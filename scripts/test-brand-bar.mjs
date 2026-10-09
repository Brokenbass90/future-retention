#!/usr/bin/env node
/**
 * test-brand-bar.mjs — полоса брендов в конструкторе.
 *
 * Главное, что проверяем: браузерная нормализация цвета совпадает с серверной.
 * Если они разойдутся, интерфейс покажет цвет, который сервер потом отвергнет
 * (или, хуже, примет в другом виде) — а цвет в письме обязан быть ровно тем,
 * что видел человек.
 *
 * Функции достаются из public/brand-bar.js текстом: файл — браузерный IIFE,
 * импортировать его в Node нельзя, а дублировать логику в тесте — значит
 * проверять копию вместо оригинала.
 *
 * Zero-AI, без сети. Exit 0 = pass.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import url from "node:url";
import { normalizeHex as serverHex, BrandError, THEME_TOKENS } from "../src/brands.js";

const repoRoot = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const check = (name, cond, extra = "") => {
  if (cond) { pass++; console.log("  \x1b[32m✓\x1b[0m", name); }
  else { fail++; console.error(`  \x1b[31m✗ ${name}\x1b[0m ${extra}`); }
};

const barSource = readFileSync(path.join(repoRoot, "public", "brand-bar.js"), "utf8");
const constructorHtml = readFileSync(path.join(repoRoot, "public", "constructor.html"), "utf8");
const constructorJs = readFileSync(path.join(repoRoot, "public", "constructor.js"), "utf8");

/** Вырезать объявление функции целиком, считая фигурные скобки. */
function extractFn(source, name) {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`не найдена функция ${name}`);
  let depth = 0, started = false;
  for (let i = start; i < source.length; i += 1) {
    if (source[i] === "{") { depth += 1; started = true; }
    else if (source[i] === "}" && started && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`функция ${name} не закрыта`);
}

const browser = new Function([
  "const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;",
  extractFn(barSource, "normalizeHex"),
  extractFn(barSource, "readableOn"),
  "return { normalizeHex, readableOn };",
].join("\n"))();

/* ─── Цвет: браузер и сервер обязаны отвечать одинаково ──────────────────── */
{
  const good = ["#f70", "#FF7700", "#ff7700", "#000", "#ffffff", "  #1E90FF  "];
  for (const value of good) {
    check(`совпадает с сервером: ${value.trim()}`,
      browser.normalizeHex(value) === serverHex(value),
      `${browser.normalizeHex(value)} vs ${serverHex(value)}`);
  }
  const bad = ["rgb(1,2,3)", "rgba(1,2,3,.5)", "red", "#12345", "#FF770080", "оранжевый"];
  for (const value of bad) {
    let serverRefused = false;
    try { serverHex(value); } catch (e) { serverRefused = e instanceof BrandError; }
    check(`оба отвергают ${value}`, serverRefused && browser.normalizeHex(value) === "");
  }
}

/* ─── Метка на плашке должна читаться ────────────────────────────────────── */
{
  check("на светлой плашке текст тёмный", browser.readableOn("#FFFFFF") === "#101318");
  check("на тёмной плашке текст белый", browser.readableOn("#101318") === "#FFFFFF");
  check("оранжевый бренд — тёмный текст", browser.readableOn("#FF7700") === "#101318");
  check("синий бренд — белый текст", browser.readableOn("#2563EB") === "#FFFFFF");
  check("мусор не роняет функцию", typeof browser.readableOn("") === "string");
}

/* ─── Полоса подключена и размечена ──────────────────────────────────────── */
{
  for (const id of ["brandBar", "brandTabs", "brandAddBtn", "brandThemeBtn"]) {
    check(`в разметке есть #${id}`, constructorHtml.includes(`id="${id}"`));
  }
  const barAt = constructorHtml.indexOf('src="/brand-bar.js"');
  const ctorAt = constructorHtml.indexOf('src="/constructor.js"');
  check("brand-bar.js подключён", barAt > 0);
  check("подключён до constructor.js (тот читает window.RetkitBrands)",
    barAt > 0 && ctorAt > 0 && barAt < ctorAt, `${barAt} vs ${ctorAt}`);
}

/* ─── Высота рабочей области учитывает вторую полосу ─────────────────────── */
{
  const css = readFileSync(path.join(repoRoot, "public", "constructor.css"), "utf8");
  check("высота .workspace вычитает обе полосы",
    /height:\s*calc\(100% - var\(--topbar-h[^)]*\) - var\(--brandbar-h/.test(css));
  check("высоты объявлены переменными", /--brandbar-h:\s*\d+px/.test(css) && /--topbar-h:\s*\d+px/.test(css));
}

/* ─── Конструктор действительно пользуется активным брендом ──────────────── */
{
  check("цель сохранения предвыбирает активный бренд",
    constructorJs.includes("window.RetkitBrands?.activeId?.()"));
  check("бренд без писем всё равно попадает в список сохранения",
    /for \(const brand of \(window\.RetkitBrands\?\.all\?\.\(\) \|\| \[\]\)\)/.test(constructorJs));
  check("папки в базе писем берут бренд из реестра",
    constructorJs.includes("function drawBrandFolders()")
      && constructorJs.includes('window.RetkitBrands?.activeId?.() || "all"'));
  check("список писем фильтруется выбранной папкой",
    /selectedBrand === "all" \|\| e\.brand === selectedBrand/.test(constructorJs));
}

/* ─── Ручное заведение бренда ────────────────────────────────────────────── */
{
  // Бренд заводится так же вручную, как блок: имя папки, тег и все восемь
  // цветов задаются человеком, а не подставляются молча.
  const suggest = new Function([
    barSource.slice(barSource.indexOf("  const TRANSLIT = {"), barSource.indexOf("  /* ─── Тема бренда")),
    "return suggestFolder;",
  ].join("\n"))();
  check("папка подсказывается транслитерацией", suggest("Новый бренд") === "X_NovyyBrend", suggest("Новый бренд"));
  check("латиница остаётся собой", suggest("IQ Broker") === "X_IQBroker", suggest("IQ Broker"));
  check("название без букв не даёт папку", suggest("2026") === "");

  for (const field of ["brandNewLabel", "brandNewFolder", "brandNewTag"]) {
    check(`в форме есть поле ${field}`, barSource.includes(`id="${field}"`));
  }
  check("в форме все токены темы, а не один цвет",
    barSource.includes("state.tokens.map((token)") && barSource.includes('data-hex="${esc(token.id)}"'));
  check("тег и папку можно переписать руками",
    barSource.includes("folderTouched") && barSource.includes("tagTouched"));
}

/* ─── Токены темы одни и те же на сервере и в диалоге ────────────────────── */
{
  check("диалог темы строится по токенам сервера, а не по своему списку",
    barSource.includes("state.tokens.map") && barSource.includes("data.tokens"),
    "тема должна приходить из /api/brands");
  check("токенов у сервера восемь", THEME_TOKENS.length === 8, String(THEME_TOKENS.length));
}

/* ─── Служебные папки не выдаются за рабочий бренд ───────────────────────── */
{
  check("служебные бренды скрыты из полосы",
    barSource.includes("filter((b) => !b.service)"));
}

console.log(`\nbrand-bar: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
