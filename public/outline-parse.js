/**
 * public/outline-parse.js — parse a source pug file into a list of
 * top-level "blocks" with line ranges. Used by the Outline panel in
 * workbench so users can insert canonical blocks at any position in
 * an existing email without manually placing the CodeMirror cursor.
 *
 * Strategy A — composed mails (preferred):
 *   `//- block-start: <id>` / `//- block-end: <id>` markers written by
 *   composeEmailFromBlocks. If we find ≥ 1 valid pair, use only these.
 *
 * Strategy B — legacy mails (fallback):
 *   Top-level (indent === 0) lines starting with `table.row` open a block.
 *   The block extends until the next top-level `table.row` line or EOF.
 *   Label is built from the class chain.
 *
 * Returns an array of:
 *   { id?: string, label: string, startLine: number, endLine: number, kind: 'marker' | 'heuristic' }
 *
 * startLine / endLine are 0-based, inclusive. EMPTY array if nothing parseable.
 *
 * Exposed in both browser (window.OutlineParse) and ESM (export) flavors so
 * we can call it from workbench.js and unit-test it from a Node script.
 */

(function () {
  'use strict';

  function parseSourcePugBlocks(pugText) {
    if (typeof pugText !== 'string' || !pugText.trim()) return [];
    const lines = pugText.split('\n');

    // Strategy A: composed-mail markers
    const fromMarkers = _parseFromMarkers(lines);
    if (fromMarkers.length > 0) return fromMarkers;

    // Strategy B: heuristic on top-level table.row
    return _parseHeuristic(lines);
  }

  // ── Strategy A ────────────────────────────────────────────────────────
  function _parseFromMarkers(lines) {
    const out = [];
    const stack = []; // { id, startLine }
    const startRe = /^\s*\/\/-\s*block-start:\s*([a-z0-9][a-z0-9_-]*)\s*$/i;
    const endRe   = /^\s*\/\/-\s*block-end:\s*([a-z0-9][a-z0-9_-]*)\s*$/i;
    for (let i = 0; i < lines.length; i++) {
      const ms = lines[i].match(startRe);
      if (ms) { stack.push({ id: ms[1], startLine: i }); continue; }
      const me = lines[i].match(endRe);
      if (me) {
        // Find matching start by id (allows minor ordering quirks).
        for (let s = stack.length - 1; s >= 0; s--) {
          if (stack[s].id === me[1]) {
            out.push({
              id: me[1],
              label: me[1],
              startLine: stack[s].startLine,
              endLine: i,
              kind: 'marker',
            });
            stack.splice(s, 1);
            break;
          }
        }
      }
    }
    // Sort by startLine just in case.
    return out.sort((a, b) => a.startLine - b.startLine);
  }

  // ── Strategy B ────────────────────────────────────────────────────────
  function _parseHeuristic(lines) {
    const isTopLevel = (line) => {
      if (!line || /^\s/.test(line)) return false;
      return /^table\.row(\.|\(|\s|$)/.test(line);
    };
    const labelFor = (line) => {
      // Pull class chain after "table.row" and before any "(" or whitespace.
      const head = (line.match(/^table[^\s(]*/) || [''])[0]; // e.g. "table.row.bg-img"
      const classes = head.split('.').slice(2); // drop "table" + "row"
      if (!classes.length) return 'row (plain)';
      // Cap to first 3 classes for readability.
      return 'row · ' + classes.slice(0, 3).join(' · ') + (classes.length > 3 ? '…' : '');
    };

    const starts = [];
    for (let i = 0; i < lines.length; i++) {
      if (isTopLevel(lines[i])) starts.push(i);
    }
    if (starts.length === 0) return [];
    return starts.map((startLine, idx) => {
      const next = starts[idx + 1];
      const endLine = next !== undefined ? next - 1 : lines.length - 1;
      return {
        label: labelFor(lines[startLine]),
        startLine,
        endLine,
        kind: 'heuristic',
      };
    });
  }

  // ── Helpers ───────────────────────────────────────────────────────────

  /**
   * Given a parsed-blocks array and an insertion target (0-based block index
   * to insert *after*, or -1 to insert at the very top), return a placement
   * object suitable for workbench.js's insertEmailBlock(block, placement).
   */
  function placementForInsertAfter(blocks, index) {
    if (!blocks || !blocks.length || index < 0) {
      return { line: 0, before: true };
    }
    const target = blocks[Math.min(index, blocks.length - 1)];
    // Insert at the line *after* the target's end. before:true means the new
    // content goes at the very start of that line (so we push existing content
    // down).
    return { line: target.endLine + 1, before: true };
  }

  const api = { parseSourcePugBlocks, placementForInsertAfter };

  // Browser global
  if (typeof window !== 'undefined') window.OutlineParse = api;
  // Node CJS export
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
