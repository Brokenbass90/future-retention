#!/usr/bin/env node
/**
 * scripts/archive-mails.mjs — убрать из базы письма, которые никому не нужны
 * каждый день, оставив живыми образцы.
 *
 * Зачем. В базе 90 писем, и это не 90 разных писем, а история: кампании
 * позапрошлого года, копии копий, тестовые прогоны. Человек открывает список
 * и не находит нужное. Блоки из этих писем давно вытащены в каталог
 * (data/block-library/imported), поэтому письма нужны не как исходник блоков,
 * а как образцы: посмотреть, как собрана настоящая рассылка, и проверить на
 * них сборку.
 *
 * Что делает: переносит письма в email-base/_archive/<БРЕНД>/. Именно
 * переносит, а не удаляет — архив остаётся на диске и в репозитории, просто
 * перестаёт показываться в списках студии. Вернуть письмо — это `git mv`
 * обратно, а не восстановление из небытия.
 *
 * Кого оставляем (правило, а не вкусовщина):
 *   1. письма, на которые ссылаются тесты и код — иначе прогон покраснеет;
 *   2. письма, дающие больше всего РАЗНЫХ блоков каталога, по жадному
 *      покрытию: пять писем на бренд закрывают заметную долю библиотеки.
 *
 * Usage:
 *   node scripts/archive-mails.mjs           # только отчёт, ничего не трогает
 *   node scripts/archive-mails.mjs --apply   # перенести
 *   node scripts/archive-mails.mjs --restore # вернуть всё из архива
 */
import { existsSync, readdirSync, readFileSync, mkdirSync, renameSync } from "node:fs";
import path from "node:path";
import url from "node:url";

const repoRoot = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const emailBase = path.join(repoRoot, "email-base");
const archiveRoot = path.join(emailBase, "_archive");
const apply = process.argv.includes("--apply");
const restore = process.argv.includes("--restore");
const KEEP_PER_BRAND = Number(process.env.KEEP_PER_BRAND || 5);

/**
 * Рабочие свалки, а не бренды: они целиком в .gitignore, туда складывается
 * вывод конструктора и следы тестов. Переносить их в архив нельзя — архив
 * лежит в репозитории, и мусор уехал бы в git. Их чистят отдельно.
 */
const SCRATCH_BRANDS = new Set(["X_assembled", "X_preview", "X_new"]);

const brands = () => readdirSync(emailBase, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name.startsWith("X_") && !SCRATCH_BRANDS.has(entry.name))
  .map((entry) => entry.name)
  .sort();

const mailsOf = (brand) => {
  const dir = path.join(emailBase, brand);
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("mail-") && !entry.name.includes("__draft-"))
    .map((entry) => entry.name)
    .sort();
};

/** Письма, названные в коде и тестах: их архив сломал бы прогон. */
function referencedByCode() {
  const referenced = new Set();
  const roots = [path.join(repoRoot, "scripts"), path.join(repoRoot, "src"), path.join(repoRoot, "email-base", "tools")];
  const texts = [readFileSync(path.join(repoRoot, "server.js"), "utf8")];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const file of readdirSync(root)) {
      if (!/\.(mjs|js)$/.test(file)) continue;
      texts.push(readFileSync(path.join(root, file), "utf8"));
    }
  }
  const haystack = texts.join("\n");
  for (const brand of brands()) {
    for (const mail of mailsOf(brand)) {
      // Ищем именно полное имя папки: «mail-welcome» встречается в коде, а
      // «mail-w» — нет, и подстрока не должна приводить к ложному удержанию.
      const pattern = new RegExp(`["'/\`]${mail}(["'/\`]|$)`, "m");
      if (pattern.test(haystack)) referenced.add(`${brand}/${mail}`);
    }
  }
  return referenced;
}

/** Сколько разных блоков каталога дало каждое письмо. */
function blocksBySourceMail() {
  const dir = path.join(repoRoot, "data", "block-library", "imported");
  const byMail = new Map();
  if (!existsSync(dir)) return byMail;
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".json") || file.startsWith("_") || file === "index.json") continue;
    let block;
    try { block = JSON.parse(readFileSync(path.join(dir, file), "utf8")); } catch { continue; }
    for (const source of block.sourceMails || []) {
      if (!byMail.has(source)) byMail.set(source, new Set());
      byMail.get(source).add(block.id);
    }
  }
  return byMail;
}

/** Жадное покрытие: письма, дающие больше всего НОВЫХ блоков. */
function coveragePicks(brand, byMail, limit) {
  const pool = [...byMail.entries()].filter(([key]) => key.startsWith(`${brand}/`));
  const covered = new Set();
  const picked = [];
  while (picked.length < limit && pool.length) {
    pool.sort((a, b) =>
      [...b[1]].filter((id) => !covered.has(id)).length - [...a[1]].filter((id) => !covered.has(id)).length);
    const [key, blocks] = pool.shift();
    const added = [...blocks].filter((id) => !covered.has(id)).length;
    if (!added) break;
    blocks.forEach((id) => covered.add(id));
    picked.push({ key, added });
  }
  return { picked, covered: covered.size };
}

function plan() {
  const referenced = referencedByCode();
  const byMail = blocksBySourceMail();
  const keep = new Set(referenced);
  const report = [];

  for (const brand of brands()) {
    const { picked, covered } = coveragePicks(brand, byMail, KEEP_PER_BRAND);
    picked.forEach(({ key }) => keep.add(key));
    const all = mailsOf(brand).map((mail) => `${brand}/${mail}`);
    report.push({
      brand,
      total: all.length,
      keep: all.filter((key) => keep.has(key)),
      archive: all.filter((key) => !keep.has(key)),
      coverage: covered,
      picks: picked,
    });
  }
  return { report, referenced };
}

function move(fromKey, toRoot) {
  const [brand, mail] = fromKey.split("/");
  const from = path.join(emailBase, brand, mail);
  const to = path.join(toRoot, brand, mail);
  if (!existsSync(from)) return false;
  mkdirSync(path.dirname(to), { recursive: true });
  renameSync(from, to);
  return true;
}

if (restore) {
  if (!existsSync(archiveRoot)) { console.log("Архива нет — нечего возвращать."); process.exit(0); }
  let returned = 0;
  for (const brand of readdirSync(archiveRoot)) {
    for (const mail of readdirSync(path.join(archiveRoot, brand))) {
      const to = path.join(emailBase, brand, mail);
      if (existsSync(to)) { console.log(`  пропуск (уже есть): ${brand}/${mail}`); continue; }
      mkdirSync(path.dirname(to), { recursive: true });
      renameSync(path.join(archiveRoot, brand, mail), to);
      returned++;
    }
  }
  console.log(`Возвращено из архива: ${returned}`);
  process.exit(0);
}

const { report, referenced } = plan();
let totalKeep = 0, totalArchive = 0;

for (const entry of report) {
  totalKeep += entry.keep.length;
  totalArchive += entry.archive.length;
  console.log(`\n${entry.brand}: всего ${entry.total}, остаётся ${entry.keep.length}, в архив ${entry.archive.length}`);
  for (const key of entry.keep) {
    const why = referenced.has(key) ? "нужен коду и тестам" : "образец: даёт блоки каталога";
    console.log(`  ✓ ${key.split("/")[1]}  — ${why}`);
  }
  if (entry.picks.length) {
    console.log(`    (пять образцов закрывают ${entry.coverage} блоков библиотеки)`);
  }
}

console.log(`\nИтого: остаётся ${totalKeep}, в архив ${totalArchive}.`);

if (!apply) {
  console.log("Это только отчёт. Перенести: node scripts/archive-mails.mjs --apply");
  process.exit(0);
}

let moved = 0, failed = 0;
for (const entry of report) {
  for (const key of entry.archive) {
    try {
      if (move(key, archiveRoot)) moved++;
    } catch (error) {
      failed++;
      console.error(`  ✗ ${key}: ${error.message}`);
    }
  }
}
console.log(`\nПеренесено в email-base/_archive: ${moved}${failed ? `, не удалось: ${failed}` : ""}`);
console.log("Вернуть всё обратно: node scripts/archive-mails.mjs --restore");
