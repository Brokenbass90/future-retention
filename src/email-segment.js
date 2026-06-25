/**
 * src/email-segment.js — segment an existing (LTR/compiled) email into top-level
 * blocks, and reorder/remove them at the SOURCE level. Pure functions, no markers
 * baked into the email. Built around the studio's section convention: top-level
 * `<table class="... row ...">` elements are the blocks (IQ template family).
 *
 * Used by the workbench "Блоки письма" panel so DnD reorder / delete work on a
 * ready email without needing it pre-built from the block library.
 */

// Find the index just AFTER the </table> that closes the <table> starting at openStart.
function matchTableEnd(html, openStart) {
  const re = /<\/?table\b[^>]*>/gi;
  re.lastIndex = openStart;
  let depth = 0, m;
  while ((m = re.exec(html)) !== null) {
    const isClose = m[0][1] === '/';
    if (isClose) { depth -= 1; if (depth === 0) return m.index + m[0].length; }
    else depth += 1;
  }
  return -1;
}

/** @returns {Array<{index,start,end,label,preview}>} top-level section blocks. */
export function segmentEmailIntoBlocks(html) {
  const src = String(html || '');
  const blocks = [];
  const re = /<table\b[^>]*>/gi;
  let m, coveredEnd = 0;
  while ((m = re.exec(src)) !== null) {
    if (m.index < coveredEnd) continue;                       // nested inside a captured block
    const cls = (m[0].match(/class\s*=\s*["']([^"']*)["']/i) || [])[1] || '';
    if (!/(^|\s)row(\s|$)/.test(cls)) continue;               // only section rows
    const end = matchTableEnd(src, m.index);
    if (end < 0) continue;
    const inner = src.slice(m.index, end);
    const text = inner.replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim();
    const label = cls.split(/\s+/).filter(c => c && c !== 'row').join(' ') || 'row';
    blocks.push({ index: blocks.length, start: m.index, end, label, preview: text.slice(0, 60) });
    coveredEnd = end;
    re.lastIndex = end;
  }
  return blocks;
}

/** Remove block #index, returns new html (or original if invalid). */
export function removeEmailBlock(html, index) {
  const src = String(html || '');
  const blocks = segmentEmailIntoBlocks(src);
  const b = blocks[index];
  if (!b) return src;
  return src.slice(0, b.start) + src.slice(b.end);
}

/** Move block #from to position #to (0-based among blocks). */
export function moveEmailBlock(html, from, to) {
  const src = String(html || '');
  const blocks = segmentEmailIntoBlocks(src);
  if (!blocks[from] || from === to || to < 0 || to > blocks.length) return src;
  const moved = src.slice(blocks[from].start, blocks[from].end);
  // Remove the moved block first.
  let rest = src.slice(0, blocks[from].start) + src.slice(blocks[from].end);
  // Re-segment the remaining html to find the insertion anchor.
  const after = segmentEmailIntoBlocks(rest);
  // Target index in the reduced list: blocks after `from` shifted by -1.
  const adjustedTo = to > from ? to - 1 : to;
  const anchor = after[adjustedTo];
  const insertAt = anchor ? anchor.start : rest.length;   // append if past the end
  return rest.slice(0, insertAt) + moved + rest.slice(insertAt);
}
