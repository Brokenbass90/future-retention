import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * src/figma.js — Figma REST API integration
 *
 * Parses Figma URLs, fetches node data from the Figma API,
 * and flattens the layer tree for AI consumption.
 *
 * Required env: FIGMA_API_TOKEN
 */

const FIGMA_API_BASE = "https://api.figma.com/v1";
const FIGMA_CACHE_TTL_MS = 10 * 60 * 1000;
const FIGMA_PERSISTED_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const FIGMA_PERSISTED_CACHE_MAX_ENTRIES = 64;
const FIGMA_STRUCTURED_IMPORT_CACHE_PATH = fileURLToPath(new URL("../data/figma-import-cache.json", import.meta.url));

const FIGMA_SECTION_ROLE_PATTERNS = [
  { role: "header", pattern: /(header|logo|brand|top bar|topbar|nav)/i },
  { role: "footer", pattern: /(footer|legal|unsubscribe|terms|social|store badges|stores?)/i },
  { role: "hero", pattern: /(hero|banner|masthead|cover|promo)/i },
  { role: "cta", pattern: /(cta|button|call to action)/i },
  { role: "feature-list", pattern: /(feature|grid|list|benefit|items|columns?)/i },
  { role: "image", pattern: /(image|illustration|visual|screenshot|device|phone)/i },
  { role: "text", pattern: /(text|copy|content|body|card|message)/i }
];

const FIGMA_TEXT_ROLE_PATTERNS = [
  { role: "cta", pattern: /(cta|button|action|trade|open|continue|verify|login|reset|start|go)/i },
  { role: "legal", pattern: /(legal|unsubscribe|terms|risk warning|disclaimer|privacy|support)/i },
  { role: "eyebrow", pattern: /(eyebrow|label|kicker|caption|overline)/i },
  { role: "heading", pattern: /(title|heading|headline|hero title|subject)/i },
  { role: "body", pattern: /(body|copy|paragraph|description|text)/i }
];

const FIGMA_IMAGE_ROLE_PATTERNS = [
  { role: "logo", pattern: /(logo|brand|wordmark)/i },
  { role: "social", pattern: /(social|facebook|instagram|youtube|telegram|twitter|x\.com|linkedin|tiktok)/i },
  { role: "badge", pattern: /(badge|app store|google play|play store|store)/i },
  { role: "background", pattern: /(background|bg|texture|pattern|wallpaper|glow)/i },
  { role: "hero", pattern: /(hero|banner|masthead|cover)/i },
  { role: "icon", pattern: /(icon|bullet|feature icon)/i }
];

const FIGMA_GENERIC_WRAPPER_PATTERN = /^(frame(?:\s+\d+)?|container|wrapper|group|layout|content|canvas)$/i;
const figmaNodeDataCache = new Map();
const figmaStructuredImportCache = new Map();
let figmaStructuredImportCacheLoaded = false;

// ─── URL Parser ───────────────────────────────────────────────────────────────

/**
 * Parses any Figma URL and extracts { fileKey, nodeId }.
 * Supports: /design/FILEKEY, /file/FILEKEY, /proto/FILEKEY
 * node-id can be: ?node-id=123:456, ?node-id=123-456, or %3A encoded
 *
 * @param {string} url
 * @returns {{ fileKey: string, nodeId: string|null } | null}
 */
export function parseFigmaUrl(url) {
  if (!url || typeof url !== "string") return null;

  const fileKeyMatch = url.match(/figma\.com\/(?:design|file|proto)\/([A-Za-z0-9_-]+)/);
  if (!fileKeyMatch) return null;

  const fileKey = fileKeyMatch[1];
  const nodeIdMatch = url.match(/node-id=([0-9]+)[:\-]([0-9]+)/);
  const nodeId = nodeIdMatch ? `${nodeIdMatch[1]}:${nodeIdMatch[2]}` : null;

  return { fileKey, nodeId };
}

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function roundPositive(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? Math.round(numeric) : 0;
}

function unique(values) {
  return Array.from(new Set((Array.isArray(values) ? values : []).map(cleanText).filter(Boolean)));
}

function normalizeHex(color) {
  if (!color || typeof color !== "object") return "";
  const alpha = Number(color.a);
  if (Number.isFinite(alpha) && alpha <= 0) return "";
  const channels = [color.r, color.g, color.b]
    .map((value) => Math.max(0, Math.min(255, Math.round(Number(value || 0) * 255))));
  return `#${channels.map((value) => value.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

function readFreshCacheEntry(store, key, ttlMs = FIGMA_CACHE_TTL_MS) {
  const entry = store.get(key);
  if (!entry || !entry.value || !Number.isFinite(entry.cachedAt)) {
    return null;
  }
  if ((Date.now() - entry.cachedAt) > ttlMs) {
    return null;
  }
  return entry.value;
}

function readAnyCacheEntry(store, key) {
  const entry = store.get(key);
  return entry?.value || null;
}

function writeCacheEntry(store, key, value) {
  if (!key || !value) {
    return value;
  }
  store.set(key, {
    cachedAt: Date.now(),
    value
  });
  return value;
}

function ensureStructuredImportCacheLoaded() {
  if (figmaStructuredImportCacheLoaded) {
    return;
  }
  figmaStructuredImportCacheLoaded = true;

  try {
    if (!existsSync(FIGMA_STRUCTURED_IMPORT_CACHE_PATH)) {
      return;
    }
    const raw = readFileSync(FIGMA_STRUCTURED_IMPORT_CACHE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    const entries = Array.isArray(parsed?.entries) ? parsed.entries : [];
    const now = Date.now();
    for (const entry of entries) {
      const key = cleanText(entry?.key);
      const cachedAt = Number(entry?.cachedAt);
      if (!key || !entry?.value || !Number.isFinite(cachedAt)) {
        continue;
      }
      if ((now - cachedAt) > FIGMA_PERSISTED_CACHE_MAX_AGE_MS) {
        continue;
      }
      figmaStructuredImportCache.set(key, {
        cachedAt,
        value: entry.value
      });
    }
  } catch {
    // Ignore corrupted cache files and rebuild on the next successful import.
  }
}

function persistStructuredImportCache() {
  ensureStructuredImportCacheLoaded();

  try {
    mkdirSync(dirname(FIGMA_STRUCTURED_IMPORT_CACHE_PATH), { recursive: true });
    const entries = Array.from(figmaStructuredImportCache.entries())
      .filter(([, entry]) => entry?.value && Number.isFinite(entry?.cachedAt))
      .sort((left, right) => Number(right[1].cachedAt) - Number(left[1].cachedAt))
      .slice(0, FIGMA_PERSISTED_CACHE_MAX_ENTRIES)
      .map(([key, entry]) => ({
        key,
        cachedAt: entry.cachedAt,
        value: entry.value
      }));
    writeFileSync(FIGMA_STRUCTURED_IMPORT_CACHE_PATH, JSON.stringify({
      generatedAt: new Date().toISOString(),
      entries
    }, null, 2));
  } catch {
    // Non-fatal: keep in-memory cache even if disk persistence fails.
  }
}

function readFreshStructuredImportCacheEntry(key, ttlMs = FIGMA_CACHE_TTL_MS) {
  ensureStructuredImportCacheLoaded();
  return readFreshCacheEntry(figmaStructuredImportCache, key, ttlMs);
}

function readAnyStructuredImportCacheEntry(key) {
  ensureStructuredImportCacheLoaded();
  return readAnyCacheEntry(figmaStructuredImportCache, key);
}

function writeStructuredImportCacheEntry(key, value) {
  const stored = writeCacheEntry(figmaStructuredImportCache, key, value);
  persistStructuredImportCache();
  return stored;
}

function getBoundsArea(bounds = {}) {
  return roundPositive(bounds.width) * roundPositive(bounds.height);
}

function computeCoverage(bounds = {}, containerBounds = {}) {
  const containerArea = getBoundsArea(containerBounds);
  if (containerArea <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(1.25, getBoundsArea(bounds) / containerArea));
}

function isDarkHexColor(hex) {
  const value = cleanText(hex);
  const match = value.match(/^#([0-9A-Fa-f]{6})$/);
  if (!match) return false;
  const channels = match[1].match(/../g).map((part) => Number.parseInt(part, 16));
  const [r, g, b] = channels.map((channel) => channel / 255);
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance <= 0.38;
}

function getFirstSolidHex(node) {
  const fill = Array.isArray(node?.fills)
    ? node.fills.find((entry) => entry?.type === "SOLID" && entry?.visible !== false && entry?.color)
    : null;
  return normalizeHex(fill?.color);
}

function getFirstStrokeHex(node) {
  const stroke = Array.isArray(node?.strokes)
    ? node.strokes.find((entry) => entry?.type === "SOLID" && entry?.visible !== false && entry?.color)
    : null;
  return normalizeHex(stroke?.color);
}

function hasImageFill(node) {
  return Array.isArray(node?.fills) && node.fills.some((entry) => entry?.type === "IMAGE");
}

function getImageFillRef(node) {
  const fill = Array.isArray(node?.fills) ? node.fills.find((entry) => entry?.type === "IMAGE") : null;
  return cleanText(fill?.imageRef);
}

function extractNodeStyle(node) {
  const backgroundImage = hasImageFill(node) ? `figma-image:${cleanText(node?.id)}` : "";
  const radiusValue = roundPositive(node?.cornerRadius || node?.rectangleCornerRadii?.[0]);
  const strokeWeight = roundPositive(node?.strokeWeight);
  return {
    bgColor: getFirstSolidHex(node),
    borderColor: getFirstStrokeHex(node),
    radius: radiusValue ? `${radiusValue}px` : "",
    borderWidth: strokeWeight ? `${strokeWeight}px` : "",
    shadow: "",
    backgroundImage,
    layoutMode: cleanText(node?.layoutMode).toLowerCase(),
    textAlign: cleanText(node?.style?.textAlignHorizontal).toLowerCase(),
    paddingTop: roundPositive(node?.paddingTop),
    paddingRight: roundPositive(node?.paddingRight),
    paddingBottom: roundPositive(node?.paddingBottom),
    paddingLeft: roundPositive(node?.paddingLeft)
  };
}

function getNodeBounds(node, rootBox = null) {
  const box = node?.absoluteBoundingBox && typeof node.absoluteBoundingBox === "object"
    ? node.absoluteBoundingBox
    : {};
  const absolute = {
    x: roundPositive(box.x),
    y: roundPositive(box.y),
    width: roundPositive(box.width),
    height: roundPositive(box.height)
  };

  if (!rootBox) {
    return absolute;
  }

  return {
    x: Math.max(0, absolute.x - roundPositive(rootBox.x)),
    y: Math.max(0, absolute.y - roundPositive(rootBox.y)),
    width: absolute.width,
    height: absolute.height
  };
}

function getNodeLineHeight(node) {
  const px = Number(node?.style?.lineHeightPx);
  if (Number.isFinite(px) && px > 0) {
    return `${Math.round(px)}px`;
  }
  return "";
}

function getNodeLetterSpacing(node) {
  const px = Number(node?.style?.letterSpacing);
  if (Number.isFinite(px) && px !== 0) {
    return `${px}px`;
  }
  return "";
}

function inferRoleFromPatterns(value, patterns, fallback = "unknown") {
  const source = cleanText(value);
  if (!source) return fallback;
  const matched = patterns.find((entry) => entry.pattern.test(source));
  return matched?.role || fallback;
}

function inferDirectionFromText(text) {
  const source = cleanText(text);
  if (!source) return "";
  return /[\u0590-\u08FF]/.test(source) ? "rtl" : "ltr";
}

function inferLocaleHintsFromTexts(texts = []) {
  const joined = (Array.isArray(texts) ? texts : []).map(cleanText).join(" ");
  const hints = [];
  if (/[\u0600-\u06FF]/.test(joined)) hints.push("arabic-script");
  if (/[\u0750-\u077F\u08A0-\u08FF]/.test(joined)) hints.push("urdu-script");
  if (/[A-Za-z]/.test(joined)) hints.push("latin-script");
  if (hints.includes("arabic-script") || hints.includes("urdu-script")) {
    hints.push("rtl-script");
  }
  return unique(hints);
}

function inferDirectionHintFromLocaleHints(localeHints = [], texts = []) {
  const hints = new Set(localeHints);
  if (hints.has("arabic-script") || hints.has("urdu-script") || hints.has("rtl-script")) {
    return "rtl";
  }
  return texts.some((text) => inferDirectionFromText(text) === "rtl") ? "rtl" : "ltr";
}

function isVisibleNode(node) {
  return node && node.visible !== false;
}

function nodeHasTextDescendant(node) {
  if (!node || !Array.isArray(node.children)) return false;
  for (const child of node.children) {
    if (child?.type === "TEXT" && cleanText(child?.characters)) {
      return true;
    }
    if (nodeHasTextDescendant(child)) {
      return true;
    }
  }
  return false;
}

function isLikelyGraphicNode(node) {
  if (!node || node.type === "TEXT" || !isVisibleNode(node)) return false;

  if (hasImageFill(node)) return true;

  const name = cleanText(node?.name);
  if (inferRoleFromPatterns(name, FIGMA_IMAGE_ROLE_PATTERNS, "") !== "") {
    return true;
  }

  if (["VECTOR", "BOOLEAN_OPERATION", "STAR", "POLYGON", "ELLIPSE", "LINE"].includes(node.type)) {
    return true;
  }

  if (["RECTANGLE", "FRAME", "GROUP", "INSTANCE", "COMPONENT"].includes(node.type) && !nodeHasTextDescendant(node)) {
    const bounds = getNodeBounds(node);
    return bounds.width >= 12 && bounds.height >= 12;
  }

  return false;
}

function inferSectionRole(node) {
  return inferRoleFromPatterns(node?.name, FIGMA_SECTION_ROLE_PATTERNS, "unknown");
}

function inferTextRole(node) {
  const byName = inferRoleFromPatterns(node?.name, FIGMA_TEXT_ROLE_PATTERNS, "");
  if (byName) return byName;

  const text = cleanText(node?.characters);
  const fontSize = roundPositive(node?.style?.fontSize);
  const fontWeight = roundPositive(node?.style?.fontWeight);
  if (/unsubscribe|terms|risk warning|disclaimer|privacy/i.test(text)) return "legal";
  if (fontSize >= 26 || fontWeight >= 650) return "heading";
  return "body";
}

function inferImageRole(node, rootBounds = null) {
  const byName = inferRoleFromPatterns(node?.name, FIGMA_IMAGE_ROLE_PATTERNS, "");
  if (byName) return byName;

  const bounds = getNodeBounds(node, rootBounds);
  const rootWidth = roundPositive(rootBounds?.width);
  const rootHeight = roundPositive(rootBounds?.height);
  if (hasImageFill(node) && rootWidth > 0 && bounds.width >= rootWidth * 0.72 && bounds.height >= Math.max(180, rootHeight * 0.2)) {
    return "background";
  }
  if (rootWidth > 0 && bounds.width <= rootWidth * 0.22 && bounds.height <= 140) {
    return "icon";
  }
  return "section";
}

function isVectorLikeGraphic(node) {
  return ["VECTOR", "BOOLEAN_OPERATION", "STAR", "POLYGON", "ELLIPSE", "LINE"].includes(cleanText(node?.type).toUpperCase());
}

function inferImagePlacement(role = "", bounds = {}, rootBounds = null) {
  const normalizedRole = cleanText(role);
  const rootWidth = roundPositive(rootBounds?.width);
  const width = roundPositive(bounds?.width);
  const height = roundPositive(bounds?.height);

  if (normalizedRole === "background") return "background";
  if (normalizedRole === "logo") return "header";
  if (normalizedRole === "badge") return "store-row";
  if (normalizedRole === "social") return "social-row";
  if (normalizedRole === "hero") return "hero";
  if (normalizedRole === "icon") return width <= 120 && height <= 120 ? "inline-icon" : "card-art";
  if (rootWidth > 0 && width >= rootWidth * 0.65) return "hero";
  return "section";
}

function inferImagePrep(node, role = "", bounds = {}, rootBounds = null) {
  const normalizedRole = cleanText(role);
  const width = roundPositive(bounds?.width);
  const height = roundPositive(bounds?.height);
  const vectorLike = isVectorLikeGraphic(node);
  const hasTransparencyCandidate = Boolean(
    vectorLike
    || hasImageFill(node)
    || ["logo", "icon", "social"].includes(normalizedRole)
  );

  let recommendedFormat = "png";
  if (normalizedRole === "logo" && vectorLike) {
    recommendedFormat = "svg";
  } else if (normalizedRole === "background") {
    recommendedFormat = "jpg";
  } else if (normalizedRole === "badge") {
    recommendedFormat = "png";
  }

  let trim = "preserve";
  if (["logo", "icon", "social"].includes(normalizedRole)) {
    trim = "tight";
  } else if (normalizedRole === "background") {
    trim = "none";
  }

  let padding = 0;
  if (normalizedRole === "logo") {
    padding = 4;
  } else if (["icon", "social"].includes(normalizedRole)) {
    padding = 8;
  } else if (normalizedRole === "hero" && width > 0 && height > 0) {
    padding = 12;
  }

  const postProcess = [];
  if (trim === "tight") {
    postProcess.push("trim-transparent-margins");
  }
  if (padding > 0) {
    postProcess.push("add-safe-padding");
  }
  if (recommendedFormat !== "svg") {
    postProcess.push("optimize-export-size");
  }
  if (normalizedRole === "background") {
    postProcess.push("prefer-css-background-when-possible");
  }
  if (["hero", "section"].includes(normalizedRole) && width >= 240) {
    postProcess.push("export-2x");
  }

  return {
    recommendedFormat,
    transparency: hasTransparencyCandidate ? "keep" : "flatten-light",
    trim,
    padding,
    placement: inferImagePlacement(normalizedRole, bounds, rootBounds),
    postProcess
  };
}

function inferColumnCount(nodes = [], rootWidth = 0) {
  const anchors = [];
  const threshold = Math.max(72, rootWidth * 0.12);
  const positioned = (Array.isArray(nodes) ? nodes : [])
    .map((node) => getNodeBounds(node))
    .filter((bounds) => bounds.width > 0)
    .sort((left, right) => left.x - right.x);

  for (const bounds of positioned) {
    const existing = anchors.find((anchor) => Math.abs(anchor - bounds.x) <= threshold);
    if (existing == null) {
      anchors.push(bounds.x);
    }
  }

  return Math.min(Math.max(anchors.length, 1), 4);
}

function isLikelySurfaceNode(node, rootBounds = null, containerBounds = null) {
  if (!node || !isVisibleNode(node) || node?.type === "TEXT") {
    return false;
  }

  const bounds = getNodeBounds(node, rootBounds);
  const coverage = computeCoverage(bounds, containerBounds || bounds);
  const style = extractNodeStyle(node);
  const hasSurfaceSignals = Boolean(
    style.bgColor
    || style.borderColor
    || style.radius
    || style.borderWidth
    || style.backgroundImage
  );

  if (!hasSurfaceSignals) {
    return false;
  }

  if (bounds.width < 24 || bounds.height < 16) {
    return false;
  }

  if (style.backgroundImage) {
    return coverage >= 0.28;
  }

  return coverage >= 0.14;
}

function inferSurfaceKind(style = {}, surfaceBounds = {}, containerBounds = {}, rootBounds = null) {
  const coverage = computeCoverage(surfaceBounds, containerBounds);
  const rootWidth = roundPositive(rootBounds?.width);
  const containerWidth = roundPositive(containerBounds?.width);
  const widthRatio = containerWidth > 0 ? roundPositive(surfaceBounds.width) / containerWidth : 0;
  const nearFullWidth = rootWidth > 0
    ? roundPositive(surfaceBounds.width) >= rootWidth * 0.94
    : widthRatio >= 0.94;
  const looksLikeCard = Boolean(
    cleanText(style.radius)
    || cleanText(style.borderColor)
    || cleanText(style.borderWidth)
  );

  if (looksLikeCard && (!nearFullWidth || coverage < 0.98)) {
    return "card";
  }

  if (cleanText(style.backgroundImage) && (coverage >= 0.58 || nearFullWidth)) {
    return "band";
  }

  if (coverage >= 0.7 && nearFullWidth) {
    return "band";
  }

  if (looksLikeCard || coverage <= 0.92) {
    return "card";
  }

  return "";
}

function findSectionSurfaceNode(sourceNode, rootBounds = null, containerBounds = null) {
  if (!sourceNode || typeof sourceNode !== "object") {
    return null;
  }

  const candidates = [];
  const addCandidate = (node) => {
    if (!isLikelySurfaceNode(node, rootBounds, containerBounds)) {
      return;
    }
    const bounds = getNodeBounds(node, rootBounds);
    const coverage = computeCoverage(bounds, containerBounds || bounds);
    const style = extractNodeStyle(node);
    let score = 0;

    if (style.backgroundImage) score += 7;
    if (style.bgColor) score += 4;
    if (style.borderColor) score += 2;
    if (style.radius) score += 2;
    if (style.borderWidth) score += 1;

    if (coverage >= 0.8) score += 5;
    else if (coverage >= 0.55) score += 4;
    else if (coverage >= 0.28) score += 3;
    else score += 1;

    if (containerBounds?.width && bounds.width >= roundPositive(containerBounds.width) * 0.88) {
      score += 2;
    }
    if (containerBounds?.height && bounds.height >= roundPositive(containerBounds.height) * 0.45) {
      score += 1;
    }

    candidates.push({ node, score, coverage, bounds, style });
  };

  addCandidate(sourceNode);
  traverseFigmaNode(sourceNode, (child) => {
    if (child === sourceNode) return;
    addCandidate(child);
  });

  candidates.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    return getBoundsArea(right.bounds) - getBoundsArea(left.bounds);
  });

  return candidates[0] || null;
}

function buildSectionStyle(node, { rootBounds = null, containerBounds = null } = {}) {
  const sourceStyle = extractNodeStyle(node);
  const surfaceCandidate = findSectionSurfaceNode(node, rootBounds, containerBounds);
  const surfaceNode = surfaceCandidate?.node || null;
  const surfaceStyle = surfaceCandidate?.style || {};
  const effectiveStyle = {
    bgColor: surfaceStyle.bgColor || sourceStyle.bgColor,
    borderColor: surfaceStyle.borderColor || sourceStyle.borderColor,
    radius: surfaceStyle.radius || sourceStyle.radius,
    borderWidth: surfaceStyle.borderWidth || sourceStyle.borderWidth,
    shadow: surfaceStyle.shadow || sourceStyle.shadow,
    backgroundImage: surfaceStyle.backgroundImage || sourceStyle.backgroundImage,
    layoutMode: sourceStyle.layoutMode || surfaceStyle.layoutMode,
    textAlign: sourceStyle.textAlign || surfaceStyle.textAlign,
    paddingTop: sourceStyle.paddingTop || surfaceStyle.paddingTop,
    paddingRight: sourceStyle.paddingRight || surfaceStyle.paddingRight,
    paddingBottom: sourceStyle.paddingBottom || surfaceStyle.paddingBottom,
    paddingLeft: sourceStyle.paddingLeft || surfaceStyle.paddingLeft
  };
  const surfaceBounds = surfaceCandidate?.bounds || getNodeBounds(surfaceNode || node, rootBounds);
  const surfaceCoverage = computeCoverage(surfaceBounds, containerBounds || surfaceBounds);

  return {
    ...effectiveStyle,
    surfaceNodeId: cleanText(surfaceNode?.id),
    surfaceKind: inferSurfaceKind(effectiveStyle, surfaceBounds, containerBounds || surfaceBounds, rootBounds),
    surfaceCoverage: surfaceCoverage ? Math.round(surfaceCoverage * 100) / 100 : 0,
    isDark: isDarkHexColor(effectiveStyle.bgColor)
  };
}

function pickDefaultFrame(browseResult) {
  const pages = Array.isArray(browseResult?.pages) ? browseResult.pages : [];
  let best = null;
  for (const page of pages) {
    for (const frame of Array.isArray(page.frames) ? page.frames : []) {
      const area = roundPositive(frame.width) * roundPositive(frame.height);
      if (!best || area > best.area) {
        best = {
          pageName: cleanText(page.name),
          nodeId: cleanText(frame.id),
          selectionName: cleanText(frame.name),
          area
        };
      }
    }
  }
  return best;
}

function traverseFigmaNode(node, visit, parentSectionId = "", rootNode = null) {
  if (!node || !isVisibleNode(node)) return;
  visit(node, parentSectionId, rootNode);
  for (const child of Array.isArray(node.children) ? node.children : []) {
    traverseFigmaNode(child, visit, parentSectionId, rootNode);
  }
}

function collectSectionChildren(node) {
  const ids = [];
  traverseFigmaNode(node, (child) => {
    if (child?.id && child !== node) {
      ids.push(cleanText(child.id));
    }
  });
  return unique(ids).slice(0, 80);
}

function collectStructuredLeafNodes(node, rootBounds = null, includeSelf = false) {
  const leaves = [];
  const maybePushLeaf = (child) => {
    if (!child || !isVisibleNode(child)) {
      return;
    }

    const hasVisibleChildren = Array.isArray(child?.children) && child.children.some((grandChild) => isVisibleNode(grandChild));

    if (child?.type === "TEXT" && cleanText(child?.characters)) {
      leaves.push({
        id: cleanText(child.id),
        type: "TEXT",
        roleHint: inferTextRole(child),
        bounds: getNodeBounds(child, rootBounds),
        node: child
      });
      return;
    }

    if (isLikelyGraphicNode(child) && !hasVisibleChildren) {
      leaves.push({
        id: cleanText(child.id),
        type: "IMAGE",
        roleHint: inferImageRole(child, rootBounds),
        bounds: getNodeBounds(child, rootBounds),
        node: child
      });
    }
  };

  if (includeSelf) {
    maybePushLeaf(node);
  }

  traverseFigmaNode(node, (child) => {
    if (child === node || !isVisibleNode(child)) {
      return;
    }
    maybePushLeaf(child);
  });
  return leaves;
}

function groupLeafNodesByVerticalBands(leaves = [], rootHeight = 0, maxGap = 0) {
  const relevant = (Array.isArray(leaves) ? leaves : [])
    .filter((entry) => entry?.bounds?.height > 0)
    .sort((left, right) => (left.bounds.y - right.bounds.y) || (left.bounds.x - right.bounds.x));

  if (relevant.length === 0) {
    return [];
  }

  const gapThreshold = maxGap || Math.max(56, rootHeight * 0.035);
  const groups = [];
  let current = [];
  let currentBottom = 0;

  for (const entry of relevant) {
    const top = roundPositive(entry.bounds.y);
    const bottom = top + roundPositive(entry.bounds.height);
    if (current.length === 0) {
      current = [entry];
      currentBottom = bottom;
      continue;
    }

    const gap = top - currentBottom;
    if (gap > gapThreshold) {
      groups.push(current);
      current = [entry];
      currentBottom = bottom;
      continue;
    }

    current.push(entry);
    currentBottom = Math.max(currentBottom, bottom);
  }

  if (current.length > 0) {
    groups.push(current);
  }

  return groups;
}

function summarizeLeafRoles(leaves = []) {
  const roles = new Set();
  for (const leaf of Array.isArray(leaves) ? leaves : []) {
    if (leaf?.roleHint) {
      roles.add(cleanText(leaf.roleHint));
    }
  }
  return roles;
}

function countLeafRoles(leaves = []) {
  const counts = {};
  for (const leaf of Array.isArray(leaves) ? leaves : []) {
    const role = cleanText(leaf?.roleHint);
    if (!role) continue;
    counts[role] = (counts[role] || 0) + 1;
  }
  return counts;
}

function inferSectionSummaryFromLeaves(leaves = [], fallback = "") {
  const snippets = (Array.isArray(leaves) ? leaves : [])
    .filter((leaf) => leaf?.type === "TEXT")
    .map((leaf) => cleanText(leaf?.node?.characters))
    .filter(Boolean)
    .slice(0, 3);

  if (snippets.length === 0) {
    return cleanText(fallback);
  }

  return snippets.join(" | ").slice(0, 280);
}

function inferSectionRoleFromLeaves(node, leaves = [], rootBounds = null) {
  const byName = inferSectionRole(node);
  if (byName && byName !== "unknown") {
    return byName;
  }

  const roles = summarizeLeafRoles(leaves);
  const roleCounts = countLeafRoles(leaves);
  const bounds = getNodeBounds(node, rootBounds);
  const hasReadableCopy = roles.has("heading") || roles.has("body") || roles.has("eyebrow");
  const nearTop = rootBounds?.height ? bounds.y <= roundPositive(rootBounds.height) * 0.42 : bounds.y <= 260;
  const nearBottom = rootBounds?.height
    ? bounds.y + bounds.height >= roundPositive(rootBounds.height) * 0.76
    : bounds.y >= 520;
  const footerSignalCount = (roleCounts.legal || 0) + (roleCounts.social || 0) + (roleCounts.badge || 0);
  const strongFooterSignals = footerSignalCount >= 2 || roleCounts.legal >= 1;

  if (roles.has("logo") && !hasReadableCopy && !roles.has("cta")) {
    return "header";
  }

  if (roles.has("logo") && hasReadableCopy && nearTop) {
    return "hero";
  }

  if (strongFooterSignals && nearBottom && !nearTop) {
    return "footer";
  }

  if (roles.has("hero") || roles.has("background")) {
    return "hero";
  }

  if (hasReadableCopy && nearTop) {
    return roles.has("cta") && !roles.has("heading") && !roles.has("body") ? "cta" : "hero";
  }

  if (hasReadableCopy && roles.has("cta") && (roleCounts.heading || 0) + (roleCounts.body || 0) >= 2) {
    return "text";
  }

  if (roles.has("cta")) {
    return "cta";
  }

  if (Array.from(roles).filter((role) => role === "icon" || role === "section").length >= 3) {
    return "feature-list";
  }

  if (roles.has("heading") || roles.has("body")) {
    return "text";
  }

  if (rootBounds?.height && nearBottom) {
    return "footer";
  }

  return "unknown";
}

function resolveSectionExtractionRoot(node, rootBounds = null) {
  let current = node;
  let depth = 0;

  while (current && depth < 4) {
    const visibleChildren = getVisibleSectionChildren(current, rootBounds);
    if (visibleChildren.length !== 1) {
      break;
    }

    const child = visibleChildren[0];
    const currentBounds = getNodeBounds(current, rootBounds);
    const childBounds = getNodeBounds(child, rootBounds);
    const childCoverage = computeCoverage(childBounds, currentBounds);
    const childHasStructure = getVisibleSectionChildren(child, rootBounds).length >= 2 || nodeHasTextDescendant(child);
    const childName = cleanText(child?.name);

    if (!childHasStructure || childCoverage < 0.7 || !FIGMA_GENERIC_WRAPPER_PATTERN.test(childName)) {
      break;
    }

    current = child;
    depth += 1;
  }

  return current || node;
}

function buildSectionDescriptor({
  id = "",
  role = "unknown",
  name = "",
  x = 0,
  y = 0,
  width = 0,
  height = 0,
  componentName = "",
  style = {},
  memberLeaves = [],
  sourceNode = null,
  rootBounds = null
} = {}) {
  const normalizedLeaves = Array.isArray(memberLeaves) ? memberLeaves.filter(Boolean) : [];
  const sourceNodeId = cleanText(sourceNode?.id);
  const containerBounds = {
    x: roundPositive(x),
    y: roundPositive(y),
    width: roundPositive(width),
    height: roundPositive(height)
  };
  return {
    id: cleanText(id),
    role: cleanText(role) || "unknown",
    name: cleanText(name),
    x: containerBounds.x,
    y: containerBounds.y,
    width: containerBounds.width,
    height: containerBounds.height,
    columnCount: inferColumnCount(normalizedLeaves.map((entry) => entry.node).filter(Boolean), roundPositive(rootBounds?.width)),
    archetype: "",
    componentName: cleanText(componentName),
    children: unique(normalizedLeaves.map((entry) => cleanText(entry.id)).filter((childId) => childId && childId !== sourceNodeId)).slice(0, 80),
    style: style && typeof style === "object" && Object.keys(style).length > 0
      ? style
      : buildSectionStyle(sourceNode, { rootBounds, containerBounds }),
    summaryText: inferSectionSummaryFromLeaves(normalizedLeaves, name),
    __memberLeafIds: new Set(normalizedLeaves.map((entry) => cleanText(entry.id)).filter(Boolean)),
    __sourceNodeId: cleanText(sourceNode?.id)
  };
}

function splitFooterDescriptor(child, leafNodes = [], rootBounds = null) {
  const groups = groupLeafNodesByVerticalBands(leafNodes, roundPositive(rootBounds?.height), Math.max(40, roundPositive(rootBounds?.height) * 0.025));
  if (groups.length < 2) {
    return null;
  }

  return groups.map((group, index) => {
    const groupRoles = summarizeLeafRoles(group);
    const x = Math.min(...group.map((entry) => roundPositive(entry.bounds.x)));
    const y = Math.min(...group.map((entry) => roundPositive(entry.bounds.y)));
    const right = Math.max(...group.map((entry) => roundPositive(entry.bounds.x) + roundPositive(entry.bounds.width)));
    const bottom = Math.max(...group.map((entry) => roundPositive(entry.bounds.y) + roundPositive(entry.bounds.height)));
    let label = `Footer row ${index + 1}`;
    if (groupRoles.has("badge") && !groupRoles.has("social") && !groupRoles.has("legal")) {
      label = "Store badges";
    } else if (groupRoles.has("social") && !groupRoles.has("badge") && !groupRoles.has("legal")) {
      label = "Social links";
    } else if (groupRoles.has("legal") && !groupRoles.has("badge") && !groupRoles.has("social")) {
      label = "Legal copy";
    } else if (groupRoles.has("badge") && groupRoles.has("social")) {
      label = "Store and social";
    } else if (groupRoles.has("social") || groupRoles.has("legal")) {
      label = "Footer band";
    }

    return buildSectionDescriptor({
      id: `${cleanText(child.id)}::footer-${String(index + 1).padStart(2, "0")}`,
      role: "footer",
      name: `${cleanText(child.name) || "Footer"} / ${label}`,
      x,
      y,
      width: Math.max(0, right - x),
      height: Math.max(0, bottom - y),
      componentName: ["INSTANCE", "COMPONENT", "COMPONENT_SET"].includes(child?.type) ? cleanText(child.name) : "",
      style: {
        ...buildSectionStyle(child, {
          rootBounds,
          containerBounds: { x, y, width: Math.max(0, right - x), height: Math.max(0, bottom - y) }
        }),
        paddingTop: 0,
        paddingRight: 0,
        paddingBottom: 0,
        paddingLeft: 0
      },
      memberLeaves: group,
      sourceNode: child,
      rootBounds
    });
  });
}

function buildAutoBandSections(rootNode, directChildren = [], rootBounds = null) {
  const childEntries = (Array.isArray(directChildren) ? directChildren : [])
    .map((child) => {
      const bounds = getNodeBounds(child, rootBounds);
      let memberLeaves = collectStructuredLeafNodes(child, rootBounds, true);

      if (memberLeaves.length === 0) {
        const leafRole = child?.type === "TEXT" && cleanText(child?.characters)
          ? inferTextRole(child)
          : isLikelyGraphicNode(child)
            ? inferImageRole(child, rootBounds)
            : "unknown";
        if (leafRole !== "unknown") {
          memberLeaves = [{
            id: cleanText(child.id),
            type: child?.type === "TEXT" ? "TEXT" : "IMAGE",
            roleHint: leafRole,
            bounds,
            node: child
          }];
        }
      }

      return {
        id: cleanText(child.id),
        bounds,
        node: child,
        memberLeaves,
        sectionRole: inferSectionRoleFromLeaves(child, memberLeaves, rootBounds)
      };
    })
    .filter((entry) => entry.id && entry.bounds.width >= 16 && entry.bounds.height >= 16);

  const sortedEntries = childEntries
    .slice()
    .sort((left, right) => (left.bounds.y - right.bounds.y) || (left.bounds.x - right.bounds.x));

  const shouldSplitBeforeChild = (currentGroup, nextEntry) => {
    if (!Array.isArray(currentGroup) || currentGroup.length === 0 || !nextEntry) {
      return false;
    }

    const currentBottom = Math.max(
      ...currentGroup.map((entry) => roundPositive(entry.bounds.y) + roundPositive(entry.bounds.height))
    );
    const nextTop = roundPositive(nextEntry.bounds.y);
    const gap = Math.max(0, nextTop - currentBottom);
    const rootHeight = roundPositive(rootBounds?.height);
    const baseGap = Math.max(48, rootHeight * 0.03);
    const currentRoles = new Set(currentGroup.map((entry) => cleanText(entry.sectionRole)).filter(Boolean));
    const nextRole = cleanText(nextEntry.sectionRole);
    const currentOnlyHeader = currentRoles.size === 1 && currentRoles.has("header");
    const currentHasReadable = currentRoles.has("hero") || currentRoles.has("text");

    if (currentRoles.has("footer") && nextRole !== "footer") {
      return true;
    }

    if (nextRole === "footer" && !currentRoles.has("footer")) {
      return currentGroup.length > 0;
    }

    if (nextRole === "header") {
      return true;
    }

    if (currentOnlyHeader && nextRole !== "header") {
      return gap >= 20;
    }

    if (nextRole === "cta" && (currentHasReadable || currentRoles.has("header"))) {
      return gap >= 28;
    }

    if (currentRoles.has("cta") && nextRole !== "cta") {
      return gap >= 28;
    }

    return gap > baseGap;
  };

  const groups = [];
  let currentGroup = [];
  for (const entry of sortedEntries) {
    if (currentGroup.length === 0) {
      currentGroup = [entry];
      continue;
    }

    if (shouldSplitBeforeChild(currentGroup, entry)) {
      groups.push(currentGroup);
      currentGroup = [entry];
      continue;
    }

    currentGroup.push(entry);
  }
  if (currentGroup.length > 0) {
    groups.push(currentGroup);
  }

  if (groups.length < 2) {
    return null;
  }

  return groups.map((group, index) => {
    const memberLeaves = group.flatMap((entry) => Array.isArray(entry.memberLeaves) ? entry.memberLeaves : []);
    const x = Math.min(...group.map((entry) => roundPositive(entry.bounds.x)));
    const y = Math.min(...group.map((entry) => roundPositive(entry.bounds.y)));
    const right = Math.max(...group.map((entry) => roundPositive(entry.bounds.x) + roundPositive(entry.bounds.width)));
    const bottom = Math.max(...group.map((entry) => roundPositive(entry.bounds.y) + roundPositive(entry.bounds.height)));
    const fakeNode = {
      id: `auto-band-${String(index + 1).padStart(2, "0")}`,
      name: `Auto band ${index + 1}`,
      absoluteBoundingBox: {
        x: roundPositive(rootBounds?.x) + x,
        y: roundPositive(rootBounds?.y) + y,
        width: Math.max(0, right - x),
        height: Math.max(0, bottom - y)
      }
    };
    const role = inferSectionRoleFromLeaves(fakeNode, memberLeaves, rootBounds);
    return buildSectionDescriptor({
      id: fakeNode.id,
      role,
      name: `${cleanText(role) || "section"} ${index + 1}`,
      x,
      y,
      width: Math.max(0, right - x),
      height: Math.max(0, bottom - y),
      componentName: "",
      style: {},
      memberLeaves,
      sourceNode: fakeNode,
      rootBounds
    });
  });
}

function getVisibleSectionChildren(node, rootBounds = null) {
  return Array.isArray(node?.children)
    ? node.children.filter((child) => isVisibleNode(child) && getNodeBounds(child, rootBounds).width >= 24 && getNodeBounds(child, rootBounds).height >= 16)
    : [];
}

function shouldExplodeCompositeChild(node, leafNodes = [], rootBounds = null) {
  const visibleChildren = getVisibleSectionChildren(node, rootBounds);
  if (visibleChildren.length < 3 || leafNodes.length < 6) {
    return false;
  }

  const bounds = getNodeBounds(node, rootBounds);
  const rootWidth = roundPositive(rootBounds?.width);
  const rootHeight = roundPositive(rootBounds?.height);
  if (rootWidth <= 0 || rootHeight <= 0) {
    return false;
  }

  const textLeafCount = leafNodes.filter((leaf) => leaf?.type === "TEXT" && cleanText(leaf?.node?.characters)).length;
  if (textLeafCount < 3) {
    return false;
  }

  const uniqueRoles = new Set(
    leafNodes
      .map((leaf) => cleanText(leaf?.roleHint))
      .filter((role) => role && role !== "unknown" && role !== "background")
  );
  if (uniqueRoles.size < 2) {
    return false;
  }

  const top = Math.min(...leafNodes.map((leaf) => roundPositive(leaf?.bounds?.y)));
  const bottom = Math.max(...leafNodes.map((leaf) => roundPositive(leaf?.bounds?.y) + roundPositive(leaf?.bounds?.height)));
  const verticalSpread = Math.max(0, bottom - top);

  return Boolean(
    bounds.width >= rootWidth * 0.62
    && bounds.height >= rootHeight * 0.3
    && verticalSpread >= bounds.height * 0.58
  );
}

function buildSectionDescriptors(rootNode, rootBounds = null) {
  const visibleChildren = getVisibleSectionChildren(rootNode, rootBounds);

  if (visibleChildren.length === 0) {
    const leafNodes = collectStructuredLeafNodes(rootNode, rootBounds, true);
    return [
      buildSectionDescriptor({
        id: cleanText(rootNode?.id),
        role: inferSectionRoleFromLeaves(rootNode, leafNodes, rootBounds),
        name: cleanText(rootNode?.name) || "Frame",
        ...getNodeBounds(rootNode, rootBounds),
        componentName: ["INSTANCE", "COMPONENT", "COMPONENT_SET"].includes(rootNode?.type) ? cleanText(rootNode.name) : "",
        style: buildSectionStyle(rootNode, {
          rootBounds,
          containerBounds: getNodeBounds(rootNode, rootBounds)
        }),
        memberLeaves: leafNodes,
        sourceNode: rootNode,
        rootBounds
      })
    ];
  }

  const structuralChildren = visibleChildren.filter((child) => {
    const bounds = getNodeBounds(child, rootBounds);
    return (
      ["FRAME", "GROUP", "INSTANCE", "COMPONENT", "COMPONENT_SET"].includes(child?.type)
      || bounds.width >= roundPositive(rootBounds?.width) * 0.68
      || nodeHasTextDescendant(child)
    );
  });
  const shouldUseAutoBands = (
    (visibleChildren.length >= 10 && structuralChildren.length <= Math.ceil(visibleChildren.length * 0.45))
    || (visibleChildren.length >= 5 && structuralChildren.length <= 2)
  );

  if (shouldUseAutoBands) {
    const autoSections = buildAutoBandSections(rootNode, visibleChildren, rootBounds);
    if (Array.isArray(autoSections) && autoSections.length > 0) {
      return autoSections;
    }
  }

  const descriptors = [];
  for (const child of visibleChildren) {
    const leafNodes = collectStructuredLeafNodes(child, rootBounds, true);
    if (shouldExplodeCompositeChild(child, leafNodes, rootBounds)) {
      const nestedAutoSections = buildAutoBandSections(child, getVisibleSectionChildren(child, rootBounds), rootBounds);
      if (Array.isArray(nestedAutoSections) && nestedAutoSections.length >= 2) {
        descriptors.push(...nestedAutoSections);
        continue;
      }
    }

    const role = inferSectionRoleFromLeaves(child, leafNodes, rootBounds);
    if (role === "footer") {
      const footerSplit = splitFooterDescriptor(child, leafNodes, rootBounds);
      if (Array.isArray(footerSplit) && footerSplit.length > 0) {
        descriptors.push(...footerSplit);
        continue;
      }
    }

    const bounds = getNodeBounds(child, rootBounds);
    descriptors.push(
      buildSectionDescriptor({
        id: cleanText(child.id),
        role,
        name: cleanText(child.name),
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
      componentName: ["INSTANCE", "COMPONENT", "COMPONENT_SET"].includes(child?.type) ? cleanText(child.name) : "",
        style: buildSectionStyle(child, { rootBounds, containerBounds: bounds }),
        memberLeaves: leafNodes,
        sourceNode: child,
        rootBounds
      })
    );
  }

  return descriptors;
}

export function buildStructuredImportFromNode({
  fileKey = "",
  nodeId = "",
  selectionName = "",
  pageName = "",
  rootNode = null,
  previewUrl = "",
  imageUrlMap = {}
} = {}) {
  if (!rootNode || typeof rootNode !== "object") {
    return null;
  }

  const rootBounds = getNodeBounds(rootNode);
  const effectiveSectionRoot = resolveSectionExtractionRoot(rootNode, rootBounds);
  const sectionDescriptors = buildSectionDescriptors(effectiveSectionRoot, rootBounds);
  const sectionMembership = new Map();
  const sectionSourceNodeIds = new Set();

  const sections = [];
  const textNodes = [];
  const imageSlots = [];
  const textSamples = [];
  const componentNames = [];
  const layerNames = [];

  for (const descriptor of sectionDescriptors) {
    sections.push({
      id: descriptor.id,
      role: descriptor.role,
      name: descriptor.name,
      x: descriptor.x,
      y: descriptor.y,
      width: descriptor.width,
      height: descriptor.height,
      columnCount: descriptor.columnCount,
      archetype: "",
      componentName: descriptor.componentName,
      children: descriptor.children,
      style: descriptor.style,
      summaryText: descriptor.summaryText
    });
    for (const childId of descriptor.__memberLeafIds) {
      if (childId) {
        sectionMembership.set(childId, descriptor.id);
      }
    }
    if (descriptor.__sourceNodeId) {
      sectionSourceNodeIds.add(descriptor.__sourceNodeId);
    }
  }

  traverseFigmaNode(rootNode, (node) => {
    if (node?.name) layerNames.push(cleanText(node.name));
    if (["INSTANCE", "COMPONENT", "COMPONENT_SET"].includes(node?.type) && node?.name) {
      componentNames.push(cleanText(node.name));
    }

    const bounds = getNodeBounds(node, rootBounds);
    const sectionId = sectionMembership.get(cleanText(node?.id)) || "";

    if (node?.type === "TEXT" && cleanText(node?.characters)) {
      const text = cleanText(node.characters);
      textSamples.push(text);
      textNodes.push({
        id: cleanText(node.id),
        roleHint: inferTextRole(node),
        text,
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        fontFamily: cleanText(node?.style?.fontFamily),
        fontSize: roundPositive(node?.style?.fontSize),
        fontWeight: roundPositive(node?.style?.fontWeight),
        lineHeight: getNodeLineHeight(node),
        letterSpacing: getNodeLetterSpacing(node),
        align: cleanText(node?.style?.textAlignHorizontal).toLowerCase(),
        direction: inferDirectionFromText(text),
        textCase: cleanText(node?.style?.textCase).toLowerCase(),
        color: getFirstSolidHex(node),
        sectionId
      });
      return;
    }

    if (node !== rootNode && isLikelyGraphicNode(node) && !sectionSourceNodeIds.has(cleanText(node?.id))) {
      const roleHint = inferImageRole(node, rootBounds);
      imageSlots.push({
        id: cleanText(node.id),
        roleHint,
        name: cleanText(node.name),
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        sectionId,
        alt: cleanText(node.name),
        componentName: ["INSTANCE", "COMPONENT", "COMPONENT_SET"].includes(node?.type) ? cleanText(node.name) : "",
        imageHash: getImageFillRef(node),
        exportRef: imageUrlMap[cleanText(node.id)] ? `figma-export:${cleanText(node.id)}` : "",
        isBackground: hasImageFill(node) && roleHint === "background",
        prep: inferImagePrep(node, roleHint, bounds, rootBounds),
        assetSource: {
          kind: imageUrlMap[cleanText(node.id)] ? "figma-export" : "",
          mimeType: imageUrlMap[cleanText(node.id)] ? "image/png" : "",
          url: cleanText(imageUrlMap[cleanText(node.id)]),
          dataUrl: ""
        }
      });
    }
  }, "", rootNode);

  if (sections.length === 0) {
    const fallbackLeaves = collectStructuredLeafNodes(rootNode, rootBounds, true);
    const fallbackDescriptor = buildSectionDescriptor({
      id: cleanText(rootNode.id),
      role: inferSectionRoleFromLeaves(rootNode, fallbackLeaves, rootBounds),
      name: cleanText(rootNode.name) || "Frame",
      ...getNodeBounds(rootNode, rootBounds),
      componentName: ["INSTANCE", "COMPONENT", "COMPONENT_SET"].includes(rootNode?.type) ? cleanText(rootNode.name) : "",
      style: buildSectionStyle(rootNode, {
        rootBounds,
        containerBounds: getNodeBounds(rootNode, rootBounds)
      }),
      memberLeaves: fallbackLeaves,
      sourceNode: rootNode,
      rootBounds
    });
    sections.push({
      id: fallbackDescriptor.id,
      role: fallbackDescriptor.role,
      name: fallbackDescriptor.name,
      x: fallbackDescriptor.x,
      y: fallbackDescriptor.y,
      width: fallbackDescriptor.width,
      height: fallbackDescriptor.height,
      columnCount: fallbackDescriptor.columnCount,
      archetype: "",
      componentName: fallbackDescriptor.componentName,
      children: fallbackDescriptor.children,
      style: fallbackDescriptor.style,
      summaryText: fallbackDescriptor.summaryText
    });
  }

  const localeHints = inferLocaleHintsFromTexts(textSamples);
  const directionHint = inferDirectionHintFromLocaleHints(localeHints, textSamples);
  const sortedTexts = [...textNodes].sort((left, right) => (right.fontSize - left.fontSize) || left.y - right.y);
  const headingNode = sortedTexts[0] || null;
  const bodyNode = textNodes.find((node) => node.roleHint === "body") || textNodes[0] || null;
  const ctaTextNode = textNodes.find((node) => node.roleHint === "cta") || null;
  const cardLikeSection = sections.find((section) => cleanText(section.style.bgColor) || cleanText(section.style.radius)) || sections[0] || null;
  const ctaSection = sections.find((section) => inferSectionRole({ name: section.name }) === "cta") || null;

  return {
    source: "figma-server-token",
    fileKey: cleanText(fileKey),
    nodeId: cleanText(nodeId),
    selectionName: cleanText(selectionName) || cleanText(rootNode?.name),
    pageName: cleanText(pageName),
    layerCount: unique(layerNames).length,
    textLayerCount: textNodes.length,
    imageFillCount: imageSlots.length,
    layerNames: unique(layerNames).slice(0, 32),
    textSamples: unique(textSamples).slice(0, 12),
    exportUrls: unique(Object.values(imageUrlMap).filter(Boolean)).slice(0, 24),
    localeHints,
    directionHint,
    frameSize: {
      width: rootBounds.width,
      height: rootBounds.height
    },
    styles: {
      bgColor: getFirstSolidHex(rootNode) || cleanText(cardLikeSection?.style?.bgColor),
      textColor: cleanText(bodyNode?.color),
      headingColor: cleanText(headingNode?.color),
      linkColor: "",
      primaryColor: cleanText(ctaSection?.style?.bgColor),
      primaryTextColor: cleanText(ctaTextNode?.color),
      buttonRadius: cleanText(ctaSection?.style?.radius),
      contentRadius: cleanText(cardLikeSection?.style?.radius),
      borderColor: cleanText(cardLikeSection?.style?.borderColor),
      fontFamily: cleanText(headingNode?.fontFamily || bodyNode?.fontFamily)
    },
    previewImage: previewUrl
      ? {
          mimeType: "image/png",
          url: cleanText(previewUrl),
          dataUrl: ""
        }
      : null,
    componentNames: unique(componentNames).slice(0, 32),
    sections,
    texts: textNodes,
    images: imageSlots
  };
}

export async function buildFigmaImportFromUrl(figmaUrl, token, opts = {}) {
  const parsed = parseFigmaUrl(figmaUrl);
  if (!parsed?.fileKey) {
    throw new Error("Could not parse Figma URL. Expected a file/design/proto URL.");
  }

  let fileKey = cleanText(parsed.fileKey);
  let nodeId = cleanText(parsed.nodeId);
  let selectionName = "";
  let pageName = "";

  if (!nodeId) {
    const browseResult = await browseFigmaFile(fileKey, token);
    const picked = pickDefaultFrame(browseResult);
    if (!picked?.nodeId) {
      throw new Error("Could not infer a frame from the Figma file. Pass a frame link with node-id.");
    }
    nodeId = picked.nodeId;
    selectionName = picked.selectionName;
    pageName = picked.pageName;
  }

  const importCacheKey = [
    cleanText(fileKey),
    cleanText(nodeId),
    cleanText(opts.format || "png"),
    Number(opts.scale) || 2,
    Number(opts.imageLimit) || 18
  ].join("::");
  const freshImport = readFreshStructuredImportCacheEntry(importCacheKey);
  if (freshImport) {
    return freshImport;
  }

  let data = null;
  try {
    data = await fetchFigmaNodeData(fileKey, nodeId, token);
  } catch (error) {
    const staleImport = readAnyStructuredImportCacheEntry(importCacheKey);
    if (staleImport) {
      return staleImport;
    }
    throw error;
  }
  const rootNode = data?.nodes?.[nodeId]?.document || data?.document || null;
  if (!rootNode) {
    throw new Error("Figma API returned no document node for the requested frame.");
  }

  const imageCandidates = [];
  traverseFigmaNode(rootNode, (node) => {
    if (node?.name) imageCandidates.push(cleanText(node.name));
  });

  const exportNodeIds = [];
  exportNodeIds.push(cleanText(rootNode.id || nodeId));
  traverseFigmaNode(rootNode, (node) => {
    if (node !== rootNode && isLikelyGraphicNode(node)) {
      exportNodeIds.push(cleanText(node.id));
    }
  });

  const limitedExportIds = unique(exportNodeIds).slice(0, Math.max(2, Number(opts.imageLimit) || 18));
  let imageUrlMap = {};
  try {
    imageUrlMap = await exportFigmaImages(fileKey, limitedExportIds, token, {
      format: opts.format || "png",
      scale: opts.scale || 2
    });
  } catch {
    imageUrlMap = {};
  }

  const previewUrl = cleanText(imageUrlMap[cleanText(rootNode.id || nodeId)]);
  return writeStructuredImportCacheEntry(importCacheKey, buildStructuredImportFromNode({
    fileKey,
    nodeId,
    selectionName: selectionName || cleanText(rootNode.name),
    pageName,
    rootNode,
    previewUrl,
    imageUrlMap
  }));
}

// ─── Layer Tree Flattener ─────────────────────────────────────────────────────

/**
 * Recursively flattens a Figma node tree into a flat array.
 * Extracts: id, name, type, depth, text, fill color, font info, dimensions.
 *
 * @param {object} node   Figma document node
 * @param {number} depth  Current recursion depth (starts at 0)
 * @param {number} maxDepth  Stop recursing past this depth
 * @returns {Array<object>}
 */
export function flattenFigmaLayers(node, depth = 0, maxDepth = 4) {
  if (!node || depth > maxDepth) return [];

  const result = [];
  const entry = {
    id: node.id,
    name: node.name,
    type: node.type,
    depth
  };

  // Text content
  if (node.characters) entry.text = node.characters;

  // Fill color (first solid fill only)
  if (node.fills?.length) {
    const solidFill = node.fills.find((f) => f.type === "SOLID" && f.color);
    if (solidFill) {
      const { r, g, b } = solidFill.color;
      entry.fill = `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`;
    }
  }

  // Typography
  if (node.style) {
    if (node.style.fontSize) entry.fontSize = node.style.fontSize;
    if (node.style.fontFamily) entry.fontFamily = node.style.fontFamily;
    if (node.style.fontWeight) entry.fontWeight = node.style.fontWeight;
  }

  // Dimensions
  if (node.absoluteBoundingBox) {
    entry.width = Math.round(node.absoluteBoundingBox.width);
    entry.height = Math.round(node.absoluteBoundingBox.height);
  }

  result.push(entry);

  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      result.push(...flattenFigmaLayers(child, depth + 1, maxDepth));
    }
  }

  return result;
}

// ─── API Client ───────────────────────────────────────────────────────────────

/**
 * Fetches a Figma file node via the REST API.
 *
 * @param {string} fileKey   Figma file key (from URL)
 * @param {string|null} nodeId  Node ID in "123:456" format, or null for root
 * @param {string} token     FIGMA_API_TOKEN
 * @returns {Promise<object>}
 */
export async function fetchFigmaNodeData(fileKey, nodeId, token) {
  if (!token) {
    throw new Error("FIGMA_API_TOKEN is not configured. Add it to .env to enable Figma inspection.");
  }

  const cacheKey = `${cleanText(fileKey)}::${cleanText(nodeId) || "root"}`;
  const freshCache = readFreshCacheEntry(figmaNodeDataCache, cacheKey);
  if (freshCache) {
    return freshCache;
  }

  const nodeParam = nodeId ? `?ids=${encodeURIComponent(nodeId)}&geometry=paths` : "";
  const apiUrl = `${FIGMA_API_BASE}/files/${fileKey}/nodes${nodeParam}`;

  const response = await fetch(apiUrl, {
    headers: { "X-Figma-Token": token }
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    if (response.status === 429) {
      const staleCache = readAnyCacheEntry(figmaNodeDataCache, cacheKey);
      if (staleCache) {
        return staleCache;
      }
    }
    throw new Error(`Figma API error ${response.status}: ${errorText.slice(0, 200)}`);
  }

  return writeCacheEntry(figmaNodeDataCache, cacheKey, await response.json());
}

/**
 * High-level helper: parse URL → fetch → flatten layers.
 * Returns { parsed, layers, texts, components } or throws.
 *
 * @param {string} figmaUrl  Full Figma URL
 * @param {string} token     FIGMA_API_TOKEN
 * @returns {Promise<{ parsed, layers, texts, components, summary }>}
 */
export async function inspectFigmaUrl(figmaUrl, token) {
  const parsed = parseFigmaUrl(figmaUrl);
  if (!parsed) {
    throw new Error("Could not parse Figma URL. Expected format: figma.com/design/FILEKEY/Name?node-id=...");
  }

  const data = await fetchFigmaNodeData(parsed.fileKey, parsed.nodeId, token);
  const nodeData = parsed.nodeId
    ? data?.nodes?.[parsed.nodeId]?.document
    : data?.document;

  const layers = nodeData ? flattenFigmaLayers(nodeData) : [];
  const texts = layers.filter((l) => l.type === "TEXT" && l.text).map((l) => l.text);
  const components = [...new Set(
    layers.filter((l) => l.type === "COMPONENT" || l.type === "INSTANCE").map((l) => l.name)
  )];

  return {
    parsed,
    layers: layers.slice(0, 100),
    texts,
    components,
    summary: {
      layerCount: layers.length,
      textCount: texts.length,
      componentCount: components.length
    }
  };
}

// ─── Image Export ─────────────────────────────────────────────────────────────

/**
 * Exports one or more Figma nodes as images via the Figma Images API.
 * Returns a map of { nodeId → imageUrl } — direct download URLs (valid ~14 days).
 *
 * @param {string} fileKey     Figma file key
 * @param {string[]} nodeIds   Array of node IDs in "123:456" format
 * @param {string} token       FIGMA_API_TOKEN
 * @param {object} [opts]      { format: 'png'|'jpg'|'svg'|'pdf', scale: 1|2|3 }
 * @returns {Promise<{ [nodeId: string]: string }>}
 */
export async function exportFigmaImages(fileKey, nodeIds, token, opts = {}) {
  if (!token) throw new Error("FIGMA_API_TOKEN is not configured.");
  if (!nodeIds?.length) throw new Error("No node IDs provided.");

  const format = opts.format || "png";
  const scale  = opts.scale  || 2;
  const ids    = nodeIds.map((id) => id.replace("-", ":")).join(",");
  const apiUrl = `${FIGMA_API_BASE}/images/${fileKey}?ids=${encodeURIComponent(ids)}&format=${format}&scale=${scale}&use_absolute_bounds=true`;

  const response = await fetch(apiUrl, {
    headers: { "X-Figma-Token": token }
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Figma Images API ${response.status}: ${text.slice(0, 200)}`);
  }

  const data = await response.json();
  if (data.err) throw new Error(`Figma Images API error: ${data.err}`);

  // Normalize keys back to "123:456" format
  const result = {};
  for (const [rawId, url] of Object.entries(data.images || {})) {
    result[rawId.replace("-", ":")] = url;
  }
  return result;
}

// ─── File Browser ─────────────────────────────────────────────────────────────

/**
 * Fetches top-level pages and frames from a Figma file for browsing.
 * Returns a lightweight list of pages → frames/components (no deep recursion).
 *
 * @param {string} fileKey  Figma file key
 * @param {string} token    FIGMA_API_TOKEN
 * @returns {Promise<{ fileName, pages: Array<{ id, name, frames: Array<{ id, name, width, height }> }> }>}
 */
export async function browseFigmaFile(fileKey, token) {
  if (!token) throw new Error("FIGMA_API_TOKEN is not configured.");

  const apiUrl = `${FIGMA_API_BASE}/files/${fileKey}?depth=2`;
  const response = await fetch(apiUrl, {
    headers: { "X-Figma-Token": token }
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Figma API ${response.status}: ${text.slice(0, 200)}`);
  }

  const data   = await response.json();
  const doc    = data?.document;
  const fileName = data?.name || fileKey;

  if (!doc?.children) return { fileName, pages: [] };

  const pages = doc.children
    .filter((page) => page.type === "CANVAS")
    .map((page) => ({
      id:   page.id,
      name: page.name,
      frames: (page.children || [])
        .filter((n) => ["FRAME", "COMPONENT", "COMPONENT_SET", "GROUP"].includes(n.type))
        .map((n) => ({
          id:     n.id,
          name:   n.name,
          type:   n.type,
          width:  Math.round(n.absoluteBoundingBox?.width  || 0),
          height: Math.round(n.absoluteBoundingBox?.height || 0),
        }))
    }));

  return { fileName, pages };
}

/**
 * Downloads an image from a URL and returns the binary Buffer.
 * Used to pull Figma-exported images into local asset storage.
 *
 * @param {string} url
 * @returns {Promise<{ buffer: Buffer, contentType: string }>}
 */
export async function downloadImageBuffer(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Image download failed: ${response.status} ${url}`);
  const contentType = response.headers.get("content-type") || "image/png";
  const arrayBuffer = await response.arrayBuffer();
  return { buffer: Buffer.from(arrayBuffer), contentType };
}
