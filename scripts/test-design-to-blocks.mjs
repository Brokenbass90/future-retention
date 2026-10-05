#!/usr/bin/env node
/**
 * test-design-to-blocks.mjs — секция макета → блоки каталога.
 *
 * Про что этот шаг. «Переработка макета» — это НЕ перевод пикселей в вёрстку:
 * макет живёт в абсолютных координатах, а письмо — поток таблиц, который
 * должен выжить в Outlook и Gmail. Отображения один в один между ними нет, и
 * буквальная конвертация даёт вёрстку, красивую в браузере и разваливающуюся
 * в почте.
 *
 * Работающий путь: макет говорит ЧТО и в каком порядке, а КАК это верстается,
 * знают блоки каталога — каждый уже проверен на почтовиках. Остаётся
 * сопоставление, и делается оно по СТРУКТУРЕ, а не по названиям: сколько
 * картинок, колонок, текста, есть ли кнопка, какая подложка. Имена внешность
 * не описывают — «hero-2» не говорит ни о чём.
 *
 * Здесь стережём три вещи:
 *   1) очевидные секции попадают в очевидные блоки (кнопка → кнопка);
 *   2) картинка ФОНОМ под текстом не уезжает в блок без картинки — это
 *      разная вёрстка, и в Outlook такое письмо выглядит пустым;
 *   3) когда похожего блока нет, это говорится прямо, а не подгоняется.
 *
 * Zero-AI, без сети. Exit 0 = pass.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import url from "node:url";
import { planFromFigmaImport } from "../src/figma-intake.js";
import { matchSectionsToBlocks, describeMatches, sectionShape } from "../src/design-to-blocks.js";
import { attachPreviews } from "../src/block-previews.js";
import { listCanonicalBlocks } from "../src/compose-email.js";

const repoRoot = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const check = (name, cond, extra = "") => {
  if (cond) { pass++; console.log("  \x1b[32m✓\x1b[0m", name); }
  else { fail++; console.error(`  \x1b[31m✗ ${name}\x1b[0m ${extra}`); }
};
const read = (...parts) => readFileSync(path.join(repoRoot, ...parts), "utf8");

const catalog = attachPreviews(listCanonicalBlocks());
const system = catalog.filter((block) => (block.kits || []).includes("system"));

/* ─── 1. Что студия видит в секции ───────────────────────────────────────── */
{
  const button = sectionShape({
    width: 552, height: 90, columns: 1, background: "#FF7A00",
    texts: [{ text: "Deposit & trade", size: 16 }], images: [],
  });
  // Отдельного признака «это кнопка» в Figma нет, а имена слоёв называют как
  // попало — поэтому судим по форме: короткая надпись на своей заливке.
  check("кнопка узнаётся по форме", button.looksLikeButton === true, JSON.stringify(button));

  const paragraph = sectionShape({
    width: 552, height: 220, columns: 1, background: "",
    texts: [{ text: "x".repeat(140), size: 15 }], images: [],
  });
  check("абзац кнопкой не считается", paragraph.looksLikeButton === false);

  const hero = sectionShape({
    width: 600, height: 320, columns: 1, background: "#1A1A1A",
    texts: [{ text: "Заголовок", size: 28 }],
    images: [{ role: "background", width: 600, height: 320 }],
  });
  check("картинка фоном отмечена отдельно", hero.backgroundImage === true);
  check("и не считается контентной картинкой", hero.images === 0);
}

/* ─── 2. Очевидное попадает в очевидное ──────────────────────────────────── */
{
  const plan = planFromFigmaImport({
    frameSize: { width: 600, height: 900 },
    sections: [
      { name: "CTA", y: 700, x: 24, width: 552, height: 90, columnCount: 1, style: { bgColor: "#FF7A00" } },
      { name: "Футер", y: 820, x: 0, width: 600, height: 200, columnCount: 1, style: { bgColor: "#F9F9F9" } },
      { name: "Две колонки", y: 400, x: 24, width: 552, height: 180, columnCount: 2, style: {} },
    ],
    texts: [
      { x: 200, y: 730, text: "Deposit & trade", fontSize: 16 },
      { x: 40, y: 880, text: "IQ Option Ltd. Risk warning. Terms and Conditions. Unsubscribe", fontSize: 11 },
      { x: 40, y: 430, text: "Левая колонка с текстом", fontSize: 14 },
      { x: 300, y: 430, text: "Правая колонка с текстом", fontSize: 14 },
    ],
    images: [],
  });
  const match = matchSectionsToBlocks({ plan, blocks: system });
  const pick = (order) => match.sections.find((section) => section.order === order)?.candidates.map((c) => c.id) || [];

  const cta = match.sections.find((section) => /CTA/i.test(section.name));
  check("кнопка макета → блок кнопки", pick(cta.order)[0] === "sys-button", pick(cta.order).join(", "));

  const footer = match.sections.find((section) => /Футер/i.test(section.name));
  check("футер макета → блок футера", pick(footer.order)[0] === "sys-footer", pick(footer.order).join(", "));

  const columns = match.sections.find((section) => /колонки/i.test(section.name));
  check("две колонки → блок с двумя колонками",
    pick(columns.order).includes("sys-two-columns"), pick(columns.order).join(", "));
}

/* ─── 3. Картинка фоном не уезжает в блок без картинки ───────────────────── */
{
  const plan = planFromFigmaImport({
    frameSize: { width: 600, height: 400 },
    sections: [{ name: "Hero", y: 0, x: 0, width: 600, height: 320, columnCount: 1, style: { bgColor: "#1A1A1A" } }],
    texts: [{ x: 40, y: 200, text: "Diego's $50 Lesson", fontSize: 28 }],
    images: [{ x: 0, y: 0, width: 600, height: 320, name: "hero" }],
  });
  const match = matchSectionsToBlocks({ plan, blocks: system });
  const best = match.sections[0].candidates[0];
  const bestBlock = system.find((block) => block.id === best.id);
  // Формально «подсветка» подходила: текста столько же, подложка есть. Но
  // картинку под текстом она не умеет, и письмо разъехалось бы.
  check("секция с картинкой фоном идёт в блок с картинкой",
    (bestBlock?.preview?.signature?.images || 0) > 0,
    `${best.id}: картинок ${bestBlock?.preview?.signature?.images}`);
}

/* ─── 4. Нет похожего — так и сказано ────────────────────────────────────── */
{
  // Секция, которой в системном наборе соответствовать нечему: шесть колонок.
  const plan = planFromFigmaImport({
    frameSize: { width: 600, height: 300 },
    sections: [{ name: "Сетка", y: 0, x: 0, width: 600, height: 260, columnCount: 6, style: {} }],
    texts: [{ x: 10, y: 20, text: "x".repeat(900), fontSize: 12 }],
    images: [],
  });
  const match = matchSectionsToBlocks({ plan, blocks: system });
  check("невозможная секция помечена как «нужен новый блок»",
    match.sections[0].needsNewBlock === true, JSON.stringify(match.sections[0].candidates));
  check("и перечислена отдельно", match.uncovered.length === 1);
  check("пересказ зовёт завести блок, а не подгонять",
    /завести новый блок по образцу соседа/.test(describeMatches(match)));
}

/* ─── 5. Подбор доезжает до человека и до агента ─────────────────────────── */
{
  const routes = read("src", "routes", "figma-routes.js");
  check("ручка вставки отдаёт подбор", /matchSectionsToBlocks\(\{ plan, blocks: catalog\(\) \}\)/.test(routes));
  check("и его пересказ", /matchSummary: describeMatches\(match\)/.test(routes));

  const panel = read("public", "figma-paste.js");
  check("окно показывает, чем собирать", /function matchRows/.test(panel));
  check("и честно помечает секции без блока", /похожего блока нет, нужен новый/.test(panel));

  const constructorJs = read("public", "constructor.js");
  check("агенту передаётся подбор", /matchSummary/.test(constructorJs));
  // Подбор структурный: он не знает, о чём блок, только как он устроен.
  check("агенту велено проверить подбор глазами", /проверь его глазами/.test(constructorJs));
  check("и сказано, что делать с непокрытыми секциями",
    /собери из мелких или предложи новый блок/.test(constructorJs));
}

console.log(`\ndesign-to-blocks: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
