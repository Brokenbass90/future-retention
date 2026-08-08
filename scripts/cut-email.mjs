#!/usr/bin/env node
/**
 * scripts/cut-email.mjs — разобрать письмо на блоки, не плодя дубли.
 *
 * Зачем: studio-model есть у 9 писем из 109 — остальные открываются в
 * конструкторе цельным куском кода. Разрезать их руками, как mail-strategies,
 * дорого; но и резать «в лоб» нельзя: каждое письмо принесёт свои копии
 * логотипа, кнопки и заголовка, и в каталоге станет невозможно искать.
 *
 * Поэтому главное здесь — СВЕРКА С БИБЛИОТЕКОЙ. Кусок письма превращается в
 * канонический вид, и если такой блок уже есть, используется он, а различия
 * уходят в значения слотов. Новый блок появляется, только если он правда новый.
 *
 * Канонический вид решает главную проблему сравнения: одно и то же в письмах
 * записано по-разному. `.pb16` и `padding-bottom:16px` — это один и тот же
 * отступ; `${{ ns.block_01 }}$` и «Заголовок» — одно и то же место под текст.
 * Без приведения к общему виду совпадений почти не находится.
 *
 *   node scripts/cut-email.mjs --brand X_IQBroker --mail welcome
 *   node scripts/cut-email.mjs --brand X_IQBroker --mail welcome --json
 *
 * СОСТОЯНИЕ: разбор и сверка с библиотекой работают, `--apply` пока НЕ проходит
 * пиксельную проверку (см. scripts/verify-cut.mjs, он откатывает созданное).
 * Осталось одно расхождение на `mail-tools` (тёмная панель +36px, большая
 * карточка −185px): в секции из НЕСКОЛЬКИХ рядов содержимое раскладывается по
 * рядам не в том порядке — замерено поэлементно, порядок узлов в собранном
 * письме отличается от оригинала. Чинить надо нумерацию зон.
 * Пока это не сведено к нулю, пользоваться стоит только сухим прогоном.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import url from "node:url";
import { createHash } from "node:crypto";
import { loadMailRules, scopeStyles } from "../src/block-styles-from-mail.js";

const repoRoot = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const EMAIL_BASE = path.join(repoRoot, "email-base");
const LIBRARY_DIRS = ["canonical", "user"].map((d) => path.join(repoRoot, "data", "block-library", d));

const opt = (name, fallback = null) => {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 && process.argv[at + 1] && !process.argv[at + 1].startsWith("--")
    ? process.argv[at + 1] : fallback;
};
const flag = (name) => process.argv.includes(`--${name}`);

/* ─── Чтение письма ──────────────────────────────────────────────────────── */

export function readMailTemplate(brand, mail) {
  const dir = path.join(EMAIL_BASE, brand, mail.startsWith("mail-") ? mail : `mail-${mail}`);
  let found = null;
  for (const name of ["header.pug", "header.jade"]) {
    const file = path.join(dir, "app", "templates", "blocks", name);
    if (existsSync(file)) { found = { file, source: readFileSync(file, "utf8") }; break; }
  }
  if (!found) throw new Error(`не найден blocks/header.(pug|jade) в ${dir}`);

  // Футер лежит отдельно, в helpers/footer, и в blocks/header его нет. Раньше
  // нарезка его просто теряла: собранное письмо выходило на 205px короче
  // оригинала. Для разбора это такая же секция, как остальные.
  for (const name of ["footer.pug", "footer.jade"]) {
    const file = path.join(dir, "app", "templates", "helpers", name);
    if (!existsSync(file)) continue;
    const footer = readFileSync(file, "utf8");
    if (footer.trim() && !footer.trim().startsWith("//")) {
      found.source = `${found.source.replace(/\s+$/, "")}\n\n${footer}`;
      found.footerFile = file;
    }
    break;
  }
  return found;
}

/**
 * Разрезать шаблон на секции верхнего уровня.
 * Секция — это узел с нулевым отступом вместе со всем, что под ним.
 */
export function splitSections(source) {
  const lines = String(source || "").split("\n");
  const sections = [];
  let current = null;
  for (const line of lines) {
    const isTop = line.trim() && !/^\s/.test(line);
    if (isTop) {
      if (current) sections.push(current);
      current = { start: line, lines: [line] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) sections.push(current);
  return sections
    .map((s) => s.lines.join("\n").replace(/\s+$/, ""))
    .filter((s) => s.trim() && !s.trim().startsWith("//"));
}

/* ─── Канонический вид ───────────────────────────────────────────────────── */

/**
 * Классы-утилиты: отступы (`pb16`) и высоты отбивок (`h-24`).
 *
 * Для сравнения они не значат ничего. Разница «здесь 16px, а там 32px»
 * выражается значением слота, а значит блок — тот же самый. Если этого не
 * учесть, каждое письмо приносит свою копию заголовка, отличающуюся одним
 * отступом, и каталог захлёбывается — ровно то, чего нельзя допустить.
 */
const UTILITY_CLASS = /^(?:(?:pb|pt|pl|pr|plr|mt|mb)\d{1,3}|h-\d{1,3}|w\d{2,4})$/;

/**
 * Убрать скоуп блока из имени класса: `iqbr-title-white--white-title` →
 * `white-title`. Нужно, чтобы сравнивать блок библиотеки с сырой вёрсткой
 * письма, где скоупа ещё нет.
 */
function unscope(cls, blockId) {
  const prefix = `${blockId}--`;
  return cls.startsWith(prefix) ? cls.slice(prefix.length) : cls;
}

/**
 * Каноническая строка одной строки Pug: тег, классы (без отступных утилит и
 * скоупа), объявления стиля (включая пришедшие из классов) и признак того,
 * что здесь есть текст/картинка/ссылка. Конкретные тексты и адреса
 * выбрасываются: они станут слотами.
 */
export function canonicalLine(rawLine, { blockId = "" } = {}) {
  const line = String(rawLine || "");
  const indent = line.match(/^\s*/)[0].length;
  const body = line.trim();
  if (!body || body.startsWith("//")) return null;

  const head = body.split(/[\s(]/, 1)[0] || "";
  const tag = (head.match(/^[a-zA-Z][\w-]*/) || ["div"])[0];
  const classes = [...head.matchAll(/\.([_a-zA-Z][\w-]*)/g)].map((m) => unscope(m[1], blockId));

  const keptClasses = classes.filter((cls) => !UTILITY_CLASS.test(cls));

  const has = [];
  if (/\bsrc\s*=/.test(body)) has.push("img");
  if (/\bhref\s*=/.test(body)) has.push("link");
  const text = body.replace(/^[^\s(]+(\([\s\S]*?\))?\s*/, "");
  if (text.trim()) has.push("text");

  // Дубли схлопываем: у отскоупленного блока класс стоит дважды
  // (`logo` и `iqbr-header-logo--logo`), и без этого одна и та же вёрстка
  // в письме и в библиотеке даёт разные отпечатки.
  //
  // Инлайновые стили в отпечаток НЕ входят вовсе: цвет, отступ и ширина —
  // это ровно то, что блок отдаёт слотами. Остаётся то, что слотом не
  // выражается: тег, смысловые классы, вложенность и наличие
  // картинки/ссылки/текста.
  return [
    indent,
    tag,
    [...new Set(keptClasses)].sort().join("."),
    has.join(","),
  ].join("|");
}

/** Каноническая форма куска вёрстки: построчно, с выравниванием отступов. */
export function canonicalShape(pug, { blockId = "" } = {}) {
  const lines = String(pug || "").split("\n")
    .map((l) => canonicalLine(l, { blockId }))
    .filter(Boolean);
  if (!lines.length) return "";
  // Отступы приводим к относительным ступеням: важна вложенность, а не то,
  // четыре пробела в письме или восемь.
  const indents = [...new Set(lines.map((l) => Number(l.split("|")[0])))].sort((a, b) => a - b);
  const level = new Map(indents.map((v, i) => [v, i]));
  return lines
    .map((l) => { const parts = l.split("|"); parts[0] = String(level.get(Number(parts[0]))); return parts.join("|"); })
    .join("\n");
}

export const shapeHash = (shape) => createHash("sha1").update(shape).digest("hex").slice(0, 12);

/* ─── Библиотека ─────────────────────────────────────────────────────────── */

export function loadLibraryShapes() {
  const out = [];
  for (const dir of LIBRARY_DIRS) {
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
      let block = null;
      try { block = JSON.parse(readFileSync(path.join(dir, file), "utf8")); } catch { continue; }
      if (!block?.pug) continue;
      // Маркер дочернего слота в каноническом виде не участвует: у контейнера
      // сравнивается сама оболочка, а содержимое разбирается отдельно.
      const pug = block.pug.split("\n").filter((l) => !/\{\{\s*[A-Z_]+\s*\}\}/.test(l)).join("\n");
      const shape = canonicalShape(pug, { blockId: block.id });
      if (!shape) continue;
      out.push({
        id: block.id,
        label: block.label,
        placement: block.placement,
        combo: block.combo === true,
        childSlots: (block.childSlots || []).map((c) => c.id),
        slotDefs: (block.slots || []).map((sl) => ({ id: sl.id, kind: sl.kind || "text" })),
        shape,
        hash: shapeHash(shape),
      });
    }
  }
  return out;
}

/* ─── Разбор секции: оболочка и содержимое ───────────────────────────────── */

/** Табличный каркас письма. Эти теги — оболочка, а не содержимое. */
const STRUCTURAL = new Set(["table", "tr", "td", "tbody", "thead", "center"]);

/** Дерево строк по отступам: с ним видно, у кого сколько детей. */
function buildTree(pug) {
  const nodes = pug.split("\n")
    .map((line, index) => ({ line, index, indent: line.match(/^\s*/)[0].length, body: line.trim() }))
    .filter((n) => n.body && !n.body.startsWith("//"))
    .map((n) => ({ ...n, tag: (n.body.match(/^([a-zA-Z][\w-]*)/) || [null, "div"])[1], children: [] }));

  const root = { indent: -1, children: [], index: -1, tag: "root" };
  const stack = [root];
  for (const node of nodes) {
    while (stack.length > 1 && stack[stack.length - 1].indent >= node.indent) stack.pop();
    stack[stack.length - 1].children.push(node);
    node.parent = stack[stack.length - 1];
    stack.push(node);
  }
  return { root, nodes };
}

/**
 * Отделить оболочку секции от содержимого.
 *
 * Правило одно: пока идёт табличный каркас (`table > tr > td …`) и у узла один
 * ребёнок — это ещё оболочка. Содержимое начинается там, где каркас
 * заканчивается: либо появился обычный тег (`p`, `a`, `ul`), либо у узла сразу
 * несколько детей. Для почтовой вёрстки это работает точнее, чем «самый
 * глубокий узел с несколькими детьми»: тот упирался в `ul > li` и резал
 * пункты списка вместо самих блоков.
 *
 * Зон может быть несколько: у тёмной панели это ряд с картинкой и ряд с
 * текстом — им соответствуют два дочерних слота контейнера.
 */
export function splitShellAndContent(sectionPug) {
  const lines = sectionPug.split("\n");
  const { root } = buildTree(sectionPug);
  const section = root.children[0];
  if (!section) return { shell: sectionPug, zones: [], parts: [] };

  const zones = [];
  const walk = (node) => {
    const kids = node.children;
    if (!kids.length) return;
    // Оболочкой считается не только табличный каркас, но и div-обёртка с
    // содержимым внутри (`.left-block > .padding-block`): иначе колонка
    // двойного блока обрывалась на внешнем div и не совпадала с библиотекой.
    // Лист (например `img` внутри `a`) оболочкой не считается — иначе
    // картинка отрывалась бы от своей ссылки.
    const chain = kids.length === 1
      && (STRUCTURAL.has(kids[0].tag) || (kids[0].tag === "div" && kids[0].children.length));
    if (chain) { walk(kids[0]); return; }
    if (kids.every((k) => STRUCTURAL.has(k.tag)) && kids.length > 1) {
      // Несколько рядов каркаса (два `tr` у тёмной панели) — у каждого своя зона.
      for (const kid of kids) walk(kid);
      return;
    }
    zones.push({ node, children: kids });
  };
  walk(section);

  const sliceOf = (node) => {
    const last = (function deepest(n) {
      return n.children.length ? deepest(n.children[n.children.length - 1]) : n;
    })(node);
    return lines.slice(node.index, last.index + 1).join("\n").replace(/\s+$/, "");
  };

  const partIndexes = new Set();
  const markerAt = new Map();
  const parts = [];
  for (const [zoneIndex, zone] of zones.entries()) {
    // На месте вырезанного содержимого оставляем маркер дочернего слота.
    // Без него у секции с двумя рядами (картинка сверху, текст снизу) второй
    // ряд оставался пустым: всё содержимое сваливалось в один слот.
    markerAt.set(zone.children[0].index, `${" ".repeat(zone.children[0].indent)}//- {{ ZONE_${zoneIndex + 1} }}`);
    for (const child of zone.children) {
      parts.push({ zone: zoneIndex + 1, pug: sliceOf(child) });
      const last = (function deepest(n) {
        return n.children.length ? deepest(n.children[n.children.length - 1]) : n;
      })(child);
      for (let i = child.index; i <= last.index; i += 1) partIndexes.add(i);
    }
  }

  const shell = lines
    .map((line, index) => (markerAt.has(index) ? markerAt.get(index) : (partIndexes.has(index) ? null : line)))
    .filter((line) => line !== null)
    .join("\n")
    .replace(/\s+$/, "");

  return { shell, zones: zones.length, parts };
}

/* ─── Кусок письма → блок со слотами ─────────────────────────────────────── */

/**
 * Вынести из куска всё, что в блоке должно стать слотом: адреса картинок,
 * ссылки и тексты. Остальное — разметка, одинаковая для всех писем.
 *
 * Тексты берём вместе с плейсхолдерами локали: `${{ ns.block_01 }}$` — это
 * не текст, а место под текст, и в блоке ему место в значении слота, а не
 * в разметке.
 */
export function extractValues(pug) {
  const images = [...pug.matchAll(/\bsrc\s*=\s*(["\'])([\s\S]*?)\1/g)].map((m) => m[2]);
  const links = [...pug.matchAll(/\bhref\s*=\s*(["\'])([\s\S]*?)\1/g)].map((m) => m[2]);
  const texts = [];
  for (const line of pug.split("\n")) {
    const body = line.trim();
    if (!body || body.startsWith("//")) continue;
    const text = body.replace(/^[^\s(]+(\([\s\S]*?\))?\s*/, "").trim();
    if (text) texts.push(text);
  }
  return { images, links, texts };
}

/** Разметка куска с подставленными токенами слотов + описания слотов. */
export function pugWithSlots(pug) {
  const slots = [];
  let imageAt = 0, linkAt = 0, textAt = 0;
  const name = (base, index) => (index === 0 ? base : `${base}_${index + 1}`);

  let out = pug.replace(/\bsrc\s*=\s*(["\'])([\s\S]*?)\1/g, (_all, q, value) => {
    const id = name("image", imageAt++);
    slots.push({ id, kind: "image", label: "Картинка", default: value, uiGroup: "assets" });
    return `src=${q}{{ ${id} }}${q}`;
  });
  out = out.replace(/\bhref\s*=\s*(["\'])([\s\S]*?)\1/g, (_all, q, value) => {
    const id = name("href", linkAt++);
    slots.push({ id, kind: "url", label: "Ссылка", default: value, uiGroup: "content" });
    return `href=${q}{{ ${id} }}${q}`;
  });
  out = out.split("\n").map((line) => {
    const body = line.trim();
    if (!body || body.startsWith("//")) return line;
    const head = body.match(/^[^\s(]+(\([\s\S]*?\))?/)?.[0] || "";
    const text = body.slice(head.length).trim();
    if (!text) return line;
    const id = name("text", textAt++);
    slots.push({ id, kind: "richText", label: "Текст", default: text, uiGroup: "content" });
    return `${line.match(/^\s*/)[0]}${head} {{ ${id} }}`;
  }).join("\n");

  return { pug: out, slots };
}

/**
 * Значения слотов существующего блока по куску письма.
 * Соответствие — по виду слота и порядку появления: картинки к картинкам,
 * ссылки к ссылкам, тексты к текстам. Если чего-то не хватает, слот остаётся
 * со своим значением по умолчанию — а расхождение поймает пиксельная сверка.
 */
export function slotValuesFor(block, pug) {
  const { images, links, texts } = extractValues(pug);
  const values = {};

  // Отступы и высоты в письме записаны классами (`pb24`, `h-24`), а в блоке
  // они слотами. Для СРАВНЕНИЯ эта разница неважна — блок тот же самый, — но
  // при сборке её надо перенести, иначе блок встанет со своим отступом по
  // умолчанию. Замечено сверкой: письмо выходило на 151px короче.
  const utilities = [...pug.matchAll(/^\s*[^\s(]*?\.((?:pb|pt|pl|pr)\d{1,3}|h-\d{1,3})/gm)].map((m) => m[1]);
  const has = (id) => (block.slotDefs || []).some((sl) => sl.id === id);
  for (const cls of utilities) {
    const pad = /^(pb|pt|pl|pr)(\d{1,3})$/.exec(cls);
    if (pad) {
      const id = { pb: "padding_bottom", pt: "padding_top", pl: "padding_left", pr: "padding_right" }[pad[1]];
      if (has(id) && values[id] === undefined) values[id] = `${pad[2]}px`;
      continue;
    }
    const height = /^h-(\d{1,3})$/.exec(cls);
    if (height && has("height") && values.height === undefined) values.height = `${height[1]}px`;
  }
  // Выравнивание кнопки: в письме атрибутом, в блоке слотом.
  const align = pug.match(/\balign\s*=\s*(["\'])(left|center|right)\1/);
  if (align && has("align")) values.align = align[2];

  const pools = { image: [...images], url: [...links], text: [...texts] };
  for (const slot of block.slotDefs || []) {
    const pool = slot.kind === "image" ? pools.image
      : slot.kind === "url" ? pools.url
        : (slot.kind === "text" || slot.kind === "richText") ? pools.text : null;
    if (!pool || !pool.length) continue;
    values[slot.id] = pool.shift();
  }
  return values;
}

/* ─── Сопоставление с библиотекой ────────────────────────────────────────── */

function describe(pug) {
  const first = pug.split("\n").find((l) => l.trim()) || "";
  return first.trim().slice(0, 58);
}

/**
 * Разобрать список соседних кусков, сопоставляя их с библиотекой.
 *
 * Порядок попыток важен. Сначала пробуем накрыть НЕСКОЛЬКО соседей одним
 * блоком: двойной блок в письме выглядит как два соседа (`.left-block` и
 * `.right-block`), а в библиотеке это один контейнер с двумя колонками. Если
 * идти по одному, каждая колонка станет отдельным новым блоком — и в каталоге
 * появится пара «полублоков», которыми никто не пользуется.
 *
 * Дальше — попытка накрыть соседей одной ОБОЛОЧКОЙ (тот же двойной блок, но
 * с содержимым внутри колонок), и только потом каждый кусок по отдельности.
 */
function matchParts(parts, byHash, depth = 0) {
  const out = [];
  const MAX_GROUP = 3;
  let i = 0;
  while (i < parts.length) {
    let taken = 0;

    for (let size = Math.min(MAX_GROUP, parts.length - i); size >= 1 && !taken; size -= 1) {
      const group = parts.slice(i, i + size);
      const pug = group.map((p) => p.pug).join("\n");
      const hit = (byHash.get(shapeHash(canonicalShape(pug))) || [])[0];
      if (!hit) continue;
      out.push({ head: describe(pug), block: hit, pug, zone: group[0].zone, children: [] });
      taken = size;
    }
    if (taken) { i += taken; continue; }

    for (let size = Math.min(MAX_GROUP, parts.length - i); size >= 1 && !taken; size -= 1) {
      if (depth >= 3) break;
      const group = parts.slice(i, i + size);
      const split = group.map((p) => splitShellAndContent(p.pug));
      if (!split.some((sp) => sp.parts.length)) continue;
      const shell = split.map((sp) => sp.shell).join("\n");
      const hit = (byHash.get(shapeHash(canonicalShape(shell))) || [])[0];
      if (!hit) continue;
      out.push({
        head: describe(group[0].pug),
        block: hit,
        pug: shell,
        zone: group[0].zone,
        children: matchParts(split.flatMap((sp) => sp.parts), byHash, depth + 1),
      });
      taken = size;
    }
    if (taken) { i += taken; continue; }

    out.push({ head: describe(parts[i].pug), block: null, pug: parts[i].pug, zone: parts[i].zone, children: [] });
    i += 1;
  }
  return out;
}

/** План разбора письма: что берём готовым, что заводим заново. */
export function planCut(brand, mail) {
  const { file, source } = readMailTemplate(brand, mail);
  const library = loadLibraryShapes();
  const byHash = new Map();
  for (const block of library) {
    if (!byHash.has(block.hash)) byHash.set(block.hash, []);
    byHash.get(block.hash).push(block);
  }

  const sections = splitSections(source).map((section) => {
    const whole = (byHash.get(shapeHash(canonicalShape(section))) || [])[0];
    if (whole) return { head: describe(section), block: whole, pug: section, children: [] };
    const { shell, parts } = splitShellAndContent(section);
    const shellHit = (byHash.get(shapeHash(canonicalShape(shell))) || [])[0];
    // Если содержимое разбирается на блоки, разметкой секции считается только
    // ОБОЛОЧКА. Иначе новый блок-контейнер создавался из всей секции целиком,
    // а её содержимое добавлялось ещё раз детьми — письмо выходило в полтора
    // раза длиннее (проверено сверкой: 6404px против 4186px).
    return {
      head: describe(section),
      block: shellHit || null,
      pug: parts.length ? shell : section,
      children: parts.length ? matchParts(parts, byHash) : [],
    };
  });

  return { brand, mail, file, librarySize: library.length, sections };
}

const walk = (nodes, fn) => { for (const n of nodes) { fn(n); walk(n.children || [], fn); } };

function printPlan(plan) {
  console.log(`${plan.brand}/${plan.mail} · секций: ${plan.sections.length} · в библиотеке: ${plan.librarySize} блоков\n`);
  const show = (nodes, pad) => {
    for (const node of nodes) {
      console.log(`${pad}${node.block ? "✓" : "+"} ${node.head}${node.block ? `  = ${node.block.id}` : "  (новый)"}`);
      show(node.children || [], pad + "  ");
    }
  };
  show(plan.sections, "  ");
  let reused = 0, fresh = 0;
  walk(plan.sections, (n) => { if (n.block) reused += 1; else fresh += 1; });
  console.log(`\nиспользуется готовых блоков: ${reused} · надо завести новых: ${fresh}`);
}

/* ─── Запись ─────────────────────────────────────────────────────────────── */

const CANONICAL = path.join(repoRoot, "data", "block-library", "canonical");

/** Каркасные классы: в имя блока не годятся, смысла не несут. */
const INK_LAYOUT = new Set(["row", "columns", "column", "wrapper", "last", "container", "center", "table"]);

/**
 * Имя нового блока по его содержимому.
 *
 * Берём первый СМЫСЛОВОЙ класс во всём куске, а не в первой строке: первая
 * строка — обычно каркас (`table.w100`), а класс-утилита выброшен, и имя
 * получалось вроде `iqbr-w100`, по которому потом ничего не найти.
 */
function slugFor(pug, taken) {
  const classes = [...pug.matchAll(/^\s*[^\s(]*?\.([a-zA-Z][\w-]*)/gm)].map((m) => m[1]);
  const meaningful = classes.find((c) => !UTILITY_CLASS.test(c) && !INK_LAYOUT.has(c));
  const first = pug.split("\n").find((l) => l.trim()) || "";
  const tag = (first.trim().match(/^([a-zA-Z][\w-]*)/) || [])[1];
  let base = `iqbr-${(meaningful || tag || "piece").toLowerCase().replace(/[^a-z0-9-]/g, "-")}`;
  let id = base, n = 2;
  while (taken.has(id) || existsSync(path.join(CANONICAL, `${id}.json`))) { id = `${base}-${n}`; n += 1; }
  taken.add(id);
  return id;
}

function applyCut(plan, { brandTag = "iqbroker" } = {}) {
  // plan.file — <письмо>/app/templates/blocks/header.jade; стили лежат
  // рядом в <письмо>/app/styles/blocks/main.styl.
  const appDir = path.resolve(path.dirname(plan.file), "..", "..");
  const stylPath = path.join(appDir, "styles", "blocks", "main.styl");
  const byClass = loadMailRules(stylPath);
  const created = [];
  const taken = new Set();
  // Дедуп внутри одного письма. Сверки с библиотекой мало: нумерованные шаги
  // в одном письме — это пять одинаковых кусков, и без этой карты нарезка
  // заводила пять почти неотличимых блоков. Ровно та свалка, из-за которой
  // потом не найти нужный блок.
  const madeByShape = new Map();

  // 1) Завести блоки для того, чего в библиотеке нет.
  walk(plan.sections, (node) => {
    if (node.block) return;
    const shape = shapeHash(canonicalShape(node.pug));
    const twin = madeByShape.get(shape);
    if (twin) {
      // Такой блок уже завели на этом же письме — берём его, различия уйдут
      // в значения слотов.
      node.block = twin;
      node.reusedFromCut = true;
      return;
    }
    const isContainer = (node.children || []).length > 0;
    const { pug, slots } = pugWithSlots(node.pug);
    const id = slugFor(node.pug, taken);
    // Маркеры зон уже стоят в оболочке — по одному на ряд. Если их нет
    // (содержимое было одним куском), добавляем один в конец.
    const markers = [...pug.matchAll(/\{\{\s*(ZONE_\d+)\s*\}\}/g)].map((m) => m[1]);
    const withMarker = isContainer && !markers.length
      ? `${pug}\n${" ".repeat(4)}//- {{ ZONE_1 }}`
      : pug;
    if (isContainer && !markers.length) markers.push("ZONE_1");
    const scoped = scopeStyles({ blockId: id, pug: withMarker, byClass });
    const block = {
      id,
      label: `${describe(node.pug).slice(0, 40)} (${plan.mail})`,
      description: `Нарезано автоматически из ${plan.brand}/${plan.mail}.`,
      placement: isContainer ? "section" : "inner",
      category: "auto",
      version: 1,
      pug: scoped.pug,
      styl: scoped.styl,
      slots,
      ...(isContainer ? {
        childSlots: markers.map((marker, index) => ({
          id: index === 0 ? "content" : `content_${index + 1}`,
          marker,
          accepts: ["inner", "inline", "both"],
        })),
      } : {}),
      outlookSafe: true,
      tags: [brandTag, "auto"],
      note: `Автонарезка ${plan.brand}/${plan.mail}. Стили втянуты из main.styl этого письма и заскоуплены.`,
      scoped: true,
    };
    writeFileSync(path.join(CANONICAL, `${id}.json`), JSON.stringify(block, null, 2) + "\n");
    created.push(id);
    node.block = {
      id,
      slotDefs: slots.map((sl) => ({ id: sl.id, kind: sl.kind })),
      childSlots: isContainer ? markers.map((_m, index) => (index === 0 ? "content" : `content_${index + 1}`)) : [],
    };
    node.createdSlots = slots;
    madeByShape.set(shape, node.block);
  });

  // 2) Дерево для сборки.
  const blocks = [];
  let uid = 0;
  const emit = (node, parentUid, slotId) => {
    const id = `u${++uid}`;
    const values = node.createdSlots
      ? Object.fromEntries(node.createdSlots.map((sl) => [sl.id, sl.default]))
      : slotValuesFor(node.block, node.pug);
    blocks.push({ uid: id, blockId: node.block.id, parentUid, slotId, slots: values });
    const slots = node.block.childSlots || [];
    for (const child of node.children || []) {
      // Зона куска — это ряд секции; ей соответствует дочерний слот с тем же
      // номером. Иначе картинка из верхнего ряда уезжает к тексту в нижний.
      const at = Math.max(0, Math.min(slots.length - 1, (child.zone || 1) - 1));
      emit(child, id, slots[at] || "content");
    }
  };

  const outerId = "u0";
  blocks.push({ uid: outerId, blockId: "iqbr-outer-wrapper", parentUid: null, slotId: null, slots: {} });
  for (const section of plan.sections) emit(section, outerId, "sections");

  return { created, blocks };
}

/* ─── Отчёт ──────────────────────────────────────────────────────────────── */

function main() {
  const brand = opt("brand", "X_IQBroker");
  const mail = opt("mail");
  if (!mail) { console.error("нужен --mail <имя>"); process.exit(1); }

  const plan = planCut(brand, mail);
  if (flag("json")) { console.log(JSON.stringify(plan, (k, v) => (k === "shape" ? undefined : v), 2)); return; }
  printPlan(plan);

  if (!flag("apply")) { console.log("\nСухой прогон. Запись: --apply (блоки заводятся только после пиксельной сверки)"); return; }

  const { created, blocks } = applyCut(plan);
  console.log(`\nзаведено новых блоков: ${created.length}${created.length ? ` — ${created.join(", ")}` : ""}`);
  writeFileSync(path.join(repoRoot, "data", `cut-${mail}.json`), JSON.stringify({ brand, mail, created, blocks }, null, 2) + "\n");
  console.log(`дерево письма: data/cut-${mail}.json (${blocks.length} узлов)`);
  console.log("\nДальше — обязательная сверка (сама откатит блоки, если не сойдётся):");
  console.log(`  node scripts/verify-cut.mjs --brand ${brand} --mail ${mail}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
