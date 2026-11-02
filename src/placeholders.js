/**
 * src/placeholders.js — какие плейсхолдеры бывают в письме и чьи они.
 *
 * В письме одновременно живут четыре разных вида фигурных скобок, и путать их
 * дорого: один подставляет сборка, другой — платформа рассылки, третий вообще
 * не трогают. «Починил» не тот — и в рассылку уходит письмо без адреса
 * компании или с невыполненной подстановкой вместо текста.
 *
 * До этого модуля описание видов было размазано: свой регэксп в подсветке
 * редактора, свой в индексе плейсхолдеров, свой в выводе блоков из писем. Со
 * вторым форматом платформы (MoEngage) таких копий стало бы вдвое больше,
 * поэтому виды описаны здесь один раз.
 *
 * ВАЖНО: ни один из этих плейсхолдеров нельзя «раскрывать» в сборке письма.
 * Перевод подставляется словарём локали, переменные платформы — платформой.
 * Подстановка нужна ровно в одном месте — в картинке каталога, где человек
 * выбирает блок глазами и должен видеть текст, а не скобки.
 */

/**
 * Виды плейсхолдеров, от самого узкого шаблона к самому широкому: порядок
 * важен, иначе `${{ ns.key }}$` частично съест правило для `{{ … }}`.
 */
export const PLACEHOLDER_DIALECTS = Object.freeze([
  {
    id: "translate",
    title: "Перевод",
    who: "сборка письма, словарь локали из email-base/vendor/data",
    example: "${{ footer.footer.unsubscribe }}$",
    pattern: /\$\{\{\s*([\w.-]+)\s*\}\}\$/g,
    keyOf: (match) => match[1],
  },
  {
    id: "contentBlock",
    title: "Блок контента MoEngage",
    who: "платформа рассылки MoEngage",
    example: "{{ContentBlock['iq_company_address_text']}}",
    // Кавычки допускаем и одинарные, и двойные: в письмах встречаются оба.
    pattern: /\{\{\s*ContentBlock\s*\[\s*(['"])([^'"\]]+)\1\s*\]\s*\}\}/g,
    keyOf: (match) => match[2],
  },
  {
    id: "embedded",
    title: "Переменная письма",
    who: "платформа рассылки",
    example: "{{embedded.company_address}}",
    pattern: /\{\{\s*embedded\.([A-Za-z0-9_]+)\s*\}\}/g,
    keyOf: (match) => match[1],
  },
  {
    id: "style",
    title: "Служебная разметка",
    who: "никто — остаётся в письме как есть",
    example: "{% if … %}",
    pattern: /\{%[^%]*?%\}/g,
    keyOf: () => "",
  },
]);

/** Найти все плейсхолдеры с указанием вида и ключа. */
export function findPlaceholders(text) {
  const source = String(text || "");
  const found = [];
  for (const dialect of PLACEHOLDER_DIALECTS) {
    const pattern = new RegExp(dialect.pattern.source, dialect.pattern.flags);
    let match;
    while ((match = pattern.exec(source)) !== null) {
      found.push({ dialect: dialect.id, key: dialect.keyOf(match), text: match[0], index: match.index });
    }
  }
  return found.sort((a, b) => a.index - b.index);
}

/** Какого вида этот плейсхолдер (или null, если это не плейсхолдер). */
export function classifyPlaceholder(text) {
  const value = String(text || "").trim();
  for (const dialect of PLACEHOLDER_DIALECTS) {
    const pattern = new RegExp(`^(?:${dialect.pattern.source})$`);
    if (pattern.test(value)) return dialect.id;
  }
  return null;
}

/**
 * Заменить плейсхолдеры значениями из словаря.
 *
 * `resolve(dialectId, key)` возвращает строку замены или null, если значения
 * нет — тогда плейсхолдер остаётся на месте. Оставлять его важно: молча
 * подставить пустоту там, где не знаешь значения, хуже, чем показать скобки.
 */
export function replacePlaceholders(text, resolve) {
  let result = String(text || "");
  for (const dialect of PLACEHOLDER_DIALECTS) {
    const pattern = new RegExp(dialect.pattern.source, dialect.pattern.flags);
    result = result.replace(pattern, (...args) => {
      const match = args.slice(0, -2);
      const replacement = resolve(dialect.id, dialect.keyOf(match), match[0]);
      return replacement == null ? match[0] : String(replacement);
    });
  }
  return result;
}

/**
 * Регэксп для подсветки в редакторе.
 *
 * Отдаём строкой, потому что подсветка живёт в браузере и собирает свой
 * CodeMirror-режим: пусть берёт шаблон отсюда, а не пишет четвёртую копию.
 */
export function highlightPatterns() {
  return PLACEHOLDER_DIALECTS.map((dialect) => ({
    id: dialect.id,
    source: dialect.pattern.source,
    title: dialect.title,
    who: dialect.who,
  }));
}
