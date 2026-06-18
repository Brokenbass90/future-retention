function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeStringList(values, limit = 24) {
  if (!Array.isArray(values)) {
    return [];
  }
  return Array.from(new Set(values.map((value) => cleanText(value)).filter(Boolean))).slice(0, limit);
}

function normalizeRole(value) {
  const normalized = cleanText(value).toLowerCase();
  switch (normalized) {
    case "header":
    case "hero":
    case "cta":
    case "support":
    case "legal":
    case "footer":
      return normalized;
    case "feature-list":
    case "feature":
    case "grid":
      return "feature-grid";
    case "text":
    case "body":
    case "content":
      return "body";
    case "image":
    case "media":
      return "media";
    default:
      return "unknown";
  }
}

function pickFirstText(...values) {
  for (const value of values) {
    const normalized = cleanText(value);
    if (normalized) {
      return normalized;
    }
  }
  return "";
}

function buildSectionSummary(title, body, items = []) {
  return [cleanText(title), cleanText(body), ...normalizeStringList(items, 5)].filter(Boolean).join(" | ");
}

function buildContentMapSections(contentMap = {}) {
  const sections = Array.isArray(contentMap?.sections) ? contentMap.sections.map((value) => cleanText(value)).filter(Boolean) : [];
  const links = Array.isArray(contentMap?.links) ? contentMap.links : [];
  const images = Array.isArray(contentMap?.images) ? contentMap.images : [];
  const result = [];

  const heading = cleanText(contentMap?.subject);
  const lead = cleanText(contentMap?.preheader);
  if (heading || lead || sections.length > 0) {
    result.push({
      id: "html_hero",
      role: heading ? "hero" : "body",
      source: "html",
      title: heading,
      body: lead || sections[0] || "",
      items: sections.slice(lead ? 0 : 1, lead ? 3 : 4),
      assetSlotKey: images.length > 0 ? "html_image_01" : "",
      summary: buildSectionSummary(heading, lead || sections[0] || "", sections.slice(1, 3))
    });
  }

  sections.slice(1).forEach((text, index) => {
    result.push({
      id: `html_body_${String(index + 1).padStart(2, "0")}`,
      role: "body",
      source: "html",
      title: "",
      body: text,
      items: [],
      assetSlotKey: "",
      summary: text
    });
  });

  const primaryLink = links.find((entry) => !/unsubscribe|terms|privacy|conditions|отпис|услов/i.test(`${entry?.text || ""} ${entry?.href || ""}`));
  if (primaryLink) {
    result.push({
      id: "html_cta",
      role: "cta",
      source: "html",
      title: cleanText(primaryLink?.text),
      body: "",
      items: [],
      assetSlotKey: "",
      summary: cleanText(primaryLink?.text) || cleanText(primaryLink?.href)
    });
  }

  const footerLinkCount = links.length - (primaryLink ? 1 : 0);
  if (footerLinkCount > 0) {
    result.push({
      id: "html_footer",
      role: "footer",
      source: "html",
      title: "",
      body: `${footerLinkCount} footer/legal link(s) detected`,
      items: [],
      assetSlotKey: "",
      summary: `${footerLinkCount} footer/legal link(s)`
    });
  }

  return result;
}

function buildScreenshotSections(screenshotOcr = {}) {
  if (!screenshotOcr || typeof screenshotOcr !== "object" || !screenshotOcr.usable) {
    return [];
  }

  const bodyBlocks = Array.isArray(screenshotOcr.bodyBlocks)
    ? screenshotOcr.bodyBlocks.map((value) => cleanText(value)).filter(Boolean)
    : [];
  const result = [];

  if (cleanText(screenshotOcr.brandLine)) {
    result.push({
      id: "shot_header",
      role: "header",
      source: "screenshot",
      title: cleanText(screenshotOcr.brandLine),
      body: "",
      items: [],
      assetSlotKey: "logo",
      summary: cleanText(screenshotOcr.brandLine)
    });
  }

  if (cleanText(screenshotOcr.title) || bodyBlocks.length > 0) {
    result.push({
      id: "shot_hero",
      role: "hero",
      source: "screenshot",
      title: cleanText(screenshotOcr.title),
      body: cleanText(screenshotOcr.ctaLead) || bodyBlocks[0] || "",
      items: bodyBlocks.slice(1, 4),
      assetSlotKey: "",
      summary: buildSectionSummary(screenshotOcr.title, screenshotOcr.ctaLead || bodyBlocks[0] || "", bodyBlocks.slice(1, 3))
    });
  }

  if (cleanText(screenshotOcr.ctaLabel)) {
    result.push({
      id: "shot_cta",
      role: "cta",
      source: "screenshot",
      title: cleanText(screenshotOcr.ctaLabel),
      body: cleanText(screenshotOcr.ctaLead),
      items: [],
      assetSlotKey: "",
      summary: buildSectionSummary(screenshotOcr.ctaLabel, screenshotOcr.ctaLead)
    });
  }

  if (cleanText(screenshotOcr.warningBody) || cleanText(screenshotOcr.supportBody)) {
    result.push({
      id: "shot_support",
      role: "support",
      source: "screenshot",
      title: "",
      body: pickFirstText(screenshotOcr.warningBody, screenshotOcr.supportBody),
      items: cleanText(screenshotOcr.warningBody) && cleanText(screenshotOcr.supportBody) ? [cleanText(screenshotOcr.supportBody)] : [],
      assetSlotKey: "",
      summary: buildSectionSummary("", pickFirstText(screenshotOcr.warningBody, screenshotOcr.supportBody))
    });
  }

  if (cleanText(screenshotOcr.footerBody)) {
    result.push({
      id: "shot_footer",
      role: "footer",
      source: "screenshot",
      title: "",
      body: cleanText(screenshotOcr.footerBody),
      items: [],
      assetSlotKey: "",
      summary: cleanText(screenshotOcr.footerBody)
    });
  }

  return result;
}

function buildDesignSchemaSections(designSchema = {}) {
  const sections = Array.isArray(designSchema?.sections) ? designSchema.sections : [];
  return sections.map((section, index) => ({
    id: cleanText(section?.id) || `design_sec_${String(index + 1).padStart(2, "0")}`,
    role: normalizeRole(section?.role),
    source: "design-schema",
    title: cleanText(section?.name),
    body: cleanText(section?.summaryText),
    items: [],
    assetSlotKey: "",
    summary: buildSectionSummary(section?.name, section?.summaryText)
  }));
}

function buildDraftSections(mail = {}) {
  const sections = Array.isArray(mail?.sections) ? mail.sections : [];
  return sections.map((section, index) => ({
    id: cleanText(section?.id) || `draft_sec_${String(index + 1).padStart(2, "0")}`,
    role: normalizeRole(section?.kind),
    source: "draft",
    title: cleanText(section?.title || section?.eyebrow),
    body: cleanText(section?.body),
    items: normalizeStringList(section?.items),
    assetSlotKey: cleanText(section?.image_key),
    summary: buildSectionSummary(section?.title || section?.eyebrow, section?.body, section?.items)
  }));
}

function normalizeVisualTokens({ designSchema = null, designAnalysis = null, screenshotOcr = null } = {}) {
  const schemaTokens = designSchema?.tokens && typeof designSchema.tokens === "object" ? designSchema.tokens : {};
  const hints = designAnalysis?.visual_hints && typeof designAnalysis.visual_hints === "object" ? designAnalysis.visual_hints : {};
  return {
    pageBgColor: pickFirstText(hints.page_bg_color, schemaTokens.bgColor),
    cardBgColor: pickFirstText(hints.card_bg_color),
    titleColor: pickFirstText(hints.title_color, schemaTokens.headingColor),
    bodyColor: pickFirstText(hints.body_color, schemaTokens.textColor),
    accentColor: pickFirstText(hints.accent_color, schemaTokens.primaryColor, schemaTokens.linkColor),
    buttonFillColor: pickFirstText(hints.button_fill_color, schemaTokens.primaryColor),
    buttonBorderColor: pickFirstText(hints.button_border_color, schemaTokens.borderColor),
    buttonTextColor: pickFirstText(hints.button_text_color, schemaTokens.primaryTextColor),
    buttonTone: pickFirstText(hints.button_tone),
    buttonShape: pickFirstText(hints.button_shape),
    buttonWidth: pickFirstText(hints.button_width),
    cardShape: pickFirstText(hints.card_shape),
    cardWidth: pickFirstText(hints.card_width),
    density: pickFirstText(hints.card_density),
    supportLayout: pickFirstText(hints.support_layout),
    layoutStyle: pickFirstText(hints.layout_style, screenshotOcr?.layoutStyle),
    titleScale: pickFirstText(hints.title_scale),
    logoScale: pickFirstText(hints.logo_scale),
    buttonRadius: pickFirstText(schemaTokens.buttonRadius),
    contentRadius: pickFirstText(schemaTokens.contentRadius),
    notes: pickFirstText(hints.notes)
  };
}

function dedupeSections(sections = []) {
  const result = [];
  const seen = new Set();
  for (const section of sections) {
    const summary = cleanText(section?.summary);
    const role = normalizeRole(section?.role);
    const key = `${role}::${summary}`;
    if (!summary || !seen.has(key)) {
      result.push({
        ...section,
        role
      });
    }
    if (summary) {
      seen.add(key);
    }
  }
  return result;
}

function collectAssetSlots({ contentMap = null, designSchema = null, draft = null } = {}) {
  const result = [];
  const images = Array.isArray(contentMap?.images) ? contentMap.images : [];
  images.forEach((src, index) => {
    result.push({
      key: `html_image_${String(index + 1).padStart(2, "0")}`,
      role: /logo|brand|header/i.test(cleanText(src)) ? "logo" : "image",
      source: "html",
      value: cleanText(src)
    });
  });

  const imageSlots = Array.isArray(designSchema?.imageSlots) ? designSchema.imageSlots : [];
  imageSlots.forEach((slot, index) => {
    result.push({
      key: cleanText(slot?.id) || `design_image_${String(index + 1).padStart(2, "0")}`,
      role: cleanText(slot?.roleHint) || "image",
      source: "design-schema",
      value: cleanText(slot?.assetSource?.url || slot?.name)
    });
  });

  const draftAssets = Array.isArray(draft?.mail?.assets) ? draft.mail.assets : [];
  draftAssets.forEach((asset, index) => {
    result.push({
      key: cleanText(asset?.key) || `draft_asset_${String(index + 1).padStart(2, "0")}`,
      role: cleanText(asset?.placement?.[0]) || "image",
      source: "draft",
      value: cleanText(asset?.src || asset?.url || asset?.label)
    });
  });

  return result.filter((item) => item.key || item.value);
}

function inferSourceKind({ contentMap = null, screenshotOcr = null, designSchema = null, brief = null } = {}) {
  const kinds = [
    contentMap ? "html" : "",
    screenshotOcr?.usable ? "screenshot" : "",
    designSchema?.source === "figma" ? "figma" : "",
    cleanText(brief?.campaignName || brief?.goal) ? "text" : ""
  ].filter(Boolean);

  if (kinds.length === 0) {
    return "unknown";
  }
  return kinds.length === 1 ? kinds[0] : "hybrid";
}

export function buildLayoutModel({
  brief = null,
  contentMap = null,
  screenshotOcr = null,
  designSchema = null,
  designAnalysis = null,
  draft = null
} = {}) {
  const sections = dedupeSections([
    ...buildDesignSchemaSections(designSchema),
    ...buildScreenshotSections(screenshotOcr),
    ...buildContentMapSections(contentMap),
    ...buildDraftSections(draft?.mail)
  ]);

  const locales = normalizeStringList([
    cleanText(brief?.locale),
    ...Object.keys(draft?.previewLocales && typeof draft.previewLocales === "object" ? draft.previewLocales : {}),
    ...(Array.isArray(draft?.mail?.translations) ? draft.mail.translations.map((entry) => entry?.locale) : [])
  ], 16);

  const title = pickFirstText(
    draft?.mail?.subject,
    contentMap?.subject,
    screenshotOcr?.title,
    sections.find((section) => section.role === "hero")?.title,
    brief?.campaignName
  );

  const preheader = pickFirstText(
    draft?.mail?.preheader,
    contentMap?.preheader,
    sections.find((section) => section.role === "hero")?.body,
    brief?.goal
  );

  const assetSlots = collectAssetSlots({ contentMap, designSchema, draft });
  const visualTokens = normalizeVisualTokens({ designSchema, designAnalysis, screenshotOcr });
  const roles = Array.from(new Set(sections.map((section) => section.role).filter(Boolean)));

  const hasContent = Boolean(title || preheader || sections.length > 0 || assetSlots.length > 0 || locales.length > 0 || visualTokens.layoutStyle);
  if (!hasContent) {
    return null;
  }

  return {
    version: 2,
    sourceKind: inferSourceKind({ contentMap, screenshotOcr, designSchema, brief }),
    title,
    preheader,
    locales,
    roles,
    assetSlots,
    visualTokens,
    sections
  };
}

export function summarizeLayoutModel(layoutModel) {
  if (!layoutModel) {
    return "No layout model.";
  }

  return [
    `Source: ${layoutModel.sourceKind}`,
    layoutModel.title ? `Title: ${layoutModel.title}` : "",
    layoutModel.preheader ? `Preheader: ${layoutModel.preheader}` : "",
    layoutModel.roles.length > 0 ? `Roles: ${layoutModel.roles.join(" > ")}` : "",
    layoutModel.locales.length > 0 ? `Locales: ${layoutModel.locales.join(", ")}` : "",
    layoutModel.assetSlots.length > 0 ? `Assets: ${layoutModel.assetSlots.length}` : "",
    layoutModel.visualTokens.layoutStyle ? `Layout: ${layoutModel.visualTokens.layoutStyle}` : "",
    layoutModel.visualTokens.accentColor ? `Accent: ${layoutModel.visualTokens.accentColor}` : ""
  ].filter(Boolean).join(" | ");
}

export function summarizeLayoutModelMeta(layoutModel) {
  if (!layoutModel) {
    return null;
  }

  return {
    sourceKind: layoutModel.sourceKind,
    sectionCount: Array.isArray(layoutModel.sections) ? layoutModel.sections.length : 0,
    roles: Array.isArray(layoutModel.roles) ? layoutModel.roles : [],
    localeCount: Array.isArray(layoutModel.locales) ? layoutModel.locales.length : 0,
    assetCount: Array.isArray(layoutModel.assetSlots) ? layoutModel.assetSlots.length : 0,
    layoutStyle: cleanText(layoutModel?.visualTokens?.layoutStyle)
  };
}
