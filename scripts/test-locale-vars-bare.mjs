#!/usr/bin/env node
/**
 * scripts/test-locale-vars-bare.mjs — NEW 2026-06-11
 *
 * Голые переменные-плейсхолдеры без точки/подчёркивания (amount, currency,
 * reason) ДОЛЖНЫ распознаваться как системные переменные. Иначе нормализатор
 * оставлял их вложенными → ломал скобки в блоке (баг «всё ломает»: EN получал
 * `{{for a total amount of{ {{amount}}`, `at}}}}`, `{{{{.}}`).
 *
 * Фикстур — самый сложный блок реального письма iqoption_payout_cancelled:
 * один абзац с op_id + amount + currency.
 *
 * Run:  node scripts/test-locale-vars-bare.mjs
 */

import {
  isSystemVariable,
  normalizeLocaleConventions,
  parseNormalizedBlocks,
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

section("эвристика: голые переменные");
assert(isSystemVariable("amount"), "amount → переменная");
assert(isSystemVariable("currency"), "currency → переменная");
assert(isSystemVariable("reason"), "reason → переменная");
assert(isSystemVariable("op_id"), "op_id → переменная (underscore)");
assert(isSystemVariable("embedded.user_full_name"), "embedded.user_full_name → переменная");
assert(!isSystemVariable("Hi"), "Hi → текст (заглавная)");
assert(!isSystemVariable("Reason:"), "Reason: → текст (двоеточие)");
assert(!isSystemVariable("Terms and Conditions"), "фраза с пробелами → текст");
assert(!isSystemVariable(","), "запятая → текст");
assert(!isSystemVariable("a"), "одна буква → текст");
// Слово с точкой В КОНЦЕ — текст, не переменная (баг с трейлинг-точкой).
assert(!isSystemVariable("anytime."), "anytime. → текст (точка в конце)");
assert(!isSystemVariable("below."), "below. → текст");
assert(!isSystemVariable("info."), "info. → текст");
assert(!isSystemVariable("request."), "request. → текст");
assert(isSystemVariable("embedded.company_email"), "embedded.company_email → переменная (полная)");

section("сложный блок с тремя голыми переменными → чистая разбивка");
{
  const RAW = `{{We are sorry to inform you that your withdrawal request {{op_id}} for a total amount of {{amount}} {{currency}} has been canceled. You may find the details below.}}`;
  const r = normalizeLocaleConventions(RAW);
  // Скобки сбалансированы: число {{ == число }}.
  const opens = (r.txt.match(/\{\{/g) || []).length;
  const closes = (r.txt.match(/\}\}/g) || []).length;
  assert(opens === closes, `скобки сбалансированы (${opens} {{ vs ${closes} }})`);
  assert(!/\{\{\{|\}\}\}/.test(r.txt), "нет тройных скобок (мусора)");
  assert(!/of\{\s/.test(r.txt), "нет одиночного { (как в баге `of{ {{amount}}`)");
  const blocks = parseNormalizedBlocks(r.txt);
  // text, op_id, text, amount, currency, text = 6
  assert(blocks.length === 6, `6 блоков (got ${blocks.length}): ${JSON.stringify(blocks)}`);
  assert(blocks[1] === "op_id", "block 1 = op_id");
  assert(blocks[3] === "amount", "block 3 = amount");
  assert(blocks[4] === "currency", "block 4 = currency (соседняя переменная)");
  assert(blocks[0].startsWith("We are sorry"), "block 0 = текст до op_id");
  assert(blocks[5].startsWith("has been canceled"), "block 5 = хвост");
}

section("анкер-юниты: весь абзац = один юнит, переменные литералами");
{
  const RAW = `{{We are sorry your request {{op_id}} for {{amount}} {{currency}} was canceled.}}`;
  const norm = normalizeLocaleConventions(RAW).txt;
  const units = buildAnchorUnits(norm, "ns");
  assert(units.length === 1, `один юнит-абзац (got ${units.length})`);
  const u = units[0];
  assert(u.visibleText.includes("{{op_id}}") && u.visibleText.includes("{{amount}}"), "visibleText содержит переменные литералом");
  assert(/\$\{\{ ns\.block_\d+ \}\}\$ \{\{op_id\}\}/.test(u.replacement), "replacement: текст-блок + литерал op_id");
  assert(u.replacement.includes("{{amount}} {{currency}}"), "amount/currency остаются литералами рядом");
}

section("greeting block: {{Hi {{embedded.user_full_name}},}} → текст + var + запятая");
{
  const RAW = `{{Hi {{embedded.user_full_name}},}}`;
  const blocks = parseNormalizedBlocks(normalizeLocaleConventions(RAW).txt);
  assert(blocks.length === 3, `3 блока (got ${blocks.length}): ${JSON.stringify(blocks)}`);
  assert(blocks[0] === "Hi", "block 0 = Hi (текст)");
  assert(blocks[1] === "embedded.user_full_name", "block 1 = переменная");
  assert(blocks[2] === ",", "block 2 = запятая");
}

section("Verdict");
if (failed) {
  console.log(bad(`\n✗ ${failed} assertion(s) failed.\n`));
  process.exit(1);
} else {
  console.log(ok("\n✓ Голые переменные распознаются, скобки не ломаются.\n"));
  process.exit(0);
}
