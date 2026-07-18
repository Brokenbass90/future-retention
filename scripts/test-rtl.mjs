#!/usr/bin/env node
/**
 * scripts/test-rtl.mjs — regression tests for BOTH RTL transformers:
 *   1. email-base/tools/rtl.js  (build + server preview — source of truth)
 *   2. public/workbench.js      (browser copy — must stay in parity)
 * Cases: safe text-only default after CSS inlining, centered/left CTAs,
 * direct-text cells, opt-in full mirror, source/assets and idempotency.
 */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import url from "node:url";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");

const coreModule = require(path.join(repoRoot, "email-base", "tools", "rtl.js"));
const core = coreModule.applyRtl;
const serverRtl = await import(path.join(repoRoot, "src", "rtl.js"));
const wbSrc = readFileSync(path.join(repoRoot, "public", "workbench.js"), "utf8");
const localeStart = wbSrc.indexOf("const RTL_SCRIPT_CODES");
const localeEnd = wbSrc.indexOf("const hasRtlGlyphs", localeStart);
const browserLocaleSource = wbSrc.slice(localeStart, localeEnd);
const browserIsRtlLocale = new Function(browserLocaleSource + "; return isRtlLocale;")();
const browserIsRtlLocaleWithoutIntl = new Function(
  "Intl",
  browserLocaleSource + "; return isRtlLocale;",
)({});
const s = wbSrc.indexOf("function applyRtl(html,");
const e = wbSrc.indexOf("// ─── Preview click → editor highlight", s);
const browser = new Function(wbSrc.slice(s, e) + "; return applyRtl;")();

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log("✓", name); }
  else { fail++; console.error("✗", name); }
}

function captureError(fn) {
  try {
    fn();
    return null;
  } catch (error) {
    return error;
  }
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
  framework: '<html lang="ar"><head><style>img{float:left;clear:both}table,tbody,tr,td{padding:0;text-align:left}.offset-by-one{padding-left:50px}@media only screen and (max-width:600px){img.hero{float:left}}</style></head><body><img src="https://img.example/first-left.png"><p style="padding-left:12px;text-align:left">مرحبا</p><img src="https://img.example/second-right.png" srcset="https://img.example/second@2x.png 2x"><div style="background-image:url(https://img.example/background-right.png);background-position:left top">نص</div></body></html>',
  inlinedFramework: '<html><head><style>img{float:left}table,td{text-align:left}</style></head><body style="padding-left:8px;text-align:left"><table class="layout" align="left" style="padding-left:50px;text-align:left"><tr style="text-align:left"><td class="layout-cell" style="padding-left:24px;text-align:left"><img class="hero" align="left" src="https://img.example/hero.png" style="float:left;padding-left:12px"><table><tr><td class="copy" style="text-align:left">نص عربي</td></tr></table><p style="padding-left:16px;text-align:left">مرحبا</p></td></tr></table></body></html>',
  centeredDirectText: '<table><tr><td align="center" style="text-align:center">مرحبا</td></tr></table>',
  inlineMediaCell: '<table><tr><td class="icon-copy" style="text-align:left"><img src="https://img.example/icon.png" style="float:left">نص عربي</td></tr></table>',
  spacerCells: '<table><tr><td class="spacer" style="text-align:left">&nbsp;</td><td class="empty"> &#160; </td></tr></table>',
  authoredDirection: '<html><body><p dir="rtl" style="text-align:left">مرحبا</p><table class="cta" align="left"><tr><td class="butt"><a href="#">اضغط</a></td></tr></table></body></html>',
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
  t("text mode: asset background position stays right", /top 24px right 24px/.test(a));
  t("text mode: asset link does not reorder image", !/<a[^>]*direction:\s*rtl/.test(a));
  t("text mode: image padding stays right", /padding-right: 12px/.test(a));
  t("text mode: asset text aligns right", /<p[^>]*text-align: right/.test(a));
  t("text mode: text block with image does not get direction that reorders it", !/<p[^>]*dir="rtl"/.test(a));

  const mirroredAsset = applyRtl(CASES.asset, { mode: "mirror" });
  t("mirror mode: background icon right→left", /top 24px left 24px/.test(mirroredAsset));
  t("mirror mode: link gets direction rtl", /<a[^>]*direction:\s*rtl/.test(mirroredAsset));
  t("mirror mode: image padding flips to left", /padding-left: 12px/.test(mirroredAsset));

  const r = applyRtl(CASES.row);
  t("text mode: column source order stays intact", r.indexOf('class="m-w') < r.indexOf('class="w-a'));
  t("text mode: row is not marked swapped", !/data-rtl-swapped/.test(r));
  const mirroredRow = applyRtl(CASES.row, { mode: "mirror" });
  t("mirror mode: td order inverted (text first)", mirroredRow.indexOf('class="w-a') < mirroredRow.indexOf('class="m-w'));
  t("mirror mode: row marked data-rtl-swapped", /data-rtl-swapped/.test(mirroredRow));
  const r2 = applyRtl(mirroredRow, { mode: "mirror" });
  t("mirror row: idempotent on re-run", r2 === mirroredRow);
  t("row: unrelated 2-td rows untouched", !/data-rtl-swapped/.test(applyRtl(CASES.plainRow)));

  const c2 = applyRtl(applyRtl(CASES.centeredAttr));
  t("centered stays center after 2 runs", /align="center"/.test(c2));

  const frameworkOnce = applyRtl(CASES.framework);
  const frameworkTwice = applyRtl(frameworkOnce);
  const originalImages = [...CASES.framework.matchAll(/<img\b[^>]*\bsrc="([^"]+)"/gi)].map(m => m[1]);
  const rtlImages = [...frameworkOnce.matchAll(/<img\b[^>]*\bsrc="([^"]+)"/gi)].map(m => m[1]);
  const originalUrls = [...CASES.framework.matchAll(/url\(([^)]+)\)/gi)].map(m => m[1]);
  const rtlUrls = [...frameworkOnce.matchAll(/url\(([^)]+)\)/gi)].map(m => m[1]);
  t("framework head CSS stays unchanged", frameworkOnce.includes('<style>img{float:left;clear:both}table,tbody,tr,td{padding:0;text-align:left}.offset-by-one{padding-left:50px}@media only screen and (max-width:600px){img.hero{float:left}}</style>'));
  t("image src and order stay unchanged", JSON.stringify(rtlImages) === JSON.stringify(originalImages));
  t("srcset stays unchanged", frameworkOnce.includes('srcset="https://img.example/second@2x.png 2x"'));
  t("CSS image URLs stay unchanged", JSON.stringify(rtlUrls) === JSON.stringify(originalUrls));
  t("complete transform is exactly idempotent", frameworkTwice === frameworkOnce);
  t("full documents carry text-mode marker", /<html\b[^>]*><!--retkit-rtl:v2:text-->/.test(frameworkOnce));

  const inlined = applyRtl(CASES.inlinedFramework);
  t("inlined framework: body layout style stays left", /<body style="padding-left:8px;text-align:left">/.test(inlined));
  t("inlined framework: layout table align/padding stay left", /<table class="layout" align="left" style="padding-left:50px;text-align:left">/.test(inlined));
  t("inlined framework: image float/padding/align stay left", /<img class="hero" align="left" src="https:\/\/img\.example\/hero\.png" style="float:left;padding-left:12px">/.test(inlined));
  t("inlined framework: direct text td is RTL/right", /<td dir="rtl" class="copy" style="text-align: right">نص عربي<\/td>/.test(inlined));
  t("inlined framework: p is RTL/right without padding mirror", /<p dir="rtl" style="padding-left:16px;text-align: right">مرحبا<\/p>/.test(inlined));

  const centeredText = applyRtl(CASES.centeredDirectText);
  t("direct text cell: centered design stays centered", /<td dir="rtl" align="center" style="text-align:center">/.test(centeredText));

  const mediaCell = applyRtl(CASES.inlineMediaCell);
  t("inline-media text cell: text aligns right without direction reordering", /<td class="icon-copy" style="text-align: right"><img/.test(mediaCell) && !/<td dir="rtl" class="icon-copy"/.test(mediaCell));
  t("inline-media text cell: image style/source stay intact", /<img src="https:\/\/img\.example\/icon\.png" style="float:left">/.test(mediaCell));
  const spacerCells = applyRtl(CASES.spacerCells);
  t("spacer cells stay byte-for-byte structural", /<td class="spacer" style="text-align:left">&nbsp;<\/td><td class="empty"> &#160; <\/td>/.test(spacerCells));

  const authored = applyRtl(CASES.authoredDirection);
  t("authored dir is not mistaken for already-transformed HTML", /<p dir="rtl" style="text-align: right">/.test(authored) && /<table class="cta" align="right">/.test(authored));

  const mirroredInlined = applyRtl(CASES.inlinedFramework, { mode: "mirror" });
  t("mirror opt-in: inlined image physical side flips", /<img class="hero" align="right"[^>]*style="float: right;padding-right: 12px">/.test(mirroredInlined));
  t("mirror opt-in: marker identifies mirror contract", /<!--retkit-rtl:v2:mirror-->/.test(mirroredInlined));

  const modeSource = '<html><body><p style="text-align:left">مرحبا</p></body></html>';
  const textApplied = applyRtl(modeSource, { mode: "text" });
  const mirrorApplied = applyRtl(modeSource, { mode: "mirror" });
  t("v2 text: same-mode run is exact no-op", applyRtl(textApplied, { mode: "text" }) === textApplied);
  t("v2 mirror: same-mode run is exact no-op", applyRtl(mirrorApplied, { mode: "mirror" }) === mirrorApplied);
  const textToMirror = captureError(() => applyRtl(textApplied, { mode: "mirror" }));
  t("v2 text→mirror: explicit clean-source diagnostic", textToMirror?.code === "RETKIT_RTL_MODE_CONFLICT"
    && /rebuild from clean source \(Original\)/i.test(textToMirror.message));
  const mirrorToText = captureError(() => applyRtl(mirrorApplied, { mode: "text" }));
  t("v2 mirror→text: explicit clean-source diagnostic", mirrorToText?.code === "RETKIT_RTL_MODE_CONFLICT"
    && /rebuild from clean source \(Original\)/i.test(mirrorToText.message));
  const v1Retry = captureError(() => applyRtl('<!--retkit-rtl:v1-->' + modeSource));
  t("legacy v1: refuses an ambiguous second pass", v1Retry?.code === "RETKIT_RTL_MODE_CONFLICT"
    && /rebuild from clean source/i.test(v1Retry.message));
  const legacyMirror = modeSource.replace('<body>', '<body><table><tr data-rtl-swapped="1"><td>a</td><td>b</td></tr></table>');
  const legacyMirrorToText = captureError(() => applyRtl(legacyMirror, { mode: "text" }));
  t("legacy mirror signature: refuses mirror→text mutation", legacyMirrorToText?.code === "RETKIT_RTL_MODE_CONFLICT");
  t("legacy mirror signature: mirror mode is tagged without another mutation",
    /<!--retkit-rtl:v2:mirror-->/.test(applyRtl(legacyMirror, { mode: "mirror" })));
}

for (const [caseName, html] of Object.entries(CASES)) {
  check(`core/browser parity (text): ${caseName}`, core(html) === browser(html));
  check(`core/browser parity (mirror): ${caseName}`, core(html, { mode: "mirror" }) === browser(html, { mode: "mirror" }));
}

check(
  "server wrapper parity (text)",
  serverRtl.applyLocaleDirectionToHtml(CASES.inlinedFramework, "ar") === core(CASES.inlinedFramework),
);
check(
  "server wrapper parity (mirror)",
  serverRtl.applyLocaleDirectionToHtml(CASES.inlinedFramework, "ar", undefined, { mode: "mirror" })
    === core(CASES.inlinedFramework, { mode: "mirror" }),
);
const serverTextApplied = serverRtl.applyLocaleDirectionToHtml(CASES.inlinedFramework, "ar");
const serverModeConflict = captureError(() => serverRtl.applyLocaleDirectionToHtml(
  serverTextApplied,
  "ar",
  undefined,
  { mode: "mirror" },
));
check("server wrapper preserves mode-conflict diagnostic",
  serverModeConflict?.code === "RETKIT_RTL_MODE_CONFLICT"
    && /rebuild from clean source/i.test(serverModeConflict.message));

const directionCases = new Map([
  ["ar", true], ["ar-KW", true], ["ur_PK", true], ["khw", true],
  ["ha", false], ["ha-Latn", false], ["ha-Arab", true],
  ["ku", false], ["ku-TR", false], ["ku-SY", false], ["ku-IQ", true], ["ku-IR", true],
  ["ku-Latn", false], ["ku-Arab", true],
  ["ks", true], ["ks-IN", true], ["ks-Arab", true], ["ks-Deva", false],
  ["ar-Latn", false], ["ar-Deva", false], ["ur-Latn", false], ["he-Hebr", true], ["he-Latn", false],
  ["en-Arab", true], ["en-Latn", false], ["und-Arab", true], ["und-Hebr", true],
  ["und-Latn", false], ["und-Deva", false], ["ar-u-nu-latn", true], ["en", false], ["invalid", false],
]);
for (const [locale, expected] of directionCases) {
  check(`script-aware direction parity: ${locale}`,
    coreModule.isRtlLocale(locale) === expected
      && serverRtl.isRtlLocale(locale) === expected
      && browserIsRtlLocale(locale) === expected);
}

// Reduced-ICU / old-browser fallback must preserve the important variants.
const savedIntlLocale = Intl.Locale;
try {
  Object.defineProperty(Intl, "Locale", { configurable: true, writable: true, value: undefined });
  for (const [locale, expected] of [
    ["ha", false], ["ha-Arab", true], ["ku", false], ["ku-IQ", true],
    ["ku-SY", false], ["ks", true], ["ks-Deva", false], ["ar", true], ["ur-Latn", false],
  ]) {
    check(`direction fallback without Intl.Locale: ${locale}`,
      coreModule.isRtlLocale(locale) === expected
        && serverRtl.isRtlLocale(locale) === expected
        && browserIsRtlLocaleWithoutIntl(locale) === expected);
  }
} finally {
  Object.defineProperty(Intl, "Locale", { configurable: true, writable: true, value: savedIntlLocale });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
