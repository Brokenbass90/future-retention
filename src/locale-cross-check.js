/**
 * src/locale-cross-check.js — zero-AI cross-locale consistency check.
 *
 * Compares EVERY locale of a namespace against a reference locale and
 * surfaces structural drift that breaks emails or signals bad translations:
 *   - block_count        : locale has more/fewer blocks than the reference
 *   - missing_var        : a {{variable}} present in the reference block is
 *                          absent from the same block of this locale
 *   - extra_var          : a {{variable}} appears in the locale but not in
 *                          the reference (often a mistranslated token)
 *   - bold_mismatch      : number of @@bold@@ segments differs from reference
 *   - unbalanced_bold    : odd number of @@ markers (a broken bold pair)
 *   - empty_block        : block is blank while the reference block has text
 *                          (untranslated / missing)
 *   - untranslated_copy  : non-reference locale block is byte-identical to the
 *                          reference (likely forgotten translation)
 *
 * Input shape matches ctx.namespaces[i].locales: { [code]: string[] }
 * where each string is one block's text (already parsed, no {{ }} wrapper).
 */

const VAR_RE = /\{\{\s*([\w.]+)\s*\}\}/g;

function extractVars(text) {
  const out = [];
  let m;
  VAR_RE.lastIndex = 0;
  while ((m = VAR_RE.exec(String(text || ""))) !== null) out.push(m[1]);
  return out;
}

function countBold(text) {
  const marks = (String(text || "").match(/@@/g) || []).length;
  return { pairs: Math.floor(marks / 2), balanced: marks % 2 === 0 };
}

function multisetDiff(a, b) {
  // items in `a` not covered by `b` (by count)
  const counts = new Map();
  for (const x of b) counts.set(x, (counts.get(x) || 0) + 1);
  const missing = [];
  for (const x of a) {
    const c = counts.get(x) || 0;
    if (c > 0) counts.set(x, c - 1);
    else missing.push(x);
  }
  return missing;
}

/**
 * @param {object} opts
 * @param {Record<string,string[]>} opts.locales  code → array of block texts
 * @param {string} [opts.refCode]                 reference locale (default: en* or first)
 * @returns {{ refCode, refBlockCount, locales, issues, summary }}
 */
export function compareLocales({ locales, refCode } = {}) {
  const codes = Object.keys(locales || {});
  if (!codes.length) return { error: "no locales to compare" };

  const ref = refCode && locales[refCode]
    ? refCode
    : (codes.find((c) => /^en/i.test(c)) || codes[0]);
  const refBlocks = Array.isArray(locales[ref]) ? locales[ref] : [];
  const refBlockCount = refBlocks.length;

  const issues = [];
  const byLocale = {};

  for (const code of codes) {
    if (code === ref) { byLocale[code] = 0; continue; }
    const blocks = Array.isArray(locales[code]) ? locales[code] : [];
    let n = 0;
    const push = (block, kind, detail) => { issues.push({ locale: code, block, kind, detail }); n += 1; };

    if (blocks.length !== refBlockCount) {
      push(null, "block_count", `${blocks.length} блок(ов) против ${refBlockCount} в reference (${ref})`);
    }

    const max = Math.max(blocks.length, refBlockCount);
    for (let i = 0; i < max; i += 1) {
      const rt = refBlocks[i];
      const lt = blocks[i];
      if (rt === undefined || lt === undefined) continue; // count issue already flagged

      const refVars = extractVars(rt);
      const locVars = extractVars(lt);
      const missing = multisetDiff(refVars, locVars);
      const extra = multisetDiff(locVars, refVars);
      for (const v of new Set(missing)) push(i, "missing_var", `нет {{${v}}}`);
      for (const v of new Set(extra)) push(i, "extra_var", `лишняя {{${v}}}`);

      const rb = countBold(rt);
      const lb = countBold(lt);
      if (!lb.balanced) push(i, "unbalanced_bold", "нечётное число @@ (сломана пара жирного)");
      else if (lb.pairs !== rb.pairs) push(i, "bold_mismatch", `${lb.pairs} пар @@ против ${rb.pairs} в reference`);

      const rtTrim = String(rt).trim();
      const ltTrim = String(lt).trim();
      if (rtTrim && !ltTrim) push(i, "empty_block", "блок пуст, в reference есть текст");
      else if (rtTrim && ltTrim && rtTrim === ltTrim && refVars.length < extractVars(rtTrim).length + 1 && /[a-zA-Zа-яА-Я]/.test(rtTrim))
        push(i, "untranslated_copy", "совпадает с reference дословно (возможно, не переведено)");
    }

    byLocale[code] = n;
  }

  return {
    refCode: ref,
    refBlockCount,
    locales: codes,
    issues,
    summary: { byLocale, total: issues.length },
  };
}
