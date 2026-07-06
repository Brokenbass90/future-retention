#!/usr/bin/env node
/**
 * scripts/test-rtl.mjs — regression tests for BOTH RTL transformers:
 *   1. email-base/tools/rtl.js  (build + server preview — source of truth)
 *   2. public/workbench.js      (browser copy — must stay in parity)
 * Cases: centered buttons stay centered, left buttons mirror, asset-card
 * smart flip, two-column row inversion (m-w/w-a), idempotency.
 */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import url from "node:url";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");

const core = require(path.join(repoRoot, "email-base", "tools", "rtl.js")).applyRtl;
const wbSrc = readFileSync(path.join(repoRoot, "public", "workbench.js"), "utf8");
const s = wbSrc.indexOf("function applyRtl(html)");
const e = wbSrc.indexOf("// ─── Preview click → editor highlight", s);
const browser = new Function(wbSrc.slice(s, e) + "; return applyRtl;")();

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log("✓", name); }
  else { fail++; console.error("✗", name); }
}

const CASES = {
  centeredAttr: '<table class="w280" align="center"><tr><td class="butt"><a href="#">اضغط</a></td></tr></table>',
  centeredMargin: '<table class="cta" style="margin: 16px auto;"><tr><td class="butt"><a href="#">اضغط</a></td></tr></table>',
  centeredCtx: '<td align="center"><table class="w280"><tr><td class="butt"><a href="#">اضغط</a></td></tr></table></td>',
  centerTag: '<center><table class="cta"><tr><td class="butt"><a href="#">اضغط</a></td></tr></table></center>',
  leftBtn: '<table class="w280" align="left"><tr><td class="butt"><a href="#">اضغط</a></td></tr></table>',
  noAlign: '<table class="cta"><tr><td class="butt"><a href="#">اضغط</a></td></tr></table>',
  asset: '<a href="https://x" style="color: #2ba6cb; text-decoration: none;"><div class="gray-block" style="background: #f9f9f9 url(https://img/i.png) top 24px right 24px no-repeat; padding: 24px;"><p class="text-asset-block" style="text-align: left;"><img src="https://img/g.png" style="padding-right: 12px; width: 56px !important;">الذهب</p></div></a>',
  row: '<div class="gray-block-2"><table class="w100"><tr style="text-align: left;"><td class="m-w pb0"><p class="number">1</p></td><td class="w-a pb0"><p class="text">افتح نافذة</p></td></tr></table></div>',
  plainRow: '<table><tr><td class="left-cell">a</td><td class="right-cell">b</td></tr></table>',
};

for (const [label, applyRtl] of [["core", core], ["browser", browser]]) {
  const t = (n, c) => check(`${label}: ${n}`, c);
  t("centered attr stays center", /align="center"/.test(applyRtl(CASES.centeredAttr)));
  t("margin-auto stays untouched", !/align="right"/.test(applyRtl(CASES.centeredMargin)));
  t("centered td context untouched", !/align="right"/.test(applyRtl(CASES.centeredCtx)));
  t("<center> context untouched", !/align="right"/.test(applyRtl(CASES.centerTag)));
  t("left button mirrors right", /align="right"/.test(applyRtl(CASES.leftBtn)));
  t("unaligned button mirrors right", /align="right"/.test(applyRtl(CASES.noAlign)));

  const a = applyRtl(CASES.asset);
  t("asset: background icon right→left", /top 24px left 24px/.test(a));
  t("asset: link gets direction rtl", /<a[^>]*direction:\s*rtl/.test(a));
  t("asset: img padding flips to left", /padding-left: 12px/.test(a));
  t("asset: text aligns right", /<p[^>]*text-align: right/.test(a));

  const r = applyRtl(CASES.row);
  t("row: td order inverted (text first)", r.indexOf('class="w-a') < r.indexOf('class="m-w'));
  t("row: marked data-rtl-swapped", /data-rtl-swapped/.test(r));
  const r2 = applyRtl(r);
  t("row: idempotent on re-run", r2.indexOf('class="w-a') < r2.indexOf('class="m-w') && (r2.match(/class="m-w/g) || []).length === 1);
  t("row: unrelated 2-td rows untouched", !/data-rtl-swapped/.test(applyRtl(CASES.plainRow)));

  const c2 = applyRtl(applyRtl(CASES.centeredAttr));
  t("centered stays center after 2 runs", /align="center"/.test(c2));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
