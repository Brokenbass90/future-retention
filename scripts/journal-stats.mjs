#!/usr/bin/env node
/**
 * scripts/journal-stats.mjs
 *
 * Read data/studio-journal.jsonl and surface AI usage patterns:
 *   - how many times each AI feature was used (placeholderize, agent, fix-locale, …)
 *   - success vs error breakdown
 *   - average anchor rate for placeholderize
 *   - which agent tools are called most / fail most
 *   - last 10 runs with timestamps for quick scanning
 *
 * Zero AI calls, zero network. Pure local analytics on what you and the
 * studio have actually done so far. Useful for:
 *   - "is AI helping or just sitting there?"
 *   - calibrating similarity / confidence thresholds with real data
 *   - identifying common failure modes
 *
 * Usage:
 *   node scripts/journal-stats.mjs            # show summary
 *   node scripts/journal-stats.mjs --recent N # show last N entries
 *   node scripts/journal-stats.mjs --json     # dump structured stats as JSON
 */

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import url from "node:url";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const journalPath = path.join(repoRoot, "data", "studio-journal.jsonl");

// ─── ANSI ────────────────────────────────────────────────────────────
const useColor = typeof process !== "undefined" && process.stdout && process.stdout.isTTY;
const C = useColor
  ? { reset: "\x1b[0m", dim: "\x1b[2m", bold: "\x1b[1m", red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m", cyan: "\x1b[36m", magenta: "\x1b[35m" }
  : { reset: "", dim: "", bold: "", red: "", green: "", yellow: "", cyan: "", magenta: "" };
const c = (color, s) => `${C[color]}${s}${C.reset}`;

// ─── Parse args ──────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = { json: false, recent: 10 };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--json") { out.json = true; continue; }
    if (a === "--recent") { out.recent = parseInt(argv[++i] || "10", 10); continue; }
    if (a === "--help" || a === "-h") { out.help = true; continue; }
  }
  return out;
}

function usage() {
  console.log(`Usage:
  node scripts/journal-stats.mjs            # show summary (last 10 runs)
  node scripts/journal-stats.mjs --recent N # show last N entries
  node scripts/journal-stats.mjs --json     # dump structured stats as JSON

Reads: ${path.relative(process.cwd(), journalPath)}
`);
}

// ─── Read journal ────────────────────────────────────────────────────
function loadEntries() {
  if (!existsSync(journalPath)) {
    return { entries: [], missing: true };
  }
  const text = readFileSync(journalPath, "utf8");
  const entries = [];
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    try {
      entries.push(JSON.parse(t));
    } catch {
      // Skip malformed lines.
    }
  }
  return { entries, missing: false };
}

// ─── Stats ───────────────────────────────────────────────────────────
function computeStats(entries) {
  const byArea = new Map();
  const errors = [];
  let placeholderizeRuns = 0;
  let placeholderizeAnchorPct = [];
  let placeholderize2ndPassUses = 0;
  const agentToolCalls = new Map();
  const agentToolErrors = new Map();
  let agentRuns = 0;

  for (const e of entries) {
    const area = e.area || "(none)";
    byArea.set(area, (byArea.get(area) || 0) + 1);

    if (e.level === "error" || (e.message && /error|failed|fail/i.test(e.message))) {
      errors.push(e);
    }

    if (area === "ai-placeholderize" && e.meta) {
      placeholderizeRuns += 1;
      if (typeof e.meta.refBlockCount === "number" && e.meta.refBlockCount > 0) {
        placeholderizeAnchorPct.push((e.meta.anchored / e.meta.refBlockCount) * 100);
      }
      if (e.meta.usedSecondPass) placeholderize2ndPassUses += 1;
    }

    if (area === "ai-agent" && e.meta) {
      agentRuns += 1;
      const steps = Array.isArray(e.meta.steps) ? e.meta.steps : [];
      for (const s of steps) {
        if (s.kind === "tool_call" && s.name) {
          agentToolCalls.set(s.name, (agentToolCalls.get(s.name) || 0) + 1);
        }
      }
    }
  }

  const avg = (arr) => arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : 0;
  const min = (arr) => arr.length ? Math.min(...arr) : 0;
  const max = (arr) => arr.length ? Math.max(...arr) : 0;

  return {
    total: entries.length,
    byArea: Object.fromEntries(byArea),
    errors,
    placeholderize: {
      runs: placeholderizeRuns,
      anchorPctMin: Number(min(placeholderizeAnchorPct).toFixed(1)),
      anchorPctAvg: Number(avg(placeholderizeAnchorPct).toFixed(1)),
      anchorPctMax: Number(max(placeholderizeAnchorPct).toFixed(1)),
      secondPassUses: placeholderize2ndPassUses,
    },
    agent: {
      runs: agentRuns,
      toolCalls: Object.fromEntries(agentToolCalls),
      toolErrors: Object.fromEntries(agentToolErrors),
    },
  };
}

// ─── Pretty print ────────────────────────────────────────────────────
function pad(s, n) { s = String(s); return s.length >= n ? s : s + " ".repeat(n - s.length); }
function padLeft(s, n) { s = String(s); return s.length >= n ? s : " ".repeat(n - s.length) + s; }

function formatStats(stats, entries, opts) {
  const lines = [];
  lines.push(c("bold", "═════════════════════════════════════════════════════════════"));
  lines.push(c("bold", " RetKit Studio — Journal Stats"));
  lines.push(c("bold", "═════════════════════════════════════════════════════════════"));
  lines.push("");
  lines.push(`  Total journal entries : ${c("cyan", String(stats.total))}`);
  lines.push("");

  // Area breakdown
  lines.push(c("bold", "─── Activity by area ───"));
  const areas = Object.entries(stats.byArea).sort((a, b) => b[1] - a[1]);
  for (const [area, count] of areas) {
    const color = area.startsWith("ai-") ? "magenta" : "cyan";
    lines.push(`  ${pad(c(color, area), 35)} ${padLeft(count, 5)}`);
  }
  lines.push("");

  // Placeholderize stats
  if (stats.placeholderize.runs > 0) {
    lines.push(c("bold", "─── AI Placeholderize ───"));
    lines.push(`  runs               : ${c("cyan", String(stats.placeholderize.runs))}`);
    lines.push(`  anchor% (min/avg/max): ${stats.placeholderize.anchorPctMin}% / ${c("green", stats.placeholderize.anchorPctAvg + "%")} / ${stats.placeholderize.anchorPctMax}%`);
    lines.push(`  2nd-pass uses      : ${stats.placeholderize.secondPassUses} (${stats.placeholderize.runs ? Math.round(stats.placeholderize.secondPassUses / stats.placeholderize.runs * 100) : 0}% of runs needed it)`);
    lines.push("");
  }

  // Agent stats
  if (stats.agent.runs > 0) {
    lines.push(c("bold", "─── AI Agent (tool-use) ───"));
    lines.push(`  runs           : ${c("cyan", String(stats.agent.runs))}`);
    const toolEntries = Object.entries(stats.agent.toolCalls).sort((a, b) => b[1] - a[1]);
    if (toolEntries.length) {
      lines.push(`  tool calls     :`);
      for (const [name, count] of toolEntries) {
        lines.push(`    ${pad(c("cyan", name), 30)} ${padLeft(count, 4)}`);
      }
    }
    lines.push("");
  }

  // Errors
  if (stats.errors.length) {
    lines.push(c("bold", c("yellow", "─── Recent errors ───")));
    for (const e of stats.errors.slice(-5)) {
      const when = e.createdAt || e.timestamp || "";
      lines.push(`  ${c("red", "✗")} ${c("dim", when.slice(0, 19))}  [${e.area}] ${(e.message || "").slice(0, 80)}`);
    }
    lines.push("");
  }

  // Recent runs
  const N = Math.max(1, Math.min(opts.recent, entries.length));
  if (N > 0 && entries.length) {
    lines.push(c("bold", `─── Last ${N} entries ───`));
    for (const e of entries.slice(-N)) {
      const when = (e.createdAt || e.timestamp || "").slice(0, 19);
      const area = (e.area || "(none)").padEnd(20);
      const title = (e.title || "").slice(0, 50);
      lines.push(`  ${c("dim", when)}  ${c("magenta", area)} ${title}`);
    }
    lines.push("");
  }

  // Empty state
  if (!entries.length) {
    lines.push(c("yellow", "  Журнал пуст. Запусти agent в workbench или demo-скрипт — записи появятся."));
    lines.push("");
  }

  return lines.join("\n");
}

// ─── Main ────────────────────────────────────────────────────────────
function main() {
  const args = parseArgs(process.argv);
  if (args.help) { usage(); return; }

  const { entries, missing } = loadEntries();
  if (missing) {
    console.log(c("yellow", `Журнал не найден: ${journalPath}`));
    console.log(c("dim", "Файл создастся автоматически после первого AI-действия в студии."));
    return;
  }

  const stats = computeStats(entries);

  if (args.json) {
    console.log(JSON.stringify({ stats, entries: entries.slice(-args.recent) }, null, 2));
    return;
  }

  console.log(formatStats(stats, entries, args));
}

main();
