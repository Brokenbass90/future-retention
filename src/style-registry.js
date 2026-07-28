/**
 * src/style-registry.js — единый индекс всего CSS, который есть в базе.
 *
 * Зачем. Блок в библиотеке несёт только тот CSS, который автор положил ему в
 * `styl`. Всё остальное (pt44, center, m-w, h-*, gray-block…) он молча берёт из
 * `blocks/main.styl` той семьи, в которую его положили. А там одно и то же имя
 * значит разное: `.h-406` — 18 разных высот, `.title` — 5 разных наборов
 * свойств. Поэтому блок, вырезанный из одной семьи, в другой едет.
 *
 * Реестр отвечает на два вопроса:
 *   1) какие правила стоят за классом X и в скольких вариантах (lookupClass);
 *   2) какой CSS нужно втянуть ВНУТРЬ блока, чтобы он стал самодостаточным
 *      (rulesForClasses) — основа автоскоупа.
 *
 * Stylus компилируется в CSS и разбирается postcss'ом: индексировать
 * отступный .styl регулярками нельзя, вложенность и медиазапросы теряются.
 *
 * Индекс кэшируется в data/style-registry.json — полный пересбор идёт по всем
 * ~120 письмам и стоит десятки секунд.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import url from "node:url";
import stylus from "stylus";
import postcss from "postcss";
import safeParser from "postcss-safe-parser";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const emailBase = path.join(repoRoot, "email-base");
const vendorStyles = path.join(emailBase, "vendor", "styles");
export const REGISTRY_PATH = path.join(repoRoot, "data", "style-registry.json");

/** Слои каскада. Чем больше вес, тем позже правило попадает в письмо. */
export const LAYERS = Object.freeze({
  framework: 0,   // vendor/styles + helpers/ink — общий движок вёрстки
  family: 1,      // blocks/main.styl конкретного письма/семьи
});

/* ─── Компиляция ─────────────────────────────────────────────────────────── */

function compileStylusFile(fileAbs, includePaths) {
  const src = readFileSync(fileAbs, "utf8");
  const renderer = stylus(src)
    .set("filename", fileAbs)
    .set("include css", true);
  for (const p of includePaths) renderer.include(p);
  let out = "";
  let error = null;
  // stylus.render синхронен, когда синхронен колбэк — используем это,
  // чтобы не тащить async через весь обход базы.
  renderer.render((err, css) => { if (err) error = err; else out = css; });
  if (error) throw error;
  return out;
}

function compileCssOrStylus(fileAbs, includePaths) {
  if (fileAbs.endsWith(".css")) return readFileSync(fileAbs, "utf8");
  return compileStylusFile(fileAbs, includePaths);
}

/* ─── Разбор CSS в плоский список правил ─────────────────────────────────── */

/**
 * @returns {Array<{selector:string, media:string|null, decls:string, classes:string[]}>}
 */
function extractRules(cssText) {
  const out = [];
  let root;
  try { root = postcss.parse(cssText, { parser: safeParser }); }
  catch { return out; }

  root.walkRules((rule) => {
    const decls = rule.nodes
      .filter((n) => n.type === "decl")
      .map((n) => `${n.prop}:${n.value}${n.important ? " !important" : ""}`)
      .join(";");
    if (!decls) return;
    const media = rule.parent?.type === "atrule" ? `@${rule.parent.name} ${rule.parent.params}` : null;
    for (const selector of rule.selector.split(",").map((s) => s.trim()).filter(Boolean)) {
      const classes = [...selector.matchAll(/\.([_a-zA-Z][\w-]*)/g)].map((m) => m[1]);
      out.push({ selector, media, decls, classes });
    }
  });
  return out;
}

/* ─── Обход источников ───────────────────────────────────────────────────── */

function listMailStyleRoots() {
  const roots = [];
  if (!existsSync(emailBase)) return roots;
  for (const brand of readdirSync(emailBase)) {
    if (!brand.startsWith("X_")) continue;
    const brandDir = path.join(emailBase, brand);
    let stat;
    try { stat = statSync(brandDir); } catch { continue; }
    if (!stat.isDirectory()) continue;
    for (const mail of readdirSync(brandDir)) {
      const stylesDir = path.join(brandDir, mail, "app", "styles");
      if (existsSync(stylesDir)) roots.push({ brand, mail, stylesDir });
    }
  }
  return roots;
}

function frameworkSources() {
  const files = [];
  if (existsSync(vendorStyles)) {
    for (const f of readdirSync(vendorStyles)) {
      if (f.endsWith(".styl") || f.endsWith(".css")) files.push(path.join(vendorStyles, f));
    }
    const helpers = path.join(vendorStyles, "helpers");
    if (existsSync(helpers)) {
      for (const f of readdirSync(helpers)) files.push(path.join(helpers, f));
    }
  }
  return files;
}

/* ─── Сборка реестра ─────────────────────────────────────────────────────── */

/**
 * @param {object} [options]
 * @param {(msg:string)=>void} [options.log]
 * @param {number} [options.maxMails] — ограничение для отладки
 */
export function buildStyleRegistry({ log = () => {}, maxMails = Infinity } = {}) {
  /** class → variantHash → { decls, selectors:Set, media:Set, sources:Set, layer } */
  const byClass = new Map();
  const sourceErrors = [];
  let ruleCount = 0;

  const record = (rule, sourceLabel, layer) => {
    ruleCount++;
    for (const cls of new Set(rule.classes)) {
      const variantKey = createHash("sha1")
        .update(`${rule.media || ""}|${rule.decls}`).digest("hex").slice(0, 12);
      if (!byClass.has(cls)) byClass.set(cls, new Map());
      const variants = byClass.get(cls);
      if (!variants.has(variantKey)) {
        variants.set(variantKey, {
          hash: variantKey, decls: rule.decls, media: rule.media,
          selectors: new Set(), sources: new Set(), layer,
        });
      }
      const v = variants.get(variantKey);
      v.selectors.add(rule.selector);
      v.sources.add(sourceLabel);
      // Класс, встреченный и во фреймворке, и в семье, остаётся фреймворковым:
      // важно, откуда он берётся В ПЕРВУЮ очередь.
      v.layer = Math.min(v.layer, layer);
    }
  };

  // 1) Фреймворк — vendor/styles.
  for (const file of frameworkSources()) {
    try {
      const css = compileCssOrStylus(file, [vendorStyles]);
      for (const rule of extractRules(css)) record(rule, `vendor/${path.basename(file)}`, LAYERS.framework);
    } catch (e) { sourceErrors.push({ file: path.relative(repoRoot, file), error: String(e.message || e).slice(0, 200) }); }
  }

  // 2) Каждое письмо: helpers (ink и компания) — фреймворк, blocks/** — семья.
  const roots = listMailStyleRoots();
  log(`письменных style-корней: ${roots.length}`);
  let n = 0;
  for (const { brand, mail, stylesDir } of roots) {
    if (++n > maxMails) break;
    const includePaths = [stylesDir, vendorStyles];
    const helpersDir = path.join(stylesDir, "helpers");
    if (existsSync(helpersDir)) {
      for (const f of readdirSync(helpersDir)) {
        const abs = path.join(helpersDir, f);
        if (!/\.(styl|css)$/.test(f)) continue;
        // ink.css — скомпилированный дубль ink.styl, индексировать оба смысла нет.
        if (f === "ink.css") continue;
        try {
          const css = compileCssOrStylus(abs, includePaths);
          for (const rule of extractRules(css)) record(rule, `${brand}/${mail}:helpers/${f}`, LAYERS.framework);
        } catch (e) { sourceErrors.push({ file: `${brand}/${mail}:helpers/${f}`, error: String(e.message || e).slice(0, 160) }); }
      }
    }
    const blocksDir = path.join(stylesDir, "blocks");
    if (existsSync(blocksDir)) {
      for (const f of readdirSync(blocksDir)) {
        const abs = path.join(blocksDir, f);
        if (!/\.(styl|css)$/.test(f)) continue;
        try {
          const css = compileCssOrStylus(abs, includePaths);
          for (const rule of extractRules(css)) record(rule, `${brand}/${mail}:blocks/${f}`, LAYERS.family);
        } catch (e) { sourceErrors.push({ file: `${brand}/${mail}:blocks/${f}`, error: String(e.message || e).slice(0, 160) }); }
      }
    }
    if (n % 20 === 0) log(`  обработано писем: ${n}/${roots.length}`);
  }

  // 3) Сериализация: Set → массив, Map → объект.
  const classes = {};
  for (const [cls, variants] of byClass) {
    classes[cls] = [...variants.values()]
      .sort((a, b) => b.sources.size - a.sources.size)
      .map((v) => ({
        hash: v.hash, decls: v.decls, media: v.media, layer: v.layer,
        selectors: [...v.selectors].slice(0, 8),
        sourceCount: v.sources.size,
        sources: [...v.sources].slice(0, 6),
      }));
  }

  return {
    generatedAt: new Date().toISOString(),
    mailsScanned: Math.min(n, roots.length),
    ruleCount,
    classCount: Object.keys(classes).length,
    conflictCount: Object.values(classes).filter((v) => v.length > 1).length,
    sourceErrors,
    classes,
  };
}

/* ─── Чтение и запросы ───────────────────────────────────────────────────── */

let cache = { mtimeMs: -1, registry: null };

export function loadStyleRegistry() {
  try {
    const stat = statSync(REGISTRY_PATH);
    if (stat.mtimeMs !== cache.mtimeMs) {
      cache = { mtimeMs: stat.mtimeMs, registry: JSON.parse(readFileSync(REGISTRY_PATH, "utf8")) };
    }
  } catch {
    cache = { mtimeMs: -1, registry: null };
  }
  return cache.registry;
}

export function saveStyleRegistry(registry) {
  mkdirSync(path.dirname(REGISTRY_PATH), { recursive: true });
  writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2) + "\n");
  cache = { mtimeMs: -1, registry: null };
}

/** Все известные варианты правил для класса, самый распространённый первым. */
export function lookupClass(name, registry = loadStyleRegistry()) {
  if (!registry) return [];
  return registry.classes?.[String(name)] || [];
}

/**
 * CSS, который нужно втянуть внутрь блока, чтобы он перестал зависеть от
 * `main.styl` семьи. Берётся ТОЛЬКО слой family: фреймворк остаётся глобальным,
 * дублировать ink в каждый блок бессмысленно.
 *
 * @param {string[]} classNames
 * @param {object} [options]
 * @param {string} [options.preferSource] — подстрока источника (напр. "X_IQ/mail-rfm-311"):
 *   если класс многозначен, берём вариант именно этого письма.
 * @returns {{css:string, resolved:string[], ambiguous:Array, missing:string[]}}
 */
export function rulesForClasses(classNames, { preferSource = null, registry = loadStyleRegistry() } = {}) {
  const resolved = [];
  const ambiguous = [];
  const missing = [];
  const chunks = [];
  const byMedia = new Map();

  for (const name of new Set(classNames || [])) {
    const variants = lookupClass(name, registry);
    if (!variants.length) { missing.push(name); continue; }
    const familyVariants = variants.filter((v) => v.layer === LAYERS.family);
    if (!familyVariants.length) { resolved.push(name); continue; } // чисто фреймворковый — не втягиваем

    let chosen = familyVariants[0];
    if (preferSource) {
      const exact = familyVariants.find((v) => v.sources.some((s) => s.includes(preferSource)));
      if (exact) chosen = exact;
    }
    if (familyVariants.length > 1) {
      ambiguous.push({
        class: name,
        variants: familyVariants.length,
        chosen: chosen.hash,
        chosenFrom: chosen.sources[0] || null,
        others: familyVariants.filter((v) => v !== chosen).map((v) => ({ hash: v.hash, decls: v.decls.slice(0, 80), from: v.sources[0] })),
      });
    }
    resolved.push(name);
    for (const v of familyVariants.filter((x) => x === chosen || x.media)) {
      // Медиазапросы одного класса нужны все, иначе блок теряет адаптив.
      if (v !== chosen && !v.media) continue;
      const key = v.media || "";
      if (!byMedia.has(key)) byMedia.set(key, []);
      byMedia.get(key).push(`.${name}{${v.decls}}`);
    }
  }

  for (const [media, rules] of byMedia) {
    const body = [...new Set(rules)].join("\n");
    chunks.push(media ? `${media}{\n${body}\n}` : body);
  }
  return { css: chunks.join("\n"), resolved, ambiguous, missing };
}

/**
 * Классы, у которых больше одного набора правил в базе.
 *
 * Считаем отдельно базовые варианты и медиа-варианты: у `.h-406` 31 запись,
 * но это 13 базовых высот и 18 мобильных — без разделения цифра врёт.
 * Настоящий конфликт — это >1 БАЗОВОГО варианта в слое семьи.
 */
export function conflictReport(registry = loadStyleRegistry(), { limit = 50, layer = LAYERS.family } = {}) {
  if (!registry) return [];
  return Object.entries(registry.classes || {})
    .map(([cls, variants]) => {
      const scoped = variants.filter((v) => v.layer === layer);
      const base = scoped.filter((v) => !v.media);
      return {
        class: cls,
        base: base.length,
        media: scoped.length - base.length,
        spread: base.map((v) => ({ decls: v.decls.slice(0, 100), sources: v.sourceCount })),
      };
    })
    .filter((r) => r.base > 1)
    .sort((a, b) => b.base - a.base || b.media - a.media)
    .slice(0, limit);
}

/** Сводка: сколько классов реально многозначны. */
export function conflictSummary(registry = loadStyleRegistry()) {
  if (!registry) return { classes: 0, conflicting: 0, worst: null };
  let conflicting = 0, worst = null;
  for (const [cls, variants] of Object.entries(registry.classes || {})) {
    const base = variants.filter((v) => v.layer === LAYERS.family && !v.media);
    if (base.length > 1) {
      conflicting++;
      if (!worst || base.length > worst.base) worst = { class: cls, base: base.length };
    }
  }
  return { classes: Object.keys(registry.classes || {}).length, conflicting, worst };
}
