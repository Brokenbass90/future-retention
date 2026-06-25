/**
 * src/html-validate.js — lightweight structural validator the AI agent can call
 * to find unclosed tags and unbalanced braces/markers. Heuristic (regex), not a
 * full parser, but catches the common breakages in email templates.
 */
const VOID_TAGS = new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);

export function validateHtml(html) {
  const src = String(html || '');
  const issues = [];

  // 1) Tag balance (ignores comments, doctype, void elements, self-closing).
  let work = src.replace(/<!--[\s\S]*?-->/g, '').replace(/<!doctype[^>]*>/gi, '');
  const tagRe = /<(\/?)([a-zA-Z][\w:-]*)\b([^>]*)>/g;
  const stack = [];
  let m;
  while ((m = tagRe.exec(work)) !== null) {
    const closing = m[1] === '/';
    const tag = m[2].toLowerCase();
    const attrs = m[3] || '';
    if (VOID_TAGS.has(tag) || /\/\s*$/.test(attrs)) continue; // void or self-closing
    if (!closing) stack.push(tag);
    else {
      if (!stack.length) { issues.push({ kind: 'stray_close', tag, message: `</${tag}> без открывающего` }); continue; }
      if (stack[stack.length - 1] === tag) stack.pop();
      else {
        const at = stack.lastIndexOf(tag);
        if (at === -1) issues.push({ kind: 'stray_close', tag, message: `</${tag}> без открывающего` });
        else { const dropped = stack.splice(at); const inner = dropped.slice(1); issues.push({ kind: 'mismatch', tag, inner, message: `</${tag}> закрыт через незакрытые: ${inner.join(', ')}` }); }
      }
    }
  }
  for (const t of stack) issues.push({ kind: 'unclosed_tag', tag: t, message: `<${t}> не закрыт` });

  // 2) Brace balance {{ }} (platform vars / locale tokens).
  const open2 = (src.match(/\{\{/g) || []).length;
  const close2 = (src.match(/\}\}/g) || []).length;
  if (open2 !== close2) issues.push({ kind: 'brace_mismatch', message: `{{ x${open2} vs }} x${close2}` });

  // 3) Placeholder token balance ${{ … }}$
  const phOpen = (src.match(/\$\{\{/g) || []).length;
  const phClose = (src.match(/\}\}\$/g) || []).length;
  if (phOpen !== phClose) issues.push({ kind: 'placeholder_mismatch', message: `\${{ x${phOpen} vs }}$ x${phClose}` });

  // 4) Bold markers @@ should be even.
  const at = (src.match(/@@/g) || []).length;
  if (at % 2 !== 0) issues.push({ kind: 'bold_unbalanced', message: `@@ встречается ${at} раз (нечётно)` });

  return { ok: issues.length === 0, count: issues.length, issues };
}
