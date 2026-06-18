import fs from "node:fs/promises";
import path from "node:path";

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "legacy-item";
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function extractMatches(content, pattern, mapper = (match) => match[1]) {
  const matches = [];
  let match;
  while ((match = pattern.exec(content))) {
    matches.push(mapper(match));
  }
  return unique(matches);
}

function normalizeLegacyBrand(rawBrand, index = 0) {
  const styles = rawBrand && typeof rawBrand.styles === "object" ? rawBrand.styles : {};
  const brandName = String(rawBrand?.brandName || `Legacy Brand ${index + 1}`).trim();
  return {
    id: slugify(brandName),
    source: "retention-tool-kit",
    label: brandName,
    tokens: {
      primaryColor: styles.brand_color || null,
      secondaryColor: styles.brand_additional_color || null,
      buttonTextColor: styles.on_brand_color || null,
      surfaceColor: styles.surface_color || null,
      surfaceVariantColor: styles.surface_variant_color || null,
      textColor: styles.on_surface_color || null,
      backgroundColor: styles.background_color || null,
      accentColor: styles.accent_color || null,
      buttonRadius: styles.button_radius || null,
      smallRadius: styles.small_radius || null,
      largeRadius: styles.large_radius || null,
      logoUrl: styles.logo_email_brand || null,
      logoWidth: styles.logo_width || null,
      position: styles.position || null,
      borderFrame: styles.border_ramka || null
    },
    spacing: {
      l: styles.padding_l || null,
      m: styles.padding_m || null,
      s: styles.padding_s || null,
      xs: styles.padding_xs || null
    },
    rawStyles: styles
  };
}

function classifyTemplate(content) {
  const normalized = String(content || "").toLowerCase();
  if (/support/i.test(normalized) || /company_email|mailto:/i.test(normalized)) {
    return "support";
  }
  if (/button/i.test(normalized) || /read-more-button|butt-link/i.test(normalized)) {
    return "cta";
  }
  if (/footer\.block_|company_terms_link|unsubscribe_link/i.test(normalized)) {
    return "footer-aware";
  }
  return "generic";
}

function normalizeLegacyTemplate(rawTemplate, index = 0) {
  const name = String(rawTemplate?.name || `Legacy Template ${index + 1}`).trim();
  const content = String(rawTemplate?.content || "");
  return {
    id: slugify(name),
    source: "retention-tool-kit",
    label: name,
    type: classifyTemplate(content),
    stats: {
      length: content.length,
      inlineStyleCount: (content.match(/style=/gi) || []).length,
      imageCount: (content.match(/<img\b/gi) || []).length,
      linkCount: (content.match(/<a\b/gi) || []).length
    },
    placeholders: {
      styleTokens: extractMatches(content, /\{%\s*([a-z0-9_]+)\s*%\}/gi),
      embeddedRefs: extractMatches(content, /\{\{\s*embedded\.([a-z0-9_]+)\s*\}\}/gi),
      blockRefs: extractMatches(content, /\$\{\{\s*([a-z0-9_.-]+)\s*\}\}\$/gi)
    },
    content
  };
}

async function readJsonIfExists(filePath, fallback = []) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return fallback;
    }
    throw error;
  }
}

export async function buildLegacyToolkitSnapshot(legacyRoot) {
  const root = path.resolve(legacyRoot);
  const packageJson = await readJsonIfExists(path.join(root, "package.json"), {});
  const brands = await readJsonIfExists(path.join(root, "server", "brands.json"), []);
  const templates = await readJsonIfExists(path.join(root, "server", "templates.json"), []);

  const normalizedBrands = brands.map(normalizeLegacyBrand);
  const normalizedTemplates = templates.map(normalizeLegacyTemplate);

  return {
    generatedAt: new Date().toISOString(),
    source: {
      root,
      packageName: packageJson?.name || null,
      packageVersion: packageJson?.version || null
    },
    summary: {
      brands: normalizedBrands.length,
      templates: normalizedTemplates.length,
      templateTypes: normalizedTemplates.reduce((acc, item) => {
        acc[item.type] = (acc[item.type] || 0) + 1;
        return acc;
      }, {})
    },
    brands: normalizedBrands,
    templates: normalizedTemplates
  };
}
