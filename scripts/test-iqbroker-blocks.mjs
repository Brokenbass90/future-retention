#!/usr/bin/env node
/**
 * test-iqbroker-blocks.mjs — нарезка письма IQ Broker.
 *
 * Блоки нарезаны из email-base/X_IQBroker/mail-strategies (см.
 * scripts/iqbroker-cut/). Главное, за чем следим:
 *   – блок самодостаточен: каждый класс с CSS либо заскоуплен на блок, либо
 *     это ink-примитив (.row/.columns/.wrapper), который есть в любом письме.
 *     Незаскоупленный семейный класс — это скрытая зависимость от main.styl
 *     чужого письма, ровно та беда, ради которой затевался скоуп;
 *   – блоки помечены тегом семьи, иначе вкладка бренда покажет их не там;
 *   – дерево письма собирается без предупреждений.
 *
 * Пиксельная сверка с оригиналом — отдельный ручной прогон (Chromium), здесь
 * проверяется структура. Zero-AI, без сети. Exit 0 = pass.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import url from "node:url";
import { normalizeBlockLibrarySavePayload } from "../src/block-library-schema.js";
import { classesUsedInPug, classesDefinedInStyl } from "../src/scope-block-styles.js";
import { loadStyleRegistry, lookupClass, LAYERS } from "../src/style-registry.js";
import { composeEmailFromBlocks } from "../src/compose-email.js";
import { loadBrands } from "../src/brands.js";
import pug from "pug";
import stylus from "stylus";

const repoRoot = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const CANONICAL = path.join(repoRoot, "data", "block-library", "canonical");
let pass = 0, fail = 0;
const check = (name, cond, extra = "") => {
  if (cond) { pass++; console.log("  \x1b[32m✓\x1b[0m", name); }
  else { fail++; console.error(`  \x1b[31m✗ ${name}\x1b[0m ${extra}`); }
};

/** Примитивы вёрстки ink: есть в каждом письме, скоупить их незачем. */
const INK = new Set([
  "row", "columns", "column", "wrapper", "last", "container", "body",
  "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve",
  "offset-by-one", "offset-by-two", "footer", "subscribe", "left", "right", "mobile-paddding",
]);

const files = readdirSync(CANONICAL).filter((f) => f.startsWith("iqbr-") && f.endsWith(".json"));
const blocks = files.map((f) => JSON.parse(readFileSync(path.join(CANONICAL, f), "utf8")));
const registry = loadStyleRegistry();

check("нарезка на месте", blocks.length >= 17, `найдено ${blocks.length}`);

/* ─── Схема и метки ──────────────────────────────────────────────────────── */
for (const block of blocks) {
  let error = "";
  try { normalizeBlockLibrarySavePayload({ ...block }); } catch (e) { error = String(e.message || e); }
  check(`${block.id}: проходит схему библиотеки`, !error, error);
}
check("все помечены тегом семьи",
  blocks.every((b) => (b.tags || []).includes("iqbroker")),
  blocks.filter((b) => !(b.tags || []).includes("iqbroker")).map((b) => b.id).join(","));
check("тег совпадает с blockTag бренда в реестре",
  loadBrands().find((b) => b.id === "X_IQBroker")?.blockTag === "iqbroker");
check("старые блоки помечены своим тегом и не смешиваются",
  readdirSync(CANONICAL).filter((f) => f.startsWith("iq-")).every((f) => {
    const d = JSON.parse(readFileSync(path.join(CANONICAL, f), "utf8"));
    return (d.tags || []).map((t) => String(t).toLowerCase()).includes("iq");
  }));

/* ─── Самодостаточность ──────────────────────────────────────────────────── */
for (const block of blocks) {
  const defined = new Set(classesDefinedInStyl(block.styl));
  const leaks = [];
  for (const cls of classesUsedInPug(block.pug)) {
    if (defined.has(cls) || INK.has(cls)) continue;
    if (cls.startsWith("iqbr-")) continue;
    // Двойной скоуп: класс есть и во фреймворке, и в семье (.center,
    // .text-pad-small). Оригинал оставлен ради ink-базы, а семейная часть
    // лежит в блоке под именем `<id>--<class>`. Зависимости нет.
    // Комбо несёт CSS своих детей, поэтому двойник у него с их префиксом.
    if (defined.has(`${block.id}--${cls}`)) continue;
    if (block.combo && [...defined].some((d) => d.endsWith(`--${cls}`))) continue;
    const variants = lookupClass(cls, registry);
    // Класс без CSS в семье — просто хук разметки, зависимости нет.
    if (!variants.some((v) => v.layer === LAYERS.family)) continue;
    leaks.push(cls);
  }
  check(`${block.id}: нет скрытой зависимости от чужого main.styl`, leaks.length === 0, leaks.join(","));
}

/* ─── Дерево собирается ──────────────────────────────────────────────────── */
{
  const tree = [
    { uid: "o", blockId: "iqbr-outer-wrapper", parentUid: null, slotId: null, slots: {} },
    { uid: "h", blockId: "iqbr-section-header", parentUid: "o", slotId: "sections", slots: {} },
    { uid: "hl", blockId: "iqbr-logo", parentUid: "h", slotId: "content", slots: {} },
    { uid: "hero", blockId: "iqbr-section-dark", parentUid: "o", slotId: "sections", slots: {} },
    { uid: "hm", blockId: "iqbr-image", parentUid: "hero", slotId: "media", slots: {} },
    { uid: "ht", blockId: "iqbr-title-white", parentUid: "hero", slotId: "content", slots: {} },
    { uid: "hx", blockId: "iqbr-text-white", parentUid: "hero", slotId: "content", slots: {} },
    { uid: "hb", blockId: "iqbr-button", parentUid: "hero", slotId: "content", slots: {} },
    { uid: "sp", blockId: "iqbr-spacer", parentUid: "o", slotId: "sections", slots: {} },
    { uid: "card", blockId: "iqbr-section-bordered", parentUid: "o", slotId: "sections", slots: {} },
    { uid: "t", blockId: "iqbr-title-middle", parentUid: "card", slotId: "content", slots: {} },
    { uid: "g", blockId: "iqbr-text-gray", parentUid: "card", slotId: "content", slots: {} },
    { uid: "cols", blockId: "iqbr-two-columns", parentUid: "card", slotId: "content", slots: {} },
    { uid: "lt", blockId: "iqbr-block-title", parentUid: "cols", slotId: "left", slots: {} },
    { uid: "ll", blockId: "iqbr-list-3", parentUid: "cols", slotId: "left", slots: {} },
    { uid: "rt", blockId: "iqbr-block-title", parentUid: "cols", slotId: "right", slots: {} },
    { uid: "rn", blockId: "iqbr-block-note", parentUid: "cols", slotId: "right", slots: {} },
    { uid: "b", blockId: "iqbr-button", parentUid: "card", slotId: "content", slots: {} },
    { uid: "st", blockId: "iqbr-stores", parentUid: "o", slotId: "sections", slots: {} },
    { uid: "sc", blockId: "iqbr-socials", parentUid: "o", slotId: "sections", slots: {} },
    { uid: "ft", blockId: "iqbr-footer", parentUid: "o", slotId: "sections", slots: {} },
  ];
  let result = null, error = "";
  try {
    result = composeEmailFromBlocks({
      brand: "X_preview", mailName: "iqbr-selftest", blocks: tree, validateOnly: true,
    });
  } catch (e) { error = String(e.message || e); }
  check("письмо из нарезки собирается на дефолтах", Boolean(result), error);
  check("без предупреждений", (result?.warnings || []).length === 0, (result?.warnings || []).join("; "));
  check("двойной блок принимает вложенные блоки в обе колонки",
    Boolean(result) && result.totalBlocks === tree.length, `${result?.totalBlocks} из ${tree.length}`);
}

/* ─── Комбо: рецепт согласован с блоками ─────────────────────────────────── */
{
  const byId = new Map(readdirSync(CANONICAL)
    .map((f) => JSON.parse(readFileSync(path.join(CANONICAL, f), "utf8")))
    .map((b) => [b.id, b]));
  const combos = blocks.filter((b) => b.combo === true);
  check("комбо на месте", combos.length >= 8, `найдено ${combos.length}`);

  for (const combo of combos) {
    const roles = new Map();
    const problems = [];
    for (const [index, child] of (combo.children || []).entries()) {
      const def = byId.get(child.id);
      if (!def) { problems.push(`${child.id}: блока нет в библиотеке`); continue; }
      if (child.role) roles.set(child.role, def);

      // Куда именно кладётся ребёнок: в контейнер комбо или в блок по parentRole.
      const host = child.parentRole ? roles.get(child.parentRole) : (index === 0 ? null : byId.get(combo.children[0].id));
      if (!child.slotId) continue;
      if (!host) { problems.push(`${child.id}: parentRole "${child.parentRole}" объявлен позже, чем используется`); continue; }
      const slots = (host.childSlots || []).map((cs) => cs.id);
      if (!slots.includes(child.slotId)) {
        problems.push(`${child.id}: слота "${child.slotId}" нет у ${host.id} (есть: ${slots.join(",") || "нет вовсе"})`);
      }
    }
    check(`${combo.id}: рецепт согласован с блоками`, problems.length === 0, problems.join(" · "));
  }

  // Плоская разметка комбо нужна для превью и для вставки одним блоком —
  // она обязана компилироваться, иначе превью молча не соберётся.
  for (const combo of combos) {
    let error = "";
    try { pug.compile(combo.pug, { pretty: false }); } catch (e) { error = String(e.message || e).slice(0, 120); }
    check(`${combo.id}: разметка компилируется`, !error, error);
    let stylError = "";
    try { stylus(combo.styl || "").render(); } catch (e) { stylError = String(e.message || e).slice(0, 120); }
    check(`${combo.id}: стили компилируются`, !stylError, stylError);
    check(`${combo.id}: разметка не пустая`, (combo.pug || "").trim().length > 100, String((combo.pug || "").length));
  }
}

console.log(`\niqbroker-blocks: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
