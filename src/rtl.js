/**
 * src/rtl.js — server-side wrapper around email-base/tools/rtl.js (CJS).
 *
 * Provides ESM-friendly RTL helpers used by the studio for previewing,
 * AI flows, and email-base bridges. The actual transformation logic lives
 * in email-base/tools/rtl.js (build-time + runtime source of truth).
 *
 * This module:
 *   1. Lazily loads the CJS core via createRequire (cached).
 *   2. Falls back to a conservative inline transformer if the core fails
 *      to load (preserves preview parity in degraded mode).
 *   3. Exposes isRtlLocale() and applyLocaleDirectionToHtml() for the rest
 *      of the server to consume.
 *
 * Extracted from server.js as part of P0.1 (modularization). Goal: prove
 * the pattern of pulling clean subsystems out of the monolith before
 * tackling larger ones (figma, ai, email-base bridges).
 */

import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);

const RTL_SCRIPT_CODES = new Set([
  "adlm", "arab", "hebr", "mand", "nkoo", "rohg", "samr", "syrc", "thaa", "yezi",
]);
const RTL_DEFAULT_LANGUAGES = new Set([
  "ar", "arc", "dv", "fa", "he", "khw", "ks", "ps", "sd", "ug", "ur", "yi",
]);
const RTL_V2_MARKER_RE = /<!--\s*retkit-rtl:v2:(text|mirror)\s*-->/i;
const RTL_ANY_MARKER_RE = /<!--\s*retkit-rtl:v(?:1|2(?::(?:text|mirror))?)\s*-->/i;

// Cache the resolved module — but invalidate when the file on disk
// changes. Without this, edits to email-base/tools/rtl.js wouldn't take
// effect in a running studio process until full restart, which is the
// kind of footgun that has caused multiple "the fix doesn't work" loops.
// We keep the most-recently-loaded module in memory plus the file's mtime;
// on each call we re-stat and re-require if the mtime moved.
let _rtlCoreCache; // null when load failed, undefined when not yet loaded
let _rtlCoreMtimeMs = 0;
let _rtlCorePath = null;

function normalizeLocaleCode(locale) {
  return String(locale || "").trim().replace(/_/g, "-").split(/[.@]/, 1)[0];
}

function parseLocaleForDirection(locale) {
  const normalized = normalizeLocaleCode(locale);
  const parts = normalized.split("-").filter(Boolean);
  const language = /^[a-z]{2,3}$/i.test(parts[0] || "") ? parts[0].toLowerCase() : "";
  let script = "";
  let region = "";
  for (const part of parts.slice(1)) {
    if (/^[a-z0-9]$/i.test(part)) break;
    if (!script && /^[a-z]{4}$/i.test(part)) script = part.toLowerCase();
    else if (!region && /^(?:[a-z]{2}|\d{3})$/i.test(part)) region = part.toUpperCase();
  }
  return { normalized, language, script, region };
}

function fallbackLikelyScript({ language, region }) {
  if (language === "ha") return "latn";
  if (language === "ku") return /^(?:IQ|IR)$/.test(region) ? "arab" : "latn";
  if (language === "ks") return "arab";
  if (language === "az") return region === "IR" ? "arab" : "latn";
  if (language === "pa") return region === "PK" ? "arab" : "guru";
  if (language === "uz") return region === "AF" ? "arab" : "latn";
  return RTL_DEFAULT_LANGUAGES.has(language) ? "arab" : "latn";
}

function resolveLocaleScript(locale) {
  const parsed = parseLocaleForDirection(locale);
  if (!parsed.language) return "";
  if (parsed.script) return parsed.script;
  try {
    if (typeof Intl !== "undefined" && typeof Intl.Locale === "function") {
      const likely = new Intl.Locale(parsed.normalized).maximize();
      if (likely.script) return String(likely.script).toLowerCase();
    }
  } catch {
    // Invalid/private locale: deterministic fallback below.
  }
  return fallbackLikelyScript(parsed);
}

export function isRtlLocale(locale) {
  return RTL_SCRIPT_CODES.has(resolveLocaleScript(locale));
}

function normalizeRtlMode(opts) {
  const rawMode = typeof opts === "string"
    ? opts
    : (opts && (opts.mode || opts.layout || opts.layoutMode));
  return /^(?:mirror|full)$/i.test(String(rawMode || "").trim()) ? "mirror" : "text";
}

function getAppliedRtlMode(html) {
  const marker = RTL_V2_MARKER_RE.exec(String(html || ""));
  return marker ? marker[1].toLowerCase() : "";
}

function hasLegacyRtlMarker(html) {
  const source = String(html || "");
  return (!getAppliedRtlMode(source) && RTL_ANY_MARKER_RE.test(source))
    || /<html\b[^>]*\bdata-retkit-rtl\s*=\s*(["']?)1\1/i.test(source);
}

function createRtlModeConflict(appliedMode, requestedMode) {
  const error = new Error(
    `[rtl] HTML is already transformed in "${appliedMode}" mode and cannot be switched to ` +
    `"${requestedMode}" after mutation. Rebuild from clean source (Original) and apply the requested mode.`
  );
  error.code = "RETKIT_RTL_MODE_CONFLICT";
  error.appliedMode = appliedMode;
  error.requestedMode = requestedMode;
  return error;
}

function assertRtlModeCanApply(html, mode) {
  const appliedMode = getAppliedRtlMode(html);
  if (appliedMode) {
    if (appliedMode === mode) return false;
    throw createRtlModeConflict(appliedMode, mode);
  }
  if (hasLegacyRtlMarker(html)) throw createRtlModeConflict("legacy/unknown", mode);
  if (/\bdata-rtl-swapped\s*=/i.test(String(html || ""))) {
    if (mode === "mirror") return false;
    throw createRtlModeConflict("mirror", mode);
  }
  return true;
}

function loadRtlCore() {
  if (!_rtlCorePath) {
    _rtlCorePath = path.join(process.cwd(), "email-base", "tools", "rtl.js");
  }
  let mtimeMs = 0;
  try {
    const { statSync } = require("node:fs");
    mtimeMs = statSync(_rtlCorePath).mtimeMs;
  } catch {
    // If we can't stat, fall through to (re)load attempt.
  }
  if (_rtlCoreCache !== undefined && mtimeMs === _rtlCoreMtimeMs) {
    return _rtlCoreCache;
  }
  try {
    // Drop CJS require cache entry so the next require reads fresh source.
    try { delete require.cache[require.resolve(_rtlCorePath)]; } catch {}
    _rtlCoreCache = require(_rtlCorePath);
    _rtlCoreMtimeMs = mtimeMs;
  } catch (err) {
    console.warn("[rtl] core load failed:", err && err.message ? err.message : err);
    _rtlCoreCache = null;
  }
  return _rtlCoreCache;
}

/**
 * Conservative inline fallback — used only when email-base/tools/rtl.js
 * is unavailable. Intentionally MINIMAL: it never adds `dir="rtl"` to
 * wrappers, links, inline tags, or whole tables/rows. The core module
 * in email-base/tools/rtl.js does the precise innermost-text-cell
 * detection; this fallback limits changes to text nodes and CTA shells so
 * framework-derived inline layout is not moved in degraded mode. If a deployment
 * runs this fallback for a while, the result is "mostly correct RTL
 * text alignment, no aggressive dir injection that could squeeze
 * layout".
 */
function rtlInlineFallback(source, opts = {}) {
  let html = source;
  const mode = normalizeRtlMode(opts);
  if (!assertRtlModeCanApply(html, mode)) {
    // A marker with this mode is an exact no-op. Legacy mirror signatures are
    // left untouched because their source has already been mutated.
    if (!getAppliedRtlMode(html) && /\bdata-rtl-swapped\s*=/i.test(html)) {
      const marker = `<!--retkit-rtl:v2:mirror-->`;
      return /<html\b/i.test(html)
        ? html.replace(/<html\b[^>]*>/i, (open) => `${open}${marker}`)
        : `${marker}${html}`;
    }
    return html;
  }
  const flipCss = (css) =>
    String(css || "").replace(
      /\btext-align\s*:\s*(left|start|end)\b([^;}\n]*)/gi,
      (match, _value, rest) =>
        /\!\s*important/i.test(rest) ? match : `text-align: right${rest}`
    );
  const flipAlign = (attrs) =>
    /\balign\s*=/i.test(attrs)
      ? attrs.replace(/\balign\s*=\s*(["']?)(left|start|end)\1/gi, 'align="right"')
      : attrs;
  const readAttr = (attrs, name) => {
    const src = String(attrs || "");
    const quoted = new RegExp(`\\b${name}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "i").exec(src);
    if (quoted) return quoted[2];
    const bare = new RegExp(`\\b${name}\\s*=\\s*([^\\s"'>]+)`, "i").exec(src);
    return bare ? bare[1] : "";
  };
  const hasClassToken = (attrs, re) =>
    readAttr(attrs, "class")
      .split(/\s+/)
      .filter(Boolean)
      .some((token) => re.test(token));
  const isButtonClassToken = (attrs) =>
    hasClassToken(attrs, /^(?:button|tiny-button|small-button|medium-button(?:-[\w-]+)?|large-button)$/i) ||
    hasClassToken(attrs, /(?:^|-)button(?:-|$)/i);
  const isSelfCentered = (attrs) => {
    if (/\balign\s*=\s*(["']?)(?:center|middle)\1/i.test(attrs)) return true;
    const styleM = String(attrs || "").match(/\bstyle\s*=\s*(["'])([\s\S]*?)\1/i);
    if (styleM && /\bmargin\s*:\s*[^;]*\bauto\b/i.test(styleM[2])) return true;
    return false;
  };
  const forceAlignRight = (attrs) =>
    /\balign\s*=/i.test(attrs)
      ? attrs
          .replace(/\balign\s*=\s*(["'])([\s\S]*?)\1/i, 'align="right"')
          .replace(/\balign\s*=\s*([^\s"'>]+)/i, 'align="right"')
      : `${attrs} align="right"`;
  const withDirRtl = (attrs) => /\bdir\s*=/i.test(attrs) ? attrs : ` dir="rtl"${attrs}`;
  const ensureTextAlignRight = (attrs) => {
    const styleMatch = String(attrs || "").match(/\bstyle\s*=\s*(["'])([\s\S]*?)\1/i);
    const textAlign = styleMatch?.[2]?.match(/\btext-align\s*:\s*([a-zA-Z-]+)/i)?.[1]?.toLowerCase();
    if (textAlign && !/^(?:left|start|end)$/.test(textAlign)) return attrs;
    if (textAlign) {
      attrs = attrs.replace(/\bstyle\s*=\s*(["'])([\s\S]*?)\1/i,
        (_full, q, body) => `style=${q}${flipCss(body)}${q}`);
    }
    const align = readAttr(attrs, "align").toLowerCase();
    if (/^(?:center|middle|right|justify)$/.test(align)) return attrs;
    if (/^(?:left|start|end)$/.test(align)) attrs = forceAlignRight(attrs);
    if (textAlign) return attrs;
    if (/\bstyle\s*=/i.test(attrs)) {
      return attrs.replace(/\bstyle\s*=\s*(["'])([\s\S]*?)\1/i,
        (_full, q, body) => `style=${q}${body.replace(/\s*;?\s*$/, ";")} text-align: right;${q}`);
    }
    return `${attrs} style="text-align: right;"`;
  };

  // Full mirroring remains an explicit opt-in even in degraded mode.
  if (mode === "mirror") {
    html = html.replace(/<([a-z][\w:-]*)([^>]*)>/gi, (m, tag, attrs) => {
      if (/^(?:style|script)$/i.test(tag) || !/\bstyle\s*=/i.test(attrs)) return m;
      return `<${tag}${attrs.replace(
        /\bstyle\s*=\s*(["'])([\s\S]*?)\1/i,
        (_full, q, body) => `style=${q}${flipCss(body)}${q}`
      )}>`;
    });
    html = html.replace(/<([a-z][\w:-]*)([^>]*)>/gi, (m, tag, attrs) => {
      if (/^(?:style|script)$/i.test(tag) || !/\balign\s*=/i.test(attrs)) return m;
      return `<${tag}${flipAlign(attrs)}>`;
    });
  }

  html = html.replace(/<table\b([^>]*)>/gi, (m, attrs) => {
    if (!isButtonClassToken(attrs) || isSelfCentered(attrs)) return m;
    return `<table${forceAlignRight(attrs)}>`;
  });
  html = html.replace(/<(p|h[1-6]|li)\b([^>]*)>/gi,
    (_m, tag, attrs) => `<${tag}${ensureTextAlignRight(withDirRtl(attrs))}>`);
  html = html.replace(/<(td|th)\b([^>]*)>([^<]+)<\/\1>/gi, (m, tag, attrs, text) => {
    if (!/[A-Za-zА-Яа-яЁё֐-׿؀-ۿݐ-ݿ]/.test(text)) return m;
    return `<${tag}${ensureTextAlignRight(withDirRtl(attrs))}>${text}</${tag}>`;
  });

  const marker = `<!--retkit-rtl:v2:${mode}-->`;
  return /<html\b/i.test(html)
    ? html.replace(/<html\b[^>]*>/i, (open) => `${open}${marker}`)
    : `${marker}${html}`;
}

/**
 * Apply RTL transformation to HTML if locale is RTL. No-op otherwise.
 *
 * @param {string} html
 * @param {string} locale  e.g. "ar", "ar_KW", "ur", "he", "fa", "en_US"
 * @param {(s:string)=>string} [cleanText]  optional pre-clean function (e.g. server.js's cleanText)
 * @returns {string}
 */
export function applyLocaleDirectionToHtml(html, locale, cleanText, opts = {}) {
  const source = typeof cleanText === "function" ? cleanText(html) : String(html || "");
  if (!source || !isRtlLocale(locale)) return source;
  const core = loadRtlCore();
  if (core && typeof core.applyRtl === "function") {
    try {
      return core.applyRtl(source, opts);
    } catch (err) {
      if (err && err.code === "RETKIT_RTL_MODE_CONFLICT") throw err;
      console.warn("[rtl] core apply failed:", err && err.message ? err.message : err);
    }
  }
  return rtlInlineFallback(source, opts);
}

/**
 * Eagerly warm up the core module cache. Optional; the lazy path handles
 * cold starts gracefully but pre-warming avoids the first-request penalty.
 */
export function warmupRtl() {
  loadRtlCore();
}
