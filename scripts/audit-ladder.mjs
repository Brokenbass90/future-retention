#!/usr/bin/env node
/**
 * audit-ladder.mjs — какие ветки лестницы в server.js недостижимы.
 *
 * Два переезда домена подряд нашли ручку, которая не срабатывала никогда:
 * история письма (`startsWith("/api/history")` выше, чем
 * `startsWith("/api/history/")`) и бренды (`GET /api/brands` объявлен дважды).
 * Обе поломки одинаковые и обе тихие: ответ приходит, он выглядит успехом,
 * просто не тот. Кнопка «открыть» в истории не работала месяцами.
 *
 * Искать это глазами в лестнице из сотни `if`-ов нельзя: ветки выглядят
 * одинаково законно, и всё решает их порядок. Поэтому — детектор. Он читает
 * условия по порядку и для каждой ветки спрашивает: есть ли выше ветка,
 * которая заберёт её запросы целиком.
 *
 * Считается по фактам, без модели: путь либо накрывается ранним префиксом,
 * либо нет. Показывает и то, что уже переехало в маршрутизатор, — там такие
 * пары невозможны, и это видно на контрасте.
 *
 * Zero-AI. Exit 1, если найдены недостижимые ветки.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import url from "node:url";

/**
 * Условия веток — в порядке появления.
 *
 * Метод берём из той же строки: в этой лестнице он всегда рядом с путём.
 * Ветка без метода отвечает на любой — и накрывает больше, чем кажется.
 *
 * Разбор и правило вынесены наружу нарочно: детектор, который нельзя
 * проверить на заведомо битой лестнице, сам ничем не лучше той лестницы.
 */
export function ladderBranches(text) {
  const branches = [];
  String(text || "").split("\n").forEach((line, index) => {
    // Только настоящие ветки лестницы. Присваивание вида
    // `const requestPath = request.url === "/" ? …` условием не является, а
    // выглядит похоже — без этой проверки детектор врёт на ровном месте.
    if (!/^\s*(\}\s*else\s+)?if\s*\(/.test(line)) return;
    const exact = line.match(/request\.url === "([^"]+)"/);
    const prefix = line.match(/request\.url\.startsWith\("([^"]+)"\)/);
    if (!exact && !prefix) return;
    const method = (line.match(/request\.method === "([A-Z]+)"/) || [])[1] || "*";
    branches.push({
      line: index + 1,
      method,
      kind: exact ? "exact" : "prefix",
      value: (exact ? exact[1] : prefix[1]),
      text: line.trim().slice(0, 110),
    });
  });
  return branches;
}

/** Забирает ли ветка `earlier` все запросы ветки `later`? */
export function shadows(earlier, later) {
  if (earlier.method !== "*" && later.method !== "*" && earlier.method !== later.method) return false;
  if (earlier.method !== "*" && later.method === "*") return false;
  if (earlier.kind === "prefix") return later.value.startsWith(earlier.value);
  return later.kind === "exact" && later.value === earlier.value;
}

/** Ветки, до которых запрос не доходит никогда. */
export function deadBranches(text) {
  const branches = ladderBranches(text);
  const dead = [];
  for (let i = 0; i < branches.length; i++) {
    for (let j = 0; j < i; j++) {
      if (shadows(branches[j], branches[i])) {
        dead.push({ later: branches[i], earlier: branches[j] });
        break;
      }
    }
  }
  return { branches, dead };
}

// Запуск как отчёта: node scripts/audit-ladder.mjs
if (process.argv[1] && process.argv[1].endsWith("audit-ladder.mjs")) {
const repoRoot = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const { branches, dead } = deadBranches(readFileSync(path.join(repoRoot, "server.js"), "utf8"));

console.log(`Веток в лестнице: ${branches.length}`);
if (!dead.length) {
  console.log("\x1b[32m✓\x1b[0m Недостижимых веток нет.");
  process.exit(0);
}

console.log(`\n\x1b[31mНедостижимых веток: ${dead.length}\x1b[0m\n`);
for (const { later, earlier } of dead) {
  console.log(`  server.js:${later.line}  ${later.method} ${later.value}`);
  console.log(`    ${later.text}`);
  console.log(`  \x1b[33mзабирает её запросы:\x1b[0m server.js:${earlier.line}  ${earlier.method} ${earlier.value}`);
  console.log(`    ${earlier.text}\n`);
}
console.log("Такая ветка не ошибка компилятора и не падение: она просто молчит,");
console.log("а вызывающий получает ответ соседней ручки и считает его своим.");
process.exit(1);
}
