import path from "node:path";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { isRtlLocale } from "./rtl.js";

const LOCALE_RE = /^[A-Za-z]{2}(?:[_-][A-Za-z]{2})?$/;
const NAMESPACE_RE = /^[A-Za-z0-9_-]{1,160}$/;
const LOCALIZATION_TOKEN_RE = /\$\{\{\s*[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_.-]+)?\s*\}\}\$/g;
const LOCALIZATION_TOKEN_CAPTURE_RE = /\$\{\{\s*([a-zA-Z0-9_-]+)(?:\.([a-zA-Z0-9_.-]+))?\s*\}\}\$/g;
const WORKBENCH_BLOCK_KEY_RE = /^block_\d+$/;
const MAX_NAMESPACES = 100;
const MAX_LOCALES_PER_NAMESPACE = 100;
const MAX_BLOCKS_PER_LOCALE = 5000;
const MAX_SYNC_BYTES = 20 * 1024 * 1024;

function parseTxtBlocks(rawText) {
  const blocks = [];
  const normalized = String(rawText || "").replace(/\r\n?/g, "\n");
  const blockRe = /\{\{([\s\S]*?)\}\}/g;
  let match;
  while ((match = blockRe.exec(normalized)) !== null) blocks.push(match[1].trim());
  return blocks;
}

function localeBlocks(namespace, locale) {
  const direct = namespace?.locales?.[locale];
  if (Array.isArray(direct)) return direct;
  const raw = namespace?.localeRaw?.[locale];
  return typeof raw === "string" ? parseTxtBlocks(raw) : null;
}

function normalizeLocale(value) {
  const locale = String(value || "").trim();
  if (!LOCALE_RE.test(locale)) throw new Error(`Invalid locale: ${locale || "(empty)"}`);
  return locale;
}

function normalizeNamespace(value) {
  const namespace = String(value || "").trim();
  if (!NAMESPACE_RE.test(namespace)) {
    throw new Error(`Invalid locale namespace: ${namespace || "(empty)"}`);
  }
  return namespace;
}

/**
 * TXT locale files use @@text@@ for emphasis. The build pipeline consumes
 * JSON values directly, so convert that one authoring convention here while
 * preserving embedded variables/HTML verbatim.
 */
export function renderWorkbenchLocaleBlock(value) {
  return String(value ?? "").replace(/@@([\s\S]*?)@@/g, "<b>$1</b>");
}

export function planWorkbenchLocaleSync(namespaces) {
  if (namespaces == null) {
    return { entries: [], namespaces: [], locales: [], skippedBuiltins: [], totalBytes: 0 };
  }
  if (!Array.isArray(namespaces)) throw new Error("namespaces must be an array");
  if (namespaces.length > MAX_NAMESPACES) throw new Error("Too many locale namespaces");

  const entries = [];
  const seenNamespaces = new Set();
  const localeSet = new Set();
  const skippedBuiltins = [];
  let totalBytes = 0;

  for (const source of namespaces) {
    if (!source || typeof source !== "object") throw new Error("Invalid locale namespace payload");
    const namespace = normalizeNamespace(source.name || source.namespace);
    if (source.builtin === true) {
      skippedBuiltins.push(namespace);
      continue;
    }
    if (seenNamespaces.has(namespace)) throw new Error(`Duplicate locale namespace: ${namespace}`);
    seenNamespaces.add(namespace);

    const localeCodes = new Set([
      ...Object.keys(source.locales && typeof source.locales === "object" ? source.locales : {}),
      ...Object.keys(source.localeRaw && typeof source.localeRaw === "object" ? source.localeRaw : {}),
    ]);
    if (localeCodes.size > MAX_LOCALES_PER_NAMESPACE) {
      throw new Error(`Too many locales in namespace: ${namespace}`);
    }

    for (const rawLocale of localeCodes) {
      const locale = normalizeLocale(rawLocale);
      const blocks = localeBlocks(source, rawLocale);
      if (!Array.isArray(blocks)) continue;
      if (blocks.length > MAX_BLOCKS_PER_LOCALE) {
        throw new Error(`Too many blocks in ${namespace}/${locale}`);
      }
      const payload = {};
      for (let index = 0; index < blocks.length; index += 1) {
        payload[`block_${String(index).padStart(2, "0")}`] = renderWorkbenchLocaleBlock(blocks[index]);
      }
      const json = `${JSON.stringify(payload, null, 2)}\n`;
      totalBytes += Buffer.byteLength(json, "utf8");
      if (totalBytes > MAX_SYNC_BYTES) throw new Error("Locale namespace payload is too large");
      entries.push({ namespace, locale, payload, json, blockCount: blocks.length });
      localeSet.add(locale);
    }
  }

  return {
    entries,
    namespaces: [...seenNamespaces],
    locales: [...localeSet].sort(),
    skippedBuiltins,
    totalBytes,
  };
}

/**
 * Persist Workbench TXT namespaces in the canonical build-mail format:
 * vendor/data/<locale>/<namespace>.json. Writes are atomic and unrelated
 * namespaces/locales are never removed. Existing non-block_NN JSON keys are
 * preserved; only the Workbench-owned flat block_NN set is replaced.
 */
export async function syncWorkbenchLocaleNamespaces({ emailBaseRoot, namespaces }) {
  if (!emailBaseRoot) throw new Error("email-base is not attached");
  const root = path.resolve(String(emailBaseRoot || ""));
  if (!existsSync(root)) throw new Error("email-base is not attached");
  const plan = planWorkbenchLocaleSync(namespaces);
  let written = 0;
  let unchanged = 0;

  for (const entry of plan.entries) {
    const localeDir = path.join(root, "vendor", "data", entry.locale);
    const destination = path.join(localeDir, `${entry.namespace}.json`);
    await mkdir(localeDir, { recursive: true });
    let previous = null;
    let mergedPayload = {};
    try {
      previous = await readFile(destination, "utf8");
      const parsed = JSON.parse(previous);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error(`Locale JSON must contain an object: ${entry.locale}/${entry.namespace}.json`);
      }
      mergedPayload = Object.fromEntries(
        Object.entries(parsed).filter(([key]) => !WORKBENCH_BLOCK_KEY_RE.test(key)),
      );
    } catch (error) {
      if (previous != null) throw error;
    }
    Object.assign(mergedPayload, entry.payload);
    const mergedJson = `${JSON.stringify(mergedPayload, null, 2)}\n`;
    if (Buffer.byteLength(mergedJson, "utf8") > MAX_SYNC_BYTES) {
      throw new Error(`Locale JSON is too large: ${entry.locale}/${entry.namespace}.json`);
    }
    if (previous === mergedJson) {
      unchanged += 1;
      continue;
    }
    const temp = path.join(localeDir, `.${entry.namespace}.json.tmp-${process.pid}-${randomUUID()}`);
    try {
      await writeFile(temp, mergedJson, "utf8");
      await rename(temp, destination);
      written += 1;
    } finally {
      await rm(temp, { force: true }).catch(() => {});
    }
  }

  return {
    written,
    unchanged,
    fileCount: plan.entries.length,
    namespaceCount: plan.namespaces.length,
    namespaces: plan.namespaces,
    locales: plan.locales,
    skippedBuiltins: plan.skippedBuiltins,
    totalBytes: plan.totalBytes,
  };
}

export function findLocalizationTokens(html) {
  const matches = String(html || "").match(LOCALIZATION_TOKEN_RE) || [];
  return [...new Set(matches)];
}

export function describeHtmlLocalization(html, locale = "base") {
  const normalizedLocale = String(locale || "base");
  const tokens = findLocalizationTokens(html);
  const expectedRaw = normalizedLocale === "base" || normalizedLocale === "original";
  const unresolvedTokens = expectedRaw ? [] : tokens;
  return {
    locale: normalizedLocale === "original" ? "base" : normalizedLocale,
    expectedRaw,
    status: expectedRaw ? "source" : (unresolvedTokens.length ? "unresolved" : "localized"),
    tokenCount: tokens.length,
    unresolvedCount: unresolvedTokens.length,
    tokens,
    unresolvedTokens,
  };
}

function getDeep(value, pathParts) {
  let current = value;
  for (const part of pathParts) {
    if (current == null || !Object.prototype.hasOwnProperty.call(Object(current), part)) return undefined;
    current = current[part];
  }
  return current;
}

/**
 * Resolve only localization tokens that remain in a compiled locale. This is
 * an idempotent safety net for stale dist output: already localized text is
 * untouched and the document-level RTL transform is deliberately not run.
 */
export async function resolveRemainingHtmlLocalization({ emailBaseRoot, html, locale }) {
  const source = String(html || "");
  const diagnosticsBefore = describeHtmlLocalization(source, locale);
  if (diagnosticsBefore.expectedRaw || !diagnosticsBefore.tokenCount) {
    return { html: source, localization: { ...diagnosticsBefore, replacedCount: 0 } };
  }

  if (!emailBaseRoot) throw new Error("email-base is not attached");
  const root = path.resolve(String(emailBaseRoot));
  if (!existsSync(root)) throw new Error("email-base is not attached");
  const normalizedLocale = normalizeLocale(locale);
  const files = new Map();
  for (const token of diagnosticsBefore.tokens) {
    LOCALIZATION_TOKEN_CAPTURE_RE.lastIndex = 0;
    const match = LOCALIZATION_TOKEN_CAPTURE_RE.exec(token);
    if (!match || files.has(match[1])) continue;
    const namespace = normalizeNamespace(match[1]);
    const localePath = path.join(root, "vendor", "data", normalizedLocale, `${namespace}.json`);
    try {
      const parsed = JSON.parse(await readFile(localePath, "utf8"));
      files.set(namespace, parsed && typeof parsed === "object" ? parsed : null);
    } catch {
      files.set(namespace, null);
    }
  }

  let replacedCount = 0;
  LOCALIZATION_TOKEN_CAPTURE_RE.lastIndex = 0;
  const resolved = source.replace(LOCALIZATION_TOKEN_CAPTURE_RE, (token, namespace, keyPath) => {
    const translation = files.get(namespace);
    const parts = String(keyPath || "").split(".").filter(Boolean);
    let value = translation && parts.length ? getDeep(translation, parts) : undefined;
    if (value == null && translation?.[namespace] && parts.length) {
      value = getDeep(translation[namespace], parts);
    }
    if (value == null) return token;
    replacedCount += 1;
    const text = String(value);
    if (isRtlLocale(normalizedLocale) && text.trim() && !/<bdi\b/i.test(text)) {
      return `<bdi>${text}</bdi>`;
    }
    return text;
  });

  return {
    html: resolved,
    localization: {
      ...describeHtmlLocalization(resolved, normalizedLocale),
      replacedCount,
    },
  };
}
