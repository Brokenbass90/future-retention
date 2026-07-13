#!/usr/bin/env node
/**
 * Прототип сборщика: outer -> section -> inner.
 * - вытаскивает <style> из каждого блока
 * - объединяет их в один <style> в голове outer с дедупликацией правил
 *   (верхнеуровневые правила и @media-блоки — как целые единицы)
 * - вкладывает markup по слотам SECTION_BLOCKS / INNER_BLOCKS
 * - подставляет тестовые значения слотов {{ ... }}
 *
 * Запуск: node email-base/_blocks-proto/assemble.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(HERE, p), "utf8");

// --- вытащить содержимое первого <style ...>...</style> и вернуть {css, html-без-style} ---
function splitStyle(src) {
  const m = src.match(/<style[^>]*>([\s\S]*?)<\/style>/i);
  const css = m ? m[1] : "";
  let html = src.replace(/<style[^>]*>[\s\S]*?<\/style>/i, "").trim();
  // срезаем ведущий документационный комментарий блока (шапку)
  html = html.replace(/^\s*<!--[\s\S]*?-->\s*/, "").trim();
  return { css, html };
}

// --- разбить CSS на верхнеуровневые правила (учитывая вложенность @media) ---
function splitRules(css) {
  const rules = [];
  let depth = 0, buf = "";
  for (const ch of css) {
    buf += ch;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) { rules.push(buf.trim()); buf = ""; }
    }
  }
  if (buf.trim()) rules.push(buf.trim());
  return rules.filter(Boolean);
}

// --- объединить и дедупить набор CSS-строк ---
function mergeCss(cssParts) {
  const seen = new Set();
  const out = [];
  for (const css of cssParts) {
    for (const rule of splitRules(css)) {
      const key = rule.replace(/\s+/g, " ").trim();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(rule);
    }
  }
  return out.join("\n            ");
}

const fillComment = (html, slot, content) =>
  html.replace(new RegExp(`<!--\\s*\\{\\{\\s*${slot}\\s*\\}\\}[\\s\\S]*?-->`), content);

const fillSlots = (html, values) =>
  html.replace(/\{\{\s*([\w]+)\s*\}\}/g, (_, k) => (k in values ? values[k] : `{{ ${k} }}`));

// ---- читаем блоки ----
const outer = splitStyle(read("outer/outer-wrapper.html"));
const section = splitStyle(read("section/section-white-bordered.html"));
const inner = splitStyle(read("inner/inner-promocode-card.html"));

// ---- тестовые значения слотов ----
const values = {
  preheader: "Тестовое письмо конструктора",
  step_number: "2",
  step_title: "Enter the promo code",
  step_text: "and make a deposit from $15",
  promocode_label: "Promocode",
  promocode: "CLAIM10C",
  promocode_hint: "Copy the promo code from the field above",
};

// ---- вкладываем markup по слотам ----
let sectionHtml = fillComment(section.html, "INNER_BLOCKS", inner.html);
let bodyHtml = fillComment(outer.html, "SECTION_BLOCKS", sectionHtml);
bodyHtml = fillSlots(bodyHtml, values);

// ---- собираем единый <style> (framework + section + inner, дедуп) ----
const mergedCss = mergeCss([outer.css, section.css, inner.css]);
let doc = bodyHtml.replace(
  /<style>[\s\S]*?<\/style>/i,
  `<style>\n            ${mergedCss}\n        </style>`
);

const outPath = join(HERE, "_test", "assembled.html");
writeFileSync(outPath, doc, "utf8");

// ---- краткая статистика ----
const count = (css) => splitRules(css).length;
console.log("Собрано:", outPath);
console.log(`Правил CSS: outer=${count(outer.css)} + section=${count(section.css)} + inner=${count(inner.css)} -> merged=${count(mergedCss)}`);
