/**
 * scripts/iqbroker-cut/build-iqbr-blocks.mjs — собрать блоки IQ Broker из нарезки письма.
 *
 * Что делает: берёт разметку из blocks.mjs, определяет по реестру стилей, какие
 * классы фреймворковые (ink — не трогаем), какие семейные (втягиваем в блок и
 * скоупим), и выдёргивает для них правила из СКОМПИЛИРОВАННОГО main.styl
 * письма mail-strategies — то есть из единственного источника, который для
 * этого письма авторитетен. Никакой угадайки «какой из 18 вариантов .left-block».
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import url from "node:url";
import stylus from "stylus";
import postcss from "postcss";
import { loadStyleRegistry, lookupClass, LAYERS } from "../../src/style-registry.js";
import { classesUsedInPug, renameClassesInPug, scopedName } from "../../src/scope-block-styles.js";
import { BLOCKS } from "./blocks.mjs";

const repoRoot = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..", "..");
const SOURCE_STYL = path.join(repoRoot, "email-base", "X_IQBroker", "mail-strategies", "app", "styles", "blocks", "main.styl");
const OUT_DIR = path.join(repoRoot, "data", "block-library", "canonical");

/* ─── CSS письма → правила по классам ────────────────────────────────────── */
const css = stylus(readFileSync(SOURCE_STYL, "utf8")).set("filename", SOURCE_STYL).render();
const byClass = new Map();
let ruleOrder = 0;
postcss.parse(css).walkRules((rule) => {
  const media = rule.parent?.type === "atrule" ? `@${rule.parent.name} ${rule.parent.params}` : null;
  const decls = rule.nodes.filter((n) => n.type === "decl").map((n) => `${n.prop}:${n.value}${n.important ? " !important" : ""}`).join(";");
  if (!decls) return;
  ruleOrder += 1;
  for (const m of new Set([...rule.selector.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((x) => x[1]))) {
    if (!byClass.has(m)) byClass.set(m, []);
    byClass.get(m).push({ media, selector: rule.selector, decls, order: ruleOrder });
  }
});

const registry = loadStyleRegistry();
const layersOf = (cls) => {
  const variants = lookupClass(cls, registry);
  return {
    framework: variants.some((v) => v.layer === LAYERS.framework),
    family: variants.some((v) => v.layer === LAYERS.family),
  };
};

/**
 * Правила класса из письма, с подменённым на скоуп именем в селекторе.
 *
 * Правила, где рядом с нашим классом стоит ЧУЖОЙ класс, отбрасываются.
 * Без этого `.columns` затаскивал в блок с логотипом полтора десятка чужих
 * правил (`table.body table.columns td.m-w` и подобные) — они к логотипу
 * отношения не имеют и в другом письме сработали бы по чужой разметке.
 */
function scopedRulesFor(blockId, cls, allowed) {
  const rules = byClass.get(cls) || [];
  const scoped = scopedName(blockId, cls);
  const out = [];
  for (const rule of rules) {
    const inSelector = new Set([...rule.selector.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]));
    inSelector.delete(cls);
    if ([...inSelector].some((other) => !allowed.has(other))) continue;
    let selector = rule.selector;
    for (const name of [cls, ...inSelector]) {
      selector = selector.replace(new RegExp(`\\.${name.replace(/-/g, "\\-")}(?![\\w-])`, "g"), `.${scopedName(blockId, name)}`);
    }
    const body = `${selector}{${rule.decls}}`;
    out.push({ order: rule.order, css: rule.media ? `${rule.media}{${body}}` : body });
  }
  return out;
}

/**
 * Ink-примитивы вёрстки. Их семейные правила в блок не втягиваем: они есть в
 * каждом письме, а их «семейные» варианты — это правки чужой разметки.
 */
const INK_PRIMITIVES = new Set([
  "row", "columns", "column", "wrapper", "last", "container", "body",
  "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve",
  "offset-by-one", "offset-by-two",
]);

const report = [];
mkdirSync(OUT_DIR, { recursive: true });

for (const def of BLOCKS) {
  const used = new Set([...classesUsedInPug(def.pug), ...(def.extraClasses || [])]);
  const renames = new Map();   // семейный класс → скоуп (замена)
  const additions = new Map(); // фреймворк+семья → скоуп рядом с оригиналом
  const missing = [];
  const keptGlobal = [];

  for (const cls of used) {
    const { framework, family } = layersOf(cls);
    const hasRules = (byClass.get(cls) || []).length > 0;
    if (INK_PRIMITIVES.has(cls) || !hasRules) {
      if (framework || INK_PRIMITIVES.has(cls)) keptGlobal.push(cls);
      else missing.push(cls);
      continue;
    }
    if (framework) additions.set(cls, scopedName(def.id, cls));
    else renames.set(cls, scopedName(def.id, cls));
  }

  const pug = renameClassesInPug(def.pug, renames, additions);
  const allowed = new Set([...renames.keys(), ...additions.keys()]);
  // Порядок правил внутри блока обязан повторять порядок в исходном CSS.
  // Проверено: при равной специфичности побеждает последнее правило, и
  // перестановка `.ig` и `.soc-icon` уменьшала последнюю иконку соцсетей
  // с 24px до 20px. Заодно убираем дубли: правило с двумя нашими классами
  // иначе попало бы в блок дважды.
  const collected = new Map();
  for (const cls of allowed) {
    for (const rule of scopedRulesFor(def.id, cls, allowed)) collected.set(rule.css, rule.order);
  }
  const stylChunks = [...collected.entries()].sort((a, b) => a[1] - b[1]).map(([css]) => css);

  const block = {
    id: def.id,
    label: def.label,
    description: def.description,
    placement: def.placement,
    category: def.category,
    version: 1,
    pug,
    styl: stylChunks.join("\n"),
    slots: def.slots || [],
    ...(def.childSlots ? { childSlots: def.childSlots } : {}),
    outlookSafe: true,
    tags: ["iqbroker", def.category].filter(Boolean),
    note: "Нарезано из email-base/X_IQBroker/mail-strategies. Семейные стили втянуты в блок и заскоуплены; ink-классы (.row/.columns/.wrapper) оставлены глобальными.",
    scoped: true,
  };
  writeFileSync(path.join(OUT_DIR, `${def.id}.json`), JSON.stringify(block, null, 2) + "\n");
  report.push({ id: def.id, scoped: renames.size, dual: additions.size, keptGlobal, missing, cssBytes: block.styl.length });
}

for (const r of report) {
  console.log(`${r.id.padEnd(24)} скоуп:${String(r.scoped).padStart(2)} рядом:${String(r.dual).padStart(2)} css:${String(r.cssBytes).padStart(5)}B  глобально:[${r.keptGlobal.join(" ")}]${r.missing.length ? `  БЕЗ CSS:[${r.missing.join(" ")}]` : ""}`);
}
