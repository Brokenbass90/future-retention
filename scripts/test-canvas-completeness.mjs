#!/usr/bin/env node
/**
 * test-canvas-completeness.mjs — письмо не считается собранным, пока в нём
 * стоит образцовый текст.
 *
 * Живой случай. Человек дал агенту готовый английский текст письма и попросил
 * собрать. Агент разложил абзацы по блокам и отчитался «собрал». В письме
 * остались зелёная подсветка с русским «Короткая подсветка: что уже сделано…»
 * и кнопка «Перейти» — значения, с которыми блоки приезжают из образца. А
 * последние три строки задания («Write your own story», «Finish your demo
 * training…», «Deposit & trade») как раз и были заголовком подсветки, её
 * текстом и надписью на кнопке: агент дописал их абзацами в тело.
 *
 * Уговаривать модель бесполезно, поэтому проверка детерминированная. Здесь
 * стережём три её свойства:
 *   1) ловит ровно тот случай, который был;
 *   2) НЕ ловит настройки (`align: left`, `tone: success`) — иначе шум, и
 *      проверку выключат первой же;
 *   3) молчит, когда всё заполнено, — иначе агент ходит по кругу.
 *
 * Zero-AI, без сети и диска (кроме чтения библиотеки блоков). Exit 0 = pass.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import url from "node:url";
import { checkCanvasReady, describeLeftovers, demoValuesByBlock } from "../src/canvas-completeness.js";
import { listCanonicalBlocks } from "../src/compose-email.js";

const repoRoot = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const check = (name, cond, extra = "") => {
  if (cond) { pass++; console.log("  \x1b[32m✓\x1b[0m", name); }
  else { fail++; console.error(`  \x1b[31m✗ ${name}\x1b[0m ${extra}`); }
};
const blocks = listCanonicalBlocks();

/* ─── 1. Тот самый случай ────────────────────────────────────────────────── */
{
  const canvas = [
    { uid: 1, blockId: "sys-title", slots: { text: "This $50 Mistake Has Made Me a Trader" } },
    { uid: 2, blockId: "sys-text", slots: { text: "We asked our pro trader Diego from Mexico to share a message." } },
    { uid: 3, blockId: "sys-callout", slots: { tone: "success", text: "Короткая подсветка: что уже сделано или что важно заметить." } },
    { uid: 4, blockId: "sys-button", slots: { label: "Перейти", align: "left" } },
  ];
  const result = checkCanvasReady({ canvas, blocks });

  check("письмо не считается готовым", result.ready === false);
  check("язык письма определён как английский", result.language === "en", result.language);
  check("подсветка названа", result.leftovers.some((item) => item.blockId === "sys-callout"));
  check("кнопка названа", result.leftovers.some((item) => item.blockId === "sys-button"));

  // Настройки — не текст. Если считать и их, в отчёте будет шум на каждом
  // блоке, и первым делом отключат саму проверку.
  check("выравнивание не считается недоделкой",
    !result.leftovers.some((item) => item.slot === "align"), JSON.stringify(result.leftovers));
  check("тон подсветки не считается недоделкой",
    !result.leftovers.some((item) => item.slot === "tone"));
  check("заполненный заголовок не трогаем",
    !result.leftovers.some((item) => item.blockId === "sys-title"));

  const text = describeLeftovers(result);
  check("отчёт называет поля по-человечески", /подсветк|кнопк|sys-callout/.test(text), text.slice(0, 120));
  check("и подсказывает, откуда брать содержимое", /заголовок, подсветка и надпись на кнопке/.test(text));
}

/* ─── 2. Заполненное письмо молчит ───────────────────────────────────────── */
{
  const canvas = [
    { uid: 1, blockId: "sys-title", slots: { text: "This $50 Mistake Has Made Me a Trader" } },
    { uid: 3, blockId: "sys-callout", slots: { tone: "success", text: "Finish your demo training and switch to a real account!" } },
    { uid: 4, blockId: "sys-button", slots: { label: "Deposit & trade", align: "left" } },
  ];
  const result = checkCanvasReady({ canvas, blocks });
  check("дособранное письмо проходит", result.ready === true, JSON.stringify(result.leftovers));
  check("и отчёт это подтверждает", /не осталось/.test(describeLeftovers(result)));
}

/* ─── 3. Русское письмо остаётся русским ─────────────────────────────────── */
{
  // Обратный случай важнее, чем кажется: если считать кириллицу подозрительной
  // всегда, проверка будет ругаться на каждое русское письмо и её выключат.
  const canvas = [
    { uid: 1, blockId: "sys-title", slots: { text: "Ваш счёт пополнен" } },
    { uid: 2, blockId: "sys-text", slots: { text: "Деньги уже на балансе, можно торговать." } },
    { uid: 3, blockId: "sys-callout", slots: { tone: "success", text: "Проверьте баланс в личном кабинете." } },
  ];
  const result = checkCanvasReady({ canvas, blocks });
  check("русское письмо не ругается на русский", result.ready === true, JSON.stringify(result.leftovers));
  check("язык определён как русский", result.language === "ru", result.language);
}

/* ─── 4. Русская служебная строка в английском письме ────────────────────── */
{
  // Образец могли слегка переписать — дословного совпадения не будет, а
  // недоделка останется.
  const canvas = [
    { uid: 1, blockId: "sys-title", slots: { text: "Welcome to the platform" } },
    { uid: 2, blockId: "sys-text", slots: { text: "Your account is ready and verified for trading." } },
    { uid: 3, blockId: "sys-callout", slots: { tone: "success", text: "Здесь будет короткая подсветка." } },
  ];
  const result = checkCanvasReady({ canvas, blocks });
  check("русский текст в английском письме замечен", result.ready === false);
  check("и причина названа прямо",
    result.leftovers.some((item) => /русский текст/.test(item.why)), JSON.stringify(result.leftovers));
}

/* ─── 5. Пустое и неизвестное ────────────────────────────────────────────── */
{
  check("пустой канвас готов", checkCanvasReady({ canvas: [], blocks }).ready === true);
  check("пустые значения не считаются",
    checkCanvasReady({ canvas: [{ uid: 1, blockId: "sys-title", slots: { text: "  " } }], blocks }).ready === true);
  // Свой блок каталогу неизвестен: судим по значению, а не гадаем.
  const unknown = checkCanvasReady({
    canvas: [{ uid: 1, blockId: "my-own-block", slots: { text: "Any text here", align: "left" } }],
    blocks,
  });
  check("неизвестный блок не ломает проверку", unknown.ready === true, JSON.stringify(unknown.leftovers));

  const demo = demoValuesByBlock(blocks);
  check("образцовые значения собраны из библиотеки", demo.size > 5, String(demo.size));
  check("и включают текст из комбо-блока",
    [...demo.values()].some((set) => [...set].some((value) => value.includes("Короткая подсветка"))));
}

/* ─── 6. Заслон стоит перед «готово» ─────────────────────────────────────── */
{
  const agent = readFileSync(path.join(repoRoot, "src", "ai-agent.js"), "utf8");
  check("агент проверяет канвас до finish", /if \(name === "finish"\)[\s\S]{0,900}checkCanvasReady/.test(agent));
  check("проверка только на конструкторе", /surface \|\| ""\) === "constructor"/.test(agent));
  check("и только один раз за прогон", /!checkedCanvas/.test(agent),
    "иначе агент ходит по кругу за уже сделанную работу");
  check("правки этого разговора учитываются", /mergeCanvasOps/.test(agent),
    "иначе ругань на текст, который агент только что заменил");

  const tools = readFileSync(path.join(repoRoot, "src", "ai-tools.js"), "utf8");
  check("агент может проверить себя сам", /"check_canvas_ready"/.test(tools));
  check("инструмент объясняет, почему это важно", /customer sees it in the sent campaign/.test(tools));
}

console.log(`\ncanvas-completeness: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
