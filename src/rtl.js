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

const RTL_PREFIXES = ["ar", "he", "fa", "ur"];

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
  return String(locale || "").trim();
}

export function isRtlLocale(locale) {
  const normalized = normalizeLocaleCode(locale).toLowerCase();
  if (!normalized) return false;
  return RTL_PREFIXES.some(
    (prefix) => normalized === prefix || normalized.startsWith(`${prefix}_`) || normalized.startsWith(`${prefix}-`)
  );
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
 * detection; this fallback just does the safe attribute/CSS flips so
 * the email isn't completely LTR in a degraded mode. If a deployment
 * runs this fallback for a while, the result is "mostly correct RTL
 * text alignment, no aggressive dir injection that could squeeze
 * layout".
 */
function rtlInlineFallback(source) {
  let html = source;
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
  const forceAlignRight = (attrs) =>
    /\balign\s*=/i.test(attrs)
      ? attrs
          .replace(/\balign\s*=\s*(["'])([\s\S]*?)\1/i, 'align="right"')
          .replace(/\balign\s*=\s*([^\s"'>]+)/i, 'align="right"')
      : `${attrs} align="right"`;
  html = html
    // 1) flip text-align in <style> blocks
    .replace(
      /(<style[^>]*>)([\s\S]*?)(<\/style>)/gi,
      (_m, open, body, close) => `${open}${flipCss(body)}${close}`
    )
    // 2) flip text-align inside inline style="..." on every tag
    .replace(/<([a-z][\w:-]*)([^>]*)>/gi, (m, tag, attrs) => {
      if (/^(?:style|script)$/i.test(tag) || !/\bstyle\s*=/i.test(attrs)) return m;
      return `<${tag}${attrs.replace(
        /\bstyle\s*=\s*(["'])([\s\S]*?)\1/i,
        (_full, q, body) => `style=${q}${flipCss(body)}${q}`
      )}>`;
    })
    // 3) flip align="left|start|end" → align="right" — no dir added
    .replace(/<([a-z][\w:-]*)([^>]*)>/gi, (m, tag, attrs) => {
      if (/^(?:style|script)$/i.test(tag) || !/\balign\s*=/i.test(attrs)) return m;
      return `<${tag}${flipAlign(attrs)}>`;
    })
    // 4) button class tables → force align="right" (no dir)
    .replace(/<table\b([^>]*)>/gi, (m, attrs) => {
      if (!isButtonClassToken(attrs)) return m;
      return `<table${forceAlignRight(attrs)}>`;
    });
  return html;
}

/**
 * Apply RTL transformation to HTML if locale is RTL. No-op otherwise.
 *
 * @param {string} html
 * @param {string} locale  e.g. "ar", "ar_KW", "ur", "he", "fa", "en_US"
 * @param {(s:string)=>string} [cleanText]  optional pre-clean function (e.g. server.js's cleanText)
 * @returns {string}
 */
export function applyLocaleDirectionToHtml(html, locale, cleanText) {
  const source = typeof cleanText === "function" ? cleanText(html) : String(html || "");
  if (!source || !isRtlLocale(locale)) return source;
  const core = loadRtlCore();
  if (core && typeof core.applyRtl === "function") {
    try {
      return core.applyRtl(source);
    } catch (err) {
      console.warn("[rtl] core apply failed:", err && err.message ? err.message : err);
    }
  }
  return rtlInlineFallback(source);
}

/**
 * Eagerly warm up the core module cache. Optional; the lazy path handles
 * cold starts gracefully but pre-warming avoids the first-request penalty.
 */
export function warmupRtl() {
  loadRtlCore();
}
