/**
 * Правка текста в HTML локали → в TXT этой локали, а не в «ручную версию».
 *
 * Раньше любая правка текста в HTML-локали (EN, ES…) сохранялась как override:
 * локаль навсегда отвязывалась от Pug и TXT. Следующие плейсхолдеры, переводы и
 * пересборки до неё уже не доходили — со стороны это выглядело как «не
 * применяется» и «откатывается». Здесь — чистая логика без DOM: сравнить
 * собранный HTML с правленым, найти изменённые тексты и блоки TXT, из которых
 * они пришли.
 *
 * Если поменялась не только надпись (теги, атрибуты, число текстов) или текст
 * не находится ровно в одном блоке TXT — возвращаем причину, и студия делает
 * как раньше: ручную версию, но уже с честным объяснением.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.RetkitLocaleTextSync = api;
  else if (root) root.RetkitLocaleTextSync = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const NAMED = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", laquo: '«', raquo: '»', mdash: '—', ndash: '–', hellip: '…' };

  function decodeEntities(value) {
    return String(value || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, body) => {
      if (body[0] === '#') {
        const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : match;
      }
      const named = NAMED[body.toLowerCase()];
      return named === undefined ? match : named;
    });
  }

  //   не схлопываем: &nbsp; в TXT стоит намеренно и должен пережить правку.
  function collapse(value) {
    return decodeEntities(value).replace(/[ \t\r\n\f]+/g, ' ').replace(/^ +| +$/g, '');
  }


  /** Текстовые куски тела письма по порядку + «скелет» из тегов. */
  function tokenize(html) {
    let source = String(html || '');
    const bodyStart = source.search(/<body[\s>]/i);
    if (bodyStart >= 0) source = source.slice(bodyStart);
    source = source
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, '');
    const texts = [];
    const tags = [];
    const re = /<[^>]*>|[^<]+/g;
    let match;
    while ((match = re.exec(source))) {
      const token = match[0];
      if (token[0] === '<') {
        tags.push(token.replace(/\s+/g, ' ').replace(/\s*(\/?)>$/, '$1>').replace(/\s*=\s*/g, '='));
        continue;
      }
      const text = collapse(token);
      if (!text) continue;
      texts.push(text);
      tags.push('#');
    }
    return { texts, skeleton: tags.join('') };
  }

  /**
   * @returns {{ ok: true, changes: Array<{index:number, from:string, to:string}> }
   *         | { ok: false, reason: string }}
   */
  function diffTexts(beforeHtml, afterHtml) {
    const before = tokenize(beforeHtml);
    const after = tokenize(afterHtml);
    if (before.texts.length !== after.texts.length || before.skeleton !== after.skeleton) {
      return { ok: false, reason: 'поменялась вёрстка, а не только текст' };
    }
    const changes = [];
    before.texts.forEach((from, index) => {
      const to = after.texts[index];
      if (from !== to) changes.push({ index, from, to });
    });
    return { ok: true, changes };
  }

  function blockSegments(raw) {
    const rendered = String(raw ?? '').replace(/@@([\s\S]*?)@@/g, '<b>$1</b>');
    return tokenize(rendered).texts;
  }

  function encodeForTxt(text, rawSample) {
    // В TXT обычно лежит голый текст; кодируем только то, что сломало бы HTML.
    let out = String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    if (/&nbsp;/.test(rawSample)) out = out.replace(/ /g, '&nbsp;');
    else out = out.replace(/ /g, ' ');
    return out.replace(/&amp;(#?\w+;)/g, '&$1');
  }

  /** Найти в raw-блоке кусок, который после декодирования даёт `from`. */
  function replaceSegmentInRaw(raw, from, to) {
    const value = String(raw ?? '');
    const pieces = value.split(/(@@|<[^>]*>)/);
    let hits = 0;
    let result = null;
    pieces.forEach((piece, i) => {
      if (piece === '@@' || /^<[^>]*>$/.test(piece)) return;
      if (collapse(piece) !== from) return;
      hits += 1;
      const lead = piece.match(/^[\s]*/)[0];
      const trail = piece.match(/[\s]*$/)[0];
      const next = pieces.slice();
      next[i] = lead + encodeForTxt(to, piece) + trail;
      result = next.join('');
    });
    return hits === 1 ? result : null;
  }

  /**
   * @param changes — из diffTexts
   * @param sources — [{ ns, key, blocks }] блоки TXT этой локали во всех namespace
   * @returns {{ ok: true, updates: Array<{ns, key, index, before, after}> } | { ok: false, reason }}
   */
  function mapChangesToBlocks(changes, sources) {
    const updates = [];
    const pending = new Map();
    for (const change of changes) {
      const candidates = [];
      for (const source of sources || []) {
        (source.blocks || []).forEach((block, index) => {
          const current = pending.get(`${source.ns}|${source.key}|${index}`)?.after ?? block;
          if (blockSegments(current).includes(change.from)) candidates.push({ source, index, current });
        });
      }
      if (!candidates.length) {
        return { ok: false, reason: `«${change.from.slice(0, 40)}» нет в TXT этой локали` };
      }
      if (candidates.length > 1) {
        return { ok: false, reason: `«${change.from.slice(0, 40)}» есть в TXT несколько раз — непонятно, какой блок править` };
      }
      const [{ source, index, current }] = candidates;
      const next = replaceSegmentInRaw(current, change.from, change.to);
      if (next == null) {
        return { ok: false, reason: `«${change.from.slice(0, 40)}» не удалось заменить внутри блока ${String(index).padStart(2, '0')}` };
      }
      const id = `${source.ns}|${source.key}|${index}`;
      const prev = pending.get(id);
      const update = { ns: source.ns, key: source.key, index, before: prev ? prev.before : source.blocks[index], after: next };
      pending.set(id, update);
    }
    for (const update of pending.values()) updates.push(update);
    return { ok: true, updates };
  }

  function planLocaleTextSync({ beforeHtml, afterHtml, sources }) {
    const diff = diffTexts(beforeHtml, afterHtml);
    if (!diff.ok) return diff;
    if (!diff.changes.length) return { ok: true, updates: [], unchanged: true };
    return mapChangesToBlocks(diff.changes, sources);
  }

  return { tokenize, diffTexts, mapChangesToBlocks, planLocaleTextSync, replaceSegmentInRaw, collapse };
});
