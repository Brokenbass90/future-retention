import http from "node:http";
import { timingSafeEqual } from "node:crypto";
import { tmpdir } from "node:os";
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
import { placeholderizeHtml, fixLocaleTxt, translateLocaleTxt } from "./src/locale-ai.js";
import { runAgent } from "./src/ai-agent.js";
import os from "node:os";
import * as fsLink from "node:fs";
import { composeEmailFromBlocks, listCanonicalBlocks, userBlockPath, userBlockDir } from "./src/compose-email.js";
import { responseSchema, cloneEditResponseSchema, translationResponseSchema, designAnalysisSchema } from "./src/ai-schemas.js";
import { getFigmaIntegrationContract } from "./src/figma-contract.js";
import { readEvalBenchmarkSnapshot, summarizeEvalBenchmark, findEvalBenchmarkCase, scoreEvalCase } from "./src/eval.js";
import { buildDesignDecomposition, summarizeDesignDecomposition } from "./src/design-decomposition.js";
import { buildDesignMappingHints, summarizeDesignMappingHints } from "./src/design-mapping.js";
import { buildDesignBlockRecommendations, summarizeDesignBlockRecommendations } from "./src/block-ranking.js";
import { buildLayoutModel, summarizeLayoutModel, summarizeLayoutModelMeta } from "./src/layout-model.js";
import { listScenarioFixtures, saveScenarioFixture } from "./src/scenarios.js";
import {
  registerCatalogItem,
  extractCatalogItemsFromTemplate,
  generateBlockCatalog as _generateBlockCatalog,
  summarizeBlockCatalog,
  ensureBlockCatalog as _ensureBlockCatalog,
  createOutlineSectionFromCatalogItem,
  buildCatalogOutlineForMail as _buildCatalogOutlineForMail
} from "./src/catalog.js";
import { isRtlLocale as _rtlIsRtlLocale, applyLocaleDirectionToHtml as _rtlApply, warmupRtl as _rtlWarmup } from "./src/rtl.js";
import { inferPlaceholders as _inferPlaceholders, applyPlaceholderProposals as _applyPlaceholderProposals } from "./src/placeholder-inference.js";
import { normalizeLocaleConventions as _normalizeLocaleConventions, buildAnchorUnits as _buildAnchorUnits, parseNormalizedBlocks as _parseNormalizedBlocks, alignLocaleToReference as _alignLocaleToReference, serializeAligned as _serializeAligned, localePrefix as _localePrefix } from "./src/locale-conventions.js";
import { buildPlaceholdersIndex as _buildPlaceholdersIndex, invalidatePlaceholdersIndexCache as _invalidatePlaceholdersIndexCache } from "./src/placeholders-index.js";
import { buildBlocksByMail as _buildBlocksByMail, readBlockSource as _readBlockSource } from "./src/blocks-by-mail.js";
import { classifyChatIntent as _classifyChatIntent } from "./src/chat-intents.js";
import { cleanText, dedupeStrings as _dedupeStrings, toRelativePath as _toRelativePath, dedupeCatalogSources as _dedupeCatalogSources, mergeCatalogTraits as _mergeCatalogTraits } from "./src/utils.js";
import { enqueueJob, getJob, listJobs, cancelJob, clearJobs, getQueueStats, startWorker } from "./src/batch.js";
import { resolveOpenAiModelForTask, summarizeOpenAiModelRouting } from "./src/model-routing.js";
import { buildInternalDesignSchema, summarizeDesignSchema } from "./src/design-schema.js";
import { buildComposePlanFromDesign } from "./src/design-compose.js";
import { scaffoldMail } from "./tools/scaffold-system-mail.js";
import { buildVendorMixinsReference, buildVendorMixinsCompact, buildMarkupPatternsReference } from "./src/vendor-mixins-ref.js";
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
const scenarioFixturesDir = path.join(studioDataDir, "scenarios");
const legacyToolkitSnapshotPath = path.join(studioDataDir, "imports", "legacy-retention-tool-kit.snapshot.json");

const port = Number(process.env.PORT || 3000);
const openAiApiKey = process.env.OPENAI_API_KEY || "";
const openAiModel = process.env.OPENAI_MODEL || "gpt-4.1-mini";
const deepLApiKey = process.env.DEEPL_API_KEY || "";
const deepLApiUrl = process.env.DEEPL_API_URL || "https://api-free.deepl.com";
const figmaApiToken = process.env.FIGMA_API_TOKEN || "";
const figmaImportSecret = process.env.FIGMA_IMPORT_SECRET || "";
const appAuthUser = process.env.APP_AUTH_USER || "";
const appAuthPassword = process.env.APP_AUTH_PASSWORD || "";
const appAuthEnabled = Boolean(appAuthUser && appAuthPassword);
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
  "You are an expert HTML email editor. Your ONLY job is to edit an existing HTML email.",
  "The user will give you an HTML email and tell you what to change.",
  "Do not ask clarifying questions, do not propose a plan, and do not wait for confirmation. Apply the requested edits immediately using reasonable assumptions.",

  // ── Output rules ──
  "You MUST return the complete modified HTML document in mail.modified_html.",
  "mail.modified_html MUST be the HTML for the PRIMARY locale only.",
  "If the user asks for multiple locales, also return full locale-specific HTML documents in mail.localized_html as [{ locale, html }].",
  "Do not build one bilingual HTML with lang toggles, duplicated blocks, or CSS locale switching. Return separate full HTML documents per locale instead.",
  "Never put the same language into all locale variants. Each localized_html entry must match its own locale.",
  "NEVER use the email-base block catalog. NEVER generate mail.sections[] entries. Set mail.sections to [].",
  "Do not invent RetKit ${{ namespace.block_NN }}$ placeholders unless the user explicitly asks to place placeholders. If they do, keep the complete HTML and replace only the requested visible text nodes with real RetKit placeholder tokens; never emulate placeholders with CSS classes or :before content.",

  // ── Editing philosophy ──
  "Default rule: make the smallest possible diff to the source HTML.",
  "CRITICAL: NEVER delete or replace the entire email body. NEVER output a placeholder, stub, or skeleton in place of existing content. If you cannot edit something, leave it exactly as-is.",
  "CRITICAL: Your output in mail.modified_html MUST be the full original HTML with only the requested changes applied. If the original email has a header, body blocks, footer — they ALL must appear in the output.",
  "CRITICAL: Never return an empty <body>, a CSS-only placeholder implementation, or a head-only document. The output must keep the original body content unless the user specifically asks to delete a particular block.",
  "Preserve all table layouts, inline CSS, image URLs, HTML comments, service tags, and template variables like {%brand_color%} and {{embedded.*}} unless the requested change requires touching them.",
  "Do not rewrite or reformat the whole email when only a local edit was requested.",
  "Only change content the user explicitly asks to change (text, links, subject, images, branding).",

  // ── Step-by-step reasoning for structural changes (move, reorder, layout) ──
  "When asked to MOVE or REORDER an element (e.g. 'move button under image', 'put CTA above text'):",
  "  STEP 1: Identify the exact HTML block containing the element to move (look at the element inventory in context).",
  "  STEP 2: Identify the exact target location in the HTML (the element it should appear after/before).",
  "  STEP 3: Copy the element's complete HTML (including wrapper <tr>/<td> if it's a table-based email).",
  "  STEP 4: Insert it at the target location with appropriate spacing.",
  "  STEP 5: Delete the original copy from its old position. Do NOT leave duplicates.",
  "  STEP 6: Add spacing rows/padding between the moved element and its new neighbors (20-32px safe default).",
  "Email HTML is almost always table-based. When moving elements, move the ENTIRE <tr> row, not just the inner content.",

  // ── Translation rules ──
  "If the user asks to translate the email, translate all visible copy but preserve structure, links, placeholders, and image URLs unless the user asks otherwise.",
  "When translating to Russian, keep text length reasonably close to the original where possible so the layout stays stable.",
  "When producing RU locale: translate subject, preheader, all body copy, and CTA button labels. Do NOT translate: href links, image src URLs, HTML class names, style values, template tokens.",

  // ── Other edit rules ──
  "If the user asks to adapt the email to another brand, preserve structure first and only update logo, brand-facing copy, obvious color tokens, and brand references that the user requested.",
  "Update mail.subject and mail.preheader with the new values for each locale.",
  "When the user asks for spacing changes, apply them in the HTML/CSS itself — do not only mention them in assistant_reply.",
  "When a layout change is requested, keep the result visually production-ready by default: preserve alignment, spacing rhythm, and visual hierarchy.",
  "Prefer reusing the email's existing spacing system. If no clear spacing system exists, use conservative email-safe spacing (roughly 20-32px vertical separation).",
  "Do not leave elements glued together after a move. If needed, add or adjust wrapper rows, padding, or inline margins in an email-safe way.",
  "Preserve responsive behavior: spacing changes must not break the mobile layout.",
  "Keep all href values unchanged unless the user explicitly asks to change links.",
  "Keep the HTML valid and complete — the full <html>...</html> document, not a snippet.",
  "Write assistant_reply in the user's language (Russian if the user writes in Russian). Max 2 sentences describing what was changed.",
].join(" ");

// Pug source editing mode: AI edits Pug/Stylus source files like a developer
const pugSourceEditSystemPrompt = [
  "You are a professional Pug email template developer working inside RetKit Email Studio.",
  "The user will show you one or more Pug/Stylus source files and ask you to make changes.",
  "Your job: apply the requested change directly to the code like an experienced email developer — no HTML, no explanations first, just do it.",

  // Output rules
  "ALWAYS return each changed file as a fenced code block: ```pug ... ``` for Pug/Jade files, ```styl ... ``` for Stylus files.",
  "The FIRST line inside every fenced block MUST be a path marker using the exact SOURCE FILES path, e.g. // file: templates/blocks/header.pug or // file: styles/blocks/main.styl.",
  "Return the COMPLETE content of every changed file, not a diff and not only the changed fragment.",
  "If one request changes both markup and styles, return two fenced blocks with two file markers.",
  "Do NOT return compiled HTML. Do NOT use mail.modified_html. Do NOT output raw table HTML.",
  "Set mail.sections to []. Set mail.modified_html to ''.",

  // Studio conventions
  "Use vendor mixin calls from vendor/helpers/mixins.pug: +vml-bg(), +top_img_100(), +col3_icon_text(), +general-btn(), +cta-two-column-table().",
  "Use studio CSS classes: .white-title, .middle-title, .fat-text, .text, .butt, .butt-link, .color-bg, .white-bg, .wrapper, .last, .offset-by-one, .ten.columns, .twelve.columns, .text-pad-small, .pb16, .pb24, .pb32, .pt24, .pt44, .center, .row.",
  "All links: a(href='...' target='_blank' universal='true'). Never inline style text colors or font families.",
  "Text content should use translation tokens: ${{ mail-id.block_N }}$ — keep existing tokens when they appear in the source.",
  "Use 4-space indentation throughout. Never use tabs.",
  "Do not add footer or preheader — those are auto-included via helpers/.",

  // Editing philosophy
  "CRITICAL: NEVER delete or replace existing content wholesale. NEVER output a stub, placeholder, or skeleton. Return the full file with only the requested change applied.",
  "Make the smallest possible change to achieve the user's goal. Preserve all existing structure, mixin calls, class names, and tokens unless the user explicitly asks to change them.",
  "When adding a new block, insert it at a logical position relative to existing blocks.",
  "When the user asks to change text in a Pug file that uses ${{ token }}$ placeholders, update the token key or add a note that the translation file must also be updated.",

  "Write assistant_reply in the user's language (Russian if the user writes in Russian). Max 2 sentences describing what was changed.",
].join(" ");

// HTML→Pug conversion mode: rewrite a finished HTML email as studio Pug
const htmlToPugSystemPrompt = [
  "You are an email code converter for a Pug/Jade email production studio.",
  "Your ONLY job: rewrite the given HTML email into studio-style Pug template code.",
  "Output the converted Pug code in mail.pug_blocks as an array of { label, pug_code } entries.",
  "Output a human-readable description of what you did in mail.summary (max 2 sentences, in the user's language).",
  "Set mail.subject and mail.preheader from the HTML content.",
  "Set mail.sections to [] — no section JSON needed.",
  "Set mail.modified_html to '' — this is not clone-edit mode.",
  "CONVERSION RULES:",
  "1. Use 4-space indentation throughout.",
  "2. Replace raw table HTML with vendor mixin calls where applicable: +vml-bg, +top_img_100, +col3_icon_text, +general-btn, +cta-two-column-table, +cta-switch-table, +person.",
  "3. Use studio CSS classes instead of inline styles: .white-title, .middle-title, .fat-text, .white-text, .text-2, .gray-text, .text, .butt, .butt-link, .brad-full, .color-bg, .white-bg, .wrapper, .last, .offset-by-one, .ten.columns, .twelve.columns, .text-pad-small, .pb16, .pb24, .pb32, .pb44, .pt24, .pt44, etc.",
  "4. All links MUST have universal='true' attribute: a(href='...' target='_blank' universal='true')",
  "5. Replace visible text content with translation tokens: ${{ mail-id.block_01 }}$ — use a sensible mail-id derived from the email subject.",
  "6. Preserve all image URLs exactly as they appear in the HTML.",
  "7. Preserve tracking parameters in links (UTM params, aff=, afftrack= etc).",
  "8. Split the email into logical labeled blocks for pug_blocks, e.g. label='logo', label='hero', label='intro', label='cta', label='stores', label='social'.",
  "9. Do NOT include footer content (legal text, unsubscribe) — this is auto-included via helpers/footer in the template.",
  "10. Do NOT output the full index.pug structure — only the content blocks that go inside blocks/header.pug.",
  "Write assistant_reply in the user's language. Max 2 sentences summarizing what was converted.",
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

  // Block assembly rules — Pug mixins
  "When assembling a new email, ALWAYS write real Pug code in the pug_blocks field using the vendor mixins.",
  "The vendor mixin library (vendor/helpers/mixins.pug) is always available. Use +mixin_name(...) calls — do NOT write raw table HTML.",
  "Key mixins to know:",
  "  +vml-bg(imageUrl, bgColor, width, height) — hero with background image, VML for Outlook. REQUIRED when design has bg image behind text.",
  "  +col3_icon_text(img1,title1,text1, img2,title2,text2, img3,title3,text3) — 3-column icon+title+text feature grid.",
  "  +general-btn(fontSize,lineH,bgColor,textColor,fontW,border,borderR,link,text,class) — custom CTA button with explicit brand colors.",
  "  +cta-two-column-table(leftHref,leftText,rightHref,rightText) — two side-by-side CTA buttons.",
  "  +top_img_100(src,link,addClass) — full-width clickable image.",
  "  +person(photo,name,position,link) — expert/analyst card.",
  "A typical email pug_blocks structure: logo row → vml-bg hero → col3_icon_text features → general-btn CTA → store badges → footer.",
  "CSS utility classes available: .white-title (h1, bold, white), .middle-title (h2, white), .fat-text (bold subtitle), .white-text / .text-2 (body, white), .gray-text (secondary body), .butt (default orange button), .butt-link (button link text), .brad-full (32px radius card), .color-bg (#101314 dark bg), .pb16/.pb24/.pb32/.pt24/.pt40 etc (spacing utilities), .plr30/.plr50 (horizontal padding).",
  "IMPORTANT: always populate mail.pug_blocks alongside mail.sections. pug_blocks is the production output; sections is the preview.",

  // Studio typography constants — do NOT guess or invent these
  "The studio has fixed typography defaults that apply to ALL emails unless the brand_theme explicitly overrides them:",
  "  font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif — ALWAYS use this stack, never invent another font.",
  "  body text: 18px / 28px line-height (fat-text / white-text / gray-text classes).",
  "  headings (h1 / white-title): 28–36px bold.",
  "  subheadings (middle-title): 22–24px.",
  "  footer / legal text: 12–14px.",
  "  These are studio constants — never output a different font-family in pug_blocks or sections.",

  // Design input rules
  "When a current draft or current email-base mail exists, preserve that structure before inventing a new one.",
  "When a design reference is attached, align the section ordering and image use to that reference as closely as possible.",
  "Treat a Figma link as a normal design input. If the frame's JSON structure is provided, use layer names and text content directly.",
  "If access to Figma frame is unclear, ask for an open draft/share link or a screenshot/export. Do not invent a layout.",
  "If the user says to leave copy empty for now, accept that — leave strings empty and keep moving.",

  // Figma → Email assembly rules
  "When Figma structured data is available (figmaImport or figmaEnrichment in context):",
  "  1. Use the actual text content from Figma layers as copy — do not invent text.",
  "  2. Use the actual image export URLs from Figma as image src — do not use placeholders.",
  "  3. Map each Figma frame/group to a block kind: top banner → hero, text group → text, button-only section → cta, icon grid → feature-list, bottom row → footer.",
  "  4. Extract colors from the Figma design and put them in mail.brand_theme.",
  "  5. If Figma layer names contain email structure hints (e.g. 'hero', 'cta', 'footer'), use them.",
  "When assembling from a screenshot or design reference:",
  "  1. Reconstruct EVERY visible section — do not skip any block even if it has no copy yet.",
  "  2. Use the design's actual color values in +general-btn and brand_theme — never use generic colors.",
  "  3. Match the visual hierarchy: if the design has a large hero image, use +vml-bg or +top_img_100.",
  "  4. If 3 feature items are visible, use +col3_icon_text. If 2 items, use +cta-two-column-table.",
  "  5. Preserve exact button label text as seen in the design. Preserve exact headline/body copy.",

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

const localeAuditSystemPrompt = [
  "You are a translation QA editor inside an email production studio.",
  "Reply in the user's language, usually Russian. Be precise, practical, and cite exact namespace, locale, block_NN, or raw line when available.",
  "The user provides locale TXT files. Each translation block should be wrapped as {{...}}. Bold/emphasis markers are @@...@@ inside a block.",
  "An empty {{}} block is a real block and must remain an empty string at the same index; never drop it or renumber later blocks.",
  "When converting emphasis to HTML, use <b>...</b>, not <strong>...</strong> and not Markdown **...**.",
  "Audit tasks: find unclosed {{ }}, extra braces, text outside blocks, empty blocks, block-count mismatches versus the reference English locale, shifted URLs, HTML tags, placeholders, numbers, and @@ markers.",
  "Also flag obviously wrong-language or semantically suspicious translations, but do not invent accusations without evidence from the provided source and target text.",
  "For audit-only requests, do not rewrite all locales. Return a short structured report: severity, location, problem, suggested fix.",
  "For fix requests, return full corrected locale TXT documents in fenced blocks. The first line of each fence must be exactly '# locale: namespace/code'. Example: ```txt\\n# locale: welcome/en\\n{{Text}}\\n```",
  "When fixing, preserve block order and count, preserve empty blocks, URLs, HTML tags, placeholders, numbers, legal copy, brand/product names, and intentional @@ emphasis unless the syntax is broken.",
  "Do not create unrelated marketing copy, do not merge blocks, and do not translate from a non-reference locale unless the user explicitly asks."
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
    deepLApiUrl,
    appAuthEnabled,
    persistenceMode: process.env.DYNO ? "ephemeral-heroku-filesystem" : "local-filesystem"
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
    readinessEndpoint: "/api/figma/readiness",
    contractEndpoint: "/api/figma/contract",
    pluginImportSecretRequired: Boolean(figmaImportSecret),
    accessModes: [
      {
        id: "plugin-push",
        label: "Send to Studio plugin",
        ready: true,
        description: "Best private-Figma flow. Sends sections, texts, image nodes, and design tokens."
      },
      {
        id: "server-token-link-import",
        label: "Server token link import",
        ready: Boolean(figmaApiToken),
        description: "Works when the server has FIGMA_API_TOKEN and the linked frame is accessible to that token."
      },
      {
        id: "shared-intake-link",
        label: "Shared intake file link",
        ready: true,
        description: "Temporary bridge for private teams: duplicate the frame into a separate intake file and share only that file/frame."
      },
      {
        id: "screenshot-fallback",
        label: "Screenshot fallback",
        ready: true,
        description: "Fallback only. Good for simple/system letters, but loses layers and structure."
      }
    ],
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

function summarizeNormalizedFigmaImportCoverage(figmaImport) {
  const normalized = normalizeFigmaImportPayload(figmaImport);
  if (!hasDetailedFigmaImportPayload(normalized)) {
    return {
      available: false,
      sectionCount: 0,
      textCount: 0,
      imageCount: 0,
      previewAvailable: false,
      styleSignalCount: 0,
      sectionRoles: [],
      imageRoles: []
    };
  }

  const sections = Array.isArray(normalized.sections) ? normalized.sections : [];
  const texts = Array.isArray(normalized.texts) ? normalized.texts : [];
  const images = Array.isArray(normalized.images) ? normalized.images : [];
  const styleSource = normalized.styles && typeof normalized.styles === "object"
    ? normalized.styles
    : normalized.tokens && typeof normalized.tokens === "object"
      ? normalized.tokens
      : {};
  const styleSignalCount = Object.values(styleSource).filter((value) => cleanText(String(value))).length;

  return {
    available: true,
    sectionCount: sections.length,
    textCount: texts.length,
    imageCount: images.length,
    previewAvailable: Boolean(cleanText(normalized?.previewImage?.url) || cleanText(normalized?.previewImage?.dataUrl)),
    styleSignalCount,
    sectionRoles: normalizeShortTextList(sections.map((section) => cleanText(section?.role)), 12, 40),
    imageRoles: normalizeShortTextList(images.map((image) => cleanText(image?.roleHint)), 12, 40)
  };
}

function buildFigmaIntakeSummary({ figmaImport = null, readiness = null, importMethod = "", hasLink = false, hasVisual = false } = {}) {
  const coverage = summarizeNormalizedFigmaImportCoverage(figmaImport);
  const parts = [
    hasLink ? "link" : "",
    hasVisual ? "visual" : "",
    coverage.available ? `${coverage.sectionCount} section(s)` : "",
    coverage.available ? `${coverage.textCount} text node(s)` : "",
    coverage.available ? `${coverage.imageCount} image slot(s)` : "",
    coverage.previewAvailable ? "preview-ready" : "",
    cleanText(importMethod),
    cleanText(readiness?.preferredPath)
  ].filter(Boolean);

  return {
    importMethod: cleanText(importMethod),
    coverage,
    text: parts.length > 0 ? parts.join(" | ") : "No structured Figma intake yet."
  };
}

function assessFigmaIntakeReadiness(figmaUrl, options = {}) {
  const url = cleanText(figmaUrl);
  const hasStructured = Boolean(options?.hasStructured);
  const hasVisual = Boolean(options?.hasVisual);
  const parsed = parseFigmaReferenceUrl(url);
  const hasLink = Boolean(url && /figma\.com/i.test(url));
  const hasFileKey = Boolean(cleanText(parsed?.fileKey));
  const hasNodeId = Boolean(cleanText(parsed?.nodeId));
  const serverTokenReady = Boolean(figmaApiToken);

  let preferredPath = "";
  let readiness = "missing-input";
  let canImportStructuredNow = false;

  if (hasStructured) {
    preferredPath = "plugin-push";
    readiness = "ready-now";
    canImportStructuredNow = true;
  } else if (hasLink && serverTokenReady && hasFileKey && hasNodeId) {
    preferredPath = "server-token-link-import";
    readiness = "ready-now";
    canImportStructuredNow = true;
  } else if (hasLink && hasFileKey && hasNodeId) {
    preferredPath = "shared-intake-link";
    readiness = "needs-shared-intake";
  } else if (hasLink && hasFileKey) {
    preferredPath = "shared-intake-link";
    readiness = "needs-frame-link";
  } else if (hasVisual) {
    preferredPath = "screenshot-fallback";
    readiness = "fallback-only";
  }

  const nextSteps = [];
  if (!hasLink && !hasVisual && !hasStructured) {
    nextSteps.push("Attach a frame link, structured plugin payload, or screenshot/export.");
  }
  if (hasLink && !hasNodeId) {
    nextSteps.push("Use Copy link to selection on the exact email frame so the link includes node-id.");
  }
  if (hasLink && !hasStructured && !serverTokenReady) {
    nextSteps.push("For private Figma, duplicate the frame into a separate intake file and share only that file/frame, or use future Send to Studio.");
  }
  if ((hasLink || hasStructured) && !hasVisual) {
    nextSteps.push("Attach screenshot/export too if you want pixel-level preview while plugin/server-token import is not fully in place.");
  }
  if (serverTokenReady && hasLink && hasFileKey && hasNodeId && !hasStructured) {
    nextSteps.push("This frame link is compatible with server-side Figma import if the token account has access to the file.");
  }
  if (hasStructured) {
    nextSteps.push("Structured Figma payload is already enough for section/image/text decomposition.");
  }

  return {
    url,
    hasLink,
    hasFileKey,
    hasNodeId,
    hasVisual,
    hasStructured,
    serverTokenReady,
    preferredPath: preferredPath || "unknown",
    readiness,
    canImportStructuredNow,
    nextSteps: Array.from(new Set(nextSteps)),
    parsedReference: parsed || null
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

function parseSipsDimensions(output) {
  const width = Number((cleanText(output).match(/pixelWidth:\s*(\d+)/i) || [])[1]) || 0;
  const height = Number((cleanText(output).match(/pixelHeight:\s*(\d+)/i) || [])[1]) || 0;
  return { width, height };
}

function normalizeOcrLine(line) {
  return cleanText(line)
    .replace(/[|]+/g, "I")
    .replace(/\s+/g, " ")
    .replace(/[<>]{2,}/g, "")
    .trim();
}

function normalizeOcrLines(rawText) {
  return cleanText(rawText)
    .split(/\r?\n+/)
    .map(normalizeOcrLine)
    .filter((line, index, collection) => {
      if (!line || line.length < 2) {
        return false;
      }
      if (/^[^A-Za-zА-Яа-я0-9]+$/.test(line)) {
        return false;
      }
      return collection.indexOf(line) === index;
    });
}

function isMostlyUppercaseLike(line) {
  const letters = cleanText(line).match(/[A-Za-zА-Яа-я]/g) || [];
  if (letters.length === 0) {
    return false;
  }

  const uppercaseLetters = letters.filter((letter) => letter === letter.toUpperCase()).length;
  return uppercaseLetters / letters.length >= 0.8;
}

function isLikelyBrandOcrLine(line) {
  const normalized = cleanText(line);
  if (!normalized) {
    return false;
  }

  if (
    normalized.split(/\s+/).length <= 3
    && normalized.length <= 24
    && !/[.!?]/.test(normalized)
    && isMostlyUppercaseLike(normalized)
    && !/(?:set|reset|open|continue|leave|review|trade|download|activate|verify|join|start|get|read|learn|buy|sell)\b/i.test(normalized)
  ) {
    return true;
  }

  return normalized.split(/\s+/).length <= 4
    && normalized.length <= 28
    && !/[.!?]/.test(normalized)
    && /(iq option|quadcode|exnova|affstore|casa|broker)/i.test(normalized);
}

function isLikelyFooterOcrLine(line) {
  return /(unsubscribe|terms|conditions|support@|risk warning|your capital|google play|app store|youtube|instagram|facebook|telegram|ignore this email|if you're having trouble|if you are having trouble|company_address|risk_warning|\{\{embedded\.)/i.test(cleanText(line));
}

function isLikelyCtaOcrLine(line) {
  const normalized = cleanText(line);
  if (!normalized || normalized.length > 40) {
    return false;
  }

  if (isLikelyFooterOcrLine(normalized)) {
    return false;
  }

  if (/\b(?:if|support|unsubscribe|terms|conditions|ignore)\b/i.test(normalized)) {
    return false;
  }

  return /(?:set|reset|open|continue|leave|review|trade|download|activate|verify|join|start|get|read|learn|buy|sell)\b/i.test(normalized)
    || (
      isMostlyUppercaseLike(normalized)
      && normalized.split(/\s+/).length >= 2
      && normalized.split(/\s+/).length <= 4
      && normalized.length <= 28
    );
}

function scoreScreenshotTitleCandidate(line) {
  const normalized = cleanText(line);
  if (!normalized) {
    return -100;
  }

  let score = 0;
  const wordCount = normalized.split(/\s+/).filter(Boolean).length;

  if (/\{\{|\}\}|https?:\/\/|support@|@/i.test(normalized)) {
    score -= 5;
  }
  if (isLikelyFooterOcrLine(normalized)) {
    score -= 6;
  }
  if (isLikelyCtaOcrLine(normalized)) {
    score -= 2;
  }
  if (/^(please|if|we('|’)ve|we have|thank|by |to )\b/i.test(normalized)) {
    score -= 3;
  }
  if (/[.!?]$/.test(normalized)) {
    score -= 2;
  }

  if (normalized.length >= 12 && normalized.length <= 72) {
    score += 2;
  }
  if (wordCount >= 2 && wordCount <= 8) {
    score += 2;
  }
  if (!/[.:;]$/.test(normalized)) {
    score += 1;
  }
  if (!/\{\{|\}\}/.test(normalized) && !/@/.test(normalized)) {
    score += 1;
  }
  if (/(set|reset|password|verify|verification|confirm|welcome|account|security|review|activate|new)\b/i.test(normalized)) {
    score += 5;
  }
  if (!isMostlyUppercaseLike(normalized) && /[A-Z][a-z]/.test(normalized)) {
    score += 1;
  }

  return score;
}

function looksLikeSystemNoticeOcrSequence(lines = []) {
  const signal = (Array.isArray(lines) ? lines : [])
    .map(cleanText)
    .filter(Boolean)
    .join(" ");
  return /(copy trading|paused|pause|suspend|suspended|suspension|reason for interruption|insufficient balance|support team|temporarily suspended)/i.test(signal);
}

function buildSystemNoticeOcrSummary(lines = [], dimensions = {}, layout = null, rawText = "") {
  const normalizedLines = (Array.isArray(lines) ? lines : [])
    .map(cleanText)
    .filter(Boolean);
  if (normalizedLines.length === 0 || !looksLikeSystemNoticeOcrSequence(normalizedLines)) {
    return null;
  }

  const footerBoundary = normalizedLines.findIndex((line) => (
    /\{\{embedded\.company_address\}\}|\{\{embedded\.risk_warning\}\}|company_address|risk_warning|terms and conditions|unsubscribe/i.test(line)
  ));
  const contentLines = footerBoundary >= 0 ? normalizedLines.slice(0, footerBoundary) : normalizedLines.slice();
  if (contentLines.length === 0) {
    return null;
  }

  let cursor = 0;
  const brandParts = [];
  while (cursor < contentLines.length) {
    const line = contentLines[cursor];
    if (/^notice$/i.test(line)) {
      cursor += 1;
      continue;
    }
    if (
      isLikelyBrandOcrLine(line)
      || /iq option/i.test(line)
      || (/\bnotice\b/i.test(line) && /iq option/i.test(line))
    ) {
      brandParts.push(line.replace(/\bnotice\b/ig, "").trim());
      cursor += 1;
      continue;
    }
    break;
  }

  const brandLine = cleanText(brandParts.find((line) => /iq option/i.test(line)) || brandParts[0]);

  const titleLines = [];
  while (cursor < contentLines.length) {
    const line = contentLines[cursor];
    if (/^(dear|hello|hi)\b/i.test(line)) {
      break;
    }
    if (
      /^(we would like|this measure|if you believe|reason for interruption|insufficient balance|check your trades|terms and conditions|\{\{embedded\.)/i.test(line)
      || /^notice$/i.test(line)
    ) {
      break;
    }
    if (line.length > 3) {
      titleLines.push(line);
    }
    cursor += 1;
    if (titleLines.length >= 3) {
      break;
    }
  }

  let greeting = "";
  if (cursor < contentLines.length && /^(dear|hello|hi)\b/i.test(contentLines[cursor])) {
    greeting = cleanText(contentLines[cursor]);
    cursor += 1;
  }

  const introLines = [];
  while (cursor < contentLines.length) {
    const line = contentLines[cursor];
    if (
      /^reason for interruption:?$/i.test(line)
      || /^insufficient balance/i.test(line)
      || /^check your trades$/i.test(line)
      || /^this measure\b/i.test(line)
      || /^if you believe\b/i.test(line)
      || /^we appreciate\b/i.test(line)
      || isLikelyCtaOcrLine(line)
    ) {
      break;
    }
    introLines.push(line);
    cursor += 1;
  }

  const reasonLineIndex = contentLines.findIndex((line) => /^reason for interruption:?$/i.test(line));
  const warningBody = cleanText(
    reasonLineIndex >= 0
      ? contentLines.slice(reasonLineIndex + 1).find((line) => (
        line
        && !/^check your trades$/i.test(line)
        && !/^this measure\b/i.test(line)
        && !/^if you believe\b/i.test(line)
        && !/^we appreciate\b/i.test(line)
        && !isLikelyFooterOcrLine(line)
      ))
      : contentLines.find((line) => /^insufficient balance/i.test(line))
  );

  const ctaLabel = cleanText(
    contentLines.find((line) => /^check your trades$/i.test(line))
    || contentLines.find((line) => isLikelyCtaOcrLine(line))
  );

  const supportStart = contentLines.findIndex((line) => /^this measure\b/i.test(line) || /^if you believe\b/i.test(line));
  const closingIndex = contentLines.findIndex((line) => /^we appreciate\b/i.test(line));
  const supportLines = supportStart >= 0
    ? contentLines
      .slice(supportStart, closingIndex >= 0 ? closingIndex : contentLines.length)
      .filter((line) => (
        line
        && !/^reason for interruption:?$/i.test(line)
        && !/^insufficient balance/i.test(line)
        && !/^check your trades$/i.test(line)
        && !isLikelyFooterOcrLine(line)
      ))
    : [];

  const title = cleanText(titleLines.join(" "));
  const introBody = cleanText(introLines.join(" "));
  const supportBody = cleanText(supportLines.join(" "));
  const footerBody = cleanText(closingIndex >= 0 ? contentLines[closingIndex] : "");

  return {
    source: "local-tesseract-system-notice",
    rawText: cleanText(rawText),
    lines: normalizedLines,
    brandLine,
    title,
    ctaLead: "",
    ctaLabel,
    brandWidthRatio: Number(layout?.brandWidthRatio) || 0,
    brandTopRatio: Number(layout?.brandTopRatio) || 0,
    titleWidthRatio: Number(layout?.titleWidthRatio) || 0,
    titleTopRatio: Number(layout?.titleTopRatio) || 0,
    titleHeightRatio: Number(layout?.titleHeightRatio) || 0,
    ctaWidthRatio: Number(layout?.ctaWidthRatio) || 0,
    ctaTopRatio: Number(layout?.ctaTopRatio) || 0,
    ctaCenterOffset: Number(layout?.ctaCenterOffset) || 0,
    bodyBlocks: [greeting, introBody].filter(Boolean),
    warningBody,
    supportBody,
    footerBody,
    layoutStyle: "centered-transactional-card",
    width: Number(dimensions.width) || 0,
    height: Number(dimensions.height) || 0,
    usable: Boolean(title || introBody || warningBody)
  };
}

function parseTesseractTsvLineRecords(rawTsv, dimensions = {}) {
  const rows = cleanText(rawTsv) ? rawTsv.split(/\r?\n/) : [];
  if (rows.length <= 1) {
    return [];
  }

  const width = Number(dimensions?.width) || 0;
  const height = Number(dimensions?.height) || 0;
  const lineMap = new Map();

  for (const row of rows.slice(1)) {
    const columns = row.split("\t");
    if (columns.length < 12 || Number(columns[0]) !== 5) {
      continue;
    }

    const text = cleanText(columns.slice(11).join("\t"));
    if (!text) {
      continue;
    }

    const key = `${columns[1]}:${columns[2]}:${columns[3]}:${columns[4]}`;
    const left = Number(columns[6]) || 0;
    const top = Number(columns[7]) || 0;
    const wordWidth = Number(columns[8]) || 0;
    const wordHeight = Number(columns[9]) || 0;
    const conf = Number(columns[10]) || 0;
    const right = left + wordWidth;
    const bottom = top + wordHeight;
    const current = lineMap.get(key) || {
      left,
      top,
      right,
      bottom,
      words: [],
      confTotal: 0,
      confCount: 0
    };

    current.left = Math.min(current.left, left);
    current.top = Math.min(current.top, top);
    current.right = Math.max(current.right, right);
    current.bottom = Math.max(current.bottom, bottom);
    current.words.push(text);

    if (Number.isFinite(conf) && conf >= 0) {
      current.confTotal += conf;
      current.confCount += 1;
    }

    lineMap.set(key, current);
  }

  return Array.from(lineMap.values())
    .map((entry) => {
      const text = cleanText(entry.words.join(" ").replace(/\s+([,.;:!?~>])/g, "$1"));
      const lineWidth = Math.max(0, entry.right - entry.left);
      const lineHeight = Math.max(0, entry.bottom - entry.top);
      const centerX = entry.left + lineWidth / 2;

      return {
        text,
        left: entry.left,
        top: entry.top,
        width: lineWidth,
        height: lineHeight,
        conf: entry.confCount > 0 ? entry.confTotal / entry.confCount : 0,
        wordCount: text.split(/\s+/).filter(Boolean).length,
        centerX,
        topRatio: height > 0 ? entry.top / height : 0,
        widthRatio: width > 0 ? lineWidth / width : 0,
        centerOffset: width > 0 ? Math.abs(centerX / width - 0.5) : 1
      };
    })
    .filter((entry) => entry.text)
    .sort((left, right) => left.top - right.top || left.left - right.left);
}

function inferScreenshotLayoutFromTesseractTsv(rawTsv, dimensions = {}) {
  const lines = parseTesseractTsvLineRecords(rawTsv, dimensions);
  if (lines.length === 0) {
    return null;
  }
  const canvasHeight = Number(dimensions.height) || 0;

  const brandCandidate = lines.find((line) => (
    line.topRatio <= 0.18
    && line.centerOffset <= 0.14
    && line.wordCount <= 4
    && line.widthRatio <= 0.46
  )) || null;

  const titleCandidate = lines
    .filter((line) => (
      line !== brandCandidate
      && line.topRatio <= 0.44
      && scoreScreenshotTitleCandidate(line.text) > 0
      && !isLikelyFooterOcrLine(line.text)
    ))
    .sort((left, right) => {
      const leftScore = scoreScreenshotTitleCandidate(left.text)
        + Math.min(left.height, 90) / 8
        + (left.centerOffset <= 0.18 ? 2 : 0)
        + (left.widthRatio >= 0.28 ? 1 : 0)
        - left.topRatio * 5;
      const rightScore = scoreScreenshotTitleCandidate(right.text)
        + Math.min(right.height, 90) / 8
        + (right.centerOffset <= 0.18 ? 2 : 0)
        + (right.widthRatio >= 0.28 ? 1 : 0)
        - right.topRatio * 5;
      return rightScore - leftScore;
    })[0] || null;

  const ctaCandidate = lines
    .filter((line) => line !== brandCandidate && line !== titleCandidate && isLikelyCtaOcrLine(line.text))
    .sort((left, right) => {
      const leftScore = (left.centerOffset <= 0.18 ? 4 : 0)
        + (left.topRatio >= 0.42 && left.topRatio <= 0.74 ? 4 : 0)
        + (left.wordCount <= 4 ? 2 : 0)
        + (isMostlyUppercaseLike(left.text) ? 2 : 0)
        - Math.abs(left.topRatio - 0.58) * 6;
      const rightScore = (right.centerOffset <= 0.18 ? 4 : 0)
        + (right.topRatio >= 0.42 && right.topRatio <= 0.74 ? 4 : 0)
        + (right.wordCount <= 4 ? 2 : 0)
        + (isMostlyUppercaseLike(right.text) ? 2 : 0)
        - Math.abs(right.topRatio - 0.58) * 6;
      return rightScore - leftScore;
    })[0] || null;

  const ctaLeadCandidate = lines
    .filter((line) => (
      line !== brandCandidate
      && line !== titleCandidate
      && line !== ctaCandidate
      && /(click the button|tap the button|button below|follow the link|below to|verify your email|set your new password)/i.test(line.text)
    ))
    .sort((left, right) => {
      const targetTop = ctaCandidate?.top || 0;
      return Math.abs(left.top - targetTop) - Math.abs(right.top - targetTop);
    })[0] || null;

  const lowerLines = lines.filter((line) => line.topRatio >= 0.62 || isLikelyFooterOcrLine(line.text));
  const warningLines = lowerLines.filter((line) => (
    looksLikeAffPasswordResetWarning(line.text)
    || /(didn.?t request|ignore this email|you can safely ignore|if this wasn.?t you|no action is needed)/i.test(line.text)
  ));
  const supportLines = lowerLines.filter((line) => (
    !warningLines.includes(line)
    && (
      looksLikeAffPasswordResetSupport(line.text)
      || /(support@|contact us|contact support|need help|questions\?|having trouble|trouble signing in)/i.test(line.text)
    )
  ));
  const footerLines = lowerLines.filter((line) => (
    !warningLines.includes(line)
    && !supportLines.includes(line)
    && /(terms|unsubscribe|conditions|legal|risk warning|company address|privacy)/i.test(line.text)
  ));

  return {
    lines,
    brandLine: cleanText(brandCandidate?.text),
    title: cleanText(titleCandidate?.text),
    ctaLead: cleanText(ctaLeadCandidate?.text),
    ctaLabel: cleanText(ctaCandidate?.text).replace(/\s*[~→>\-]+$/, "").trim(),
    brandWidthRatio: Number(brandCandidate?.widthRatio) || 0,
    brandTopRatio: Number(brandCandidate?.topRatio) || 0,
    titleWidthRatio: Number(titleCandidate?.widthRatio) || 0,
    titleTopRatio: Number(titleCandidate?.topRatio) || 0,
    titleHeightRatio: canvasHeight > 0 && Number.isFinite(titleCandidate?.height)
      ? Number(titleCandidate.height) / canvasHeight
      : 0,
    ctaWidthRatio: Number(ctaCandidate?.widthRatio) || 0,
    ctaTopRatio: Number(ctaCandidate?.topRatio) || 0,
    ctaCenterOffset: Number(ctaCandidate?.centerOffset) || 0,
    warningBody: cleanText(warningLines.map((line) => line.text).join(" ")),
    supportBody: cleanText(supportLines.map((line) => line.text).join(" ")),
    footerBody: cleanText(footerLines.map((line) => line.text).join(" ")),
    layoutStyle: brandCandidate && titleCandidate && ctaCandidate && (warningLines.length > 0 || supportLines.length > 0)
      ? "centered-transactional-card"
      : ""
  };
}

function buildLocalScreenshotOcrSummary(rawText, dimensions = {}, layout = null) {
  const lines = Array.isArray(layout?.lines) && layout.lines.length > 0
    ? layout.lines.map((line) => cleanText(line?.text)).filter(Boolean)
    : normalizeOcrLines(rawText);
  const systemNoticeSummary = buildSystemNoticeOcrSummary(lines, dimensions, layout, rawText);
  if (systemNoticeSummary?.usable) {
    return systemNoticeSummary;
  }
  const brandLine = lines[0] && isLikelyBrandOcrLine(lines[0]) ? lines[0] : "";
  const meaningfulLines = lines.filter((line, index) => !(brandLine && index === 0 && line === brandLine));
  const footerLines = meaningfulLines.filter((line) => isLikelyFooterOcrLine(line));
  const nonFooterLines = meaningfulLines.filter((line) => !footerLines.includes(line));
  const ctaCandidates = nonFooterLines.filter((line) => isLikelyCtaOcrLine(line));
  const ctaLabel = cleanText(layout?.ctaLabel)
    || ctaCandidates.slice().reverse().find((line) => line.split(/\s+/).length <= 4)
    || ctaCandidates.at(-1)
    || "";
  const titleCandidates = nonFooterLines.filter((line) => line !== ctaLabel);
  const title = cleanText(layout?.title) || titleCandidates
    .slice()
    .sort((left, right) => scoreScreenshotTitleCandidate(right) - scoreScreenshotTitleCandidate(left))[0] || "";
  const ctaLead = cleanText(layout?.ctaLead)
    || nonFooterLines.find((line) => (
      line !== title
      && line !== ctaLabel
      && /(click the button|tap the button|use the button|button below|follow the link|below to)/i.test(line)
    ))
    || "";
  const warningBody = cleanText(layout?.warningBody);
  const ignoredBodyLines = new Set([
    brandLine,
    title,
    ctaLead,
    ctaLabel,
    warningBody,
    ...normalizeOcrLines(cleanText(layout?.supportBody)),
    ...normalizeOcrLines(cleanText(layout?.footerBody))
  ].filter(Boolean));

  const bodyBlocks = nonFooterLines.filter((line) => {
    if (ignoredBodyLines.has(line)) {
      return false;
    }
    return line.length >= 18;
  });
  const supportLines = footerLines.filter((line) => /support@|having trouble|ignore this email|\bif you\b/i.test(line));
  let supportBody = cleanText(layout?.supportBody) || cleanText(supportLines.join(" "));
  let footerBody = cleanText(layout?.footerBody) || cleanText(footerLines.filter((line) => !supportLines.includes(line)).join(" "));
  if (/ignore\s+If\b/i.test(supportBody) && /(this email|это письмо|этот email)/i.test(footerBody || "")) {
    supportBody = supportBody.replace(/ignore\s+If\b/i, "ignore this email. If");
    footerBody = "";
  }
  if (
    footerBody
    && footerBody.length <= 24
    && /(this email|это письмо|этот email)/i.test(footerBody)
    && /ignore/i.test(supportBody)
  ) {
    supportBody = cleanText(`${supportBody} ${footerBody}`);
    footerBody = "";
  }

  return {
    source: "local-tesseract",
    rawText: cleanText(rawText),
    lines,
    brandLine: cleanText(brandLine),
    title: cleanText(title),
    ctaLead: cleanText(ctaLead),
    ctaLabel: cleanText(ctaLabel).replace(/\s*[~→>\-]+$/, "").trim(),
    brandWidthRatio: Number(layout?.brandWidthRatio) || 0,
    brandTopRatio: Number(layout?.brandTopRatio) || 0,
    titleWidthRatio: Number(layout?.titleWidthRatio) || 0,
    titleTopRatio: Number(layout?.titleTopRatio) || 0,
    titleHeightRatio: Number(layout?.titleHeightRatio) || 0,
    ctaWidthRatio: Number(layout?.ctaWidthRatio) || 0,
    ctaTopRatio: Number(layout?.ctaTopRatio) || 0,
    ctaCenterOffset: Number(layout?.ctaCenterOffset) || 0,
    bodyBlocks: bodyBlocks.slice(0, 4),
    warningBody,
    supportBody,
    footerBody,
    layoutStyle: cleanText(layout?.layoutStyle),
    width: Number(dimensions.width) || 0,
    height: Number(dimensions.height) || 0,
    usable: Boolean(cleanText(title) || cleanText(ctaLabel) || bodyBlocks.length > 0)
  };
}

function chooseBestScreenshotOcrSummary(summaries = []) {
  const usable = (Array.isArray(summaries) ? summaries : []).filter((summary) => summary && summary.usable);
  if (usable.length === 0) {
    return null;
  }

  const titleSource = usable
    .slice()
    .sort((left, right) => scoreScreenshotTitleCandidate(right?.title) - scoreScreenshotTitleCandidate(left?.title))[0] || usable[0];
  const bodySource = usable
    .slice()
    .sort((left, right) => {
      const leftScore = (left?.bodyBlocks?.length || 0) * 4 + (cleanText(left?.supportBody) ? 2 : 0) + (cleanText(left?.footerBody) ? 1 : 0);
      const rightScore = (right?.bodyBlocks?.length || 0) * 4 + (cleanText(right?.supportBody) ? 2 : 0) + (cleanText(right?.footerBody) ? 1 : 0);
      return rightScore - leftScore;
    })[0] || usable[0];
  const ctaSource = usable.find((summary) => cleanText(summary?.ctaLabel)) || bodySource;

  const title = cleanText(titleSource?.title);
  const ctaLead = cleanText(bodySource?.ctaLead)
    || cleanText(titleSource?.ctaLead)
    || usable.map((summary) => cleanText(summary?.ctaLead)).find(Boolean)
    || "";
  const bodyBlocks = Array.isArray(bodySource?.bodyBlocks)
    ? bodySource.bodyBlocks.map(cleanText).filter((line) => line && line !== title && line !== ctaLead)
    : [];

  const warningBody = cleanText(bodySource?.warningBody) || cleanText(titleSource?.warningBody);
  let supportBody = cleanText(bodySource?.supportBody) || cleanText(titleSource?.supportBody);
  let footerBody = cleanText(bodySource?.footerBody) || cleanText(titleSource?.footerBody);
  if (/ignore\s+If\b/i.test(supportBody) && /(this email|это письмо|этот email)/i.test(footerBody || "")) {
    supportBody = supportBody.replace(/ignore\s+If\b/i, "ignore this email. If");
    footerBody = "";
  }
  if (
    footerBody
    && footerBody.length <= 24
    && /(this email|это письмо|этот email)/i.test(footerBody)
    && /ignore/i.test(supportBody)
  ) {
    supportBody = cleanText(`${supportBody} ${footerBody}`);
    footerBody = "";
  }

  return {
    source: usable.map((summary) => cleanText(summary.source)).filter(Boolean).join("+") || "local-tesseract",
    rawText: usable.map((summary) => cleanText(summary.rawText)).filter(Boolean).join("\n"),
    lines: usable.flatMap((summary) => Array.isArray(summary.lines) ? summary.lines : []).map(cleanText).filter(Boolean),
    brandLine: cleanText(titleSource?.brandLine) || cleanText(bodySource?.brandLine),
    title,
    ctaLead,
    ctaLabel: cleanText(ctaSource?.ctaLabel),
    brandWidthRatio: Number(titleSource?.brandWidthRatio || bodySource?.brandWidthRatio) || 0,
    brandTopRatio: Number(titleSource?.brandTopRatio || bodySource?.brandTopRatio) || 0,
    titleWidthRatio: Number(titleSource?.titleWidthRatio || bodySource?.titleWidthRatio) || 0,
    titleTopRatio: Number(titleSource?.titleTopRatio || bodySource?.titleTopRatio) || 0,
    titleHeightRatio: Number(titleSource?.titleHeightRatio || bodySource?.titleHeightRatio) || 0,
    ctaWidthRatio: Number(ctaSource?.ctaWidthRatio || bodySource?.ctaWidthRatio || titleSource?.ctaWidthRatio) || 0,
    ctaTopRatio: Number(ctaSource?.ctaTopRatio || bodySource?.ctaTopRatio || titleSource?.ctaTopRatio) || 0,
    ctaCenterOffset: Number(ctaSource?.ctaCenterOffset || bodySource?.ctaCenterOffset || titleSource?.ctaCenterOffset) || 0,
    bodyBlocks,
    warningBody,
    supportBody,
    footerBody,
    layoutStyle: cleanText(titleSource?.layoutStyle) || cleanText(bodySource?.layoutStyle) || cleanText(ctaSource?.layoutStyle),
    width: Number(bodySource?.width || titleSource?.width) || 0,
    height: Number(bodySource?.height || titleSource?.height) || 0,
    usable: true
  };
}

function isRussianLikeLocale(locale) {
  const normalized = normalizeLocaleCode(locale || "");
  return normalized === "ru" || normalized === "uk";
}

function getMockSectionCopy(locale) {
  if (isRussianLikeLocale(locale)) {
    return {
      detailsEyebrow: "Детали",
      visualEyebrow: "Визуал",
      primaryActionEyebrow: "Основное действие",
      mainContentTitle: "Основной блок",
      primaryActionTitle: "Главное действие",
      footerTitle: "Футер",
      featureTitle: "Что должно быть в письме",
      featureBody: "Блок собран из brief, перевода и текущей структуры письма.",
      ctaBody: "Пользователь должен получить один четкий CTA и перейти по основной ссылке.",
      footerBody: "Footer, legal и unsubscribe copy нужно подтвердить перед отправкой."
    };
  }

  return {
    detailsEyebrow: "Details",
    visualEyebrow: "Visual",
    primaryActionEyebrow: "Primary action",
    mainContentTitle: "Main content",
    primaryActionTitle: "Primary action",
    footerTitle: "Footer",
    featureTitle: "What should be in this email",
    featureBody: "This block is assembled from the brief, translations, and current email structure.",
    ctaBody: "The recipient should get one clear CTA and go to the primary link.",
    footerBody: "Footer, legal and unsubscribe copy should be confirmed before send."
  };
}

async function runLocalScreenshotOcr(payload) {
  const design = normalizeDesignPayload(payload?.design);
  const assetId = cleanText(design?.assetId);
  let dataUrl = cleanText(design?.dataUrl);

  if (!/^data:image\//i.test(dataUrl) && dataUrl) {
    dataUrl = await resolveVisionImageUrl(dataUrl);
  }

  if (!/^data:image\//i.test(dataUrl) && assetId) {
    try {
      const assetEntry = dbAssetsGetAll()
        .map(normalizeAssetRegistryEntry)
        .find((item) => cleanText(item?.id) === assetId);
      const assetSource = cleanText(assetEntry?.localUrl || assetEntry?.preferredUrl || assetEntry?.externalUrl);
      if (assetSource) {
        dataUrl = await resolveVisionImageUrl(assetSource);
      }
    } catch {
      dataUrl = "";
    }
  }

  if (!/^data:image\//i.test(dataUrl)) {
    return null;
  }

  const { mimeType, buffer } = decodeDataUrl(dataUrl);
  if (!/^image\//i.test(mimeType)) {
    return null;
  }

  const extension = getExtensionForAssetUpload(mimeType, cleanText(design?.name) || "design.png");
  const tempBase = path.join(tmpdir(), `studio-ocr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const imagePath = `${tempBase}${extension}`;
  let dimensions = { width: 0, height: 0 };

  try {
    await writeFile(imagePath, buffer);

    try {
      const sipsResult = await runCommand("/usr/bin/sips", ["-g", "pixelWidth", "-g", "pixelHeight", imagePath], __dirname);
      dimensions = parseSipsDimensions(`${sipsResult.stdout}\n${sipsResult.stderr}`);
    } catch {
      dimensions = { width: 0, height: 0 };
    }

    const psmVariants = ["4", "11", "6"];
    const summaries = [];
    for (const psm of psmVariants) {
      try {
        const ocrResult = await runCommand("tesseract", [imagePath, "stdout", "--psm", psm, "-l", "eng"], __dirname);
        let layout = null;
        try {
          const tsvResult = await runCommand("tesseract", [imagePath, "stdout", "--psm", psm, "-l", "eng", "tsv"], __dirname);
          layout = inferScreenshotLayoutFromTesseractTsv(tsvResult.stdout, dimensions);
        } catch {
          layout = null;
        }
        const summary = buildLocalScreenshotOcrSummary(ocrResult.stdout, dimensions, layout);
        if (summary?.usable) {
          summary.source = `local-tesseract-psm-${psm}`;
          summaries.push(summary);
        }
      } catch {
        continue;
      }
    }

    if (summaries.length > 0) {
      return chooseBestScreenshotOcrSummary(summaries);
    }

    const ocrResult = await runCommand("tesseract", [imagePath, "stdout", "--psm", "6", "-l", "eng"], __dirname);
    return buildLocalScreenshotOcrSummary(ocrResult.stdout, dimensions);
  } catch (error) {
  return {
    source: "local-tesseract",
    usable: false,
    error: cleanText(error?.message)
    };
  } finally {
    await rm(imagePath, { force: true }).catch(() => {});
  }
}

function createScreenshotOcrDebugSummary(screenshotOcr) {
  if (!screenshotOcr || typeof screenshotOcr !== "object") {
    return null;
  }

  return {
    source: cleanText(screenshotOcr.source),
    usable: Boolean(screenshotOcr.usable),
    brandLine: cleanText(screenshotOcr.brandLine),
    title: cleanText(screenshotOcr.title),
    ctaLead: cleanText(screenshotOcr.ctaLead),
    ctaLabel: cleanText(screenshotOcr.ctaLabel),
    brandWidthRatio: Number(screenshotOcr.brandWidthRatio) || 0,
    brandTopRatio: Number(screenshotOcr.brandTopRatio) || 0,
    titleWidthRatio: Number(screenshotOcr.titleWidthRatio) || 0,
    titleTopRatio: Number(screenshotOcr.titleTopRatio) || 0,
    titleHeightRatio: Number(screenshotOcr.titleHeightRatio) || 0,
    ctaWidthRatio: Number(screenshotOcr.ctaWidthRatio) || 0,
    ctaTopRatio: Number(screenshotOcr.ctaTopRatio) || 0,
    ctaCenterOffset: Number(screenshotOcr.ctaCenterOffset) || 0,
    bodyBlocks: Array.isArray(screenshotOcr.bodyBlocks)
      ? screenshotOcr.bodyBlocks.map(cleanText).filter(Boolean).slice(0, 4)
      : [],
    warningBody: cleanText(screenshotOcr.warningBody),
    supportBody: cleanText(screenshotOcr.supportBody),
    footerBody: cleanText(screenshotOcr.footerBody),
    layoutStyle: cleanText(screenshotOcr.layoutStyle),
    width: Number(screenshotOcr.width) || 0,
    height: Number(screenshotOcr.height) || 0,
    error: cleanText(screenshotOcr.error)
  };
}

function normalizeScreenshotOcrPayload(screenshotOcr) {
  if (!screenshotOcr || typeof screenshotOcr !== "object") {
    return null;
  }

  return {
    source: cleanText(screenshotOcr.source),
    usable: Boolean(screenshotOcr.usable),
    brandLine: cleanText(screenshotOcr.brandLine),
    title: cleanText(screenshotOcr.title),
    ctaLead: cleanText(screenshotOcr.ctaLead),
    ctaLabel: cleanText(screenshotOcr.ctaLabel),
    brandWidthRatio: Number(screenshotOcr.brandWidthRatio) || 0,
    brandTopRatio: Number(screenshotOcr.brandTopRatio) || 0,
    titleWidthRatio: Number(screenshotOcr.titleWidthRatio) || 0,
    titleTopRatio: Number(screenshotOcr.titleTopRatio) || 0,
    titleHeightRatio: Number(screenshotOcr.titleHeightRatio) || 0,
    ctaWidthRatio: Number(screenshotOcr.ctaWidthRatio) || 0,
    ctaTopRatio: Number(screenshotOcr.ctaTopRatio) || 0,
    ctaCenterOffset: Number(screenshotOcr.ctaCenterOffset) || 0,
    bodyBlocks: Array.isArray(screenshotOcr.bodyBlocks)
      ? screenshotOcr.bodyBlocks.map(cleanText).filter(Boolean)
      : [],
    warningBody: cleanText(screenshotOcr.warningBody),
    supportBody: cleanText(screenshotOcr.supportBody),
    footerBody: cleanText(screenshotOcr.footerBody),
    layoutStyle: cleanText(screenshotOcr.layoutStyle),
    width: Number(screenshotOcr.width) || 0,
    height: Number(screenshotOcr.height) || 0,
    error: cleanText(screenshotOcr.error)
  };
}

async function enrichPayloadWithLocalScreenshotOcr(payload) {
  if (!hasVisualDesignInput(payload) || hasStructuredFigmaInput(payload) || payload?.screenshotOcr) {
    return payload;
  }

  const screenshotOcr = await runLocalScreenshotOcr(payload);
  if (!screenshotOcr) {
    return payload;
  }

  return {
    ...payload,
    screenshotOcr
  };
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

function looksLikeSystemNoticeMail(mail) {
  const sections = Array.isArray(mail?.sections) ? mail.sections : [];
  if (sections.length < 5) {
    return false;
  }

  const signal = [
    cleanText(mail?.subject),
    cleanText(mail?.preheader),
    cleanText(sections[0]?.eyebrow),
    cleanText(sections[0]?.title),
    cleanText(sections[1]?.title),
    cleanText(sections[1]?.body),
    cleanText(sections[2]?.cta_label),
    cleanText(sections[3]?.body),
    cleanText(sections[4]?.body)
  ].join(" ");

  return /(copy trading|paused|suspend|suspended|interruption|insufficient balance|support team)/i.test(signal);
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

function splitAffPasswordResetWarningAndSupport(text) {
  const value = cleanText(text);
  if (!value) {
    return {
      warning: "",
      support: ""
    };
  }

  const normalized = value.replace(/\s+/g, " ").trim();
  const sentences = normalized
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => cleanText(sentence))
    .filter(Boolean);
  const warningLines = sentences.filter((sentence) => looksLikeAffPasswordResetWarning(sentence));
  const supportLines = sentences.filter((sentence) => looksLikeAffPasswordResetSupport(sentence));

  if (warningLines.length > 0 || supportLines.length > 0) {
    return {
      warning: cleanText(warningLines.join(" ")),
      support: cleanText(supportLines.join(" "))
    };
  }

  return {
    warning: "",
    support: value
  };
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
  font-family 'Helvetica Neue', Helvetica, Arial, sans-serif

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

function getSimpleSystemCardReferenceRoot() {
  return path.join(emailBaseRoot, "X_System", "mail-payment");
}

function getSystemNoticeCardReferenceRoot() {
  return path.join(emailBaseRoot, "X_System", "mail-payment");
}

function isAffPasswordResetReference(payload) {
  const target = resolveReferenceTemplateMailTarget(payload);
  return cleanText(target.category) === "X_AffSystem"
    && cleanText(target.mailId) === "password-retrieving-affiliate";
}

function buildAffPasswordResetTemplateMail(payload) {
  const screenshotOcr = payload?.screenshotOcr && typeof payload?.screenshotOcr === "object"
    ? payload.screenshotOcr
    : null;
  const analysisVisualHints = payload?.designAnalysis?.visual_hints && typeof payload.designAnalysis.visual_hints === "object"
    ? payload.designAnalysis.visual_hints
    : null;
  const logoUrl = cleanText(extractLatestLogoOverrideUrl(payload))
    || "https://static.cdnpub.info/files/storage/public/5f/c8/d0517a03c1c8h5j9j4/logoaff_white_shadow__1_.png";
  const bodyBlocks = Array.isArray(screenshotOcr?.bodyBlocks)
    ? screenshotOcr.bodyBlocks.map(cleanText).filter(Boolean)
    : [];
  const warningSplit = splitAffPasswordResetWarningAndSupport(
    cleanText(screenshotOcr?.warningBody)
      || cleanText(screenshotOcr?.supportBody)
  );
  const title = looksLikeResetHeadline(cleanText(screenshotOcr?.title))
    ? cleanText(screenshotOcr.title)
    : "Set your new password";
  const introBody = cleanText(bodyBlocks.slice(0, 2).join("\n\n"))
    || "We created an account for you on {{affiliate_embedded_admin_domain_url}} (or received a request to reset your password).";
  const ctaBody = cleanText(screenshotOcr?.ctaLead)
    || "Please click the button below to set your new password:";
  const warningBody = cleanText(screenshotOcr?.warningBody)
    || cleanText(warningSplit.warning)
    || "If you didn’t request to create or reset your password, you can safely ignore this email.";
  const supportBody = cleanText(screenshotOcr?.supportBody)
    || cleanText(warningSplit.support)
    || "If you’re having trouble signing in to your account, try setting your password again or reach out to support.";
  const ctaLabel = normalizeAffPasswordResetCtaLabel(
    cleanText(screenshotOcr?.ctaLabel),
    "Set new password"
  );
  const ctaHref = cleanText(payload?.brief?.primaryLink) || "";

  return {
    subject: title,
    preheader: cleanText(bodyBlocks[0]) || "Password reset instructions",
    locale: normalizeLocaleCode(payload?.brief?.locale || "en"),
    summary: "Affiliate password reset email built from the base template.",
    brand_logo_url: logoUrl,
    brand_logo_alt: deriveLogoAltText(logoUrl),
    visual_style: mergeVisualStyleHints(
      deriveAffPasswordResetVisualStyle(screenshotOcr),
      analysisVisualHints
    ),
    sections: [
      {
        kind: "text",
        title,
        body: introBody
      },
      {
        kind: "cta",
        title: "",
        body: ctaBody,
        cta_label: ctaLabel,
        cta_href: ctaHref
      },
      {
        kind: "text",
        title: "",
        body: warningBody
      },
      {
        kind: "text",
        title: "",
        body: supportBody
      },
      {
        kind: "footer",
        title: "",
        body: ""
      }
    ],
    assets: [],
    translations: []
  };
}

function countTextWords(text) {
  return cleanText(text).split(/\s+/).filter(Boolean).length;
}

function normalizeVisualStyleHints(hints) {
  const normalizeHexColor = (value) => {
    const normalized = cleanText(value);
    return /^#[0-9A-Fa-f]{6}$/.test(normalized) ? normalized.toUpperCase() : "";
  };
  const titleScale = cleanText(hints?.titleScale);
  const logoScale = cleanText(hints?.logoScale);
  const cardWidth = cleanText(hints?.cardWidth);
  const buttonWidth = cleanText(hints?.buttonWidth);
  const buttonTone = cleanText(hints?.buttonTone);
  const cardShape = cleanText(hints?.cardShape);
  const buttonShape = cleanText(hints?.buttonShape);
  const cardDensity = cleanText(hints?.cardDensity);
  const supportLayout = cleanText(hints?.supportLayout);
  const layoutStyle = cleanText(hints?.layoutStyle);
  const notes = cleanText(hints?.notes);

  return {
    titleScale: ["hero", "default", "compact"].includes(titleScale) ? titleScale : "default",
    logoScale: ["wide", "default", "compact"].includes(logoScale) ? logoScale : "default",
    cardWidth: ["wide", "default", "narrow"].includes(cardWidth) ? cardWidth : "default",
    buttonWidth: ["wide", "default", "compact"].includes(buttonWidth) ? buttonWidth : "default",
    buttonTone: ["outline", "solid"].includes(buttonTone) ? buttonTone : "solid",
    cardShape: ["sharp", "soft", "round"].includes(cardShape) ? cardShape : "soft",
    buttonShape: ["sharp", "soft", "pill"].includes(buttonShape) ? buttonShape : "soft",
    cardDensity: ["airy", "default", "compact"].includes(cardDensity) ? cardDensity : "default",
    supportLayout: ["detached", "default", "inline"].includes(supportLayout) ? supportLayout : "default",
    layoutStyle: ["centered-transactional-card", "hero-promo-band", "multi-band", "plain"].includes(layoutStyle) ? layoutStyle : "",
    pageBgColor: normalizeHexColor(hints?.pageBgColor),
    cardBgColor: normalizeHexColor(hints?.cardBgColor),
    titleColor: normalizeHexColor(hints?.titleColor),
    bodyColor: normalizeHexColor(hints?.bodyColor),
    accentColor: normalizeHexColor(hints?.accentColor),
    buttonFillColor: normalizeHexColor(hints?.buttonFillColor),
    buttonBorderColor: normalizeHexColor(hints?.buttonBorderColor),
    buttonTextColor: normalizeHexColor(hints?.buttonTextColor),
    notes
  };
}

function mergeVisualStyleHints(baseHints, overrideHints) {
  const base = normalizeVisualStyleHints(baseHints);
  const override = normalizeVisualStyleHints(overrideHints);

  return {
    titleScale: override.titleScale !== "default" ? override.titleScale : base.titleScale,
    logoScale: override.logoScale !== "default" ? override.logoScale : base.logoScale,
    cardWidth: override.cardWidth !== "default" ? override.cardWidth : base.cardWidth,
    buttonWidth: override.buttonWidth !== "default" ? override.buttonWidth : base.buttonWidth,
    buttonTone: override.buttonTone !== "solid" ? override.buttonTone : base.buttonTone,
    cardShape: override.cardShape !== "soft" ? override.cardShape : base.cardShape,
    buttonShape: override.buttonShape !== "soft" ? override.buttonShape : base.buttonShape,
    cardDensity: override.cardDensity !== "default" ? override.cardDensity : base.cardDensity,
    supportLayout: override.supportLayout !== "default" ? override.supportLayout : base.supportLayout,
    layoutStyle: override.layoutStyle || base.layoutStyle,
    pageBgColor: cleanText(override.pageBgColor) || cleanText(base.pageBgColor),
    cardBgColor: cleanText(override.cardBgColor) || cleanText(base.cardBgColor),
    titleColor: cleanText(override.titleColor) || cleanText(base.titleColor),
    bodyColor: cleanText(override.bodyColor) || cleanText(base.bodyColor),
    accentColor: cleanText(override.accentColor) || cleanText(base.accentColor),
    buttonFillColor: cleanText(override.buttonFillColor) || cleanText(base.buttonFillColor),
    buttonBorderColor: cleanText(override.buttonBorderColor) || cleanText(base.buttonBorderColor),
    buttonTextColor: cleanText(override.buttonTextColor) || cleanText(base.buttonTextColor),
    notes: cleanText(override.notes) || cleanText(base.notes)
  };
}

function deriveSimpleSystemCardVisualStyle(screenshotOcr) {
  const title = cleanText(screenshotOcr?.title);
  const ctaLabel = cleanText(screenshotOcr?.ctaLabel);
  const supportBody = cleanText(screenshotOcr?.supportBody);
  const titleWordCount = countTextWords(title);
  const titleWidthRatio = Number(screenshotOcr?.titleWidthRatio) || 0;
  const titleHeightRatio = Number(screenshotOcr?.titleHeightRatio) || 0;
  const titleTopRatio = Number(screenshotOcr?.titleTopRatio) || 0;
  const brandWidthRatio = Number(screenshotOcr?.brandWidthRatio) || 0;
  const ctaWidthRatio = Number(screenshotOcr?.ctaWidthRatio) || 0;

  let titleScale = "default";
  if (titleWordCount >= 8 || titleWidthRatio >= 0.72) {
    titleScale = "compact";
  } else if (titleHeightRatio >= 0.045 || titleWidthRatio >= 0.5 || titleWordCount <= 4) {
    titleScale = "hero";
  }

  let logoScale = "default";
  if (brandWidthRatio >= 0.24) {
    logoScale = "wide";
  } else if (brandWidthRatio > 0 && brandWidthRatio <= 0.16) {
    logoScale = "compact";
  }

  let buttonWidth = "default";
  if (ctaWidthRatio >= 0.26) {
    buttonWidth = "wide";
  } else if ((ctaWidthRatio > 0 && ctaWidthRatio <= 0.16) || ctaLabel.length <= 14) {
    buttonWidth = "compact";
  }

  let cardWidth = "default";
  if (titleWidthRatio >= 0.64 || ctaWidthRatio >= 0.3 || titleTopRatio >= 0.14) {
    cardWidth = "wide";
  } else if ((titleWidthRatio > 0 && titleWidthRatio <= 0.42) || (ctaWidthRatio > 0 && ctaWidthRatio <= 0.16)) {
    cardWidth = "narrow";
  }

  return normalizeVisualStyleHints({
    titleScale,
    logoScale,
    cardWidth,
    buttonWidth,
    buttonTone: titleScale === "hero" && ctaWidthRatio >= 0.24 ? "outline" : "solid",
    cardShape: "soft",
    buttonShape: titleScale === "hero" ? "soft" : "pill",
    cardDensity: supportBody ? "airy" : (titleScale === "compact" ? "compact" : "default"),
    supportLayout: supportBody ? "detached" : "inline"
  });
}

function deriveAffPasswordResetVisualStyle(screenshotOcr) {
  const title = cleanText(screenshotOcr?.title);
  const titleWordCount = countTextWords(title);
  const supportBody = cleanText(screenshotOcr?.supportBody);
  const titleWidthRatio = Number(screenshotOcr?.titleWidthRatio) || 0;
  const titleTopRatio = Number(screenshotOcr?.titleTopRatio) || 0;
  const brandWidthRatio = Number(screenshotOcr?.brandWidthRatio) || 0;
  const ctaWidthRatio = Number(screenshotOcr?.ctaWidthRatio) || 0;

  let titleScale = "default";
  if (titleWordCount >= 8 || titleWidthRatio >= 0.74) {
    titleScale = "compact";
  } else if (titleWidthRatio >= 0.48 || titleWordCount <= 5) {
    titleScale = "hero";
  }

  let logoScale = "default";
  if (brandWidthRatio >= 0.22) {
    logoScale = "wide";
  } else if (brandWidthRatio > 0 && brandWidthRatio <= 0.14) {
    logoScale = "compact";
  }

  let buttonWidth = "default";
  if (ctaWidthRatio >= 0.3) {
    buttonWidth = "wide";
  } else if (ctaWidthRatio > 0 && ctaWidthRatio <= 0.18) {
    buttonWidth = "compact";
  }

  let cardWidth = "default";
  if (titleWidthRatio >= 0.58 || ctaWidthRatio >= 0.28 || titleTopRatio >= 0.16) {
    cardWidth = "wide";
  } else if ((titleWidthRatio > 0 && titleWidthRatio <= 0.42) || (ctaWidthRatio > 0 && ctaWidthRatio <= 0.17)) {
    cardWidth = "narrow";
  }

  return normalizeVisualStyleHints({
    titleScale,
    logoScale,
    cardWidth,
    buttonWidth,
    buttonTone: "outline",
    cardShape: "sharp",
    buttonShape: "sharp",
    cardDensity: supportBody ? "airy" : "default",
    supportLayout: supportBody ? "detached" : "inline"
  });
}

function normalizeSystemNoticeTitle(title = "", ctaLabel = "", fallbackTitle = "") {
  const normalizedTitle = cleanText(title);
  const normalizedCta = cleanText(ctaLabel);
  const fallback = cleanText(fallbackTitle) || "Important account notice";

  if (!normalizedTitle) {
    return fallback;
  }

  const loweredTitle = normalizedTitle.toLowerCase();
  const loweredCta = normalizedCta.toLowerCase();
  const titleWordCount = countTextWords(normalizedTitle);
  const looksLikeActionOnly = /^(check|open|continue|resume|view|learn|watch|start|go|verify|confirm|review)\b/i.test(normalizedTitle);
  const duplicatesCta = loweredCta && loweredTitle === loweredCta;

  if ((looksLikeActionOnly && titleWordCount <= 4) || duplicatesCta) {
    return fallback;
  }

  return normalizedTitle;
}

function deriveSystemNoticeCardVisualStyle(screenshotOcr) {
  const title = cleanText(screenshotOcr?.title);
  const titleWordCount = countTextWords(title);
  const titleWidthRatio = Number(screenshotOcr?.titleWidthRatio) || 0;
  const brandWidthRatio = Number(screenshotOcr?.brandWidthRatio) || 0;
  const ctaWidthRatio = Number(screenshotOcr?.ctaWidthRatio) || 0;

  let titleScale = "default";
  if (titleWordCount >= 9 || titleWidthRatio >= 0.78) {
    titleScale = "compact";
  } else if (titleWidthRatio >= 0.52 || titleWordCount <= 6) {
    titleScale = "hero";
  }

  let logoScale = "default";
  if (brandWidthRatio >= 0.2) {
    logoScale = "wide";
  } else if (brandWidthRatio > 0 && brandWidthRatio <= 0.12) {
    logoScale = "compact";
  }

  let buttonWidth = "default";
  if (ctaWidthRatio >= 0.24) {
    buttonWidth = "wide";
  } else if (ctaWidthRatio > 0 && ctaWidthRatio <= 0.16) {
    buttonWidth = "compact";
  }

  return normalizeVisualStyleHints({
    titleScale,
    logoScale,
    cardWidth: "wide",
    buttonWidth,
    buttonTone: "solid",
    cardShape: "soft",
    buttonShape: "soft",
    cardDensity: "airy",
    supportLayout: "detached",
    layoutStyle: "centered-transactional-card",
    pageBgColor: "#EEF2FA",
    cardBgColor: "#FFFFFF",
    titleColor: "#20242F",
    bodyColor: "#495466",
    accentColor: "#F68A2F",
    buttonFillColor: "#F68A2F",
    buttonBorderColor: "#F68A2F",
    buttonTextColor: "#FFFFFF"
  });
}

function buildSystemNoticeCardTemplateMail(payload) {
  const screenshotOcr = payload?.screenshotOcr && typeof payload?.screenshotOcr === "object"
    ? payload.screenshotOcr
    : null;
  const analysisVisualHints = payload?.designAnalysis?.visual_hints && typeof payload.designAnalysis.visual_hints === "object"
    ? payload.designAnalysis.visual_hints
    : null;
  const bodyBlocks = Array.isArray(screenshotOcr?.bodyBlocks)
    ? screenshotOcr.bodyBlocks.map(cleanText).filter(Boolean)
    : [];
  const greetingCandidate = cleanText(bodyBlocks[0]);
  const greeting = /^(dear|hello|hi|уважаем|здравств|привет)/i.test(greetingCandidate)
    ? greetingCandidate
    : "Dear client,";
  const introBlocks = /^(dear|hello|hi|уважаем|здравств|привет)/i.test(greetingCandidate)
    ? bodyBlocks.slice(1)
    : bodyBlocks;
  const defaultTitle = cleanText(payload?.brief?.campaignName) || "Important account notice";
  const title = normalizeSystemNoticeTitle(
    cleanText(screenshotOcr?.title),
    cleanText(screenshotOcr?.ctaLabel),
    defaultTitle
  );
  const introBody = cleanText(introBlocks.slice(0, 2).join("\n\n"))
    || cleanText(payload?.brief?.goal)
    || "We would like to inform you that your account activity has been temporarily suspended.";
  const rawSignal = [
    cleanText(screenshotOcr?.ctaLead),
    cleanText(screenshotOcr?.warningBody),
    cleanText(screenshotOcr?.supportBody),
    cleanText(getRecentUserTranscript(payload))
  ].join(" ").toLowerCase();
  const reasonTitle = /reason for interruption/i.test(rawSignal)
    ? "Reason for interruption:"
    : "Reason:";
  const reasonBody = cleanText(screenshotOcr?.warningBody)
    || cleanText(introBlocks.find((line) => /(insufficient balance|reason|interruption|paused|suspend|copying)/i.test(line)))
    || "Please review your account settings.";
  const ctaLabel = cleanText(screenshotOcr?.ctaLabel)
    || cleanText(payload?.brief?.primaryCta)
    || "Check your account";
  const ctaHref = cleanText(payload?.brief?.primaryLink) || "";
  const supportBody = cleanText(screenshotOcr?.supportBody)
    || cleanText(introBlocks.slice(2).join("\n\n"))
    || "If you need help, please review your account settings and contact Support Team for further assistance.";
  const closingBody = cleanText(screenshotOcr?.footerBody) || "We appreciate your understanding.";
  const logoUrl = cleanText(extractLatestLogoOverrideUrl(payload))
    || "https://images01.iqoption.com/89/0689/static-01503674720413810689.png";

  return {
    subject: title,
    preheader: cleanText(introBlocks[0]) || title,
    locale: normalizeLocaleCode(payload?.brief?.locale || "en"),
    summary: "System notice email assembled from screenshot OCR.",
    brand_logo_url: logoUrl,
    brand_logo_alt: cleanText(screenshotOcr?.brandLine) || "IQ Option",
    visual_style: mergeVisualStyleHints(
      deriveSystemNoticeCardVisualStyle(screenshotOcr),
      analysisVisualHints
    ),
    sections: [
      {
        kind: "text",
        eyebrow: greeting,
        title,
        body: introBody
      },
      {
        kind: "feature-list",
        title: reasonTitle,
        body: reasonBody
      },
      {
        kind: "cta",
        title: "",
        body: "",
        cta_label: ctaLabel,
        cta_href: ctaHref
      },
      {
        kind: "text",
        title: "",
        body: supportBody
      },
      {
        kind: "text",
        title: "",
        body: closingBody
      },
      {
        kind: "footer",
        title: "",
        body: ""
      }
    ],
    assets: [],
    translations: []
  };
}

function buildSimpleSystemCardTemplateMail(payload) {
  const screenshotOcr = payload?.screenshotOcr && typeof payload.screenshotOcr === "object"
    ? payload.screenshotOcr
    : null;
  const analysisVisualHints = payload?.designAnalysis?.visual_hints && typeof payload.designAnalysis.visual_hints === "object"
    ? payload.designAnalysis.visual_hints
    : null;
  const logoUrl = cleanText(extractLatestLogoOverrideUrl(payload));
  const bodyBlocks = Array.isArray(screenshotOcr?.bodyBlocks)
    ? screenshotOcr.bodyBlocks.map(cleanText).filter(Boolean)
    : [];
  const warningSplit = splitAffPasswordResetWarningAndSupport(cleanText(screenshotOcr?.supportBody));
  const title = cleanText(screenshotOcr?.title) || cleanText(payload?.brief?.campaignName) || "Important update";
  const introBody = cleanText(bodyBlocks.slice(0, 3).join("\n\n")) || cleanText(payload?.brief?.goal) || "We prepared an important update for your account.";
  const ctaBody = cleanText(screenshotOcr?.ctaLead) || cleanText(payload?.brief?.contentNotes) || "Please use the button below to continue.";
  const warningBody = cleanText(screenshotOcr?.warningBody) || cleanText(warningSplit.warning);
  const supportBody = cleanText(screenshotOcr?.supportBody) || cleanText(warningSplit.support);
  const ctaLabel = cleanText(screenshotOcr?.ctaLabel) || cleanText(payload?.brief?.primaryCta) || "Continue";
  const ctaHref = cleanText(payload?.brief?.primaryLink) || "";
  const brandLabel = cleanText(screenshotOcr?.brandLine) || deriveLogoAltText(logoUrl) || "Brand";

  return {
    subject: title,
    preheader: cleanText(bodyBlocks[0]) || cleanText(payload?.brief?.goal) || title,
    locale: normalizeLocaleCode(payload?.brief?.locale || "en"),
    summary: "Simple transactional card email assembled from screenshot OCR.",
    brand_logo_url: logoUrl,
    brand_logo_alt: brandLabel,
    visual_style: mergeVisualStyleHints(
      deriveSimpleSystemCardVisualStyle(screenshotOcr),
      analysisVisualHints
    ),
    sections: [
      {
        kind: "text",
        title,
        body: introBody
      },
      {
        kind: "cta",
        title: "",
        body: ctaBody,
        cta_label: ctaLabel,
        cta_href: ctaHref
      },
      {
        kind: "text",
        title: "",
        body: warningBody
      },
      {
        kind: "text",
        title: "",
        body: supportBody
      },
      {
        kind: "footer",
        title: "",
        body: ""
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

function looksLikeSimpleSystemCardScreenshot(payload, mail) {
  const screenshotOcr = payload?.screenshotOcr && typeof payload?.screenshotOcr === "object"
    ? payload.screenshotOcr
    : null;
  if (!screenshotOcr?.usable || !hasVisualDesignInput(payload) || payload?.baseEmailHtml) {
    return false;
  }

  if (cleanText(screenshotOcr?.layoutStyle) !== "centered-transactional-card") {
    return false;
  }

  const signal = [
    cleanText(screenshotOcr?.title),
    cleanText(screenshotOcr?.ctaLead),
    cleanText(screenshotOcr?.ctaLabel),
    ...(Array.isArray(screenshotOcr?.bodyBlocks) ? screenshotOcr.bodyBlocks.map(cleanText) : []),
    cleanText(screenshotOcr?.warningBody),
    cleanText(screenshotOcr?.supportBody),
    cleanText(getRecentUserTranscript(payload)),
    ...(Array.isArray(mail?.sections) ? mail.sections.flatMap((section) => [cleanText(section?.title), cleanText(section?.body)]) : [])
  ].filter(Boolean).join(" ");

  return /(password|reset|verify|verification|confirm|welcome|activate|account|email|security|invitation)/i.test(signal);
}

function looksLikeSystemNoticeScreenshot(payload, mail) {
  const screenshotOcr = payload?.screenshotOcr && typeof payload?.screenshotOcr === "object"
    ? payload.screenshotOcr
    : null;
  if (!screenshotOcr?.usable || !hasVisualDesignInput(payload) || payload?.baseEmailHtml) {
    return false;
  }

  if (cleanText(screenshotOcr?.layoutStyle) !== "centered-transactional-card") {
    return false;
  }

  const signal = [
    cleanText(screenshotOcr?.brandLine),
    cleanText(screenshotOcr?.title),
    cleanText(screenshotOcr?.ctaLead),
    cleanText(screenshotOcr?.ctaLabel),
    ...(Array.isArray(screenshotOcr?.bodyBlocks) ? screenshotOcr.bodyBlocks.map(cleanText) : []),
    cleanText(screenshotOcr?.warningBody),
    cleanText(screenshotOcr?.supportBody),
    cleanText(screenshotOcr?.footerBody),
    cleanText(getRecentUserTranscript(payload)),
    ...(Array.isArray(mail?.sections) ? mail.sections.flatMap((section) => [cleanText(section?.title), cleanText(section?.body)]) : [])
  ].filter(Boolean).join(" ");

  return /(notice|paused|pause|suspend|suspended|suspension|interruption|reason for interruption|insufficient balance|copy trading|temporarily suspended|support team)/i.test(signal);
}

function getEmailBaseTemplateProfile(payload, mail) {
  const selection = getReferenceTemplateSelection(payload);
  const selectionProfile = cleanText(selection?.profile);
  if (selectionProfile && selectionProfile !== "generic") {
    return selectionProfile;
  }

  if (
    looksLikeSystemVerificationDraft(payload, mail)
    && cleanText(selection?.category) === "X_IQBroker"
    && cleanText(selection?.mailId) === "payment-verification-request-pop"
  ) {
    return "system-verification";
  }

  if (looksLikeSystemNoticeScreenshot(payload, mail)) {
    return "system-notice-card";
  }

  if (looksLikeSimpleSystemCardScreenshot(payload, mail)) {
    return "simple-system-card";
  }

  return selectionProfile || "generic";
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
  const visualStyle = normalizeVisualStyleHints(mail?.visual_style);
  const introTitle = getAffPasswordResetToken(translationFileKey, 0, "title");
  const introBody = getAffPasswordResetToken(translationFileKey, 0, "body");
  const ctaBody = getAffPasswordResetToken(translationFileKey, 1, "body");
  const ctaLabel = getAffPasswordResetToken(translationFileKey, 1, "cta_label");
  const warningBody = getAffPasswordResetToken(translationFileKey, 2, "body");
  const supportBody = getAffPasswordResetToken(translationFileKey, 3, "body");
  const ctaHref = cleanText(mail?.sections?.[1]?.cta_href) || "";
  const logoClassChain = buildPugClassChain("qr-reset-logo", "center", getVisualModifierClass("qr-reset-logo", visualStyle.logoScale));
  const cardClassChain = buildPugClassChain("qr-reset-card", getVisualModifierClass("qr-reset-card", visualStyle.cardDensity));
  const shellClassChain = buildPugClassChain("twelve", "columns", "qr-reset-shell", getVisualModifierClass("qr-reset-shell", visualStyle.cardWidth));
  const titleClassChain = buildPugClassChain("qr-reset-title", getVisualModifierClass("qr-reset-title", visualStyle.titleScale));
  const buttonClassChain = buildPugClassChain(
    "qr-reset-button",
    getVisualModifierClass("qr-reset-button", visualStyle.buttonWidth),
    getVisualModifierClass("qr-reset-button", visualStyle.buttonTone)
  );
  const supportWrapClassChain = buildPugClassChain("qr-reset-support-wrap", getVisualModifierClass("qr-reset-support-wrap", visualStyle.supportLayout));
  const buttonMarkup = ctaHref
    ? `                                                a.${buttonClassChain}(href=${JSON.stringify(ctaHref)} target=\"_blank\" universal=\"true\")!= ${JSON.stringify(ctaLabel)}`
    : `                                                span.${buildPugClassChain(buttonClassChain, "qr-reset-button-disabled")}!= ${JSON.stringify(ctaLabel)}`;

  return [
    "table.row.qr-reset-page",
    "    tr",
    "        td.pb0",
    "            table.twelve.columns",
    "                tr",
    "                    td.pb0",
    `                        img.${logoClassChain}(src=${JSON.stringify(logoUrl)} alt=${JSON.stringify(logoAlt)})`,
    "",
    "table.row.qr-reset-page",
    "    tr",
    "        td.wrapper.last",
    `            table.${shellClassChain}`,
    "                tr",
    "                    td.pb0",
    `                        table.${cardClassChain}`,
    "                            tr",
    "                                td.qr-reset-card-pad",
    `                                    p.${titleClassChain}!= ${JSON.stringify(introTitle)}`,
    `                                    p.qr-reset-copy.qr-reset-copy-intro!= ${JSON.stringify(introBody)}`,
    `                                    p.qr-reset-copy.qr-reset-copy-lead!= ${JSON.stringify(ctaBody)}`,
    "                                    table.qr-reset-button-wrap",
    "                                        tr",
    "                                            td",
    buttonMarkup,
    `                                    p.qr-reset-copy.qr-reset-copy-warning!= ${JSON.stringify(warningBody)}`,
    "",
    "table.row.qr-reset-page",
    "    tr",
    "        td.wrapper.last",
    `            table.${shellClassChain}`,
    "                tr",
    `                    td.${supportWrapClassChain}`,
    `                        p.qr-reset-support!= ${JSON.stringify(supportBody)}`
  ].join("\n");
}

function renderAffPasswordResetFooterPug(mail, translationFileKey) {
  const footerBodyValue = cleanText(mail?.sections?.[4]?.body);
  if (!footerBodyValue) {
    return "";
  }

  const footerBody = getAffPasswordResetToken(translationFileKey, 4, "body");
  return [
    "table.row.qr-reset-page",
    "    tr",
    "        td.pb30",
    "            table.twelve.columns",
    "                tr",
    "                    td",
    "                        .qr-reset-legal-wrap",
    `                            p.qr-reset-legal-text!= ${JSON.stringify(footerBody)}`
  ].join("\n");
}

function getSimpleSystemCardToken(translationFileKey, sectionIndex, field) {
  return makeTranslationToken(translationFileKey, `sections.${getSectionLocaleKey(sectionIndex)}.${field}`);
}

function buildPugClassChain(...classes) {
  return classes.map(cleanText).filter(Boolean).join(".");
}

function getVisualModifierClass(baseClass, modifier) {
  const normalized = cleanText(modifier);
  if (!normalized || normalized === "default") {
    return "";
  }
  return `${baseClass}-${normalized}`;
}

function resolveShapeRadius(shape, radiusMap, fallbackKey) {
  const normalized = cleanText(shape);
  if (normalized && radiusMap[normalized]) {
    return radiusMap[normalized];
  }
  return radiusMap[fallbackKey] || "";
}

function buildSimpleSystemCardThemeTokens(mail) {
  const visualStyle = normalizeVisualStyleHints(mail?.visual_style);
  const accent = cleanText(visualStyle.accentColor) || "#4F91F7";
  const buttonFill = cleanText(visualStyle.buttonFillColor) || accent;
  const buttonBorder = cleanText(visualStyle.buttonBorderColor) || accent;
  const buttonText = cleanText(visualStyle.buttonTextColor) || (visualStyle.buttonTone === "outline" ? buttonBorder : "#FFFFFF");

  return {
    pageBg: cleanText(visualStyle.pageBgColor) || "#F4F6FB",
    cardBg: cleanText(visualStyle.cardBgColor) || "#FFFFFF",
    titleColor: cleanText(visualStyle.titleColor) || "#20242F",
    bodyColor: cleanText(visualStyle.bodyColor) || "#465064",
    supportColor: cleanText(visualStyle.bodyColor) || "#4F5869",
    legalColor: "#8F95A6",
    buttonFill,
    buttonBorder,
    buttonText,
    cardRadius: resolveShapeRadius(visualStyle.cardShape, {
      sharp: "6px",
      soft: "18px",
      round: "28px"
    }, "soft"),
    buttonRadius: resolveShapeRadius(visualStyle.buttonShape, {
      sharp: "4px",
      soft: "8px",
      pill: "999px"
    }, "soft")
  };
}

function buildAffPasswordResetThemeTokens(mail) {
  const visualStyle = normalizeVisualStyleHints(mail?.visual_style);
  const accent = cleanText(visualStyle.accentColor) || "#FF2746";
  const buttonFill = cleanText(visualStyle.buttonFillColor) || accent;
  const buttonBorder = cleanText(visualStyle.buttonBorderColor) || accent;
  const buttonText = cleanText(visualStyle.buttonTextColor) || (visualStyle.buttonTone === "outline" ? buttonBorder : "#FFFFFF");

  return {
    pageBg: cleanText(visualStyle.pageBgColor) || "#F3F4FA",
    cardBg: cleanText(visualStyle.cardBgColor) || "#FFFFFF",
    titleColor: cleanText(visualStyle.titleColor) || accent,
    bodyColor: cleanText(visualStyle.bodyColor) || "#3A4050",
    supportColor: cleanText(visualStyle.bodyColor) || "#3D4353",
    legalColor: "#8F95A6",
    buttonFill,
    buttonBorder,
    buttonText,
    cardRadius: resolveShapeRadius(visualStyle.cardShape, {
      sharp: "6px",
      soft: "12px",
      round: "24px"
    }, "sharp"),
    buttonRadius: resolveShapeRadius(visualStyle.buttonShape, {
      sharp: "4px",
      soft: "10px",
      pill: "999px"
    }, "sharp")
  };
}

function renderSimpleSystemCardHeaderPug(mail, translationFileKey) {
  const logoUrl = cleanText(mail?.brand_logo_url);
  const brandLabel = cleanText(mail?.brand_logo_alt) || "Brand";
  const visualStyle = normalizeVisualStyleHints(mail?.visual_style);
  const introTitle = getSimpleSystemCardToken(translationFileKey, 0, "title");
  const introBody = getSimpleSystemCardToken(translationFileKey, 0, "body");
  const ctaBody = getSimpleSystemCardToken(translationFileKey, 1, "body");
  const ctaLabel = getSimpleSystemCardToken(translationFileKey, 1, "cta_label");
  const warningBody = getSimpleSystemCardToken(translationFileKey, 2, "body");
  const supportBody = getSimpleSystemCardToken(translationFileKey, 3, "body");
  const ctaHref = cleanText(mail?.sections?.[1]?.cta_href) || "";
  const logoClassChain = buildPugClassChain("ssc-logo", "center", getVisualModifierClass("ssc-logo", visualStyle.logoScale));
  const cardClassChain = buildPugClassChain("ssc-card", getVisualModifierClass("ssc-card", visualStyle.cardDensity));
  const shellClassChain = buildPugClassChain("twelve", "columns", "ssc-shell", getVisualModifierClass("ssc-shell", visualStyle.cardWidth));
  const titleClassChain = buildPugClassChain("ssc-title", getVisualModifierClass("ssc-title", visualStyle.titleScale));
  const buttonClassChain = buildPugClassChain(
    "ssc-button",
    getVisualModifierClass("ssc-button", visualStyle.buttonWidth),
    getVisualModifierClass("ssc-button", visualStyle.buttonTone)
  );
  const supportWrapClassChain = buildPugClassChain("ssc-support-wrap", getVisualModifierClass("ssc-support-wrap", visualStyle.supportLayout));
  const lines = [
    "table.row.ssc-page",
    "    tr",
    "        td.pb0"
  ];

  if (logoUrl) {
    lines.push(`            img.${logoClassChain}(src=${JSON.stringify(logoUrl)} alt=${JSON.stringify(brandLabel)})`);
  } else {
    lines.push(`            p.ssc-brand-text.center!= ${JSON.stringify(brandLabel)}`);
  }

  lines.push(
    "",
    "table.row.ssc-page",
    "    tr",
    "        td.wrapper.last",
    `            table.${shellClassChain}`,
    "                tr",
    "                    td.pb0",
    `                        table.${cardClassChain}`,
    "                            tr",
    "                                td.ssc-card-pad",
    `                                    p.${titleClassChain}!= ${JSON.stringify(introTitle)}`,
    `                                    p.ssc-copy.ssc-copy-intro!= ${JSON.stringify(introBody)}`,
    `                                    p.ssc-copy.ssc-copy-lead!= ${JSON.stringify(ctaBody)}`,
    "                                    table.ssc-button-wrap",
    "                                        tr",
    "                                            td"
  );

  if (ctaHref) {
    lines.push(`                                                a.${buttonClassChain}(href=${JSON.stringify(ctaHref)} target=\"_blank\" universal=\"true\")!= ${JSON.stringify(ctaLabel)}`);
  } else {
    lines.push(`                                                span.${buildPugClassChain(buttonClassChain, "ssc-button-disabled")}!= ${JSON.stringify(ctaLabel)}`);
  }

  if (cleanText(mail?.sections?.[2]?.body)) {
    lines.push(`                                    p.ssc-copy.ssc-copy-warning!= ${JSON.stringify(warningBody)}`);
  }

  if (cleanText(mail?.sections?.[3]?.body)) {
    lines.push(
      "",
      "table.row.ssc-page",
      "    tr",
      "        td.wrapper.last",
      `            table.${shellClassChain}`,
      "                tr",
      `                    td.${supportWrapClassChain}`,
      `                        p.ssc-support!= ${JSON.stringify(supportBody)}`
    );
  }

  return lines.join("\n");
}

function renderSimpleSystemCardFooterPug(mail, translationFileKey) {
  const footerBodyValue = cleanText(mail?.sections?.[4]?.body);
  if (!footerBodyValue) {
    return "";
  }

  const footerBody = getSimpleSystemCardToken(translationFileKey, 4, "body");
  return [
    "table.row.ssc-page",
    "    tr",
    "        td.pb30",
    "            table.twelve.columns",
    "                tr",
    "                    td",
    "                        .ssc-legal-wrap",
    `                            p.ssc-legal-text!= ${JSON.stringify(footerBody)}`
  ].join("\n");
}

function renderSimpleSystemCardIndexPug() {
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

function renderSimpleSystemCardMainStylus(mail) {
  const theme = buildSimpleSystemCardThemeTokens(mail);
  return `
*
  font-family "Roboto", "Helvetica", "Arial", sans-serif !important
  -webkit-font-smoothing antialiased
  font-smoothing antialiased

html
  background ${theme.pageBg} !important

body
  margin 0 auto !important
  text-align center !important
  background ${theme.pageBg} !important

table.body
  background ${theme.pageBg} !important

.bg-col
  background ${theme.pageBg} !important

.center
  text-align center
  margin 0 auto

.ssc-page
  background ${theme.pageBg} !important

.ssc-shell
  width 520px
  margin 0 auto
  @media screen and (max-width: 600px)
    width 100% !important

.ssc-shell-wide
  width 580px
  @media screen and (max-width: 600px)
    width 100% !important

.ssc-shell-narrow
  width 460px
  @media screen and (max-width: 600px)
    width 100% !important

.ssc-logo
  float none
  display block
  margin 0 auto
  max-width 188px
  width 188px
  padding-top 18px
  padding-bottom 28px
  height auto
  @media screen and (max-width: 600px)
    max-width 164px !important
    width 164px !important
    padding-top 12px !important
    padding-bottom 22px !important

.ssc-logo-wide
  max-width 212px
  width 212px
  @media screen and (max-width: 600px)
    max-width 176px !important
    width 176px !important

.ssc-logo-compact
  max-width 152px
  width 152px
  @media screen and (max-width: 600px)
    max-width 136px !important
    width 136px !important

.ssc-brand-text
  margin 0
  padding-top 18px
  padding-bottom 28px
  color ${theme.titleColor}
  font-size 32px
  line-height 1.1
  font-weight 700
  letter-spacing .01em
  @media screen and (max-width: 600px)
    font-size 26px !important

.ssc-card
  width 100%
  background ${theme.cardBg}
  border 1px solid #eaedf4
  border-radius ${theme.cardRadius}

.ssc-card-airy .ssc-card-pad
  padding 54px 56px 46px
  @media screen and (max-width: 600px)
    padding 34px 26px 30px !important

.ssc-card-compact .ssc-card-pad
  padding 38px 40px 30px
  @media screen and (max-width: 600px)
    padding 28px 22px 22px !important

.ssc-card-pad
  padding 46px 48px 40px
  @media screen and (max-width: 600px)
    padding 30px 24px 26px !important

.ssc-title
  margin 0 0 28px
  color ${theme.titleColor}
  font-size 46px
  line-height 1.08
  font-weight 700
  text-align left
  @media screen and (max-width: 600px)
    font-size 36px !important
    line-height 1.1 !important
    margin-bottom 20px !important

.ssc-title-hero
  font-size 54px
  line-height 1.06
  margin-bottom 30px
  @media screen and (max-width: 600px)
    font-size 38px !important

.ssc-title-compact
  font-size 38px
  line-height 1.12
  margin-bottom 22px
  @media screen and (max-width: 600px)
    font-size 32px !important

.ssc-copy
  margin 0
  color ${theme.bodyColor}
  font-size 18px
  line-height 1.56
  text-align left
  font-weight 400
  @media screen and (max-width: 600px)
    font-size 16px !important
    line-height 1.55 !important

.ssc-copy-intro
  margin-bottom 24px

.ssc-copy-lead
  margin-bottom 18px

.ssc-copy-warning
  margin-top 12px
  color ${theme.bodyColor}

.ssc-button-wrap
  width 100%
  margin 0 0 34px
  border-collapse collapse
  border-spacing 0

.ssc-button-wrap td
  padding 0
  text-align left

.ssc-button
  display inline-block
  min-width 248px
  box-sizing border-box
  padding 18px 24px
  border-radius ${theme.buttonRadius}
  background ${theme.buttonFill}
  color ${theme.buttonText} !important
  font-size 19px
  line-height 1.2
  font-weight 700
  text-decoration none
  text-align center
  border 2px solid ${theme.buttonBorder}
  @media screen and (max-width: 600px)
    min-width 100% !important
    font-size 17px !important

.ssc-button-wide
  min-width 292px

.ssc-button-compact
  min-width 204px

.ssc-button-outline
  background transparent
  border 2px solid ${theme.buttonBorder}
  color ${theme.buttonText} !important

.ssc-button-disabled
  opacity .74

.ssc-support-wrap
  padding 34px 48px 18px
  @media screen and (max-width: 600px)
    padding 26px 24px 12px !important

.ssc-support-wrap-inline
  padding-top 22px
  @media screen and (max-width: 600px)
    padding-top 18px !important

.ssc-support
  margin 0
  color ${theme.supportColor}
  font-size 18px
  line-height 1.56
  text-align center
  font-weight 400
  @media screen and (max-width: 600px)
    font-size 16px !important

.ssc-legal-wrap
  padding 10px 0 0

.ssc-legal-text
  margin 0
  color ${theme.legalColor}
  font-size 12px
  line-height 18px
  text-align center
`;
}

function buildSystemNoticeCardThemeTokens(mail) {
  const visualStyle = normalizeVisualStyleHints(mail?.visual_style);
  const accent = cleanText(visualStyle.accentColor) || "#F68A2F";
  const buttonFill = cleanText(visualStyle.buttonFillColor) || accent;
  const buttonBorder = cleanText(visualStyle.buttonBorderColor) || accent;
  const buttonText = cleanText(visualStyle.buttonTextColor) || "#FFFFFF";

  return {
    pageBg: cleanText(visualStyle.pageBgColor) || "#EEF2FA",
    cardBg: cleanText(visualStyle.cardBgColor) || "#FFFFFF",
    titleColor: cleanText(visualStyle.titleColor) || "#20242F",
    bodyColor: cleanText(visualStyle.bodyColor) || "#495466",
    mutedColor: "#6E7686",
    accent,
    calloutBg: "#FFF6EB",
    calloutBorder: accent,
    buttonFill,
    buttonBorder,
    buttonText,
    badgeBg: "#F2F4F8",
    badgeText: "#9097A6",
    cardRadius: resolveShapeRadius(visualStyle.cardShape, {
      sharp: "10px",
      soft: "18px",
      round: "28px"
    }, "soft"),
    buttonRadius: resolveShapeRadius(visualStyle.buttonShape, {
      sharp: "6px",
      soft: "12px",
      pill: "999px"
    }, "soft")
  };
}

function getSystemNoticeCardToken(translationFileKey, sectionIndex, field) {
  return makeTranslationToken(translationFileKey, `sections.${getSectionLocaleKey(sectionIndex)}.${field}`);
}

function renderSystemNoticeCardHeaderPug(mail, translationFileKey) {
  const logoUrl = cleanText(mail?.brand_logo_url) || "https://images01.iqoption.com/89/0689/static-01503674720413810689.png";
  const logoAlt = cleanText(mail?.brand_logo_alt) || "IQ Option";
  const visualStyle = normalizeVisualStyleHints(mail?.visual_style);
  const greetingToken = getSystemNoticeCardToken(translationFileKey, 0, "eyebrow");
  const titleToken = getSystemNoticeCardToken(translationFileKey, 0, "title");
  const introToken = getSystemNoticeCardToken(translationFileKey, 0, "body");
  const reasonTitleToken = getSystemNoticeCardToken(translationFileKey, 1, "title");
  const reasonBodyToken = getSystemNoticeCardToken(translationFileKey, 1, "body");
  const ctaToken = getSystemNoticeCardToken(translationFileKey, 2, "cta_label");
  const supportToken = getSystemNoticeCardToken(translationFileKey, 3, "body");
  const closingToken = getSystemNoticeCardToken(translationFileKey, 4, "body");
  const ctaHref = cleanText(mail?.sections?.[2]?.cta_href) || "";
  const shellClassChain = buildPugClassChain("twelve", "columns", "snc-shell", getVisualModifierClass("snc-shell", visualStyle.cardWidth));
  const logoClassChain = buildPugClassChain("snc-logo", getVisualModifierClass("snc-logo", visualStyle.logoScale));
  const titleClassChain = buildPugClassChain("snc-title", getVisualModifierClass("snc-title", visualStyle.titleScale));
  const buttonClassChain = buildPugClassChain("snc-button", getVisualModifierClass("snc-button", visualStyle.buttonWidth));

  return [
    "table.row.snc-page",
    "    tr",
    "        td.wrapper.last",
    `            table.${shellClassChain}`,
    "                tr",
    "                    td.pb0",
    "                        table.snc-card",
    "                            tr",
    "                                td.snc-card-pad",
    "                                    table.snc-topbar",
    "                                        tr",
    "                                            td.snc-topbar-left",
    `                                                img.${logoClassChain}(src=${JSON.stringify(logoUrl)} alt=${JSON.stringify(logoAlt)})`,
    "                                            td.snc-topbar-right",
    "                                                span.snc-badge NOTICE",
    `                                    p.snc-greeting!= ${JSON.stringify(greetingToken)}`,
    `                                    p.${titleClassChain}!= ${JSON.stringify(titleToken)}`,
    `                                    p.snc-copy.snc-copy-intro!= ${JSON.stringify(introToken)}`,
    `                                    p.snc-reason-title!= ${JSON.stringify(reasonTitleToken)}`,
    "                                    .snc-callout",
    `                                        p.snc-callout-copy!= ${JSON.stringify(reasonBodyToken)}`,
    "                                    table.snc-button-wrap",
    "                                        tr",
    "                                            td"
  ].concat(
    ctaHref
      ? [`                                                a.${buttonClassChain}(href=${JSON.stringify(ctaHref)} target=\"_blank\" universal=\"true\")!= ${JSON.stringify(ctaToken)}`]
      : [`                                                span.${buildPugClassChain(buttonClassChain, "snc-button-disabled")}!= ${JSON.stringify(ctaToken)}`],
    [
      cleanText(mail?.sections?.[3]?.body)
        ? `                                    p.snc-copy.snc-copy-support!= ${JSON.stringify(supportToken)}`
        : "",
      "                            tr",
      "                                td.snc-card-ack",
      `                                    p.snc-ack!= ${JSON.stringify(closingToken)}`
    ].filter(Boolean)
  ).join("\n");
}

function renderSystemNoticeCardFooterPug() {
  return [
    "table.row.snc-footer",
    "    tr",
    "        td.pb30",
    "            table.twelve.columns",
    "                tr",
    "                    td",
    "                        .snc-footer-pad",
    "                            p.snc-footer-address {{embedded.company_address}}",
    "                            p.snc-footer-warning {{embedded.risk_warning}}",
    "                            p.snc-footer-links",
    "                                a(href='https://iqoption.com/terms-and-conditions' target='_blank') ${{ footer.footer.conditions }}$",
    "                                |  |",
    "                                a(href='{{embedded.unsubscribe_link}}' target='_blank') ${{ footer.footer.unsubscribe }}$"
  ].join("\n");
}

function renderSystemNoticeCardIndexPug() {
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

function renderSystemNoticeCardMainStylus(mail) {
  const theme = buildSystemNoticeCardThemeTokens(mail);
  return `
*
  font-family "Roboto", "Helvetica", "Arial", sans-serif !important

html
  background ${theme.pageBg} !important

body
  margin 0 auto !important
  text-align center !important
  background ${theme.pageBg} !important

table.body
  background ${theme.pageBg} !important

.bg-col
  background ${theme.pageBg} !important

.center
  text-align center
  margin 0 auto

.snc-page
  background ${theme.pageBg} !important

.snc-shell
  width 580px
  margin 0 auto
  @media screen and (max-width: 600px)
    width 100% !important

.snc-shell-narrow
  width 520px
  @media screen and (max-width: 600px)
    width 100% !important

.snc-logo
  display block
  float none
  max-width 134px
  width 134px
  height auto

.snc-logo-wide
  max-width 148px
  width 148px

.snc-logo-compact
  max-width 118px
  width 118px

.snc-card
  width 100%
  background ${theme.cardBg}
  border-radius ${theme.cardRadius}
  border 1px solid #E7EBF3

.snc-card-pad
  padding 28px 40px 0
  @media screen and (max-width: 600px)
    padding 22px 24px 0 !important

.snc-topbar
  width 100%
  margin 0 0 28px

.snc-topbar-left
  text-align left
  vertical-align middle

.snc-topbar-right
  text-align right
  vertical-align middle

.snc-badge
  display inline-block
  padding 7px 12px
  border-radius 6px
  background ${theme.badgeBg}
  color ${theme.badgeText}
  font-size 12px
  line-height 1
  font-weight 700
  letter-spacing .06em

.snc-greeting
  margin 0 0 18px
  color ${theme.titleColor}
  font-size 18px
  line-height 1.45
  font-weight 700
  text-align left

.snc-title
  margin 0 0 24px
  color ${theme.titleColor}
  font-size 54px
  line-height 1.05
  font-weight 700
  text-align left
  @media screen and (max-width: 600px)
    font-size 38px !important
    line-height 1.08 !important

.snc-title-hero
  font-size 58px
  line-height 1.03
  @media screen and (max-width: 600px)
    font-size 40px !important

.snc-title-compact
  font-size 44px
  line-height 1.08
  @media screen and (max-width: 600px)
    font-size 34px !important

.snc-copy
  margin 0
  color ${theme.bodyColor}
  font-size 18px
  line-height 1.56
  text-align left
  font-weight 400
  @media screen and (max-width: 600px)
    font-size 16px !important

.snc-copy-intro
  margin-bottom 22px

.snc-reason-title
  margin 0 0 14px
  color ${theme.titleColor}
  font-size 18px
  line-height 1.45
  font-weight 700
  text-align left

.snc-callout
  margin 0 0 28px
  padding 18px 22px
  border-left 4px solid ${theme.calloutBorder}
  background ${theme.calloutBg}

.snc-callout-copy
  margin 0
  color ${theme.titleColor}
  font-size 18px
  line-height 1.45
  text-align left
  font-weight 400

.snc-button-wrap
  width 100%
  margin 0 0 28px
  border-collapse collapse
  border-spacing 0

.snc-button-wrap td
  padding 0
  text-align left

.snc-button
  display inline-block
  min-width 240px
  box-sizing border-box
  padding 17px 26px
  border-radius ${theme.buttonRadius}
  background ${theme.buttonFill}
  border 2px solid ${theme.buttonBorder}
  color ${theme.buttonText} !important
  text-decoration none
  text-align center
  font-size 19px
  line-height 1.2
  font-weight 700
  @media screen and (max-width: 600px)
    min-width 100% !important
    font-size 17px !important

.snc-button-wide
  min-width 280px

.snc-button-compact
  min-width 204px

.snc-button-disabled
  opacity .76

.snc-copy-support
  margin-bottom 28px

.snc-copy-support a
  color #4F86FF !important
  text-decoration underline !important

.snc-card-ack
  padding 24px 40px 30px
  border-top 1px solid #E8EBF2
  @media screen and (max-width: 600px)
    padding 20px 24px 26px !important

.snc-ack
  margin 0
  color ${theme.mutedColor}
  font-size 18px
  line-height 1.5
  text-align left

.snc-footer
  background ${theme.pageBg} !important

.snc-footer-pad
  padding 24px 0 0

.snc-footer-address,
.snc-footer-warning
  margin 0 0 14px
  color #8C93A3
  font-size 12px
  line-height 18px
  text-align center

.snc-footer-links
  margin 0
  color #8C93A3
  font-size 12px
  line-height 18px
  text-align center

.snc-footer-links a
  color #8C93A3 !important
  text-decoration underline !important
`;
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

function renderAffPasswordResetMainStylus(mail) {
  const theme = buildAffPasswordResetThemeTokens(mail);
  return `
*
  font-family "Roboto", "Helvetica", "Arial", sans-serif !important
  -webkit-font-smoothing antialiased
  font-smoothing antialiased

html
  background ${theme.pageBg} !important

body
  margin 0 auto !important
  text-align center !important
  background ${theme.pageBg} !important

table.body
  background ${theme.pageBg} !important

.bg-col
  background ${theme.pageBg} !important

.center
  text-align center
  margin 0 auto

.qr-reset-page
  background ${theme.pageBg} !important

.qr-reset-shell
  width 520px
  margin 0 auto
  @media screen and (max-width: 600px)
    width 100% !important

.qr-reset-shell-wide
  width 580px
  @media screen and (max-width: 600px)
    width 100% !important

.qr-reset-shell-narrow
  width 460px
  @media screen and (max-width: 600px)
    width 100% !important

.qr-reset-logo
  float none
  display block
  margin 0 auto
  max-width 236px
  width 236px
  padding-top 18px
  padding-bottom 30px
  height auto
  @media screen and (max-width: 600px)
    max-width 200px !important
    width 200px !important
    padding-top 8px !important
    padding-bottom 22px !important

.qr-reset-logo-wide
  max-width 252px
  width 252px
  @media screen and (max-width: 600px)
    max-width 208px !important
    width 208px !important

.qr-reset-logo-compact
  max-width 196px
  width 196px
  @media screen and (max-width: 600px)
    max-width 176px !important
    width 176px !important

.qr-reset-card
  width 100%
  background ${theme.cardBg}
  border-radius ${theme.cardRadius}

.qr-reset-card-airy .qr-reset-card-pad
  padding 62px 60px 54px
  @media screen and (max-width: 600px)
    padding 36px 28px 30px !important

.qr-reset-card-compact .qr-reset-card-pad
  padding 48px 48px 40px
  @media screen and (max-width: 600px)
    padding 30px 24px 24px !important

.qr-reset-card-pad
  padding 58px 56px 48px
  @media screen and (max-width: 600px)
    padding 34px 26px 28px !important

.qr-reset-title
  margin 0 0 42px
  color ${theme.titleColor}
  font-size 62px
  line-height 1.03
  font-weight 700
  text-align left
  @media screen and (max-width: 600px)
    font-size 42px !important
    line-height 1.06 !important
    margin-bottom 28px !important

.qr-reset-title-hero
  font-size 68px
  @media screen and (max-width: 600px)
    font-size 44px !important

.qr-reset-title-compact
  font-size 54px
  line-height 1.06
  margin-bottom 34px
  @media screen and (max-width: 600px)
    font-size 38px !important

.qr-reset-copy
  margin 0
  color ${theme.bodyColor}
  font-size 19px
  line-height 1.54
  text-align left
  font-weight 400
  @media screen and (max-width: 600px)
    font-size 16px !important
    line-height 1.55 !important

.qr-reset-copy-intro
  margin-bottom 30px

.qr-reset-copy-lead
  margin-bottom 26px

.qr-reset-copy-warning
  margin-top 8px

.qr-reset-button-wrap
  width 100%
  margin 0 0 40px
  border-collapse collapse
  border-spacing 0

.qr-reset-button-wrap td
  padding 0
  text-align center

.qr-reset-button
  display inline-block
  width 100%
  max-width 520px
  box-sizing border-box
  padding 24px 22px
  border 2px solid ${theme.buttonBorder}
  border-radius ${theme.buttonRadius}
  color ${theme.buttonText} !important
  font-size 20px
  line-height 1.2
  font-weight 700
  letter-spacing .02em
  text-transform uppercase
  text-decoration none
  text-align center
  @media screen and (max-width: 600px)
    font-size 17px !important
    padding 20px 16px !important

.qr-reset-button-wide
  max-width 560px

.qr-reset-button-compact
  max-width 420px

.qr-reset-button-solid
  background ${theme.buttonFill}
  color ${theme.buttonText} !important

.qr-reset-support-wrap
  padding 42px 46px 24px
  @media screen and (max-width: 600px)
    padding 28px 20px 14px !important

.qr-reset-support-wrap-inline
  padding-top 28px
  @media screen and (max-width: 600px)
    padding-top 20px !important

.qr-reset-support
  margin 0
  color ${theme.supportColor}
  font-size 18px
  line-height 1.55
  text-align center
  font-weight 400
  @media screen and (max-width: 600px)
    font-size 16px !important

.qr-reset-legal-wrap
  padding 8px 0 0

.qr-reset-legal-text
  margin 0
  color ${theme.legalColor}
  font-size 12px
  line-height 18px
  text-align center

.qr-reset-legal-text a
  color ${theme.legalColor} !important
  text-decoration underline
`;
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

function renderPugBlocksIndexPug() {
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
    "",
    "        include ../../../../vendor/helpers/gmail-fix"
  ].join("\n");
}

function renderPugBlocksHeaderPug(pugBlocks) {
  // Each block is preceded by a comment label, then the actual pug_code.
  // Blocks are separated by a blank line for readability.
  return pugBlocks
    .map((b) => `// --- ${b.label} ---\n${b.pug_code}`)
    .join("\n\n");
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
  payload,
  pugBlocks = []
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
    const mainStylePath = path.join(stylesRoot, "blocks", "main.styl");

    await mkdir(path.join(templatesRoot, "blocks"), { recursive: true });
    await mkdir(path.join(templatesRoot, "helpers"), { recursive: true });
    await mkdir(path.join(stylesRoot, "blocks"), { recursive: true });
    await cp(referenceStylesRoot, stylesRoot, { recursive: true });
    if (existsSync(referenceAssetsRoot)) {
      await cp(referenceAssetsRoot, assetsRoot, { recursive: true });
    }
    await writeFile(templatePath, renderAffPasswordResetIndexPug(), "utf8");
    await writeFile(headerPath, renderAffPasswordResetHeaderPug(mail, translationFileKey), "utf8");
    await writeFile(footerPath, renderAffPasswordResetFooterPug(mail, translationFileKey), "utf8");
    await writeFile(mainStylePath, renderAffPasswordResetMainStylus(mail).trimStart(), "utf8");

    return {
      profile,
      templatePath,
      stylePath
    };
  }

  if (profile === "system-notice-card") {
    const referenceRoot = getSystemNoticeCardReferenceRoot();
    const referenceStylesRoot = path.join(referenceRoot, "app", "styles");
    const referenceAssetsRoot = path.join(referenceRoot, "app", "assets");
    const headerPath = path.join(templatesRoot, "blocks", "header.pug");
    const footerPath = path.join(templatesRoot, "helpers", "footer.pug");
    const mainStylePath = path.join(stylesRoot, "blocks", "main.styl");

    await mkdir(path.join(templatesRoot, "blocks"), { recursive: true });
    await mkdir(path.join(templatesRoot, "helpers"), { recursive: true });
    await mkdir(path.join(stylesRoot, "blocks"), { recursive: true });
    await cp(referenceStylesRoot, stylesRoot, { recursive: true });
    if (existsSync(referenceAssetsRoot)) {
      await cp(referenceAssetsRoot, assetsRoot, { recursive: true });
    }
    await writeFile(templatePath, renderSystemNoticeCardIndexPug(), "utf8");
    await writeFile(headerPath, renderSystemNoticeCardHeaderPug(mail, translationFileKey), "utf8");
    await writeFile(footerPath, renderSystemNoticeCardFooterPug(), "utf8");
    await writeFile(mainStylePath, renderSystemNoticeCardMainStylus(mail).trimStart(), "utf8");

    return {
      profile,
      templatePath,
      stylePath
    };
  }

  if (profile === "simple-system-card") {
    const referenceRoot = getSimpleSystemCardReferenceRoot();
    const referenceStylesRoot = path.join(referenceRoot, "app", "styles");
    const referenceAssetsRoot = path.join(referenceRoot, "app", "assets");
    const headerPath = path.join(templatesRoot, "blocks", "header.pug");
    const footerPath = path.join(templatesRoot, "helpers", "footer.pug");
    const mainStylePath = path.join(stylesRoot, "blocks", "main.styl");

    await mkdir(path.join(templatesRoot, "blocks"), { recursive: true });
    await mkdir(path.join(templatesRoot, "helpers"), { recursive: true });
    await mkdir(path.join(stylesRoot, "blocks"), { recursive: true });
    await cp(referenceStylesRoot, stylesRoot, { recursive: true });
    if (existsSync(referenceAssetsRoot)) {
      await cp(referenceAssetsRoot, assetsRoot, { recursive: true });
    }
    await writeFile(templatePath, renderSimpleSystemCardIndexPug(), "utf8");
    await writeFile(headerPath, renderSimpleSystemCardHeaderPug(mail, translationFileKey), "utf8");
    await writeFile(footerPath, renderSimpleSystemCardFooterPug(mail, translationFileKey), "utf8");
    await writeFile(mainStylePath, renderSimpleSystemCardMainStylus(mail).trimStart(), "utf8");

    return {
      profile,
      templatePath,
      stylePath
    };
  }

  await mkdir(templatesRoot, { recursive: true });
  await mkdir(stylesRoot, { recursive: true });
  await writeFile(stylePath, renderStudioCommonStylus().trimStart(), "utf8");

  // If the AI produced pug_blocks, write a proper vendor-mixin-based index.pug + blocks/header.pug.
  // Otherwise fall back to the legacy section-based template.
  if (Array.isArray(pugBlocks) && pugBlocks.length > 0) {
    const headerPath = path.join(templatesRoot, "blocks", "header.pug");
    await mkdir(path.join(templatesRoot, "blocks"), { recursive: true });
    await writeFile(templatePath, renderPugBlocksIndexPug(), "utf8");
    await writeFile(headerPath, renderPugBlocksHeaderPug(pugBlocks), "utf8");
    return {
      profile: `${profile}+pug_blocks`,
      templatePath,
      stylePath
    };
  }

  await writeFile(templatePath, renderStudioEmailBaseTemplate(mail, translationFileKey), "utf8");

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
  const selectionProfile = cleanText(selection?.profile);
  const inferredProfile = cleanText(getEmailBaseTemplateProfile(payload, payload?.currentDraft || {}));
  const templateRootExists = Boolean(
    category
    && mailId
    && existsSync(path.join(emailBaseRoot, category, `mail-${mailId}`, "app", "templates"))
  );
  if (!templateRootExists) {
    return false;
  }

  if (category === "X_IQ" && /^rfm-/i.test(mailId)) {
    return true;
  }

  // Special profiles already have dedicated email-base builders that produce
  // cleaner output than the raw reference template override flow.
  if (["aff-password-reset", "system-verification", "simple-system-card", "system-notice-card"].includes(selectionProfile)
    || ["aff-password-reset", "system-verification", "simple-system-card", "system-notice-card"].includes(inferredProfile)) {
    return false;
  }

  return Boolean(
    payload?.screenshotOcr?.usable
    && hasVisualDesignInput(payload)
    && !hasStructuredFigmaInput(payload)
    && !payload?.baseEmailHtml
    && cleanText(selection?.source) !== "fallback"
    && (Number(selection?.score) > 0 || cleanText(selection?.profile))
  );
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
        ...payload,
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
        ...payload,
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

  // Extract AI-generated pug_blocks from the draft (not stripped by normalizeMail).
  const pugBlocks = Array.isArray(mailSource?.pug_blocks)
    ? mailSource.pug_blocks.filter((b) => b && cleanText(b.label) && cleanText(b.pug_code))
    : [];
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
    payload,
    pugBlocks
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
      ...payload,
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

function buildNormalizedContentMapSections(contentMap) {
  if (!contentMap || typeof contentMap !== "object") {
    return [];
  }

  const preheader = cleanText(contentMap.preheader);
  const ctaLabels = new Set(
    (Array.isArray(contentMap.links) ? contentMap.links : [])
      .map((entry) => cleanText(entry?.text).toLowerCase())
      .filter(Boolean)
  );
  const sections = [];

  for (const entry of Array.isArray(contentMap.sections) ? contentMap.sections : []) {
    const text = cleanText(entry);
    const normalized = text.toLowerCase();

    if (!text) continue;
    if (preheader && text === preheader) continue;
    if (ctaLabels.has(normalized)) continue;
    if (/terms and unsubscribe|terms and conditions|unsubscribe|отписаться|условия и положения/i.test(text)) continue;
    if (sections.includes(text)) continue;

    sections.push(text);
  }

  return sections;
}

function pickContentMapHeading(contentMap, normalizedSections = []) {
  const sections = normalizedSections.length > 0
    ? normalizedSections
    : buildNormalizedContentMapSections(contentMap);

  return cleanText(
    sections.find((line) => line.length <= 140 && !/[.!?…:]\s*$/.test(line))
    || sections[0]
  );
}

function pickContentMapLead(contentMap, normalizedSections = []) {
  const sections = normalizedSections.length > 0
    ? normalizedSections
    : buildNormalizedContentMapSections(contentMap);
  const heading = pickContentMapHeading(contentMap, sections);

  return cleanText(
    sections.find((line) => line !== heading && line.length >= 48)
    || sections.find((line) => line !== heading)
    || contentMap?.preheader
  );
}

function buildTranslationEntryFromContentMap(contentMap, locale, mail, sourceName = "") {
  if (!contentMap || typeof contentMap !== "object") {
    return null;
  }

  const normalizedSections = buildNormalizedContentMapSections(contentMap);
  const heading = pickContentMapHeading(contentMap, normalizedSections);
  const lead = pickContentMapLead(contentMap, normalizedSections);
  const ctaLabels = Array.isArray(contentMap.links)
    ? contentMap.links
      .map((entry) => cleanText(entry?.text))
      .filter(Boolean)
      .slice(0, 3)
    : [];
  const bodyBlocks = normalizedSections.length > 0
    ? normalizedSections
    : Array.isArray(contentMap.sections)
      ? contentMap.sections.map(cleanText).filter(Boolean)
      : [];

  if (!cleanText(contentMap.subject) && !cleanText(contentMap.preheader) && !heading && bodyBlocks.length === 0 && ctaLabels.length === 0) {
    return null;
  }

  return normalizeTranslationEntry({
    locale: normalizeLocaleCode(locale) || normalizeLocaleCode(mail?.locale) || "en",
    subject: cleanText(contentMap.subject) || heading || cleanText(mail?.subject),
    preheader: cleanText(contentMap.preheader) || lead || cleanText(mail?.preheader),
    cta_labels: ctaLabels,
    notes: "Derived from attached base email HTML",
    body_blocks: bodyBlocks,
    source_name: sourceName || "clone-edit-base-email.txt"
  }, mail || {});
}

function upsertInlineStyleValue(styleText, property, value) {
  const propertyName = cleanText(property).toLowerCase();
  const nextValue = cleanText(value);
  const existing = cleanText(styleText);
  if (!propertyName || !nextValue) {
    return existing;
  }

  const declarations = existing
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean);
  let replaced = false;

  const nextDeclarations = declarations.map((item) => {
    const [rawName, ...rest] = item.split(":");
    const name = cleanText(rawName).toLowerCase();
    if (name !== propertyName) {
      return item;
    }
    replaced = true;
    return `${propertyName}: ${nextValue}`;
  });

  if (!replaced) {
    nextDeclarations.push(`${propertyName}: ${nextValue}`);
  }

  return nextDeclarations.join("; ");
}

function patchFirstTagInlineStyle(html, tagRegex, updates = {}) {
  let changed = false;
  const nextHtml = String(html || "").replace(tagRegex, (tag) => {
    let nextTag = tag;
    const styleMatch = nextTag.match(/\sstyle=(["'])([\s\S]*?)\1/i);
    let styleText = styleMatch ? styleMatch[2] : "";

    for (const [property, value] of Object.entries(updates || {})) {
      const nextStyle = upsertInlineStyleValue(styleText, property, value);
      if (nextStyle !== styleText) {
        styleText = nextStyle;
        changed = true;
      }
    }

    if (!changed) {
      return tag;
    }

    if (styleMatch) {
      nextTag = nextTag.replace(styleMatch[0], ` style="${styleText}"`);
    } else {
      nextTag = nextTag.replace(/<([a-z0-9:-]+)/i, `<$1 style="${styleText}"`);
    }

    return nextTag;
  });

  return { html: nextHtml, changed };
}

function patchHtmlFragmentStyle(fragment, updates = {}) {
  const rootTagMatch = String(fragment || "").match(/^<([a-z0-9:-]+)\b[\s\S]*?>/i);
  if (!rootTagMatch) {
    return { html: String(fragment || ""), changed: false };
  }

  const tagName = rootTagMatch[1];
  return patchFirstTagInlineStyle(String(fragment || ""), new RegExp(`<${tagName}\\b[\\s\\S]*?>`, "i"), updates);
}

function looksLikePrimaryCtaLabel(text) {
  const value = cleanText(stripTags(text || ""));
  if (!value || value.length > 160) {
    return false;
  }
  if (/unsubscribe|terms|privacy|conditions|отпис|услов/i.test(value)) {
    return false;
  }
  return /(set new password|reset password|leave review|trade|open|learn|start|continue|confirm|verify|download|join|log in|sign in|оставить|подтверд|сброс|парол|открыть|скачать|войти)/i.test(value);
}

function userRequestedBlankLinks(payload) {
  const latestUserMessage = cleanText(getLatestUserMessage(payload));
  return /(ссылк[^\n]{0,40}пуст|leave links empty|href empty|empty href|links? blank)/i.test(latestUserMessage);
}

function findFirstPrimaryCtaBlock(html) {
  const source = String(html || "");
  const tableRegex = /<table\b[\s\S]{0,2400}?<a\b[^>]*>([\s\S]{1,220}?)<\/a>[\s\S]{0,2400}?<\/table>/ig;
  let match = null;
  while ((match = tableRegex.exec(source))) {
    const tableHtml = match[0] || "";
    const tableText = cleanText(stripTags(tableHtml));
    const paragraphCount = (tableHtml.match(/<p\b/gi) || []).length;
    if (/<img\b/i.test(tableHtml) || paragraphCount > 1 || tableText.length > 260) {
      continue;
    }
    if (looksLikePrimaryCtaLabel(match[1])) {
      return {
        html: tableHtml,
        start: match.index,
        end: match.index + tableHtml.length,
        kind: "table"
      };
    }
  }

  const anchorRegex = /<a\b[^>]*>([\s\S]{1,220}?)<\/a>/ig;
  while ((match = anchorRegex.exec(source))) {
    if (looksLikePrimaryCtaLabel(match[1])) {
      return {
        html: match[0],
        start: match.index,
        end: match.index + match[0].length,
        kind: "anchor"
      };
    }
  }

  return null;
}

function applyDeterministicCloneEditFallback(payload) {
  const originalHtml = cleanText(payload?.baseEmailHtml);
  if (!originalHtml) {
    return { html: "", changed: false, appliedRules: [] };
  }

  const latestUserMessage = cleanText(getLatestUserMessage(payload));
  const wantsSpacing = /(отступ|spacing|space|gap|margin|padding|воздух)/i.test(latestUserMessage);
  const wantsMoveCtaUnderImage = /((кнопк|cta).*(под|после).*(картин|image|hero))|((кнопк|cta).*(над|before).*(текст|text))|((move|put).*(button|cta).*(under|below).*(image|picture))/i.test(latestUserMessage);
  const wantsEmptyLinks = userRequestedBlankLinks(payload);

  let html = originalHtml;
  let changed = false;
  const appliedRules = [];

  if (wantsEmptyLinks) {
    const nextHtml = html.replace(/href=(["'])(?!mailto:|tel:)[^"']*\1/gi, 'href=""');
    if (nextHtml !== html) {
      html = nextHtml;
      changed = true;
      appliedRules.push("blank-links");
    }
  }

  const firstImageMatch = html.match(/<img\b[^>]*>/i);
  if (firstImageMatch && (wantsSpacing || wantsMoveCtaUnderImage)) {
    const patchedImage = patchFirstTagInlineStyle(html, /<img\b[^>]*>/i, {
      "display": "block",
      "margin-bottom": wantsMoveCtaUnderImage ? "24px" : "20px"
    });
    if (patchedImage.changed) {
      html = patchedImage.html;
      changed = true;
      appliedRules.push("image-spacing");
    }
  }

  const ctaBlock = findFirstPrimaryCtaBlock(html);
  if (ctaBlock && (wantsSpacing || wantsMoveCtaUnderImage)) {
    const ctaStyled = patchHtmlFragmentStyle(ctaBlock.html, {
      "margin-top": wantsMoveCtaUnderImage ? "24px" : "16px",
      "margin-bottom": "24px"
    });

    let nextBlockHtml = ctaStyled.html;
    if (ctaBlock.kind === "anchor") {
      const anchorStyled = patchFirstTagInlineStyle(nextBlockHtml, /<a\b[^>]*>/i, {
        "display": "inline-block",
        "margin-top": wantsMoveCtaUnderImage ? "24px" : "16px",
        "margin-bottom": "24px"
      });
      nextBlockHtml = anchorStyled.html;
    }

    if (nextBlockHtml !== ctaBlock.html) {
      html = `${html.slice(0, ctaBlock.start)}${nextBlockHtml}${html.slice(ctaBlock.end)}`;
      changed = true;
      appliedRules.push("cta-spacing");
    }
  }

  if (wantsMoveCtaUnderImage) {
    const latestImageMatch = html.match(/<img\b[^>]*>/i);
    const latestCtaBlock = findFirstPrimaryCtaBlock(html);
    if (latestImageMatch && latestCtaBlock) {
      const imageEnd = latestImageMatch.index + latestImageMatch[0].length;
      const alreadyBelowImage = latestCtaBlock.start >= imageEnd
        && cleanText(stripTags(html.slice(imageEnd, latestCtaBlock.start))).length <= 2;

      if (!alreadyBelowImage) {
        const withoutCta = `${html.slice(0, latestCtaBlock.start)}${html.slice(latestCtaBlock.end)}`;
        const imageInWithoutCta = withoutCta.match(/<img\b[^>]*>/i);
        if (imageInWithoutCta) {
          const insertAt = imageInWithoutCta.index + imageInWithoutCta[0].length;
          html = `${withoutCta.slice(0, insertAt)}${latestCtaBlock.html}${withoutCta.slice(insertAt)}`;
          changed = true;
          appliedRules.push("cta-below-image");
        }
      }
    }
  }

  if ((wantsSpacing || wantsMoveCtaUnderImage) && ctaBlock) {
    const paragraphAfterCtaRegex = /(<\/(?:table|a)>)([\s\S]*?)(<p\b[^>]*>)/i;
    const nextHtml = html.replace(paragraphAfterCtaRegex, (full, closeTag, between, pTag) => {
      const patchedParagraph = patchFirstTagInlineStyle(pTag, /<p\b[^>]*>/i, {
        "margin-top": "24px"
      });
      return `${closeTag}${between}${patchedParagraph.html}`;
    });
    if (nextHtml !== html) {
      html = nextHtml;
      changed = true;
      appliedRules.push("text-spacing");
    }
  }

  return {
    html,
    changed,
    appliedRules
  };
}

function getCloneEditContentMap(payload) {
  const html = cleanText(payload?.baseEmailHtml);
  if (!html) {
    return null;
  }

  return payload?.baseEmailContentMap && typeof payload.baseEmailContentMap === "object"
    ? payload.baseEmailContentMap
    : extractEmailHtmlContentMap(html);
}

function buildResponseLayoutModel(result, payload) {
  if (!result || typeof result !== "object") {
    return null;
  }

  const draft = result?.draft && typeof result.draft === "object" ? result.draft : null;
  const currentDraft = payload?.currentDraft && typeof payload.currentDraft === "object" ? payload.currentDraft : null;
  const draftHtml = cleanText(draft?.html)
    || cleanText(draft?.mail?.html)
    || cleanText(currentDraft?.html)
    || cleanText(currentDraft?.mail?.html)
    || cleanText(payload?.baseEmailHtml);
  const contentMap = draftHtml
    ? extractEmailHtmlContentMap(draftHtml)
    : getCloneEditContentMap(payload);

  return buildLayoutModel({
    brief: payload?.brief,
    contentMap,
    screenshotOcr: payload?.screenshotOcr,
    designSchema: payload?.designSchema,
    designAnalysis: result?.designAnalysis || payload?.designAnalysis,
    draft
  });
}

function attachLayoutModelToChatResult(result, payload) {
  if (!result?.draft || typeof result.draft !== "object") {
    return result;
  }

  const layoutModel = buildResponseLayoutModel(result, payload);
  if (!layoutModel) {
    return result;
  }

  return {
    ...result,
    draft: {
      ...result.draft,
      layoutModelSummary: summarizeLayoutModel(layoutModel),
      layoutModelMeta: summarizeLayoutModelMeta(layoutModel)
    }
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
  if (/(нов(ое|ый)|друго(е|й)|сделай другое|на базе этого письма|по мотивам|similar|same structure|на основе этого письма)/i.test(latestUserMessage)) {
    intents.push("derive-new-email");
  }
  if (/(сохрани структуру|не меняй верстку|оставь структуру|preserve structure|same layout|same html)/i.test(latestUserMessage)) {
    intents.push("preserve-structure");
  }
  if (/(смени бренд|другой бренд|под другой бренд|rebrand|brand swap|logo|логотип|лого|цвет|footer|футер|store|stores|social|соц)/i.test(latestUserMessage)) {
    intents.push("brand-swap");
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
  if (contentMap?.sectionCount) {
    hints.push(`Visible text section count in base HTML: ${contentMap.sectionCount}`);
  }
  if (Array.isArray(contentMap?.images) && contentMap.images.length > 0) {
    hints.push(`Image count in base HTML: ${contentMap.images.length}`);
  }
  if (Array.isArray(contentMap?.links) && contentMap.links.length > 0) {
    hints.push(`Link count in base HTML: ${contentMap.links.length}`);
  }
  const likelyFooterLinks = Array.isArray(contentMap?.links)
    ? contentMap.links.filter((item) => /terms|unsubscribe|privacy|conditions|отпис|услов/i.test(`${item?.text || ""} ${item?.href || ""}`))
    : [];
  if (likelyFooterLinks.length > 0) {
    hints.push("Footer/legal links detected — preserve footer structure unless user explicitly asks to replace it.");
  }
  const storeBadgeImages = Array.isArray(contentMap?.images)
    ? contentMap.images.filter((src) => /app.?store|google.?play|play\.png|app\.png|badge/i.test(src))
    : [];
  if (storeBadgeImages.length > 0) {
    hints.push("Store badges detected — keep badge row ordering unless the user asks to change it.");
  }
  const logoLikeImage = Array.isArray(contentMap?.images)
    ? contentMap.images.find((src) => /logo|brand|header/i.test(src))
    : "";
  if (logoLikeImage) {
    hints.push(`Likely logo asset detected: ${logoLikeImage}`);
  }

  const preserveStructure = intents.includes("preserve-structure")
    || intents.includes("translate")
    || intents.includes("brand-swap")
    || intents.includes("rebrand");

  return {
    intents,
    summary: intents.length > 0 ? intents.join(", ") : "direct-edit",
    preserveStructure,
    requestedLocales,
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
  return getUserMessageContents(payload)
    .map(cleanText)
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
  const locales = matches
    .map((token) => allowed.get(token.toLowerCase()))
    .filter(Boolean);

  const keywordLocales = [
    [/(русск|russian)/i, "ru"],
    [/(англ|english)/i, "en"],
    [/(араб|arabic)/i, "ar"],
    [/(урду|urdu)/i, "ur"],
    [/(португ|portuguese)/i, "pt"],
    [/(немец|german)/i, "de"],
    [/(франц|french)/i, "fr"],
    [/(испан|spanish)/i, "es"],
    [/(италь|italian)/i, "it"]
  ]
    .filter(([pattern]) => pattern.test(source))
    .map(([, locale]) => locale);

  return Array.from(new Set([...locales, ...keywordLocales].filter(Boolean)));
}

function inferBriefCategoryFromMessages(payload) {
  const design = normalizeDesignPayload(payload?.design);
  const screenshotOcr = payload?.screenshotOcr && typeof payload.screenshotOcr === "object" ? payload.screenshotOcr : null;
  const source = [
    cleanText(getRecentUserTranscript(payload)),
    cleanText(payload?.brief?.designUrl),
    cleanText(design?.name),
    cleanText(design?.figmaSelectionName),
    cleanText(screenshotOcr?.title),
    Array.isArray(screenshotOcr?.bodyBlocks) ? screenshotOcr.bodyBlocks.map(cleanText).join("\n") : "",
    cleanText(screenshotOcr?.supportBody),
    cleanText(screenshotOcr?.footerBody)
  ].join("\n").toLowerCase();

  if (/(системн|технич|тех письмо|техническ|transactional|technical|service email|system email|password reset|reset your password|set your new password|confirm email|verify email|verification code|ignore this email)/i.test(source)) {
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
  const screenshotOcr = payload?.screenshotOcr && typeof payload.screenshotOcr === "object"
    ? payload.screenshotOcr
    : null;
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
  const screenshotOcrText = screenshotOcr
    ? [
        cleanText(screenshotOcr?.brandLine),
        cleanText(screenshotOcr?.layoutStyle),
        cleanText(screenshotOcr?.title),
        cleanText(screenshotOcr?.ctaLead),
        cleanText(screenshotOcr?.ctaLabel),
        ...(Array.isArray(screenshotOcr?.bodyBlocks) ? screenshotOcr.bodyBlocks.map(cleanText) : []),
        cleanText(screenshotOcr?.warningBody),
        cleanText(screenshotOcr?.supportBody),
        cleanText(screenshotOcr?.footerBody)
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
    screenshotOcrText,
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
  const rawSource = cleanText(sourceText).toLowerCase();
  const source = normalizeTemplateSelectionText(sourceText);
  const resolvedCategory = resolveBriefCategory(payload);
  const inferredRfmDigits = extractRfmVariantDigits(sourceText);
  const inferredRfmMailId = inferRfmReferenceMailId(sourceText);
  const brandHint = normalizeTemplateSelectionText(payload?.designAnalysis?.brand_hint);
  const affPasswordSignal = looksLikePasswordResetSelectionSignal(source);
  const affBrandSignal = brandHint.includes("affstore") || /affstore|affiliate/.test(source);
  const affInfrastructureSignal = (
    /affiliate[_-]embedded|affiliate_embedded_admin_domain_url|reset_password_link|support@quadcode\.com|quadcode/i.test(rawSource)
    || /affiliate embedded|affiliate embedded admin domain url|reset password link|support quadcode com|quadcode/i.test(source)
  );

  if (
    affPasswordSignal
    && (
      cleanText(resolvedCategory) === "X_AffSystem"
      || affBrandSignal
      || affInfrastructureSignal
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
    && looksLikeSystemVerificationSelectionSignal(source)
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

function looksLikePasswordResetSelectionSignal(source = "") {
  const normalized = normalizeTemplateSelectionText(source);
  if (!normalized) {
    return false;
  }

  return /(?:\bpassword\b|\breset\b|\blogin\b|\bsign in\b|\bsignin\b|\bsigning in\b|\bcreate account\b|парол|сброс|логин|аккаунт|senha|redefinir)/i.test(normalized);
}

function looksLikeSystemVerificationSelectionSignal(source = "") {
  const normalized = normalizeTemplateSelectionText(source);
  if (!normalized) {
    return false;
  }

  return /(?:passbook|bank passbook|payment verification|verification request|document|documents|declin|reject|reason_text|вериф|провер|документ|пасбук|паспорт|банк)/i.test(normalized);
}

function isStickyTemplateSelection(selection) {
  if (!selection || typeof selection !== "object") {
    return false;
  }

  const category = cleanText(selection.category);
  const mailId = cleanText(selection.mailId);
  const profile = cleanText(selection.profile);
  const source = cleanText(selection.source);

  if (!category || !mailId) {
    return false;
  }

  return Boolean(
    source === "special-case"
    || source === "ocr-special-case"
    || source === "manual"
    || (profile && profile !== "generic")
  );
}

function inferScreenshotTemplateSelectionOverride(payload) {
  const screenshotOcr = payload?.screenshotOcr && typeof payload.screenshotOcr === "object"
    ? payload.screenshotOcr
    : null;
  if (!screenshotOcr?.usable) {
    return null;
  }

  const rawSource = [
    cleanText(screenshotOcr?.brandLine),
    cleanText(screenshotOcr?.title),
    cleanText(screenshotOcr?.ctaLead),
    cleanText(screenshotOcr?.ctaLabel),
    ...(Array.isArray(screenshotOcr?.bodyBlocks) ? screenshotOcr.bodyBlocks.map(cleanText) : []),
    cleanText(screenshotOcr?.warningBody),
    cleanText(screenshotOcr?.supportBody),
    cleanText(screenshotOcr?.footerBody),
    cleanText(screenshotOcr?.layoutStyle),
    cleanText(getRecentUserTranscript(payload))
  ].filter(Boolean).join(" ").toLowerCase();
  const source = normalizeTemplateSelectionText(rawSource);
  const passwordSignal = looksLikePasswordResetSelectionSignal(source);
  const affiliateSignal = (
    /affiliate[_-]embedded|affiliate_embedded_admin_domain_url|reset_password_link|support@quadcode\.com|quadcode/i.test(rawSource)
    || /affiliate embedded|affiliate embedded admin domain url|reset password link|support quadcode com|quadcode/i.test(source)
  );
  const noticeSignal = /(system\s*notice|notice\s*email|copy\s*trading|paused|pause|suspend|suspended|suspension|reason for interruption|insufficient balance|support team|temporarily suspended)/i.test([
    rawSource,
    cleanText(payload?.message),
    cleanText(payload?.brief?.goal),
    cleanText(payload?.brief?.campaignName)
  ].filter(Boolean).join(" "));

  if (!passwordSignal && noticeSignal) {
    return {
      category: "X_System",
      mailId: "payment",
      profile: "system-notice-card",
      score: 6400,
      reasons: ["ocr special profile", "system notice card"],
      outlineKinds: ["text", "feature-list", "cta", "text", "footer"],
      source: "ocr-special-case"
    };
  }

  if (!passwordSignal || !affiliateSignal) {
    if (looksLikeSimpleSystemCardScreenshot(payload, payload?.currentDraft || {})) {
      const resolvedCategory = resolveBriefCategory(payload) || "X_System";
      return {
        category: resolvedCategory,
        mailId: cleanText(payload?.brief?.mailId) || inferMailIdForCategory(resolvedCategory),
        profile: "simple-system-card",
        score: 6200,
        reasons: ["ocr special profile", "centered transactional card"],
        outlineKinds: ["text", "cta", "text", "footer"],
        source: "ocr-special-case"
      };
    }

    return null;
  }

  return {
    category: "X_AffSystem",
    mailId: "password-retrieving-affiliate",
    profile: "aff-password-reset",
    score: 6500,
    reasons: ["ocr special profile", "affiliate password reset", affiliateSignal ? "ocr:affiliate-infra" : ""].filter(Boolean),
    outlineKinds: ["text", "cta", "text", "text", "footer"],
    source: "ocr-special-case"
  };
}

function resolveReferenceTemplateSelection(payload) {
  const summary = summarizeEmailBase();
  const resolvedCategory = resolveBriefCategory(payload);
  const scopedCategory = cleanText(resolvedCategory);
  const explicitMailId = cleanText(payload?.brief?.mailId);
  const screenshotOverride = inferScreenshotTemplateSelectionOverride(payload);
  if (screenshotOverride) {
    return screenshotOverride;
  }
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
  const screenshotOverride = inferScreenshotTemplateSelectionOverride(payload);
  if (screenshotOverride) {
    return screenshotOverride;
  }

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

  if (payload?.localeAuditMode) {
    return "discuss";
  }

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

function getUserMessageContents(payload) {
  const contents = [
    ...(Array.isArray(payload?.messages) ? payload.messages : [])
      .filter((message) => message.role === "user")
      .map((message) => cleanText(message.content)),
    cleanText(payload?.message)
  ].filter(Boolean);

  return Array.from(new Set(contents));
}

function extractLatestLogoOverrideUrl(payload) {
  const messages = [...getUserMessageContents(payload)].reverse();

  for (const content of messages) {
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
            prep: image.prep && typeof image.prep === "object"
              ? {
                  recommendedFormat: cleanText(image.prep.recommendedFormat || image.prep.format),
                  transparency: cleanText(image.prep.transparency),
                  trim: cleanText(image.prep.trim),
                  padding: Number.isFinite(Number(image.prep.padding)) ? Number(image.prep.padding) : 0,
                  placement: cleanText(image.prep.placement),
                  postProcess: Array.isArray(image.prep.postProcess)
                    ? image.prep.postProcess.map(cleanText).filter(Boolean).slice(0, 12)
                    : []
                }
              : null,
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
    ...buildFigmaResponseMetadata(payload),
    providerRuntime: createProviderRuntime({
      providerId,
      mode
    })
  };
}

function buildFigmaResponseMetadata(payload) {
  const intake = payload?.intake && typeof payload.intake === "object"
    ? payload.intake
    : null;
  const figmaEnrichment = payload?.figmaEnrichment && typeof payload.figmaEnrichment === "object"
    ? payload.figmaEnrichment
    : hasDetailedFigmaImportPayload(payload?.design?.figmaImport)
      ? {
          source: cleanText(payload?.design?.figmaImport?.source) || "structured-import",
          structured: true,
          structuredCoverage: summarizeNormalizedFigmaImportCoverage(payload?.design?.figmaImport),
          summary: buildFigmaIntakeSummary({
            figmaImport: payload?.design?.figmaImport,
            readiness: assessFigmaIntakeReadiness(cleanText(payload?.brief?.designUrl), {
              hasStructured: true,
              hasVisual: Boolean(cleanText(payload?.design?.dataUrl))
            }),
            importMethod: cleanText(payload?.design?.figmaImport?.source) || "structured-import",
            hasLink: Boolean(cleanText(payload?.brief?.designUrl)),
            hasVisual: Boolean(cleanText(payload?.design?.dataUrl))
          }).text
        }
      : null;

  return {
    intake,
    figmaEnrichment
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
  const readiness = assessFigmaIntakeReadiness(designUrl, {
    hasVisual,
    hasStructured
  });
  const importMethod = hasStructured
    ? cleanText(figmaImport?.source) || (readiness.preferredPath === "plugin-push" ? "figma-plugin" : "structured-import")
    : "";
  const intakeSummary = buildFigmaIntakeSummary({
    figmaImport,
    readiness,
    importMethod,
    hasLink,
    hasVisual
  });
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
      importMethod,
      structuredCoverage: intakeSummary.coverage,
      summary: intakeSummary.text,
      recommendedNextStep,
      readiness
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
  const readiness = assessFigmaIntakeReadiness(figmaUrl, {
    hasVisual: Boolean(cleanText(mergedDesign?.dataUrl)),
    hasStructured: true
  });
  const intakeSummary = buildFigmaIntakeSummary({
    figmaImport: mergedDesign?.figmaImport,
    readiness,
    importMethod: "figma-server-token",
    hasLink: true,
    hasVisual: Boolean(cleanText(mergedDesign?.dataUrl))
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
      structured: true,
      readiness,
      importMethod: "figma-server-token",
      structuredCoverage: intakeSummary.coverage,
      summary: intakeSummary.text
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
  const screenshotVisualFlow = Boolean(payload?.screenshotOcr?.usable && hasVisualDesignInput(payload) && !payload?.baseEmailHtml);
  const templateProfile = cleanText(getEmailBaseTemplateProfile(payload, mail));
  const specialScreenshotProfile = screenshotVisualFlow && ["aff-password-reset", "system-verification", "simple-system-card", "system-notice-card"].includes(templateProfile);
  const visualAssetSections = sections.filter((section) => {
    const kind = cleanText(section?.kind);
    return Boolean(
      cleanText(section?.image_key)
      || cleanText(section?.image_url)
      || cleanText(section?.image_notes)
      || ["image", "hero"].includes(kind)
    );
  });

  if (specialScreenshotProfile && visualAssetSections.length === 0) {
    return [];
  }

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
    const sectionKind = cleanText(section?.kind) || "text";
    const sectionNeedsVisualAsset = Boolean(
      cleanText(section?.image_key)
      || cleanText(section?.image_url)
      || cleanText(section?.image_notes)
      || ["image", "hero"].includes(sectionKind)
    );

    if (specialScreenshotProfile && !sectionNeedsVisualAsset) {
      continue;
    }

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
      sectionKind,
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

  const normalizeVisualHints = (rawHints) => normalizeVisualStyleHints({
    titleScale: cleanText(rawHints?.titleScale ?? rawHints?.title_scale),
    logoScale: cleanText(rawHints?.logoScale ?? rawHints?.logo_scale),
    cardWidth: cleanText(rawHints?.cardWidth ?? rawHints?.card_width),
    buttonWidth: cleanText(rawHints?.buttonWidth ?? rawHints?.button_width),
    buttonTone: cleanText(rawHints?.buttonTone ?? rawHints?.button_tone),
    cardShape: cleanText(rawHints?.cardShape ?? rawHints?.card_shape),
    buttonShape: cleanText(rawHints?.buttonShape ?? rawHints?.button_shape),
    cardDensity: cleanText(rawHints?.cardDensity ?? rawHints?.card_density),
    supportLayout: cleanText(rawHints?.supportLayout ?? rawHints?.support_layout),
    layoutStyle: cleanText(rawHints?.layoutStyle ?? rawHints?.layout_style),
    pageBgColor: cleanText(rawHints?.pageBgColor ?? rawHints?.page_bg_color),
    cardBgColor: cleanText(rawHints?.cardBgColor ?? rawHints?.card_bg_color),
    titleColor: cleanText(rawHints?.titleColor ?? rawHints?.title_color),
    bodyColor: cleanText(rawHints?.bodyColor ?? rawHints?.body_color),
    accentColor: cleanText(rawHints?.accentColor ?? rawHints?.accent_color),
    buttonFillColor: cleanText(rawHints?.buttonFillColor ?? rawHints?.button_fill_color),
    buttonBorderColor: cleanText(rawHints?.buttonBorderColor ?? rawHints?.button_border_color),
    buttonTextColor: cleanText(rawHints?.buttonTextColor ?? rawHints?.button_text_color),
    notes: cleanText(rawHints?.notes)
  });

  return {
    summary: cleanText(rawAnalysis.summary),
    reference_family: cleanText(rawAnalysis.reference_family),
    reference_variant: cleanText(rawAnalysis.reference_variant),
    brand_hint: cleanText(rawAnalysis.brand_hint),
    visual_hints: normalizeVisualHints(rawAnalysis.visual_hints),
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
    `Visual hints: layout=${cleanText(normalized.visual_hints?.layoutStyle) || "default"} | title=${cleanText(normalized.visual_hints?.titleScale) || "default"} | logo=${cleanText(normalized.visual_hints?.logoScale) || "default"} | button=${cleanText(normalized.visual_hints?.buttonTone) || "solid"}/${cleanText(normalized.visual_hints?.buttonWidth) || "default"} | card=${cleanText(normalized.visual_hints?.cardDensity) || "default"}/${cleanText(normalized.visual_hints?.cardShape) || "soft"}/${cleanText(normalized.visual_hints?.cardWidth) || "default"} | support=${cleanText(normalized.visual_hints?.supportLayout) || "default"} | colors=${[cleanText(normalized.visual_hints?.pageBgColor), cleanText(normalized.visual_hints?.cardBgColor), cleanText(normalized.visual_hints?.titleColor), cleanText(normalized.visual_hints?.accentColor)].filter(Boolean).join("/") || "default"}`,
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

function summarizeFigmaEnrichmentForContext(payload) {
  const enrichment = payload?.figmaEnrichment && typeof payload.figmaEnrichment === "object"
    ? payload.figmaEnrichment
    : null;
  const intake = payload?.intake && typeof payload.intake === "object"
    ? payload.intake
    : null;

  if (!enrichment && !intake) {
    return "Figma intake enrichment: none.";
  }

  const coverage = enrichment?.structuredCoverage && typeof enrichment.structuredCoverage === "object"
    ? enrichment.structuredCoverage
    : intake?.structuredCoverage && typeof intake.structuredCoverage === "object"
      ? intake.structuredCoverage
      : null;

  return [
    `Figma intake enrichment: ${cleanText(enrichment?.source) || cleanText(intake?.importMethod) || "present"}.`,
    cleanText(enrichment?.figmaUrl) ? `Figma source URL: ${cleanText(enrichment.figmaUrl)}` : "",
    cleanText(enrichment?.summary) || cleanText(intake?.summary),
    cleanText(enrichment?.readiness?.readiness) ? `Figma readiness: ${cleanText(enrichment.readiness.readiness)}` : "",
    coverage?.available
      ? `Figma coverage: ${normalizePositiveInt(coverage.sectionCount)} sections, ${normalizePositiveInt(coverage.textCount)} texts, ${normalizePositiveInt(coverage.imageCount)} images.`
      : "",
    Array.isArray(coverage?.sectionRoles) && coverage.sectionRoles.length > 0 ? `Figma section roles: ${coverage.sectionRoles.join(" | ")}` : "",
    Array.isArray(coverage?.imageRoles) && coverage.imageRoles.length > 0 ? `Figma image roles: ${coverage.imageRoles.join(" | ")}` : ""
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
  const rawDesign = payload?.design && typeof payload.design === "object"
    ? payload.design
    : {};
  const design = normalizeDesignPayload({
    ...rawDesign,
    figmaImport: rawDesign.figmaImport || payload?.figmaImport,
    figmaFileKey: cleanText(rawDesign.figmaFileKey) || cleanText(payload?.figmaFileKey),
    figmaNodeId: cleanText(rawDesign.figmaNodeId) || cleanText(payload?.figmaNodeId),
    figmaSelectionName: cleanText(rawDesign.figmaSelectionName) || cleanText(payload?.figmaSelectionName)
  });
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
    message: cleanText(payload?.message),
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
    screenshotOcr: normalizeScreenshotOcrPayload(payload?.screenshotOcr),
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
    pugSourceMode: Boolean(payload?.pugSourceMode),
    pugSourceFiles: payload?.pugSourceFiles && typeof payload.pugSourceFiles === "object"
      ? payload.pugSourceFiles
      : null,
    localeAuditMode: Boolean(payload?.localeAuditMode),
    // Locale namespaces snapshot from the workbench — нужен AI-диспетчеру
    // (placeholderize / translate / fix-locale). Раньше whitelist его ВЫБРАСЫВАЛ,
    // и сервер отвечал «Не вижу загруженных локалей» при загруженных локалях.
    namespaces: Array.isArray(payload?.namespaces) ? payload.namespaces : [],
    activeNamespaceName: cleanText(payload?.activeNamespaceName) || null,
    activeNamespaceId: cleanText(payload?.activeNamespaceId) || null,
    activeLocale: cleanText(payload?.activeLocale) || null,
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
  const stickySelection = isStickyTemplateSelection(payload?.templateSelection)
    ? payload.templateSelection
    : inferScreenshotTemplateSelectionOverride({
      ...payload,
      design,
      designAnalysis,
      designSchema,
      designDecomposition,
      designMappingHints,
      designBlockRecommendations
    });

  return {
    ...payload,
    design,
    designAnalysis,
    designSchema,
    designDecomposition,
    designMappingHints,
    designBlockRecommendations,
    templateSelection: stickySelection || resolveReferenceTemplateSelection({
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
    "- Default to the smallest possible HTML diff.",
    "- Preserve all HTML structure, table layouts, inline CSS, comments, and service tags unless the requested change requires touching them.",
    "- Only replace content the user explicitly asks to change (text, image URLs, href links).",
    "- If the user asks to translate, translate visible copy while preserving placeholders and structure.",
    "- For RU translation, keep copy length reasonably close to the original where possible so the layout remains stable.",
    "- If the user asks to rebrand, preserve layout first and only change brand-facing content/assets the user requested.",
    "- If the user asks to create a NEW email based on this one, keep the same structural skeleton by default and only rewrite the visible content/assets needed for the new purpose.",
    "- Keep footer/legal/store/social rows unless the user explicitly asks to remove or replace them.",
    "- If you move a CTA/button, keep the result visually sane by default: remove duplicates, preserve centering/alignment, and add spacing between the moved CTA and neighboring blocks.",
    "- Reuse the email's existing spacing scale where possible. If spacing is unclear, choose conservative email-safe gaps instead of leaving blocks stuck together.",
    "- If subject/preheader should change, update mail.subject and mail.preheader accordingly.",
    "- Do not restructure sections or change the number of blocks unless explicitly asked.",
    "- Keep href values unchanged unless the user explicitly asks to change links.",
    "- OUTPUT: return the COMPLETE modified HTML string in mail.modified_html.",
    "- mail.modified_html must contain the full <html>…</html> document, not a diff or snippet.",
    "",
    `File size: ${map.charCount ? Math.round(map.charCount / 1024) + "KB" : "unknown"}`,
    `Visible text blocks: ${map.sectionCount || 0}`,
    `Image count: ${Array.isArray(map.images) ? map.images.length : 0}`,
    `Link count: ${Array.isArray(map.links) ? map.links.length : 0}`,
    `Detected edit mode: ${cloneEditHints.summary}`,
    cloneEditHints.preserveStructure ? "Preserve structure: yes" : "Preserve structure: only if user asks",
    map.subject ? `Subject in HTML: ${map.subject}` : "",
    map.preheader ? `Preheader: ${map.preheader}` : "",
    ...(Array.isArray(cloneEditHints.hints) ? cloneEditHints.hints : []),
    "",
    // ── Detailed element inventory — helps AI locate elements before touching HTML ──
    (() => {
      const parts = [];
      // CTA buttons / links with visible text
      const ctaLinks = Array.isArray(map.links) ? map.links.filter((l) => l.text && l.href) : [];
      if (ctaLinks.length > 0) {
        parts.push("CTA buttons / clickable links in this email (text → href):");
        for (const l of ctaLinks.slice(0, 10)) {
          parts.push(`  • "${l.text}" → ${l.href.slice(0, 80)}${l.href.length > 80 ? "…" : ""}`);
        }
      }
      // Images (skip tiny icons)
      const imgs = Array.isArray(map.images) ? map.images : [];
      if (imgs.length > 0) {
        parts.push("Images in this email (top-to-bottom order):");
        for (const src of imgs.slice(0, 12)) {
          const label = /logo|brand|header/i.test(src) ? "logo"
            : /hero|banner|cover|main/i.test(src) ? "hero"
            : /store|badge|app|play/i.test(src) ? "store-badge"
            : /social|fb|ig|tw|vk/i.test(src) ? "social"
            : "image";
          parts.push(`  • [${label}] ${src.slice(0, 100)}${src.length > 100 ? "…" : ""}`);
        }
      }
      // First 5 text sections for orientation
      const secs = Array.isArray(map.sections) ? map.sections.filter(Boolean) : [];
      if (secs.length > 0) {
        parts.push("Main visible text blocks (excerpt, top-to-bottom):");
        for (const s of secs.slice(0, 5)) {
          parts.push(`  • "${s.slice(0, 120)}${s.length > 120 ? "…" : ""}"`);
        }
      }
      return parts.join("\n");
    })(),
    "",
    "=== END BASE EMAIL CONTEXT ===",
    "The full HTML will be appended separately. Edit it according to user instructions.",
    "IMPORTANT: Before writing any HTML, mentally identify WHERE each element to change is located in the HTML above. Then apply the smallest possible correct edit."
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
    const primaryLocale = normalizeLocaleCode(payload.brief.locale || payload?.currentDraft?.mail?.locale || "en");
    const requestedLocales = Array.from(new Set([
      primaryLocale,
      ...parseLocaleList(payload.brief.requestedLocales)
    ].filter(Boolean)));
    return [
      "CLONE-EDIT MODE. Edit the HTML email appended below. Return the result in mail.modified_html.",
      buildResponseLanguageInstruction(payload),
      `Primary locale for mail.modified_html: ${primaryLocale}`,
      `Requested locales: ${requestedLocales.join(", ")}`,
      requestedLocales.length > 1
        ? "Return mail.localized_html with a full HTML document for each requested locale."
        : "If only one locale is requested, mail.localized_html may contain just that primary locale.",
      "Do not return a plan, a checklist, or follow-up questions. Execute the edit now.",
      "Do not return one combined bilingual HTML document. Keep locales as separate full HTML files.",
      `Campaign name: ${payload.brief.campaignName || "Untitled campaign"}`,
      `Detected clone-edit intent: ${cloneEditHints.summary}`,
      `Preserve structure: ${cloneEditHints.preserveStructure ? "yes" : "only if user explicitly asks"}`,
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
    (() => {
      const bs = payload.brief?.brandStyle;
      if (!bs || typeof bs !== "object") return "";
      const parts = [];
      if (bs.primaryColor) parts.push(`primaryColor: ${bs.primaryColor}`);
      if (bs.buttonTextColor) parts.push(`buttonTextColor: ${bs.buttonTextColor}`);
      if (bs.bgColor) parts.push(`bgColor: ${bs.bgColor}`);
      if (bs.buttonRadius) parts.push(`buttonRadius: ${bs.buttonRadius}`);
      if (bs.bodySize) parts.push(`bodySize: ${bs.bodySize}`);
      return parts.length > 0 ? `Brand style overrides (use these in pug_blocks, override studio defaults): ${parts.join(", ")}` : "";
    })(),
    `Design input type: ${summarizeDesignInputForContext(payload)}`,
    `Design URL: ${payload.brief.designUrl || "None"}`,
    "Figma access rule: if the user provides only a Figma link and direct access is unclear, ask for an open draft/share link or a screenshot/export of the exact frame. Do not ask for raw JSON unless the workflow is explicitly advanced/internal.",
    "Blocking rule: if there is only an inaccessible/private Figma link, do not fabricate a generic email layout. Ask only for an open draft/share link or a PNG/JPG export of the exact frame.",
    "Copy rule: if the user says copy can stay empty for now, leave strings empty and keep moving once the design itself is accessible.",
    "Figma structured input:",
    summarizeFigmaImportForContext(payload),
    "Figma intake enrichment:",
    summarizeFigmaEnrichmentForContext(payload),
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
    buildVendorMixinsReference(),
    buildMarkupPatternsReference(),
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


// ─── Workbench namespace summary for AI chat context ─────────────────────
// When the user is in the workbench (RetKit) and has loaded one or more
// locale namespaces (TXT files), the chat payload includes `namespaces` —
// an array of { namespace, locales: { code: blocks[] } }. The plain
// discussion path used to ignore this, so the AI would say "load locales
// first" even when 14 blocks were sitting right there. This summary fixes
// that by surfacing the loaded namespaces (with block counts and the first
// 6 reference-text blocks) into the prompt.
function summarizeWorkbenchNamespacesForContext(payload) {
  const arr = Array.isArray(payload?.namespaces) ? payload.namespaces : null;
  if (!arr || !arr.length) return "Loaded namespaces: (none — the user has not opened a locale folder yet)";

  const lines = [`Loaded namespaces (${arr.length}):`];
  for (const ns of arr.slice(0, 8)) {
    // workbench sends ns.name; older payloads used ns.namespace — accept both.
    const name = cleanText(ns?.namespace) || cleanText(ns?.name) || "?";
    const locales = ns?.locales && typeof ns.locales === "object" ? ns.locales : {};
    const codes = Object.keys(locales);
    const blockCounts = codes.map((c) => `${c}:${(locales[c] || []).length}`).join(", ");
    lines.push(`  • ${name}  [${blockCounts}]`);
    // Show a few reference blocks (prefer 'en') so AI sees actual content.
    const refCode = locales.en ? "en" : codes[0];
    const refBlocks = Array.isArray(locales[refCode]) ? locales[refCode] : [];
    refBlocks.slice(0, 6).forEach((b, i) => {
      const txt = String(b || "").replace(/@@/g, "").slice(0, 80);
      if (txt) lines.push(`      block_${String(i).padStart(2, "0")} (${refCode}): "${txt}"`);
    });
    if (refBlocks.length > 6) lines.push(`      …и ещё ${refBlocks.length - 6} блоков`);
  }
  if (arr.length > 8) lines.push(`  …и ещё ${arr.length - 8} namespace(s) загружены.`);
  return lines.join("\n");
}

// Surface the email source currently open in the workbench editor (HTML or
// Pug), so AI can analyze it without us streaming the whole file twice.
function summarizeWorkbenchOpenSourceForContext(payload) {
  const html = String(payload?.baseEmailHtml || "").trim();
  if (html) {
    const head = html.slice(0, 600);
    const tail = html.length > 1200 ? `\n…[truncated ${html.length - 1200} chars]…\n` + html.slice(-600) : "";
    return `Open HTML in editor (${html.length} chars):\n--- begin ---\n${head}${tail}\n--- end ---`;
  }
  const pug = payload?.pugSourceFiles && typeof payload.pugSourceFiles === "object" ? payload.pugSourceFiles : null;
  if (pug) {
    const entries = Object.entries(pug).filter(([, c]) => typeof c === "string" && c.trim());
    if (entries.length) {
      const [pPath, pContent] = entries[0];
      const head = pContent.slice(0, 600);
      return `Open Pug in editor: ${pPath} (${pContent.length} chars):\n--- begin ---\n${head}\n--- end ---`;
    }
  }
  return "Open editor source: (no HTML or Pug currently open)";
}

function buildDiscussionContext(payload) {
  const emailBaseSummary = summarizeEmailBase();
  const templateSelection = getReferenceTemplateSelection(payload);
  const transcript = payload.messages
    .map((message) => `${message.role === "assistant" ? "Assistant" : "User"}: ${cleanText(message.content)}`)
    .join("\n");

  if (payload.localeAuditMode) {
    return [
      "Locale audit request inside RetKit email studio.",
      buildResponseLanguageInstruction(payload),
      "Focus only on translation/locale QA unless the user explicitly asks for email layout work.",
      "Do not propose assembling a new email draft as the next step.",
      `Current base mail: ${emailBaseSummary.currentMail?.folder || "None"}`,
      `Content notes/context: ${payload.brief.contentNotes || "None"}`,
      "Workbench locale state:",
      summarizeWorkbenchNamespacesForContext(payload),
      "Workbench editor source:",
      summarizeWorkbenchOpenSourceForContext(payload),
      "Conversation transcript:",
      transcript || "User: Please audit the loaded translations."
    ].filter(Boolean).join("\n");
  }

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
    `Content notes/context: ${payload.brief.contentNotes || "None"}`,
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
    "Figma intake enrichment:",
    summarizeFigmaEnrichmentForContext(payload),
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
    buildVendorMixinsReference(),
    buildMarkupPatternsReference(),
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
    "Workbench locale state:",
    summarizeWorkbenchNamespacesForContext(payload),
    "Workbench editor source:",
    summarizeWorkbenchOpenSourceForContext(payload),
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

  // Pug source editing mode: inject source files for developer-style editing
  if (payload.pugSourceMode && payload.pugSourceFiles) {
    const filesBlock = Object.entries(payload.pugSourceFiles)
      .map(([path, content]) => `=== ${path} ===\n${content}\n=== END ${path} ===`)
      .join('\n\n');
    content.push({
      type: "input_text",
      text: `SOURCE FILES (edit these and return changed file(s) as fenced code blocks):\n\n${filesBlock}`
    });
  }

  // Clone & Edit: append full base HTML so AI can edit it and return mail.modified_html
  if (payload.baseEmailHtml && !payload.pugSourceMode) {
    content.push({
      type: "input_text",
      text: `=== FULL BASE EMAIL HTML (edit this, return complete result in mail.modified_html) ===\n${payload.baseEmailHtml}\n=== END BASE EMAIL HTML ===`
    });
  }

  const activeSystemPrompt = payload.localeAuditMode
    ? localeAuditSystemPrompt
    : payload.pugSourceMode
      ? pugSourceEditSystemPrompt
      : payload.baseEmailHtml
        ? cloneEditSystemPrompt
        : systemPrompt;

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
        text: payload.localeAuditMode
          ? localeAuditSystemPrompt
          : "You are a live email strategist inside a collaborative email-studio. Reply in the user's language. Be concise and practical. Prefer making a concrete proposal first. Ask at most two blocking follow-up questions. If a CTA URL is missing, leave href empty instead of blocking the draft. Do not claim you started background work and do not say you will send code later."
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
        "Also set analysis.visual_hints for the visible shell: centered card vs multi-band, title scale, logo scale, card width, CTA style (outline/solid, wide/default/compact), card density, support placement, approximate page/card/title/body/accent/button colors, and card/button corner shape.",
        "Figma structured input:",
        summarizeFigmaImportForContext(payload),
        "Figma intake enrichment:",
        summarizeFigmaEnrichmentForContext(payload),
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
        emailBaseSummary.available ? emailBaseSummary.technology.join(", ") : "Not attached",
        "=== EMAIL BASE BLOCK CATALOG (map each design section to these specific blocks) ===",
        buildEmailBaseDeepContext()
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
          "Your output is used directly to assemble a production email — be precise and specific.",
          "Reply in the user's language. Do not write HTML.",
          "",
          "ANALYSIS APPROACH — think step by step:",
          "  1. Scan the image top-to-bottom and identify every distinct visual section.",
          "  2. For each section: what kind is it? what text is visible? is there an image? is there a button?",
          "  3. Map each section to the closest block kind (see below).",
          "  4. If the email base catalog is provided, also suggest the specific block ID that best matches.",
          "  5. Extract all brand colors, corner radii, and layout style from what you can see.",
          "  6. Note any images that will need to be exported/extracted from Figma.",
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
          "  title        — visible headline text (quote EXACTLY if possible, leave empty if not present)",
          "  body         — visible paragraph/body text (quote EXACTLY if possible, leave empty if not present)",
          "  cta_label    — visible button label (quote EXACTLY, leave empty if no button in this section)",
          "  has_image    — true if the section contains an image, false otherwise",
          "  image_notes  — describe the image: what it shows, approximate dimensions, position (e.g. 'full-width hero banner showing trading chart, ~600×400px')",
          "  layout_notes — layout details: column count, background color, text alignment, whether image is bg vs inline",
          "",
          "IMAGE EXTRACTION NOTES (critical for Figma workflows):",
          "  For every image you see, note in image_notes whether it looks like:",
          "  - A hero/banner (full width, decorative) → will need export at 600px width",
          "  - A feature icon (small, ~48-80px) → will need export at 2x",
          "  - A logo → will need export as PNG with transparent background",
          "  - A product screenshot or app mockup → will need export at actual display size",
          "",
          "Extract visible template family, variant, and brand from labels or layer names.",
          "Set reference_family, reference_variant, brand_hint to empty strings if not visible.",
          "",
          "Also return visual_hints based on the visible shell.",
          "  layout_style   — centered-transactional-card | hero-promo-band | multi-band | plain | ''",
          "  title_scale    — hero | default | compact",
          "  logo_scale     — wide | default | compact",
          "  card_width     — wide | default | narrow",
          "  button_width   — wide | default | compact",
          "  button_tone    — outline | solid",
          "  card_shape     — sharp | soft | round",
          "  button_shape   — sharp | soft | pill",
          "  card_density   — airy | default | compact",
          "  support_layout — detached | default | inline",
          "  page_bg_color      — approximate dominant page background hex like #F3F4FA or '' if unclear",
          "  card_bg_color      — approximate card/panel fill hex like #FFFFFF or '' if unclear",
          "  title_color        — approximate headline color hex or '' if unclear",
          "  body_color         — approximate body text color hex or '' if unclear",
          "  accent_color       — main accent/brand color hex or '' if unclear",
          "  button_fill_color  — fill color for solid CTA or '' if unclear",
          "  button_border_color — outline/border color for CTA or '' if unclear",
          "  button_text_color  — CTA text color hex or '' if unclear",
          "  notes          — short practical note about the visible spacing/shape style"
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
  const screenshotOcr = payload?.screenshotOcr && typeof payload.screenshotOcr === "object" ? payload.screenshotOcr : null;
  const ocrBodyPreview = Array.isArray(screenshotOcr?.bodyBlocks) ? screenshotOcr.bodyBlocks.slice(0, 3) : [];
  const ocrSectionKinds = screenshotOcr?.usable
    ? [
        cleanText(screenshotOcr?.title) ? "text" : "",
        cleanText(screenshotOcr?.ctaLabel) ? "cta" : "",
        cleanText(screenshotOcr?.supportBody || screenshotOcr?.footerBody) ? "footer" : ""
      ].filter(Boolean)
    : [];
  const analysis = normalizeDesignAnalysis({
    summary: hasDesign
      ? screenshotOcr?.usable
        ? `Есть design reference (${designInputType}). Live vision недоступен, но локальный OCR fallback распознал часть текста и базовую структуру.`
        : `Есть design reference (${designInputType}), но mock-режим не анализирует изображение по содержанию. Можно только использовать его как ориентир по структуре.`
      : "Design reference не приложен.",
        visual_hints: screenshotOcr?.usable
      ? {
          layout_style: cleanText(screenshotOcr?.layoutStyle) || "plain",
          title_scale: cleanText(deriveSimpleSystemCardVisualStyle(screenshotOcr)?.titleScale) || "default",
          logo_scale: cleanText(deriveSimpleSystemCardVisualStyle(screenshotOcr)?.logoScale) || "default",
          card_width: cleanText(deriveSimpleSystemCardVisualStyle(screenshotOcr)?.cardWidth) || "default",
          button_width: cleanText(deriveSimpleSystemCardVisualStyle(screenshotOcr)?.buttonWidth) || "default",
          button_tone: cleanText(deriveSimpleSystemCardVisualStyle(screenshotOcr)?.buttonTone) || "solid",
          card_shape: cleanText(deriveSimpleSystemCardVisualStyle(screenshotOcr)?.cardShape) || "soft",
          button_shape: cleanText(deriveSimpleSystemCardVisualStyle(screenshotOcr)?.buttonShape) || "soft",
          card_density: cleanText(deriveSimpleSystemCardVisualStyle(screenshotOcr)?.cardDensity) || "default",
          support_layout: cleanText(deriveSimpleSystemCardVisualStyle(screenshotOcr)?.supportLayout) || "default",
          page_bg_color: "",
          card_bg_color: "",
          title_color: "",
          body_color: "",
          accent_color: "",
          button_fill_color: "",
          button_border_color: "",
          button_text_color: "",
          notes: cleanText(screenshotOcr?.layoutStyle) || "ocr visual fallback"
        }
      : {
          layout_style: "",
          title_scale: "default",
          logo_scale: "default",
          card_width: "default",
          button_width: "default",
          button_tone: "solid",
          card_shape: "soft",
          button_shape: "soft",
          card_density: "default",
          support_layout: "default",
          page_bg_color: "",
          card_bg_color: "",
          title_color: "",
          body_color: "",
          accent_color: "",
          button_fill_color: "",
          button_border_color: "",
          button_text_color: "",
          notes: ""
        },
    section_kinds: payload.currentDraft?.sections?.map((section) => cleanText(section.kind)).filter(Boolean).slice(0, 6)
      || (ocrSectionKinds.length > 0 ? ocrSectionKinds : ["hero", "text", "feature-list", "cta", "footer"]),
    sections_structured: [],
    suggested_blocks: hasDesign
      ? screenshotOcr?.usable
        ? [
            cleanText(screenshotOcr?.title) ? "Text block with headline" : "",
            cleanText(screenshotOcr?.ctaLabel) ? "Single CTA block" : "",
            cleanText(screenshotOcr?.supportBody || screenshotOcr?.footerBody) ? "Support/footer block" : ""
          ].filter(Boolean)
        : ["Hero block", "Content block", "CTA block", "Footer block"]
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
      hasDesign
        ? screenshotOcr?.usable
          ? "Mock mode: пиксельный layout не распознан полностью, используется локальный OCR fallback."
          : "Mock mode: нет vision-разбора пиксельного макета"
        : "Design reference отсутствует",
      ocrBodyPreview.length > 0 ? `OCR blocks: ${ocrBodyPreview.join(" | ")}` : "",
      cleanText(screenshotOcr?.error),
      warning || ""
    ].filter(Boolean),
    mode: "mock-design",
    updatedAt: new Date().toISOString()
  });

  return {
    assistantReply: hasDesign
      ? screenshotOcr?.usable
        ? `Design reference сохранен. Live vision сейчас недоступен, поэтому студия использует локальный OCR fallback и собирает только rough structural analysis.${warning ? ` ${warning}` : ""}`
        : `Design reference сохранен, но сейчас доступен только mock-анализ. Для реального разбора макета нужен OpenAI provider с ключом.${warning ? ` ${warning}` : ""}`
      : "Сначала приложи design reference, потом можно запускать анализ макета.",
    analysis
  };
}

function createAssetRecords(payload) {
  const records = isSystemCategoryName(resolveBriefCategory(payload))
    ? []
    : payload.assetInputs
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

  const logoUrl = cleanText(extractLatestLogoOverrideUrl(payload));
  if (logoUrl && !records.some((asset) => cleanText(asset.url) === logoUrl)) {
    records.unshift({
      key: "brand_logo_asset",
      url: logoUrl,
      alt: deriveLogoAltText(logoUrl),
      placement: "logo",
      notes: "User provided logo override",
      width: 240,
      height: 80
    });
  }

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
  return getUserMessageContents(payload).at(-1) || "";
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
  const templateSelection = getReferenceTemplateSelection(payload);
  const requestedLocales = Array.from(new Set([
    normalizeLocaleCode(payload?.brief?.locale || mail?.locale || "en"),
    ...parseLocaleList(payload?.brief?.requestedLocales || "")
  ].filter(Boolean)));
  const localesNote = requestedLocales.length > 1
    ? ` Локали: ${requestedLocales.join(", ")}.`
    : "";
  const categoryNote = cleanText(templateSelection?.profile) === "aff-password-reset"
    ? "Собрал черновик affiliate password reset письма."
    : payload?.screenshotOcr?.usable && hasVisualDesignInput(payload) && !payload?.baseEmailHtml
      ? "Собрал OCR-черновик письма по скрину."
      : isSystemCategoryName(resolveBriefCategory(payload))
        ? "Собрал черновик системного письма."
        : "Собрал черновик письма.";
  return `${categoryNote} Preview, код и локали обновлены.${localesNote}`;
}

function buildTemplateSelectionUserNote(payload) {
  const selection = getReferenceTemplateSelection(payload);
  const reference = cleanText(selection?.category) && cleanText(selection?.mailId)
    ? `${selection.category}/mail-${selection.mailId}`
    : "";
  const profile = cleanText(selection?.profile);
  const source = cleanText(selection?.source);
  const reasons = Array.isArray(selection?.reasons) ? selection.reasons.map(cleanText).filter(Boolean) : [];
  const missingVariantReason = reasons.find((reason) => /visible variant .* not found in base/i.test(reason));
  const hasRussianResponse = detectPreferredResponseLanguage(payload) === "Russian";

  if (!missingVariantReason) {
    const isSpecialReference = Boolean(reference)
      && (
        source === "special-case"
        || source === "ocr-special-case"
        || (profile && profile !== "generic")
      );
    if (!isSpecialReference) {
      return "";
    }

    if (hasRussianResponse) {
      return ` Использую reference ${reference}${profile ? ` (profile: ${profile})` : ""}.`;
    }

    return ` Using reference ${reference}${profile ? ` (profile: ${profile})` : ""}.`;
  }

  const match = missingVariantReason.match(/visible variant\s+(\d{3})\s+not found in base/i);
  const digits = cleanText(match?.[1]);
  const variantLabel = digits ? digits.replace(/(\d)(\d)(\d)/, "$1-$2-$3") : "";

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
  const preserveCanonicalFooter = Boolean(
    payload?.design?.figmaImport
    || payload?.figmaEnrichment?.structuredCoverage?.available
    || cleanText(payload?.figmaEnrichment?.importMethod).includes("figma")
  );
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
        if (preserveCanonicalFooter) {
          continue;
        }
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
  const needsFooter = !preserveCanonicalFooter && footerSections.length === 0 && cleanText(payload?.designMappingHints?.footerFamily);
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
  const copy = getMockSectionCopy(context.locale);
  const getTemplateValue = (key, fallback = "") => (
    Object.prototype.hasOwnProperty.call(templateSection, key)
      ? cleanText(templateSection[key])
      : cleanText(fallback)
  );
  const sectionMeta = {
    sourceRole: cleanText(templateSection?.sourceRole),
    sourceArchetype: cleanText(templateSection?.sourceArchetype),
    recommendedCatalogId: cleanText(templateSection?.recommendedCatalogId),
    profileBlockId: cleanText(templateSection?.profileBlockId),
    profileSectionKind: cleanText(templateSection?.profileSectionKind),
    confidence: cleanText(templateSection?.confidence)
  };

  if (kind === "image" && sectionBlockId === "header-logo-row") {
    return {
      ...sectionMeta,
      kind: "image",
      eyebrow: "",
      title: "",
      body: "",
      image_key: context.logoAssetKey || context.heroAssetKey || context.sectionAssetKey,
      cta_label: "",
      cta_href: "",
      items: []
    };
  }

  if (kind === "hero") {
    return {
      ...sectionMeta,
      kind: "hero",
      eyebrow: getTemplateValue("eyebrow", sharedEyebrow || "Primary message"),
      title: getTemplateValue("title", context.heroTitle),
      body: getTemplateValue("body", context.heroBody),
      image_key: context.heroAssetKey || context.sectionAssetKey,
      cta_label: context.ctaLabel,
      cta_href: context.ctaHref,
      items: []
    };
  }

  if (kind === "feature-list") {
    return {
      ...sectionMeta,
      kind: "feature-list",
      eyebrow: getTemplateValue("eyebrow", "Key points"),
      title: getTemplateValue("title", copy.featureTitle),
      body: getTemplateValue("body", copy.featureBody),
      image_key: "",
      cta_label: "",
      cta_href: "",
      items: context.featureItems
    };
  }

  if (kind === "image") {
    return {
      ...sectionMeta,
      kind: "image",
      eyebrow: getTemplateValue("eyebrow", copy.visualEyebrow),
      title: getTemplateValue("title", detail || copy.mainContentTitle),
      body: getTemplateValue("body", nextDetail || context.supportBody),
      image_key: context.sectionAssetKey || context.heroAssetKey,
      cta_label: "",
      cta_href: "",
      items: []
    };
  }

  if (kind === "cta") {
    return {
      ...sectionMeta,
      kind: "cta",
      eyebrow: getTemplateValue("eyebrow", copy.primaryActionEyebrow),
      title: getTemplateValue("title", copy.primaryActionTitle),
      body: getTemplateValue("body", context.ctaBody),
      image_key: "",
      cta_label: context.ctaLabel,
      cta_href: context.ctaHref,
      items: []
    };
  }

  if (kind === "footer") {
    if (sectionBlockId === "social-links-row" || sectionBlockId === "social-icons-row") {
      return {
        ...sectionMeta,
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
        ...sectionMeta,
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
      ...sectionMeta,
      kind: "footer",
      eyebrow: "",
      title: getTemplateValue("title", copy.footerTitle),
      body: getTemplateValue("body", context.footerBody),
      image_key: "",
      cta_label: "",
      cta_href: "",
      items: []
    };
  }

  return {
    ...sectionMeta,
    kind: "text",
    eyebrow: getTemplateValue("eyebrow", copy.detailsEyebrow),
    title: getTemplateValue("title", detail || copy.mainContentTitle),
    body: getTemplateValue("body", nextDetail || context.supportBody),
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
  if (payload?.screenshotOcr?.usable && hasVisualDesignInput(payload) && !hasStructuredFigmaInput(payload)) {
    return mail;
  }

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
  const explicitTemplateMail = options.templateMail && typeof options.templateMail === "object"
    ? options.templateMail
    : includeCurrentDraft && payload?.currentDraft && typeof payload.currentDraft === "object"
      ? payload.currentDraft
      : null;
  const affPasswordResetMock = cleanText(getReferenceTemplateSelection(payload)?.profile) === "aff-password-reset";
  const templateMail = explicitTemplateMail
    || (affPasswordResetMock ? buildAffPasswordResetTemplateMail(payload) : null);
  const cloneEditContentMap = getCloneEditContentMap(payload);
  const cloneEditBodyBlocks = buildNormalizedContentMapSections(cloneEditContentMap);
  const cloneEditHeading = pickContentMapHeading(cloneEditContentMap, cloneEditBodyBlocks);
  const cloneEditLead = pickContentMapLead(cloneEditContentMap, cloneEditBodyBlocks);
  const cloneEditCtas = Array.isArray(cloneEditContentMap?.links)
    ? cloneEditContentMap.links
      .map((entry) => ({
        text: cleanText(entry?.text),
        href: cleanText(entry?.href)
      }))
      .filter((entry) => entry.text || entry.href)
    : [];
  const translationSeed = findPreferredTranslationEntry(payload.translationText, payload.brief.locale, {
    locale: payload.brief.locale || templateMail?.locale || "en",
    subject: templateMail?.subject || "",
    preheader: templateMail?.preheader || "",
    sections: Array.isArray(templateMail?.sections) ? templateMail.sections : [],
    body_blocks: []
  });
  const translatedBlocks = Array.isArray(translationSeed?.body_blocks) ? translationSeed.body_blocks : [];
  const screenshotOcr = payload?.screenshotOcr && typeof payload.screenshotOcr === "object"
    ? payload.screenshotOcr
    : null;
  const screenshotBlocks = Array.isArray(screenshotOcr?.bodyBlocks)
    ? screenshotOcr.bodyBlocks.map(cleanText).filter(Boolean)
    : [];
  const resetSupportSplit = splitAffPasswordResetWarningAndSupport(cleanText(screenshotOcr?.supportBody));
  const resetWarningBody = cleanText(screenshotOcr?.warningBody) || cleanText(resetSupportSplit.warning);
  const resetSupportBody = cleanText(screenshotOcr?.supportBody) || cleanText(resetSupportSplit.support);
  const detailLines = translatedBlocks.length > 0
    ? translatedBlocks
    : cloneEditBodyBlocks.length > 0
      ? cloneEditBodyBlocks
      : screenshotBlocks.length > 0
        ? screenshotBlocks
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
    || cloneEditHeading
    || cloneEditContentMap?.subject
    || screenshotOcr?.title
    || payload.brief.campaignName
    || deriveTitleFromUserMessage(latestUserMessage)
    || templateMail?.sections?.find((section) => cleanText(section?.kind) === "hero")?.title
    || templateMail?.sections?.find((section) => cleanText(section?.title))?.title
    || "Новый email draft"
  );
  const heroBody = cleanText(
    translatedBlocks[1]
    || cloneEditLead
    || cloneEditContentMap?.preheader
    || screenshotBlocks[0]
    || payload.brief.goal
    || payload.brief.contentNotes
    || templateMail?.sections?.find((section) => cleanText(section?.kind) === "hero")?.body
    || templateMail?.sections?.find((section) => cleanText(section?.body))?.body
    || "Собираем письмо на базе brief, текущих переводов и структуры из email-base."
  );
  const subject = cleanText(
    translationSeed?.subject
    || cloneEditContentMap?.subject
    || cloneEditHeading
    || screenshotOcr?.title
    || templateMail?.subject
    || payload.brief.campaignName
    || deriveTitleFromUserMessage(latestUserMessage)
    || heroTitle
  );
  const preheader = cleanText(
    translationSeed?.preheader
    || cloneEditContentMap?.preheader
    || cloneEditLead
    || screenshotBlocks[0]
    || payload.brief.goal
    || templateMail?.preheader
    || heroBody.slice(0, 120)
  );
  const ctaLabel = cleanText(
    payload.brief.primaryCta
    || translationSeed?.cta_labels?.[0]
    || cloneEditCtas[0]?.text
    || screenshotOcr?.ctaLabel
    || templateCta.label
    || "Open email"
  );
  const ctaHref = cleanText(
    payload.brief.primaryLink
    || cloneEditCtas[0]?.href
    || templateCta.href
    || ""
  );
  const logoAssetKey = getAssetByPlacement(assets, ["logo"])?.key || "";
  const heroAssetKey = getAssetByPlacement(assets, ["hero", "background"])?.key
    || assets[0]?.key
    || "";
  const sectionAssetKey = getAssetByPlacement(assets, ["section", "feature"])?.key
    || heroAssetKey;
  const affPasswordResetTemplateSections = affPasswordResetMock
    ? [
        { kind: "image", recommendedCatalogId: "header-logo-row" },
        {
          kind: "text",
          recommendedCatalogId: "plain-copy-text-card",
          eyebrow: "",
          title: cleanText(screenshotOcr?.title) || heroTitle,
          body: cleanText(screenshotBlocks.slice(0, 3).join("\n\n")) || heroBody
        },
        {
          kind: "cta",
          recommendedCatalogId: "single-button-cta-card",
          eyebrow: "",
          title: "",
          body: cleanText(screenshotOcr?.ctaLead || templateMail?.sections?.[1]?.body || "")
        },
        {
          kind: "text",
          recommendedCatalogId: "plain-copy-text-card",
          eyebrow: "",
          title: "",
          body: resetWarningBody
        },
        {
          kind: "text",
          recommendedCatalogId: "plain-copy-text-card",
          eyebrow: "",
          title: "",
          body: resetSupportBody
        }
      ].filter((section) => cleanText(section.body) || cleanText(section.title) || cleanText(section.kind) === "image" || cleanText(section.kind) === "cta")
    : [];
  const screenshotTemplateSections = screenshotOcr?.usable
    ? [
        (logoAssetKey || cleanText(payload?.brief?.designUrl) || screenshotOcr?.title)
          ? { kind: "image", recommendedCatalogId: "header-logo-row" }
          : null,
        cleanText(screenshotOcr?.title) || screenshotBlocks.length > 0
          ? {
              kind: "text",
              recommendedCatalogId: "plain-copy-text-card",
              eyebrow: "",
              title: cleanText(screenshotOcr?.title) || heroTitle,
              body: cleanText(screenshotBlocks.slice(0, 3).join("\n\n")) || heroBody
            }
          : null,
        cleanText(screenshotOcr?.ctaLabel)
          ? {
              kind: "cta",
              recommendedCatalogId: "single-button-cta-card",
              eyebrow: "",
              title: "",
              body: cleanText(screenshotOcr?.ctaLead || screenshotBlocks.at(-1) || heroBody)
            }
          : null,
        cleanText(screenshotOcr?.supportBody)
          ? {
              kind: "text",
              recommendedCatalogId: "plain-copy-text-card",
              eyebrow: "",
              title: "",
              body: cleanText(screenshotOcr.supportBody)
            }
          : null,
        cleanText(screenshotOcr?.footerBody).length > 18
          ? {
              kind: "footer",
              recommendedCatalogId: "legal-unsubscribe-footer",
              title: "",
              body: cleanText(screenshotOcr.footerBody)
            }
          : null
      ].filter(Boolean)
    : [];
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
  const templateSections = affPasswordResetTemplateSections.length > 0
    ? affPasswordResetTemplateSections
    : screenshotTemplateSections.length > 0
    ? screenshotTemplateSections
    : profiledTemplateSections.length > 0
    ? profiledTemplateSections
    : designDrivenSections.length > 0
      ? designDrivenSections
      : hasVisualDesignInput(payload)
        ? [
            { kind: "image", recommendedCatalogId: "header-logo-row" },
            { kind: "text", recommendedCatalogId: "plain-copy-text-card" },
            { kind: "cta", recommendedCatalogId: "single-button-cta-card" },
            { kind: "footer", recommendedCatalogId: "legal-unsubscribe-footer" }
          ]
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
    locale,
    templateSections,
    detailLines,
    heroTitle,
    heroBody,
    supportBody: resetSupportBody || detailLines[1] || payload.brief.contentNotes || heroBody,
    ctaBody: cleanText(screenshotOcr?.ctaLead || screenshotBlocks.at(-1) || screenshotBlocks[0]) || payload.brief.goal || detailLines.at(-1) || getMockSectionCopy(locale).ctaBody,
    footerBody: affPasswordResetMock
      ? ""
      : cleanText(screenshotOcr?.footerBody)
      || cleanText(templateMail?.sections?.find((section) => cleanText(section.kind) === "footer")?.body)
      || (screenshotOcr?.usable ? "" : getMockSectionCopy(locale).footerBody),
    featureItems,
    ctaLabel: affPasswordResetMock ? normalizeAffPasswordResetCtaLabel(ctaLabel, templateCta.label) : ctaLabel,
    ctaHref,
    logoAssetKey,
    heroAssetKey,
    sectionAssetKey
  };

  const sections = templateSections
    .map((section, index) => buildMockSectionForKind(cleanText(section?.kind) || "text", index, context))
    .filter((section, index, collection) => section.kind !== "image" || Boolean(section.image_key) || collection.length <= 3);
  const visualStyle = affPasswordResetMock
    ? mergeVisualStyleHints(
        deriveAffPasswordResetVisualStyle(screenshotOcr) || normalizeVisualStyleHints(templateMail?.visual_style),
        payload?.designAnalysis?.visual_hints
      )
    : cleanText(screenshotOcr?.layoutStyle) === "centered-transactional-card"
      ? mergeVisualStyleHints(deriveSimpleSystemCardVisualStyle(screenshotOcr), payload?.designAnalysis?.visual_hints)
      : normalizeVisualStyleHints(templateMail?.visual_style);

  const mail = {
    subject,
    preheader,
    locale,
    summary: heroBody,
    brand_logo_url: cleanText(templateMail?.brand_logo_url),
    brand_logo_alt: cleanText(templateMail?.brand_logo_alt),
    visual_style: visualStyle,
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
  const match = cleanText(fileName).match(/(?:^|[_-])([a-z]{2}(?:[_-][A-Za-z]{2})?)(?=[_.-]|$)/i);
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
    .map((line) => normalizeBoldTokens(unwrapTranslationBraces(line)));
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
      ? entry.body_blocks.map(normalizeBoldTokens)
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

function mergeSourceTranslationEntryIntoEntries(entries, sourceEntry, mail) {
  const normalizedSource = sourceEntry ? normalizeTranslationEntry(sourceEntry, mail) : null;
  if (!normalizedSource) {
    return dedupeTranslationEntries(entries, mail);
  }

  const sourceLocale = normalizeLocaleCode(normalizedSource.locale) || normalizeLocaleCode(mail?.locale) || "en";
  let mergedSource = false;

  const mergedEntries = (Array.isArray(entries) ? entries : []).map((entry) => {
    const normalizedEntry = normalizeTranslationEntry(entry, mail);
    if (!localeMatchesRequest(normalizedEntry.locale, sourceLocale)) {
      return normalizedEntry;
    }

    mergedSource = true;
    return normalizeTranslationEntry({
      locale: sourceLocale,
      subject: cleanText(normalizedEntry.subject) || cleanText(normalizedSource.subject),
      preheader: cleanText(normalizedEntry.preheader) || cleanText(normalizedSource.preheader),
      cta_labels: Array.isArray(normalizedEntry.cta_labels) && normalizedEntry.cta_labels.length > 0
        ? normalizedEntry.cta_labels
        : normalizedSource.cta_labels,
      notes: cleanText(normalizedEntry.notes) || cleanText(normalizedSource.notes),
      body_blocks: Array.isArray(normalizedEntry.body_blocks) && normalizedEntry.body_blocks.length > 0
        ? normalizedEntry.body_blocks
        : normalizedSource.body_blocks,
      source_name: cleanText(normalizedEntry.source_name) || cleanText(normalizedSource.source_name)
    }, mail);
  });

  if (!mergedSource) {
    mergedEntries.unshift(normalizedSource);
  }

  return dedupeTranslationEntries(mergedEntries, mail);
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
  const cloneEditEntry = buildTranslationEntryFromContentMap(
    getCloneEditContentMap(payload),
    payload?.brief?.locale || mail?.locale || "en",
    mail,
    "clone-edit-base-email.txt"
  );
  if (cloneEditEntry) {
    return cloneEditEntry;
  }

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

function extractStructuredJsonFromModelText(rawText) {
  const source = cleanText(rawText);
  if (!source) {
    return null;
  }

  const candidates = [source];
  const fencedMatch = source.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fencedMatch?.[1]) {
    candidates.push(cleanText(fencedMatch[1]));
  }

  const firstBrace = source.indexOf("{");
  const lastBrace = source.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(source.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Try the next candidate.
    }
  }

  return null;
}

function extractHtmlDocumentFromModelText(rawText) {
  const source = String(rawText || "").trim();
  if (!source) {
    return "";
  }

  const directMatch = source.match(/(?:<!doctype[\s\S]*?<html[\s\S]*?<\/html>|<html[\s\S]*?<\/html>)/i);
  if (directMatch?.[0]) {
    return directMatch[0].trim();
  }

  const fencedMatch = source.match(/^```(?:html)?\s*([\s\S]*?)\s*```$/i);
  if (fencedMatch?.[1]) {
    const fencedHtml = fencedMatch[1].trim();
    if (/<html[\s\S]*<\/html>/i.test(fencedHtml) || /<!doctype/i.test(fencedHtml)) {
      return fencedHtml;
    }
  }

  if (/^\s*(?:<!doctype|<html|<body)\b/i.test(source)) {
    return source;
  }

  return "";
}

function buildCloneEditResponseFromRawHtml(rawText, payload) {
  const modifiedHtml = cleanText(extractHtmlDocumentFromModelText(rawText));
  if (!modifiedHtml) {
    return null;
  }

  const primaryLocale = normalizeLocaleCode(
    cleanText(payload?.brief?.locale)
    || cleanText(payload?.currentDraft?.mail?.locale)
    || "en"
  );
  const contentMap = extractEmailHtmlContentMap(modifiedHtml) || {};
  const fallbackMail = {
    subject: cleanText(contentMap.subject) || cleanText(payload?.currentDraft?.mail?.subject),
    preheader: cleanText(contentMap.preheader) || cleanText(payload?.currentDraft?.mail?.preheader),
    locale: primaryLocale,
    sections: [],
    assets: [],
    translations: []
  };
  const sourceEntry = buildTranslationEntryFromContentMap(
    contentMap,
    primaryLocale,
    fallbackMail,
    "clone-edit-html-fallback.txt"
  );
  const userText = cleanText(getLatestUserMessage(payload));
  const assistantReply = /[А-Яа-яЁё]/.test(userText)
    ? "Готово. Основной HTML восстановлен из ответа модели, а локали будут дособраны отдельным шагом."
    : "Done. Recovered the primary HTML from the model response; locale variants will be completed in a follow-up step.";

  return {
    assistant_reply: assistantReply,
    mail: {
      subject: cleanText(contentMap.subject) || cleanText(payload?.currentDraft?.mail?.subject) || "",
      preheader: cleanText(contentMap.preheader) || cleanText(payload?.currentDraft?.mail?.preheader) || "",
      locale: primaryLocale,
      summary: cleanText(contentMap.sections?.[0]) || cleanText(contentMap.preheader) || cleanText(contentMap.subject) || "Clone-edit HTML recovered from raw model output.",
      modified_html: modifiedHtml,
      localized_html: [],
      translations: sourceEntry ? [sourceEntry] : []
    }
  };
}

function buildLocaleRepairPlan(payload, draft) {
  const effectiveDraft = draft && typeof draft === "object" ? draft : null;
  const baseMail = normalizeMail(effectiveDraft?.mail || payload?.currentDraft || null, payload);
  const requestedLocales = Array.from(new Set([
    normalizeLocaleCode(payload?.brief?.locale || baseMail.locale || "en"),
    ...parseLocaleList(payload?.brief?.requestedLocales || ""),
    ...extractRequestedLocalesFromMessages(payload)
  ].filter(Boolean)));

  const existingEntries = dedupeTranslationEntries(
    [
      ...parseTranslationEntries(cleanText(payload?.translationText), baseMail),
      ...(Array.isArray(baseMail?.translations) ? baseMail.translations : [])
    ],
    baseMail
  );

  const sourceEntry = payload?.baseEmailHtml && cleanText(effectiveDraft?.html)
    ? buildCloneEditPreviewSourceEntry(cleanText(effectiveDraft.html), baseMail)
    : buildSourceTranslationEntry(baseMail, payload);

  const sourceBodyCount = Array.isArray(sourceEntry?.body_blocks) ? sourceEntry.body_blocks.filter(Boolean).length : 0;
  const sourceCtaCount = Array.isArray(sourceEntry?.cta_labels) ? sourceEntry.cta_labels.filter(Boolean).length : 0;

  const missingLocales = requestedLocales.filter((locale) => !existingEntries.some((entry) => localeMatchesRequest(entry.locale, locale)));
  const incompleteLocales = requestedLocales.filter((locale) => {
    const entry = existingEntries.find((candidate) => localeMatchesRequest(candidate?.locale, locale));
    if (!entry) {
      return false;
    }

    if (localeMatchesRequest(locale, sourceEntry?.locale)) {
      return false;
    }

    const bodyCount = Array.isArray(entry?.body_blocks) ? entry.body_blocks.filter(Boolean).length : 0;
    const ctaCount = Array.isArray(entry?.cta_labels) ? entry.cta_labels.filter(Boolean).length : 0;
    return (sourceBodyCount > 0 && bodyCount < sourceBodyCount) || (sourceCtaCount > 0 && ctaCount < sourceCtaCount);
  });

  return {
    baseMail,
    sourceEntry,
    requestedLocales,
    existingEntries,
    missingLocales,
    incompleteLocales,
    targetLocales: Array.from(new Set([...missingLocales, ...incompleteLocales]))
  };
}

function createMockDraft(payload, warning = "") {
  const mail = buildFallbackMail(payload, { includeCurrentDraft: true });
  const reusingStructure = Boolean(payload.currentDraft?.sections?.length);
  const screenshotOcrUsed = Boolean(payload?.screenshotOcr?.usable && hasVisualDesignInput(payload) && !payload?.baseEmailHtml);
  const suffix = warning ? ` Сейчас включен mock-режим: ${warning}.` : "";

  // Clone-edit mock: return original HTML unchanged so the user always gets output.
  // The AI couldn't apply edits, but at least the HTML is accessible via Copy HTML.
  if (payload.baseEmailHtml) {
    const fallbackEdit = applyDeterministicCloneEditFallback(payload);
    const modifiedHtml = cleanText(fallbackEdit.html) || cleanText(payload.baseEmailHtml);
    const ruleNote = Array.isArray(fallbackEdit.appliedRules) && fallbackEdit.appliedRules.length > 0
      ? ` Применил safe fallback для простых правок: ${fallbackEdit.appliedRules.join(", ")}.`
      : "";
    return {
      assistant_reply: fallbackEdit.changed
        ? `⚠️ Mock-режим: AI-правки сейчас недоступны.${suffix}${ruleNote} HTML обновлен детерминированным fallback и доступен через Copy HTML.`
        : `⚠️ Mock-режим: не удалось применить правки через AI.${suffix} Исходный HTML возвращён без изменений — скопируй его через кнопку Copy HTML.`,
      mail: { ...mail, modified_html: modifiedHtml }
    };
  }

  return {
    assistant_reply: reusingStructure
      ? `Обновил draft на базе текущей структуры письма и ваших материалов.${suffix}`
      : screenshotOcrUsed
        ? `Собрал rough draft через локальный OCR fallback: распознал часть текста и CTA со скрина, но layout пока приближенный.${suffix}`
        : `Собрал draft по brief, переводам, design reference и доступным блокам.${suffix}`,
    mail
  };
}

async function createProjectAwareMockDraft(payload, warning = "") {
  // Clone-edit mode: always use createMockDraft which returns original HTML as modified_html
  if (payload.baseEmailHtml) {
    return createMockDraft(payload, warning);
  }

  if (payload.currentDraft?.sections?.length) {
    return createMockDraft(payload, warning);
  }

  if (hasVisualDesignInput(payload) && !hasStructuredFigmaInput(payload)) {
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
  const translations = targetLocales.map((locale) => {
    const deterministicEntry = buildDeterministicMockTranslationEntry(locale, mail, sourceEntry);
    if (deterministicEntry) {
      return deterministicEntry;
    }

    return normalizeTranslationEntry({
      locale,
      subject: sourceEntry.subject || mail.subject,
      preheader: sourceEntry.preheader || mail.preheader,
      cta_labels: sourceEntry.cta_labels?.length > 0 ? sourceEntry.cta_labels : collectCtaLabels(mail),
      notes: `Mock placeholder copied from ${sourceEntry.locale || mail.locale}. Replace with reviewed translation before send.`,
      body_blocks: sourceEntry.body_blocks?.length > 0 ? sourceEntry.body_blocks : deriveBodyBlocksFromMail(mail),
      source_name: `${normalizeLocaleCode(locale) || "locale"}.txt`
    }, mail);
  });
  const deterministicLocales = translations
    .filter((entry) => /deterministic/i.test(cleanText(entry?.notes)))
    .map((entry) => normalizeLocaleCode(entry?.locale))
    .filter(Boolean);

  return {
    assistant_reply: [
      deterministicLocales.length > 0
        ? `Собрал ${translations.length} missing locale(s); deterministic fallback готов для: ${deterministicLocales.join(", ")}.`
        : `Собрал ${translations.length} missing locale(s) как placeholder bundle.`,
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
    visual_style: normalizeVisualStyleHints(mail.visual_style),
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

  const assets = (Array.isArray(mail.assets) ? mail.assets : [])
    .map((asset) => ({ ...asset }))
    .filter((asset) => cleanText(asset.placement) === "logo" || isLikelyLogoAsset(asset));

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
        const blockId = cleanText(section.profileBlockId || section.recommendedCatalogId);
        return blockId === "header-logo-row" || Boolean(cleanText(section.title) || cleanText(section.body) || cleanText(section.image_key));
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

function renderSystemEmailHtml(mail, metadata = {}) {
  const logoAsset = getPreferredLogoAsset(mail);
  const logoUrl = cleanText(mail?.brand_logo_url) || cleanText(logoAsset?.url) || "https://images01.iqoption.com/89/0689/static-01503674720413810689.png";
  const logoAlt = cleanText(mail?.brand_logo_alt) || cleanText(logoAsset?.alt) || "IQ Option";
  const logoMarkup = `<img class="system-logo" src="${escapeHtml(logoUrl)}" alt="${escapeHtml(logoAlt)}" />`;
  const contentSections = (Array.isArray(mail.sections) ? mail.sections : [])
    .filter((section) => cleanText(section.kind) !== "footer")
    .map((section, index) => renderSystemSectionHtml(section, mail, index))
    .join("");
  const hideMeta = Boolean(metadata?.hideDebugMeta);

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
            ${hideMeta ? "" : `<tr>
              <td class="system-head-meta">Subject: ${formatInlineMarkup(mail.subject)}<br />Preheader: ${formatInlineMarkup(mail.preheader)}</td>
            </tr>`}
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

function renderMarketingEmailHtml(mail, metadata = {}) {
  const sectionsHtml = mail.sections.map((section) => renderSectionHtml(section, mail)).join("");
  const hideMeta = Boolean(metadata?.hideDebugMeta);

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
      ${hideMeta ? "" : `<div class="meta">Subject: ${formatInlineMarkup(mail.subject)}<br />Preheader: ${formatInlineMarkup(mail.preheader)}</div>`}
      ${sectionsHtml}
    </div>
  </body>
</html>`;
}

function renderDraftHtml(mail, metadata = {}) {
  return cleanText(metadata?.previewCategory) === "X_System"
    ? renderSystemEmailHtml(mail, metadata)
    : renderMarketingEmailHtml(mail, metadata);
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
    previewBlocked: metadata?.previewBlocked || existingDraft?.previewBlocked || null,
    previewLocales: {
      ...(existingDraft?.previewLocales && typeof existingDraft.previewLocales === "object" ? existingDraft.previewLocales : {}),
      ...(metadata?.previewLocales && typeof metadata.previewLocales === "object" ? metadata.previewLocales : {})
    },
    localePayloads: {
      ...(existingDraft?.localePayloads && typeof existingDraft.localePayloads === "object" ? existingDraft.localePayloads : {}),
      ...(metadata?.localePayloads && typeof metadata.localePayloads === "object" ? metadata.localePayloads : {})
    },
    localeBuildLogs: {
      ...(existingDraft?.localeBuildLogs && typeof existingDraft.localeBuildLogs === "object" ? existingDraft.localeBuildLogs : {}),
      ...(metadata?.localeBuildLogs && typeof metadata.localeBuildLogs === "object" ? metadata.localeBuildLogs : {})
    },
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

function normalizeCloneEditLocalizedHtmlEntries(entries, fallbackLocale = "en") {
  const previewLocales = {};
  for (const entry of Array.isArray(entries) ? entries : []) {
    const locale = normalizeLocaleCode(cleanText(entry?.locale) || fallbackLocale);
    const html = cleanText(entry?.html);
    if (!locale || !html) {
      continue;
    }
    previewLocales[locale] = html;
  }
  return previewLocales;
}

function escapeHtmlTextContent(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function buildFlexibleHtmlTextPattern(source) {
  const normalized = cleanText(source);
  if (!normalized) {
    return null;
  }
  const tokens = normalized.split(/\s+/).map(cleanText).filter(Boolean);
  if (tokens.length === 0) {
    return null;
  }
  return new RegExp(tokens.map((token) => escapeRegExp(token)).join("(?:\\s|&nbsp;|&#160;)+"), "i");
}

function replaceFirstFlexibleHtmlText(html, sourceText, targetText) {
  const source = cleanText(sourceText);
  const target = cleanText(targetText);
  if (!source || !target || source === target) {
    return html;
  }

  if (html.includes(source)) {
    return html.replace(source, escapeHtmlTextContent(target));
  }

  const pattern = buildFlexibleHtmlTextPattern(source);
  if (!pattern) {
    return html;
  }

  return html.replace(pattern, escapeHtmlTextContent(target));
}

function buildCloneEditPreviewSourceEntry(baseHtml, mail) {
  const contentMap = extractEmailHtmlContentMap(baseHtml) || {};
  return normalizeTranslationEntry({
    locale: normalizeLocaleCode(mail?.locale || "en"),
    subject: cleanText(mail?.subject) || cleanText(contentMap.subject),
    preheader: cleanText(mail?.preheader) || cleanText(contentMap.preheader),
    cta_labels: Array.isArray(contentMap.links) && contentMap.links.length > 0
      ? contentMap.links.map((entry) => cleanText(entry.text)).filter(Boolean)
      : collectCtaLabels(mail),
    body_blocks: Array.isArray(contentMap.sections) && contentMap.sections.length > 0
      ? contentMap.sections.map(cleanText).filter(Boolean)
      : deriveBodyBlocksFromMail(mail),
    notes: "",
    source_name: "clone-edit-preview-source"
  }, mail);
}

function synthesizeCloneEditPreviewHtml(baseHtml, sourceEntry, targetEntry) {
  let transformed = cleanText(baseHtml);
  if (!transformed || !targetEntry) {
    return transformed;
  }

  const targetSubject = cleanText(targetEntry.subject);
  if (targetSubject && /<title[^>]*>[\s\S]*?<\/title>/i.test(transformed)) {
    transformed = transformed.replace(/<title[^>]*>[\s\S]*?<\/title>/i, `<title>${escapeHtmlTextContent(targetSubject)}</title>`);
  }

  const targetPreheader = cleanText(targetEntry.preheader);
  if (targetPreheader) {
    transformed = transformed.replace(
      /(<[^>]*class="[^"]*preheader[^"]*"[^>]*>)([\s\S]*?)(<\/(?:td|div|span|p)>)/i,
      (_match, open, _content, close) => `${open}${escapeHtmlTextContent(targetPreheader)}${close}`
    );
  }

  const sourceCtas = Array.isArray(sourceEntry?.cta_labels) ? sourceEntry.cta_labels.map(cleanText).filter(Boolean) : [];
  const targetCtas = Array.isArray(targetEntry?.cta_labels) ? targetEntry.cta_labels.map(cleanText).filter(Boolean) : [];
  for (let index = 0; index < Math.min(sourceCtas.length, targetCtas.length); index += 1) {
    transformed = replaceFirstFlexibleHtmlText(transformed, sourceCtas[index], targetCtas[index]);
  }

  const sourceBlocks = Array.isArray(sourceEntry?.body_blocks) ? sourceEntry.body_blocks.map(cleanText).filter(Boolean) : [];
  const targetBlocks = Array.isArray(targetEntry?.body_blocks) ? targetEntry.body_blocks.map(cleanText).filter(Boolean) : [];
  for (let index = 0; index < Math.min(sourceBlocks.length, targetBlocks.length); index += 1) {
    transformed = replaceFirstFlexibleHtmlText(transformed, sourceBlocks[index], targetBlocks[index]);
  }

  return applyLocaleDirectionToHtml(transformed, targetEntry.locale);
}

function buildCloneEditPreviewLocalesFromHtml(mail, baseHtml, payload, localizedHtmlEntries = []) {
  const primaryLocale = normalizeLocaleCode(
    cleanText(mail?.locale)
    || cleanText(payload?.brief?.locale)
    || "en"
  );
  const modifiedHtml = cleanText(baseHtml);
  const previewLocales = normalizeCloneEditLocalizedHtmlEntries(localizedHtmlEntries, primaryLocale);

  if (modifiedHtml) {
    previewLocales[primaryLocale] = modifiedHtml;
  }

  const sourceEntry = Array.isArray(mail?.translations)
    ? mail.translations.find((entry) => localeMatchesRequest(entry?.locale, primaryLocale))
      || buildCloneEditPreviewSourceEntry(modifiedHtml || "", mail)
    : buildCloneEditPreviewSourceEntry(modifiedHtml || "", mail);

  for (const entry of Array.isArray(mail?.translations) ? mail.translations : []) {
    const locale = normalizeLocaleCode(cleanText(entry?.locale));
    if (!locale || previewLocales[locale]) {
      continue;
    }
    const synthesized = synthesizeCloneEditPreviewHtml(modifiedHtml || "", sourceEntry, entry);
    if (synthesized) {
      previewLocales[locale] = synthesized;
    }
  }

  return previewLocales;
}

function buildCloneEditPreviewLocales(result, mail, payload) {
  return buildCloneEditPreviewLocalesFromHtml(
    mail,
    cleanText(result?.mail?.modified_html),
    payload,
    Array.isArray(result?.mail?.localized_html) ? result.mail.localized_html : []
  );
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
  const cloneEditPreviewLocales = modifiedHtml
    ? buildCloneEditPreviewLocales(result, mail, payload)
    : {};

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
      hideDebugMeta: Boolean(payload?.screenshotOcr?.usable && hasVisualDesignInput(payload) && !payload?.baseEmailHtml),
      modifiedHtml,
      previewLocales: cloneEditPreviewLocales
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

  // pug_blocks: real Pug code using vendor mixins — pass through to client and draft
  const rawPugBlocks = Array.isArray(result.mail?.pug_blocks) ? result.mail.pug_blocks : [];
  const pugBlocks = rawPugBlocks
    .filter((b) => b && cleanText(b.label) && cleanText(b.pug_code))
    .map((b) => ({ label: cleanText(b.label), pug_code: b.pug_code.trim() }));

  if (pugBlocks.length > 0) {
    draftResult.pugBlocks = pugBlocks;
    // Also store inside the draft object so it persists with the draft
    if (draftResult.draft?.mail) {
      draftResult.draft.mail.pug_blocks = pugBlocks;
    }
    console.log(`[materializeDraft] pug_blocks: ${pugBlocks.length} blocks (${pugBlocks.map((b) => b.label).join(", ")})`);
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

// ─── Token usage accumulator ─────────────────────────────────────────────────
// Tracks cumulative token consumption across all OpenAI calls this session.
// Resets on server restart. Exposed via /api/status → tokenUsage.
const tokenUsage = {
  inputTokens:  0,
  outputTokens: 0,
  totalTokens:  0,
  calls:        0,
  lastCallAt:   null
};

function _trackUsage(usage) {
  tokenUsage.inputTokens  += (usage?.input_tokens  || 0);
  tokenUsage.outputTokens += (usage?.output_tokens || 0);
  tokenUsage.totalTokens  += (usage?.total_tokens  || usage?.input_tokens + usage?.output_tokens || 0);
  tokenUsage.calls        += 1;
  tokenUsage.lastCallAt    = new Date().toISOString();
}

function _aiCall(buildRequestFn, label, options = {}) {
  return callOpenAiWithRetry(buildRequestFn, {
    label,
    apiKey: openAiApiKey,
    logger: appendStudioJournalEntry,
    onUsage: _trackUsage,
    ...options
  });
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
  const draftTask = resolveDraftTaskForPayload(payload);
  const effectivePayload = draftTask === "cloneEdit"
    ? hydratePayloadTemplateSelection(payload)
    : hydratePayloadTemplateSelection(await ensureDesignAnalysis(payload));
  const inputMessages = await buildInputMessages(effectivePayload);
  const model = resolveOpenAiModelForTask(draftTask);
  const schema = draftTask === "cloneEdit" ? cloneEditResponseSchema : responseSchema;
  const schemaName = draftTask === "cloneEdit" ? "email_studio_clone_edit" : "email_studio_draft";
  const requestLabel = draftTask === "cloneEdit" ? "clone-edit" : "create-draft";
  const aiOptions = draftTask === "cloneEdit"
    ? { timeoutMs: 240_000, retryMax: 1 }
    : {};

  const data = await _aiCall(
    async () => ({
      body: {
        model,
        input: inputMessages,
        text: { format: { type: "json_schema", name: schemaName, strict: true, schema } }
      }
    }),
    requestLabel,
    aiOptions
  );

  const rawText = extractResponseText(data);
  if (!rawText) throw new Error("OpenAI response did not contain output text");
  const parsed = extractStructuredJsonFromModelText(rawText);
  if (parsed) {
    return {
      ...parsed,
      design_analysis: effectivePayload.designAnalysis || null
    };
  }

  if (draftTask === "cloneEdit") {
    const recovered = buildCloneEditResponseFromRawHtml(rawText, effectivePayload);
    if (recovered) {
      return {
        ...recovered,
        design_analysis: effectivePayload.designAnalysis || null
      };
    }
  }

  throw new Error(`OpenAI ${requestLabel} response was not valid structured JSON`);
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
  const inferredTemplateProfile = getEmailBaseTemplateProfile(payload, payload?.currentDraft || {});

  if (inferredTemplateProfile === "aff-password-reset" && !payload?.currentDraft?.sections?.length) {
    return buildAffPasswordResetTemplateMail(payload);
  }

  if (inferredTemplateProfile === "system-notice-card" && !payload?.currentDraft?.sections?.length) {
    return buildSystemNoticeCardTemplateMail(payload);
  }

  if (inferredTemplateProfile === "simple-system-card" && !payload?.currentDraft?.sections?.length) {
    return buildSimpleSystemCardTemplateMail(payload);
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

function normalizeAffPasswordResetCtaLabel(text, fallback = "") {
  const value = cleanText(text) || cleanText(fallback);
  if (!value) {
    return "";
  }

  return /[→›»]$/.test(value) ? value : `${value} →`;
}

function translateAffPasswordResetTextToRussian(text) {
  const value = cleanText(text);
  if (!value) {
    return "";
  }

  const exactMap = new Map([
    ["Set your new password", "Задайте новый пароль"],
    ["Password reset instructions", "Инструкции по сбросу пароля"],
    ["Please click the button below to set your new password:", "Нажмите кнопку ниже, чтобы задать новый пароль:"],
    ["If you didn’t request to create or reset your password, you can safely ignore this email.", "Если вы не запрашивали создание аккаунта или сброс пароля, просто проигнорируйте это письмо."],
    ["If you didn't request to create or reset your password, you can safely ignore this email.", "Если вы не запрашивали создание аккаунта или сброс пароля, просто проигнорируйте это письмо."],
    ["If you’re having trouble signing in to your account, try setting your password again or reach out to support.", "Если у вас возникли проблемы со входом в аккаунт, попробуйте задать пароль еще раз или обратитесь в поддержку."],
    ["If you're having trouble signing in to your account, try setting your password again or reach out to support.", "Если у вас возникли проблемы со входом в аккаунт, попробуйте задать пароль еще раз или обратитесь в поддержку."],
    ["Terms and Conditions", "Условия и положения"]
  ]);

  if (exactMap.has(value)) {
    return exactMap.get(value);
  }

  const introMatch = value.match(/^We(?:['’]ve| have)? created an account for you on\s+(\{\{[^}]+\}\})\s*\(or received a request to\s*reset your password\)\.?$/i);
  if (introMatch) {
    return `Мы создали для вас аккаунт на ${introMatch[1]} или получили запрос на сброс пароля.`;
  }

  const supportMatch = value.match(/^If you(?:['’]re| are) having trouble signing in to your account, try setting your password again or reach out to us at\s+([^\s]+@[^\s]+)\.?$/i);
  if (supportMatch) {
    return `Если у вас возникли проблемы со входом в аккаунт, попробуйте задать пароль еще раз или напишите нам на ${supportMatch[1]}`;
  }

  if (/^Set new password$/i.test(value) || /^SET NEW PASSWORD$/i.test(value)) {
    return "ЗАДАТЬ НОВЫЙ ПАРОЛЬ →";
  }

  if (/support@quadcode\.com/i.test(value) && /trouble signing in/i.test(value)) {
    return "Если у вас возникли проблемы со входом в аккаунт, попробуйте задать пароль еще раз или напишите нам на support@quadcode.com";
  }

  return value;
}

function buildDeterministicMockTranslationEntry(locale, mail, sourceEntry) {
  const normalizedLocale = normalizeLocaleCode(locale);
  if (normalizedLocale !== "ru" || !looksLikeAffPasswordResetMail(mail)) {
    return null;
  }

  const sourceBlocks = Array.isArray(sourceEntry?.body_blocks) && sourceEntry.body_blocks.length > 0
    ? sourceEntry.body_blocks.map(cleanText).filter(Boolean)
    : deriveBodyBlocksFromMail(mail);
  const sourceCtas = Array.isArray(sourceEntry?.cta_labels) && sourceEntry.cta_labels.length > 0
    ? sourceEntry.cta_labels.map(cleanText).filter(Boolean)
    : collectCtaLabels(mail);
  const subject = translateAffPasswordResetTextToRussian(cleanText(sourceEntry?.subject) || cleanText(mail?.subject));
  const preheader = translateAffPasswordResetTextToRussian(cleanText(sourceEntry?.preheader) || cleanText(mail?.preheader));
  const bodyBlocks = sourceBlocks.map((block) => translateAffPasswordResetTextToRussian(block));
  const ctaLabels = sourceCtas.map((label) => translateAffPasswordResetTextToRussian(label));

  return normalizeTranslationEntry({
    locale: normalizedLocale,
    subject: subject || cleanText(sourceEntry?.subject) || cleanText(mail?.subject),
    preheader: preheader || cleanText(sourceEntry?.preheader) || cleanText(mail?.preheader),
    cta_labels: ctaLabels.length > 0 ? ctaLabels : sourceCtas,
    notes: "Deterministic Russian fallback for affiliate password reset screenshot.",
    body_blocks: bodyBlocks.length > 0 ? bodyBlocks : sourceBlocks,
    source_name: "ru.txt"
  }, mail);
}

function mergeAffPasswordResetMailOntoTemplate(normalizedGeneratedMail, baseMail, payloadTranslationEntries, payload) {
  const screenshotDrivenAffPasswordReset = Boolean(
    payload?.screenshotOcr?.usable
    && hasVisualDesignInput(payload)
    && cleanText(getReferenceTemplateSelection(payload)?.profile) === "aff-password-reset"
  );
  const blankLinksRequested = userRequestedBlankLinks(payload);
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
  const ctaLabel = normalizeAffPasswordResetCtaLabel(
    cleanText(ctaSection?.cta_label)
    || cleanText(generatedSections[0]?.cta_label)
    || cleanText(baseSections[1]?.cta_label),
    cleanText(baseSections[1]?.cta_label)
  );
  const ctaBodyCandidate = splitIntro.cta
    || resolvedIntroSplit.cta
    || cleanText(ctaSection?.body)
    || findGeneratedSectionText(generatedCandidates, ({ text }) => looksLikeAffPasswordResetCtaBody(text));
  const ctaBody = isWeakAffPasswordResetCtaBody(ctaBodyCandidate, ctaLabel)
    ? cleanText(baseSections[1]?.body)
    : cleanText(ctaBodyCandidate);
  const combinedSupportCandidate = cleanText(generatedSections[3]?.body)
    || findGeneratedSectionText(generatedCandidates, ({ text }) => looksLikeAffPasswordResetSupport(text))
    || cleanText(baseSections[3]?.body);
  const splitSupport = splitAffPasswordResetWarningAndSupport(combinedSupportCandidate);
  const warningBody = looksLikeAffPasswordResetWarning(cleanText(generatedSections[2]?.body))
    ? cleanText(generatedSections[2]?.body)
    : findGeneratedSectionText(generatedCandidates, ({ text }) => looksLikeAffPasswordResetWarning(text))
    || cleanText(baseSections[1]?.body);
  const resolvedWarningBody = splitSupport.warning
    || (warningBody === cleanText(baseSections[1]?.body)
    ? cleanText(baseSections[2]?.body)
    : warningBody);
  const supportBody = cleanText(splitSupport.support)
    || (looksLikeAffPasswordResetSupport(cleanText(generatedSections[3]?.body))
      ? cleanText(generatedSections[3]?.body)
      : findGeneratedSectionText(generatedCandidates, ({ text }) => looksLikeAffPasswordResetSupport(text))
        || cleanText(baseSections[3]?.body));
  const footerBody = screenshotDrivenAffPasswordReset
    ? ""
    : cleanText(generatedSections[4]?.body)
      || findGeneratedSectionText(generatedCandidates, ({ kind, text }) => kind === "footer" && cleanText(text).length > 12)
      || cleanText(baseSections[4]?.body);

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
        cta_label: ctaLabel,
        cta_href: blankLinksRequested ? "" : cleanText(ctaSection?.cta_href) || cleanText(generatedSections[0]?.cta_href) || cleanText(baseSections[1]?.cta_href)
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
        body: footerBody
      }
    ],
    assets: baseMail.assets
  };
}

function mergeSystemNoticeMailOntoTemplate(normalizedGeneratedMail, baseMail, payloadTranslationEntries, payload) {
  const blankLinksRequested = userRequestedBlankLinks(payload);
  const baseSections = Array.isArray(baseMail?.sections) ? baseMail.sections.map((section) => normalizeSection(section)) : [];
  const generatedSections = Array.isArray(normalizedGeneratedMail?.sections)
    ? normalizedGeneratedMail.sections.map((section) => normalizeSection(section))
    : [];
  const ctaSection = generatedSections.find((section) => cleanText(section.kind) === "cta") || generatedSections[2] || null;

  return {
    ...baseMail,
    subject: cleanText(baseMail?.subject) || cleanText(normalizedGeneratedMail?.subject),
    preheader: cleanText(baseMail?.preheader) || cleanText(normalizedGeneratedMail?.preheader),
    locale: cleanText(normalizedGeneratedMail?.locale) || cleanText(baseMail?.locale),
    summary: cleanText(normalizedGeneratedMail?.summary) || cleanText(baseMail?.summary),
    brand_logo_url: cleanText(extractLatestLogoOverrideUrl(payload)) || cleanText(baseMail?.brand_logo_url),
    brand_logo_alt: cleanText(baseMail?.brand_logo_alt) || cleanText(normalizedGeneratedMail?.brand_logo_alt) || "IQ Option",
    translations: payloadTranslationEntries.length > 0
      ? payloadTranslationEntries
      : Array.isArray(normalizedGeneratedMail?.translations) && normalizedGeneratedMail.translations.length > 0
        ? normalizedGeneratedMail.translations
        : baseMail.translations,
    sections: [
      {
        ...baseSections[0],
        kind: "text",
        eyebrow: cleanText(baseSections[0]?.eyebrow),
        title: cleanText(baseSections[0]?.title) || cleanText(baseMail?.subject),
        body: cleanText(baseSections[0]?.body)
      },
      {
        ...baseSections[1],
        kind: "feature-list",
        title: cleanText(baseSections[1]?.title) || "Reason for interruption:",
        body: cleanText(baseSections[1]?.body)
      },
      {
        ...baseSections[2],
        kind: "cta",
        body: cleanText(baseSections[2]?.body),
        cta_label: cleanText(baseSections[2]?.cta_label) || cleanText(ctaSection?.cta_label),
        cta_href: blankLinksRequested
          ? ""
          : cleanText(baseSections[2]?.cta_href) || cleanText(ctaSection?.cta_href)
      },
      {
        ...baseSections[3],
        kind: "text",
        body: cleanText(baseSections[3]?.body)
      },
      {
        ...baseSections[4],
        kind: "text",
        body: cleanText(baseSections[4]?.body)
      },
      {
        ...baseSections[5],
        kind: "footer",
        body: cleanText(baseSections[5]?.body)
      }
    ].filter((section) => section && typeof section === "object"),
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

  if (looksLikeSystemNoticeMail(baseMail) || cleanText(getReferenceTemplateSelection(payload)?.profile) === "system-notice-card") {
    return applyPrimaryTranslationEntryToMail(
      applyDeterministicDraftEdits(
        mergeSystemNoticeMailOntoTemplate(normalizedGeneratedMail, baseMail, payloadTranslationEntries, payload),
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

// RTL helpers extracted to src/rtl.js (P0.1 modularization).
// We re-export thin local wrappers under the old names so existing callers
// inside this file keep working without churn. The wrappers inject this
// file's cleanText() so input normalization stays identical.
function isRtlLocale(locale) {
  return _rtlIsRtlLocale(locale);
}

function applyLocaleDirectionToHtml(html, locale) {
  return _rtlApply(html, locale, cleanText);
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
        ...buildFigmaResponseMetadata(payload),
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
        ...buildFigmaResponseMetadata(payload),
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
      ...buildFigmaResponseMetadata(payload),
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
      ...buildFigmaResponseMetadata(payload),
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
    ...buildFigmaResponseMetadata(payload),
    providerRuntime: createProviderRuntime({
      providerId,
      mode: "mock-discuss",
      fallback: true,
      errorMessage: `${providerId} adapter is planned but not wired yet`
    })
  };
}

function shouldAutoGenerateMissingLocalesForDraft(payload, draft) {
  const repairPlan = buildLocaleRepairPlan(payload, draft);
  if (repairPlan.requestedLocales.length <= 1) {
    return false;
  }
  if (repairPlan.targetLocales.length === 0) {
    return false;
  }

  const latestUserMessage = cleanText(getLatestUserMessage(payload)).toLowerCase();
  const explicitlyRequested = /(авто|автомат|automatic|autogen|сделай автомат|сделай перев|переводы.*сделай|generate.*locales|generate.*translations)/i.test(latestUserMessage);
  return explicitlyRequested || !cleanText(payload?.translationText);
}

async function resolveDraftResponse(payload) {
  const providerId = payload.settings.providerId;
  payload = await enrichPayloadWithLocalScreenshotOcr(payload);

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
  // Clone-edit mode: skip template merge so that modified_html (or the base HTML fallback)
  // is preserved in generated.mail and passed through to materializeDraft correctly.
  if (
    templateMail
    && !effectivePayload.baseEmailHtml
    && !shouldSkipEmailBaseBuildForVisualMock(effectivePayload, providerRuntime)
  ) {
    generated = {
      ...generated,
      mail: mergeGeneratedMailOntoTemplate(generated?.mail || null, templateMail, effectivePayload)
    };
  }

  let draftResponse = {
    ...materializeDraft(generated, effectivePayload, mode),
    designAnalysis: normalizeDesignAnalysis(generated.design_analysis),
    ...buildFigmaResponseMetadata(effectivePayload),
    providerRuntime
  };

  const screenshotOcrDebugSummary = createScreenshotOcrDebugSummary(effectivePayload?.screenshotOcr);
  if (screenshotOcrDebugSummary && draftResponse?.draft) {
    draftResponse.draft.screenshotOcr = screenshotOcrDebugSummary;
  }

  const visualPreviewBlocked = buildVisualPreviewBlockedState(effectivePayload, providerRuntime);
  if (visualPreviewBlocked && draftResponse.draft) {
    draftResponse.draft.previewBlocked = visualPreviewBlocked;
    draftResponse.assistantReply = [
      "Скрин получен, но точная сборка по нему сейчас недоступна.",
      visualPreviewBlocked.body,
      "Показываю честный blocked-state вместо случайной фальшивой верстки."
    ].join(" ");
  }

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
      const generatedTranslationEntries = Array.isArray(localesResult?.draft?.mail?.translations)
        ? localesResult.draft.mail.translations
        : [];
      const deterministicGeneratedLocales = generatedTranslationEntries
        .filter((entry) => /deterministic/i.test(cleanText(entry?.notes)))
        .map((entry) => normalizeLocaleCode(entry?.locale))
        .filter((locale) => visibleGeneratedLocales.includes(locale));
      const generatedLocalesNote = visibleGeneratedLocales.length > 0
        ? cleanText(localesResult.mode).startsWith("mock")
          ? deterministicGeneratedLocales.length > 0
            ? ` Rule-based locale fallback: ${deterministicGeneratedLocales.join(", ")}. Остальные locale по-прежнему placeholder, пока AI/billing недоступен.`
            : ` Placeholder locale bundle: ${visibleGeneratedLocales.join(", ")}. Реальный перевод сейчас не сгенерирован из-за ограничений AI/billing.`
          : ` Автопереводы: ${visibleGeneratedLocales.join(", ")}.`
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
      if (screenshotOcrDebugSummary && draftResponse?.draft) {
        draftResponse.draft.screenshotOcr = screenshotOcrDebugSummary;
      }
    } catch {
      // Keep the draft even if locale generation fails.
    }
  }

  draftResponse.assistantReply = appendProblemNotesToAssistantReply(
    draftResponse.assistantReply,
    collectDraftProblemNotes(draftResponse)
  );

  // Clone-edit mode: skip email-base build — the modified HTML IS the preview output.
  if (
    !effectivePayload.baseEmailHtml
    && !shouldSkipEmailBaseBuildForVisualMock(effectivePayload, draftResponse.providerRuntime)
    && summaryEmailBaseBuildIsAvailableForDraft(effectivePayload, draftResponse.draft)
  ) {
    try {
      const builtPreview = await buildTemporaryEmailBasePreviewFromDraft(effectivePayload, draftResponse.draft.mail);
      return {
        ...draftResponse,
        assistantReply: `${cleanText(draftResponse.assistantReply)} Preview прогнан через реальный email-base build.`.trim(),
        draft: screenshotOcrDebugSummary && (builtPreview.draft || draftResponse.draft)
          ? {
              ...(builtPreview.draft || draftResponse.draft),
              screenshotOcr: screenshotOcrDebugSummary
            }
          : builtPreview.draft || draftResponse.draft,
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

function shouldSkipEmailBaseBuildForVisualMock(payload, providerRuntime) {
  if (payload?.screenshotOcr?.usable) {
    return false;
  }

  return Boolean(
    (providerRuntime?.fallback || cleanText(providerRuntime?.mode).startsWith("mock"))
    && hasVisualDesignInput(payload)
    && !hasStructuredFigmaInput(payload)
    && !payload?.baseEmailHtml
  );
}

function buildVisualPreviewBlockedState(payload, providerRuntime) {
  if (!shouldSkipEmailBaseBuildForVisualMock(payload, providerRuntime)) {
    return null;
  }

  if (payload?.screenshotOcr?.usable) {
    return null;
  }

  const issueCode = cleanText(providerRuntime?.issueCode);
  const issueDetail = cleanText(providerRuntime?.errorMessage || providerRuntime?.issueLabel);
  let body = "Студия получила скрин, но сейчас не может честно распознать его через live vision. Вместо случайной сборки из чужих блоков preview остановлен.";

  if (issueCode === "quota") {
    body = "Студия получила скрин, но live vision сейчас недоступен из-за quota или billing OpenAI. Без vision она не может надежно собрать письмо по картинке.";
  } else if (/does not represent a valid image|invalid image/i.test(issueDetail)) {
    body = "Студия получила файл, но рантайм не распознал его как валидную картинку. Нужен реальный PNG/JPG export или Copy as PNG из Figma.";
  }

  return {
    kind: "visual-fallback-blocked",
    title: "Сборка по скрину сейчас недоступна",
    body,
    details: issueDetail,
    nextStep: "Лучший путь сейчас: восстановить live AI vision или прислать structured Figma intake."
  };
}

function formatProviderIssueForUser(providerRuntime) {
  if (!providerRuntime?.fallback) {
    return "";
  }

  if (providerRuntime.issueCode === "quota") {
    return "OpenAI API сейчас уперся в quota или billing.";
  }

  if (providerRuntime.issueCode === "auth") {
    return "OpenAI API вернул ошибку авторизации.";
  }

  if (providerRuntime.issueCode === "rate_limit") {
    return "OpenAI API уперся в rate limit.";
  }

  if (providerRuntime.issueCode === "schema") {
    return "OpenAI structured output schema была отклонена.";
  }

  return cleanText(providerRuntime.errorMessage || providerRuntime.issueLabel);
}

function collectDraftProblemNotes(draftResponse) {
  const notes = [];
  const blocked = draftResponse?.draft?.previewBlocked;
  const providerIssue = formatProviderIssueForUser(draftResponse?.providerRuntime);
  const decompositionWarnings = Array.isArray(draftResponse?.draft?.designDecomposition?.warnings)
    ? draftResponse.draft.designDecomposition.warnings.map(cleanText).filter(Boolean)
    : [];
  const screenshotOcrError = cleanText(draftResponse?.draft?.screenshotOcr?.error);
  const screenshotOcrUsed = Boolean(draftResponse?.draft?.screenshotOcr?.usable);

  if (cleanText(blocked?.body)) {
    notes.push(cleanText(blocked.body));
  }

  if (providerIssue) {
    notes.push(providerIssue);
  }

  if (decompositionWarnings.length > 0 && !screenshotOcrUsed) {
    notes.push(`Design warnings: ${decompositionWarnings.slice(0, 2).join(" | ")}`);
  }

  if (screenshotOcrError) {
    notes.push(`Local OCR warning: ${screenshotOcrError}`);
  }

  return Array.from(new Set(notes.filter(Boolean)));
}

function appendProblemNotesToAssistantReply(reply, notes) {
  const normalizedReply = cleanText(reply);
  const normalizedNotes = Array.isArray(notes) ? notes.filter(Boolean) : [];
  if (normalizedNotes.length === 0) {
    return normalizedReply;
  }

  const missingNotes = normalizedNotes.filter((note) => !normalizedReply.includes(note));
  if (missingNotes.length === 0) {
    return normalizedReply;
  }

  return [
    normalizedReply,
    `Проблемы: ${missingNotes.join(" ")}`
  ].filter(Boolean).join(" ");
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

  // ── AI-tools intent dispatch (placeholderize / translate / fix-locale) ──
  // Looks at the user's last message and, if it matches one of our supported
  // intents, runs the matching helper directly and returns a chat result with
  // an `aiToolResult` field that the frontend can apply (cm.setValue +
  // setLocaleRawContent loop). This bypasses the heavy draft orchestrator,
  // which is where the "AI вернул пустой <body>" failures come from.
  try {
    const dispatched = await tryAiToolsDispatch(payload);
    if (dispatched) return dispatched;
  } catch (err) {
    console.warn("[chat] ai-tools dispatch failed:", err && err.message ? err.message : err);
  }

  if (payload.intent === "discuss") {
    return resolveDiscussionResponse(payload);
  }

  return resolveDraftResponse(payload);
}

// ─── AI tools dispatcher ─────────────────────────────────────────────────
function detectAiToolIntent(text) {
  if (!text) return null;
  const t = String(text).toLowerCase();
  // Questions are NEVER execution intents — let the discussion path answer.
  // A user asking "удобно ли тебе?" / "можешь?" / "как ты бы расставил?" wants
  // an analysis, not the tool to run. Easiest signal: trailing "?", or a
  // few question/conditional verbs.
  const isQuestion = /[?？]\s*$/.test(t)
    || /\bудобно ли\b|\bсможешь(ь| )ли\b|\bпосмотри\b|\bпроанализируй\b|\bрасскажи\b|\bобъясни\b|\bчто такое\b/.test(t)
    || /\bcan you\b|\bcould you\b|\bwould you\b|\bwhat is\b|\bexplain\b|\banalyze\b/.test(t);
  if (isQuestion) return null;

  // ── placeholderize is the HIGHEST-PRIORITY intent. Tolerate Russian
  // mis-spellings (пл[еэ]йсхолдер) — users routinely type 'плэйсхолдер'
  // with э and the old regex missed it.
  if (/(пл[еэ]йсхолд[ае]р|placeholder|\$\{\{)/i.test(t)) {
    return "placeholderize";
  }
  // ── fix-locale / unify-locale: explicit "fix" verbs OR "приведи к единому
  // виду / в соответствие / причеши / унифицируй" — user wants the TXT
  // files cleaned up to match the reference shape. Higher priority than
  // translate, because "translate" would overwrite valid blocks; fix-locale
  // only repairs broken {{...}} / @@…@@ delimiters.
  if ((/(почин|исправ|унифиц|приведи в соответ|приведи к единому|причеши|подправ|поправ)/i.test(t))
      && /(локал|блок|перевод|плейсхолд|плэйсхолд|placeholder|local|translat)/i.test(t)) {
    return "fix-locale";
  }
  // ── translate: only when verb is clearly "translate", and the target is
  // a locale code or "все локали".
  if (/(перевед|перевод|translat)/i.test(t) &&
      /(во все|на все|все локал|all local|каждой локали|every local)/i.test(t)) {
    return "translate-all";
  }
  if (/(перевед|перевод|translat)/i.test(t) && /локал|local/i.test(t)) {
    return "translate-active";
  }
  return null;
}

function lastUserText(payload) {
  if (typeof payload?.message === "string" && payload.message.trim()) return payload.message;
  const msgs = Array.isArray(payload?.messages) ? payload.messages : [];
  for (let i = msgs.length - 1; i >= 0; i -= 1) {
    if (msgs[i]?.role === "user" && typeof msgs[i].content === "string" && msgs[i].content.trim()) {
      return msgs[i].content;
    }
  }
  return "";
}

function pickActiveNamespaceFromBundle(bundleJsonText) {
  if (!bundleJsonText) return null;
  try {
    const arr = JSON.parse(bundleJsonText);
    if (Array.isArray(arr) && arr.length) return arr[0]; // {namespace, locales: { code: blocks[] }}
  } catch {}
  return null;
}

async function tryAiToolsDispatch(payload) {
  if (!openAiApiKey) return null;
  const userText = lastUserText(payload);
  const hasNamespaceWorkspace = Array.isArray(payload?.namespaces)
    && payload.namespaces.some((namespace) => namespace && typeof namespace === "object");
  let intent = detectAiToolIntent(userText);
  if (!intent && hasNamespaceWorkspace && userText && userText.length > 6 && userText.length < 400) {
    // Free-text fallback: ask the model to classify into one of our supported intents.
    try {
      intent = await classifyAiIntent(userText);
    } catch (err) {
      console.warn('[ai-classify] failed:', err && err.message);
    }
  }
  if (!intent) return null;

  // A new-mail request can legitimately mention translations while also
  // attaching a design ("собери письмо и создай RU локаль"). In that case
  // there is no existing locale workspace for the surgical locale tools to
  // edit yet. Let the draft pipeline create the mail and requested locales
  // instead of short-circuiting with "no namespaces loaded".
  if (
    !hasNamespaceWorkspace
    && hasDesignInput(payload)
    && ["translate-all", "translate-active", "fix-locale"].includes(intent)
  ) {
    return null;
  }

  // The frontend bundles namespaces under `brief.contentNotes` (as a JSON dump
  // when localeOpsRequested), and active locale's blocks under `brief.localeBlocks`.
  // We try multiple locations for resilience.
  // Prefer the always-on namespaces[] field that the studio now sends with every chat call.
  let namespacesArr = Array.isArray(payload?.namespaces) ? payload.namespaces : null;
  if (!namespacesArr) {
    const briefNotes = String(payload?.brief?.contentNotes || "");
    const bundleMatch = briefNotes.match(/Locale bundle loaded in Studio:\s*([\s\S]*?)$/);
    namespacesArr = bundleMatch ? safeJsonParse(bundleMatch[1]) : null;
  }

  // Normalize the namespace shape — workbench sends { id, name, locales },
  // older payloads use { namespace, locales }. Make sure both .name and
  // .namespace are populated so downstream code (and prompts) always work.
  const normalizedNamespaces = (Array.isArray(namespacesArr) ? namespacesArr : []).map((n) => {
    if (!n || typeof n !== "object") return n;
    const name = cleanText(n.namespace) || cleanText(n.name) || "";
    return { ...n, name, namespace: name };
  });

  // Pick the most-likely-relevant namespace:
  //   1) explicit activeNamespaceName / activeNamespaceId from payload, if any
  //   2) the largest namespace that ISN'T a known shared utility
  //      (footer_*, header_*, common_*, shared_*)
  //   3) otherwise the first non-utility namespace
  //   4) otherwise the first one
  const UTIL_NS_RE = /^(footer|header|common|shared|partials?|gmail-fix)([_-].*)?$/i;
  function pickRelevantNamespace(list, payload) {
    if (!list.length) return null;
    const activeName = cleanText(payload?.activeNamespaceName || payload?.activeNs || "");
    const activeId   = cleanText(payload?.activeNamespaceId || "");
    if (activeName) {
      const hit = list.find((n) => n.name === activeName || n.namespace === activeName);
      if (hit) return hit;
    }
    if (activeId) {
      const hit = list.find((n) => String(n.id) === activeId);
      if (hit) return hit;
    }
    const nonUtil = list.filter((n) => !UTIL_NS_RE.test(n.name || ""));
    const pool = nonUtil.length ? nonUtil : list;
    pool.sort((a, b) => {
      const ac = Object.values(a.locales || {}).reduce((m, arr) => Math.max(m, Array.isArray(arr) ? arr.length : 0), 0);
      const bc = Object.values(b.locales || {}).reduce((m, arr) => Math.max(m, Array.isArray(arr) ? arr.length : 0), 0);
      return bc - ac; // largest first
    });
    return pool[0] || null;
  }
  const ns = pickRelevantNamespace(normalizedNamespaces, payload);

  // Helper: serialize blocks back to TXT so the AI helpers can consume.
  const serializeBlocks = (blocks) =>
    Array.isArray(blocks) && blocks.length
      ? blocks.map((b) => `{{${b}}}`).join("\n\n") + "\n"
      : "";

  if (intent === "placeholderize") {
    // Source: prefer baseEmailHtml; fallback to currently-open Pug file content.
    let source = String(payload?.baseEmailHtml || "").trim();
    let kind = "html";
    if (!source && payload?.pugSourceFiles && typeof payload.pugSourceFiles === "object") {
      // Pick the first non-empty .pug/.jade file in the bundle.
      for (const [path, content] of Object.entries(payload.pugSourceFiles)) {
        if (/\.(pug|jade)$/i.test(path) && typeof content === "string" && content.trim()) {
          source = content;
          kind = "pug";
          break;
        }
      }
    }
    const html = source;
    if (!html) {
      return aiToolReply("Чтобы поставить плейсхолдеры, открой HTML или .pug файл в редакторе и повтори запрос.");
    }
    if (!ns || !ns.namespace || !ns.locales) {
      return aiToolReply("Не вижу загруженных локалей. Открой папку с TXT-локалями («Локали» → «Выбрать папку») и повтори запрос.");
    }
    const refLocaleCode = ns.locales.en ? "en" : Object.keys(ns.locales)[0];
    const refTxt = serializeBlocks(ns.locales[refLocaleCode]);
    if (!refTxt) {
      return aiToolReply(`В namespace ${ns.namespace} нет блоков для reference (искал ${refLocaleCode}).`);
    }
    const result = await placeholderizeHtml({
      html, refLocaleTxt: refTxt, namespace: ns.namespace,
      apiKey: openAiApiKey, model: "gpt-4.1-mini",
      logger: appendStudioJournalEntry,
      mailHint: ns.namespace,
    });
    if (result.report) {
      try {
        await appendStudioJournalEntry({
          area: "ai-placeholderize",
          title: `Placeholderize ${ns.namespace} (chat)`,
          message: `Anchored ${result.report.anchored}/${result.report.refBlockCount} (${result.report.missed} missed, ${result.report.ambiguous} ambiguous)${result.report.usedSecondPass ? ', used 2nd pass' : ''}`,
          meta: { namespace: ns.namespace, ...result.report,
            decisions: (result.report.decisions || []).map((d) => ({
              blockIndex: d.blockIndex, refText: d.refText, elementId: d.elementId,
              parentChain: d.parentChain,
              similarity: Number(d.similarity?.toFixed?.(3) ?? d.similarity),
              confidence: Number(d.confidence?.toFixed?.(3) ?? d.confidence),
              source: d.source,
            })) },
        });
      } catch { /* non-blocking */ }
    }
    const total = (ns.locales[refLocaleCode] || []).length;
    const refBlocks = ns.locales[refLocaleCode] || [];
    const blockPreview = (i) => {
      const raw = String(refBlocks[i] || "").replace(/@@/g, "");
      return raw.length > 60 ? raw.slice(0, 60) + "..." : raw;
    };
    const lines = [
      `Поставил ${result.anchors}/${total} плейсхолдеров ${ns.namespace}.block_NN в ${kind === 'pug' ? 'Pug-исходнике' : 'Original HTML'}.`,
    ];
    if (result.missed && result.missed.length) {
      lines.push(`Не нашёл совпадения для:`);
      result.missed.slice(0, 10).forEach(i => {
        lines.push(`  • block_${String(i).padStart(2, '0')}: "${blockPreview(i)}"`);
      });
      if (result.missed.length > 10) {
        lines.push(`  ...и ещё ${result.missed.length - 10} блоков.`);
      }
      lines.push(`Эти блоки нужно расставить вручную или поправить текст в HTML/локали.`);
    }
    if (result.ambiguous && result.ambiguous.length) {
      lines.push(`Несколько совпадений в HTML (поэтому не вставил):`);
      result.ambiguous.slice(0, 5).forEach(i => {
        lines.push(`  • block_${String(i).padStart(2, '0')}: "${blockPreview(i)}"`);
      });
    }
    if (result.anchors > 0) {
      lines.push("Переключайся на любую локаль — переводы подставятся из TXT.");
    }
    return aiToolReply(lines.join(" "), {
      kind: "placeholderize",
      editorHtml: result.html,
      summary: { anchors: result.anchors, total, missed: result.missed, ambiguous: result.ambiguous },
    });
  }

  if (intent === "translate-all" || intent === "translate-active") {
    if (!ns || !ns.locales) {
      return aiToolReply("Сначала загрузи namespace с локалями (TXT-файлы в Студию).");
    }
    const srcCode = ns.locales.en ? "en" : (ns.referenceLocale || Object.keys(ns.locales)[0]);
    const srcTxt = serializeBlocks(ns.locales[srcCode]);
    if (!srcTxt) return aiToolReply(`Нет содержимого для source-локали ${srcCode}.`);

    const allCodes = Object.keys(ns.locales);
    const targets = intent === "translate-all"
      ? allCodes.filter((c) => c !== srcCode)
      : [String(payload?.activeLocale || "").trim() || allCodes.find((c) => c !== srcCode)].filter(Boolean);

    if (!targets.length) return aiToolReply("Не нашёл целевых локалей для перевода.");

    const localeUpdates = [];
    const errors = [];
    for (const tgt of targets) {
      try {
        const r = await translateLocaleTxt({
          srcTxt, fromLang: srcCode, toLang: tgt,
          apiKey: openAiApiKey, model: "gpt-4.1-mini",
        });
        // Guard: if AI returned blocks containing literal ${{...}}$ tokens
        // (a hallucination — user asked for translation, not placeholderize),
        // refuse to overwrite the locale.
        const looksLikePh = r.blocks.some((b) => /\$\{\{[\s\S]*?\}\}\$/.test(b));
        if (looksLikePh) {
          errors.push(`${tgt}: AI returned literal ${'${{'}}-tokens — refused, locale not overwritten`);
          continue;
        }
        localeUpdates.push({ namespace: ns.namespace, code: tgt, txt: r.translatedTxt, blocks: r.blocks.length, skipped: r.skipped });
      } catch (e) {
        errors.push(`${tgt}: ${e.message}`);
      }
    }
    const summary = `Перевёл ${localeUpdates.length}/${targets.length} локал${targets.length === 1 ? 'ь' : 'ей'} из ${srcCode} в namespace «${ns.namespace}».` +
      (errors.length ? ` Ошибки: ${errors.join("; ")}.` : "");
    return aiToolReply(summary, { kind: "translate", localeUpdates });
  }

  if (intent === "fix-locale") {
    if (!ns || !ns.locales) return aiToolReply("Сначала загрузи namespace с локалями.");

    // Two modes:
    //   - "all"     — user asked to bring EVERY locale to the reference shape
    //                 (e.g. «приведи переводы к единому виду», «причеши все локали»)
    //   - "active"  — user explicitly wants the currently-active locale only.
    const userText = String(payload?.text || payload?.message || "").toLowerCase() ||
                     (Array.isArray(payload?.messages) ? String(payload.messages[payload.messages.length - 1]?.content || "").toLowerCase() : "");
    const looksLikeAll = /(во все|на все|все локал|всех локал|каждой локал|all local|every local|единому виду|единый вид|в соответ|причеши|унифиц|приведи переводы|all locales|all the locales)/i.test(userText);

    // Reference locale: prefer 'en', otherwise the namespace's stored reference, otherwise first.
    const refCode = ns.locales.en ? "en" : (ns.referenceLocale || Object.keys(ns.locales)[0]);
    const refTxt = refCode ? serializeBlocks(ns.locales[refCode]) : "";

    // Determine target list.
    let targets;
    if (looksLikeAll) {
      targets = Object.keys(ns.locales).filter((c) => c && c !== refCode);
    } else {
      const code = String(payload?.activeLocale || "").trim();
      if (!code || code === "original") {
        return aiToolReply("Переключись на конкретную локаль (ar, ur, ru, …), или попроси «приведи все локали к единому виду» — починю пачкой.");
      }
      targets = [code];
    }

    if (!targets.length) {
      return aiToolReply(`Не нашёл целевых локалей для починки (reference=${refCode}).`);
    }

    const localeUpdates = [];
    const summary = [];
    const errors = [];

    for (const code of targets) {
      const txt = serializeBlocks(ns.locales[code]);
      if (!txt) { errors.push(`${code}: нет содержимого`); continue; }
      try {
        const r = await fixLocaleTxt({
          txt, refTxt: (refTxt && code !== refCode) ? refTxt : undefined,
          language: code, apiKey: openAiApiKey, model: "gpt-4.1-mini",
        });
        // Guard: AI must not insert literal ${{ ... }}$ tokens INTO locale TXT.
        const looksLikePh = (r.blocks || []).some((b) => /\$\{\{[\s\S]*?\}\}\$/.test(b));
        if (looksLikePh) {
          errors.push(`${code}: AI вернул литеральные \${{ ... }}\$-токены в блоках, пропустил.`);
          continue;
        }
        const before = (ns.locales[code] || []).length;
        const after = r.blocks.length;
        localeUpdates.push({ namespace: ns.namespace, code, txt: r.fixedTxt, blocks: after });
        summary.push(`${code}: ${before} → ${after}`);
      } catch (err) {
        errors.push(`${code}: ${err && err.message ? err.message : err}`);
      }
    }

    const lines = [];
    if (localeUpdates.length) {
      lines.push(`Привёл ${localeUpdates.length} локаль(и) к виду reference=${refCode} в «${ns.namespace}»: ${summary.join(", ")}.`);
    }
    if (errors.length) {
      lines.push(`Не удалось: ${errors.slice(0, 6).join("; ")}${errors.length > 6 ? `; …и ещё ${errors.length - 6}` : ""}.`);
    }
    if (!localeUpdates.length && !errors.length) {
      lines.push("Все локали уже совпадают с reference — чинить нечего.");
    }
    return aiToolReply(lines.join(" "), { kind: "fix-locale", localeUpdates });
  }

  return null;
}


const _AI_INTENT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    intent: {
      type: "string",
      enum: ["placeholderize", "translate-all", "translate-active", "fix-locale", "none"],
    },
    confidence: { type: "number", minimum: 0, maximum: 1 },
  },
  required: ["intent", "confidence"],
};

async function classifyAiIntent(text) {
  const sys =
    "Classify the user's free-text request into ONE intent for an email-localization studio. " +
    "Be aggressive — most messages map to an intent; pick `none` only for greetings, jokes, or pure analysis questions.\n" +
    "Intents:\n" +
    "  • placeholderize  — insert ${{ ns.block_NN }}$ placeholders into the HTML. " +
    "    Triggers (any of): «расставь / расставить / распиши / разметь плейсхолдер[ыов]», «put placeholders», «mark placeholders», " +
    "    «согласно ENG/английскому», «по логике английского текста», any spelling with е/э (плей/плэй), or the literal `${`.\n" +
    "  • translate-all  — translate the email TXT into ALL loaded locales. " +
    "    Triggers: «переведи во все локали», «translate to all locales», «локализуй на все языки».\n" +
    "  • translate-active  — translate into the currently active locale only. " +
    "    Triggers: «переведи на ar/ru/…», «локализуй активную локаль», «translate to active locale».\n" +
    "  • fix-locale  — repair / unify locale TXT (broken {{}} brackets, @@ markers, block count, drift between locales). " +
    "    Triggers: «приведи к единому виду», «приведи в соответствие», «причеши блоки», «унифицируй переводы», " +
    "    «почини локаль», «исправь блоки», «поправь форматирование», «fix / repair locale».\n" +
    "  • none  — analysis / questions / chat / greetings.\n\n" +
    "Priority rules:\n" +
    "  1. If the message asks to PLACE/RECOVER placeholders → placeholderize.\n" +
    "  2. If the message asks to UNIFY / REPAIR / ALIGN locale TXTs (and does NOT ask to translate the meaning) → fix-locale.\n" +
    "  3. If the message asks to TRANSLATE meaning into another language → translate-*.\n" +
    "  4. Be lenient on word forms, typos (плей/плэй, расставь/расставить), and Russian/English/mixed wording.\n" +
    "Return intent + confidence (0..1). Use confidence ≥0.8 when the verb is explicit; 0.5–0.8 when it's implied.";
  const data = await callOpenAiWithRetry(
    async () => ({
      url: "https://api.openai.com/v1/responses",
      body: {
        model: "gpt-4.1-mini",
        input: [
          { role: "system", content: [{ type: "input_text", text: sys }] },
          { role: "user",   content: [{ type: "input_text", text }] },
        ],
        text: { format: { type: "json_schema", name: "ai_intent", strict: true, schema: _AI_INTENT_SCHEMA } },
      },
    }),
    { label: "ai-intent-classify", apiKey: openAiApiKey }
  );
  const txt = extractResponseText(data);
  if (!txt) return null;
  const parsed = JSON.parse(txt);
  const intent = parsed?.intent;
  if (!intent || intent === "none") return null;
  if ((parsed.confidence ?? 1) < 0.5) return null;
  return intent;
}

function safeJsonParse(s) { try { return JSON.parse(s); } catch { return null; } }

function aiToolReply(text, aiToolResult) {
  return {
    assistantReply: text,
    mode: "ai-tool",
    ...(aiToolResult ? { aiToolResult } : {}),
  };
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
    result = attachLayoutModelToChatResult(result, payload);
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
  const repairPlan = buildLocaleRepairPlan(payload, baseDraft);
  const {
    baseMail,
    sourceEntry,
    existingEntries,
    requestedLocales,
    targetLocales
  } = repairPlan;

  if (requestedLocales.length === 0) {
    throw new Error("Requested locales are empty. Fill the Requested locales field first.");
  }
  const sourceEntries = mergeSourceTranslationEntryIntoEntries(
    existingEntries.length > 0 ? existingEntries : [sourceEntry],
    sourceEntry,
    baseMail
  );
  const cloneEditPreviewLocales = cleanText(baseDraft?.html)
    ? buildCloneEditPreviewLocalesFromHtml(
        { ...baseMail, translations: sourceEntries },
        cleanText(baseDraft?.html),
        payload,
        Object.entries(baseDraft?.previewLocales && typeof baseDraft.previewLocales === "object" ? baseDraft.previewLocales : {})
          .map(([locale, html]) => ({ locale, html }))
      )
    : null;

  if (targetLocales.length === 0) {
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
        previewCategory: payload.brief.category,
        previewLocales: cloneEditPreviewLocales || undefined
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
      generated = await createDeepLTranslations(payload, baseMail, sourceEntry, targetLocales);
      mode = "deepl-translations";
      providerRuntime = createProviderRuntime({ providerId, mode, liveAttempted: true, liveUsed: true });
    } catch (error) {
      generated = createMockTranslations(payload, baseMail, sourceEntry, targetLocales, error.message);
      mode = "mock-translations";
      providerRuntime = createProviderRuntime({ providerId, mode, liveAttempted: true, fallback: true, errorMessage: error.message });
    }
  } else if (providerId === "openai" && openAiApiKey) {
    try {
      generated = await createOpenAiTranslations(payload, baseMail, sourceEntry, targetLocales);
      mode = "openai-translations";
      providerRuntime = createProviderRuntime({
        providerId,
        mode,
        liveAttempted: true,
        liveUsed: true
      });
    } catch (error) {
      generated = createMockTranslations(payload, baseMail, sourceEntry, targetLocales, error.message);
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
    generated = createMockTranslations(payload, baseMail, sourceEntry, targetLocales, "Mock translation mode selected.");
    mode = "mock-translations";
    providerRuntime = createProviderRuntime({
      providerId,
      mode
    });
  } else if (providerId === "openai") {
    generated = createMockTranslations(payload, baseMail, sourceEntry, targetLocales, "OPENAI_API_KEY is not configured on the server.");
    mode = "mock-translations";
    providerRuntime = createProviderRuntime({
      providerId,
      mode,
      fallback: true,
      errorMessage: "OPENAI_API_KEY is not configured on the server."
    });
  } else {
    generated = createMockTranslations(payload, baseMail, sourceEntry, targetLocales, `${providerId} adapter is planned but not wired yet.`);
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
  const mergedCloneEditPreviewLocales = cleanText(baseDraft?.html)
    ? buildCloneEditPreviewLocalesFromHtml(
        mergedMail,
        cleanText(baseDraft?.html),
        payload,
        Object.entries(baseDraft?.previewLocales && typeof baseDraft.previewLocales === "object" ? baseDraft.previewLocales : {})
          .map(([locale, html]) => ({ locale, html }))
      )
    : null;

  return {
    assistantReply: cleanText(generated.assistant_reply)
      || `Generated missing locales: ${targetLocales.join(", ")}.`,
    mode,
    providerRuntime,
    generatedLocales: targetLocales,
    translationText: renderTranslationBundle(mergedTranslations),
    uploadStatus: `Translation bundle now contains ${mergedTranslations.length} locale file(s). Generated/repaired: ${targetLocales.join(", ")}.`,
    draft: createDraftSnapshot(mergedMail, baseDraft, {
      assetRecommendations: buildAssetRecommendations(mergedMail, payload),
      previewCategory: payload.brief.category,
      previewLocales: mergedCloneEditPreviewLocales || undefined
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

function safeCredentialEquals(actual, expected) {
  const actualBuffer = Buffer.from(String(actual || ""), "utf8");
  const expectedBuffer = Buffer.from(String(expected || ""), "utf8");
  return actualBuffer.length === expectedBuffer.length
    && timingSafeEqual(actualBuffer, expectedBuffer);
}

function isApplicationRequestAuthorized(request) {
  if (!appAuthEnabled) return true;
  const authorization = String(request?.headers?.authorization || "");
  if (!authorization.startsWith("Basic ")) return false;

  try {
    const decoded = Buffer.from(authorization.slice(6), "base64").toString("utf8");
    const separator = decoded.indexOf(":");
    if (separator < 0) return false;
    const username = decoded.slice(0, separator);
    const password = decoded.slice(separator + 1);
    return safeCredentialEquals(username, appAuthUser)
      && safeCredentialEquals(password, appAuthPassword);
  } catch {
    return false;
  }
}

function isAuthExemptRequest(request) {
  if (request?.method === "GET" && request?.url === "/healthz") return true;
  return request?.url === "/api/figma/import"
    && (request?.method === "POST" || request?.method === "OPTIONS");
}

function rejectUnauthorizedRequest(response) {
  response.writeHead(401, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "WWW-Authenticate": 'Basic realm="Retention Studio", charset="UTF-8"'
  });
  response.end(JSON.stringify({ error: "Authentication required" }));
}

const server = http.createServer(async (request, response) => {
  try {
    if (request.method === "GET" && request.url === "/healthz") {
      sendJson(response, 200, {
        ok: true,
        service: "retention-future",
        node: process.version,
        authEnabled: appAuthEnabled
      });
      return;
    }

    if (!isAuthExemptRequest(request) && !isApplicationRequestAuthorized(request)) {
      rejectUnauthorizedRequest(response);
      return;
    }

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

    if (request.method === "POST" && request.url === "/api/figma/readiness") {
      const body = await readRequestBody(request);
      const figmaUrl = findFirstFigmaUrlInPayload(body) || cleanText(body?.url);
      const existingStructuredImport = normalizeFigmaImportPayload(
        body?.figmaImport && typeof body.figmaImport === "object"
          ? body.figmaImport
          : body
      );
      const hasStructured = hasDetailedFigmaImportPayload(existingStructuredImport);
      const hasVisual = Boolean(
        cleanText(body?.dataUrl)
        || cleanText(body?.imageUrl)
        || cleanText(body?.image_url)
        || cleanText(body?.screenshotUrl)
        || cleanText(body?.screenshot_url)
        || cleanText(body?.previewUrl)
        || cleanText(body?.preview_url)
      );
      const readiness = assessFigmaIntakeReadiness(figmaUrl, {
        hasStructured,
        hasVisual
      });
      const intakeSummary = buildFigmaIntakeSummary({
        figmaImport: existingStructuredImport,
        readiness,
        importMethod: hasStructured ? cleanText(existingStructuredImport?.source) || "structured-import" : "",
        hasLink: Boolean(figmaUrl),
        hasVisual
      });

      sendJson(response, 200, {
        figma: summarizeFigmaIntegration(),
        readiness,
        structuredCoverage: intakeSummary.coverage,
        summary: intakeSummary.text
      }, getFigmaImportCorsHeaders());
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
      const responseFigmaEnrichment = payloadForNormalization?.figmaEnrichment && typeof payloadForNormalization.figmaEnrichment === "object"
        ? payloadForNormalization.figmaEnrichment
        : result.intake.hasStructured
          ? {
              source: cleanText(result.intake.importMethod) || "structured-import",
              structured: true,
              readiness: result.intake.readiness,
              structuredCoverage: result.intake.structuredCoverage,
              summary: result.intake.summary
            }
          : null;
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
        ok: true,
        design: result.design,
        designSchema: result.designSchema,
        designDecomposition,
        designMappingHints,
        designBlockRecommendations,
        composePlan: (() => { try { return buildComposePlanFromDesign({ schema: result.designSchema }); } catch (e) { return { plan: [], warnings: [String(e && e.message || e)] }; } })(),
        figmaEnrichment: responseFigmaEnrichment,
        decompositionSummary: summarizeDesignDecomposition(designDecomposition),
        mappingSummary: summarizeDesignMappingHints(designMappingHints),
        blockRecommendationSummary: summarizeDesignBlockRecommendations(designBlockRecommendations),
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
        tokenUsage,
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
      const decomposeFigmaEnrichment = payload?.figmaEnrichment && typeof payload.figmaEnrichment === "object"
        ? payload.figmaEnrichment
        : hasDetailedFigmaImportPayload(payload?.design?.figmaImport)
          ? {
              source: cleanText(payload?.design?.figmaImport?.source) || "structured-import",
              structured: true,
              structuredCoverage: summarizeNormalizedFigmaImportCoverage(payload?.design?.figmaImport),
              summary: buildFigmaIntakeSummary({
                figmaImport: payload?.design?.figmaImport,
                readiness: assessFigmaIntakeReadiness(cleanText(payload?.brief?.designUrl), {
                  hasStructured: true,
                  hasVisual: Boolean(cleanText(payload?.design?.dataUrl))
                }),
                importMethod: cleanText(payload?.design?.figmaImport?.source) || "structured-import",
                hasLink: Boolean(cleanText(payload?.brief?.designUrl)),
                hasVisual: Boolean(cleanText(payload?.design?.dataUrl))
              }).text
            }
          : null;
      sendJson(response, 200, {
        designSchema: payload.designSchema,
        designDecomposition: payload.designDecomposition,
        designMappingHints: payload.designMappingHints,
        designBlockRecommendations: payload.designBlockRecommendations,
        figmaEnrichment: decomposeFigmaEnrichment,
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

    // ── Block library (hand-crafted canonical blocks + user-saved) ──
    if (request.method === "GET" && request.url === "/api/blocks-library") {
      try {
        const blocks = listCanonicalBlocks();
        sendJson(response, 200, { count: blocks.length, blocks });
      } catch (err) {
        sendJson(response, 500, { error: String(err && err.message ? err.message : err) });
      }
      return;
    }

    // ── Save a new user-block (or overwrite if force=true).
    if (request.method === "POST" && request.url === "/api/blocks-library/save") {
      try {
        const body = await readRequestBody(request);
        const id = String(body?.id || "").trim();
        if (!id || !/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(id)) {
          sendJson(response, 400, { error: "id must be 1-64 chars, letters/digits/_/-" });
          return;
        }
        const label = String(body?.label || id).trim().slice(0, 120);
        const description = String(body?.description || "").trim().slice(0, 400);
        const placement = body?.placement === "section" || body?.placement === "inline" || body?.placement === "helper"
          ? body.placement : "inline";
        const category = String(body?.category || "misc").trim().slice(0, 40);
        const pug = String(body?.pug || "");
        const styl = String(body?.styl || "");
        if (!pug.trim()) { sendJson(response, 400, { error: "pug content required" }); return; }
        const slots = Array.isArray(body?.slots) ? body.slots.map((sl) => ({
          id: String(sl?.id || "").trim(),
          kind: String(sl?.kind || "text"),
          label: String(sl?.label || sl?.id || ""),
          default: sl?.default,
          min: sl?.min, max: sl?.max, options: sl?.options,
        })).filter((sl) => sl.id) : [];
        const force = Boolean(body?.force);
        const target = userBlockPath(id);
        if (existsSync(target) && !force) {
          sendJson(response, 409, { error: "block id already exists", hint: "send force=true to overwrite" });
          return;
        }
        await mkdir(userBlockDir(), { recursive: true });
        const blockJson = {
          id, label, description, placement, category,
          version: 1, source: "user",
          pug, styl, slots,
          tags: Array.isArray(body?.tags) ? body.tags.slice(0, 12).map(String) : [],
          createdAt: new Date().toISOString(),
        };
        await writeFile(target, JSON.stringify(blockJson, null, 2) + "\n", "utf8");
        try { await appendStudioJournalEntry({ area: "blocks", title: `User block saved: ${id}`, message: `placement=${placement}, slots=${slots.length}`, meta: { id, placement, category, slots: slots.length } }); } catch {}
        sendJson(response, 200, { ok: true, id, path: path.relative(__dirname, target) });
      } catch (err) {
        sendJson(response, 500, { error: String(err && err.message ? err.message : err) });
      }
      return;
    }

    // ── Delete a user-block by id.
    if (request.method === "DELETE" && request.url.startsWith("/api/blocks-library/user/")) {
      try {
        const id = decodeURIComponent(request.url.slice("/api/blocks-library/user/".length));
        if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(id)) { sendJson(response, 400, { error: "invalid id" }); return; }
        const target = userBlockPath(id);
        if (!existsSync(target)) { sendJson(response, 404, { error: "not found" }); return; }
        await rm(target, { force: true });
        sendJson(response, 200, { ok: true, id });
      } catch (err) {
        sendJson(response, 500, { error: String(err && err.message ? err.message : err) });
      }
      return;
    }

    // ── Compose-preview: build a mail from blocks+slots and return dist HTML inline ──
    // No file persistence — uses an in-memory dest under /tmp.
    if (request.method === "POST" && request.url === "/api/compose-preview") {
      try {
        const body = await readRequestBody(request);
        const blocks = Array.isArray(body?.blocks) ? body.blocks : [];
        if (!blocks.length) { sendJson(response, 400, { error: "blocks array required" }); return; }
        const mailName = String(body?.mailName || ("preview-" + Date.now())).replace(/[^a-z0-9_-]/gi, "-").toLowerCase();
        const brand = "X_preview";
        const tmpDir = path.join(os.tmpdir(), "retkit-compose-preview");
        await mkdir(tmpDir, { recursive: true });
        // Symlink (or copy) vendor + tools so build-mail.js can find them.
        for (const item of ["vendor", "tools", "node_modules"]) {
          const src = path.join(__dirname, "email-base", item);
          const dst = path.join(tmpDir, item);
          if (existsSync(src) && !existsSync(dst)) {
            try { fsLink.symlinkSync(src, dst, "dir"); } catch { /* ignore */ }
          }
        }
        // Compose into tmp dir.
        const composed = composeEmailFromBlocks({ brand, mailName, blocks, destRoot: tmpDir, markBlocks: true });
        // Run build-mail.js synchronously.
        const built = await new Promise((resolve) => {
          const args = ["tools/build-mail.js", "--category", brand, "--mail", mailName, "--locales", "en", "--pretty"];
          const child = spawn(process.execPath, args, { cwd: tmpDir, stdio: ["ignore", "pipe", "pipe"] });
          let stderr = "";
          child.stderr.on("data", (d) => { stderr += d.toString(); });
          child.on("close", (code) => resolve({ code, stderr }));
          child.on("error", (err) => resolve({ code: -1, stderr: String(err) }));
        });
        if (built.code !== 0) {
          sendJson(response, 422, { error: "build failed", stderr: built.stderr.slice(0, 800) });
          return;
        }
        const distHtml = path.join(tmpDir, "dist", brand, "mail-" + mailName, "en", "index.html");
        if (!existsSync(distHtml)) {
          sendJson(response, 500, { error: "build succeeded but dist HTML missing" });
          return;
        }
        const html = await readFile(distHtml, "utf8");
        sendJson(response, 200, {
          ok: true, mailName, brand,
          html, htmlLength: html.length,
          blocksUsed: composed.blocksUsed, totalBlocks: composed.totalBlocks,
          warnings: composed.warnings,
        });
      } catch (err) {
        sendJson(response, 500, { error: String(err && err.message ? err.message : err) });
      }
      return;
    }

    // ── Compose-save: persist the assembled mail into email-base/<brand>/mail-<name>/
    //    and build it. Used by the constructor's Save button. Refuses if the
    //    target folder already exists (unless force=true).
    if (request.method === "POST" && request.url === "/api/compose-save") {
      try {
        const body = await readRequestBody(request);
        const blocks = Array.isArray(body?.blocks) ? body.blocks : [];
        if (!blocks.length) { sendJson(response, 400, { error: "blocks array required" }); return; }
        const rawName = String(body?.mailName || "").trim();
        if (!rawName || !/^[a-z0-9_-]+$/i.test(rawName)) {
          sendJson(response, 400, { error: "mailName must be letters/digits/_/- only" });
          return;
        }
        const brand = String(body?.brand || "X_assembled").replace(/[^a-zA-Z0-9_]/g, "") || "X_assembled";
        const destFolder = path.join(__dirname, "email-base", brand, "mail-" + rawName);
        const force = Boolean(body?.force);
        if (existsSync(destFolder) && !force) {
          sendJson(response, 409, {
            error: "mail already exists",
            existsAt: path.relative(__dirname, destFolder),
            hint: "pick a different name OR send { force: true } to overwrite",
          });
          return;
        }
        // Compose into email-base directly.
        const composed = composeEmailFromBlocks({
          brand, mailName: rawName, blocks,
          destRoot: path.join(__dirname, "email-base"),
        });
        // Build it.
        const built = await new Promise((resolve) => {
          const args = ["tools/build-mail.js", "--category", brand, "--mail", rawName, "--locales", "en", "--pretty"];
          const child = spawn(process.execPath, args, { cwd: path.join(__dirname, "email-base"), stdio: ["ignore", "pipe", "pipe"] });
          let stderr = "";
          child.stderr.on("data", (d) => { stderr += d.toString(); });
          child.on("close", (code) => resolve({ code, stderr }));
          child.on("error", (err) => resolve({ code: -1, stderr: String(err) }));
        });
        const journalMeta = { brand, mailName: rawName, blocksUsed: composed.blocksUsed, buildOk: built.code === 0 };
        try { await appendStudioJournalEntry({ area: "constructor", title: `Mail saved: ${brand}/mail-${rawName}`, message: `${composed.blocksUsed}/${composed.totalBlocks} blocks; build ${built.code === 0 ? "ok" : "failed"}`, meta: journalMeta }); } catch {}
        if (built.code !== 0) {
          sendJson(response, 422, {
            ok: false,
            error: "saved but build failed",
            path: path.relative(__dirname, destFolder),
            stderr: built.stderr.slice(0, 800),
          });
          return;
        }
        sendJson(response, 200, {
          ok: true,
          brand, mailName: rawName,
          path: path.relative(__dirname, destFolder),
          blocksUsed: composed.blocksUsed,
          totalBlocks: composed.totalBlocks,
          warnings: composed.warnings,
        });
      } catch (err) {
        sendJson(response, 500, { error: String(err && err.message ? err.message : err) });
      }
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
      const chatResult = attachLayoutModelToChatResult(await resolveChatResponse(payload), payload);
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

    if (request.method === "POST" && request.url === "/api/chat/intent") {
      const body = await readRequestBody(request);
      const text = cleanText(body?.text || body?.message || "");
      const minConfidence = Number(body?.minConfidence ?? 0.6);
      try {
        const r = _classifyChatIntent(text);
        if (!r) {
          sendJson(response, 200, { ok: true, intent: null });
          return;
        }
        const meetsThreshold = r.confidence >= minConfidence;
        sendJson(response, 200, {
          ok: true,
          intent: r.intent,
          params: r.params,
          confidence: r.confidence,
          hint: r.hint || null,
          shouldExecute: meetsThreshold,
        });
      } catch (err) {
        console.error("[chat/intent] failed:", err);
        sendJson(response, 500, { error: String(err && err.message ? err.message : err) });
      }
      return;
    }

    if (request.method === "POST" && request.url === "/api/mail/infer-placeholders") {
      const body = await readRequestBody(request);
      const html = cleanText(body?.html);
      if (!html) {
        sendJson(response, 400, { error: "html is required" });
        return;
      }
      const mailNamespace = cleanText(body?.mailNamespace) || null;
      try {
        const result = _inferPlaceholders(html, { mailNamespace });
        sendJson(response, 200, { ok: true, ...result });
      } catch (err) {
        console.error("[infer-placeholders] failed:", err);
        sendJson(response, 500, { error: String(err && err.message ? err.message : err) });
      }
      return;
    }

    if (request.method === "GET" && request.url.startsWith("/api/blocks/by-mail")) {
      try {
        const u = new URL(request.url, "http://localhost");
        const force = u.searchParams.get("force") === "1";
        const result = await _buildBlocksByMail({ force });
        sendJson(response, 200, { ok: true, ...result });
      } catch (err) {
        console.error("[blocks/by-mail] failed:", err);
        sendJson(response, 500, { error: String(err && err.message ? err.message : err) });
      }
      return;
    }

    if (request.method === "GET" && request.url.startsWith("/api/blocks/source")) {
      try {
        const u = new URL(request.url, "http://localhost");
        const category = u.searchParams.get("category") || "";
        const mailId = u.searchParams.get("mailId") || "";
        const blockFile = u.searchParams.get("blockFile") || "";
        const src = await _readBlockSource({ category, mailId, blockFile });
        if (!src) {
          sendJson(response, 404, { error: "block not found or invalid params" });
          return;
        }
        sendJson(response, 200, { ok: true, text: src.text, path: src.absPath.replace(process.cwd(), "") });
      } catch (err) {
        console.error("[blocks/source] failed:", err);
        sendJson(response, 500, { error: String(err && err.message ? err.message : err) });
      }
      return;
    }

    if (request.method === "GET" && request.url.startsWith("/api/mail/placeholders-index")) {
      try {
        const u = new URL(request.url, "http://localhost");
        const locale = (u.searchParams.get("locale") || "en").toLowerCase();
        const force = u.searchParams.get("force") === "1";
        const result = await _buildPlaceholdersIndex({ locale, force });
        sendJson(response, 200, { ok: true, ...result });
      } catch (err) {
        console.error("[placeholders-index] failed:", err);
        sendJson(response, 500, { error: String(err && err.message ? err.message : err) });
      }
      return;
    }

    if (request.method === "POST" && request.url === "/api/mail/apply-placeholders") {
      const body = await readRequestBody(request);
      const html = cleanText(body?.html);
      const accepted = Array.isArray(body?.accepted) ? body.accepted : [];
      if (!html) {
        sendJson(response, 400, { error: "html is required" });
        return;
      }
      try {
        const result = _applyPlaceholderProposals(html, accepted);
        sendJson(response, 200, { ok: true, ...result });
      } catch (err) {
        console.error("[apply-placeholders] failed:", err);
        sendJson(response, 500, { error: String(err && err.message ? err.message : err) });
      }
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

    if (request.method === "POST" && request.url === "/api/layout-model/inspect") {
      let payload = normalizePayload(await readRequestBody(request));
      payload = await enrichPayloadWithServerSideFigma(payload);
      const html = cleanText(payload?.baseEmailHtml)
        || cleanText(payload?.currentDraft?.html)
        || cleanText(payload?.currentDraft?.mail?.html);
      const contentMap = html ? extractEmailHtmlContentMap(html) : getCloneEditContentMap(payload);
      const layoutModel = buildLayoutModel({
        brief: payload?.brief,
        contentMap,
        screenshotOcr: payload?.screenshotOcr,
        designSchema: payload?.designSchema,
        designAnalysis: payload?.designAnalysis,
        draft: payload?.currentDraft ? { ...payload.currentDraft } : null
      });

      sendJson(response, 200, {
        ok: Boolean(layoutModel),
        layoutModel,
        summary: summarizeLayoutModel(layoutModel),
        meta: summarizeLayoutModelMeta(layoutModel)
      });
      return;
    }

    if (request.method === "GET" && request.url === "/api/scenarios") {
      const scenarios = listScenarioFixtures(scenarioFixturesDir);
      sendJson(response, 200, {
        ok: true,
        count: scenarios.length,
        scenarios: scenarios.map((entry) => ({
          id: entry.id,
          title: entry.title,
          description: entry.description,
          type: entry.type,
          tags: entry.tags,
          fileName: entry.fileName
        }))
      });
      return;
    }

    if (request.method === "POST" && request.url === "/api/scenarios/save") {
      const body = await readRequestBody(request);
      const scenario = body?.scenario && typeof body.scenario === "object" ? body.scenario : body;
      const saved = await saveScenarioFixture(scenarioFixturesDir, scenario, {
        overwrite: Boolean(body?.overwrite)
      });
      sendJson(response, 200, {
        ok: true,
        id: saved.id,
        fileName: saved.fileName,
        filePath: saved.filePath,
        scenario: saved.scenario
      });
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
      const rawPayload = await readRequestBody(request);
      const payload = normalizePayload(rawPayload);
      const summary = summarizeEmailBase();
      const category = cleanText(
        payload?.brief?.category
        || rawPayload?.brief?.category
        || rawPayload?.category
        || payload?.category
      ) || summary.currentMail?.category;
      const mailId = cleanText(
        payload?.brief?.mailId
        || rawPayload?.brief?.mailId
        || rawPayload?.mailId
        || payload?.mailId
      ) || summary.currentMail?.mailId;
      const locale = cleanText(
        payload?.brief?.locale
        || rawPayload?.brief?.locale
        || rawPayload?.locale
        || payload?.locale
      ) || payload.brief.locale || "en";

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

    // ─── Add locale to existing saved email ────────────────────────────
    // POST /api/email-base/add-locale
    // Body: { category, mailId, locale, sourceLocale?, engine? }
    // Reads existing studio.mail.json → source locale JSON → translates → writes new locale → rebuilds
    if (request.method === "POST" && request.url === "/api/email-base/add-locale") {
      const body = await readRequestBody(request);
      const category = ensureSafeCategoryName(cleanText(body?.category));
      const mailId   = cleanText(body?.mailId);
      const locale   = normalizeLocaleCode(cleanText(body?.locale));
      const engine   = cleanText(body?.engine) || "openai"; // "openai" | "deepl"

      if (!category || !mailId || !locale) {
        sendJson(response, 400, { error: "category, mailId and locale are required" });
        return;
      }

      const summary = summarizeEmailBase();
      if (!summary.available) {
        sendJson(response, 400, { error: "email-base is not attached" });
        return;
      }

      const mailRoot = path.join(emailBaseRoot, category, `mail-${mailId}`);
      if (!existsSync(mailRoot)) {
        sendJson(response, 404, { error: `Mail not found: ${category}/mail-${mailId}` });
        return;
      }

      // Read studio.mail.json to get translationFileKey and primaryLocale
      const metaPath = path.join(mailRoot, "studio.mail.json");
      if (!existsSync(metaPath)) {
        sendJson(response, 400, { error: "studio.mail.json not found for this mail — was it created via email-studio?" });
        return;
      }
      const meta = JSON.parse(await readFile(metaPath, "utf8"));
      const translationFileKey = cleanText(meta.translation_file);
      const sourceLocale = normalizeLocaleCode(cleanText(body?.sourceLocale) || cleanText(meta.primary_locale) || "en");
      const mail = meta.mail && typeof meta.mail === "object" ? meta.mail : {};

      if (!translationFileKey) {
        sendJson(response, 400, { error: "translation_file not found in studio.mail.json" });
        return;
      }

      // Check target locale doesn't already exist
      const targetLocalePath = path.join(emailBaseRoot, "vendor", "data", locale, `${translationFileKey}.json`);
      if (existsSync(targetLocalePath)) {
        sendJson(response, 409, { error: `Locale '${locale}' already exists for this mail (${translationFileKey}.json)` });
        return;
      }

      // Read source locale JSON as the translation source
      const sourceLocalePath = path.join(emailBaseRoot, "vendor", "data", sourceLocale, `${translationFileKey}.json`);
      let sourceEntry;
      if (existsSync(sourceLocalePath)) {
        const raw = JSON.parse(await readFile(sourceLocalePath, "utf8"));
        sourceEntry = {
          locale: sourceLocale,
          subject:     cleanText(raw.subject) || cleanText(mail.subject) || "",
          preheader:   cleanText(raw.preheader) || cleanText(mail.preheader) || "",
          cta_labels:  Array.isArray(raw.cta_labels) ? raw.cta_labels : [],
          body_blocks: Array.isArray(raw.body_blocks) ? raw.body_blocks : [],
          sections:    raw.sections || {},
          notes:       cleanText(raw.summary) || ""
        };
      } else {
        // Fall back to mail metadata fields
        sourceEntry = {
          locale: sourceLocale,
          subject: cleanText(mail.subject) || "",
          preheader: cleanText(mail.preheader) || "",
          cta_labels: [],
          body_blocks: [],
          sections: {},
          notes: ""
        };
      }

      // Run translation
      let translationResult;
      try {
        const fakePayload = {
          brief: { locale: sourceLocale, translationLocales: [locale] },
          assetInputs: [], assetRegistryItems: [], designInputs: []
        };
        if (engine === "deepl") {
          translationResult = await createDeepLTranslations(fakePayload, mail, sourceEntry, [locale]);
        } else {
          translationResult = await createOpenAiTranslations(fakePayload, mail, sourceEntry, [locale]);
        }
      } catch (err) {
        sendJson(response, 500, { error: `Translation failed: ${err.message}` });
        return;
      }

      const translatedEntry = Array.isArray(translationResult.translations)
        ? translationResult.translations.find((t) => normalizeLocaleCode(cleanText(t.locale)) === locale)
        : null;

      if (!translatedEntry) {
        sendJson(response, 500, { error: "Translation engine returned no results for the requested locale" });
        return;
      }

      // Write the new locale JSON
      const localePayload = createLocalePayloadForEntry(mail, { ...translatedEntry, locale, source_name: `${translationFileKey}.json` });
      const localeDir = path.join(emailBaseRoot, "vendor", "data", locale);
      await mkdir(localeDir, { recursive: true });
      await writeFile(targetLocalePath, JSON.stringify(localePayload, null, 2), "utf8");

      // Rebuild for the new locale to get preview HTML
      const buildResult = await runCommand(
        process.execPath,
        ["mail", "build-pretty", category, mailId, "--locales", locale],
        emailBaseRoot
      );
      const distDir  = path.join(emailBaseRoot, "dist", category, `mail-${mailId}`, locale);
      const prettyPath = path.join(distDir, "index.pretty.html");
      const compactPath = path.join(distDir, "index.html");
      const htmlPath = existsSync(prettyPath) ? prettyPath : compactPath;
      const previewHtml = existsSync(htmlPath)
        ? applyLocaleDirectionToHtml(await readFile(htmlPath, "utf8"), locale)
        : null;
      const buildLog = [buildResult.stdout, buildResult.stderr].filter(Boolean).join("\n").trim() || "Build completed.";

      await appendStudioJournalEntry({
        area: "email-base",
        title: "Locale added",
        message: `Added ${locale} to ${category}/mail-${mailId} via ${engine}.`,
        meta: { category, mailId, locale, translationFileKey, engine }
      });

      sendJson(response, 200, {
        ok: true,
        locale,
        category,
        mailId,
        translationFileKey,
        previewHtml,
        buildLog,
        assistantReply: `${translationResult.assistant_reply || ""} Записал ${locale} в vendor/data/${locale}/${translationFileKey}.json и собрал preview.`
      });
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

    // POST /api/email-base/html-to-pug — AI converts pasted HTML email → studio Pug blocks
    // Body: { html, mailId?, userMessage? }
    // Response: { pugBlocks, subject, preheader, assistantReply }
    if (request.method === "POST" && request.url === "/api/email-base/html-to-pug") {
      const body = await readJsonBody(request);
      const html = cleanText(body?.html);
      if (!html || html.length < 100) {
        sendJson(response, 400, { error: "html is required (min 100 chars)" });
        return;
      }

      const model = resolveOpenAiModelForTask("clone_edit");
      const messages = [
        { role: "user", content: [
          body?.userMessage ? `Task: ${body.userMessage}` : "Convert this HTML email to studio Pug blocks.",
          "",
          "=== VENDOR MIXIN REFERENCE ===",
          buildVendorMixinsReference(),
          buildMarkupPatternsReference(),
          "=== HTML EMAIL TO CONVERT ===",
          html
        ].join("\n") }
      ];

      let result;
      try {
        const data = await _aiCall(
          async () => ({
            body: {
              model,
              system: htmlToPugSystemPrompt,
              input: messages,
              text: { format: { type: "json_schema", name: "email_studio_response", strict: true, schema: responseSchema } }
            }
          }),
          "html_to_pug"
        );
        const rawText = extractResponseText(data);
        result = JSON.parse(rawText);
      } catch (err) {
        sendJson(response, 500, { error: `AI conversion failed: ${err.message}` });
        return;
      }

      const rawPugBlocks = Array.isArray(result.mail?.pug_blocks) ? result.mail.pug_blocks : [];
      const pugBlocks = rawPugBlocks
        .filter((b) => b && cleanText(b.label) && cleanText(b.pug_code))
        .map((b) => ({ label: cleanText(b.label), pug_code: b.pug_code.trim() }));

      sendJson(response, 200, {
        pugBlocks,
        subject:       cleanText(result.mail?.subject) || "",
        preheader:     cleanText(result.mail?.preheader) || "",
        assistantReply: cleanText(result.assistant_reply) || "Конвертация завершена.",
      });
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

    // GET /api/legacy-toolkit/snapshot — imported legacy toolkit metadata
    if (request.method === "GET" && request.url === "/api/legacy-toolkit/snapshot") {
      try {
        const raw = await readFile(legacyToolkitSnapshotPath, "utf8");
        const snapshot = JSON.parse(raw);
        sendJson(response, 200, snapshot);
      } catch (err) {
        sendJson(response, 404, { error: `Legacy toolkit snapshot is not available: ${err.message}` });
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

    // ── Workbench: list source emails from email-base ────────────────────
    // ── Workbench: block catalog + snippets (for drag-and-drop "From base" shelf)
    if (request.method === "GET" && request.url === "/api/wb/block-catalog") {
      try {
        const catalogP  = path.join(studioDataDir, "block-catalog.json");
        const snippetsP = path.join(studioDataDir, "block-snippets.json");
        const catalog   = existsSync(catalogP)
          ? JSON.parse(readFileSync(catalogP, "utf8"))
          : { items: [] };
        const snippets  = existsSync(snippetsP)
          ? JSON.parse(readFileSync(snippetsP, "utf8"))
          : { items: {} };
        // Combine: every catalog item gets its snippet (if any) inlined.
        const items = (Array.isArray(catalog.items) ? catalog.items : [])
          .map(it => {
            const snip = snippets?.items?.[it.id];
            return {
              id: it.id,
              label: it.label,
              description: it.description,
              sectionKind: it.sectionKind,
              usageCount: it.usageCount || 0,
              traits: it.traits || {},
              pug: snip?.pug || null,
              sourceFile: snip?.sourceFile || null,
            };
          })
          .sort((a, b) => (b.usageCount || 0) - (a.usageCount || 0));
        sendJson(response, 200, { ok: true, items });
      } catch (e) {
        sendJson(response, 500, { error: e.message });
      }
      return;
    }

    // ── AI: place ${{ ns.block_NN }}$ placeholders in HTML matching reference TXT ──
    if (request.method === "POST" && request.url === "/api/wb/ai/placeholderize") {
      try {
        const { html = "", refLocaleTxt = "", namespace = "" } = await readRequestBody(request);
        if (!openAiApiKey) { sendJson(response, 503, { error: "OPENAI_API_KEY is not configured" }); return; }
        if (!html || !refLocaleTxt || !namespace) {
          sendJson(response, 400, { error: "html, refLocaleTxt, namespace required" }); return;
        }
        const result = await placeholderizeHtml({
          html, refLocaleTxt, namespace,
          apiKey: openAiApiKey, model: "gpt-4.1-mini",
          logger: appendStudioJournalEntry,
          mailHint: namespace,
        });
        // Journal the structured decision report so we accumulate calibration data.
        try {
          if (result.report) {
            await appendStudioJournalEntry({
              area: "ai-placeholderize",
              title: `Placeholderize ${namespace}`,
              message: `Anchored ${result.report.anchored}/${result.report.refBlockCount} (${result.report.missed} missed, ${result.report.ambiguous} ambiguous)${result.report.usedSecondPass ? ', used 2nd pass' : ''}`,
              meta: {
                namespace,
                ...result.report,
                decisions: (result.report.decisions || []).map((d) => ({
                  blockIndex: d.blockIndex,
                  refText: d.refText,
                  elementId: d.elementId,
                  parentChain: d.parentChain,
                  similarity: Number(d.similarity?.toFixed?.(3) ?? d.similarity),
                  confidence: Number(d.confidence?.toFixed?.(3) ?? d.confidence),
                  source: d.source,
                })),
              },
            });
          }
        } catch { /* non-blocking */ }
        sendJson(response, 200, { ok: true, ...result });
      } catch (e) {
        sendJson(response, 500, { error: e.message });
      }
      return;
    }

    // ── AI Agent: real tool-use loop (read_open_html, analyze, placeholderize,
    //              fix_locale, translate, finish) — the model decides what to call.
    //              Streams NDJSON frames so the UI can render each tool call live.
    if (request.method === "POST" && request.url === "/api/wb/ai/agent") {
      try {
        const body = await readRequestBody(request);
        if (!openAiApiKey) { sendJson(response, 503, { error: "OPENAI_API_KEY is not configured" }); return; }
        const userMessage = String(body?.message || body?.text || "").trim();
        if (!userMessage) { sendJson(response, 400, { error: "message required" }); return; }

        // Build ctx: HTML currently open + loaded namespaces + active.
        const namespaces = Array.isArray(body?.namespaces) ? body.namespaces.map((n) => ({
          ...n,
          name: cleanText(n.namespace) || cleanText(n.name) || "",
          namespace: cleanText(n.namespace) || cleanText(n.name) || "",
        })) : [];
        const activeName = cleanText(body?.activeNamespaceName || "");
        const activeNamespace = activeName
          ? (namespaces.find((n) => n.name === activeName) || null)
          : (namespaces[0] || null);
        const ctx = {
          html: String(body?.baseEmailHtml || body?.html || "").trim(),
          namespaces,
          activeNamespace,
          activeLocale: cleanText(body?.activeLocale || ""),
        };

        // Stream NDJSON frames as the agent runs.
        response.writeHead(200, {
          "Content-Type": "application/x-ndjson; charset=utf-8",
          "Cache-Control": "no-store",
          Connection: "keep-alive",
        });
        const send = (frame) => {
          try { response.write(JSON.stringify(frame) + "\n"); } catch { /* ignore */ }
        };
        send({ kind: "start", ctxSummary: {
          htmlLength: ctx.html.length,
          namespaces: namespaces.length,
          activeNamespace: activeNamespace ? activeNamespace.name : null,
          activeLocale: ctx.activeLocale,
        }});

        try {
          const result = await runAgent({
            userMessage,
            history: Array.isArray(body?.messages) ? body.messages : [],
            ctx,
            apiKey: openAiApiKey,
            model: "gpt-4.1-mini",
            onFrame: send,
          });
          // Journal the agent run (best-effort).
          try {
            await appendStudioJournalEntry({
              area: "ai-agent",
              title: `Agent: ${userMessage.slice(0, 60)}`,
              message: `${result.steps.length} step(s); ${result.localeUpdates?.length || 0} locale update(s); ${result.modifiedHtml ? "modified HTML" : "no HTML change"}`,
              meta: {
                userMessage: userMessage.slice(0, 200),
                summary: result.summary,
                steps: result.steps.map((s) => ({ kind: s.kind, name: s.name || null })),
              },
            });
          } catch { /* non-blocking */ }
          send({ kind: "final", payload: {
            summary: result.summary,
            modifiedHtml: result.modifiedHtml || "",
            localeUpdates: result.localeUpdates || [],
            localeDeletes: result.localeDeletes || [],
          }});
        } catch (err) {
          send({ kind: "error", message: String(err && err.message ? err.message : err) });
        } finally {
          response.end();
        }
      } catch (e) {
        try { sendJson(response, 500, { error: e.message }); } catch { response.end(); }
      }
      return;
    }

    // ── AI: fix a possibly-broken locale TXT (paired {{}}, balanced @@, ...) ──
    // ── Zero-AI: детерминированная починка локали по конвенциям проекта ──
    // (переменные {{embedded.*}}/{{user_name}} вне текстовых блоков, скобки,
    //  Subject-строка). См. src/locale-conventions.js.
    if (request.method === "POST" && request.url === "/api/wb/locale-normalize") {
      try {
        const body = await readRequestBody(request);
        const txt = String(body?.txt || "");
        if (!txt.trim()) { sendJson(response, 400, { error: "txt required" }); return; }
        const r = _normalizeLocaleConventions(txt);
        // Если передан namespace — вернуть ещё и анкер-юниты для расстановки
        // плейсхолдеров (текст+переменная+хвост одного абзаца = один юнит).
        const nsName = cleanText(body?.namespace || "");
        const units = nsName ? _buildAnchorUnits(r.txt, nsName) : undefined;
        sendJson(response, 200, { ok: true, changed: r.changed, txt: r.txt, changes: r.changes, ...(units ? { units } : {}) });
      } catch (err) {
        sendJson(response, 500, { error: String(err && err.message ? err.message : err) });
      }
      return;
    }

    // ── Zero-AI: полная подготовка namespace к расстановке плейсхолдеров ──
    // 1) нормализовать конвенции во ВСЕХ локалях;
    // 2) выровнять каждую локаль по структуре reference (одинаковое число
    //    блоков, переменные на местах, нехватка → пустой блок-спейсер);
    // 3) вернуть готовые TXT по всем локалям + анкер-юниты reference.
    if (request.method === "POST" && request.url === "/api/wb/locale-prepare") {
      try {
        const body = await readRequestBody(request);
        const nsName = cleanText(body?.namespace || "ns");
        const locales = body?.locales && typeof body.locales === "object" ? body.locales : {};
        const codes = Object.keys(locales);
        if (!codes.length) { sendJson(response, 400, { error: "locales map required" }); return; }
        let refCode = cleanText(body?.refCode || "");
        if (!refCode || !(refCode in locales)) {
          refCode = codes.find((c) => /^en/i.test(c)) || codes[0];
        }
        // Шаг 1: нормализация конвенций.
        const norm = {};
        for (const code of codes) norm[code] = _normalizeLocaleConventions(String(locales[code] || "")).txt;
        const refBlocks = _parseNormalizedBlocks(norm[refCode]);
        // Шаг 2: выравнивание не-reference локалей по reference.
        const out = {};
        const report = {};
        for (const code of codes) {
          if (code === refCode) { out[code] = norm[code]; report[code] = { aligned: false, padded: 0 }; continue; }
          const locBlocks = _parseNormalizedBlocks(norm[code]);
          const al = _alignLocaleToReference(refBlocks, locBlocks);
          out[code] = _serializeAligned(_localePrefix(norm[code]), al.blocks);
          report[code] = { aligned: true, padded: al.padded, dropped: al.dropped, before: locBlocks.length, after: al.blocks.length };
        }
        // Шаг 3: анкер-юниты reference для расстановки в HTML.
        const units = _buildAnchorUnits(norm[refCode], nsName.replace(/[^a-z0-9_-]/gi, "_"));
        sendJson(response, 200, { ok: true, refCode, refBlockCount: refBlocks.length, locales: out, report, units });
      } catch (err) {
        sendJson(response, 500, { error: String(err && err.message ? err.message : err) });
      }
      return;
    }

    if (request.method === "POST" && request.url === "/api/wb/ai/fix-locale-txt") {
      try {
        const { txt = "", refTxt = "", language = "" } = await readRequestBody(request);
        if (!openAiApiKey) { sendJson(response, 503, { error: "OPENAI_API_KEY is not configured" }); return; }
        if (!txt) { sendJson(response, 400, { error: "txt required" }); return; }
        const result = await fixLocaleTxt({
          txt, refTxt: refTxt || undefined, language: language || undefined,
          apiKey: openAiApiKey, model: "gpt-4.1-mini",
        });
        sendJson(response, 200, { ok: true, ...result });
      } catch (e) {
        sendJson(response, 500, { error: e.message });
      }
      return;
    }

    // ── AI: translate a locale TXT block-by-block to a new language ──────────
    if (request.method === "POST" && request.url === "/api/wb/ai/translate-locale-txt") {
      try {
        const { srcTxt = "", fromLang = "", toLang = "" } = await readRequestBody(request);
        if (!openAiApiKey) { sendJson(response, 503, { error: "OPENAI_API_KEY is not configured" }); return; }
        if (!srcTxt || !toLang) { sendJson(response, 400, { error: "srcTxt and toLang required" }); return; }
        const result = await translateLocaleTxt({
          srcTxt, fromLang: fromLang || undefined, toLang,
          apiKey: openAiApiKey, model: "gpt-4.1-mini",
        });
        sendJson(response, 200, { ok: true, ...result });
      } catch (e) {
        sendJson(response, 500, { error: e.message });
      }
      return;
    }

    // ── Built-in namespaces (footer_upload etc) ─────────────────────────────
    if (request.method === "GET" && request.url === "/api/wb/builtin-namespaces") {
      try {
        const fp = path.join(studioDataDir, "builtin-namespaces.json");
        const data = existsSync(fp)
          ? JSON.parse(readFileSync(fp, "utf8"))
          : { namespaces: [] };
        sendJson(response, 200, { ok: true, namespaces: data.namespaces || [] });
      } catch (e) { sendJson(response, 500, { error: e.message }); }
      return;
    }

    if (request.method === "GET" && request.url === "/api/wb/emails") {
      const srcRoot  = path.join(__dirname, "email-base");
      const distRoot = path.join(__dirname, "email-base", "dist");
      const result   = [];
      const SKIP = new Set(['dist', 'node_modules', 'vendor', 'docs', '_legacy', '_trash', 'mail', 'tools']);
      try {
        const brands = readdirSync(srcRoot, { withFileTypes: true })
          .filter(d => d.isDirectory() && !d.name.startsWith('_') && !SKIP.has(d.name))
          .map(d => d.name);
        for (const brand of brands) {
          const brandDir = path.join(srcRoot, brand);
          const mails = readdirSync(brandDir, { withFileTypes: true })
            .filter(d => d.isDirectory() && d.name.startsWith('mail-'))
            .map(d => {
              const built = existsSync(path.join(distRoot, brand, d.name, 'index.html'));
              return { name: d.name, built };
            });
          if (mails.length) result.push({ brand, mails });
        }
      } catch(e) { console.error('[wb] emails list error:', e.message); }
      sendJson(response, 200, { ok: true, emails: result });
      return;
    }

    // ── Workbench: read a dist email HTML ─────────────────────────────────
    if (request.method === "GET" && request.url.startsWith("/api/wb/email?")) {
      const params = new URL(request.url, "http://localhost").searchParams;
      const brand  = (params.get("brand") || "").replace(/\.\./g, "");
      const mail   = (params.get("mail") || "").replace(/\.\./g, "");
      if (!brand || !mail) { sendJson(response, 400, { error: "brand and mail required" }); return; }
      const htmlPath = path.join(__dirname, "email-base", "dist", brand, mail, "index.html");
      try {
        const data = await readFile(htmlPath, "utf8");
        sendJson(response, 200, { ok: true, html: data, brand, mail });
      } catch {
        sendJson(response, 404, { error: "Not found" });
      }
      return;
    }

    // ── Workbench: list editable source files for an email ───────────────────
    if (request.method === "GET" && request.url.startsWith("/api/wb/email-files?")) {
      const params = new URL(request.url, "http://localhost").searchParams;
      const brand  = (params.get("brand") || "").replace(/\.\./g, "");
      const mail   = (params.get("mail")  || "").replace(/\.\./g, "");
      if (!brand || !mail) { sendJson(response, 400, { error: "brand and mail required" }); return; }
      const emailDir = path.join(__dirname, "email-base", brand, mail, "app");
      try {
        const files = [];
        const walk = (dir, rel) => {
          const entries = readdirSync(dir, { withFileTypes: true });
          for (const e of entries) {
            if (e.name.startsWith(".") || e.name === "node_modules" || e.name === "dist") continue;
            const relPath = rel ? rel + "/" + e.name : e.name;
            const absPath = path.join(dir, e.name);
            if (e.isDirectory()) { walk(absPath, relPath); }
            else if (/\.(pug|styl|jade)$/.test(e.name)) {
              // Prefer .pug over .jade: skip .jade if a matching .pug exists on disk
              if (e.name.endsWith(".jade")) {
                const pugAbsPath = absPath.replace(/\.jade$/, ".pug");
                if (existsSync(pugAbsPath)) continue;
              }
              files.push({ path: relPath, ext: path.extname(e.name).slice(1) });
            }
          }
        };
        walk(emailDir, "");
        sendJson(response, 200, { ok: true, files, brand, mail });
      } catch(e) {
        sendJson(response, 404, { error: e.message });
      }
      return;
    }

    // ── Workbench: read a source file ────────────────────────────────────────
    if (request.method === "GET" && request.url.startsWith("/api/wb/email-file?")) {
      const params = new URL(request.url, "http://localhost").searchParams;
      const brand  = (params.get("brand") || "").replace(/\.\./g, "");
      const mail   = (params.get("mail")  || "").replace(/\.\./g, "");
      const file   = (params.get("file")  || "").replace(/\.\./g, "");
      if (!brand || !mail || !file) { sendJson(response, 400, { error: "brand, mail, file required" }); return; }
      try {
        const filePath = path.join(__dirname, "email-base", brand, mail, "app", file);
        const content = await readFile(filePath, "utf8");
        sendJson(response, 200, { ok: true, content, brand, mail, file });
      } catch(e) {
        sendJson(response, 404, { error: "File not found" });
      }
      return;
    }

    // ── Workbench: save a source file ────────────────────────────────────────
    if (request.method === "POST" && request.url === "/api/wb/email-file") {
      const { brand = "", mail = "", file = "", content = "" } = await readRequestBody(request);
      if (!brand || !mail || !file) { sendJson(response, 400, { error: "brand, mail, file required" }); return; }
      const safeBrand = brand.replace(/\.\./g, "");
      const safeMail  = mail.replace(/\.\./g, "");
      const safeFile  = file.replace(/\.\./g, "");
      try {
        const filePath = path.join(__dirname, "email-base", safeBrand, safeMail, "app", safeFile);
        await writeFile(filePath, content, "utf8");
        sendJson(response, 200, { ok: true });
      } catch(e) {
        sendJson(response, 500, { error: e.message });
      }
      return;
    }

    // ── Workbench: rebuild an email from source (Pug+Stylus → HTML) ────────
    if (request.method === "POST" && request.url === "/api/wb/build-email") {
      const { brand = "", mail = "" } = await readRequestBody(request);
      if (!brand || !mail) { sendJson(response, 400, { error: "brand and mail required" }); return; }
      const safeBrand = brand.replace(/\.\./g, "").replace(/[^a-zA-Z0-9_\-]/g, "");
      const safeMail  = mail.replace(/\.\./g, "").replace(/[^a-zA-Z0-9_\-]/g, "");
      // build-mail.js convention: --mail <name> where name has no "mail-" prefix
      // (it adds "mail-" internally). Strip it from folder names like "mail-welcome" -> "welcome"
      const mailArg   = safeMail.replace(/^mail-/, "");
      const emailBaseDir = path.join(__dirname, "email-base");
      const t0 = Date.now();
      try {
        await new Promise((resolve, reject) => {
          const child = spawn(
            process.execPath,
            ["tools/build-mail.js", "--category", safeBrand, "--mail", mailArg],
            { cwd: emailBaseDir, stdio: ["ignore", "pipe", "pipe"] }
          );
          let errOut = "";
          child.stderr.on("data", d => { errOut += d.toString(); });
          child.on("close", code => {
            if (code === 0) resolve();
            else reject(new Error(errOut.trim().split("\n").pop() || `Exit ${code}`));
          });
        });
        sendJson(response, 200, { ok: true, duration: Date.now() - t0 });
      } catch(err) {
        sendJson(response, 422, { ok: false, error: err.message });
      }
      return;
    }

    // ── Workbench: Clone email ───────────────────────────────────────────────
    if (request.method === "POST" && request.url === "/api/wb/email-clone") {
      const { brand = "", mail = "", newName = "" } = await readRequestBody(request);
      const safe = s => s.replace(/\.\./g, "").replace(/[^a-zA-Z0-9_\-]/g, "");
      const sBrand = safe(brand), sMail = safe(mail), sNew = safe(newName);
      if (!sBrand || !sMail || !sNew) { sendJson(response, 400, { error: "brand, mail, newName required" }); return; }
      const src  = path.join(__dirname, "email-base", sBrand, sMail);
      const dest = path.join(__dirname, "email-base", sBrand, sNew);
      if (!existsSync(src)) { sendJson(response, 404, { error: "Source not found" }); return; }
      if (existsSync(dest)) { sendJson(response, 409, { error: "Destination already exists" }); return; }
      try {
        await cp(src, dest, { recursive: true });
        sendJson(response, 200, { ok: true });
      } catch(e) { sendJson(response, 500, { error: e.message }); }
      return;
    }

    // ── Workbench: Rename email ──────────────────────────────────────────────
    if (request.method === "POST" && request.url === "/api/wb/email-rename") {
      const { brand = "", mail = "", newName = "" } = await readRequestBody(request);
      const safe = s => s.replace(/\.\./g, "").replace(/[^a-zA-Z0-9_\-]/g, "");
      const sBrand = safe(brand), sMail = safe(mail), sNew = safe(newName);
      if (!sBrand || !sMail || !sNew) { sendJson(response, 400, { error: "brand, mail, newName required" }); return; }
      const src  = path.join(__dirname, "email-base", sBrand, sMail);
      const dest = path.join(__dirname, "email-base", sBrand, sNew);
      if (!existsSync(src)) { sendJson(response, 404, { error: "Source not found" }); return; }
      if (existsSync(dest)) { sendJson(response, 409, { error: "Destination already exists" }); return; }
      try {
        await rename(src, dest);
        sendJson(response, 200, { ok: true });
      } catch(e) { sendJson(response, 500, { error: e.message }); }
      return;
    }

    // ── Workbench: Delete email (moves to _trash to avoid EPERM on mounted FS) ──
    if (request.method === "POST" && request.url === "/api/wb/email-delete") {
      const { brand = "", mail = "" } = await readRequestBody(request);
      const safe = s => s.replace(/\.\./g, "").replace(/[^a-zA-Z0-9_\-]/g, "");
      const sBrand = safe(brand), sMail = safe(mail);
      if (!sBrand || !sMail) { sendJson(response, 400, { error: "brand and mail required" }); return; }
      const target    = path.join(__dirname, "email-base", sBrand, sMail);
      const trashDir  = path.join(__dirname, "email-base", "_trash", sBrand);
      const trashDest = path.join(trashDir, sMail + "__" + Date.now());
      if (!existsSync(target)) { sendJson(response, 404, { error: "Not found" }); return; }
      try {
        await mkdir(trashDir, { recursive: true });
        await rename(target, trashDest);
        sendJson(response, 200, { ok: true, note: "moved to _trash/" + sBrand });
      } catch(e) { sendJson(response, 500, { error: e.message }); }
      return;
    }

    // ── Workbench: Pug / Stylus converter ───────────────────────────────────
    if (request.method === "POST" && request.url === "/api/wb/convert") {
      const body = await readRequestBody(request);
      const { code = "", from } = body;
      try {
        if (from === "pug") {
          const { default: pug } = await import("pug");
          const html = pug.render(code, { pretty: true });
          sendJson(response, 200, { ok: true, result: html, to: "html" });
        } else if (from === "stylus") {
          const { default: stylus } = await import("stylus");
          const css = await new Promise((res, rej) => {
            stylus(code).render((err, css) => err ? rej(err) : res(css));
          });
          sendJson(response, 200, { ok: true, result: css, to: "css" });
        } else if (from === "html2pug") {
          // HTML → Pug (decompile)
          const { default: html2pug } = await import("html2pug");
          const pug = html2pug(code, { tabs: false, nspaces: 2, fragment: false });
          sendJson(response, 200, { ok: true, result: pug, to: "pug" });
        } else {
          sendJson(response, 400, { error: "Unknown from type. Use 'pug', 'stylus', or 'html2pug'." });
        }
      } catch (err) {
        sendJson(response, 422, { error: err.message });
      }
      return;
    }

    // ── Workbench: Import HTML → create new email source structure ──────────
    if (request.method === "POST" && request.url === "/api/wb/email-import") {
      const { brand = "", name = "", html = "", createBrand = false, format = "pug" } = await readRequestBody(request);
      const safe = s => s.replace(/\.\./g, "").replace(/[^a-zA-Z0-9_\-]/g, "");
      const sBrand = safe(brand), sName = safe(name);
      if (!sBrand || !sName) { sendJson(response, 400, { error: "brand and name required" }); return; }
      const mailFolder = sName.startsWith("mail-") ? sName : `mail-${sName}`;
      const mailDir   = path.join(__dirname, "email-base", sBrand, mailFolder);
      const templDir  = path.join(mailDir, "app", "templates");
      const stylesDir = path.join(mailDir, "app", "styles");
      const helpersDir = path.join(stylesDir, "helpers");
      const blocksDir  = path.join(stylesDir, "blocks");
      if (existsSync(mailDir)) { sendJson(response, 409, { error: "Письмо с таким именем уже существует" }); return; }
      try {
        // Create brand dir if needed
        const brandDir = path.join(__dirname, "email-base", sBrand);
        if (!existsSync(brandDir)) {
          if (!createBrand) { sendJson(response, 404, { error: "Бренд не найден. Создайте его сначала." }); return; }
          await mkdir(brandDir, { recursive: true });
        }
        await mkdir(templDir, { recursive: true });

        // ─── RAW HTML MODE ─────────────────────────────────────────────
        // No Pug, no Stylus. build-mail.js detects index.html and uses it
        // verbatim — only localization + RTL run on it.
        if (format === "html" || format === "raw") {
          await writeFile(path.join(templDir, "index.html"), html || "", "utf-8");
          // Still create an EMPTY app/styles/ dir so future "add stylus" works
          // without surprise, but no required files.
          await mkdir(stylesDir, { recursive: true });
          sendJson(response, 200, { ok: true, brand: sBrand, mail: mailFolder, format: "html" });
          return;
        }

        // ─── PUG + STYLUS MODE (legacy default) ────────────────────────
        await mkdir(helpersDir, { recursive: true });
        await mkdir(blocksDir, { recursive: true });
        const pugContent = html ? `//- Импортировано из HTML\n${html}` : `//- Пустое письмо\ndoctype html\nhtml\n  head\n    title ${sName}\n  body\n    .wrapper Письмо`;
        await writeFile(path.join(templDir, "index.pug"), pugContent, "utf-8");
        await writeFile(path.join(stylesDir, "common.styl"), `@import 'helpers/variables'\n@import 'helpers/ink'\n@import 'helpers/mixins'\n@import 'blocks/main'\n`, "utf-8");
        await writeFile(path.join(helpersDir, "variables.styl"), `// Переменные для ${sName}\n`, "utf-8");
        await writeFile(path.join(blocksDir, "main.styl"), `// Стили для ${sName}\n`, "utf-8");
        sendJson(response, 200, { ok: true, brand: sBrand, mail: mailFolder, format: "pug" });
      } catch(e) { sendJson(response, 500, { error: e.message }); }
      return;
    }

    // ── Workbench: Create new brand folder ──────────────────────────────────
    if (request.method === "POST" && request.url === "/api/wb/create-brand") {
      const { name = "" } = await readRequestBody(request);
      const safe = s => s.replace(/\.\./g, "").replace(/[^a-zA-Z0-9_\-]/g, "");
      const sName = safe(name);
      if (!sName) { sendJson(response, 400, { error: "name required" }); return; }
      const brandDir = path.join(__dirname, "email-base", sName);
      if (existsSync(brandDir)) { sendJson(response, 409, { error: "Бренд уже существует" }); return; }
      try {
        await mkdir(brandDir, { recursive: true });
        sendJson(response, 200, { ok: true, brand: sName });
      } catch(e) { sendJson(response, 500, { error: e.message }); }
      return;
    }

    // ── Workbench: HTML → Pug AI reverse compilation ────────────────
    if (request.method === "POST" && request.url === "/api/wb/html-to-pug") {
      const { originalHtml = "", modifiedHtml = "", currentPug = "", pugPath = "" } = await readRequestBody(request);
      if (!modifiedHtml || !currentPug) {
        sendJson(response, 400, { error: "modifiedHtml and currentPug are required" });
        return;
      }
      if (!openAiApiKey) {
        sendJson(response, 503, { error: "OPENAI_API_KEY is not configured" });
        return;
      }
      try {
        const systemMsg = [
          "You are a senior Pug email template developer.",
          "The user has edited the compiled HTML of a Pug email template.",
          "Your job: apply ONLY the user's HTML changes to the Pug source file — preserve all existing structure, mixin calls, class names, and ${{ token }}$ placeholders.",
          "CRITICAL: Return the FULL updated Pug file content, not a diff, not a snippet — the complete file.",
          "CRITICAL: NEVER remove existing blocks, mixins, or tokens that were not changed by the user.",
          "Output: a single fenced code block ```pug ... ``` containing the full updated Pug file. Nothing else.",
        ].join(" ");

        const userMsg = [
          "=== CURRENT PUG SOURCE ===",
          currentPug,
          "=== END PUG SOURCE ===",
          "",
          originalHtml ? "=== ORIGINAL COMPILED HTML (before edits) ===" : "",
          originalHtml ? originalHtml : "",
          originalHtml ? "=== END ORIGINAL HTML ===" : "",
          "",
          "=== MODIFIED HTML (user's edits — apply these changes to the Pug above) ===",
          modifiedHtml,
          "=== END MODIFIED HTML ===",
          "",
          "Apply the HTML changes to the Pug file and return the complete updated Pug source.",
        ].filter(Boolean).join("\n");

        const data = await _aiCall(
          async () => ({
            body: {
              model: openAiModel,
              input: [
                { role: "system", content: [{ type: "input_text", text: systemMsg }] },
                { role: "user",   content: [{ type: "input_text", text: userMsg   }] },
              ],
            }
          }),
          "html-to-pug",
          { timeoutMs: 120_000, retryMax: 1 }
        );

        const raw = extractResponseText(data) || "";
        // Extract pug from fenced code block
        const match = raw.match(/```(?:pug|jade)?\s*([\s\S]+?)```/);
        const pugContent = match ? match[1].trim() : raw.trim();

        if (!pugContent) {
          sendJson(response, 500, { error: "AI did not return Pug content", raw: raw.slice(0, 500) });
          return;
        }
        sendJson(response, 200, { ok: true, pug: pugContent });
      } catch (e) {
        sendJson(response, 500, { error: e.message });
      }
      return;
    }

    if (request.method === "GET" && (request.url === "/" || request.url.startsWith("/?"))) {
      response.writeHead(302, {
        Location: "/workbench",
        "Cache-Control": "no-store"
      });
      response.end();
      return;
    }

    if (request.method === "GET" && (request.url === "/workbench" || request.url === "/workbench/")) {
      const wbPath = path.join(publicDir, "workbench.html");
      const data = await readFile(wbPath);
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      response.end(data);
      return;
    }

    if (request.method === "GET" && (request.url === "/constructor" || request.url === "/constructor/")) {
      const cPath = path.join(publicDir, "constructor.html");
      const data = await readFile(cPath);
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      response.end(data);
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

if ((appAuthUser || appAuthPassword) && !appAuthEnabled) {
  console.warn("[security] APP_AUTH_USER and APP_AUTH_PASSWORD must both be set; application auth is disabled.");
}

server.listen(port, () => {
  console.log(`Email Studio Demo is running on http://localhost:${port}`);
});
