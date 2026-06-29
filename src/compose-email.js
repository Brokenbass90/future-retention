/**
 * src/compose-email.js — assemble a real email from canonical blocks.
 *
 * Inputs:
 *   - brand        — folder under email-base/ (e.g. "X_assembled")
 *   - mailName     — the mail folder name without "mail-" prefix
 *   - blocks       — ordered [{ id, slots: { slot_id: value } }]
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

import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import url from "node:url";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, "..");

const CANONICAL_DIR = path.join(REPO_ROOT, "data", "block-library", "canonical");
const USER_BLOCK_DIR = path.join(REPO_ROOT, "data", "block-library", "user");
const IMPORTED_DIR = path.join(REPO_ROOT, "data", "block-library", "imported");
const EMAIL_BASE = path.join(REPO_ROOT, "email-base");
const DEFAULT_SKELETON = path.join(EMAIL_BASE, "X_IQBroker", "mail-welcome");

/* ─── Slot substitution ─────────────────────────────────────────── */

function htmlEscapeAttr(s) {
  // For values that land inside HTML attribute='...' contexts in pug.
  return String(s ?? "")
    .replace(/'/g, "&#39;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
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
      return `${head}(${attrsSub})${restSub}`;
    }
    return substituteSlotsInString(line, values, { attrEscape: false });
  }).join("\n");
}

/* ─── Block loading + validation ────────────────────────────────── */

export function loadCanonicalBlock(id) {
  // Try canonical first, then user-saved blocks.
  const tryCanonical = path.join(CANONICAL_DIR, `${id}.json`);
  if (existsSync(tryCanonical)) return JSON.parse(readFileSync(tryCanonical, "utf8"));
  const tryUser = path.join(USER_BLOCK_DIR, `${id}.json`);
  if (existsSync(tryUser)) return JSON.parse(readFileSync(tryUser, "utf8"));
  const tryImported = path.join(IMPORTED_DIR, `${id}.json`);
  if (existsSync(tryImported)) return JSON.parse(readFileSync(tryImported, "utf8"));
  throw new Error(`block not found: ${id}`);
}

function _readBlocksFromDir(dir, sourceTag) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json") && f !== "index.json" && !f.startsWith("_"))
    .map((f) => {
      try {
        const b = JSON.parse(readFileSync(path.join(dir, f), "utf8"));
        if (b.validated === false) return null; // skip blocks that failed build validation
        return { ...b, source: b.source || sourceTag };
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

// Path resolver used by the server when it needs to write or delete a user
// block on disk. NOT a security boundary — callers must validate the id.
export function userBlockPath(id) {
  return path.join(USER_BLOCK_DIR, `${id}.json`);
}
export function userBlockDir() { return USER_BLOCK_DIR; }

/**
 * Merge block.slots[] defaults with user-supplied values.
 * Throws if a required slot is missing AND has no default.
 */
export function resolveBlockSlotValues(block, userSlots = {}) {
  const out = {};
  for (const slot of block.slots || []) {
    if (slot.id in userSlots) {
      out[slot.id] = userSlots[slot.id];
    } else if ("default" in slot) {
      out[slot.id] = slot.default;
    } else {
      throw new Error(`block ${block.id}: required slot "${slot.id}" missing and no default`);
    }
  }
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
 * @param {object} args
 * @param {string} args.brand        — destination brand folder ("X_assembled" default)
 * @param {string} args.mailName     — without "mail-" prefix
 * @param {Array}  args.blocks       — [{ id: string, slots: {...} }]
 * @param {string} [args.skeleton]   — abs path to a template mail to use as wrapper
 * @param {string} [args.destRoot]   — override destination root (default email-base)
 * @returns {{ destDir, brand, mailName, totalBlocks, blocksUsed, warnings }}
 */
export function composeEmailFromBlocks({
  brand = "X_assembled",
  mailName,
  blocks,
  skeleton = DEFAULT_SKELETON,
  destRoot = EMAIL_BASE,
  markBlocks = false,
}) {
  if (!mailName || !/^[a-z0-9_-]+$/i.test(mailName)) {
    throw new Error(`invalid mailName: "${mailName}" (use letters, digits, _ -)`);
  }
  if (!Array.isArray(blocks) || !blocks.length) {
    throw new Error(`blocks must be a non-empty array`);
  }

  // 1) Load + validate all referenced blocks first; fail fast.
  const resolved = [];
  const warnings = [];
  for (const entry of blocks) {
    if (!entry || !entry.id) {
      warnings.push(`skipped block with no id: ${JSON.stringify(entry).slice(0, 60)}`);
      continue;
    }
    let block;
    if (entry.def && typeof entry.def === "object" && typeof entry.def.pug === "string" && entry.def.pug.trim()) {
      // Ad-hoc (unsaved) block definition — used by the constructor's block
      // authoring preview. Same shape as a library block JSON.
      block = {
        id: entry.id,
        label: entry.def.label || entry.id,
        placement: entry.def.placement || "section",
        pug: entry.def.pug,
        styl: entry.def.styl || "",
        slots: Array.isArray(entry.def.slots) ? entry.def.slots : [],
      };
    } else {
      try { block = loadCanonicalBlock(entry.id); }
      catch (err) {
        warnings.push(`block "${entry.id}" not found in canonical library — skipped`);
        continue;
      }
    }
    const slotValues = resolveBlockSlotValues(block, entry.slots || {});
    resolved.push({ block, slotValues });
  }
  if (!resolved.length) throw new Error(`no resolvable blocks (warnings: ${warnings.join("; ")})`);

  // 2) Concatenate pug + styl with slot substitution.
  //    `//-` markers are unbuffered (stripped from HTML) — for source tooling.
  //    When markBlocks is on (preview path only), we ALSO emit buffered `//`
  //    comments that survive into the rendered HTML as <!-- rk:block... -->,
  //    so the constructor can map DOM ranges → canvas blocks for drop zones
  //    and click-to-select. Saved emails never get these markers.
  const pugParts = resolved.map(({ block, slotValues }, i) => {
    const sub = substituteSlotsInPug(block.pug || "", slotValues);
    const srcMarkStart = `//- block-start: ${block.id}`;
    const srcMarkEnd = `//- block-end: ${block.id}`;
    if (!markBlocks) {
      return `${srcMarkStart}\n${sub.trimEnd()}\n${srcMarkEnd}\n`;
    }
    const domStart = `// rk:block-start:${i}:${block.id}`;
    const domEnd = `// rk:block-end:${i}:${block.id}`;
    return `${srcMarkStart}\n${domStart}\n${sub.trimEnd()}\n${domEnd}\n${srcMarkEnd}\n`;
  });
  const composedPug = pugParts.join("\n");

  const stylParts = resolved.map(({ block, slotValues }) => {
    const sub = substituteSlotsInString(block.styl || "", slotValues, { attrEscape: false });
    return `/* ${block.id} */\n${sub.trim()}\n`;
  });
  const composedStyl = stylParts.join("\n");

  // 3) Scaffold the destination mail folder.
  const destDir = path.join(destRoot, brand, `mail-${mailName}`);
  if (existsSync(destDir)) {
    try { rmSync(destDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  copyTreeSkippingDist(skeleton, destDir);

  // 4) Drop the composed pug into blocks/header.pug + styl into blocks/main.styl.
  const headerPug = path.join(destDir, "app", "templates", "blocks", "header.pug");
  mkdirSync(path.dirname(headerPug), { recursive: true });
  writeFileSync(headerPug, composedPug, "utf8");
  // Remove any leftover .jade variant so Pug uses ours.
  const headerJade = path.join(destDir, "app", "templates", "blocks", "header.jade");
  if (existsSync(headerJade)) { try { rmSync(headerJade, { force: true }); } catch {} }

  const mainStyl = path.join(destDir, "app", "styles", "blocks", "main.styl");
  mkdirSync(path.dirname(mainStyl), { recursive: true });
  writeFileSync(mainStyl, composedStyl, "utf8");

  return {
    destDir,
    brand,
    mailName,
    totalBlocks: blocks.length,
    blocksUsed: resolved.length,
    warnings,
    headerPugPath: headerPug,
    mainStylPath: mainStyl,
  };
}
