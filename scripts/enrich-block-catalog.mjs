#!/usr/bin/env node
/**
 * scripts/enrich-block-catalog.mjs — augment data/block-catalog.json with
 * per-block metadata extracted from the source jade files referenced in
 * each block's `sources[]`.
 *
 * Adds to each item:
 *   placeholders[]  — distinct ${{ ns.block_XX }}$ tokens found in any source
 *   assets[]        — distinct image paths referenced (img(src=...), CSS url(…))
 *   classes[]       — distinct CSS-like classes used (a.foo.bar → ["foo","bar"])
 *   helperRefs[]    — top-level mixin include / extend references
 *
 * Non-destructive: existing keys are preserved. Run idempotently.
 *
 * Usage:
 *   node scripts/enrich-block-catalog.mjs           # writes back in place
 *   node scripts/enrich-block-catalog.mjs --dry     # prints diff summary
 */

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const CATALOG_PATH = path.join(ROOT, "data", "block-catalog.json");
const DRY_RUN = process.argv.includes("--dry");

if (!fs.existsSync(CATALOG_PATH)) {
  console.error(`[enrich] not found: ${CATALOG_PATH}`);
  process.exit(1);
}

const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, "utf8"));

const PLACEHOLDER_RE = /\$\{\{\s*([\w-]+)\.([\w-]+)\s*\}\}\$/g;
// img(src="..."), src="..." in attrs lists, and url(...) inside styl/css.
const IMG_SRC_RE = /\bsrc\s*=\s*(["'])([^"']+)\1/g;
const URL_FUNC_RE = /\burl\(\s*['"]?([^)'"]+)['"]?\s*\)/g;
// Pug class shorthand: tag.classA.classB or .classA.classB
const PUG_CLASS_RE = /(?:^|[\s(])(?:[a-zA-Z][\w-]*)?((?:\.[a-zA-Z][\w-]*)+)/g;
const MIXIN_INCLUDE_RE = /^\s*(?:include|extends|\+[a-zA-Z][\w-]*)\s+([\S]+)/gm;

function unique(arr) {
  return Array.from(new Set(arr)).sort();
}

function extractFromSource(absFile) {
  if (!fs.existsSync(absFile)) {
    return { placeholders: [], assets: [], classes: [], helperRefs: [] };
  }
  const text = fs.readFileSync(absFile, "utf8");
  const placeholders = [];
  let m;
  PLACEHOLDER_RE.lastIndex = 0;
  while ((m = PLACEHOLDER_RE.exec(text)) !== null) {
    placeholders.push(`${m[1]}.${m[2]}`);
  }

  const assets = [];
  IMG_SRC_RE.lastIndex = 0;
  while ((m = IMG_SRC_RE.exec(text)) !== null) assets.push(m[2]);
  URL_FUNC_RE.lastIndex = 0;
  while ((m = URL_FUNC_RE.exec(text)) !== null) assets.push(m[1]);

  const classes = [];
  PUG_CLASS_RE.lastIndex = 0;
  while ((m = PUG_CLASS_RE.exec(text)) !== null) {
    for (const c of m[1].split(".")) {
      if (c) classes.push(c);
    }
  }

  const helperRefs = [];
  MIXIN_INCLUDE_RE.lastIndex = 0;
  while ((m = MIXIN_INCLUDE_RE.exec(text)) !== null) helperRefs.push(m[1]);

  return {
    placeholders: unique(placeholders),
    assets: unique(assets),
    classes: unique(classes),
    helperRefs: unique(helperRefs),
  };
}

let enrichedCount = 0;
let skippedCount = 0;
const sourcesScanned = new Set();

for (const item of catalog.items || []) {
  const acc = { placeholders: [], assets: [], classes: [], helperRefs: [] };
  for (const src of item.sources || []) {
    const abs = path.join(ROOT, src.file);
    sourcesScanned.add(abs);
    const e = extractFromSource(abs);
    acc.placeholders.push(...e.placeholders);
    acc.assets.push(...e.assets);
    acc.classes.push(...e.classes);
    acc.helperRefs.push(...e.helperRefs);
  }
  const next = {
    placeholders: unique(acc.placeholders),
    assets: unique(acc.assets),
    classes: unique(acc.classes),
    helperRefs: unique(acc.helperRefs),
  };
  // Skip writing empty arrays to keep diff small.
  let touched = false;
  for (const k of Object.keys(next)) {
    if (next[k].length > 0 && JSON.stringify(item[k] || []) !== JSON.stringify(next[k])) {
      item[k] = next[k];
      touched = true;
    }
  }
  if (touched) enrichedCount += 1;
  else skippedCount += 1;
}

catalog.enrichedAt = new Date().toISOString();
catalog.enrichedSchema = "v1.placeholders+assets+classes+helperRefs";

if (DRY_RUN) {
  console.log("[enrich] DRY RUN — not writing");
  console.log(`  items enriched : ${enrichedCount}`);
  console.log(`  items unchanged: ${skippedCount}`);
  console.log(`  sources scanned: ${sourcesScanned.size}`);
  console.log("\n  sample enriched item:");
  const first = (catalog.items || []).find((it) => it.placeholders?.length);
  if (first) {
    const { sources, ...trimmed } = first;
    console.log(JSON.stringify({ ...trimmed, _sourcesCount: sources?.length || 0 }, null, 2));
  } else {
    console.log("  (no enriched items found)");
  }
  process.exit(0);
}

fs.writeFileSync(CATALOG_PATH, JSON.stringify(catalog, null, 2));
console.log(`[enrich] wrote ${CATALOG_PATH}`);
console.log(`  items enriched : ${enrichedCount}`);
console.log(`  items unchanged: ${skippedCount}`);
console.log(`  sources scanned: ${sourcesScanned.size}`);
