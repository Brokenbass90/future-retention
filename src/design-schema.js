/**
 * Internal normalized design schema.
 *
 * Converts screenshot/Figma/plugin payloads into one structured shape the
 * studio can use for routing, template selection, and later block mapping.
 */

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizePositiveNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : 0;
}

function normalizeHexColor(value) {
  const source = cleanText(value);
  if (!source) return "";

  const shortHex = source.match(/^#([0-9a-f]{3})$/i);
  if (shortHex) {
    const [r, g, b] = shortHex[1].split("");
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }

  const longHex = source.match(/^#([0-9a-f]{6})$/i);
  if (longHex) {
    return `#${longHex[1].toUpperCase()}`;
  }

  const rgb = source.match(/^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i);
  if (rgb) {
    const channels = rgb.slice(1).map((part) => Math.max(0, Math.min(255, Number(part))));
    return `#${channels.map((part) => part.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
  }

  return "";
}

function normalizePixelValue(value) {
  const source = cleanText(value);
  if (!source) return "";
  if (/^\d+px$/i.test(source)) return source.toLowerCase();
  const numeric = Number(source);
  return Number.isFinite(numeric) && numeric >= 0 ? `${numeric}px` : "";
}

function normalizeDirection(value) {
  const normalized = cleanText(value).toLowerCase();
  return normalized === "rtl" || normalized === "ltr" ? normalized : "";
}

function normalizeStringList(values, limit = 24) {
  return Array.from(new Set((Array.isArray(values) ? values : []).map((value) => cleanText(value)).filter(Boolean))).slice(0, limit);
}

function pickFirstString(...values) {
  for (const value of values) {
    const normalized = cleanText(value);
    if (normalized) return normalized;
  }
  return "";
}

function looksLikeDataUrl(value) {
  return /^data:/i.test(cleanText(value));
}

function looksLikeUrl(value) {
  return /^https?:\/\//i.test(cleanText(value));
}

function normalizeRole(value, allowed, fallback = "unknown") {
  const normalized = cleanText(value).toLowerCase();
  return allowed.has(normalized) ? normalized : fallback;
}

const SECTION_ROLES = new Set(["header", "hero", "text", "feature-list", "image", "cta", "footer", "unknown"]);
const TEXT_ROLES = new Set(["heading", "body", "eyebrow", "cta", "legal", "unknown"]);
const IMAGE_ROLES = new Set(["logo", "hero", "section", "icon", "badge", "social", "background", "unknown"]);

function normalizeTokenGroup(raw = {}) {
  return {
    bgColor: normalizeHexColor(raw.bgColor || raw.backgroundColor),
    textColor: normalizeHexColor(raw.textColor),
    headingColor: normalizeHexColor(raw.headingColor),
    linkColor: normalizeHexColor(raw.linkColor),
    primaryColor: normalizeHexColor(raw.primaryColor),
    primaryTextColor: normalizeHexColor(raw.primaryTextColor),
    buttonRadius: normalizePixelValue(raw.buttonRadius),
    contentRadius: normalizePixelValue(raw.contentRadius),
    borderColor: normalizeHexColor(raw.borderColor),
    fontFamily: cleanText(raw.fontFamily)
  };
}

function normalizeDesignSection(section, index = 0) {
  const rawStyle = section?.style && typeof section.style === "object" ? section.style : {};
  return {
    id: pickFirstString(section?.id, `sec_${String(index + 1).padStart(2, "0")}`),
    role: normalizeRole(section?.role || section?.kind || section?.roleHint, SECTION_ROLES),
    name: pickFirstString(section?.name, section?.title),
    x: normalizePositiveNumber(section?.x),
    y: normalizePositiveNumber(section?.y),
    width: normalizePositiveNumber(section?.width),
    height: normalizePositiveNumber(section?.height),
    columnCount: normalizePositiveNumber(section?.columnCount),
    archetype: cleanText(section?.archetype),
    componentName: pickFirstString(section?.componentName, section?.component_name),
    children: Array.isArray(section?.children) ? section.children.map((child) => cleanText(child)).filter(Boolean) : [],
    style: {
      bgColor: normalizeHexColor(rawStyle.bgColor || rawStyle.backgroundColor),
      borderColor: normalizeHexColor(rawStyle.borderColor),
      radius: normalizePixelValue(rawStyle.radius || rawStyle.borderRadius),
      borderWidth: normalizePixelValue(rawStyle.borderWidth),
      shadow: cleanText(rawStyle.shadow),
      backgroundImage: pickFirstString(rawStyle.backgroundImage, rawStyle.background_image),
      layoutMode: cleanText(rawStyle.layoutMode || rawStyle.layout_mode),
      textAlign: cleanText(rawStyle.textAlign || rawStyle.align),
      paddingTop: normalizePositiveNumber(rawStyle.paddingTop),
      paddingRight: normalizePositiveNumber(rawStyle.paddingRight),
      paddingBottom: normalizePositiveNumber(rawStyle.paddingBottom),
      paddingLeft: normalizePositiveNumber(rawStyle.paddingLeft)
    },
    summaryText: pickFirstString(section?.summaryText, section?.title, section?.body, section?.layout_notes)
  };
}

function normalizeTextNode(node, index = 0) {
  return {
    id: pickFirstString(node?.id, `txt_${String(index + 1).padStart(2, "0")}`),
    roleHint: normalizeRole(node?.roleHint || node?.role || node?.kind, TEXT_ROLES),
    text: pickFirstString(node?.text, node?.characters, node?.value),
    x: normalizePositiveNumber(node?.x),
    y: normalizePositiveNumber(node?.y),
    width: normalizePositiveNumber(node?.width),
    height: normalizePositiveNumber(node?.height),
    fontFamily: cleanText(node?.fontFamily),
    fontSize: normalizePositiveNumber(node?.fontSize),
    fontWeight: normalizePositiveNumber(node?.fontWeight),
    lineHeight: normalizePixelValue(node?.lineHeight),
    letterSpacing: normalizePixelValue(node?.letterSpacing),
    align: cleanText(node?.align || node?.textAlign),
    direction: normalizeDirection(node?.direction),
    textCase: cleanText(node?.textCase),
    color: normalizeHexColor(node?.color || node?.fill),
    sectionId: cleanText(node?.sectionId)
  };
}

function normalizeImageSlot(image, index = 0) {
  const assetSource = image?.assetSource && typeof image.assetSource === "object" ? image.assetSource : {};
  const url = pickFirstString(assetSource.url, image?.url, image?.exportUrl);
  const dataUrl = pickFirstString(assetSource.dataUrl, image?.dataUrl);
  return {
    id: pickFirstString(image?.id, `img_${String(index + 1).padStart(2, "0")}`),
    roleHint: normalizeRole(image?.roleHint || image?.role || image?.placement, IMAGE_ROLES),
    name: pickFirstString(image?.name, image?.label),
    x: normalizePositiveNumber(image?.x),
    y: normalizePositiveNumber(image?.y),
    width: normalizePositiveNumber(image?.width),
    height: normalizePositiveNumber(image?.height),
    sectionId: cleanText(image?.sectionId),
    alt: pickFirstString(image?.alt, image?.description),
    componentName: pickFirstString(image?.componentName, image?.component_name),
    imageHash: pickFirstString(image?.imageHash, image?.image_hash),
    exportRef: pickFirstString(image?.exportRef, image?.export_ref),
    isBackground: Boolean(image?.isBackground || image?.background),
    assetSource: {
      kind: pickFirstString(assetSource.kind, image?.assetKind, looksLikeDataUrl(dataUrl) ? "figma-export" : looksLikeUrl(url) ? "external-url" : ""),
      mimeType: pickFirstString(assetSource.mimeType, image?.mimeType),
      url: looksLikeUrl(url) ? url : "",
      dataUrl: looksLikeDataUrl(dataUrl) ? dataUrl : ""
    }
  };
}

function normalizePreviewImage(previewImage, fallbackDataUrl = "") {
  const dataUrl = pickFirstString(previewImage?.dataUrl, fallbackDataUrl);
  const url = pickFirstString(previewImage?.url);
  return {
    mimeType: pickFirstString(previewImage?.mimeType, dataUrl.startsWith("data:image/jpeg") ? "image/jpeg" : dataUrl.startsWith("data:image/webp") ? "image/webp" : dataUrl ? "image/png" : ""),
    url: looksLikeUrl(url) ? url : "",
    dataUrl: looksLikeDataUrl(dataUrl) ? dataUrl : ""
  };
}

function buildSectionsFromAnalysis(designAnalysis = null) {
  const structured = Array.isArray(designAnalysis?.sections_structured) ? designAnalysis.sections_structured : [];
  if (structured.length > 0) {
    return structured.map((section, index) => normalizeDesignSection({
      id: `analysis_sec_${String(index + 1).padStart(2, "0")}`,
      role: section?.kind,
      name: section?.title,
      summaryText: [cleanText(section?.title), cleanText(section?.body), cleanText(section?.layout_notes)].filter(Boolean).join(" | ")
    }, index));
  }

  const kinds = Array.isArray(designAnalysis?.section_kinds) ? designAnalysis.section_kinds : [];
  return kinds.map((kind, index) => normalizeDesignSection({
    id: `analysis_sec_${String(index + 1).padStart(2, "0")}`,
    role: kind,
    name: kind
  }, index));
}

export function buildInternalDesignSchema({ briefDesignUrl = "", design = null, designAnalysis = null } = {}) {
  const rawDesign = design && typeof design === "object" ? design : {};
  const figmaImport = rawDesign?.figmaImport && typeof rawDesign.figmaImport === "object" ? rawDesign.figmaImport : {};
  const meta = rawDesign?.meta && typeof rawDesign.meta === "object" ? rawDesign.meta : {};

  const sectionsSource = Array.isArray(figmaImport?.sections) ? figmaImport.sections : [];
  const textSource = Array.isArray(figmaImport?.texts) ? figmaImport.texts : Array.isArray(figmaImport?.textNodes) ? figmaImport.textNodes : [];
  const imageSource = Array.isArray(figmaImport?.images) ? figmaImport.images : Array.isArray(figmaImport?.imageSlots) ? figmaImport.imageSlots : [];
  const componentNames = Array.isArray(figmaImport?.componentNames)
    ? figmaImport.componentNames.map((value) => cleanText(value)).filter(Boolean)
    : [];

  const previewImage = normalizePreviewImage(
    figmaImport?.previewImage && typeof figmaImport.previewImage === "object" ? figmaImport.previewImage : {},
    rawDesign?.dataUrl
  );

  const schema = {
    source: figmaImport?.source
      ? cleanText(figmaImport.source)
      : pickFirstString(rawDesign?.figmaFileKey, rawDesign?.figmaNodeId, meta?.fileKey) || /figma\.com/i.test(cleanText(briefDesignUrl))
        ? "figma"
        : previewImage.dataUrl || looksLikeUrl(briefDesignUrl)
          ? "screenshot"
          : "",
    meta: {
      brandHint: pickFirstString(designAnalysis?.brand_hint, meta?.brandHint),
      categoryHint: pickFirstString(meta?.categoryHint),
      fileKey: pickFirstString(meta?.fileKey, rawDesign?.figmaFileKey, figmaImport?.fileKey),
      frameId: pickFirstString(meta?.frameId, rawDesign?.figmaNodeId, figmaImport?.nodeId),
      frameName: pickFirstString(meta?.frameName, rawDesign?.figmaSelectionName, figmaImport?.selectionName, rawDesign?.name),
      pageName: pickFirstString(meta?.pageName, figmaImport?.pageName),
      width: normalizePositiveNumber(meta?.width || meta?.frameSize?.width || figmaImport?.frameSize?.width),
      height: normalizePositiveNumber(meta?.height || meta?.frameSize?.height || figmaImport?.frameSize?.height)
    },
    tokens: normalizeTokenGroup(figmaImport?.styles || figmaImport?.tokens || rawDesign?.brandTheme || {}),
    sections: sectionsSource.length > 0
      ? sectionsSource.map((section, index) => normalizeDesignSection(section, index))
      : buildSectionsFromAnalysis(designAnalysis),
    textNodes: textSource.map((node, index) => normalizeTextNode(node, index))
      .filter((node) => node.text),
    imageSlots: imageSource.map((image, index) => normalizeImageSlot(image, index))
      .filter((image) => image.assetSource.url || image.assetSource.dataUrl || image.name || image.roleHint !== "unknown"),
    componentNames,
    localeHints: normalizeStringList(figmaImport?.localeHints),
    directionHint: normalizeDirection(figmaImport?.directionHint),
    previewImage
  };

  const hasContent = Boolean(
    schema.source
    || schema.meta.fileKey
    || schema.meta.frameId
    || schema.meta.frameName
    || schema.sections.length > 0
    || schema.textNodes.length > 0
    || schema.imageSlots.length > 0
    || schema.componentNames.length > 0
    || schema.localeHints.length > 0
    || schema.directionHint
    || schema.previewImage.dataUrl
    || schema.previewImage.url
  );

  return hasContent ? schema : null;
}

export function summarizeDesignSchema(schema) {
  if (!schema) {
    return "No structured design schema.";
  }

  const sectionRoles = schema.sections.map((section) => section.role).filter(Boolean);
  const imageRoles = schema.imageSlots.map((slot) => slot.roleHint).filter(Boolean);

  return [
    `Source: ${schema.source || "unknown"}`,
    schema.meta.frameName ? `Frame: ${schema.meta.frameName}` : "",
    schema.meta.pageName ? `Page: ${schema.meta.pageName}` : "",
    schema.meta.fileKey ? `File key: ${schema.meta.fileKey}` : "",
    schema.sections.length > 0 ? `Sections: ${sectionRoles.join(" > ")}` : "",
    schema.textNodes.length > 0 ? `Text nodes: ${schema.textNodes.length}` : "",
    schema.imageSlots.length > 0 ? `Image slots: ${imageRoles.join(", ")}` : "",
    schema.componentNames.length > 0 ? `Components: ${schema.componentNames.slice(0, 6).join(", ")}` : "",
    schema.directionHint ? `Direction hint: ${schema.directionHint}` : "",
    schema.localeHints.length > 0 ? `Locale hints: ${schema.localeHints.join(", ")}` : ""
  ].filter(Boolean).join(" | ");
}
