/**
 * src/locale-analyze.js — structural analysis of an HTML email + its
 * reference locale, with zero AI calls.
 *
 * What it computes:
 *   1. extractVisibleElements(html) — gets the leaf-text DOM elements.
 *   2. parseTxtBlocks(refTxt)       — parses the reference locale.
 *   3. For each refBlock, finds candidate HTML elements ranked by
 *      token-overlap similarity. Surface: top-3 per block, plus the
 *      "best confidence" tier (sim ≥ 0.6 = anchor, 0.3..0.6 = candidate,
 *      < 0.3 = orphan).
 *   4. For each HTML element, finds whether any refBlock plausibly
 *      references it. Elements with no candidate match are "hardcoded
 *      text" — strings that won't be localized.
 *   5. Cross-locale drift: for every namespace in the bundle, compares
 *      block counts and per-block whitespace shape against the reference
 *      locale.
 *
 * Output is a structured report meant for two consumers:
 *   - the workbench UI / demo CLI (pretty-print)
 *   - a future AI agent that uses this as input context (so the AI
 *     doesn't waste tokens recomputing trivial similarity)
 *
 * The whole thing runs in milliseconds, fully offline.
 */

import { extractVisibleElements, parseTxtBlocks } from "./locale-ai.js";

function tokenize(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2);
}

function similarity(a, b) {
  const aT = new Set(tokenize(a));
  const bT = new Set(tokenize(b));
  if (!aT.size || !bT.size) return 0;
  let inter = 0;
  for (const t of aT) if (bT.has(t)) inter += 1;
  const minSize = Math.min(aT.size, bT.size);
  return minSize ? inter / minSize : 0;
}

// Confidence buckets for the analysis.
const TIER_ANCHOR = "anchor";       // sim ≥ 0.6 — single high-confidence candidate
const TIER_CANDIDATE = "candidate"; // 0.3 ≤ sim < 0.6 — fuzzy match, may need AI
const TIER_ORPHAN = "orphan";       // < 0.3 or no match — block has no anchor in HTML

/**
 * @param {object} args
 * @param {string} args.html          The HTML email content.
 * @param {string} args.refTxt        Reference locale TXT (source-of-truth blocks).
 * @param {object} [args.locales]     Optional: { code: TXT_string } map for cross-locale drift.
 * @param {string} [args.refCode]     The locale code for refTxt (default "en").
 * @returns {object}                  Structured analysis report.
 */
export function analyzeLocaleAgainstHtml({ html, refTxt, locales = {}, refCode = "en" }) {
  if (!html || typeof html !== "string") throw new Error("html is required");
  if (!refTxt) throw new Error("refTxt is required");

  const elements = extractVisibleElements(html);
  const refBlocks = parseTxtBlocks(refTxt);

  const blocks = []; // per-refBlock report

  // Clean ref texts once.
  const refTexts = refBlocks.map((b) => String(b || "").replace(/@@/g, "").trim());

  // ── Global best-first anchor assignment ────────────────────────────────
  // Previously anchors were claimed in block order, so an early block could
  // grab an element that a LATER block matched more strongly. Instead we build
  // every (block, element) pair, sort by similarity descending, and assign
  // greedily from the top — each element and each block used at most once.
  // This is the standard fix for order-dependent greedy matching and yields a
  // strictly better (higher total-similarity) anchor set.
  const ANCHOR_THRESHOLD = 0.6;
  const pairs = [];
  for (let i = 0; i < refTexts.length; i += 1) {
    if (!refTexts[i]) continue;
    for (const el of elements) {
      const sim = similarity(refTexts[i], el.text);
      if (sim >= ANCHOR_THRESHOLD) pairs.push({ i, el, sim });
    }
  }
  pairs.sort((a, b) => b.sim - a.sim);
  const anchorByBlock = new Map();   // block index → { el, sim }
  const anchoredElementIds = new Set();
  for (const p of pairs) {
    if (anchorByBlock.has(p.i) || anchoredElementIds.has(p.el.id)) continue;
    anchorByBlock.set(p.i, { el: p.el, sim: p.sim });
    anchoredElementIds.add(p.el.id);
  }

  for (let i = 0; i < refTexts.length; i += 1) {
    const refText = refTexts[i];
    if (!refText) {
      blocks.push({ index: i, refText: "", tier: "empty", candidates: [] });
      continue;
    }

    // Top-3 candidates for display: rank elements NOT anchored to another block.
    const ranked = elements
      .filter((e) => !anchoredElementIds.has(e.id) || anchorByBlock.get(i)?.el.id === e.id)
      .map((e) => ({ el: e, sim: similarity(refText, e.text) }))
      .sort((a, b) => b.sim - a.sim);

    const top = ranked.slice(0, 3).map((r) => ({
      id: r.el.id,
      tag: r.el.tag,
      text: r.el.text.slice(0, 80),
      parentChain: r.el.parentChain,
      similarity: Number(r.sim.toFixed(3)),
    }));

    const anchor = anchorByBlock.get(i);
    // bestSim reflects the assigned anchor if any, else the best fuzzy candidate.
    const bestSim = anchor ? anchor.sim : (ranked[0]?.sim ?? 0);
    let tier;
    if (anchor) tier = TIER_ANCHOR;
    else if (bestSim >= 0.3) tier = TIER_CANDIDATE;
    else tier = TIER_ORPHAN;

    blocks.push({
      index: i,
      refText: refText.slice(0, 120),
      tier,
      bestSimilarity: Number(bestSim.toFixed(3)),
      candidates: top,
    });
  }

  // HTML-side orphans: elements that no refBlock points to with sim >= 0.3.
  const elementCoverage = new Map(); // id → best sim against any refBlock
  for (const el of elements) {
    let best = 0;
    for (const b of refBlocks) {
      const refText = String(b || "").replace(/@@/g, "");
      if (!refText) continue;
      const s = similarity(refText, el.text);
      if (s > best) best = s;
    }
    elementCoverage.set(el.id, best);
  }
  const hardcoded = elements
    .filter((el) => (elementCoverage.get(el.id) ?? 0) < 0.3)
    .map((el) => ({
      id: el.id,
      tag: el.tag,
      text: el.text.slice(0, 80),
      parentChain: el.parentChain,
      bestSimilarity: Number((elementCoverage.get(el.id) ?? 0).toFixed(3)),
    }));

  // Cross-locale drift: for each non-ref locale, compare to ref.
  const driftByLocale = {};
  const refBlockCount = refBlocks.length;
  for (const code of Object.keys(locales || {})) {
    if (code === refCode) continue;
    const t = locales[code];
    if (!t) continue;
    const tBlocks = parseTxtBlocks(t);
    const issues = [];
    if (tBlocks.length !== refBlockCount) {
      issues.push(`block count: ${tBlocks.length} vs ref ${refBlockCount}`);
    }
    // Per-block @@ marker parity check.
    for (let i = 0; i < Math.min(tBlocks.length, refBlockCount); i += 1) {
      const refAt = (String(refBlocks[i] || "").match(/@@/g) || []).length;
      const tAt = (String(tBlocks[i] || "").match(/@@/g) || []).length;
      if (refAt !== tAt) {
        issues.push(`block_${String(i).padStart(2, "0")}: @@ count ${tAt} vs ref ${refAt}`);
      }
      // Placeholder-pattern parity (the {{Var_Name}} runtime placeholders).
      const refPh = String(refBlocks[i] || "").match(/\{\{[A-Za-z_][\w]*\}\}/g) || [];
      const tPh = String(tBlocks[i] || "").match(/\{\{[A-Za-z_][\w]*\}\}/g) || [];
      const missing = refPh.filter((p) => !tPh.includes(p));
      const extra = tPh.filter((p) => !refPh.includes(p));
      if (missing.length) issues.push(`block_${String(i).padStart(2, "0")}: missing placeholder(s) ${missing.join(", ")}`);
      if (extra.length) issues.push(`block_${String(i).padStart(2, "0")}: extra placeholder(s) ${extra.join(", ")}`);
    }
    driftByLocale[code] = {
      blockCount: tBlocks.length,
      issues,
    };
  }

  // Top-line stats.
  const anchored = blocks.filter((b) => b.tier === TIER_ANCHOR).length;
  const candidate = blocks.filter((b) => b.tier === TIER_CANDIDATE).length;
  const orphan = blocks.filter((b) => b.tier === TIER_ORPHAN).length;
  const empty = blocks.filter((b) => b.tier === "empty").length;

  return {
    summary: {
      refBlockCount: refBlocks.length,
      elementCount: elements.length,
      anchored,
      candidate,
      orphan,
      empty,
      hardcodedCount: hardcoded.length,
      localesWithDrift: Object.keys(driftByLocale).filter((c) => driftByLocale[c].issues.length).length,
    },
    blocks,
    hardcoded,
    driftByLocale,
    refCode,
  };
}

/**
 * Pretty-print the analysis report as a colored CLI table.
 *
 * @param {object} report Result from analyzeLocaleAgainstHtml.
 * @param {object} [opts]
 * @param {boolean} [opts.color] Use ANSI colors (default true if TTY).
 */
export function formatAnalysisReport(report, opts = {}) {
  const useColor = opts.color ?? (typeof process !== "undefined" && process.stdout && process.stdout.isTTY);
  const C = useColor
    ? { reset: "\x1b[0m", dim: "\x1b[2m", bold: "\x1b[1m", red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m", cyan: "\x1b[36m", magenta: "\x1b[35m" }
    : { reset: "", dim: "", bold: "", red: "", green: "", yellow: "", cyan: "", magenta: "" };
  const c = (color, s) => `${C[color]}${s}${C.reset}`;

  const s = report.summary;
  const lines = [];

  lines.push(c("bold", "═════════════════════════════════════════════════════════════"));
  lines.push(c("bold", " Smart Analysis (zero AI calls)"));
  lines.push(c("bold", "═════════════════════════════════════════════════════════════"));
  lines.push("");
  lines.push(`  Reference blocks : ${c("cyan", String(s.refBlockCount))}   HTML elements : ${c("cyan", String(s.elementCount))}`);
  lines.push("");

  const total = s.refBlockCount || 1;
  const pct = (n) => `${Math.round((n / total) * 100).toString().padStart(3)}%`;
  lines.push(`  ${c("green", "● Anchor")}    ${String(s.anchored).padStart(3)} / ${total}  (${pct(s.anchored)})  ${c("dim", "— sim ≥ 0.6, ready for placement")}`);
  lines.push(`  ${c("yellow", "● Candidate")} ${String(s.candidate).padStart(3)} / ${total}  (${pct(s.candidate)})  ${c("dim", "— 0.3 ≤ sim < 0.6, AI should pick")}`);
  lines.push(`  ${c("red", "● Orphan")}    ${String(s.orphan).padStart(3)} / ${total}  (${pct(s.orphan)})  ${c("dim", "— sim < 0.3, no anchor in HTML")}`);
  if (s.empty) lines.push(`  ${c("dim", "○ Empty")}     ${String(s.empty).padStart(3)} / ${total}  ${c("dim", "— empty block, nothing to anchor")}`);
  lines.push("");
  lines.push(`  Hardcoded HTML text (no block reference) : ${c("yellow", String(s.hardcodedCount))} element(s)`);
  lines.push(`  Locales with drift                       : ${c(s.localesWithDrift ? "yellow" : "green", String(s.localesWithDrift))}`);
  lines.push("");

  // Orphan list (the ones that need AI or manual help)
  const orphans = report.blocks.filter((b) => b.tier === "orphan");
  if (orphans.length) {
    lines.push(c("bold", "─── Orphan refBlocks (no anchor candidate) ───"));
    for (const b of orphans.slice(0, 12)) {
      lines.push(`  ${c("red", "✗")} block_${String(b.index).padStart(2, "0")}  ${c("dim", `(best sim ${b.bestSimilarity.toFixed(2)})`)}  ${b.refText.slice(0, 60)}`);
    }
    if (orphans.length > 12) lines.push(c("dim", `  …и ещё ${orphans.length - 12} блок(ов)`));
    lines.push("");
  }

  // Candidate list (fuzzy — needs AI second-pass)
  const candidates = report.blocks.filter((b) => b.tier === "candidate");
  if (candidates.length) {
    lines.push(c("bold", "─── Candidate refBlocks (AI should disambiguate) ───"));
    for (const b of candidates.slice(0, 10)) {
      const topCandidate = b.candidates[0];
      const chain = (topCandidate?.parentChain || []).slice(0, 2).join(" > ");
      lines.push(`  ${c("yellow", "?")} block_${String(b.index).padStart(2, "0")} ${c("dim", `(sim ${b.bestSimilarity.toFixed(2)})`)}  ${b.refText.slice(0, 50)}`);
      if (topCandidate) {
        lines.push(`     → ${c("dim", "best:")} #${topCandidate.id} <${topCandidate.tag}> ${c("dim", chain)} "${topCandidate.text.slice(0, 50)}"`);
      }
    }
    if (candidates.length > 10) lines.push(c("dim", `  …и ещё ${candidates.length - 10} блок(ов)`));
    lines.push("");
  }

  // Hardcoded HTML text
  if (report.hardcoded.length) {
    lines.push(c("bold", "─── Hardcoded HTML text (not referenced by any block) ───"));
    for (const el of report.hardcoded.slice(0, 8)) {
      const chain = (el.parentChain || []).slice(0, 2).join(" > ");
      lines.push(`  ${c("yellow", "⚠")} <${el.tag}> ${c("dim", chain)} "${el.text.slice(0, 60)}"`);
    }
    if (report.hardcoded.length > 8) lines.push(c("dim", `  …и ещё ${report.hardcoded.length - 8} элемент(ов)`));
    lines.push("");
  }

  // Cross-locale drift
  const driftCodes = Object.keys(report.driftByLocale).filter((c) => report.driftByLocale[c].issues.length);
  if (driftCodes.length) {
    lines.push(c("bold", "─── Cross-locale drift ───"));
    for (const code of driftCodes) {
      const d = report.driftByLocale[code];
      lines.push(`  ${c("magenta", code)}  ${c("dim", `(${d.blockCount} blocks)`)}`);
      for (const issue of d.issues.slice(0, 6)) {
        lines.push(`     ${c("yellow", "•")} ${issue}`);
      }
      if (d.issues.length > 6) lines.push(c("dim", `     …и ещё ${d.issues.length - 6}`));
    }
    lines.push("");
  }

  // Quality verdict
  lines.push(c("bold", "─── Verdict ───"));
  if (s.anchored === total) {
    lines.push(c("green", `  ✓ All ${total} blocks have high-confidence anchors. Safe to run placeholderize.`));
  } else if (s.anchored + s.candidate >= total * 0.9) {
    lines.push(c("yellow", `  ◐ ${s.anchored + s.candidate}/${total} blocks have at least a candidate. AI second-pass should resolve.`));
  } else if (s.orphan > total * 0.2) {
    lines.push(c("red", `  ✗ ${s.orphan} orphan block(s) — HTML or locale TXT likely diverged. Inspect orphans first.`));
  } else {
    lines.push(c("yellow", `  ◐ Mixed: ${s.anchored} anchor, ${s.candidate} candidate, ${s.orphan} orphan.`));
  }
  if (s.localesWithDrift) {
    lines.push(c("yellow", `  ⚠ ${s.localesWithDrift} locale(s) drifted from reference — fix-locale recommended before translating.`));
  }
  if (s.hardcodedCount > 5) {
    lines.push(c("yellow", `  ⚠ ${s.hardcodedCount} HTML elements look hardcoded — content can't be translated until tokenized.`));
  }

  return lines.join("\n");
}
