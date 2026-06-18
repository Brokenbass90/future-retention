function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizePositiveNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : 0;
}

function unique(values) {
  return Array.from(new Set((Array.isArray(values) ? values : []).map(cleanText).filter(Boolean)));
}

function lower(value) {
  return cleanText(value).toLowerCase();
}

function containsAny(source, patterns) {
  const text = lower(source);
  return patterns.some((pattern) => pattern.test(text));
}

function isDarkHexColor(value) {
  const source = cleanText(value);
  const match = source.match(/^#([0-9a-f]{6})$/i);
  if (!match) {
    return false;
  }

  const hex = match[1];
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance < 0.36;
}

function classifyTextRole(node = {}, frameWidth = 0) {
  const explicit = lower(node.roleHint);
  if (explicit && explicit !== "unknown") {
    return explicit;
  }

  const text = cleanText(node.text);
  const textLower = lower(text);
  const fontSize = normalizePositiveNumber(node.fontSize);
  const fontWeight = normalizePositiveNumber(node.fontWeight);
  const width = normalizePositiveNumber(node.width);
  const y = normalizePositiveNumber(node.y);

  if (containsAny(textLower, [/unsubscribe/, /terms/, /risk warning/, /disclaimer/, /support@/, /legal/, /copyright/])) {
    return "legal";
  }

  if (containsAny(textLower, [/trade$/, /okay$/, /continue$/, /set new password$/, /reset password$/, /verify$/, /open$/, /start$/, /login$/])) {
    return "cta";
  }

  if ((fontSize >= 26 || fontWeight >= 650) && text.length <= 180) {
    return "heading";
  }

  if (fontSize >= 18 && width > 0 && frameWidth > 0 && width <= frameWidth * 0.45 && y < 180) {
    return "eyebrow";
  }

  return "body";
}

function classifyImageRole(image = {}, frameWidth = 0, frameHeight = 0) {
  const explicit = lower(image.roleHint);
  if (explicit && explicit !== "unknown") {
    return explicit;
  }

  const name = [image.name, image.label].map(cleanText).join(" ");
  const width = normalizePositiveNumber(image.width);
  const height = normalizePositiveNumber(image.height);
  const y = normalizePositiveNumber(image.y);

  if (image?.isBackground) {
    return "background";
  }

  if (containsAny(name, [/logo/, /brand/, /wordmark/])) {
    return "logo";
  }

  if (containsAny(name, [/social/, /facebook/, /instagram/, /youtube/, /telegram/, /x\W/, /twitter/])) {
    return "social";
  }

  if (containsAny(name, [/badge/, /app store/, /google play/, /store/])) {
    return "badge";
  }

  if (containsAny(name, [/hero/, /banner/, /masthead/, /cover/])) {
    return "hero";
  }

  if (width > 0 && height > 0 && frameWidth > 0 && width <= frameWidth * 0.22 && height <= 120) {
    return "icon";
  }

  if (frameWidth > 0 && width >= frameWidth * 0.55 && y <= Math.max(160, frameHeight * 0.12)) {
    return "hero";
  }

  if (width > 0 && height > 0 && frameWidth > 0 && width >= frameWidth * 0.75 && height >= 180) {
    return "background";
  }

  return "section";
}

function inferSectionRoleFromContent(section = {}, nodes = [], frameHeight = 0) {
  const explicit = lower(section.role);
  if (explicit && explicit !== "unknown") {
    return explicit;
  }

  const name = [section.name, section.summaryText].map(cleanText).join(" ");
  const y = normalizePositiveNumber(section.y);
  const height = normalizePositiveNumber(section.height);
  const nodeRoles = unique(nodes.flatMap((node) => [node.roleHint, node.inferredRole]));

  if (containsAny(name, [/header/, /logo/]) || nodeRoles.includes("logo")) {
    return "header";
  }

  if (containsAny(name, [/footer/, /legal/, /unsubscribe/]) || nodeRoles.includes("legal") || nodeRoles.includes("social")) {
    return "footer";
  }

  if (containsAny(name, [/hero/, /banner/, /masthead/]) || nodeRoles.includes("hero")) {
    return "hero";
  }

  if (containsAny(name, [/cta/, /button/, /call to action/]) || nodeRoles.includes("cta")) {
    return "cta";
  }

  if (nodeRoles.includes("heading") && nodeRoles.includes("hero")) {
    return "hero";
  }

  if (nodeRoles.includes("heading") && nodeRoles.includes("cta")) {
    return "cta";
  }

  const iconCount = nodes.filter((node) => node.inferredRole === "icon").length;
  if (iconCount >= 3) {
    return "feature-list";
  }

  if (frameHeight > 0 && y + height >= frameHeight * 0.82) {
    return "footer";
  }

  if (nodes.some((node) => node.inferredRole === "heading")) {
    return "text";
  }

  return "unknown";
}

function buildSyntheticSections(schema = {}) {
  const texts = Array.isArray(schema.textNodes) ? schema.textNodes : [];
  const images = Array.isArray(schema.imageSlots) ? schema.imageSlots : [];
  const items = [...texts, ...images]
    .map((item) => ({
      id: cleanText(item.id),
      y: normalizePositiveNumber(item.y),
      height: normalizePositiveNumber(item.height),
      source: item
    }))
    .sort((left, right) => left.y - right.y);

  if (items.length === 0) {
    return [];
  }

  const groups = [];
  let current = [];
  let currentBottom = 0;

  for (const item of items) {
    if (current.length === 0) {
      current = [item];
      currentBottom = item.y + item.height;
      continue;
    }

    const gap = item.y - currentBottom;
    if (gap > 120) {
      groups.push(current);
      current = [item];
      currentBottom = item.y + item.height;
      continue;
    }

    current.push(item);
    currentBottom = Math.max(currentBottom, item.y + item.height);
  }

  if (current.length > 0) {
    groups.push(current);
  }

  return groups.map((group, index) => {
    const y = Math.min(...group.map((item) => item.y));
    const bottom = Math.max(...group.map((item) => item.y + item.height));
    return {
      id: `auto_sec_${String(index + 1).padStart(2, "0")}`,
      role: "unknown",
      name: `Auto section ${index + 1}`,
      x: 0,
      y,
      width: normalizePositiveNumber(schema?.meta?.width),
      height: Math.max(0, bottom - y),
      children: group.map((item) => item.id).filter(Boolean),
      style: {},
      summaryText: ""
    };
  });
}

function attachRolesToNodes(schema = {}) {
  const frameWidth = normalizePositiveNumber(schema?.meta?.width);
  const frameHeight = normalizePositiveNumber(schema?.meta?.height);

  const textNodes = (Array.isArray(schema.textNodes) ? schema.textNodes : []).map((node) => ({
    ...node,
    inferredRole: classifyTextRole(node, frameWidth)
  }));

  const imageSlots = (Array.isArray(schema.imageSlots) ? schema.imageSlots : []).map((image) => ({
    ...image,
    inferredRole: classifyImageRole(image, frameWidth, frameHeight)
  }));

  return { textNodes, imageSlots };
}

function collectSectionNodes(section = {}, textNodes = [], imageSlots = []) {
  const childIds = new Set(Array.isArray(section.children) ? section.children.map(cleanText).filter(Boolean) : []);
  const explicitSectionId = cleanText(section.id);
  const inRange = (node) => {
    const y = normalizePositiveNumber(node.y);
    const sectionY = normalizePositiveNumber(section.y);
    const sectionBottom = sectionY + normalizePositiveNumber(section.height);
    if (normalizePositiveNumber(section.height) <= 0) {
      return false;
    }
    return y >= sectionY && y <= sectionBottom;
  };
  const explicitNodeMatch = (node) => childIds.has(cleanText(node.id)) || cleanText(node.sectionId) === explicitSectionId;
  const hasExplicitBindings = childIds.size > 0
    || textNodes.some((node) => cleanText(node.sectionId) === explicitSectionId)
    || imageSlots.some((node) => cleanText(node.sectionId) === explicitSectionId);

  return hasExplicitBindings
    ? [
        ...textNodes.filter(explicitNodeMatch),
        ...imageSlots.filter(explicitNodeMatch)
      ]
    : [
        ...textNodes.filter((node) => inRange(node)),
        ...imageSlots.filter((node) => inRange(node))
      ];
}

function countColumnAnchors(nodes = [], frameWidth = 0) {
  const positioned = nodes
    .map((node) => ({
      x: normalizePositiveNumber(node.x),
      width: normalizePositiveNumber(node.width),
      role: cleanText(node.inferredRole || node.roleHint)
    }))
    .filter((node) => node.width > 0)
    .filter((node) => node.role !== "background" && node.role !== "legal");

  if (positioned.length < 2) {
    return 1;
  }

  const relevant = positioned.filter((node) => {
    if (frameWidth <= 0) return true;
    return node.width <= frameWidth * 0.62 || ["icon", "badge", "social", "section"].includes(node.role);
  });

  if (relevant.length < 2) {
    return 1;
  }

  const threshold = Math.max(80, frameWidth * 0.14);
  const anchors = [];

  for (const node of relevant.sort((left, right) => left.x - right.x)) {
    const existing = anchors.find((anchor) => Math.abs(anchor - node.x) <= threshold);
    if (!existing) {
      anchors.push(node.x);
    }
  }

  return Math.min(Math.max(anchors.length, 1), 4);
}

function inferSectionArchetype(section = {}, nodes = [], frameWidth = 0) {
  const role = cleanText(section.role);
  const childRoles = new Set(Array.isArray(section.childRoleHints) ? section.childRoleHints.map(cleanText).filter(Boolean) : []);
  const columnCount = normalizePositiveNumber(section.columnCount);
  const width = normalizePositiveNumber(section.width);
  const surfaceKind = cleanText(section?.style?.surfaceKind);
  const hasBackgroundFill = Boolean(
    cleanText(section?.style?.bgColor)
    || cleanText(section?.style?.backgroundImage)
    || surfaceKind === "band"
  );
  const hasBorderFrame = Boolean(
    cleanText(section?.style?.radius)
    || cleanText(section?.style?.borderWidth)
    || surfaceKind === "card"
  );
  const hasCardStyle = Boolean(
    hasBorderFrame
    || hasBackgroundFill
    || (frameWidth > 0 && width > 0 && width <= frameWidth * 0.92)
  );
  const hasEmphasizedFrame = Boolean(
    cleanText(section?.style?.borderWidth)
    || surfaceKind === "band"
    || isDarkHexColor(section?.style?.bgColor)
  );

  if (role === "header" && childRoles.has("logo")) {
    return "logo-row";
  }

  if (role === "footer") {
    if (childRoles.has("badge") && !childRoles.has("social") && !childRoles.has("legal")) {
      return "store-badges-row";
    }
    if (childRoles.has("social") && !childRoles.has("badge") && !childRoles.has("legal")) {
      return "social-links-row";
    }
    if (childRoles.has("legal") && !childRoles.has("badge") && !childRoles.has("social")) {
      return "legal-footer-copy";
    }
    if (childRoles.has("badge") && childRoles.has("social")) {
      return "store-social-footer-band";
    }
    if (childRoles.has("social") || childRoles.has("legal")) {
      return "legal-footer-band";
    }
    return "footer-band";
  }

  if (role === "hero" && (childRoles.has("background") || surfaceKind === "band" || cleanText(section?.style?.backgroundImage))) {
    return "background-hero";
  }

  if (role === "hero" && childRoles.has("hero")) {
    return "hero-banner";
  }

  if ((role === "text" || role === "cta") && hasBackgroundFill && hasBorderFrame && hasEmphasizedFrame && columnCount <= 1) {
    return "callout-box";
  }

  if (columnCount >= 3) {
    return "three-column-grid";
  }

  if (columnCount === 2) {
    return "two-column-grid";
  }

  if (role === "cta" && hasCardStyle) {
    return "cta-card";
  }

  if (role === "text" && hasCardStyle) {
    return "copy-card";
  }

  if (role === "feature-list" && hasCardStyle) {
    return "feature-card-stack";
  }

  if (hasCardStyle) {
    return "content-card";
  }

  return "plain-section";
}

function inferFooterTraits(sections = []) {
  const footerSections = sections.filter((section) => cleanText(section.role) === "footer");
  const archetypes = new Set(footerSections.map((section) => cleanText(section.archetype)).filter(Boolean));

  return {
    hasStoreRow: archetypes.has("store-badges-row") || archetypes.has("store-social-footer-band"),
    hasSocialRow: archetypes.has("social-links-row") || archetypes.has("store-social-footer-band") || archetypes.has("legal-footer-band"),
    hasLegalCopy: archetypes.has("legal-footer-copy") || archetypes.has("legal-footer-band") || archetypes.has("store-social-footer-band"),
    sectionCount: footerSections.length
  };
}

function countCardSections(sections = [], frameWidth = 0) {
  return sections.filter((section) => {
    const width = normalizePositiveNumber(section.width);
    const surfaceKind = cleanText(section?.style?.surfaceKind);
    return Boolean(
      surfaceKind === "card"
      || (surfaceKind !== "band" && normalizePositiveNumber(section?.style?.surfaceCoverage) >= 0.18)
      || cleanText(section?.style?.radius)
      || cleanText(section?.style?.bgColor)
      || (frameWidth > 0 && width > 0 && width <= frameWidth * 0.92 && cleanText(section.role) !== "footer")
    );
  }).length;
}

function countBackgroundBands(sections = [], frameWidth = 0) {
  return sections.filter((section) => {
    const width = normalizePositiveNumber(section.width);
    return Boolean(
      cleanText(section?.style?.surfaceKind) === "band"
      || (frameWidth > 0 && width >= frameWidth * 0.92 && cleanText(section?.style?.bgColor))
      || cleanText(section?.style?.backgroundImage)
      || (cleanText(section?.role) === "hero"
        && ["background-hero", "hero-banner"].includes(cleanText(section?.archetype)))
    );
  }).length;
}

function inferScriptHints(textNodes = []) {
  const combinedText = textNodes.map((node) => cleanText(node.text)).filter(Boolean).join(" ");
  if (!combinedText) {
    return {
      localeHints: [],
      primaryScript: "",
      directionHint: "ltr"
    };
  }

  const arabicMatches = combinedText.match(/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/g) || [];
  const urduMatches = combinedText.match(/[ٹڈڑںھہےیگکپچژ]/g) || [];
  const cyrillicMatches = combinedText.match(/[\u0400-\u04FF]/g) || [];
  const latinMatches = combinedText.match(/[A-Za-z]/g) || [];

  const counts = {
    arabic: arabicMatches.length,
    urdu: urduMatches.length,
    cyrillic: cyrillicMatches.length,
    latin: latinMatches.length
  };

  let primaryScript = "latin";
  let maxCount = counts.latin;
  for (const [script, count] of Object.entries(counts)) {
    if (count > maxCount) {
      primaryScript = script;
      maxCount = count;
    }
  }

  const localeHints = [];
  if (counts.arabic > 0) {
    localeHints.push("arabic-script", "rtl-script");
  }
  if (counts.urdu >= 3) {
    localeHints.push("urdu-script", "rtl-script");
  }
  if (counts.cyrillic > 0) {
    localeHints.push("cyrillic-script");
  }
  if (counts.latin > 0) {
    localeHints.push("latin-script");
  }

  return {
    localeHints: unique(localeHints),
    primaryScript,
    directionHint: counts.arabic > 0 || counts.urdu >= 3 ? "rtl" : "ltr"
  };
}

function inferFooterFamily(sections = [], imageSlots = [], textNodes = []) {
  const footerSections = sections.filter((section) => cleanText(section.role) === "footer");
  const imageRoles = new Set(imageSlots.map((slot) => cleanText(slot.inferredRole || slot.roleHint)).filter(Boolean));
  const hasLegalText = textNodes.some((node) => cleanText(node.inferredRole || node.roleHint) === "legal");
  const footerTraits = inferFooterTraits(sections);

  if (footerSections.length === 0 && !hasLegalText) {
    return "";
  }

  if ((imageRoles.has("badge") || footerTraits.hasStoreRow) && (imageRoles.has("social") || footerTraits.hasSocialRow)) {
    return "store-social-legal-footer";
  }

  if (imageRoles.has("badge") || footerTraits.hasStoreRow) {
    return "store-legal-footer";
  }

  if (imageRoles.has("social") || footerTraits.hasSocialRow) {
    return "social-legal-footer";
  }

  return "legal-footer";
}

function inferStyleFamily(layoutTraits = [], sections = []) {
  const traits = new Set((Array.isArray(layoutTraits) ? layoutTraits : []).map(cleanText).filter(Boolean));
  const sectionRoles = new Set((Array.isArray(sections) ? sections : []).map((section) => cleanText(section.role)).filter(Boolean));

  if (traits.has("simple-system-layout") && traits.has("framed-card")) {
    return "simple-system-card";
  }

  if (traits.has("hero-image") && traits.has("feature-grid")) {
    return "feature-promo-layout";
  }

  if (traits.has("background-image") || traits.has("dark-background")) {
    return "hero-promo-layout";
  }

  if (traits.has("3-column") || traits.has("4-column")) {
    return "multi-column-promotional-layout";
  }

  if (traits.has("single-column") && sectionRoles.has("footer") && (sectionRoles.has("cta") || sectionRoles.has("text"))) {
    return "simple-transactional-layout";
  }

  if (traits.has("store-badges") && traits.has("social-row") && traits.has("legal-footer")) {
    return "store-social-promotional-layout";
  }

  return "";
}

function inferLayoutTraits(sections = [], textNodes = [], imageSlots = [], frameWidth = 0) {
  const traits = [];
  const columnCounts = sections.map((section) => normalizePositiveNumber(section.columnCount)).filter((count) => count > 1);
  const maxColumns = columnCounts.length > 0 ? Math.max(...columnCounts) : 1;
  const sectionRoles = new Set(sections.map((section) => cleanText(section.role)).filter(Boolean));
  const sectionArchetypes = new Set(sections.map((section) => cleanText(section.archetype)).filter(Boolean));
  const imageRoles = new Set(imageSlots.map((slot) => cleanText(slot.inferredRole || slot.roleHint)).filter(Boolean));
  const cardSectionCount = countCardSections(sections, frameWidth);
  const backgroundBandCount = countBackgroundBands(sections, frameWidth);
  const hasDarkBackground = sections.some((section) => Boolean(section?.style?.isDark) || isDarkHexColor(section?.style?.bgColor));

  if (maxColumns > 1) {
    traits.push(`${maxColumns}-column`);
  } else {
    traits.push("single-column");
  }

  if (imageRoles.has("logo")) traits.push("logo-row");
  if (imageRoles.has("social")) traits.push("social-row");
  if (imageRoles.has("badge")) traits.push("store-badges");
  if (imageRoles.has("hero")) traits.push("hero-image");
  if (imageRoles.has("background") && (backgroundBandCount > 0 || sectionArchetypes.has("background-hero"))) {
    traits.push("background-image");
  }
  if (sectionRoles.has("footer")) traits.push("legal-footer");
  if (sectionRoles.has("feature-list")) traits.push("feature-grid");
  if (backgroundBandCount > 0) traits.push("background-band");
  if (hasDarkBackground) traits.push("dark-background");
  if (sectionArchetypes.has("callout-box")) traits.push("callout-box");
  if (sectionArchetypes.has("two-column-grid")) traits.push("two-column-grid");
  if (sectionArchetypes.has("three-column-grid")) traits.push("three-column-grid");
  if (sectionArchetypes.has("cta-card")) traits.push("cta-card");
  if (sectionArchetypes.has("store-badges-row")) traits.push("store-row");
  if (sectionArchetypes.has("social-links-row")) traits.push("social-row");
  if (sectionArchetypes.has("legal-footer-copy")) traits.push("legal-copy");
  if (sectionArchetypes.has("copy-card")) traits.push("copy-card");
  if (sectionArchetypes.has("feature-card-stack")) traits.push("feature-card-stack");

  const transactionalLike = sectionRoles.has("header")
    && sectionRoles.has("footer")
    && (sectionRoles.has("cta") || sectionRoles.has("text"))
    && sections.length <= 5
    && maxColumns <= 1;
  if (transactionalLike) {
    traits.push("simple-system-layout");
  }

  const framedSections = sections.filter((section) =>
    cleanText(section?.style?.radius)
    || cleanText(section?.style?.bgColor)
    || (normalizePositiveNumber(section.width) > 0 && frameWidth > 0 && normalizePositiveNumber(section.width) <= frameWidth * 0.94)
  );
  if (framedSections.length > 0) {
    traits.push("framed-card");
  }

  if (cardSectionCount >= 2) {
    traits.push("card-stack");
  } else if (cardSectionCount === 1) {
    traits.push("single-card");
  }

  return unique(traits);
}

export function buildDesignDecomposition(schema = null) {
  if (!schema || typeof schema !== "object") {
    return null;
  }

  const { textNodes, imageSlots } = attachRolesToNodes(schema);
  const inputSections = Array.isArray(schema.sections) && schema.sections.length > 0
    ? schema.sections
    : buildSyntheticSections(schema);
  const frameHeight = normalizePositiveNumber(schema?.meta?.height);

  const sections = inputSections.map((section) => {
    const nodes = collectSectionNodes(section, textNodes, imageSlots);
    const inferredRole = inferSectionRoleFromContent(section, nodes, frameHeight);
    const role = lower(section.role) && lower(section.role) !== "unknown" ? lower(section.role) : inferredRole;
    const columnCount = countColumnAnchors(
      nodes.filter((node) => node.inferredRole !== "background" && node.inferredRole !== "legal"),
      normalizePositiveNumber(schema?.meta?.width)
    );

    return {
      ...section,
      role,
      inferredRole,
      columnCount,
      archetype: inferSectionArchetype(
        {
          ...section,
          role,
          columnCount,
          childRoleHints: unique(nodes.flatMap((node) => [node.roleHint, node.inferredRole]))
        },
        nodes,
        normalizePositiveNumber(schema?.meta?.width)
      ),
      childRoleHints: unique(nodes.flatMap((node) => [node.roleHint, node.inferredRole])),
      textCount: nodes.filter((node) => "text" in node).length,
      imageCount: nodes.filter((node) => "assetSource" in node).length
    };
  });

  const warnings = [];
  if (sections.length === 0) warnings.push("No sections detected.");
  if (!sections.some((section) => section.role === "header")) warnings.push("No header/logo section detected.");
  if (!sections.some((section) => section.role === "footer")) warnings.push("No footer/legal section detected.");
  if (imageSlots.length === 0) warnings.push("No exported image slots detected.");

  const textRoleCounts = textNodes.reduce((acc, node) => {
    const key = cleanText(node.inferredRole || node.roleHint || "unknown");
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const imageRoleCounts = imageSlots.reduce((acc, node) => {
    const key = cleanText(node.inferredRole || node.roleHint || "unknown");
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const layoutTraits = inferLayoutTraits(
    sections,
    textNodes,
    imageSlots,
    normalizePositiveNumber(schema?.meta?.width)
  );
  const scriptHints = inferScriptHints(textNodes);
  const explicitLocaleHints = unique(schema?.localeHints);
  const explicitDirectionHint = cleanText(schema?.directionHint);
  const footerFamily = inferFooterFamily(sections, imageSlots, textNodes);
  const styleFamily = inferStyleFamily(layoutTraits, sections);

  return {
    sectionCount: sections.length,
    inferredSections: sections,
    inferredTextNodes: textNodes,
    inferredImageSlots: imageSlots,
    sectionRoles: sections.map((section) => cleanText(section.role)).filter(Boolean),
    sectionArchetypes: sections.map((section) => ({
      id: cleanText(section.id),
      role: cleanText(section.role),
      archetype: cleanText(section.archetype),
      columnCount: normalizePositiveNumber(section.columnCount)
    })),
    textRoleCounts,
    imageRoleCounts,
    layoutTraits,
    footerFamily,
    styleFamily,
    localeHints: unique([...explicitLocaleHints, ...(Array.isArray(scriptHints.localeHints) ? scriptHints.localeHints : [])]),
    primaryScript: scriptHints.primaryScript,
    directionHint: explicitDirectionHint === "rtl" || explicitDirectionHint === "ltr"
      ? explicitDirectionHint
      : scriptHints.directionHint,
    warnings,
    layoutSignature: sections.map((section) => cleanText(section.role)).filter(Boolean).join(" > ")
  };
}

export function summarizeDesignDecomposition(decomposition) {
  if (!decomposition) {
    return "No design decomposition.";
  }

  const textRoles = Object.entries(decomposition.textRoleCounts || {})
    .map(([role, count]) => `${role}:${count}`)
    .join(", ");
  const imageRoles = Object.entries(decomposition.imageRoleCounts || {})
    .map(([role, count]) => `${role}:${count}`)
    .join(", ");

  return [
    decomposition.layoutSignature ? `Layout: ${decomposition.layoutSignature}` : "",
    `Sections: ${decomposition.sectionCount}`,
    decomposition.layoutTraits?.length ? `Traits: ${decomposition.layoutTraits.join(", ")}` : "",
    decomposition.styleFamily ? `Style family: ${decomposition.styleFamily}` : "",
    decomposition.footerFamily ? `Footer family: ${decomposition.footerFamily}` : "",
    decomposition.directionHint ? `Direction: ${decomposition.directionHint}` : "",
    decomposition.localeHints?.length ? `Locale hints: ${decomposition.localeHints.join(", ")}` : "",
    textRoles ? `Text roles: ${textRoles}` : "",
    imageRoles ? `Image roles: ${imageRoles}` : "",
    decomposition.warnings?.length ? `Warnings: ${decomposition.warnings.join(" | ")}` : ""
  ].filter(Boolean).join(" | ");
}
