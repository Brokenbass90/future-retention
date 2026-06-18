#!/usr/bin/env node
/**
 * Extracts representative pug/jade snippets for every entry in
 * data/block-catalog.json from the first source file listed in `sources[]`,
 * and writes them to data/block-snippets.json keyed by catalog item id.
 *
 * Why: the catalog stores pointers (file, evidence, order) but not the actual
 * source code, which the workbench needs for its drag-and-drop shelf "From base".
 *
 * Run:
 *   node scripts/extract-block-snippets.mjs
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

const CATALOG_PATH = path.join(projectRoot, "data", "block-catalog.json");
const OUTPUT_PATH  = path.join(projectRoot, "data", "block-snippets.json");

function trimSnippet(text, { maxLines = 80 } = {}) {
  if (!text) return "";
  const lines = String(text).replace(/\r\n?/g, "\n").split("\n");
  // Drop trailing blanks
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  if (lines.length > maxLines) {
    return lines.slice(0, maxLines).join("\n") + "\n//- … (snippet truncated)";
  }
  return lines.join("\n");
}

async function readSafe(absPath) {
  try {
    return await fs.readFile(absPath, "utf8");
  } catch {
    return null;
  }
}

async function main() {
  const catRaw = await fs.readFile(CATALOG_PATH, "utf8");
  const catalog = JSON.parse(catRaw);
  const items = Array.isArray(catalog?.items) ? catalog.items : [];

  const out = { generatedAt: new Date().toISOString(), items: {} };

  for (const item of items) {
    const sources = Array.isArray(item.sources) ? item.sources : [];
    if (!sources.length) continue;

    // Prefer source where file path includes "/blocks/" (the actual block partial,
    // not e.g. an index.jade that includes everything).
    const preferred = sources.find((s) => /\/blocks\//.test(s.file)) || sources[0];
    const fileRel = preferred.file;
    if (!fileRel) continue;
    const fileAbs = path.join(projectRoot, fileRel);

    const raw = await readSafe(fileAbs);
    if (!raw) {
      console.warn(`[snippets] miss: ${item.id} (${fileRel})`);
      continue;
    }

    const pug = trimSnippet(raw);
    out.items[item.id] = {
      id: item.id,
      label: item.label,
      sectionKind: item.sectionKind,
      usageCount: item.usageCount || 0,
      sourceFile: fileRel,
      pug,
    };
  }

  await fs.writeFile(OUTPUT_PATH, JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log(`[snippets] wrote ${Object.keys(out.items).length} entries → ${path.relative(projectRoot, OUTPUT_PATH)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
