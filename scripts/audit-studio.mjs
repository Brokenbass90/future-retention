#!/usr/bin/env node
/**
 * scripts/audit-studio.mjs — что в студии лишнее, мёртвое и удвоенное.
 *
 * Зачем это, а не «пусть модель посмотрит код». На сорока тысячах строк модель
 * выдаёт десятки правдоподобных находок, половина из которых выдумана, и
 * разбор списка стоит дороже самих ошибок. Здесь всё считается по фактам:
 * есть ссылка на ручку или нет, импортируется файл или нет, сколько раз
 * повторён один и тот же регэксп. Врать такому отчёту нечем.
 *
 * Что ищем и почему именно это:
 *   • ручки API, которые никто не вызывает — их 107, и каждая мёртвая
 *     продолжает жить в коде, ломаться при рефакторинге и путать агента;
 *   • вторые реализации одного и того же — главная болезнь этого проекта
 *     (два чата, два способа собрать путь, четыре копии регэкспа плейсхолдеров);
 *   • файлы, на которые никто не ссылается;
 *   • функции-переростки: там, где функция длиннее экрана, ошибки живут дольше;
 *   • забытые TODO и заглушки.
 *
 * Usage:
 *   node scripts/audit-studio.mjs            # отчёт
 *   node scripts/audit-studio.mjs --json     # машинно-читаемо
 *   node scripts/audit-studio.mjs --top 40   # длиннее список
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import url from "node:url";

const repoRoot = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const asJson = argv.includes("--json");
const TOP = Number((argv[argv.indexOf("--top") + 1]) || 20);

const read = (file) => { try { return readFileSync(file, "utf8"); } catch { return ""; } };
const listFiles = (dir, pattern) => {
  const full = path.join(repoRoot, dir);
  if (!existsSync(full)) return [];
  return readdirSync(full)
    .filter((name) => pattern.test(name))
    .map((name) => path.join(dir, name));
};

const SOURCES = [
  "server.js",
  ...listFiles("src", /\.js$/),
  ...listFiles("public", /\.js$/),
  ...listFiles("mcp", /\.mjs$/),
  ...listFiles("scripts", /\.mjs$/),
  ...listFiles("email-base/tools", /\.js$/),
];
const TEXT = new Map(SOURCES.map((file) => [file, read(path.join(repoRoot, file))]));
const textOf = (file) => TEXT.get(file) || "";

/* ─── 1. Ручки, которые никто не зовёт ───────────────────────────────────── */

function deadEndpoints() {
  const server = textOf("server.js");
  const routes = new Set();
  for (const match of server.matchAll(/["'`](\/api\/[a-z0-9/_-]+)["'`]/gi)) routes.add(match[1]);

  // Кто вообще может звать ручку: интерфейс, MCP-сервер, тесты, скрипты — и
  // сами страницы: в разметке встречаются и ссылки, и встроенные обработчики.
  // Без HTML отчёт объявлял мёртвыми живые ручки.
  const callers = SOURCES.filter((file) => file !== "server.js");
  const callerText = [
    ...callers.map(textOf),
    ...listFiles("public", /\.html$/).map((file) => read(path.join(repoRoot, file))),
    read(path.join(repoRoot, "docs", "PROJECT-OVERVIEW.md")),
  ].join("\n");

  const dead = [];
  for (const route of [...routes].sort()) {
    // Ручка считается живой, если её зовут по полному пути или по префиксу:
    // часть маршрутов разбирается через startsWith («/api/drafts/» + действие).
    if (callerText.includes(route)) continue;
    const prefix = route.replace(/\/$/, "");
    if (callerText.includes(`${prefix}/`) || callerText.includes(`${prefix}?`)) continue;
    dead.push(route);
  }
  return { total: routes.size, dead };
}

/* ─── 2. Вторые реализации ───────────────────────────────────────────────── */

/**
 * Одинаковые куски кода в разных файлах.
 *
 * Считаем не «похоже», а «совпадает дословно»: нормализованная строка длиной
 * от 40 значимых символов, встреченная в двух и более файлах. Такие совпадения
 * почти всегда означают копипасту, а не случайность.
 */
function duplicatedLogic() {
  const seen = new Map();
  for (const file of SOURCES) {
    if (file.startsWith("scripts/")) continue; // в тестах повторы нормальны
    const lines = textOf(file).split("\n");
    for (const raw of lines) {
      const line = raw.trim();
      if (line.length < 40) continue;
      if (/^[/*]/.test(line)) continue;            // комментарии
      if (/^(import|export|console|\/\/)/.test(line)) continue;
      if (!/[=(){}]/.test(line)) continue;          // не код
      if (!seen.has(line)) seen.set(line, new Set());
      seen.get(line).add(file);
    }
  }
  return [...seen.entries()]
    .filter(([, files]) => files.size > 1)
    .map(([line, files]) => ({ line: line.slice(0, 110), files: [...files].sort() }))
    .sort((a, b) => b.files.length - a.files.length);
}

/** Регэкспы плейсхолдеров, размноженные по модулям: типичная мина этого проекта. */
function duplicatedPatterns() {
  const patterns = new Map();
  for (const file of SOURCES) {
    if (file.startsWith("scripts/")) continue;
    for (const match of textOf(file).matchAll(/\/(\\\$\\\{\\\{|\\\{\\\{)[^/\n]{4,80}\/[gimsuy]*/g)) {
      const key = match[0];
      if (!patterns.has(key)) patterns.set(key, new Set());
      patterns.get(key).add(file);
    }
  }
  return [...patterns.entries()]
    .map(([pattern, files]) => ({ pattern, files: [...files].sort() }))
    .filter((entry) => entry.files.length > 1 || entry.files.some((f) => f !== "src/placeholders.js"))
    .sort((a, b) => b.files.length - a.files.length);
}

/* ─── 3. Файлы, на которые никто не ссылается ────────────────────────────── */

function orphanFiles() {
  const htmlText = listFiles("public", /\.html$/).map((file) => read(path.join(repoRoot, file))).join("\n");
  const orphans = [];

  for (const file of SOURCES) {
    const base = path.basename(file);
    if (file === "server.js") continue;
    const stem = base.replace(/\.(js|mjs)$/, "");

    if (file.startsWith("public/")) {
      // Браузерный файл живой, если его подключает страница.
      if (htmlText.includes(base)) continue;
      orphans.push({ file, why: "не подключён ни одной страницей" });
      continue;
    }
    if (file.startsWith("scripts/")) {
      // Скрипт живой, если он в npm test или в других скриптах package.json.
      const pkg = read(path.join(repoRoot, "package.json"));
      if (pkg.includes(base)) continue;
      orphans.push({ file, why: "не запускается ни одним npm-скриптом" });
      continue;
    }
    // Модуль живой, если его кто-то импортирует.
    const importedBy = SOURCES.filter((other) => other !== file
      && new RegExp(`from\\s+["'][^"']*${stem}\\.js["']`).test(textOf(other)));
    if (!importedBy.length) orphans.push({ file, why: "никто не импортирует" });
  }
  return orphans;
}

/* ─── 4. Переростки ──────────────────────────────────────────────────────── */

function oversized() {
  const files = SOURCES
    .map((file) => ({ file, lines: textOf(file).split("\n").length }))
    .filter((entry) => entry.lines > 1500)
    .sort((a, b) => b.lines - a.lines);

  /**
   * Скобки внутри строк, шаблонов и регэкспов — не скобки кода.
   *
   * Без этой чистки счётчик глубины уезжает, и функция на сто строк
   * показывается как четырёхтысячная. Проверено на createMinimap(): отчёт
   * говорил 4341 строку при реальных ста шести. Врущий отчёт хуже,
   * чем отсутствующий, поэтому чистим грубо, но честно.
   */
  const stripNoise = (line) => String(line)
    .replace(/\\./g, "")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/`(?:[^`\\]|\\.)*`/g, "``")
    .replace(/\/(?:[^/\\\n[]|\\.|\[(?:[^\]\\]|\\.)*\])+\/[gimsuy]*/g, "/re/")
    .replace(/\/\/.*$/, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");

  const functions = [];
  for (const file of SOURCES) {
    if (file.startsWith("scripts/")) continue;
    const lines = textOf(file).split("\n").map(stripNoise);
    let start = -1, name = "", depth = 0, started = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (start < 0) {
        const match = line.match(/^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_$]+)/);
        if (match) { start = i; name = match[1]; depth = 0; started = false; }
      }
      if (start >= 0) {
        depth += (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
        if ((line.match(/\{/g) || []).length) started = true;
        if (started && depth <= 0) {
          const length = i - start + 1;
          if (length > 120) functions.push({ file, name, lines: length, at: start + 1 });
          start = -1;
        }
      }
    }
  }
  functions.sort((a, b) => b.lines - a.lines);
  return { files, functions };
}

/* ─── 5. Забытое ─────────────────────────────────────────────────────────── */

function leftovers() {
  const marks = [];
  for (const file of SOURCES) {
    const lines = textOf(file).split("\n");
    lines.forEach((line, index) => {
      if (/\b(TODO|FIXME|XXX|HACK)\b/.test(line)) {
        marks.push({ file, at: index + 1, text: line.trim().slice(0, 100) });
      }
    });
  }
  return marks;
}

/* ─── Отчёт ──────────────────────────────────────────────────────────────── */

const report = {
  endpoints: deadEndpoints(),
  duplicates: duplicatedLogic(),
  patterns: duplicatedPatterns(),
  orphans: orphanFiles(),
  oversized: oversized(),
  leftovers: leftovers(),
};

if (asJson) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

const head = (title) => console.log(`\n\x1b[1m${title}\x1b[0m`);

head(`Ручки API: ${report.endpoints.total}, никто не зовёт — ${report.endpoints.dead.length}`);
report.endpoints.dead.slice(0, TOP).forEach((route) => console.log(`  ${route}`));
if (report.endpoints.dead.length > TOP) console.log(`  … ещё ${report.endpoints.dead.length - TOP}`);

head(`Дословные повторы кода между файлами: ${report.duplicates.length}`);
report.duplicates.slice(0, TOP).forEach((entry) => {
  console.log(`  ${entry.files.length}× ${entry.files.join(", ")}`);
  console.log(`     ${entry.line}`);
});

head(`Регэкспы плейсхолдеров вне общего модуля: ${report.patterns.length}`);
report.patterns.slice(0, TOP).forEach((entry) => {
  console.log(`  ${entry.pattern.slice(0, 70)}  →  ${entry.files.join(", ")}`);
});

head(`Файлы, на которые никто не ссылается: ${report.orphans.length}`);
report.orphans.slice(0, TOP).forEach((entry) => console.log(`  ${entry.file} — ${entry.why}`));

head(`Файлы длиннее 1500 строк: ${report.oversized.files.length}`);
report.oversized.files.forEach((entry) => console.log(`  ${entry.lines.toString().padStart(6)}  ${entry.file}`));

head(`Функции длиннее 120 строк: ${report.oversized.functions.length}`);
report.oversized.functions.slice(0, TOP).forEach((entry) =>
  console.log(`  ${entry.lines.toString().padStart(5)}  ${entry.file}:${entry.at}  ${entry.name}()`));

head(`Забытые TODO / FIXME: ${report.leftovers.length}`);
report.leftovers.slice(0, TOP).forEach((entry) => console.log(`  ${entry.file}:${entry.at}  ${entry.text}`));

console.log("\nЭто факты, а не мнение: ссылка либо есть, либо нет. Что из этого чинить — решаем отдельно.");
