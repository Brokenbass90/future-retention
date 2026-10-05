/* Replace across the whole email — template code + every locale of every
 * editable namespace — in one reviewed step. Pure logic, no DOM.
 * Smart parts:
 *  - HTML-entity aware: "a&b" also finds "a&amp;b" (and vice versa), and the
 *    replacement is written in the same encoding as the text it replaces;
 *  - built-in (locked) namespaces are reported but never changed;
 *  - one plan → one apply, with a snapshot for a one-click undo.
 */
(function (root) {
  'use strict';

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  const encodeAmp = (s) => String(s).replace(/&(?!(?:amp|lt|gt|quot|#39|#\d+|#x[0-9a-f]+);)/gi, '&amp;');
  const decodeAmp = (s) => String(s).replace(/&amp;/gi, '&');

  // Variants of the needle, each with how to encode the replacement for it.
  function variants(find) {
    const needle = String(find || '');
    if (!needle) return [];
    const list = [
      { needle, encode: (r) => r },
      { needle: encodeAmp(needle), encode: encodeAmp },
      { needle: decodeAmp(needle), encode: decodeAmp },
    ];
    const seen = new Set();
    return list.filter((v) => v.needle && !seen.has(v.needle) && seen.add(v.needle))
      .sort((a, b) => b.needle.length - a.needle.length);
  }

  function matcher(find) {
    const vs = variants(find);
    if (!vs.length) return null;
    const re = new RegExp(vs.map((v) => escapeRegExp(v.needle)).join('|'), 'g');
    const byNeedle = new Map(vs.map((v) => [v.needle, v]));
    return { re, byNeedle };
  }

  function countIn(text, find) {
    const m = matcher(find);
    if (!m) return 0;
    return (String(text || '').match(m.re) || []).length;
  }

  // Single pass: a replacement that contains the needle is never re-matched.
  function replaceIn(text, find, replacement) {
    const m = matcher(find);
    const source = String(text ?? '');
    if (!m) return { value: source, count: 0 };
    let count = 0;
    const value = source.replace(m.re, (hit) => {
      count += 1;
      return m.byNeedle.get(hit).encode(String(replacement ?? ''));
    });
    return { value, count };
  }

  function sample(text, find, radius = 36) {
    const m = matcher(find);
    if (!m) return '';
    const source = String(text || '');
    m.re.lastIndex = 0;
    const hit = m.re.exec(source);
    if (!hit) return '';
    const start = Math.max(0, hit.index - radius);
    const end = Math.min(source.length, hit.index + hit[0].length + radius);
    return `${start > 0 ? '…' : ''}${source.slice(start, end)}${end < source.length ? '…' : ''}`;
  }

  // namespaces: [{ id, name, builtin?, locales: { code: [block, …] } }]
  function plan({ code = '', namespaces = [], find = '' } = {}) {
    const result = { find: String(find || ''), code: null, locales: [], total: 0, editableTotal: 0 };
    if (!result.find) return result;
    const codeCount = countIn(code, find);
    result.code = { count: codeCount, sample: codeCount ? sample(code, find) : '' };
    result.total += codeCount;
    result.editableTotal += codeCount;
    for (const ns of namespaces || []) {
      if (!ns || !ns.locales) continue;
      for (const [locale, blocks] of Object.entries(ns.locales)) {
        const list = Array.isArray(blocks) ? blocks : [];
        let count = 0;
        let first = '';
        const blockIndexes = [];
        list.forEach((block, index) => {
          const c = countIn(block, find);
          if (c) { count += c; blockIndexes.push(index); if (!first) first = sample(block, find); }
        });
        if (!count) continue;
        const locked = Boolean(ns.builtin);
        result.locales.push({ nsId: ns.id, nsName: ns.name, locale, count, blockIndexes, sample: first, locked });
        result.total += count;
        if (!locked) result.editableTotal += count;
      }
    }
    result.locales.sort((a, b) => (a.nsName === b.nsName ? a.locale.localeCompare(b.locale) : a.nsName.localeCompare(b.nsName)));
    return result;
  }

  // selection: { code: bool, locales: Set('nsId|locale') }
  // Returns new code, per-namespace locale patches and an undo snapshot.
  function apply({ code = '', namespaces = [], find = '', replacement = '', selection = {} } = {}) {
    const out = { code, codeCount: 0, patches: [], undo: { code, locales: [] }, total: 0 };
    if (selection.code) {
      const r = replaceIn(code, find, replacement);
      out.code = r.value;
      out.codeCount = r.count;
      out.total += r.count;
    }
    const wanted = selection.locales instanceof Set ? selection.locales : new Set(selection.locales || []);
    for (const ns of namespaces || []) {
      if (!ns || ns.builtin || !ns.locales) continue;
      for (const [locale, blocks] of Object.entries(ns.locales)) {
        if (!wanted.has(`${ns.id}|${locale}`)) continue;
        const before = Array.isArray(blocks) ? blocks.slice() : [];
        let count = 0;
        const after = before.map((block) => {
          const r = replaceIn(block, find, replacement);
          count += r.count;
          return r.value;
        });
        if (!count) continue;
        out.patches.push({ nsId: ns.id, locale, blocks: after, count });
        out.undo.locales.push({ nsId: ns.id, locale, blocks: before });
        out.total += count;
      }
    }
    return out;
  }

  root.RetKitReplaceAcross = { variants, countIn, replaceIn, plan, apply };
})(typeof globalThis !== 'undefined' ? globalThis : this);
