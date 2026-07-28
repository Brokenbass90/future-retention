#!/usr/bin/env node
/**
 * scripts/scope-block-styles.mjs — прогон автоскоупа по библиотеке.
 *
 * По умолчанию НИЧЕГО не пишет: показывает, что изменится. Запись — только
 * с --apply, и только после того, как отчёт посмотрели глазами.
 *
 *   node scripts/scope-block-styles.mjs --source canonical        # что будет
 *   node scripts/scope-block-styles.mjs --block iq-gray-step -v   # разбор одного
 *   node scripts/scope-block-styles.mjs --source canonical --apply
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import url from "node:url";
import { scopeBlockStyles } from "../src/scope-block-styles.js";
import { loadStyleRegistry } from "../src/style-registry.js";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const libraryRoot = path.join(repoRoot, "data", "block-library");

const argv = process.argv.slice(2);
const opt = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d; };
const has = (n) => argv.includes(`--${n}`);
const SOURCE = opt("source", "canonical");
const ONE = opt("block", null);
const APPLY = has("apply");
const VERBOSE = has("v") || has("verbose");

const registry = loadStyleRegistry();
if (!registry) { console.error("нет реестра стилей — сначала: npm run styles:registry"); process.exit(1); }

const dirs = SOURCE === "all" ? ["canonical", "imported", "user"] : [SOURCE];
const rows = [];

for (const src of dirs) {
  const dir = path.join(libraryRoot, src);
  if (!existsSync(dir)) continue;
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".json") || file === "index.json" || file === "_validation.json") continue;
    let block;
    try { block = JSON.parse(readFileSync(path.join(dir, file), "utf8")); } catch { continue; }
    if (!block?.id) continue;
    if (ONE && block.id !== ONE) continue;
    block.source = src;

    const { block: next, report } = scopeBlockStyles(block, { registry });
    rows.push({ report, next, file: path.join(dir, file) });

    if (VERBOSE || ONE) {
      console.log(`\n=== ${block.id} (${src}) · изменится: ${report.changed}`);
      if (report.renamed.length) console.log(`  переименовать: ${report.renamed.map((r) => r.from).join(", ")}`);
      if (report.dualScoped.length) console.log(`  оба имени (фреймворк + своё): ${report.dualScoped.map((r) => r.from).join(", ")}`);
      if (report.pulled.length) console.log(`  втянуть из семьи: ${report.pulled.join(", ")}`);
      for (const a of report.ambiguousResolved) {
        console.log(`  ⚠️ .${a.class} — ${a.variants} смыслов, взят из ${a.from}${a.decided ? " (по решению)" : " (по распространённости)"}`);
      }
      if (report.turnedIntoSlots.length) console.log(`  → слотом: ${report.turnedIntoSlots.map((t) => `${t.class} → ${t.slot.id}`).join(", ")}`);
      if (report.missing.length) console.log(`  без CSS (оставлены как есть): ${report.missing.join(", ")}`);
    }

    if (APPLY && report.changed) {
      const { source, ...clean } = next;
      writeFileSync(path.join(dir, file), JSON.stringify(clean, null, 2) + "\n", "utf8");
    }
  }
}

const changed = rows.filter((r) => r.report.changed);
const undecided = rows.flatMap((r) => r.report.ambiguousResolved.filter((a) => !a.decided)
  .map((a) => ({ block: r.report.id, ...a })));

console.log(`\nблоков просмотрено: ${rows.length} · изменится: ${changed.length}`);
console.log(`втягиваний из семьи: ${rows.reduce((s, r) => s + r.report.pulled.length, 0)}`);
console.log(`переименований: ${rows.reduce((s, r) => s + r.report.renamed.length, 0)}`);
console.log(`двойных (фреймворк + своё): ${rows.reduce((s, r) => s + r.report.dualScoped.length, 0)}`);
console.log(`станет слотами: ${rows.reduce((s, r) => s + r.report.turnedIntoSlots.length, 0)}`);

if (undecided.length) {
  console.log(`\n⚠️ многозначные классы БЕЗ явного решения (взят самый распространённый вариант): ${undecided.length}`);
  const byClass = new Map();
  for (const u of undecided) {
    if (!byClass.has(u.class)) byClass.set(u.class, { variants: u.variants, blocks: [] });
    byClass.get(u.class).blocks.push(u.block);
  }
  for (const [cls, info] of [...byClass.entries()].sort((a, b) => b[1].blocks.length - a[1].blocks.length).slice(0, 15)) {
    console.log(`   .${cls} — ${info.variants} смыслов, в ${info.blocks.length} блоках: ${info.blocks.slice(0, 4).join(", ")}`);
  }
  console.log(`   добавь решение в data/style-decisions.json, если вариант по умолчанию не тот`);
}

console.log(APPLY ? "\nЗАПИСАНО на диск." : "\nЭто сухой прогон. Запись: добавь --apply");
