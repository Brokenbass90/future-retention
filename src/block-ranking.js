function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function unique(values) {
  return Array.from(new Set((Array.isArray(values) ? values : []).map((value) => cleanText(value)).filter(Boolean)));
}

function normalizeId(value) {
  return cleanText(value).toLowerCase();
}

function buildCatalogItemText(item = {}) {
  return [
    cleanText(item.id),
    cleanText(item.label),
    cleanText(item.description),
    cleanText(item.sectionKind),
    ...(Array.isArray(item.helperMixins) ? item.helperMixins.map(cleanText) : [])
  ].filter(Boolean).join(" ").toLowerCase();
}

function isCompatibleSectionKind(role, itemSectionKind, itemText) {
  const normalizedRole = cleanText(role);
  const normalizedKind = cleanText(itemSectionKind);
  const text = cleanText(itemText);

  if (!normalizedRole || !normalizedKind) {
    return false;
  }

  if (normalizedRole === "header") {
    return normalizedKind === "image" && /logo/.test(text);
  }

  if (normalizedRole === "hero") {
    return ["hero", "image", "cta"].includes(normalizedKind);
  }

  if (normalizedRole === "text") {
    return ["text", "feature-list"].includes(normalizedKind);
  }

  if (normalizedRole === "feature-list") {
    return ["feature-list", "text", "image"].includes(normalizedKind);
  }

  if (normalizedRole === "image") {
    return ["image", "hero"].includes(normalizedKind);
  }

  if (normalizedRole === "cta") {
    return ["cta", "hero"].includes(normalizedKind);
  }

  if (normalizedRole === "footer") {
    return normalizedKind === "footer";
  }

  return normalizedRole === normalizedKind;
}

function scoreCatalogItemForSection(section, item, context = {}) {
  const role = cleanText(section?.role);
  const archetype = cleanText(section?.archetype);
  const desiredAssetRoles = Array.isArray(section?.desiredAssetRoles) ? section.desiredAssetRoles.map(cleanText) : [];
  const recommendedBlockArchetypes = Array.isArray(section?.recommendedBlockArchetypes) ? section.recommendedBlockArchetypes.map(cleanText) : [];
  const columnCount = Number(section?.columnCount) || 1;
  const itemId = cleanText(item?.id);
  const itemText = buildCatalogItemText(item);
  const itemTraits = item?.traits && typeof item.traits === "object" ? item.traits : {};
  const itemSectionKind = cleanText(item?.sectionKind);

  let score = 0;
  const reasons = [];

  if (recommendedBlockArchetypes.includes(itemId)) {
    score += 140;
    reasons.push(`archetype:${itemId}`);
  }

  const compatibleKind = isCompatibleSectionKind(role, itemSectionKind, itemText);
  if (compatibleKind) {
    score += role === itemSectionKind ? 80 : 52;
    reasons.push(`role:${role}`);
  } else if (role && itemSectionKind) {
    score -= 45;
  }

  if (role === "header" && /logo/.test(itemText)) {
    score += 50;
    reasons.push("header-logo");
  }

  if (role === "footer" && /footer|unsubscribe|social|store/.test(itemText)) {
    score += 45;
    reasons.push("footer-pattern");
  }

  if (role === "hero" && /hero|banner|vml|dark/.test(itemText)) {
    score += 50;
    reasons.push("hero-pattern");
  }

  if (role === "text" && /copy|text|card/.test(itemText)) {
    score += 40;
    reasons.push("copy-pattern");
  }

  if (role === "feature-list" && /feature|grid|column|list|awards|numbered|bullet/.test(itemText)) {
    score += 55;
    reasons.push("feature-pattern");
  }

  if (role === "cta" && /cta|button|switch/.test(itemText)) {
    score += 50;
    reasons.push("cta-pattern");
  }

  if (desiredAssetRoles.includes("logo") && /logo/.test(itemText)) {
    score += 30;
    reasons.push("asset:logo");
  }
  if (desiredAssetRoles.includes("social") && /social/.test(itemText)) {
    score += 30;
    reasons.push("asset:social");
  }
  if (desiredAssetRoles.includes("badge") && /badge|store/.test(itemText)) {
    score += 30;
    reasons.push("asset:badge");
  }
  if (desiredAssetRoles.includes("background") && /hero|banner|background|vml|dark/.test(itemText)) {
    score += 28;
    reasons.push("asset:background");
  }
  if (desiredAssetRoles.includes("section") && itemTraits.hasImage && /image|banner|hero|feature/.test(itemText)) {
    score += 18;
    reasons.push("asset:section");
  }

  if (columnCount >= 3 && /three|grid/.test(itemText)) {
    score += 22;
    reasons.push("columns:3+");
  } else if (columnCount === 2 && /two|switch/.test(itemText)) {
    score += 18;
    reasons.push("columns:2");
  }

  if (cleanText(context?.styleFamily) === "simple-system-card" && compatibleKind && /copy|cta|footer|logo/.test(itemText)) {
    score += 12;
    reasons.push("style:simple-system-card");
  }

  if (cleanText(context?.footerFamily).includes("social") && role === "footer" && /social/.test(itemText)) {
    score += 12;
    reasons.push("footer:social");
  }

  if (cleanText(context?.footerFamily).includes("store") && role === "footer" && /store|badge/.test(itemText)) {
    score += 12;
    reasons.push("footer:store");
  }

  return {
    id: itemId,
    label: cleanText(item?.label) || itemId,
    sectionKind: itemSectionKind || "text",
    score,
    reasons: unique(reasons)
  };
}

export function buildDesignBlockRecommendations({ catalog = null, mappingHints = null } = {}) {
  const items = Array.isArray(catalog?.items) ? catalog.items : [];
  const sectionMappings = Array.isArray(mappingHints?.sectionMappings) ? mappingHints.sectionMappings : [];
  if (items.length === 0 || sectionMappings.length === 0) {
    return null;
  }

  const sectionRecommendations = sectionMappings.map((section) => {
    const ranked = items
      .map((item) => scoreCatalogItemForSection(section, item, mappingHints))
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score || left.label.localeCompare(right.label))
      .slice(0, 5);

    return {
      sectionId: cleanText(section.id),
      role: cleanText(section.role),
      archetype: cleanText(section.archetype),
      candidates: ranked
    };
  });

  const topCandidateIds = unique(sectionRecommendations.flatMap((section) => section.candidates.slice(0, 2).map((candidate) => candidate.id)));

  return {
    recommendedCatalogIds: topCandidateIds,
    sectionRecommendations,
    coverage: {
      sectionCount: sectionRecommendations.length,
      matchedSections: sectionRecommendations.filter((section) => section.candidates.length > 0).length
    }
  };
}

export function summarizeDesignBlockRecommendations(recommendations) {
  if (!recommendations) {
    return "No block recommendations.";
  }

  const sectionLines = (Array.isArray(recommendations.sectionRecommendations) ? recommendations.sectionRecommendations : [])
    .slice(0, 6)
    .map((section) => {
      const candidates = section.candidates.slice(0, 3).map((candidate) => candidate.id).join(", ");
      return `${section.role || section.sectionId}: ${candidates || "no match"}`;
    });

  return [
    recommendations.recommendedCatalogIds?.length ? `Top blocks: ${recommendations.recommendedCatalogIds.join(", ")}` : "",
    recommendations.coverage ? `Coverage: ${recommendations.coverage.matchedSections}/${recommendations.coverage.sectionCount}` : "",
    sectionLines.length > 0 ? `Per-section: ${sectionLines.join(" | ")}` : ""
  ].filter(Boolean).join(" | ");
}
