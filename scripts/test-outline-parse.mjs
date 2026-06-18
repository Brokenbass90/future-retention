#!/usr/bin/env node
/**
 * scripts/test-outline-parse.mjs
 *
 * Validates public/outline-parse.js against:
 *  1. Hand-crafted fixtures (marker mode + heuristic mode + edge cases)
 *  2. Real email-base pug files (heuristic mode against existing mails)
 *
 * Run:  node scripts/test-outline-parse.mjs
 * Exits 0 on success, 1 on any assertion failure.
 */

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import url from "node:url";
import vm from "node:vm";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, "..");

// Load the browser-side parser by evaluating it in a VM context that
// exposes a fake `window`. We then pull OutlineParse off `window`.
const sandbox = { window: {}, module: { exports: null } };
vm.createContext(sandbox);
const parserSrc = readFileSync(
  path.join(REPO_ROOT, "public", "outline-parse.js"),
  "utf8"
);
vm.runInContext(parserSrc, sandbox);
const { parseSourcePugBlocks, placementForInsertAfter } =
  sandbox.window.OutlineParse || sandbox.module.exports || {};
if (typeof parseSourcePugBlocks !== "function") {
  console.error("[fatal] Failed to load OutlineParse from outline-parse.js");
  process.exit(2);
}

const C = { reset: "\x1b[0m", red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m", dim: "\x1b[2m" };
const ok = (s) => `${C.green}${s}${C.reset}`;
const bad = (s) => `${C.red}${s}${C.reset}`;
const dim = (s) => `${C.dim}${s}${C.reset}`;
const section = (s) => console.log("\n" + dim("━━━ ") + s + dim(" ━━━"));

let failed = 0;
const assert = (cond, label) => {
  if (cond) console.log("  " + ok("✓") + " " + label);
  else { console.log("  " + bad("✗") + " " + label); failed++; }
};

// ─── Fixture 1: empty / whitespace ──────────────────────────────────────
section("Empty / whitespace");
assert(parseSourcePugBlocks("").length === 0, "empty string → []");
assert(parseSourcePugBlocks("   \n\n   ").length === 0, "whitespace → []");
assert(parseSourcePugBlocks(null).length === 0, "null → []");
assert(parseSourcePugBlocks(undefined).length === 0, "undefined → []");

// ─── Fixture 2: marker mode (composed mail) ─────────────────────────────
section("Marker mode (composed-mail)");
const composedPug = [
  "//- block-start: header-logo",
  "table.row.white-bg",
  "  tr",
  "    td.wrapper",
  "      img(src='logo.png')",
  "//- block-end: header-logo",
  "",
  "//- block-start: hero-stack",
  "table.row.brad-full",
  "  tr",
  "    td.text-pad",
  "      p.title Hello",
  "//- block-end: hero-stack",
  "",
  "//- block-start: cta-banner",
  "table.row",
  "  tr",
  "    td.butt",
  "      a.butt-link(href='#') Click",
  "//- block-end: cta-banner",
].join("\n");

const composed = parseSourcePugBlocks(composedPug);
assert(composed.length === 3, "found 3 blocks");
assert(composed[0].id === "header-logo", "block #1 id = header-logo");
assert(composed[1].id === "hero-stack", "block #2 id = hero-stack");
assert(composed[2].id === "cta-banner", "block #3 id = cta-banner");
assert(composed.every((b) => b.kind === "marker"), "all kind === 'marker'");
assert(composed[0].startLine === 0 && composed[0].endLine === 5, "block #1 range 0..5");
assert(composed[1].startLine === 7 && composed[1].endLine === 12, "block #2 range 7..12");
assert(composed.every((b) => b.endLine > b.startLine), "endLine > startLine for all");

// ─── Fixture 3: heuristic mode (legacy mail) ────────────────────────────
section("Heuristic mode (legacy mail)");
const legacyPug = [
  "extends ../../layout",
  "",
  "block content",
  "  table.row.white-bg",
  "    tr",
  "      td",
  "        p Hello",
  "",
  "table.row.brad-full.bg-img-bottom",
  "  tr",
  "    td.wrapper",
  "      p.title World",
  "      p Description here",
  "",
  "table.row",
  "  tr",
  "    td.butt",
  "      a.butt-link(href='#') CTA",
].join("\n");

const legacy = parseSourcePugBlocks(legacyPug);
console.log(dim("  parsed blocks:"));
legacy.forEach((b, i) => console.log(dim(`    #${i + 1} L${b.startLine}-${b.endLine}: ${b.label}`)));
assert(legacy.length === 2, "found 2 top-level blocks (indented one inside `block content` is ignored)");
assert(legacy[0].kind === "heuristic", "kind === 'heuristic'");
assert(legacy[0].label.includes("brad-full"), "label captures class chain");
assert(legacy[1].label.includes("row"), "second block labeled as plain row");

// ─── Fixture 4: marker mode wins when both present ──────────────────────
section("Marker mode takes precedence over heuristic");
const hybridPug = [
  "//- block-start: only-one",
  "table.row.bg-img",
  "  tr",
  "    td",
  "      p Hi",
  "//- block-end: only-one",
].join("\n");
const hybrid = parseSourcePugBlocks(hybridPug);
assert(hybrid.length === 1, "1 block via markers");
assert(hybrid[0].kind === "marker", "kind === 'marker' (not heuristic)");
assert(hybrid[0].id === "only-one", "id preserved");

// ─── Fixture 5: placementForInsertAfter ─────────────────────────────────
section("placementForInsertAfter");
const blocks = [
  { startLine: 0, endLine: 5 },
  { startLine: 7, endLine: 12 },
  { startLine: 14, endLine: 19 },
];
assert(placementForInsertAfter(blocks, -1).line === 0, "before all → line 0");
assert(placementForInsertAfter(blocks, 0).line === 6, "after block #1 → endLine+1 = 6");
assert(placementForInsertAfter(blocks, 1).line === 13, "after block #2 → 13");
assert(placementForInsertAfter(blocks, 2).line === 20, "after block #3 → 20");
assert(placementForInsertAfter(blocks, 5).line === 20, "out-of-range clamped to last block");
assert(placementForInsertAfter([], 0).line === 0, "empty blocks → line 0");

// ─── Fixture 6: walk real email-base files ──────────────────────────────
section("Real email-base files (legacy heuristic mode)");
const emailBase = path.join(REPO_ROOT, "email-base");
let scanned = 0;
let withBlocks = 0;
if (existsSync(emailBase)) {
  const brands = readdirSync(emailBase).filter((d) =>
    statSync(path.join(emailBase, d)).isDirectory()
  );
  for (const brand of brands.slice(0, 5)) {
    const brandDir = path.join(emailBase, brand);
    const mails = readdirSync(brandDir).filter((m) => m.startsWith("mail-"));
    for (const mail of mails.slice(0, 4)) {
      const pugFile = path.join(brandDir, mail, "app", "templates", "blocks", "header.pug");
      const jadeFile = path.join(brandDir, mail, "app", "templates", "blocks", "header.jade");
      const file = existsSync(pugFile) ? pugFile : (existsSync(jadeFile) ? jadeFile : null);
      if (!file) continue;
      try {
        const text = readFileSync(file, "utf8");
        const result = parseSourcePugBlocks(text);
        scanned++;
        if (result.length > 0) withBlocks++;
        console.log(dim(`  ${brand}/${mail}: `) + result.length + dim(" block(s) (" + (result[0]?.kind || "n/a") + ")"));
      } catch { /* unreadable, skip */ }
    }
  }
}
console.log(dim(`  scanned ${scanned} mail header files, ${withBlocks} produced ≥ 1 block`));
assert(scanned > 0, "at least one real mail file was scanned");
assert(withBlocks >= scanned * 0.5, `≥ 50% of scanned mails produce a non-empty outline (got ${withBlocks}/${scanned})`);

// ─── Verdict ────────────────────────────────────────────────────────────
section("Verdict");
if (failed === 0) {
  console.log(ok("\n✓ All assertions passed. Parser is solid.\n"));
  process.exit(0);
} else {
  console.log(bad("\n✗ " + failed + " assertion(s) failed.\n"));
  process.exit(1);
}
