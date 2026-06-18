#!/usr/bin/env node
/**
 * scripts/demo-placeholderize.mjs
 *
 * Take an HTML file and a reference TXT, run the smart placeholderize
 * (parent-chain context + two-pass validator), and print a colored
 * report. Use this to demo to stakeholders that the AI actually does
 * useful work, end-to-end.
 *
 * Usage:
 *   node scripts/demo-placeholderize.mjs --html path/to/email.html \
 *                                        --ref  path/to/en.txt \
 *                                        --ns   welcome-broker \
 *                                        [--out path/to/output.html] \
 *                                        [--json]
 *
 * Requires OPENAI_API_KEY in the environment (or in .env at repo root).
 *
 * The script prints, in order:
 *   1. Summary headline: "AI anchored N/M placeholders" + second-pass usage.
 *   2. Confidence / similarity stats.
 *   3. Per-decision table: one row per refBlock with its anchor element,
 *      source (primary / second-pass / skipped), and how sure the AI was.
 *   4. List of unmapped refBlocks with their text (if any) so a human can
 *      decide whether to fix the HTML or the TXT.
 *
 * If --out is given, the rewritten HTML (with `${{ ns.block_NN }}$`
 * placeholders) is saved there. Otherwise it's just summarized.
 *
 * If --json is given, prints the full report JSON instead of a colored
 * table — useful for piping into other tools.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import url from "node:url";
import { placeholderizeHtml } from "../src/locale-ai.js";
import { analyzeLocaleAgainstHtml, formatAnalysisReport } from "../src/locale-analyze.js";

// ─── Minimal arg parser ──────────────────────────────────────────────────
function parseArgs(argv) {
  const out = { json: false, analyzeOnly: false, auto: false };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--json") { out.json = true; continue; }
    if (a === "--auto") { out.auto = true; continue; }
    if (a === "--analyze") { out.analyzeOnly = true; continue; }
    if (a === "--html") { out.html = argv[++i]; continue; }
    if (a === "--ref")  { out.ref  = argv[++i]; continue; }
    if (a === "--ns")   { out.ns   = argv[++i]; continue; }
    if (a === "--out")  { out.out  = argv[++i]; continue; }
    if (a === "--model"){ out.model = argv[++i]; continue; }
    if (a === "--help" || a === "-h") { out.help = true; continue; }
    console.error(`Unknown argument: ${a}`);
    out.help = true;
  }
  return out;
}

function usage() {
  console.log(`Usage:
  node scripts/demo-placeholderize.mjs --html <path> --ref <path> --ns <namespace> [--out <path>] [--json] [--model gpt-4.1-mini]

  # auto-discover mode: find latest HTML + matching ref TXT in the workspace
  node scripts/demo-placeholderize.mjs --auto

  # smart analysis only (NO AI calls) — diagnose coverage / drift instantly
  node scripts/demo-placeholderize.mjs --analyze --html <path> --ref <path>

Required (when not --auto):
  --html       HTML file to placeholderize
  --ref        Reference TXT file (source-of-truth blocks wrapped in {{...}})
  --ns         Namespace for placeholders, e.g. welcome-broker

Optional:
  --analyze    Run structural analysis only — no AI call, no token spend
  --out        Path to write the rewritten HTML
  --json       Print the full machine-readable report JSON
  --model      OpenAI model (default: gpt-4.1-mini)

Environment:
  OPENAI_API_KEY required (loaded from .env if present); not needed for --analyze.
`);
}

// ─── Auto-discover: find a plausible HTML + ref TXT pair ─────────────────
function discoverFiles(repoRoot) {
  const candidates = [];
  const scanDirs = [
    path.join(repoRoot, "data", "uploads"),
    path.join(repoRoot, "data", "imports"),
    path.join(repoRoot, "email-base", "dist"),
    repoRoot,
  ];
  function walk(dir, depth = 0) {
    if (depth > 3) return;
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith(".") || e.name === "node_modules") continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else if (e.isFile() && /\.(html|htm|txt)$/i.test(e.name)) {
        try { candidates.push({ path: p, ext: path.extname(e.name).toLowerCase(), mtime: statSync(p).mtimeMs }); } catch {}
      }
    }
  }
  for (const d of scanDirs) walk(d);
  const htmls = candidates.filter((c) => /\.html?$/i.test(c.ext)).sort((a, b) => b.mtime - a.mtime);
  const txts  = candidates.filter((c) => /\.txt$/i.test(c.ext)).sort((a, b) => b.mtime - a.mtime);
  // Prefer non-utility TXTs (skip footer_upload-like).
  const nonUtilTxts = txts.filter((c) => !/footer|header|common|shared/i.test(path.basename(c.path)));
  const pickedTxt = (nonUtilTxts[0] || txts[0])?.path;
  return { html: htmls[0]?.path, ref: pickedTxt };
}

// ─── .env loader (no dependency) ─────────────────────────────────────────
function loadDotEnv(repoRoot) {
  const envPath = path.join(repoRoot, ".env");
  if (!existsSync(envPath)) return;
  const text = readFileSync(envPath, "utf8");
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

// ─── Tiny ANSI helpers (no chalk dependency) ─────────────────────────────
const C = {
  reset: "\x1b[0m",
  dim:   "\x1b[2m",
  bold:  "\x1b[1m",
  red:   "\x1b[31m",
  green: "\x1b[32m",
  yellow:"\x1b[33m",
  blue:  "\x1b[34m",
  magenta:"\x1b[35m",
  cyan:  "\x1b[36m",
};
const c = (color, s) => `${C[color]}${s}${C.reset}`;
const ok   = (s) => c("green", s);
const warn = (s) => c("yellow", s);
const bad  = (s) => c("red", s);
const dim  = (s) => c("dim", s);
const head = (s) => c("bold", s);

function padRight(s, n) { s = String(s); return s.length >= n ? s : s + " ".repeat(n - s.length); }
function padLeft(s, n) { s = String(s); return s.length >= n ? s : " ".repeat(n - s.length) + s; }

// ─── Pretty-print the report ────────────────────────────────────────────
function printReport(result) {
  const r = result.report;
  if (!r) {
    console.log(warn("No report attached to the result (unexpected)."));
    return;
  }

  const total = r.refBlockCount;
  const anchored = r.anchored;
  const pct = total ? Math.round((anchored / total) * 100) : 0;
  const headline = `${anchored}/${total} (${pct}%) refBlocks anchored`;

  console.log();
  if (anchored === total) {
    console.log(head(ok(`✓ AI placed every placeholder: ${headline}`)));
  } else if (anchored >= total * 0.8) {
    console.log(head(ok(`✓ AI did well: ${headline}`)));
  } else if (anchored >= total * 0.5) {
    console.log(head(warn(`◐ AI did partial work: ${headline}`)));
  } else {
    console.log(head(bad(`✗ AI underperformed: ${headline}`)));
  }

  console.log();
  console.log(`  HTML elements scanned: ${C.cyan}${r.elementCount}${C.reset}`);
  console.log(`  Missed:                ${r.missed > 0 ? warn(r.missed) : ok(0)}`);
  console.log(`  Ambiguous:             ${r.ambiguous > 0 ? warn(r.ambiguous) : ok(0)}`);
  console.log(`  Used second-pass:      ${r.usedSecondPass ? c("magenta", "yes") : dim("no (primary was enough)")}`);
  console.log();
  console.log(`  Confidence — min: ${r.stats.confidenceMin.toFixed(2)}, avg: ${r.stats.confidenceAvg.toFixed(2)}`);
  console.log(`  Similarity — min: ${r.stats.similarityMin.toFixed(2)}, avg: ${r.stats.similarityAvg.toFixed(2)}`);
  console.log();

  // ── Decisions table ─────────────────────────────────────────────
  const accepted = r.decisions.filter((d) => d.source === "primary" || d.source === "second-pass");
  const rejected = r.decisions.filter((d) => d.source !== "primary" && d.source !== "second-pass");
  accepted.sort((a, b) => a.blockIndex - b.blockIndex);

  console.log(head("Accepted decisions:"));
  console.log(dim("  block  elId  conf  sim   source       parent-chain                ref-text"));
  for (const d of accepted) {
    const conf = d.confidence.toFixed(2);
    const sim = d.similarity.toFixed(2);
    const src = d.source === "primary" ? dim("primary") : c("magenta", "2nd-pass");
    const chain = (d.parentChain || []).slice(0, 2).join(" > ").slice(0, 30);
    const ref = d.refText.slice(0, 40);
    console.log(`  ${padLeft(d.blockIndex, 5)}  ${padLeft(d.elementId, 4)}  ${conf}  ${sim}  ${padRight(src, 12)} ${padRight(chain, 30)}  ${ref}`);
  }

  if (rejected.length) {
    console.log();
    console.log(head(warn("Rejected by safety checks:")));
    for (const d of rejected) {
      const tag = d.source.replace(/^primary-/, "");
      console.log(`  ${padLeft(d.blockIndex, 5)}  ${dim(tag.padEnd(28))} ${d.refText.slice(0, 60)}`);
    }
  }

  // ── Missed list (refBlocks with text but no anchor) ────────────
  const acceptedBlocks = new Set(accepted.map((d) => d.blockIndex));
  if (acceptedBlocks.size < total) {
    console.log();
    console.log(head(warn("Reference blocks without an anchor:")));
    for (let i = 0; i < total; i += 1) {
      if (acceptedBlocks.has(i)) continue;
      const txt = (result.raw?._refBlocks?.[i] || "").slice(0, 80);
      console.log(`  ${padLeft(i, 5)}  ${dim("block_" + String(i).padStart(2, "0"))}  ${txt}`);
    }
  }

  console.log();
}

// ─── Main ──────────────────────────────────────────────────────────────
async function main() {
  const args = parseArgs(process.argv);

  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(here, "..");

  // Auto-discover paths if requested.
  if (args.auto && (!args.html || !args.ref)) {
    const found = discoverFiles(repoRoot);
    if (found.html && !args.html) args.html = found.html;
    if (found.ref && !args.ref) args.ref = found.ref;
    if (!args.ns) {
      // Derive a namespace name from the TXT filename
      args.ns = args.ref ? path.basename(args.ref, path.extname(args.ref)) : "demo";
    }
    console.log(dim(`[auto] html: ${args.html || "(not found)"}`));
    console.log(dim(`[auto] ref : ${args.ref || "(not found)"}`));
    console.log(dim(`[auto] ns  : ${args.ns}`));
  }

  if (args.help || !args.html || !args.ref || (!args.ns && !args.analyzeOnly)) {
    usage();
    process.exit(args.help ? 0 : 2);
  }

  loadDotEnv(repoRoot);
  const html = readFileSync(args.html, "utf8");
  const refTxt = readFileSync(args.ref, "utf8");

  // ── Smart analysis FIRST — always, runs offline, zero token cost.
  console.log();
  const analysis = analyzeLocaleAgainstHtml({ html, refTxt, refCode: "en" });
  console.log(formatAnalysisReport(analysis));
  console.log();

  if (args.analyzeOnly) {
    if (args.json) console.log(JSON.stringify(analysis, null, 2));
    return;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error(bad("✗ OPENAI_API_KEY is not set (checked env and .env in repo root)"));
    process.exit(3);
  }

  console.log(dim(`html : ${args.html} (${html.length} bytes)`));
  console.log(dim(`ref  : ${args.ref}`));
  console.log(dim(`ns   : ${args.ns}`));
  console.log(dim(`model: ${args.model || "gpt-4.1-mini"}`));
  console.log(dim("calling AI…"));

  const t0 = Date.now();
  const result = await placeholderizeHtml({
    html,
    refLocaleTxt: refTxt,
    namespace: args.ns,
    apiKey,
    model: args.model || "gpt-4.1-mini",
    mailHint: args.ns,
  });
  const ms = Date.now() - t0;
  console.log(dim(`done in ${ms} ms`));

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  printReport(result);

  if (args.out && result.html && result.anchors > 0) {
    writeFileSync(args.out, result.html, "utf8");
    console.log(ok(`✓ Wrote rewritten HTML to ${args.out}`));
  } else if (args.out) {
    console.log(warn(`Skipped --out: no anchors were placed (output would equal input).`));
  }
}

main().catch((err) => {
  console.error(bad(`✗ ${err.message || err}`));
  process.exit(1);
});
