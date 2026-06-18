/**
 * test-locale-analyze.mjs — regression test for the zero-AI locale↔HTML
 * matcher (src/locale-analyze.js).
 *
 * Focus: global best-first anchor assignment. The exact-matching block must
 * win a shared element over a weaker (but earlier) block — the order-dependent
 * greedy version got this wrong.
 *
 * Zero-AI, no network. Exit 0 = pass.
 */
import { analyzeLocaleAgainstHtml } from "../src/locale-analyze.js";

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log("✓", name); }
  else { fail++; console.log("✗ FAIL", name); }
}

// One HTML element; two ref blocks compete for it.
//   block0 "withdraw funds bonus"  → sim 0.667 (has an extra token "bonus")
//   block1 "withdraw your funds…"  → sim 1.000 (exact)
// Earlier-order greedy would let block0 grab the element; global best-first
// correctly gives it to block1.
const html = "<p>withdraw your funds securely now today</p>";
const refTxt = "{{withdraw funds bonus}}\n\n{{withdraw your funds securely now today}}";
const report = analyzeLocaleAgainstHtml({ html, refTxt, refCode: "en" });

check("exact-match block (index 1) is the anchor", report.blocks[1].tier === "anchor");
check("weaker earlier block (index 0) did NOT steal the element", report.blocks[0].tier !== "anchor");
check("exactly one anchored block", report.summary.anchored === 1);

// Drift detection: a locale with fewer blocks than the reference is flagged.
const drift = analyzeLocaleAgainstHtml({
  html,
  refTxt: "{{Hello there}}\n\n{{Welcome aboard}}",   // 2 blocks
  locales: { ru: "{{Привет}}" },                      // 1 block — drifted
  refCode: "en",
});
check("block-count drift flagged for ru locale",
  (drift.driftByLocale.ru?.issues || []).some((s) => /block count/i.test(s)));

console.log("\n" + (fail === 0 ? `✓ ALL PASS (${pass})` : `✗ ${fail} FAILED, ${pass} passed`));
process.exit(fail === 0 ? 0 : 1);
