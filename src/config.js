/**
 * src/config.js — centralised configuration
 * Loaded once at startup. All modules import from here.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

// ─── Load .env ────────────────────────────────────────────────────────────────

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return { loaded: false, filePath, keys: [] };
  try {
    const source = readFileSync(filePath, "utf8");
    const keys = [];
    for (const line of source.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!match) continue;
      const key = match[1];
      let value = match[2].trim();
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
      keys.push(key);
    }
    return { loaded: true, filePath, keys };
  } catch {
    return { loaded: false, filePath, keys: [] };
  }
}

const envFilePath = path.join(ROOT, ".env");
export const envRuntime = loadEnvFile(envFilePath);

// ─── Paths ────────────────────────────────────────────────────────────────────

export const paths = {
  root: ROOT,
  public: path.join(ROOT, "public"),
  emailBase: path.join(ROOT, "email-base"),
  data: path.join(ROOT, "data"),
  src: path.join(ROOT, "src"),
  db: path.join(ROOT, "data", "studio.db"),
  blockCatalog: path.join(ROOT, "data", "block-catalog.json"),
  assetStorage: path.join(ROOT, "data", "assets"),
  assetRegistry: path.join(ROOT, "data", "asset-registry.json"),
  studioJournal: path.join(ROOT, "data", "studio-journal.json"),
  projectRules: path.join(ROOT, "data", "project-rules.json"),
  templateFamilyProfiles: path.join(ROOT, "data", "template-family-profiles.json"),
  mailStructureProfiles: path.join(ROOT, "data", "mail-structure-profiles.json"),
  aiLessons: path.join(ROOT, "data", "ai-lessons.json"),
};

// ─── API keys & settings ──────────────────────────────────────────────────────

export const PORT = Number(process.env.PORT || 3000);
export const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
export const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";
export const DEEPL_API_KEY = process.env.DEEPL_API_KEY || "";
export const DEEPL_API_URL = process.env.DEEPL_API_URL || "https://api-free.deepl.com";
export const FIGMA_API_TOKEN = process.env.FIGMA_API_TOKEN || "";
export const FIGMA_IMPORT_SECRET = process.env.FIGMA_IMPORT_SECRET || "";

// ─── Email base constants ─────────────────────────────────────────────────────

export const CATEGORY_IGNORE_LIST = new Set(["vendor", "docs", "dist", "tools", "node_modules", "_legacy"]);
export const LOCALE_DIR_PATTERN = /^[A-Za-z]{2}([_-][A-Za-z]{2})?$/;
export const TEMPLATE_SOURCE_EXTENSIONS = [".pug", ".jade"];

// ─── MIME types ───────────────────────────────────────────────────────────────

export const MIME_TYPES = {
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

// ─── Client profiles ──────────────────────────────────────────────────────────

export const CLIENT_PROFILES = [
  { id: "standard", label: "Standard preview", description: "Базовый browser preview без симуляции клиента." },
  { id: "gmail-web", label: "Gmail Web", description: "Heuristic profile для Gmail webmail и базовых ограничений." },
  { id: "outlook-desktop", label: "Outlook Desktop", description: "Heuristic profile под Word-based Outlook rendering." },
  { id: "apple-mail", label: "Apple Mail", description: "Более permissive профиль с высоким уровнем поддержки CSS." },
  { id: "yahoo-mail", label: "Yahoo Mail", description: "Heuristic профиль для консервативной webmail среды." }
];

// ─── Summary ──────────────────────────────────────────────────────────────────

export function getRuntimeConfigSummary() {
  return {
    envFilePath,
    envFileLoaded: envRuntime.loaded,
    envKeys: envRuntime.keys,
    openAiConfigured: Boolean(OPENAI_API_KEY),
    openAiModel: OPENAI_MODEL,
    deepLConfigured: Boolean(DEEPL_API_KEY),
    deepLApiUrl: DEEPL_API_URL,
    figmaConfigured: Boolean(FIGMA_API_TOKEN)
  };
}
