/**
 * src/html-blocks.js — safe block-level operations on the OPEN email HTML.
 *
 * Compiled emails are deeply-nested tables with no reliable "section"
 * boundaries, so we DO NOT try to chop the table tree (that corrupts emails).
 * Two safe primitives instead:
 *
 *   - insertHtml(html, { anchor, position, snippet })  — splice a snippet at a
 *     UNIQUE anchor (before/after) or at body start/end. String-level, no parsing.
 *   - removeHtml(html, { from, to } | { block })       — remove a UNIQUELY
 *     identified region. Guards refuse ambiguous or oversized deletions.
 *
 * Plus marker-aware listing for constructor/compose-built previews that carry
 * <!-- rk:block-start:N:id --> … <!-- rk:block-end:N:id --> markers.
 */

const RK_START = /<!--\s*rk:block-start:(\d+):([^\s]+?)\s*-->/g;

/** List sections when the HTML carries rk:block markers (constructor path). */
export function listHtmlSections(html) {
  const src = String(html || "");
  const sections = [];
  RK_START.lastIndex = 0;
  let m;
  while ((m = RK_START.exec(src)) !== null) {
    const idx = Number(m[1]);
    const id = m[2];
    const endRe = new RegExp(`<!--\\s*rk:block-end:${idx}:${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*-->`);
    const endM = endRe.exec(src.slice(m.index));
    const start = m.index;
    const end = endM ? m.index + endM.index + endM[0].length : -1;
    const inner = end > 0 ? src.slice(start, end) : "";
    const text = inner.replace(/<[^>]+>/g, " ").replace(/<!--.*?-->/g, " ").replace(/\s+/g, " ").trim();
    sections.push({ index: idx, id, start, end, preview: text.slice(0, 80) });
  }
  return { marked: sections.length > 0, count: sections.length, sections };
}

function countOccurrences(haystack, needle) {
  if (!needle) return 0;
  let n = 0, i = 0;
  while (true) {
    const at = haystack.indexOf(needle, i);
    if (at === -1) break;
    n += 1; i = at + needle.length;
    if (n > 500) break;
  }
  return n;
}

/**
 * Insert `snippet` into html.
 * @param {string} html
 * @param {object} opts { anchor?, position: 'before'|'after'|'body_start'|'body_end', snippet }
 * @returns {{ html } | { error }}
 */
export function insertHtml(html, { anchor = "", position = "after", snippet = "" } = {}) {
  const src = String(html || "");
  const snip = String(snippet || "");
  if (!src) return { error: "no HTML open in the editor" };
  if (!snip.trim()) return { error: "snippet is empty" };
  if (snip.length > 8000) return { error: "snippet too long (>8000 chars) — insert one block at a time" };

  if (position === "body_start" || position === "body_end") {
    const bodyOpen = src.match(/<body[^>]*>/i);
    const bodyClose = src.match(/<\/body\s*>/i);
    if (position === "body_start") {
      if (!bodyOpen) return { error: "no <body> tag found" };
      const at = bodyOpen.index + bodyOpen[0].length;
      return { html: src.slice(0, at) + "\n" + snip + "\n" + src.slice(at) };
    }
    if (!bodyClose) return { error: "no </body> tag found" };
    const at = bodyClose.index;
    return { html: src.slice(0, at) + "\n" + snip + "\n" + src.slice(at) };
  }

  const a = String(anchor || "");
  if (!a) return { error: "anchor required (or use position body_start/body_end)" };
  if (a.length > 2000) return { error: "anchor too long (>2000) — use a shorter unique substring" };
  const count = countOccurrences(src, a);
  if (count === 0) return { error: "anchor not found — locate it with find_in_html first (mind whitespace/entities)" };
  if (count > 1) return { error: `anchor matches ${count} places — extend it with surrounding context to be unique` };

  const at = src.indexOf(a);
  if (position === "before") return { html: src.slice(0, at) + snip + "\n" + src.slice(at) };
  // default 'after'
  const end = at + a.length;
  return { html: src.slice(0, end) + "\n" + snip + src.slice(end) };
}

/**
 * Remove a uniquely-identified region.
 * @param {string} html
 * @param {object} opts { from, to } (inclusive region) OR { block } (single substring)
 * @returns {{ html, removed } | { error }}
 */
export function removeHtml(html, { from = "", to = "", block = "" } = {}) {
  const src = String(html || "");
  if (!src) return { error: "no HTML open in the editor" };

  let start, end;
  if (block) {
    const b = String(block);
    const count = countOccurrences(src, b);
    if (count === 0) return { error: "block not found — locate it with find_in_html first" };
    if (count > 1) return { error: `block matches ${count} places — extend it to be unique` };
    start = src.indexOf(b);
    end = start + b.length;
  } else {
    const f = String(from), t = String(to);
    if (!f || !t) return { error: "provide { from, to } anchors or a single { block }" };
    if (countOccurrences(src, f) !== 1) return { error: "`from` anchor is not unique — extend it with context" };
    start = src.indexOf(f);
    const tAt = src.indexOf(t, start);
    if (tAt === -1) return { error: "`to` anchor not found after `from`" };
    end = tAt + t.length;
  }

  const region = end - start;
  if (region <= 0) return { error: "empty region" };
  const out = src.slice(0, start) + src.slice(end);
  if (out.length < src.length * 0.5) {
    return { error: "removal would delete >50% of the document — refused; target a smaller block" };
  }
  return { html: out, removed: region };
}
