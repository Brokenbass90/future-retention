/**
 * src/catalog.js — Block catalog generation
 *
 * Scans the email-base directory, detects Pug/Jade block patterns,
 * and builds a structured catalog of reusable email blocks.
 *
 * Dependencies:
 *   - src/utils.js   — cleanText, dedupeStrings, dedupeCatalogSources, mergeCatalogTraits
 *   - src/config.js  — paths
 *   - node:fs, node:fs/promises, node:path
 */

import path from "node:path";
import { existsSync, readdirSync } from "node:fs";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { cleanText, dedupeStrings, toRelativePath, dedupeCatalogSources, mergeCatalogTraits } from "./utils.js";
import { paths } from "./config.js";

const TEMPLATE_EXTENSIONS = new Set([".jade", ".pug"]);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isTemplateFile(filePath) {
  return TEMPLATE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function toRel(filePath) {
  return toRelativePath(filePath, paths.root);
}

/**
 * Lists all template source files (index + blocks/ + helpers/) for a mail.
 * @param {string} mailTemplatesRoot  e.g. email-base/X_Brand/mail-foo/app/templates
 */
function listMailTemplateSourceFiles(mailTemplatesRoot) {
  if (!existsSync(mailTemplatesRoot)) return [];

  function scanDir(dirPath, filterFn) {
    try {
      return readdirSync(dirPath, { withFileTypes: true })
        .filter((e) => e.isFile() && filterFn(e.name))
        .map((e) => path.join(dirPath, e.name));
    } catch {
      return [];
    }
  }

  const indexPath = (() => {
    for (const ext of [".jade", ".pug"]) {
      const p = path.join(mailTemplatesRoot, `index${ext}`);
      if (existsSync(p)) return p;
    }
    return null;
  })();

  const blockFiles = scanDir(path.join(mailTemplatesRoot, "blocks"), isTemplateFile);
  const helperFiles = scanDir(path.join(mailTemplatesRoot, "helpers"), isTemplateFile);

  return [indexPath, ...blockFiles, ...helperFiles].filter(Boolean);
}

// ─── Catalog item builders ────────────────────────────────────────────────────

function getEvidenceOrder(content, evidenceNeedle) {
  const index = cleanText(evidenceNeedle) ? content.indexOf(evidenceNeedle) : -1;
  return index >= 0 ? index : Number.MAX_SAFE_INTEGER;
}

function resolveTemplateFileRank(filePath) {
  const normalized = toRel(filePath);

  if (/\/helpers\/preheader\.(jade|pug)$/i.test(normalized)) return 50;
  if (/\/blocks\/header\.(jade|pug)$/i.test(normalized)) return 100;
  if (/\/blocks\//i.test(normalized)) return 200;
  if (/\/index\.(jade|pug)$/i.test(normalized)) return 300;
  if (/\/helpers\/button\.(jade|pug)$/i.test(normalized)) return 700;
  if (/\/helpers\/footer\.(jade|pug)$/i.test(normalized)) return 900;
  if (/\/helpers\//i.test(normalized)) return 800;

  return 500;
}

function createCatalogSource(category, mailId, filePath, evidenceNeedle) {
  const fileRank = resolveTemplateFileRank(filePath);
  return {
    category,
    mailId,
    file: toRel(filePath),
    evidence: cleanText(evidenceNeedle),
    order: fileRank * 1000000
  };
}

function createCatalogItem({ id, label, description, sectionKind, helperMixins = [], traits = {}, usageCount = 1, category, mailId, filePath, evidence, content }) {
  const source = createCatalogSource(category, mailId, filePath, evidence);
  const fileRank = resolveTemplateFileRank(filePath);
  source.order = fileRank * 1000000 + getEvidenceOrder(content, evidence);
  return { id, label, description, sectionKind, helperMixins, traits, usageCount, sources: [source] };
}

export function registerCatalogItem(map, item) {
  const normalized = {
    id: cleanText(item?.id),
    label: cleanText(item?.label),
    description: cleanText(item?.description),
    sectionKind: cleanText(item?.sectionKind) || "text",
    helperMixins: dedupeStrings(item?.helperMixins),
    traits: mergeCatalogTraits({}, item?.traits),
    usageCount: Number(item?.usageCount) || 1,
    sources: dedupeCatalogSources(item?.sources)
  };
  if (!normalized.id) return;

  const existing = map.get(normalized.id);
  if (!existing) { map.set(normalized.id, normalized); return; }

  existing.label = existing.label || normalized.label;
  existing.description = existing.description || normalized.description;
  existing.sectionKind = existing.sectionKind || normalized.sectionKind;
  existing.helperMixins = dedupeStrings([...existing.helperMixins, ...normalized.helperMixins]);
  existing.traits = mergeCatalogTraits(existing.traits, normalized.traits);
  existing.usageCount += normalized.usageCount;
  existing.sources = dedupeCatalogSources([...existing.sources, ...normalized.sources]);
}

// ─── Pattern detection ────────────────────────────────────────────────────────

export async function extractCatalogItemsFromTemplate(category, mailId, filePath) {
  const content = await readFile(filePath, "utf8");
  const items = [];

  const numberedSections = (content.match(/p\.number\b/g) || []).length;
  const listItems = (content.match(/p\.text\.list-item\b/g) || []).length;
  const hasSimpleCta = /table\.medium-button(?:-bot)?\.radius|\.button-wrapper\b/.test(content);
  const hasTextCard = /p\.(?:title|subtitle|hello)\b/.test(content) && /p\.text\b/.test(content);
  const hasHeroBlock = /\.bg-head\b|\.bgr-image\b|p\.title-top\b|img\.banner\b/.test(content);
  const hasPromoColumns = /three-colums|three-columns|text-promo|w-33\b|two-up\b|three-up\b|four-up\b/.test(content);
  const hasFooterLegal = /footer-text|unsubscribe|\[unsubscribe\]|terms and conditions|helpers\/footer/i.test(content);
  const hasSocialLinks = /\.social-links\b|img\.soc\b|img\.soc-icon\b|\.socials\b/.test(content);

  const push = (opts) => items.push(createCatalogItem({ category, mailId, filePath, content, ...opts }));

  if (/img\.logo\b/.test(content)) push({ id: "header-logo-row", label: "Header logo row", description: "Тонкая верхняя строка с логотипом и ссылкой на бренд.", sectionKind: "image", traits: { hasImage: true, hasCta: true, ctaCount: 1, itemMode: "none", minItems: 0, outlookSafe: true, vml: false }, evidence: "img.logo" });

  if (hasHeroBlock) push({ id: "hero-image-block", label: "Hero image block", description: "Hero-секция с фоновым изображением или баннером, заголовком и brand-led top area.", sectionKind: "hero", traits: { hasImage: true, hasCta: hasSimpleCta, ctaCount: hasSimpleCta ? 1 : 0, itemMode: "none", minItems: 0, outlookSafe: true, vml: false }, evidence: /\.bg-head\b/.test(content) ? ".bg-head" : "p.title-top" });

  if (/\+cta-two-column-table\(/.test(content) || /Table-based CTA example/.test(content)) push({ id: "hero-image-two-cta", label: "Hero image with two CTA", description: "Первый экран с большой картинкой, hero copy и двухкнопочным table-based CTA.", sectionKind: "hero", helperMixins: ["cta-two-column-table"], traits: { hasImage: true, hasCta: true, ctaCount: 2, itemMode: "none", minItems: 0, outlookSafe: true, vml: false }, evidence: "Table-based CTA example" });

  if (numberedSections > 0) push({ id: "numbered-feature-stack", label: "Numbered feature stack", description: "Секция с пронумерованными шагами/выгодами.", sectionKind: "feature-list", traits: { hasImage: true, hasCta: true, ctaCount: 1, itemMode: "numbered", minItems: numberedSections, outlookSafe: true, vml: false }, usageCount: numberedSections, evidence: "p.number" });

  if (listItems > 0) push({ id: "bullet-proof-list-card", label: "Bullet proof list card", description: "Текстовый блок со списком выгод через list-item паттерн.", sectionKind: "feature-list", traits: { hasImage: false, hasCta: false, ctaCount: 0, itemMode: "bullets", minItems: listItems, outlookSafe: true, vml: false }, usageCount: listItems, evidence: "p.text.list-item" });

  if (hasSimpleCta) push({ id: "single-button-cta-card", label: "Single CTA card", description: "Простой однокнопочный CTA-блок на medium-button паттерне.", sectionKind: "cta", traits: { hasImage: false, hasCta: true, ctaCount: 1, itemMode: "none", minItems: 0, outlookSafe: true, vml: false }, evidence: "table.medium-button.radius" });

  if (hasTextCard) {
    const textEvidence = /p\.title\b/.test(content)
      ? "p.title"
      : (/p\.subtitle\b/.test(content) ? "p.subtitle" : "p.hello");
    push({ id: "plain-copy-text-card", label: "Plain copy text card", description: "Базовый текстовый блок с title + body copy.", sectionKind: "text", traits: { hasImage: false, hasCta: false, ctaCount: 0, itemMode: "none", minItems: 0, outlookSafe: true, vml: false }, evidence: textEvidence });
  }

  if (hasPromoColumns) push({ id: "three-promo-column-row", label: "Three promo column row", description: "Трехколоночный ряд с promo/feature-блоками.", sectionKind: "feature-list", traits: { hasImage: false, hasCta: true, ctaCount: 3, itemMode: "grid", minItems: 3, outlookSafe: true, vml: false }, usageCount: 3, evidence: "three-colums" });

  if (/\+cta-switch-table\(/.test(content) || /Table-based switch row example/.test(content)) push({ id: "switch-cta-row", label: "Switch CTA row", description: "Двухкнопочный switch row с центральной стрелкой.", sectionKind: "cta", helperMixins: ["cta-switch-table"], traits: { hasImage: true, hasCta: true, ctaCount: 2, itemMode: "binary", minItems: 2, outlookSafe: true, vml: false }, evidence: "Table-based switch row example" });

  if (/\+vml-bg\(/.test(content)) push({ id: "vml-bottom-hero", label: "VML background hero", description: "Outlook-safe hero на VML background helper.", sectionKind: "cta", helperMixins: ["vml-bg"], traits: { hasImage: true, hasCta: true, ctaCount: 1, itemMode: "none", minItems: 0, outlookSafe: true, vml: true }, evidence: "+vml-bg(" });

  if (/\+vml-bg-fixed\(/.test(content) || /Fixed VML background example/.test(content)) push({ id: "vml-bottom-hero-fixed", label: "Fixed VML background hero", description: "Фиксированный VML background helper для Outlook.", sectionKind: "cta", helperMixins: ["vml-bg-fixed"], traits: { hasImage: true, hasCta: true, ctaCount: 1, itemMode: "none", minItems: 0, outlookSafe: true, vml: true }, evidence: "Fixed VML background example" });

  if (/img\.a-app\b/.test(content) || /img\.a-google\b/.test(content) || /apps\.apple\.com/.test(content) || /play\.google\.com/.test(content)) push({ id: "store-badges-row", label: "Store badges row", description: "Ряд с App Store и Google Play badges.", sectionKind: "footer", traits: { hasImage: true, hasCta: true, ctaCount: 2, itemMode: "none", minItems: 0, outlookSafe: true, vml: false }, evidence: "img.a-app" });

  if (hasFooterLegal) push({ id: "legal-unsubscribe-footer", label: "Legal unsubscribe footer", description: "Юридический footer с address, legal copy, terms и unsubscribe ссылками.", sectionKind: "footer", traits: { hasImage: false, hasCta: true, ctaCount: 2, itemMode: "none", minItems: 0, outlookSafe: true, vml: false }, evidence: "footer-text" });

  if (hasSocialLinks) push({ id: "social-links-row", label: "Social links row", description: "Строка соцсетей/брендовых иконок с ссылками.", sectionKind: "footer", traits: { hasImage: true, hasCta: true, ctaCount: 3, itemMode: "none", minItems: 0, outlookSafe: true, vml: false }, evidence: /\.social-links\b/.test(content) ? ".social-links" : "img.soc" });

  if (/wrap-awards|\.award-\d|wrap-award\b/.test(content)) push({ id: "awards-showcase-row", label: "Awards showcase row", description: "Блок с наградами и badge-изображениями.", sectionKind: "feature-list", traits: { hasImage: true, hasCta: false, ctaCount: 0, itemMode: "grid", minItems: 2, outlookSafe: true, vml: false }, evidence: "wrap-awards" });

  if (/table\.row\.dark-bg\b/.test(content) || /\.dark-bg\b/.test(content)) push({ id: "dark-banner-cta-block", label: "Dark banner CTA block", description: "Секция с тёмным фоном и promotional CTA.", sectionKind: "hero", traits: { hasImage: true, hasCta: true, ctaCount: 1, itemMode: "none", minItems: 0, outlookSafe: true, vml: false }, evidence: "table.row.dark-bg" });

  if (/countdown|js-countdown|timer-block\b/.test(content)) push({ id: "countdown-timer-block", label: "Countdown timer block", description: "Блок с обратным отсчётом для акций.", sectionKind: "hero", traits: { hasImage: false, hasCta: false, ctaCount: 0, itemMode: "none", minItems: 0, outlookSafe: false, vml: false }, evidence: "countdown" });

  if (/img\(src=/.test(content) && !hasTextCard && !hasSimpleCta && !/img\.logo\b/.test(content) && /a\(href=/.test(content)) {
    const imgCount = (content.match(/img\(src=/g) || []).length;
    if (imgCount >= 1 && imgCount <= 3) push({ id: "image-banner-block", label: "Image banner block", description: "Баннерный блок: одна или несколько картинок с ссылками.", sectionKind: "image", traits: { hasImage: true, hasCta: false, ctaCount: imgCount, itemMode: "none", minItems: 0, outlookSafe: true, vml: false }, evidence: "img(src=" });
  }

  return items;
}

// ─── Catalog generation ───────────────────────────────────────────────────────

export function summarizeBlockCatalog(catalog) {
  const items = Array.isArray(catalog?.items) ? catalog.items : [];
  const sourceMails = dedupeStrings(
    items.flatMap((item) =>
      item.sources.map((s) => (s.category && s.mailId ? `${s.category}/mail-${s.mailId}` : ""))
    )
  );
  return {
    itemCount: items.length,
    generatedAt: cleanText(catalog?.generatedAt),
    path: toRel(paths.blockCatalog),
    sourceMailCount: sourceMails.length,
    sourceMails,
    sectionKinds: dedupeStrings(items.map((item) => item.sectionKind)),
    helperMixins: dedupeStrings(items.flatMap((item) => item.helperMixins || []))
  };
}

/**
 * Scans the entire email-base and builds a block catalog.
 * @param {object} opts
 * @param {Function} opts.summarizeEmailBase  Function that returns email base summary
 */
export async function generateBlockCatalog({ summarizeEmailBase }) {
  const emailBase = summarizeEmailBase();
  const catalogMap = new Map();

  for (const category of emailBase.categories || []) {
    for (const mail of category.mails || []) {
      const mailRoot = path.join(paths.emailBase, category.name, mail.folder, "app", "templates");
      const templateFiles = listMailTemplateSourceFiles(mailRoot);
      for (const filePath of templateFiles) {
        const items = await extractCatalogItemsFromTemplate(category.name, mail.id, filePath);
        for (const item of items) registerCatalogItem(catalogMap, item);
      }
    }
  }

  const items = [...catalogMap.values()].sort((l, r) => {
    const lo = l.sources[0]?.order ?? Number.MAX_SAFE_INTEGER;
    const ro = r.sources[0]?.order ?? Number.MAX_SAFE_INTEGER;
    return lo - ro || l.label.localeCompare(r.label);
  });

  return {
    generatedAt: new Date().toISOString(),
    root: toRel(paths.emailBase),
    items,
    summary: summarizeBlockCatalog({ generatedAt: new Date().toISOString(), items })
  };
}

/**
 * Loads the catalog from disk, or regenerates if missing/forced.
 * @param {object} opts
 * @param {boolean} [opts.force]
 * @param {Function} opts.summarizeEmailBase
 */
export async function ensureBlockCatalog({ force = false, summarizeEmailBase } = {}) {
  if (!force && existsSync(paths.blockCatalog)) {
    try {
      const raw = await readFile(paths.blockCatalog, "utf8");
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed?.items)) {
        return { ...parsed, summary: summarizeBlockCatalog(parsed) };
      }
    } catch { /* fall through to regenerate */ }
  }

  const catalog = await generateBlockCatalog({ summarizeEmailBase });
  await mkdir(paths.data, { recursive: true });
  await writeFile(paths.blockCatalog, `${JSON.stringify(catalog, null, 2)}\n`);
  return catalog;
}

// ─── Outline builder (used when building AI context for a specific mail) ──────

export function createOutlineSectionFromCatalogItem(item, index, assets = []) {
  const imageAsset = item.traits?.hasImage ? assets[Math.min(index, Math.max(assets.length - 1, 0))] : null;
  const itemCount = Math.min(Math.max(item.traits?.minItems || 0, 0), 5);
  return {
    kind: cleanText(item.sectionKind) || "text",
    eyebrow: "email-base catalog block",
    title: item.label,
    body: item.description,
    image_key: imageAsset?.key || "",
    cta_label: item.traits?.hasCta ? (item.traits?.ctaCount > 1 ? "CTA group" : "Primary CTA") : "",
    cta_href: "",
    items: item.traits?.itemMode === "numbered"
      ? Array.from({ length: itemCount || 3 }, (_, i) => `Step ${i + 1}`)
      : [],
    catalog_id: item.id
  };
}

export function buildCatalogOutlineForMail(catalog, category, mailId, assets = []) {
  const items = Array.isArray(catalog?.items) ? catalog.items : [];
  return items
    .filter((item) => item.sources.some((s) => s.category === category && s.mailId === mailId))
    .sort((l, r) => {
      const lo = l.sources.find((s) => s.category === category && s.mailId === mailId)?.order ?? Number.MAX_SAFE_INTEGER;
      const ro = r.sources.find((s) => s.category === category && s.mailId === mailId)?.order ?? Number.MAX_SAFE_INTEGER;
      return lo - ro || l.label.localeCompare(r.label);
    })
    .map((item, index) => createOutlineSectionFromCatalogItem(item, index, assets));
}
