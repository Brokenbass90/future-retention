/**
 * src/compose-email.js — assemble a real email from canonical blocks.
 *
 * Inputs:
 *   - brand        — folder under email-base/ (e.g. "X_assembled")
 *   - mailName     — the mail folder name without "mail-" prefix
 *   - blocks       — ordered flat entries (legacy) or explicit tree entries:
 *                    [{ uid, blockId, parentUid, slotId, slots }]
 *   - skeleton     — which template mail to use as wrapper (default: "X_IQBroker/mail-welcome")
 *
 * What it does:
 *   1. Loads each block from data/block-library/canonical/<id>.json.
 *   2. Validates that every required slot is present (default value used if missing).
 *   3. Substitutes {{ slot_id }} tokens in each block's pug + styl with the
 *      user-provided values (or defaults). HTML-escapes string values inside
 *      attribute contexts.
 *   4. Concatenates all blocks' pug → one blocks/header.pug.
 *   5. Concatenates all blocks' styl → blocks/main.styl (block-scoped styles).
 *   6. Scaffolds the mail folder by copying the skeleton (vendor helpers,
 *      common.styl, index.pug, helpers/) and dropping in the composed pug+styl.
 *   7. Returns the destination path; caller (handler) decides whether to also
 *      run build-mail.js.
 *
 * Output is a `data/block-library/canonical`-grade mail that builds via the
 * existing tools/build-mail.js with no further tweaks.
 *
 * Used by:
 *   - src/ai-tools.js → compose_email_from_blocks handler (agent path)
 *   - scripts/test-compose.mjs → end-to-end smoke test
 *   - eventually: the drag-and-drop constructor "Save" button
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, readdirSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import url from "node:url";
import { buildStudioModelSourceSignatures } from "./studio-model-signatures.js";
import { assertPortableBlockSource } from "./block-library-review.js";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, "..");

const CANONICAL_DIR = path.join(REPO_ROOT, "data", "block-library", "canonical");
const USER_BLOCK_DIR = path.join(REPO_ROOT, "data", "block-library", "user");
const IMPORTED_DIR = path.join(REPO_ROOT, "data", "block-library", "imported");
const EMAIL_BASE = path.join(REPO_ROOT, "email-base");
const DEFAULT_SKELETON = path.join(EMAIL_BASE, "X_IQBroker", "mail-welcome");
const SAFE_PATH_SEGMENT_RE = /^[a-z0-9][a-z0-9_-]{0,127}$/i;
const SAFE_BLOCK_ID_RE = /^[a-z0-9][a-z0-9_-]{0,127}$/i;

function assertSafePathSegment(value, label) {
  const segment = String(value ?? "");
  if (!SAFE_PATH_SEGMENT_RE.test(segment) || segment === "." || segment === "..") {
    throw new Error(`invalid ${label}: "${segment}" (use 1-128 letters, digits, _ or -; start with a letter/digit)`);
  }
  return segment;
}

function pathIsWithin(root, candidate, { allowRoot = false } = {}) {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  return (allowRoot && resolvedCandidate === resolvedRoot)
    || resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`);
}

function assertContainedPath(root, candidate, label, options) {
  if (!pathIsWithin(root, candidate, options)) {
    throw new Error(`${label} escapes its allowed root`);
  }
  return path.resolve(candidate);
}

function resolveTrustedSkeleton(skeleton, trustedSkeletonRoots = []) {
  const resolved = path.resolve(String(skeleton || ""));
  if (!existsSync(resolved) || !statSync(resolved).isDirectory()) {
    throw new Error(`skeleton is not a readable directory: ${resolved}`);
  }
  const realSkeleton = realpathSync(resolved);
  const allowedRoots = [EMAIL_BASE, ...(Array.isArray(trustedSkeletonRoots) ? trustedSkeletonRoots : [])]
    .filter(Boolean)
    .map((root) => path.resolve(String(root)))
    .filter((root) => existsSync(root) && statSync(root).isDirectory())
    .map((root) => realpathSync(root));
  if (!allowedRoots.some((root) => pathIsWithin(root, realSkeleton, { allowRoot: true }))) {
    throw new Error("skeleton is outside email-base; an internal trustedSkeletonRoots override is required");
  }
  return realSkeleton;
}

/* ─── Slot substitution ─────────────────────────────────────────── */

function htmlEscapeAttr(s) {
  // For values that land inside HTML attribute='...' contexts in pug.
  return String(s ?? "")
    .replace(/'/g, "&#39;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function slotTokenPattern(id) {
  return new RegExp(`\\{\\{\\s*${String(id).replace(/[^a-z0-9_]/gi, "")}\\s*\\}\\}`, "i");
}

function slotUsedInPugStyle(pugSource, id) {
  const token = slotTokenPattern(id);
  return String(pugSource || "").split("\n").some((line) => {
    const styleAttrs = line.match(/\bstyle\s*=\s*(["'])(.*?)\1/gi) || [];
    return styleAttrs.some((attr) => token.test(attr));
  });
}

function slotUsedInStyl(stylSource, id) {
  return slotTokenPattern(id).test(String(stylSource || ""));
}

function failSlot(block, slot, message) {
  const error = new Error(`block ${block?.id || "unknown"}: slot "${slot?.id || "unknown"}" ${message}`);
  error.code = "UNSAFE_SLOT_VALUE";
  error.statusCode = 422;
  throw error;
}

function privateEmailAssetHostname(hostname) {
  const host = String(hostname || "").trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!host) return false;
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true;

  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const octets = ipv4.slice(1).map(Number);
    if (octets.some((part) => part > 255)) return true;
    const [a, b] = octets;
    return a === 0
      || a === 10
      || a === 127
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || (a === 100 && b >= 64 && b <= 127);
  }

  if (host.includes(":")) {
    return host === "::"
      || host === "::1"
      || host === "0:0:0:0:0:0:0:1"
      || /^f[cd][0-9a-f]*:/i.test(host)
      || /^fe[89ab][0-9a-f]*:/i.test(host)
      || host.startsWith("::ffff:");
  }
  return false;
}

/**
 * Returns a human-readable rejection reason for URLs that only work inside
 * the Studio/runtime network. Empty, placeholder and ordinary relative values
 * remain governed by their existing slot contracts.
 */
export function unsafeEmailAssetUrlReason(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^\/studio-assets(?:\/|$)/i.test(raw)) return "uses the local /studio-assets path";

  const candidate = raw.startsWith("//") ? `https:${raw}` : raw;
  let parsed;
  try { parsed = new URL(candidate); }
  catch { return ""; }
  if (/^\/studio-assets(?:\/|$)/i.test(parsed.pathname)) {
    return "uses the local /studio-assets path";
  }
  if (["http:", "https:"].includes(parsed.protocol) && privateEmailAssetHostname(parsed.hostname)) {
    return `uses a local/private host (${parsed.hostname})`;
  }
  return "";
}

function unsafeAssetError(label, reason) {
  const error = new Error(`${label} cannot use a non-public asset URL: ${reason}`);
  error.code = "UNSAFE_ASSET_URL";
  error.statusCode = 422;
  return error;
}

/** Reject hard-coded local/private asset URLs in the fully rendered source. */
export function assertEmailAssetSourcePublic(source, label = "composed email source") {
  const text = String(source || "");
  if (/\/studio-assets(?:\/|$|[?#])/i.test(text)) {
    throw unsafeAssetError(label, "uses the local /studio-assets path");
  }
  const urls = text.match(/(?:https?:)?\/\/(?:\[[^\]]+\]|[a-z0-9.-]+)(?::\d+)?(?:\/[^\s"'<>)]*)?/gi) || [];
  for (const assetUrl of urls) {
    const reason = unsafeEmailAssetUrlReason(assetUrl);
    if (reason) throw unsafeAssetError(label, reason);
  }
}

/**
 * Slot values are data, never Pug/Stylus source. Attribute values are escaped
 * later; this contract additionally prevents a value from creating a new line,
 * interpolation expression or CSS declaration in either language.
 */
function normalizeTypedSlotValue(block, slot, raw) {
  if (raw == null) return "";
  if (!["string", "number", "boolean"].includes(typeof raw)) {
    failSlot(block, slot, "must be a string, number or boolean");
  }
  const kind = String(slot?.kind || "text").toLowerCase();
  let value = String(raw);
  const inPugStyle = slotUsedInPugStyle(block?.pug, slot.id);
  const inStyl = slotUsedInStyl(block?.styl, slot.id);
  const cssContext = inPugStyle || inStyl;
  if (/\r|\n|\u0000|\u2028|\u2029/.test(value)) {
    failSlot(block, slot, "cannot contain line breaks or control separators");
  }
  if (/[#!]\{/.test(value)) {
    failSlot(block, slot, "cannot contain Pug interpolation (#{...}/!{...})");
  }
  if (/^\s*(?:!?=|-\s|\+[a-z]|&attributes\b|:\s*[a-z]|(?:if|unless|else|each|for|while|case|when|include|extends|mixin)\b)/i.test(value)) {
    failSlot(block, slot, "cannot begin with Pug syntax");
  }
  if (/\{\{\s*[A-Z][A-Z0-9_]*\s*\}\}/.test(value)) {
    failSlot(block, slot, "cannot create a constructor child-slot marker");
  }
  if (/\b(?:process|global|globalThis|require|module|exports|Function|eval)\s*(?:\.|\[|\()/i.test(value)) {
    failSlot(block, slot, "cannot contain JavaScript expressions");
  }
  if (/<\s*script\b|\bon[a-z]+\s*=|\b(?:javascript|vbscript)\s*:/i.test(value)) {
    failSlot(block, slot, "contains executable HTML/URL content");
  }

  if (kind === "number") {
    const number = Number(value);
    if (!Number.isFinite(number)) failSlot(block, slot, "must be a finite number");
    if (slot.min != null && number < Number(slot.min)) failSlot(block, slot, `must be at least ${slot.min}`);
    if (slot.max != null && number > Number(slot.max)) failSlot(block, slot, `must be at most ${slot.max}`);
    value = String(number);
  }
  if (kind === "select" && !cssContext && Array.isArray(slot.options) && slot.options.length) {
    const option = slot.options.find((candidate) => String(candidate) === value);
    if (option === undefined) failSlot(block, slot, `must be one of: ${slot.options.map(String).join(", ")}`);
    value = String(option);
  }
  if (["url", "image", "localizedurl"].includes(kind)
      && /^\s*(?:javascript|vbscript|data\s*:\s*text\/html)/i.test(value)) {
    failSlot(block, slot, "uses a forbidden URL scheme");
  }
  if (["url", "image", "localizedurl"].includes(kind)) {
    const unsafeAssetReason = unsafeEmailAssetUrlReason(value);
    if (unsafeAssetReason) {
      throw unsafeAssetError(`block ${block?.id || "unknown"}: slot "${slot?.id || "unknown"}"`, unsafeAssetReason);
    }
  }

  if (cssContext) {
    if (/[;{}\r\n]/.test(value)) failSlot(block, slot, "cannot terminate or add a CSS declaration");
    if (inStyl && /["']/.test(value)) {
      failSlot(block, slot, "cannot contain quotes when used in Stylus");
    }
    if (/^\s*@?(?:import|require|use)\b|\b(?:require|use|json|embedurl|image-size)\s*\(/i.test(value)) {
      failSlot(block, slot, "cannot inject Stylus imports or file-reading functions");
    }
  }
  return value;
}

function substituteSlotsInString(template, values, opts = {}) {
  const { attrEscape = false } = opts;
  return String(template || "").replace(/\{\{\s*([a-z][a-z0-9_]*)\s*\}\}/gi, (m, id) => {
    if (!(id in values)) return m; // keep token if unknown — caller will see it
    const v = values[id];
    if (v == null) return "";
    return attrEscape ? htmlEscapeAttr(v) : String(v);
  });
}

/**
 * Pug attribute values are wrapped in single quotes. We need every slot
 * substitution that lands inside `(...attr='value'...)` to be attr-escaped
 * (no stray quotes), while substitutions outside attributes can stay raw
 * (so a `richText` slot value like `<b>hi</b>` renders as inline HTML).
 *
 * We achieve this by walking pug line by line:
 *   - For lines containing `(...)` attribute syntax → escape inside the parens.
 *   - For lines that look like text content → raw substitution.
 *
 * This regex-based approach is good enough for v1 — our canonical blocks
 * never put HTML inside attributes (URLs, colors, sizes only there).
 */
function substituteSlotsInPug(pug, values) {
  return pug.split("\n").map((line) => {
    // Naive: if the line has a paren-attribute section, attr-escape inside;
    // outside the parens, raw-substitute.
    const m = line.match(/^(\s*[^\s(]+)\(([^)]*)\)(.*)$/);
    if (m) {
      const [, head, attrs, rest] = m;
      const attrsSub = substituteSlotsInString(attrs, values, { attrEscape: true });
      const restSub = substituteSlotsInString(rest, values, { attrEscape: false });
      return stripEmptyPugStyleDeclarations(`${head}(${attrsSub})${restSub}`);
    }
    return stripEmptyPugStyleDeclarations(substituteSlotsInString(line, values, { attrEscape: false }));
  }).join("\n");
}

/** Remove optional `property:` fragments after empty slot substitution. */
function stripEmptyPugStyleDeclarations(line) {
  return String(line || "").replace(/\bstyle\s*=\s*(["'])([\s\S]*?)\1/gi, (_all, quote, css) => {
    const declarations = String(css).split(";").filter((declaration) => {
      const colonAt = declaration.indexOf(":");
      return colonAt < 0 || declaration.slice(colonAt + 1).trim() !== "";
    });
    return `style=${quote}${declarations.join(";")}${quote}`;
  });
}

/* ─── Generic block appearance ──────────────────────────────────── */

const APPEARANCE_CSS = Object.freeze({
  background_color: "background-color",
  border: "border",
  radius: "border-radius",
  padding: "padding",
});

function safeAppearanceCssValue(raw) {
  const value = String(raw ?? "").trim().slice(0, 180);
  if (!value || /[;{}<>"'\r\n]/.test(value)) return "";
  // Email-safe style values used here are colors, dimensions and border
  // shorthands. Excluding punctuation that can terminate an attribute keeps
  // the fallback safe even when an API client bypasses the constructor UI.
  if (!/^[a-z0-9#().,%+\-\s/]+$/i.test(value)) return "";
  return value;
}

function pugSelectorMatch(line) {
  return String(line || "").match(/^(\s*(?:(?:[a-z][\w-]*)?(?:[.#][\w-]+)+|[a-z][\w-]*))/i);
}

function isRenderablePugLine(line) {
  const trimmed = String(line || "").trim();
  if (!trimmed || /^(?:\/\/|doctype\b|include\b|extends\b|block\b|mixin\b|if\b|unless\b|else\b|each\b|for\b|case\b|when\b|default\b|\+|\||-\s)/i.test(trimmed)) return false;
  return Boolean(pugSelectorMatch(line));
}

function addInlineStyleToPugLine(line, declarations) {
  const style = declarations.filter(Boolean).join(";");
  if (!style) return line;
  const selector = pugSelectorMatch(line);
  if (!selector) return line;
  const head = selector[1];
  const tail = line.slice(head.length);
  if (tail.startsWith("(")) {
    let quote = "";
    let depth = 0;
    let closeAt = -1;
    for (let i = 0; i < tail.length; i += 1) {
      const char = tail[i];
      if (quote) {
        if (char === quote && tail[i - 1] !== "\\") quote = "";
        continue;
      }
      if (char === "\"" || char === "'") { quote = char; continue; }
      if (char === "(") depth += 1;
      else if (char === ")" && --depth === 0) { closeAt = i; break; }
    }
    if (closeAt >= 0) {
      let attrs = tail.slice(1, closeAt);
      const styleRe = /\bstyle\s*=\s*(["'])([\s\S]*?)\1/i;
      if (styleRe.test(attrs)) {
        attrs = attrs.replace(styleRe, (_all, q, current) => {
          const prefix = String(current || "").trim().replace(/;+$/, "");
          return `style=${q}${prefix ? `${prefix};` : ""}${style}${q}`;
        });
      } else {
        attrs += `${attrs.trim() ? " " : ""}style="${style}"`;
      }
      return `${head}(${attrs})${tail.slice(closeAt + 1)}`;
    }
  }
  return `${head}(style="${style}")${tail}`;
}

/**
 * Apply inspector-wide appearance overrides without rewriting a block's
 * canonical Pug. Surface styles go on the first rendered node; padding goes
 * on its first td when available because padding on an email table itself is
 * inconsistently supported by Outlook. Invalid values are ignored.
 */
export function applyBlockAppearanceToPug(pug, appearance = {}) {
  const clean = Object.create(null);
  for (const key of Object.keys(APPEARANCE_CSS)) {
    const value = safeAppearanceCssValue(appearance?.[key]);
    if (value) clean[key] = value;
  }
  if (!Object.keys(clean).length) return String(pug || "");

  const lines = String(pug || "").split("\n");
  const rootIndex = lines.findIndex(isRenderablePugLine);
  if (rootIndex < 0) return lines.join("\n");
  const tdOffset = lines.slice(rootIndex).findIndex((line) => /^\s*td(?=[.#(\s]|$)/i.test(line));
  const paddingIndex = tdOffset >= 0 ? rootIndex + tdOffset : rootIndex;
  const byLine = new Map();
  const add = (index, declaration) => byLine.set(index, [...(byLine.get(index) || []), declaration]);
  for (const key of ["background_color", "border", "radius"]) {
    if (clean[key]) add(rootIndex, `${APPEARANCE_CSS[key]}:${clean[key]}`);
  }
  if (clean.padding) add(paddingIndex, `${APPEARANCE_CSS.padding}:${clean.padding}`);
  for (const [index, declarations] of byLine) {
    lines[index] = addInlineStyleToPugLine(lines[index], declarations);
  }
  return lines.join("\n");
}

function mergePugStyleAttribute(line, declaration) {
  const source = String(line || "");
  const openAt = source.indexOf("(");
  if (openAt < 0) {
    const token = source.match(/^(\s*[^\s]+)/)?.[1];
    if (!token) return source;
    return `${token}(style="${declaration}")${source.slice(token.length)}`;
  }
  let quote = "";
  let depth = 0;
  let closeAt = -1;
  for (let i = openAt; i < source.length; i += 1) {
    const char = source[i];
    if (quote) {
      if (char === quote && source[i - 1] !== "\\") quote = "";
      continue;
    }
    if (char === "\"" || char === "'") { quote = char; continue; }
    if (char === "(") depth += 1;
    else if (char === ")" && --depth === 0) { closeAt = i; break; }
  }
  if (closeAt < 0) return source;
  let attrs = source.slice(openAt + 1, closeAt);
  const styleRe = /\bstyle\s*=\s*(["'])([\s\S]*?)\1/i;
  if (styleRe.test(attrs)) {
    attrs = attrs.replace(styleRe, (_all, q, current) => {
      const prefix = String(current || "").trim().replace(/;+$/, "");
      return `style=${q}${prefix ? `${prefix};` : ""}${declaration}${q}`;
    });
  } else {
    attrs += `${attrs.trim() ? " " : ""}style="${declaration}"`;
  }
  return `${source.slice(0, openAt + 1)}${attrs}${source.slice(closeAt)}`;
}

/** Apply the constructor outer-wrapper color to the real scaffold shell. */
export function applyOuterWrapperBackgroundToPug(pug, rawColor) {
  const color = safeAppearanceCssValue(rawColor);
  if (!color) return String(pug || "");
  const declaration = `background-color:${color}`;
  return String(pug || "").split("\n").map((line) => {
    const trimmed = line.trim();
    if (/^body\.body(?:\(|\s|$)/.test(trimmed)) return mergePugStyleAttribute(line, declaration);
    if (/^table\.body(?:\(|\s|$)/.test(trimmed)) return mergePugStyleAttribute(line, declaration);
    if (/^td(?:\([^)]*\))?(?:\.[\w-]+)*\.bg-col(?:\.|\(|\s|$)/.test(trimmed)) {
      return mergePugStyleAttribute(line, declaration);
    }
    return line;
  }).join("\n");
}

/* ─── Ручной слой стилей письма ─────────────────────────────────── */

/** Заголовок файла: объясняет правила игры тому, кто откроет его в workbench. */
const CUSTOM_STYL_HEADER = [
  "// custom.styl — ручные стили ЭТОГО письма.",
  "//",
  "// Конструктор сюда не пишет и этот файл не перезаписывает: всё, что здесь,",
  "// переживает пересохранение письма из конструктора.",
  "//",
  "// Каскад: фреймворк (ink/vendor) → стили блоков (blocks/main.styl) →",
  "// ЭТОТ ФАЙЛ → inline-стили в разметке блоков.",
  "// То есть отсюда можно переопределить дефолты любого блока, но inline-стиль,",
  "// заданный слотом в конструкторе, останется сильнее.",
  "",
].join("\n");

/**
 * Создаёт `app/styles/custom.styl` и гарантирует, что он импортируется
 * ПОСЛЕДНИМ в common.styl. Обе операции идемпотентны и никогда не затирают
 * существующее содержимое.
 *
 * Файл лежит вне `blocks/`, потому что common.styl подтягивает `blocks/**\/*`
 * глобом в алфавитном порядке — там custom.styl оказался бы ПЕРЕД main.styl
 * и проиграл бы ему в каскаде.
 */
/** Путь ручного слоя стилей письма. */
export function customStylePath(destDir) {
  return path.join(destDir, "app", "styles", "custom.styl");
}

/** Содержимое custom.styl до пересборки письма (null, если файла не было). */
function readPreservedCustomStyl(destDir) {
  const file = customStylePath(destDir);
  if (!existsSync(file)) return null;
  try { return readFileSync(file, "utf8"); } catch { return null; }
}

/** Вернуть ручной слой на место после раскладки скелета. */
function restorePreservedCustomStyl(destDir, content) {
  if (content == null) return;
  const file = customStylePath(destDir);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content, "utf8");
}

export function ensureCustomStyleLayer(destDir) {
  const stylesDir = path.join(destDir, "app", "styles");
  const customPath = path.join(stylesDir, "custom.styl");
  mkdirSync(stylesDir, { recursive: true });
  if (!existsSync(customPath)) writeFileSync(customPath, CUSTOM_STYL_HEADER, "utf8");

  // Точка входа сборки: inline.styl, если есть, иначе common.styl (build-mail.js).
  const entryPath = existsSync(path.join(stylesDir, "inline.styl"))
    ? path.join(stylesDir, "inline.styl")
    : path.join(stylesDir, "common.styl");
  if (!existsSync(entryPath)) return { customPath, entryPath: null, imported: false };

  const entry = readFileSync(entryPath, "utf8");
  if (/^\s*@import\s+['"]custom['"]\s*$/m.test(entry)) {
    return { customPath, entryPath, imported: false };
  }
  const updated = entry.replace(/\s*$/, "")
    + "\n\n// Ручные стили письма — всегда последними, чтобы бить дефолты блоков.\n"
    + "@import 'custom'\n";
  writeFileSync(entryPath, updated, "utf8");
  return { customPath, entryPath, imported: true };
}

/* ─── Block loading + validation ────────────────────────────────── */

export function loadCanonicalBlock(id) {
  return loadBlockRecord(id).block;
}

function loadBlockRecord(id) {
  const safeId = String(id || "");
  if (!SAFE_BLOCK_ID_RE.test(safeId)) throw new Error(`invalid block id: ${safeId}`);
  // Directory provenance is the trust boundary; a manually edited user JSON
  // cannot promote itself merely by claiming source:"canonical".
  for (const [dir, origin] of [
    [CANONICAL_DIR, "canonical"],
    [USER_BLOCK_DIR, "user"],
    [IMPORTED_DIR, "imported"],
  ]) {
    const candidate = assertContainedPath(dir, path.resolve(dir, `${safeId}.json`), "block path");
    if (existsSync(candidate)) {
      const block = JSON.parse(readFileSync(candidate, "utf8"));
      return { block: { ...block, source: origin }, origin };
    }
  }
  throw new Error(`block not found: ${id}`);
}

function _readBlocksFromDir(dir, sourceTag) {
  if (!existsSync(dir)) return [];
  if (dir === IMPORTED_DIR) {
    const indexPath = path.join(dir, "index.json");
    if (existsSync(indexPath)) {
      try {
        const index = JSON.parse(readFileSync(indexPath, "utf8"));
        const ids = Array.isArray(index.blocks) ? index.blocks.map((b) => b && b.id).filter(Boolean) : [];
        if (ids.length) {
          return ids.map((id) => {
            try {
              const b = JSON.parse(readFileSync(path.join(dir, `${id}.json`), "utf8"));
              if (b.validated === false) return null;
              return { ...b, source: sourceTag };
            } catch { return null; }
          }).filter(Boolean);
        }
      } catch { /* fall through to directory scan */ }
    }
  }
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json") && f !== "index.json" && !f.startsWith("_"))
    .map((f) => {
      try {
        const b = JSON.parse(readFileSync(path.join(dir, f), "utf8"));
        if (b.validated === false) return null; // skip blocks that failed build validation
        return { ...b, source: sourceTag };
      } catch { return null; }
    })
    .filter(Boolean);
}

export function listCanonicalBlocks() {
  // Returns canonical first, user-saved second. Same shape.
  const canonical = _readBlocksFromDir(CANONICAL_DIR, "canonical");
  const imported  = _readBlocksFromDir(IMPORTED_DIR, "imported");
  const user      = _readBlocksFromDir(USER_BLOCK_DIR, "user");
  return [...canonical, ...imported, ...user];
}

export function userBlockPath(id) {
  const safeId = String(id || "");
  if (!SAFE_BLOCK_ID_RE.test(safeId)) throw new Error("invalid user block id");
  return assertContainedPath(USER_BLOCK_DIR, path.resolve(USER_BLOCK_DIR, `${safeId}.json`), "user block path");
}
export function userBlockDir() { return USER_BLOCK_DIR; }

/**
 * Merge block.slots[] defaults with user-supplied values.
 * Throws if a required slot is missing AND has no default.
 */
export function resolveBlockSlotValues(block, userSlots = {}) {
  if (!userSlots || typeof userSlots !== "object" || Array.isArray(userSlots)) {
    throw new Error(`block ${block?.id || "unknown"}: slots must be an object`);
  }
  const out = Object.create(null);
  for (const slot of block.slots || []) {
    if (!slot || !SAFE_BLOCK_ID_RE.test(String(slot.id || ""))) {
      throw new Error(`block ${block?.id || "unknown"}: invalid slot definition`);
    }
    if (Object.prototype.hasOwnProperty.call(userSlots, slot.id)) {
      out[slot.id] = normalizeTypedSlotValue(block, slot, userSlots[slot.id]);
    } else if ("default" in slot) {
      out[slot.id] = normalizeTypedSlotValue(block, slot, slot.default);
    } else {
      throw new Error(`block ${block.id}: required slot "${slot.id}" missing and no default`);
    }
  }
  return out;
}

/* ─── Constructor tree helpers ─────────────────────────────────────── */

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

function isUid(value) {
  return (typeof value === "string" && value.length > 0)
    || (typeof value === "number" && Number.isFinite(value));
}

function uidKey(value) {
  return `${typeof value}:${String(value)}`;
}

function previewMarkerUid(entry, fallbackIndex) {
  const raw = isUid(entry?.uid) ? String(entry.uid) : String(fallbackIndex);
  // Constructor UIDs are normally integers/UUIDs. Keep those readable; encode
  // unusual characters so an arbitrary UID cannot break a Pug comment line.
  return /^[a-z0-9_.-]+$/i.test(raw)
    ? raw
    : encodeURIComponent(raw).replace(/%/g, "~");
}

function markerMatcher(marker, legacyInnerBlocks = false) {
  if (legacyInnerBlocks) return /\{\{\s*INNER_BLOCKS\s*\}\}/;
  const text = String(marker || "");
  const token = text.match(/^\{\{\s*([a-z][a-z0-9_]*)\s*\}\}$/i);
  if (token) return new RegExp(`\\{\\{\\s*${token[1]}\\s*\\}\\}`, "i");
  return text;
}

/**
 * A block can declare several named insertion points. Existing canonical
 * sections predate childSlots, so `{{ INNER_BLOCKS }}` remains a single
 * implicit slot until their definitions are migrated.
 */
function blockChildSlots(block, pug) {
  const declared = Array.isArray(block?.childSlots)
    ? block.childSlots.filter((slot) => slot && slot.id != null)
    : [];
  if (declared.length) {
    return declared.map((slot) => ({
      id: String(slot.id),
      marker: typeof slot.marker === "string" && slot.marker
        ? slot.marker
        : `{{ ${String(slot.id)} }}`,
      matcher: markerMatcher(
        typeof slot.marker === "string" && slot.marker
          ? slot.marker
          : `{{ ${String(slot.id)} }}`,
      ),
      accepts: Array.isArray(slot.accepts)
        ? slot.accepts.map((p) => String(p).toLowerCase())
        : [],
      legacyInnerBlocks: false,
    }));
  }
  if (/\{\{\s*INNER_BLOCKS\s*\}\}/.test(String(pug || ""))) {
    return [{
      id: "inner",
      marker: "{{ INNER_BLOCKS }}",
      matcher: markerMatcher("{{ INNER_BLOCKS }}", true),
      accepts: ["inner", "inline", "both", "helper"],
      legacyInnerBlocks: true,
    }];
  }
  return [];
}

function childSlotAccepts(slot, placement) {
  const p = String(placement || "").toLowerCase();
  if (!slot.accepts.length) return ["inner", "inline", "both", "helper"].includes(p);
  if (slot.accepts.includes(p)) return true;
  // Imported legacy blocks call the same semantic level `inline`.
  if (p === "inline" && slot.accepts.includes("inner")) return true;
  if (p === "inner" && slot.accepts.includes("inline")) return true;
  return false;
}

function childMarkerLineIndexes(lines, slot) {
  const indexes = [];
  for (let i = 0; i < lines.length; i++) {
    const matcher = slot.matcher;
    const matches = matcher instanceof RegExp
      ? matcher.test(lines[i])
      : lines[i].includes(matcher);
    if (matches) indexes.push(i);
  }
  return indexes;
}

function reindentPug(text, pad) {
  return String(text || "").split("\n")
    .map((line) => (line.trim() === "" ? "" : pad + line))
    .join("\n");
}

/** Replace a marker line rather than only its token (usually `//- {{ ... }}`). */
function fillChildMarker(pug, slot, renderedChildren) {
  const lines = String(pug || "").split("\n");
  const indexes = childMarkerLineIndexes(lines, slot);
  if (!indexes.length) return { found: false, pug: lines.join("\n") };
  const first = indexes[0];
  const pad = (lines[first].match(/^[ \t]*/) || [""])[0];
  const replacement = renderedChildren.length
    ? reindentPug(renderedChildren.join("\n"), pad)
    : "";
  lines.splice(first, 1, replacement);
  // A child-slot marker is singular. Remove accidental duplicates so no
  // constructor token leaks into the saved source.
  for (let i = indexes.length - 1; i >= 1; i--) lines.splice(indexes[i], 1);
  return { found: true, pug: lines.join("\n") };
}

function selectChildSlot(slots, entry) {
  const requested = entry?.slotId;
  if (requested !== undefined && requested !== null && String(requested) !== "") {
    return slots.find((slot) => slot.id === String(requested)) || null;
  }
  return slots.length === 1 ? slots[0] : null;
}

/**
 * Keep the round-trip file JSON-only even for ad-hoc entries. Dangerous object
 * keys, functions and cycles are discarded; normal `def` data is preserved.
 */
function studioJsonValue(value, seen = new WeakSet(), depth = 0) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "bigint") return String(value);
  if (typeof value !== "object" || depth > 40) return undefined;
  if (seen.has(value)) return undefined;
  seen.add(value);
  if (Array.isArray(value)) {
    const out = value.map((item) => {
      const safe = studioJsonValue(item, seen, depth + 1);
      return safe === undefined ? null : safe;
    });
    seen.delete(value);
    return out;
  }
  const out = Object.create(null);
  for (const key of Object.keys(value)) {
    if (key === "__proto__" || key === "prototype" || key === "constructor") continue;
    const safe = studioJsonValue(value[key], seen, depth + 1);
    if (safe !== undefined) out[key] = safe;
  }
  seen.delete(value);
  return out;
}

/* ─── Scaffold helpers ──────────────────────────────────────────── */

function copyTreeSkippingDist(src, dst) {
  if (!existsSync(dst)) mkdirSync(dst, { recursive: true });
  for (const e of readdirSync(src, { withFileTypes: true })) {
    if (e.name === "dist") continue;
    const sp = path.join(src, e.name);
    const dp = path.join(dst, e.name);
    if (e.isDirectory()) copyTreeSkippingDist(sp, dp);
    else if (e.isFile()) {
      try {
        const data = readFileSync(sp);
        writeFileSync(dp, data);
      } catch { /* ignore unreadable files */ }
    }
  }
}

/* ─── Main API ──────────────────────────────────────────────────── */

/**
 * Resolve and validate the source destination without writing anything.
 * Callers that need to guard the destructive compose step (for example with
 * `withComposeSaveTransaction`) can use this exact path calculation instead
 * of duplicating the compose path-safety rules.
 */
export function resolveComposeEmailTarget({
  brand = "X_assembled",
  mailName,
  destRoot = EMAIL_BASE,
} = {}) {
  const safeBrand = assertSafePathSegment(brand, "brand");
  const safeMailName = assertSafePathSegment(mailName, "mailName");
  const resolvedDestRoot = path.resolve(String(destRoot || ""));
  const destDir = assertContainedPath(
    resolvedDestRoot,
    path.resolve(resolvedDestRoot, safeBrand, `mail-${safeMailName}`),
    "compose destination",
  );
  return Object.freeze({
    brand: safeBrand,
    mailName: safeMailName,
    destRoot: resolvedDestRoot,
    destDir,
  });
}

/**
 * @param {object} args
 * @param {string} args.brand        — destination brand folder ("X_assembled" default)
 * @param {string} args.mailName     — without "mail-" prefix
 * @param {Array}  args.blocks       — [{ id: string, slots: {...} }]
 * @param {string} [args.skeleton]   — abs path to a template mail to use as wrapper
 * @param {string} [args.destRoot]   — override destination root (default email-base)
 * @param {boolean} [args.validateOnly] — render and validate in memory without filesystem writes
 * @returns {{ destDir, brand, mailName, totalBlocks, blocksUsed, warnings }}
 */
export function composeEmailFromBlocks({
  brand = "X_assembled",
  mailName,
  blocks,
  skeleton = DEFAULT_SKELETON,
  destRoot = EMAIL_BASE,
  trustedSkeletonRoots = [],
  markBlocks = false,
  preserveSkeletonPreheader = false,
  validateOnly = false,
}) {
  const target = resolveComposeEmailTarget({ brand, mailName, destRoot });
  const safeBrand = target.brand;
  const safeMailName = target.mailName;
  const destDir = target.destDir;
  const resolvedSkeleton = resolveTrustedSkeleton(skeleton, trustedSkeletonRoots);
  if (destDir === resolvedSkeleton) {
    throw new Error("skeleton and destination are the same directory; stage a trusted snapshot before composing");
  }
  if (!Array.isArray(blocks) || !blocks.length) {
    throw new Error(`blocks must be a non-empty array`);
  }

  // 1) Load + validate all referenced blocks first; fail fast.
  const resolved = [];
  const warnings = [];
  for (let inputIndex = 0; inputIndex < blocks.length; inputIndex++) {
    const entry = blocks[inputIndex];
    const blockId = entry && String(entry.blockId || entry.id || "");
    if (!entry || !blockId) {
      warnings.push(`skipped block with no id: ${JSON.stringify(entry).slice(0, 60)}`);
      continue;
    }
    if (!SAFE_BLOCK_ID_RE.test(blockId)) {
      throw new Error(`invalid block id: ${blockId}`);
    }
    let block;
    let origin;
    if (entry.def && typeof entry.def === "object" && typeof entry.def.pug === "string" && entry.def.pug.trim()) {
      // Ad-hoc (unsaved) block definition — used by the constructor's block
      // authoring preview. Same shape as a library block JSON.
      block = {
        id: blockId,
        label: entry.def.label || blockId,
        placement: entry.def.placement || "section",
        pug: entry.def.pug,
        styl: entry.def.styl || "",
        slots: Array.isArray(entry.def.slots) ? entry.def.slots : [],
        childSlots: Array.isArray(entry.def.childSlots) ? entry.def.childSlots : [],
        appearance: entry.def.appearance && typeof entry.def.appearance === "object" ? entry.def.appearance : {},
      };
      origin = "ad-hoc";
    } else {
      try {
        const record = loadBlockRecord(blockId);
        block = record.block;
        origin = record.origin;
      }
      catch (err) {
        warnings.push(`block "${blockId}" not found in canonical library — skipped`);
        continue;
      }
    }
    if (origin !== "canonical") {
      assertPortableBlockSource(block, { label: `${origin} block "${blockId}"` });
    }
    const slotValues = resolveBlockSlotValues(block, entry.slots || {});
    resolved.push({ entry, block, origin, slotValues, inputIndex });
  }
  if (!resolved.length) throw new Error(`no resolvable blocks (warnings: ${warnings.join("; ")})`);

  // 2) Concatenate pug + styl with slot substitution.
  //    `//-` markers are unbuffered (stripped from HTML) — for source tooling.
  //    When markBlocks is on (preview path only), we ALSO emit buffered `//`
  //    comments that survive into the rendered HTML as <!-- rk:block... -->,
  //    so the constructor can map DOM ranges → canvas blocks for drop zones
  //    and click-to-select. Saved emails never get these markers.
  // Outer blocks are structural context: the selected skeleton owns the actual
  // email frame. Only nodes truly emitted into header.pug count as used.
  const explicitTree = blocks.some((entry) => entry && hasOwn(entry, "parentUid"));
  const emitted = [];
  const emittedSet = new Set();
  const recordEmitted = (item) => {
    if (emittedSet.has(item.inputIndex)) return;
    emittedSet.add(item.inputIndex);
    emitted.push(item);
  };
  const describeEntry = (item) => isUid(item.entry?.uid)
    ? `"${item.block.id}" (uid ${String(item.entry.uid)})`
    : `"${item.block.id}"`;
  const wrapMarkers = (item, innerPug) => {
    const { block, entry, inputIndex } = item;
    const sourceStart = `//- block-start: ${block.id}`;
    const sourceEnd = `//- block-end: ${block.id}`;
    if (!markBlocks) return `${sourceStart}\n${innerPug.trimEnd()}\n${sourceEnd}`;
    const markerUid = previewMarkerUid(entry, inputIndex);
    const domStart = `// rk:block-start:${markerUid}:${block.id}`;
    const domEnd = `// rk:block-end:${markerUid}:${block.id}`;
    return `${sourceStart}\n${domStart}\n${innerPug.trimEnd()}\n${domEnd}\n${sourceEnd}`;
  };

  /** Render a node and place only compatible direct children into real markers. */
  const renderItem = (item, directChildren, renderChild, skipChild) => {
    recordEmitted(item);
    let pug = substituteSlotsInPug(item.block.pug || "", item.slotValues).trimEnd();
    pug = applyBlockAppearanceToPug(pug, {
      ...(item.block.appearance && typeof item.block.appearance === "object" ? item.block.appearance : {}),
      ...(item.entry?.appearance && typeof item.entry.appearance === "object" ? item.entry.appearance : {}),
    });
    const childSlots = blockChildSlots(item.block, pug);
    const groups = new Map(childSlots.map((slot) => [slot.id, []]));

    for (const child of directChildren) {
      const slot = selectChildSlot(childSlots, child.entry);
      if (!slot) {
        const requested = child.entry?.slotId;
        const reason = !childSlots.length
          ? `parent ${describeEntry(item)} has no child slot`
          : requested !== undefined && requested !== null && String(requested) !== ""
            ? `parent ${describeEntry(item)} has no child slot "${String(requested)}"`
            : `parent ${describeEntry(item)} has several child slots; slotId is required`;
        warnings.push(`${describeEntry(child)} skipped: ${reason}`);
        skipChild(child);
        continue;
      }
      if (!childSlotAccepts(slot, child.block.placement)) {
        warnings.push(`${describeEntry(child)} skipped: slot "${slot.id}" of ${describeEntry(item)} does not accept placement "${child.block.placement}"`);
        skipChild(child);
        continue;
      }
      groups.get(slot.id).push(child);
    }

    for (const slot of childSlots) {
      const assigned = groups.get(slot.id) || [];
      const markerExists = childMarkerLineIndexes(pug.split("\n"), slot).length > 0;
      if (!markerExists) {
        for (const child of assigned) {
          warnings.push(`${describeEntry(child)} skipped: marker for child slot "${slot.id}" is missing in ${describeEntry(item)}`);
          skipChild(child);
        }
        continue;
      }
      const renderedChildren = assigned.map(renderChild).filter(Boolean);
      pug = fillChildMarker(pug, slot, renderedChildren).pug;
    }
    return wrapMarkers(item, pug);
  };

  let flow = [];

  if (explicitTree) {
    // New constructor model: parentUid is authoritative. Array adjacency never
    // changes parentage; it only controls sibling order.
    const byUid = new Map();
    const treeItems = [];
    const childrenByParent = new Map();
    const invalidReasons = new Map();
    const skipped = new Set();
    const handled = new Set();
    const visiting = new Set();

    for (const item of resolved) {
      if (!hasOwn(item.entry, "parentUid")) {
        invalidReasons.set(item, `${describeEntry(item)} skipped: parentUid is missing in explicit tree mode`);
        continue;
      }
      if (!isUid(item.entry.uid)) {
        invalidReasons.set(item, `${describeEntry(item)} skipped: explicit tree entry needs a string/number uid`);
        continue;
      }
      const key = uidKey(item.entry.uid);
      if (byUid.has(key)) {
        invalidReasons.set(item, `${describeEntry(item)} skipped: duplicate uid ${String(item.entry.uid)}`);
        continue;
      }
      byUid.set(key, item);
      treeItems.push(item);
      childrenByParent.set(item, []);
    }

    for (const item of treeItems) {
      const parentUid = item.entry.parentUid;
      if (parentUid === null) continue;
      if (!isUid(parentUid)) {
        invalidReasons.set(item, `${describeEntry(item)} skipped: parentUid must be null, string or number`);
        continue;
      }
      if (item.block.placement === "outer") {
        invalidReasons.set(item, `${describeEntry(item)} skipped: outer must be a root/context node`);
        continue;
      }
      const parent = byUid.get(uidKey(parentUid));
      if (!parent) {
        invalidReasons.set(item, `${describeEntry(item)} orphan skipped: parentUid ${String(parentUid)} was not found`);
        continue;
      }
      childrenByParent.get(parent).push(item);
    }

    const skipSubtree = (item, reason = "") => {
      if (!item || skipped.has(item) || handled.has(item)) return;
      skipped.add(item);
      if (reason) warnings.push(reason);
      for (const child of childrenByParent.get(item) || []) skipSubtree(child);
    };
    for (const [item, reason] of invalidReasons) skipSubtree(item, reason);

    const renderTreeNode = (item) => {
      if (!item || skipped.has(item) || handled.has(item)) return "";
      if (visiting.has(item)) {
        skipSubtree(item, `${describeEntry(item)} skipped: parent cycle detected`);
        return "";
      }
      visiting.add(item);
      handled.add(item);
      const rendered = renderItem(
        item,
        childrenByParent.get(item) || [],
        renderTreeNode,
        (child) => skipSubtree(child),
      );
      visiting.delete(item);
      return rendered;
    };

    const renderRoot = (item) => {
      if (skipped.has(item) || handled.has(item)) return [];
      if (item.block.placement === "outer") {
        handled.add(item); // context only; deliberately not recordEmitted()
        const units = [];
        const outerSlots = blockChildSlots(item.block, item.block.pug || "");
        for (const child of childrenByParent.get(item) || []) {
          const slot = outerSlots.length ? selectChildSlot(outerSlots, child.entry) : null;
          if (outerSlots.length && !slot) {
            skipSubtree(child, `${describeEntry(child)} skipped: outer ${describeEntry(item)} has no matching child slot`);
            continue;
          }
          if (slot && !childSlotAccepts(slot, child.block.placement)) {
            skipSubtree(child, `${describeEntry(child)} skipped: outer slot "${slot.id}" does not accept placement "${child.block.placement}"`);
            continue;
          }
          if (!slot && child.block.placement !== "section") {
            skipSubtree(child, `${describeEntry(child)} skipped: outer accepts section children, not "${child.block.placement}"`);
            continue;
          }
          const rendered = renderTreeNode(child);
          if (rendered) units.push(rendered);
        }
        return units;
      }
      if (["section", "both", "helper"].includes(item.block.placement)) {
        const rendered = renderTreeNode(item);
        return rendered ? [rendered] : [];
      }
      skipSubtree(item, `${describeEntry(item)} skipped: root content must be section/top-level helper`);
      return [];
    };

    for (const item of treeItems) {
      if (item.entry.parentUid === null) flow.push(...renderRoot(item));
    }
    // Existing-parent cycles and descendants of an unreachable root have not
    // been handled by traversal. Reject them explicitly instead of guessing.
    for (const item of treeItems) {
      if (!handled.has(item) && !skipped.has(item)) {
        skipSubtree(item, `${describeEntry(item)} skipped: node is unreachable or part of a parent cycle`);
      }
    }
  } else {
    // Legacy model: preserve the historic flat sequence interpretation. The
    // only intentional tightening is that an inner is never appended after a
    // section lacking an actual child marker.
    const contentItems = resolved.filter(({ block }) => block.placement !== "outer");
    let openSection = null;
    const renderLegacyLeaf = (item) => renderItem(item, [], renderLegacyLeaf, () => {});
    const flushSection = () => {
      if (!openSection) return;
      flow.push(renderItem(openSection.item, openSection.children, renderLegacyLeaf, () => {}));
      openSection = null;
    };
    contentItems.forEach((item, i) => {
      const placement = item.block.placement;
      if (placement === "section") {
        flushSection();
        openSection = { item, children: [] };
      } else if (placement === "inner" || placement === "inline") {
        if (openSection) openSection.children.push(item);
        else warnings.push(`inner-block ${describeEntry(item)} without section skipped`);
      } else if (placement === "both" || placement === "helper") {
        const next = contentItems[i + 1];
        const nextIsSection = next?.block?.placement === "section";
        if (openSection && !nextIsSection) openSection.children.push(item);
        else {
          flushSection();
          flow.push(renderLegacyLeaf(item));
        }
      } else {
        warnings.push(`block ${describeEntry(item)} with unknown placement "${placement}" skipped`);
      }
    });
    flushSection();
  }

  if (!emitted.length) {
    throw new Error(`no renderable content blocks (warnings: ${warnings.join("; ")})`);
  }
  const composedPug = flow.join("\n");

  const stylParts = emitted.map(({ block, slotValues }) => {
    const sub = substituteSlotsInString(block.styl || "", slotValues, { attrEscape: false });
    return `/* ${block.id} */\n${sub.trim()}\n`;
  });
  const composedStyl = stylParts.join("\n");

  // Final in-memory gate before the first destructive filesystem operation.
  // Slot validation catches constructor/API values; this second pass also
  // catches a hard-coded URL in canonical, imported or ad-hoc Pug/Stylus.
  // Keep it above readPreservedCustomStyl/rmSync/copyTreeSkippingDist so an
  // invalid API or AI compose request cannot touch an existing destination.
  assertEmailAssetSourcePublic(composedPug, "composed Pug");
  assertEmailAssetSourcePublic(composedStyl, "composed Stylus");
  if (validateOnly) {
    return {
      destDir,
      brand: safeBrand,
      mailName: safeMailName,
      totalBlocks: blocks.length,
      blocksUsed: emitted.length,
      warnings,
      validated: true,
    };
  }

  // 3) Scaffold the destination mail folder.
  //    Папка сносится и раскладывается из скелета заново, поэтому ручной слой
  //    стилей письма надо спасти ДО сноса и вернуть ПОСЛЕ — иначе обещание
  //    «custom.styl переживает пересохранение из конструктора» держаться не
  //    будет ни секунды.
  const preservedCustomStyl = readPreservedCustomStyl(destDir);
  if (existsSync(destDir)) {
    try { rmSync(destDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  copyTreeSkippingDist(resolvedSkeleton, destDir);
  restorePreservedCustomStyl(destDir, preservedCustomStyl);

  // The outer block is a constructor context node and is not emitted into
  // blocks/header.pug. Its one meaningful visual setting belongs on the real
  // scaffold shell instead, otherwise the inspector appears to accept a color
  // that never reaches either preview or saved HTML.
  const outerContext = resolved.find((item) => (
    item.block.placement === "outer"
    && (!explicitTree || item.entry.parentUid === null)
  ));

  // A new constructor mail must not inherit the campaign namespace of the
  // default IQ Broker skeleton. Reopened/parsed mail round-trips opt out via
  // preserveSkeletonPreheader so their authored source stays byte-for-byte in
  // control; fresh canonical composition receives a neutral, valid preheader.
  const outerHasPreheaderSlot = Boolean(
    outerContext?.entry?.slots
    && Object.prototype.hasOwnProperty.call(outerContext.entry.slots, "preheader")
  );
  const explicitOuterPreheader = Boolean(
    outerHasPreheaderSlot
    && (
      (Array.isArray(outerContext.entry.explicitSlots) && outerContext.entry.explicitSlots.includes("preheader"))
      // Backward compatibility for constructor models saved before explicitSlots:
      // a non-empty authored value was necessarily deliberate. The ambiguous
      // synthesized empty default is inherited unless the new marker is set.
      || String(outerContext.entry.slots.preheader ?? "").trim()
    )
  );
  if (!preserveSkeletonPreheader || explicitOuterPreheader) {
    let preheaderText = String(outerContext?.slotValues?.preheader ?? "").trim();
    if (/\$\{\{\s*[a-z0-9_.-]+\s*\}\}\$/i.test(preheaderText)) {
      warnings.push("outer preheader campaign placeholder was removed from a reusable constructor mail");
      preheaderText = "";
    }
    const hiddenFill = "\u00a0".repeat(120);
    const preheaderPug = `div.preheader= ${JSON.stringify(`${preheaderText}${preheaderText ? " " : ""}${hiddenFill}`)}\n`;
    const helperDir = path.join(destDir, "app", "templates", "helpers");
    mkdirSync(helperDir, { recursive: true });
    writeFileSync(path.join(helperDir, "preheader.pug"), preheaderPug, "utf8");
    writeFileSync(path.join(helperDir, "preheader.jade"), preheaderPug, "utf8");
  }

  const outerBackground = outerContext?.entry?.appearance?.background_color
    ?? outerContext?.block?.appearance?.background_color
    ?? outerContext?.slotValues?.background_color;
  if (outerBackground != null && String(outerBackground).trim()) {
    for (const extension of ["pug", "jade"]) {
      const indexPath = path.join(destDir, "app", "templates", `index.${extension}`);
      if (!existsSync(indexPath)) continue;
      const indexSource = readFileSync(indexPath, "utf8");
      writeFileSync(indexPath, applyOuterWrapperBackgroundToPug(indexSource, outerBackground), "utf8");
    }
  }

  // 4) Drop the composed pug into blocks/header.pug + styl into blocks/main.styl.
  const headerPug = path.join(destDir, "app", "templates", "blocks", "header.pug");
  mkdirSync(path.dirname(headerPug), { recursive: true });
  writeFileSync(headerPug, composedPug, "utf8");
  // Remove any leftover .jade variant so Pug uses ours.
  const headerJade = path.join(destDir, "app", "templates", "blocks", "header.jade");
  if (existsSync(headerJade)) { try { rmSync(headerJade, { force: true }); } catch {} }

  // Футер — отдельный блок. Гасим футер, вшитый в скелет (index.jade делает include helpers/footer).
  const footerPug = path.join(destDir, "app", "templates", "helpers", "footer.pug");
  const footerJade = path.join(destDir, "app", "templates", "helpers", "footer.jade");
  try { mkdirSync(path.dirname(footerPug), { recursive: true }); } catch {}
  try { if (existsSync(footerJade)) rmSync(footerJade, { force: true }); } catch {}
  try { writeFileSync(footerPug, "//- footer removed — use a footer block\n", "utf8"); } catch {}

  const mainStyl = path.join(destDir, "app", "styles", "blocks", "main.styl");
  mkdirSync(path.dirname(mainStyl), { recursive: true });
  // Скелет (copyTreeSkippingDist выше) принёс родной blocks/main.styl семьи —
  // с pt/pb-хелперами, h-*, center, m-w и мобильными media. Раньше мы его
  // затирали и композиции теряли отступы/адаптив. Теперь стили блоков
  // ДОПОЛНЯЮТ скелетные: при конфликте классов последние (блочные) побеждают.
  let skeletonStyl = "";
  try { if (existsSync(mainStyl)) skeletonStyl = readFileSync(mainStyl, "utf8"); } catch { /* ignore */ }
  const mergedStyl = skeletonStyl.trim()
    ? skeletonStyl.replace(/\s+$/, "") + "\n\n/* ── RetKit constructor blocks ── */\n" + composedStyl
    : composedStyl;
  writeFileSync(mainStyl, mergedStyl, "utf8");

  // Слой ручных стилей письма. main.styl принадлежит конструктору и
  // перезаписывается на каждое сохранение — всё, что там правили руками,
  // терялось. custom.styl конструктор создаёт один раз и больше НИКОГДА
  // не трогает; в каскаде он идёт последним и бьёт и скелет, и блоки
  // (слабее только inline-стили самих блоков).
  ensureCustomStyleLayer(destDir);

  // Durable constructor source of truth. Pug/Styl are compilation products;
  // this JSON lets the studio reopen the exact tree (including recipe IDs and
  // ad-hoc defs) without reverse-parsing generated source.
  const studioModelPath = path.join(destDir, "studio-model.json");
  const studioModel = {
    schemaVersion: 1,
    entries: studioJsonValue(blocks) || [],
    sourceSignatures: buildStudioModelSourceSignatures(destDir),
  };
  const studioJson = JSON.stringify(studioModel, null, 2)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
  writeFileSync(studioModelPath, studioJson + "\n", "utf8");

  return {
    destDir,
    brand: safeBrand,
    mailName: safeMailName,
    totalBlocks: blocks.length,
    blocksUsed: emitted.length,
    warnings,
    headerPugPath: headerPug,
    mainStylPath: mainStyl,
    studioModelPath,
  };
}
