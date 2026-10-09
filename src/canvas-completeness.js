/**
 * src/canvas-completeness.js — не осталось ли в письме образцового текста.
 *
 * Живой случай, ради которого это написано. Человек дал агенту готовый текст
 * письма на английском и попросил собрать. Агент разложил абзацы по блокам и
 * отчитался «готово». В письме при этом остались: зелёная подсветка с русским
 * «Короткая подсветка: что уже сделано или что важно заметить» и кнопка
 * «Перейти» — ровно те значения, с которыми блоки приезжают из образца. А
 * последние три строки задания («Write your own story», «Finish your demo
 * training…», «Deposit & trade») — это и были заголовок подсветки, её текст и
 * надпись на кнопке. Агент их просто дописал абзацами в тело.
 *
 * Уговаривать модель «будь внимательнее» бесполезно. Проверка детерминированная:
 * значения по умолчанию известны из библиотеки блоков, и если после сборки они
 * всё ещё стоят в письме — письмо не дособрано. Это не стиль и не вкусовщина:
 * образцовый текст в отправленной рассылке видит клиент.
 *
 * Отдельно ловим язык: русская служебная строка в английском письме — это не
 * «вариант», это недоделка, даже если текст не совпал с образцом дословно.
 */

/** Слоты, в которых лежит видимый текст. Цвета и отступы нас не интересуют. */
const TEXT_KINDS = new Set(["text", "richText", "html", "string", ""]);

/**
 * Собрать образцовые значения из библиотеки блоков.
 *
 * Берём и `default` самого слота, и значения, которыми комбо-блок засевает
 * своих детей: в конструкторе письмо чаще всего начинается именно с комбо, и
 * демо-текст приезжает оттуда.
 *
 * @param {Array} blocks — каталог блоков
 * @returns {Map<string, Set<string>>} blockId → множество образцовых строк
 */
export function demoValuesByBlock(blocks) {
  const map = new Map();
  const add = (blockId, value) => {
    const text = String(value ?? "").trim();
    if (!text) return;
    const id = String(blockId || "").trim();
    if (!id) return;
    if (!map.has(id)) map.set(id, new Set());
    map.get(id).add(text);
  };

  for (const block of blocks || []) {
    for (const slot of block?.slots || []) {
      if (TEXT_KINDS.has(String(slot?.kind || "text"))) add(block.id, slot?.default);
    }
    for (const child of block?.children || []) {
      for (const [, value] of Object.entries(child?.slots || {})) add(child.id, value);
    }
  }
  return map;
}

/** Есть ли в строке кириллица. */
const hasCyrillic = (value) => /[А-Яа-яЁё]/.test(String(value || ""));
/** Есть ли латиница — слово, а не одинокая буква из адреса. */
const hasLatinWords = (value) => /[A-Za-z]{3,}/.test(String(value || ""));

/**
 * Что в письме осталось недозаполненным.
 *
 * @param {object} input
 * @param {Array} input.canvas — дерево конструктора: uid, blockId, slots
 * @param {Array} input.blocks — каталог блоков (за образцовыми значениями)
 * @returns {{ready: boolean, leftovers: Array, language: string}}
 */
export function checkCanvasReady({ canvas = [], blocks = [] } = {}) {
  const demo = demoValuesByBlock(blocks);
  const leftovers = [];

  // Настройки — не текст. `align: left` и `tone: success` совпадают с
  // образцом всегда и ни о какой недоделке не говорят: если считать и их,
  // проверка утонет в шуме и её выключат.
  const kinds = new Map();
  for (const block of blocks || []) {
    const byId = new Map();
    for (const slot of block?.slots || []) byId.set(String(slot?.id || ""), String(slot?.kind || "text"));
    kinds.set(String(block?.id || ""), byId);
  }
  const isVisibleText = (blockId, slotId, value) => {
    const kind = kinds.get(blockId)?.get(slotId);
    if (kind !== undefined) return TEXT_KINDS.has(kind);
    // Блок каталогу неизвестен (свой, удалённый) — судим по значению: слово с
    // пробелом это текст, одиночный токен вроде «left» — настройка.
    return /\s/.test(String(value || "").trim());
  };

  // Язык письма определяем по большинству текста, а не по одному блоку:
  // одна английская подпись в русском письме — норма, а наоборот — нет.
  let cyrillic = 0;
  let latin = 0;
  for (const entry of canvas) {
    for (const value of Object.values(entry?.slots || {})) {
      const text = String(value ?? "");
      if (hasCyrillic(text)) cyrillic += text.length;
      else if (hasLatinWords(text)) latin += text.length;
    }
  }
  const language = cyrillic > latin * 1.5 ? "ru" : latin > cyrillic * 1.5 ? "en" : "mixed";

  for (const entry of canvas) {
    const blockId = String(entry?.blockId || entry?.id || "").trim();
    const known = demo.get(blockId);
    for (const [slotId, rawValue] of Object.entries(entry?.slots || {})) {
      const value = String(rawValue ?? "").trim();
      if (!value) continue;
      if (!isVisibleText(blockId, slotId, value)) continue;

      if (known?.has(value)) {
        leftovers.push({
          uid: entry?.uid ?? null,
          blockId,
          slot: slotId,
          value: value.slice(0, 120),
          why: "остался образцовый текст блока — в рассылке его увидит клиент",
        });
        continue;
      }
      // Служебная русская строка в письме на другом языке: образец мог быть
      // слегка переписан, но недоделка от этого не перестала быть недоделкой.
      if (language === "en" && hasCyrillic(value) && !hasLatinWords(value)) {
        leftovers.push({
          uid: entry?.uid ?? null,
          blockId,
          slot: slotId,
          value: value.slice(0, 120),
          why: "русский текст в английском письме",
        });
      }
    }
  }

  return { ready: leftovers.length === 0, leftovers, language };
}

/** Человеческий текст для агента и для чата. */
export function describeLeftovers(result) {
  if (!result || result.ready) return "Образцового текста в письме не осталось.";
  const lines = result.leftovers.map((item) => (
    `• блок ${item.blockId}, поле «${item.slot}» (uid ${item.uid}): «${item.value}» — ${item.why}`
  ));
  return [
    `Письмо не дособрано: ${result.leftovers.length} ${result.leftovers.length === 1 ? "поле" : "полей"} с текстом из образца.`,
    ...lines,
    "",
    "Заполните их по смыслу задания: у текста, который дал человек, обычно есть",
    "заголовок, подсветка и надпись на кнопке — их не нужно дописывать абзацами в тело.",
    "Меняйте через update_canvas_block.",
  ].join("\n");
}
