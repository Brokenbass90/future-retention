import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { existsSync, readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, "public");
const emailBaseRoot = path.join(__dirname, "email-base");

const port = Number(process.env.PORT || 3000);
const openAiApiKey = process.env.OPENAI_API_KEY || "";
const openAiModel = process.env.OPENAI_MODEL || "gpt-4.1-mini";
const categoryIgnoreList = new Set(["vendor", "docs", "dist", "tools", "node_modules", "_legacy"]);
const localeDirPattern = /^[A-Za-z]{2}([_-][A-Za-z]{2})?$/;
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
  "Return a practical marketing email structure with 3-5 sections.",
  "Prefer these section kinds only: hero, text, feature-list, image, cta, footer.",
  "Use empty strings or empty arrays for fields that do not apply.",
  "Do not mention implementation limits or that you are an AI assistant.",
  "Keep the assistant reply short, direct, and useful to an email marketer."
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
            required: ["key", "url", "alt", "width", "height"]
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

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

function listDirectoryNames(rootPath, matcher = () => true) {
  if (!existsSync(rootPath)) {
    return [];
  }

  return readdirSync(rootPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && matcher(entry.name))
    .map((entry) => entry.name)
    .sort();
}

function getProviderCatalog() {
  return [
    {
      id: "openai",
      label: "OpenAI",
      available: Boolean(openAiApiKey),
      status: openAiApiKey ? `Configured: ${openAiModel}` : "Needs OPENAI_API_KEY",
      capabilities: ["chat", "vision", "structured output"]
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
          templatePath: `${currentCategory}/${currentMail.folder}/app/templates/index.pug`,
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

  const result = await runCommand(
    process.execPath,
    ["mail", "build-pretty", selectedCategory, selectedMail, "--locales", selectedLocale],
    emailBaseRoot
  );

  const distDir = path.join(emailBaseRoot, "dist", selectedCategory, `mail-${selectedMail}`, selectedLocale);
  const prettyPath = path.join(distDir, "index.pretty.html");
  const compactPath = path.join(distDir, "index.html");
  const htmlPath = existsSync(prettyPath) ? prettyPath : compactPath;
  const templatePath = path.join(
    emailBaseRoot,
    selectedCategory,
    `mail-${selectedMail}`,
    "app",
    "templates",
    "index.pug"
  );
  const footerLocalePath = path.join(emailBaseRoot, "vendor", "data", selectedLocale, "footer.json");

  const html = await readFile(htmlPath, "utf8");
  const templateSource = await readFile(templatePath, "utf8");
  const localeSource = existsSync(footerLocalePath)
    ? await readFile(footerLocalePath, "utf8")
    : JSON.stringify({ note: "No locale footer file found" }, null, 2);
  const assets = extractAssetRecordsFromHtml(html);

  return {
    assistantReply: `Загрузил реальный build из email-base: ${selectedCategory}/mail-${selectedMail} (${selectedLocale}).`,
    mode: "email-base",
    draft: {
      mail: {
        subject: `email-base/${selectedCategory}/mail-${selectedMail}`,
        preheader: "Built from actual email-base template",
        locale: selectedLocale,
        summary: "Real HTML built by email-base pipeline",
        sections: [],
        assets,
        translations: [
          {
            locale: selectedLocale,
            subject: `email-base/${selectedCategory}/mail-${selectedMail}`,
            preheader: "Built from actual email-base template",
            cta_labels: [],
            notes: "Preview loaded from the real build pipeline."
          }
        ]
      },
      html,
      pug: templateSource,
      locales: localeSource,
      assetsManifest: JSON.stringify(
        Object.fromEntries(assets.map((asset) => [asset.key, asset])),
        null,
        2
      ),
      spec: JSON.stringify(
        {
          source: "email-base",
          category: selectedCategory,
          mailId: selectedMail,
          locale: selectedLocale,
          distPath: path.relative(__dirname, htmlPath)
        },
        null,
        2
      ),
      buildLog: [result.stdout, result.stderr].filter(Boolean).join("\n").trim() || "Build completed."
    }
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
  return cleanText(brief.locale) || "en";
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
        notes: cleanText(asset?.notes)
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

function normalizePayload(payload) {
  const brief = payload?.brief ?? {};
  const settings = payload?.settings ?? {};
  const assetInputs = normalizeAssetInputs(payload);
  return {
    intent: cleanText(payload?.intent) || "draft",
    messages: Array.isArray(payload?.messages) ? payload.messages.slice(-8) : [],
    brief: {
      campaignName: cleanText(brief.campaignName),
      category: cleanText(brief.category),
      mailId: cleanText(brief.mailId),
      locale: getDraftLocale(brief),
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
    assetInputs,
    assetLinks: assetInputs.map((asset) => asset.url).filter(Boolean),
    translationText: cleanText(payload?.translationText),
    design: payload?.design && cleanText(payload.design.dataUrl)
      ? {
          name: cleanText(payload.design.name) || "design-reference",
          dataUrl: cleanText(payload.design.dataUrl)
        }
      : null,
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
    "Create a draft marketing email.",
    `Campaign name: ${payload.brief.campaignName || "Untitled campaign"}`,
    `Primary locale: ${payload.brief.locale}`,
    `Audience: ${payload.brief.audience || "Not specified"}`,
    `Goal: ${payload.brief.goal || "Not specified"}`,
    `Tone: ${payload.brief.tone || "Direct and clear"}`,
    `Primary CTA label: ${payload.brief.primaryCta || "Learn more"}`,
    `Primary CTA href: ${payload.brief.primaryLink || "https://example.com"}`,
    `Content notes: ${payload.brief.contentNotes || "None"}`,
    `Design URL: ${payload.brief.designUrl || "None"}`,
    "Structured assets:",
    describeAssetPlan(payload.assetInputs),
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
    "Answer like a collaborative email strategist and implementation partner.",
    "Be concise but concrete. Suggest improvements, ask for missing pieces implicitly by pointing them out, and reference the current draft when useful.",
    `Campaign name: ${payload.brief.campaignName || "Untitled campaign"}`,
    `Goal: ${payload.brief.goal || "Not specified"}`,
    `Tone: ${payload.brief.tone || "Not specified"}`,
    `Primary locale: ${payload.brief.locale}`,
    `Current base mail: ${emailBaseSummary.currentMail?.folder || "None"}`,
    "Structured assets:",
    describeAssetPlan(payload.assetInputs),
    "Current draft context:",
    summarizeCurrentDraft(payload.currentDraft),
    "Translations source:",
    summarizeTranslationText(payload.translationText),
    "Conversation transcript:",
    transcript || "User: Let's discuss the email direction."
  ].join("\n");
}

function buildInputMessages(payload) {
  const content = [
    {
      type: "input_text",
      text: buildUserContext(payload)
    }
  ];

  if (payload.brief.designUrl && looksLikeImageUrl(payload.brief.designUrl)) {
    content.push({
      type: "input_image",
      image_url: payload.brief.designUrl,
      detail: "auto"
    });
  }

  if (payload.design?.dataUrl) {
    content.push({
      type: "input_image",
      image_url: payload.design.dataUrl,
      detail: "auto"
    });
  }

  for (const assetLink of payload.assetLinks.slice(0, 3)) {
    if (/\.(png|jpe?g|gif|webp|svg)(\?.*)?$/i.test(assetLink)) {
      content.push({
        type: "input_image",
        image_url: assetLink,
        detail: "low"
      });
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

function buildDiscussionMessages(payload) {
  const content = [
    {
      type: "input_text",
      text: buildDiscussionContext(payload)
    }
  ];

  if (payload.brief.designUrl && looksLikeImageUrl(payload.brief.designUrl)) {
    content.push({
      type: "input_image",
      image_url: payload.brief.designUrl,
      detail: "auto"
    });
  }

  if (payload.design?.dataUrl) {
    content.push({
      type: "input_image",
      image_url: payload.design.dataUrl,
      detail: "auto"
    });
  }

  for (const [index, asset] of payload.assetInputs.slice(0, 4).entries()) {
    if (looksLikeImageUrl(asset.url)) {
      const placement = resolveAssetPlacement(asset, index);
      content.push({
        type: "input_image",
        image_url: asset.url,
        detail: placement === "hero" ? "auto" : "low"
      });
    }
  }

  return [
    {
      role: "system",
      content: [{
        type: "input_text",
        text: "You are a live email strategist inside a collaborative email-studio. Discuss ideas, critique drafts, and suggest implementation-minded next steps."
      }]
    },
    {
      role: "user",
      content
    }
  ];
}

function createAssetRecords(payload) {
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

  if (payload.design?.dataUrl) {
    records.unshift({
      key: "uploaded_design",
      url: payload.design.dataUrl,
      alt: payload.design.name || "Uploaded design reference",
      placement: "design-reference",
      notes: "Uploaded design reference",
      width: 600,
      height: 300
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

function normalizeBoldTokens(text) {
  return cleanText(text).replace(/@@(.*?)@@/g, "**$1**");
}

function unwrapTranslationBraces(text) {
  return cleanText(text).replace(/^\{\{\s*/, "").replace(/\s*\}\}$/, "").trim();
}

function extractLocaleFromFilename(fileName) {
  const match = cleanText(fileName).match(/_([a-z]{2}(?:[_-][A-Za-z]{2})?)(?:_|\.|$)/);
  return match ? match[1].replace("-", "_") : "";
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

  const subjectMatch = content.match(/^Subject:\s*(.+)$/im);
  const snippetMatch = content.match(/^Snippet:\s*(.+)$/im);
  const bodySource = content
    .replace(/^Subject:\s*.+$/gim, "")
    .replace(/^Snippet:\s*.+$/gim, "");
  const blocks = [...bodySource.matchAll(/\{\{([\s\S]*?)\}\}/g)]
    .map((match) => normalizeBoldTokens(unwrapTranslationBraces(match[1])))
    .filter(Boolean);
  const lines = content.split(/\r?\n/).map((line) => line.trim());
  const pushIndex = lines.findIndex((line) => /^PUSH$/i.test(line));
  const pushLines = pushIndex >= 0
    ? lines.slice(pushIndex + 1).map(normalizeBoldTokens).filter(Boolean)
    : [];
  const localeFromName = extractLocaleFromFilename(doc.name);
  const locale = localeFromName || "unknown";

  if (!subjectMatch && !snippetMatch && blocks.length === 0) {
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
    subject: normalizeBoldTokens(unwrapTranslationBraces(subjectMatch?.[1] || "")),
    preheader: normalizeBoldTokens(unwrapTranslationBraces(snippetMatch?.[1] || "")),
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

  const normalizedPreferred = cleanText(preferredLocale).toLowerCase();
  return entries.find((entry) => cleanText(entry.locale).toLowerCase() === normalizedPreferred)
    || entries.find((entry) => cleanText(entry.locale).toLowerCase().startsWith(normalizedPreferred.split(/[_-]/)[0] || ""))
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
    locale: cleanText(entry?.locale) || mail.locale || "en",
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

function createMockDraft(payload, warning = "") {
  const translationSeed = findPreferredTranslationEntry(payload.translationText, payload.brief.locale, {
    locale: payload.brief.locale || "en",
    subject: "",
    preheader: "",
    sections: [],
    body_blocks: []
  });
  const campaignName = payload.brief.campaignName || "Retention restart";
  const translatedBlocks = Array.isArray(translationSeed?.body_blocks) ? translationSeed.body_blocks : [];
  const translatedHeadline = translatedBlocks[0] || "";
  const translatedBody = translatedBlocks[1] || "";
  const headline = payload.brief.goal || translatedBody || "Bring inactive customers back with a clean, clear offer.";
  const heroTitle = translatedHeadline || campaignName;
  const ctaLabel = payload.brief.primaryCta || translationSeed?.cta_labels?.[0] || translatedBlocks[2] || "See the offer";
  const ctaHref = payload.brief.primaryLink || "https://example.com";
  const assets = createAssetRecords(payload);
  const heroAsset = getAssetByPlacement(assets, ["hero", "background", "logo"])?.key || assets[0]?.key || "";
  const sectionAsset = getAssetByPlacement(assets, ["section", "feature", "body"])?.key || "";
  const locale = payload.brief.locale || "en";
  const featureItems = translatedBlocks.length > 3
    ? translatedBlocks.slice(3, 7)
    : defaultFeatureItems(payload);
  const subject = translationSeed?.subject || `${campaignName} | ${ctaLabel}`;
  const preheader = translationSeed?.preheader || headline.slice(0, 90);

  const mail = {
    subject,
    preheader,
    locale,
    summary: headline,
    sections: [
      {
        kind: "hero",
        eyebrow: "Email Studio Demo",
        title: heroTitle,
        body: headline,
        image_key: heroAsset,
        cta_label: ctaLabel,
        cta_href: ctaHref,
        items: []
      },
      {
        kind: "feature-list",
        eyebrow: "Why this email exists",
        title: "Suggested block structure",
        body: "These bullets come from your brief and show how the studio can turn raw notes into reusable email blocks.",
        image_key: "",
        cta_label: "",
        cta_href: "",
        items: featureItems
      },
      {
        kind: "text",
        eyebrow: "Creative direction",
        title: "How I would build it next",
        body: "Turn this demo draft into a canonical mail spec, connect it to your real email base, and then let the assistant generate only from approved block definitions.",
        image_key: sectionAsset,
        cta_label: "",
        cta_href: "",
        items: []
      },
      {
        kind: "cta",
        eyebrow: "Primary action",
        title: "Ready for preview and code review",
        body: "The preview, HTML, Pug sketch, locales JSON, and asset manifest are generated from the same structured draft.",
        image_key: "",
        cta_label: ctaLabel,
        cta_href: ctaHref,
        items: []
      },
      {
        kind: "footer",
        eyebrow: "",
        title: "Footer",
        body: "Future step: connect repository sync, canonical block catalog, and build/lint actions.",
        image_key: "",
        cta_label: "",
        cta_href: "",
        items: []
      }
    ],
    assets,
    translations: []
  };

  mail.translations = parseTranslationSeed(payload.translationText, mail);

  const suffix = warning ? ` Сейчас включен mock-режим: ${warning}.` : "";
  return {
    assistant_reply: `Собрал первый драфт письма и разложил его на блоки, preview и код.${suffix}`,
    mail
  };
}

function createMockDiscussion(payload, warning = "") {
  const lastUserMessage = [...payload.messages].reverse().find((message) => message.role === "user")?.content || "";
  const draft = payload.currentDraft;
  const hasDesign = Boolean(payload.design?.dataUrl || payload.brief.designUrl);
  const hasTranslations = Boolean(payload.translationText);
  const assetPlan = payload.assetInputs
    .filter((asset) => asset.url)
    .map((asset, index) => `${resolveAssetKey(asset, index, resolveAssetPlacement(asset, index))} -> ${resolveAssetPlacement(asset, index)}`)
    .join(", ");

  if (!draft) {
    return {
      assistantReply: [
        "Сейчас чат живой, но у нас еще нет рабочего draft.",
        "Сначала дай мне контекст письма, потом загрузи design, переводы и картинки в Upload Hub, и после этого я смогу обсуждать уже конкретный draft.",
        warning ? `Текущий режим: ${warning}.` : ""
      ].filter(Boolean).join(" ")
    };
  }

  return {
    assistantReply: [
      `Обсуждаю текущее письмо. Последний запрос: "${lastUserMessage || "без явного вопроса"}".`,
      hasDesign ? "Design reference уже есть." : "Design reference пока не загружен.",
      hasTranslations ? "Переводы уже приложены." : "Переводы пока не приложены.",
      assetPlan ? `Картинки размечены так: ${assetPlan}.` : "Картинки пока не размечены по ролям.",
      "Следующий рабочий шаг: либо обсуждаем изменения текста/структуры, либо жмем обновление draft и применяем их к письму.",
      warning ? `Текущий режим: ${warning}.` : ""
    ].join(" ")
  };
}

function normalizeMail(rawMail, payload) {
  const fallback = createMockDraft(payload).mail;
  const mail = rawMail && typeof rawMail === "object" ? rawMail : fallback;

  const normalized = {
    subject: cleanText(mail.subject) || fallback.subject,
    preheader: cleanText(mail.preheader) || fallback.preheader,
    locale: cleanText(mail.locale) || fallback.locale,
    summary: cleanText(mail.summary) || fallback.summary,
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

  return normalized;
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
  const button = section.cta_label && section.cta_href
    ? `<a class="button" href="${escapeHtml(section.cta_href)}">${formatInlineMarkup(section.cta_label)}</a>`
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

function renderEmailHtml(mail) {
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

function materializeDraft(result, payload, mode) {
  const mail = normalizeMail(result.mail, payload);
  const emailBaseSummary = summarizeEmailBase();

  return {
    assistantReply: cleanText(result.assistant_reply) || "Черновик письма собран.",
    mode,
    draft: {
      mail,
      html: renderEmailHtml(mail),
      pug: renderEmailPug(mail),
      locales: renderLocalesJson(mail),
      assetsManifest: renderAssetsManifest(mail),
      spec: JSON.stringify(mail, null, 2),
      buildLog: [
        "No email-base build executed yet.",
        emailBaseSummary.currentMail
          ? `Current base mail: ${emailBaseSummary.currentMail.folder}`
          : "No current base mail detected."
      ].join("\n")
    }
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
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${openAiApiKey}`
    },
    body: JSON.stringify({
      model: openAiModel,
      input: buildInputMessages(payload),
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

  return JSON.parse(rawText);
}

async function createOpenAiDiscussion(payload) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${openAiApiKey}`
    },
    body: JSON.stringify({
      model: openAiModel,
      input: buildDiscussionMessages(payload)
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
    if (request.method === "GET" && request.url === "/api/status") {
      sendJson(response, 200, {
        openAiConfigured: Boolean(openAiApiKey),
        model: openAiModel,
        providers: getProviderCatalog(),
        clientProfiles,
        emailBase: summarizeEmailBase()
      });
      return;
    }

    if (request.method === "POST" && request.url === "/api/chat") {
      const payload = normalizePayload(await readRequestBody(request));
      const providerId = payload.settings.providerId;

      if (payload.intent === "discuss") {
        let discussion;
        let mode = providerId;

        if (providerId === "openai" && openAiApiKey) {
          try {
            discussion = await createOpenAiDiscussion(payload);
            mode = "openai-discuss";
          } catch (error) {
            discussion = createMockDiscussion(payload, error.message);
            mode = "mock-discuss";
          }
        } else if (providerId === "mock") {
          discussion = createMockDiscussion(payload, "Mock provider selected in settings");
          mode = "mock-discuss";
        } else if (providerId === "openai") {
          discussion = createMockDiscussion(payload, "OPENAI_API_KEY is not configured on the server");
          mode = "mock-discuss";
        } else {
          discussion = createMockDiscussion(payload, `${providerId} adapter is planned but not wired yet`);
          mode = "mock-discuss";
        }

        sendJson(response, 200, {
          assistantReply: discussion.assistantReply,
          mode
        });
        return;
      }

      let generated;
      let mode = providerId;

      if (providerId === "openai" && openAiApiKey) {
        try {
          generated = await createOpenAiDraft(payload);
          mode = "openai";
        } catch (error) {
          generated = createMockDraft(payload, error.message);
          mode = "mock";
        }
      } else if (providerId === "mock") {
        generated = createMockDraft(payload, "Mock provider selected in settings");
        mode = "mock";
      } else if (providerId === "openai") {
        generated = createMockDraft(payload, "OPENAI_API_KEY is not configured on the server");
        mode = "mock";
      } else {
        generated = createMockDraft(payload, `${providerId} adapter is planned but not wired yet`);
        mode = "mock";
      }

      sendJson(response, 200, materializeDraft(generated, payload, mode));
      return;
    }

    if (request.method === "POST" && request.url === "/api/email-base/build") {
      const payload = normalizePayload(await readRequestBody(request));
      const summary = summarizeEmailBase();
      const category = cleanText(payload?.brief?.category || payload?.category) || summary.currentMail?.category;
      const mailId = cleanText(payload?.brief?.mailId || payload?.mailId) || summary.currentMail?.mailId;
      const locale = cleanText(payload?.brief?.locale || payload?.locale) || payload.brief.locale || "en";

      sendJson(response, 200, await buildEmailBasePreview(category, mailId, locale));
      return;
    }

    if (request.method === "GET") {
      await serveStatic(request, response);
      return;
    }

    sendJson(response, 404, { error: "Not found" });
  } catch (error) {
    sendJson(response, 500, {
      error: error instanceof Error ? error.message : "Unknown server error"
    });
  }
});

server.listen(port, () => {
  console.log(`Email Studio Demo is running on http://localhost:${port}`);
});
