#!/usr/bin/env node
/**
 * test-block-previews-visible.mjs — в карточке каталога что-то видно.
 *
 * Блок в студии выбирают глазами, по картинке. Пустая карточка читается как
 * «блок сломан», и человек его обходит — хотя чаще сломано не блок, а превью:
 * белый текст отрисован на белой подложке, картинка не загрузилась, содержимое
 * не поместилось в кадр.
 *
 * Эти пустые карточки копились молча: их никто не считал. Здесь они считаются.
 * Список известных пустых заморожен и может только СОКРАЩАТЬСЯ — новый пустой
 * блок валит проверку сразу, а не через полгода.
 *
 * Спейсеры и разделители пустые по назначению — их не трогаем.
 *
 * Браузер не нужен: смотрим уже отрисованные PNG. Exit 0 = pass.
 */
import { previewBackdropForBlock, hasLightTextInStyles } from "../src/block-previews.js";
import { PNG } from "pngjs";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import url from "node:url";

const repoRoot = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const PREVIEWS = path.join(repoRoot, "data", "block-previews");
let pass = 0, fail = 0;
const check = (name, cond, extra = "") => {
  if (cond) { pass++; console.log("  \x1b[32m✓\x1b[0m", name); }
  else { fail++; console.error(`  \x1b[31m✗ ${name}\x1b[0m ${extra}`); }
};

/**
 * Известные пустые карточки. Список замораживает долг, а не разрешает его:
 * каждая строка — блок, который человек в каталоге видит пустым.
 *
 * Семь блоков с белым текстом уже починились тёмной подложкой и отсюда
 * вычеркнуты. Оставшиеся — другой природы, их надо смотреть руками.
 *
 * Чинить так: перерисовать превью (`npm run previews -- --only <id>`), убедиться,
 * что карточка перестала быть пустой, и вычеркнуть строку отсюда.
 */
const KNOWN_EMPTY = new Set([
  "canonical/iq-hero-copy",
  "imported/iq-cta-35",
  "imported/iq-utility-02",
  "imported/iq-utility-03",
  "imported/iq-utility-04",
  "imported/iq-utility-05",
  "imported/iq-utility-09",
  "imported/iq-utility-11",
  "imported/iq-utility-12",
  "imported/iq-utility-13",
  "imported/iq-utility-14",
  "imported/iq-utility-15",
  "imported/iq-utility-22",
  "imported/iqbroker-cta-13",
]);

/** Пустые по назначению: им нечего показывать. */
const BY_DESIGN_EMPTY = /spacer|space|divider|gap/i;

/** Доля пикселей, отличных от фона. Ниже порога карточка выглядит пустой. */
function visibleRatio(file) {
  const png = PNG.sync.read(readFileSync(file));
  const bg = [png.data[0], png.data[1], png.data[2]];
  let different = 0;
  for (let i = 0; i < png.data.length; i += 4) {
    const distance = Math.abs(png.data[i] - bg[0])
      + Math.abs(png.data[i + 1] - bg[1])
      + Math.abs(png.data[i + 2] - bg[2]);
    if (distance > 24) different++;
  }
  return { ratio: different / (png.width * png.height), width: png.width, height: png.height };
}

/* ─── 1. Пустых карточек не прибавилось ──────────────────────────────────── */
{
  const empty = [];
  const fixed = [];
  let checked = 0;
  for (const source of ["canonical", "imported", "user"]) {
    const dir = path.join(PREVIEWS, source);
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".desktop.png")) continue;
      const id = file.slice(0, -".desktop.png".length);
      const key = `${source}/${id}`;
      if (BY_DESIGN_EMPTY.test(id)) continue;
      checked++;
      const { ratio } = visibleRatio(path.join(dir, file));
      if (ratio < 0.001) empty.push(key);
      else if (KNOWN_EMPTY.has(key)) fixed.push(key);
    }
  }

  check("превью вообще есть", checked > 100, String(checked));

  const fresh = empty.filter((key) => !KNOWN_EMPTY.has(key));
  check(
    "новых пустых карточек нет",
    fresh.length === 0,
    fresh.length
      ? `пустые: ${fresh.join(", ")} — перерисуйте превью и посмотрите, что не видно`
      : "",
  );

  if (fixed.length) {
    console.log(`    \x1b[36m↓ починились, вычеркните из KNOWN_EMPTY: ${fixed.join(", ")}\x1b[0m`);
  }
  console.log(`  пустых карточек: ${empty.length} из ${checked} (цель — 0)`);
  check("долг пустых карточек не вырос", empty.length <= KNOWN_EMPTY.size, `${empty.length} > ${KNOWN_EMPTY.size}`);
}

/* ─── 2. Белый текст получает тёмную подложку ────────────────────────────── */
{
  // Самая частая причина пустой карточки: блок с классом white-text рисуется
  // на белом фоне превью. Подложка должна включаться по нему автоматически.
  const whiteTextBlocks = [];
  for (const source of ["canonical", "imported", "user"]) {
    const dir = path.join(repoRoot, "data", "block-library", source);
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".json")) continue;
      let block;
      try { block = JSON.parse(readFileSync(path.join(dir, file), "utf8")); } catch { continue; }
      if (hasLightTextInStyles(block)) whiteTextBlocks.push(block.id);
    }
  }
  check("блоки с белым текстом найдены", whiteTextBlocks.length > 0, String(whiteTextBlocks.length));
  check("им всем назначена тёмная подложка", whiteTextBlocks.every((id) => {
    for (const source of ["canonical", "imported", "user"]) {
      const file = path.join(repoRoot, "data", "block-library", source, `${id}.json`);
      if (!existsSync(file)) continue;
      return Boolean(previewBackdropForBlock(JSON.parse(readFileSync(file, "utf8"))));
    }
    return false;
  }), whiteTextBlocks.join(", "));

  // И обратная защита: правило узкое нарочно. Кнопке с белым текстом на своей
  // заливке тёмная подложка не нужна — она и так видна, а перерисовка сотни
  // исправных превью стоит дороже пользы.
  const button = { id: "x", pug: 'a.butt-link(href="#") Текст', styl: ".butt-link\\n  color #fff\\n  background-color #ff7a00" };
  check("кнопке подложка не навязывается", !hasLightTextInStyles(button));
  const hero = { id: "y", pug: "div.hero\\n  img(src='a.png')\\n  p.white-title Заголовок", styl: ".hero\\n  background url(a.png)" };
  check("блоку со своим фоном подложка не навязывается", !hasLightTextInStyles(hero));
  const plain = { id: "z", pug: "p.white-text Текст", styl: ".white-text\\n  font-size 14px" };
  check("простому белому тексту подложка нужна", hasLightTextInStyles(plain));
}

console.log(`\nblock-previews-visible: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
