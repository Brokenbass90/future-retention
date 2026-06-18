#!/usr/bin/env node
/**
 * scripts/test-locale-conventions.mjs — NEW 2026-06-11
 *
 * Конвенции локалей (src/locale-conventions.js) на ТОЧНОМ фикстуре
 * пользователя: «как было с косяками» → «как должно быть».
 * Плюс анкер-юниты для placeholderize и эвристика переменных.
 *
 * Run:  node scripts/test-locale-conventions.mjs
 */

import {
  isSystemVariable,
  tokenizeLocaleTxt,
  normalizeLocaleConventions,
  buildAnchorUnits,
} from "../src/locale-conventions.js";

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

// ─── Точный фикстур пользователя ────────────────────────────────────────
const BEFORE = `Subject: Resend your documents to verify withdrawal request

{{Your withdrawal request has been put on hold}}

{{@@Dear Client,@@}}

{{Recently, you received an email informing that your withdrawal request has been put on hold. Unfortunately, we’ve accidentally sent it from the wrong address (happens to the best of us 🤷) and now we can’t receive the documents sent as a proof in reply emails.}}

{{In order for us to be able to proceed, please provide us with the following document by replying to this (100% correct) email:}}

{{the full page screenshot of your book bank, clearly showing your name and account number.}}

{{Please note that the withdrawal request will be on hold for 24 hours in order for you to submit your documents and if there is no reply after that period the withdrawal will be cancelled automatically.}}

{{If we can be of any further assistance, please do not hesitate to contact your account manager or {{embedded.company_email}}.}}

{{We appreciate you choosing our platform and for being part of {{embedded.brand_name}}.}}

{{Terms and Conditions}}`;

const AFTER_EXPECTED = `Subject: Resend your documents to verify withdrawal request

{{Your withdrawal request has been put on hold}}

{{@@Dear Client,@@}}

{{Recently, you received an email informing that your withdrawal request has been put on hold. Unfortunately, we’ve accidentally sent it from the wrong address (happens to the best of us 🤷) and now we can’t receive the documents sent as a proof in reply emails.}}

{{In order for us to be able to proceed, please provide us with the following document by replying to this (100% correct) email:}}

{{the full page screenshot of your book bank, clearly showing your name and account number.}}

{{Please note that the withdrawal request will be on hold for 24 hours in order for you to submit your documents and if there is no reply after that period the withdrawal will be cancelled automatically.}}

{{If we can be of any further assistance, please do not hesitate to contact your account manager or}} {{embedded.company_email}}{{.}}

{{We appreciate you choosing our platform and for being part of}} {{embedded.brand_name}}{{.}}

{{Terms and Conditions}}`;

section("эвристика системных переменных");
assert(isSystemVariable("embedded.company_email"), "embedded.company_email → переменная");
assert(isSystemVariable("embedded.brand_name"), "embedded.brand_name → переменная");
assert(isSystemVariable("user_name"), "user_name → переменная");
assert(isSystemVariable("Level_Name"), "Level_Name → переменная");
assert(!isSystemVariable("Hello"), "Hello → текст (нет ._)");
assert(!isSystemVariable("."), "одиночная точка → текст");
assert(!isSystemVariable("Dear Client,"), "фраза с пробелом → текст");
assert(!isSystemVariable("@@Dear Client,@@"), "жирный маркер → текст");

section("nesting-aware токенизатор");
{
  const toks = tokenizeLocaleTxt("{{a {{embedded.x}} b}} tail");
  const blocks = toks.filter((t) => t.type === "block");
  assert(blocks.length === 1, "вложенный блок захвачен ЦЕЛИКОМ (1 внешний блок)");
  assert(blocks[0].inner === "a {{embedded.x}} b", `inner полный: "${blocks[0].inner}"`);
}

section("normalizeLocaleConventions — фикстур пользователя 1:1");
{
  const r = normalizeLocaleConventions(BEFORE);
  assert(r.changed, "файл распознан как требующий правки");
  if (r.txt !== AFTER_EXPECTED) {
    // Показать первое расхождение для отладки.
    let i = 0;
    while (i < r.txt.length && r.txt[i] === AFTER_EXPECTED[i]) i += 1;
    console.log(dim(`  расхождение @${i}:`));
    console.log(dim(`  got:      …${JSON.stringify(r.txt.slice(Math.max(0, i - 40), i + 40))}…`));
    console.log(dim(`  expected: …${JSON.stringify(AFTER_EXPECTED.slice(Math.max(0, i - 40), i + 40))}…`));
  }
  assert(r.txt === AFTER_EXPECTED, "результат побайтно равен эталону пользователя");
  assert(r.changes.filter((c) => c.type === "split_variables").length === 2, "2 блока разбиты вокруг переменных");
  // Идемпотентность: повторный прогон ничего не меняет.
  const r2 = normalizeLocaleConventions(r.txt);
  assert(!r2.changed, "идемпотентно: повторная нормализация без изменений");
  assert(r2.txt === AFTER_EXPECTED, "повторный прогон не портит файл");
}

section("починка незакрытой переменной");
{
  const broken = "{{contact us at {{embedded.company_email and thanks}}";
  const r = normalizeLocaleConventions(broken);
  assert(/\{\{embedded\.company_email\}\}/.test(r.txt), "незакрытая {{embedded.x закрыта");
  assert(r.changes.some((c) => c.type === "closed_variable"), "зафиксировано изменение closed_variable");
}

section("buildAnchorUnits — юниты для placeholderize");
{
  const units = buildAnchorUnits(AFTER_EXPECTED, "expay_withdrawal_docs");
  // Блоков всего: 7 текстовых абзацев + (текст+вар+точка)×2 = 7 + 6 = 13.
  const allBlocks = units.flatMap((u) => u.blockIndexes);
  assert(allBlocks.length === 13, `13 блоков сквозной нумерации (got ${allBlocks.length})`);
  assert(units.length === 9, `9 юнитов-абзацев (got ${units.length})`);

  const emailUnit = units.find((u) => u.visibleText.includes("account manager"));
  assert(!!emailUnit, "юнит с company_email найден");
  assert(emailUnit.blockIndexes.length === 3, "юнит объединяет 3 блока (текст+вар+точка)");
  assert(
    emailUnit.visibleText === "If we can be of any further assistance, please do not hesitate to contact your account manager or {{embedded.company_email}}.",
    `visibleText соответствует видимому тексту письма: "${emailUnit.visibleText.slice(-60)}"`
  );
  assert(
    emailUnit.replacement === "${{ expay_withdrawal_docs.block_06 }}$ {{embedded.company_email}}${{ expay_withdrawal_docs.block_08 }}$",
    `replacement: ${emailUnit.replacement}`
  );

  const brandUnit = units.find((u) => u.visibleText.includes("brand_name"));
  assert(
    brandUnit.replacement === "${{ expay_withdrawal_docs.block_09 }}$ {{embedded.brand_name}}${{ expay_withdrawal_docs.block_11 }}$",
    `brand replacement: ${brandUnit.replacement}`
  );

  const simpleUnit = units[0];
  assert(simpleUnit.replacement === "${{ expay_withdrawal_docs.block_00 }}$", "обычный абзац = один плейсхолдер");
  assert(units.every((u) => !u.varOnly), "var-only юнитов нет в этом файле");
}

section("Verdict");
if (failed) {
  console.log(bad(`\n✗ ${failed} assertion(s) failed.\n`));
  process.exit(1);
} else {
  console.log(ok("\n✓ Конвенции работают. before→after юзера воспроизводится 1:1.\n"));
  process.exit(0);
}
