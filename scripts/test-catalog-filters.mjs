#!/usr/bin/env node
/**
 * test-catalog-filters.mjs — каталог не должен прятать то, что человек ищет.
 *
 * Живой случай. Человек поставил галочку «мобильные» и вкладка «Комбо»
 * показала ноль из девяноста трёх. Пропал sys-starter — единственное комбо
 * системного набора, то самое «простое письмо: заголовок, приветствие, текст,
 * зелёная подсветка, кнопка, футер», с которого начинают.
 *
 * Причина: «мобильность» считалась по собственным стилям блока. У комбо своих
 * стилей почти нет — это сборка из других блоков, и медиазапросы живут у
 * детей. То есть галочка прятала ВСЕ комбо разом, и заметить это можно было
 * только наткнувшись.
 *
 * Здесь же закреплено второе: обёртку студия ставит сама при первой секции, и
 * каталог не должен делать вид, что с неё надо начинать.
 *
 * Zero-AI, без сети. Exit 0 = pass.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import url from "node:url";
import { listCanonicalBlocks } from "../src/compose-email.js";

const repoRoot = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const check = (name, cond, extra = "") => {
  if (cond) { pass++; console.log("  \x1b[32m✓\x1b[0m", name); }
  else { fail++; console.error(`  \x1b[31m✗ ${name}\x1b[0m ${extra}`); }
};
const read = (...parts) => readFileSync(path.join(repoRoot, ...parts), "utf8");

const library = listCanonicalBlocks();
const byId = new Map(library.map((block) => [block.id, block]));

/** То же правило, что в public/constructor.js. */
const hasMobile = (block) => {
  if (/@media/i.test(block?.styl || "")) return true;
  return (block?.children || []).some((child) => (
    /@media/i.test(byId.get(String(child?.id || ""))?.styl || "")
  ));
};

/* ─── 1. Тот самый случай ────────────────────────────────────────────────── */
{
  const starter = byId.get("sys-starter");
  check("комбо простого письма на месте", Boolean(starter));
  check("оно помечено как комбо", starter?.combo === true || (starter?.tags || []).includes("combo"));
  check("и входит в системный набор", (starter?.kits || []).includes("system"));

  // Вот из-за чего оно пропадало: своих медиазапросов у комбо нет.
  check("своих медиазапросов у комбо нет", !/@media/i.test(starter?.styl || ""),
    "если появятся — проверка перестанет стеречь настоящую причину");
  check("но мобильная вёрстка у него есть — через детей", hasMobile(starter) === true);

  const combos = library.filter((block) => block.combo === true || (block.tags || []).includes("combo"));
  const hiddenByOldRule = combos.filter((block) => !/@media/i.test(block.styl || ""));
  const rescued = hiddenByOldRule.filter((block) => hasMobile(block));
  check("старое правило прятало комбо", hiddenByOldRule.length >= 1,
    `комбо без своих медиазапросов: ${hiddenByOldRule.length}`);
  check("новое правило возвращает их в каталог", rescued.length === hiddenByOldRule.length,
    `спасено ${rescued.length} из ${hiddenByOldRule.length}: ${hiddenByOldRule.filter((b) => !hasMobile(b)).map((b) => b.id).join(", ")}`);
}

/* ─── 2. Правило живёт в конструкторе, а не только здесь ─────────────────── */
{
  const source = read("public", "constructor.js");
  check("мобильность считается и по детям", /Array\.isArray\(b\?\.children\)/.test(source));
  check("и объяснено, почему", /медиазапросы\s*\n?\s*\*?\s*живут у детей/.test(source.replace(/\s+/g, " "))
    || /медиазапросы живут у детей/.test(source.replace(/\s+/g, " ")));
}

/* ─── 3. Обёртка ставится сама ───────────────────────────────────────────── */
{
  const source = read("public", "constructor.js");
  check("обёртка достраивается сама", /function ensureOuterForMutation/.test(source));
  // Подсказка раньше звала начинать с обёртки — то есть делать руками то,
  // что студия делает без человека.
  check("подсказка не зовёт начинать с обёртки",
    !/Начни с обёртки/.test(source), "обёртку студия ставит сама");
  check("и прямо говорит, кто её ставит", /обёртку студия поставит сама|Обёртку письма студия добавит сама/i.test(source));

  const html = read("public", "constructor.html");
  check("каталог открывается на готовых кусках", /data-filter="combo"[^>]*\n?[^>]*active|class="cat-tab active" data-filter="combo"/.test(html)
    || /cat-tab active[^>]*data-filter="combo"/.test(html));
  check("вкладка обёрток объясняет, зачем она", /Ставится сама при первой секции/.test(html));
}

console.log(`\ncatalog-filters: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
