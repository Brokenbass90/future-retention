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
  const countIn = (text, part) => (part ? String(text).split(part).length - 1 : 0);
  for (let i = 0; i < before.length; i += 1) {
    if (before[i] === after[i]) continue;
    if (!before[i] || !after[i]) continue;
    // Какое по счёту это вхождение текста в письме и сколько их всего —
    // чтобы одинаковые «Title text» в двух блоках не были тупиком.
    let ordinal = 0;
    for (let j = 0; j < i; j += 1) ordinal += countIn(before[j], before[i]);
    const total = before.reduce((sum, node) => sum + countIn(node, before[i]), 0);
    edits.push({ from: before[i], to: after[i], ordinal, total });
  }
  return edits;
}

/**
 * Применить пары к Pug. Возвращает новый исходник и отчёт по каждой паре,
 * чтобы интерфейс мог сказать правду: что перенеслось, а что нет и почему.
 */
export function applyTextEditsToPug(pugSource, edits) {
  const source = String(pugSource || "");
  const applied = [];
  const skipped = [];
  const replacements = [];
  const positionsOf = (text) => {
    const out = [];
    for (let at = source.indexOf(text); at >= 0; at = source.indexOf(text, at + text.length)) out.push(at);
    return out;
  };
  for (const edit of Array.isArray(edits) ? edits : []) {
    const from = String(edit?.from ?? "");
    const to = String(edit?.to ?? "");
    if (!from || !to || from === to) continue;
    const positions = positionsOf(from);
    if (!positions.length) {
      skipped.push({ ...edit, reason: "в Pug нет такого текста — вероятно он приходит из локали или плейсхолдера" });
      continue;
    }
    let at = positions[0];
    if (positions.length > 1) {
      // Несколько одинаковых мест. Pug выводит текст в том же порядке, что и
      // HTML, поэтому N-е вхождение в письме — N-е в Pug. Но только если число
      // вхождений совпадает: иначе текст есть ещё где-то (миксин, комментарий),
      // и порядок не доказывает ничего.
      const total = Number(edit?.total);
      const ordinal = Number(edit?.ordinal);
      if (!Number.isInteger(ordinal) || total !== positions.length || ordinal < 0 || ordinal >= positions.length) {
        skipped.push({ ...edit, reason: `текст встречается в Pug ${positions.length} раза, а в письме ${Number.isFinite(total) ? total : "?"} — какое из мест менять, неясно` });
        continue;
      }
      at = positions[ordinal];
    }
    if (replacements.some((r) => at < r.at + r.length && r.at < at + from.length)) {
      skipped.push({ ...edit, reason: "пересекается с другой правкой в том же месте Pug" });
      continue;
    }
    replacements.push({ at, length: from.length, to });
    applied.push({ ...edit });
  }
  let pug = source;
  for (const r of replacements.sort((a, b) => b.at - a.at)) {
    pug = pug.slice(0, r.at) + r.to + pug.slice(r.at + r.length);
  }
  return { pug, applied, skipped };
}
