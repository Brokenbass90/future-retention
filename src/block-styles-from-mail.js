/**
 * src/block-styles-from-mail.js — стили блока из письма, из которого он вырезан.
 *
 * Когда блок режется из письма, его CSS надо брать не «где-то в базе», а из
 * `blocks/main.styl` ЭТОГО письма: одно и то же имя класса в разных семьях
 * значит разное (`.m-w` — десяток разных ширин, `.left-block` — восемнадцать
 * вариантов). Здесь единственный источник правды — скомпилированный CSS
 * конкретного письма.
 *
 * Что делает `scopeStyles`:
 *   – семейные классы переименовывает в `<id>--<class>` и втягивает их правила
 *     внутрь блока: блок перестаёт зависеть от чужого main.styl;
 *   – классы, которые есть и во фреймворке (ink), и в семье, оставляет на
 *     месте и ДОБАВЛЯЕТ рядом скоуп: ink-база нужна, семейная надстройка тоже;
 *   – ink-примитивы вёрстки (`.row`, `.columns`, `.wrapper`) не трогает вовсе.
 *
 * Правила отдаются в том же порядке, что в исходном CSS. Это не косметика:
 * при равной специфичности побеждает последнее правило, и перестановка
 * `.ig` и `.soc-icon` уменьшала иконку соцсетей с 24px до 20px.
 */
import { readFileSync } from "node:fs";
import stylus from "stylus";
import postcss from "postcss";
import { loadStyleRegistry, lookupClass, LAYERS } from "./style-registry.js";
import { classesUsedInPug, renameClassesInPug, scopedName } from "./scope-block-styles.js";

/** Ink-примитивы вёрстки: есть в каждом письме, дублировать в блок незачем. */
export const INK_PRIMITIVES = new Set([
  "row", "columns", "column", "wrapper", "last", "container", "body",
  "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve",
  "offset-by-one", "offset-by-two",
]);

/** Скомпилировать main.styl письма и разложить правила по классам. */
export function loadMailRules(stylPath) {
  const css = stylus(readFileSync(stylPath, "utf8")).set("filename", stylPath).render();
  const byClass = new Map();
  let order = 0;
  postcss.parse(css).walkRules((rule) => {
    const media = rule.parent?.type === "atrule" ? `@${rule.parent.name} ${rule.parent.params}` : null;
    const decls = rule.nodes
      .filter((n) => n.type === "decl")
      .map((n) => `${n.prop}:${n.value}${n.important ? " !important" : ""}`)
      .join(";");
    if (!decls) return;
    order += 1;
    for (const cls of new Set([...rule.selector.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]))) {
      if (!byClass.has(cls)) byClass.set(cls, []);
      byClass.get(cls).push({ media, selector: rule.selector, decls, order });
    }
  });
  return byClass;
}

function rulesFor(byClass, blockId, cls, allowed) {
  const out = [];
  for (const rule of byClass.get(cls) || []) {
    const others = new Set([...rule.selector.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]));
    others.delete(cls);
    // Правило, где рядом стоит ЧУЖОЙ класс, к этому блоку не относится:
    // так `.columns` затаскивал в блок с логотипом полтора десятка правил
    // вида `table.body table.columns td.m-w`.
    //
    // Исключение — ink-примитивы: `table[class=body] table.columns td.m-w`
    // описывает ширину именно нашего `.m-w`, просто через каркас. Отбросив
    // такое правило, блок терял ширину колонки — на мобильном письмо
    // разъезжалось на 377px. Ink-классы оставляем как есть: они глобальные
    // и в разметке блока присутствуют.
    const foreign = [...others].filter((o) => !allowed.has(o) && !INK_PRIMITIVES.has(o));
    if (foreign.length) continue;
    const rename = [cls, ...[...others].filter((o) => allowed.has(o))];
    let selector = rule.selector;
    for (const name of rename) {
      selector = selector.replace(new RegExp(`\\.${name.replace(/-/g, "\\-")}(?![\\w-])`, "g"), `.${scopedName(blockId, name)}`);
    }
    const body = `${selector}{${rule.decls}}`;
    out.push({ order: rule.order, css: rule.media ? `${rule.media}{${body}}` : body });
  }
  return out;
}

/**
 * Свойства, которыми управляют слоты блока.
 *
 * Если такое свойство осталось ещё и в CSS блока, слот бессилен: правило из
 * семьи приходит с `!important` и бьёт инлайновый стиль. Видно на кнопке:
 * скругление слота 16px не применяется, в письме остаётся 12px из CSS.
 *
 * ПОКА НЕ ПРИМЕНЯЕТСЯ — две попытки, оба замера здесь.
 *
 * 1. Вычистка скругления и фона: `mail-strategies` сломалась с 0 до 58/52px.
 * 2. Вычистка одного скругления: та же поломка, 58/52px. Причина понятна из
 *    сборки — у скелета письма своё `.butt{border-radius:16px !important}`,
 *    и стоит блоку перестать нести своё значение, побеждает чужое.
 *
 * Инлайновый `!important` в разметке блока тоже не помогает: инлайнер стилей
 * (juice) отдаёт приоритет `!important` из таблицы стилей, а не из атрибута.
 * Рабочий путь, судя по всему, другой — не тащить в блок глобальный класс
 * `.butt` вовсе, оставив только скоуп. Но это меняет базу от ink, поэтому
 * делать надо с отдельной пиксельной проверкой, а не походя.
 */
export const SLOT_GOVERNED = Object.freeze({
  radius: "border-radius",
});
// Список намеренно короткий. Отступы и фон сюда НЕ входят: пробовал — у части
// блоков отступ живёт классом, а фон приходит из семьи, и вычистка ломала уже
// проверенную нарезку strategies (0 → 58px). Осталось только скругление,
// которое блок всегда задаёт сам и инлайном.

/** Выбросить из CSS объявления, которыми распоряжается слот. */
export function dropSlotGovernedDeclarations(css, slotIds = []) {
  const properties = new Set(slotIds.map((id) => SLOT_GOVERNED[id]).filter(Boolean));
  if (!properties.size) return css;
  return String(css || "").split("\n").map((line) => {
    const at = line.indexOf("{");
    if (at < 0) return line;
    const head = line.slice(0, at + 1);
    const tail = line.slice(at + 1);
    const close = tail.lastIndexOf("}");
    const body = close >= 0 ? tail.slice(0, close) : tail;
    const rest = close >= 0 ? tail.slice(close) : "";
    const kept = body.split(";").filter((decl) => {
      const prop = decl.split(":")[0]?.trim();
      return prop && !properties.has(prop);
    });
    return kept.length ? `${head}${kept.join(";")}${rest}` : "";
  }).filter(Boolean).join("\n");
}

/**
 * Заскоупить разметку блока и собрать его CSS.
 * @returns {{pug: string, styl: string, keptGlobal: string[], missing: string[]}}
 */
export function scopeStyles({ blockId, pug, byClass, registry = loadStyleRegistry(), extraClasses = [] }) {
  const used = new Set([...classesUsedInPug(pug), ...extraClasses]);
  const renames = new Map();
  const additions = new Map();
  const keptGlobal = [];
  const missing = [];

  for (const cls of used) {
    const variants = lookupClass(cls, registry);
    const framework = variants.some((v) => v.layer === LAYERS.framework);
    const hasRules = (byClass.get(cls) || []).length > 0;
    if (INK_PRIMITIVES.has(cls) || !hasRules) {
      if (framework || INK_PRIMITIVES.has(cls)) keptGlobal.push(cls);
      else missing.push(cls);
      continue;
    }
    if (framework) additions.set(cls, scopedName(blockId, cls));
    else renames.set(cls, scopedName(blockId, cls));
  }

  const allowed = new Set([...renames.keys(), ...additions.keys()]);
  const collected = new Map();
  for (const cls of allowed) {
    for (const rule of rulesFor(byClass, blockId, cls, allowed)) collected.set(rule.css, rule.order);
  }

  return {
    pug: renameClassesInPug(pug, renames, additions),
    styl: [...collected.entries()].sort((a, b) => a[1] - b[1]).map(([css]) => css).join("\n"),
    keptGlobal,
    missing,
  };
}
