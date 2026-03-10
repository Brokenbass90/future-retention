import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { cp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";

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

const port = Number(process.env.PORT || 3000);
const openAiApiKey = process.env.OPENAI_API_KEY || "";
const openAiModel = process.env.OPENAI_MODEL || "gpt-4.1-mini";
const deepLApiKey = process.env.DEEPL_API_KEY || "";
const deepLApiUrl = process.env.DEEPL_API_URL || "https://api-free.deepl.com";
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

const systemPrompt = [
  "You are the drafting brain for an email studio.",
  "Your job is to turn a marketer brief, design references, translations, and image links into a compact email draft.",
  "The studio builds both marketing and transactional/system emails.",
  "Return a practical email structure with 3-5 sections.",
  "When a current draft or current email-base mail exists, preserve that structure before inventing a new one.",
  "When a design reference is attached, align the section ordering and image use to that reference as closely as possible.",
  "Prefer these section kinds only: hero, text, feature-list, image, cta, footer.",
  "Use empty strings or empty arrays for fields that do not apply.",
  "Do not mention implementation limits or that you are an AI assistant.",
  "Keep the assistant reply short, direct, and useful to an email marketer.",
  "Write assistant_reply in the user's language. If the latest user message is in Russian, answer in Russian."
].join(" ");

const responseSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    assistant_reply: {
      type: "string"
    },
    mail: {
      type: "object",
      additionalProperties: false,
      properties: {
        subject: { type: "string" },
        preheader: { type: "string" },
        locale: { type: "string" },
        summary: { type: "string" },
        sections: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              kind: {
                type: "string",
                enum: ["hero", "text", "feature-list", "image", "cta", "footer"]
              },
              eyebrow: { type: "string" },
              title: { type: "string" },
              body: { type: "string" },
              image_key: { type: "string" },
              cta_label: { type: "string" },
              cta_href: { type: "string" },
              items: {
                type: "array",
                items: { type: "string" }
              }
            },
            required: [
              "kind",
              "eyebrow",
              "title",
              "body",
              "image_key",
              "cta_label",
              "cta_href",
              "items"
            ]
          }
        },
        assets: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              key: { type: "string" },
              url: { type: "string" },
              alt: { type: "string" },
              placement: { type: "string" },
              notes: { type: "string" },
              width: { type: "number" },
              height: { type: "number" }
            },
            required: ["key", "url", "alt", "placement", "notes", "width", "height"]
          }
        },
        translations: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              locale: { type: "string" },
              subject: { type: "string" },
              preheader: { type: "string" },
              cta_labels: {
                type: "array",
                items: { type: "string" }
              },
              notes: { type: "string" },
              body_blocks: {
                type: "array",
                items: { type: "string" }
              },
              source_name: { type: "string" }
            },
            required: ["locale", "subject", "preheader", "cta_labels", "notes", "body_blocks", "source_name"]
          }
        }
      },
      required: [
        "subject",
        "preheader",
        "locale",
        "summary",
        "sections",
        "assets",
        "translations"
      ]
    }
  },
  required: ["assistant_reply", "mail"]
};

const translationResponseSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    assistant_reply: {
      type: "string"
    },
    translations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          locale: { type: "string" },
          subject: { type: "string" },
          preheader: { type: "string" },
          cta_labels: {
            type: "array",
            items: { type: "string" }
          },
          notes: { type: "string" },
          body_blocks: {
            type: "array",
            items: { type: "string" }
          },
          source_name: { type: "string" }
        },
        required: ["locale", "subject", "preheader", "cta_labels", "notes", "body_blocks", "source_name"]
      }
    }
  },
  required: ["assistant_reply", "translations"]
};

const designAnalysisSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    assistant_reply: {
      type: "string"
    },
    analysis: {
      type: "object",
      additionalProperties: false,
      properties: {
        summary: { type: "string" },
        section_kinds: {
          type: "array",
          items: {
            type: "string",
            enum: ["hero", "text", "feature-list", "image", "cta", "footer"]
          }
        },
        suggested_blocks: {
          type: "array",
          items: { type: "string" }
        },
        asset_slots: {
          type: "array",
          items: { type: "string" }
        },
        content_requirements: {
          type: "array",
          items: { type: "string" }
        },
        warnings: {
          type: "array",
          items: { type: "string" }
        }
      },
      required: ["summary", "section_kinds", "suggested_blocks", "asset_slots", "content_requirements", "warnings"]
    }
  },
  required: ["assistant_reply", "analysis"]
};

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

function dedupeCatalogSources(sources) {
  const map = new Map();

  for (const source of Array.isArray(sources) ? sources : []) {
    const normalized = {
      category: cleanText(source?.category),
      mailId: cleanText(source?.mailId),
      file: cleanText(source?.file),
      evidence: cleanText(source?.evidence),
      order: Number(source?.order) || 0
    };
    const key = [
      normalized.category,
      normalized.mailId,
      normalized.file,
      normalized.evidence
    ].join("|");
    map.set(key, normalized);
  }

  return [...map.values()].sort((left, right) => left.order - right.order || left.file.localeCompare(right.file));
}

function mergeCatalogTraits(left = {}, right = {}) {
  return {
    hasImage: Boolean(left.hasImage || right.hasImage),
    hasCta: Boolean(left.hasCta || right.hasCta),
    ctaCount: Math.max(Number(left.ctaCount) || 0, Number(right.ctaCount) || 0),
    itemMode: cleanText(right.itemMode) || cleanText(left.itemMode) || "none",
    minItems: Math.max(Number(left.minItems) || 0, Number(right.minItems) || 0),
    outlookSafe: Boolean(left.outlookSafe || right.outlookSafe),
    vml: Boolean(left.vml || right.vml)
  };
}

function registerCatalogItem(map, item) {
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

  if (!normalized.id) {
    return;
  }

  const existing = map.get(normalized.id);
  if (!existing) {
    map.set(normalized.id, normalized);
    return;
  }

  existing.label = existing.label || normalized.label;
  existing.description = existing.description || normalized.description;
  existing.sectionKind = existing.sectionKind || normalized.sectionKind;
  existing.helperMixins = dedupeStrings([...existing.helperMixins, ...normalized.helperMixins]);
  existing.traits = mergeCatalogTraits(existing.traits, normalized.traits);
  existing.usageCount += normalized.usageCount;
  existing.sources = dedupeCatalogSources([...existing.sources, ...normalized.sources]);
}

function getEvidenceOrder(content, evidenceNeedle) {
  const index = cleanText(evidenceNeedle) ? content.indexOf(evidenceNeedle) : -1;
  return index >= 0 ? index : Number.MAX_SAFE_INTEGER;
}

function createCatalogSource(category, mailId, filePath, evidenceNeedle) {
  return {
    category,
    mailId,
    file: toStudioRelative(filePath),
    evidence: cleanText(evidenceNeedle),
    order: 0
  };
}

function createCatalogItem({
  id,
  label,
  description,
  sectionKind,
  helperMixins = [],
  traits = {},
  usageCount = 1,
  category,
  mailId,
  filePath,
  evidence,
  content
}) {
  const source = createCatalogSource(category, mailId, filePath, evidence);
  source.order = getEvidenceOrder(content, evidence);

  return {
    id,
    label,
    description,
    sectionKind,
    helperMixins,
    traits,
    usageCount,
    sources: [source]
  };
}

async function extractCatalogItemsFromTemplate(category, mailId, filePath) {
  const content = await readFile(filePath, "utf8");
  const items = [];
  const numberedSections = (content.match(/p\.number\b/g) || []).length;
  const listItems = (content.match(/p\.text\.list-item\b/g) || []).length;
  const hasSimpleCta = /table\.medium-button(?:-bot)?\.radius|\.button-wrapper\b/.test(content);
  const hasTextCard = /p\.title\b/.test(content) && /p\.text\b/.test(content);
  const hasPromoColumns = /three-colums|text-promo|w-33\b/.test(content);
  const hasFooterLegal = /footer-text|unsubscribe|\[unsubscribe\]|terms and conditions|helpers\/footer/i.test(content);

  if (/img\.logo\b/.test(content)) {
    items.push(createCatalogItem({
      id: "header-logo-row",
      label: "Header logo row",
      description: "Тонкая верхняя строка с логотипом и ссылкой на бренд.",
      sectionKind: "image",
      traits: {
        hasImage: true,
        hasCta: true,
        ctaCount: 1,
        itemMode: "none",
        minItems: 0,
        outlookSafe: true,
        vml: false
      },
      category,
      mailId,
      filePath,
      evidence: "img.logo",
      content
    }));
  }

  if (/\+cta-two-column-table\(/.test(content) || /Table-based CTA example/.test(content)) {
    items.push(createCatalogItem({
      id: "hero-image-two-cta",
      label: "Hero image with two CTA",
      description: "Первый экран с большой картинкой, hero copy и двухкнопочным table-based CTA.",
      sectionKind: "hero",
      helperMixins: ["cta-two-column-table"],
      traits: {
        hasImage: true,
        hasCta: true,
        ctaCount: 2,
        itemMode: "none",
        minItems: 0,
        outlookSafe: true,
        vml: false
      },
      category,
      mailId,
      filePath,
      evidence: "Table-based CTA example",
      content
    }));
  }

  if (numberedSections > 0) {
    items.push(createCatalogItem({
      id: "numbered-feature-stack",
      label: "Numbered feature stack",
      description: "Секция с пронумерованными шагами/выгодами, где каждый блок может иметь текст, картинку и CTA.",
      sectionKind: "feature-list",
      traits: {
        hasImage: true,
        hasCta: true,
        ctaCount: 1,
        itemMode: "numbered",
        minItems: numberedSections,
        outlookSafe: true,
        vml: false
      },
      usageCount: numberedSections,
      category,
      mailId,
      filePath,
      evidence: "p.number",
      content
    }));
  }

  if (listItems > 0) {
    items.push(createCatalogItem({
      id: "bullet-proof-list-card",
      label: "Bullet proof list card",
      description: "Текстовый блок со списком выгод, шагов или требований через list-item паттерн.",
      sectionKind: "feature-list",
      traits: {
        hasImage: false,
        hasCta: false,
        ctaCount: 0,
        itemMode: "bullets",
        minItems: listItems,
        outlookSafe: true,
        vml: false
      },
      usageCount: listItems,
      category,
      mailId,
      filePath,
      evidence: "p.text.list-item",
      content
    }));
  }

  if (hasSimpleCta) {
    items.push(createCatalogItem({
      id: "single-button-cta-card",
      label: "Single CTA card",
      description: "Простой однокнопочный CTA-блок на стандартном medium-button паттерне.",
      sectionKind: "cta",
      traits: {
        hasImage: false,
        hasCta: true,
        ctaCount: 1,
        itemMode: "none",
        minItems: 0,
        outlookSafe: true,
        vml: false
      },
      category,
      mailId,
      filePath,
      evidence: "table.medium-button.radius",
      content
    }));
  }

  if (hasTextCard) {
    items.push(createCatalogItem({
      id: "plain-copy-text-card",
      label: "Plain copy text card",
      description: "Базовый текстовый блок с title + body copy без сложной графики.",
      sectionKind: "text",
      traits: {
        hasImage: false,
        hasCta: false,
        ctaCount: 0,
        itemMode: "none",
        minItems: 0,
        outlookSafe: true,
        vml: false
      },
      category,
      mailId,
      filePath,
      evidence: "p.title",
      content
    }));
  }

  if (hasPromoColumns) {
    items.push(createCatalogItem({
      id: "three-promo-column-row",
      label: "Three promo column row",
      description: "Трехколоночный ряд с короткими promo или feature-блоками.",
      sectionKind: "feature-list",
      traits: {
        hasImage: false,
        hasCta: true,
        ctaCount: 3,
        itemMode: "grid",
        minItems: 3,
        outlookSafe: true,
        vml: false
      },
      usageCount: 3,
      category,
      mailId,
      filePath,
      evidence: "three-colums",
      content
    }));
  }

  if (/\+cta-switch-table\(/.test(content) || /Table-based switch row example/.test(content)) {
    items.push(createCatalogItem({
      id: "switch-cta-row",
      label: "Switch CTA row",
      description: "Двухкнопочный switch row с центральной стрелкой и явным сравнением двух действий.",
      sectionKind: "cta",
      helperMixins: ["cta-switch-table"],
      traits: {
        hasImage: true,
        hasCta: true,
        ctaCount: 2,
        itemMode: "binary",
        minItems: 2,
        outlookSafe: true,
        vml: false
      },
      category,
      mailId,
      filePath,
      evidence: "Table-based switch row example",
      content
    }));
  }

  if (/\+vml-bg\(/.test(content)) {
    items.push(createCatalogItem({
      id: "vml-bottom-hero",
      label: "VML background hero",
      description: "Outlook-safe hero или CTA-блок на VML background helper.",
      sectionKind: "cta",
      helperMixins: ["vml-bg"],
      traits: {
        hasImage: true,
        hasCta: true,
        ctaCount: 1,
        itemMode: "none",
        minItems: 0,
        outlookSafe: true,
        vml: true
      },
      category,
      mailId,
      filePath,
      evidence: "+vml-bg(",
      content
    }));
  }

  if (/\+vml-bg-fixed\(/.test(content) || /Fixed VML background example/.test(content)) {
    items.push(createCatalogItem({
      id: "vml-bottom-hero-fixed",
      label: "Fixed VML background hero",
      description: "Более безопасный фиксированный VML background helper для Outlook и тяжелых hero-блоков.",
      sectionKind: "cta",
      helperMixins: ["vml-bg-fixed"],
      traits: {
        hasImage: true,
        hasCta: true,
        ctaCount: 1,
        itemMode: "none",
        minItems: 0,
        outlookSafe: true,
        vml: true
      },
      category,
      mailId,
      filePath,
      evidence: "Fixed VML background example",
      content
    }));
  }

  if (/img\.a-app\b/.test(content) || /img\.a-google\b/.test(content) || /apps\.apple\.com/.test(content) || /play\.google\.com/.test(content)) {
    items.push(createCatalogItem({
      id: "store-badges-row",
      label: "Store badges row",
      description: "Компактный футерный ряд с App Store и Google Play badges.",
      sectionKind: "footer",
      traits: {
        hasImage: true,
        hasCta: true,
        ctaCount: 2,
        itemMode: "none",
        minItems: 0,
        outlookSafe: true,
        vml: false
      },
      category,
      mailId,
      filePath,
      evidence: "img.a-app",
      content
    }));
  }

  if (hasFooterLegal) {
    items.push(createCatalogItem({
      id: "legal-unsubscribe-footer",
      label: "Legal unsubscribe footer",
      description: "Юридический footer с address, legal copy, terms и unsubscribe ссылками.",
      sectionKind: "footer",
      traits: {
        hasImage: false,
        hasCta: true,
        ctaCount: 2,
        itemMode: "none",
        minItems: 0,
        outlookSafe: true,
        vml: false
      },
      category,
      mailId,
      filePath,
      evidence: "footer-text",
      content
    }));
  }

  return items;
}

async function generateBlockCatalog() {
  const emailBase = summarizeEmailBase();
  const catalogMap = new Map();

  for (const category of emailBase.categories || []) {
    for (const mail of category.mails || []) {
      const mailRoot = path.join(emailBaseRoot, category.name, mail.folder, "app", "templates");
      const templateFiles = listMailTemplateSourceFiles(mailRoot);

      for (const filePath of templateFiles) {
        const items = await extractCatalogItemsFromTemplate(category.name, mail.id, filePath);
        for (const item of items) {
          registerCatalogItem(catalogMap, item);
        }
      }
    }
  }

  const items = [...catalogMap.values()].sort((left, right) => {
    const leftOrder = left.sources[0]?.order ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = right.sources[0]?.order ?? Number.MAX_SAFE_INTEGER;
    return leftOrder - rightOrder || left.label.localeCompare(right.label);
  });

  return {
    generatedAt: new Date().toISOString(),
    root: toStudioRelative(emailBaseRoot),
    items,
    summary: summarizeBlockCatalog({
      generatedAt: new Date().toISOString(),
      items
    })
  };
}

function summarizeBlockCatalog(catalog) {
  const items = Array.isArray(catalog?.items) ? catalog.items : [];
  const sourceMails = dedupeStrings(items.flatMap((item) => item.sources.map((source) => {
    if (!source.category || !source.mailId) {
      return "";
    }
    return `${source.category}/mail-${source.mailId}`;
  })));

  return {
    itemCount: items.length,
    generatedAt: cleanText(catalog?.generatedAt),
    path: toStudioRelative(blockCatalogPath),
    sourceMailCount: sourceMails.length,
    sourceMails,
    sectionKinds: dedupeStrings(items.map((item) => item.sectionKind)),
    helperMixins: dedupeStrings(items.flatMap((item) => item.helperMixins || []))
  };
}

async function ensureBlockCatalog(options = {}) {
  const force = Boolean(options.force);

  if (!force && existsSync(blockCatalogPath)) {
    try {
      const raw = await readFile(blockCatalogPath, "utf8");
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed?.items)) {
        return {
          ...parsed,
          summary: summarizeBlockCatalog(parsed)
        };
      }
    } catch {
      // Regenerate below.
    }
  }

  const catalog = await generateBlockCatalog();
  await mkdir(studioDataDir, { recursive: true });
  await writeFile(blockCatalogPath, `${JSON.stringify(catalog, null, 2)}\n`);
  return catalog;
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

async function readAssetRegistry() {
  if (!existsSync(assetRegistryPath)) {
    return {
      items: [],
      updatedAt: ""
    };
  }

  try {
    const raw = await readFile(assetRegistryPath, "utf8");
    const parsed = JSON.parse(raw);
    return {
      items: Array.isArray(parsed?.items) ? parsed.items.map(normalizeAssetRegistryEntry) : [],
      updatedAt: cleanText(parsed?.updatedAt)
    };
  } catch {
    return {
      items: [],
      updatedAt: ""
    };
  }
}

async function writeAssetRegistry(items) {
  const normalizedItems = items.map(normalizeAssetRegistryEntry);
  const payload = {
    updatedAt: new Date().toISOString(),
    items: normalizedItems
  };
  await mkdir(studioDataDir, { recursive: true });
  await writeFile(assetRegistryPath, `${JSON.stringify(payload, null, 2)}\n`);
  return payload;
}

async function readStudioJournal() {
  if (!existsSync(studioJournalPath)) {
    return {
      updatedAt: "",
      entries: []
    };
  }

  try {
    const raw = await readFile(studioJournalPath, "utf8");
    const parsed = JSON.parse(raw);
    return {
      updatedAt: cleanText(parsed?.updatedAt),
      entries: Array.isArray(parsed?.entries) ? parsed.entries : []
    };
  } catch {
    return {
      updatedAt: "",
      entries: []
    };
  }
}

async function readProjectRules() {
  if (!existsSync(projectRulesPath)) {
    return {
      updatedAt: "",
      items: []
    };
  }

  try {
    const raw = await readFile(projectRulesPath, "utf8");
    const parsed = JSON.parse(raw);
    return {
      updatedAt: cleanText(parsed?.updatedAt),
      items: Array.isArray(parsed?.items) ? parsed.items.map(normalizeProjectRuleEntry).filter((item) => item.text) : []
    };
  } catch {
    return {
      updatedAt: "",
      items: []
    };
  }
}

async function writeStudioJournal(entries) {
  const payload = {
    updatedAt: new Date().toISOString(),
    entries: Array.isArray(entries) ? entries : []
  };
  await mkdir(studioDataDir, { recursive: true });
  await writeFile(studioJournalPath, `${JSON.stringify(payload, null, 2)}\n`);
  return payload;
}

async function writeProjectRules(items) {
  const normalizedItems = Array.isArray(items)
    ? items.map(normalizeProjectRuleEntry).filter((item) => item.text)
    : [];
  const payload = {
    updatedAt: new Date().toISOString(),
    items: normalizedItems
  };
  await mkdir(studioDataDir, { recursive: true });
  await writeFile(projectRulesPath, `${JSON.stringify(payload, null, 2)}\n`);
  return payload;
}

async function appendStudioJournalEntry(entry) {
  const journal = await readStudioJournal();
  const nextEntry = {
    id: `journal-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    timestamp: new Date().toISOString(),
    level: cleanText(entry?.level) || "info",
    area: cleanText(entry?.area) || "studio",
    title: cleanText(entry?.title) || "Studio event",
    message: cleanText(entry?.message),
    meta: entry?.meta && typeof entry.meta === "object" ? entry.meta : {}
  };
  const entries = [nextEntry, ...(journal.entries || [])].slice(0, 250);
  return writeStudioJournal(entries);
}

async function clearStudioJournal() {
  return writeStudioJournal([]);
}

async function appendProjectRule(text, source = "manual") {
  const cleanRule = cleanText(text);
  if (!cleanRule) {
    throw new Error("Project rule text is empty");
  }

  const rules = await readProjectRules();
  const timestamp = new Date().toISOString();
  const existing = (rules.items || []).find((item) => cleanText(item.text).toLowerCase() === cleanRule.toLowerCase());

  if (existing) {
    existing.updatedAt = timestamp;
    existing.active = true;
    if (!existing.source) {
      existing.source = cleanText(source) || "manual";
    }
    return writeProjectRules(rules.items);
  }

  const nextItem = {
    id: `rule-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    text: cleanRule,
    source: cleanText(source) || "manual",
    createdAt: timestamp,
    updatedAt: timestamp,
    active: true
  };
  return writeProjectRules([nextItem, ...(rules.items || [])].slice(0, 200));
}

async function clearProjectRules() {
  return writeProjectRules([]);
}

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

function createOutlineSectionFromCatalogItem(item, index, assets = []) {
  const imageAsset = item.traits?.hasImage ? assets[Math.min(index, Math.max(assets.length - 1, 0))] : null;
  const itemCount = Math.min(Math.max(item.traits?.minItems || 0, 0), 5);

  return {
    kind: cleanText(item.sectionKind) || "text",
    eyebrow: "email-base catalog block",
    title: item.label,
    body: item.description,
    image_key: imageAsset?.key || "",
    cta_label: item.traits?.hasCta
      ? (item.traits?.ctaCount > 1 ? "CTA group" : "Primary CTA")
      : "",
    cta_href: "",
    items: item.traits?.itemMode === "numbered"
      ? Array.from({ length: itemCount || 3 }, (_, itemIndex) => `Step ${itemIndex + 1}`)
      : [],
    catalog_id: item.id
  };
}

function buildCatalogOutlineForMail(catalog, category, mailId, assets = []) {
  const items = Array.isArray(catalog?.items) ? catalog.items : [];

  return items
    .filter((item) => item.sources.some((source) => source.category === category && source.mailId === mailId))
    .sort((left, right) => {
      const leftOrder = left.sources.find((source) => source.category === category && source.mailId === mailId)?.order ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = right.sources.find((source) => source.category === category && source.mailId === mailId)?.order ?? Number.MAX_SAFE_INTEGER;
      return leftOrder - rightOrder || left.label.localeCompare(right.label);
    })
    .map((item, index) => createOutlineSectionFromCatalogItem(item, index, assets));
}

function getProviderCatalog() {
  return [
    {
      id: "openai",
      label: "OpenAI",
      available: Boolean(openAiApiKey),
      status: openAiApiKey ? `Configured: ${openAiModel}` : "Needs OPENAI_API_KEY",
      capabilities: ["chat", "vision", "structured output", "design ingest"]
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
    deepLConfigured: Boolean(deepLApiKey),
    deepLApiUrl
  };
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
    previewCategory: selectedCategory
  });
  draftSnapshot.html = html;
  draftSnapshot.pug = templateSource;
  draftSnapshot.locales = localeSource;
  draftSnapshot.assetsManifest = JSON.stringify(
    Object.fromEntries(assets.map((asset) => [asset.key, asset])),
    null,
    2
  );
  draftSnapshot.spec = JSON.stringify(
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
  draftSnapshot.buildLog = [result.stdout, result.stderr].filter(Boolean).join("\n").trim() || "Build completed.";

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

function buildLocaleSectionMap(mail, translationEntry) {
  const sections = {};
  const blocks = Array.isArray(translationEntry?.body_blocks) ? translationEntry.body_blocks : [];
  const heroSectionIndex = mail.sections.findIndex((section) => section.kind === "hero");
  const featureSectionIndex = mail.sections.findIndex((section) => section.kind === "feature-list");
  const ctaSectionIndex = mail.sections.findIndex((section) => section.kind === "cta");
  const usedBlockIndices = new Set();

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
  return {
    subject: "Set your new password",
    preheader: "Password reset instructions",
    locale: normalizeLocaleCode(payload?.brief?.locale || "en"),
    summary: "Affiliate password reset email built from the base template.",
    brand_logo_url: cleanText(extractLatestLogoOverrideUrl(payload))
      || "https://static.cdnpub.info/files/storage/public/5f/c8/d0517a03c1c8h5j9j4/logoaff_white_shadow__1_.png",
    brand_logo_alt: "Affstore",
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
        body: "If you’re having trouble signing in to your account, try setting your password again or reach out to us at support@affstore.com."
      },
      {
        kind: "footer",
        title: "",
        body: "{{embedded.company_address}}\n\n{{embedded.risk_warning}}\n\nTerms and Conditions"
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
  if (isAffPasswordResetReference(payload)) {
    return "aff-password-reset";
  }

  if (isSystemCategoryName(resolveBriefCategory(payload))) {
    return "system-verification";
  }

  if (looksLikeSystemVerificationDraft(payload, mail)) {
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
    "                        a(href=\"https://affiliate.iqoption.com\" target=\"_blank\")",
    `                            img.logo.center.pb5(src=${JSON.stringify(logoUrl)} alt=${JSON.stringify(logoAlt)})`,
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
    "                            p.footer-text.center.pb25 {{embedded.risk_warning}}",
    "                            p.footer-text.center",
    "                                a(href=\"{{embedded.company_terms_link}}\" target=\"_blank\") ${{ footer.footer.conditions }}$"
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

async function buildTemporaryEmailBasePreviewFromDraft(payload, rawDraft) {
  const summary = summarizeEmailBase();
  if (!summary.available) {
    throw new Error("email-base is not attached");
  }

  const category = ensureSafeCategoryName(resolveBriefCategory(payload, summary.currentMail?.category || "X_System"));
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
      mail: savedMail
    }, null, 2);
    draftSnapshot.buildLog = localeBuildLogs[selectedPreviewLocale] || localeBuildLogs[Object.keys(localeBuildLogs)[0]] || "Build completed.";

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

  const category = ensureSafeCategoryName(resolveBriefCategory(payload, summary.currentMail?.category || "X_IQ"));
  const mailId = resolveStudioMailId(payload.brief.mailId, payload.brief.campaignName);
  const mail = normalizeMail(rawDraft, payload);
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
  await writeFile(metaPath, JSON.stringify({
    created_at: new Date().toISOString(),
    source: "email-studio",
    category,
    mail_id: mailId,
    translation_file: translationFileKey,
    primary_locale: primaryLocale,
    template_profile: writtenTemplate.profile,
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
    mail
  }, null, 2);
  draftSnapshot.buildLog = localeBuildLogs[selectedPreviewLocale] || localeBuildLogs[Object.keys(localeBuildLogs)[0]] || "Build completed.";

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

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(payload));
}

function sendText(response, statusCode, body, contentType = "text/plain; charset=utf-8") {
  response.writeHead(statusCode, {
    "Content-Type": contentType,
    "Cache-Control": "no-store"
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

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function looksLikeImageUrl(value) {
  return /^data:image\//i.test(value) || /\.(png|jpe?g|gif|webp|svg)(\?.*)?$/i.test(value);
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

function stripTags(value) {
  return String(value).replace(/<[^>]*>/g, " ");
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
  const userTranscript = cleanText(getRecentUserTranscript(payload)).toLowerCase();
  if (/(системн|технич|тех письмо|техническ|transactional|technical|service email|system email)/i.test(userTranscript)) {
    return "X_System";
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

  const preferred = category.mails.find((mail) => /payment|success|welcome|confirm|docs|verification/i.test(cleanText(mail.id)))
    || category.mails[0];
  return cleanText(preferred?.id);
}

function resolveReferenceTemplateMailTarget(payload) {
  const category = resolveBriefCategory(payload, summarizeEmailBase().currentMail?.category || "");
  const transcript = cleanText(getRecentUserTranscript(payload)).toLowerCase();
  if (isSystemCategoryName(category)) {
    if (/(passbook|verification|verify|document|documents|declin|reject|вериф|провер|документ|пасбук|банк)/i.test(transcript)) {
      return {
        category: "X_IQBroker",
        mailId: "payment-verification-request-pop"
      };
    }
  }

  if (cleanText(category) === "X_AffSystem") {
    if (/(password|reset|login|sign in|signin|create account|парол|сброс|логин|аккаунт)/i.test(transcript)) {
      return {
        category: "X_AffSystem",
        mailId: "password-retrieving-affiliate"
      };
    }
  }

  return {
    category: category || summarizeEmailBase().currentMail?.category || "",
    mailId: cleanText(payload?.brief?.mailId) || inferMailIdForCategory(category)
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

function normalizeDesignPayload(design) {
  if (!design || typeof design !== "object") {
    return null;
  }

  const dataUrl = cleanText(design.dataUrl);
  const name = cleanText(design.name);
  const assetId = cleanText(design.assetId);

  if (!dataUrl && !name && !assetId) {
    return null;
  }

  return {
    name: name || "design-reference",
    dataUrl,
    assetId
  };
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

function normalizeDesignAnalysis(rawAnalysis) {
  if (!rawAnalysis || typeof rawAnalysis !== "object") {
    return null;
  }

  const normalizeKinds = (Array.isArray(rawAnalysis.section_kinds) ? rawAnalysis.section_kinds : [])
    .map(cleanText)
    .filter((value) => ["hero", "text", "feature-list", "image", "cta", "footer"].includes(value));

  return {
    summary: cleanText(rawAnalysis.summary),
    section_kinds: normalizeKinds,
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

  return [
    `Summary: ${normalized.summary || "None"}`,
    `Section kinds: ${normalized.section_kinds.join(", ") || "None"}`,
    `Suggested blocks: ${normalized.suggested_blocks.join(" | ") || "None"}`,
    `Asset slots: ${normalized.asset_slots.join(" | ") || "None"}`,
    `Missing content: ${normalized.content_requirements.join(" | ") || "None"}`,
    `Warnings: ${normalized.warnings.join(" | ") || "None"}`
  ].join("\n");
}

function summarizeDesignInputForContext(payload) {
  const link = cleanText(payload?.brief?.designUrl);
  const hasUpload = Boolean(cleanText(payload?.design?.dataUrl));

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

function buildCategorySpecificInstructions(payload) {
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

function normalizePayload(payload) {
  const brief = payload?.brief ?? {};
  const settings = payload?.settings ?? {};
  const design = normalizeDesignPayload(payload?.design);
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
  return {
    intent: resolvedIntent,
    messages: Array.isArray(payload?.messages) ? payload.messages.slice(-8) : [],
    brief: {
      campaignName: cleanText(brief.campaignName),
      category: resolvedCategory,
      mailId: cleanText(brief.mailId) || inferMailIdForCategory(resolvedCategory),
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
      providerId: cleanText(settings.providerId) || (openAiApiKey ? "openai" : "mock"),
      theme: cleanText(settings.theme) || "light",
      clientProfileId: cleanText(settings.clientProfileId) || "standard"
    },
    assetInputs: resolvedAssetInputs,
    assetRegistryItems,
    projectRules,
    assetLinks: resolvedAssetInputs.map((asset) => asset.url).filter(Boolean),
    translationText: cleanText(payload?.translationText),
    design,
    designAnalysis: normalizeDesignAnalysis(payload?.designAnalysis),
    currentDraft: payload?.currentDraft && typeof payload.currentDraft === "object"
      ? payload.currentDraft
      : null
  };
}

function buildUserContext(payload) {
  const emailBaseSummary = summarizeEmailBase();
  const transcript = payload.messages
    .map((message) => `${message.role === "assistant" ? "Assistant" : "User"}: ${cleanText(message.content)}`)
    .join("\n");

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
    "Design analysis:",
    summarizeDesignAnalysisForContext(payload.designAnalysis),
    "Structured assets:",
    describeAssetPlan(payload.assetInputs),
    "Asset library in project:",
    summarizeAssetLibraryForContext(payload),
    "Saved project rules:",
    summarizeProjectRulesForContext(payload.projectRules),
    buildCategorySpecificInstructions(payload),
    "Translations source:",
    summarizeTranslationText(payload.translationText),
    `Requested AI provider: ${payload.settings.providerId}`,
    `Email base contract: ${emailBaseSummary.available ? emailBaseSummary.technology.join(", ") : "Not attached"}`,
    `Current base mail: ${emailBaseSummary.currentMail?.folder || "None"}`,
    "Current draft context:",
    summarizeCurrentDraft(payload.currentDraft),
    "Conversation transcript:",
    transcript || "User: Please draft a strong retention email."
  ].join("\n");
}

function buildDiscussionContext(payload) {
  const emailBaseSummary = summarizeEmailBase();
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
    "Design analysis:",
    summarizeDesignAnalysisForContext(payload.designAnalysis),
    "Structured assets:",
    describeAssetPlan(payload.assetInputs),
    "Asset library in project:",
    summarizeAssetLibraryForContext(payload),
    "Saved project rules:",
    summarizeProjectRulesForContext(payload.projectRules),
    buildCategorySpecificInstructions(payload),
    "Current draft context:",
    summarizeCurrentDraft(payload.currentDraft),
    "Translations source:",
    summarizeTranslationText(payload.translationText),
    "Conversation transcript:",
    transcript || "User: Let's discuss the email direction."
  ].join("\n");
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

  return [
    {
      role: "system",
      content: [{ type: "input_text", text: systemPrompt }]
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
  const currentDraftSummary = summarizeCurrentDraft(payload.currentDraft);
  const content = [
    {
      type: "input_text",
      text: [
        "Analyze the provided email design reference for an email studio.",
        "Return only structural guidance that can be mapped to reusable email blocks.",
        `Campaign name: ${payload.brief.campaignName || "Untitled campaign"}`,
        `Goal: ${payload.brief.goal || "Not specified"}`,
        `Audience: ${payload.brief.audience || "Not specified"}`,
        `Primary locale: ${payload.brief.locale}`,
        `Current base mail: ${emailBaseSummary.currentMail?.folder || "None"}`,
        `Design input type: ${summarizeDesignInputForContext(payload)}`,
        "Saved project rules:",
        summarizeProjectRulesForContext(payload.projectRules),
        buildCategorySpecificInstructions(payload),
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
        text: "You analyze email design references for a reusable email block system. Reply in the user's language. Describe layout structure, missing content needs, likely block mapping, and asset slots. Do not write HTML."
      }]
    },
    {
      role: "user",
      content
    }
  ];
}

function createMockDesignAnalysis(payload, warning = "") {
  const hasDesign = Boolean(payload.design?.dataUrl || payload.brief.designUrl);
  const designInputType = summarizeDesignInputForContext(payload);
  const analysis = normalizeDesignAnalysis({
    summary: hasDesign
      ? `Есть design reference (${designInputType}), но mock-режим не анализирует изображение по содержанию. Можно только использовать его как ориентир по структуре.`
      : "Design reference не приложен.",
    section_kinds: payload.currentDraft?.sections?.map((section) => cleanText(section.kind)).filter(Boolean).slice(0, 6)
      || ["hero", "text", "feature-list", "cta", "footer"],
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

function buildMockSectionForKind(kind, index, context) {
  const templateSection = context.templateSections[index] || {};
  const detailLines = context.detailLines;
  const detail = detailLines[index] || detailLines[0] || "";
  const nextDetail = detailLines[index + 1] || "";
  const sharedEyebrow = context.audience ? `Audience: ${context.audience}` : cleanText(templateSection.eyebrow);

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
  const locale = payload.brief.locale || cleanText(templateMail?.locale) || "en";
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
  const designDrivenSections = Array.isArray(payload.designAnalysis?.section_kinds) && payload.designAnalysis.section_kinds.length > 0
    ? payload.designAnalysis.section_kinds.map((kind) => ({ kind }))
    : [];
  const heroSections = rawTemplateSections.filter((section) => cleanText(section?.kind) === "hero");
  const footerSections = rawTemplateSections.filter((section) => cleanText(section?.kind) === "footer");
  const middleSections = rawTemplateSections.filter((section) => !["hero", "footer"].includes(cleanText(section?.kind)));
  const templateSections = rawTemplateSections.length > 0
    ? [...heroSections, ...middleSections, ...footerSections]
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

function parseTxtTranslationDoc(doc) {
  const content = cleanText(doc.content);
  if (!content) {
    return null;
  }

  const lines = content.split(/\r?\n/).map((line) => line.trim());
  const subjectLine = lines.find((line) => /^Subject:\s*/i.test(line)) || "";
  const snippetLine = lines.find((line) => /^Snippet:\s*/i.test(line)) || "";
  const subject = cleanText(subjectLine.replace(/^Subject:\s*/i, ""));
  const preheader = cleanText(snippetLine.replace(/^Snippet:\s*/i, ""));
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
  return {
    locale: normalizeLocaleCode(entry?.locale) || normalizeLocaleCode(mail.locale) || "en",
    subject: cleanText(entry?.subject) || mail.subject,
    preheader: cleanText(entry?.preheader) || mail.preheader,
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
      assistant_reply: `Собрал draft на базе текущего письма из email-base и ваших материалов.${suffix}`,
      mail
    };
  } catch (error) {
    return createMockDraft(payload, cleanText(error?.message) || warning);
  }
}

function createMockDiscussion(payload, warning = "") {
  const lastUserMessage = [...payload.messages].reverse().find((message) => message.role === "user")?.content || "";
  const draft = payload.currentDraft;
  const hasDesign = Boolean(payload.design?.dataUrl || payload.brief.designUrl);
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
  const hasDesign = Boolean(payload.design?.dataUrl || payload.brief.designUrl);
  const heroAssetExists = assets.some((asset, index) => resolveAssetPlacement(asset, index) === "hero");
  const sectionAssetExists = assets.some((asset, index) => {
    const placement = resolveAssetPlacement(asset, index);
    return placement === "section" || placement === "feature";
  });
  const heroLibraryCandidate = libraryItems.some((item) => ["hero", "background"].includes(cleanText(item.placement)));
  const sectionLibraryCandidate = libraryItems.some((item) => ["section", "feature"].includes(cleanText(item.placement)));

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
        text: "You translate email copy into requested locales. Keep structure intact, preserve numbers, emojis, URLs, and **strong emphasis** markers. Translate naturally for each locale and do not add commentary outside the structured output. Write assistant_reply in the user's language."
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

  const normalized = {
    subject: cleanText(mail.subject) || fallback.subject,
    preheader: cleanText(mail.preheader) || fallback.preheader,
    locale: cleanText(mail.locale) || fallback.locale,
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

  const preheader = /build a simple|use system structure|собери|собираем|системн/i.test(cleanText(mail.preheader))
    ? inferSystemPreheader({ ...mail, sections }) || cleanText(mail.preheader)
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

function createDraftSnapshot(mail, existingDraft = null, metadata = {}) {
  const emailBaseSummary = summarizeEmailBase();

  return {
    mail,
    html: cleanText(existingDraft?.html) || renderDraftHtml(mail, metadata),
    previewLocales: existingDraft?.previewLocales || metadata.previewLocales || {},
    localePayloads: existingDraft?.localePayloads || metadata.localePayloads || {},
    localeBuildLogs: existingDraft?.localeBuildLogs || metadata.localeBuildLogs || {},
    pug: cleanText(existingDraft?.pug) || renderEmailPug(mail),
    locales: renderLocalesJson(mail),
    assetsManifest: renderAssetsManifest(mail),
    spec: JSON.stringify(mail, null, 2),
    assetRecommendations: Array.isArray(metadata?.assetRecommendations) ? metadata.assetRecommendations : [],
    buildLog: cleanText(existingDraft?.buildLog) || [
      "No email-base build executed yet.",
      emailBaseSummary.currentMail
        ? `Current base mail: ${emailBaseSummary.currentMail.folder}`
        : "No current base mail detected."
    ].join("\n")
  };
}

function materializeDraft(result, payload, mode) {
  const mail = normalizeMail(result.mail, payload);
  const assetRecommendations = buildAssetRecommendations(mail, payload);
  const fallbackReply = buildDraftSuccessReply(payload, mail);
  const normalizedReply = finalizeAssistantReply(
    payload,
    isSystemCategoryName(resolveBriefCategory(payload)) || looksLikeDraftReplyArtifact(result.assistant_reply) ? "" : result.assistant_reply,
    fallbackReply
  );

  return {
    assistantReply: normalizedReply,
    mode,
    draft: createDraftSnapshot(mail, null, {
      assetRecommendations,
      previewCategory: resolveBriefCategory(payload)
    })
  };
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

function extractResponseText(apiResponse) {
  if (typeof apiResponse.output_text === "string" && apiResponse.output_text.trim()) {
    return apiResponse.output_text;
  }

  const segments = [];

  for (const item of apiResponse.output || []) {
    if (item.type !== "message") {
      continue;
    }

    for (const content of item.content || []) {
      if (content.type === "output_text" && content.text) {
        segments.push(content.text);
      }
    }
  }

  return segments.join("\n");
}

async function createOpenAiDraft(payload) {
  const effectivePayload = await ensureDesignAnalysis(payload);
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${openAiApiKey}`
    },
    body: JSON.stringify({
      model: openAiModel,
      input: await buildInputMessages(effectivePayload),
      text: {
        format: {
          type: "json_schema",
          name: "email_studio_draft",
          strict: true,
          schema: responseSchema
        }
      }
    })
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message || "OpenAI request failed");
  }

  const rawText = extractResponseText(data);
  if (!rawText) {
    throw new Error("OpenAI response did not contain output text");
  }

  return {
    ...JSON.parse(rawText),
    design_analysis: effectivePayload.designAnalysis || null
  };
}

async function createOpenAiDiscussion(payload) {
  const effectivePayload = await ensureDesignAnalysis(payload, { optional: true });
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${openAiApiKey}`
    },
    body: JSON.stringify({
      model: openAiModel,
      input: await buildDiscussionMessages(effectivePayload)
    })
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message || "OpenAI discussion request failed");
  }

  return {
    assistantReply: extractResponseText(data) || "Обсуждение готово."
  };
}

async function createOpenAiDesignAnalysis(payload) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${openAiApiKey}`
    },
    body: JSON.stringify({
      model: openAiModel,
      input: await buildDesignAnalysisMessages(payload),
      text: {
        format: {
          type: "json_schema",
          name: "email_studio_design_analysis",
          strict: true,
          schema: designAnalysisSchema
        }
      }
    })
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message || "OpenAI design analysis request failed");
  }

  const rawText = extractResponseText(data);
  if (!rawText) {
    throw new Error("OpenAI design analysis response did not contain output text");
  }

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

async function createOpenAiTranslations(payload, mail, sourceEntry, targetLocales) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${openAiApiKey}`
    },
    body: JSON.stringify({
      model: openAiModel,
      input: buildTranslationMessages(payload, sourceEntry, targetLocales),
      text: {
        format: {
          type: "json_schema",
          name: "email_studio_translations",
          strict: true,
          schema: translationResponseSchema
        }
      }
    })
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message || "OpenAI translation request failed");
  }

  const rawText = extractResponseText(data);
  if (!rawText) {
    throw new Error("OpenAI translation response did not contain output text");
  }

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
  const hasDesign = Boolean(payload.design?.dataUrl || payload.brief.designUrl);

  if (!hasDesign || payload.designAnalysis) {
    return payload;
  }

  try {
    const result = await createOpenAiDesignAnalysis(payload);
    return {
      ...payload,
      designAnalysis: result.analysis
    };
  } catch (error) {
    if (optional) {
      return payload;
    }
    throw error;
  }
}

async function resolveSystemTemplateMail(payload) {
  try {
    const summary = summarizeEmailBase();
    const referenceTarget = resolveReferenceTemplateMailTarget(payload);
    const preview = await buildEmailBasePreview(
      referenceTarget.category || resolveBriefCategory(payload, summary.currentMail?.category || "X_System"),
      referenceTarget.mailId || cleanText(payload?.brief?.mailId) || summary.currentMail?.mailId || "",
      cleanText(payload?.brief?.locale) || "en"
    );
    return preview?.draft?.mail || null;
  } catch {
    return payload?.currentDraft?.sections?.length ? payload.currentDraft : null;
  }
}

async function resolveTemplateMail(payload) {
  if (isAffPasswordResetReference(payload)) {
    return buildAffPasswordResetTemplateMail(payload);
  }

  if (isSystemCategoryName(resolveBriefCategory(payload))) {
    return resolveSystemTemplateMail(payload);
  }

  if (payload?.currentDraft?.sections?.length) {
    return payload.currentDraft;
  }

  try {
    const summary = summarizeEmailBase();
    const referenceTarget = resolveReferenceTemplateMailTarget(payload);
    const preview = await buildEmailBasePreview(
      referenceTarget.category || resolveBriefCategory(payload, summary.currentMail?.category || ""),
      referenceTarget.mailId || cleanText(payload?.brief?.mailId) || summary.currentMail?.mailId || "",
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

    return {
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
  });
}

function mergeGeneratedMailOntoTemplate(generatedMail, templateMail, payload) {
  if (!templateMail || typeof templateMail !== "object") {
    return generatedMail;
  }

  const baseMail = normalizeMail(templateMail, payload);
  const normalizedGeneratedMail = normalizeMail(generatedMail, payload);
  const payloadTranslationEntries = parseTranslationEntries(cleanText(payload?.translationText), baseMail);
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
    sections: mergeGeneratedSectionsOntoTemplateSections(baseMail.sections, normalizedGeneratedMail.sections),
    assets: baseMail.assets
  };

  return applyPrimaryTranslationEntryToMail(applyDeterministicDraftEdits(merged, payload), payload);
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
  let generated;
  let mode = providerId;
  let providerRuntime = createProviderRuntime({
    providerId,
    mode
  });

  if (providerId === "openai" && openAiApiKey) {
    try {
      generated = await createOpenAiDraft(payload);
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

  const templateMail = await resolveTemplateMail(payload);
  if (templateMail) {
    generated = {
      ...generated,
      mail: mergeGeneratedMailOntoTemplate(generated?.mail || null, templateMail, payload)
    };
  }

  let draftResponse = {
    ...materializeDraft(generated, payload, mode),
    designAnalysis: normalizeDesignAnalysis(generated.design_analysis),
    providerRuntime
  };

  if (shouldAutoGenerateMissingLocalesForDraft(payload, draftResponse.draft)) {
    try {
      const localesResult = await generateMissingLocales(payload, draftResponse.draft);
      const visibleGeneratedLocales = Array.isArray(localesResult.generatedLocales)
        ? localesResult.generatedLocales.filter((locale) => locale !== normalizeLocaleCode(payload?.brief?.locale || draftResponse?.draft?.mail?.locale || "en"))
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

  if (summaryEmailBaseBuildIsAvailableForDraft(payload, draftResponse.draft)) {
    try {
      const builtPreview = await buildTemporaryEmailBasePreviewFromDraft(payload, draftResponse.draft.mail);
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

  return Boolean(cleanText(payload?.brief?.category));
}

async function resolveChatResponse(payload) {
  if (payload.intent === "discuss") {
    return resolveDiscussionResponse(payload);
  }

  return resolveDraftResponse(payload);
}

async function resolveDesignAnalysis(payload) {
  const providerId = payload.settings.providerId;

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

  if (providerId === "openai" && openAiApiKey) {
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

    if (request.method === "GET" && request.url === "/api/status") {
      const blockCatalog = await ensureBlockCatalog();
      const assetRegistry = await readAssetRegistry();
      const journal = await readStudioJournal();
      const projectRules = await readProjectRules();
      sendJson(response, 200, {
        openAiConfigured: Boolean(openAiApiKey),
        model: openAiModel,
        config: summarizeRuntimeConfig(),
        providers: getProviderCatalog(),
        clientProfiles,
        emailBase: summarizeEmailBase(),
        blockCatalog: summarizeBlockCatalog(blockCatalog),
        assetRegistry: summarizeAssetRegistry(assetRegistry),
        journal: summarizeStudioJournal(journal),
        projectRules: summarizeProjectRules(projectRules)
      });
      return;
    }

    if (request.method === "GET" && request.url === "/api/block-catalog") {
      sendJson(response, 200, await ensureBlockCatalog());
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
      sendJson(response, 200, await resolveChatResponse(payload));
      return;
    }

    if (request.method === "POST" && request.url === "/api/chat/stream") {
      const payload = normalizePayload(await readRequestBody(request));
      payload.projectRules = (await readProjectRules()).items;
      await streamChatResponse(response, payload);
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
      const draftSource = rawPayload?.draft?.mail || rawPayload?.draft || rawPayload?.currentDraft;

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

server.listen(port, () => {
  console.log(`Email Studio Demo is running on http://localhost:${port}`);
});
