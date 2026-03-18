/**
 * src/assembler.js — Block Assembly Pipeline
 *
 * Core feature: given a set of canonical block IDs + content variables,
 * assembles a real Pug email template that matches the email-base structure.
 *
 * How it works:
 *   1. AI picks blocks from the catalog: header-logo-row, hero-image-block, etc.
 *   2. assembleEmail() maps block IDs → real .pug file paths
 *   3. Builds index.pug with correct includes
 *   4. Returns a "ready to build" mail folder structure
 *
 * Translation tokens: ${{ mail-id.block_01 }}$ — auto-generated per block slot
 */

import path from "node:path";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { mkdir, writeFile, cp } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { paths, CATEGORY_IGNORE_LIST, TEMPLATE_SOURCE_EXTENSIONS } from "./config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Block catalog with file paths ───────────────────────────────────────────
// Maps canonical block ID → relative path from mail root
// These are "meta-blocks" — composites of includes that appear in every template.
// The actual files are discovered dynamically from the email base.

const CANONICAL_BLOCK_MAP = {
  "header-logo-row": {
    description: "Logo row at top — always first",
    sectionKind: "image",
    includeRelative: "blocks/header",
    required: true,
    order: 0
  },
  "hero-image-block": {
    description: "Full-width hero with headline + CTA",
    sectionKind: "hero",
    includeRelative: "blocks/hero",
    order: 1
  },
  "hero-image-two-cta": {
    description: "Hero with table-based two CTA pattern",
    sectionKind: "hero",
    includeRelative: "blocks/hero",
    order: 1
  },
  "plain-copy-text-card": {
    description: "Text body block — headline + paragraph",
    sectionKind: "text",
    includeRelative: "blocks/text",
    order: 2
  },
  "single-button-cta-card": {
    description: "Single centered CTA button",
    sectionKind: "cta",
    includeRelative: "blocks/cta",
    order: 3
  },
  "numbered-steps-block": {
    description: "Numbered list of steps (1, 2, 3...)",
    sectionKind: "feature-list",
    includeRelative: "blocks/steps",
    order: 4
  },
  "numbered-feature-stack": {
    description: "Numbered feature stack",
    sectionKind: "feature-list",
    includeRelative: "blocks/steps",
    order: 4
  },
  "image-section-block": {
    description: "Standalone image section",
    sectionKind: "image",
    includeRelative: "blocks/image",
    order: 5
  },
  "store-badges-row": {
    description: "App Store + Google Play badges",
    sectionKind: "footer",
    includeRelative: "blocks/store-badges",
    order: 8
  },
  "three-promo-column-row": {
    description: "Promo/features row with multiple columns",
    sectionKind: "feature-list",
    includeRelative: "blocks/features",
    order: 8
  },
  "social-links-row": {
    description: "Social media icon links",
    sectionKind: "footer",
    includeRelative: "blocks/social",
    order: 9
  },
  "social-icons-row": {
    description: "Social media icon links",
    sectionKind: "footer",
    includeRelative: "blocks/social",
    order: 9
  },
  "switch-cta-row": {
    description: "Switch CTA row",
    sectionKind: "cta",
    includeRelative: "blocks/cta",
    order: 3
  },
  "vml-bottom-hero": {
    description: "VML hero block",
    sectionKind: "hero",
    includeRelative: "blocks/hero",
    order: 1
  },
  "vml-bottom-hero-fixed": {
    description: "Fixed VML hero block",
    sectionKind: "hero",
    includeRelative: "blocks/hero",
    order: 1
  },
  "legal-unsubscribe-footer": {
    description: "Legal text + unsubscribe links — always last",
    sectionKind: "footer",
    includeRelative: "helpers/footer",
    isHelper: true,
    required: true,
    order: 99
  }
};

// ─── Find existing block files ────────────────────────────────────────────────

export function discoverBlocksInMail(category, mailId) {
  const mailRoot = path.join(paths.emailBase, category, `mail-${mailId}`);
  const blocksDir = path.join(mailRoot, "app", "templates", "blocks");
  const helpersDir = path.join(mailRoot, "app", "templates", "helpers");

  const blocks = {};

  if (existsSync(blocksDir)) {
    for (const file of readdirSync(blocksDir)) {
      const ext = path.extname(file);
      if (TEMPLATE_SOURCE_EXTENSIONS.includes(ext)) {
        const name = path.basename(file, ext);
        blocks[name] = path.join("blocks", file);
      }
    }
  }

  if (existsSync(helpersDir)) {
    for (const file of readdirSync(helpersDir)) {
      const ext = path.extname(file);
      if (TEMPLATE_SOURCE_EXTENSIONS.includes(ext)) {
        const name = path.basename(file, ext);
        blocks[`helpers/${name}`] = path.join("helpers", file);
      }
    }
  }

  return blocks;
}

// ─── Get closest reference template ──────────────────────────────────────────

export function findReferenceTemplate(category, mailType) {
  const categoryPath = path.join(paths.emailBase, category);
  if (!existsSync(categoryPath)) return null;

  const allMails = readdirSync(categoryPath).filter((d) => d.startsWith("mail-"));

  // Try exact match first
  const exactMatch = allMails.find((d) => d === `mail-${mailType}`);
  if (exactMatch) return { category, mailId: mailType, folder: exactMatch };

  // Try partial match by type keywords
  const typeWords = mailType.toLowerCase().split(/[-_]/);
  const scored = allMails
    .map((folder) => {
      const folderWords = folder.toLowerCase().split(/[-_]/);
      const score = typeWords.filter((w) => folderWords.includes(w)).length;
      return { folder, mailId: folder.replace(/^mail-/, ""), score };
    })
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length > 0) {
    return { category, mailId: scored[0].mailId, folder: scored[0].folder };
  }

  // Fall back to first mail in category
  if (allMails.length > 0) {
    const folder = allMails[0];
    return { category, mailId: folder.replace(/^mail-/, ""), folder };
  }

  return null;
}

// ─── Read reference template content ─────────────────────────────────────────

function readFileSafe(filePath) {
  if (!existsSync(filePath)) return null;
  try {
    return readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}

function resolveIndexPath(templatesRoot) {
  for (const ext of TEMPLATE_SOURCE_EXTENSIONS) {
    const filePath = path.join(templatesRoot, `index${ext}`);
    if (existsSync(filePath)) return filePath;
  }
  return null;
}

// ─── Generate locale tokens ───────────────────────────────────────────────────

/**
 * Generate translation token map for a new email.
 * Returns: { "block_01": "Welcome to the platform", ... }
 */
export function generateLocaleTokenMap(mailId, sections) {
  const namespace = mailId.replace(/^mail-/, "").replace(/\s+/g, "-");
  const map = {};
  sections.forEach((section, i) => {
    const pad = String(i + 1).padStart(2, "0");
    if (section.title) map[`block_${pad}`] = section.title;
    if (section.body) map[`block_${pad}_body`] = section.body;
    if (section.cta_label) map[`block_${pad}_cta`] = section.cta_label;
    if (section.eyebrow) map[`block_${pad}_eyebrow`] = section.eyebrow;
    // Array items
    if (Array.isArray(section.items)) {
      section.items.forEach((item, j) => {
        map[`block_${pad}_item${j + 1}`] = item;
      });
    }
  });
  return { namespace, tokens: map };
}

// ─── Build Pug index file ─────────────────────────────────────────────────────

/**
 * Generates index.pug content for a new email.
 * Reuses include structure from a reference template, or builds from scratch.
 */
export function buildIndexPug({ mailId, blocks, referenceContent, doctype = "html" }) {
  const namespace = mailId.replace(/^mail-/, "");

  // If we have a reference, use it as a starting point
  if (referenceContent) {
    return adaptReferenceTemplate(referenceContent, namespace, blocks);
  }

  // Build from scratch with canonical structure
  const blockIncludes = blocks
    .filter((b) => !b.isHelper)
    .sort((a, b) => (a.order || 0) - (b.order || 0))
    .map((b) => `                                    include ${b.includeRelative}`)
    .join("\n");

  return `doctype ${doctype}
html(xmlns="http://www.w3.org/1999/xhtml")

    include ../../../../vendor/helpers/mixins
    include ../../../../vendor/helpers/head

    body.body
        include helpers/preheader
        table.body
            tr
                td(align="center", valign="top").center.bg-col
                    center
                        table.container
                            tr
                                td.pt0.plr10a
                                    include blocks/header
${blockIncludes}
                                    include helpers/footer

        //Gmail App Fix
        include ../../../../vendor/helpers/gmail-fix
`;
}

function adaptReferenceTemplate(content, newNamespace, blocks) {
  // Simply return the reference content as the base —
  // the user will adjust blocks manually or via build pipeline
  // Future: do token namespace replacement here
  return content;
}

// ─── Build header.pug block ───────────────────────────────────────────────────

export function buildHeaderBlock({ logoUrl, logoHref, logoAlt, brandColor = "#ff7a2f", mailId }) {
  const namespace = mailId.replace(/^mail-/, "");
  const tokenPrefix = namespace;

  return `table.row
    tr
        td.wrapper.last.offset-by-one.pt0
            table.ten.columns
                tr
                    td.text-pad-small.pb0
                        a(href="${logoHref || "#"}" universal="true" target="_blank")
                            img.logo.center(src="${logoUrl || "https://via.placeholder.com/200x50"}" alt="${logoAlt || "Logo"}")
`;
}

// ─── Build variables.styl ─────────────────────────────────────────────────────

export function buildVariablesStyl({ primaryColor = "#ff7a2f", backgroundColor = "#ffffff", fontFamily = "Arial, sans-serif", textColor = "#333333" }) {
  return `// Brand variables — edit to match your brand
$primary-color = ${primaryColor}
$bg-color = ${backgroundColor}
$text-color = ${textColor}
$font-family = ${fontFamily}
$container-width = 600px
$mobile-width = 100%
`;
}

// ─── Main assembler ───────────────────────────────────────────────────────────

/**
 * Assemble a new email from draft + reference.
 *
 * @param {object} opts
 *   category         - e.g. "X_IQ"
 *   mailId           - e.g. "rfm-new-001"
 *   draft            - AI draft with sections[]
 *   referenceMailId  - optional: which existing mail to copy structure from
 *   brandVars        - optional: { primaryColor, backgroundColor, ... }
 */
export async function assembleEmail({ category, mailId, draft, referenceMailId, brandVars = {} }) {
  const cleanCategory = String(category || "").replace(/[^A-Za-z0-9_]/g, "");
  const cleanMailId = String(mailId || "").replace(/[^A-Za-z0-9_\-]/g, "").replace(/^mail-/, "");

  if (!cleanCategory || !cleanMailId) {
    throw new Error("category and mailId are required");
  }

  const mailFolder = `mail-${cleanMailId}`;
  const mailRoot = path.join(paths.emailBase, cleanCategory, mailFolder);

  // Find reference template
  let referenceContent = null;
  if (referenceMailId) {
    const refTemplatesRoot = path.join(
      paths.emailBase, cleanCategory, `mail-${referenceMailId}`, "app", "templates"
    );
    const refIndexPath = resolveIndexPath(refTemplatesRoot);
    if (refIndexPath) {
      referenceContent = readFileSafe(refIndexPath);
    }
  } else {
    // Auto-find closest reference in same category
    const ref = findReferenceTemplate(cleanCategory, cleanMailId);
    if (ref) {
      const refTemplatesRoot = path.join(
        paths.emailBase, ref.category, ref.folder, "app", "templates"
      );
      const refIndexPath = resolveIndexPath(refTemplatesRoot);
      if (refIndexPath) referenceContent = readFileSafe(refIndexPath);
    }
  }

  // Generate translation tokens
  const sections = Array.isArray(draft?.sections) ? draft.sections : [];
  const { namespace, tokens } = generateLocaleTokenMap(cleanMailId, sections);

  // Build locale JSON
  const localeData = {
    [`${namespace}`]: tokens
  };

  // Build block list from AI sections
  const sectionBlocks = sections.map((section, i) => ({
    includeRelative: `blocks/section-${i + 1}`,
    isHelper: false,
    order: i + 1,
    section
  }));

  // Generate index.pug
  const indexContent = buildIndexPug({
    mailId: cleanMailId,
    blocks: sectionBlocks,
    referenceContent
  });

  // Generate variables.styl
  const variablesContent = buildVariablesStyl(brandVars);

  // Build folder structure
  const templatesRoot = path.join(mailRoot, "app", "templates");
  const stylesRoot = path.join(mailRoot, "app", "styles");
  const helpersDir = path.join(stylesRoot, "helpers");

  await mkdir(path.join(templatesRoot, "blocks"), { recursive: true });
  await mkdir(path.join(templatesRoot, "helpers"), { recursive: true });
  await mkdir(helpersDir, { recursive: true });
  await mkdir(path.join(stylesRoot, "blocks"), { recursive: true });
  await mkdir(path.join(mailRoot, "app", "assets", "styles"), { recursive: true });

  // Write index.pug
  await writeFile(path.join(templatesRoot, "index.pug"), indexContent, "utf-8");

  // Write locale JSON to vendor data (creates placeholder locale files)
  const vendorDataLocalesPath = path.join(paths.emailBase, "vendor", "data");
  if (existsSync(vendorDataLocalesPath)) {
    const locales = readdirSync(vendorDataLocalesPath).filter((d) => {
      return /^[A-Za-z]{2}([_-][A-Za-z]{2})?$/.test(d);
    }).slice(0, 1); // write to first locale only as scaffold

    if (locales.length > 0) {
      const localePath = path.join(vendorDataLocalesPath, locales[0], `${namespace}.json`);
      await mkdir(path.dirname(localePath), { recursive: true });
      // Don't overwrite existing locale
      if (!existsSync(localePath)) {
        await writeFile(localePath, JSON.stringify(localeData, null, 2), "utf-8");
      }
    }
  }

  // Write variables.styl
  await writeFile(path.join(helpersDir, "variables.styl"), variablesContent, "utf-8");

  // Copy header block from reference if available
  if (referenceMailId) {
    const refBlocksDir = path.join(
      paths.emailBase, cleanCategory, `mail-${referenceMailId}`, "app", "templates", "blocks"
    );
    const destBlocksDir = path.join(templatesRoot, "blocks");
    if (existsSync(refBlocksDir)) {
      try {
        await cp(refBlocksDir, destBlocksDir, { recursive: true, force: false });
      } catch { /* skip if files already exist */ }
    }

    // Copy helpers (footer, preheader, etc.)
    const refHelpersDir = path.join(
      paths.emailBase, cleanCategory, `mail-${referenceMailId}`, "app", "templates", "helpers"
    );
    const destHelpersDir = path.join(templatesRoot, "helpers");
    if (existsSync(refHelpersDir)) {
      try {
        await cp(refHelpersDir, destHelpersDir, { recursive: true, force: false });
      } catch { /* skip */ }
    }

    // Copy styles from reference
    const refStylesRoot = path.join(
      paths.emailBase, cleanCategory, `mail-${referenceMailId}`, "app", "styles"
    );
    if (existsSync(refStylesRoot)) {
      try {
        await cp(refStylesRoot, stylesRoot, { recursive: true, force: false });
      } catch { /* skip */ }
    }
  }

  // Build common.styl if not copied
  const commonStylPath = path.join(stylesRoot, "common.styl");
  if (!existsSync(commonStylPath)) {
    await writeFile(commonStylPath, `@import 'helpers/variables'\n@import 'helpers/ink'\n@import 'blocks/main'\n`, "utf-8");
  }

  return {
    ok: true,
    mailRoot,
    folder: `${cleanCategory}/${mailFolder}`,
    namespace,
    tokenCount: Object.keys(tokens).length,
    localeData,
    sectionCount: sections.length,
    hasReference: Boolean(referenceContent),
    files: [
      `${cleanCategory}/${mailFolder}/app/templates/index.pug`,
      `${cleanCategory}/${mailFolder}/app/styles/helpers/variables.styl`
    ]
  };
}

// ─── Enrich block catalog with file paths ────────────────────────────────────

/**
 * For each item in block catalog, find actual .pug/.jade file path
 * by scanning matching sources.
 */
export function enrichCatalogWithPaths(catalogItems) {
  return catalogItems.map((item) => {
    const enriched = { ...item, filePaths: [] };

    for (const source of (item.sources || []).slice(0, 3)) {
      if (!source.category || !source.mailId) continue;
      const mailRoot = path.join(
        paths.emailBase, source.category, `mail-${source.mailId}`, "app", "templates"
      );
      const blocksDir = path.join(mailRoot, "blocks");
      if (!existsSync(blocksDir)) continue;

      const files = readdirSync(blocksDir)
        .filter((f) => TEMPLATE_SOURCE_EXTENSIONS.includes(path.extname(f)))
        .map((f) => path.join("blocks", f));

      enriched.filePaths.push(...files.slice(0, 2));
    }

    enriched.filePaths = [...new Set(enriched.filePaths)];
    return enriched;
  });
}

// ─── Quick scaffold for new brand ────────────────────────────────────────────

/**
 * Create minimal brand folder structure so build pipeline can run.
 * Call this when a brand category doesn't exist yet.
 */
export async function scaffoldNewBrand(categoryName) {
  const cleanName = String(categoryName || "").replace(/[^A-Za-z0-9_]/g, "");
  if (!cleanName) throw new Error("Invalid category name");

  const categoryPath = path.join(paths.emailBase, cleanName);
  await mkdir(categoryPath, { recursive: true });

  return {
    ok: true,
    category: cleanName,
    path: categoryPath,
    note: `Brand folder created. Add mail-* folders inside to start adding emails.`
  };
}
