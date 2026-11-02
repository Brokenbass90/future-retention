/**
 * src/source-reader.js — чтение исходников самой студии.
 *
 * Claude Code, открытый в папке студии, читает код своими средствами — ему
 * это не нужно. А Claude Desktop через MCP кода не видит вовсе: он может
 * собрать письмо, но на вопрос «почему превью пустое» ответить нечем, потому
 * что исходников перед ним нет.
 *
 * Отсюда правила, и они узкие нарочно:
 *   • читаем только из разрешённых папок студии — в домашнюю папку человека,
 *     в его почту, в ключи и в node_modules ходить незачем и опасно;
 *   • только чтение. Правки кода идут через Claude Code в папке студии, где
 *     есть git, откат и глаза человека;
 *   • .env и всё похожее на секреты не отдаём даже из разрешённой папки —
 *     это ровно тот файл, который пришлют по ошибке.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import path from "node:path";

/** Что считается кодом студии. Всё остальное — не наше дело. */
export const SOURCE_ROOTS = [
  "src", "scripts", "public", "mcp", "tools", "docs",
  "email-base/tools", "figma-plugin", ".claude/skills",
];

/** Одиночные файлы в корне, которые тоже относятся к студии. */
export const SOURCE_FILES = ["server.js", "package.json", "README.md", "ROADMAP.md"];

const TEXT_EXTENSIONS = new Set([
  ".js", ".mjs", ".cjs", ".json", ".md", ".css", ".html", ".pug", ".jade", ".styl", ".txt", ".yml", ".yaml",
]);

/** Файлы, которые не отдаём никогда: там живут ключи и чужие данные. */
const SECRET_RE = /(^|\/)(\.env|\.env\..*|.*\.pem|.*\.key|.*credentials.*|.*secret.*)$/i;

export class SourceAccessError extends Error {
  constructor(message) {
    super(message);
    this.name = "SourceAccessError";
  }
}

/**
 * Превратить путь из запроса в путь на диске — или отказать.
 *
 * Проверка идёт по разрешённым корням, а не по «нет ли тут ..»: строковая
 * проверка обходится символической ссылкой и кодированием, а сравнение
 * готового абсолютного пути с корнем — нет.
 */
export function resolveSourcePath(repoRoot, requested) {
  // Срезаем только «./» и ведущие слэши. Резать все точки подряд нельзя:
  // так путь .claude/skills превращался в claude/skills и переставал
  // находиться — а это единственное место, где лежит скилл студии.
  const rel = String(requested || "").trim()
    .replace(/^(?:\.\/)+/, "")
    .replace(/^\/+/, "");
  if (!rel) throw new SourceAccessError("Не указан путь к файлу.");
  if (rel.includes("\0")) throw new SourceAccessError("Недопустимый путь.");
  if (SECRET_RE.test(rel)) {
    throw new SourceAccessError(`Файл "${rel}" не отдаётся: похоже на ключи или чужие данные.`);
  }

  const abs = path.resolve(repoRoot, rel);
  const root = path.resolve(repoRoot);
  const insideAllowed = SOURCE_FILES.includes(path.relative(root, abs))
    || SOURCE_ROOTS.some((allowed) => {
      const base = path.resolve(root, allowed);
      return abs === base || abs.startsWith(base + path.sep);
    });
  if (!insideAllowed) {
    throw new SourceAccessError(
      `Путь "${rel}" вне кода студии. Читать можно: ${SOURCE_ROOTS.join(", ")} ` +
      `и файлы ${SOURCE_FILES.join(", ")}.`
    );
  }
  if (abs.split(path.sep).includes("node_modules")) {
    throw new SourceAccessError("node_modules не читаем: это чужой код, а не студия.");
  }
  return abs;
}

/**
 * Прочитать файл студии.
 *
 * Большие файлы (server.js — двадцать тысяч строк) отдаём окном: целиком их
 * всё равно никто не прочитает, а обрезанный без предупреждения файл хуже
 * отказа — по нему делают неверные выводы.
 */
export function readSource(repoRoot, { file, from = 1, lines = 400 } = {}) {
  const abs = resolveSourcePath(repoRoot, file);
  if (!existsSync(abs) || !statSync(abs).isFile()) {
    throw new SourceAccessError(`Файл "${file}" не найден.`);
  }
  const ext = path.extname(abs).toLowerCase();
  if (ext && !TEXT_EXTENSIONS.has(ext)) {
    throw new SourceAccessError(`Файл "${file}" не текстовый (${ext}) — читать нечего.`);
  }
  const all = readFileSync(abs, "utf8").split("\n");
  const start = Math.max(1, Number(from) || 1);
  const count = Math.max(1, Math.min(Number(lines) || 400, 1200));
  const slice = all.slice(start - 1, start - 1 + count);
  return {
    file: path.relative(path.resolve(repoRoot), abs),
    totalLines: all.length,
    from: start,
    to: Math.min(all.length, start + slice.length - 1),
    truncated: start + slice.length - 1 < all.length,
    text: slice.map((line, index) => `${start + index}\t${line}`).join("\n"),
  };
}

/**
 * Найти в коде студии строку или выражение.
 *
 * Без поиска чтение бесполезно: чтобы прочитать нужное место, надо сначала
 * узнать, в каком из четырёхсот файлов оно живёт.
 */
export function searchSource(repoRoot, { query, glob = "", limit = 60 } = {}) {
  const needle = String(query || "").trim();
  if (!needle) throw new SourceAccessError("Пустой запрос поиска.");
  let pattern;
  try {
    pattern = new RegExp(needle, "gi");
  } catch (error) {
    throw new SourceAccessError(`Неверное выражение поиска: ${error.message}`);
  }
  const filter = String(glob || "").trim().toLowerCase();
  const root = path.resolve(repoRoot);
  const cap = Math.max(1, Math.min(Number(limit) || 60, 200));
  const hits = [];

  const walk = (dir, depth = 0) => {
    if (hits.length >= cap || depth > 6) return;
    let entries = [];
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (hits.length >= cap) return;
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(abs, depth + 1); continue; }
      const rel = path.relative(root, abs);
      if (SECRET_RE.test(rel)) continue;
      if (!TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
      if (filter && !rel.toLowerCase().includes(filter)) continue;
      let text = "";
      try { text = readFileSync(abs, "utf8"); } catch { continue; }
      const lines = text.split("\n");
      for (let index = 0; index < lines.length && hits.length < cap; index++) {
        pattern.lastIndex = 0;
        if (!pattern.test(lines[index])) continue;
        hits.push({ file: rel, line: index + 1, text: lines[index].trim().slice(0, 300) });
      }
    }
  };

  for (const allowed of SOURCE_ROOTS) {
    const base = path.resolve(root, allowed);
    if (existsSync(base)) walk(base);
  }
  for (const file of SOURCE_FILES) {
    if (hits.length >= cap) break;
    const abs = path.resolve(root, file);
    if (!existsSync(abs)) continue;
    if (filter && !file.toLowerCase().includes(filter)) continue;
    const lines = readFileSync(abs, "utf8").split("\n");
    for (let index = 0; index < lines.length && hits.length < cap; index++) {
      pattern.lastIndex = 0;
      if (!pattern.test(lines[index])) continue;
      hits.push({ file, line: index + 1, text: lines[index].trim().slice(0, 300) });
    }
  }
  return { query: needle, count: hits.length, capped: hits.length >= cap, hits };
}

/** Что вообще есть в этой папке студии. */
export function listSource(repoRoot, { dir = "src" } = {}) {
  const abs = resolveSourcePath(repoRoot, dir);
  if (!existsSync(abs) || !statSync(abs).isDirectory()) {
    throw new SourceAccessError(`Папка "${dir}" не найдена.`);
  }
  const entries = readdirSync(abs, { withFileTypes: true })
    .filter((entry) => entry.name !== "node_modules" && !entry.name.startsWith("."))
    .map((entry) => {
      const child = path.join(abs, entry.name);
      return {
        name: entry.name,
        kind: entry.isDirectory() ? "dir" : "file",
        lines: entry.isDirectory() || !TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())
          ? null
          : (() => { try { return readFileSync(child, "utf8").split("\n").length; } catch { return null; } })(),
      };
    })
    .sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "dir" ? -1 : 1));
  return { dir: path.relative(path.resolve(repoRoot), abs) || ".", entries };
}
