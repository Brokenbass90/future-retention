#!/usr/bin/env node
/**
 * Полная арабизация письма (mode "document") против эталона команды:
 * scripts/fixtures/rtl/photo-welcome2.source.html → photo-welcome2.ar-rtl.expected.html
 * (английский шаблон с арабским текстом → готовое арабское письмо).
 *
 * Сверяем то, что видит почтовый клиент: dir/align и стороны во всех inline
 * стилях каждого элемента — должно совпасть 1:1. CSS в <style> эталон
 * отзеркалил наполовину (добавил «0» с другой стороны, не перенеся значение);
 * у нас — честное зеркало, его проверяем отдельно по правилам.
 */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import url from "node:url";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const { applyRtl } = require(path.join(root, "email-base", "tools", "rtl.js"));
const fx = (name) => readFileSync(path.join(root, "scripts", "fixtures", "rtl", name), "utf8");
const source = fx("photo-welcome2.source.html");
const expected = fx("photo-welcome2.ar-rtl.expected.html");

let ok = 0, fail = 0;
const check = (name, cond, detail = "") => {
  if (cond) { ok += 1; console.log(`  ✓ ${name}`); } else { fail += 1; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
};

const PROPS = ["text-align", "padding-left", "padding-right", "margin-left", "margin-right", "float", "direction"];
function elements(html) {
  const body = html.replace(/<style[\s\S]*?<\/style>/gi, "");
  const out = [];
  const re = /<([a-z][a-z0-9]*)\b([^>]*)>/gi;
  let m;
  while ((m = re.exec(body))) {
    const tag = m[1].toLowerCase();
    if (tag === "br" || tag === "meta") continue;
    const attr = (n) => (m[2].match(new RegExp(`\\b${n}\\s*=\\s*"([^"]*)"`, "i")) || [])[1] || "";
    const style = attr("style");
    const props = {};
    for (const p of PROPS) {
      const all = [...style.matchAll(new RegExp(`(?:^|;)\\s*${p}\\s*:\\s*([^;]+)`, "gi"))];
      if (all.length) props[p] = all[all.length - 1][1].trim().replace(/\s+/g, " ");
    }
    out.push({ tag, dir: attr("dir"), align: attr("align"), props });
  }
  return out;
}

const out = applyRtl(source, { mode: "document", lang: "ar" });
const A = elements(out);
const E = elements(expected);
check("столько же элементов", A.length === E.length, `${A.length} vs ${E.length}`);
const diffs = [];
for (let i = 0; i < Math.min(A.length, E.length); i += 1) {
  for (const k of ["dir", "align"]) if (A[i][k] !== E[i][k]) diffs.push(`${i} <${E[i].tag}> ${k}: «${A[i][k]}» вместо «${E[i][k]}»`);
  for (const p of PROPS) if ((A[i].props[p] || "") !== (E[i].props[p] || "")) diffs.push(`${i} <${E[i].tag}> ${p}: «${A[i].props[p] || ""}» вместо «${E[i].props[p] || ""}»`);
}
check("каждый элемент как в эталоне (dir, align, стороны)", diffs.length === 0, diffs.slice(0, 6).join("; "));
check("<html dir=rtl lang=ar>", /<html\b[^>]*\bdir="rtl"[^>]*\blang="ar"|<html\b[^>]*\blang="ar"[^>]*\bdir="rtl"/.test(out));
check("тексты не тронуты", (out.match(/[؀-ۿ]+/g) || []).join(" ") === (source.match(/[؀-ۿ]+/g) || []).join(" "));
check("ссылки и картинки не тронуты",
  JSON.stringify(out.match(/(?:href|src)="[^"]*"/g)) === JSON.stringify(source.match(/(?:href|src)="[^"]*"/g)));
check("повторный прогон ничего не меняет", applyRtl(out, { mode: "document" }) === out);

const css = (out.match(/<style>([\s\S]*?)<\/style>/i) || [])[1] || "";
check("CSS: колонка-отступ перенесена направо", /td\.offset-by-one\{padding-right:50px\}/.test(css));
check("CSS: мобильный отступ !important тоже зеркален", /\.text-pad-small\{padding-right:20px!important\}/.test(css));
check("CSS: 4-значный margin зеркален", /\.middle-item\{width:160px;margin: 0 24px 10px 10px\}/.test(css));
check("CSS: float у «Отписаться» уходит влево", /a\.right\{[^}]*float: left/.test(css));
check("CSS: фон с url() не тронут", css.includes("background:url(https://fsms.quadcode.com/storage/public/da/qi/pg6p3qts7059jvpg/bg1.jpg) center no-repeat"));
check("CSS: центр остаётся центром", /table\.center,td\.center\{text-align:center\}/.test(css));

check("старые режимы не изменились (text)", !/<html\b[^>]*dir=/.test(applyRtl(source, { mode: "text" })));

/* Письмо с карточками-иллюстрациями (photo-welcome7): большая картинка на
 * фоне прижата к краю, текст стоит колонкой с другой стороны. Зеркалить такую
 * карточку нельзя — текст уедет на картинку. Текст арабизируем, карточку нет. */
{
  const w7 = fx("photo-welcome7.source.html");
  let report = null;
  const ar = applyRtl(w7, { mode: "document", lang: "ar", onReport: (r) => { report = r; } });
  check("иллюстрации распознаны (bg1, bg2, bg3)", JSON.stringify(report?.illustrations) === JSON.stringify(["bg1", "bg2", "bg3"]), JSON.stringify(report));
  for (const c of ["bg1", "bg2", "bg3"]) {
    const tag = (ar.match(new RegExp(`<div[^>]*class="${c}"[^>]*>`)) || [""])[0];
    check(`${c}: карточка dir=ltr, картинка осталась справа`, /dir="ltr"/.test(tag) && /\) right (?:bottom|center) no-repeat/.test(tag), tag.slice(0, 160));
  }
  const css7 = (ar.match(/<style>([\s\S]*?)<\/style>/i) || [])[1] || "";
  check("CSS иллюстраций не тронут (и мобильный тоже)", /\.bg3\{background:url\([^)]+\) right top no-repeat!important/.test(css7) && /\.bg1\{background:url\([^)]+\) right bottom no-repeat;background-size:464px\}/.test(css7));
  const card = ar.slice(ar.indexOf('class="bg1"'), ar.indexOf('class="bg2"'));
  check("внутри карточки текст справа налево", /<p dir="rtl" class="subtitle pb15"[^>]*text-align: right;/.test(card));
  check("внутри карточки колонка не сдвинута (нет dir у обёрток)", !/<div dir="rtl" class="(?:padd|w230)"/.test(card));
  check("иконки слева (bg4–bg7) зеркалены целиком: иконка справа, отступ справа",
    /class="bg4" style="background: url\([^)]+\) right center no-repeat; background-size: 56px;[^"]*padding-right: 70px;/.test(ar)
    && /\.bg5,\.bg6,\.bg7\{background-size:56px;padding-right:70px\}/.test(css7));
  check("остальное письмо арабизировано", /<html\b[^>]*dir="rtl"/.test(ar) && (ar.match(/ dir="rtl"/g) || []).length > 60);
  const naive = applyRtl(w7, { mode: "document", keepIllustrations: false });
  check("можно отключить (keepIllustrations: false)", !/dir="ltr"/.test(naive));
}

// Уже арабизированное письмо не трогаем и не падаем — в любом режиме.
{
  const done = '<!doctype html><html dir="rtl" lang="ar"><body><p style="padding-left:10px">مرحبا</p></body></html>';
  let report = null;
  check("html dir=rtl: document — без изменений", applyRtl(done, { mode: "document", onReport: (r) => { report = r; } }) === done && report?.alreadyRtl === true);
  check("html dir=rtl: text (авто превью/сборка) — без изменений", applyRtl(done, { mode: "text" }) === done);
  check("html dir=rtl: mirror — без изменений", applyRtl(done, { mode: "mirror" }) === done);
  const marked = applyRtl('<html><body><p style="text-align:left">مرحبا</p></body></html>', { mode: "document" });
  check("маркер document: text не падает и не меняет", applyRtl(marked, { mode: "text" }) === marked);
  const textMarked = applyRtl('<html><body><p style="text-align:left">مرحبا</p></body></html>', { mode: "text" });
  check("старый RTL text + кнопка document — не падает, не трогает", applyRtl(textMarked, { mode: "document" }) === textMarked);
  check("v1 + document — не падает, не трогает", applyRtl('<!--retkit-rtl:v1--><p>x</p>', { mode: "document" }) === '<!--retkit-rtl:v1--><p>x</p>');
}

console.log(`\nrtl-document: ${ok} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
