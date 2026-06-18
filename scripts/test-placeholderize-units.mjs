#!/usr/bin/env node
/**
 * scripts/test-placeholderize-units.mjs — NEW 2026-06-11
 *
 * placeholderizeHtml + анкер-юниты конвенций: абзац с {{embedded.*}}-переменной
 * («{{text}} {{var}}{{.}}» в TXT) анкерится как ОДИН юнит, а подстановка
 * раскладывает его в «${{ ns.block_NN }}$ {{var}}${{ ns.block_MM }}$» —
 * переменная остаётся литералом для платформы рассылки.
 * AI замокан (__OPENAI_TEST_MOCK), вся остальная машинерия настоящая.
 *
 * Run:  node scripts/test-placeholderize-units.mjs
 */

import { placeholderizeHtml } from "../src/locale-ai.js";

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

const REF_TXT = `Subject: Resend your documents

{{Your withdrawal request has been put on hold}}

{{@@Dear Client,@@}}

{{If we can be of any further assistance, please do not hesitate to contact your account manager or}} {{embedded.company_email}}{{.}}

{{Terms and Conditions}}`;

const HTML = `<!DOCTYPE html><html><body>
<table><tr><td>
<h1>Your withdrawal request has been put on hold</h1>
<p><b>Dear Client,</b></p>
<p>If we can be of any further assistance, please do not hesitate to contact your account manager or {{embedded.company_email}}.</p>
<a href="https://x.example/terms">Terms and Conditions</a>
</td></tr></table>
</body></html>`;

section("юниты доезжают до AI-запроса");
let capturedPayload = null;
globalThis.__OPENAI_TEST_MOCK = async ({ body }) => {
  // Первый вызов — primary pass. Сохраним payload, ответим маппингом.
  const user = body.input.find((m) => m.role === "user");
  capturedPayload = JSON.parse(user.content[0].text);
  // Замапим юниты на элементы по точному совпадению текста.
  const mappings = [];
  for (const rb of capturedPayload.refBlocks) {
    const el = capturedPayload.elements.find((e) => e.text.replace(/\s+/g, " ").trim() === rb.text.replace(/\s+/g, " ").trim());
    if (el) mappings.push({ blockIndex: rb.blockIndex, elementId: el.id, confidence: 0.95 });
  }
  return { output_text: JSON.stringify({ mappings }) };
};

try {
  const result = await placeholderizeHtml({
    html: HTML,
    refLocaleTxt: REF_TXT,
    namespace: "expay_withdrawal_docs",
    apiKey: "test",
  });

  assert(capturedPayload !== null, "AI получил payload");
  const unitTexts = capturedPayload.refBlocks.map((b) => b.text);
  assert(unitTexts.length === 4, `4 анкер-юнита вместо 6 сырых блоков (got ${unitTexts.length})`);
  const composite = unitTexts.find((t) => t.includes("account manager"));
  assert(
    composite === "If we can be of any further assistance, please do not hesitate to contact your account manager or {{embedded.company_email}}.",
    `составной юнит содержит переменную литералом: "${(composite || "").slice(-55)}"`
  );
  assert(unitTexts.some((t) => t === "Dear Client,"), "@@ маркеры сняты для матчинга");

  section("подстановка");
  assert(result.anchors === 4, `4 анкера поставлено (got ${result.anchors})`);
  assert(
    result.html.includes("${{ expay_withdrawal_docs.block_02 }}$ {{embedded.company_email}}${{ expay_withdrawal_docs.block_04 }}$"),
    "составной абзац: блок + литерал переменной + блок-точка"
  );
  assert(result.html.includes("${{ expay_withdrawal_docs.block_00 }}$"), "заголовок → block_00");
  assert(result.html.includes("${{ expay_withdrawal_docs.block_01 }}$"), "Dear Client → block_01");
  assert(result.html.includes("${{ expay_withdrawal_docs.block_05 }}$"), "Terms → block_05 (сквозная нумерация с переменной)");
  assert(!/\$\{\{ expay_withdrawal_docs\.block_03 \}\}\$/.test(result.html), "block_03 (сама переменная) НЕ анкерится как текст");
  assert(result.report.unitCount === 4, "report.unitCount = 4");
  assert(result.missed.length === 0, `ничего не потеряно (missed: ${result.missed})`);
} finally {
  delete globalThis.__OPENAI_TEST_MOCK;
}

section("Verdict");
if (failed) {
  console.log(bad(`\n✗ ${failed} assertion(s) failed.\n`));
  process.exit(1);
} else {
  console.log(ok("\n✓ Placeholderize понимает конвенции: переменные остаются литералами.\n"));
  process.exit(0);
}
