#!/usr/bin/env node
/**
 * scripts/compare-previews.mjs — пиксельная сверка превью «до/после».
 *
 * Нужна для рискованных операций над библиотекой (автоскоуп стилей): блок
 * должен выглядеть ровно так же, как раньше, иначе миграция незаметно
 * поломала вёрстку в сотне писем.
 *
 * Сравнение честное: если размеры разошлись, это уже расхождение, а не повод
 * подогнать картинки друг под друга.
 *
 *   node scripts/compare-previews.mjs <папка-до> <папка-после> [--threshold 0.002]
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";

const [beforeDir, afterDir] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? Number(argv[i + 1]) : d; };
const THRESHOLD = opt("threshold", 0.002);   // 0.2% пикселей
const LIMIT = opt("limit", 0) || Infinity;

if (!beforeDir || !afterDir || !existsSync(beforeDir) || !existsSync(afterDir)) {
  console.error("usage: node scripts/compare-previews.mjs <папка-до> <папка-после>");
  process.exit(1);
}

const files = readdirSync(beforeDir).filter((f) => f.endsWith(".png"));
const identical = [];
const differs = [];
const resized = [];
const missing = [];

let n = 0;
for (const file of files) {
  if (++n > LIMIT) break;
  const a = path.join(beforeDir, file);
  const b = path.join(afterDir, file);
  if (!existsSync(b)) { missing.push(file); continue; }

  let imgA, imgB;
  try { imgA = PNG.sync.read(readFileSync(a)); imgB = PNG.sync.read(readFileSync(b)); }
  catch { missing.push(file); continue; }

  if (imgA.width !== imgB.width || imgA.height !== imgB.height) {
    resized.push({ file, before: `${imgA.width}×${imgA.height}`, after: `${imgB.width}×${imgB.height}` });
    continue;
  }
  const diff = new PNG({ width: imgA.width, height: imgA.height });
  const changed = pixelmatch(imgA.data, imgB.data, diff.data, imgA.width, imgA.height, { threshold: 0.1 });
  const ratio = changed / (imgA.width * imgA.height);
  if (ratio > THRESHOLD) differs.push({ file, ratio, changed });
  else identical.push(file);
}

console.log(`сравнено: ${identical.length + differs.length + resized.length} превью`);
console.log(`  совпадают (порог ${(THRESHOLD * 100).toFixed(2)}%): ${identical.length}`);
console.log(`  изменилась геометрия: ${resized.length}`);
console.log(`  расходятся по пикселям: ${differs.length}`);
if (missing.length) console.log(`  нет пары: ${missing.length}`);

for (const r of resized.slice(0, 20)) console.log(`   ⚠ ${r.file}: ${r.before} → ${r.after}`);
for (const d of differs.sort((x, y) => y.ratio - x.ratio).slice(0, 20)) {
  console.log(`   ⚠ ${d.file}: ${(d.ratio * 100).toFixed(2)}% (${d.changed} px)`);
}

process.exit(differs.length || resized.length ? 1 : 0);
