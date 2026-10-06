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

console.log(`\nrtl-document: ${ok} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
