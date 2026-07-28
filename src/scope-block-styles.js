/**
 * src/scope-block-styles.js — делаем блок самодостаточным.
 *
 * Проблема: блок несёт только тот CSS, который автор положил ему в `styl`,
 * а всё остальное молча берёт из `blocks/main.styl` семьи. Имена там значат
 * разное: `.m-w` — 10 разных ширин, `.bgr-image` — 36 разных фоновых картинок.
 * Поэтому блок, вырезанный из одной семьи, в другой едет.
 *
 * Что делает скоуп:
 *   1. классы, которые принадлежат блоку, переименовываются в `<id>--<class>`
 *      (`.gray-block` → `.iq-gray-step--gray-block`) — столкнуться с чужим
 *      классом такое имя уже не может;
 *   2. правила, которые блок брал из семьи, ВТЯГИВАЮТСЯ внутрь его `styl`
 *      (выбор варианта при многозначности — по data/style-decisions.json);
 *   3. фреймворковые классы (ink/vendor: .row, .columns, .wrapper, .center)
 *      НЕ трогаются: это общие примитивы вёрстки, дублировать их в каждый
 *      блок бессмысленно, а переименовать — значит сломать скелет.
 *
 * Функция чистая: принимает блок, отдаёт новый блок и отчёт. Запись на диск и
 * проверка «до/после» — в scripts/scope-block-styles.mjs.
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import url from "node:url";
import { loadStyleRegistry, lookupClass, rulesForClasses, LAYERS } from "./style-registry.js";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const DECISIONS_PATH = path.join(repoRoot, "data", "style-decisions.json");

let decisionsCache = null;
export function loadStyleDecisions() {
  if (decisionsCache) return decisionsCache;
  try { decisionsCache = JSON.parse(readFileSync(DECISIONS_PATH, "utf8")); }
  catch { decisionsCache = { classes: {} }; }
  return decisionsCache;
}
export function invalidateStyleDecisions() { decisionsCache = null; }

/* ─── Извлечение классов ─────────────────────────────────────────────────── */

/** Классы, которые блок использует в разметке (pug-сокращения + class="…"). */
export function classesUsedInPug(pug) {
  const out = new Set();
  for (const rawLine of String(pug || "").split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("//")) continue;
    const head = line.split(/[\s(]/, 1)[0] || "";
    for (const m of head.matchAll(/\.([_a-zA-Z][\w-]*)/g)) out.add(m[1]);
    for (const m of rawLine.matchAll(/\bclass\s*=\s*(["'])([\s\S]*?)\1/g)) {
      for (const token of m[2].split(/\s+/)) {
        if (!token || token.includes("{{")) continue;
        if (/^[_a-zA-Z][\w-]*$/.test(token)) out.add(token);
      }
    }
  }
  return [...out];
}

/** Классы, которые блок сам определяет в своём styl. */
export function classesDefinedInStyl(styl) {
  const out = new Set();
  for (const m of String(styl || "").matchAll(/(^|[\s,{}>+~])\.([_a-zA-Z][\w-]*)(?=[\s,{:.]|$)/gm)) {
    out.add(m[2]);
  }
  return [...out];
}

/* ─── Классификация ──────────────────────────────────────────────────────── */

/**
 * Раскладывает классы блока по слоям.
 * @returns {{own:string[], framework:string[], overridden:string[], family:string[], missing:string[]}}
 */
export function classifyBlockClasses(block, registry = loadStyleRegistry()) {
  const used = classesUsedInPug(block.pug);
  const own = new Set(classesDefinedInStyl(block.styl));
  const out = { own: [], ownOverFramework: [], framework: [], overridden: [], family: [], missing: [] };

  for (const cls of used) {
    if (own.has(cls)) {
      // Блок переопределяет фреймворковый класс (.logo, .butt, .text-pad-small):
      // базовые правила приходят из ink/vendor, а блок дописывает своё поверх.
      // Просто переименовать нельзя — потеряется фреймворковая база.
      if (lookupClass(cls, registry).some((v) => v.layer === LAYERS.framework)) out.ownOverFramework.push(cls);
      else out.own.push(cls);
      continue;
    }
    const variants = lookupClass(cls, registry);
    if (!variants.length) { out.missing.push(cls); continue; }
    const familyBase = variants.filter((v) => v.layer === LAYERS.family && !v.media);
    if (!familyBase.length) { out.framework.push(cls); continue; }
    // Класс есть и во фреймворке, и в семье (.row, .columns — Ink, который
    // семьи переопределяют). Оставляем фреймворковый: он есть в каждом письме.
    if (variants.some((v) => v.layer === LAYERS.framework)) { out.overridden.push(cls); continue; }
    out.family.push(cls);
  }
  // Класс может быть объявлен в styl блока, но не встречаться в разметке —
  // это мёртвый CSS, переименовывать его тоже надо, иначе он останется
  // глобальным и продолжит влиять на чужие блоки.
  for (const cls of own) {
    if (used.includes(cls)) continue;
    if (lookupClass(cls, registry).some((v) => v.layer === LAYERS.framework)) out.ownOverFramework.push(cls);
    else out.own.push(cls);
  }
  return out;
}

/* ─── Переименование ─────────────────────────────────────────────────────── */

/** Префикс скоупа блока: `iq-gray-step--`. */
export function scopePrefix(blockId) {
  return `${String(blockId).replace(/[^a-z0-9_-]/gi, "-")}--`;
}

/** `.gray-block` в блоке `iq-gray-step` → `.iq-gray-step--gray-block`. */
export function scopedName(blockId, cls) {
  return `${scopePrefix(blockId)}${cls}`;
}

/** Класс уже принадлежит скоупу этого блока — второй раз префиксовать нельзя. */
export function isAlreadyScoped(blockId, cls) {
  return String(cls).startsWith(scopePrefix(blockId));
}

/**
 * Замена имён классов в Pug. Трогаем только позиции классов:
 * сокращения `tag.a.b` в начале строки и содержимое `class="…"`.
 * Текст, атрибуты href/src и токены слотов остаются как есть.
 */
/**
 * @param {Map<string,string>} renames — класс → новое имя (замена)
 * @param {Map<string,string>} [additions] — класс → добавочное имя (оба остаются)
 */
export function renameClassesInPug(pug, renames, additions = new Map()) {
  if (!renames.size && !additions.size) return String(pug || "");
  return String(pug || "").split("\n").map((line) => {
    const indent = line.match(/^\s*/)[0];
    let rest = line.slice(indent.length);
    if (!rest || rest.startsWith("//")) return line;

    // Голова строки: tag.a.b#id(attrs) — заменяем только до первой скобки/пробела.
    const headMatch = rest.match(/^[\w-]*((?:\.[_a-zA-Z][\w-]*)+)/);
    if (headMatch) {
      const replaced = headMatch[1].replace(/\.([_a-zA-Z][\w-]*)/g, (all, cls) => {
        if (renames.has(cls)) return `.${renames.get(cls)}`;
        // Фреймворковый класс остаётся на месте, рядом встаёт скоуп-версия:
        // база приходит из ink, а правки блока — из его собственного правила.
        if (additions.has(cls)) return `.${cls}.${additions.get(cls)}`;
        return all;
      });
      rest = rest.slice(0, headMatch.index + headMatch[0].length - headMatch[1].length)
        + replaced + rest.slice(headMatch.index + headMatch[0].length);
    }
    // Атрибут class="a b"
    rest = rest.replace(/\bclass\s*=\s*(["'])([\s\S]*?)\1/g, (all, quote, value) => {
      const next = value.split(/(\s+)/).map((token) => {
        if (renames.has(token)) return renames.get(token);
        if (additions.has(token)) return `${token} ${additions.get(token)}`;
        return token;
      }).join("");
      return `class=${quote}${next}${quote}`;
    });
    return indent + rest;
  }).join("\n");
}

/** Замена имён классов в CSS/Stylus-исходнике блока. */
export function renameClassesInStyl(styl, renames) {
  if (!renames.size) return String(styl || "");
  return String(styl || "").replace(/\.([_a-zA-Z][\w-]*)/g,
    (all, cls) => (renames.has(cls) ? `.${renames.get(cls)}` : all));
}

/* ─── Главная операция ───────────────────────────────────────────────────── */

/**
 * @param {object} block — запись библиотеки блоков
 * @param {object} [options]
 * @param {object} [options.registry]
 * @param {object} [options.decisions]
 * @returns {{block:object, report:object}} новый блок и что с ним сделали
 */
export function scopeBlockStyles(block, { registry = loadStyleRegistry(), decisions = loadStyleDecisions() } = {}) {
  const buckets = classifyBlockClasses(block, registry);
  const report = {
    id: block.id,
    source: block.source,
    renamed: [],
    pulled: [],
    ambiguousResolved: [],
    turnedIntoSlots: [],
    skipped: [],
    dualScoped: [],
    missing: [...buckets.missing],
    keptGlobal: [...buckets.framework, ...buckets.overridden],
    changed: false,
  };

  const decisionFor = (cls) => decisions?.classes?.[cls] || null;

  // 1) Что втягиваем из семьи, а что нет.
  const pullClasses = [];
  for (const cls of buckets.family) {
    const decision = decisionFor(cls);
    if (decision?.skip) { report.skipped.push({ class: cls, why: decision.why || "решение: не трогать" }); continue; }
    if (decision?.slot) { report.turnedIntoSlots.push({ class: cls, slot: decision.slot, why: decision.why }); continue; }
    pullClasses.push(cls);
  }

  // 2) Правила из реестра. preferSource решает многозначность.
  const pulledChunks = [];
  for (const cls of pullClasses) {
    const decision = decisionFor(cls);
    const result = rulesForClasses([cls], { registry, preferSource: decision?.prefer || null });
    if (!result.css) { report.missing.push(cls); continue; }
    pulledChunks.push(result.css);
    report.pulled.push(cls);
    for (const a of result.ambiguous) {
      report.ambiguousResolved.push({
        class: a.class, variants: a.variants, from: a.chosenFrom,
        decided: Boolean(decision?.prefer),
      });
    }
  }

  // 3) Переименование: свои классы + втянутые. Фреймворковые не трогаем.
  // Повторный прогон не должен давать `.demo--demo--x`: уже отскоупленные
  // классы пропускаем. Операция обязана быть идемпотентной — её будут гонять
  // и при импорте блока, и при ручном сохранении из конструктора.
  const renames = new Map();
  for (const cls of [...new Set([...buckets.own, ...report.pulled])]) {
    if (isAlreadyScoped(block.id, cls)) continue;
    const scoped = scopedName(block.id, cls);
    if (scoped === cls) continue;
    renames.set(cls, scoped);
  }
  // Классы, где блок дописывает поверх фреймворка: оставляем оба имени.
  const additions = new Map();
  for (const cls of buckets.ownOverFramework) {
    if (isAlreadyScoped(block.id, cls)) continue;
    const scoped = scopedName(block.id, cls);
    if (scoped === cls) continue;
    additions.set(cls, scoped);
  }

  const allRenames = new Map([...renames, ...additions]);
  const nextPug = renameClassesInPug(block.pug, renames, additions);
  // В styl переименовываем и те, и другие: собственное правило блока должно
  // стать скоупным, а фреймворковое мы и не трогали — оно живёт в ink.
  const ownStyl = renameClassesInStyl(block.styl || "", allRenames);
  const pulledStyl = renameClassesInStyl(pulledChunks.join("\n"), renames);

  const nextStyl = [
    ownStyl.trim(),
    pulledStyl.trim()
      ? `/* втянуто из стилей семьи при скоупе — блок больше не зависит от main.styl */\n${pulledStyl.trim()}`
      : "",
  ].filter(Boolean).join("\n\n");

  report.renamed = [...renames.entries()].map(([from, to]) => ({ from, to }));
  report.dualScoped = [...additions.entries()].map(([from, to]) => ({ from, to }));
  report.changed = nextPug !== block.pug || nextStyl !== (block.styl || "");

  const next = {
    ...block,
    pug: nextPug,
    styl: nextStyl,
    version: Number(block.version || 1) + (report.changed ? 1 : 0),
    scoped: true,
  };

  // 4) Классы, которые решено не втягивать значением.
  //    Слот здесь НЕ создаём: поле в инспекторе, не протянутое в pug, — это
  //    обещание, которое интерфейс не выполняет. Пока класс просто остаётся
  //    глобальным (берётся из скелета), а в отчёте видно, что с ним делать.
  for (const item of report.turnedIntoSlots) {
    item.pending = "слот появится, когда класс протянут в pug инлайн-стилем";
  }

  return { block: next, report };
}
