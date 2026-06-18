/**
 * src/blocks-by-mail.js — index of "block files per mail".
 *
 * Walks email-base for X_<category>/mail-<id>/app/templates/blocks .jade files, and produces a
 * flat catalog of importable pieces:
 *
 *   {
 *     category: "X_AffSystem",
 *     mailId:   "QCM-Offer",
 *     blockFile:"header.jade",
 *     name:     "header",
 *     lines:    42,
 *     placeholders: ["aff-QCM-Offer.block_00", ...],   // used inside the block
 *     assetCount: 3,                                   // img(src=...) / url(...)
 *     preview:  "first ~6 jade lines of the block",
 *   }
 *
 * Powers the "tear code from another mail" palette (P1.2 in ROADMAP):
 * pick a mail, see its blocks, insert one into the current draft.
 *
 * Caching: 60s TTL, cheap to recompute (~200ms on 142-mail base).
 */

import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const PLACEHOLDER_RE = /\$\{\{\s*([\w-]+)\.([\w-]+)\s*\}\}\$/g;
const IMG_SRC_RE = /\bsrc\s*=\s*(["'])([^"']+)\1/g;
const URL_FUNC_RE = /\burl\(\s*['"]?([^)'"]+)['"]?\s*\)/g;

let _cache = null;
let _cacheAt = 0;
const TTL_MS = 60_000;

async function listMailDirs(emailBaseRoot) {
  const out = [];
  let categories = [];
  try {
    categories = (await readdir(emailBaseRoot, { withFileTypes: true }))
      .filter(
        (e) =>
          e.isDirectory() &&
          e.name.startsWith("X_") &&
          !e.name.startsWith("X_legacy") &&
          !e.name.startsWith("X_trash")
      )
      .map((e) => ({ name: e.name, abs: path.join(emailBaseRoot, e.name) }));
  } catch {
    return out;
  }
  for (const cat of categories) {
    let mails = [];
    try {
      mails = (await readdir(cat.abs, { withFileTypes: true }))
        .filter((e) => e.isDirectory() && e.name.startsWith("mail-"))
        .map((e) => ({
          category: cat.name,
          mailId: e.name.replace(/^mail-/, ""),
          abs: path.join(cat.abs, e.name),
        }));
    } catch { /* skip */ }
    out.push(...mails);
  }
  return out;
}

async function listBlockFiles(mailAbs) {
  const blocksDir = path.join(mailAbs, "app", "templates", "blocks");
  let entries;
  try {
    entries = await readdir(blocksDir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isFile() && /\.(jade|pug)$/i.test(e.name))
    .map((e) => path.join(blocksDir, e.name));
}

function extractBlockMeta(text) {
  const placeholders = new Set();
  PLACEHOLDER_RE.lastIndex = 0;
  let m;
  while ((m = PLACEHOLDER_RE.exec(text)) !== null) {
    placeholders.add(`${m[1]}.${m[2]}`);
  }

  let assetCount = 0;
  IMG_SRC_RE.lastIndex = 0;
  while (IMG_SRC_RE.exec(text) !== null) assetCount += 1;
  URL_FUNC_RE.lastIndex = 0;
  while (URL_FUNC_RE.exec(text) !== null) assetCount += 1;

  const lines = text.split("\n");
  const previewLines = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("//")) continue;
    previewLines.push(line);
    if (previewLines.length >= 6) break;
  }
  return {
    placeholders: Array.from(placeholders).sort(),
    assetCount,
    lines: lines.length,
    preview: previewLines.join("\n"),
  };
}

export async function buildBlocksByMail({
  emailBaseRoot,
  force = false,
} = {}) {
  if (!force && _cache && Date.now() - _cacheAt < TTL_MS) return _cache;
  const root = emailBaseRoot || path.join(process.cwd(), "email-base");
  const mails = await listMailDirs(root);
  const items = [];
  for (const m of mails) {
    const files = await listBlockFiles(m.abs);
    for (const f of files) {
      let text = "";
      try { text = await readFile(f, "utf8"); } catch { continue; }
      const meta = extractBlockMeta(text);
      items.push({
        category: m.category,
        mailId: m.mailId,
        blockFile: path.basename(f),
        name: path.basename(f).replace(/\.(jade|pug)$/i, ""),
        lines: meta.lines,
        placeholders: meta.placeholders,
        assetCount: meta.assetCount,
        preview: meta.preview,
      });
    }
  }
  items.sort(
    (a, b) =>
      a.category.localeCompare(b.category) ||
      a.mailId.localeCompare(b.mailId) ||
      a.blockFile.localeCompare(b.blockFile)
  );
  // Group by mail for convenience.
  const byMail = new Map();
  for (const it of items) {
    const key = `${it.category}/${it.mailId}`;
    if (!byMail.has(key)) byMail.set(key, { category: it.category, mailId: it.mailId, blocks: [] });
    byMail.get(key).blocks.push(it);
  }
  _cache = {
    generatedAt: new Date().toISOString(),
    mailsScanned: mails.length,
    totalBlocks: items.length,
    items,
    byMail: Array.from(byMail.values()),
  };
  _cacheAt = Date.now();
  return _cache;
}

/**
 * Read a specific block source by category/mailId/blockFile.
 * Returns { text, absPath } or null if not found.
 */
export async function readBlockSource({ category, mailId, blockFile, emailBaseRoot } = {}) {
  if (!category || !mailId || !blockFile) return null;
  // Guard: refuse traversal.
  if (
    category.includes("..") ||
    mailId.includes("..") ||
    blockFile.includes("..") ||
    blockFile.includes("/") ||
    blockFile.includes("\\")
  ) return null;
  if (!/^X_/.test(category)) return null;
  if (!/\.(jade|pug)$/i.test(blockFile)) return null;

  const root = emailBaseRoot || path.join(process.cwd(), "email-base");
  const abs = path.join(root, category, `mail-${mailId}`, "app", "templates", "blocks", blockFile);
  try {
    const s = await stat(abs);
    if (!s.isFile()) return null;
    const text = await readFile(abs, "utf8");
    return { text, absPath: abs };
  } catch {
    return null;
  }
}

export function invalidateBlocksByMailCache() {
  _cache = null;
  _cacheAt = 0;
}
