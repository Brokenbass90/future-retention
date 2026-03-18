/**
 * src/figma.js — Figma REST API integration
 *
 * Parses Figma URLs, fetches node data from the Figma API,
 * and flattens the layer tree for AI consumption.
 *
 * Required env: FIGMA_API_TOKEN
 */

const FIGMA_API_BASE = "https://api.figma.com/v1";

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
  if (/unsubscribe|terms|risk warning|disclaimer|support@/i.test(text)) return "legal";
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

function buildSectionStyle(node) {
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

function buildStructuredImportFromNode({
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
  const sectionNodes = Array.isArray(rootNode.children) && rootNode.children.length > 0
    ? rootNode.children.filter((child) => isVisibleNode(child) && getNodeBounds(child).width >= 24 && getNodeBounds(child).height >= 16)
    : [rootNode];

  const sections = [];
  const textNodes = [];
  const imageSlots = [];
  const textSamples = [];
  const componentNames = [];
  const layerNames = [];

  for (const child of sectionNodes) {
    const bounds = getNodeBounds(child, rootBounds);
    const descendants = [];
    traverseFigmaNode(child, (node) => {
      if (node !== child) descendants.push(node);
      if (node?.name) layerNames.push(cleanText(node.name));
      if (["INSTANCE", "COMPONENT", "COMPONENT_SET"].includes(node?.type) && node?.name) {
        componentNames.push(cleanText(node.name));
      }
    }, cleanText(child.id), rootNode);

    const descendantForColumns = descendants.filter((node) => node?.type === "TEXT" || isLikelyGraphicNode(node));
    sections.push({
      id: cleanText(child.id),
      role: inferSectionRole(child),
      name: cleanText(child.name),
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      columnCount: inferColumnCount(descendantForColumns, rootBounds.width),
      archetype: "",
      componentName: ["INSTANCE", "COMPONENT", "COMPONENT_SET"].includes(child?.type) ? cleanText(child.name) : "",
      children: collectSectionChildren(child),
      style: buildSectionStyle(child),
      summaryText: cleanText(child.name)
    });

    traverseFigmaNode(child, (node, sectionId) => {
      const bounds = getNodeBounds(node, rootBounds);
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

      if (node !== child && isLikelyGraphicNode(node)) {
        imageSlots.push({
          id: cleanText(node.id),
          roleHint: inferImageRole(node, rootBounds),
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
          isBackground: hasImageFill(node) && (inferImageRole(node, rootBounds) === "background"),
          assetSource: {
            kind: imageUrlMap[cleanText(node.id)] ? "figma-export" : "",
            mimeType: imageUrlMap[cleanText(node.id)] ? "image/png" : "",
            url: cleanText(imageUrlMap[cleanText(node.id)]),
            dataUrl: ""
          }
        });
      }
    }, cleanText(child.id), rootNode);
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

  const data = await fetchFigmaNodeData(fileKey, nodeId, token);
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
  return buildStructuredImportFromNode({
    fileKey,
    nodeId,
    selectionName: selectionName || cleanText(rootNode.name),
    pageName,
    rootNode,
    previewUrl,
    imageUrlMap
  });
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

  const nodeParam = nodeId ? `?ids=${encodeURIComponent(nodeId)}&geometry=paths` : "";
  const apiUrl = `${FIGMA_API_BASE}/files/${fileKey}/nodes${nodeParam}`;

  const response = await fetch(apiUrl, {
    headers: { "X-Figma-Token": token }
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(`Figma API error ${response.status}: ${errorText.slice(0, 200)}`);
  }

  return response.json();
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
