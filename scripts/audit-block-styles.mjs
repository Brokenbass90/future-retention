#!/usr/bin/env node
/**
 * scripts/audit-block-styles.mjs — от чего на самом деле зависят стили блоков.
 *
 * Блок в библиотеке несёт только тот CSS, который автор положил ему в `styl`.
 * Всё остальное он молча берёт из `blocks/main.styl` семьи, куда его положили —
 * а там `.h-406` значит 16 разных высот, `.bgr-image` — 36 разных фонов.
 * Этот отчёт показывает, ГДЕ именно блок опирается на чужое, ДО того как мы
 * начнём переписывать имена классов.
 *
 * Каждый класс из разметки блока попадает в одну из корзин:
 *   own      — определён в собственном styl блока (всё хорошо)
 *   framework — ink/vendor, общий для всех (втягивать не надо)
 *   family   — есть только в main.styl семей → нужно втянуть в блок
 *              (и отдельно: сколько у него смыслов — 1 значит безопасно)
 *   missing  — CSS нет нигде: класс в разметке есть, стилей за ним не стоит
 *
 * Usage:
 *   node scripts/audit-block-styles.mjs                  # markdown в docs/
 *   node scripts/audit-block-styles.mjs --source canonical
 *   node scripts/audit-block-styles.mjs --json           # машиночитаемо в stdout
 *   node scripts/audit-block-styles.mjs --block iq-hero-copy   # разбор одного
 */
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import url from "node:url";
import { loadStyleRegistry, lookupClass, LAYERS } from "../src/style-registry.js";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const libraryRoot = path.join(repoRoot, "data", "block-library");
const outPath = path.join(repoRoot, "docs", "BLOCK-STYLE-DEPENDENCIES.md");

const argv = process.argv.slice(2);
const opt = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d; };
const has = (n) => argv.includes(`--${n}`);
const SOURCE = opt("source", "all");
const ONE = opt("block", null);

/* ─── Извлечение классов ─────────────────────────────────────────────────── */

/**
 * Классы, которые блок ИСПОЛЬЗУЕТ в разметке.
 * Pug: `table.row.header(...)`, `div.a.b`, а также `class="x y"` в атрибутах.
 * Токены слотов `{{ … }}` в позиции класса пропускаем — это не имя класса.
 */
export function classesUsedInPug(pug) {
  const out = new Set();
  for (const rawLine of String(pug || "").split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("//")) continue;

    // Голова строки до открывающей скобки/пробела: tag.a.b#id
    const head = line.split(/[\s(]/, 1)[0] || "";
    for (const m of head.matchAll(/\.([_a-zA-Z][\w-]*)/g)) out.add(m[1]);

    // class="a b" / class='a b' в любом месте строки
    for (const m of rawLine.matchAll(/\bclass\s*=\s*(["'])([\s\S]*?)\1/g)) {
      for (const token of m[2].split(/\s+/)) {
        if (!token || token.includes("{{")) continue;
        if (/^[_a-zA-Z][\w-]*$/.test(token)) out.add(token);
      }
    }
  }
  return [...out];
}

/** Классы, которые блок САМ ОПРЕДЕЛЯЕТ в своём styl. */
export function classesDefinedInStyl(styl) {
  const out = new Set();
  const text = String(styl || "");
  // Блоки хранят styl уже в CSS-подобном виде (`.a{...}`), но встречается и
  // отступный Stylus — ловим оба: имя класса перед `{`, `,` или концом строки.
  for (const m of text.matchAll(/(^|[\s,{}>+~])\.([_a-zA-Z][\w-]*)(?=[\s,{:.]|$)/gm)) {
    out.add(m[2]);
  }
  return [...out];
}

/* ─── Классификация ──────────────────────────────────────────────────────── */

function classifyBlock(block, registry) {
  const used = classesUsedInPug(block.pug);
  const own = new Set(classesDefinedInStyl(block.styl));

  const buckets = { own: [], framework: [], overridden: [], family: [], missing: [] };
  const ambiguous = [];

  for (const cls of used) {
    if (own.has(cls)) { buckets.own.push(cls); continue; }
    const variants = lookupClass(cls, registry);
    if (!variants.length) { buckets.missing.push(cls); continue; }

    const familyBase = variants.filter((v) => v.layer === LAYERS.family && !v.media);
    if (!familyBase.length) { buckets.framework.push(cls); continue; }

    // Класс есть и во фреймворке, и в семье (.row, .columns, .center — Ink,
    // который семьи переопределяют под себя). Решение тут другое, чем для
    // чисто семейного класса: по умолчанию оставляем фреймворковый вариант,
    // а переопределение втягиваем только если блок на него реально смотрит.
    const inFramework = variants.some((v) => v.layer === LAYERS.framework);
    if (inFramework) { buckets.overridden.push(cls); continue; }

    buckets.family.push(cls);
    if (familyBase.length > 1) {
      ambiguous.push({
        class: cls,
        meanings: familyBase.length,
        top: familyBase.slice(0, 3).map((v) => ({ decls: v.decls.slice(0, 90), sources: v.sourceCount })),
      });
    }
  }

  // Мёртвый CSS: класс определён в styl блока, но в разметке блока не встречается.
  const usedSet = new Set(used);
  const unusedOwn = [...own].filter((c) => !usedSet.has(c));

  return {
    id: block.id,
    source: block.source,
    label: block.label || block.id,
    placement: block.placement || null,
    usedCount: used.length,
    ...buckets,
    ambiguous,
    unusedOwn,
    // Блок самодостаточен, если каждый его класс либо свой, либо фреймворковый.
    // overridden не мешает самодостаточности: фреймворковый вариант класса
    // есть в каждом письме, блок не останется без стилей.
    selfContained: buckets.family.length === 0 && buckets.missing.length === 0,
    // Насколько тяжело мигрировать: многозначные классы требуют решения руками.
    manualDecisions: ambiguous.length,
  };
}

/* ─── Загрузка библиотеки ────────────────────────────────────────────────── */

function loadLibrary() {
  const sources = SOURCE === "all" ? ["canonical", "imported", "user"] : [SOURCE];
  const out = [];
  for (const src of sources) {
    const dir = path.join(libraryRoot, src);
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".json") || file === "index.json" || file === "_validation.json") continue;
      try {
        const block = JSON.parse(readFileSync(path.join(dir, file), "utf8"));
        if (block?.id && block.validated !== false) out.push({ ...block, source: src });
      } catch { /* битый json — не наша забота здесь */ }
    }
  }
  return out;
}

/* ─── Отчёт ──────────────────────────────────────────────────────────────── */

function markdown(rows, registry) {
  const total = rows.length;
  const selfContained = rows.filter((r) => r.selfContained).length;
  const withMissing = rows.filter((r) => r.missing.length).length;
  const withAmbiguous = rows.filter((r) => r.manualDecisions).length;

  const familyFreq = new Map();
  const missingFreq = new Map();
  for (const r of rows) {
    for (const c of r.family) familyFreq.set(c, (familyFreq.get(c) || 0) + 1);
    for (const c of r.missing) missingFreq.set(c, (missingFreq.get(c) || 0) + 1);
  }
  const top = (map, n = 25) => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);

  const lines = [];
  lines.push("# Зависимости стилей блоков — что придётся втянуть при автоскоупе");
  lines.push("");
  lines.push(`Сгенерировано: ${new Date().toISOString()} · \`node scripts/audit-block-styles.mjs\``);
  lines.push("");
  lines.push("Отчёт отвечает на вопрос «что сломается, если оторвать блоки от `main.styl` семьи».");
  lines.push("Каждый класс из разметки блока разложен на: свой (в `styl` блока), фреймворковый");
  lines.push("(ink/vendor, остаётся глобальным), из семьи (надо втянуть внутрь блока) и");
  lines.push("отсутствующий (CSS нет нигде).");
  lines.push("");
  lines.push("## Сводка");
  lines.push("");
  lines.push(`| | блоков |`);
  lines.push(`|---|---|`);
  lines.push(`| всего в библиотеке | ${total} |`);
  lines.push(`| **уже самодостаточны** (только свои + фреймворк) | **${selfContained}** |`);
  lines.push(`| опираются на классы семьи | ${total - selfContained} |`);
  lines.push(`| используют классы, которых нет нигде | ${withMissing} |`);
  lines.push(`| используют фреймворковые классы, переопределённые семьёй | ${rows.filter((r) => r.overridden.length).length} |`);
  lines.push(`| требуют решения руками (многозначный класс) | ${withAmbiguous} |`);
  lines.push("");
  lines.push(`Реестр: ${registry?.classCount ?? "?"} классов, ${registry?.ruleCount ?? "?"} правил, ${registry?.mailsScanned ?? "?"} писем.`);
  lines.push("");

  lines.push("## Классы семьи, которые надо втянуть в блоки");
  lines.push("");
  lines.push("| класс | в скольких блоках | смыслов в базе | вердикт |");
  lines.push("|---|---|---|---|");
  for (const [cls, count] of top(familyFreq)) {
    const meanings = lookupClass(cls, registry).filter((v) => v.layer === LAYERS.family && !v.media).length;
    const verdict = meanings > 1 ? `⚠️ решать руками` : "✅ переносится автоматом";
    lines.push(`| \`.${cls}\` | ${count} | ${meanings} | ${verdict} |`);
  }
  lines.push("");

  if (missingFreq.size) {
    lines.push("## Классы без CSS — в разметке есть, стилей нет");
    lines.push("");
    lines.push("Это либо опечатки, либо остатки от удалённых семей. Втягивать нечего:");
    lines.push("класс надо либо убрать из разметки, либо дописать ему правила.");
    lines.push("");
    lines.push("| класс | в скольких блоках |");
    lines.push("|---|---|");
    for (const [cls, count] of top(missingFreq, 30)) lines.push(`| \`.${cls}\` | ${count} |`);
    lines.push("");
  }

  const hard = rows.filter((r) => r.manualDecisions)
    .sort((a, b) => b.manualDecisions - a.manualDecisions).slice(0, 30);
  if (hard.length) {
    lines.push("## Блоки, которые нельзя мигрировать автоматом");
    lines.push("");
    lines.push("| блок | источник | многозначных классов | какие |");
    lines.push("|---|---|---|---|");
    for (const r of hard) {
      lines.push(`| \`${r.id}\` | ${r.source} | ${r.manualDecisions} | ${r.ambiguous.map((a) => `\`.${a.class}\`(${a.meanings})`).join(", ")} |`);
    }
    lines.push("");
  }

  const clean = rows.filter((r) => r.selfContained).map((r) => r.id);
  lines.push("## Блоки, готовые к скоупу прямо сейчас");
  lines.push("");
  lines.push(`${clean.length} шт. — все их классы либо свои, либо фреймворковые.`);
  lines.push("");
  if (clean.length <= 80) {
    lines.push(clean.map((id) => `\`${id}\``).join(", "));
  } else {
    lines.push(clean.slice(0, 80).map((id) => `\`${id}\``).join(", ") + ` … и ещё ${clean.length - 80}`);
  }
  lines.push("");

  const deadCss = rows.filter((r) => r.unusedOwn.length).length;
  lines.push("## Попутно");
  lines.push("");
  lines.push(`- Блоков с мёртвым собственным CSS (класс определён в \`styl\`, но в разметке блока не используется): **${deadCss}**.`);
  lines.push("");
  return lines.join("\n") + "\n";
}

/* ─── main ───────────────────────────────────────────────────────────────── */

const registry = loadStyleRegistry();
if (!registry) {
  console.error("реестра стилей нет — сначала: npm run styles:registry");
  process.exit(1);
}

let library = loadLibrary();
if (ONE) library = library.filter((b) => b.id === ONE);
if (!library.length) { console.error("блоки не найдены"); process.exit(1); }

const rows = library.map((b) => classifyBlock(b, registry))
  .sort((a, b) => (b.family.length + b.missing.length) - (a.family.length + a.missing.length));

if (ONE) {
  const r = rows[0];
  console.log(`${r.id} (${r.source}) — ${r.label}`);
  console.log(`  классов в разметке: ${r.usedCount}`);
  console.log(`  свои        (${r.own.length}): ${r.own.join(", ") || "—"}`);
  console.log(`  фреймворк   (${r.framework.length}): ${r.framework.join(", ") || "—"}`);
  console.log(`  переопр. семьёй (${r.overridden.length}): ${r.overridden.join(", ") || "—"}`);
  console.log(`  из семьи    (${r.family.length}): ${r.family.join(", ") || "—"}`);
  console.log(`  без CSS     (${r.missing.length}): ${r.missing.join(", ") || "—"}`);
  if (r.unusedOwn.length) console.log(`  мёртвый свой CSS: ${r.unusedOwn.join(", ")}`);
  if (r.ambiguous.length) {
    console.log(`  ⚠️ многозначные:`);
    for (const a of r.ambiguous) {
      console.log(`     .${a.class} — ${a.meanings} смыслов:`);
      for (const t of a.top) console.log(`        (${t.sources} ист.) ${t.decls}`);
    }
  }
  console.log(`  самодостаточен: ${r.selfContained ? "да" : "нет"}`);
  process.exit(0);
}

if (has("json")) {
  console.log(JSON.stringify({ generatedAt: new Date().toISOString(), blocks: rows }, null, 2));
  process.exit(0);
}

mkdirSync(path.dirname(outPath), { recursive: true });
writeFileSync(outPath, markdown(rows, registry), "utf8");

const selfContained = rows.filter((r) => r.selfContained).length;
const hard = rows.filter((r) => r.manualDecisions).length;
console.log(
  `блоков: ${rows.length} · самодостаточны: ${selfContained} · ` +
  `опираются на семью: ${rows.length - selfContained} · требуют решения руками: ${hard}`,
);
console.log(`отчёт: ${path.relative(repoRoot, outPath)}`);
