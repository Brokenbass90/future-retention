/**
 * locale-validator.js — strict validation for locale files (TXT/JSON) before
 * we let them into the editor. Rejects garbage uploads with a clear reason.
 *
 * Rules (in priority order, first failure wins):
 *   1. Empty content                   → reject
 *   2. Too small / too large           → reject (1 char min, 1 MB max)
 *   3. Looks like HTML, JS, CSS, MD,
 *      or binary garbage               → reject
 *   4. Has at least one {{ ... }} block or one JSON-key-like entry
 *      and a sane block-density        → accept (TXT) / (JSON)
 *
 * Output:
 *   { ok: true,  format: 'txt'|'json', blockCount, note? }
 *   { ok: false, reason: string }
 *
 * Public API on window:
 *   window.LocaleValidator.validate(content, filename) → result
 */

(function () {
  'use strict';

  const MAX_BYTES = 1_048_576;            // 1 MB hard limit
  const MIN_BYTES = 1;
  const TXT_BLOCK_RE = /\{\{[\s\S]+?\}\}/g;
  const ALLOWED_EXTS = /\.(txt|json|md)$/i; // .md allowed as TXT fallback

  // Tag/pattern signatures that almost certainly mean "this is not a locale".
  const HTML_HINTS_RE = /<\/?(?:html|body|head|table|div|tr|td|tbody|thead|tfoot|p|h[1-6]|script|style|meta|link)\b/i;
  const JS_HINTS_RE = /\b(?:function|const|let|var|=>|require\(|import\s|module\.exports|console\.log)\b/;
  const CSS_RULE_RE = /^\s*\.?[\w-]+\s*\{[^}]*[a-z-]+:\s*[^;]+;[^}]*\}/m;

  function ext(filename) {
    if (!filename) return '';
    const m = String(filename).match(/\.[a-z0-9]+$/i);
    return m ? m[0].toLowerCase() : '';
  }

  function bytesOf(s) {
    try {
      if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s).length;
    } catch {}
    return s.length;
  }

  function looksLikeHtml(s) {
    return HTML_HINTS_RE.test(s);
  }
  function looksLikeJs(s) {
    return JS_HINTS_RE.test(s);
  }
  function looksLikeCss(s) {
    return CSS_RULE_RE.test(s);
  }
  // Detects long runs of non-printable / binary noise (control chars).
  function looksBinary(s) {
    const sample = s.slice(0, 2000);
    let bad = 0;
    for (const ch of sample) {
      const c = ch.charCodeAt(0);
      // Allow tab(9), LF(10), CR(13). Reject other <32 and DEL.
      if (c === 9 || c === 10 || c === 13) continue;
      if (c < 32 || c === 127) bad += 1;
    }
    return bad / Math.max(1, sample.length) > 0.02;
  }

  /**
   * Validate a locale upload. Filename is optional but helps disambiguate
   * .json (which uses JSON key/value) from plain .txt.
   */
  function validate(content, filename) {
    if (content == null) return { ok: false, reason: 'Пустое содержимое' };
    const text = String(content);
    const size = bytesOf(text);

    if (size < MIN_BYTES) {
      return { ok: false, reason: 'Файл пустой' };
    }
    if (size > MAX_BYTES) {
      return { ok: false, reason: `Файл слишком большой (${(size / 1024).toFixed(1)} KB > ${MAX_BYTES / 1024} KB)` };
    }
    if (looksBinary(text)) {
      return { ok: false, reason: 'Похоже на двоичный файл (много управляющих символов)' };
    }

    const fileExt = ext(filename);
    if (filename && !ALLOWED_EXTS.test(filename)) {
      return { ok: false, reason: `Расширение ${fileExt || '(без расширения)'} не поддерживается. Ожидался .txt или .json` };
    }

    // JSON branch — enter only when filename says .json OR content starts
    // with {" or {\n" (a literal JSON object), not {{ (TXT placeholder).
    const stripped = text.trimStart();
    const looksJson = fileExt === '.json'
      || (stripped.startsWith('{') && !stripped.startsWith('{{') &&
          /^\{\s*["a-zA-Z_]/.test(stripped));
    if (looksJson) {
      try {
        const parsed = JSON.parse(text);
        if (!parsed || typeof parsed !== 'object') {
          return { ok: false, reason: 'JSON-файл не содержит объект' };
        }
        const blockCount = countJsonLeaves(parsed);
        if (blockCount < 1) {
          return { ok: false, reason: 'JSON не содержит ни одной строки-значения' };
        }
        return { ok: true, format: 'json', blockCount };
      } catch (err) {
        return { ok: false, reason: `Не валидный JSON: ${err.message}` };
      }
    }

    // TXT branch. Reject obvious HTML/JS/CSS uploads.
    if (looksLikeHtml(text)) {
      return { ok: false, reason: 'Похоже на HTML, а не на локаль (есть теги <html>/<body>/<table>/...). Используй «Открыть HTML письмо» для импорта вёрстки.' };
    }
    if (looksLikeJs(text)) {
      return { ok: false, reason: 'Похоже на JavaScript-файл, а не на TXT-локаль' };
    }
    if (looksLikeCss(text)) {
      return { ok: false, reason: 'Похоже на CSS, а не на TXT-локаль' };
    }

    const blocks = text.match(TXT_BLOCK_RE) || [];
    if (blocks.length === 0) {
      return { ok: false, reason: 'В файле нет ни одного блока {{...}}. Это не похоже на TXT-локаль студии.' };
    }
    // Sanity: проверка плотности блоков. Файл из 50KB с 1 блоком — подозрительно.
    const density = blocks.length / (size / 1024 || 1);
    if (size > 4096 && density < 0.2) {
      return {
        ok: true, format: 'txt', blockCount: blocks.length,
        note: `Подозрительно мало плейсхолдеров для такого размера файла (${blocks.length} на ${(size / 1024).toFixed(1)} KB). Проверь что не попало лишнее.`,
      };
    }
    return { ok: true, format: 'txt', blockCount: blocks.length };
  }

  function countJsonLeaves(obj, depth = 0) {
    if (depth > 6) return 0;
    let n = 0;
    if (typeof obj === 'string') return 1;
    if (Array.isArray(obj)) {
      for (const v of obj) n += countJsonLeaves(v, depth + 1);
      return n;
    }
    if (obj && typeof obj === 'object') {
      for (const k of Object.keys(obj)) n += countJsonLeaves(obj[k], depth + 1);
      return n;
    }
    return 0;
  }

  if (typeof window !== 'undefined') {
    window.LocaleValidator = { validate, _internals: { bytesOf, looksBinary, looksLikeHtml, looksLikeJs, looksLikeCss } };
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { validate };
  }
})();
