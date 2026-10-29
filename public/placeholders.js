/**
 * public/placeholders.js — виды плейсхолдеров для браузера.
 *
 * Зеркало src/placeholders.js. Зеркало, а не копия по случайности: в проекте
 * нет сборки, модуль из src в страницу не подключить, а знать виды нужно и
 * там и там. Раньше вместо этого по файлам было размножено четыре разных
 * регэкспа, и каждый знал только про переводы — поэтому формат MoEngage
 * `{{ContentBlock['…']}}` не видели ни боковая панель, ни подсветка, ни
 * индекс: человеку казалось, что студия просто «не заметила» половину текста.
 *
 * Расхождение зеркала с оригиналом ловит scripts/test-placeholders.mjs: он
 * сверяет шаблоны построчно. Правите здесь — правьте и там.
 */
(function () {
  "use strict";

  var DIALECTS = [
    {
      id: "translate",
      title: "Перевод",
      who: "сборка письма, словарь локали",
      pattern: /\$\{\{\s*([\w.-]+)\s*\}\}\$/g,
      keyOf: function (match) { return match[1]; },
    },
    {
      id: "contentBlock",
      title: "Блок контента MoEngage",
      who: "платформа рассылки MoEngage",
      pattern: /\{\{\s*ContentBlock\s*\[\s*(['"])([^'"\]]+)\1\s*\]\s*\}\}/g,
      keyOf: function (match) { return match[2]; },
    },
    {
      id: "embedded",
      title: "Переменная письма",
      who: "платформа рассылки",
      pattern: /\{\{\s*embedded\.([A-Za-z0-9_]+)\s*\}\}/g,
      keyOf: function (match) { return match[1]; },
    },
    {
      id: "style",
      title: "Служебная разметка",
      who: "никто — остаётся в письме как есть",
      pattern: /\{%[^%]*?%\}/g,
      keyOf: function () { return ""; },
    },
  ];

  /** Все плейсхолдеры текста с видом, ключом и позицией, по порядку. */
  function findPlaceholders(text) {
    var source = String(text == null ? "" : text);
    var found = [];
    DIALECTS.forEach(function (dialect) {
      var pattern = new RegExp(dialect.pattern.source, dialect.pattern.flags);
      var match;
      while ((match = pattern.exec(source)) !== null) {
        found.push({
          dialect: dialect.id,
          title: dialect.title,
          key: dialect.keyOf(match),
          text: match[0],
          index: match.index,
        });
      }
    });
    return found.sort(function (a, b) { return a.index - b.index; });
  }

  /** Вид одного плейсхолдера или null, если это обычный текст. */
  function classifyPlaceholder(text) {
    var value = String(text == null ? "" : text).trim();
    for (var i = 0; i < DIALECTS.length; i++) {
      var pattern = new RegExp("^(?:" + DIALECTS[i].pattern.source + ")$");
      if (pattern.test(value)) return DIALECTS[i].id;
    }
    return null;
  }

  window.RetkitPlaceholders = {
    DIALECTS: DIALECTS,
    findPlaceholders: findPlaceholders,
    classifyPlaceholder: classifyPlaceholder,
  };
})();
