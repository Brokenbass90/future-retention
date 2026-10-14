/**
 * src/original-text-sync.js — правка текстов в Original переносится в Pug.
 *
 * ЗАЧЕМ. Локализация в этом проекте устроена так: Pug — единственный источник,
 * а локаль — его сборка, где `${{ ns.block_NN }}$` заменяется текстом из
 * vendor/data/<локаль>/<NS>.json. Значит правильный сценарий ровно один:
 * поставил плейсхолдер В ОДНОМ месте — и все локали подтянули свой перевод.
 *
 * Но человек работает не в Pug, а в понятном ему HTML. Если правку Original
 * сохранять как HTML-override, она остаётся ВНУТРИ одной локали: остальные
 * собираются из нетронутого Pug и ничего не подтягивают. Отсюда «приходится
 * в каждой локали подставлять руками».
 *
 * ЧТО ДЕЛАЕМ. Не конвертируем HTML обратно в Pug — это lossy и убило бы
 * миксины, include и структуру. Переносим только ТЕКСТ: сравниваем текстовые
 * узлы «до» и «после», получаем пары (было → стало) и заменяем их в Pug.
 * Дальше обычная пересборка, и все локали получают подстановку сами.
 *
 * ГРАНИЦЫ, осознанные и проверяемые:
 *   • переносится только текст, не разметка и не стили;
 *   • замена применяется, лишь если старый текст встречается в Pug РОВНО раз;
 *     иначе мы не знаем, какое из вхождений имел в виду человек, и честно
 *     сообщаем о пропуске вместо того, чтобы испортить письмо наугад;
 *   • служебные узлы (script/style/preheader) не трогаем.
 *
 * Функции чистые: ни сети, ни файлов — их проверяет scripts/test-original-text-sync.mjs.
 */
import * as cheerio from "cheerio";

const SKIP_TAGS = new Set(["script", "style", "title", "head", "meta", "link"]);

/** Видимые текстовые узлы документа, в порядке следования. */
export function visibleTextNodes(html) {
  const $ = cheerio.load(String(html || ""), null, false);
  const out = [];
  const walk = (node) => {
    for (const child of node.children || []) {
      if (child.type === "text") {
        const raw = String(child.data || "");
        if (raw.trim()) out.push(raw.trim().replace(/\s+/g, " "));
        continue;
      }
      if (child.type !== "tag") continue;
      if (SKIP_TAGS.has(String(child.name || "").toLowerCase())) continue;
      // preheader — скрытая техническая строка, её текст не редактируют.
      const cls = String(child.attribs?.class || "");
      if (/\bpreheader\b/.test(cls)) continue;
      walk(child);
    }
  };
  walk($.root()[0]);
  return out;
}

/**
 * Пары «было → стало» между двумя версиями одного документа.
 *
 * Считаем, что правка текста не меняет структуру: количество и порядок узлов
 * совпадают. Если это не так — человек поменял разметку, а не текст, и
 * переносить нечего: возвращаем пустой список вместо догадок.
 */
export function textEditsBetween(beforeHtml, afterHtml) {
  const before = visibleTextNodes(beforeHtml);
  const after = visibleTextNodes(afterHtml);
  if (!before.length || before.length !== after.length) return [];
  const edits = [];
  for (let i = 0; i < before.length; i += 1) {
    if (before[i] === after[i]) continue;
    if (!before[i] || !after[i]) continue;
    edits.push({ from: before[i], to: after[i] });
  }
  return edits;
}

/**
 * Применить пары к Pug. Возвращает новый исходник и отчёт по каждой паре,
 * чтобы интерфейс мог сказать правду: что перенеслось, а что нет и почему.
 */
export function applyTextEditsToPug(pugSource, edits) {
  let pug = String(pugSource || "");
  const applied = [];
  const skipped = [];
  for (const edit of Array.isArray(edits) ? edits : []) {
    const from = String(edit?.from ?? "");
    const to = String(edit?.to ?? "");
    if (!from || !to || from === to) continue;
    const occurrences = pug.split(from).length - 1;
    if (occurrences === 0) {
      skipped.push({ ...edit, reason: "в Pug нет такого текста — вероятно он приходит из локали или плейсхолдера" });
      continue;
    }
    if (occurrences > 1) {
      skipped.push({ ...edit, reason: `текст встречается в Pug ${occurrences} раза — какое из мест менять, неясно` });
      continue;
    }
    pug = pug.replace(from, to);
    applied.push({ ...edit });
  }
  return { pug, applied, skipped };
}
