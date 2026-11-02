/**
 * public/email-weight.js — «весы» письма для «Кода» и конструктора.
 *
 * Считает вес готового HTML в байтах (как его увидит почтовик) и самый
 * большой <style> в голове. Пороги — те же, что у сборки (build-mail.js):
 *   до 90 КБ   — норма;
 *   90–102 КБ  — близко к обрезке;
 *   от 102 КБ  — Gmail обрежет письмо («[Сообщение обрезано]»).
 * <style> больше 16 КБ Gmail выбрасывает целиком вместе с @media.
 */
(function (root) {
  "use strict";
  const KB = 1024;
  const WARN = 90 * KB;
  const CLIP = 102 * KB;
  const GMAIL_STYLE = 16 * KB;
  const encoder = typeof TextEncoder !== "undefined" ? new TextEncoder() : null;
  const bytesOf = (s) => (encoder ? encoder.encode(String(s || "")).length : unescape(encodeURIComponent(String(s || ""))).length);
  const kb = (n) => (n / KB).toFixed(1).replace(/\.0$/, "") + " КБ";

  function measure(html) {
    const text = String(html || "");
    const bytes = bytesOf(text);
    let styleBytes = 0;
    text.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, (_, css) => { styleBytes = Math.max(styleBytes, bytesOf(css)); return _; });
    const level = bytes >= CLIP ? "clip" : bytes >= WARN ? "warn" : "ok";
    const lines = [
      `Вес письма: ${kb(bytes)} (Gmail обрезает от ${kb(CLIP)})`,
      styleBytes ? `Самый большой <style>: ${kb(styleBytes)}${styleBytes > GMAIL_STYLE ? " — больше 16 КБ, Gmail выбросит его вместе с @media" : " — Gmail его оставит"}` : "",
    ].filter(Boolean);
    return { bytes, styleBytes, level, label: `⚖ ${kb(bytes)}`, title: lines.join("\n") };
  }

  /** Обновить элемент-бейдж: текст, подсказка и цвет по уровню. */
  function paint(el, html) {
    if (!el) return null;
    if (!html) { el.textContent = "⚖ —"; el.title = "Вес появится, когда соберётся превью"; el.dataset.level = ""; el.style.color = ""; return null; }
    const m = measure(html);
    el.textContent = m.label;
    el.title = m.title;
    el.dataset.level = m.level;
    el.style.color = m.level === "clip" ? "#ef4444" : m.level === "warn" ? "#f59e0b" : "#22c55e";
    return m;
  }

  root.RetkitEmailWeight = { measure, paint, WARN, CLIP, GMAIL_STYLE };
})(typeof globalThis !== "undefined" ? globalThis : this);
