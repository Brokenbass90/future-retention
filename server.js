import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { cp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";

// New modular imports
import {
  getDb,
  migrateFromJson,
  journalAppend as dbJournalAppend,
  journalList as dbJournalList,
  journalClear as dbJournalClear,
  rulesGetAll as dbRulesGetAll,
  rulesAppend as dbRulesAppend,
  rulesClear as dbRulesClear,
  lessonsGetAll as dbLessonsGetAll,
  lessonsAppend as dbLessonsAppend,
  lessonsDelete as dbLessonsDelete,
  lessonsClear as dbLessonsClear,
  assetsGetAll as dbAssetsGetAll,
  assetsUpsert as dbAssetsUpsert,
  assetsUpdate as dbAssetsUpdate,
  historyAppend as dbHistoryAppend,
  historyList as dbHistoryList,
  historyGetHtml as dbHistoryGetHtml,
  historyDelete as dbHistoryDelete,
  historyClear as dbHistoryClear,
} from "./src/db.js";

import {
  assembleEmail,
  findReferenceTemplate,
  discoverBlocksInMail,
  enrichCatalogWithPaths,
  scaffoldNewBrand,
  generateLocaleTokenMap,
} from "./src/assembler.js";
import { parseFigmaUrl, flattenFigmaLayers, fetchFigmaNodeData, inspectFigmaUrl, exportFigmaImages, browseFigmaFile, downloadImageBuffer, buildFigmaImportFromUrl } from "./src/figma.js";
import { callOpenAiWithRetry, extractResponseText } from "./src/ai-client.js";
import { responseSchema, translationResponseSchema, designAnalysisSchema } from "./src/ai-schemas.js";
import { getFigmaIntegrationContract } from "./src/figma-contract.js";
import { readEvalBenchmarkSnapshot, summarizeEvalBenchmark, findEvalBenchmarkCase, scoreEvalCase } from "./src/eval.js";
import { buildDesignDecomposition, summarizeDesignDecomposition } from "./src/design-decomposition.js";
import { buildDesignMappingHints, summarizeDesignMappingHints } from "./src/design-mapping.js";
import { buildDesignBlockRecommendations, summarizeDesignBlockRecommendations } from "./src/block-ranking.js";
import {
  registerCatalogItem,
  extractCatalogItemsFromTemplate,
  generateBlockCatalog as _generateBlockCatalog,
  summarizeBlockCatalog,
  ensureBlockCatalog as _ensureBlockCatalog,
  createOutlineSectionFromCatalogItem,
  buildCatalogOutlineForMail as _buildCatalogOutlineForMail
} from "./src/catalog.js";
import { cleanText, dedupeStrings as _dedupeStrings, toRelativePath as _toRelativePath, dedupeCatalogSources as _dedupeCatalogSources, mergeCatalogTraits as _mergeCatalogTraits } from "./src/utils.js";
import { enqueueJob, getJob, listJobs, cancelJob, clearJobs, getQueueStats, startWorker } from "./src/batch.js";
import { resolveOpenAiModelForTask, summarizeOpenAiModelRouting } from "./src/model-routing.js";
import { buildInternalDesignSchema, summarizeDesignSchema } from "./src/design-schema.js";
import { scaffoldMail } from "./tools/scaffold-system-mail.js";
import { patchTheme, saveTheme, readTheme, listThemes, normalizeTheme } from "./tools/theme-patcher.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envFilePath = path.join(__dirname, ".env");
const envRuntime = loadEnvFile(envFilePath);
const publicDir = path.join(__dirname, "public");
const emailBaseRoot = path.join(__dirname, "email-base");
const studioDataDir = path.join(__dirname, "data");
const blockCatalogPath = path.join(studioDataDir, "block-catalog.json");
const assetStorageDir = path.join(studioDataDir, "assets");
const assetRegistryPath = path.join(studioDataDir, "asset-registry.json");
const studioJournalPath = path.join(studioDataDir, "studio-journal.json");
const projectRulesPath = path.join(studioDataDir, "project-rules.json");
const templateFamilyProfilesPath = path.join(studioDataDir, "template-family-profiles.json");
const mailStructureProfilesPath = path.join(studioDataDir, "mail-structure-profiles.json");
const aiLessonsPath = path.join(studioDataDir, "ai-lessons.json");
const evalBenchmarkPath = path.join(studioDataDir, "eval-benchmarks.json");

const port = Number(process.env.PORT || 3000);
const openAiApiKey = process.env.OPENAI_API_KEY || "";
const openAiModel = process.env.OPENAI_MODEL || "gpt-4.1-mini";
const deepLApiKey = process.env.DEEPL_API_KEY || "";
const deepLApiUrl = process.env.DEEPL_API_URL || "https://api-free.deepl.com";
const figmaApiToken = process.env.FIGMA_API_TOKEN || "";
const figmaImportSecret = process.env.FIGMA_IMPORT_SECRET || "";
const categoryIgnoreList = new Set(["vendor", "docs", "dist", "tools", "node_modules", "_legacy"]);
const localeDirPattern = /^[A-Za-z]{2}([_-][A-Za-z]{2})?$/;
const templateSourceExtensions = [".pug", ".jade"];
const clientProfiles = [
  {
    id: "standard",
    label: "Standard preview",
    description: "Базовый browser preview без симуляции клиента."
  },
  {
    id: "gmail-web",
    label: "Gmail Web",
    description: "Heuristic profile для Gmail webmail и базовых ограничений."
  },
  {
    id: "outlook-desktop",
    label: "Outlook Desktop",
    description: "Heuristic profile под Word-based Outlook rendering."
  },
  {
    id: "apple-mail",
    label: "Apple Mail",
    description: "Более permissive профиль с высоким уровнем поддержки CSS."
  },
  {
    id: "yahoo-mail",
    label: "Yahoo Mail",
    description: "Heuristic профиль для консервативной webmail среды."
  }
];

const templateSelectionStopwords = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "in", "is", "it", "of", "on", "or", "that", "the", "this", "to", "with",
  "email", "mail", "template", "campaign", "design", "reference", "layout", "block",
  "и", "в", "во", "не", "что", "он", "на", "я", "с", "со", "как", "а", "то", "все", "она", "так", "его", "но", "да", "ты", "к", "у", "же",
  "вы", "за", "бы", "по", "только", "ее", "мне", "было", "вот", "от", "меня", "еще", "нет", "о", "из", "ему", "теперь", "когда", "даже",
  "ну", "ли", "если", "уже", "или", "ни", "быть", "был", "него", "до", "вас", "нибудь", "опять", "уж", "вам", "ведь", "там", "потом",
  "себя", "ничего", "ей", "может", "они", "тут", "где", "есть", "надо", "нужно", "сделай", "собери", "письмо", "макет"
]);

const templateSelectionAliases = {
  verification: ["verify", "verified", "verification", "passbook", "document", "documents", "docs", "kyc", "proof", "bank", "statement", "reason_text", "вериф", "провер", "документ", "пасбук", "банк"],
  verify: ["verification", "verified", "passbook", "document", "docs", "kyc", "вериф", "провер"],
  passbook: ["verification", "verify", "bank", "statement", "docs", "document", "пасбук", "банк"],
  document: ["documents", "docs", "verification", "kyc", "proof", "документ", "вериф"],
  docs: ["document", "documents", "verification", "kyc", "proof", "документ", "вериф"],
  password: ["reset", "login", "signin", "sign", "account", "credentials", "парол", "сброс", "логин", "аккаунт"],
  reset: ["password", "login", "account", "парол", "сброс"],
  login: ["password", "reset", "signin", "account", "логин", "парол"],
  signin: ["sign", "login", "password", "account"],
  activation: ["activate", "activated", "confirm", "confirmation", "verify", "welcome", "регистра", "подтверд"],
  activate: ["activation", "confirm", "confirmation", "welcome", "verify"],
  welcome: ["onboarding", "registration", "activate", "activation", "signup"],
  onboarding: ["welcome", "registration", "activate", "activation", "signup"],
  registration: ["signup", "welcome", "activation", "activate", "регистра"],
  affiliate: ["aff", "partner", "ib", "affiliate", "partner", "афф", "партнер"],
  aff: ["affiliate", "partner", "ib", "афф", "партнер"],
  ib: ["affiliate", "partner", "aff"],
  ticket: ["support", "reply", "answer", "тикет", "саппорт", "ответ"],
  reply: ["ticket", "support", "answer", "ответ"],
  payment: ["payout", "withdrawal", "wallet", "deposit", "pay", "оплат", "выплат", "кошелек"],
  payout: ["payment", "withdrawal", "wallet"],
  withdrawal: ["payment", "payout", "wallet"],
  reminder: ["followup", "follow", "verify", "напомин"],
  termination: ["terminate", "blacklisted", "restricted", "fraud", "blocked", "ban", "блок", "restricted"],
  contest: ["promo", "competition", "tournament", "конкурс"],
  newsletter: ["promo", "digest", "news", "рассылка"],
  promo: ["newsletter", "contest", "campaign"],
  selfie: ["verification", "kyc", "document", "proof"],
  ewallet: ["payment", "wallet", "verification"],
  pix: ["payment", "verification", "wallet"],
  nequi: ["payment", "verification", "wallet"]
};

// Clone-edit mode: completely separate system prompt — no catalog, pure HTML editing
const cloneEditSystemPrompt = [
  "You are an HTML email editor. Your ONLY job is to edit an existing HTML email.",
  "The user will give you an HTML email and tell you what to change.",
  "You MUST return the complete modified HTML document in mail.modified_html.",
  "NEVER use the email-base block catalog. NEVER generate mail.sections[] entries. Set mail.sections to [].",
  "NEVER output ${{ token }}$ placeholders — write real translated text directly in the HTML.",
  "Preserve all table layouts, inline CSS, image URLs, and template variables like {%brand_color%} and {{embedded.*}}.",
  "Only change content the user explicitly asks to change (text, links, subject, images, branding).",
  "If the user asks to translate the email, translate all visible copy but preserve structure, links, placeholders, and image URLs unless the user asks otherwise.",
  "If the user asks to adapt the email to another brand, preserve structure first and only update logo, brand-facing copy, obvious color tokens, and brand references that the user requested.",
  "If the user asks to simplify or modernize copy, keep the same structure unless they explicitly ask for layout changes.",
  "Update mail.subject and mail.preheader with the new values.",
  "Keep the HTML valid and complete — the full <html>...</html> document, not a snippet.",
  "Write assistant_reply in the user's language (Russian if the user writes in Russian). Max 2 sentences.",
].join(" ");

const systemPrompt = [
  "You are the assembly brain for an email production studio.",
  "Your job is to turn a marketer brief, design references, translations, and image links into a precise email draft based on the studio's real email-base templates.",

  // Core mission
  "The studio builds both marketing and transactional/system emails at scale for multiple brands.",
  "Each brand lives in its own category folder (e.g. X_IQ, X_IQBroker, X_Exnova, X_System).",
  "New brands may be added at any time — do not assume a fixed list of brands.",

  // Template structure knowledge
  "Emails are built from Pug/Jade templates with Stylus styles.",
  "Each email has: index.pug (main layout), blocks/ (content blocks like header.pug), helpers/ (footer, preheader, head), vendor/helpers (shared mixins, global head).",
  "All styles use Stylus with variables in helpers/variables.styl — colors, fonts, spacing differ per brand.",

  // Translation tokens — CRITICAL knowledge
  "Translation copy is stored as tokens in the format: ${{ namespace.key_name }}$",
  "The namespace is the mail ID without the 'mail-' prefix (e.g. mail-welcome → welcome-broker, mail-rfm-311 → rfm-311).",
  "Example token: ${{ welcome-broker.block_01 }}$ — this is a heading in the welcome email for IQBroker.",
  "When you reference existing templates, always use these real token patterns, not invented placeholder text.",
  "When creating a new email, propose token keys in the same format: ${{ new-mail-id.block_01 }}$",

  // Block assembly rules
  "When assembling a new email, think in blocks: which canonical blocks from the catalog fit the design?",
  "Canonical blocks include: header-logo-row, hero-image-block, plain-copy-text-card, single-button-cta-card, store-badges-row, legal-unsubscribe-footer.",
  "A typical email structure: header-logo-row → [hero or content blocks] → single-button-cta-card → store-badges-row → legal-unsubscribe-footer.",
  "Prefer existing block combinations from the catalog. Do not invent completely new layouts when a reusable block exists.",

  // Design input rules
  "When a current draft or current email-base mail exists, preserve that structure before inventing a new one.",
  "When a design reference is attached, align the section ordering and image use to that reference as closely as possible.",
  "Treat a Figma link as a normal design input. If the frame's JSON structure is provided, use layer names and text content directly.",
  "If access to Figma frame is unclear, ask for an open draft/share link or a screenshot/export. Do not invent a layout.",
  "If the user says to leave copy empty for now, accept that — leave strings empty and keep moving.",

  // Response rules
  "Do not ask the marketer for raw JSON or technical payloads unless the workflow is explicitly advanced/internal.",
  "Prefer these section kinds only: hero, text, feature-list, image, cta, footer.",
  "Use empty strings or empty arrays for fields that do not apply.",
  "Do not mention implementation limits or that you are an AI assistant.",
  "Keep the assistant reply short, direct, and useful to an email marketer — max 3-4 sentences.",
  "Write assistant_reply in the user's language. If the latest user message is in Russian, answer in Russian.",

  // Brand theme extraction from design screenshot
  "When a design screenshot or design reference is provided, extract the brand visual style into mail.brand_theme.",
  "Extract: primaryColor (button background hex), primaryTextColor (button label hex), buttonRadius (e.g. '12px'), contentRadius (card corners e.g. '8px'), textColor (body text hex), headingColor (h1 hex), linkColor (inline link hex), bgColor (outer email bg hex), borderColor (card border hex), logoUrl (logo https:// URL).",
  "If a value is not clearly visible in the design, return empty string '' for that field.",
  "ALWAYS output mail.brand_theme — set all fields to '' when no design is provided.",
  "buttonRadius and contentRadius MUST be in 'px' format or '' — never use 'em' or named values.",
  "Colors MUST be hex (e.g. '#BDFF00') or '' — never use CSS color names.",

  // Scaffold mode — creating new system emails from templates
  "When the context includes '=== SCAFFOLD MODE ===' the user is creating a brand-new system email from a cloned template.",
  "In scaffold mode you are given: the new mail ID, the token namespace, and a list of token keys (block_00, block_01, ...).",
  "Your job is to write the copy for each token key and return it in mail.locale_entries as an array of { key, value } pairs.",
  "Example: [{ key: 'block_00', value: 'Reset your password' }, { key: 'block_01', value: 'Click the button below...' }]",
  "Each value should be the actual email copy for that block — concise, on-brand, transactional tone.",
  "Always fill locale_entries with ALL token keys provided. Do not skip any key.",
  "Outside scaffold mode, leave mail.locale_entries as an empty array [].",

  // Learning from mistakes
  "Pay close attention to 'AI lessons learned' in the context — these are corrections from the team. Never repeat a corrected mistake.",
  "If a lesson says a certain block pattern is wrong, avoid that pattern. If a lesson gives a preferred phrasing, use it."
].join(" ");

// responseSchema, translationResponseSchema, designAnalysisSchema → imported from src/ai-schemas.js

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".jpg": "image/jpeg",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp"
};

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) {
    return {
      loaded: false,
      filePath,
      keys: []
    };
  }

  try {
    const source = readFileSync(filePath, "utf8");
    const keys = [];

    for (const line of source.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }

      const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!match) {
        continue;
      }

      const key = match[1];
      let value = match[2] || "";

      if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }

      value = value.replace(/\\n/g, "\n");
      if (!process.env[key]) {
        process.env[key] = value;
      }
      keys.push(key);
    }

    return {
      loaded: true,
      filePath,
      keys
    };
  } catch {
    return {
      loaded: false,
      filePath,
      keys: []
    };
  }
}

function listDirectoryNames(rootPath, matcher = () => true) {
  if (!existsSync(rootPath)) {
    return [];
  }

  return readdirSync(rootPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && matcher(entry.name))
    .map((entry) => entry.name)
    .sort();
}

function listFilesRecursive(rootPath, matcher = () => true) {
  if (!existsSync(rootPath)) {
    return [];
  }

  const files = [];
  const visit = (currentPath) => {
    const entries = readdirSync(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        visit(entryPath);
        continue;
      }

      if (matcher(entryPath, entry.name)) {
        files.push(entryPath);
      }
    }
  };

  visit(rootPath);
  return files.sort();
}

function isTemplateSourceFile(filePath) {
  return templateSourceExtensions.includes(path.extname(filePath).toLowerCase());
}

function resolveMailTemplateIndexPath(mailTemplatesRoot) {
  for (const extension of templateSourceExtensions) {
    const filePath = path.join(mailTemplatesRoot, `index${extension}`);
    if (existsSync(filePath)) {
      return filePath;
    }
  }

  return "";
}

async function withPreferredTemplateSource(mailTemplatesRoot, runner) {
  const pugPath = path.join(mailTemplatesRoot, "index.pug");
  const jadePath = path.join(mailTemplatesRoot, "index.jade");
  const hasPug = existsSync(pugPath);
  const hasJade = existsSync(jadePath);

  if (!(hasPug && hasJade)) {
    return runner();
  }

  const parkedJadePath = path.join(mailTemplatesRoot, "index.jade.studio-disabled");
  await rename(jadePath, parkedJadePath);

  try {
    return await runner();
  } finally {
    if (existsSync(parkedJadePath)) {
      await rename(parkedJadePath, jadePath);
    }
  }
}

function listMailTemplateSourceFiles(mailTemplatesRoot) {
  const indexPath = resolveMailTemplateIndexPath(mailTemplatesRoot);
  const blockFiles = listFilesRecursive(
    path.join(mailTemplatesRoot, "blocks"),
    (filePath) => isTemplateSourceFile(filePath)
  );
  const helperFiles = listFilesRecursive(
    path.join(mailTemplatesRoot, "helpers"),
    (filePath) => isTemplateSourceFile(filePath)
  );

  return [indexPath, ...blockFiles, ...helperFiles].filter(Boolean);
}

function toStudioRelative(filePath) {
  return path.relative(__dirname, filePath).split(path.sep).join("/");
}

function dedupeStrings(values) {
  return Array.from(new Set((values || []).map((value) => cleanText(value)).filter(Boolean))).sort();
}

// dedupeCatalogSources, mergeCatalogTraits, registerCatalogItem,
// extractCatalogItemsFromTemplate, generateBlockCatalog, etc. → src/catalog.js
const dedupeCatalogSources = _dedupeCatalogSources;
const mergeCatalogTraits = _mergeCatalogTraits;

// registerCatalogItem, getEvidenceOrder, createCatalogSource,
// createCatalogItem, extractCatalogItemsFromTemplate → src/catalog.js


// generateBlockCatalog, summarizeBlockCatalog, ensureBlockCatalog → src/catalog.js
async function generateBlockCatalog() {
  return _generateBlockCatalog({ summarizeEmailBase });
}
async function ensureBlockCatalog(options = {}) {
  return _ensureBlockCatalog({ force: Boolean(options?.force), summarizeEmailBase });
}

function inferMailFamilyKey(mailId = "") {
  const normalized = cleanText(mailId).replace(/^mail-/, "").toLowerCase();
  if (!normalized) {
    return "";
  }

  if (/^rfm-\d{3}$/i.test(normalized)) {
    return "rfm";
  }

  const parts = normalized.split("-").filter(Boolean);
  if (parts.length >= 4) {
    return parts.slice(0, 3).join("-");
  }
  if (parts.length >= 2) {
    return parts.slice(0, 2).join("-");
  }
  return normalized;
}

function extractVisibleMailVariant(mailId = "") {
  const rfmMatch = cleanText(mailId).match(/^rfm-(\d)(\d)(\d)$/i);
  if (rfmMatch) {
    return `${rfmMatch[1]}-${rfmMatch[2]}-${rfmMatch[3]}`;
  }
  return "";
}

function parseTemplateHelperMixinsFromContent(content) {
  const mixins = [];
  if (/\+cta-two-column-table\(/.test(content)) {
    mixins.push("cta-two-column-table");
  }
  if (/\+cta-switch-table\(/.test(content)) {
    mixins.push("cta-switch-table");
  }
  if (/\+vml-bg-fixed\(/.test(content)) {
    mixins.push("vml-bg-fixed");
  }
  if (/\+vml-bg\(/.test(content)) {
    mixins.push("vml-bg");
  }
  return dedupeStrings(mixins);
}

function inferTemplateColumnCount(content) {
  const normalized = cleanText(content);
  if (!normalized) {
    return 1;
  }

  if (/four-up|four-columns?|w-25\b/i.test(normalized)) {
    return 4;
  }

  if (/three-colums|three-columns?|three-up|w-33\b|text-promo/i.test(normalized)) {
    return 3;
  }

  if (/\+cta-two-column-table\(|two-columns?|two-up|50%/i.test(normalized)) {
    return 2;
  }

  return 1;
}

function inferMailLayoutTraits(content, metrics = {}, helperMixins = [], sectionKinds = []) {
  const traits = [];
  const columnCount = Number(metrics.columnCount) || 1;
  const ctaSectionCount = Array.isArray(sectionKinds)
    ? sectionKinds.filter((kind) => cleanText(kind) === "cta").length
    : 0;

  if (columnCount > 1) {
    traits.push(`${columnCount}-column`);
  } else {
    traits.push("single-column");
  }

  if (metrics.hasLogo) traits.push("logo-row");
  if (metrics.hasStoreBadges) traits.push("store-badges");
  if (metrics.hasSocialRow) traits.push("social-row");
  if (metrics.hasLegalFooter) traits.push("legal-footer");
  if (metrics.hasBackgroundImage) traits.push("background-image");
  if (metrics.hasDarkBackground) traits.push("dark-background");
  if (metrics.hasCalloutBox) traits.push("callout-box");
  if (metrics.hasFramedCard) traits.push("framed-card");
  if (ctaSectionCount === 1 || (ctaSectionCount === 0 && metrics.ctaButtonCount === 1)) traits.push("single-cta");
  if (ctaSectionCount > 1 || (ctaSectionCount === 0 && metrics.ctaButtonCount > 1)) traits.push("multi-cta");
  if (metrics.numberedCount > 0) traits.push("numbered-content");
  if (metrics.bulletCount > 0) traits.push("bullet-list");

  if (Array.isArray(helperMixins) && helperMixins.includes("vml-bg")) {
    traits.push("vml-background");
  }
  if (Array.isArray(helperMixins) && helperMixins.includes("vml-bg-fixed")) {
    traits.push("vml-background-fixed");
  }
  if (Array.isArray(helperMixins) && helperMixins.includes("cta-two-column-table")) {
    traits.push("two-column-cta");
  }
  if (Array.isArray(helperMixins) && helperMixins.includes("cta-switch-table")) {
    traits.push("switch-cta");
  }

  return dedupeStrings(traits);
}

function inferMailFooterFamily(content, metrics = {}, category = "") {
  const normalized = cleanText(content).toLowerCase();
  const normalizedCategory = cleanText(category);

  if (metrics.hasStoreBadges && metrics.hasSocialRow && metrics.hasLegalFooter) {
    return "store-social-legal-footer";
  }

  if (metrics.hasSocialRow && metrics.hasLegalFooter) {
    if (normalized.includes("affstore")) {
      return "affstore-legal-footer";
    }
    if (normalized.includes("casatrade")) {
      return "casatrade-legal-footer";
    }
    if (normalized.includes("exnova")) {
      return "exnova-legal-footer";
    }
    return normalizedCategory === "X_new" || normalizedCategory === "X_AffSystem"
      ? "affiliate-social-legal-footer"
      : "social-legal-footer";
  }

  if (metrics.hasLegalFooter) {
    return "legal-footer";
  }

  return "";
}

function inferMailStyleFamily(category = "", familyKey = "", sectionKinds = [], metrics = {}, layoutTraits = []) {
  const normalizedCategory = cleanText(category);
  const normalizedFamilyKey = cleanText(familyKey);
  const kinds = Array.isArray(sectionKinds) ? sectionKinds.map(cleanText).filter(Boolean) : [];
  const traits = new Set(Array.isArray(layoutTraits) ? layoutTraits.map(cleanText).filter(Boolean) : []);

  if (normalizedCategory === "X_new" && traits.has("single-column") && traits.has("framed-card") && traits.has("legal-footer")) {
    return "x-new-simple-system-card";
  }

  if (normalizedCategory === "X_AffSystem" && traits.has("single-column") && traits.has("single-cta")) {
    return "affiliate-system-card";
  }

  if (normalizedFamilyKey === "rfm" || kinds.includes("feature-list") && kinds.includes("hero") && kinds.includes("footer")) {
    return "promo-rfm-layout";
  }

  if (traits.has("background-image") || traits.has("dark-background")) {
    return "hero-promo-layout";
  }

  if (traits.has("single-column") && traits.has("single-cta") && kinds.includes("footer")) {
    return "simple-transactional-layout";
  }

  return "";
}

function buildMailStructureMetrics(content) {
  const columnCount = inferTemplateColumnCount(content);
  return {
    hasLogo: /img\.logo\b/i.test(content),
    hasStoreBadges: /img\.a-app\b|img\.a-google\b|apps\.apple\.com|play\.google\.com/i.test(content),
    hasSocialRow: /\.social-links\b|\.socials\b|img\.soc\b|soc-icon\b/i.test(content),
    hasLegalFooter: /footer-text|unsubscribe|\[unsubscribe\]|terms and conditions|helpers\/footer/i.test(content),
    hasBackgroundImage: /\.bg-head\b|\.bgr(?:-image)?\b|background:\s*url\(|img\.banner\b/i.test(content),
    hasDarkBackground: /\.dark-bg\b|background:\s*#(?:0[0-9a-f]{5}|1[0-9a-f]{5}|2[0-9a-f]{5}|3[0-9a-f]{5})\b/i.test(content),
    hasCalloutBox: /\.purple-block\b|\.ramka\b|border-left:\s*\d+px\s+solid\b/i.test(content),
    hasFramedCard: /\.brad-top\b|\.brad-bot\b|border-radius\s*:?\s*[3456789]\d?px\b/i.test(content),
    columnCount,
    ctaButtonCount: (content.match(/table\.medium-button(?:-bot)?\.radius|\.button-wrapper\b|a\.butt-link\b|a\.butt\b/gi) || []).length,
    numberedCount: (content.match(/p\.number\b/gi) || []).length,
    bulletCount: (content.match(/p\.text\.list-item\b|<li\b|^\s*li[\s.(]/gim) || []).length,
    imageCount: (content.match(/\bimg\./g) || []).length
  };
}

function normalizeMailStructureProfileEntry(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  return {
    category: cleanText(entry.category),
    mailId: cleanText(entry.mailId),
    folder: cleanText(entry.folder),
    familyKey: cleanText(entry.familyKey),
    visibleVariant: cleanText(entry.visibleVariant),
    structureSignature: cleanText(entry.structureSignature),
    sectionKinds: Array.isArray(entry.sectionKinds) ? entry.sectionKinds.map(cleanText).filter(Boolean) : [],
    helperMixins: Array.isArray(entry.helperMixins) ? entry.helperMixins.map(cleanText).filter(Boolean) : [],
    blockIds: Array.isArray(entry.blockIds) ? entry.blockIds.map(cleanText).filter(Boolean) : [],
    layoutTraits: Array.isArray(entry.layoutTraits) ? entry.layoutTraits.map(cleanText).filter(Boolean) : [],
    footerFamily: cleanText(entry.footerFamily),
    styleFamily: cleanText(entry.styleFamily),
    metrics: entry.metrics && typeof entry.metrics === "object"
      ? {
          hasLogo: Boolean(entry.metrics.hasLogo),
          hasStoreBadges: Boolean(entry.metrics.hasStoreBadges),
          hasSocialRow: Boolean(entry.metrics.hasSocialRow),
          hasLegalFooter: Boolean(entry.metrics.hasLegalFooter),
          hasBackgroundImage: Boolean(entry.metrics.hasBackgroundImage),
          hasDarkBackground: Boolean(entry.metrics.hasDarkBackground),
          hasCalloutBox: Boolean(entry.metrics.hasCalloutBox),
          hasFramedCard: Boolean(entry.metrics.hasFramedCard),
          columnCount: Number(entry.metrics.columnCount) || 1,
          ctaButtonCount: Number(entry.metrics.ctaButtonCount) || 0,
          numberedCount: Number(entry.metrics.numberedCount) || 0,
          bulletCount: Number(entry.metrics.bulletCount) || 0,
          imageCount: Number(entry.metrics.imageCount) || 0
        }
      : {
          hasLogo: false,
          hasStoreBadges: false,
          hasSocialRow: false,
          hasLegalFooter: false,
          hasBackgroundImage: false,
          hasDarkBackground: false,
          hasCalloutBox: false,
          hasFramedCard: false,
          columnCount: 1,
          ctaButtonCount: 0,
          numberedCount: 0,
          bulletCount: 0,
          imageCount: 0
        }
  };
}

function summarizeMailStructureProfiles(profiles) {
  const items = Array.isArray(profiles?.items) ? profiles.items : [];
  return {
    itemCount: items.length,
    updatedAt: cleanText(profiles?.updatedAt),
    familyCount: dedupeStrings(items.map((item) => item.familyKey)).length,
    path: toStudioRelative(mailStructureProfilesPath)
  };
}

function readMailStructureProfilesSnapshot() {
  if (!existsSync(mailStructureProfilesPath)) {
    return {
      updatedAt: "",
      items: []
    };
  }

  try {
    const raw = readFileSync(mailStructureProfilesPath, "utf8");
    const parsed = JSON.parse(raw);
    return {
      updatedAt: cleanText(parsed?.updatedAt),
      items: Array.isArray(parsed?.items) ? parsed.items.map(normalizeMailStructureProfileEntry).filter((item) => item?.mailId) : []
    };
  } catch {
    return {
      updatedAt: "",
      items: []
    };
  }
}

function findMailStructureProfile(profiles, category, mailId) {
  const items = Array.isArray(profiles?.items) ? profiles.items : [];
  return items.find((item) => cleanText(item.category) === cleanText(category) && cleanText(item.mailId) === cleanText(mailId)) || null;
}

async function generateMailStructureProfiles() {
  const emailBase = summarizeEmailBase();
  const blockCatalog = await ensureBlockCatalog();
  const items = [];

  for (const category of emailBase.categories || []) {
    for (const mail of category.mails || []) {
      const mailRoot = path.join(emailBaseRoot, category.name, mail.folder, "app", "templates");
      const templateFiles = listMailTemplateSourceFiles(mailRoot);
      const content = templateFiles
        .filter(Boolean)
        .map((filePath) => {
          try {
            return readFileSync(filePath, "utf8");
          } catch {
            return "";
          }
        })
        .join("\n\n");
      const helperMixins = parseTemplateHelperMixinsFromContent(content);
      const metrics = buildMailStructureMetrics(content);
      const outline = buildCatalogOutlineForMail(blockCatalog, category.name, mail.id);
      const sectionKinds = outline.map((section) => cleanText(section.kind)).filter(Boolean);
      const layoutTraits = inferMailLayoutTraits(content, metrics, helperMixins, sectionKinds);
      const orderedOutlineBlockIds = outline.map((section) => cleanText(section.catalog_id)).filter(Boolean);
      const orderedCatalogBlockIds = Array.isArray(blockCatalog?.items)
        ? blockCatalog.items
          .filter((item) => item.sources.some((source) => source.category === category.name && source.mailId === mail.id))
          .sort((left, right) => {
            const leftOrder = left.sources.find((source) => source.category === category.name && source.mailId === mail.id)?.order ?? Number.MAX_SAFE_INTEGER;
            const rightOrder = right.sources.find((source) => source.category === category.name && source.mailId === mail.id)?.order ?? Number.MAX_SAFE_INTEGER;
            return leftOrder - rightOrder || cleanText(left.id).localeCompare(cleanText(right.id));
          })
          .map((item) => cleanText(item.id))
          .filter(Boolean)
        : [];
      const blockIds = [];

      for (const blockId of [...orderedOutlineBlockIds, ...orderedCatalogBlockIds]) {
        if (blockId && !blockIds.includes(blockId)) {
          blockIds.push(blockId);
        }
      }

      items.push({
        category: category.name,
        mailId: mail.id,
        folder: mail.folder,
        familyKey: inferMailFamilyKey(mail.id),
        visibleVariant: extractVisibleMailVariant(mail.id),
        structureSignature: sectionKinds.join(">"),
        sectionKinds,
        helperMixins,
        blockIds,
        layoutTraits,
        footerFamily: inferMailFooterFamily(content, metrics, category.name),
        styleFamily: inferMailStyleFamily(category.name, inferMailFamilyKey(mail.id), sectionKinds, metrics, layoutTraits),
        metrics
      });
    }
  }

  return {
    updatedAt: new Date().toISOString(),
    items: items
      .map(normalizeMailStructureProfileEntry)
      .filter((item) => item?.mailId)
      .sort((left, right) => `${left.category}/${left.mailId}`.localeCompare(`${right.category}/${right.mailId}`))
  };
}

async function ensureMailStructureProfiles(options = {}) {
  const force = Boolean(options.force);

  if (!force && existsSync(mailStructureProfilesPath)) {
    const snapshot = readMailStructureProfilesSnapshot();
    if (Array.isArray(snapshot.items) && snapshot.items.length > 0) {
      return snapshot;
    }
  }

  const profiles = await generateMailStructureProfiles();
  await mkdir(studioDataDir, { recursive: true });
  await writeFile(mailStructureProfilesPath, `${JSON.stringify(profiles, null, 2)}\n`);
  return profiles;
}

function decodeDataUrl(dataUrl) {
  const match = String(dataUrl).match(/^data:([^;]+);base64,(.+)$/);
  if (!match) {
    throw new Error("Unsupported upload payload. Expected base64 data URL.");
  }

  return {
    mimeType: cleanText(match[1]) || "application/octet-stream",
    buffer: Buffer.from(match[2], "base64")
  };
}

function getExtensionForAssetUpload(mimeType, fileName = "") {
  const byMime = {
    "image/gif": ".gif",
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/svg+xml": ".svg",
    "image/webp": ".webp"
  };

  if (byMime[mimeType]) {
    return byMime[mimeType];
  }

  const fromName = path.extname(cleanText(fileName)).toLowerCase();
  return fromName || ".bin";
}

function getSafeUploadStem(fileName, fallback = "asset") {
  const rawStem = cleanText(fileName)
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return rawStem || fallback;
}

function getStoredAssetUrl(fileName) {
  return `/studio-assets/${encodeURIComponent(fileName)}`;
}

function normalizeAssetRegistryEntry(entry) {
  const fileName = cleanText(entry?.fileName);
  return {
    id: cleanText(entry?.id),
    kind: cleanText(entry?.kind) || "asset",
    label: cleanText(entry?.label) || fileName || "asset",
    fileName,
    localUrl: fileName ? getStoredAssetUrl(fileName) : "",
    externalUrl: cleanText(entry?.externalUrl),
    preferredUrl: cleanText(entry?.externalUrl) || (fileName ? getStoredAssetUrl(fileName) : ""),
    alt: cleanText(entry?.alt),
    notes: cleanText(entry?.notes),
    placement: cleanText(entry?.placement) || "auto",
    key: cleanText(entry?.key),
    mimeType: cleanText(entry?.mimeType),
    size: Number(entry?.size) || 0,
    createdAt: cleanText(entry?.createdAt),
    updatedAt: cleanText(entry?.updatedAt)
  };
}

function summarizeAssetRegistry(registry) {
  const items = Array.isArray(registry?.items) ? registry.items : [];
  return {
    itemCount: items.length,
    designCount: items.filter((item) => item.kind === "design").length,
    imageCount: items.filter((item) => item.kind !== "design").length,
    withExternalUrlCount: items.filter((item) => cleanText(item.externalUrl)).length,
    generatedAt: cleanText(registry?.updatedAt || registry?.generatedAt),
    path: toStudioRelative(assetRegistryPath)
  };
}

function summarizeStudioJournal(journal) {
  const entries = Array.isArray(journal?.entries) ? journal.entries : [];
  return {
    entryCount: entries.length,
    errorCount: entries.filter((entry) => cleanText(entry.level) === "error").length,
    warningCount: entries.filter((entry) => cleanText(entry.level) === "warning").length,
    updatedAt: cleanText(journal?.updatedAt),
    lastEntryAt: cleanText(entries[0]?.timestamp),
    path: toStudioRelative(studioJournalPath)
  };
}

function normalizeProjectRuleEntry(entry) {
  return {
    id: cleanText(entry?.id),
    text: cleanText(entry?.text),
    source: cleanText(entry?.source) || "manual",
    createdAt: cleanText(entry?.createdAt),
    updatedAt: cleanText(entry?.updatedAt),
    active: entry?.active !== false
  };
}

function summarizeProjectRules(rules) {
  const items = Array.isArray(rules?.items) ? rules.items.map(normalizeProjectRuleEntry) : [];
  return {
    itemCount: items.length,
    activeCount: items.filter((item) => item.active).length,
    updatedAt: cleanText(rules?.updatedAt),
    path: toStudioRelative(projectRulesPath)
  };
}

function summarizeProjectRulesForContext(rules) {
  const items = Array.isArray(rules) ? rules.map(normalizeProjectRuleEntry) : [];
  const activeRules = items.filter((item) => item.active && item.text).slice(0, 12);

  if (activeRules.length === 0) {
    return "No explicit project rules saved yet.";
  }

  return activeRules.map((item, index) => `${index + 1}. ${item.text}`).join("\n");
}

function normalizeTemplateFamilyProfileEntry(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const canonicalStructure = Array.isArray(entry.canonicalStructure)
    ? entry.canonicalStructure.map(cleanText).filter((kind) => ["hero", "text", "feature-list", "image", "cta", "footer"].includes(kind))
    : [];
  const variants = Array.isArray(entry.variants)
    ? entry.variants.map((variant) => ({
        mailId: cleanText(variant?.mailId),
        visibleVariant: cleanText(variant?.visibleVariant),
        label: cleanText(variant?.label),
        notes: cleanText(variant?.notes)
      })).filter((variant) => variant.mailId)
    : [];

  return {
    id: cleanText(entry.id),
    label: cleanText(entry.label),
    category: cleanText(entry.category),
    brand: cleanText(entry.brand),
    aliases: Array.isArray(entry.aliases) ? entry.aliases.map(cleanText).filter(Boolean) : [],
    defaultMailId: cleanText(entry.defaultMailId),
    matchMailIds: Array.isArray(entry.matchMailIds) ? entry.matchMailIds.map(cleanText).filter(Boolean) : [],
    matchFamilyKeys: Array.isArray(entry.matchFamilyKeys) ? entry.matchFamilyKeys.map(cleanText).filter(Boolean) : [],
    canonicalStructure,
    blockHints: Array.isArray(entry.blockHints) ? entry.blockHints.map(cleanText).filter(Boolean) : [],
    footerFamily: cleanText(entry.footerFamily),
    layoutTraits: Array.isArray(entry.layoutTraits) ? entry.layoutTraits.map(cleanText).filter(Boolean) : [],
    localeNotes: Array.isArray(entry.localeNotes) ? entry.localeNotes.map(cleanText).filter(Boolean) : [],
    styleNotes: cleanText(entry.styleNotes),
    notes: cleanText(entry.notes),
    variants
  };
}

function readTemplateFamilyProfilesSnapshot() {
  if (!existsSync(templateFamilyProfilesPath)) {
    return {
      updatedAt: "",
      items: []
    };
  }

  try {
    const raw = readFileSync(templateFamilyProfilesPath, "utf8");
    const parsed = JSON.parse(raw);
    return {
      updatedAt: cleanText(parsed?.updatedAt),
      items: Array.isArray(parsed?.items) ? parsed.items.map(normalizeTemplateFamilyProfileEntry).filter((item) => item?.id) : []
    };
  } catch {
    return {
      updatedAt: "",
      items: []
    };
  }
}

function summarizeTemplateFamilyProfiles(profiles) {
  const items = Array.isArray(profiles?.items) ? profiles.items : [];
  const categories = dedupeStrings(items.map((item) => item.category));
  return {
    itemCount: items.length,
    updatedAt: cleanText(profiles?.updatedAt),
    categories,
    path: toStudioRelative(templateFamilyProfilesPath)
  };
}

function summarizeTemplateFamilyProfilesForContext(profiles) {
  const items = Array.isArray(profiles?.items) ? profiles.items : [];
  if (items.length === 0) {
    return "No template family profiles saved yet.";
  }

  return items
    .slice(0, 8)
    .map((item) => {
      const variants = Array.isArray(item.variants) && item.variants.length > 0
        ? item.variants.map((variant) => variant.visibleVariant || variant.mailId).filter(Boolean).join(", ")
        : "no variants";
      const structure = Array.isArray(item.canonicalStructure) && item.canonicalStructure.length > 0
        ? item.canonicalStructure.join(" > ")
        : "no structure";
      const footer = cleanText(item.footerFamily) || "default footer";
      return `${item.label} | category=${item.category} | structure=${structure} | footer=${footer} | variants=${variants}`;
    })
    .join("\n");
}

function findTemplateFamilyProfileById(profileId) {
  const profiles = readTemplateFamilyProfilesSnapshot();
  return (profiles.items || []).find((item) => cleanText(item.id) === cleanText(profileId)) || null;
}

async function readAssetRegistry() {
  try {
    const items = dbAssetsGetAll().map(normalizeAssetRegistryEntry);
    return { items, updatedAt: new Date().toISOString() };
  } catch {
    return { items: [], updatedAt: "" };
  }
}

async function writeAssetRegistry(items) {
  // DB is source of truth — upsert each item
  try {
    for (const item of (items || [])) {
      dbAssetsUpsert(item);
    }
  } catch { /* ignore */ }
  return { updatedAt: new Date().toISOString(), items };
}

// ─── DB-backed replacements for JSON file operations ─────────────────────────
// These functions maintain the same API as the old JSON-based versions
// so all existing callers continue to work unchanged.

async function readStudioJournal() {
  try {
    const entries = dbJournalList(250).map((e) => ({
      id: e.id,
      timestamp: e.createdAt,
      level: e.level,
      area: e.area,
      title: e.title,
      message: e.message,
      meta: e.meta
    }));
    return { updatedAt: entries[0]?.timestamp || "", entries };
  } catch {
    return { updatedAt: "", entries: [] };
  }
}

async function readProjectRules() {
  try {
    const items = dbRulesGetAll().map((r) => ({
      id: r.id,
      text: r.text,
      source: r.source,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      active: r.active
    }));
    return { updatedAt: new Date().toISOString(), items };
  } catch {
    return { updatedAt: "", items: [] };
  }
}

// writeStudioJournal / writeProjectRules kept for legacy callers
async function writeStudioJournal(_entries) {
  // No-op — journal is now DB-backed
  return { updatedAt: new Date().toISOString(), entries: _entries || [] };
}

async function writeProjectRules(items) {
  // Legacy bulk-write — replace with DB upserts
  try {
    dbRulesClear();
    if (Array.isArray(items)) {
      for (const item of items) {
        if (item?.text) dbRulesAppend(item.text, item.source || "manual");
      }
    }
  } catch { /* ignore */ }
  return { updatedAt: new Date().toISOString(), items: items || [] };
}

async function appendStudioJournalEntry(entry) {
  try {
    dbJournalAppend({
      level: cleanText(entry?.level) || "info",
      area: cleanText(entry?.area) || "studio",
      title: cleanText(entry?.title) || "Studio event",
      message: cleanText(entry?.message) || "",
      meta: entry?.meta && typeof entry.meta === "object" ? entry.meta : {}
    });
  } catch { /* silently ignore journal errors */ }
  return { updatedAt: new Date().toISOString(), entries: [] };
}

async function clearStudioJournal() {
  try { dbJournalClear(); } catch { /* ignore */ }
  return { updatedAt: new Date().toISOString(), entries: [] };
}

async function appendProjectRule(text, source = "manual") {
  const cleanRule = cleanText(text);
  if (!cleanRule) throw new Error("Project rule text is empty");
  try {
    dbRulesAppend(cleanRule, source);
    return await readProjectRules();
  } catch (e) {
    throw e;
  }
}

async function clearProjectRules() {
  try { dbRulesClear(); } catch { /* ignore */ }
  return { updatedAt: new Date().toISOString(), items: [] };
}

// ─────────────────────────────────────────────
// AI Lessons (memory of mistakes and corrections) — SQLite-backed
// ─────────────────────────────────────────────

async function readAiLessons() {
  try {
    const items = dbLessonsGetAll();
    return { items };
  } catch {
    return { items: [] };
  }
}

// writeAiLessons kept for backward-compat (no-op — DB handles persistence)
async function writeAiLessons(_items) { /* no-op: DB is source of truth */ }

async function appendAiLesson({ category = "general", mistake, correction, tags = [], source = "user" }) {
  const cleanMistake = cleanText(mistake);
  const cleanCorrection = cleanText(correction);
  if (!cleanMistake || !cleanCorrection) {
    throw new Error("Both mistake and correction are required for an AI lesson");
  }
  const result = dbLessonsAppend({
    category: cleanText(category) || "general",
    mistake: cleanMistake,
    correction: cleanCorrection,
    tags: Array.isArray(tags) ? tags.map(String).filter(Boolean) : [],
    source: cleanText(source) || "user"
  });
  return result;
}

async function deleteAiLesson(id) {
  try {
    return dbLessonsDelete(id);
  } catch {
    return { deleted: false };
  }
}

function buildLessonsContext(lessons) {
  const items = Array.isArray(lessons?.items) ? lessons.items : [];
  if (items.length === 0) {
    return "No lessons recorded yet.";
  }
  return items
    .slice(0, 30)
    .map((lesson, index) => {
      const tags = lesson.tags?.length ? ` [${lesson.tags.join(", ")}]` : "";
      return `Lesson ${index + 1}${tags}:\n  ❌ Was wrong: ${lesson.mistake}\n  ✅ Should be: ${lesson.correction}`;
    })
    .join("\n\n");
}

// ─────────────────────────────────────────────
// Email Base Deep Context (real template knowledge for AI)
// ─────────────────────────────────────────────

function extractTranslationTokensFromTemplate(content) {
  const tokenPattern = /\$\{\{\s*([\w.-]+)\s*\}\}\$/g;
  const tokens = new Set();
  let match;
  while ((match = tokenPattern.exec(content)) !== null) {
    tokens.add(match[1]);
  }
  return [...tokens];
}

function extractIncludesFromTemplate(content) {
  const includePattern = /include\s+([\w./\-]+)/g;
  const includes = [];
  let match;
  while ((match = includePattern.exec(content)) !== null) {
    includes.push(match[1]);
  }
  return includes;
}

function readTemplateFileSafe(filePath) {
  try {
    return readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}

function buildEmailBaseDeepContext() {
  const emailBase = summarizeEmailBase();
  if (!emailBase.available) {
    return "Email base not available.";
  }

  const lines = [];
  lines.push(`Email base root: ${emailBase.root}`);
  lines.push(`Brands (categories): ${emailBase.categories.map((c) => c.name).join(", ")}`);
  lines.push("");

  // Per-brand: list mails + sample token keys from first template found
  for (const category of emailBase.categories.slice(0, 8)) {
    const mailList = category.mails.map((m) => m.id).join(", ");
    lines.push(`Brand [${category.name}] — ${category.mails.length} emails: ${mailList}`);

    // Sample one mail's tokens to show AI the translation key format
    const sampleMail = category.mails[0];
    if (sampleMail) {
      const blockDir = path.join(emailBaseRoot, category.name, sampleMail.folder, "app", "templates", "blocks");
      const blockFiles = existsSync(blockDir)
        ? readdirSync(blockDir).filter((f) => /\.(jade|pug)$/.test(f)).map((f) => path.join(blockDir, f))
        : [];
      const indexFile = resolveMailTemplateIndexPath(
        path.join(emailBaseRoot, category.name, sampleMail.folder, "app", "templates")
      );

      const allFiles = [indexFile, ...blockFiles].filter(Boolean).slice(0, 3);
      const allTokens = [];
      const allIncludes = [];

      for (const filePath of allFiles) {
        const content = readTemplateFileSafe(filePath);
        if (content) {
          allTokens.push(...extractTranslationTokensFromTemplate(content));
          allIncludes.push(...extractIncludesFromTemplate(content));
        }
      }

      const uniqueTokens = [...new Set(allTokens)].slice(0, 6);
      const uniqueIncludes = [...new Set(allIncludes)].slice(0, 5);

      if (uniqueTokens.length > 0) {
        const tokenExamples = uniqueTokens.map((t) => "${{ " + t + " }}$").join(", ");
        lines.push(`  Sample tokens from mail-${sampleMail.id}: ${tokenExamples}`);
      }
      if (uniqueIncludes.length > 0) {
        lines.push(`  Block includes: ${uniqueIncludes.join(", ")}`);
      }
    }
  }

  // Block catalog summary
  lines.push("");
  lines.push("Available canonical blocks (use these IDs when assembling emails):");
  try {
    if (existsSync(blockCatalogPath)) {
      const catalogRaw = readFileSync(blockCatalogPath, "utf-8");
      const catalog = JSON.parse(catalogRaw);
      const items = Array.isArray(catalog?.items) ? catalog.items : [];
      for (const item of items) {
        const traitNotes = [];
        if (item.traits?.hasImage) traitNotes.push("has-image");
        if (item.traits?.hasCta) traitNotes.push(`cta×${item.traits.ctaCount}`);
        if (item.traits?.outlookSafe) traitNotes.push("outlook-safe");
        lines.push(`  • [${item.id}] ${item.label} (${item.sectionKind}) — ${traitNotes.join(", ")} — used in ${item.sources?.length || 0} templates`);
      }
    }
  } catch {
    lines.push("  (block catalog not loaded)");
  }

  lines.push("");
  lines.push("Template structure convention:");
  lines.push("  index.pug → include blocks/header → [content blocks] → include helpers/footer");
  lines.push("  Token format: ${{ mail-id-without-prefix.block_01 }}$");
  lines.push("  Stylus variables: helpers/variables.styl — override per brand (colors, fonts)");

  return lines.join("\n");
}

// ─────────────────────────────────────────────
// Figma REST API helpers
// ─────────────────────────────────────────────

// parseFigmaUrl, flattenFigmaLayers, fetchFigmaNodeData → imported from src/figma.js

// ─────────────────────────────────────────────
// End of new helpers section
// ─────────────────────────────────────────────

async function registerUploadedAssets(files) {
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error("No asset files provided");
  }

  const registry = await readAssetRegistry();
  const nextItems = [...registry.items];
  const added = [];

  await mkdir(assetStorageDir, { recursive: true });

  for (const [index, file] of files.entries()) {
    const name = cleanText(file?.name) || `upload-${Date.now()}-${index + 1}.png`;
    const kind = cleanText(file?.kind) || "asset";
    const { mimeType, buffer } = decodeDataUrl(file?.dataUrl || "");
    const extension = getExtensionForAssetUpload(mimeType, name);
    const stem = getSafeUploadStem(name, kind === "design" ? "design" : "asset");
    const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${stem}${extension}`;
    const targetPath = path.join(assetStorageDir, unique);
    await writeFile(targetPath, buffer);

    const entry = normalizeAssetRegistryEntry({
      id: `asset-${Date.now()}-${index + 1}-${Math.random().toString(36).slice(2, 7)}`,
      kind,
      label: name,
      fileName: unique,
      externalUrl: cleanText(file?.externalUrl),
      alt: cleanText(file?.alt) || getSafeUploadStem(name, "asset"),
      notes: cleanText(file?.notes),
      placement: cleanText(file?.placement) || (kind === "design" ? "reference" : "auto"),
      key: cleanText(file?.key) || getSafeUploadStem(name, "asset"),
      mimeType,
      size: buffer.byteLength,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    nextItems.unshift(entry);
    added.push(entry);
  }

  const savedRegistry = await writeAssetRegistry(nextItems);
  return {
    items: added,
    registry: {
      ...savedRegistry,
      items: savedRegistry.items.map(normalizeAssetRegistryEntry),
      summary: summarizeAssetRegistry(savedRegistry)
    }
  };
}

async function updateAssetRegistryEntry(id, patch) {
  const registry = await readAssetRegistry();
  const entryIndex = registry.items.findIndex((item) => item.id === cleanText(id));
  if (entryIndex === -1) {
    throw new Error("Asset registry entry not found");
  }

  const existing = registry.items[entryIndex];
  const next = normalizeAssetRegistryEntry({
    ...existing,
    ...patch,
    updatedAt: new Date().toISOString()
  });
  registry.items.splice(entryIndex, 1, next);
  const savedRegistry = await writeAssetRegistry(registry.items);

  return {
    item: next,
    registry: {
      ...savedRegistry,
      items: savedRegistry.items.map(normalizeAssetRegistryEntry),
      summary: summarizeAssetRegistry(savedRegistry)
    }
  };
}

async function serveStudioAsset(request, response) {
  const requestedFile = decodeURIComponent(request.url.replace(/^\/studio-assets\//, ""));
  const safeName = path.basename(requestedFile);
  const assetPath = path.join(assetStorageDir, safeName);

  if (!assetPath.startsWith(assetStorageDir) || !existsSync(assetPath)) {
    sendText(response, 404, "Not found");
    return;
  }

  const data = await readFile(assetPath);
  response.writeHead(200, {
    "Content-Type": mimeTypes[path.extname(assetPath).toLowerCase()] || "application/octet-stream",
    "Cache-Control": "no-store"
  });
  response.end(data);
}

// createOutlineSectionFromCatalogItem, buildCatalogOutlineForMail → src/catalog.js
function buildCatalogOutlineForMail(catalog, category, mailId, assets = []) {
  return _buildCatalogOutlineForMail(catalog, category, mailId, assets);
}

function getProviderCatalog() {
  const modelRouting = summarizeOpenAiModelRouting();
  return [
    {
      id: "openai",
      label: "OpenAI",
      available: Boolean(openAiApiKey),
      status: openAiApiKey
        ? `Configured: default ${modelRouting.default}, design ${modelRouting.designAnalysis}, draft ${modelRouting.draft}`
        : "Needs OPENAI_API_KEY",
      capabilities: ["chat", "vision", "structured output", "design ingest"]
    },
    {
      id: "deepl",
      label: "DeepL (translations only)",
      available: Boolean(deepLApiKey),
      status: deepLApiKey ? `Configured: ${deepLApiUrl}` : "Needs DEEPL_API_KEY",
      capabilities: ["translations"]
    },
    {
      id: "mock",
      label: "Mock",
      available: true,
      status: "Always available",
      capabilities: ["chat", "preview", "fallback"]
    },
    {
      id: "anthropic",
      label: "Anthropic",
      available: false,
      status: "Planned adapter",
      capabilities: ["chat", "analysis"]
    },
    {
      id: "gemini",
      label: "Gemini",
      available: false,
      status: "Planned adapter",
      capabilities: ["chat", "vision"]
    },
    {
      id: "local",
      label: "Local model",
      available: false,
      status: "Planned adapter",
      capabilities: ["classification", "cheap helpers"]
    }
  ];
}

function summarizeRuntimeConfig() {
  return {
    envFilePath: toStudioRelative(envFilePath),
    envFileLoaded: Boolean(envRuntime.loaded),
    envKeys: Array.isArray(envRuntime.keys) ? envRuntime.keys : [],
    openAiConfigured: Boolean(openAiApiKey),
    openAiModel,
    openAiModelRouting: summarizeOpenAiModelRouting(),
    deepLConfigured: Boolean(deepLApiKey),
    deepLApiUrl
  };
}

function summarizeFigmaIntegration() {
  const modes = ["frame-link", "screenshot-export", "plugin-push"];

  if (figmaApiToken) {
    modes.push("server-token");
  }

  return {
    enabled: true,
    modes,
    serverTokenConfigured: Boolean(figmaApiToken),
    pluginImportEnabled: true,
    pluginImportEndpoint: "/api/figma/import",
    contractEndpoint: "/api/figma/contract",
    pluginImportSecretRequired: Boolean(figmaImportSecret),
    recommendedFlow: figmaApiToken
      ? "Default flow: paste a Figma frame link or screenshot into chat. For private files, use an open draft/share link, screenshot/export, or future Send to Studio via server token/plugin."
      : "Default flow: paste a Figma frame link or screenshot into chat. For private files, use an open draft/share link or screenshot/export. Plugin push is ready as the next step.",
    notes: [
      "Managers should not prepare JSON manually.",
      "If only a Figma link is provided and access is unclear, the studio should ask for an open draft/share link or a screenshot/export.",
      "Plugin import is intended for advanced/internal automation and future one-click Figma push."
    ]
  };
}

function summarizeEvalFoundation() {
  return summarizeEvalBenchmark(readEvalBenchmarkSnapshot(evalBenchmarkPath));
}

function summarizeEmailBase() {
  if (!existsSync(emailBaseRoot)) {
    return {
      available: false,
      root: emailBaseRoot
    };
  }

  const categories = listDirectoryNames(
    emailBaseRoot,
    (name) => !name.startsWith(".") && !categoryIgnoreList.has(name)
  )
    .map((categoryName) => {
      const categoryPath = path.join(emailBaseRoot, categoryName);
      const mails = listDirectoryNames(categoryPath, (name) => name.startsWith("mail-")).map((folder) => ({
        id: folder.replace(/^mail-/, ""),
        folder
      }));

      return {
        name: categoryName,
        mails
      };
    })
    .filter((category) => category.mails.length > 0);

  const locales = listDirectoryNames(
    path.join(emailBaseRoot, "vendor", "data"),
    (name) => localeDirPattern.test(name)
  );
  const currentCategory = categories[0]?.name || "";
  const currentMail = categories[0]?.mails[0] || null;

  return {
    available: true,
    root: emailBaseRoot,
    categories,
    localeCount: locales.length,
    locales,
    currentMail: currentCategory && currentMail
      ? {
          category: currentCategory,
          mailId: currentMail.id,
          folder: `${currentCategory}/${currentMail.folder}`,
          templatePath: toStudioRelative(
            resolveMailTemplateIndexPath(path.join(emailBaseRoot, currentCategory, currentMail.folder, "app", "templates"))
          ),
          stylePath: `${currentCategory}/${currentMail.folder}/app/styles/common.styl`
        }
      : null,
    technology: [
      "Pug templates",
      "Stylus styles",
      "Table-based email layout",
      "vendor/data locales",
      "build-mail.js pipeline"
    ]
  };
}

function extractAssetRecordsFromHtml(html) {
  const assetMap = new Map();
  const srcMatches = html.matchAll(/<(?:img|source)[^>]+src="([^"]+)"/gi);
  let index = 1;

  for (const match of srcMatches) {
    const url = match[1];
    if (!url || assetMap.has(url)) {
      continue;
    }

    assetMap.set(url, {
      key: `base_asset_${index}`,
      url,
      alt: `Built asset ${index}`,
      width: 600,
      height: 300
    });
    index += 1;
  }

  return [...assetMap.values()];
}

async function runCommand(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env
    });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({
          code,
          stdout,
          stderr
        });
        return;
      }

      reject(new Error((stdout + stderr).trim() || `Command failed with exit code ${code}`));
    });
  });
}

async function buildEmailBasePreview(category, mailId, locale) {
  const summary = summarizeEmailBase();
  if (!summary.available) {
    throw new Error("email-base is not attached");
  }

  const selectedCategory = category || summary.currentMail?.category;
  const selectedMail = mailId || summary.currentMail?.mailId;
  const selectedLocale = locale || "en";

  if (!selectedCategory || !selectedMail) {
    throw new Error("No email-base mail was found");
  }

  const templatesRoot = path.join(
    emailBaseRoot,
    selectedCategory,
    `mail-${selectedMail}`,
    "app",
    "templates"
  );
  const mailRoot = path.join(emailBaseRoot, selectedCategory, `mail-${selectedMail}`);
  const stylesRoot = path.join(mailRoot, "app", "styles");
  const result = await withPreferredTemplateSource(templatesRoot, () => runCommand(
    process.execPath,
    ["mail", "build-pretty", selectedCategory, selectedMail, "--locales", selectedLocale],
    emailBaseRoot
  ));

  const distDir = path.join(emailBaseRoot, "dist", selectedCategory, `mail-${selectedMail}`, selectedLocale);
  const prettyPath = path.join(distDir, "index.pretty.html");
  const compactPath = path.join(distDir, "index.html");
  const htmlPath = existsSync(prettyPath) ? prettyPath : compactPath;
  const resolvedTemplatePath = resolveMailTemplateIndexPath(templatesRoot);
  const footerLocalePath = path.join(emailBaseRoot, "vendor", "data", selectedLocale, "footer.json");

  const html = applyLocaleDirectionToHtml(await readFile(htmlPath, "utf8"), selectedLocale);
  const templateSource = resolvedTemplatePath
    ? await readFile(resolvedTemplatePath, "utf8")
    : "No index template file found";
  const localeSource = existsSync(footerLocalePath)
    ? await readFile(footerLocalePath, "utf8")
    : JSON.stringify({ note: "No locale footer file found" }, null, 2);
  const assets = extractAssetRecordsFromHtml(html);
  const blockCatalog = await ensureBlockCatalog();
  const assetRegistry = await readAssetRegistry();
  const blockOutline = buildCatalogOutlineForMail(blockCatalog, selectedCategory, selectedMail, assets);
  const assetRecommendations = buildAssetRecommendations({ sections: blockOutline }, {
    assetInputs: [],
    assetRegistryItems: assetRegistry.items
  });
  const assetsManifest = JSON.stringify(
    Object.fromEntries(assets.map((asset) => [asset.key, asset])),
    null,
    2
  );
  const specContent = JSON.stringify(
    {
      source: "email-base",
      category: selectedCategory,
      mailId: selectedMail,
      locale: selectedLocale,
      distPath: path.relative(__dirname, htmlPath)
    },
    null,
    2
  );
  const buildLog = [result.stdout, result.stderr].filter(Boolean).join("\n").trim() || "Build completed.";
  const workspaceFiles = await collectWorkspaceFiles({
    mailRoot,
    templatesRoot,
    stylesRoot,
    previewLocales: { [selectedLocale]: html },
    localePayloads: {
      [selectedLocale]: (() => {
        try {
          return JSON.parse(localeSource);
        } catch {
          return localeSource;
        }
      })()
    },
    localeBuildLogs: { [selectedLocale]: buildLog },
    assetsManifest,
    specContent
  });
  const draftSnapshot = createDraftSnapshot({
    subject: `email-base/${selectedCategory}/mail-${selectedMail}`,
    preheader: "Built from actual email-base template",
    locale: selectedLocale,
    summary: "Real HTML built by email-base pipeline",
    sections: blockOutline,
    assets,
    translations: [
      {
        locale: selectedLocale,
        subject: `email-base/${selectedCategory}/mail-${selectedMail}`,
        preheader: "Built from actual email-base template",
        cta_labels: [],
        notes: "Preview loaded from the real build pipeline.",
        body_blocks: blockOutline.map((section) => cleanText(section.title || section.body)).filter(Boolean),
        source_name: `email-base_${selectedCategory}_mail-${selectedMail}_${selectedLocale}.txt`
      }
    ]
  }, null, {
    assetRecommendations,
    previewCategory: selectedCategory,
    workspaceFiles
  });
  draftSnapshot.html = html;
  draftSnapshot.pug = templateSource;
  draftSnapshot.stylus = getPrimaryWorkspaceFileContent(workspaceFiles, "stylus");
  draftSnapshot.locales = localeSource;
  draftSnapshot.assetsManifest = assetsManifest;
  draftSnapshot.spec = specContent;
  draftSnapshot.buildLog = buildLog;
  draftSnapshot.workspaceFiles = workspaceFiles;

  return {
    assistantReply: `Загрузил реальный build из email-base: ${selectedCategory}/mail-${selectedMail} (${selectedLocale}). Block catalog нашел ${blockOutline.length} канонических секций.`,
    mode: "email-base",
    draft: draftSnapshot
  };
}

function ensureSafeCategoryName(value) {
  const category = cleanText(value);
  if (!category || !/^[A-Za-z0-9_-]+$/.test(category)) {
    throw new Error("Invalid email-base category");
  }
  return category;
}

function resolveStudioMailId(rawMailId, campaignName) {
  const explicit = slugify(cleanText(rawMailId).replace(/^mail-/, ""));
  if (explicit && explicit !== "draft") {
    return explicit;
  }

  const fromCampaign = slugify(campaignName);
  if (fromCampaign && fromCampaign !== "draft") {
    return fromCampaign;
  }

  return `studio-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}`;
}

function getStudioTranslationFileKey(mailId) {
  return `studio-${slugify(mailId)}`;
}

function makeTranslationToken(fileKey, keyPath) {
  return `\${{ ${fileKey}.${keyPath} }}$`;
}

function formatTextForLocaleJson(value) {
  const text = cleanText(value);
  if (!text) {
    return "";
  }

  const withStrong = text.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
  return withStrong.replace(/\r?\n/g, "<br>");
}

function formatPlainLocaleText(value) {
  return cleanText(value).replace(/\*\*(.*?)\*\*/g, "$1");
}

function getMailAssetMap(mail) {
  return new Map((mail.assets || []).map((asset) => [asset.key, asset]));
}

function getSectionLocaleKey(index) {
  return `section_${String(index + 1).padStart(2, "0")}`;
}

function looksLikeResetHeadline(text) {
  const value = cleanText(text);
  if (!value) {
    return false;
  }

  if (value.length > 90 || value.split(/\s+/).length > 10) {
    return false;
  }

  return /(password|senha|парол|mot de passe|contrase|heslo|hasło|salasan|kata sandi|passwort)/i.test(value)
    || /(set|reset|new|nova|novo|defin|нов|измен|trocar)/i.test(value);
}

function looksLikeAffPasswordResetMail(mail) {
  const sections = Array.isArray(mail?.sections) ? mail.sections : [];
  if (sections.length < 4) {
    return false;
  }

  const signal = [
    cleanText(mail?.subject),
    cleanText(mail?.preheader),
    cleanText(sections[0]?.title),
    cleanText(sections[1]?.cta_label),
    cleanText(sections[2]?.body),
    cleanText(sections[3]?.body)
  ].join(" ");

  return cleanText(sections[1]?.kind) === "cta"
    && cleanText(sections.at(-1)?.kind) === "footer"
    && /(password|senha|парол|reset|set new|defin|nova senha)/i.test(signal);
}

function splitAffPasswordResetIntroAndCtaBody(text) {
  const value = cleanText(text);
  if (!value) {
    return {
      intro: "",
      cta: ""
    };
  }

  const patterns = [
    /(Please click the button below[\s\S]*)$/i,
    /(Por favor, clique no bot[aã]o abaixo[\s\S]*)$/i,
    /(Пожалуйста, нажмите на кнопку ниже[\s\S]*)$/i,
    /(Clique no bot[aã]o abaixo[\s\S]*)$/i,
    /(Click the button below[\s\S]*)$/i
  ];

  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (match?.index > 0) {
      return {
        intro: value.slice(0, match.index).trim(),
        cta: cleanText(match[1])
      };
    }
  }

  return {
    intro: value,
    cta: ""
  };
}

function isWeakAffPasswordResetCtaBody(text, ctaLabel = "") {
  const value = cleanText(text);
  const normalizedLabel = normalizeTemplateSelectionText(ctaLabel);
  return !value
    || value.length < 16
    || looksLikeResetHeadline(value)
    || (normalizedLabel && normalizeTemplateSelectionText(value) === normalizedLabel);
}

function buildBaseLocaleSectionMap(mail) {
  const sections = {};

  for (const [index, section] of mail.sections.entries()) {
    const key = getSectionLocaleKey(index);
    sections[key] = {
      eyebrow: formatTextForLocaleJson(section.eyebrow),
      title: formatTextForLocaleJson(section.title),
      body: formatTextForLocaleJson(section.body),
      cta_label: formatTextForLocaleJson(section.cta_label),
      items: Array.isArray(section.items) ? section.items.map(formatTextForLocaleJson) : []
    };
  }

  return sections;
}

function buildAffPasswordResetLocaleSectionMap(mail, translationEntry) {
  const sections = buildBaseLocaleSectionMap(mail);
  const blocks = Array.isArray(translationEntry?.body_blocks)
    ? translationEntry.body_blocks.map(cleanText).filter(Boolean)
    : [];

  if (blocks.length === 0) {
    return sections;
  }

  const introKey = getSectionLocaleKey(0);
  const ctaKey = getSectionLocaleKey(1);
  const warningKey = getSectionLocaleKey(2);
  const supportKey = getSectionLocaleKey(3);
  let cursor = 0;
  let hasMappedCtaBody = false;

  if (looksLikeResetHeadline(blocks[0])) {
    sections[introKey].title = formatTextForLocaleJson(blocks[0]);
    cursor = 1;
  }

  if (blocks[cursor]) {
    const introSplit = splitAffPasswordResetIntroAndCtaBody(blocks[cursor]);
    sections[introKey].body = formatTextForLocaleJson(introSplit.intro || blocks[cursor]);
    if (introSplit.cta) {
      sections[ctaKey].body = formatTextForLocaleJson(introSplit.cta);
      hasMappedCtaBody = true;
    }
    cursor += 1;
  }

  if (!hasMappedCtaBody && blocks[cursor]) {
    sections[ctaKey].body = formatTextForLocaleJson(blocks[cursor]);
    cursor += 1;
  }

  if (translationEntry?.cta_labels?.[0]) {
    sections[ctaKey].cta_label = formatTextForLocaleJson(translationEntry.cta_labels[0]);
  }

  if (blocks[cursor]) {
    sections[warningKey].body = formatTextForLocaleJson(blocks[cursor]);
    cursor += 1;
  }

  if (blocks.length > cursor) {
    sections[supportKey].body = formatTextForLocaleJson(blocks.slice(cursor).join("\n\n"));
  }

  return sections;
}

function buildLocaleSectionMap(mail, translationEntry) {
  if (looksLikeAffPasswordResetMail(mail)) {
    return buildAffPasswordResetLocaleSectionMap(mail, translationEntry);
  }

  const sections = buildBaseLocaleSectionMap(mail);
  const blocks = Array.isArray(translationEntry?.body_blocks) ? translationEntry.body_blocks : [];
  const heroSectionIndex = mail.sections.findIndex((section) => section.kind === "hero");
  const featureSectionIndex = mail.sections.findIndex((section) => section.kind === "feature-list");
  const ctaSectionIndex = mail.sections.findIndex((section) => section.kind === "cta");
  const usedBlockIndices = new Set();

  if (blocks.length > 0 && heroSectionIndex >= 0) {
    const heroKey = getSectionLocaleKey(heroSectionIndex);
    if (blocks[0]) {
      sections[heroKey].title = formatTextForLocaleJson(blocks[0]);
      usedBlockIndices.add(0);
    }
    if (blocks[1]) {
      sections[heroKey].body = formatTextForLocaleJson(blocks[1]);
      usedBlockIndices.add(1);
    }
    if (translationEntry?.cta_labels?.[0]) {
      sections[heroKey].cta_label = formatTextForLocaleJson(translationEntry.cta_labels[0]);
    }
  }

  if (blocks.length > 2 && featureSectionIndex >= 0) {
    const featureKey = getSectionLocaleKey(featureSectionIndex);
    const itemCount = Math.max(sections[featureKey].items.length, Math.min(4, blocks.length - 2));
    const localizedItems = blocks.slice(2, 2 + itemCount).map(formatTextForLocaleJson).filter(Boolean);
    if (localizedItems.length > 0) {
      sections[featureKey].items = localizedItems;
      for (let index = 2; index < 2 + localizedItems.length; index += 1) {
        usedBlockIndices.add(index);
      }
    }
  }

  if (translationEntry?.cta_labels?.[0] && ctaSectionIndex >= 0) {
    const ctaKey = getSectionLocaleKey(ctaSectionIndex);
    if (sections[ctaKey].cta_label) {
      sections[ctaKey].cta_label = formatTextForLocaleJson(translationEntry.cta_labels[0]);
    }
  }

  let blockCursor = 0;
  const nextBlock = () => {
    while (blockCursor < blocks.length && usedBlockIndices.has(blockCursor)) {
      blockCursor += 1;
    }
    if (blockCursor >= blocks.length) {
      return "";
    }
    const value = blocks[blockCursor];
    usedBlockIndices.add(blockCursor);
    blockCursor += 1;
    return value;
  };

  const firstContentSectionIndex = mail.sections.findIndex((section) => !["image", "footer"].includes(cleanText(section.kind)));
  if (firstContentSectionIndex >= 0 && blocks.length > 0 && !usedBlockIndices.has(0)) {
    const firstKey = getSectionLocaleKey(firstContentSectionIndex);
    if (sections[firstKey]?.title) {
      const block = nextBlock();
      if (block) {
        sections[firstKey].title = formatTextForLocaleJson(block);
      }
    }
  }

  for (const [index, section] of mail.sections.entries()) {
    const kind = cleanText(section.kind);
    const key = getSectionLocaleKey(index);

    if (kind === "image" || kind === "footer") {
      continue;
    }

    if (kind === "hero") {
      continue;
    }

    if (Array.isArray(section.items) && section.items.length > 0) {
      const localizedItems = [];
      for (let itemIndex = 0; itemIndex < section.items.length; itemIndex += 1) {
        const block = nextBlock();
        if (!block) {
          break;
        }
        localizedItems.push(formatTextForLocaleJson(block));
      }
      if (localizedItems.length > 0) {
        sections[key].items = localizedItems;
      }
      continue;
    }

    if (sections[key]?.body || ["text", "hero", "cta"].includes(kind)) {
      const block = nextBlock();
      if (block) {
        sections[key].body = formatTextForLocaleJson(block);
      }
    }
  }

  return sections;
}

function createLocalePayloadForEntry(mail, translationEntry) {
  return {
    subject: formatPlainLocaleText(translationEntry?.subject || mail.subject),
    preheader: formatPlainLocaleText(translationEntry?.preheader || mail.preheader),
    summary: formatPlainLocaleText(translationEntry?.notes || mail.summary),
    sections: buildLocaleSectionMap(mail, translationEntry),
    body_blocks: Array.isArray(translationEntry?.body_blocks)
      ? translationEntry.body_blocks.map(formatTextForLocaleJson)
      : [],
    cta_labels: Array.isArray(translationEntry?.cta_labels)
      ? translationEntry.cta_labels.map(formatTextForLocaleJson)
      : [],
    notes: cleanText(translationEntry?.notes),
    source_name: cleanText(translationEntry?.source_name)
  };
}

function applyBoldPhraseToText(text, phrase) {
  const source = cleanText(text);
  const target = cleanText(phrase);
  if (!source || !target) {
    return source;
  }

  const relaxedTarget = target.replace(/[,:;.!?]+$/g, "");
  const alreadyBoldTargets = Array.from(new Set([target, relaxedTarget].filter(Boolean)));
  for (const candidate of alreadyBoldTargets) {
    if (source.includes(`**${candidate}**`) || source.includes(`<strong>${candidate}</strong>`)) {
      return source;
    }
  }

  for (const candidate of alreadyBoldTargets) {
    const repeatedBoldPattern = new RegExp(`\\*{2,}\\s*(${escapeRegExp(candidate)})\\s*\\*{2,}([,:;.!?])?`, "i");
    if (repeatedBoldPattern.test(source)) {
      return source.replace(repeatedBoldPattern, (_match, core, punctuation = "") => `**${core}**${punctuation || ""}`);
    }
  }

  const directPattern = new RegExp(escapeRegExp(target), "i");
  if (directPattern.test(source)) {
    return source.replace(directPattern, (match) => match.startsWith("**") && match.endsWith("**") ? match : `**${match}**`);
  }

  if (!relaxedTarget || relaxedTarget === target) {
    return source;
  }

  const relaxedPattern = new RegExp(`${escapeRegExp(relaxedTarget)}([,:;.!?])?`, "i");
  if (relaxedPattern.test(source)) {
    return source.replace(relaxedPattern, (match) => match.startsWith("**") && match.endsWith("**") ? match : `**${match}**`);
  }

  return source;
}

function deriveLogoAltText(url) {
  const name = extractAssetNameFromUrl(url)
    .replace(/[-_]+/g, " ")
    .trim();
  return name || "Brand logo";
}

function applyDeterministicDraftEdits(mail, payload) {
  const logoUrl = extractLatestLogoOverrideUrl(payload);
  const boldPhrases = extractRequestedBoldPhrases(payload);
  let nextMail = {
    ...mail,
    sections: Array.isArray(mail.sections) ? mail.sections.map((section) => ({ ...section, items: Array.isArray(section.items) ? [...section.items] : [] })) : [],
    translations: Array.isArray(mail.translations) ? mail.translations.map((entry) => ({
      ...entry,
      cta_labels: Array.isArray(entry.cta_labels) ? [...entry.cta_labels] : [],
      body_blocks: Array.isArray(entry.body_blocks) ? [...entry.body_blocks] : []
    })) : []
  };

  if (logoUrl) {
    nextMail.brand_logo_url = logoUrl;
    nextMail.brand_logo_alt = deriveLogoAltText(logoUrl);
  }

  if (boldPhrases.length === 0) {
    return nextMail;
  }

  for (const phrase of boldPhrases) {
    nextMail.sections = nextMail.sections.map((section) => ({
      ...section,
      eyebrow: applyBoldPhraseToText(section.eyebrow, phrase),
      title: applyBoldPhraseToText(section.title, phrase),
      body: applyBoldPhraseToText(section.body, phrase),
      cta_label: applyBoldPhraseToText(section.cta_label, phrase),
      items: Array.isArray(section.items) ? section.items.map((item) => applyBoldPhraseToText(item, phrase)) : []
    }));

    nextMail.translations = nextMail.translations.map((entry) => ({
      ...entry,
      subject: applyBoldPhraseToText(entry.subject, phrase),
      preheader: applyBoldPhraseToText(entry.preheader, phrase),
      notes: applyBoldPhraseToText(entry.notes, phrase),
      cta_labels: Array.isArray(entry.cta_labels) ? entry.cta_labels.map((label) => applyBoldPhraseToText(label, phrase)) : [],
      body_blocks: Array.isArray(entry.body_blocks) ? entry.body_blocks.map((block) => applyBoldPhraseToText(block, phrase)) : []
    }));
  }

  return nextMail;
}

function renderStudioSectionPug(section, sectionIndex, assetMap, translationFileKey) {
  const sectionKey = getSectionLocaleKey(sectionIndex);
  const token = (field) => makeTranslationToken(translationFileKey, `sections.${sectionKey}.${field}`);
  const lines = [
    "                        tr",
    `                            td.section.section-${section.kind}`
  ];
  const asset = section.image_key ? assetMap.get(section.image_key) : null;

  if (asset) {
    lines.push(
      `                                img.section-image(src=${JSON.stringify(asset.url)} alt=${JSON.stringify(asset.alt || asset.key)} width=${JSON.stringify(String(asset.width || 580))} height=${JSON.stringify(String(asset.height || 280))})`
    );
  }

  if (section.eyebrow) {
    lines.push(`                                p.eyebrow!= ${JSON.stringify(token("eyebrow"))}`);
  }

  if (section.title) {
    lines.push(`                                h1.section-title!= ${JSON.stringify(token("title"))}`);
  }

  if (section.body) {
    lines.push(`                                p.section-body!= ${JSON.stringify(token("body"))}`);
  }

  if (Array.isArray(section.items) && section.items.length > 0) {
    lines.push("                                table.feature-table(role=\"presentation\" width=\"100%\")");
    for (let itemIndex = 0; itemIndex < section.items.length; itemIndex += 1) {
      lines.push("                                    tr");
      lines.push(`                                        td.feature-item!= ${JSON.stringify(makeTranslationToken(translationFileKey, `sections.${sectionKey}.items.${itemIndex}`))}`);
    }
  }

  if (section.cta_label && section.cta_href) {
    lines.push("                                table.button-wrap(role=\"presentation\")");
    lines.push("                                    tr");
    lines.push("                                        td");
    lines.push(`                                            a.button-link(href=${JSON.stringify(section.cta_href)} universal="true" target="_blank")!= ${JSON.stringify(token("cta_label"))}`);
  } else if (section.cta_label) {
    lines.push("                                table.button-wrap(role=\"presentation\")");
    lines.push("                                    tr");
    lines.push("                                        td");
    lines.push(`                                            span.button-link.button-link-disabled!= ${JSON.stringify(token("cta_label"))}`);
  }

  return lines.join("\n");
}

function renderStudioEmailBaseTemplate(mail, translationFileKey) {
  const assetMap = getMailAssetMap(mail);
  const sectionLines = mail.sections
    .map((section, index) => renderStudioSectionPug(section, index, assetMap, translationFileKey))
    .join("\n");

  return [
    "doctype html",
    "html(xmlns=\"http://www.w3.org/1999/xhtml\")",
    "",
    "    include ../../../../vendor/helpers/head",
    "    <u></u>",
    "    body.email-body",
    "        div.preheader",
    `            != ${JSON.stringify(makeTranslationToken(translationFileKey, "preheader"))}`,
    "            |  &nbsp;&raquo;&nbsp;&raquo;&nbsp;&raquo;&nbsp;&raquo;&nbsp;&raquo;&nbsp;&raquo;&nbsp;&raquo;&nbsp;&raquo;&nbsp;&raquo;",
    "        table.email-bg(role=\"presentation\" width=\"100%\")",
    "            tr",
    "                td(align=\"center\")",
    "                    table.email-canvas(role=\"presentation\" width=\"100%\")",
    sectionLines,
    "                        tr",
    "                            td.section.section-footer-legal",
    "                                p.footer-address {{embedded.company_address}}",
    "                                p.footer-warning {{embedded.risk_warning}}",
    "                                p.footer-links",
    "                                    a(href=\"{{embedded.company_terms_link}}\" universal=\"true\" target=\"_blank\") ${{ footer.footer.conditions }}$",
    "                                    |  | ",
    "                                    a(href=\"{{embedded.unsubscribe_link}}\" universal=\"true\" target=\"_blank\") ${{ footer.footer.unsubscribe }}$",
    "",
    "        include ../../../../vendor/helpers/gmail-fix",
    ""
  ].join("\n");
}

function renderStudioCommonStylus() {
  return `
body
  margin 0
  padding 0
  background #eef2e8
  color #14281d
  font-family 'Arial', sans-serif

table
  border-collapse collapse
  border-spacing 0
  mso-table-lspace 0pt
  mso-table-rspace 0pt

img
  border 0
  display block
  line-height 100%
  outline none
  text-decoration none
  max-width 100%

.preheader
  display none !important
  visibility hidden
  opacity 0
  overflow hidden
  mso-hide all
  font-size 1px
  line-height 1px
  max-height 0
  max-width 0
  color transparent

.email-bg
  width 100%
  background #eef2e8

.email-canvas
  width 100%
  max-width 640px
  margin 0 auto
  background #fffdf7

.section
  padding 28px 24px
  border-bottom 1px solid #dfe7db

.section-hero
  background #1f3b2c
  color #fff8ef

.section-cta
  background #14281d
  color #fff8ef

.section-footer, .section-footer-legal
  background #f3efe5
  color #516253

.section-image
  width 100%
  height auto
  margin 0 0 18px

.eyebrow
  margin 0 0 10px
  font-size 12px
  line-height 18px
  font-weight 700
  text-transform uppercase
  letter-spacing 1.5px

.section-title
  margin 0 0 12px
  font-size 30px
  line-height 36px
  font-weight 700

.section-body
  margin 0
  font-size 16px
  line-height 24px

.feature-table
  width 100%
  margin-top 16px

.feature-item
  padding 0 0 10px
  font-size 16px
  line-height 24px

.button-wrap
  margin-top 18px

.button-link
  display inline-block
  padding 14px 22px
  background #ff7a2f
  color #fff8ef !important
  text-decoration none
  font-weight 700
  border-radius 999px

.button-link-disabled
  opacity 0.72

.footer-address, .footer-warning, .footer-links
  margin 0 0 12px
  font-size 12px
  line-height 18px
  color #516253

.footer-links a
  color #516253 !important
  text-decoration underline

@media only screen and (max-width: 640px)
  .section
    padding 22px 18px

  .section-title
    font-size 24px
    line-height 30px
`;
}

function getSystemVerificationReferenceRoot() {
  return path.join(emailBaseRoot, "X_IQBroker", "mail-payment-verification-request-pop");
}

function getAffPasswordResetReferenceRoot() {
  return path.join(emailBaseRoot, "X_AffSystem", "mail-password-retrieving-affiliate");
}

function isAffPasswordResetReference(payload) {
  const target = resolveReferenceTemplateMailTarget(payload);
  return cleanText(target.category) === "X_AffSystem"
    && cleanText(target.mailId) === "password-retrieving-affiliate";
}

function buildAffPasswordResetTemplateMail(payload) {
  const logoUrl = cleanText(extractLatestLogoOverrideUrl(payload))
    || "https://static.cdnpub.info/files/storage/public/5f/c8/d0517a03c1c8h5j9j4/logoaff_white_shadow__1_.png";

  return {
    subject: "Set your new password",
    preheader: "Password reset instructions",
    locale: normalizeLocaleCode(payload?.brief?.locale || "en"),
    summary: "Affiliate password reset email built from the base template.",
    brand_logo_url: logoUrl,
    brand_logo_alt: deriveLogoAltText(logoUrl),
    sections: [
      {
        kind: "text",
        title: "Set your new password",
        body: "We created an account for you on {{affiliate_embedded_admin_domain_url}} (or received a request to reset your password)."
      },
      {
        kind: "cta",
        title: "",
        body: "Please click the button below to set your new password:",
        cta_label: "Set new password",
        cta_href: "{{reset_password_link}}"
      },
      {
        kind: "text",
        title: "",
        body: "If you didn’t request to create or reset your password, you can safely ignore this email."
      },
      {
        kind: "text",
        title: "",
        body: "If you’re having trouble signing in to your account, try setting your password again or reach out to support."
      },
      {
        kind: "footer",
        title: "",
        body: "{{embedded.company_address}}\n\nTerms and Conditions"
      }
    ],
    assets: [],
    translations: []
  };
}

function looksLikeSystemVerificationDraft(payload, mail) {
  if (!isSystemCategoryName(payload?.brief?.category)) {
    return false;
  }

  const source = [
    cleanText(payload?.brief?.campaignName),
    cleanText(payload?.brief?.goal),
    cleanText(getRecentUserTranscript(payload)),
    cleanText(mail?.subject),
    cleanText(mail?.preheader),
    ...(Array.isArray(mail?.sections) ? mail.sections.flatMap((section) => [
      cleanText(section?.title),
      cleanText(section?.body),
      ...(Array.isArray(section?.items) ? section.items.map(cleanText) : [])
    ]) : [])
  ].join(" ").toLowerCase();

  return /(passbook|verification|verify|verified|bank passbook|document|documents|declin|reject|reason_text|вериф|провер|документ|пасбук|паспорт|банк)/i.test(source);
}

function getEmailBaseTemplateProfile(payload, mail) {
  const selection = getReferenceTemplateSelection(payload);
  if (cleanText(selection?.profile)) {
    return cleanText(selection.profile);
  }

  if (
    looksLikeSystemVerificationDraft(payload, mail)
    && cleanText(selection?.category) === "X_IQBroker"
    && cleanText(selection?.mailId) === "payment-verification-request-pop"
  ) {
    return "system-verification";
  }

  return "generic";
}

function getSystemVerificationToken(translationFileKey, sectionIndex, field) {
  return makeTranslationToken(translationFileKey, `sections.${getSectionLocaleKey(sectionIndex)}.${field}`);
}

function renderSystemVerificationSectionPug(section, sectionIndex, translationFileKey) {
  const lines = [];
  const titleToken = getSystemVerificationToken(translationFileKey, sectionIndex, "title");
  const bodyToken = getSystemVerificationToken(translationFileKey, sectionIndex, "body");
  const ctaToken = getSystemVerificationToken(translationFileKey, sectionIndex, "cta_label");

  if (cleanText(section.kind) === "feature-list") {
    lines.push("                tr");
    lines.push("                    td.text-pad-small.pb32");
    lines.push("                        .verification-callout");
    if (cleanText(section.title)) {
      lines.push(`                            p.text.strong.pb12!= ${JSON.stringify(titleToken)}`);
    }
    if (cleanText(section.body)) {
      lines.push(`                            p.text.pb12!= ${JSON.stringify(bodyToken)}`);
    }
    if (Array.isArray(section.items) && section.items.length > 0) {
      lines.push("                            ul.verification-list");
      for (let itemIndex = 0; itemIndex < section.items.length; itemIndex += 1) {
        lines.push(`                                li!= ${JSON.stringify(makeTranslationToken(translationFileKey, `sections.${getSectionLocaleKey(sectionIndex)}.items.${itemIndex}`))}`);
      }
    }
    return lines.join("\n");
  }

  lines.push("                tr");
  lines.push("                    td.text-pad-small");

  if (cleanText(section.title)) {
    const titleClass = sectionIndex === 0 ? "middle-title" : "text strong";
    const titlePadding = sectionIndex === 0 ? "pb20" : "pb12";
    lines.push(`                        p.${titleClass}.${titlePadding}!= ${JSON.stringify(titleToken)}`);
  }

  if (cleanText(section.body)) {
    const bodyClass = cleanText(section.kind) === "footer" ? "small-text" : "text";
    const bodyPadding = cleanText(section.cta_label) ? "pb20" : "pb16";
    lines.push(`                        p.${bodyClass}.${bodyPadding}!= ${JSON.stringify(bodyToken)}`);
  }

  if (cleanText(section.cta_label)) {
    lines.push("                        .button-wrapper");
    lines.push("                            table.medium-button.radius");
    lines.push("                                tr");
    lines.push("                                    td.iq");
    if (cleanText(section.cta_href)) {
      lines.push(`                                        a.butt(href=${JSON.stringify(cleanText(section.cta_href))} universal=\"true\" target=\"_blank\")!= ${JSON.stringify(ctaToken)}`);
    } else {
      lines.push(`                                        span.butt.nopoint!= ${JSON.stringify(ctaToken)}`);
    }
  }

  return lines.join("\n");
}

function renderSystemVerificationHeaderPug(mail, translationFileKey) {
  const logoUrl = cleanText(mail?.brand_logo_url) || "https://images01.iqoption.com/89/0689/static-01503674720413810689.png";
  const logoAlt = cleanText(mail?.brand_logo_alt) || "IQ Option";
  const sections = (Array.isArray(mail.sections) ? mail.sections : [])
    .filter((section) => !["footer", "image", "cta"].includes(cleanText(section.kind)))
    .map((section, index) => renderSystemVerificationSectionPug(section, index, translationFileKey))
    .filter(Boolean)
    .join("\n");
  const ctaSection = (Array.isArray(mail.sections) ? mail.sections : [])
    .find((section) => cleanText(section.kind) === "cta" && cleanText(section.cta_label));
  const ctaIndex = (Array.isArray(mail.sections) ? mail.sections : []).findIndex((section) => cleanText(section.kind) === "cta" && cleanText(section.cta_label));
  const ctaBlock = ctaSection && ctaIndex >= 0
    ? renderSystemVerificationSectionPug(ctaSection, ctaIndex, translationFileKey)
    : "";

  return [
    "table.center",
    "    tr",
    "        td",
    "            table.ten.columns",
    "                tr",
    "                    td.pb0",
    `                        img.logo(src=${JSON.stringify(logoUrl)} alt=${JSON.stringify(logoAlt)})`,
    "",
    "table.row.border-full",
    "    tr",
    "        td.wrapper.last.offset-by-one.pt44",
    "            table.ten.columns",
    sections,
    ctaBlock ? `\n${ctaBlock}` : ""
  ].join("\n");
}

function renderSystemVerificationFooterPug() {
  return [
    "table.row.footer",
    "    tr",
    "        td.wrapper.last.offset-by-one.pt50",
    "            table.ten.columns",
    "                tr",
    "                    td.pb50.text-pad-small",
    "                        p.warning {{embedded.risk_warning}}",
    "                        p.warning {{embedded.company_address}}",
    "                        p.subscribe",
    "                            a.ctr(href=\"{{embedded.company_terms_link}}\" target=\"_blank\") ${{ footer.footer.conditions }}$"
  ].join("\n");
}

function getAffPasswordResetToken(translationFileKey, sectionIndex, field) {
  return makeTranslationToken(translationFileKey, `sections.${getSectionLocaleKey(sectionIndex)}.${field}`);
}

function renderAffPasswordResetHeaderPug(mail, translationFileKey) {
  const logoUrl = cleanText(mail?.brand_logo_url)
    || "https://static.cdnpub.info/files/storage/public/5f/c8/d0517a03c1c8h5j9j4/logoaff_white_shadow__1_.png";
  const logoAlt = cleanText(mail?.brand_logo_alt) || "Affstore";
  const introTitle = getAffPasswordResetToken(translationFileKey, 0, "title");
  const introBody = getAffPasswordResetToken(translationFileKey, 0, "body");
  const ctaBody = getAffPasswordResetToken(translationFileKey, 1, "body");
  const ctaLabel = getAffPasswordResetToken(translationFileKey, 1, "cta_label");
  const warningBody = getAffPasswordResetToken(translationFileKey, 2, "body");
  const supportBody = getAffPasswordResetToken(translationFileKey, 3, "body");
  const ctaHref = cleanText(mail?.sections?.[1]?.cta_href) || "{{reset_password_link}}";

  return [
    "table.row.white-bg.brad-top.bg-col",
    "    tr",
    "        td.wrapper.offset-by-one.last",
    "            table.ten.columns",
    "                tr",
    "                    td.six.sub-columns.pt0",
    `                        img.logo.center.pb5(src=${JSON.stringify(logoUrl)} alt=${JSON.stringify(logoAlt)})`,
    "",
    "table.row.white-bg.bg-bord-r.br-top.bg-bord-top",
    "    tr.bg-bord-l",
    "        td.wrapper.last.offset-by-one",
    "            table.ten.columns",
    "                tr",
    "                    td.text-pad-small.pt25.pb20",
    `                        p.subtitle.center.pb15!= ${JSON.stringify(introTitle)}`,
    `                        p.text.pb15!= ${JSON.stringify(introBody)}`,
    "",
    "table.row.white-bg.bg-bord-r",
    "    tr.bg-bord-l",
    "        td.wrapper.last.offset-by-three.pt0",
    "            table.six.columns",
    "                tr",
    "                    td.pb0.plr20-a",
    `                        p.text.pb15!= ${JSON.stringify(ctaBody)}`,
    "                        .button-wrapper",
    "                            table.medium-button.radius",
    "                                tr",
    "                                    td.iq",
    `                                        a.butt(href=${JSON.stringify(ctaHref)} target=\"_blank\" universal=\"true\")!= ${JSON.stringify(ctaLabel)}`,
    "",
    "table.row.white-bg.bg-bord-r.br-bot.bg-bord-bot",
    "    tr.bg-bord-l",
    "        td.wrapper.last.offset-by-one",
    "            table.ten.columns",
    "                tr",
    "                    td.text-pad-small.pt17.pb20",
    `                        p.text.pb15!= ${JSON.stringify(warningBody)}`,
    `                        p.text.pb15!= ${JSON.stringify(supportBody)}`
  ].join("\n");
}

function renderAffPasswordResetFooterPug() {
  return [
    "table.row.footer.bg-col",
    "    tr",
    "        td.pb30.bg-col",
    "            table.twelve.columns",
    "                tr",
    "                    td",
    "                        .mobile-paddding",
    "                            p.footer-text.center {{embedded.company_address}}",
    "                            p.footer-text.center",
    "                                a(href=\"{{embedded.company_terms_link}}\" target=\"_blank\" universal=\"true\") ${{ footer.footer.conditions }}$"
  ].join("\n");
}

function renderAffPasswordResetIndexPug() {
  return [
    "doctype PUBLIC \"-//W3C//DTD XHTML 1.0 Strict//EN\" \"http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd\"",
    "html(xmlns=\"http://www.w3.org/1999/xhtml\")",
    "    include ../../../../vendor/helpers/mixins",
    "    include ../../../../vendor/helpers/head",
    "    body",
    "        include ../../../../vendor/helpers/preheader",
    "        table.body",
    "            tr",
    "                td(align=\"center\", valign=\"top\").center.bg-col",
    "                    center",
    "                        table.container",
    "                            tr",
    "                                td",
    "                                    include blocks/header",
    "                                    include helpers/footer",
    "",
    "        include ../../../../vendor/helpers/gmail-fix"
  ].join("\n");
}

function renderSystemVerificationIndexPug() {
  return [
    "doctype PUBLIC \"-//W3C//DTD XHTML 1.0 Strict//EN\" \"http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd\"",
    "html(xmlns=\"http://www.w3.org/1999/xhtml\")",
    "    include ../../../../vendor/helpers/head",
    "    body",
    "        include ../../../../vendor/helpers/preheader",
    "        table.body",
    "            tr",
    "                td.center(align=\"center\", valign=\"top\")",
    "                    center",
    "                        table.container",
    "                            tr",
    "                                td.pt30",
    "                                    include blocks/header",
    "                                    include helpers/footer",
    "",
    "        include ../../../../vendor/helpers/gmail-fix"
  ].join("\n");
}

function renderSystemVerificationExtraStylus() {
  return `
.verification-callout
  background #eef4fb
  border-left 4px solid #4668ff
  border-radius 0 16px 16px 0
  padding 22px 24px 16px

.verification-list
  margin 0
  padding 0 0 0 22px

.verification-list li
  color #20242f
  font-size 18px
  line-height 28px
  margin 0 0 10px

.strong
  font-weight 700 !important
`;
}

async function writeEmailBaseDraftFiles({
  mailRoot,
  templatesRoot,
  stylesRoot,
  assetsRoot,
  templatePath,
  stylePath,
  mail,
  translationFileKey,
  payload
}) {
  const profile = getEmailBaseTemplateProfile(payload, mail);

  if (profile === "system-verification") {
    const referenceRoot = getSystemVerificationReferenceRoot();
    const referenceStylesRoot = path.join(referenceRoot, "app", "styles");
    const referenceAssetsRoot = path.join(referenceRoot, "app", "assets");
    const headerPath = path.join(templatesRoot, "blocks", "header.pug");
    const footerPath = path.join(templatesRoot, "helpers", "footer.pug");
    const extraStylePath = path.join(stylesRoot, "blocks", "studio-verification.styl");

    await mkdir(path.join(templatesRoot, "blocks"), { recursive: true });
    await mkdir(path.join(templatesRoot, "helpers"), { recursive: true });
    await cp(referenceStylesRoot, stylesRoot, { recursive: true });
    if (existsSync(referenceAssetsRoot)) {
      await cp(referenceAssetsRoot, assetsRoot, { recursive: true });
    }
    await writeFile(templatePath, renderSystemVerificationIndexPug(), "utf8");
    await writeFile(headerPath, renderSystemVerificationHeaderPug(mail, translationFileKey), "utf8");
    await writeFile(footerPath, renderSystemVerificationFooterPug(), "utf8");
    await writeFile(extraStylePath, renderSystemVerificationExtraStylus().trimStart(), "utf8");

    return {
      profile,
      templatePath,
      stylePath
    };
  }

  if (profile === "aff-password-reset") {
    const referenceRoot = getAffPasswordResetReferenceRoot();
    const referenceStylesRoot = path.join(referenceRoot, "app", "styles");
    const referenceAssetsRoot = path.join(referenceRoot, "app", "assets");
    const headerPath = path.join(templatesRoot, "blocks", "header.pug");
    const footerPath = path.join(templatesRoot, "helpers", "footer.pug");

    await mkdir(path.join(templatesRoot, "blocks"), { recursive: true });
    await mkdir(path.join(templatesRoot, "helpers"), { recursive: true });
    await cp(referenceStylesRoot, stylesRoot, { recursive: true });
    if (existsSync(referenceAssetsRoot)) {
      await cp(referenceAssetsRoot, assetsRoot, { recursive: true });
    }
    await writeFile(templatePath, renderAffPasswordResetIndexPug(), "utf8");
    await writeFile(headerPath, renderAffPasswordResetHeaderPug(mail, translationFileKey), "utf8");
    await writeFile(footerPath, renderAffPasswordResetFooterPug(), "utf8");

    return {
      profile,
      templatePath,
      stylePath
    };
  }

  await mkdir(templatesRoot, { recursive: true });
  await mkdir(stylesRoot, { recursive: true });
  await writeFile(templatePath, renderStudioEmailBaseTemplate(mail, translationFileKey), "utf8");
  await writeFile(stylePath, renderStudioCommonStylus().trimStart(), "utf8");

  return {
    profile,
    templatePath,
    stylePath
  };
}

function createTemporaryStudioMailId(category = "") {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const scope = slugify(category || "mail").slice(0, 16) || "mail";
  const nonce = Math.random().toString(36).slice(2, 8);
  return `studio-preview-${scope}-${stamp}-${nonce}`;
}

async function removePathIfExists(targetPath) {
  if (!targetPath) {
    return;
  }

  try {
    await rm(targetPath, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup for temporary build artifacts.
  }
}

function canUseReferenceTemplatePreview(payload) {
  const selection = getReferenceTemplateSelection(payload);
  const category = cleanText(selection?.category);
  const mailId = cleanText(selection?.mailId);
  if (category !== "X_IQ" || !/^rfm-/i.test(mailId)) {
    return false;
  }

  return existsSync(path.join(emailBaseRoot, category, `mail-${mailId}`, "app", "templates"));
}

function isIqRfmReferenceSelection(selection) {
  return cleanText(selection?.category) === "X_IQ" && /^rfm-\d{3}$/i.test(cleanText(selection?.mailId));
}

function buildIqRfmReferenceTemplateMail(payload, mailId = "") {
  const familyProfile = findTemplateFamilyProfileById("x-iq-rfm");
  const locale = normalizeLocaleCode(payload?.brief?.locale || "en");
  const selectionMailId = cleanText(mailId) || getDefaultIqRfmMailId();
  const variantLabel = selectionMailId.replace(/^rfm-/, "").replace(/(\d)(\d)(\d)/, "$1-$2-$3");
  const structure = Array.isArray(familyProfile?.canonicalStructure) && familyProfile.canonicalStructure.length > 0
    ? familyProfile.canonicalStructure
    : ["hero", "feature-list", "text", "cta", "footer"];
  return {
    subject: "",
    preheader: "",
    locale,
    summary: `IQ Option RFM ${variantLabel} reference draft.`,
    brand_logo_url: "https://static.cdnroute.io/files/storage/public/60/b6/1b5cef3f19b7c9i0b2/logo_shadow_top_2.png",
    brand_logo_alt: "IQ Option",
    sections: structure.map((kind) => ({
      kind,
      eyebrow: "",
      title: "",
      body: kind === "footer" ? "{{embedded.company_address}}\n\n{{embedded.risk_warning}}" : "",
      image_key: "",
      cta_label: "",
      cta_href: "",
      items: []
    })),
    assets: [],
    translations: []
  };
}

function listFilesRecursiveSync(rootDir) {
  if (!rootDir || !existsSync(rootDir)) {
    return [];
  }

  const files = [];
  const queue = [rootDir];
  while (queue.length > 0) {
    const current = queue.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const nextPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(nextPath);
      } else if (entry.isFile()) {
        files.push(nextPath);
      }
    }
  }

  return files;
}

function extractReferenceTranslationRefsFromSource(source) {
  const refs = [];
  const seen = new Set();
  const matches = source.matchAll(/\$\{\{\s*([A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)+)\s*\}\}\$/g);

  for (const match of matches) {
    const fullPath = cleanText(match[1]);
    if (!fullPath || fullPath.startsWith("embedded.") || seen.has(fullPath)) {
      continue;
    }
    seen.add(fullPath);
    const parts = fullPath.split(".").filter(Boolean);
    const namespace = parts.shift() || "";
    if (!namespace || parts.length === 0) {
      continue;
    }
    refs.push({
      namespace,
      pathParts: parts
    });
  }

  return refs;
}

function collectReferenceLocalePlan(templatesRoot) {
  const templateFiles = listFilesRecursiveSync(templatesRoot)
    .filter((filePath) => [".jade", ".pug"].includes(path.extname(filePath).toLowerCase()));
  const refsByNamespace = new Map();

  for (const filePath of templateFiles) {
    const source = readFileSync(filePath, "utf8");
    for (const ref of extractReferenceTranslationRefsFromSource(source)) {
      const list = refsByNamespace.get(ref.namespace) || [];
      if (!list.some((item) => item.pathParts.join(".") === ref.pathParts.join("."))) {
        list.push(ref);
      }
      refsByNamespace.set(ref.namespace, list);
    }
  }

  const namespaceStats = [...refsByNamespace.entries()].map(([namespace, refs]) => ({
    namespace,
    refs
  }));
  const primaryNamespace = namespaceStats
    .filter((entry) => !/^(footer|iq-soc)$/i.test(entry.namespace))
    .sort((left, right) => right.refs.length - left.refs.length || left.namespace.localeCompare(right.namespace))[0]?.namespace || "";
  const socialNamespaces = namespaceStats
    .filter((entry) => /soc/i.test(entry.namespace))
    .map((entry) => entry.namespace);

  return {
    refsByNamespace,
    primaryNamespace,
    socialNamespaces
  };
}

function setNestedLocaleValue(target, pathParts, value) {
  if (!target || !Array.isArray(pathParts) || pathParts.length === 0) {
    return;
  }

  let cursor = target;
  for (let index = 0; index < pathParts.length; index += 1) {
    const key = cleanText(pathParts[index]);
    if (!key) {
      return;
    }
    if (index === pathParts.length - 1) {
      cursor[key] = value;
      return;
    }
    if (!cursor[key] || typeof cursor[key] !== "object" || Array.isArray(cursor[key])) {
      cursor[key] = {};
    }
    cursor = cursor[key];
  }
}

function collectReferenceLocaleFragments(mail, localePayload) {
  const fragments = [];
  const preheader = parseLocalePayloadTextToMailText(localePayload?.preheader);
  if (preheader) {
    fragments.push(preheader);
  }

  const sections = localePayload?.sections && typeof localePayload.sections === "object"
    ? localePayload.sections
    : {};

  for (let index = 0; index < (Array.isArray(mail?.sections) ? mail.sections.length : 0); index += 1) {
    const section = mail.sections[index];
    if (cleanText(section?.kind) === "footer") {
      continue;
    }
    const localized = sections[getSectionLocaleKey(index)] || {};
    const title = parseLocalePayloadTextToMailText(localized.title);
    const body = parseLocalePayloadTextToMailText(localized.body);
    const items = Array.isArray(localized.items)
      ? localized.items.map(parseLocalePayloadTextToMailText).filter(Boolean)
      : [];
    const ctaLabel = parseLocalePayloadTextToMailText(localized.cta_label);

    if (title) {
      fragments.push(title);
    }
    if (body) {
      fragments.push(body);
    }
    for (const item of items) {
      fragments.push(item);
    }
    if (ctaLabel) {
      fragments.push(ctaLabel);
    }
  }

  return fragments.filter(Boolean);
}

function buildReferenceNamespacePayload(refs = [], values = []) {
  const payload = {};
  for (let index = 0; index < refs.length; index += 1) {
    setNestedLocaleValue(payload, refs[index].pathParts, values[index] || "");
  }
  return payload;
}

function createReferenceLocaleOverridePayloads(mail, localePayload, localePlan) {
  const payloads = [];
  const fragments = collectReferenceLocaleFragments(mail, localePayload);

  if (localePlan.primaryNamespace) {
    const refs = localePlan.refsByNamespace.get(localePlan.primaryNamespace) || [];
    payloads.push([
      localePlan.primaryNamespace,
      buildReferenceNamespacePayload(refs, refs.map((_ref, index) => fragments[index] || ""))
    ]);
  }

  for (const namespace of localePlan.socialNamespaces) {
    const refs = localePlan.refsByNamespace.get(namespace) || [];
    payloads.push([
      namespace,
      buildReferenceNamespacePayload(refs, refs.map(() => ""))
    ]);
  }

  return payloads.filter((entry) => entry[0] && entry[1] && Object.keys(entry[1]).length > 0);
}

function shouldBlankReferenceLinks(payload) {
  const transcript = cleanText(getRecentUserTranscript(payload)).toLowerCase();
  return /(ссылк[аи].*(пуст|пустыми|пустой)|оставь.*href.*пуст|leave.*links?.*empty|empty href)/i.test(transcript);
}

async function blankReferenceTemplateLinks(templatesRoot) {
  const templateFiles = listFilesRecursiveSync(templatesRoot)
    .filter((filePath) => [".jade", ".pug"].includes(path.extname(filePath).toLowerCase()));

  for (const filePath of templateFiles) {
    const source = await readFile(filePath, "utf8");
    const sanitized = source.replace(/\bhref=(["'])(?!\{\{|\$\{\{)(.*?)\1/g, 'href=""');
    if (sanitized !== source) {
      await writeFile(filePath, sanitized, "utf8");
    }
  }
}

async function writeTemporaryLocaleOverride(localePath, payload, cleanupEntries) {
  const existed = existsSync(localePath);
  const previousContent = existed ? await readFile(localePath, "utf8") : "";
  await mkdir(path.dirname(localePath), { recursive: true });
  await writeFile(localePath, JSON.stringify(payload, null, 2), "utf8");
  cleanupEntries.push({
    path: localePath,
    existed,
    previousContent
  });
}

async function restoreTemporaryLocaleOverrides(cleanupEntries) {
  for (const entry of [...cleanupEntries].reverse()) {
    if (entry.existed) {
      await writeFile(entry.path, entry.previousContent, "utf8");
    } else {
      await removePathIfExists(entry.path);
    }
  }
}

async function buildReferenceEmailBasePreviewFromDraft(payload, rawDraft) {
  const summary = summarizeEmailBase();
  const templateSelection = getReferenceTemplateSelection(payload);
  const category = ensureSafeCategoryName(cleanText(templateSelection?.category) || "X_IQ");
  const referenceMailId = cleanText(templateSelection?.mailId);
  const referenceRoot = path.join(emailBaseRoot, category, `mail-${referenceMailId}`);
  if (!referenceMailId || !existsSync(referenceRoot)) {
    throw new Error("Reference template root is missing");
  }

  const mailId = createTemporaryStudioMailId(category);
  const mail = normalizeMail(rawDraft, payload);
  const primaryLocale = normalizeLocaleCode(payload.brief.locale || mail.locale || "en");
  const mailRoot = path.join(emailBaseRoot, category, `mail-${mailId}`);
  const templatesRoot = path.join(mailRoot, "app", "templates");
  const stylesRoot = path.join(mailRoot, "app", "styles");
  const assetsRoot = path.join(mailRoot, "app", "assets");
  const referenceTemplatesRoot = path.join(referenceRoot, "app", "templates");
  const referenceStylesRoot = path.join(referenceRoot, "app", "styles");
  const referenceAssetsRoot = path.join(referenceRoot, "app", "assets");
  const localePayloads = new Map();
  const localeOverrideCleanup = [];
  const previewLocales = {};
  const localeBuildLogs = {};
  const distDir = path.join(emailBaseRoot, "dist", category, `mail-${mailId}`);

  for (const entry of Array.isArray(mail.translations) ? mail.translations : []) {
    const locale = cleanText(entry.locale);
    if (!locale) {
      continue;
    }
    localePayloads.set(locale, createLocalePayloadForEntry(mail, entry));
  }

  if (!hasLocaleEntryForRequest(localePayloads, primaryLocale)) {
    localePayloads.set(primaryLocale, createLocalePayloadForEntry(mail, {
      locale: primaryLocale,
      subject: mail.subject,
      preheader: mail.preheader,
      cta_labels: collectCtaLabels(mail),
      body_blocks: [],
      notes: "",
      source_name: ""
    }));
  }

  try {
    await mkdir(path.join(mailRoot, "app"), { recursive: true });
    await cp(referenceTemplatesRoot, templatesRoot, { recursive: true });
    await cp(referenceStylesRoot, stylesRoot, { recursive: true });
    if (existsSync(referenceAssetsRoot)) {
      await cp(referenceAssetsRoot, assetsRoot, { recursive: true });
    }

    if (shouldBlankReferenceLinks(payload)) {
      await blankReferenceTemplateLinks(templatesRoot);
    }

    const localePlan = collectReferenceLocalePlan(templatesRoot);
    const localeOverridePreview = {};

    for (const [locale, localePayload] of localePayloads.entries()) {
      const overrides = createReferenceLocaleOverridePayloads(mail, localePayload, localePlan);
      localeOverridePreview[locale] = Object.fromEntries(overrides);
      for (const [namespace, namespacePayload] of overrides) {
        const localePath = path.join(emailBaseRoot, "vendor", "data", locale, `${namespace}.json`);
        await writeTemporaryLocaleOverride(localePath, namespacePayload, localeOverrideCleanup);
      }
    }

    for (const locale of localePayloads.keys()) {
      const buildResult = await withPreferredTemplateSource(templatesRoot, () => runCommand(
        process.execPath,
        ["mail", "build-pretty", category, mailId, "--locales", locale],
        emailBaseRoot
      ));

      const prettyPath = path.join(distDir, locale, "index.pretty.html");
      const compactPath = path.join(distDir, locale, "index.html");
      const htmlPath = existsSync(prettyPath) ? prettyPath : compactPath;
      previewLocales[locale] = applyLocaleDirectionToHtml(await readFile(htmlPath, "utf8"), locale);
      localeBuildLogs[locale] = [buildResult.stdout, buildResult.stderr].filter(Boolean).join("\n").trim() || "Build completed.";
    }

    const selectedPreviewLocale = resolveLocalePayloadKey(localePayloads, primaryLocale);
    const html = previewLocales[selectedPreviewLocale] || previewLocales[Object.keys(previewLocales)[0]] || "";
    const resolvedTemplatePath = resolveMailTemplateIndexPath(templatesRoot);
    const templateSource = resolvedTemplatePath
      ? await readFile(resolvedTemplatePath, "utf8")
      : "No index template file found";
    const assetRegistry = await readAssetRegistry();
    const assets = extractAssetRecordsFromHtml(html);
    const savedMail = {
      ...mail,
      assets: mail.assets?.length > 0 ? mail.assets : assets,
      translations: Array.from(localePayloads.entries()).map(([locale, localePayload]) => ({
        locale,
        subject: localePayload.subject,
        preheader: localePayload.preheader,
        cta_labels: localePayload.cta_labels || [],
        notes: localePayload.notes || "",
        body_blocks: localePayload.body_blocks || [],
        source_name: localePayload.source_name || `${referenceMailId}.json`
      }))
    };
    const draftSnapshot = createDraftSnapshot(savedMail, null, {
      assetRecommendations: buildAssetRecommendations(savedMail, {
        assetInputs: payload.assetInputs,
        assetRegistryItems: payload.assetRegistryItems.length > 0 ? payload.assetRegistryItems : assetRegistry.items
      }),
      previewCategory: category,
      templateSelection,
      previewLocales,
      localePayloads: Object.fromEntries(localePayloads.entries()),
      localeBuildLogs
    });
    draftSnapshot.html = html;
    draftSnapshot.pug = templateSource;
    draftSnapshot.locales = JSON.stringify(localeOverridePreview[selectedPreviewLocale] || {}, null, 2);
    draftSnapshot.assetsManifest = JSON.stringify(
      Object.fromEntries((savedMail.assets || []).map((asset) => [asset.key, asset])),
      null,
      2
    );
    draftSnapshot.spec = JSON.stringify({
      source: "email-reference-preview-build",
      category,
      mailId,
      referenceMailId,
      primaryLocale,
      templateProfile: "reference-preview",
      referenceTemplate: templateSelection,
      mail: savedMail
    }, null, 2);
    draftSnapshot.buildLog = localeBuildLogs[selectedPreviewLocale] || localeBuildLogs[Object.keys(localeBuildLogs)[0]] || "Build completed.";
    draftSnapshot.workspaceFiles = await collectWorkspaceFiles({
      mailRoot,
      templatesRoot,
      stylesRoot,
      previewLocales,
      localePayloads: localeOverridePreview,
      localeBuildLogs,
      assetsManifest: draftSnapshot.assetsManifest,
      specContent: draftSnapshot.spec
    });
    draftSnapshot.stylus = getPrimaryWorkspaceFileContent(draftSnapshot.workspaceFiles, "stylus");

    return {
      draft: draftSnapshot,
      previewSource: "email-base-reference",
      buildLog: draftSnapshot.buildLog
    };
  } finally {
    await removePathIfExists(mailRoot);
    await removePathIfExists(distDir);
    await restoreTemporaryLocaleOverrides(localeOverrideCleanup);
  }
}

async function buildTemporaryEmailBasePreviewFromDraft(payload, rawDraft) {
  const summary = summarizeEmailBase();
  if (!summary.available) {
    throw new Error("email-base is not attached");
  }

  if (canUseReferenceTemplatePreview(payload)) {
    return buildReferenceEmailBasePreviewFromDraft(payload, rawDraft);
  }

  const templateSelection = getReferenceTemplateSelection(payload);
  const category = ensureSafeCategoryName(
    cleanText(payload?.brief?.category)
    || cleanText(templateSelection?.category)
    || summary.currentMail?.category
    || "X_System"
  );
  const mailId = createTemporaryStudioMailId(category);
  const mail = normalizeMail(rawDraft, payload);
  const translationFileKey = getStudioTranslationFileKey(mailId);
  const primaryLocale = normalizeLocaleCode(payload.brief.locale || mail.locale || "en");
  const mailRoot = path.join(emailBaseRoot, category, `mail-${mailId}`);
  const templatesRoot = path.join(mailRoot, "app", "templates");
  const stylesRoot = path.join(mailRoot, "app", "styles");
  const assetsRoot = path.join(mailRoot, "app", "assets");
  const templatePath = path.join(templatesRoot, "index.pug");
  const stylePath = path.join(stylesRoot, "common.styl");
  const localePayloads = new Map();
  const createdLocalePaths = [];

  for (const entry of Array.isArray(mail.translations) ? mail.translations : []) {
    const locale = cleanText(entry.locale);
    if (!locale) {
      continue;
    }
    localePayloads.set(locale, createLocalePayloadForEntry(mail, entry));
  }

  if (!hasLocaleEntryForRequest(localePayloads, primaryLocale)) {
    localePayloads.set(primaryLocale, createLocalePayloadForEntry(mail, {
      locale: primaryLocale,
      subject: mail.subject,
      preheader: mail.preheader,
      cta_labels: collectCtaLabels(mail),
      body_blocks: [],
      notes: "",
      source_name: ""
    }));
  }

  const distDir = path.join(emailBaseRoot, "dist", category, `mail-${mailId}`);
  const previewLocales = {};
  const localeBuildLogs = {};

  try {
    const writtenTemplate = await writeEmailBaseDraftFiles({
      mailRoot,
      templatesRoot,
      stylesRoot,
      assetsRoot,
      templatePath,
      stylePath,
      mail,
      translationFileKey,
      payload
    });

    for (const [locale, localePayload] of localePayloads.entries()) {
      const localeDir = path.join(emailBaseRoot, "vendor", "data", locale);
      const localePath = path.join(localeDir, `${translationFileKey}.json`);
      await mkdir(localeDir, { recursive: true });
      await writeFile(localePath, JSON.stringify(localePayload, null, 2), "utf8");
      createdLocalePaths.push(localePath);
    }

    for (const locale of localePayloads.keys()) {
      const buildResult = await runCommand(
        process.execPath,
        ["mail", "build-pretty", category, mailId, "--locales", locale],
        emailBaseRoot
      );

      const prettyPath = path.join(distDir, locale, "index.pretty.html");
      const compactPath = path.join(distDir, locale, "index.html");
      const htmlPath = existsSync(prettyPath) ? prettyPath : compactPath;
      previewLocales[locale] = applyLocaleDirectionToHtml(await readFile(htmlPath, "utf8"), locale);
      localeBuildLogs[locale] = [buildResult.stdout, buildResult.stderr].filter(Boolean).join("\n").trim() || "Build completed.";
    }

    const selectedPreviewLocale = resolveLocalePayloadKey(localePayloads, primaryLocale);
    const html = previewLocales[selectedPreviewLocale] || previewLocales[Object.keys(previewLocales)[0]] || "";
    const templateSource = await readFile(writtenTemplate.templatePath, "utf8");
    const localeSource = JSON.stringify(localePayloads.get(selectedPreviewLocale), null, 2);
    const assets = extractAssetRecordsFromHtml(html);
    const assetRegistry = await readAssetRegistry();
    const savedMail = {
      ...mail,
      assets: mail.assets?.length > 0 ? mail.assets : assets,
      translations: Array.from(localePayloads.entries()).map(([locale, localePayload]) => ({
        locale,
        subject: localePayload.subject,
        preheader: localePayload.preheader,
        cta_labels: localePayload.cta_labels || [],
        notes: localePayload.notes || "",
        body_blocks: localePayload.body_blocks || [],
        source_name: localePayload.source_name || `${translationFileKey}.json`
      }))
    };
    const draftSnapshot = createDraftSnapshot(savedMail, null, {
      assetRecommendations: buildAssetRecommendations(savedMail, {
        assetInputs: payload.assetInputs,
        assetRegistryItems: payload.assetRegistryItems.length > 0 ? payload.assetRegistryItems : assetRegistry.items
      }),
      previewCategory: category,
      templateSelection,
      previewLocales,
      localePayloads: Object.fromEntries(localePayloads.entries()),
      localeBuildLogs
    });
    draftSnapshot.html = html;
    draftSnapshot.pug = templateSource;
    draftSnapshot.locales = localeSource;
    draftSnapshot.assetsManifest = JSON.stringify(
      Object.fromEntries((savedMail.assets || []).map((asset) => [asset.key, asset])),
      null,
      2
    );
    draftSnapshot.spec = JSON.stringify({
      source: "email-studio-preview-build",
      category,
      mailId,
      translationFileKey,
      primaryLocale,
      temporary: true,
      templateProfile: writtenTemplate.profile,
      referenceTemplate: templateSelection,
      mail: savedMail
    }, null, 2);
    draftSnapshot.buildLog = localeBuildLogs[selectedPreviewLocale] || localeBuildLogs[Object.keys(localeBuildLogs)[0]] || "Build completed.";
    draftSnapshot.workspaceFiles = await collectWorkspaceFiles({
      mailRoot,
      templatesRoot,
      stylesRoot,
      previewLocales,
      localePayloads: Object.fromEntries(localePayloads.entries()),
      localeBuildLogs,
      assetsManifest: draftSnapshot.assetsManifest,
      specContent: draftSnapshot.spec
    });
    draftSnapshot.stylus = getPrimaryWorkspaceFileContent(draftSnapshot.workspaceFiles, "stylus");

    return {
      draft: draftSnapshot,
      previewSource: "email-base-draft",
      buildLog: draftSnapshot.buildLog
    };
  } finally {
    await removePathIfExists(mailRoot);
    await removePathIfExists(distDir);
    for (const localePath of createdLocalePaths) {
      await removePathIfExists(localePath);
    }
  }
}

async function createEmailBaseMailFromDraft(payload, rawDraft) {
  const summary = summarizeEmailBase();
  if (!summary.available) {
    throw new Error("email-base is not attached");
  }

  const templateSelection = getReferenceTemplateSelection(payload);
  const draftSnapshotSource = rawDraft && typeof rawDraft === "object" ? rawDraft : {};
  const category = ensureSafeCategoryName(
    cleanText(payload?.brief?.category)
    || cleanText(templateSelection?.category)
    || summary.currentMail?.category
    || "X_IQ"
  );
  const mailId = resolveStudioMailId(payload.brief.mailId, payload.brief.campaignName);
  const mailSource = draftSnapshotSource.mail && typeof draftSnapshotSource.mail === "object"
    ? draftSnapshotSource.mail
    : rawDraft;
  const mail = normalizeMail(mailSource, payload);
  const translationFileKey = getStudioTranslationFileKey(mailId);
  const locales = Array.from(new Set((mail.translations || []).map((entry) => normalizeLocaleCode(entry.locale)).filter(Boolean)));
  const primaryLocale = normalizeLocaleCode(payload.brief.locale || mail.locale || locales[0] || "en");
  const mailRoot = path.join(emailBaseRoot, category, `mail-${mailId}`);
  const templatesRoot = path.join(mailRoot, "app", "templates");
  const stylesRoot = path.join(mailRoot, "app", "styles");
  const assetsRoot = path.join(mailRoot, "app", "assets");
  const templatePath = path.join(templatesRoot, "index.pug");
  const stylePath = path.join(stylesRoot, "common.styl");
  const metaPath = path.join(mailRoot, "studio.mail.json");

  if (existsSync(mailRoot)) {
    throw new Error(`email-base target already exists: ${category}/mail-${mailId}`);
  }

  const localePayloads = new Map();
  for (const entry of mail.translations) {
    const locale = cleanText(entry.locale);
    if (!locale) {
      continue;
    }
    localePayloads.set(locale, createLocalePayloadForEntry(mail, entry));
  }

  if (!hasLocaleEntryForRequest(localePayloads, primaryLocale)) {
    localePayloads.set(primaryLocale, createLocalePayloadForEntry(mail, {
      locale: primaryLocale,
      subject: mail.subject,
      preheader: mail.preheader,
      cta_labels: collectCtaLabels(mail),
      body_blocks: [],
      notes: "",
      source_name: ""
    }));
  }

  for (const locale of localePayloads.keys()) {
    const targetPath = path.join(emailBaseRoot, "vendor", "data", locale, `${translationFileKey}.json`);
    if (existsSync(targetPath)) {
      throw new Error(`Translation file already exists: vendor/data/${locale}/${translationFileKey}.json`);
    }
  }

  const writtenTemplate = await writeEmailBaseDraftFiles({
    mailRoot,
    templatesRoot,
    stylesRoot,
    assetsRoot,
    templatePath,
    stylePath,
    mail,
    translationFileKey,
    payload
  });
  await applyWorkspaceFileOverrides(mailRoot, draftSnapshotSource.workspaceFiles);
  await writeFile(metaPath, JSON.stringify({
    created_at: new Date().toISOString(),
    source: "email-studio",
    category,
    mail_id: mailId,
    translation_file: translationFileKey,
    primary_locale: primaryLocale,
    template_profile: writtenTemplate.profile,
    reference_template: templateSelection,
    mail
  }, null, 2), "utf8");

  for (const [locale, localePayload] of localePayloads.entries()) {
    const localeDir = path.join(emailBaseRoot, "vendor", "data", locale);
    await mkdir(localeDir, { recursive: true });
    await writeFile(
      path.join(localeDir, `${translationFileKey}.json`),
      JSON.stringify(localePayload, null, 2),
      "utf8"
    );
  }

  const previewLocales = {};
  const localeBuildLogs = {};
  for (const locale of localePayloads.keys()) {
    const buildResult = await runCommand(
      process.execPath,
      ["mail", "build-pretty", category, mailId, "--locales", locale],
      emailBaseRoot
    );

    const distDir = path.join(emailBaseRoot, "dist", category, `mail-${mailId}`, locale);
    const prettyPath = path.join(distDir, "index.pretty.html");
    const compactPath = path.join(distDir, "index.html");
    const htmlPath = existsSync(prettyPath) ? prettyPath : compactPath;
      previewLocales[locale] = applyLocaleDirectionToHtml(await readFile(htmlPath, "utf8"), locale);
    localeBuildLogs[locale] = [buildResult.stdout, buildResult.stderr].filter(Boolean).join("\n").trim() || "Build completed.";
  }

  const selectedPreviewLocale = resolveLocalePayloadKey(localePayloads, primaryLocale);
  const html = previewLocales[selectedPreviewLocale] || previewLocales[Object.keys(previewLocales)[0]] || "";
  const templateSource = await readFile(writtenTemplate.templatePath, "utf8");
  const localeSource = JSON.stringify(localePayloads.get(selectedPreviewLocale), null, 2);
  const assets = extractAssetRecordsFromHtml(html);
  const assetRegistry = await readAssetRegistry();
  const savedMail = {
    ...mail,
    assets: mail.assets?.length > 0 ? mail.assets : assets,
    translations: Array.from(localePayloads.entries()).map(([locale, localePayload]) => ({
      locale,
      subject: localePayload.subject,
      preheader: localePayload.preheader,
      cta_labels: localePayload.cta_labels || [],
      notes: localePayload.notes || "",
      body_blocks: localePayload.body_blocks || [],
      source_name: localePayload.source_name || `${translationFileKey}.json`
    }))
  };
  const draftSnapshot = createDraftSnapshot(savedMail, null, {
    assetRecommendations: buildAssetRecommendations(savedMail, {
      assetInputs: payload.assetInputs,
      assetRegistryItems: payload.assetRegistryItems.length > 0 ? payload.assetRegistryItems : assetRegistry.items
    }),
    previewCategory: category,
    templateSelection,
    previewLocales,
    localePayloads: Object.fromEntries(localePayloads.entries()),
    localeBuildLogs
  });
  draftSnapshot.html = html;
  draftSnapshot.pug = templateSource;
  draftSnapshot.locales = localeSource;
  draftSnapshot.assetsManifest = JSON.stringify(
    Object.fromEntries((mail.assets || []).map((asset) => [asset.key, asset])),
    null,
    2
  );
  draftSnapshot.spec = JSON.stringify({
    source: "email-studio-save",
    category,
    mailId,
    translationFileKey,
    primaryLocale,
    templateProfile: writtenTemplate.profile,
    referenceTemplate: templateSelection,
    mail
  }, null, 2);
  draftSnapshot.buildLog = localeBuildLogs[selectedPreviewLocale] || localeBuildLogs[Object.keys(localeBuildLogs)[0]] || "Build completed.";
  draftSnapshot.workspaceFiles = await collectWorkspaceFiles({
    mailRoot,
    templatesRoot,
    stylesRoot,
    previewLocales,
    localePayloads: Object.fromEntries(localePayloads.entries()),
    localeBuildLogs,
    assetsManifest: draftSnapshot.assetsManifest,
    specContent: draftSnapshot.spec
  });
  draftSnapshot.stylus = getPrimaryWorkspaceFileContent(draftSnapshot.workspaceFiles, "stylus");

  return {
    assistantReply: `Сохранил draft в email-base как ${category}/mail-${mailId}, записал ${localePayloads.size} locale file(s) и собрал ${primaryLocale} preview.`,
    mode: "email-base",
    saved: {
      category,
      mailId,
      folder: `${category}/mail-${mailId}`,
      translationFile: `${translationFileKey}.json`,
      locales: Array.from(localePayloads.keys())
    },
    draft: draftSnapshot
  };
}

function sendJson(response, statusCode, payload, extraHeaders = {}) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...extraHeaders
  });
  response.end(JSON.stringify(payload));
}

function sendText(response, statusCode, body, contentType = "text/plain; charset=utf-8", extraHeaders = {}) {
  response.writeHead(statusCode, {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
    ...extraHeaders
  });
  response.end(body);
}

async function readRequestBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  return JSON.parse(raw);
}

// cleanText → imported from src/utils.js

function normalizeFigmaNodeId(value) {
  return cleanText(value).replace(/-/g, ":");
}

function looksLikeImageUrl(value) {
  return /^data:image\//i.test(value) || /\.(png|jpe?g|gif|webp|svg)(\?.*)?$/i.test(value);
}

function parseFigmaReferenceUrl(value) {
  const url = cleanText(value);
  if (!url || !/figma\.com/i.test(url)) {
    return null;
  }

  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split("/").filter(Boolean);
    const mode = cleanText(segments[0]);
    const fileKey = ["file", "design", "proto", "board"].includes(mode) ? cleanText(segments[1]) : "";
    const nodeId = normalizeFigmaNodeId(parsed.searchParams.get("node-id"));
    const selectionName = cleanText(decodeURIComponent(segments[2] || "")).replace(/[-_]+/g, " ");

    return {
      url,
      mode,
      fileKey,
      nodeId,
      selectionName
    };
  } catch {
    return {
      url,
      mode: "figma",
      fileKey: "",
      nodeId: "",
      selectionName: ""
    };
  }
}

function extractUrlsFromText(value) {
  return (cleanText(value).match(/https?:\/\/[^\s)]+/gi) || [])
    .map((url) => url.replace(/[.,]+$/g, ""));
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function slugify(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "draft";
}

function extractLines(text) {
  return cleanText(text)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * Replaces ${{ namespace.key }}$ tokens in built HTML using a localeContent map.
 * Tokens from other namespaces (affbot, footer, etc.) are preserved unchanged.
 */
function resolveTokensForPreview(html, namespace, localeContent) {
  if (!html || !namespace || !localeContent) return html;
  return html.replace(
    /\$\{\{\s*([a-zA-Z0-9_-]+)\.([a-zA-Z0-9_.-]+)\s*\}\}\$/g,
    (match, ns, key) => {
      if (ns !== namespace) return match; // preserve shared tokens
      const val = localeContent[key];
      return val != null ? String(val) : match;
    }
  );
}

function stripTags(value) {
  return String(value).replace(/<[^>]*>/g, " ");
}

/**
 * Extracts a structured "content map" from an HTML email for the Clone & Edit feature.
 * Returns: subject, preheader, sections (ordered text blocks), images, links.
 * This summary is what the AI receives instead of the full raw HTML.
 */
function extractEmailHtmlContentMap(html) {
  if (!html || typeof html !== "string") return null;

  // Subject from <title> or meta
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const subject = cleanText(stripTags(titleMatch?.[1] || ""));

  // Preheader: typically first visible text div with class containing "preheader"
  const preheaderMatch = html.match(/<[^>]*class="[^"]*preheader[^"]*"[^>]*>([\s\S]*?)<\/(?:td|div|span|p)>/i);
  const preheader = cleanText(stripTags(preheaderMatch?.[1] || "")).slice(0, 200);

  // Extract all image srcs (skip tiny spacers < 5px, data URIs, empty)
  const imgMatches = [...html.matchAll(/<img[^>]+src=["']([^"']+)["'][^>]*>/gi)];
  const images = imgMatches
    .map((m) => {
      const src = m[1] || "";
      const widthMatch = m[0].match(/width=["']?(\d+)/i);
      const w = widthMatch ? Number(widthMatch[1]) : 100;
      return { src, width: w };
    })
    .filter((img) => img.width >= 10 && !img.src.startsWith("data:") && img.src.trim())
    .map((img) => img.src)
    .filter((src, i, arr) => arr.indexOf(src) === i)
    .slice(0, 20);

  // Extract CTA links (a href with text, skip unsubscribe/img-only links)
  const linkMatches = [...html.matchAll(/<a\s[^>]*href=["']([^"'#][^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi)];
  const links = linkMatches
    .map((m) => ({
      href: cleanText(m[1] || ""),
      text: cleanText(stripTags(m[2] || ""))
    }))
    .filter((l) => l.href && l.text && l.text.length > 1 && l.text.length < 120)
    .filter((l) => !/unsubscribe|отписат|unsub/i.test(l.href + l.text))
    .filter((l, i, arr) => arr.findIndex((x) => x.href === l.href) === i)
    .slice(0, 15);

  // Extract text sections: look for <td> or <div> blocks with substantial text
  const blockMatches = [...html.matchAll(/<(?:td|div|p)[^>]*>([\s\S]*?)<\/(?:td|div|p)>/gi)];
  const sections = [];
  const seenTexts = new Set();

  for (const m of blockMatches) {
    const rawText = cleanText(stripTags(m[1] || ""));
    if (rawText.length < 12 || rawText.length > 1200) continue;
    // Skip if it looks like just a link text (already captured) or styling artifact
    if (/^https?:\/\//.test(rawText)) continue;
    if (seenTexts.has(rawText)) continue;
    seenTexts.add(rawText);
    sections.push(rawText);
    if (sections.length >= 25) break;
  }

  return {
    subject,
    preheader,
    images,
    links,
    sections,
    charCount: html.length,
    sectionCount: sections.length
  };
}

function inferCloneEditIntentHints(payload, contentMap = null) {
  const latestUserMessage = cleanText(getLatestUserMessage(payload)).toLowerCase();
  const requestedLocales = Array.from(new Set([
    ...parseLocaleList(cleanText(payload?.brief?.requestedLocales)),
    ...extractRequestedLocalesFromMessages(payload)
  ].filter(Boolean)));

  const intents = [];
  if (/(translate|translation|перевед|перевод|локал|locale|language|на русский|на араб|на урду|на португ)/i.test(latestUserMessage) || requestedLocales.length > 1) {
    intents.push("translate");
  }
  if (/(brand|rebrand|ребренд|бренд|другой бренд|под бренд|смени лого|замени лого|logo)/i.test(latestUserMessage)) {
    intents.push("rebrand");
  }
  if (/(adapt|адапт|подправ|передел|update|refresh|cleanup|rewrite|упрости|сделай живее)/i.test(latestUserMessage)) {
    intents.push("adapt");
  }

  const hints = [];
  if (contentMap?.subject) {
    hints.push(`Current subject in HTML: ${contentMap.subject}`);
  }
  if (contentMap?.preheader) {
    hints.push(`Current preheader in HTML: ${contentMap.preheader}`);
  }
  if (requestedLocales.length > 0) {
    hints.push(`Requested locales from user context: ${requestedLocales.join(", ")}`);
  }
  if (cleanText(payload?.brief?.primaryLink)) {
    hints.push(`Primary link override requested: ${cleanText(payload.brief.primaryLink)}`);
  }

  return {
    intents,
    summary: intents.length > 0 ? intents.join(", ") : "direct-edit",
    hints
  };
}

function getDraftLocale(brief) {
  return normalizeLocaleCode(brief.locale) || "en";
}

function normalizeLocaleCode(value) {
  const raw = cleanText(value).replaceAll("-", "_");
  if (!raw) {
    return "";
  }

  const parts = raw.split("_").filter(Boolean);
  if (parts.length === 0) {
    return "";
  }

  if (parts.length === 1) {
    return parts[0].toLowerCase();
  }

  return [parts[0].toLowerCase(), ...parts.slice(1).map((part) => part.toUpperCase())].join("_");
}

function parseLocaleList(value) {
  return Array.from(new Set(
    cleanText(value)
      .split(/[\s,;]+/)
      .map(normalizeLocaleCode)
      .filter(Boolean)
  ));
}

function getLatestPayloadMessage(payload, role = "user") {
  return [...(Array.isArray(payload?.messages) ? payload.messages : [])]
    .reverse()
    .find((message) => message.role === role)?.content || "";
}

function getRecentUserTranscript(payload) {
  return (Array.isArray(payload?.messages) ? payload.messages : [])
    .filter((message) => message.role === "user")
    .map((message) => cleanText(message.content))
    .filter(Boolean)
    .join("\n");
}

function extractRequestedLocalesFromMessages(payload) {
  const source = cleanText(getRecentUserTranscript(payload)).replaceAll("-", "_");
  if (!source) {
    return [];
  }

  const emailBaseSummary = summarizeEmailBase();
  const supportedLocales = [
    ...(Array.isArray(emailBaseSummary.locales) ? emailBaseSummary.locales : []),
    "en", "ru", "pt", "pt_BR", "de", "fr", "fr_FR", "es", "es_ES", "it", "id", "ja", "ko", "th", "tr", "uk", "vi", "ar", "az", "bn", "cn", "ge", "hi", "hl", "ms", "nl", "no", "se", "tl", "ur"
  ];
  const allowed = new Map(
    supportedLocales
      .map((locale) => normalizeLocaleCode(locale))
      .filter(Boolean)
      .map((locale) => [locale.toLowerCase(), locale])
  );

  const matches = source.match(/\b[a-z]{2}(?:_[A-Za-z]{2})?\b/gi) || [];
  return Array.from(new Set(
    matches
      .map((token) => allowed.get(token.toLowerCase()))
      .filter(Boolean)
  ));
}

function inferBriefCategoryFromMessages(payload) {
  const design = normalizeDesignPayload(payload?.design);
  const source = [
    cleanText(getRecentUserTranscript(payload)),
    cleanText(payload?.brief?.designUrl),
    cleanText(design?.name),
    cleanText(design?.figmaSelectionName)
  ].join("\n").toLowerCase();

  if (/(системн|технич|тех письмо|техническ|transactional|technical|service email|system email)/i.test(source)) {
    return "X_System";
  }

  if (/(iq[\s_-]*option|iqoption|\/iq-option-emails|\brfm\b)/i.test(source)) {
    return "X_IQ";
  }

  if (/\bexnova\b/i.test(source)) {
    return "X_Exnova";
  }

  return "";
}

function resolveBriefCategory(payload, fallback = "") {
  const inferredCategory = inferBriefCategoryFromMessages(payload);
  const explicitCategory = cleanText(payload?.brief?.category || payload?.category);
  if (inferredCategory === "X_System") {
    return "X_System";
  }
  return explicitCategory || cleanText(fallback) || inferredCategory;
}

function listIqRfmMailIds() {
  const emailBaseSummary = summarizeEmailBase();
  const category = (emailBaseSummary.categories || []).find((entry) => cleanText(entry.name) === "X_IQ");
  return Array.isArray(category?.mails)
    ? category.mails.map((mail) => cleanText(mail.id)).filter((mailId) => /^rfm-\d{3}$/i.test(mailId))
    : [];
}

function getDefaultIqRfmMailId() {
  const familyProfile = findTemplateFamilyProfileById("x-iq-rfm");
  const availableMailIds = listIqRfmMailIds();
  return cleanText(familyProfile?.defaultMailId) && availableMailIds.includes(cleanText(familyProfile.defaultMailId))
    ? cleanText(familyProfile.defaultMailId)
    : ["rfm-333", "rfm-331", "rfm-332", "rfm-334"].find((mailId) => availableMailIds.includes(mailId))
    || availableMailIds[0]
    || "";
}

function inferMailIdForCategory(categoryName = "") {
  const normalizedCategory = cleanText(categoryName);
  if (!normalizedCategory) {
    return "";
  }

  const emailBaseSummary = summarizeEmailBase();
  const category = (emailBaseSummary.categories || []).find((entry) => cleanText(entry.name) === normalizedCategory);
  if (!category || !Array.isArray(category.mails) || category.mails.length === 0) {
    return "";
  }

  if (normalizedCategory === "X_IQ") {
    const rfmPreferred = getDefaultIqRfmMailId();
    if (rfmPreferred) {
      return rfmPreferred;
    }
  }

  const preferred = category.mails.find((mail) => /payment|success|welcome|confirm|docs|verification/i.test(cleanText(mail.id)))
    || category.mails[0];
  return cleanText(preferred?.id);
}

function extractRfmVariantDigits(sourceText = "") {
  const source = normalizeTemplateSelectionText(sourceText);
  const matches = [
    ...source.matchAll(/\brfm\b[^\d]{0,6}([1-3])[^\d]{0,3}([1-3])[^\d]{0,3}([1-4])\b/g),
    ...source.matchAll(/\brfm\b[^\d]{0,4}([1-3]{3})\b/g),
    ...source.matchAll(/\b([1-3])[^\d]{0,3}([1-3])[^\d]{0,3}([1-4])\b/g)
  ];

  for (const match of matches) {
    const digits = match[1] && match[2] && match[3]
      ? `${match[1]}${match[2]}${match[3]}`
      : cleanText(match[1]);
    if (digits && /^\d{3}$/.test(digits)) {
      return digits;
    }
  }

  return "";
}

function inferRfmReferenceMailId(sourceText = "") {
  const availableMailIds = listIqRfmMailIds();
  const availableSet = new Set(availableMailIds);
  if (availableSet.size === 0) {
    return "";
  }

  const digits = extractRfmVariantDigits(sourceText);
  const candidateId = digits ? `rfm-${digits}` : "";
  if (candidateId && availableSet.has(candidateId)) {
    return candidateId;
  }

  return ["rfm-333", "rfm-331", "rfm-332", "rfm-334"].find((mailId) => availableSet.has(mailId))
    || availableMailIds.find((mailId) => /^rfm-/i.test(mailId))
    || availableMailIds[0]
    || "";
}

function normalizeTemplateSelectionText(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTemplateSelectionTokens(value) {
  const baseTokens = normalizeTemplateSelectionText(value)
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && !templateSelectionStopwords.has(token));
  const expanded = new Set();

  for (const token of baseTokens) {
    expanded.add(token);
    for (const alias of templateSelectionAliases[token] || []) {
      if (alias.length >= 2) {
        expanded.add(alias);
      }
    }
  }

  return [...expanded];
}

function buildTemplateSelectionSourceText(payload) {
  const design = normalizeDesignPayload(payload?.design);
  const designSchema = payload?.designSchema && typeof payload.designSchema === "object"
    ? payload.designSchema
    : buildNormalizedDesignSchema(payload, design, payload?.designAnalysis);
  const designDecomposition = payload?.designDecomposition && typeof payload.designDecomposition === "object"
    ? payload.designDecomposition
    : buildNormalizedDesignDecomposition({
      ...payload,
      design,
      designSchema
    }, designSchema);
  const designMappingHints = payload?.designMappingHints && typeof payload.designMappingHints === "object"
    ? payload.designMappingHints
    : buildNormalizedDesignMappingHints({
      ...payload,
      design,
      designSchema,
      designDecomposition
    }, designSchema, designDecomposition);
  const figmaImport = normalizeFigmaImportPayload(design?.figmaImport);
  const translationSeedMail = payload?.currentDraft && typeof payload.currentDraft === "object"
    ? payload.currentDraft
    : {
        locale: cleanText(payload?.brief?.locale) || "en",
        subject: "",
        preheader: "",
        sections: []
      };
  const translationEntries = parseTranslationEntries(cleanText(payload?.translationText), translationSeedMail);
  const translationText = translationEntries.flatMap((entry) => [
    cleanText(entry?.locale),
    cleanText(entry?.subject),
    cleanText(entry?.preheader),
    cleanText(entry?.notes),
    ...(Array.isArray(entry?.cta_labels) ? entry.cta_labels.map(cleanText) : []),
    ...(Array.isArray(entry?.body_blocks) ? entry.body_blocks.map(cleanText) : [])
  ]).filter(Boolean).join(" ");
  const currentDraftText = Array.isArray(payload?.currentDraft?.sections)
    ? payload.currentDraft.sections.flatMap((section) => [
        cleanText(section?.kind),
        cleanText(section?.eyebrow),
        cleanText(section?.title),
        cleanText(section?.body),
        ...(Array.isArray(section?.items) ? section.items.map(cleanText) : [])
      ]).filter(Boolean).join(" ")
    : "";
  const figmaText = [
    cleanText(design?.name),
    cleanText(design?.figmaSelectionName),
    cleanText(design?.figmaFileKey),
    cleanText(design?.figmaNodeId),
    cleanText(figmaImport?.pageName),
    ...(Array.isArray(figmaImport?.layerNames) ? figmaImport.layerNames.map(cleanText) : []),
    ...(Array.isArray(figmaImport?.textSamples) ? figmaImport.textSamples.map(cleanText) : [])
  ].filter(Boolean).join(" ");
  const schemaText = designSchema
    ? [
        cleanText(designSchema?.meta?.frameName),
        cleanText(designSchema?.meta?.pageName),
        ...(Array.isArray(designSchema?.sections) ? designSchema.sections.flatMap((section) => [
          cleanText(section?.role),
          cleanText(section?.name),
          cleanText(section?.summaryText)
        ]) : []),
        ...(Array.isArray(designSchema?.textNodes) ? designSchema.textNodes.map((node) => cleanText(node?.text)) : []),
        ...(Array.isArray(designSchema?.imageSlots) ? designSchema.imageSlots.flatMap((image) => [
          cleanText(image?.roleHint),
          cleanText(image?.name)
        ]) : []),
        ...(Array.isArray(designSchema?.componentNames) ? designSchema.componentNames.map(cleanText) : [])
      ].filter(Boolean).join(" ")
    : "";
  const decompositionText = designDecomposition
    ? [
        cleanText(designDecomposition?.layoutSignature),
        ...(Array.isArray(designDecomposition?.sectionRoles) ? designDecomposition.sectionRoles.map(cleanText) : []),
        ...(Array.isArray(designDecomposition?.layoutTraits) ? designDecomposition.layoutTraits.map(cleanText) : []),
        cleanText(designDecomposition?.styleFamily),
        cleanText(designDecomposition?.footerFamily),
        cleanText(designDecomposition?.directionHint),
        ...(Array.isArray(designDecomposition?.localeHints) ? designDecomposition.localeHints.map(cleanText) : []),
        ...(Array.isArray(designDecomposition?.warnings) ? designDecomposition.warnings.map(cleanText) : [])
      ].filter(Boolean).join(" ")
    : "";
  const mappingText = designMappingHints
    ? [
        cleanText(designMappingHints?.assemblyStrategy),
        cleanText(designMappingHints?.layoutComplexity),
        cleanText(designMappingHints?.styleFamily),
        cleanText(designMappingHints?.footerFamily),
        ...(Array.isArray(designMappingHints?.recommendedBlockArchetypes) ? designMappingHints.recommendedBlockArchetypes.map(cleanText) : []),
        ...(Array.isArray(designMappingHints?.desiredAssetRoles) ? designMappingHints.desiredAssetRoles.map(cleanText) : []),
        ...(Array.isArray(designMappingHints?.missingAssetRoles) ? designMappingHints.missingAssetRoles.map(cleanText) : []),
        ...(Array.isArray(designMappingHints?.warnings) ? designMappingHints.warnings.map(cleanText) : [])
      ].filter(Boolean).join(" ")
    : "";
  const blockRecommendationText = payload?.designBlockRecommendations
    ? [
        ...(Array.isArray(payload.designBlockRecommendations?.recommendedCatalogIds) ? payload.designBlockRecommendations.recommendedCatalogIds.map(cleanText) : []),
        ...(Array.isArray(payload.designBlockRecommendations?.sectionRecommendations)
          ? payload.designBlockRecommendations.sectionRecommendations.flatMap((section) => [
            cleanText(section?.role),
            ...(Array.isArray(section?.candidates) ? section.candidates.map((candidate) => cleanText(candidate?.id)) : [])
          ])
          : [])
      ].filter(Boolean).join(" ")
    : "";

  return [
    cleanText(payload?.brief?.campaignName),
    cleanText(payload?.brief?.category),
    cleanText(payload?.brief?.mailId),
    cleanText(payload?.brief?.goal),
    cleanText(payload?.brief?.audience),
    cleanText(payload?.brief?.tone),
    cleanText(payload?.brief?.contentNotes),
    cleanText(payload?.brief?.primaryCta),
    cleanText(payload?.brief?.primaryLink),
    cleanText(payload?.brief?.designUrl),
    cleanText(extractLatestLogoOverrideUrl(payload)),
    cleanText(getRecentUserTranscript(payload)),
    cleanText(payload?.designAnalysis?.summary),
    cleanText(payload?.designAnalysis?.reference_family),
    cleanText(payload?.designAnalysis?.reference_variant),
    cleanText(payload?.designAnalysis?.brand_hint),
    figmaText,
    schemaText,
    decompositionText,
    mappingText,
    blockRecommendationText,
    ...(Array.isArray(payload?.designAnalysis?.suggested_blocks) ? payload.designAnalysis.suggested_blocks.map(cleanText) : []),
    ...(Array.isArray(payload?.designAnalysis?.content_requirements) ? payload.designAnalysis.content_requirements.map(cleanText) : []),
    ...(Array.isArray(payload?.designAnalysis?.warnings) ? payload.designAnalysis.warnings.map(cleanText) : []),
    translationText,
    currentDraftText
  ].filter(Boolean).join(" ");
}

function collectTemplateSelectionSectionKinds(payload) {
  const fromDecomposition = Array.isArray(payload?.designDecomposition?.sectionRoles)
    ? payload.designDecomposition.sectionRoles.map(cleanText).filter(Boolean)
    : [];
  if (fromDecomposition.length > 0) {
    return fromDecomposition;
  }

  const fromSchema = Array.isArray(payload?.designSchema?.sections)
    ? payload.designSchema.sections.map((section) => cleanText(section?.role)).filter(Boolean)
    : [];
  if (fromSchema.length > 0) {
    return fromSchema;
  }

  const fromDesign = Array.isArray(payload?.designAnalysis?.section_kinds)
    ? payload.designAnalysis.section_kinds.map(cleanText).filter(Boolean)
    : [];
  if (fromDesign.length > 0) {
    return fromDesign;
  }

  return Array.isArray(payload?.currentDraft?.sections)
    ? payload.currentDraft.sections.map((section) => cleanText(section?.kind)).filter(Boolean)
    : [];
}

function scoreCandidateOutlineKinds(candidateKinds, requestedKinds) {
  if (!Array.isArray(candidateKinds) || candidateKinds.length === 0 || !Array.isArray(requestedKinds) || requestedKinds.length === 0) {
    return 0;
  }

  const candidateSet = new Set(candidateKinds);
  const requestedSet = new Set(requestedKinds);
  let score = 0;

  for (const kind of requestedKinds) {
    if (candidateSet.has(kind)) {
      score += 22;
    }
  }

  for (let index = 0; index < Math.min(candidateKinds.length, requestedKinds.length); index += 1) {
    if (candidateKinds[index] === requestedKinds[index]) {
      score += 14;
    }
  }

  if (requestedSet.has("hero") && !candidateSet.has("hero")) {
    score -= 18;
  }

  if (requestedSet.has("feature-list") && !candidateSet.has("feature-list")) {
    score -= 12;
  }

  return score;
}

function findCandidateTemplateFamilyProfiles(templateFamilyProfiles, candidate, structureProfile) {
  const items = Array.isArray(templateFamilyProfiles?.items) ? templateFamilyProfiles.items : [];
  const candidateCategory = cleanText(candidate?.category);
  const candidateMailId = cleanText(candidate?.mailId);
  const structureFamilyKey = cleanText(structureProfile?.familyKey);

  return items.filter((profile) => {
    if (cleanText(profile?.category) && cleanText(profile.category) !== candidateCategory) {
      return false;
    }

    const profileMailIds = new Set([
      cleanText(profile?.defaultMailId),
      ...(Array.isArray(profile?.matchMailIds) ? profile.matchMailIds.map(cleanText) : []),
      ...(Array.isArray(profile?.variants) ? profile.variants.map((variant) => cleanText(variant?.mailId)) : [])
    ].filter(Boolean));
    const profileFamilyKeys = new Set((Array.isArray(profile?.matchFamilyKeys) ? profile.matchFamilyKeys : []).map(cleanText).filter(Boolean));

    if (profileMailIds.has(candidateMailId)) {
      return true;
    }

    if (structureFamilyKey && profileFamilyKeys.has(structureFamilyKey)) {
      return true;
    }

    return false;
  });
}

function scoreFamilyProfilesForCandidate(candidateProfiles, signals, requestedKinds, structureProfile) {
  if (!Array.isArray(candidateProfiles) || candidateProfiles.length === 0) {
    return {
      score: 0,
      reasons: []
    };
  }

  const signalTokens = new Set(Array.isArray(signals?.tokens) ? signals.tokens : []);
  const referenceFamily = normalizeTemplateSelectionText(signals?.referenceFamily);
  const brandHint = normalizeTemplateSelectionText(signals?.brandHint);
  let score = 0;
  const reasons = [];

  for (const profile of candidateProfiles) {
    const profileTokens = extractTemplateSelectionTokens([
      cleanText(profile?.label),
      cleanText(profile?.brand),
      ...(Array.isArray(profile?.aliases) ? profile.aliases : []),
      ...(Array.isArray(profile?.layoutTraits) ? profile.layoutTraits : []),
      cleanText(profile?.footerFamily),
      cleanText(profile?.notes),
      cleanText(profile?.styleNotes)
    ].filter(Boolean).join(" "));

    let profileMatched = false;
    for (const token of profileTokens) {
      if (signalTokens.has(token)) {
        score += token.length >= 6 ? 28 : 16;
        profileMatched = true;
        reasons.push(`profile-token:${token}`);
      }
    }

    const profileLabel = normalizeTemplateSelectionText(profile?.label);
    if (referenceFamily && profileLabel && (referenceFamily.includes(profileLabel) || profileLabel.includes(referenceFamily))) {
      score += 120;
      profileMatched = true;
      reasons.push(`profile:${cleanText(profile?.id || profile?.label)}`);
    }

    const profileBrand = normalizeTemplateSelectionText(profile?.brand);
    if (brandHint && profileBrand && (brandHint.includes(profileBrand) || profileBrand.includes(brandHint))) {
      score += 75;
      profileMatched = true;
      reasons.push(`brand-profile:${cleanText(profile?.brand)}`);
    }

    if (cleanText(structureProfile?.familyKey) && Array.isArray(profile?.matchFamilyKeys) && profile.matchFamilyKeys.includes(cleanText(structureProfile.familyKey))) {
      score += 35;
      reasons.push(`family-profile:${cleanText(structureProfile.familyKey)}`);
    }

    if (profileMatched && Array.isArray(profile?.canonicalStructure) && profile.canonicalStructure.length > 0) {
      const structureScore = Math.round(scoreCandidateOutlineKinds(profile.canonicalStructure, requestedKinds) * 0.5);
      score += structureScore;
      if (structureScore > 0) {
        reasons.push(`profile-structure:${profile.canonicalStructure.join(">")}`);
      }
    }
  }

  return {
    score,
    reasons: Array.from(new Set(reasons)).slice(0, 8)
  };
}

function scoreReferenceCandidate(candidate, signals, requestedKinds, blockCatalog, explicitCategory, mailStructureProfiles, templateFamilyProfiles) {
  const candidateId = cleanText(candidate?.mailId);
  const candidateCategory = cleanText(candidate?.category);
  const normalizedCandidateId = normalizeTemplateSelectionText(candidateId);
  const candidateTokens = extractTemplateSelectionTokens(candidateId);
  const candidateCategoryTokens = extractTemplateSelectionTokens(candidateCategory);
  const signalText = cleanText(signals?.text);
  const signalTextNormalized = normalizeTemplateSelectionText(signalText);
  const signalTokens = new Set(Array.isArray(signals?.tokens) ? signals.tokens : []);
  const outlineKinds = buildCatalogOutlineForMail(blockCatalog, candidateCategory, candidateId)
    .map((section) => cleanText(section?.kind))
    .filter(Boolean);
  const structureProfile = findMailStructureProfile(mailStructureProfiles, candidateCategory, candidateId);
  const structureTokens = new Set(extractTemplateSelectionTokens([
    ...(Array.isArray(structureProfile?.layoutTraits) ? structureProfile.layoutTraits : []),
    ...(Array.isArray(structureProfile?.helperMixins) ? structureProfile.helperMixins : []),
    ...(Array.isArray(structureProfile?.blockIds) ? structureProfile.blockIds : []),
    cleanText(structureProfile?.footerFamily),
    cleanText(structureProfile?.styleFamily)
  ].join(" ")));
  let score = 0;
  const reasons = [];

  if (explicitCategory) {
    if (candidateCategory === explicitCategory) {
      score += 160;
      reasons.push("category match");
    } else {
      score -= 220;
    }
  }

  if (signals?.explicitMailId) {
    const normalizedExplicitMailId = normalizeTemplateSelectionText(signals.explicitMailId);
    if (normalizedExplicitMailId === normalizedCandidateId) {
      score += 1000;
      reasons.push("explicit mailId");
    } else if (normalizedCandidateId && normalizedExplicitMailId.includes(normalizedCandidateId)) {
      score += 240;
      reasons.push("mailId substring match");
    }
  }

  if (normalizedCandidateId && signalTextNormalized.includes(normalizedCandidateId)) {
    score += 220;
    reasons.push("mailId phrase matched request");
  }

  for (const token of candidateTokens) {
    if (signalTokens.has(token)) {
      score += token.length >= 6 ? 40 : 22;
      reasons.push(`token:${token}`);
    }
  }

  for (const token of candidateCategoryTokens) {
    if (signalTokens.has(token)) {
      score += 18;
      reasons.push(`category-token:${token}`);
    }
  }

  const referenceFamily = normalizeTemplateSelectionText(signals?.referenceFamily);
  if (referenceFamily) {
    const familyKey = normalizeTemplateSelectionText(structureProfile?.familyKey);
    if (familyKey && familyKey === referenceFamily) {
      score += 220;
      reasons.push(`family:${cleanText(structureProfile.familyKey)}`);
    }
  }

  const referenceVariantDigits = extractRfmVariantDigits(cleanText(signals?.referenceVariant));
  if (referenceVariantDigits) {
    const profileVariantDigits = cleanText(structureProfile?.visibleVariant).replace(/\D/g, "");
    if (profileVariantDigits === referenceVariantDigits) {
      score += 520;
      reasons.push(`variant:${referenceVariantDigits}`);
    }
  }

  const brandHint = normalizeTemplateSelectionText(signals?.brandHint);
  if (brandHint) {
    if (brandHint.includes("iqoption") && candidateCategory === "X_IQ") {
      score += 90;
      reasons.push("brand:iq-option");
    } else if (brandHint.includes("affstore") && candidateCategory === "X_AffSystem") {
      score += 90;
      reasons.push("brand:affstore");
    }
  }

  const candidateProfiles = findCandidateTemplateFamilyProfiles(templateFamilyProfiles, candidate, structureProfile);
  const profileSignals = scoreFamilyProfilesForCandidate(candidateProfiles, signals, requestedKinds, structureProfile);
  score += profileSignals.score;
  reasons.push(...profileSignals.reasons);

  for (const token of structureTokens) {
    if (signalTokens.has(token)) {
      score += token.length >= 6 ? 26 : 14;
      reasons.push(`layout:${token}`);
    }
  }

  const requestedBlockArchetypes = Array.isArray(signals?.recommendedBlockArchetypes)
    ? signals.recommendedBlockArchetypes.map(cleanText).filter(Boolean)
    : [];
  if (requestedBlockArchetypes.length > 0 && Array.isArray(structureProfile?.blockIds) && structureProfile.blockIds.length > 0) {
    const overlap = requestedBlockArchetypes.filter((blockId) => structureProfile.blockIds.includes(blockId));
    if (overlap.length > 0) {
      score += overlap.length * 34;
      reasons.push(`blocks:${overlap.slice(0, 3).join(",")}`);
    }
  }

  const recommendedCatalogIds = Array.isArray(signals?.recommendedCatalogIds)
    ? signals.recommendedCatalogIds.map(cleanText).filter(Boolean)
    : [];
  if (recommendedCatalogIds.length > 0 && Array.isArray(structureProfile?.blockIds) && structureProfile.blockIds.length > 0) {
    const overlap = recommendedCatalogIds.filter((blockId) => structureProfile.blockIds.includes(blockId));
    if (overlap.length > 0) {
      score += overlap.length * 42;
      reasons.push(`catalog:${overlap.slice(0, 3).join(",")}`);
    }
  }

  if ((structureProfile?.metrics?.columnCount || 1) > 1 && Array.isArray(signals?.layoutTraits)) {
    const requestedMultiColumn = signals.layoutTraits.some((trait) => /(?:^|\b)(2|3|4)-column\b/.test(cleanText(trait)));
    if (requestedMultiColumn) {
      score += 30;
      reasons.push(`columns:${structureProfile.metrics.columnCount}`);
    }
  }

  const requestedLayoutTraits = Array.isArray(signals?.layoutTraits)
    ? signals.layoutTraits.map(cleanText).filter(Boolean)
    : [];
  if (requestedLayoutTraits.length > 0 && Array.isArray(structureProfile?.layoutTraits) && structureProfile.layoutTraits.length > 0) {
    const structureTraits = structureProfile.layoutTraits.map(cleanText).filter(Boolean);
    const overlap = requestedLayoutTraits.filter((trait) => structureTraits.includes(trait));
    if (overlap.length > 0) {
      score += overlap.length * 24;
      reasons.push(`traits:${overlap.slice(0, 3).join(",")}`);
    }
  }

  const desiredAssetRoles = Array.isArray(signals?.desiredAssetRoles)
    ? signals.desiredAssetRoles.map(cleanText).filter(Boolean)
    : [];
  if (desiredAssetRoles.length > 0 && structureProfile?.metrics) {
    const assetRoleMatch = desiredAssetRoles.reduce((acc, role) => {
      if (role === "logo" && structureProfile.metrics.hasLogo) return acc + 1;
      if (role === "badge" && structureProfile.metrics.hasStoreBadges) return acc + 1;
      if (role === "social" && structureProfile.metrics.hasSocialRow) return acc + 1;
      if (role === "background" && structureProfile.metrics.hasBackgroundImage) return acc + 1;
      return acc;
    }, 0);
    if (assetRoleMatch > 0) {
      score += assetRoleMatch * 18;
      reasons.push(`assets:${assetRoleMatch}`);
    }
  }

  score += scoreCandidateOutlineKinds(outlineKinds, requestedKinds);
  if (requestedKinds.length > 0 && outlineKinds.length > 0) {
    const overlap = requestedKinds.filter((kind) => outlineKinds.includes(kind));
    if (overlap.length > 0) {
      reasons.push(`structure:${overlap.join(">")}`);
    }
  }

  if (requestedKinds.length > 0 && outlineKinds.length > 0) {
    score += Math.min(outlineKinds.length, 6);
  }

  const requestedFooterFamily = cleanText(signals?.footerFamily);
  if (requestedFooterFamily && cleanText(structureProfile?.footerFamily) === requestedFooterFamily) {
    score += 45;
    reasons.push(`footer:${requestedFooterFamily}`);
  }

  const requestedStyleFamily = cleanText(signals?.styleFamily);
  if (requestedStyleFamily && cleanText(structureProfile?.styleFamily) === requestedStyleFamily) {
    score += 55;
    reasons.push(`style:${requestedStyleFamily}`);
  }

  const requestedTraits = new Set((Array.isArray(signals?.layoutTraits) ? signals.layoutTraits : []).map(cleanText).filter(Boolean));
  if (requestedTraits.has("background-image") && structureProfile?.metrics?.hasBackgroundImage) {
    score += 34;
    reasons.push("metric:background-image");
  }
  if (requestedTraits.has("dark-background") && structureProfile?.metrics?.hasDarkBackground) {
    score += 24;
    reasons.push("metric:dark-background");
  }
  if (requestedTraits.has("callout-box") && structureProfile?.metrics?.hasCalloutBox) {
    score += 24;
    reasons.push("metric:callout-box");
  }
  if (requestedTraits.has("framed-card") && structureProfile?.metrics?.hasFramedCard) {
    score += 20;
    reasons.push("metric:framed-card");
  }

  return {
    ...candidate,
    score,
    reasons: Array.from(new Set(reasons)).slice(0, 6),
    outlineKinds
  };
}

function readBlockCatalogSnapshot() {
  if (!existsSync(blockCatalogPath)) {
    return { items: [] };
  }

  try {
    const raw = readFileSync(blockCatalogPath, "utf8");
    const parsed = JSON.parse(raw);
    return {
      items: Array.isArray(parsed?.items) ? parsed.items : []
    };
  } catch {
    return { items: [] };
  }
}

function buildSpecialTemplateSelection(payload, sourceText) {
  const source = normalizeTemplateSelectionText(sourceText);
  const resolvedCategory = resolveBriefCategory(payload);
  const inferredRfmDigits = extractRfmVariantDigits(sourceText);
  const inferredRfmMailId = inferRfmReferenceMailId(sourceText);
  const brandHint = normalizeTemplateSelectionText(payload?.designAnalysis?.brand_hint);
  const affPasswordSignal = /(password|reset|login|sign in|signin|create account|парол|сброс|логин|аккаунт|senha|redefinir)/i.test(source);
  const affBrandSignal = brandHint.includes("affstore") || /affstore|affiliate/.test(source);

  if (
    affPasswordSignal
    && (
      cleanText(resolvedCategory) === "X_AffSystem"
      || affBrandSignal
    )
  ) {
    return {
      category: "X_AffSystem",
      mailId: "password-retrieving-affiliate",
      profile: "aff-password-reset",
      score: 5000,
      reasons: ["special profile", "affiliate password reset", affBrandSignal ? "brand:affstore" : ""].filter(Boolean),
      outlineKinds: ["text", "cta", "text", "text", "footer"]
    };
  }

  if (
    isSystemCategoryName(resolvedCategory)
    && /(passbook|verification|verify|document|documents|declin|reject|reason_text|вериф|провер|документ|пасбук|банк)/i.test(source)
  ) {
    return {
      category: "X_IQBroker",
      mailId: "payment-verification-request-pop",
      profile: "system-verification",
      score: 5000,
      reasons: ["special profile", "system verification reference"],
      outlineKinds: ["image", "text", "feature-list", "text", "footer"]
    };
  }

  if (
    (inferredRfmMailId || inferredRfmDigits)
    && (
      cleanText(resolvedCategory) === "X_IQ"
      || /(iq option|iqoption|\brfm\b)/i.test(source)
    )
  ) {
    const resolvedMailId = inferredRfmMailId || getDefaultIqRfmMailId();
    const reasons = ["special profile", "iq rfm reference"];
    if (inferredRfmDigits) {
      if (resolvedMailId === `rfm-${inferredRfmDigits}`) {
        reasons.push(`visible variant ${inferredRfmDigits}`);
      } else {
        reasons.push(`visible variant ${inferredRfmDigits} not found in base`);
      }
    }
    return {
      category: "X_IQ",
      mailId: resolvedMailId,
      profile: "generic",
      score: 4200,
      reasons,
      outlineKinds: ["hero", "feature-list", "text", "cta", "footer"]
    };
  }

  return null;
}

function resolveReferenceTemplateSelection(payload) {
  const summary = summarizeEmailBase();
  const resolvedCategory = resolveBriefCategory(payload);
  const scopedCategory = cleanText(resolvedCategory);
  const explicitMailId = cleanText(payload?.brief?.mailId);
  const sourceText = buildTemplateSelectionSourceText(payload);
  const requestedKinds = collectTemplateSelectionSectionKinds(payload);
  const layoutTraits = dedupeStrings([
    ...(Array.isArray(payload?.designDecomposition?.layoutTraits) ? payload.designDecomposition.layoutTraits : []),
    ...(Array.isArray(payload?.designSchema?.sections)
      ? payload.designSchema.sections
        .map((section) => cleanText(section?.role))
        .filter((role) => ["hero", "feature-list", "cta", "footer"].includes(role))
      : [])
  ]);
  const mappingHints = payload?.designMappingHints && typeof payload.designMappingHints === "object"
    ? payload.designMappingHints
    : null;
  const footerFamilyHint = cleanText(payload?.designAnalysis?.footer_family)
    || cleanText(payload?.designDecomposition?.footerFamily)
    || cleanText(mappingHints?.footerFamily)
    || (layoutTraits.includes("social-row") && layoutTraits.includes("legal-footer") ? "social-legal-footer" : "");
  const styleFamilyHint = cleanText(payload?.designAnalysis?.style_family)
    || cleanText(payload?.designDecomposition?.styleFamily)
    || cleanText(mappingHints?.styleFamily)
    || (layoutTraits.includes("simple-system-layout") ? "simple-transactional-layout" : "");
  const signals = {
    text: sourceText,
    tokens: extractTemplateSelectionTokens(sourceText),
    explicitMailId,
    referenceFamily: cleanText(payload?.designAnalysis?.reference_family),
    referenceVariant: cleanText(payload?.designAnalysis?.reference_variant),
    brandHint: cleanText(payload?.designAnalysis?.brand_hint),
    layoutTraits,
    footerFamily: footerFamilyHint,
    styleFamily: styleFamilyHint,
    recommendedBlockArchetypes: Array.isArray(mappingHints?.recommendedBlockArchetypes) ? mappingHints.recommendedBlockArchetypes : [],
    desiredAssetRoles: Array.isArray(mappingHints?.desiredAssetRoles) ? mappingHints.desiredAssetRoles : [],
    recommendedCatalogIds: Array.isArray(payload?.designBlockRecommendations?.recommendedCatalogIds) ? payload.designBlockRecommendations.recommendedCatalogIds : [],
    layoutComplexity: cleanText(mappingHints?.layoutComplexity),
    directionHint: cleanText(mappingHints?.directionHint)
  };
  const specialSelection = buildSpecialTemplateSelection(payload, sourceText);

  if (specialSelection) {
    return {
      ...specialSelection,
      source: "special-case"
    };
  }

  if (!summary.available) {
    return {
      category: scopedCategory,
      mailId: explicitMailId,
      profile: "generic",
      score: 0,
      reasons: ["email-base unavailable"],
      outlineKinds: [],
      source: "unavailable"
    };
  }

  const candidateCategories = scopedCategory
    ? (summary.categories || []).filter((entry) => cleanText(entry.name) === scopedCategory)
    : (summary.categories || []);
  const categoryFallback = scopedCategory || cleanText(summary.currentMail?.category);
  const blockCatalog = readBlockCatalogSnapshot();
  const mailStructureProfiles = readMailStructureProfilesSnapshot();
  const templateFamilyProfiles = readTemplateFamilyProfilesSnapshot();
  const candidates = candidateCategories.flatMap((category) => (Array.isArray(category.mails) ? category.mails : []).map((mail) => ({
    category: cleanText(category.name),
    mailId: cleanText(mail.id),
    folder: cleanText(mail.folder)
  })));

  if (candidates.length === 0) {
    return {
      category: categoryFallback,
      mailId: explicitMailId || inferMailIdForCategory(categoryFallback),
      profile: "generic",
      score: 0,
      reasons: ["no candidate mails in category"],
      outlineKinds: [],
      source: "fallback"
    };
  }

  const ranked = candidates
    .map((candidate) => scoreReferenceCandidate(candidate, signals, requestedKinds, blockCatalog, scopedCategory, mailStructureProfiles, templateFamilyProfiles))
    .sort((left, right) => right.score - left.score || left.mailId.localeCompare(right.mailId));
  const winner = ranked[0];

  if (winner && winner.score > 0) {
    return {
      category: winner.category,
      mailId: winner.mailId,
      profile: "generic",
      score: winner.score,
      reasons: winner.reasons,
      outlineKinds: winner.outlineKinds,
      source: "scored"
    };
  }

  return {
    category: categoryFallback,
    mailId: explicitMailId || inferMailIdForCategory(categoryFallback),
    profile: "generic",
    score: winner?.score || 0,
    reasons: winner?.reasons?.length ? winner.reasons : ["fallback to category default"],
    outlineKinds: winner?.outlineKinds || [],
    source: "fallback"
  };
}

function getReferenceTemplateSelection(payload) {
  const selection = payload?.templateSelection;
  if (selection && typeof selection === "object" && cleanText(selection.category) && cleanText(selection.mailId)) {
    return selection;
  }

  return resolveReferenceTemplateSelection(payload);
}

function summarizeTemplateSelectionForContext(selection) {
  if (!selection || (!cleanText(selection.category) && !cleanText(selection.mailId))) {
    return "Reference template: not selected.";
  }

  const reference = cleanText(selection.category) && cleanText(selection.mailId)
    ? `${selection.category}/mail-${selection.mailId}`
    : cleanText(selection.category) || cleanText(selection.mailId) || "unknown";
  const reasons = Array.isArray(selection.reasons) && selection.reasons.length > 0
    ? selection.reasons.join("; ")
    : "no clear reasons";
  const outline = Array.isArray(selection.outlineKinds) && selection.outlineKinds.length > 0
    ? selection.outlineKinds.join(" > ")
    : "no catalog outline";

  return `Reference template: ${reference} | profile=${cleanText(selection.profile) || "generic"} | source=${cleanText(selection.source) || "unknown"} | score=${Math.round(Number(selection.score) || 0)} | reasons=${reasons} | outline=${outline}`;
}

function resolveReferenceTemplateMailTarget(payload) {
  const selection = getReferenceTemplateSelection(payload);
  return {
    category: cleanText(selection?.category) || resolveBriefCategory(payload, summarizeEmailBase().currentMail?.category || ""),
    mailId: cleanText(selection?.mailId) || cleanText(payload?.brief?.mailId) || inferMailIdForCategory(cleanText(selection?.category) || resolveBriefCategory(payload))
  };
}

function inferServerIntent(payload, fallbackIntent = "") {
  const latestUserMessage = cleanText(getLatestPayloadMessage(payload, "user")).toLowerCase();
  const previousAssistantMessage = cleanText(getLatestPayloadMessage(payload, "assistant")).toLowerCase();

  if (!latestUserMessage) {
    return cleanText(fallbackIntent) || "draft";
  }

  const containsDraftSignal = [
    "сверстай", "сверстаем", "сверстать", "верстай", "переверстай", "собери", "соберем", "собрать",
    "сделай", "сделаем", "добавь", "добавим", "измени", "обнови", "убери", "замени", "подставь",
    "примени", "начинай", "начнем", "поехали", "делай", "build", "apply", "update", "generate", "layout", "draft"
  ].some((token) => latestUserMessage.includes(token));

  const applyPatterns = [
    /(нужно|надо)\s+(собрать|сделать|сверстать|обновить|добавить|переверстать)/i,
    /\b(build|apply|update|change|add|remove|replace|generate|layout|draft)\b/i,
    /\b\d+\s*(колонк|колонки|columns?|картинк|изображени|images?)\b/i
  ];

  const confirmationPatterns = [
    /^(да|ага|ок|окей|хорошо|верно|подтверждаю|можешь|начинай|делай|поехали|вперед|yes|go ahead)/i
  ];

  if (containsDraftSignal || applyPatterns.some((pattern) => pattern.test(latestUserMessage))) {
    return "draft";
  }

  if (
    confirmationPatterns.some((pattern) => pattern.test(latestUserMessage))
    && /(собер|сдела|сверст|черновик|draft|верстк|код|макет|письм)/i.test(previousAssistantMessage)
  ) {
    return "draft";
  }

  const discussPatterns = [
    /[?]\s*$/i,
    /^(что|как|почему|зачем|где|когда|чем|можно|подскажи|расскажи|какие)\b/i,
    /\b(обсудим|объясни|explain|why|what|how)\b/i
  ];

  if (discussPatterns.some((pattern) => pattern.test(latestUserMessage))) {
    return "discuss";
  }

  return cleanText(fallbackIntent) || "draft";
}

function extractLatestLogoOverrideUrl(payload) {
  const messages = [...(Array.isArray(payload?.messages) ? payload.messages : [])]
    .filter((message) => message.role === "user")
    .reverse();

  for (const message of messages) {
    const content = cleanText(message.content);
    if (!/(лого|logo)/i.test(content)) {
      continue;
    }
    const imageUrl = extractUrlsFromText(content).find(looksLikeImageUrl);
    if (imageUrl) {
      return imageUrl;
    }
  }

  return "";
}

function extractRequestedBoldPhrases(payload) {
  const messages = [...(Array.isArray(payload?.messages) ? payload.messages : [])]
    .filter((message) => message.role === "user")
    .reverse();
  const phrases = [];
  const patterns = [
    /сделай(?:\s+надпись)?\s+[«"']?([^,"'»]+?)[»"']?\s*,?\s*жирн(?:ой|ым)/i,
    /сделай(?:\s+надпись)?\s+[«"']?(.+?)[»"']?\s+жирн(?:ой|ым)/i,
    /make(?:\s+the)?(?:\s+text)?\s+[“"'`]?(.+?)[”"'`]?\s+bold/i,
    /bold(?:\s+the)?(?:\s+text)?\s+[“"'`]?(.+?)[”"'`]?$/i
  ];

  for (const message of messages) {
    const content = cleanText(message.content);
    for (const pattern of patterns) {
      const match = content.match(pattern);
      if (!match?.[1]) {
        continue;
      }
      const phrase = cleanText(match[1])
        .replace(/\s+(?:и|and)\s+(?:используй|use)\b.*$/i, "")
        .replace(/\s+https?:\/\/\S+$/i, "")
        .replace(/[.]+$/g, "");
      if (phrase) {
        phrases.push(phrase);
      }
    }
  }

  return Array.from(new Set(phrases));
}

function normalizeAssetInputs(payload) {
  if (Array.isArray(payload?.assetInputs) && payload.assetInputs.length > 0) {
    return payload.assetInputs
      .map((asset, index) => ({
        id: cleanText(asset?.id) || `asset-${index + 1}`,
        key: cleanText(asset?.key) || `asset_${index + 1}`,
        url: cleanText(asset?.url),
        alt: cleanText(asset?.alt),
        placement: cleanText(asset?.placement) || "auto",
        notes: cleanText(asset?.notes),
        libraryId: cleanText(asset?.libraryId),
        downloadUrl: cleanText(asset?.downloadUrl)
      }))
      .filter((asset) => asset.url || asset.key || asset.notes);
  }

  if (Array.isArray(payload?.assetLinks)) {
    return payload.assetLinks
      .map((url, index) => ({
        id: `asset-${index + 1}`,
        key: index === 0 ? "hero_asset" : `asset_${index + 1}`,
        url: cleanText(url),
        alt: "",
        placement: index === 0 ? "hero" : "section",
        notes: ""
      }))
      .filter((asset) => asset.url);
  }

  return [];
}

function normalizeShortTextList(values, limit = 8, maxLength = 180) {
  if (!Array.isArray(values)) {
    return [];
  }

  return Array.from(new Set(values
    .map((value) => cleanText(value).slice(0, maxLength))
    .filter(Boolean)))
    .slice(0, limit);
}

function normalizePositiveInt(value) {
  const numeric = Number.parseInt(value, 10);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}

function normalizeFigmaImportPayload(figmaImport) {
  if (!figmaImport || typeof figmaImport !== "object") {
    return null;
  }

  const normalized = {
    source: cleanText(figmaImport.source) || "figma-json",
    fileKey: cleanText(figmaImport.fileKey),
    nodeId: cleanText(figmaImport.nodeId),
    selectionName: cleanText(figmaImport.selectionName),
    pageName: cleanText(figmaImport.pageName),
    layerCount: normalizePositiveInt(figmaImport.layerCount),
    textLayerCount: normalizePositiveInt(figmaImport.textLayerCount),
    imageFillCount: normalizePositiveInt(figmaImport.imageFillCount),
    layerNames: normalizeShortTextList(figmaImport.layerNames, 12, 80),
    textSamples: normalizeShortTextList(figmaImport.textSamples, 6, 180),
    exportUrls: normalizeShortTextList(figmaImport.exportUrls, 6, 400),
    localeHints: Array.isArray(figmaImport.localeHints)
      ? normalizeShortTextList(figmaImport.localeHints, 16, 60)
      : [],
    directionHint: cleanText(figmaImport.directionHint),
    frameSize: figmaImport.frameSize && typeof figmaImport.frameSize === "object"
      ? {
          width: normalizePositiveInt(figmaImport.frameSize.width),
          height: normalizePositiveInt(figmaImport.frameSize.height)
        }
      : null,
    styles: figmaImport.styles && typeof figmaImport.styles === "object"
      ? { ...figmaImport.styles }
      : null,
    tokens: figmaImport.tokens && typeof figmaImport.tokens === "object"
      ? { ...figmaImport.tokens }
      : null,
    previewImage: figmaImport.previewImage && typeof figmaImport.previewImage === "object"
      ? {
          mimeType: cleanText(figmaImport.previewImage.mimeType),
          url: cleanText(figmaImport.previewImage.url),
          dataUrl: cleanText(figmaImport.previewImage.dataUrl)
        }
      : null,
    componentNames: Array.isArray(figmaImport.componentNames)
      ? normalizeShortTextList(figmaImport.componentNames, 24, 120)
      : [],
    sections: Array.isArray(figmaImport.sections)
      ? figmaImport.sections
          .filter((section) => section && typeof section === "object")
          .slice(0, 30)
          .map((section, index) => ({
            id: cleanText(section.id) || `figma-sec-${index + 1}`,
            role: cleanText(section.role || section.kind || section.roleHint),
            name: cleanText(section.name || section.title),
            x: Number.isFinite(Number(section.x)) ? Number(section.x) : 0,
            y: Number.isFinite(Number(section.y)) ? Number(section.y) : 0,
            width: Number.isFinite(Number(section.width)) ? Number(section.width) : 0,
            height: Number.isFinite(Number(section.height)) ? Number(section.height) : 0,
            columnCount: Number.isFinite(Number(section.columnCount)) ? Number(section.columnCount) : 0,
            archetype: cleanText(section.archetype),
            componentName: cleanText(section.componentName || section.component_name),
            children: Array.isArray(section.children) ? section.children.map(cleanText).filter(Boolean).slice(0, 40) : [],
            style: section.style && typeof section.style === "object" ? { ...section.style } : {},
            summaryText: cleanText(section.summaryText || section.body || section.layoutNotes || section.layout_notes)
          }))
      : [],
    texts: Array.isArray(figmaImport.texts) || Array.isArray(figmaImport.textNodes)
      ? (Array.isArray(figmaImport.texts) ? figmaImport.texts : figmaImport.textNodes)
          .filter((node) => node && typeof node === "object")
          .slice(0, 160)
          .map((node, index) => ({
            id: cleanText(node.id) || `figma-txt-${index + 1}`,
            roleHint: cleanText(node.roleHint || node.role || node.kind),
            text: cleanText(node.text || node.characters || node.value),
            x: Number.isFinite(Number(node.x)) ? Number(node.x) : 0,
            y: Number.isFinite(Number(node.y)) ? Number(node.y) : 0,
            width: Number.isFinite(Number(node.width)) ? Number(node.width) : 0,
            height: Number.isFinite(Number(node.height)) ? Number(node.height) : 0,
            fontFamily: cleanText(node.fontFamily),
            fontSize: Number.isFinite(Number(node.fontSize)) ? Number(node.fontSize) : 0,
            fontWeight: Number.isFinite(Number(node.fontWeight)) ? Number(node.fontWeight) : 0,
            lineHeight: cleanText(node.lineHeight),
            letterSpacing: cleanText(node.letterSpacing),
            align: cleanText(node.align || node.textAlign),
            direction: cleanText(node.direction),
            textCase: cleanText(node.textCase),
            color: cleanText(node.color || node.fill),
            sectionId: cleanText(node.sectionId)
          }))
      : [],
    images: Array.isArray(figmaImport.images) || Array.isArray(figmaImport.imageSlots)
      ? (Array.isArray(figmaImport.images) ? figmaImport.images : figmaImport.imageSlots)
          .filter((image) => image && typeof image === "object")
          .slice(0, 80)
          .map((image, index) => ({
            id: cleanText(image.id) || `figma-img-${index + 1}`,
            roleHint: cleanText(image.roleHint || image.role || image.placement),
            name: cleanText(image.name || image.label),
            x: Number.isFinite(Number(image.x)) ? Number(image.x) : 0,
            y: Number.isFinite(Number(image.y)) ? Number(image.y) : 0,
            width: Number.isFinite(Number(image.width)) ? Number(image.width) : 0,
            height: Number.isFinite(Number(image.height)) ? Number(image.height) : 0,
            sectionId: cleanText(image.sectionId),
            alt: cleanText(image.alt || image.description),
            componentName: cleanText(image.componentName || image.component_name),
            imageHash: cleanText(image.imageHash || image.image_hash),
            exportRef: cleanText(image.exportRef || image.export_ref),
            isBackground: Boolean(image.isBackground || image.background),
            assetSource: image.assetSource && typeof image.assetSource === "object"
              ? { ...image.assetSource }
              : {
                  kind: cleanText(image.assetKind),
                  mimeType: cleanText(image.mimeType),
                  url: cleanText(image.url || image.exportUrl),
                  dataUrl: cleanText(image.dataUrl)
                }
          }))
      : []
  };

  if (
    !normalized.fileKey
    && !normalized.nodeId
    && !normalized.selectionName
    && !normalized.pageName
    && normalized.layerCount === 0
    && normalized.textLayerCount === 0
    && normalized.imageFillCount === 0
    && normalized.layerNames.length === 0
    && normalized.textSamples.length === 0
    && normalized.exportUrls.length === 0
    && normalized.componentNames.length === 0
    && normalized.sections.length === 0
    && normalized.texts.length === 0
    && normalized.images.length === 0
    && normalized.localeHints.length === 0
    && !normalized.directionHint
    && !normalized.styles
    && !normalized.tokens
    && !normalized.previewImage
  ) {
    return null;
  }

  return normalized;
}

function hasDetailedFigmaImportPayload(figmaImport) {
  const normalized = normalizeFigmaImportPayload(figmaImport);
  if (!normalized) {
    return false;
  }

  return Boolean(
    cleanText(normalized.pageName)
    || normalized.layerCount > 0
    || normalized.textLayerCount > 0
    || normalized.imageFillCount > 0
    || normalized.layerNames.length > 0
    || normalized.textSamples.length > 0
    || normalized.exportUrls.length > 0
    || normalized.componentNames.length > 0
    || normalized.sections.length > 0
    || normalized.texts.length > 0
    || normalized.images.length > 0
    || normalized.localeHints.length > 0
    || Boolean(normalized.directionHint)
    || Boolean(normalized.styles)
    || Boolean(normalized.tokens)
    || Boolean(normalized.previewImage?.dataUrl || normalized.previewImage?.url)
  );
}

function normalizeDesignPayload(design) {
  if (!design || typeof design !== "object") {
    return null;
  }

  const dataUrl = cleanText(design.dataUrl);
  const name = cleanText(design.name);
  const assetId = cleanText(design.assetId);
  const normalizedFigmaImport = normalizeFigmaImportPayload(design.figmaImport);
  const figmaFileKey = cleanText(design.figmaFileKey) || cleanText(normalizedFigmaImport?.fileKey);
  const figmaNodeId = cleanText(design.figmaNodeId) || cleanText(normalizedFigmaImport?.nodeId);
  const figmaSelectionName = cleanText(design.figmaSelectionName) || cleanText(normalizedFigmaImport?.selectionName);

  if (!dataUrl && !name && !assetId && !figmaFileKey && !figmaNodeId && !figmaSelectionName && !normalizedFigmaImport) {
    return null;
  }

  return {
    name: name || figmaSelectionName || "design-reference",
    dataUrl,
    assetId,
    figmaFileKey,
    figmaNodeId,
    figmaSelectionName,
    figmaImport: normalizedFigmaImport,
    meta: design.meta && typeof design.meta === "object"
      ? { ...design.meta }
      : null,
    brandTheme: design.brandTheme && typeof design.brandTheme === "object"
      ? { ...design.brandTheme }
      : null
  };
}

function hasDesignInput(payload) {
  const design = normalizeDesignPayload(payload?.design);
  return Boolean(
    cleanText(payload?.brief?.designUrl)
    || cleanText(design?.dataUrl)
    || cleanText(design?.assetId)
    || cleanText(design?.figmaFileKey)
    || cleanText(design?.figmaNodeId)
    || cleanText(design?.figmaSelectionName)
    || design?.figmaImport
  );
}

function hasFigmaReferenceLink(payload) {
  return /figma\.com/i.test(cleanText(payload?.brief?.designUrl));
}

function hasVisualDesignInput(payload) {
  const design = normalizeDesignPayload(payload?.design);
  const designUrl = cleanText(payload?.brief?.designUrl);
  return Boolean(cleanText(design?.dataUrl) || looksLikeImageUrl(designUrl));
}

function hasStructuredFigmaInput(payload) {
  const design = normalizeDesignPayload(payload?.design);
  return hasDetailedFigmaImportPayload(design?.figmaImport);
}

function needsFigmaAccessClarification(payload) {
  return hasFigmaReferenceLink(payload) && !hasVisualDesignInput(payload) && !hasStructuredFigmaInput(payload);
}

function isDraftBlockedByInaccessibleFigma(payload) {
  return needsFigmaAccessClarification(payload)
    && !(Array.isArray(payload?.currentDraft?.sections) && payload.currentDraft.sections.length > 0);
}

function buildFigmaAccessBlockedAssistantReply(payload) {
  const hasRussianResponse = detectPreferredResponseLanguage(payload) === "Russian";
  const latestUserMessage = cleanText(getLatestPayloadMessage(payload, "user")).toLowerCase();

  if (/(как|где).*(share|draft|open).*(link|ссыл)|как.*открыть.*доступ|how.*(share|open draft).*(link|access)/i.test(latestUserMessage)) {
    if (hasRussianResponse) {
      return [
        "В Figma это делается так: выдели нужный frame, нажми Share справа сверху, открой доступ `Anyone with the link can view`, затем скопируй ссылку на frame.",
        "Если публичный доступ давать нельзя, проще не возиться с link: нажми `Copy/Paste as -> Copy as PNG` и вставь скрин сюда."
      ].join(" ");
    }

    return [
      "In Figma: select the frame, click Share in the top-right corner, switch it to `Anyone with the link can view`, then copy the link.",
      "If public access is not allowed, the easier path is `Copy/Paste as -> Copy as PNG` and paste the screenshot here."
    ].join(" ");
  }

  if (hasRussianResponse) {
    return [
      "Сейчас у меня есть только ссылка на приватный Figma frame, самого макета я не вижу.",
      "Чтобы собрать письмо по вашей базе, пришли либо open draft/share link на этот frame, либо PNG/JPG export этого frame.",
      "Если нужен share link: в Figma выдели frame, нажми `Share`, включи `Anyone with the link can view` и скопируй ссылку на этот frame.",
      "Тексты и ссылки можно пока оставить пустыми: сначала соберу структуру, потом добьем локали и картинки."
    ].join(" ");
  }

  return [
    "Right now I only have a private Figma frame link, not the actual layout.",
    "To build the email on top of your base, send either an open draft/share link for that frame or a PNG/JPG export of it.",
    "Copy and links can stay empty for now: first I will assemble the structure, then we can fill in locales and images."
  ].join(" ");
}

function createFigmaAccessBlockedResponse(payload, providerId, mode) {
  return {
    assistantReply: buildFigmaAccessBlockedAssistantReply(payload),
    mode,
    clearDraft: true,
    providerRuntime: createProviderRuntime({
      providerId,
      mode
    })
  };
}

function pickFirstNonEmptyString(values = []) {
  for (const value of values) {
    const normalized = cleanText(value);
    if (normalized) {
      return normalized;
    }
  }
  return "";
}

function pickFirstArray(values = []) {
  for (const value of values) {
    if (Array.isArray(value) && value.length > 0) {
      return value;
    }
  }
  return [];
}

function getFigmaImportCorsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Figma-Import-Secret"
  };
}

function readFigmaImportSecret(payload, request) {
  return pickFirstNonEmptyString([
    request?.headers?.["x-figma-import-secret"],
    payload?.secret,
    payload?.importSecret
  ]);
}

function isFigmaImportAuthorized(payload, request) {
  if (!figmaImportSecret) {
    return true;
  }

  return readFigmaImportSecret(payload, request) === figmaImportSecret;
}

function normalizeFigmaPluginRequest(payload) {
  const parsedReference = parseFigmaReferenceUrl(pickFirstNonEmptyString([
    payload?.designUrl,
    payload?.frameUrl,
    payload?.frame_url,
    payload?.url,
    payload?.figmaUrl,
    payload?.figma_url,
    payload?.frame?.url
  ]));
  const figmaImportSource = payload?.figmaImport && typeof payload.figmaImport === "object"
    ? payload.figmaImport
    : payload;
  const designUrl = pickFirstNonEmptyString([
    parsedReference?.url,
    payload?.designUrl,
    payload?.frameUrl,
    payload?.frame_url,
    payload?.url,
    payload?.figmaUrl,
    payload?.figma_url
  ]);
  const imageUrl = pickFirstNonEmptyString([
    payload?.dataUrl,
    payload?.imageUrl,
    payload?.image_url,
    payload?.screenshotUrl,
    payload?.screenshot_url,
    payload?.previewUrl,
    payload?.preview_url
  ]);
  const normalizedImageUrl = looksLikeImageUrl(imageUrl) ? imageUrl : "";
  const normalizedFigmaImport = normalizeFigmaImportPayload({
    source: pickFirstNonEmptyString([figmaImportSource?.source, "figma-plugin"]),
    fileKey: pickFirstNonEmptyString([figmaImportSource?.fileKey, figmaImportSource?.file_key, figmaImportSource?.meta?.fileKey, parsedReference?.fileKey]),
    nodeId: normalizeFigmaNodeId(pickFirstNonEmptyString([figmaImportSource?.nodeId, figmaImportSource?.node_id, figmaImportSource?.meta?.nodeId, parsedReference?.nodeId])),
    selectionName: pickFirstNonEmptyString([figmaImportSource?.selectionName, figmaImportSource?.selection?.name, figmaImportSource?.meta?.selectionName, payload?.name, parsedReference?.selectionName]),
    pageName: pickFirstNonEmptyString([figmaImportSource?.pageName, figmaImportSource?.selection?.pageName, figmaImportSource?.meta?.pageName]),
    layerCount: figmaImportSource?.layerCount,
    textLayerCount: figmaImportSource?.textLayerCount,
    imageFillCount: figmaImportSource?.imageFillCount,
    layerNames: pickFirstArray([figmaImportSource?.layerNames, figmaImportSource?.layers?.map?.((layer) => layer?.name)]),
    textSamples: pickFirstArray([figmaImportSource?.textSamples, figmaImportSource?.texts]),
    exportUrls: pickFirstArray([figmaImportSource?.exportUrls, figmaImportSource?.imageUrls]),
    frameSize: figmaImportSource?.frameSize,
    styles: figmaImportSource?.styles,
    tokens: figmaImportSource?.tokens,
    previewImage: figmaImportSource?.previewImage && typeof figmaImportSource.previewImage === "object"
      ? figmaImportSource.previewImage
      : normalizedImageUrl
        ? { dataUrl: normalizedImageUrl }
        : null,
    componentNames: pickFirstArray([figmaImportSource?.componentNames, figmaImportSource?.components?.map?.((component) => component?.name)]),
    sections: pickFirstArray([figmaImportSource?.sections]),
    texts: pickFirstArray([figmaImportSource?.texts, figmaImportSource?.textNodes]),
    images: pickFirstArray([figmaImportSource?.images, figmaImportSource?.imageSlots])
  });
  const figmaImport = hasDetailedFigmaImportPayload(normalizedFigmaImport) ? normalizedFigmaImport : null;
  const design = normalizeDesignPayload({
    name: pickFirstNonEmptyString([
      payload?.name,
      normalizedFigmaImport?.selectionName,
      parsedReference?.selectionName,
      "figma-frame"
    ]),
    dataUrl: normalizedImageUrl,
    assetId: "",
    meta: {
      fileKey: pickFirstNonEmptyString([payload?.fileKey, normalizedFigmaImport?.fileKey, parsedReference?.fileKey]),
      frameId: normalizeFigmaNodeId(pickFirstNonEmptyString([payload?.nodeId, normalizedFigmaImport?.nodeId, parsedReference?.nodeId])),
      frameName: pickFirstNonEmptyString([payload?.selectionName, normalizedFigmaImport?.selectionName, parsedReference?.selectionName, payload?.name]),
      pageName: pickFirstNonEmptyString([payload?.pageName, normalizedFigmaImport?.pageName]),
      width: normalizedFigmaImport?.frameSize?.width || payload?.frameSize?.width,
      height: normalizedFigmaImport?.frameSize?.height || payload?.frameSize?.height
    },
    figmaFileKey: pickFirstNonEmptyString([payload?.fileKey, normalizedFigmaImport?.fileKey, parsedReference?.fileKey]),
    figmaNodeId: normalizeFigmaNodeId(pickFirstNonEmptyString([payload?.nodeId, normalizedFigmaImport?.nodeId, parsedReference?.nodeId])),
    figmaSelectionName: pickFirstNonEmptyString([payload?.selectionName, normalizedFigmaImport?.selectionName, parsedReference?.selectionName]),
    figmaImport
  });
  const designSchema = buildInternalDesignSchema({
    briefDesignUrl: designUrl,
    design
  });
  const hasLink = Boolean(designUrl);
  const hasVisual = Boolean(normalizedImageUrl);
  const hasStructured = hasDetailedFigmaImportPayload(figmaImport);
  const mode = hasLink && hasVisual && hasStructured
    ? "frame-link + screenshot/export + structured push"
    : hasLink && hasVisual
      ? "frame-link + screenshot/export"
      : hasLink && hasStructured
        ? "frame-link + structured push"
        : hasStructured && hasVisual
          ? "screenshot/export + structured push"
          : hasStructured
            ? "structured push only"
            : hasVisual
              ? "screenshot/export only"
              : hasLink
                ? "frame-link only"
                : "unknown";
  const recommendedNextStep = hasLink && !hasVisual && !hasStructured
    ? "Next step: if the frame is private, send an open draft/share link or attach a screenshot/export."
    : hasStructured && !hasVisual
      ? "Next step: attach a screenshot/export too if you want pixel-level vision and visual preview."
      : hasVisual && !hasStructured && !hasLink
        ? "Next step: this already works for simple letters. Add a frame link only if you want extra reference context."
        : hasLink || hasVisual || hasStructured
          ? "Intake accepted."
          : "No usable Figma intake data detected.";

  return {
    design,
    designSchema,
    briefPatch: {
      designUrl
    },
    intake: {
      mode,
      hasLink,
      hasVisual,
      hasStructured,
      recommendedNextStep
    }
  };
}

function findFirstFigmaUrlInPayload(payload) {
  const directCandidates = [
    payload?.brief?.designUrl,
    payload?.designUrl,
    payload?.frameUrl,
    payload?.url,
    payload?.figmaUrl,
    payload?.design?.meta?.url
  ]
    .map(cleanText)
    .filter((value) => /figma\.com/i.test(value));

  if (directCandidates.length > 0) {
    return directCandidates[0];
  }

  const messages = Array.isArray(payload?.messages) ? payload.messages : [];
  for (const message of messages) {
    const content = typeof message?.content === "string"
      ? message.content
      : Array.isArray(message?.content)
        ? message.content.map((part) => cleanText(part?.text || part?.content || "")).join(" ")
        : "";
    const urls = extractUrlsFromText(content);
    const figmaUrl = urls.find((url) => /figma\.com/i.test(url));
    if (figmaUrl) {
      return figmaUrl;
    }
  }

  return "";
}

async function tryBuildServerSideFigmaImport(figmaUrl) {
  const normalizedUrl = cleanText(figmaUrl);
  if (!normalizedUrl || !figmaApiToken || !/figma\.com/i.test(normalizedUrl)) {
    return null;
  }

  const parsed = parseFigmaReferenceUrl(normalizedUrl);
  if (!cleanText(parsed?.fileKey)) {
    return null;
  }

  try {
    return await buildFigmaImportFromUrl(normalizedUrl, figmaApiToken, {
      format: "png",
      scale: 2,
      imageLimit: 18
    });
  } catch {
    return null;
  }
}

async function enrichPayloadWithServerSideFigma(payload) {
  if (!payload || typeof payload !== "object") {
    return payload;
  }

  const existingDesign = normalizeDesignPayload(payload.design);
  if (hasDetailedFigmaImportPayload(existingDesign?.figmaImport)) {
    return payload;
  }

  const figmaUrl = findFirstFigmaUrlInPayload(payload);
  if (!figmaUrl) {
    return payload;
  }

  const structuredImport = await tryBuildServerSideFigmaImport(figmaUrl);
  if (!structuredImport) {
    return payload;
  }

  const mergedDesign = normalizeDesignPayload({
    ...(existingDesign || {}),
    name: cleanText(existingDesign?.name) || cleanText(structuredImport.selectionName) || "figma-frame",
    dataUrl: cleanText(existingDesign?.dataUrl) || cleanText(structuredImport?.previewImage?.url) || cleanText(structuredImport?.previewImage?.dataUrl),
    figmaFileKey: cleanText(existingDesign?.figmaFileKey) || cleanText(structuredImport.fileKey),
    figmaNodeId: cleanText(existingDesign?.figmaNodeId) || cleanText(structuredImport.nodeId),
    figmaSelectionName: cleanText(existingDesign?.figmaSelectionName) || cleanText(structuredImport.selectionName),
    figmaImport: {
      ...(existingDesign?.figmaImport && typeof existingDesign.figmaImport === "object" ? existingDesign.figmaImport : {}),
      ...structuredImport
    }
  });

  return hydratePayloadTemplateSelection({
    ...payload,
    brief: {
      ...(payload.brief && typeof payload.brief === "object" ? payload.brief : {}),
      designUrl: cleanText(payload?.brief?.designUrl) || figmaUrl
    },
    design: mergedDesign,
    figmaEnrichment: {
      source: "server-token-link-import",
      figmaUrl,
      structured: true
    }
  });
}

function filterDesignAssetInputs(assetInputs, design) {
  const normalizedDesign = normalizeDesignPayload(design);
  if (!normalizedDesign) {
    return assetInputs;
  }

  const designUrl = cleanText(normalizedDesign.dataUrl);
  const designAssetId = cleanText(normalizedDesign.assetId);

  return assetInputs.filter((asset) => {
    const assetUrl = cleanText(asset?.url);
    const assetLibraryId = cleanText(asset?.libraryId);
    return !(
      (designUrl && assetUrl && designUrl === assetUrl)
      || (designAssetId && assetLibraryId && designAssetId === assetLibraryId)
    );
  });
}

function normalizeAssetLibraryItems(payload) {
  if (!Array.isArray(payload?.assetRegistryItems)) {
    return [];
  }

  return payload.assetRegistryItems
    .map((item, index) => normalizeAssetRegistryEntry({
      id: cleanText(item?.id) || `library-${index + 1}`,
      kind: cleanText(item?.kind) || "asset",
      label: cleanText(item?.label),
      fileName: cleanText(item?.fileName),
      localUrl: cleanText(item?.localUrl),
      externalUrl: cleanText(item?.externalUrl),
      preferredUrl: cleanText(item?.preferredUrl) || cleanText(item?.externalUrl) || cleanText(item?.localUrl),
      alt: cleanText(item?.alt),
      notes: cleanText(item?.notes),
      placement: cleanText(item?.placement) || "auto",
      key: cleanText(item?.key),
      mimeType: cleanText(item?.mimeType),
      size: Number(item?.size) || 0,
      createdAt: cleanText(item?.createdAt),
      updatedAt: cleanText(item?.updatedAt)
    }))
    .filter((item) => item.preferredUrl || item.localUrl);
}

function isSystemCategoryName(categoryName = "") {
  return cleanText(categoryName) === "X_System";
}

function isScreenshotLikeText(value = "") {
  const text = cleanText(value).toLowerCase();
  return /(screenshot|screen shot|screen-|скрин|снимок экрана|image \d+|img_\d+)/i.test(text);
}

function isLikelyLogoLibraryItem(item) {
  const placement = cleanText(item?.placement).toLowerCase();
  if (placement === "logo") {
    return true;
  }

  const source = [
    cleanText(item?.label),
    cleanText(item?.fileName),
    cleanText(item?.alt),
    cleanText(item?.notes),
    cleanText(item?.key)
  ].join(" ").toLowerCase();

  return /logo|brand|header/i.test(source) && !isScreenshotLikeText(source);
}

function isDesignEquivalentLibraryItem(item, payload) {
  const design = normalizeDesignPayload(payload?.design);
  if (!design || !item) {
    return false;
  }

  const designUrl = cleanText(design.dataUrl);
  const designAssetId = cleanText(design.assetId);
  const designName = cleanText(design.name).toLowerCase();
  const itemId = cleanText(item.id);
  const itemUrl = cleanText(item.preferredUrl) || cleanText(item.localUrl);
  const itemLabel = cleanText(item.label).toLowerCase();
  const itemFileName = cleanText(item.fileName).toLowerCase();

  return Boolean(
    cleanText(item.kind) === "design"
    || (designAssetId && itemId === designAssetId)
    || (designUrl && itemUrl && designUrl === itemUrl)
    || (designName && (itemLabel === designName || itemFileName.endsWith(designName)))
  );
}

function filterAssetLibraryItemsForContent(items, payload) {
  const filtered = (Array.isArray(items) ? items : []).filter((item) => !isDesignEquivalentLibraryItem(item, payload));
  if (!isSystemCategoryName(resolveBriefCategory(payload))) {
    return filtered;
  }
  return filtered.filter(isLikelyLogoLibraryItem);
}

function extractAssetNameFromUrl(url) {
  const raw = cleanText(url);
  if (!raw) {
    return "";
  }

  try {
    const parsed = new URL(raw);
    return path.basename(parsed.pathname, path.extname(parsed.pathname));
  } catch {
    const fileName = raw.split("/").pop() || "";
    return fileName.replace(/\.[a-z0-9]+$/i, "");
  }
}

function isGenericAssetKey(key) {
  const normalized = cleanText(key);
  return !normalized || /^asset[_-]?\d+$/i.test(normalized) || normalized === "hero_asset";
}

function inferAssetPlacement(asset, index = 0) {
  const signal = [
    asset?.notes,
    asset?.key,
    asset?.alt,
    extractAssetNameFromUrl(asset?.url)
  ].map(cleanText).join(" ").toLowerCase();

  if (/(logo|brand|brandmark|wordmark|icon)/i.test(signal)) {
    return "logo";
  }

  if (/(footer|legal|social|unsubscribe)/i.test(signal)) {
    return "footer";
  }

  if (/(background|bg|texture|pattern|wallpaper)/i.test(signal)) {
    return "background";
  }

  if (/(hero|banner|cover|header|masthead|first screen|above the fold|main visual)/i.test(signal)) {
    return "hero";
  }

  if (/(feature|benefit|card|tile|product shot)/i.test(signal)) {
    return "feature";
  }

  if (/(section|body|content|phone|screen|screenshot|app|device)/i.test(signal)) {
    return "section";
  }

  if (/(reference|design|figma|wireframe|mockup|layout)/i.test(signal)) {
    return "reference";
  }

  return index === 0 ? "hero" : "section";
}

function resolveAssetPlacement(asset, index = 0) {
  const explicit = cleanText(asset?.placement);
  if (explicit && explicit !== "auto") {
    return explicit;
  }

  return inferAssetPlacement(asset, index);
}

function resolveAssetKey(asset, index, placement) {
  if (!isGenericAssetKey(asset?.key)) {
    return cleanText(asset.key);
  }

  if (placement === "hero" && index === 0) {
    return "hero_asset";
  }

  const source = cleanText(asset?.notes) || cleanText(asset?.alt) || extractAssetNameFromUrl(asset?.url);
  return `${slugify(placement)}_${slugify(source || `${placement}-${index + 1}`)}`;
}

function describeAssetPlan(assetInputs) {
  if (!Array.isArray(assetInputs) || assetInputs.length === 0) {
    return "No structured assets";
  }

  return assetInputs
    .filter((asset) => asset.url)
    .map((asset, index) => {
      const placement = resolveAssetPlacement(asset, index);
      const key = resolveAssetKey(asset, index, placement);
      const placementLabel = cleanText(asset.placement) === "auto"
        ? `auto->${placement}`
        : placement;
      return `${key} | placement=${placementLabel} | notes=${asset.notes || "-"} | url=${asset.url}`;
    })
    .join("\n");
}

function summarizeCurrentDraft(currentDraft) {
  if (!currentDraft || typeof currentDraft !== "object") {
    return "No current draft";
  }

  return JSON.stringify(currentDraft, null, 2).slice(0, 6000);
}

function getSectionDesiredPlacements(section) {
  const kind = cleanText(section?.kind);

  if (kind === "hero") {
    return ["hero", "background", "reference"];
  }

  if (kind === "feature-list" || kind === "text" || kind === "image") {
    return ["section", "feature", "reference"];
  }

  if (kind === "cta") {
    return ["hero", "section", "background", "reference"];
  }

  if (kind === "footer") {
    return ["footer", "logo", "reference"];
  }

  return ["section", "feature", "reference"];
}

function scoreLibraryAssetForSection(section, item) {
  const desiredPlacements = getSectionDesiredPlacements(section);
  const signal = [
    cleanText(item?.label),
    cleanText(item?.notes),
    cleanText(item?.key),
    cleanText(item?.alt)
  ].join(" ").toLowerCase();
  let score = 0;

  if (desiredPlacements.includes(cleanText(item?.placement))) {
    score += 6;
  }

  if (cleanText(item?.kind) === "design") {
    score -= 2;
  }

  if (section.kind === "hero" && /(hero|banner|cover|header|offer)/i.test(signal)) {
    score += 4;
  }

  if ((section.kind === "feature-list" || section.kind === "text" || section.kind === "image") && /(feature|body|section|screen|screenshot|app|phone|device|card)/i.test(signal)) {
    score += 4;
  }

  if (section.kind === "footer" && /(footer|logo|badge|store|social)/i.test(signal)) {
    score += 4;
  }

  if (section.kind === "cta" && /(cta|button|offer|hero|banner)/i.test(signal)) {
    score += 3;
  }

  return score;
}

function scoreLibraryAssetForDesignRole(role, item) {
  const normalizedRole = cleanText(role);
  const placement = cleanText(item?.placement);
  const signal = [
    cleanText(item?.label),
    cleanText(item?.notes),
    cleanText(item?.key),
    cleanText(item?.alt)
  ].join(" ").toLowerCase();

  let score = 0;

  if (placement === normalizedRole) {
    score += 8;
  }

  if (normalizedRole === "logo" && /(logo|brand|header)/i.test(signal)) {
    score += 6;
  }

  if (normalizedRole === "badge" && /(app store|appstore|google play|googleplay|badge|store)/i.test(signal)) {
    score += 6;
  }

  if (normalizedRole === "social" && /(social|facebook|instagram|twitter|telegram|youtube|linkedin|tiktok)/i.test(signal)) {
    score += 6;
  }

  return score;
}

function buildAssetRecommendations(mail, payload) {
  const registryItems = Array.isArray(payload?.assetRegistryItems) ? payload.assetRegistryItems : [];
  const sections = Array.isArray(mail?.sections) ? mail.sections : [];
  const usedLibraryIds = new Set(
    (Array.isArray(payload?.assetInputs) ? payload.assetInputs : [])
      .map((asset) => cleanText(asset.libraryId))
      .filter(Boolean)
  );
  const usedUrls = new Set(
    (Array.isArray(payload?.assetInputs) ? payload.assetInputs : [])
      .map((asset) => cleanText(asset.url))
      .filter(Boolean)
  );
  const libraryCandidates = registryItems.filter((item) => !usedLibraryIds.has(cleanText(item.id)) && !usedUrls.has(cleanText(item.preferredUrl)));
  const recommendations = [];

  for (const [index, section] of sections.entries()) {
    const desiredPlacements = getSectionDesiredPlacements(section);
    const hasMappedImage = Boolean(cleanText(section?.image_key));
    const matches = libraryCandidates
      .map((item) => ({
        id: cleanText(item.id),
        label: cleanText(item.label) || cleanText(item.fileName) || cleanText(item.key),
        placement: cleanText(item.placement) || "auto",
        preferredUrl: cleanText(item.preferredUrl) || cleanText(item.localUrl),
        score: scoreLibraryAssetForSection(section, item),
        kind: cleanText(item.kind) || "asset"
      }))
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, 3);

    recommendations.push({
      sectionIndex: index,
      sectionTitle: cleanText(section?.title) || cleanText(section?.eyebrow) || `Section ${index + 1}`,
      sectionKind: cleanText(section?.kind) || "text",
      desiredPlacements,
      hasMappedImage,
      status: hasMappedImage ? "mapped" : matches.length > 0 ? "needs-asset" : "missing-library-match",
      message: hasMappedImage
        ? "В секции уже есть image mapping."
        : matches.length > 0
          ? `В library есть ${matches.length} подходящих asset candidate(s).`
          : "В library пока нет явного кандидата под эту секцию.",
      matches
    });
  }

  const desiredGlobalRoles = Array.isArray(payload?.designMappingHints?.desiredAssetRoles)
    ? payload.designMappingHints.desiredAssetRoles.map(cleanText).filter(Boolean)
    : [];
  const presentPlacements = new Set(
    (Array.isArray(mail?.assets) ? mail.assets : [])
      .map((asset) => cleanText(asset?.placement))
      .filter(Boolean)
  );

  for (const role of desiredGlobalRoles.filter((value) => ["logo", "badge", "social"].includes(value))) {
    if (presentPlacements.has(role)) {
      continue;
    }

    const matches = libraryCandidates
      .map((item) => ({
        id: cleanText(item.id),
        label: cleanText(item.label) || cleanText(item.fileName) || cleanText(item.key),
        placement: cleanText(item.placement) || "auto",
        preferredUrl: cleanText(item.preferredUrl) || cleanText(item.localUrl),
        score: scoreLibraryAssetForDesignRole(role, item),
        kind: cleanText(item.kind) || "asset"
      }))
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, 3);

    recommendations.push({
      sectionIndex: -1,
      sectionTitle: `Design role: ${role}`,
      sectionKind: "design-role",
      desiredPlacements: [role],
      hasMappedImage: false,
      status: matches.length > 0 ? "needs-asset" : "missing-library-match",
      message: matches.length > 0
        ? `В library уже есть candidate(s) для роли ${role}.`
        : `В library пока нет явного кандидата для роли ${role}.`,
      matches
    });
  }

  return recommendations;
}

function summarizeAssetLibraryForContext(payload) {
  const items = Array.isArray(payload?.assetRegistryItems) ? payload.assetRegistryItems : [];

  if (items.length === 0) {
    return "Asset library is empty";
  }

  return items
    .slice(0, 8)
    .map((item) => `${cleanText(item.key) || cleanText(item.label)} | placement=${cleanText(item.placement) || "auto"} | kind=${cleanText(item.kind) || "asset"} | url=${cleanText(item.preferredUrl) || cleanText(item.localUrl)}`)
    .join("\n");
}

function buildNormalizedDesignSchema(payload, design = null, designAnalysis = null) {
  return buildInternalDesignSchema({
    briefDesignUrl: cleanText(payload?.brief?.designUrl),
    design: design ?? payload?.design,
    designAnalysis: designAnalysis ?? payload?.designAnalysis
  });
}

function buildNormalizedDesignDecomposition(payload, designSchema = null) {
  return buildDesignDecomposition(
    designSchema ?? payload?.designSchema ?? buildNormalizedDesignSchema(payload)
  );
}

function buildNormalizedDesignMappingHints(payload, designSchema = null, designDecomposition = null) {
  const schema = designSchema ?? payload?.designSchema ?? buildNormalizedDesignSchema(payload);
  const decomposition = designDecomposition ?? payload?.designDecomposition ?? buildNormalizedDesignDecomposition(payload, schema);
  return buildDesignMappingHints({
    schema,
    decomposition
  });
}

function buildNormalizedDesignBlockRecommendations(payload, designMappingHints = null) {
  const blockCatalog = readBlockCatalogSnapshot();
  const mappingHints = designMappingHints ?? payload?.designMappingHints ?? buildNormalizedDesignMappingHints(payload);
  return buildDesignBlockRecommendations({
    catalog: blockCatalog,
    mappingHints
  });
}

function getLessonsContextSnapshot() {
  try {
    return buildLessonsContext({ items: dbLessonsGetAll() });
  } catch {
    return "No lessons recorded yet.";
  }
}

function normalizeDesignAnalysis(rawAnalysis) {
  if (!rawAnalysis || typeof rawAnalysis !== "object") {
    return null;
  }

  const normalizeKinds = (Array.isArray(rawAnalysis.section_kinds) ? rawAnalysis.section_kinds : [])
    .map(cleanText)
    .filter((value) => ["hero", "text", "feature-list", "image", "cta", "footer"].includes(value));

  const validKinds = new Set(["hero", "text", "feature-list", "image", "cta", "footer"]);

  const normalizeSectionsStructured = (arr) => {
    if (!Array.isArray(arr)) return [];
    return arr.map((s, fallbackIdx) => ({
      index:        typeof s.index === "number" ? s.index : fallbackIdx,
      kind:         validKinds.has(s.kind) ? s.kind : "text",
      title:        cleanText(s.title) || "",
      body:         cleanText(s.body) || "",
      cta_label:    cleanText(s.cta_label) || "",
      has_image:    typeof s.has_image === "boolean" ? s.has_image : false,
      image_notes:  cleanText(s.image_notes) || "",
      layout_notes: cleanText(s.layout_notes) || ""
    }));
  };

  return {
    summary: cleanText(rawAnalysis.summary),
    reference_family: cleanText(rawAnalysis.reference_family),
    reference_variant: cleanText(rawAnalysis.reference_variant),
    brand_hint: cleanText(rawAnalysis.brand_hint),
    section_kinds: normalizeKinds,
    sections_structured: normalizeSectionsStructured(rawAnalysis.sections_structured),
    suggested_blocks: Array.isArray(rawAnalysis.suggested_blocks) ? rawAnalysis.suggested_blocks.map(cleanText).filter(Boolean) : [],
    asset_slots: Array.isArray(rawAnalysis.asset_slots) ? rawAnalysis.asset_slots.map(cleanText).filter(Boolean) : [],
    content_requirements: Array.isArray(rawAnalysis.content_requirements) ? rawAnalysis.content_requirements.map(cleanText).filter(Boolean) : [],
    warnings: Array.isArray(rawAnalysis.warnings) ? rawAnalysis.warnings.map(cleanText).filter(Boolean) : [],
    mode: cleanText(rawAnalysis.mode),
    updatedAt: cleanText(rawAnalysis.updatedAt)
  };
}

function summarizeDesignAnalysisForContext(analysis) {
  const normalized = normalizeDesignAnalysis(analysis);
  if (!normalized) {
    return "No design analysis";
  }

  const structuredSections = normalized.sections_structured && normalized.sections_structured.length > 0
    ? normalized.sections_structured.map((s) =>
        `  [${s.index}] ${s.kind.toUpperCase()}` +
        (s.title ? ` | title: "${s.title}"` : "") +
        (s.body ? ` | body: "${s.body.slice(0, 80)}${s.body.length > 80 ? "…" : ""}"` : "") +
        (s.cta_label ? ` | cta: "${s.cta_label}"` : "") +
        (s.has_image ? ` | image: ${s.image_notes || "yes"}` : "") +
        (s.layout_notes ? ` | layout: ${s.layout_notes}` : "")
      ).join("\n")
    : null;

  return [
    `Summary: ${normalized.summary || "None"}`,
    `Reference family: ${normalized.reference_family || "None"}`,
    `Reference variant: ${normalized.reference_variant || "None"}`,
    `Brand hint: ${normalized.brand_hint || "None"}`,
    `Section kinds: ${normalized.section_kinds.join(", ") || "None"}`,
    structuredSections ? `Sections (top-to-bottom):\n${structuredSections}` : null,
    `Suggested blocks: ${normalized.suggested_blocks.join(" | ") || "None"}`,
    `Asset slots: ${normalized.asset_slots.join(" | ") || "None"}`,
    `Missing content: ${normalized.content_requirements.join(" | ") || "None"}`,
    `Warnings: ${normalized.warnings.join(" | ") || "None"}`
  ].filter(Boolean).join("\n");
}

function summarizeDesignInputForContext(payload) {
  const design = normalizeDesignPayload(payload?.design);
  const link = cleanText(payload?.brief?.designUrl);
  const hasUpload = Boolean(cleanText(design?.dataUrl));
  const hasFigmaStructured = hasDetailedFigmaImportPayload(design?.figmaImport);

  if (hasUpload && /figma\.com/i.test(link) && hasFigmaStructured) {
    return "Uploaded design image plus Figma frame URL and structured Figma payload.";
  }

  if (hasUpload && hasFigmaStructured) {
    return "Uploaded screenshot or image export plus structured Figma payload.";
  }

  if (hasUpload && link) {
    return /figma\.com/i.test(link)
      ? "Uploaded design image plus public Figma frame URL reference."
      : looksLikeImageUrl(link)
        ? "Uploaded design image plus public image export URL."
        : "Uploaded design image plus external reference URL.";
  }

  if (hasUpload) {
    return "Uploaded screenshot or image export.";
  }

  if (/figma\.com/i.test(link) && hasFigmaStructured) {
    return "Figma frame URL plus structured Figma payload.";
  }

  if (hasFigmaStructured) {
    return "Structured Figma payload only.";
  }

  if (/figma\.com/i.test(link)) {
    return "Public Figma frame URL reference only.";
  }

  if (looksLikeImageUrl(link)) {
    return "Public image export URL only.";
  }

  if (link) {
    return "External reference URL only.";
  }

  return "No design input.";
}

function summarizeFigmaImportForContext(payload) {
  const design = normalizeDesignPayload(payload?.design);
  const figmaImport = normalizeFigmaImportPayload(design?.figmaImport);
  if (!hasDetailedFigmaImportPayload(figmaImport)) {
    return "Figma structured import: none.";
  }

  const fileKey = cleanText(figmaImport?.fileKey);
  const nodeId = cleanText(figmaImport?.nodeId);
  const selectionName = cleanText(figmaImport?.selectionName);
  const pageName = cleanText(figmaImport?.pageName);
  const layerNames = normalizeShortTextList(figmaImport?.layerNames, 8, 60);
  const textSamples = normalizeShortTextList(figmaImport?.textSamples, 4, 120);
  const summaryBits = [
    selectionName ? `selection ${selectionName}` : "",
    pageName ? `page ${pageName}` : "",
    fileKey ? `file ${fileKey}` : "",
    nodeId ? `node ${nodeId}` : "",
    figmaImport?.layerCount ? `${figmaImport.layerCount} layers` : "",
    figmaImport?.textLayerCount ? `${figmaImport.textLayerCount} text layers` : "",
    figmaImport?.imageFillCount ? `${figmaImport.imageFillCount} image fills` : ""
  ].filter(Boolean);

  return [
    `Figma structured import: ${summaryBits.join(", ") || "present"}.`,
    layerNames.length > 0 ? `Figma layer names: ${layerNames.join(" | ")}` : "",
    textSamples.length > 0 ? `Figma text samples: ${textSamples.join(" | ")}` : "",
    cleanText(figmaImport?.directionHint) ? `Figma direction hint: ${cleanText(figmaImport.directionHint)}` : "",
    Array.isArray(figmaImport?.localeHints) && figmaImport.localeHints.length > 0 ? `Figma locale hints: ${figmaImport.localeHints.join(" | ")}` : ""
  ].filter(Boolean).join("\n");
}

function buildCategorySpecificInstructions(payload) {
  const templateSelection = getReferenceTemplateSelection(payload);

  if (cleanText(templateSelection?.profile) === "aff-password-reset") {
    return [
      "Category-specific rules for affiliate password reset:",
      "- Preserve a compact transactional layout: logo, headline, intro text, one CTA button, warning text, support line, legal footer.",
      "- Keep the Affstore brand treatment unless the user explicitly overrides the logo.",
      "- Do not add promo sections, extra cards, image blocks, gradients, or marketing banners.",
      "- Preserve system placeholders like {{affiliate_embedded_admin_domain_url}} and {{reset_password_link}} exactly.",
      "- If no custom copy is provided, stay very close to the base password-reset reference instead of inventing new copy."
    ].join("\n");
  }

  if (!isSystemCategoryName(resolveBriefCategory(payload))) {
    return "Category-specific rules: none.";
  }

  return [
    "Category-specific rules for X_System / transactional email:",
    "- Build a simple system/transactional email, not a marketing promo.",
    "- The uploaded design is reference-only. Never use the design screenshot itself as a mail asset or section image.",
    "- Do not invent decorative hero banners, gradients, or promotional cards.",
    "- Prefer this structure: header/logo, headline, greeting/body, highlighted info/callout block, support/contact line, signoff, legal footer.",
    "- Do not add a CTA section unless the user explicitly asks for a button or provides CTA text.",
    "- If the screenshot contains a logo at the top, map it to header/logo treatment, not to a standalone image block.",
    "- Keep copy compact and transactional. Preserve placeholders like {{embedded.user_id}} and {{reason_text}} exactly."
  ].join("\n");
}

function isVisionSupportedMimeType(mimeType) {
  return [
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/gif"
  ].includes(cleanText(mimeType).toLowerCase());
}

async function resolveVisionImageUrl(source) {
  const value = cleanText(source);
  if (!value) {
    return "";
  }

  if (/^data:image\//i.test(value)) {
    return value;
  }

  if (/^https?:\/\//i.test(value)) {
    return value;
  }

  if (value.startsWith("/studio-assets/")) {
    const requestedFile = decodeURIComponent(value.replace(/^\/studio-assets\//, ""));
    const safeName = path.basename(requestedFile);
    const assetPath = path.join(assetStorageDir, safeName);

    if (!assetPath.startsWith(assetStorageDir) || !existsSync(assetPath)) {
      return "";
    }

    const mimeType = (mimeTypes[path.extname(assetPath).toLowerCase()] || "application/octet-stream").split(";")[0];
    if (!isVisionSupportedMimeType(mimeType)) {
      return "";
    }

    const buffer = await readFile(assetPath);
    return `data:${mimeType};base64,${buffer.toString("base64")}`;
  }

  return "";
}

async function appendVisionInput(content, source, detail = "auto") {
  const imageUrl = await resolveVisionImageUrl(source);
  if (!imageUrl) {
    return false;
  }

  content.push({
    type: "input_image",
    image_url: imageUrl,
    detail
  });
  return true;
}

function shouldForceMockProvider(settings = {}) {
  if (settings?.forceMock === true) {
    return true;
  }

  const raw = cleanText(settings?.forceMock).toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes";
}

function resolveEffectiveProviderId(settings = {}) {
  const requested = cleanText(settings?.providerId);

  if (!requested) {
    return openAiApiKey ? "openai" : "mock";
  }

  if (requested === "mock" && openAiApiKey && !shouldForceMockProvider(settings)) {
    return "openai";
  }

  return requested;
}

function normalizePayload(payload) {
  const brief = payload?.brief ?? {};
  const settings = payload?.settings ?? {};
  const design = normalizeDesignPayload(payload?.design);
  const normalizedDesignAnalysis = normalizeDesignAnalysis(payload?.designAnalysis);
  const assetInputs = filterDesignAssetInputs(normalizeAssetInputs(payload), design);
  const assetRegistryItems = filterAssetLibraryItemsForContent(normalizeAssetLibraryItems(payload), payload);
  const projectRules = Array.isArray(payload?.projectRules)
    ? payload.projectRules.map(normalizeProjectRuleEntry).filter((item) => item.text)
    : [];
  const inferredRequestedLocales = extractRequestedLocalesFromMessages(payload);
  const combinedRequestedLocales = Array.from(new Set([
    ...parseLocaleList(cleanText(brief.requestedLocales)),
    ...inferredRequestedLocales
  ]));
  const resolvedCategory = resolveBriefCategory(payload);
  const resolvedIntent = inferServerIntent(payload, cleanText(payload?.intent));
  const resolvedAssetInputs = isSystemCategoryName(resolvedCategory)
    ? []
    : assetInputs;
  const normalized = {
    intent: resolvedIntent,
    messages: Array.isArray(payload?.messages) ? payload.messages.slice(-8) : [],
    brief: {
      campaignName: cleanText(brief.campaignName),
      category: resolvedCategory,
      mailId: cleanText(brief.mailId),
      locale: getDraftLocale(brief),
      requestedLocales: combinedRequestedLocales.join(", "),
      audience: cleanText(brief.audience),
      goal: cleanText(brief.goal),
      tone: cleanText(brief.tone),
      primaryCta: cleanText(brief.primaryCta),
      primaryLink: cleanText(brief.primaryLink),
      contentNotes: cleanText(brief.contentNotes),
      designUrl: cleanText(brief.designUrl)
    },
    settings: {
      providerId: resolveEffectiveProviderId(settings),
      theme: cleanText(settings.theme) || "light",
      clientProfileId: cleanText(settings.clientProfileId) || "standard"
    },
    assetInputs: resolvedAssetInputs,
    assetRegistryItems,
    projectRules,
    assetLinks: resolvedAssetInputs.map((asset) => asset.url).filter(Boolean),
    translationText: cleanText(payload?.translationText),
    design,
    designAnalysis: normalizedDesignAnalysis,
    designSchema: buildNormalizedDesignSchema({
      brief: {
        designUrl: cleanText(brief.designUrl)
      },
      design,
      designAnalysis: normalizedDesignAnalysis
    }, design, normalizedDesignAnalysis),
    designDecomposition: null,
    designMappingHints: null,
    designBlockRecommendations: null,
    currentDraft: payload?.currentDraft && typeof payload.currentDraft === "object"
      ? payload.currentDraft
      : null,
    // Clone & Edit: base HTML email attachment
    baseEmailHtml: cleanText(payload?.baseEmailHtml) || null,
    baseEmailContentMap: payload?.baseEmailContentMap && typeof payload.baseEmailContentMap === "object"
      ? payload.baseEmailContentMap
      : null,
    // Scaffold mode: context from POST /api/email-base/scaffold response
    scaffoldContext: payload?.scaffoldContext && typeof payload.scaffoldContext === "object"
      ? payload.scaffoldContext
      : null
  };

  return hydratePayloadTemplateSelection(normalized);
}

function hydratePayloadTemplateSelection(payload) {
  if (!payload || typeof payload !== "object") {
    return payload;
  }

  const design = normalizeDesignPayload(payload.design);
  const designAnalysis = normalizeDesignAnalysis(payload.designAnalysis);
  const designSchema = buildNormalizedDesignSchema({
    ...payload,
    design,
    designAnalysis
  }, design, designAnalysis);
  const designDecomposition = buildNormalizedDesignDecomposition({
    ...payload,
    design,
    designAnalysis,
    designSchema
  }, designSchema);
  const designMappingHints = buildNormalizedDesignMappingHints({
    ...payload,
    design,
    designAnalysis,
    designSchema,
    designDecomposition
  }, designSchema, designDecomposition);
  const designBlockRecommendations = buildNormalizedDesignBlockRecommendations({
    ...payload,
    design,
    designAnalysis,
    designSchema,
    designDecomposition,
    designMappingHints
  }, designMappingHints);

  return {
    ...payload,
    design,
    designAnalysis,
    designSchema,
    designDecomposition,
    designMappingHints,
    designBlockRecommendations,
    templateSelection: resolveReferenceTemplateSelection({
      ...payload,
      design,
      designAnalysis,
      designSchema,
      designDecomposition,
      designMappingHints,
      designBlockRecommendations
    })
  };
}

/**
 * Builds context lines for "Clone & Edit" mode when user attaches an existing HTML email.
 * The AI receives a structured content map instead of raw HTML to stay within token limits.
 */
function buildBaseEmailContext(payload) {
  const html = cleanText(payload?.baseEmailHtml);
  if (!html) return null;

  // Either use pre-extracted contentMap from client, or extract server-side
  const map = payload?.baseEmailContentMap && typeof payload.baseEmailContentMap === "object"
    ? payload.baseEmailContentMap
    : extractEmailHtmlContentMap(html);

  if (!map) return null;
  const cloneEditHints = inferCloneEditIntentHints(payload, map);

  const lines = [
    "=== BASE EMAIL FOR EDITING (clone-and-edit mode) ===",
    "The user attached an existing HTML email. Your task is to EDIT this email, not create a new one.",
    "RULES for edit mode (MANDATORY — do not skip):",
    "- Do NOT use the email-base block catalog. Do NOT generate mail.sections[] entries.",
    "- Set mail.sections to an empty array [].",
    "- Preserve all HTML structure, table layouts, and inline CSS exactly.",
    "- Only replace content the user explicitly asks to change (text, image URLs, href links).",
    "- If the user asks to translate, translate visible copy while preserving placeholders and structure.",
    "- If the user asks to rebrand, preserve layout first and only change brand-facing content/assets the user requested.",
    "- If subject/preheader should change, update mail.subject and mail.preheader accordingly.",
    "- Do not restructure sections or change the number of blocks unless explicitly asked.",
    "- OUTPUT: return the COMPLETE modified HTML string in mail.modified_html.",
    "- mail.modified_html must contain the full <html>…</html> document, not a diff or snippet.",
    "",
    `File size: ${map.charCount ? Math.round(map.charCount / 1024) + "KB" : "unknown"}`,
    `Detected edit mode: ${cloneEditHints.summary}`,
    map.subject ? `Subject in HTML: ${map.subject}` : "",
    map.preheader ? `Preheader: ${map.preheader}` : "",
    ...(Array.isArray(cloneEditHints.hints) ? cloneEditHints.hints : []),
    "",
    "--- CONTENT SECTIONS (visible text blocks in order) ---",
    ...(map.sections || []).map((s, i) => `[${i + 1}] ${s}`),
    "",
    "--- IMAGE URLS ---",
    ...(map.images || []).map((src, i) => `[img-${i + 1}] ${src}`),
    "",
    "--- CTA LINKS ---",
    ...(map.links || []).map((l, i) => `[link-${i + 1}] text="${l.text}" href="${l.href}"`),
    "",
    "=== END BASE EMAIL CONTEXT ===",
    "The full HTML will be appended separately. Edit it according to user instructions."
  ].filter((l) => l !== null);

  return lines.join("\n");
}

function buildUserContext(payload) {
  const isCloneEdit = !!payload.baseEmailHtml;
  const isScaffold = !!(payload.scaffoldContext && typeof payload.scaffoldContext === "object");
  const emailBaseSummary = summarizeEmailBase();
  const templateSelection = getReferenceTemplateSelection(payload);
  const transcript = payload.messages
    .map((message) => `${message.role === "assistant" ? "Assistant" : "User"}: ${cleanText(message.content)}`)
    .join("\n");

  // ── SCAFFOLD MODE: creating copy for a new system email from template ──
  if (isScaffold) {
    const sc = payload.scaffoldContext;
    const tokenList = Array.isArray(sc.tokenKeys)
      ? sc.tokenKeys.map((k) => `  - ${k}`).join("\n")
      : "  (no token keys provided)";
    return [
      "=== SCAFFOLD MODE ===",
      buildResponseLanguageInstruction(payload),
      `You are writing copy for a NEW system email being created from a template.`,
      `New mail ID: ${sc.newMailId || "unknown"}`,
      `Token namespace: ${sc.namespace || sc.newMailId || "unknown"}`,
      `Category: ${sc.category || "unknown"}`,
      `Template cloned from: ${sc.templateMail || "unknown"}`,
      ``,
      `Token keys to fill (ALL must be included in mail.locale_entries):`,
      tokenList,
      ``,
      `RULES:`,
      `- Return EVERY token key in mail.locale_entries as { key, value } pairs.`,
      `- Write concise, on-brand transactional copy for each value.`,
      `- Set mail.sections to [] — do not generate layout sections.`,
      `- Set mail.modified_html to "" — this is not clone-edit mode.`,
      `- Use mail.subject and mail.preheader for the email subject/preheader.`,
      `Brief: ${payload.brief.campaignName || payload.brief.goal || "New system email"}`,
      `Tone: ${payload.brief.tone || "Direct and clear"}`,
      `Primary CTA label: ${payload.brief.primaryCta || ""}`,
      `Primary CTA href: ${payload.brief.primaryLink || ""}`,
      `Conversation transcript:`,
      transcript || "User: Please write the copy for this new email."
    ].filter(Boolean).join("\n");
  }

  // ── CLONE-EDIT MODE: minimal context, skip the entire catalog ──
  if (isCloneEdit) {
    const cloneEditHints = inferCloneEditIntentHints(payload, payload?.baseEmailContentMap && typeof payload.baseEmailContentMap === "object"
      ? payload.baseEmailContentMap
      : extractEmailHtmlContentMap(payload.baseEmailHtml || ""));
    return [
      "CLONE-EDIT MODE. Edit the HTML email appended below. Return the result in mail.modified_html.",
      buildResponseLanguageInstruction(payload),
      `Primary locale: ${payload.brief.locale}`,
      `Requested locales: ${payload.brief.requestedLocales || payload.brief.locale}`,
      `Campaign name: ${payload.brief.campaignName || "Untitled campaign"}`,
      `Detected clone-edit intent: ${cloneEditHints.summary}`,
      `Primary CTA label: ${payload.brief.primaryCta || ""}`,
      `Primary CTA href: ${payload.brief.primaryLink || ""}`,
      buildBaseEmailContext(payload) || "",
      "Conversation transcript:",
      transcript || "User: Please edit this email."
    ].filter(Boolean).join("\n");
  }

  // ── NORMAL MODE: full context with email-base catalog ──

  // Read AI lessons synchronously from snapshot (already loaded) or inline
  const lessonsContext = getLessonsContextSnapshot();

  return [
    "Create or update an email draft.",
    buildResponseLanguageInstruction(payload),
    `Campaign name: ${payload.brief.campaignName || "Untitled campaign"}`,
    `Primary locale: ${payload.brief.locale}`,
    `Requested locales: ${payload.brief.requestedLocales || payload.brief.locale}`,
    `Audience: ${payload.brief.audience || "Not specified"}`,
    `Goal: ${payload.brief.goal || "Not specified"}`,
    `Tone: ${payload.brief.tone || "Direct and clear"}`,
    `Primary CTA label: ${payload.brief.primaryCta || ""}`,
    `Primary CTA href: ${payload.brief.primaryLink || ""}`,
    `Content notes: ${payload.brief.contentNotes || "None"}`,
    `Design input type: ${summarizeDesignInputForContext(payload)}`,
    `Design URL: ${payload.brief.designUrl || "None"}`,
    "Figma access rule: if the user provides only a Figma link and direct access is unclear, ask for an open draft/share link or a screenshot/export of the exact frame. Do not ask for raw JSON unless the workflow is explicitly advanced/internal.",
    "Blocking rule: if there is only an inaccessible/private Figma link, do not fabricate a generic email layout. Ask only for an open draft/share link or a PNG/JPG export of the exact frame.",
    "Copy rule: if the user says copy can stay empty for now, leave strings empty and keep moving once the design itself is accessible.",
    "Figma structured input:",
    summarizeFigmaImportForContext(payload),
    "Design analysis:",
    summarizeDesignAnalysisForContext(payload.designAnalysis),
    "Structured design schema:",
    summarizeDesignSchema(payload.designSchema),
    "Design decomposition:",
    summarizeDesignDecomposition(payload.designDecomposition),
    "Design mapping hints:",
    summarizeDesignMappingHints(payload.designMappingHints),
    "Design block recommendations:",
    summarizeDesignBlockRecommendations(payload.designBlockRecommendations),
    "Structured assets:",
    describeAssetPlan(payload.assetInputs),
    "Asset library in project:",
    summarizeAssetLibraryForContext(payload),
    "Template family profiles:",
    summarizeTemplateFamilyProfilesForContext(readTemplateFamilyProfilesSnapshot()),
    "Saved project rules:",
    summarizeProjectRulesForContext(payload.projectRules),
    "=== EMAIL BASE KNOWLEDGE (real templates) ===",
    buildEmailBaseDeepContext(),
    "=== AI LESSONS LEARNED (never repeat these mistakes) ===",
    lessonsContext,
    "=== END OF BASE KNOWLEDGE ===",
    buildCategorySpecificInstructions(payload),
    summarizeTemplateSelectionForContext(templateSelection),
    "Translations source:",
    summarizeTranslationText(payload.translationText),
    `Requested AI provider: ${payload.settings.providerId}`,
    `Email base contract: ${emailBaseSummary.available ? emailBaseSummary.technology.join(", ") : "Not attached"}`,
    `Current base mail: ${emailBaseSummary.currentMail?.folder || "None"}`,
    "Current draft context:",
    summarizeCurrentDraft(payload.currentDraft),
    "Conversation transcript:",
    transcript || "User: Please draft a strong retention email."
  ].filter(Boolean).join("\n");
}

function buildDiscussionContext(payload) {
  const emailBaseSummary = summarizeEmailBase();
  const templateSelection = getReferenceTemplateSelection(payload);
  const transcript = payload.messages
    .map((message) => `${message.role === "assistant" ? "Assistant" : "User"}: ${cleanText(message.content)}`)
    .join("\n");

  return [
    "You are discussing an email with a marketer inside an email studio.",
    buildResponseLanguageInstruction(payload),
    "Answer like a collaborative email strategist and implementation partner.",
    "Be concise, concrete, and practical.",
    "Prefer making a concrete proposal first instead of turning the reply into a long questionnaire.",
    "Ask at most two blocking follow-up questions.",
    "If a CTA URL is missing, keep href empty instead of blocking the draft.",
    "Do not claim you started background work, do not say you will send code later, and do not pretend there is async progress. Either discuss, or say clearly that the next step is to assemble the draft now.",
    `Campaign name: ${payload.brief.campaignName || "Untitled campaign"}`,
    `Goal: ${payload.brief.goal || "Not specified"}`,
    `Tone: ${payload.brief.tone || "Not specified"}`,
    `Primary locale: ${payload.brief.locale}`,
    `Requested locales: ${payload.brief.requestedLocales || payload.brief.locale}`,
    `Current base mail: ${emailBaseSummary.currentMail?.folder || "None"}`,
    `Design input type: ${summarizeDesignInputForContext(payload)}`,
    "Figma access rule: if the user provides only a Figma link and direct access is unclear, ask for an open draft/share link or a screenshot/export of the exact frame. Do not ask for raw JSON unless the workflow is explicitly advanced/internal.",
    "Blocking rule: if there is only an inaccessible/private Figma link, ask only for an open draft/share link or a PNG/JPG export of the exact frame. Do not switch into copy questions first.",
    "Copy rule: if the user says copy can stay empty for now, accept that and do not block on CTA, footer, or legal copy.",
    "Figma structured input:",
    summarizeFigmaImportForContext(payload),
    "Design analysis:",
    summarizeDesignAnalysisForContext(payload.designAnalysis),
    "Structured design schema:",
    summarizeDesignSchema(payload.designSchema),
    "Design decomposition:",
    summarizeDesignDecomposition(payload.designDecomposition),
    "Design mapping hints:",
    summarizeDesignMappingHints(payload.designMappingHints),
    "Design block recommendations:",
    summarizeDesignBlockRecommendations(payload.designBlockRecommendations),
    "Structured assets:",
    describeAssetPlan(payload.assetInputs),
    "Asset library in project:",
    summarizeAssetLibraryForContext(payload),
    "Template family profiles:",
    summarizeTemplateFamilyProfilesForContext(readTemplateFamilyProfilesSnapshot()),
    "Saved project rules:",
    summarizeProjectRulesForContext(payload.projectRules),
    "=== EMAIL BASE KNOWLEDGE (real templates) ===",
    buildEmailBaseDeepContext(),
    "=== AI LESSONS LEARNED (never repeat these mistakes) ===",
    getLessonsContextSnapshot(),
    "=== END OF BASE KNOWLEDGE ===",
    buildCategorySpecificInstructions(payload),
    summarizeTemplateSelectionForContext(templateSelection),
    buildBaseEmailContext(payload) || "",
    "Current draft context:",
    summarizeCurrentDraft(payload.currentDraft),
    "Translations source:",
    summarizeTranslationText(payload.translationText),
    "Conversation transcript:",
    transcript || "User: Let's discuss the email direction."
  ].filter(Boolean).join("\n");
}

async function buildInputMessages(payload) {
  const content = [
    {
      type: "input_text",
      text: buildUserContext(payload)
    }
  ];

  if (payload.brief.designUrl && looksLikeImageUrl(payload.brief.designUrl)) {
    await appendVisionInput(content, payload.brief.designUrl, "auto");
  }

  if (payload.design?.dataUrl) {
    await appendVisionInput(content, payload.design.dataUrl, "auto");
  }

  for (const assetLink of payload.assetLinks.slice(0, 3)) {
    if (/\.(png|jpe?g|gif|webp|svg)(\?.*)?$/i.test(assetLink)) {
      await appendVisionInput(content, assetLink, "low");
    }
  }

  // Clone & Edit: append full base HTML so AI can edit it and return mail.modified_html
  if (payload.baseEmailHtml) {
    content.push({
      type: "input_text",
      text: `=== FULL BASE EMAIL HTML (edit this, return complete result in mail.modified_html) ===\n${payload.baseEmailHtml}\n=== END BASE EMAIL HTML ===`
    });
  }

  const activeSystemPrompt = payload.baseEmailHtml ? cloneEditSystemPrompt : systemPrompt;

  return [
    {
      role: "system",
      content: [{ type: "input_text", text: activeSystemPrompt }]
    },
    {
      role: "user",
      content
    }
  ];
}

async function buildDiscussionMessages(payload) {
  const content = [
    {
      type: "input_text",
      text: buildDiscussionContext(payload)
    }
  ];

  if (payload.brief.designUrl && looksLikeImageUrl(payload.brief.designUrl)) {
    await appendVisionInput(content, payload.brief.designUrl, "auto");
  }

  if (payload.design?.dataUrl) {
    await appendVisionInput(content, payload.design.dataUrl, "auto");
  }

  for (const [index, asset] of payload.assetInputs.slice(0, 4).entries()) {
    if (looksLikeImageUrl(asset.url)) {
      const placement = resolveAssetPlacement(asset, index);
      await appendVisionInput(content, asset.url, placement === "hero" ? "auto" : "low");
    }
  }

  return [
    {
      role: "system",
      content: [{
        type: "input_text",
        text: "You are a live email strategist inside a collaborative email-studio. Reply in the user's language. Be concise and practical. Prefer making a concrete proposal first. Ask at most two blocking follow-up questions. If a CTA URL is missing, leave href empty instead of blocking the draft. Do not claim you started background work and do not say you will send code later."
      }]
    },
    {
      role: "user",
      content
    }
  ];
}

async function buildDesignAnalysisMessages(payload) {
  const emailBaseSummary = summarizeEmailBase();
  const templateSelection = getReferenceTemplateSelection(payload);
  const currentDraftSummary = summarizeCurrentDraft(payload.currentDraft);
  const content = [
    {
      type: "input_text",
      text: [
        "Analyze the provided email design reference for an email studio.",
        "Return structural guidance that maps to reusable email blocks.",
        "In sections_structured, enumerate every visible section top-to-bottom with kind, visible text, CTA, image presence, and layout notes.",
        `Campaign name: ${payload.brief.campaignName || "Untitled campaign"}`,
        `Goal: ${payload.brief.goal || "Not specified"}`,
        `Audience: ${payload.brief.audience || "Not specified"}`,
        `Primary locale: ${payload.brief.locale}`,
        `Current base mail: ${emailBaseSummary.currentMail?.folder || "None"}`,
        `Design input type: ${summarizeDesignInputForContext(payload)}`,
        "Figma access rule: if there is only a Figma link, prefer asking for an open draft/share link or a screenshot/export of the frame. Do not ask for raw JSON unless this is an advanced/internal workflow.",
        "If the screenshot or Figma UI shows a visible template family or frame label like RFM 1-3-3, capture it.",
        "Set analysis.reference_family to the visible family label such as RFM, set analysis.reference_variant to the visible variant like 1-3-3, and set analysis.brand_hint to the visible brand such as IQ Option. If not obvious, return empty strings.",
        "Figma structured input:",
        summarizeFigmaImportForContext(payload),
        "Structured design schema:",
        summarizeDesignSchema(payload.designSchema),
        "Design decomposition:",
        summarizeDesignDecomposition(payload.designDecomposition),
        "Design mapping hints:",
        summarizeDesignMappingHints(payload.designMappingHints),
        "Design block recommendations:",
        summarizeDesignBlockRecommendations(payload.designBlockRecommendations),
        "Template family profiles:",
        summarizeTemplateFamilyProfilesForContext(readTemplateFamilyProfilesSnapshot()),
        "Saved project rules:",
        summarizeProjectRulesForContext(payload.projectRules),
        buildCategorySpecificInstructions(payload),
        summarizeTemplateSelectionForContext(templateSelection),
        "Current draft context:",
        currentDraftSummary,
        "Available block system:",
        emailBaseSummary.available ? emailBaseSummary.technology.join(", ") : "Not attached"
      ].join("\n")
    }
  ];

  if (payload.brief.designUrl && looksLikeImageUrl(payload.brief.designUrl)) {
    await appendVisionInput(content, payload.brief.designUrl, "high");
  }

  if (payload.design?.dataUrl) {
    await appendVisionInput(content, payload.design.dataUrl, "high");
  }

  return [
    {
      role: "system",
      content: [{
        type: "input_text",
        text: [
          "You analyze email design references for a reusable email block system.",
          "Reply in the user's language. Do not write HTML.",
          "",
          "BLOCK KINDS — map every visible section to one of these:",
          "  hero         — full-width top banner with headline, optional subtitle, optional CTA. Has a prominent image or background.",
          "  text         — editorial text section, possibly with an eyebrow or subheading. No standalone image.",
          "  feature-list — a list or grid of feature items / benefit tiles / icon+text rows.",
          "  image        — standalone decorative or illustrative image block.",
          "  cta          — dedicated call-to-action section: button + short copy, no other content.",
          "  footer       — bottom section with legal text, unsubscribe, social links, logo.",
          "",
          "For sections_structured, list ALL visible sections top-to-bottom.",
          "For each section fill:",
          "  index        — 0-based order position",
          "  kind         — one of the block kinds above",
          "  title        — visible headline text (quote if possible, leave empty if not present)",
          "  body         — visible paragraph/body text (quote if possible, leave empty if not present)",
          "  cta_label    — visible button label (leave empty if no button in this section)",
          "  has_image    — true if the section contains an image, false otherwise",
          "  image_notes  — brief description of the image (size hint, position, what it shows) or empty string",
          "  layout_notes — any notable layout detail (e.g. '2-column grid', 'dark background', 'centered text')",
          "",
          "Extract visible template family, variant, and brand from labels or layer names.",
          "Set reference_family, reference_variant, brand_hint to empty strings if not visible."
        ].join("\n")
      }]
    },
    {
      role: "user",
      content
    }
  ];
}

function createMockDesignAnalysis(payload, warning = "") {
  const hasDesign = hasDesignInput(payload);
  const designInputType = summarizeDesignInputForContext(payload);
  const analysis = normalizeDesignAnalysis({
    summary: hasDesign
      ? `Есть design reference (${designInputType}), но mock-режим не анализирует изображение по содержанию. Можно только использовать его как ориентир по структуре.`
      : "Design reference не приложен.",
    section_kinds: payload.currentDraft?.sections?.map((section) => cleanText(section.kind)).filter(Boolean).slice(0, 6)
      || ["hero", "text", "feature-list", "cta", "footer"],
    sections_structured: [],
    suggested_blocks: hasDesign
      ? ["Hero block", "Content block", "CTA block", "Footer block"]
      : ["Нужен design reference для точного block mapping"],
    asset_slots: hasDesign
      ? ["Hero visual", "Optional section image", "Logo/social/footer icons"]
      : ["Не хватает design reference"],
    content_requirements: [
      !payload.brief.primaryLink ? "Нужна основная CTA ссылка" : "",
      !payload.brief.requestedLocales ? "Нужно указать requested locales" : "",
      !payload.translationText ? "Нужен translation bundle или автогенерация локалей" : ""
    ].filter(Boolean),
    warnings: [
      hasDesign ? "Mock mode: нет vision-разбора пиксельного макета" : "Design reference отсутствует",
      warning || ""
    ].filter(Boolean),
    mode: "mock-design",
    updatedAt: new Date().toISOString()
  });

  return {
    assistantReply: hasDesign
      ? `Design reference сохранен, но сейчас доступен только mock-анализ. Для реального разбора макета нужен OpenAI provider с ключом.${warning ? ` ${warning}` : ""}`
      : "Сначала приложи design reference, потом можно запускать анализ макета.",
    analysis
  };
}

function createAssetRecords(payload) {
  if (isSystemCategoryName(resolveBriefCategory(payload))) {
    return [];
  }

  const records = payload.assetInputs
    .filter((asset) => asset.url)
    .slice(0, 8)
    .map((asset, index) => {
      const placement = resolveAssetPlacement(asset, index);
      return {
        key: resolveAssetKey(asset, index, placement),
        url: asset.url,
        alt: cleanText(asset.alt) || cleanText(asset.notes) || `Reference image ${index + 1}`,
        placement,
        notes: cleanText(asset.notes),
        width: 600,
        height: 300
      };
    });

  return records;
}

function getAssetByPlacement(assets, placements) {
  return assets.find((asset) => placements.includes(cleanText(asset.placement)));
}

function defaultFeatureItems(payload) {
  const noteLines = extractLines(payload.brief.contentNotes);
  if (noteLines.length > 0) {
    return noteLines.slice(0, 4);
  }

  return [
    "Strong hero with one primary call to action",
    "A short proof section with benefit bullets",
    "A dedicated CTA block near the bottom"
  ];
}

function getLatestUserMessage(payload) {
  return [...(Array.isArray(payload?.messages) ? payload.messages : [])]
    .reverse()
    .find((message) => message.role === "user")?.content || "";
}

function detectPreferredResponseLanguage(payload) {
  const latestUserMessage = cleanText(getLatestUserMessage(payload));
  if (/[А-Яа-яЁё]/.test(latestUserMessage)) {
    return "Russian";
  }
  return "English";
}

function buildResponseLanguageInstruction(payload) {
  return detectPreferredResponseLanguage(payload) === "Russian"
    ? "Preferred assistant reply language: Russian."
    : "Preferred assistant reply language: English.";
}

function finalizeAssistantReply(payload, text, fallback) {
  const preferred = detectPreferredResponseLanguage(payload);
  const cleaned = cleanText(text);
  if (!cleaned) {
    return cleanText(fallback);
  }

  if (preferred === "Russian" && !/[А-Яа-яЁё]/.test(cleaned)) {
    return cleanText(fallback);
  }

  return cleaned;
}

function looksLikeDraftReplyArtifact(text) {
  const source = cleanText(text);
  if (!source) {
    return false;
  }

  return /here is the requested translation|translated email copy|keeping the original text intact|target and source locales are the same|вот перевод|перевод вашей рассылки/i.test(source)
    || source.length > 900;
}

function buildDraftSuccessReply(payload, mail) {
  const requestedLocales = Array.from(new Set([
    normalizeLocaleCode(payload?.brief?.locale || mail?.locale || "en"),
    ...parseLocaleList(payload?.brief?.requestedLocales || "")
  ].filter(Boolean)));
  const localesNote = requestedLocales.length > 1
    ? ` Локали: ${requestedLocales.join(", ")}.`
    : "";
  const categoryNote = isSystemCategoryName(resolveBriefCategory(payload))
    ? "Собрал черновик системного письма."
    : "Собрал черновик письма.";
  return `${categoryNote} Preview, код и локали обновлены.${localesNote}`;
}

function buildTemplateSelectionUserNote(payload) {
  const selection = getReferenceTemplateSelection(payload);
  const reasons = Array.isArray(selection?.reasons) ? selection.reasons.map(cleanText).filter(Boolean) : [];
  const missingVariantReason = reasons.find((reason) => /visible variant .* not found in base/i.test(reason));
  if (!missingVariantReason) {
    return "";
  }

  const match = missingVariantReason.match(/visible variant\s+(\d{3})\s+not found in base/i);
  const digits = cleanText(match?.[1]);
  const variantLabel = digits ? digits.replace(/(\d)(\d)(\d)/, "$1-$2-$3") : "";
  const reference = cleanText(selection?.category) && cleanText(selection?.mailId)
    ? `${selection.category}/mail-${selection.mailId}`
    : "";
  const hasRussianResponse = detectPreferredResponseLanguage(payload) === "Russian";

  if (hasRussianResponse) {
    return variantLabel && reference
      ? ` Точного reference ${variantLabel} в базе пока нет, поэтому использую ближайший импортированный шаблон ${reference}.`
      : " Точного reference из макета в базе пока нет, поэтому использую ближайший импортированный шаблон.";
  }

  return variantLabel && reference
    ? ` Exact reference ${variantLabel} is not in the base yet, so I am using the closest imported template ${reference}.`
    : " The exact reference from the design is not in the base yet, so I am using the closest imported template.";
}

function deriveTitleFromUserMessage(text) {
  const candidate = cleanText(text)
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/\s+/g, " ")
    .replace(/[.?!].*$/, "");
  return candidate.length >= 12 ? candidate.slice(0, 72) : "";
}

function mergeAssetRecords(primaryAssets = [], secondaryAssets = []) {
  const merged = [];
  const seen = new Set();

  for (const asset of [...primaryAssets, ...secondaryAssets]) {
    const key = cleanText(asset?.key) || cleanText(asset?.url);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push({
      key: cleanText(asset?.key),
      url: cleanText(asset?.url),
      alt: cleanText(asset?.alt),
      placement: cleanText(asset?.placement),
      notes: cleanText(asset?.notes),
      width: Number(asset?.width) || 600,
      height: Number(asset?.height) || 300
    });
  }

  return merged.filter((asset) => asset.url);
}

function getPrimaryTemplateCta(templateMail = null) {
  const ctaSection = Array.isArray(templateMail?.sections)
    ? templateMail.sections.find((section) => cleanText(section?.cta_label) && cleanText(section?.cta_href))
    : null;

  return {
    label: cleanText(ctaSection?.cta_label),
    href: cleanText(ctaSection?.cta_href)
  };
}

function mapBlockRecommendationIdToSectionKind(blockId) {
  const normalized = cleanText(blockId);
  if (!normalized) {
    return "";
  }

  if (normalized === "header-logo-row") {
    return "header";
  }

  if (["hero-image-block", "hero-image-two-cta", "vml-bottom-hero", "vml-bottom-hero-fixed"].includes(normalized)) {
    return "hero";
  }

  if ([
    "plain-copy-text-card",
    "two-column-copy-block",
    "feature-list-stack",
    "bullet-proof-list-card"
  ].includes(normalized)) {
    return "text";
  }

  if ([
    "numbered-steps-block",
    "numbered-feature-stack",
    "feature-grid",
    "two-column-feature-grid",
    "three-promo-column-row"
  ].includes(normalized)) {
    return "feature-list";
  }

  if (["image-section-block", "image-card-block", "image-showcase-block"].includes(normalized)) {
    return "image";
  }

  if (["single-button-cta-card", "switch-cta-row"].includes(normalized)) {
    return "cta";
  }

  if (["store-badges-row", "social-links-row", "social-icons-row", "legal-unsubscribe-footer"].includes(normalized)) {
    return "footer";
  }

  return "";
}

function mapDesignRoleToSectionKind(role, fallbackBlockId = "") {
  const normalizedRole = cleanText(role);
  if (normalizedRole === "header") {
    return mapBlockRecommendationIdToSectionKind(fallbackBlockId) || "image";
  }
  if (["hero", "text", "feature-list", "image", "cta", "footer"].includes(normalizedRole)) {
    return normalizedRole;
  }
  return mapBlockRecommendationIdToSectionKind(fallbackBlockId) || "text";
}

function inferDefaultCatalogIdForSection(role = "", footerFamily = "") {
  const normalizedRole = cleanText(role);
  const normalizedFooterFamily = cleanText(footerFamily);

  if (normalizedRole === "header") {
    return "header-logo-row";
  }

  if (normalizedRole === "hero") {
    return "hero-image-block";
  }

  if (normalizedRole === "feature-list") {
    return "feature-list-stack";
  }

  if (normalizedRole === "cta") {
    return "single-button-cta-card";
  }

  if (normalizedRole === "text") {
    return "plain-copy-text-card";
  }

  if (normalizedRole === "footer") {
    if (normalizedFooterFamily.includes("store")) {
      return "store-badges-row";
    }
    if (normalizedFooterFamily.includes("social")) {
      return "social-links-row";
    }
    return "legal-unsubscribe-footer";
  }

  return "";
}

function getPreferredLocaleFromDesignHints(payload, fallbackLocale = "") {
  const explicitHints = Array.isArray(payload?.designMappingHints?.localeHints)
    ? payload.designMappingHints.localeHints
    : Array.isArray(payload?.designDecomposition?.localeHints)
      ? payload.designDecomposition.localeHints
      : Array.isArray(payload?.designSchema?.localeHints)
        ? payload.designSchema.localeHints
        : [];

  for (const localeHint of explicitHints) {
    const normalized = normalizeLocaleCode(localeHint);
    if (normalized) {
      return normalized;
    }
  }

  return normalizeLocaleCode(fallbackLocale);
}

function buildDesignHintTemplateSections(payload) {
  const blockSections = Array.isArray(payload?.designBlockRecommendations?.sectionRecommendations)
    ? payload.designBlockRecommendations.sectionRecommendations
    : [];
  const mappingSections = Array.isArray(payload?.designMappingHints?.sectionMappings)
    ? payload.designMappingHints.sectionMappings
    : [];
  const footerFamily = cleanText(payload?.designMappingHints?.footerFamily);
  const result = [];

  if (blockSections.length > 0 || mappingSections.length > 0) {
    const length = Math.max(blockSections.length, mappingSections.length);
    for (let index = 0; index < length; index += 1) {
      const mapping = mappingSections[index] || {};
      const blockSection = blockSections[index] || {};
      const sectionRole = cleanText(mapping?.role || blockSection?.role);
      const candidateIds = Array.isArray(blockSection?.candidates)
        ? blockSection.candidates.map((candidate) => cleanText(candidate?.id)).filter(Boolean)
        : [];
      const topCandidateId = candidateIds[0] || inferDefaultCatalogIdForSection(sectionRole, footerFamily);
      const kind = mapDesignRoleToSectionKind(sectionRole, topCandidateId);

      if (!kind) {
        continue;
      }

      if (sectionRole === "footer") {
        const footerCatalogIds = [];
        if (candidateIds.some((id) => id === "store-badges-row") || footerFamily.includes("store")) {
          footerCatalogIds.push("store-badges-row");
        }
        if (
          candidateIds.some((id) => ["social-links-row", "social-icons-row"].includes(id))
          || footerFamily.includes("social")
        ) {
          footerCatalogIds.push(candidateIds.find((id) => ["social-links-row", "social-icons-row"].includes(id)) || "social-links-row");
        }
        footerCatalogIds.push(
          candidateIds.find((id) => id === "legal-unsubscribe-footer")
          || "legal-unsubscribe-footer"
        );

        for (const footerCatalogId of Array.from(new Set(footerCatalogIds.filter(Boolean)))) {
          result.push({
            kind: mapBlockRecommendationIdToSectionKind(footerCatalogId) || "footer",
            sourceRole: sectionRole,
            sourceArchetype: cleanText(mapping?.archetype || blockSection?.archetype),
            recommendedCatalogId: footerCatalogId
          });
        }
        continue;
      }

      result.push({
        kind,
        sourceRole: sectionRole,
        sourceArchetype: cleanText(mapping?.archetype || blockSection?.archetype),
        recommendedCatalogId: topCandidateId
      });
    }
  }

  if (result.length === 0) {
    const designKinds = Array.isArray(payload?.designAnalysis?.section_kinds)
      ? payload.designAnalysis.section_kinds.map(cleanText).filter(Boolean)
      : [];
    result.push(...designKinds.map((kind) => ({ kind })));
  }

  const withoutFooter = result.filter((section) => cleanText(section.kind) !== "footer");
  const footerSections = result.filter((section) => cleanText(section.kind) === "footer");
  const needsFooter = footerSections.length === 0 && cleanText(payload?.designMappingHints?.footerFamily);
  if (needsFooter) {
    footerSections.push({
      kind: "footer",
      sourceRole: "footer"
    });
  }

  return [...withoutFooter, ...footerSections];
}

function buildMockSectionForKind(kind, index, context) {
  const templateSection = context.templateSections[index] || {};
  const sectionBlockId = cleanText(templateSection?.recommendedCatalogId || templateSection?.profileBlockId);
  const detailLines = context.detailLines;
  const detail = detailLines[index] || detailLines[0] || "";
  const nextDetail = detailLines[index + 1] || "";
  const sharedEyebrow = context.audience ? `Audience: ${context.audience}` : cleanText(templateSection.eyebrow);

  if (kind === "image" && sectionBlockId === "header-logo-row") {
    return {
      kind: "image",
      eyebrow: "",
      title: "",
      body: "",
      image_key: context.heroAssetKey || context.sectionAssetKey,
      cta_label: "",
      cta_href: "",
      items: []
    };
  }

  if (kind === "hero") {
    return {
      kind: "hero",
      eyebrow: sharedEyebrow || "Primary message",
      title: context.heroTitle,
      body: context.heroBody,
      image_key: context.heroAssetKey || context.sectionAssetKey,
      cta_label: context.ctaLabel,
      cta_href: context.ctaHref,
      items: []
    };
  }

  if (kind === "feature-list") {
    return {
      kind: "feature-list",
      eyebrow: cleanText(templateSection.eyebrow) || "Key points",
      title: cleanText(templateSection.title) || "Что должно быть в письме",
      body: cleanText(templateSection.body) || "Блок собран из brief, перевода и текущей структуры письма.",
      image_key: "",
      cta_label: "",
      cta_href: "",
      items: context.featureItems
    };
  }

  if (kind === "image") {
    return {
      kind: "image",
      eyebrow: cleanText(templateSection.eyebrow) || "Visual",
      title: cleanText(templateSection.title) || detail || "Визуальный блок",
      body: cleanText(templateSection.body) || nextDetail || context.supportBody,
      image_key: context.sectionAssetKey || context.heroAssetKey,
      cta_label: "",
      cta_href: "",
      items: []
    };
  }

  if (kind === "cta") {
    return {
      kind: "cta",
      eyebrow: cleanText(templateSection.eyebrow) || "Primary action",
      title: cleanText(templateSection.title) || "Главное действие",
      body: cleanText(templateSection.body) || context.ctaBody,
      image_key: "",
      cta_label: context.ctaLabel,
      cta_href: context.ctaHref,
      items: []
    };
  }

  if (kind === "footer") {
    if (sectionBlockId === "social-links-row" || sectionBlockId === "social-icons-row") {
      return {
        kind: "footer",
        eyebrow: "",
        title: "",
        body: "",
        image_key: context.sectionAssetKey,
        cta_label: "",
        cta_href: "",
        items: []
      };
    }

    if (sectionBlockId === "store-badges-row") {
      return {
        kind: "footer",
        eyebrow: "",
        title: "",
        body: "",
        image_key: context.sectionAssetKey,
        cta_label: "",
        cta_href: "",
        items: []
      };
    }

    return {
      kind: "footer",
      eyebrow: "",
      title: cleanText(templateSection.title) || "Footer",
      body: cleanText(templateSection.body) || context.footerBody,
      image_key: "",
      cta_label: "",
      cta_href: "",
      items: []
    };
  }

  return {
    kind: "text",
    eyebrow: cleanText(templateSection.eyebrow) || "Details",
    title: cleanText(templateSection.title) || detail || "Основной блок",
    body: cleanText(templateSection.body) || nextDetail || context.supportBody,
    image_key: context.sectionAssetKey,
    cta_label: "",
    cta_href: "",
    items: []
  };
}

function isWeakGeneratedSectionLayout(sections, payload, expectedSections = []) {
  const normalizedSections = Array.isArray(sections) ? sections.map((section) => normalizeSection(section)) : [];
  const mappingSections = Array.isArray(payload?.designMappingHints?.sectionMappings)
    ? payload.designMappingHints.sectionMappings
    : [];
  const expectedKinds = (Array.isArray(expectedSections) ? expectedSections : [])
    .map((section) => cleanText(section?.kind))
    .filter(Boolean);

  if (normalizedSections.length === 0) {
    return expectedKinds.length > 0 || mappingSections.length > 0;
  }

  if (mappingSections.length === 0 && expectedKinds.length === 0) {
    return false;
  }

  const kinds = normalizedSections.map((section) => cleanText(section.kind)).filter(Boolean);
  const uniqueKinds = new Set(kinds);
  let score = 0;

  if (uniqueKinds.size === 1 && uniqueKinds.has("text")) {
    score += 2;
  }

  if (mappingSections.some((section) => cleanText(section.role) === "cta") && !kinds.includes("cta")) {
    score += 2;
  }

  if (mappingSections.some((section) => cleanText(section.role) === "feature-list") && !kinds.includes("feature-list")) {
    score += 1;
  }

  if (mappingSections.some((section) => ["hero", "image"].includes(cleanText(section.role))) && !kinds.some((kind) => ["hero", "image"].includes(kind))) {
    score += 1;
  }

  if (mappingSections.some((section) => cleanText(section.role) === "footer") && !kinds.includes("footer")) {
    score += 2;
  }

  const nonHeaderExpectedCount = expectedKinds.filter((kind) => kind !== "header").length;
  if (nonHeaderExpectedCount >= 3 && normalizedSections.length < Math.max(2, nonHeaderExpectedCount - 1)) {
    score += 1;
  }

  return score >= 3;
}

function repairMailSectionsFromDesignHints(mail, payload) {
  const expectedSections = buildDesignHintTemplateSections(payload);
  if (expectedSections.length === 0 || !isWeakGeneratedSectionLayout(mail?.sections, payload, expectedSections)) {
    return mail;
  }

  return {
    ...mail,
    sections: mergeGeneratedSectionsOntoTemplateSections(expectedSections, mail?.sections)
  };
}

function buildFallbackMail(payload, options = {}) {
  const includeCurrentDraft = Boolean(options.includeCurrentDraft);
  const templateMail = options.templateMail && typeof options.templateMail === "object"
    ? options.templateMail
    : includeCurrentDraft && payload?.currentDraft && typeof payload.currentDraft === "object"
      ? payload.currentDraft
      : null;
  const translationSeed = findPreferredTranslationEntry(payload.translationText, payload.brief.locale, {
    locale: payload.brief.locale || templateMail?.locale || "en",
    subject: templateMail?.subject || "",
    preheader: templateMail?.preheader || "",
    sections: Array.isArray(templateMail?.sections) ? templateMail.sections : [],
    body_blocks: []
  });
  const translatedBlocks = Array.isArray(translationSeed?.body_blocks) ? translationSeed.body_blocks : [];
  const detailLines = translatedBlocks.length > 0
    ? translatedBlocks
    : defaultFeatureItems(payload);
  const latestUserMessage = getLatestUserMessage(payload);
  const templateCta = getPrimaryTemplateCta(templateMail);
  const uploadedAssets = createAssetRecords(payload);
  const templateAssets = Array.isArray(templateMail?.assets) ? templateMail.assets : [];
  const assets = mergeAssetRecords(uploadedAssets, templateAssets);
  const locale = payload.brief.locale
    || getPreferredLocaleFromDesignHints(payload, cleanText(templateMail?.locale))
    || cleanText(templateMail?.locale)
    || "en";
  const heroTitle = cleanText(
    translatedBlocks[0]
    || payload.brief.campaignName
    || deriveTitleFromUserMessage(latestUserMessage)
    || templateMail?.sections?.find((section) => cleanText(section?.kind) === "hero")?.title
    || templateMail?.sections?.find((section) => cleanText(section?.title))?.title
    || "Новый email draft"
  );
  const heroBody = cleanText(
    translatedBlocks[1]
    || payload.brief.goal
    || payload.brief.contentNotes
    || templateMail?.sections?.find((section) => cleanText(section?.kind) === "hero")?.body
    || templateMail?.sections?.find((section) => cleanText(section?.body))?.body
    || "Собираем письмо на базе brief, текущих переводов и структуры из email-base."
  );
  const subject = cleanText(
    translationSeed?.subject
    || payload.brief.campaignName
    || deriveTitleFromUserMessage(latestUserMessage)
    || templateMail?.subject
    || heroTitle
  );
  const preheader = cleanText(
    translationSeed?.preheader
    || payload.brief.goal
    || templateMail?.preheader
    || heroBody.slice(0, 120)
  );
  const ctaLabel = cleanText(
    payload.brief.primaryCta
    || translationSeed?.cta_labels?.[0]
    || templateCta.label
    || "Open email"
  );
  const ctaHref = cleanText(
    payload.brief.primaryLink
    || templateCta.href
    || ""
  );
  const heroAssetKey = getAssetByPlacement(assets, ["hero", "background"])?.key
    || assets[0]?.key
    || "";
  const sectionAssetKey = getAssetByPlacement(assets, ["section", "feature"])?.key
    || heroAssetKey;
  const rawTemplateSections = Array.isArray(templateMail?.sections) && templateMail.sections.length > 0
    ? templateMail.sections.filter((section) => {
        const signal = `${cleanText(section?.title)} ${cleanText(section?.body)}`.toLowerCase();
        return !(cleanText(section?.kind) === "image" && /logo|header logo/.test(signal));
      })
    : [];
  const designDrivenSections = buildDesignHintTemplateSections(payload);
  const guidedTemplateSections = rawTemplateSections.length > 0 && designDrivenSections.length > 0
    ? buildDesignGuidedTemplateSections(rawTemplateSections, payload)
    : attachStructureProfileHintsToTemplateSections(rawTemplateSections, payload);
  const heroSections = rawTemplateSections.filter((section) => cleanText(section?.kind) === "hero");
  const footerSections = rawTemplateSections.filter((section) => cleanText(section?.kind) === "footer");
  const middleSections = rawTemplateSections.filter((section) => !["hero", "footer"].includes(cleanText(section?.kind)));
  const profiledTemplateSections = guidedTemplateSections.length > 0
    ? guidedTemplateSections
    : [...heroSections, ...middleSections, ...footerSections].map((section) => normalizeSection(section));
  const templateSections = profiledTemplateSections.length > 0
    ? profiledTemplateSections
    : designDrivenSections.length > 0
      ? designDrivenSections
    : [
        { kind: "hero" },
        { kind: "text" },
        { kind: "feature-list" },
        { kind: "cta" },
        { kind: "footer" }
      ];
  const featureItems = detailLines.slice(2, 6).length > 0
    ? detailLines.slice(2, 6)
    : defaultFeatureItems(payload);
  const context = {
    audience: payload.brief.audience,
    templateSections,
    detailLines,
    heroTitle,
    heroBody,
    supportBody: detailLines[1] || payload.brief.contentNotes || heroBody,
    ctaBody: payload.brief.goal || detailLines.at(-1) || "Пользователь должен получить один четкий CTA и перейти по основной ссылке.",
    footerBody: cleanText(templateMail?.sections?.find((section) => cleanText(section.kind) === "footer")?.body)
      || "Footer, legal и unsubscribe copy нужно подтвердить перед отправкой.",
    featureItems,
    ctaLabel,
    ctaHref,
    heroAssetKey,
    sectionAssetKey
  };

  const sections = templateSections
    .map((section, index) => buildMockSectionForKind(cleanText(section?.kind) || "text", index, context))
    .filter((section, index, collection) => section.kind !== "image" || Boolean(section.image_key) || collection.length <= 3);

  const mail = {
    subject,
    preheader,
    locale,
    summary: heroBody,
    brand_logo_url: cleanText(templateMail?.brand_logo_url),
    brand_logo_alt: cleanText(templateMail?.brand_logo_alt),
    sections,
    assets,
    translations: []
  };

  mail.translations = parseTranslationSeed(payload.translationText, mail);
  return mail;
}

function normalizeBoldTokens(text) {
  return cleanText(text).replace(/@@(.*?)@@/g, "**$1**");
}

function unwrapTranslationBraces(text) {
  return cleanText(text).replace(/^\{\{\s*/, "").replace(/\s*\}\}$/, "").trim();
}

function extractLocaleFromFilename(fileName) {
  const match = cleanText(fileName).match(/_([a-z]{2}(?:[_-][A-Za-z]{2})?)(?:_|\.|$)/);
  return match ? normalizeLocaleCode(match[1]) : "";
}

function splitTranslationDocuments(translationText) {
  const raw = cleanText(translationText);
  if (!raw) {
    return [];
  }

  const marker = /^=== FILE: (.+?) ===$/gm;
  const matches = [...raw.matchAll(marker)];
  if (matches.length === 0) {
    return [{ name: "inline.txt", content: raw }];
  }

  const docs = [];
  for (let index = 0; index < matches.length; index += 1) {
    const current = matches[index];
    const start = current.index + current[0].length;
    const end = index + 1 < matches.length ? matches[index + 1].index : raw.length;
    docs.push({
      name: cleanText(current[1]) || `translation-${index + 1}.txt`,
      content: raw.slice(start, end).trim()
    });
  }

  return docs.filter((doc) => doc.content);
}

// Detect AI-generated internal instruction text leaking into preheader/snippet field.
// When the model doesn't know what to put, it sometimes writes the task description instead.
function isSystemPlaceholderText(text) {
  const t = cleanText(text);
  if (!t || t.length < 8) return false;
  return /собираем\s+письм|собери\s+письм|build a simple email|use system structure|системн[ыйая]\s+прехедер|текущих переводов|на базе brief|из email-base|based on (?:brief|template|email-base)|system preheader/i.test(t);
}

function parseTxtTranslationDoc(doc) {
  const content = cleanText(doc.content);
  if (!content) {
    return null;
  }

  const lines = content.split(/\r?\n/).map((line) => line.trim());
  const subjectLine = lines.find((line) => /^Subject:\s*/i.test(line)) || "";
  const snippetLine = lines.find((line) => /^Snippet:\s*/i.test(line)) || "";
  const subject = cleanText(subjectLine.replace(/^Subject:\s*/i, ""));
  const rawPreheader = cleanText(snippetLine.replace(/^Snippet:\s*/i, ""));
  // Drop internal instruction text that AI sometimes puts into the snippet field
  const preheader = isSystemPlaceholderText(rawPreheader) ? "" : rawPreheader;
  const pushIndex = lines.findIndex((line) => /^PUSH$/i.test(line));
  const contentLines = pushIndex >= 0 ? lines.slice(0, pushIndex) : lines;
  const blocks = contentLines
    .filter((line) => /^\{\{[\s\S]*\}\}$/.test(line))
    .map((line) => normalizeBoldTokens(unwrapTranslationBraces(line)))
    .filter(Boolean);
  const pushLines = pushIndex >= 0
    ? lines.slice(pushIndex + 1).map(normalizeBoldTokens).filter(Boolean)
    : [];
  const localeFromName = extractLocaleFromFilename(doc.name);
  const locale = localeFromName || "unknown";

  if (!subject && !preheader && blocks.length === 0) {
    return null;
  }

  const notesParts = [
    `file=${doc.name}`,
    `blocks=${blocks.length}`,
    pushLines.length > 0 ? `push=${pushLines.length}` : "",
    blocks[0] ? `first=${blocks[0].slice(0, 90)}` : ""
  ].filter(Boolean);

  return {
    locale,
    subject: normalizeBoldTokens(unwrapTranslationBraces(subject)),
    preheader: normalizeBoldTokens(unwrapTranslationBraces(preheader)),
    cta_labels: pushLines.slice(-2),
    notes: notesParts.join(" | "),
    body_blocks: blocks,
    source_name: doc.name
  };
}

function parseJsonTranslationEntries(translationText, mail) {
  try {
    const parsed = JSON.parse(translationText);
    if (Array.isArray(parsed)) {
      return parsed.map((entry) => normalizeTranslationEntry(entry, mail));
    }

    if (parsed && typeof parsed === "object") {
      if ("locale" in parsed) {
        return [normalizeTranslationEntry(parsed, mail)];
      }

      return Object.entries(parsed).map(([locale, value]) => {
        const payloadValue = value && typeof value === "object" ? value : {};
        return normalizeTranslationEntry({ locale, ...payloadValue }, mail);
      });
    }
  } catch {
    return [];
  }

  return [];
}

function parseTranslationDoc(doc, mail) {
  const extension = path.extname(cleanText(doc.name)).toLowerCase();

  if (extension === ".json") {
    return parseJsonTranslationEntries(doc.content, mail).map((entry) => ({
      ...entry,
      source_name: cleanText(entry.source_name) || doc.name
    }));
  }

  const txtEntry = parseTxtTranslationDoc(doc);
  return txtEntry ? [normalizeTranslationEntry(txtEntry, mail)] : [];
}

function parseTranslationEntries(translationText, mail) {
  const docs = splitTranslationDocuments(translationText);
  const docEntries = docs.flatMap((doc) => parseTranslationDoc(doc, mail));

  if (docEntries.length > 0) {
    return docEntries;
  }

  return parseJsonTranslationEntries(translationText, mail);
}

function summarizeTranslationText(translationText) {
  const txtEntries = parseTranslationEntries(translationText, {
    locale: "en",
    subject: "",
    preheader: "",
    sections: []
  });

  if (txtEntries.length > 0) {
    return txtEntries
      .map((entry) => {
        const sample = (entry.body_blocks || []).slice(0, 3).join(" | ").slice(0, 180);
        const sourceName = entry.source_name || "inline";
        return `${entry.locale} from ${sourceName}: subject="${entry.subject}" | snippet="${entry.preheader}" | blocks=${(entry.body_blocks || []).length} | sample=${sample}`;
      })
      .join("\n");
  }

  return cleanText(translationText) || "None";
}

function findPreferredTranslationEntry(translationText, preferredLocale, mail) {
  const entries = parseTranslationEntries(translationText, mail);
  if (entries.length === 0) {
    return null;
  }

  const normalizedPreferred = normalizeLocaleCode(preferredLocale).toLowerCase();
  return entries.find((entry) => normalizeLocaleCode(entry.locale).toLowerCase() === normalizedPreferred)
    || entries.find((entry) => normalizeLocaleCode(entry.locale).toLowerCase().startsWith(normalizedPreferred.split(/[_-]/)[0] || ""))
    || entries[0];
}

function parseTranslationSeed(translationText, mail) {
  const fallbackLocale = mail.locale || "en";
  const fallback = [
    {
      locale: fallbackLocale,
      subject: mail.subject,
      preheader: mail.preheader,
      cta_labels: collectCtaLabels(mail),
      notes: cleanText(translationText).slice(0, 240),
      body_blocks: [],
      source_name: ""
    }
  ];

  if (!translationText) {
    return fallback;
  }

  const entries = parseTranslationEntries(translationText, mail);
  if (entries.length > 0) {
    return entries;
  }

  return fallback;
}

function normalizeTranslationEntry(entry, mail) {
  const rawPreheader = cleanText(entry?.preheader);
  const preheader = isSystemPlaceholderText(rawPreheader) ? "" : (rawPreheader || mail.preheader);
  return {
    locale: normalizeLocaleCode(entry?.locale) || normalizeLocaleCode(mail.locale) || "en",
    subject: cleanText(entry?.subject) || mail.subject,
    preheader,
    cta_labels: Array.isArray(entry?.cta_labels) && entry.cta_labels.length > 0
      ? entry.cta_labels.map(cleanText).filter(Boolean)
      : collectCtaLabels(mail),
    notes: cleanText(entry?.notes),
    body_blocks: Array.isArray(entry?.body_blocks)
      ? entry.body_blocks.map(normalizeBoldTokens).filter(Boolean)
      : [],
    source_name: cleanText(entry?.source_name)
  };
}

function collectCtaLabels(mail) {
  return Array.from(new Set(Array.isArray(mail?.sections)
    ? mail.sections
    .map((section) => cleanText(section.cta_label))
    .filter(Boolean)
    : []));
}

function deriveBodyBlocksFromMail(mail) {
  const blocks = [];

  for (const section of Array.isArray(mail?.sections) ? mail.sections : []) {
    if (section.kind === "footer") {
      continue;
    }

    if (section.title) {
      blocks.push(cleanText(section.title));
    }

    if (section.body) {
      blocks.push(cleanText(section.body));
    }

    if (Array.isArray(section.items) && section.items.length > 0) {
      for (const item of section.items) {
        const text = cleanText(item);
        if (text) {
          blocks.push(text);
        }
      }
    }
  }

  return blocks.filter(Boolean);
}

function dedupeTranslationEntries(entries, mail) {
  const map = new Map();

  for (const rawEntry of entries) {
    const normalized = normalizeTranslationEntry(rawEntry, mail);
    const locale = normalizeLocaleCode(normalized.locale) || mail.locale || "en";
    map.set(locale, {
      ...normalized,
      locale,
      source_name: cleanText(normalized.source_name) || `${locale}.txt`
    });
  }

  return [...map.values()];
}

function localeMatchesRequest(existingLocale, requestedLocale) {
  const existing = normalizeLocaleCode(existingLocale);
  const requested = normalizeLocaleCode(requestedLocale);

  if (!existing || !requested) {
    return false;
  }

  if (existing === requested) {
    return true;
  }

  const requestedParts = requested.split("_");
  const existingParts = existing.split("_");
  return requestedParts.length === 1 && existingParts[0] === requestedParts[0];
}

function hasLocaleEntryForRequest(localePayloads, requestedLocale) {
  if (!(localePayloads instanceof Map)) {
    return false;
  }

  return [...localePayloads.keys()].some((locale) => localeMatchesRequest(locale, requestedLocale));
}

function resolveLocalePayloadKey(localePayloads, requestedLocale) {
  if (!(localePayloads instanceof Map)) {
    return "";
  }

  const requested = normalizeLocaleCode(requestedLocale);
  if (!requested) {
    return [...localePayloads.keys()][0] || "";
  }

  const direct = [...localePayloads.keys()].find((locale) => normalizeLocaleCode(locale) === requested);
  if (direct) {
    return direct;
  }

  const prefixMatch = [...localePayloads.keys()].find((locale) => localeMatchesRequest(locale, requested));
  return prefixMatch || [...localePayloads.keys()][0] || "";
}

function collapseRedundantTranslationEntries(entries) {
  return entries.filter((entry) => {
    const locale = normalizeLocaleCode(entry.locale);
    if (!locale || locale.includes("_")) {
      return true;
    }

    return !entries.some((otherEntry) => {
      const otherLocale = normalizeLocaleCode(otherEntry.locale);
      return otherLocale.startsWith(`${locale}_`)
        && cleanText(otherEntry.source_name) === cleanText(entry.source_name)
        && cleanText(otherEntry.subject) === cleanText(entry.subject)
        && cleanText(otherEntry.preheader) === cleanText(entry.preheader);
    });
  });
}

function sortTranslationEntries(entries, primaryLocale, requestedLocales = []) {
  const requestedOrder = parseLocaleList(requestedLocales.join(" "));
  const primary = normalizeLocaleCode(primaryLocale);

  return [...entries].sort((left, right) => {
    const leftLocale = normalizeLocaleCode(left.locale);
    const rightLocale = normalizeLocaleCode(right.locale);

    if (leftLocale === primary && rightLocale !== primary) {
      return -1;
    }
    if (rightLocale === primary && leftLocale !== primary) {
      return 1;
    }

    const leftRequested = requestedOrder.indexOf(leftLocale);
    const rightRequested = requestedOrder.indexOf(rightLocale);
    if (leftRequested !== rightRequested) {
      return (leftRequested === -1 ? Number.MAX_SAFE_INTEGER : leftRequested)
        - (rightRequested === -1 ? Number.MAX_SAFE_INTEGER : rightRequested);
    }

    return leftLocale.localeCompare(rightLocale);
  });
}

function formatBoldTokensForTxt(value) {
  return cleanText(value).replace(/\*\*(.*?)\*\*/g, "@@$1@@");
}

function renderTranslationEntryContent(entry) {
  const lines = [];
  const subject = formatBoldTokensForTxt(entry.subject);
  const preheader = formatBoldTokensForTxt(entry.preheader);

  if (subject) {
    lines.push(`Subject: ${subject}`);
  }

  if (preheader) {
    lines.push(`Snippet: ${preheader}`);
  }

  if (lines.length > 0 && Array.isArray(entry.body_blocks) && entry.body_blocks.length > 0) {
    lines.push("");
  }

  for (const block of Array.isArray(entry.body_blocks) ? entry.body_blocks : []) {
    lines.push(`{{${formatBoldTokensForTxt(block)}}}`);
    lines.push("");
  }

  const ctaLabels = Array.isArray(entry.cta_labels)
    ? entry.cta_labels.map(formatBoldTokensForTxt).filter(Boolean)
    : [];

  if (ctaLabels.length > 0) {
    if (lines.length > 0 && lines.at(-1) !== "") {
      lines.push("");
    }
    lines.push("PUSH");
    lines.push(...ctaLabels);
  }

  return lines.join("\n").trim();
}

function renderTranslationBundle(entries) {
  return entries
    .map((entry, index) => {
      const fileName = cleanText(entry.source_name)
        || `generated_${normalizeLocaleCode(entry.locale) || `locale_${index + 1}`}.txt`;
      return `=== FILE: ${fileName} ===\n${renderTranslationEntryContent(entry)}`;
    })
    .join("\n\n");
}

function buildSourceTranslationEntry(mail, payload) {
  const preferred = findPreferredTranslationEntry(payload.translationText, payload.brief.locale, mail);
  if (preferred) {
    const normalized = normalizeTranslationEntry(preferred, mail);
    if (normalized.body_blocks.length === 0) {
      normalized.body_blocks = deriveBodyBlocksFromMail(mail);
    }
    if (normalized.cta_labels.length === 0) {
      normalized.cta_labels = collectCtaLabels(mail);
    }
    if (!normalized.source_name) {
      normalized.source_name = `derived_${normalized.locale}.txt`;
    }
    return normalized;
  }

  return normalizeTranslationEntry({
    locale: normalizeLocaleCode(payload.brief.locale || mail.locale || "en"),
    subject: mail.subject,
    preheader: mail.preheader,
    cta_labels: collectCtaLabels(mail),
    notes: "Derived from current draft",
    body_blocks: deriveBodyBlocksFromMail(mail),
    source_name: `derived_${normalizeLocaleCode(payload.brief.locale || mail.locale || "en")}.txt`
  }, mail);
}

function createMockDraft(payload, warning = "") {
  const mail = buildFallbackMail(payload, { includeCurrentDraft: true });
  const reusingStructure = Boolean(payload.currentDraft?.sections?.length);
  const suffix = warning ? ` Сейчас включен mock-режим: ${warning}.` : "";
  return {
    assistant_reply: reusingStructure
      ? `Обновил draft на базе текущей структуры письма и ваших материалов.${suffix}`
      : `Собрал draft по brief, переводам, design reference и доступным блокам.${suffix}`,
    mail
  };
}

async function createProjectAwareMockDraft(payload, warning = "") {
  if (payload.currentDraft?.sections?.length) {
    return createMockDraft(payload, warning);
  }

  const summary = summarizeEmailBase();
  if (!summary.available || !summary.currentMail) {
    return createMockDraft(payload, warning);
  }

  try {
    const templateSelection = getReferenceTemplateSelection(payload);
    if (isIqRfmReferenceSelection(templateSelection)) {
      const mail = buildFallbackMail(payload, {
        templateMail: buildIqRfmReferenceTemplateMail(payload, templateSelection.mailId)
      });
      const suffix = warning ? ` Сейчас включен mock-режим: ${warning}.` : "";
      return {
        assistant_reply: `Собрал draft на базе email-base reference ${templateSelection.category}/mail-${templateSelection.mailId}.${suffix}`,
        mail
      };
    }

    const referenceTarget = resolveReferenceTemplateMailTarget(payload);
    const preview = await buildEmailBasePreview(
      referenceTarget.category || payload.brief.category || summary.currentMail.category,
      referenceTarget.mailId || payload.brief.mailId || summary.currentMail.mailId,
      payload.brief.locale || "en"
    );
    const mail = buildFallbackMail(payload, {
      templateMail: preview.draft?.mail || null
    });
    const suffix = warning ? ` Сейчас включен mock-режим: ${warning}.` : "";
    return {
      assistant_reply: `Собрал draft на базе email-base reference ${templateSelection.category}/mail-${templateSelection.mailId}.${suffix}`,
      mail
    };
  } catch (error) {
    return createMockDraft(payload, cleanText(error?.message) || warning);
  }
}

function createMockDiscussion(payload, warning = "") {
  const lastUserMessage = [...payload.messages].reverse().find((message) => message.role === "user")?.content || "";
  const draft = payload.currentDraft;
  const hasDesign = hasDesignInput(payload);
  const figmaNeedsAccessHelp = needsFigmaAccessClarification(payload);
  const hasTranslations = Boolean(payload.translationText);
  const translationEntries = parseTranslationEntries(payload.translationText, draft || buildFallbackMail(payload));
  const translationCount = translationEntries.length;
  const assetPlan = payload.assetInputs
    .filter((asset) => asset.url)
    .map((asset, index) => `${resolveAssetKey(asset, index, resolveAssetPlacement(asset, index))} -> ${resolveAssetPlacement(asset, index)}`)
    .join(", ");
  const assetRecommendations = draft ? buildAssetRecommendations({ sections: draft.sections || [] }, payload) : [];
  const libraryHint = assetRecommendations
    .find((entry) => entry.status === "needs-asset" && entry.matches.length > 0);
  const questions = collectDiscussionQuestions(payload, draft);
  const askedToBuildFromDesign = /(сверст|build|layout|design|дизайн|скрин|screenshot|figma)/i.test(lastUserMessage);
  const capabilityQuestion = /(что ты умеешь|что ты можешь|какое письмо.*смож|какое письмо.*умеешь|what can you|what email)/i.test(lastUserMessage);
  const mockVisionWarning = warning && hasDesign && askedToBuildFromDesign
    ? "В текущем mock-режиме я вижу только факт приложенного design reference, но не разбираю картинку по пикселям. Для этого нужен live OpenAI provider с API key."
    : "";

  if (!draft && figmaNeedsAccessHelp) {
    return {
      assistantReply: [
        buildFigmaAccessBlockedAssistantReply(payload),
        warning ? `Текущий режим: ${warning}.` : ""
      ].filter(Boolean).join(" ")
    };
  }

  if (capabilityQuestion) {
    return {
      assistantReply: [
        "Сейчас я могу собрать draft из brief, переводов, картинок и структуры текущего письма из email-base.",
        "Если сначала загрузить базовое письмо из email-base, я буду опираться на ваши блоки и текущую модель верстки.",
        hasDesign ? "Design reference вижу." : "Design reference пока не приложен.",
        hasTranslations ? `Переводы уже есть: ${translationCount} locale(s).` : "Переводы можно приложить txt/json bundle или целой папкой.",
        warning ? `Текущий режим: ${warning}.` : "",
        warning ? "Без OPENAI_API_KEY это mock-режим, а не настоящая vision-модель." : ""
      ].filter(Boolean).join(" ")
    };
  }

  if (!draft) {
    return {
      assistantReply: [
        "Рабочего draft пока нет, но контекст студии я уже вижу.",
        hasDesign ? "Design reference уже приложен." : "Design reference пока не приложен.",
        figmaNeedsAccessHelp ? "Вижу Figma link, но для надежной работы нужен open draft/share link или скрин/export выбранного frame." : "",
        hasTranslations ? `В bundle сейчас ${translationCount} locale(s).` : "Переводы пока не приложены.",
        assetPlan ? `Картинки уже размечены так: ${assetPlan}.` : "Картинки пока не размечены.",
        mockVisionWarning,
        questions.length > 0
          ? `Чтобы собрать нормальный draft, мне нужны ответы на вопросы: ${formatDiscussionQuestions(questions)}`
          : "Контекста уже хватает, можно жать «Применить к письму» и собирать первый draft.",
        warning ? `Текущий режим: ${warning}.` : ""
      ].filter(Boolean).join(" ")
    };
  }

  return {
    assistantReply: [
      `Обсуждаю текущее письмо. Последний запрос: "${lastUserMessage || "без явного вопроса"}".`,
      hasDesign ? "Design reference уже есть." : "Design reference пока не загружен.",
      figmaNeedsAccessHelp ? "Если этот Figma frame приватный, пришли open draft/share link или скрин/export именно этого frame." : "",
      hasTranslations ? `Переводы уже приложены: ${translationCount} locale(s).` : "Переводы пока не приложены.",
      assetPlan ? `Картинки размечены так: ${assetPlan}.` : "Картинки пока не размечены по ролям.",
      libraryHint
        ? `В asset library уже есть кандидаты для блока "${libraryHint.sectionTitle}": ${libraryHint.matches.map((item) => item.label).join(", ")}.`
        : "",
      mockVisionWarning,
      questions.length > 0
        ? `Сейчас мне еще нужны ответы на вопросы: ${formatDiscussionQuestions(questions)}`
        : "По текущему контексту уже можно либо обсуждать точечные правки, либо жать обновление draft.",
      warning ? `Текущий режим: ${warning}.` : ""
    ].join(" ")
  };
}

function createMockTranslations(payload, mail, sourceEntry, targetLocales, warning = "") {
  const translations = targetLocales.map((locale) => normalizeTranslationEntry({
    locale,
    subject: sourceEntry.subject || mail.subject,
    preheader: sourceEntry.preheader || mail.preheader,
    cta_labels: sourceEntry.cta_labels?.length > 0 ? sourceEntry.cta_labels : collectCtaLabels(mail),
    notes: `Mock placeholder copied from ${sourceEntry.locale || mail.locale}. Replace with reviewed translation before send.`,
    body_blocks: sourceEntry.body_blocks?.length > 0 ? sourceEntry.body_blocks : deriveBodyBlocksFromMail(mail),
    source_name: `mock-generated_${locale}.txt`
  }, mail));

  return {
    assistant_reply: [
      `Собрал ${translations.length} missing locale(s) как placeholder bundle.`,
      warning || "Mock translation mode selected."
    ].filter(Boolean).join(" "),
    translations
  };
}

function hasTrackingParams(url) {
  return /[?&](utm_[^=]+|click_id|sub\d*=|aff|ref=|cid=|pid=|gclid=|fbclid=|yclid=)/i.test(cleanText(url));
}

function collectDiscussionQuestions(payload, draft) {
  const questions = [];
  const assets = payload.assetInputs.filter((asset) => asset.url);
  const libraryItems = Array.isArray(payload.assetRegistryItems) ? payload.assetRegistryItems : [];
  const hasDesign = hasDesignInput(payload);
  const heroAssetExists = assets.some((asset, index) => resolveAssetPlacement(asset, index) === "hero");
  const sectionAssetExists = assets.some((asset, index) => {
    const placement = resolveAssetPlacement(asset, index);
    return placement === "section" || placement === "feature";
  });
  const heroLibraryCandidate = libraryItems.some((item) => ["hero", "background"].includes(cleanText(item.placement)));
  const sectionLibraryCandidate = libraryItems.some((item) => ["section", "feature"].includes(cleanText(item.placement)));

  if (needsFigmaAccessClarification(payload)) {
    questions.push("Ссылка на Figma уже есть. Это open draft/share link, или лучше приложишь скрин/export выбранного frame?");
  }

  if (!heroAssetExists) {
    questions.push(heroLibraryCandidate
      ? "Hero-картинки в текущем письме нет, но в asset library уже есть кандидаты. Берем одну из них или делаем новый visual?"
      : "Нужна ли hero-картинка для первого экрана, или делаем сильный текстовый hero без визуала?");
  }

  if (draft && draft.sections?.some((section) => section.kind === "text" || section.kind === "feature-list") && !sectionAssetExists) {
    questions.push(sectionLibraryCandidate
      ? "Для body-блока в текущем письме нет картинки, но в library уже есть section/feature candidates. Подставляем одну из них?"
      : "Нужна ли отдельная body/section image для контентного блока, или оставляем письмо почти текстовым?");
  }

  if (!hasDesign) {
    questions.push("Есть ли дизайн, референс или хотя бы скрин структуры письма, чтобы точнее собрать блоки?");
  }

  if (!draft && !payload.brief.contentNotes && !payload.translationText) {
    questions.push("Если уже есть готовый текст письма или ключевые блоки копирайта, скинь их в чат или приложи locale bundle.");
  }

  return questions.slice(0, 2);
}

function formatDiscussionQuestions(questions) {
  return questions.map((question, index) => `${index + 1}) ${question}`).join(" ");
}

function buildTranslationMessages(payload, sourceEntry, targetLocales) {
  const sourceBlocks = (sourceEntry.body_blocks || [])
    .map((block, index) => `${index + 1}. ${block}`)
    .join("\n");
  const sourceCtas = (sourceEntry.cta_labels || []).join(" | ");

  return [
    {
      role: "system",
      content: [{
        type: "input_text",
        text: "You translate email copy into requested locales. Keep structure intact, preserve numbers, emojis, URLs, placeholders, and **strong emphasis** markers. Return the same number of body_blocks in the same order as the source. Do not merge a headline into a paragraph and do not move CTA copy into another block. Translate naturally for each locale and do not add commentary outside the structured output. Write assistant_reply in the user's language."
      }]
    },
    {
      role: "user",
      content: [{
        type: "input_text",
        text: [
          `Campaign name: ${payload.brief.campaignName || "Untitled campaign"}`,
          `Goal: ${payload.brief.goal || "Not specified"}`,
          `Audience: ${payload.brief.audience || "Not specified"}`,
          `Tone: ${payload.brief.tone || "Not specified"}`,
          `Source locale: ${sourceEntry.locale}`,
          `Target locales: ${targetLocales.join(", ")}`,
          `Source subject: ${sourceEntry.subject}`,
          `Source preheader: ${sourceEntry.preheader}`,
          `Source CTA labels: ${sourceCtas || "None"}`,
          "Source body blocks:",
          sourceBlocks || "1. No explicit blocks provided"
        ].join("\n")
      }]
    }
  ];
}

function normalizeMail(rawMail, payload) {
  const fallback = buildFallbackMail(payload);
  const mail = rawMail && typeof rawMail === "object" ? rawMail : fallback;

  let normalized = {
    subject: cleanText(mail.subject) || fallback.subject,
    preheader: cleanText(mail.preheader) || fallback.preheader,
    locale: cleanText(mail.locale) || getPreferredLocaleFromDesignHints(payload, fallback.locale) || fallback.locale,
    summary: cleanText(mail.summary) || fallback.summary,
    brand_logo_url: cleanText(mail.brand_logo_url) || cleanText(fallback.brand_logo_url),
    brand_logo_alt: cleanText(mail.brand_logo_alt) || cleanText(fallback.brand_logo_alt),
    sections: Array.isArray(mail.sections) && mail.sections.length > 0
      ? mail.sections.map((section) => normalizeSection(section))
      : fallback.sections,
    assets: Array.isArray(mail.assets) && mail.assets.length > 0
      ? mail.assets.map((asset, index) => normalizeAsset(asset, index))
      : fallback.assets,
    translations: Array.isArray(mail.translations) && mail.translations.length > 0
      ? mail.translations.map((entry) => normalizeTranslationEntry(entry, mail))
      : parseTranslationSeed(payload.translationText, fallback)
  };

  normalized = repairMailSectionsFromDesignHints(normalized, payload);
  normalized.assets = applyDesignDrivenAssetPlacements(normalized.assets, payload);

  if (!normalized.assets.some((asset) => asset.key === "hero_asset") && normalized.assets.length > 0) {
    normalized.assets[0].key = "hero_asset";
  }

  for (const section of normalized.sections) {
    if (section.image_key && !normalized.assets.some((asset) => asset.key === section.image_key)) {
      section.image_key = normalized.assets[0]?.key || "";
    }
  }

  return applyDeterministicDraftEdits(adaptMailToCategory(normalized, payload), payload);
}

function isPlaceholderPreviewAsset(asset) {
  const url = cleanText(asset?.url).toLowerCase();
  return !url || url.includes("placehold.co");
}

function isLikelyLogoAsset(asset) {
  const placement = cleanText(asset?.placement).toLowerCase();
  if (placement === "logo") {
    return true;
  }

  const width = Number(asset?.width) || 0;
  const height = Number(asset?.height) || 0;
  const source = [
    cleanText(asset?.key),
    cleanText(asset?.alt),
    cleanText(asset?.notes),
    cleanText(asset?.url)
  ].join(" ").toLowerCase();

  if (!(/logo|brand|header/i.test(source)) || isScreenshotLikeText(source)) {
    return false;
  }

  if (width > 0 && height > 0) {
    return height <= 160 && width <= 360;
  }

  return false;
}

function isLikelyStoreBadgeAsset(asset) {
  const source = [
    cleanText(asset?.key),
    cleanText(asset?.alt),
    cleanText(asset?.notes),
    cleanText(asset?.url)
  ].join(" ").toLowerCase();

  return /(app store|appstore|google play|googleplay|badge|store badge)/i.test(source);
}

function isLikelySocialAsset(asset) {
  const source = [
    cleanText(asset?.key),
    cleanText(asset?.alt),
    cleanText(asset?.notes),
    cleanText(asset?.url)
  ].join(" ").toLowerCase();

  return /(social|facebook|instagram|twitter|x\.com|telegram|youtube|linkedin|tiktok)/i.test(source);
}

function applyDesignDrivenAssetPlacements(assets, payload) {
  const normalizedAssets = Array.isArray(assets) ? assets.map((asset) => ({ ...asset })) : [];
  if (normalizedAssets.length === 0) {
    return normalizedAssets;
  }

  const desiredRoles = Array.isArray(payload?.designMappingHints?.desiredAssetRoles)
    ? payload.designMappingHints.desiredAssetRoles.map(cleanText).filter(Boolean)
    : [];
  if (desiredRoles.length === 0) {
    return normalizedAssets;
  }

  const currentPlacements = new Set(normalizedAssets.map((asset) => cleanText(asset.placement)).filter(Boolean));

  if (desiredRoles.includes("logo") && !currentPlacements.has("logo")) {
    const logoAsset = normalizedAssets.find((asset) => isLikelyLogoAsset(asset));
    if (logoAsset) {
      logoAsset.placement = "logo";
      currentPlacements.add("logo");
    }
  }

  if (desiredRoles.includes("badge") && !currentPlacements.has("badge")) {
    const badgeAsset = normalizedAssets.find((asset) => isLikelyStoreBadgeAsset(asset));
    if (badgeAsset) {
      badgeAsset.placement = "badge";
      currentPlacements.add("badge");
    }
  }

  if (desiredRoles.includes("social") && !currentPlacements.has("social")) {
    const socialAsset = normalizedAssets.find((asset) => isLikelySocialAsset(asset));
    if (socialAsset) {
      socialAsset.placement = "social";
      currentPlacements.add("social");
    }
  }

  if (desiredRoles.includes("background") && !currentPlacements.has("background")) {
    const backgroundAsset = normalizedAssets
      .filter((asset) => cleanText(asset.placement) !== "logo")
      .sort((left, right) => ((Number(right.width) || 0) * (Number(right.height) || 0)) - ((Number(left.width) || 0) * (Number(left.height) || 0)))[0];
    if (backgroundAsset) {
      backgroundAsset.placement = "background";
      currentPlacements.add("background");
    }
  }

  if (desiredRoles.includes("hero") && !currentPlacements.has("hero") && !currentPlacements.has("background")) {
    const heroAsset = normalizedAssets.find((asset) => !["logo", "badge", "social"].includes(cleanText(asset.placement)));
    if (heroAsset) {
      heroAsset.placement = "hero";
      currentPlacements.add("hero");
    }
  }

  if (desiredRoles.includes("section")) {
    for (const asset of normalizedAssets) {
      const placement = cleanText(asset.placement);
      if (!placement || placement === "auto") {
        asset.placement = "section";
      }
    }
  }

  return normalizedAssets;
}

function inferSystemPreheader(mail) {
  const lines = [];
  for (const section of Array.isArray(mail?.sections) ? mail.sections : []) {
    if (cleanText(section.kind) === "footer") {
      continue;
    }
    if (cleanText(section.body)) {
      lines.push(...extractLines(section.body));
    }
  }

  const candidate = lines.find((line) => line.length > 20 && !/\{\{.+?\}\}/.test(line)) || lines[0] || "";
  return cleanText(candidate).slice(0, 120);
}

function transformSystemTextSection(section) {
  if (cleanText(section?.kind) !== "text") {
    return { ...section };
  }

  const lines = extractLines(section.body);
  const bulletLines = lines
    .filter((line) => /^[-*•]\s*/.test(line))
    .map((line) => line.replace(/^[-*•]\s*/, "").trim())
    .filter(Boolean);

  if (Array.isArray(section.items) && section.items.length > 0) {
    return {
      ...section,
      kind: "feature-list",
      image_key: "",
      items: section.items
    };
  }

  if (bulletLines.length >= 3) {
    const introLines = lines.filter((line) => !/^[-*•]\s*/.test(line));
    return {
      ...section,
      kind: "feature-list",
      title: cleanText(section.title) || introLines[0] || "Что важно проверить",
      body: introLines.slice(1).join("\n\n"),
      image_key: "",
      items: bulletLines
    };
  }

  return {
    ...section,
    image_key: ""
  };
}

function adaptMailToCategory(mail, payload) {
  if (!isSystemCategoryName(resolveBriefCategory(payload))) {
    return mail;
  }

  const assets = [];

  let sections = (Array.isArray(mail.sections) ? mail.sections : [])
    .map((section) => {
      if (cleanText(section.kind) === "hero") {
        return {
          ...section,
          kind: "text",
          eyebrow: "",
          image_key: "",
          cta_label: "",
          cta_href: ""
        };
      }
      return {
        ...section,
        image_key: ""
      };
    })
    .filter((section) => {
      if (cleanText(section.kind) === "image") {
        return Boolean(cleanText(section.title) || cleanText(section.body));
      }
      return true;
    })
    .filter((section) => {
      const label = cleanText(section.cta_label).toLowerCase();
      return !(cleanText(section.kind) === "cta" && !cleanText(payload?.brief?.primaryCta) && !cleanText(payload?.brief?.primaryLink) && (!label || label === "open email"));
    })
    .map((section) => {
      const label = cleanText(section.cta_label).toLowerCase();
      if (!cleanText(payload?.brief?.primaryCta) && !cleanText(payload?.brief?.primaryLink) && label === "open email") {
        return {
          ...section,
          cta_label: "",
          cta_href: ""
        };
      }
      if (cleanText(section.kind) !== "image") {
        return transformSystemTextSection(section);
      }
      return section;
    })
    .filter((section, index) => {
      if (index !== 0 || cleanText(section.kind) !== "text") {
        return true;
      }

      const title = cleanText(section.title);
      const body = cleanText(section.body);
      return !(title && !body && title.length <= 24 && title.split(/\s+/).length <= 3);
    })
    .filter((section) => {
      if (!["text", "feature-list", "cta"].includes(cleanText(section.kind))) {
        return true;
      }

      return Boolean(
        cleanText(section.title)
        || cleanText(section.body)
        || (Array.isArray(section.items) && section.items.length > 0)
        || cleanText(section.cta_label)
      );
    });

  if (!sections.some((section) => cleanText(section.kind) === "footer")) {
    sections.push({
      kind: "footer",
      eyebrow: "",
      title: "",
      body: "{{embedded.company_address}}\n\n{{embedded.risk_warning}}\n\nTerms and Conditions",
      image_key: "",
      cta_label: "",
      cta_href: "",
      items: []
    });
  }

  const preheader = isSystemPlaceholderText(mail.preheader) || /build a simple|use system structure|собери\b|собираем|системн/i.test(cleanText(mail.preheader))
    ? inferSystemPreheader({ ...mail, sections }) || ""
    : cleanText(mail.preheader);

  return {
    ...mail,
    preheader,
    assets,
    sections
  };
}

function normalizeSection(section) {
  const allowedKinds = new Set(["hero", "text", "feature-list", "image", "cta", "footer"]);
  const kind = cleanText(section?.kind);

  return {
    kind: allowedKinds.has(kind) ? kind : "text",
    sourceRole: cleanText(section?.sourceRole),
    sourceArchetype: cleanText(section?.sourceArchetype),
    recommendedCatalogId: cleanText(section?.recommendedCatalogId),
    profileBlockId: cleanText(section?.profileBlockId),
    profileSectionKind: cleanText(section?.profileSectionKind),
    confidence: cleanText(section?.confidence),
    eyebrow: cleanText(section?.eyebrow),
    title: cleanText(section?.title),
    body: cleanText(section?.body),
    image_key: cleanText(section?.image_key),
    cta_label: cleanText(section?.cta_label),
    cta_href: cleanText(section?.cta_href),
    items: Array.isArray(section?.items) ? section.items.map(cleanText).filter(Boolean) : []
  };
}

function normalizeAsset(asset, index) {
  return {
    key: cleanText(asset?.key) || `asset_${index + 1}`,
    url: cleanText(asset?.url) || "https://placehold.co/600x300/png",
    alt: cleanText(asset?.alt) || `Asset ${index + 1}`,
    placement: cleanText(asset?.placement) || "section",
    notes: cleanText(asset?.notes),
    width: Number(asset?.width) || 600,
    height: Number(asset?.height) || 300
  };
}

function paragraphize(text) {
  return extractLines(text).map((line) => `<p>${formatInlineMarkup(line)}</p>`).join("");
}

function formatInlineMarkup(text) {
  const content = cleanText(text);
  if (!content) {
    return "";
  }

  const segments = content.split(/\*\*/);
  return segments.map((segment, index) => index % 2 === 1
    ? `<strong>${escapeHtml(segment)}</strong>`
    : escapeHtml(segment)).join("");
}

function getAssetByKey(mail, assetKey) {
  return mail.assets.find((asset) => asset.key === assetKey);
}

function renderSectionHtml(section, mail) {
  const image = section.image_key ? getAssetByKey(mail, section.image_key) : null;
  const eyebrow = section.eyebrow ? `<div class="eyebrow">${formatInlineMarkup(section.eyebrow)}</div>` : "";
  const title = section.title ? `<h2>${formatInlineMarkup(section.title)}</h2>` : "";
  const body = section.body ? `<div class="body-copy">${paragraphize(section.body)}</div>` : "";
  const button = section.cta_label
    ? section.cta_href
      ? `<a class="button" href="${escapeHtml(section.cta_href)}">${formatInlineMarkup(section.cta_label)}</a>`
      : `<span class="button is-disabled" aria-disabled="true">${formatInlineMarkup(section.cta_label)}</span>`
    : "";
  const items = section.items.length > 0
    ? `<ul>${section.items.map((item) => `<li>${formatInlineMarkup(item)}</li>`).join("")}</ul>`
    : "";
  const imageMarkup = image
    ? `<img class="section-image" src="${escapeHtml(image.url)}" alt="${escapeHtml(image.alt)}" width="${image.width}" height="${image.height}" />`
    : "";

  if (section.kind === "hero") {
    return `
      <section class="section hero">
        ${imageMarkup}
        <div class="section-content">
          ${eyebrow}
          <h1>${formatInlineMarkup(section.title || mail.subject)}</h1>
          ${body}
          ${button}
        </div>
      </section>
    `;
  }

  if (section.kind === "feature-list") {
    return `
      <section class="section feature-list">
        ${eyebrow}
        ${title}
        ${body}
        ${items}
      </section>
    `;
  }

  if (section.kind === "image") {
    return `
      <section class="section image-only">
        ${eyebrow}
        ${title}
        ${imageMarkup}
        ${body}
      </section>
    `;
  }

  if (section.kind === "cta") {
    return `
      <section class="section cta">
        ${eyebrow}
        ${title}
        ${body}
        ${button}
      </section>
    `;
  }

  if (section.kind === "footer") {
    return `
      <section class="section footer">
        ${body || `<p>${escapeHtml(section.title)}</p>`}
      </section>
    `;
  }

  return `
    <section class="section text">
      ${eyebrow}
      ${title}
      ${body}
      ${button}
      ${items}
    </section>
  `;
}

function getPreferredLogoAsset(mail) {
  return (Array.isArray(mail?.assets) ? mail.assets : []).find((asset) => ["logo", "hero"].includes(cleanText(asset.placement)));
}

function renderSystemSectionHtml(section, mail, index) {
  if (section.kind === "footer") {
    return "";
  }

  if (section.kind === "image") {
    return "";
  }

  const isLead = index === 0;
  const titleTag = isLead ? "h1" : "h2";
  const titleClass = isLead ? "system-title" : "system-subtitle";
  const title = section.title
    ? `<${titleTag} class="${titleClass}">${formatInlineMarkup(section.title)}</${titleTag}>`
    : "";
  const eyebrow = section.eyebrow ? `<div class="system-eyebrow">${formatInlineMarkup(section.eyebrow)}</div>` : "";
  const body = section.body ? `<div class="system-copy">${paragraphize(section.body)}</div>` : "";
  const button = section.cta_label
    ? section.cta_href
      ? `<a class="system-button" href="${escapeHtml(section.cta_href)}">${formatInlineMarkup(section.cta_label)}</a>`
      : `<span class="system-button is-disabled" aria-disabled="true">${formatInlineMarkup(section.cta_label)}</span>`
    : "";

  if (section.kind === "feature-list") {
    const items = section.items.length > 0
      ? `<ul class="system-list">${section.items.map((item) => `<li>${formatInlineMarkup(item)}</li>`).join("")}</ul>`
      : "";
    return `
      <tr>
        <td class="system-pad system-pad-top-0">
          <div class="system-callout">
            ${title}
            ${body}
            ${items}
          </div>
        </td>
      </tr>
    `;
  }

  return `
    <tr>
      <td class="system-pad ${isLead ? "system-pad-top" : "system-pad-top-0"}">
        ${eyebrow}
        ${title}
        ${body}
        ${button}
      </td>
    </tr>
  `;
}

function renderSystemFooterHtml(mail) {
  const footerSection = Array.isArray(mail.sections)
    ? mail.sections.find((section) => cleanText(section.kind) === "footer")
    : null;
  const footerBody = footerSection?.body
    ? paragraphize(footerSection.body)
    : "";

  return `
    <tr>
      <td class="system-footer-pad">
        <div class="system-footer">
          ${footerBody}
        </div>
      </td>
    </tr>
  `;
}

function renderSystemEmailHtml(mail) {
  const logoAsset = getPreferredLogoAsset(mail);
  const logoUrl = cleanText(mail?.brand_logo_url) || cleanText(logoAsset?.url) || "https://images01.iqoption.com/89/0689/static-01503674720413810689.png";
  const logoAlt = cleanText(mail?.brand_logo_alt) || cleanText(logoAsset?.alt) || "IQ Option";
  const logoMarkup = `<img class="system-logo" src="${escapeHtml(logoUrl)}" alt="${escapeHtml(logoAlt)}" />`;
  const contentSections = (Array.isArray(mail.sections) ? mail.sections : [])
    .filter((section) => cleanText(section.kind) !== "footer")
    .map((section, index) => renderSystemSectionHtml(section, mail, index))
    .join("");

  return `<!DOCTYPE html>
<html lang="${escapeHtml(mail.locale)}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(mail.subject)}</title>
    <style>
      body {
        margin: 0;
        background: #f6f9fc;
        color: #20242f;
        font-family: "Roboto", "Helvetica", "Arial", sans-serif;
      }

      .system-shell {
        width: 100%;
        background: #f6f9fc;
        padding: 20px 0 36px;
      }

      .system-frame {
        width: 100%;
        max-width: 640px;
        margin: 0 auto;
        background: #ffffff;
      }

      .system-head-meta {
        padding: 16px 22px 0;
        color: #7a8698;
        font-size: 11px;
        line-height: 16px;
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }

      .system-header {
        padding: 28px 40px 14px;
      }

      .system-logo {
        display: block;
        max-width: 134px;
        height: auto;
      }

      .system-brand {
        color: #f58220;
        font-size: 22px;
        font-weight: 700;
      }

      .system-pad {
        padding: 0 40px 22px;
      }

      .system-pad-top {
        padding-top: 8px;
      }

      .system-pad-top-0 {
        padding-top: 0;
      }

      .system-title,
      .system-subtitle {
        margin: 0 0 18px;
        color: #20242f;
        line-height: 1.16;
        font-weight: 700;
      }

      .system-title {
        font-size: 28px;
      }

      .system-subtitle {
        font-size: 18px;
      }

      .system-eyebrow {
        margin: 0 0 10px;
        color: #2473d7;
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }

      .system-copy p,
      .system-footer p {
        margin: 0 0 14px;
        color: #4f5f73;
        font-size: 16px;
        line-height: 24px;
      }

      .system-callout {
        border-left: 4px solid #4668ff;
        background: #eef4fb;
        padding: 22px 24px 18px;
      }

      .system-list {
        margin: 10px 0 0 18px;
        padding: 0;
        color: #20242f;
      }

      .system-list li {
        margin: 0 0 10px;
        color: #20242f;
        font-size: 16px;
        line-height: 24px;
      }

      .system-button {
        display: inline-block;
        margin-top: 8px;
        padding: 13px 22px;
        background: #2c89df;
        color: #ffffff !important;
        text-decoration: none;
        border-radius: 4px;
        font-size: 14px;
        font-weight: 700;
      }

      .system-button.is-disabled {
        opacity: 0.72;
        pointer-events: none;
      }

      .system-footer-pad {
        padding: 10px 40px 32px;
      }

      .system-footer {
        border-top: 1px solid #e6ebf0;
        padding-top: 18px;
      }

      .system-footer p {
        color: #8c98a7;
        font-size: 12px;
        line-height: 18px;
      }

      @media only screen and (max-width: 640px) {
        .system-header,
        .system-pad,
        .system-footer-pad {
          padding-left: 20px !important;
          padding-right: 20px !important;
        }

        .system-title {
          font-size: 24px;
        }

        .system-copy p,
        .system-list li {
          font-size: 15px;
          line-height: 22px;
        }
      }
    </style>
  </head>
  <body>
    <table class="system-shell" role="presentation" cellspacing="0" cellpadding="0" border="0">
      <tr>
        <td align="center">
          <table class="system-frame" role="presentation" cellspacing="0" cellpadding="0" border="0">
            <tr>
              <td class="system-head-meta">Subject: ${formatInlineMarkup(mail.subject)}<br />Preheader: ${formatInlineMarkup(mail.preheader)}</td>
            </tr>
            <tr>
              <td class="system-header">${logoMarkup}</td>
            </tr>
            ${contentSections}
            ${renderSystemFooterHtml(mail)}
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function renderMarketingEmailHtml(mail) {
  const sectionsHtml = mail.sections.map((section) => renderSectionHtml(section, mail)).join("");

  return `<!DOCTYPE html>
<html lang="${escapeHtml(mail.locale)}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(mail.subject)}</title>
    <style>
      body {
        margin: 0;
        background: #eef2e8;
        color: #14281d;
        font-family: "Avenir Next", "Segoe UI", sans-serif;
      }

      .canvas {
        max-width: 640px;
        margin: 32px auto;
        background: #fffdf7;
        border-radius: 28px;
        overflow: hidden;
        box-shadow: 0 24px 70px rgba(20, 40, 29, 0.16);
      }

      .meta {
        padding: 18px 24px;
        background: #14281d;
        color: #d7e6c8;
        font-size: 12px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }

      .section {
        padding: 28px 24px;
        border-bottom: 1px solid rgba(20, 40, 29, 0.08);
      }

      .hero {
        background: linear-gradient(160deg, #1d3b2a 0%, #365b38 42%, #f4a259 100%);
        color: #fff9f0;
      }

      .hero h1,
      .section h2 {
        margin: 0 0 12px;
        line-height: 1.05;
      }

      .hero h1 {
        font-size: 42px;
      }

      .section h2 {
        font-size: 28px;
      }

      .eyebrow {
        margin-bottom: 12px;
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        opacity: 0.72;
      }

      .body-copy p,
      .footer p {
        margin: 0 0 12px;
        font-size: 16px;
        line-height: 1.6;
      }

      .section-image {
        width: 100%;
        display: block;
        border-radius: 20px;
        margin-bottom: 20px;
        object-fit: cover;
      }

      .feature-list ul {
        margin: 18px 0 0;
        padding-left: 18px;
      }

      .feature-list li {
        margin-bottom: 10px;
        line-height: 1.55;
      }

      .button {
        display: inline-block;
        margin-top: 16px;
        padding: 14px 20px;
        border-radius: 999px;
        background: #ff7b2c;
        color: #fffdf7;
        text-decoration: none;
        font-weight: 700;
      }

      .button.is-disabled {
        opacity: 0.72;
        cursor: default;
        pointer-events: none;
      }

      .cta {
        background: #14281d;
        color: #fff7eb;
      }

      .footer {
        background: #f5f1e7;
        color: #4a5d4f;
      }
    </style>
  </head>
  <body>
    <div class="canvas">
      <div class="meta">Subject: ${formatInlineMarkup(mail.subject)}<br />Preheader: ${formatInlineMarkup(mail.preheader)}</div>
      ${sectionsHtml}
    </div>
  </body>
</html>`;
}

function renderDraftHtml(mail, metadata = {}) {
  return cleanText(metadata?.previewCategory) === "X_System"
    ? renderSystemEmailHtml(mail)
    : renderMarketingEmailHtml(mail);
}

function renderSectionPug(section) {
  const lines = [`section.section.section-${section.kind}`];

  if (section.eyebrow) {
    lines.push(`  .eyebrow ${section.eyebrow}`);
  }

  if (section.kind === "hero") {
    if (section.image_key) {
      lines.push(`  img.section-image(src=assets.${section.image_key}.url alt=assets.${section.image_key}.alt)`);
    }
    lines.push(`  h1= locale.${slugify(section.title || "headline")}`);
  } else if (section.title) {
    lines.push(`  h2= locale.${slugify(section.title)}`);
  }

  if (section.body) {
    lines.push(`  p= locale.${slugify(section.body.slice(0, 28))}`);
  }

  if (section.items.length > 0) {
    lines.push("  ul");
    for (const item of section.items) {
      lines.push(`    li= locale.${slugify(item.slice(0, 28))}`);
    }
  }

  if (section.cta_label && section.cta_href) {
    lines.push(`  a.button(href="${section.cta_href}")= locale.${slugify(section.cta_label)}`);
  } else if (section.cta_label) {
    lines.push(`  span.button.button-disabled= locale.${slugify(section.cta_label)}`);
  }

  return lines.join("\n");
}

function renderEmailPug(mail) {
  const sections = mail.sections.map(renderSectionPug).join("\n\n");

  return [
    `//- Demo-only sketch generated from the mail spec`,
    `- const assets = require("./assets.json")`,
    `- const locale = require("./locales/${mail.locale}.json")`,
    "",
    "doctype html",
    `html(lang="${mail.locale}")`,
    "  head",
    '    meta(charset="utf-8")',
    '    meta(name="viewport" content="width=device-width, initial-scale=1")',
    `    title= locale.subject`,
    "  body",
    "    .email-canvas",
    sections
  ].join("\n");
}

function renderLocalesJson(mail) {
  const payload = {};

  for (const entry of mail.translations) {
    payload[entry.locale] = {
      subject: entry.subject,
      preheader: entry.preheader,
      cta_labels: entry.cta_labels,
      notes: entry.notes,
      body_blocks: entry.body_blocks,
      source_name: entry.source_name
    };
  }

  return JSON.stringify(payload, null, 2);
}

function renderAssetsManifest(mail) {
  const payload = {};

  for (const asset of mail.assets) {
    payload[asset.key] = {
      url: asset.url,
      alt: asset.alt,
      placement: asset.placement || "section",
      notes: asset.notes || "",
      width: asset.width,
      height: asset.height
    };
  }

  return JSON.stringify(payload, null, 2);
}

function inferWorkspaceTab(filePath = "") {
  const normalized = cleanText(filePath).toLowerCase();
  const extension = path.extname(normalized);

  if (normalized.startsWith("preview/") || extension === ".html") {
    return "html";
  }
  if (normalized.startsWith("logs/") || extension === ".log") {
    return "buildLog";
  }
  if (normalized.startsWith("locales/") || normalized.includes("/vendor/data/") || extension === ".json" && normalized.includes("locale")) {
    return "locales";
  }
  if (normalized.startsWith("studio/assets") || normalized.endsWith("assets.json")) {
    return "assets";
  }
  if (normalized.startsWith("studio/spec") || normalized.endsWith("mail-spec.json")) {
    return "spec";
  }
  if ([".styl", ".css"].includes(extension) || normalized.includes("/styles/")) {
    return "stylus";
  }
  if ([".pug", ".jade"].includes(extension) || normalized.includes("/templates/")) {
    return "pug";
  }
  return "spec";
}

function inferWorkspaceLanguage(filePath = "", tab = "") {
  const normalizedTab = cleanText(tab);
  const extension = path.extname(cleanText(filePath).toLowerCase());

  if (normalizedTab === "pug") {
    return "pug";
  }
  if (normalizedTab === "stylus") {
    return extension === ".css" ? "css" : "stylus";
  }
  if (normalizedTab === "html") {
    return "html";
  }
  if (normalizedTab === "locales" || normalizedTab === "assets" || normalizedTab === "spec") {
    return "json";
  }
  if (normalizedTab === "buildLog") {
    return "log";
  }
  return extension.replace(/^\./, "") || "text";
}

function renderWorkspaceFileContent(value) {
  if (typeof value === "string") {
    return value;
  }

  return JSON.stringify(value || {}, null, 2);
}

function getWorkspaceFileSortWeight(file) {
  const tabOrder = {
    html: 0,
    pug: 1,
    stylus: 2,
    locales: 3,
    assets: 4,
    spec: 5,
    buildLog: 6
  };

  const filePath = cleanText(file?.path).toLowerCase();
  if (filePath.endsWith("/index.pug") || filePath.endsWith("/index.jade") || filePath.endsWith("/index.html")) {
    return -2;
  }
  if (filePath.endsWith("/common.styl")) {
    return -1;
  }
  return tabOrder[cleanText(file?.tab)] ?? 20;
}

function normalizeWorkspaceFileEntry(file, index = 0) {
  const filePath = cleanText(file?.path) || `workspace/file-${index + 1}.txt`;
  const tab = cleanText(file?.tab) || inferWorkspaceTab(filePath);
  const locale = cleanText(file?.locale);
  const content = renderWorkspaceFileContent(file?.content);

  return {
    id: cleanText(file?.id) || `${tab}:${locale || "default"}:${filePath}`,
    tab,
    locale,
    path: filePath,
    label: cleanText(file?.label) || path.basename(filePath),
    language: cleanText(file?.language) || inferWorkspaceLanguage(filePath, tab),
    editable: file?.editable !== false,
    mailRelativePath: cleanText(file?.mailRelativePath),
    sourcePath: cleanText(file?.sourcePath),
    content
  };
}

function resolveDependencyCandidates(baseFilePath, requestedPath, extensions = []) {
  const normalizedRequest = cleanText(requestedPath)
    .replace(/^['"]|['"]$/g, "")
    .replace(/\s+$/, "");

  if (!normalizedRequest || /^(https?:)?\/\//i.test(normalizedRequest)) {
    return [];
  }

  const absoluteBase = path.resolve(path.dirname(baseFilePath), normalizedRequest);
  const hasExtension = Boolean(path.extname(absoluteBase));
  const candidates = hasExtension
    ? [absoluteBase]
    : [
        ...extensions.map((extension) => `${absoluteBase}${extension}`),
        ...extensions.map((extension) => path.join(absoluteBase, `index${extension}`))
      ];

  return Array.from(new Set(candidates.filter((candidate) => existsSync(candidate))));
}

function collectReferencedTemplateFiles(seedFiles = []) {
  const queue = [...seedFiles];
  const visited = new Set();
  const files = [];

  while (queue.length > 0) {
    const filePath = queue.shift();
    if (!filePath || visited.has(filePath) || !existsSync(filePath)) {
      continue;
    }

    visited.add(filePath);
    files.push(filePath);

    const source = readFileSync(filePath, "utf8");
    const includeMatches = source.matchAll(/^\s*(?:include|extends)\s+([^\n\r]+)/gm);
    for (const match of includeMatches) {
      const target = cleanText(match[1]).split(/\s+/)[0];
      for (const candidate of resolveDependencyCandidates(filePath, target, templateSourceExtensions)) {
        if (!visited.has(candidate)) {
          queue.push(candidate);
        }
      }
    }
  }

  return files.sort((left, right) => left.localeCompare(right));
}

function collectReferencedStyleFiles(seedFiles = []) {
  const queue = [...seedFiles];
  const visited = new Set();
  const files = [];

  while (queue.length > 0) {
    const filePath = queue.shift();
    if (!filePath || visited.has(filePath) || !existsSync(filePath)) {
      continue;
    }

    visited.add(filePath);
    files.push(filePath);

    const source = readFileSync(filePath, "utf8");
    const importMatches = source.matchAll(/^\s*@(?:import|require)\s+["']([^"']+)["']/gm);
    for (const match of importMatches) {
      const target = cleanText(match[1]);
      for (const candidate of resolveDependencyCandidates(filePath, target, [".styl", ".css"])) {
        if (!visited.has(candidate)) {
          queue.push(candidate);
        }
      }
    }
  }

  return files.sort((left, right) => left.localeCompare(right));
}

async function collectWorkspaceFiles({
  mailRoot = "",
  templatesRoot = "",
  stylesRoot = "",
  previewLocales = {},
  localePayloads = {},
  localeBuildLogs = {},
  assetsManifest = "",
  specContent = "",
  extraVirtualFiles = []
} = {}) {
  const files = [];

  const pushFile = (entry) => {
    files.push(normalizeWorkspaceFileEntry(entry, files.length));
  };

  const templateSeedFiles = listFilesRecursiveSync(templatesRoot)
    .filter((filePath) => isTemplateSourceFile(filePath))
    .sort((left, right) => left.localeCompare(right));
  const templateFiles = collectReferencedTemplateFiles(templateSeedFiles);
  const mailRootPath = mailRoot ? path.resolve(mailRoot) : "";

  for (const filePath of templateFiles) {
    const isWithinMailRoot = mailRootPath && path.resolve(filePath).startsWith(`${mailRootPath}${path.sep}`);
    pushFile({
      tab: "pug",
      path: toStudioRelative(filePath),
      label: path.basename(filePath),
      language: "pug",
      editable: Boolean(isWithinMailRoot),
      mailRelativePath: isWithinMailRoot ? path.relative(mailRoot, filePath).split(path.sep).join("/") : "",
      sourcePath: toStudioRelative(filePath),
      content: await readFile(filePath, "utf8")
    });
  }

  const styleSeedFiles = listFilesRecursiveSync(stylesRoot)
    .filter((filePath) => [".styl", ".css"].includes(path.extname(filePath).toLowerCase()))
    .sort((left, right) => left.localeCompare(right));
  const styleFiles = collectReferencedStyleFiles(styleSeedFiles);

  for (const filePath of styleFiles) {
    const extension = path.extname(filePath).toLowerCase();
    const isWithinMailRoot = mailRootPath && path.resolve(filePath).startsWith(`${mailRootPath}${path.sep}`);
    pushFile({
      tab: "stylus",
      path: toStudioRelative(filePath),
      label: path.basename(filePath),
      language: extension === ".css" ? "css" : "stylus",
      editable: Boolean(isWithinMailRoot),
      mailRelativePath: isWithinMailRoot ? path.relative(mailRoot, filePath).split(path.sep).join("/") : "",
      sourcePath: toStudioRelative(filePath),
      content: await readFile(filePath, "utf8")
    });
  }

  for (const locale of Object.keys(previewLocales).sort()) {
    pushFile({
      tab: "html",
      locale,
      path: `preview/${locale}.html`,
      label: `${locale}.html`,
      language: "html",
      editable: true,
      content: previewLocales[locale]
    });
  }

  for (const locale of Object.keys(localePayloads).sort()) {
    pushFile({
      tab: "locales",
      locale,
      path: `locales/${locale}.json`,
      label: `${locale}.json`,
      language: "json",
      editable: true,
      content: localePayloads[locale]
    });
  }

  for (const locale of Object.keys(localeBuildLogs).sort()) {
    pushFile({
      tab: "buildLog",
      locale,
      path: `logs/${locale}.log`,
      label: `${locale}.log`,
      language: "log",
      editable: false,
      content: localeBuildLogs[locale]
    });
  }

  if (assetsManifest) {
    pushFile({
      tab: "assets",
      path: "studio/assets.json",
      label: "assets.json",
      language: "json",
      editable: true,
      content: assetsManifest
    });
  }

  if (specContent) {
    pushFile({
      tab: "spec",
      path: "studio/mail-spec.json",
      label: "mail-spec.json",
      language: "json",
      editable: true,
      content: specContent
    });
  }

  for (const file of Array.isArray(extraVirtualFiles) ? extraVirtualFiles : []) {
    pushFile(file);
  }

  return files.sort((left, right) => {
    const weightDiff = getWorkspaceFileSortWeight(left) - getWorkspaceFileSortWeight(right);
    if (weightDiff !== 0) {
      return weightDiff;
    }
    return left.path.localeCompare(right.path);
  });
}

function getPrimaryWorkspaceFileContent(workspaceFiles, tab) {
  const candidates = Array.isArray(workspaceFiles)
    ? workspaceFiles.filter((file) => cleanText(file?.tab) === cleanText(tab))
    : [];

  return cleanText(candidates[0]?.content);
}

async function applyWorkspaceFileOverrides(mailRoot, workspaceFiles) {
  const allowedTabs = new Set(["pug", "stylus"]);
  const rootPath = path.resolve(mailRoot);

  for (const file of Array.isArray(workspaceFiles) ? workspaceFiles : []) {
    const normalized = normalizeWorkspaceFileEntry(file);
    if (!normalized.mailRelativePath || !allowedTabs.has(normalized.tab)) {
      continue;
    }

    const targetPath = path.resolve(mailRoot, normalized.mailRelativePath);
    if (!targetPath.startsWith(`${rootPath}${path.sep}`)) {
      continue;
    }

    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, normalized.content, "utf8");
  }
}

function createDraftSnapshot(mail, existingDraft = null, metadata = {}) {
  const emailBaseSummary = summarizeEmailBase();
  const templateSelection = metadata?.templateSelection || existingDraft?.templateSelection || null;
  const templateSelectionSummary = summarizeTemplateSelectionForContext(templateSelection);
  const workspaceFiles = Array.isArray(existingDraft?.workspaceFiles)
    ? existingDraft.workspaceFiles
    : Array.isArray(metadata?.workspaceFiles)
      ? metadata.workspaceFiles
      : [];

  return {
    mail,
    html: cleanText(metadata?.modifiedHtml) || cleanText(existingDraft?.html) || renderDraftHtml(mail, metadata),
    previewLocales: existingDraft?.previewLocales || metadata.previewLocales || {},
    localePayloads: existingDraft?.localePayloads || metadata.localePayloads || {},
    localeBuildLogs: existingDraft?.localeBuildLogs || metadata.localeBuildLogs || {},
    pug: cleanText(existingDraft?.pug) || renderEmailPug(mail),
    stylus: cleanText(existingDraft?.stylus) || cleanText(metadata?.stylus) || getPrimaryWorkspaceFileContent(workspaceFiles, "stylus"),
    locales: renderLocalesJson(mail),
    assetsManifest: renderAssetsManifest(mail),
    spec: JSON.stringify(mail, null, 2),
    workspaceFiles,
    templateSelection,
    designSchema: metadata?.designSchema || existingDraft?.designSchema || null,
    designDecomposition: metadata?.designDecomposition || existingDraft?.designDecomposition || null,
    designMappingHints: metadata?.designMappingHints || existingDraft?.designMappingHints || null,
    designBlockRecommendations: metadata?.designBlockRecommendations || existingDraft?.designBlockRecommendations || null,
    assetRecommendations: Array.isArray(metadata?.assetRecommendations) ? metadata.assetRecommendations : [],
    buildLog: cleanText(existingDraft?.buildLog) || [
      "No email-base build executed yet.",
      templateSelectionSummary,
      emailBaseSummary.currentMail
        ? `Current base mail: ${emailBaseSummary.currentMail.folder}`
        : "No current base mail detected."
    ].join("\n")
  };
}

function materializeDraft(result, payload, mode) {
  const mail = normalizeMail(result.mail, payload);
  const assetRecommendations = buildAssetRecommendations(mail, payload);
  const templateSelection = getReferenceTemplateSelection(payload);
  const fallbackReply = buildDraftSuccessReply(payload, mail);
  const normalizedReply = finalizeAssistantReply(
    payload,
    isSystemCategoryName(resolveBriefCategory(payload)) || looksLikeDraftReplyArtifact(result.assistant_reply) ? "" : result.assistant_reply,
    fallbackReply
  );
  const templateSelectionNote = buildTemplateSelectionUserNote(payload);

  const modifiedHtml = cleanText(result.mail?.modified_html) || null;

  // Scaffold mode: extract locale_entries and build localeContent map for token resolution
  const rawLocaleEntries = Array.isArray(result.mail?.locale_entries) ? result.mail.locale_entries : [];
  const localeContent = rawLocaleEntries.length > 0
    ? Object.fromEntries(rawLocaleEntries.map(({ key, value }) => [cleanText(key), cleanText(value)]).filter(([k]) => k))
    : null;

  console.log(`[materializeDraft] mode=${mode} clone-edit=${!!modifiedHtml} scaffold-entries=${rawLocaleEntries.length} modified_html_len=${modifiedHtml?.length ?? 0} sections_count=${result.mail?.sections?.length ?? 0}`);

  const draftResult = {
    assistantReply: `${normalizedReply}${templateSelectionNote}`.trim(),
    mode,
    draft: createDraftSnapshot(mail, null, {
      assetRecommendations,
      previewCategory: resolveBriefCategory(payload),
      templateSelection,
      designSchema: payload?.designSchema || null,
      designDecomposition: payload?.designDecomposition || null,
      designMappingHints: payload?.designMappingHints || null,
      designBlockRecommendations: payload?.designBlockRecommendations || null,
      modifiedHtml
    })
  };

  // Pass locale_entries through so the client can resolve tokens for scaffold preview
  if (localeContent) {
    draftResult.localeContent = localeContent;
    draftResult.scaffoldMailId = cleanText(payload.scaffoldContext?.newMailId) || null;
    draftResult.scaffoldCategory = cleanText(payload.scaffoldContext?.category) || null;
  }

  // Brand theme: extract from AI response and pass to client
  // Also attach to result for server-side patch when in scaffold mode
  const rawTheme = result.mail?.brand_theme;
  const brandTheme = rawTheme && typeof rawTheme === "object"
    ? normalizeTheme({ ...rawTheme, brandId: cleanText(payload.brief?.category) || "unknown" })
    : null;

  if (brandTheme && Object.values(brandTheme).some((v) => v && v !== "unknown")) {
    draftResult.brandTheme = brandTheme;
  }

  return draftResult;
}

function detectProviderIssue(message) {
  const source = cleanText(message);
  const lowered = source.toLowerCase();

  if (!source) {
    return {
      code: "",
      label: ""
    };
  }

  if (lowered.includes("quota") || lowered.includes("billing")) {
    return {
      code: "quota",
      label: "OpenAI quota or billing issue"
    };
  }

  if (lowered.includes("invalid schema")) {
    return {
      code: "schema",
      label: "Structured output schema issue"
    };
  }

  if (lowered.includes("api key") || lowered.includes("authentication") || lowered.includes("unauthorized")) {
    return {
      code: "auth",
      label: "Authentication issue"
    };
  }

  if (lowered.includes("rate limit")) {
    return {
      code: "rate_limit",
      label: "Rate limit reached"
    };
  }

  return {
    code: "provider_error",
    label: source
  };
}

function createProviderRuntime({
  providerId,
  mode,
  liveAttempted = false,
  liveUsed = false,
  fallback = false,
  errorMessage = ""
}) {
  const issue = detectProviderIssue(errorMessage);
  return {
    providerId: cleanText(providerId),
    mode: cleanText(mode),
    liveAttempted: Boolean(liveAttempted),
    liveUsed: Boolean(liveUsed),
    fallback: Boolean(fallback),
    issueCode: issue.code,
    issueLabel: issue.label,
    errorMessage: cleanText(errorMessage)
  };
}

// callOpenAiWithRetry, extractResponseText → imported from src/ai-client.js
// Bind logger so module-level appendStudioJournalEntry is used automatically
function _aiCall(buildRequestFn, label) {
  return callOpenAiWithRetry(buildRequestFn, { label, apiKey: openAiApiKey, logger: appendStudioJournalEntry });
}

function resolveDraftTaskForPayload(payload) {
  if (payload?.baseEmailHtml) {
    return "cloneEdit";
  }

  if (Array.isArray(payload?.currentDraft?.sections) && payload.currentDraft.sections.length > 0) {
    return "followupEdit";
  }

  return "draft";
}

async function createOpenAiDraft(payload) {
  const effectivePayload = hydratePayloadTemplateSelection(await ensureDesignAnalysis(payload));
  const inputMessages = await buildInputMessages(effectivePayload);
  const model = resolveOpenAiModelForTask(resolveDraftTaskForPayload(effectivePayload));

  const data = await _aiCall(
    async () => ({
      body: {
        model,
        input: inputMessages,
        text: { format: { type: "json_schema", name: "email_studio_draft", strict: true, schema: responseSchema } }
      }
    }),
    "create-draft"
  );

  const rawText = extractResponseText(data);
  if (!rawText) throw new Error("OpenAI response did not contain output text");

  return {
    ...JSON.parse(rawText),
    design_analysis: effectivePayload.designAnalysis || null
  };
}

async function createOpenAiDiscussion(payload) {
  const effectivePayload = hydratePayloadTemplateSelection(await ensureDesignAnalysis(payload, { optional: true }));
  const inputMessages = await buildDiscussionMessages(effectivePayload);
  const model = resolveOpenAiModelForTask("discussion");

  const data = await _aiCall(
    async () => ({ body: { model, input: inputMessages } }),
    "discussion"
  );

  return { assistantReply: extractResponseText(data) || "Обсуждение готово." };
}

async function createOpenAiDesignAnalysis(payload) {
  const effectivePayload = hydratePayloadTemplateSelection(payload);
  const inputMessages = await buildDesignAnalysisMessages(effectivePayload);
  const model = resolveOpenAiModelForTask("designAnalysis");

  const data = await _aiCall(
    async () => ({
      body: {
        model,
        input: inputMessages,
        text: { format: { type: "json_schema", name: "email_studio_design_analysis", strict: true, schema: designAnalysisSchema } }
      }
    }),
    "design-analysis"
  );

  const rawText = extractResponseText(data);
  if (!rawText) throw new Error("OpenAI design analysis response did not contain output text");

  const parsed = JSON.parse(rawText);
  return {
    assistantReply: cleanText(parsed.assistant_reply) || "Design analysis is ready.",
    analysis: normalizeDesignAnalysis({
      ...(parsed.analysis || {}),
      mode: "openai-design",
      updatedAt: new Date().toISOString()
    })
  };
}

// ─── DeepL Translations ───────────────────────────────────────────────────────

/**
 * Maps studio locale codes (en_US, ru, pt_BR …) to DeepL language codes.
 * DeepL uses ISO 639-1 for source, and a mix of ISO 639-1/BCP-47 for targets.
 */
function studioLocaleToDeepL(locale) {
  const lc = cleanText(locale).replace(/_/g, "-").toLowerCase();
  const map = {
    "en":    "EN",   "en-us": "EN-US", "en-gb": "EN-GB",
    "ru":    "RU",
    "de":    "DE",
    "fr":    "FR",
    "es":    "ES",
    "pt":    "PT",   "pt-br": "PT-BR", "pt-pt": "PT-PT",
    "it":    "IT",
    "nl":    "NL",
    "pl":    "PL",
    "uk":    "UK",
    "tr":    "TR",
    "zh":    "ZH",   "zh-hans": "ZH", "zh-hant": "ZH",
    "ja":    "JA",
    "ko":    "KO",
    "ar":    "AR",
    "id":    "ID",
    "cs":    "CS",
    "sk":    "SK",
    "ro":    "RO",
    "hu":    "HU",
    "bg":    "BG",
    "da":    "DA",
    "fi":    "FI",
    "el":    "EL",
    "lt":    "LT",
    "lv":    "LV",
    "nb":    "NB",
    "sl":    "SL",
    "sv":    "SV",
  };
  return map[lc] || lc.split("-")[0].toUpperCase();
}

/**
 * Translates an array of text strings from sourceLang to targetLang using DeepL API.
 * Returns translated strings in the same order.
 */
async function deeplTranslateTexts(texts, targetLocale, sourceLocale = "") {
  if (!deepLApiKey) throw new Error("DEEPL_API_KEY is not configured");
  const targetLang = studioLocaleToDeepL(targetLocale);
  const sourceLang = sourceLocale ? studioLocaleToDeepL(sourceLocale) : null;

  const nonEmpty = texts.map((t, i) => ({ i, t: cleanText(t) })).filter((x) => x.t);
  if (nonEmpty.length === 0) return texts.map(() => "");

  const body = new URLSearchParams();
  nonEmpty.forEach(({ t }) => body.append("text", t));
  body.append("target_lang", targetLang);
  if (sourceLang) body.append("source_lang", sourceLang);
  body.append("tag_handling", "html");
  body.append("split_sentences", "nonewlines");

  const apiBase = deepLApiUrl.replace(/\/$/, "");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);

  let res;
  try {
    res = await fetch(`${apiBase}/v2/translate`, {
      method: "POST",
      headers: {
        "Authorization": `DeepL-Auth-Key ${deepLApiKey}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: body.toString(),
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`DeepL API error ${res.status}: ${errText.slice(0, 200)}`);
  }

  const data = await res.json();
  const translated = (data.translations || []).map((t) => t.text);

  // Rehydrate into original positions
  const result = texts.map(() => "");
  nonEmpty.forEach(({ i }, idx) => {
    result[i] = translated[idx] || texts[i];
  });
  return result;
}

/**
 * Translates a source translation entry into each of the targetLocales using DeepL.
 * Returns same shape as createMockTranslations/createOpenAiTranslations.
 */
async function createDeepLTranslations(payload, mail, sourceEntry, targetLocales) {
  const sourceLocale = cleanText(sourceEntry?.locale || mail?.locale || "en");
  const translations = [];
  const errors = [];

  for (const locale of targetLocales) {
    try {
      const sourceBlocks = Array.isArray(sourceEntry.body_blocks)
        ? sourceEntry.body_blocks.map(cleanText).filter(Boolean)
        : [];
      const sourceCtaLabels = Array.isArray(sourceEntry.cta_labels)
        ? sourceEntry.cta_labels.map(cleanText).filter(Boolean)
        : [];

      // Batch all text: [subject, preheader, ...ctaLabels, ...bodyBlocks]
      const allTexts = [
        cleanText(sourceEntry.subject || mail.subject),
        cleanText(sourceEntry.preheader || mail.preheader),
        ...sourceCtaLabels,
        ...sourceBlocks
      ];
      const translated = await deeplTranslateTexts(allTexts, locale, sourceLocale);

      const subjectT = translated[0] || allTexts[0];
      const preheaderT = translated[1] || allTexts[1];
      const ctaT = translated.slice(2, 2 + sourceCtaLabels.length);
      const blocksT = translated.slice(2 + sourceCtaLabels.length);

      translations.push(normalizeTranslationEntry({
        locale,
        subject: subjectT,
        preheader: preheaderT,
        cta_labels: ctaT.length > 0 ? ctaT : sourceCtaLabels,
        body_blocks: blocksT.length > 0 ? blocksT : sourceBlocks,
        notes: `Translated by DeepL from ${sourceLocale}`,
        source_name: `deepl-${locale}.txt`
      }, mail));
    } catch (err) {
      errors.push(`${locale}: ${err.message}`);
      // Fall back to mock for this locale
      translations.push(normalizeTranslationEntry({
        locale,
        subject: cleanText(sourceEntry.subject || mail.subject),
        preheader: cleanText(sourceEntry.preheader || mail.preheader),
        cta_labels: sourceEntry.cta_labels || [],
        body_blocks: sourceEntry.body_blocks || [],
        notes: `DeepL error (${err.message}). Review manually.`,
        source_name: `deepl-fallback-${locale}.txt`
      }, mail));
    }
  }

  const warnPart = errors.length > 0 ? ` Ошибки DeepL: ${errors.join("; ")}.` : "";
  return {
    assistant_reply: `DeepL переводы готовы: ${targetLocales.join(", ")}.${warnPart}`,
    translations
  };
}

async function createOpenAiTranslations(payload, mail, sourceEntry, targetLocales) {
  const model = resolveOpenAiModelForTask("translations");
  const data = await _aiCall(
    async () => ({
      body: {
        model,
        input: buildTranslationMessages(payload, sourceEntry, targetLocales),
        text: { format: { type: "json_schema", name: "email_studio_translations", strict: true, schema: translationResponseSchema } }
      }
    }),
    "translations"
  );

  const rawText = extractResponseText(data);
  if (!rawText) throw new Error("OpenAI translation response did not contain output text");

  const parsed = JSON.parse(rawText);
  return {
    assistant_reply: cleanText(parsed.assistant_reply) || `Сгенерировал ${targetLocales.length} locale(s).`,
    translations: Array.isArray(parsed.translations)
      ? parsed.translations.map((entry) => normalizeTranslationEntry(entry, mail))
      : []
  };
}

async function ensureDesignAnalysis(payload, options = {}) {
  const optional = Boolean(options.optional);
  const hasDesign = hasDesignInput(payload);

  if (!hasDesign || payload.designAnalysis) {
    return payload;
  }

  try {
    const result = await createOpenAiDesignAnalysis(payload);
    return hydratePayloadTemplateSelection({
      ...payload,
      designAnalysis: result.analysis
    });
  } catch (error) {
    if (optional) {
      return payload;
    }
    throw error;
  }
}

async function resolveTemplateMail(payload) {
  const templateSelection = getReferenceTemplateSelection(payload);

  if (cleanText(templateSelection?.profile) === "aff-password-reset" && !payload?.currentDraft?.sections?.length) {
    return buildAffPasswordResetTemplateMail(payload);
  }

  if (payload?.currentDraft?.sections?.length) {
    return payload.currentDraft;
  }

  if (isIqRfmReferenceSelection(templateSelection)) {
    return buildIqRfmReferenceTemplateMail(payload, templateSelection.mailId);
  }

  try {
    const summary = summarizeEmailBase();
    const preview = await buildEmailBasePreview(
      cleanText(templateSelection?.category) || resolveBriefCategory(payload, summary.currentMail?.category || ""),
      cleanText(templateSelection?.mailId) || cleanText(payload?.brief?.mailId) || summary.currentMail?.mailId || "",
      cleanText(payload?.brief?.locale) || "en"
    );
    return preview?.draft?.mail || null;
  } catch {
    return null;
  }
}

function parseLocalePayloadTextToMailText(value) {
  return cleanText(value)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<strong>(.*?)<\/strong>/gi, "**$1**")
    .replace(/<\/?[^>]+>/g, "");
}

function applyPrimaryTranslationEntryToMail(mail, payload) {
  const preferredEntry = findPreferredTranslationEntry(payload?.translationText, payload?.brief?.locale || mail?.locale || "en", mail);
  if (!preferredEntry) {
    return mail;
  }

  const localePayload = createLocalePayloadForEntry(mail, preferredEntry);
  const sections = (Array.isArray(mail?.sections) ? mail.sections : []).map((section, index) => {
    const localized = localePayload.sections?.[getSectionLocaleKey(index)] || {};
    return {
      ...section,
      eyebrow: parseLocalePayloadTextToMailText(localized.eyebrow) || cleanText(section.eyebrow),
      title: parseLocalePayloadTextToMailText(localized.title) || cleanText(section.title),
      body: parseLocalePayloadTextToMailText(localized.body) || cleanText(section.body),
      cta_label: parseLocalePayloadTextToMailText(localized.cta_label) || cleanText(section.cta_label),
      items: Array.isArray(localized.items) && localized.items.length > 0
        ? localized.items.map(parseLocalePayloadTextToMailText).filter(Boolean)
        : Array.isArray(section.items)
          ? section.items.map(cleanText).filter(Boolean)
          : []
    };
  });

  return {
    ...mail,
    locale: normalizeLocaleCode(preferredEntry.locale) || mail.locale,
    subject: cleanText(preferredEntry.subject) || mail.subject,
    preheader: cleanText(preferredEntry.preheader) || mail.preheader,
    sections
  };
}

function selectGeneratedSectionForTemplateSection(templateSection, templateIndex, generatedSections, usedIndices) {
  const candidates = (Array.isArray(generatedSections) ? generatedSections : [])
    .map((section, index) => ({ section: normalizeSection(section), index }))
    .filter(({ index }) => !usedIndices.has(index));

  if (candidates.length === 0) {
    return null;
  }

  const templateKind = cleanText(templateSection?.kind);
  const templateSignal = [
    cleanText(templateSection?.title),
    cleanText(templateSection?.body),
    ...(Array.isArray(templateSection?.items) ? templateSection.items.map(cleanText) : [])
  ].join(" ").toLowerCase();

  let match = candidates.find(({ section }) => cleanText(section.kind) === templateKind);

  if (!match && ["hero", "text"].includes(templateKind)) {
    match = candidates.find(({ section }) => ["hero", "text"].includes(cleanText(section.kind)));
  }

  if (!match && templateKind === "feature-list") {
    match = candidates.find(({ section }) => cleanText(section.kind) === "feature-list" || (Array.isArray(section.items) && section.items.length > 0));
  }

  if (!match && templateKind === "footer") {
    match = [...candidates].reverse().find(({ section }) => {
      const signal = [
        cleanText(section?.title),
        cleanText(section?.body),
        ...(Array.isArray(section?.items) ? section.items.map(cleanText) : [])
      ].join(" ").toLowerCase();
      return cleanText(section.kind) === "footer"
        || /(risk_warning|company_address|unsubscribe|terms|legal|footer)/i.test(signal)
        || /(risk_warning|company_address|unsubscribe|terms|legal|footer)/i.test(templateSignal);
    });
  }

  if (!match && templateIndex < candidates.length) {
    match = candidates[templateIndex];
  }

  return match || candidates[0];
}

function collectGeneratedSectionTextCandidates(sections) {
  const candidates = [];

  for (const [index, rawSection] of (Array.isArray(sections) ? sections : []).entries()) {
    const section = normalizeSection(rawSection);
    const kind = cleanText(section.kind);
    if (section.title) {
      candidates.push({ index, kind, field: "title", text: cleanText(section.title) });
    }
    if (section.body) {
      candidates.push({ index, kind, field: "body", text: cleanText(section.body) });
    }
    for (const item of Array.isArray(section.items) ? section.items : []) {
      const text = cleanText(item);
      if (text) {
        candidates.push({ index, kind, field: "item", text });
      }
    }
  }

  return candidates;
}

function findGeneratedSectionText(candidates, matcher) {
  return cleanText((Array.isArray(candidates) ? candidates : []).find((candidate) => matcher(candidate))?.text);
}

function looksLikeAffPasswordResetIntroBody(text) {
  const value = cleanText(text);
  return Boolean(value)
    && value.length > 30
    && !looksLikeResetHeadline(value)
    && /(account|request|senha|парол|{{|received|received a request|criad|criamos|redefinir|reset)/i.test(value)
    && !/(support@|reach out|contact|entre em contato|ignore this email|ignor|terms and conditions)/i.test(value);
}

function looksLikeAffPasswordResetCtaBody(text) {
  const value = cleanText(text);
  return Boolean(value) && /(click|button|below|set your new password|clique|bot[aã]o|abaixo|definir sua nova senha|нажм|кнопк)/i.test(value);
}

function looksLikeAffPasswordResetWarning(text) {
  const value = cleanText(text);
  return Boolean(value) && /(didn.?t request|ignore this email|safely ignore|não solicitou|pode ignorar|можете проигнорировать|не запрашивали)/i.test(value);
}

function looksLikeAffPasswordResetSupport(text) {
  const value = cleanText(text);
  return Boolean(value) && /(support@|trouble signing in|reach out|contact us|entre em contato|acessar sua conta|войд|поддержк|свяж)/i.test(value);
}

function mergeAffPasswordResetMailOntoTemplate(normalizedGeneratedMail, baseMail, payloadTranslationEntries, payload) {
  const baseSections = Array.isArray(baseMail?.sections) ? baseMail.sections.map((section) => normalizeSection(section)) : [];
  const generatedSections = Array.isArray(normalizedGeneratedMail?.sections)
    ? normalizedGeneratedMail.sections.map((section) => normalizeSection(section))
    : [];
  const generatedCandidates = collectGeneratedSectionTextCandidates(generatedSections);
  const introTitleDirect = cleanText(generatedSections[0]?.title);
  const introBodyDirect = cleanText(generatedSections[0]?.body);
  const splitIntro = splitAffPasswordResetIntroAndCtaBody(introBodyDirect);
  const ctaSection = generatedSections.find((section) => cleanText(section.kind) === "cta") || generatedSections[1] || null;
  const title = looksLikeResetHeadline(introTitleDirect)
    ? introTitleDirect
    : findGeneratedSectionText(generatedCandidates, ({ text }) => looksLikeResetHeadline(text))
      || cleanText(baseSections[0]?.title);
  const introBodyCandidate = splitIntro.intro
    || (!looksLikeResetHeadline(introTitleDirect) ? introTitleDirect : "")
    || findGeneratedSectionText(generatedCandidates, ({ text }) => looksLikeAffPasswordResetIntroBody(text))
    || cleanText(baseSections[0]?.body);
  const resolvedIntroSplit = splitAffPasswordResetIntroAndCtaBody(introBodyCandidate);
  const introBody = cleanText(resolvedIntroSplit.intro) || cleanText(baseSections[0]?.body);
  const ctaLabel = cleanText(ctaSection?.cta_label)
    || cleanText(generatedSections[0]?.cta_label)
    || cleanText(baseSections[1]?.cta_label);
  const ctaBodyCandidate = splitIntro.cta
    || resolvedIntroSplit.cta
    || cleanText(ctaSection?.body)
    || findGeneratedSectionText(generatedCandidates, ({ text }) => looksLikeAffPasswordResetCtaBody(text));
  const ctaBody = isWeakAffPasswordResetCtaBody(ctaBodyCandidate, ctaLabel)
    ? cleanText(baseSections[1]?.body)
    : cleanText(ctaBodyCandidate);
  const warningBody = looksLikeAffPasswordResetWarning(cleanText(generatedSections[2]?.body))
    ? cleanText(generatedSections[2]?.body)
    : findGeneratedSectionText(generatedCandidates, ({ text }) => looksLikeAffPasswordResetWarning(text))
    || cleanText(baseSections[1]?.body);
  const resolvedWarningBody = warningBody === cleanText(baseSections[1]?.body)
    ? cleanText(baseSections[2]?.body)
    : warningBody;
  const supportBody = looksLikeAffPasswordResetSupport(cleanText(generatedSections[3]?.body))
    ? cleanText(generatedSections[3]?.body)
    : findGeneratedSectionText(generatedCandidates, ({ text }) => looksLikeAffPasswordResetSupport(text))
      || cleanText(baseSections[3]?.body);

  return {
    ...baseMail,
    subject: cleanText(normalizedGeneratedMail?.subject) || cleanText(baseMail?.subject),
    preheader: cleanText(normalizedGeneratedMail?.preheader) || cleanText(baseMail?.preheader),
    locale: cleanText(normalizedGeneratedMail?.locale) || cleanText(baseMail?.locale),
    summary: cleanText(normalizedGeneratedMail?.summary) || cleanText(baseMail?.summary),
    brand_logo_url: cleanText(extractLatestLogoOverrideUrl(payload)) || cleanText(baseMail?.brand_logo_url),
    brand_logo_alt: cleanText(baseMail?.brand_logo_alt) || "Affstore",
    translations: payloadTranslationEntries.length > 0
      ? payloadTranslationEntries
      : Array.isArray(normalizedGeneratedMail?.translations) && normalizedGeneratedMail.translations.length > 0
        ? normalizedGeneratedMail.translations
        : baseMail.translations,
    sections: [
      {
        ...baseSections[0],
        kind: "text",
        title,
        body: introBody
      },
      {
        ...baseSections[1],
        kind: "cta",
        body: ctaBody,
        cta_label: ctaLabel
      },
      {
        ...baseSections[2],
        kind: "text",
        body: resolvedWarningBody
      },
      {
        ...baseSections[3],
        kind: "text",
        body: supportBody
      },
      {
        ...baseSections[4],
        kind: "footer",
        body: cleanText(baseSections[4]?.body)
      }
    ],
    assets: baseMail.assets
  };
}

function mergeGeneratedSectionsOntoTemplateSections(templateSections, generatedSections) {
  const baseSections = Array.isArray(templateSections) ? templateSections.map((section) => normalizeSection(section)) : [];
  const sourceSections = Array.isArray(generatedSections) ? generatedSections.map((section) => normalizeSection(section)) : [];
  const usedIndices = new Set();

  return baseSections.map((templateSection, index) => {
    const match = selectGeneratedSectionForTemplateSection(templateSection, index, sourceSections, usedIndices);
    const generatedSection = match?.section || null;

    if (match) {
      usedIndices.add(match.index);
    }

    const mergedSection = {
      ...templateSection,
      kind: cleanText(templateSection.kind) || cleanText(generatedSection?.kind) || "text",
      eyebrow: cleanText(generatedSection?.eyebrow) || cleanText(templateSection.eyebrow),
      title: cleanText(generatedSection?.title) || cleanText(templateSection.title),
      body: cleanText(generatedSection?.body) || cleanText(templateSection.body),
      image_key: cleanText(templateSection.image_key) || cleanText(generatedSection?.image_key),
      cta_label: cleanText(generatedSection?.cta_label) || cleanText(templateSection.cta_label),
      cta_href: cleanText(generatedSection?.cta_href) || cleanText(templateSection.cta_href),
      items: Array.isArray(generatedSection?.items) && generatedSection.items.length > 0
        ? generatedSection.items.map(cleanText).filter(Boolean)
        : Array.isArray(templateSection.items)
          ? templateSection.items.map(cleanText).filter(Boolean)
          : []
    };

    const profileBlockId = cleanText(mergedSection.profileBlockId);
    if (profileBlockId === "header-logo-row") {
      return {
        ...mergedSection,
        eyebrow: "",
        title: "",
        body: "",
        cta_label: "",
        cta_href: "",
        items: []
      };
    }

    if (profileBlockId === "social-links-row" || profileBlockId === "social-icons-row" || profileBlockId === "store-badges-row") {
      return {
        ...mergedSection,
        eyebrow: "",
        title: "",
        body: "",
        cta_label: "",
        cta_href: "",
        items: []
      };
    }

    return mergedSection;
  });
}

function createEmptySectionForKind(kind) {
  return normalizeSection({
    kind,
    eyebrow: "",
    title: "",
    body: "",
    image_key: "",
    cta_label: "",
    cta_href: "",
    items: []
  });
}

function attachStructureProfileHintsToTemplateSections(templateSections, payload) {
  const sections = Array.isArray(templateSections) ? templateSections.map((section) => normalizeSection(section)) : [];
  if (sections.length === 0) {
    return sections;
  }

  const selection = getReferenceTemplateSelection(payload);
  const structureProfiles = readMailStructureProfilesSnapshot();
  const structureProfile = findMailStructureProfile(structureProfiles, selection?.category, selection?.mailId);
  if (!structureProfile) {
    return sections;
  }

  return sections.map((section, index) => normalizeSection({
    ...section,
    profileBlockId: cleanText(structureProfile?.blockIds?.[index]),
    profileSectionKind: cleanText(structureProfile?.sectionKinds?.[index])
  }));
}

function selectTemplateSectionForExpectedSection(expectedSection, templateSections, usedIndices) {
  const normalizedExpected = normalizeSection(expectedSection);
  const expectedKind = cleanText(normalizedExpected.kind);
  const expectedCatalogId = cleanText(normalizedExpected.recommendedCatalogId);
  const expectedSourceRole = cleanText(normalizedExpected.sourceRole);
  const candidates = (Array.isArray(templateSections) ? templateSections : [])
    .map((section, index) => ({ section: normalizeSection(section), index }))
    .filter(({ index }) => !usedIndices.has(index));

  if (candidates.length === 0) {
    return null;
  }

  let match = expectedCatalogId
    ? candidates.find(({ section }) => cleanText(section.profileBlockId) === expectedCatalogId)
    : null;

  if (!match && expectedSourceRole === "header") {
    match = candidates.find(({ section }) => cleanText(section.profileBlockId) === "header-logo-row");
  }

  if (!match) {
    match = candidates.find(({ section }) => cleanText(section.kind) === expectedKind);
  }

  if (!match && expectedKind === "text") {
    match = candidates.find(({ section }) => ["text", "hero"].includes(cleanText(section.kind)));
  }

  if (!match && expectedKind === "feature-list") {
    match = candidates.find(({ section }) => cleanText(section.kind) === "feature-list" || (Array.isArray(section.items) && section.items.length > 0));
  }

  if (!match && expectedKind === "image") {
    match = candidates.find(({ section }) => ["image", "hero"].includes(cleanText(section.kind)));
  }

  if (!match && expectedKind === "cta") {
    match = candidates.find(({ section }) => ["cta", "hero"].includes(cleanText(section.kind)) && (cleanText(section.cta_label) || cleanText(section.cta_href)));
  }

  if (!match && expectedKind === "footer") {
    match = [...candidates].reverse().find(({ section }) => cleanText(section.kind) === "footer");
  }

  return match || null;
}

function buildDesignGuidedTemplateSections(templateSections, payload) {
  const baseSections = attachStructureProfileHintsToTemplateSections(templateSections, payload);
  const expectedSections = buildDesignHintTemplateSections(payload).map((section) => normalizeSection(section));
  if (baseSections.length === 0 || expectedSections.length === 0) {
    return baseSections;
  }

  const usedIndices = new Set();
  const guidedSections = expectedSections.map((expectedSection) => {
    const match = selectTemplateSectionForExpectedSection(expectedSection, baseSections, usedIndices);
    if (match) {
      usedIndices.add(match.index);
      return {
        ...match.section,
        kind: cleanText(expectedSection.kind) || cleanText(match.section.kind) || "text"
      };
    }

    return createEmptySectionForKind(expectedSection.kind);
  });

  const hasFooter = guidedSections.some((section) => cleanText(section.kind) === "footer");
  if (!hasFooter) {
    const footerSection = [...baseSections].reverse().find((section) => cleanText(section.kind) === "footer");
    if (footerSection) {
      guidedSections.push(footerSection);
    }
  }

  return guidedSections;
}

function mergeGeneratedMailOntoTemplate(generatedMail, templateMail, payload) {
  if (!templateMail || typeof templateMail !== "object") {
    return generatedMail;
  }

  const baseMail = normalizeMail(templateMail, payload);
  const normalizedGeneratedMail = normalizeMail(generatedMail, payload);
  const payloadTranslationEntries = parseTranslationEntries(cleanText(payload?.translationText), baseMail);
  const guidedTemplateSections = buildDesignGuidedTemplateSections(baseMail.sections, payload);
  const merged = {
    ...baseMail,
    subject: cleanText(normalizedGeneratedMail?.subject) || baseMail.subject,
    preheader: cleanText(normalizedGeneratedMail?.preheader) || baseMail.preheader,
    locale: cleanText(normalizedGeneratedMail?.locale) || baseMail.locale,
    summary: cleanText(normalizedGeneratedMail?.summary) || baseMail.summary,
    brand_logo_url: cleanText(normalizedGeneratedMail?.brand_logo_url) || baseMail.brand_logo_url,
    brand_logo_alt: cleanText(normalizedGeneratedMail?.brand_logo_alt) || baseMail.brand_logo_alt,
    translations: payloadTranslationEntries.length > 0
      ? payloadTranslationEntries
      : Array.isArray(normalizedGeneratedMail?.translations) && normalizedGeneratedMail.translations.length > 0
      ? normalizedGeneratedMail.translations
      : baseMail.translations,
    sections: mergeGeneratedSectionsOntoTemplateSections(guidedTemplateSections, normalizedGeneratedMail.sections),
    assets: baseMail.assets
  };

  if (looksLikeAffPasswordResetMail(baseMail)) {
    return applyPrimaryTranslationEntryToMail(
      applyDeterministicDraftEdits(
        mergeAffPasswordResetMailOntoTemplate(normalizedGeneratedMail, baseMail, payloadTranslationEntries, payload),
        payload
      ),
      payload
    );
  }

  return applyPrimaryTranslationEntryToMail(
    applyDeterministicDraftEdits(
      repairMailSectionsFromDesignHints(merged, payload),
      payload
    ),
    payload
  );
}

function isRtlLocale(locale) {
  const normalized = normalizeLocaleCode(locale).toLowerCase();
  return ["ar", "he", "fa", "ur"].some((prefix) => normalized === prefix || normalized.startsWith(`${prefix}_`));
}

function applyLocaleDirectionToHtml(html, locale) {
  const source = cleanText(html);
  if (!source || !isRtlLocale(locale)) {
    return source;
  }

  let transformed = source
    .replace(/<html([^>]*)>/i, (match, attrs) => /\bdir=/i.test(attrs) ? `<html${attrs}>` : `<html${attrs} dir="rtl">`)
    .replace(/<body([^>]*)>/i, (match, attrs) => {
      if (/\bdir=/i.test(attrs)) {
        return `<body${attrs}>`;
      }
      if (/\bstyle=/i.test(attrs)) {
        return `<body${attrs.replace(/\bstyle=(["'])(.*?)\1/i, (_full, quote, value) => `style=${quote}${value}; direction: rtl; text-align: right;${quote}`)} dir="rtl">`;
      }
      return `<body${attrs} dir="rtl" style="direction: rtl; text-align: right;">`;
    });

  const rtlStyle = `
<style type="text/css">
  html[dir="rtl"] body,
  html[dir="rtl"] table,
  html[dir="rtl"] td,
  html[dir="rtl"] p,
  html[dir="rtl"] div,
  html[dir="rtl"] h1,
  html[dir="rtl"] h2,
  html[dir="rtl"] h3,
  html[dir="rtl"] li {
    direction: rtl !important;
    text-align: right !important;
  }
  html[dir="rtl"] ul,
  html[dir="rtl"] ol {
    direction: rtl !important;
  }
  html[dir="rtl"] img.logo {
    margin-right: 0 !important;
    margin-left: auto !important;
  }
</style>`;

  if (/<\/head>/i.test(transformed)) {
    transformed = transformed.replace(/<\/head>/i, `${rtlStyle}\n</head>`);
  }

  return transformed;
}

async function resolveDiscussionResponse(payload) {
  const providerId = payload.settings.providerId;

  if (isDraftBlockedByInaccessibleFigma(payload)) {
    return createFigmaAccessBlockedResponse(payload, providerId, "figma-access-blocked");
  }

  if (providerId === "openai" && openAiApiKey) {
    try {
      const discussion = await createOpenAiDiscussion(payload);
      return {
        assistantReply: discussion.assistantReply,
        mode: "openai-discuss",
        providerRuntime: createProviderRuntime({
          providerId,
          mode: "openai-discuss",
          liveAttempted: true,
          liveUsed: true
        })
      };
    } catch (error) {
      const fallback = createMockDiscussion(payload, error.message);
      return {
        assistantReply: fallback.assistantReply,
        mode: "mock-discuss",
        providerRuntime: createProviderRuntime({
          providerId,
          mode: "mock-discuss",
          liveAttempted: true,
          fallback: true,
          errorMessage: error.message
        })
      };
    }
  }

  if (providerId === "mock") {
    const discussion = createMockDiscussion(payload, "Mock provider selected in settings");
    return {
      assistantReply: discussion.assistantReply,
      mode: "mock-discuss",
      providerRuntime: createProviderRuntime({
        providerId,
        mode: "mock-discuss"
      })
    };
  }

  if (providerId === "openai") {
    const discussion = createMockDiscussion(payload, "OPENAI_API_KEY is not configured on the server");
    return {
      assistantReply: discussion.assistantReply,
      mode: "mock-discuss",
      providerRuntime: createProviderRuntime({
        providerId,
        mode: "mock-discuss",
        fallback: true,
        errorMessage: "OPENAI_API_KEY is not configured on the server"
      })
    };
  }

  const discussion = createMockDiscussion(payload, `${providerId} adapter is planned but not wired yet`);
  return {
    assistantReply: discussion.assistantReply,
    mode: "mock-discuss",
    providerRuntime: createProviderRuntime({
      providerId,
      mode: "mock-discuss",
      fallback: true,
      errorMessage: `${providerId} adapter is planned but not wired yet`
    })
  };
}

function shouldAutoGenerateMissingLocalesForDraft(payload, draft) {
  const requestedLocales = Array.from(new Set([
    normalizeLocaleCode(payload?.brief?.locale || draft?.mail?.locale || "en"),
    ...parseLocaleList(payload?.brief?.requestedLocales || "")
  ].filter(Boolean)));

  if (requestedLocales.length <= 1) {
    return false;
  }

  const existingEntries = dedupeTranslationEntries(
    [
      ...parseTranslationEntries(cleanText(payload?.translationText), draft?.mail || payload?.currentDraft || null),
      ...(Array.isArray(draft?.mail?.translations) ? draft.mail.translations : [])
    ],
    draft?.mail || payload?.currentDraft || null
  );

  const missingLocales = requestedLocales.filter((locale) => !existingEntries.some((entry) => localeMatchesRequest(entry.locale, locale)));
  if (missingLocales.length === 0) {
    return false;
  }

  const latestUserMessage = cleanText(getLatestUserMessage(payload)).toLowerCase();
  const explicitlyRequested = /(авто|автомат|automatic|autogen|сделай автомат|сделай перев|переводы.*сделай|generate.*locales|generate.*translations)/i.test(latestUserMessage);
  return explicitlyRequested || !cleanText(payload?.translationText);
}

async function resolveDraftResponse(payload) {
  const providerId = payload.settings.providerId;

  if (isDraftBlockedByInaccessibleFigma(payload)) {
    return createFigmaAccessBlockedResponse(payload, providerId, "figma-access-blocked");
  }

  let effectivePayload = payload;
  let generated;
  let mode = providerId;
  let providerRuntime = createProviderRuntime({
    providerId,
    mode
  });

  if (providerId === "openai" && openAiApiKey) {
    try {
      generated = await createOpenAiDraft(payload);
      effectivePayload = hydratePayloadTemplateSelection({
        ...payload,
        designAnalysis: normalizeDesignAnalysis(generated.design_analysis)
      });
      mode = "openai";
      providerRuntime = createProviderRuntime({
        providerId,
        mode,
        liveAttempted: true,
        liveUsed: true
      });
    } catch (error) {
      generated = await createProjectAwareMockDraft(payload, error.message);
      mode = "mock";
      providerRuntime = createProviderRuntime({
        providerId,
        mode,
        liveAttempted: true,
        fallback: true,
        errorMessage: error.message
      });
    }
  } else if (providerId === "mock") {
    generated = await createProjectAwareMockDraft(payload, "Mock provider selected in settings");
    mode = "mock";
    providerRuntime = createProviderRuntime({
      providerId,
      mode
    });
  } else if (providerId === "openai") {
    generated = await createProjectAwareMockDraft(payload, "OPENAI_API_KEY is not configured on the server");
    mode = "mock";
    providerRuntime = createProviderRuntime({
      providerId,
      mode,
      fallback: true,
      errorMessage: "OPENAI_API_KEY is not configured on the server"
    });
  } else {
    generated = await createProjectAwareMockDraft(payload, `${providerId} adapter is planned but not wired yet`);
    mode = "mock";
      providerRuntime = createProviderRuntime({
        providerId,
        mode,
        fallback: true,
        errorMessage: `${providerId} adapter is planned but not wired yet`
      });
  }

  const templateMail = await resolveTemplateMail(effectivePayload);
  if (templateMail) {
    generated = {
      ...generated,
      mail: mergeGeneratedMailOntoTemplate(generated?.mail || null, templateMail, effectivePayload)
    };
  }

  let draftResponse = {
    ...materializeDraft(generated, effectivePayload, mode),
    designAnalysis: normalizeDesignAnalysis(generated.design_analysis),
    providerRuntime
  };

  // Auto-patch brand theme when scaffold context is present + AI returned brand_theme
  if (effectivePayload.scaffoldContext && draftResponse.brandTheme) {
    try {
      const sc = effectivePayload.scaffoldContext;
      const mailRoot = path.join(emailBaseRoot, sc.category, `mail-${sc.newMailId}`);
      if (existsSync(mailRoot)) {
        await patchTheme(mailRoot, draftResponse.brandTheme);
        // Save theme for future reuse (brandId = category name lowercased)
        const themeWithId = { ...draftResponse.brandTheme, brandId: sc.category.toLowerCase().replace(/[^a-z0-9-]/g, "-") };
        await saveTheme(themeWithId).catch(() => {});
        console.log(`[theme-patcher] Patched ${sc.category}/mail-${sc.newMailId} with brand theme`);
      }
    } catch (themeErr) {
      console.warn("[theme-patcher] Auto-patch failed:", themeErr.message);
    }
  }

  if (shouldAutoGenerateMissingLocalesForDraft(effectivePayload, draftResponse.draft)) {
    try {
      const localesResult = await generateMissingLocales(effectivePayload, draftResponse.draft);
      const visibleGeneratedLocales = Array.isArray(localesResult.generatedLocales)
        ? localesResult.generatedLocales.filter((locale) => locale !== normalizeLocaleCode(effectivePayload?.brief?.locale || draftResponse?.draft?.mail?.locale || "en"))
        : [];
      const generatedLocalesNote = visibleGeneratedLocales.length > 0
        ? ` Автопереводы: ${visibleGeneratedLocales.join(", ")}.`
        : "";
      draftResponse = {
        ...draftResponse,
        assistantReply: `${cleanText(draftResponse.assistantReply)}${generatedLocalesNote}`.trim(),
        draft: localesResult.draft || draftResponse.draft,
        translationText: localesResult.translationText || "",
        uploadStatus: localesResult.uploadStatus || "",
        generatedLocales: Array.isArray(localesResult.generatedLocales) ? localesResult.generatedLocales : [],
        providerRuntime: localesResult.providerRuntime || draftResponse.providerRuntime
      };
    } catch {
      // Keep the draft even if locale generation fails.
    }
  }

  if (summaryEmailBaseBuildIsAvailableForDraft(effectivePayload, draftResponse.draft)) {
    try {
      const builtPreview = await buildTemporaryEmailBasePreviewFromDraft(effectivePayload, draftResponse.draft.mail);
      return {
        ...draftResponse,
        assistantReply: `${cleanText(draftResponse.assistantReply)} Preview прогнан через реальный email-base build.`.trim(),
        draft: builtPreview.draft || draftResponse.draft,
        previewSource: builtPreview.previewSource || "email-base-draft"
      };
    } catch (error) {
      const buildMessage = cleanText(error?.message);
      if (draftResponse.draft) {
        draftResponse.draft.buildLog = [
          cleanText(draftResponse.draft.buildLog),
          buildMessage ? `Preview build fallback: ${buildMessage}` : ""
        ].filter(Boolean).join("\n");
      }
    }
  }

  return draftResponse;
}

function summaryEmailBaseBuildIsAvailableForDraft(payload, draft) {
  if (!draft?.mail) {
    return false;
  }

  const summary = summarizeEmailBase();
  if (!summary.available) {
    return false;
  }

  return Boolean(cleanText(payload?.brief?.category) || cleanText(payload?.templateSelection?.category));
}

/**
 * Auto-saves a generation to history if the result contains a real draft.
 * Fire-and-forget: errors are swallowed so they never break the chat response.
 */
function autoSaveGenerationHistory(result, payload) {
  try {
    const mail = result?.draft?.mail;
    if (!mail || result.intent === "discuss") return;
    const brief = payload?.brief || {};
    dbHistoryAppend({
      category: cleanText(mail.category || brief.category),
      mailId: cleanText(mail.mail_id || brief.mailId),
      locale: cleanText(mail.locale || brief.locale),
      subject: cleanText(mail.subject),
      preheader: cleanText(mail.preheader),
      mode: cleanText(result.mode || "draft"),
      source: cleanText(result.previewSource || "ai"),
      brief: {
        campaignName: cleanText(brief.campaignName),
        goal: cleanText(brief.goal),
        category: cleanText(brief.category),
        mailId: cleanText(brief.mailId),
        locale: cleanText(brief.locale)
      },
      html: mail.html || ""
    });
  } catch {
    // history saving is best-effort
  }
}

async function resolveChatResponse(payload) {
  payload = await enrichPayloadWithServerSideFigma(payload);
  if (payload.intent === "discuss") {
    return resolveDiscussionResponse(payload);
  }

  return resolveDraftResponse(payload);
}

async function resolveDesignAnalysis(payload) {
  payload = await enrichPayloadWithServerSideFigma(payload);
  const providerId = payload.settings.providerId;

  if (isDraftBlockedByInaccessibleFigma(payload)) {
    return {
      ...createFigmaAccessBlockedResponse(payload, providerId, "figma-access-blocked"),
      designAnalysis: null
    };
  }

  if (providerId === "openai" && openAiApiKey) {
    try {
      const result = await createOpenAiDesignAnalysis(payload);
      return {
        assistantReply: result.assistantReply,
        mode: "openai-design",
        designAnalysis: result.analysis,
        providerRuntime: createProviderRuntime({
          providerId,
          mode: "openai-design",
          liveAttempted: true,
          liveUsed: true
        })
      };
    } catch (error) {
      const fallback = createMockDesignAnalysis(payload, error.message);
      return {
        assistantReply: fallback.assistantReply,
        mode: "mock-design",
        designAnalysis: fallback.analysis,
        providerRuntime: createProviderRuntime({
          providerId,
          mode: "mock-design",
          liveAttempted: true,
          fallback: true,
          errorMessage: error.message
        })
      };
    }
  }

  const fallback = createMockDesignAnalysis(
    payload,
    providerId === "openai"
      ? "OPENAI_API_KEY is not configured on the server."
      : providerId === "mock"
        ? "Mock provider selected in settings."
        : `${providerId} adapter is planned but not wired yet.`
  );
  return {
    assistantReply: fallback.assistantReply,
    mode: "mock-design",
    designAnalysis: fallback.analysis,
    providerRuntime: createProviderRuntime({
      providerId,
      mode: "mock-design",
      fallback: true,
      errorMessage: providerId === "openai"
        ? "OPENAI_API_KEY is not configured on the server."
        : providerId === "mock"
          ? ""
          : `${providerId} adapter is planned but not wired yet.`
    })
  };
}

async function wait(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function chunkAssistantReply(text) {
  const words = cleanText(text).split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return [];
  }

  const chunks = [];
  let current = "";

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > 42 && current) {
      chunks.push(`${current} `);
      current = word;
      continue;
    }
    current = next;
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
}

function sendNdjsonFrame(response, frame) {
  response.write(`${JSON.stringify(frame)}\n`);
}

async function streamChatResponse(response, payload) {
  response.writeHead(200, {
    "Content-Type": "application/x-ndjson; charset=utf-8",
    "Cache-Control": "no-store",
    Connection: "keep-alive"
  });

  sendNdjsonFrame(response, { type: "start" });
  let result;
  try {
    result = await resolveChatResponse(payload);
  } catch (error) {
    sendNdjsonFrame(response, {
      type: "final",
      payload: {
        assistantReply: `Ошибка при генерации: ${error instanceof Error ? error.message : "Unknown error"}`,
        mode: "error"
      }
    });
    response.end();
    return;
  }

  for (const chunk of chunkAssistantReply(result.assistantReply)) {
    sendNdjsonFrame(response, {
      type: "assistant_delta",
      delta: chunk
    });
    await wait(18);
  }

  sendNdjsonFrame(response, {
    type: "final",
    payload: result
  });
  response.end();
}

async function generateMissingLocales(payload, existingDraft = null) {
  payload = await enrichPayloadWithServerSideFigma(payload);
  const baseDraft = existingDraft && typeof existingDraft === "object" ? existingDraft : null;
  const baseMail = normalizeMail(baseDraft?.mail || payload.currentDraft || null, payload);
  const existingEntries = dedupeTranslationEntries(
    [
      ...(Array.isArray(baseMail.translations) ? baseMail.translations : []),
      ...parseTranslationEntries(payload.translationText, baseMail)
    ],
    baseMail
  );
  const requestedLocales = Array.from(new Set([
    normalizeLocaleCode(payload.brief.locale || baseMail.locale),
    ...parseLocaleList(payload.brief.requestedLocales)
  ].filter(Boolean)));

  if (requestedLocales.length === 0) {
    throw new Error("Requested locales are empty. Fill the Requested locales field first.");
  }

  const missingLocales = requestedLocales.filter((locale) => !existingEntries.some((entry) => localeMatchesRequest(entry.locale, locale)));

  const sourceEntry = buildSourceTranslationEntry(baseMail, payload);
  const sourceEntries = existingEntries.length > 0
    ? existingEntries
    : [sourceEntry];

  if (missingLocales.length === 0) {
    const mergedMail = {
      ...baseMail,
      translations: collapseRedundantTranslationEntries(
        sortTranslationEntries(sourceEntries, payload.brief.locale, requestedLocales)
      )
    };

    return {
      assistantReply: `Все requested locales уже есть в bundle: ${requestedLocales.join(", ")}.`,
      mode: `${payload.settings.providerId}-translations`,
      translationText: renderTranslationBundle(mergedMail.translations),
      uploadStatus: `Locales already complete: ${requestedLocales.join(", ")}.`,
      draft: createDraftSnapshot(mergedMail, baseDraft, {
        assetRecommendations: buildAssetRecommendations(mergedMail, payload),
        previewCategory: payload.brief.category
      })
    };
  }

  let generated;
  let mode = `${payload.settings.providerId}-translations`;
  const providerId = payload.settings.providerId;
  let providerRuntime = createProviderRuntime({
    providerId,
    mode
  });

  if (providerId === "deepl" && deepLApiKey) {
    try {
      generated = await createDeepLTranslations(payload, baseMail, sourceEntry, missingLocales);
      mode = "deepl-translations";
      providerRuntime = createProviderRuntime({ providerId, mode, liveAttempted: true, liveUsed: true });
    } catch (error) {
      generated = createMockTranslations(payload, baseMail, sourceEntry, missingLocales, error.message);
      mode = "mock-translations";
      providerRuntime = createProviderRuntime({ providerId, mode, liveAttempted: true, fallback: true, errorMessage: error.message });
    }
  } else if (providerId === "openai" && openAiApiKey) {
    try {
      generated = await createOpenAiTranslations(payload, baseMail, sourceEntry, missingLocales);
      mode = "openai-translations";
      providerRuntime = createProviderRuntime({
        providerId,
        mode,
        liveAttempted: true,
        liveUsed: true
      });
    } catch (error) {
      generated = createMockTranslations(payload, baseMail, sourceEntry, missingLocales, error.message);
      mode = "mock-translations";
      providerRuntime = createProviderRuntime({
        providerId,
        mode,
        liveAttempted: true,
        fallback: true,
        errorMessage: error.message
      });
    }
  } else if (providerId === "mock") {
    generated = createMockTranslations(payload, baseMail, sourceEntry, missingLocales, "Mock translation mode selected.");
    mode = "mock-translations";
    providerRuntime = createProviderRuntime({
      providerId,
      mode
    });
  } else if (providerId === "openai") {
    generated = createMockTranslations(payload, baseMail, sourceEntry, missingLocales, "OPENAI_API_KEY is not configured on the server.");
    mode = "mock-translations";
    providerRuntime = createProviderRuntime({
      providerId,
      mode,
      fallback: true,
      errorMessage: "OPENAI_API_KEY is not configured on the server."
    });
  } else {
    generated = createMockTranslations(payload, baseMail, sourceEntry, missingLocales, `${providerId} adapter is planned but not wired yet.`);
    mode = "mock-translations";
    providerRuntime = createProviderRuntime({
      providerId,
      mode,
      fallback: true,
      errorMessage: `${providerId} adapter is planned but not wired yet.`
    });
  }

  const mergedTranslations = sortTranslationEntries(
    collapseRedundantTranslationEntries(
      dedupeTranslationEntries([...sourceEntries, ...generated.translations], baseMail)
    ),
    payload.brief.locale,
    requestedLocales
  );
  const mergedMail = {
    ...baseMail,
    translations: mergedTranslations
  };

  return {
    assistantReply: cleanText(generated.assistant_reply)
      || `Generated missing locales: ${missingLocales.join(", ")}.`,
    mode,
    providerRuntime,
    generatedLocales: missingLocales,
    translationText: renderTranslationBundle(mergedTranslations),
    uploadStatus: `Translation bundle now contains ${mergedTranslations.length} locale file(s). Generated: ${missingLocales.join(", ")}.`,
    draft: createDraftSnapshot(mergedMail, baseDraft, {
      assetRecommendations: buildAssetRecommendations(mergedMail, payload),
      previewCategory: payload.brief.category
    })
  };
}

async function serveStatic(request, response) {
  const requestPath = request.url === "/" ? "/index.html" : request.url;
  const sanitizedPath = path
    .normalize(requestPath.split("?")[0])
    .replace(/^(\.\.[/\\])+/, "")
    .replace(/^[/\\]+/, "");
  const filePath = path.join(publicDir, sanitizedPath);

  if (!filePath.startsWith(publicDir)) {
    sendText(response, 403, "Forbidden");
    return;
  }

  try {
    const data = await readFile(filePath);
    const contentType = mimeTypes[path.extname(filePath)] || "application/octet-stream";
    response.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": "no-store"
    });
    response.end(data);
  } catch {
    sendText(response, 404, "Not found");
  }
}

const server = http.createServer(async (request, response) => {
  try {
    if (request.method === "GET" && request.url.startsWith("/studio-assets/")) {
      await serveStudioAsset(request, response);
      return;
    }

    if (request.method === "OPTIONS" && request.url === "/api/figma/import") {
      sendText(response, 204, "", "text/plain; charset=utf-8", getFigmaImportCorsHeaders());
      return;
    }

    if (request.method === "GET" && request.url === "/api/figma/status") {
      sendJson(response, 200, summarizeFigmaIntegration(), getFigmaImportCorsHeaders());
      return;
    }

    // ─── DeepL endpoints ──────────────────────────────────────────────────

    if (request.method === "GET" && request.url === "/api/deepl/status") {
      sendJson(response, 200, {
        available: Boolean(deepLApiKey),
        apiUrl: deepLApiUrl
      });
      return;
    }

    if (request.method === "POST" && request.url === "/api/deepl/translate") {
      if (!deepLApiKey) {
        sendJson(response, 400, { error: "DEEPL_API_KEY is not configured on the server" });
        return;
      }
      const body = await readRequestBody(request);
      const texts = Array.isArray(body?.texts) ? body.texts : [cleanText(body?.text)].filter(Boolean);
      const targetLocale = cleanText(body?.targetLocale || body?.target_locale);
      const sourceLocale = cleanText(body?.sourceLocale || body?.source_locale || "");
      if (!targetLocale) {
        sendJson(response, 400, { error: "targetLocale is required" });
        return;
      }
      try {
        const translated = await deeplTranslateTexts(texts, targetLocale, sourceLocale);
        sendJson(response, 200, { translated });
      } catch (err) {
        sendJson(response, 500, { error: err.message });
      }
      return;
    }

    if (request.method === "POST" && request.url === "/api/figma/import") {
      const rawPayload = await readRequestBody(request);
      if (!isFigmaImportAuthorized(rawPayload, request)) {
        sendJson(response, 401, {
          error: "Figma import secret mismatch"
        }, getFigmaImportCorsHeaders());
        return;
      }

      let payloadForNormalization = rawPayload;
      const figmaUrl = findFirstFigmaUrlInPayload(rawPayload);
      const existingStructuredImport = normalizeFigmaImportPayload(
        rawPayload?.figmaImport && typeof rawPayload.figmaImport === "object"
          ? rawPayload.figmaImport
          : rawPayload
      );
      if (!hasDetailedFigmaImportPayload(existingStructuredImport)) {
        const serverStructuredImport = await tryBuildServerSideFigmaImport(figmaUrl);
        if (serverStructuredImport) {
          payloadForNormalization = {
            ...rawPayload,
            figmaImport: {
              ...(rawPayload?.figmaImport && typeof rawPayload.figmaImport === "object" ? rawPayload.figmaImport : {}),
              ...serverStructuredImport
            },
            dataUrl: cleanText(rawPayload?.dataUrl) || cleanText(serverStructuredImport?.previewImage?.url) || cleanText(serverStructuredImport?.previewImage?.dataUrl),
            fileKey: cleanText(rawPayload?.fileKey) || cleanText(serverStructuredImport.fileKey),
            nodeId: cleanText(rawPayload?.nodeId) || cleanText(serverStructuredImport.nodeId),
            selectionName: cleanText(rawPayload?.selectionName) || cleanText(serverStructuredImport.selectionName),
            pageName: cleanText(rawPayload?.pageName) || cleanText(serverStructuredImport.pageName)
          };
        }
      }

      const result = normalizeFigmaPluginRequest(payloadForNormalization);
      if (!result.design && !result.briefPatch.designUrl) {
        sendJson(response, 400, {
          error: "No usable Figma link, screenshot/export or structured payload found"
        }, getFigmaImportCorsHeaders());
        return;
      }

      await appendStudioJournalEntry({
        area: "design",
        title: "Figma intake received",
        message: [
          `Mode: ${result.intake.mode}.`,
          cleanText(result.design?.figmaSelectionName) ? `Selection: ${result.design.figmaSelectionName}.` : "",
          result.intake.recommendedNextStep
        ].filter(Boolean).join(" "),
        meta: {
          mode: result.intake.mode,
          hasLink: result.intake.hasLink,
          hasVisual: result.intake.hasVisual,
          hasStructured: result.intake.hasStructured,
          fileKey: cleanText(result.design?.figmaFileKey),
          nodeId: cleanText(result.design?.figmaNodeId)
        }
      });

      const designDecomposition = buildNormalizedDesignDecomposition({ designSchema: result.designSchema }, result.designSchema);
      const designMappingHints = buildNormalizedDesignMappingHints({ designSchema: result.designSchema }, result.designSchema);
      const designBlockRecommendations = buildNormalizedDesignBlockRecommendations({
        designSchema: result.designSchema,
        designMappingHints
      }, designMappingHints);

      sendJson(response, 200, {
        design: result.design,
        designSchema: result.designSchema,
        designDecomposition,
        designMappingHints,
        designBlockRecommendations,
        mappingSummary: summarizeDesignMappingHints(designMappingHints),
        briefPatch: result.briefPatch,
        intake: result.intake,
        figma: summarizeFigmaIntegration(),
        assistantReply: result.intake.hasLink && !result.intake.hasVisual && !result.intake.hasStructured
          ? "Figma link received. If this frame is private, the next safe step is an open draft/share link or a screenshot/export."
          : result.intake.hasStructured
            ? "Figma intake received. Structured frame data is ready for future Send to Studio flow."
            : "Figma intake received.",
        uploadStatus: [
          `Figma intake mode: ${result.intake.mode}.`,
          result.intake.recommendedNextStep
        ].filter(Boolean).join(" ")
      }, getFigmaImportCorsHeaders());
      return;
    }

    if (request.method === "GET" && request.url === "/api/figma/contract") {
      sendJson(response, 200, {
        figma: summarizeFigmaIntegration(),
        contract: getFigmaIntegrationContract()
      }, getFigmaImportCorsHeaders());
      return;
    }

    if (request.method === "GET" && request.url === "/api/status") {
      const blockCatalog = await ensureBlockCatalog();
      const mailStructures = await ensureMailStructureProfiles();
      const assetRegistry = await readAssetRegistry();
      const journal = await readStudioJournal();
      const projectRules = await readProjectRules();
      const templateFamilies = readTemplateFamilyProfilesSnapshot();
      sendJson(response, 200, {
        openAiConfigured: Boolean(openAiApiKey),
        model: openAiModel,
        modelRouting: summarizeOpenAiModelRouting(),
        config: summarizeRuntimeConfig(),
        providers: getProviderCatalog(),
        clientProfiles,
        figma: summarizeFigmaIntegration(),
        emailBase: summarizeEmailBase(),
        blockCatalog: summarizeBlockCatalog(blockCatalog),
        mailStructures: summarizeMailStructureProfiles(mailStructures),
        templateFamilies: summarizeTemplateFamilyProfiles(templateFamilies),
        evalBenchmark: summarizeEvalFoundation(),
        assetRegistry: summarizeAssetRegistry(assetRegistry),
        journal: summarizeStudioJournal(journal),
        projectRules: summarizeProjectRules(projectRules)
      });
      return;
    }

    if (request.method === "GET" && request.url === "/api/eval/status") {
      sendJson(response, 200, {
        evalBenchmark: summarizeEvalFoundation()
      });
      return;
    }

    if (request.method === "POST" && request.url === "/api/design/decompose") {
      const rawPayload = await readRequestBody(request);
      const payload = await enrichPayloadWithServerSideFigma(normalizePayload(rawPayload));
      sendJson(response, 200, {
        designSchema: payload.designSchema,
        designDecomposition: payload.designDecomposition,
        designMappingHints: payload.designMappingHints,
        designBlockRecommendations: payload.designBlockRecommendations,
        summary: summarizeDesignDecomposition(payload.designDecomposition),
        mappingSummary: summarizeDesignMappingHints(payload.designMappingHints),
        blockRecommendationSummary: summarizeDesignBlockRecommendations(payload.designBlockRecommendations)
      });
      return;
    }

    if (request.method === "POST" && request.url === "/api/eval/score") {
      const rawPayload = await readRequestBody(request);
      const snapshot = readEvalBenchmarkSnapshot(evalBenchmarkPath);
      const benchmarkCase = rawPayload?.caseId
        ? findEvalBenchmarkCase(snapshot, rawPayload.caseId)
        : rawPayload?.benchmarkCase;

      if (!benchmarkCase) {
        sendJson(response, 400, {
          error: "Benchmark case not found",
          evalBenchmark: summarizeEvalBenchmark(snapshot)
        });
        return;
      }

      const result = scoreEvalCase(benchmarkCase, {
        draft: rawPayload?.draft,
        templateSelection: rawPayload?.templateSelection,
        providerRuntime: rawPayload?.providerRuntime
      });

      sendJson(response, 200, {
        benchmarkCase,
        result
      });
      return;
    }

    if (request.method === "GET" && request.url === "/api/block-catalog") {
      sendJson(response, 200, await ensureBlockCatalog());
      return;
    }

    if (request.method === "GET" && request.url === "/api/template-family-profiles") {
      sendJson(response, 200, readTemplateFamilyProfilesSnapshot());
      return;
    }

    if (request.method === "GET" && request.url === "/api/mail-structure-profiles") {
      sendJson(response, 200, await ensureMailStructureProfiles());
      return;
    }

    if (request.method === "POST" && request.url === "/api/mail-structure-profiles/refresh") {
      const profiles = await ensureMailStructureProfiles({ force: true });
      await appendStudioJournalEntry({
        area: "catalog",
        title: "Mail structure profiles refreshed",
        message: `Mail structure profiles now contain ${profiles.items.length} mail profile(s).`
      });
      sendJson(response, 200, profiles);
      return;
    }

    if (request.method === "POST" && request.url === "/api/block-catalog/refresh") {
      const catalog = await ensureBlockCatalog({ force: true });
      await appendStudioJournalEntry({
        area: "catalog",
        title: "Block catalog refreshed",
        message: `Catalog now contains ${catalog.summary?.itemCount || catalog.items.length} block(s).`
      });
      sendJson(response, 200, catalog);
      return;
    }

    if (request.method === "GET" && request.url === "/api/assets") {
      const registry = await readAssetRegistry();
      sendJson(response, 200, {
        items: registry.items,
        summary: summarizeAssetRegistry(registry)
      });
      return;
    }

    if (request.method === "POST" && request.url === "/api/assets/register") {
      const payload = await readRequestBody(request);
      const result = await registerUploadedAssets(Array.isArray(payload?.files) ? payload.files : []);
      await appendStudioJournalEntry({
        area: "assets",
        title: "Assets uploaded",
        message: `Registered ${result.items.length} file(s) in asset library.`,
        meta: {
          count: result.items.length
        }
      });
      sendJson(response, 200, result);
      return;
    }

    if (request.method === "POST" && request.url === "/api/assets/update") {
      const payload = await readRequestBody(request);
      const result = await updateAssetRegistryEntry(payload?.id, payload?.patch || {});
      await appendStudioJournalEntry({
        area: "assets",
        title: "Asset updated",
        message: cleanText(payload?.patch?.externalUrl)
          ? `Linked asset ${cleanText(result.item.label) || cleanText(result.item.id)} to external URL.`
          : `Updated asset ${cleanText(result.item.label) || cleanText(result.item.id)}.`,
        meta: {
          assetId: cleanText(result.item.id)
        }
      });
      sendJson(response, 200, result);
      return;
    }

    if (request.method === "GET" && request.url === "/api/journal") {
      const journal = await readStudioJournal();
      sendJson(response, 200, {
        entries: journal.entries,
        summary: summarizeStudioJournal(journal)
      });
      return;
    }

    if (request.method === "POST" && request.url === "/api/journal/clear") {
      const journal = await clearStudioJournal();
      sendJson(response, 200, {
        entries: journal.entries,
        summary: summarizeStudioJournal(journal)
      });
      return;
    }

    if (request.method === "GET" && request.url === "/api/project-rules") {
      const rules = await readProjectRules();
      sendJson(response, 200, {
        items: rules.items,
        summary: summarizeProjectRules(rules)
      });
      return;
    }

    if (request.method === "POST" && request.url === "/api/project-rules") {
      const payload = await readRequestBody(request);
      const rules = await appendProjectRule(payload?.text, payload?.source);
      await appendStudioJournalEntry({
        area: "rules",
        title: "Project rule saved",
        message: cleanText(payload?.text)
      });
      sendJson(response, 200, {
        items: rules.items,
        summary: summarizeProjectRules(rules)
      });
      return;
    }

    if (request.method === "POST" && request.url === "/api/project-rules/clear") {
      const rules = await clearProjectRules();
      await appendStudioJournalEntry({
        area: "rules",
        title: "Project rules cleared",
        message: "Project rules list was reset."
      });
      sendJson(response, 200, {
        items: rules.items,
        summary: summarizeProjectRules(rules)
      });
      return;
    }

    if (request.method === "POST" && request.url === "/api/chat") {
      const payload = normalizePayload(await readRequestBody(request));
      payload.projectRules = (await readProjectRules()).items;
      const chatResult = await resolveChatResponse(payload);
      autoSaveGenerationHistory(chatResult, payload);
      sendJson(response, 200, chatResult);
      return;
    }

    if (request.method === "POST" && request.url === "/api/chat/stream") {
      const payload = normalizePayload(await readRequestBody(request));
      payload.projectRules = (await readProjectRules()).items;
      await streamChatResponse(response, payload);
      return;
    }

    if (request.method === "POST" && request.url === "/api/email/extract-content") {
      const body = await readRequestBody(request);
      const html = cleanText(body?.html);
      if (!html) {
        sendJson(response, 400, { error: "html is required" });
        return;
      }
      const contentMap = extractEmailHtmlContentMap(html);
      if (!contentMap) {
        sendJson(response, 400, { error: "Could not parse HTML" });
        return;
      }
      sendJson(response, 200, { ok: true, contentMap });
      return;
    }

    if (request.method === "POST" && request.url === "/api/design/analyze") {
      const payload = normalizePayload(await readRequestBody(request));
      payload.projectRules = (await readProjectRules()).items;
      const result = await resolveDesignAnalysis(payload);
      await appendStudioJournalEntry({
        area: "design",
        title: "Design analyzed",
        message: cleanText(result.assistantReply),
        meta: {
          mode: cleanText(result.mode)
        }
      });
      sendJson(response, 200, result);
      return;
    }

    if (request.method === "POST" && request.url === "/api/translations/generate") {
      const rawPayload = await readRequestBody(request);
      const payload = normalizePayload(rawPayload);
      const existingDraft = rawPayload?.draft && typeof rawPayload.draft === "object"
        ? rawPayload.draft
        : null;

      const result = await generateMissingLocales(payload, existingDraft);
      await appendStudioJournalEntry({
        area: "translations",
        title: "Locales generated",
        message: cleanText(result.assistantReply),
        meta: {
          requested: cleanText(payload.brief.requestedLocales)
        }
      });
      sendJson(response, 200, result);
      return;
    }

    if (request.method === "POST" && request.url === "/api/email-base/build") {
      const payload = normalizePayload(await readRequestBody(request));
      const summary = summarizeEmailBase();
      const category = cleanText(payload?.brief?.category || payload?.category) || summary.currentMail?.category;
      const mailId = cleanText(payload?.brief?.mailId || payload?.mailId) || summary.currentMail?.mailId;
      const locale = cleanText(payload?.brief?.locale || payload?.locale) || payload.brief.locale || "en";

      const result = await buildEmailBasePreview(category, mailId, locale);
      await appendStudioJournalEntry({
        area: "email-base",
        title: "Base email built",
        message: `Loaded preview for ${category}/mail-${mailId} (${locale}).`
      });
      sendJson(response, 200, result);
      return;
    }

    if (request.method === "POST" && request.url === "/api/email-base/create") {
      const rawPayload = await readRequestBody(request);
      const payload = normalizePayload(rawPayload);
      const draftSource = rawPayload?.draft || rawPayload?.currentDraft || rawPayload?.draft?.mail;

      if (!draftSource || typeof draftSource !== "object") {
        sendJson(response, 400, { error: "Current draft is required to create a mail in email-base" });
        return;
      }

      const result = await createEmailBaseMailFromDraft(payload, draftSource);
      await appendStudioJournalEntry({
        area: "email-base",
        title: "Draft saved to email-base",
        message: `Saved ${cleanText(result.saved?.folder)} with ${Array.isArray(result.saved?.locales) ? result.saved.locales.length : 0} locale(s).`,
        meta: result.saved || {}
      });
      sendJson(response, 200, result);
      return;
    }

    // ─── AI Lessons endpoints ───────────────────────────────────────────

    if (request.method === "GET" && request.url === "/api/ai/lessons") {
      const lessons = await readAiLessons();
      sendJson(response, 200, lessons);
      return;
    }

    if (request.method === "POST" && request.url === "/api/ai/lesson") {
      const body = await readRequestBody(request);
      const lesson = await appendAiLesson({
        category: cleanText(body?.category) || "general",
        mistake: cleanText(body?.mistake),
        correction: cleanText(body?.correction),
        tags: Array.isArray(body?.tags) ? body.tags : [],
        source: cleanText(body?.source) || "user"
      });
      await appendStudioJournalEntry({
        area: "ai-lessons",
        title: "AI lesson saved",
        message: `Lesson: ${lesson.mistake.slice(0, 80)}...`
      });
      sendJson(response, 200, { ok: true, lesson });
      return;
    }

    if (request.method === "DELETE" && request.url.startsWith("/api/ai/lesson/")) {
      const lessonId = request.url.replace("/api/ai/lesson/", "").split("?")[0];
      const result = await deleteAiLesson(lessonId);
      sendJson(response, 200, result);
      return;
    }

    if (request.method === "POST" && request.url === "/api/ai/lessons/clear") {
      try { dbLessonsClear(); } catch { /* ignore */ }
      sendJson(response, 200, { ok: true });
      return;
    }

    // ─── Figma Inspect endpoint (parse URL → fetch Figma REST API) ──────

    if (request.method === "POST" && request.url === "/api/figma/inspect") {
      const body = await readRequestBody(request);
      const figmaUrl = cleanText(body?.url);

      if (!figmaUrl) {
        sendJson(response, 400, { error: "url is required" });
        return;
      }

      if (!figmaApiToken) {
        const parsed = parseFigmaUrl(figmaUrl);
        sendJson(response, 400, {
          error: "FIGMA_API_TOKEN is not configured. Add it to your .env file to enable Figma inspection.",
          parsed
        });
        return;
      }

      try {
        const result = await inspectFigmaUrl(figmaUrl, figmaApiToken);
        sendJson(response, 200, { ok: true, ...result });
      } catch (err) {
        sendJson(response, 400, { error: err.message });
      }
      return;
    }

    // ─── Figma Browse — list pages + frames from a file ──────────────────
    // POST /api/figma/browse  Body: { url } or { fileKey }
    // Response: { fileName, pages: [{ id, name, frames: [{ id, name, width, height }] }] }
    if (request.method === "POST" && request.url === "/api/figma/browse") {
      const body = await readRequestBody(request);
      if (!figmaApiToken) {
        sendJson(response, 400, { error: "FIGMA_API_TOKEN is not configured. Add it to .env." });
        return;
      }
      let fileKey = cleanText(body?.fileKey);
      if (!fileKey && body?.url) {
        const parsed = parseFigmaUrl(cleanText(body.url));
        if (!parsed) { sendJson(response, 400, { error: "Could not parse Figma URL" }); return; }
        fileKey = parsed.fileKey;
      }
      if (!fileKey) { sendJson(response, 400, { error: "fileKey or url required" }); return; }
      try {
        const result = await browseFigmaFile(fileKey, figmaApiToken);
        sendJson(response, 200, result);
      } catch (err) {
        sendJson(response, 400, { error: err.message });
      }
      return;
    }

    // ─── Figma Export Images — export nodes as PNGs, save to studio-assets ─
    // POST /api/figma/export-images
    // Body: { fileKey, nodeIds: string[], format?: 'png'|'jpg'|'svg', scale?: 1|2|3, save?: bool }
    // Response: { images: [{ nodeId, name?, url, assetUrl? }] }
    if (request.method === "POST" && request.url === "/api/figma/export-images") {
      const body = await readRequestBody(request);
      if (!figmaApiToken) {
        sendJson(response, 400, { error: "FIGMA_API_TOKEN is not configured. Add it to .env." });
        return;
      }
      const fileKey = cleanText(body?.fileKey);
      const rawIds  = Array.isArray(body?.nodeIds) ? body.nodeIds.map(String) : [];
      const format  = ["png", "jpg", "svg", "pdf"].includes(body?.format) ? body.format : "png";
      const scale   = [1, 2, 3].includes(Number(body?.scale)) ? Number(body.scale) : 2;
      const save    = body?.save !== false; // default true — save to studio-assets

      if (!fileKey || !rawIds.length) {
        sendJson(response, 400, { error: "fileKey and nodeIds[] required" });
        return;
      }

      try {
        // Step 1: get Figma-hosted download URLs for each node
        const urlMap = await exportFigmaImages(fileKey, rawIds, figmaApiToken, { format, scale });

        // Step 2: optionally download each image and register in studio-assets
        const results = [];
        for (const [nodeId, figmaUrl] of Object.entries(urlMap)) {
          if (!figmaUrl) {
            results.push({ nodeId, url: null, error: "Figma returned no URL for this node" });
            continue;
          }
          if (!save) {
            results.push({ nodeId, url: figmaUrl });
            continue;
          }
          try {
            const { buffer, contentType } = await downloadImageBuffer(figmaUrl);
            // Build filename: sanitize nodeId "123:456" → "figma-123-456.png"
            const ext      = format === "jpg" ? "jpg" : format === "svg" ? "svg" : "png";
            const safeName = `figma-${nodeId.replace(/[^a-z0-9]/gi, "-")}.${ext}`;
            const assetPath = path.join(assetStorageDir, safeName);
            await mkdir(assetStorageDir, { recursive: true });
            await writeFile(assetPath, buffer);
            const assetUrl = `/studio-assets/${safeName}`;
            results.push({ nodeId, url: figmaUrl, assetUrl, fileName: safeName, contentType });
          } catch (dlErr) {
            results.push({ nodeId, url: figmaUrl, error: dlErr.message });
          }
        }
        sendJson(response, 200, { images: results });
      } catch (err) {
        sendJson(response, 400, { error: err.message });
      }
      return;
    }

    // ─── Block-assembly pipeline ─────────────────────────────────────────

    if (request.method === "POST" && request.url === "/api/email-base/assemble") {
      const body = await readRequestBody(request);
      const { category, mailId, blocks, referenceMailType, locale, subject } = body || {};

      if (!category || !mailId) {
        sendJson(response, 400, { error: "category and mailId are required" });
        return;
      }

      try {
        const result = await assembleEmail({
          category: cleanText(category),
          mailId: cleanText(mailId),
          blocks: Array.isArray(blocks) ? blocks : [],
          referenceMailType: cleanText(referenceMailType) || null,
          locale: cleanText(locale) || "en",
          subject: cleanText(subject) || ""
        });

        await appendStudioJournalEntry({
          area: "assembler",
          title: "Email assembled",
          message: `Assembled ${category}/mail-${mailId} with ${result.blocksWritten || 0} block(s).`,
          meta: { category, mailId, blocks: result.blocksWritten }
        });

        sendJson(response, 200, { ok: true, result });
      } catch (err) {
        sendJson(response, 500, { error: err.message });
      }
      return;
    }

    // ─── Block catalog endpoints ──────────────────────────────────────────

    if (request.method === "GET" && request.url === "/api/email-base/blocks") {
      try {
        const catalogPath = path.join(studioDataDir, "block-catalog.json");
        if (!existsSync(catalogPath)) {
          sendJson(response, 200, { items: [] });
          return;
        }
        const raw = readFileSync(catalogPath, "utf-8");
        const catalog = JSON.parse(raw);
        const { enrichCatalogWithPaths } = await import("./src/assembler.js");
        const enriched = enrichCatalogWithPaths(catalog?.items || []);
        sendJson(response, 200, { items: enriched });
      } catch (err) {
        sendJson(response, 500, { error: err.message });
      }
      return;
    }

    // ─── Email base tree (brand → mail browser) ──────────────────────────

    if (request.method === "GET" && request.url === "/api/email-base/tree") {
      try {
        const brands = listDirectoryNames(emailBaseRoot, (n) => n.startsWith("X_") && !n.startsWith("_"));
        const tree = brands.map((brand) => {
          const brandPath = path.join(emailBaseRoot, brand);
          const mails = listDirectoryNames(brandPath, (n) => n.startsWith("mail-"));
          return {
            brand,
            label: brand.replace(/^X_/, ""),
            mails: mails.map((mailId) => {
              const distPath = path.join(emailBaseRoot, brand, mailId, "dist");
              const hasBuilt = existsSync(distPath);
              // collect locales from dist subfolders (en_US, ru, etc.)
              const locales = hasBuilt
                ? listDirectoryNames(distPath).filter((l) => l !== "")
                : [];
              return { mailId, hasBuilt, locales };
            })
          };
        });
        sendJson(response, 200, { tree });
      } catch (err) {
        sendJson(response, 500, { error: err.message });
      }
      return;
    }

    // ─── Email base read (for diff view) ─────────────────────────────────

    if (request.method === "GET" && request.url.startsWith("/api/email-base/read")) {
      try {
        const params = new URL(request.url, "http://localhost").searchParams;
        const category = cleanText(params.get("category"));
        const mailId = cleanText(params.get("mailId"));
        const locale = cleanText(params.get("locale") || "index");

        if (!category || !mailId) {
          sendJson(response, 400, { error: "category and mailId are required" });
          return;
        }

        // Canonicalize mailId (may or may not have "mail-" prefix)
        const fullMailId = mailId.startsWith("mail-") ? mailId : `mail-${mailId}`;
        const distDir = path.join(emailBaseRoot, category, fullMailId, "dist");

        if (!existsSync(distDir)) {
          sendJson(response, 404, { error: "No dist for this mail", html: null });
          return;
        }

        // Try locale-specific index.html first, then root index.html
        const localeHtml = path.join(distDir, locale, "index.html");
        const rootHtml = path.join(distDir, "index.html");

        let html = null;
        let resolvedLocale = locale;
        if (existsSync(localeHtml)) {
          html = readFileSync(localeHtml, "utf-8");
        } else if (existsSync(rootHtml)) {
          html = readFileSync(rootHtml, "utf-8");
          resolvedLocale = "index";
        } else {
          // Try first available locale folder
          const localeDirs = listDirectoryNames(distDir);
          if (localeDirs.length > 0) {
            const firstLocaleHtml = path.join(distDir, localeDirs[0], "index.html");
            if (existsSync(firstLocaleHtml)) {
              html = readFileSync(firstLocaleHtml, "utf-8");
              resolvedLocale = localeDirs[0];
            }
          }
        }

        if (!html) {
          sendJson(response, 404, { error: "No built HTML found for this mail", html: null });
          return;
        }

        sendJson(response, 200, { html, locale: resolvedLocale });
      } catch (err) {
        sendJson(response, 500, { error: err.message });
      }
      return;
    }

    // ─── Email base deep context (for AI debugging) ──────────────────────

    if (request.method === "GET" && request.url === "/api/email-base/deep-context") {
      const context = buildEmailBaseDeepContext();
      sendJson(response, 200, { context });
      return;
    }

    // POST /api/email-base/scaffold — create a new system email from a template
    // Body: { category, templateMail, newMailId, localeContent?, buildAfter? }
    // Response: { mailRoot, namespace, tokenKeys, blockCount, previewHtml? }
    if (request.method === "POST" && request.url === "/api/email-base/scaffold") {
      const payload = await readJsonBody(request);
      const category = cleanText(payload?.category);
      const templateMail = cleanText(payload?.templateMail);
      const newMailId = cleanText(payload?.newMailId);

      if (!category || !templateMail || !newMailId) {
        sendJson(response, 400, { error: "Required: category, templateMail, newMailId" });
        return;
      }

      // Sanitize newMailId: lowercase, alphanumeric + hyphens only
      const safeNewMailId = newMailId.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
      if (!safeNewMailId) {
        sendJson(response, 400, { error: "newMailId must contain alphanumeric characters" });
        return;
      }

      try {
        const result = await scaffoldMail({
          category,
          templateMail,
          newMailId: safeNewMailId,
          dryRun: false,
          verbose: false,
        });

        // Optionally build the mail immediately after scaffold
        let buildLog = null;
        let builtHtml = null;
        if (payload?.buildAfter !== false) {
          try {
            const mailTemplatesRoot = path.join(emailBaseRoot, category, `mail-${safeNewMailId}`, "app", "templates");
            const locale = "en";
            await withPreferredTemplateSource(mailTemplatesRoot, () =>
              runCommand(process.execPath, ["mail", "build-pretty", category, safeNewMailId, "--locales", locale], emailBaseRoot)
            );
            const distDir = path.join(emailBaseRoot, "dist", category, `mail-${safeNewMailId}`, locale);
            const prettyPath = path.join(distDir, "index.pretty.html");
            const compactPath = path.join(distDir, "index.html");
            const htmlPath = existsSync(prettyPath) ? prettyPath : compactPath;
            builtHtml = await readFile(htmlPath, "utf8");
            buildLog = "Build completed.";
          } catch (buildErr) {
            buildLog = `Build failed: ${buildErr.message}`;
          }
        }

        // If localeContent provided, resolve tokens in builtHtml for preview
        let previewHtml = null;
        if (builtHtml && payload?.localeContent && typeof payload.localeContent === "object") {
          previewHtml = resolveTokensForPreview(builtHtml, safeNewMailId, payload.localeContent);
        } else if (builtHtml) {
          previewHtml = builtHtml;
        }

        sendJson(response, 200, {
          ...result,
          safeMailId: safeNewMailId,
          buildLog,
          previewHtml,
        });
      } catch (err) {
        sendJson(response, 400, { error: err.message });
      }
      return;
    }

    // POST /api/email-base/patch-theme — apply brand theme to a mail's styles
    // Body: { category, mailId, theme: BrandTheme, buildAfter?, save? }
    // Response: { patched[], skipped[], buildLog?, previewHtml? }
    if (request.method === "POST" && request.url === "/api/email-base/patch-theme") {
      const payload = await readJsonBody(request);
      const category = cleanText(payload?.category);
      const mailId   = cleanText(payload?.mailId);
      const rawTheme = payload?.theme;

      if (!category || !mailId || !rawTheme) {
        sendJson(response, 400, { error: "Required: category, mailId, theme" });
        return;
      }

      const theme = normalizeTheme(rawTheme);
      if (!theme) {
        sendJson(response, 400, { error: "Invalid theme object" });
        return;
      }

      try {
        const mailRoot = path.join(emailBaseRoot, category, `mail-${mailId}`);
        if (!existsSync(mailRoot)) {
          sendJson(response, 404, { error: `Mail not found: ${category}/mail-${mailId}` });
          return;
        }

        // Apply theme patches to styl/jade files
        const patchResult = await patchTheme(mailRoot, theme);

        // Save theme to data/brands/{brandId}/theme.json if requested
        let savedThemePath = null;
        if (payload?.save && theme.brandId && theme.brandId !== "unknown") {
          savedThemePath = await saveTheme(theme);
        }

        // Rebuild after patching if requested
        let buildLog = null;
        let previewHtml = null;
        if (payload?.buildAfter !== false) {
          try {
            const mailTemplatesRoot = path.join(mailRoot, "app", "templates");
            const locale = "en";
            await withPreferredTemplateSource(mailTemplatesRoot, () =>
              runCommand(process.execPath, ["mail", "build-pretty", category, mailId, "--locales", locale], emailBaseRoot)
            );
            const distDir = path.join(emailBaseRoot, "dist", category, `mail-${mailId}`, locale);
            const prettyPath = path.join(distDir, "index.pretty.html");
            const compactPath = path.join(distDir, "index.html");
            const htmlPath = existsSync(prettyPath) ? prettyPath : compactPath;
            previewHtml = await readFile(htmlPath, "utf8");
            buildLog = "Build completed.";
          } catch (buildErr) {
            buildLog = `Build failed: ${buildErr.message}`;
          }
        }

        sendJson(response, 200, {
          patched: patchResult.patched,
          skipped: patchResult.skipped,
          savedThemePath,
          buildLog,
          previewHtml
        });
      } catch (err) {
        sendJson(response, 400, { error: err.message });
      }
      return;
    }

    // POST /api/email-base/rebuild — rebuild a mail without patching styles
    // Body: { category, mailId, locale?, localeContent? }
    // Response: { previewHtml, buildLog }
    // If localeContent provided, tokens are resolved in the resulting HTML for preview.
    if (request.method === "POST" && request.url === "/api/email-base/rebuild") {
      const payload = await readJsonBody(request);
      const category = cleanText(payload?.category);
      const mailId   = cleanText(payload?.mailId);
      const locale   = cleanText(payload?.locale) || "en";
      const localeContent = payload?.localeContent && typeof payload.localeContent === "object"
        ? payload.localeContent : null;

      if (!category || !mailId) {
        sendJson(response, 400, { error: "Required: category, mailId" });
        return;
      }

      const mailRoot = path.join(emailBaseRoot, category, `mail-${mailId}`);
      if (!existsSync(mailRoot)) {
        sendJson(response, 404, { error: `Mail not found: ${category}/mail-${mailId}` });
        return;
      }

      try {
        const mailTemplatesRoot = path.join(mailRoot, "app", "templates");
        await withPreferredTemplateSource(mailTemplatesRoot, () =>
          runCommand(process.execPath, ["mail", "build-pretty", category, mailId, "--locales", locale], emailBaseRoot)
        );
        const distDir    = path.join(emailBaseRoot, "dist", category, `mail-${mailId}`, locale);
        const prettyPath = path.join(distDir, "index.pretty.html");
        const compactPath = path.join(distDir, "index.html");
        const htmlPath   = existsSync(prettyPath) ? prettyPath : compactPath;
        let previewHtml  = await readFile(htmlPath, "utf8");
        // Resolve scaffold tokens if caller provided localeContent
        if (localeContent) {
          previewHtml = resolveTokensForPreview(previewHtml, mailId, localeContent);
        }
        sendJson(response, 200, { previewHtml, buildLog: "Build completed." });
      } catch (err) {
        sendJson(response, 500, { error: err.message, buildLog: `Build failed: ${err.message}` });
      }
      return;
    }

    // GET /api/brands — list saved brand themes
    if (request.method === "GET" && request.url === "/api/brands") {
      try {
        const themes = await listThemes();
        sendJson(response, 200, { themes });
      } catch (err) {
        sendJson(response, 500, { error: err.message });
      }
      return;
    }

    // GET /api/brands/:brandId — get one brand theme
    if (request.method === "GET" && request.url.startsWith("/api/brands/")) {
      const brandId = request.url.replace("/api/brands/", "").split("?")[0];
      try {
        const theme = await readTheme(brandId);
        if (!theme) { sendJson(response, 404, { error: "Theme not found" }); return; }
        sendJson(response, 200, { theme });
      } catch (err) {
        sendJson(response, 500, { error: err.message });
      }
      return;
    }

    // ─── Batch mode endpoints ─────────────────────────────────────────────

    if (request.method === "GET" && request.url === "/api/batch/status") {
      sendJson(response, 200, {
        stats: getQueueStats(),
        jobs: listJobs({ limit: 20 })
      });
      return;
    }

    if (request.method === "GET" && request.url.startsWith("/api/batch/job/")) {
      const jobId = request.url.replace("/api/batch/job/", "").split("?")[0];
      const job = getJob(jobId);
      if (!job) { sendJson(response, 404, { error: "Job not found" }); return; }
      sendJson(response, 200, job);
      return;
    }

    if (request.method === "POST" && request.url === "/api/batch/queue") {
      const body = await readRequestBody(request);
      const tasks = Array.isArray(body?.tasks) ? body.tasks : (body ? [body] : []);

      if (tasks.length === 0) {
        sendJson(response, 400, { error: "tasks[] is required" });
        return;
      }
      if (tasks.length > 50) {
        sendJson(response, 400, { error: "Max 50 tasks per batch" });
        return;
      }

      const queued = tasks.map((task) => enqueueJob({
        type: cleanText(task?.type) || "generate-draft",
        brief: task?.brief || {},
        locale: cleanText(task?.locale) || "en",
        category: cleanText(task?.category) || "",
        mailId: cleanText(task?.mailId) || "",
        options: task?.options || {}
      }));

      await appendStudioJournalEntry({
        area: "batch",
        title: `Batch queued: ${queued.length} task(s)`,
        message: queued.map((j) => j.id).join(", ")
      });

      sendJson(response, 200, {
        ok: true,
        queued: queued.length,
        jobs: queued
      });
      return;
    }

    if (request.method === "POST" && request.url.startsWith("/api/batch/cancel/")) {
      const jobId = request.url.replace("/api/batch/cancel/", "").split("?")[0];
      const job = cancelJob(jobId);
      if (!job) { sendJson(response, 404, { error: "Job not found or not cancellable" }); return; }
      sendJson(response, 200, { ok: true, job });
      return;
    }

    if (request.method === "POST" && request.url === "/api/batch/clear") {
      const body = await readRequestBody(request);
      const result = clearJobs({ olderThanMs: Number(body?.olderThanMs) || 3_600_000 });
      sendJson(response, 200, { ok: true, ...result });
      return;
    }

    // ─── Generation History endpoints ─────────────────────────────────────

    if (request.method === "GET" && request.url.startsWith("/api/history")) {
      const params = new URL(request.url, "http://localhost").searchParams;
      const limit = Math.min(Number(params.get("limit")) || 50, 200);
      sendJson(response, 200, { items: dbHistoryList(limit) });
      return;
    }

    if (request.method === "GET" && request.url.startsWith("/api/history/")) {
      const id = request.url.replace("/api/history/", "").split("?")[0];
      const html = dbHistoryGetHtml(id);
      if (html === null) { sendJson(response, 404, { error: "Not found" }); return; }
      sendJson(response, 200, { id, html });
      return;
    }

    if (request.method === "DELETE" && request.url.startsWith("/api/history/")) {
      const id = request.url.replace("/api/history/", "").split("?")[0];
      sendJson(response, 200, dbHistoryDelete(id));
      return;
    }

    if (request.method === "POST" && request.url === "/api/history/clear") {
      dbHistoryClear();
      sendJson(response, 200, { ok: true });
      return;
    }

    if (request.method === "GET") {
      await serveStatic(request, response);
      return;
    }

    sendJson(response, 404, { error: "Not found" });
  } catch (error) {
    try {
      await appendStudioJournalEntry({
        level: "error",
        area: "server",
        title: "Server error",
        message: error instanceof Error ? error.message : "Unknown server error",
        meta: {
          method: request.method,
          url: request.url
        }
      });
    } catch {
      // Ignore secondary journal failures.
    }
    if (response.headersSent) {
      response.end();
      return;
    }
    sendJson(response, 500, {
      error: error instanceof Error ? error.message : "Unknown server error"
    });
  }
});

// ─── Startup: init DB + migrate from JSON ────────────────────────────────────
try {
  getDb(); // Initialise schema
  const migrationResult = migrateFromJson({ verbose: true });
  console.log(`[db] SQLite ready. Migration: ${JSON.stringify(migrationResult)}`);
} catch (dbError) {
  console.warn(`[db] SQLite init warning: ${dbError.message}. Falling back to JSON mode.`);
}

// ─── Startup: batch worker ───────────────────────────────────────────────────
startWorker(async (job) => {
  const { type, brief, locale, category, mailId } = job.payload;

  if (type === "generate-draft") {
    // Build a minimal payload that createOpenAiDraft understands
    const payload = {
      brief: { ...brief, locale: locale || brief?.locale || "en", category, mailId },
      currentDraft: null,
      attachedImages: []
    };
    const result = await createOpenAiDraft(payload);
    await appendStudioJournalEntry({
      area: "batch",
      title: `Batch job done: ${job.id}`,
      message: `Generated draft for ${category}/${mailId || "new"}`
    });
    return result;
  }

  throw new Error(`Unknown batch job type: ${type}`);
}, { pollMs: 800 });

console.log("[batch] Worker started");

server.listen(port, () => {
  console.log(`Email Studio Demo is running on http://localhost:${port}`);
});
