#!/usr/bin/env node
/**
 * test-brand-theme-compose.mjs — тема бренда доходит до стилей письма.
 *
 * Ради чего это: универсальный блок должен уметь написать
 * `background: $brand_primary` и перекраситься при переключении бренда,
 * вместо того чтобы цвет был вбит в блок руками.
 *
 * Два обещания проверяем отдельно:
 *   1. переменные бренда есть в main.styl ДО стилей блоков и содержат цвета
 *      именно этого бренда (а без бренда — дефолты, сборка не падает);
 *   2. существующие письма от этого не меняются НИ НА БАЙТ: неиспользованная
 *      переменная Stylus не даёт CSS. Это проверяется сравнением скомпилиро-
 *      ванного CSS с темой и без неё, а не рассуждением.
 *
 * Zero-AI, без сети. Exit 0 = pass.
 */
import { existsSync, readFileSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";
import stylus from "stylus";
import { composeEmailFromBlocks, brandThemeStylusHeader } from "../src/compose-email.js";
import { getBrand, THEME_TOKENS } from "../src/brands.js";

const REPO = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const check = (name, cond, extra = "") => {
  if (cond) { pass++; console.log("  \x1b[32m✓\x1b[0m", name); }
  else { fail++; console.error(`  \x1b[31m✗ ${name}\x1b[0m ${extra}`); }
};

/* ─── Заголовок темы ─────────────────────────────────────────────────────── */
{
  const iq = getBrand("X_IQ");
  const header = brandThemeStylusHeader("X_IQ");
  check("переменных столько же, сколько токенов",
    THEME_TOKENS.every((t) => header.includes(`$brand_${t.id} = `)),
    header.split("\n").slice(0, 3).join(" | "));
  check("цвета взяты из реестра, а не выдуманы",
    header.includes(`$brand_primary = ${iq.theme.primary}`), header.split("\n")[1]);
  check("в заголовке видно, чей это бренд", header.includes(iq.label));

  const unknown = brandThemeStylusHeader("X_NoSuchBrandAtAll");
  check("бренда нет в реестре — берём дефолты, а не падаем",
    THEME_TOKENS.every((t) => unknown.includes(`$brand_${t.id} = ${t.fallback}`)));
  check("и честно об этом пишем", /по умолчанию/.test(unknown));
  check("подпись — строчный комментарий Stylus (блочный утёк бы в CSS письма)",
    header.trim().startsWith("//") && !header.includes("/*"), header.split("\n")[0]);
}

/* ─── Письмо собирается, переменные на месте ─────────────────────────────── */
const tmp = path.join(os.tmpdir(), "retkit-brand-theme-test");
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });
for (const item of ["vendor", "tools", "node_modules"]) {
  const src = path.join(REPO, "email-base", item);
  const dst = path.join(tmp, item);
  if (existsSync(src) && !existsSync(dst)) { try { symlinkSync(src, dst, "dir"); } catch { /* ignore */ } }
}

const MAIL = "brand-theme";
const tree = [
  { uid: "o", blockId: "iq-outer-wrapper", parentUid: null, slotId: null, slots: {} },
  { uid: "s", blockId: "iq-section", parentUid: "o", slotId: "sections", slots: {} },
  { uid: "t", blockId: "iq-text-title", parentUid: "s", slotId: "content", slots: {} },
];
composeEmailFromBlocks({ brand: "X_IQ", mailName: MAIL, blocks: tree, destRoot: tmp });

const mainStylPath = path.join(tmp, "X_IQ", `mail-${MAIL}`, "app", "styles", "blocks", "main.styl");
const mainStyl = readFileSync(mainStylPath, "utf8");
{
  check("main.styl собран", mainStyl.length > 0);
  check("переменные бренда попали в письмо", mainStyl.includes("$brand_primary = "));
  const varAt = mainStyl.indexOf("$brand_primary = ");
  const blocksAt = mainStyl.indexOf("/* iq-text-title */");
  check("переменные объявлены ДО стилей блоков (иначе Stylus их не увидит)",
    varAt > 0 && blocksAt > 0 && varAt < blocksAt, `${varAt} vs ${blocksAt}`);
}

/* ─── Главное: старые письма не меняются ─────────────────────────────────── */
const stylesDir = path.dirname(mainStylPath);
function renderCss(source) {
  return stylus(source).set("filename", mainStylPath).set("paths", [stylesDir, path.dirname(stylesDir)]).render();
}
{
  // Убираем ровно тот кусок, что добавили, и сравниваем скомпилированный CSS.
  const withoutTheme = mainStyl.replace(brandThemeStylusHeader("X_IQ"), "");
  check("вырезали именно вставку", withoutTheme.length < mainStyl.length
    && !withoutTheme.includes("$brand_primary = "));
  let a = null, b = null, error = "";
  try { a = renderCss(mainStyl); b = renderCss(withoutTheme); }
  catch (e) { error = String(e.message || e).slice(0, 160); }
  check("main.styl компилируется", Boolean(a) && Boolean(b), error);
  check("CSS письма не изменился ни на байт — неиспользованная переменная не даёт правил",
    a !== null && a === b, a && b ? `${a.length} vs ${b.length}` : error);
}

/* ─── А блок, который её использует, получает цвет бренда ────────────────── */
{
  const iq = getBrand("X_IQ");
  const css = stylus(`${brandThemeStylusHeader("X_IQ")}
.universal-button
  background-color: $brand_primary
  color: $brand_primary_text
`).render();
  // Stylus сжимает #FF7700 до #f70 — это тот же цвет, поэтому сравниваем по
  // значению, а не по написанию. (Сжатие не наше: так же поступает Stylus с
  // любым hex, вписанным в блок руками.)
  const short = (hex) => {
    const h = hex.replace("#", "").toLowerCase();
    return h[0] === h[1] && h[2] === h[3] && h[4] === h[5] ? `#${h[0]}${h[2]}${h[4]}` : `#${h}`;
  };
  const hasColour = (hex) => css.toLowerCase().includes(hex.toLowerCase()) || css.toLowerCase().includes(short(hex));
  check("блок с $brand_primary компилируется в цвет бренда",
    hasColour(iq.theme.primary), css.replace(/\s+/g, " ").slice(0, 120));
  check("и токен текста на основном тоже работает", hasColour(iq.theme.primary_text));
}

rmSync(tmp, { recursive: true, force: true });
console.log(`\nbrand-theme-compose: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
