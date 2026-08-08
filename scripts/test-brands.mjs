#!/usr/bin/env node
/**
 * test-brands.mjs — бренд как сущность.
 *
 * Главное, что проверяем:
 *   – реестр самозасевается из папок на диске, то есть подключение ничего
 *     не ломает и до первой правки повторяет прежнюю политику видимости;
 *   – цвета темы только HEX (в почте цвет обязан быть явным #RRGGBB);
 *   – имя папки выводится из названия, включая кириллицу;
 *   – правка темы мержится, а не затирает остальные токены.
 *
 * Реестр — файл в data/, поэтому тест работает на его копии и возвращает
 * исходный файл на место.
 *
 * Zero-AI, без сети. Exit 0 = pass.
 */
import { existsSync, readFileSync, writeFileSync, rmSync, rmdirSync } from "node:fs";
import path from "node:path";
import url from "node:url";
import {
  loadBrands, saveBrands, createBrand, updateBrand, getBrand,
  brandFolderFromLabel, normalizeHex, themeAsStylus, themeSlotValues,
  THEME_TOKENS, BRANDS_PATH, BrandError,
} from "../src/brands.js";

const repoRoot = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const check = (name, cond, extra = "") => {
  if (cond) { pass++; console.log("  \x1b[32m✓\x1b[0m", name); }
  else { fail++; console.error(`  \x1b[31m✗ ${name}\x1b[0m ${extra}`); }
};

// Снимок реестра: тест не должен оставлять следов в рабочей базе.
const hadRegistry = existsSync(BRANDS_PATH);
const backup = hadRegistry ? readFileSync(BRANDS_PATH, "utf8") : null;
const TEST_ID = "X_TestBrandFixture";

function cleanup() {
  try {
    const brands = loadBrands().filter((b) => b.id !== TEST_ID);
    if (backup !== null) writeFileSync(BRANDS_PATH, backup);
    else if (existsSync(BRANDS_PATH)) rmSync(BRANDS_PATH);
    else saveBrands(brands);
  } catch { /* восстановление не должно ронять отчёт */ }
  try { rmdirSync(path.join(repoRoot, "email-base", TEST_ID)); } catch { /* уже нет */ }
}

try {
  /* ─── Посев ────────────────────────────────────────────────────────────── */
  {
    const brands = loadBrands();
    check("реестр непустой", brands.length > 0, String(brands.length));
    check("бренды с диска подхвачены", brands.some((b) => b.id === "X_IQ"),
      brands.map((b) => b.id).join(","));
    check("у каждого бренда полная тема",
      brands.every((b) => THEME_TOKENS.every((t) => /^#[0-9A-F]{6}$/.test(b.theme[t.id] || ""))),
      JSON.stringify(brands[0]?.theme));
    check("служебный бренд помечен", brands.some((b) => b.id === "X_preview" && b.service));
    // Во вкладках должны остаться только рабочие бренды: архив и свалка
    // сборок помечены служебными и полосу не занимают.
    check("во вкладках только рабочие бренды",
      brands.filter((b) => !b.service).map((b) => b.id).join(",") === "X_IQ,X_IQBroker",
      brands.filter((b) => !b.service).map((b) => b.id).join(","));
    check("архивный бренд не активен",
      brands.find((b) => b.id === "X_System")?.active === false);

    // Порядок вкладок: первый в списке становится брендом по умолчанию.
    check("IQ Option идёт первым", brands[0]?.id === "X_IQ", brands[0]?.id);
    check("IQ Broker вторым", brands[1]?.id === "X_IQBroker", brands[1]?.id);
    check("служебные бренды в хвосте",
      brands.filter((b) => b.service).every((b, i, arr) => brands.indexOf(b) >= brands.length - arr.length));
  }

  /* ─── Имя папки из названия ────────────────────────────────────────────── */
  {
    check("латиница", brandFolderFromLabel("IQ Broker") === "X_IQBroker");
    check("кириллица транслитерируется",
      brandFolderFromLabel("Новый бренд") === "X_NovyyBrend", brandFolderFromLabel("Новый бренд"));
    check("регистр первой буквы сохраняется",
      brandFolderFromLabel("Экснова") === "X_Eksnova", brandFolderFromLabel("Экснова"));
    let refused = false;
    try { brandFolderFromLabel("2026"); } catch { refused = true; }
    check("название без букв отвергается с подсказкой", refused);
  }

  /* ─── Цвета только HEX ─────────────────────────────────────────────────── */
  {
    check("короткий hex разворачивается", normalizeHex("#f70") === "#FF7700");
    check("регистр приводится к верхнему", normalizeHex("#ff7700") === "#FF7700");
    for (const bad of ["rgb(1,2,3)", "rgba(1,2,3,.5)", "red", "#12345", "#FF770080"]) {
      let refused = false;
      try { normalizeHex(bad); } catch (e) { refused = e instanceof BrandError; }
      check(`отклонён неподходящий цвет ${bad}`, refused);
    }
  }

  /* ─── Создание ─────────────────────────────────────────────────────────── */
  {
    const brand = createBrand({ label: "Test Brand Fixture", theme: { primary: "#1E90FF" } });
    check("бренд создан", brand.id === TEST_ID, brand.id);
    check("тема применена", brand.theme.primary === "#1E90FF");
    check("остальные токены заполнены дефолтами", brand.theme.text === "#393A44");
    check("папка письма создана сразу",
      existsSync(path.join(repoRoot, "email-base", TEST_ID)));
    check("бренд виден в реестре", Boolean(getBrand(TEST_ID)));

    let conflict = null;
    try { createBrand({ label: "Test Brand Fixture" }); }
    catch (e) { conflict = e; }
    check("повторное создание отвергается 409-м", conflict?.statusCode === 409, String(conflict?.message));
  }

  /* ─── Правка ───────────────────────────────────────────────────────────── */
  {
    const updated = updateBrand(TEST_ID, { theme: { link: "#ff0" } });
    check("токен изменён", updated.theme.link === "#FFFF00", updated.theme.link);
    check("остальные токены НЕ затёрты", updated.theme.primary === "#1E90FF", updated.theme.primary);
    check("createdAt не переписан", Boolean(updated.createdAt));

    const renamed = updateBrand(TEST_ID, { label: "Переименован", active: false });
    check("название меняется", renamed.label === "Переименован");
    check("активность меняется", renamed.active === false);

    let missing = null;
    try { updateBrand("X_NoSuchBrand", { label: "x" }); } catch (e) { missing = e; }
    check("правка несуществующего — 404", missing?.statusCode === 404);
  }

  /* ─── Тема в вёрстку ───────────────────────────────────────────────────── */
  {
    const brand = getBrand(TEST_ID);
    const stylus = themeAsStylus(brand);
    check("тема отдаётся переменными Stylus",
      stylus.includes("$brand_primary = #1E90FF"), stylus.split("\n")[0]);
    check("переменных столько же, сколько токенов",
      stylus.trim().split("\n").length === THEME_TOKENS.length);

    const slots = themeSlotValues(brand);
    check("тема отдаётся значениями слотов",
      slots.brand_primary === "#1E90FF" && slots.brand_text === "#393A44",
      JSON.stringify(slots).slice(0, 90));
  }
} finally {
  cleanup();
}

check("реестр восстановлен после теста",
  hadRegistry ? existsSync(BRANDS_PATH) : !existsSync(BRANDS_PATH));
check("тестовый бренд убран", !loadBrands().some((b) => b.id === TEST_ID));

console.log(`\nbrands: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
