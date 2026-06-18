function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizePositiveNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : 0;
}

function unique(values) {
  return Array.from(new Set((Array.isArray(values) ? values : []).map((value) => cleanText(value)).filter(Boolean)));
}

function countBy(values = []) {
  return (Array.isArray(values) ? values : []).reduce((acc, value) => {
    const key = cleanText(value);
    if (!key) return acc;
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function toLabel(key) {
  return cleanText(key)
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function inferDesiredAssetRoles(section = {}, decomposition = null) {
  const role = cleanText(section.role);
  const archetype = cleanText(section.archetype);
  const childRoleHints = new Set((Array.isArray(section.childRoleHints) ? section.childRoleHints : []).map((value) => cleanText(value)).filter(Boolean));
  const desired = [];

  if (role === "header") {
    desired.push("logo");
  }

  if (role === "hero") {
    if (archetype === "background-hero" || childRoleHints.has("background")) {
      desired.push("background");
    }
    if (childRoleHints.has("hero") || !childRoleHints.has("background")) {
      desired.push("hero");
    }
  }

  if (role === "feature-list") {
    if (normalizePositiveNumber(section.columnCount) >= 2) {
      desired.push("icon");
    }
    desired.push("section");
  }

  if (role === "image") {
    desired.push(childRoleHints.has("background") ? "background" : "section");
  }

  if (role === "cta" && (archetype === "cta-card" || childRoleHints.has("cta"))) {
    desired.push("section");
  }

  if (role === "footer") {
    if (archetype === "store-badges-row" || cleanText(decomposition?.footerFamily).includes("store")) {
      desired.push("badge");
    }
    if (archetype === "social-links-row" || cleanText(decomposition?.footerFamily).includes("social") || childRoleHints.has("social")) {
      desired.push("social");
    }
    if (archetype !== "legal-footer-copy") {
      desired.push("logo");
    }
  }

  return unique(desired);
}

function inferRecommendedBlockArchetypes(section = {}, decomposition = null) {
  const role = cleanText(section.role);
  const archetype = cleanText(section.archetype);
  const footerFamily = cleanText(decomposition?.footerFamily);
  const childRoleHints = new Set((Array.isArray(section.childRoleHints) ? section.childRoleHints : []).map((value) => cleanText(value)).filter(Boolean));
  const columnCount = normalizePositiveNumber(section.columnCount);
  const surfaceKind = cleanText(section?.style?.surfaceKind);
  const isDark = Boolean(section?.style?.isDark);
  const hasBackgroundImage = Boolean(cleanText(section?.style?.backgroundImage));
  const recommendations = [];

  if (role === "header") {
    recommendations.push("header-logo-row");
  } else if (role === "hero") {
    if (
      archetype === "background-hero"
      || cleanText(decomposition?.styleFamily) === "hero-promo-layout"
      || surfaceKind === "band"
      || hasBackgroundImage
      || isDark
    ) {
      recommendations.push("dark-banner-cta-block");
    }
    if (childRoleHints.has("cta")) {
      recommendations.push("hero-image-two-cta");
    } else if (archetype === "hero-banner" || childRoleHints.has("hero") || childRoleHints.has("background")) {
      recommendations.push("hero-image-block");
    } else {
      recommendations.push("hero-image-block");
      recommendations.push("plain-copy-text-card");
    }
  } else if (role === "feature-list") {
    if (columnCount >= 3 || archetype === "three-column-grid") {
      recommendations.push("three-promo-column-row");
    } else if (columnCount === 2 || archetype === "two-column-grid") {
      recommendations.push("numbered-feature-stack");
      recommendations.push("bullet-proof-list-card");
    } else if (childRoleHints.has("icon") || childRoleHints.has("section")) {
      recommendations.push("numbered-feature-stack");
    } else {
      recommendations.push("bullet-proof-list-card");
    }
  } else if (role === "image") {
    if (childRoleHints.has("background") || surfaceKind === "band" || hasBackgroundImage) {
      recommendations.push("dark-banner-cta-block");
    }
    recommendations.push("hero-image-block");
  } else if (role === "cta") {
    if (columnCount >= 2) {
      recommendations.push("switch-cta-row");
    }
    recommendations.push("single-button-cta-card");
    if (surfaceKind === "card" || archetype === "cta-card") {
      recommendations.push("plain-copy-text-card");
    }
  } else if (role === "text") {
    if (columnCount >= 2) {
      recommendations.push("bullet-proof-list-card");
      recommendations.push("numbered-feature-stack");
    } else if (surfaceKind === "card" || archetype === "copy-card" || archetype === "callout-box") {
      recommendations.push("plain-copy-text-card");
      recommendations.push("single-button-cta-card");
    } else {
      recommendations.push("plain-copy-text-card");
    }
  } else if (role === "footer") {
    if (archetype === "store-badges-row" || footerFamily.includes("store")) {
      recommendations.push("store-badges-row");
    }
    if (archetype === "social-links-row" || footerFamily.includes("social")) {
      recommendations.push("social-links-row");
    }
    recommendations.push("legal-unsubscribe-footer");
  }

  if (recommendations.length === 0) {
    recommendations.push("block-candidate");
  }

  return unique(recommendations);
}

function inferSectionConfidence(section = {}) {
  const role = cleanText(section.role);
  const archetype = cleanText(section.archetype);
  const surfaceKind = cleanText(section?.style?.surfaceKind);

  if (!role || role === "unknown") {
    return "low";
  }

  if (role === "footer" || role === "header") {
    return "high";
  }

  if (archetype && archetype !== "plain-section") {
    return "high";
  }

  if (surfaceKind === "card" || surfaceKind === "band") {
    return "high";
  }

  return "medium";
}

function inferComplexity(decomposition = null) {
  const layoutTraits = new Set((Array.isArray(decomposition?.layoutTraits) ? decomposition.layoutTraits : []).map((value) => cleanText(value)).filter(Boolean));
  const sectionCount = normalizePositiveNumber(decomposition?.sectionCount);

  if (layoutTraits.has("4-column") || layoutTraits.has("background-image")) {
    return "high";
  }

  if (layoutTraits.has("3-column") || layoutTraits.has("feature-grid") || sectionCount >= 6) {
    return "medium";
  }

  return "low";
}

function inferAssemblyStrategy({ decomposition = null, sectionMappings = [], blockCandidateCount = 0, lowConfidenceSections = [] } = {}) {
  const complexity = inferComplexity(decomposition);
  const styleFamily = cleanText(decomposition?.styleFamily);
  const footerFamily = cleanText(decomposition?.footerFamily);
  const totalSections = sectionMappings.length;
  const lowConfidenceRatio = totalSections > 0 ? lowConfidenceSections.length / totalSections : 0;

  if (styleFamily || footerFamily) {
    return "reference-family-first";
  }

  if (complexity === "low" && blockCandidateCount === 0 && lowConfidenceSections.length <= 1) {
    return "base-blocks-first";
  }

  if (complexity === "high" || blockCandidateCount >= 2 || lowConfidenceRatio >= 0.35) {
    return "hybrid-reference-plus-freeform";
  }

  return "reference-family-first";
}

export function buildDesignMappingHints({ schema = null, decomposition = null } = {}) {
  if (!schema || !decomposition) {
    return null;
  }

  const inferredSections = Array.isArray(decomposition.inferredSections) ? decomposition.inferredSections : [];
  const sectionMappings = inferredSections.map((section, index) => {
    const desiredAssetRoles = inferDesiredAssetRoles(section, decomposition);
    const recommendedBlockArchetypes = inferRecommendedBlockArchetypes(section, decomposition);
    return {
      id: cleanText(section.id) || `sec_${index + 1}`,
      index,
      role: cleanText(section.role) || "unknown",
      archetype: cleanText(section.archetype) || "plain-section",
      columnCount: normalizePositiveNumber(section.columnCount),
      surfaceKind: cleanText(section?.style?.surfaceKind),
      surfaceCoverage: normalizePositiveNumber(section?.style?.surfaceCoverage),
      hasBackgroundImage: Boolean(cleanText(section?.style?.backgroundImage)),
      isDark: Boolean(section?.style?.isDark),
      confidence: inferSectionConfidence(section),
      childRoleHints: unique(section.childRoleHints),
      desiredAssetRoles,
      recommendedBlockArchetypes,
      notes: unique([
        cleanText(section.summaryText),
        cleanText(section.componentName),
        cleanText(section?.style?.layoutMode),
        cleanText(section?.style?.surfaceKind),
        cleanText(section?.style?.backgroundImage) ? "background-image" : "",
        Boolean(section?.style?.isDark) ? "dark-surface" : "",
        normalizePositiveNumber(section.textCount) > 0 ? `${normalizePositiveNumber(section.textCount)} text node(s)` : "",
        normalizePositiveNumber(section.imageCount) > 0 ? `${normalizePositiveNumber(section.imageCount)} image slot(s)` : ""
      ])
    };
  });

  const blockArchetypeSequence = sectionMappings.flatMap((section) => section.recommendedBlockArchetypes);
  const allDesiredAssetRoles = sectionMappings.flatMap((section) => section.desiredAssetRoles);
  const recommendedBlockArchetypes = unique(blockArchetypeSequence);
  const desiredAssetRoles = unique(allDesiredAssetRoles);
  const presentImageRoles = Object.keys(decomposition.imageRoleCounts || {}).filter(Boolean);
  const missingAssetRoles = desiredAssetRoles.filter((role) => !presentImageRoles.includes(role));
  const lowConfidenceSections = sectionMappings.filter((section) => section.confidence === "low");
  const blockCandidateCount = sectionMappings.filter((section) => section.recommendedBlockArchetypes.includes("block-candidate")).length;
  const assemblyStrategy = inferAssemblyStrategy({
    decomposition,
    sectionMappings,
    blockCandidateCount,
    lowConfidenceSections
  });

  const warnings = [];
  if (missingAssetRoles.length > 0) {
    warnings.push(`Missing explicit asset roles: ${missingAssetRoles.join(", ")}`);
  }
  if (lowConfidenceSections.length > 0) {
    warnings.push(`Low-confidence sections: ${lowConfidenceSections.map((section) => section.role || section.id).join(", ")}`);
  }
  if (blockCandidateCount > 0) {
    warnings.push(`${blockCandidateCount} section(s) may need a block candidate.`);
  }

  return {
    assemblyStrategy,
    layoutComplexity: inferComplexity(decomposition),
    directionHint: cleanText(decomposition.directionHint),
    localeHints: unique(decomposition.localeHints),
    styleFamily: cleanText(decomposition.styleFamily),
    footerFamily: cleanText(decomposition.footerFamily),
    layoutTraits: unique(decomposition.layoutTraits),
    blockArchetypeSequence,
    recommendedBlockArchetypes,
    desiredAssetRoles,
    presentImageRoles,
    missingAssetRoles,
    assetRoleCounts: countBy(allDesiredAssetRoles),
    sectionMappings,
    warnings
  };
}

export function summarizeDesignMappingHints(hints) {
  if (!hints) {
    return "No design mapping hints.";
  }

  return [
    hints.assemblyStrategy ? `Assembly: ${hints.assemblyStrategy}` : "",
    hints.layoutComplexity ? `Complexity: ${hints.layoutComplexity}` : "",
    hints.styleFamily ? `Style family: ${hints.styleFamily}` : "",
    hints.footerFamily ? `Footer family: ${hints.footerFamily}` : "",
    hints.directionHint ? `Direction: ${hints.directionHint}` : "",
    hints.localeHints?.length ? `Locale hints: ${hints.localeHints.join(", ")}` : "",
    hints.recommendedBlockArchetypes?.length ? `Block archetypes: ${hints.recommendedBlockArchetypes.map(toLabel).join(", ")}` : "",
    hints.desiredAssetRoles?.length ? `Desired asset roles: ${hints.desiredAssetRoles.join(", ")}` : "",
    hints.missingAssetRoles?.length ? `Missing asset roles: ${hints.missingAssetRoles.join(", ")}` : "",
    hints.warnings?.length ? `Warnings: ${hints.warnings.join(" | ")}` : ""
  ].filter(Boolean).join(" | ");
}
