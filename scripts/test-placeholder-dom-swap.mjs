#!/usr/bin/env node
/**
 * scripts/test-placeholder-dom-swap.mjs — NEW 2026-06-11
 *
 * Regression for the "письмо превратилось в один плейсхолдер" disaster:
 * the client-side zero-AI shortcut `replaceVisibleTextWithPlaceholders`
 * (public/workbench.js) treated `td.center > center > table > …` as a LEAF
 * (only direct children were checked, and <center> wasn't a container tag),
 * matched the whole-email textContent against one locale block via the
 * containment rule, and replaced the entire body with `${{ ns.block_NN }}$`.
 *
 * The function lives in browser JS — we extract it via vm sandbox with a
 * linkedom DOMParser (gotcha: CJS require doesn't work, ESM monkey-patching
 * doesn't work → vm.createContext, как в других браузерных тестах).
 *
 * Run:  node scripts/test-placeholder-dom-swap.mjs
 * Exits 0 on success, 1 on any assertion failure.
 */

import { readFileSync } from "node:fs";
import vm from "node:vm";
import path from "node:path";
import url from "node:url";
import { DOMParser } from "linkedom";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const REPO = path.resolve(here, "..");

const C = { reset: "\x1b[0m", red: "\x1b[31m", green: "\x1b[32m", dim: "\x1b[2m" };
const ok = (s) => `${C.green}${s}${C.reset}`;
const bad = (s) => `${C.red}${s}${C.reset}`;
const dim = (s) => `${C.dim}${s}${C.reset}`;
let failed = 0;
const assert = (cond, label) => {
  if (cond) console.log("  " + ok("✓") + " " + label);
  else { console.log("  " + bad("✗") + " " + label); failed++; }
};
const section = (s) => console.log("\n" + dim("━━━ ") + s + dim(" ━━━"));

// ─── Extract the functions from workbench.js into a sandbox ─────────────
const src = readFileSync(path.join(REPO, "public", "workbench.js"), "utf8");

function extractFn(name) {
  // Top-level functions in workbench.js start at column 0 and end with a
  // lone `}` at column 0. Brace-counting breaks on regex literals like
  // /\$\{\{/ (unbalanced braces inside), so use the layout convention.
  const startRe = new RegExp(`(?:^|\\n)function ${name}\\s*\\(`);
  const m = startRe.exec(src);
  if (!m) throw new Error(`function not found in workbench.js: ${name}`);
  const start = m.index === 0 ? 0 : m.index + 1;
  const endRe = /\n\}/g;
  endRe.lastIndex = start;
  const e = endRe.exec(src);
  if (!e) throw new Error(`end of function not found: ${name}`);
  return src.slice(start, e.index + 2);
}

const sandbox = {
  DOMParser,
  console,
  Node: { DOCUMENT_POSITION_FOLLOWING: 4, DOCUMENT_POSITION_PRECEDING: 2 },
};
vm.createContext(sandbox);
const code = [
  // Dependencies of replaceVisibleTextWithPlaceholders, in order.
  extractFn("normalizeCopyForMatch"),
  "const PH_NUM = (n) => String(n).padStart(2, '0');",
  "const PH_STR = (ns, n) => '${{ ' + ns + '.block_' + PH_NUM(n) + ' }}$';",
  extractFn("replaceVisibleTextWithPlaceholders"),
].join("\n\n");
vm.runInContext(code, sandbox);
const replaceFn = vm.runInContext("replaceVisibleTextWithPlaceholders", sandbox);

// ─── Fixture: structure that killed the real email ──────────────────────
// td.center wraps the WHOLE email through <center> (not a container tag in
// the old code) → old leaf-check passed it as candidate.
const EMAIL = `<!DOCTYPE PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd">
<html><head><title>t</title></head>
<body>
<div class="preheader" style="display:none">Withdrawal docs needed</div>
<table class="body"><tbody><tr>
<td align="center" valign="top" class="center">
  <center>
    <table class="container"><tr><td class="pt30">
      <table class="row header"><tr><td class="wrapper">
        <a href="https://example.com"><img src="logo.png" alt="logo"/></a>
      </td></tr></table>
      <table class="row"><tr><td>
        <h1>Your withdrawal request has been put on hold</h1>
        <p>Dear Client,</p>
        <p>Recently, you received an email informing that your withdrawal request has been put on hold. Unfortunately, we sent it from the wrong address and now we cannot receive the documents sent as a proof in reply emails.</p>
        <p>In order for us to be able to proceed, please provide us with the following document by replying to this email:</p>
        <p>the full page screenshot of your book bank, clearly showing your name and account number.</p>
      </td></tr></table>
    </td></tr></table>
  </center>
</td>
</tr></tbody></table>
</body></html>`;

const BLOCKS = [
  "Your withdrawal request has been put on hold",
  "Dear Client,",
  "Recently, you received an email informing that your withdrawal request has been put on hold. Unfortunately, we sent it from the wrong address and now we cannot receive the documents sent as a proof in reply emails.",
  "In order for us to be able to proceed, please provide us with the following document by replying to this email:",
  "the full page screenshot of your book bank, clearly showing your name and account number.",
];

section("placeholderize an email wrapped in td.center > center > table");
const res = replaceFn(EMAIL, "expay_withdrawal_docs", BLOCKS);

assert(res.count >= 4, `matched most blocks (${res.count}/${BLOCKS.length})`);
assert(!/\$\{\{ expay_withdrawal_docs\.block_\d+ \}\}\$\s*<\/center>/.test(res.html.replace(/\n/g, "")),
  "no placeholder directly swallowing the <center> wrapper");
// The killer assertion: structural elements must SURVIVE.
for (const marker of ["class=\"container\"", "class=\"row header\"", "img src=\"logo.png\"", "<h1>", "preheader"]) {
  assert(res.html.includes(marker.replace(/"/g, '"')) || res.html.includes(marker), `structure survived: ${marker}`);
}
// Each matched block became exactly one placeholder; body wasn't collapsed.
const phCount = (res.html.match(/\$\{\{ expay_withdrawal_docs\.block_\d+ \}\}\$/g) || []).length;
assert(phCount === res.count, `placeholders in HTML (${phCount}) === matched count (${res.count})`);
assert(res.html.length > EMAIL.length * 0.5, `document size sane (${res.html.length} vs ${EMAIL.length} original)`);

section("giant wrapper element is never matched");
{
  // Degenerate case: an email that is ONE td with plain text inside (no inner
  // containers at all). The td text CONTAINS block 0 → old containment rule
  // would swallow it. New ratio guard must reject.
  const FLAT = `<!DOCTYPE html><html><body><table><tr><td class="center">${"X".repeat(40)} ${BLOCKS[2]} ${"Y".repeat(400)}</td></tr></table></body></html>`;
  const r2 = replaceFn(FLAT, "ns", [BLOCKS[2]]);
  assert(r2.count === 0, `oversized containment match rejected (count=${r2.count})`);
  assert(r2.html.includes("YYYY"), "wrapper content intact");
}

section("exact match still works for long blocks");
{
  const longBlock = BLOCKS[2];
  const EX = `<!DOCTYPE html><html><body><table><tr><td><p>${longBlock}</p></td></tr></table></body></html>`;
  const r3 = replaceFn(EX, "ns", [longBlock]);
  assert(r3.count === 1, `exact long-block match ok (count=${r3.count})`);
  assert(r3.html.includes("${{ ns.block_00 }}$"), "placeholder substituted");
}

// ════════════════════════════════════════════════════════════════════════
section("unit-матчер: конвейер «нормализовать → юниты → расставить»");
{
  const { normalizeLocaleConventions, buildAnchorUnits } = await import("../src/locale-conventions.js");
  vm.runInContext(extractFn("findLinkWrap"), sandbox);
  vm.runInContext(extractFn("applyUnitToElement"), sandbox);
  vm.runInContext(extractFn("replaceUnitsWithPlaceholders"), sandbox);
  const replaceUnits = vm.runInContext("replaceUnitsWithPlaceholders", sandbox);

  const RAW_BROKEN = `Subject: Resend docs

{{Your withdrawal request has been put on hold}}

{{@@Dear Client,@@}}

{{If we can be of any further assistance, please do not hesitate to contact your account manager or {{embedded.company_email}}.}}

{{We appreciate you choosing our platform and for being part of {{embedded.brand_name}}.}}

{{Terms and Conditions}}`;

  const norm = normalizeLocaleConventions(RAW_BROKEN);
  const units = buildAnchorUnits(norm.txt, "expay_withdrawal_docs");

  const EMAIL2 = `<!DOCTYPE html><html><body>
<table><tr><td class="center"><center><table class="container"><tr><td>
<h1>Your withdrawal request has been put on hold</h1>
<p><b>Dear Client,</b></p>
<p>If we can be of any further assistance, please do not hesitate to contact your account manager or {{embedded.company_email}}.</p>
<p>We appreciate you choosing our platform and for being part of {{embedded.brand_name}}.</p>
<a href="https://x.example/terms">Terms and Conditions</a>
</td></tr></table></center></td></tr></table>
</body></html>`;

  const r = replaceUnits(EMAIL2, units);
  assert(r.count === 5, `все 5 юнитов расставлены (got ${r.count})`);
  assert(
    r.html.includes("${{ expay_withdrawal_docs.block_02 }}$ {{embedded.company_email}}${{ expay_withdrawal_docs.block_04 }}$"),
    "составной абзац: блок + литерал переменной + блок-точка"
  );
  assert(
    r.html.includes("${{ expay_withdrawal_docs.block_05 }}$ {{embedded.brand_name}}${{ expay_withdrawal_docs.block_07 }}$"),
    "второй составной абзац тоже"
  );
  assert(r.html.includes("${{ expay_withdrawal_docs.block_00 }}$"), "заголовок → block_00");
  assert((r.missed || []).length === 0, `missed пуст (got ${JSON.stringify(r.missed)})`);
  assert(r.html.includes('class="container"'), "структура письма цела");
  // КЛЮЧЕВОЕ: ссылка Terms and Conditions сохранила href, плейсхолдер внутри <a>.
  assert(
    /<a href="https:\/\/x\.example\/terms">\$\{\{ expay_withdrawal_docs\.block_\d+ \}\}\$<\/a>/.test(r.html),
    "ссылка <a href> сохранена, плейсхолдер ВНУТРИ неё (href не потерян)"
  );
}

// ════════════════════════════════════════════════════════════════════════
section("инлайн-ссылка ВНУТРИ абзаца: текст→плейсхолдеры, ссылка жива");
{
  const { normalizeLocaleConventions, buildAnchorUnits } = await import("../src/locale-conventions.js");
  vm.runInContext(extractFn("findLinkWrap"), sandbox);
  vm.runInContext(extractFn("applyUnitToElement"), sandbox);
  vm.runInContext(extractFn("replaceUnitsWithPlaceholders"), sandbox);
  const replaceUnits = vm.runInContext("replaceUnitsWithPlaceholders", sandbox);

  // Письмо: переменная company_email обёрнута в mailto-ссылку ВНУТРИ абзаца.
  const RAW = `{{If you have any questions, you can contact us at {{embedded.company_email}}.}}`;
  const units = buildAnchorUnits(normalizeLocaleConventions(RAW).txt, "ns");
  const EMAIL = `<!DOCTYPE html><html><body><table><tr><td>
<p>If you have any questions, you can contact us at <a href="mailto:support@x.com">{{embedded.company_email}}</a>.</p>
</td></tr></table></body></html>`;

  const r = replaceUnits(EMAIL, units);
  assert(r.count === 1, `абзац со ссылкой расставлен (got ${r.count})`);
  assert(r.html.includes('<a href="mailto:support@x.com">{{embedded.company_email}}</a>'),
    "mailto-ссылка вокруг переменной СОХРАНЕНА");
  assert(/\$\{\{ ns\.block_00 \}\}\$ <a href="mailto:support@x\.com">\{\{embedded\.company_email\}\}<\/a>\$\{\{ ns\.block_02 \}\}\$/.test(r.html),
    "текст до/после → плейсхолдеры, ссылка с переменной между ними");
}

section("переменная в HREF ссылки, видимый текст — переводимый блок");
{
  const { normalizeLocaleConventions, buildAnchorUnits } = await import("../src/locale-conventions.js");
  const replaceUnits = vm.runInContext("replaceUnitsWithPlaceholders", sandbox);
  // mailto:{{embedded.company_email}} в href, текст ссылки = обычный блок, хвост "anytime."
  const RAW = `{{If you have questions}} {{contact our support team}} {{anytime.}}`;
  const units = buildAnchorUnits(normalizeLocaleConventions(RAW).txt, "ns");
  const EMAIL = `<!DOCTYPE html><html><body><p>If you have questions <a href="mailto:{{embedded.company_email}}">contact our support team</a> anytime.</p></body></html>`;
  const r = replaceUnits(EMAIL, units);
  assert(r.count === 1, `абзац матчится несмотря на 'anytime.' и переменную в href (got ${r.count})`);
  assert(r.html.includes('href="mailto:{{embedded.company_email}}"'), "переменная в HREF сохранена");
  assert(/\$\{\{ ns\.block_00 \}\}\$ <a href="mailto:\{\{embedded\.company_email\}\}">\$\{\{ ns\.block_01 \}\}\$<\/a> \$\{\{ ns\.block_02 \}\}\$/.test(r.html),
    "текст→плейсхолдеры, ссылка с href-переменной, видимый текст = block_01");
}

section("инлайн-ссылка вокруг ТЕКСТА (не переменной) внутри абзаца");
{
  const { normalizeLocaleConventions, buildAnchorUnits } = await import("../src/locale-conventions.js");
  const replaceUnits = vm.runInContext("replaceUnitsWithPlaceholders", sandbox);
  // "visit our website" — кусок текста, обёрнут в ссылку. В локали это отдельный блок.
  const RAW = `{{Please}} {{visit our website}} {{for more info.}}`;
  const units = buildAnchorUnits(normalizeLocaleConventions(RAW).txt, "ns");
  const EMAIL = `<!DOCTYPE html><html><body><p>Please <a href="https://site.com">visit our website</a> for more info.</p></body></html>`;
  const r = replaceUnits(EMAIL, units);
  assert(r.html.includes('<a href="https://site.com">${{ ns.block_01 }}$</a>'),
    "ссылка вокруг текстового блока сохранена, плейсхолдер внутри неё");
}

section("Verdict");
if (failed) {
  console.log(bad(`\n✗ ${failed} assertion(s) failed.\n`));
  process.exit(1);
} else {
  console.log(ok("\n✓ All assertions passed. DOM-swap placeholderize is safe again.\n"));
  process.exit(0);
}
