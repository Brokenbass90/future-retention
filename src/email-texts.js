/**
 * src/email-texts.js — тексты письма по порядку, как их видит читатель.
 *
 * Агенту не нужно 25 КБ инлайн-стилей, чтобы узнать, что написано в письме:
 * отдаём только видимые тексты (и прехедер, alt, title) в порядке документа,
 * плюс что осталось неподставленным. Без зависимостей — простой разбор тегов.
 */
const ENTITY = { "&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&zwnj;": "" };
const decode = (text) => String(text).replace(/&(?:nbsp|amp|lt|gt|quot|#39|zwnj);/g, (m) => ENTITY[m] ?? m)
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));

export function extractEmailTexts(html) {
  const source = String(html || "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<head[\s\S]*?<\/head>/i, "")
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, "");
  const items = [];
  const push = (kind, raw) => {
    const text = decode(raw).replace(/\s+/g, " ").trim();
    if (!text || /^[\s‌ ]*$/.test(text)) return;
    items.push({ index: items.length, kind, text });
  };
  const preheader = /<div[^>]*class="[^"]*preheader[^"]*"[^>]*>([\s\S]*?)<\/div>/i.exec(source);
  if (preheader) push("preheader", preheader[1].replace(/<[^>]+>/g, ""));
  const body = preheader ? source.replace(preheader[0], "") : source;
  // Блочные теги разрывают текст; строчные (b, a, span…) — нет.
  const chunks = body.replace(/<(?:\/?(?:p|div|td|th|tr|table|h[1-6]|li|ul|ol|br|center|tbody)\b)[^>]*>/gi, "\n")
    .replace(/<img\b[^>]*>/gi, (tag) => {
      const alt = /\balt="([^"]*)"/i.exec(tag)?.[1];
      return alt ? `\n\u0001alt:${alt}\n` : "\n";
    })
    .replace(/<[^>]+>/g, "")
    .split("\n");
  for (const chunk of chunks) {
    if (chunk.startsWith("\u0001alt:")) push("alt", chunk.slice(5));
    else push("text", chunk);
  }
  const html2 = String(html || "");
  return {
    count: items.length,
    texts: items,
    placeholders: (html2.match(/\$\{\{\s*[^}]+?\s*\}\}\$/g) || []).length,
    unresolved: [...new Set(html2.match(/\$\{\{\s*[^}]+?\s*\}\}\$/g) || [])].slice(0, 20),
    sizeKb: Math.round(Buffer.byteLength(html2) / 102.4) / 10,
  };
}
