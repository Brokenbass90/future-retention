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
    if (cleanText(decomposition?.footerFamily).includes("store")) {
      desired.push("badge");
    }
    if (cleanText(decomposition?.footerFamily).includes("social") || childRoleHints.has("social")) {
      desired.push("social");
    }
    desired.push("logo");
  }

  return unique(desired);
}

function inferRecommendedBlockArchetypes(section = {}, decomposition = null) {
  const role = cleanText(section.role);
  const archetype = cleanText(section.archetype);
  const footerFamily = cleanText(decomposition?.footerFamily);
  const recommendations = [];

  if (role === "header") {
    recommendations.push("header-logo-row");
  } else if (role === "hero") {
    if (archetype === "background-hero") {
      recommendations.push("background-hero-banner");
    } else if (archetype === "hero-banner") {
      recommendations.push("hero-image-block");
    } else {
      recommendations.push("hero-copy-block");
    }
  } else if (role === "feature-list") {
    if (normalizePositiveNumber(section.columnCount) >= 3) {
      recommendations.push("feature-grid");
    } else if (normalizePositiveNumber(section.columnCount) === 2) {
      recommendations.push("two-column-feature-grid");
    } else {
      recommendations.push("feature-list-stack");
    }
  } else if (role === "image") {
    recommendations.push(archetype === "content-card" ? "image-card-block" : "image-showcase-block");
  } else if (role === "cta") {
    recommendations.push("single-button-cta-card");
  } else if (role === "text") {
    if (normalizePositiveNumber(section.columnCount) >= 2) {
      recommendations.push("two-column-copy-block");
    } else {
      recommendations.push("plain-copy-text-card");
    }
  } else if (role === "footer") {
    if (footerFamily.includes("store")) {
      recommendations.push("store-badges-row");
    }
    if (footerFamily.includes("social")) {
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

  if (!role || role === "unknown") {
    return "low";
  }

  if (role === "footer" || role === "header") {
    return "high";
  }

  if (archetype && archetype !== "plain-section") {
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
      confidence: inferSectionConfidence(section),
      childRoleHints: unique(section.childRoleHints),
      desiredAssetRoles,
      recommendedBlockArchetypes,
      notes: unique([
        cleanText(section.summaryText),
        cleanText(section.componentName),
        cleanText(section?.style?.layoutMode),
        cleanText(section?.style?.backgroundImage) ? "background-image" : "",
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
    assemblyStrategy: "reference-family-first",
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
