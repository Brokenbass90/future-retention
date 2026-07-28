#!/usr/bin/env node
/**
 * scripts/build-style-registry.mjs — пересобрать индекс всего CSS базы.
 *
 *   node scripts/build-style-registry.mjs              # полный пересбор
 *   node scripts/build-style-registry.mjs --max 20     # первые 20 писем (отладка)
 *   node scripts/build-style-registry.mjs --report     # только отчёт по конфликтам
 *   node scripts/build-style-registry.mjs --class h-406  # что стоит за классом
 */
import { buildStyleRegistry, saveStyleRegistry, loadStyleRegistry, conflictReport, conflictSummary, lookupClass, LAYERS } from "../src/style-registry.js";

const argv = process.argv.slice(2);
const opt = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d; };
const has = (n) => argv.includes(`--${n}`);

const askedClass = opt("class");
if (askedClass) {
  const variants = lookupClass(askedClass);
  if (!variants.length) { console.log(`.${askedClass} — в базе нет ни одного правила`); process.exit(0); }
  console.log(`.${askedClass} — ${variants.length} вариант(ов):\n`);
  for (const v of variants) {
    console.log(`  [${v.layer === LAYERS.framework ? "фреймворк" : "семья"}] в ${v.sourceCount} источник(ах)${v.media ? ` · ${v.media}` : ""}`);
    console.log(`    ${v.decls}`);
    console.log(`    напр.: ${v.sources.slice(0, 3).join(", ")}\n`);
  }
  process.exit(0);
}

if (has("report")) {
  const reg = loadStyleRegistry();
  if (!reg) { console.error("реестра нет — сначала прогони без --report"); process.exit(1); }
  const summary = conflictSummary(reg);
  const conflicts = conflictReport(reg, { limit: Number(opt("limit", 30)) });
  console.log(`классов: ${summary.classes} · правил разобрано: ${reg.ruleCount} · писем: ${reg.mailsScanned}`);
  console.log(`классов с НЕСКОЛЬКИМИ базовыми смыслами в слое семьи: ${summary.conflicting}`);
  console.log(`\nтоп (базовых вариантов / из них мобильных):\n`);
  for (const c of conflicts) {
    console.log(`  .${c.class} — ${c.base} базовых, ${c.media} медиа`);
    for (const s of c.spread.slice(0, 3)) console.log(`      (${s.sources} ист.) ${s.decls}`);
  }
  process.exit(0);
}

const registry = buildStyleRegistry({
  log: (m) => console.log(m),
  maxMails: Number(opt("max", Infinity)) || Infinity,
});
saveStyleRegistry(registry);
console.log(
  `\nготово: ${registry.classCount} классов · ${registry.ruleCount} правил · ` +
  `${registry.conflictCount} классов с несколькими смыслами · писем ${registry.mailsScanned}`,
);
if (registry.sourceErrors.length) {
  console.log(`не скомпилировалось источников: ${registry.sourceErrors.length}`);
  for (const e of registry.sourceErrors.slice(0, 8)) console.log(`  ${e.file}: ${e.error}`);
}
