#!/usr/bin/env node
/**
 * scripts/test-locale-align.mjs — NEW 2026-06-11
 *
 * Выравнивание локалей по эталону (alignLocaleToReference): у всех локалей
 * одинаковое число блоков, переменные на тех же позициях, нехватка текста →
 * пустой блок-спейсер. Якоря — системные переменные.
 *
 * Run:  node scripts/test-locale-align.mjs
 */

import {
  normalizeLocaleConventions,
  parseNormalizedBlocks,
  alignLocaleToReference,
  serializeAligned,
  localePrefix,
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

// Эталон EN после нормализации: 6 блоков, 1 переменная-якорь.
const EN_RAW = `{{Hello}}

{{Contact us at {{embedded.company_email}}.}}

{{Terms and Conditions}}`;

const enNorm = normalizeLocaleConventions(EN_RAW).txt;
const enBlocks = parseNormalizedBlocks(enNorm);
// enBlocks = [Hello, Contact us at, embedded.company_email, ., Terms and Conditions] = 5

section("эталон");
assert(enBlocks.length === 5, `эталон = 5 блоков (got ${enBlocks.length})`);
assert(enBlocks[2] === "embedded.company_email", "переменная на позиции 2");

section("локаль КОРОЧЕ эталона → пустые спейсеры");
{
  // RU без "Terms and Conditions" блока и без точки после переменной.
  const RU_RAW = `{{Привет}}

{{Свяжитесь с нами {{embedded.company_email}}}}`;
  const ruNorm = normalizeLocaleConventions(RU_RAW).txt;
  const ruBlocks = parseNormalizedBlocks(ruNorm);
  const aligned = alignLocaleToReference(enBlocks, ruBlocks);
  assert(aligned.blocks.length === 5, `выровнено до 5 блоков (got ${aligned.blocks.length})`);
  assert(aligned.blocks[0] === "Привет", "block_00 = перевод");
  assert(aligned.blocks[1] === "Свяжитесь с нами", "block_01 = перевод (текст до переменной)");
  assert(aligned.blocks[2] === "embedded.company_email", "block_02 = переменная из эталона");
  assert(aligned.blocks[3] === "", "block_03 = пустой спейсер (в RU не было точки)");
  assert(aligned.blocks[4] === "", "block_04 = пустой спейсер (в RU не было Terms)");
  assert(aligned.padded === 2, "запомнил 2 пустых добивки");
}

section("локаль ДЛИННЕЕ в сегменте → склейка в последний слот, без потери");
{
  // Локаль, где до переменной два предложения вместо одного.
  const DE_RAW = `{{Hallo}}

{{Kontakt. Bitte {{embedded.company_email}}.}}

{{AGB}}`;
  const deNorm = normalizeLocaleConventions(DE_RAW).txt;
  const deBlocks = parseNormalizedBlocks(deNorm);
  // deBlocks = [Hallo, Kontakt. Bitte, embedded..., ., AGB] — здесь сегмент до var = 1 текст, ок
  const aligned = alignLocaleToReference(enBlocks, deBlocks);
  assert(aligned.blocks.length === 5, "DE выровнено до 5");
  assert(aligned.blocks[4] === "AGB", "Terms-слот заполнен переводом AGB");
  assert(aligned.padded === 0, "DE: добивок не понадобилось");
}

section("идемпотентность: выровненная локаль = эталон по структуре");
{
  const aligned = alignLocaleToReference(enBlocks, enBlocks);
  assert(aligned.blocks.length === 5 && aligned.padded === 0, "эталон сам с собой не меняется");
  assert(JSON.stringify(aligned.blocks) === JSON.stringify(enBlocks), "блоки идентичны");
}

section("serializeAligned сохраняет Subject-prefix");
{
  const RU = `Subject: Тест\n\n{{Привет}}\n\n{{Пока}}`;
  const prefix = localePrefix(RU);
  assert(/^Subject: Тест/.test(prefix), "prefix содержит Subject");
  const out = serializeAligned(prefix, ["Привет", "", "Пока"]);
  assert(/^Subject: Тест/.test(out), "Subject сохранён в начале");
  assert(out.includes("{{}}"), "пустой блок сериализуется как {{}}");
  assert(parseNormalizedBlocks(out).length === 3, "3 блока на выходе");
}

section("Verdict");
if (failed) {
  console.log(bad(`\n✗ ${failed} assertion(s) failed.\n`));
  process.exit(1);
} else {
  console.log(ok("\n✓ Выравнивание по эталону работает: одинаковое число блоков, пустые спейсеры.\n"));
  process.exit(0);
}
