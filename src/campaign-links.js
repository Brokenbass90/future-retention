/**
 * src/campaign-links.js — метка кампании в ссылках письма.
 *
 * Проблема, ради которой это сделано: у блоков в ссылках зашиты чужие метки —
 * `afftrack=mail_IQ-RFM-2-3-3-Second-Email`, `retrack=mail_strategies`. Блок
 * берут в новое письмо, и метка едет с ним. Заметить это можно только глазами,
 * а исправлять приходится в коде, руками, во всех ссылках сразу.
 *
 * Решение: письмо получает СВОЮ метку, и при сборке все `afftrack`/`retrack`
 * переписываются на неё. Значит, в блоках может лежать что угодно — в готовом
 * письме метка будет одна и та, которую назвали.
 *
 * Почему переписываем, а не требуем токен `{{ campaign }}` в блоках: токен
 * пришлось бы проставить в 500+ блоках, и любой блок без него молча остался бы
 * с чужой меткой. Переписывание работает и со старыми блоками, и с теми, что
 * ещё нарежутся.
 *
 * Трогаем только эти два параметра и только внутри ссылок. Остальная строка
 * запроса — часть адреса и к рассылке отношения не имеет.
 */

/** Параметры, которые обозначают кампанию в ссылках платформы. */
export const CAMPAIGN_PARAMS = Object.freeze(["afftrack", "retrack"]);

/** Метка кампании: буквы, цифры, дефис, подчёркивание. */
const LABEL_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;

export function normalizeCampaign(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (!LABEL_RE.test(raw)) {
    throw new Error(`метка кампании: только буквы, цифры, дефис и подчёркивание (получено "${raw.slice(0, 30)}")`);
  }
  return raw;
}

/**
 * Переписать метку кампании во всех ссылках куска разметки.
 *
 * @param {string} source — Pug или HTML
 * @param {string} campaign — метка; пустая строка означает «не трогать»
 * @returns {{ text: string, replaced: number }}
 */
export function applyCampaign(source, campaign) {
  const label = normalizeCampaign(campaign);
  const text = String(source ?? "");
  if (!label) return { text, replaced: 0 };

  let replaced = 0;
  const pattern = new RegExp(`\\b(${CAMPAIGN_PARAMS.join("|")})=([^&"'\\s)]*)`, "g");
  const out = text.replace(pattern, (all, param, value) => {
    // Плейсхолдер платформы (`{{embedded.…}}`) или слот блока — не наше дело:
    // там значение подставляется на отправке, и подмена сломала бы ссылку.
    if (/\{\{/.test(value)) return all;
    const next = `${param}=${label}`;
    if (next !== all) replaced += 1;
    return next;
  });
  return { text: out, replaced };
}

/** Все метки кампаний, которые сейчас стоят в ссылках. */
export function findCampaigns(source) {
  const found = new Map();
  const pattern = new RegExp(`\\b(${CAMPAIGN_PARAMS.join("|")})=([^&"'\\s)]*)`, "g");
  for (const [, param, value] of String(source ?? "").matchAll(pattern)) {
    if (!value || /\{\{/.test(value)) continue;
    const key = `${param}=${value}`;
    found.set(key, (found.get(key) || 0) + 1);
  }
  return [...found.entries()].map(([key, count]) => {
    const [param, value] = key.split("=");
    return { param, value, count };
  });
}
