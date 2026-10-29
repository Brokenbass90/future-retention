/**
 * src/placeholder-order.js — плейсхолдеры по порядку, без ИИ.
 *
 * Каждый следующий текст письма (сверху вниз) получает следующий текстовый
 * блок reference-локали: 1-й текст → первый блок TXT, 2-й → второй и т.д.
 *
 * Расставляем, только когда счёт сходится. Если в TXT текстов больше, чем
 * мест в письме (или наоборот), правильное соответствие угадать нельзя —
 * отказываем с объяснением и ничего не меняем. Лучше не расставить, чем
 * расставить со сдвигом: тогда в каждой локали тексты уедут не на свои места.
 *
 * Уже стоящие плейсхолдеры (${{ ns.block_NN }}$) считаются занятыми: их блоки
 * из TXT вычитаются, а места в письме не считаются. Так можно доделать письмо,
 * в котором часть плейсхолдеров уже есть.
 *
 * Системные переменные в TXT ({{embedded.x}}, {{user_name}}) — не тексты для
 * перевода: они остаются в письме литералом и в счёт не идут.
 */
import { tokenizeLocaleTxt, isSystemVariable } from "./locale-conventions.js";
import { extractPugTextCandidates } from "./pug-placeholderize.js";
import { replacePlaceholders } from "./placeholders.js";

export class PlaceholderOrderError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "PlaceholderOrderError";
    this.code = details.code || "PLACEHOLDER_ORDER_REFUSED";
    this.details = details;
  }
}

const pad2 = (n) => String(n).padStart(2, "0");

function safeNamespace(namespace) {
  const ns = String(namespace || "").trim().replace(/[^A-Za-z0-9_-]/g, "_");
  if (!ns) throw new PlaceholderOrderError("namespace is required", { code: "NO_NAMESPACE" });
  return ns;
}

/**
 * Текстовые блоки reference TXT в порядке файла: { index, text, token }.
 *
 * Переменная — это {{embedded.x}} / {{user_name}} (с точкой или «_»). Голое
 * слово в нижнем регистре ({{from}}, {{to}}) соглашение тоже считает
 * переменной, но в письмах это обычный текст карточки. Поэтому голое слово
 * считаем переменной, только если оно стоит в письме литералом {{слово}}.
 */
const DOTTED_VAR_RE = /^[A-Za-z][A-Za-z0-9-]*(?:[._][A-Za-z0-9-]+)+$/;
export function referenceTextBlocks(refLocaleTxt, namespace, source = null) {
  const ns = safeNamespace(namespace);
  const out = [];
  let index = 0;
  for (const token of tokenizeLocaleTxt(String(refLocaleTxt || ""))) {
    if (token.type === "outside") continue;
    const inner = String(token.inner || "").trim();
    const variable = isSystemVariable(inner)
      && (DOTTED_VAR_RE.test(inner) || source == null || String(source).includes("{{" + inner + "}}"));
    if (!variable) {
      out.push({ index, text: inner, token: "${{ " + ns + ".block_" + pad2(index) + " }}$" });
    }
    index += 1;
  }
  return out;
}

function onlyPlaceholdersOrSpace(text) {
  const stripped = replacePlaceholders(String(text || ""), () => "");
  return !/[\p{L}\p{N}]/u.test(stripped.replace(/&nbsp;|&#160;|&raquo;|&laquo;|&[a-z]+;/gi, " "));
}

/**
 * Тексты HTML-письма сверху вниз: текст между тегами в <body>, без <style>,
 * <script>, <title>, комментариев и условных блоков Outlook. Хвост
 * прехедера (&nbsp;&raquo;…) остаётся на месте — заменяется только сам текст.
 */
export function extractHtmlTextCandidates(html) {
  const source = String(html || "");
  const bodyAt = source.search(/<body\b/i);
  const from = bodyAt >= 0 ? source.indexOf(">", bodyAt) + 1 : 0;
  const candidates = [];
  const skipRe = /<(style|script|title|head)\b[\s\S]*?<\/\1>|<!--[\s\S]*?-->/gi;
  const skipped = [];
  let m;
  while ((m = skipRe.exec(source))) skipped.push([m.index, m.index + m[0].length]);
  const inSkipped = (at) => skipped.some(([a, b]) => at >= a && at < b);

  const textRe = />([^<]+)</g;
  textRe.lastIndex = Math.max(0, from - 1);
  while ((m = textRe.exec(source))) {
    const segStart = m.index + 1;
    if (segStart < from || inSkipped(segStart)) { textRe.lastIndex = m.index + m[0].length - 1; continue; }
    const seg = m[1];
    textRe.lastIndex = m.index + m[0].length - 1;
    if (onlyPlaceholdersOrSpace(seg) || /\$\{\{[\s\S]*?\}\}\$/.test(seg)) continue;
    // Обрезаем пробелы и «хвост» из &nbsp;/&raquo;/» по краям: они не текст.
    const lead = /^(?:\s|&nbsp;|&#160;)*/i.exec(seg)[0].length;
    const tailMatch = /(?:\s|&nbsp;|&#160;|&raquo;|»)*$/i.exec(seg.slice(lead));
    const core = seg.slice(lead, seg.length - tailMatch[0].length);
    if (!core) continue;
    candidates.push({ id: candidates.length, start: segStart + lead, end: segStart + lead + core.length, raw: core });
  }
  return candidates;
}

/**
 * @param {{ source: string, kind: "pug"|"html", refLocaleTxt: string, namespace: string }} input
 * @returns {{ source, placed, pairs: [{ text, token }], alreadyPlaced }}
 */
export function placeholderizeByOrder({ source, kind = "pug", refLocaleTxt, namespace }) {
  const text = String(source || "");
  if (!text.trim()) throw new PlaceholderOrderError("источник пуст", { code: "EMPTY_SOURCE" });
  const blocks = referenceTextBlocks(refLocaleTxt, namespace, text);
  if (!blocks.length) throw new PlaceholderOrderError("в reference TXT нет текстов", { code: "EMPTY_TXT" });

  // Блоки, чьи плейсхолдеры уже стоят в письме, заняты.
  const alreadyPlaced = blocks.filter((b) => text.includes(b.token));
  const free = blocks.filter((b) => !text.includes(b.token));
  const candidates = kind === "html" ? extractHtmlTextCandidates(text) : extractPugTextCandidates(text);

  if (free.length !== candidates.length) {
    const more = free.length > candidates.length;
    const message = more
      ? `В TXT текстов больше (${free.length}), чем мест в письме (${candidates.length}). Какой текст куда ставить — не понять, плейсхолдеры не расставлены.`
      : `В письме мест больше (${candidates.length}), чем текстов в TXT (${free.length}). Какое место оставить без перевода — не понять, плейсхолдеры не расставлены.`;
    throw new PlaceholderOrderError(message, {
      code: more ? "MORE_TEXTS_THAN_PLACES" : "MORE_PLACES_THAN_TEXTS",
      texts: free.length,
      places: candidates.length,
      alreadyPlaced: alreadyPlaced.length,
      // Подсказка, где расхождение: первые лишние тексты или места.
      extra: (more ? free.slice(candidates.length).map((b) => b.text) : candidates.slice(free.length).map((c) => c.raw))
        .slice(0, 5).map((s) => String(s).slice(0, 80)),
    });
  }

  const pairs = candidates.map((candidate, i) => ({ text: candidate.raw, ref: free[i].text, token: free[i].token, start: candidate.start, end: candidate.end }));
  let output = text;
  for (const pair of [...pairs].sort((a, b) => b.start - a.start)) {
    output = output.slice(0, pair.start) + pair.token + output.slice(pair.end);
  }
  return {
    source: output,
    placed: pairs.length,
    alreadyPlaced: alreadyPlaced.length,
    pairs: pairs.map(({ text: t, ref, token }) => ({ text: t, ref, token })),
  };
}
