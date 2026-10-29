/**
 * src/mcp-setup.js — подключение своего агента к студии за одно нажатие.
 *
 * Пользователь приносит своего Клода (или другой MCP-клиент), студия отдаёт ему
 * инструменты. Ручная правка JSON-конфига — ровно то место, где человек
 * бросает затею, поэтому студия готовит конфиг сама, а где может — и
 * прописывает его.
 *
 * Что можно и чего нельзя, честно:
 *   • Студия запущена локально → сервер работает на той же машине, что и
 *     Claude Desktop, значит может дописать конфиг сам.
 *   • Студия на Heroku → её сервер к машине пользователя доступа не имеет.
 *     Остаётся показать готовый JSON и команду для копирования.
 * Различает эти случаи isLocalStudioRequest(), а не догадки в интерфейсе.
 *
 * Функции чистые там, где это возможно, — их проверяет scripts/test-mcp-setup.mjs.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, cpSync, readdirSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import os from "node:os";

export const MCP_SERVER_KEY = "retkit";

/** Путь к конфигу Claude Desktop для текущей ОС. */
export function claudeDesktopConfigPath(platform = process.platform, home = os.homedir()) {
  if (platform === "darwin") {
    return path.join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json");
  }
  if (platform === "win32") {
    const appData = process.env.APPDATA || path.join(home, "AppData", "Roaming");
    return path.join(appData, "Claude", "claude_desktop_config.json");
  }
  return path.join(home, ".config", "Claude", "claude_desktop_config.json");
}

/**
 * Локальная ли студия с точки зрения этого запроса.
 *
 * Автоустановка допустима, только если браузер и сервер студии — одна машина.
 * Иначе мы бы правили конфиг на сервере, а человек ждал бы результата у себя.
 */
export function isLocalStudioRequest({ host = "", remoteAddress = "" } = {}) {
  const hostname = String(host).split(":")[0].toLowerCase();
  const localHostnames = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0", "[::1]"]);
  const address = String(remoteAddress).replace(/^::ffff:/, "");
  const localAddress = address === "127.0.0.1" || address === "::1" || address === "";
  return localHostnames.has(hostname) && localAddress;
}

/** Блок конфигурации MCP-сервера студии. */
/**
 * Каким node запускать MCP-сервер из Claude Desktop.
 *
 * Claude Desktop, открытый из Dock, не видит PATH терминала: ни nvm, ни
 * /usr/local/bin там нет, и голое "node" падает с spawn node ENOENT.
 * Поэтому прописываем абсолютный путь к тому node, которым запущена студия.
 */
export function resolveNodeCommand(execPath = process.execPath) {
  return execPath && path.isAbsolute(execPath) && existsSync(execPath) ? execPath : "node";
}

export function mcpServerEntry({ serverPath, studioUrl, user = "", password = "", token = "", command = resolveNodeCommand() }) {
  const env = { STUDIO_URL: studioUrl };
  // Метка агента нужна студии, чтобы отличать его от человека: на этом стоят
  // замки на письма и адресация черновиков. Она не секрет и ничего не
  // открывает сама по себе — это имя, а не ключ.
  if (/^[0-9a-f]{32}$/.test(String(token))) env.RETKIT_TOKEN = String(token);
  if (user && password) {
    env.STUDIO_USER = user;
    env.STUDIO_PASSWORD = password;
  }
  return { command, args: [serverPath], env };
}

/** Готовый JSON для ручной вставки — ровно то, что человек копирует. */
export function manualConfigSnippet(entry) {
  return JSON.stringify({ mcpServers: { [MCP_SERVER_KEY]: entry } }, null, 2);
}

/** Однострочная команда для Claude Code. */
export function claudeCodeCommand(entry) {
  const envArgs = Object.entries(entry.env || {})
    .map(([key, value]) => `--env ${key}=${JSON.stringify(value)}`)
    .join(" ");
  return `claude mcp add ${MCP_SERVER_KEY} ${envArgs} -- node ${JSON.stringify(entry.args[0])}`.replace(/\s+/g, " ");
}

/**
 * Слить наш блок в существующий конфиг, ничего чужого не потеряв.
 *
 * У человека там уже могут быть другие MCP-серверы, и затереть их — худшее,
 * что можно сделать «кнопкой в один клик». Поэтому читаем, дописываем один
 * ключ и возвращаем результат; повреждённый JSON не перезаписываем молча.
 */
export function mergeIntoConfig(existingRaw, entry) {
  let config = {};
  const raw = String(existingRaw || "").trim();
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) config = parsed;
      else throw new Error("не объект");
    } catch {
      throw new Error(
        "Конфиг Claude Desktop повреждён и не разобран как JSON. " +
        "Исправьте его вручную или скопируйте блок из окна подключения."
      );
    }
  }
  const servers = config.mcpServers && typeof config.mcpServers === "object" ? config.mcpServers : {};
  const replaced = Object.prototype.hasOwnProperty.call(servers, MCP_SERVER_KEY);
  const next = { ...config, mcpServers: { ...servers, [MCP_SERVER_KEY]: entry } };
  return { config: next, replaced, otherServers: Object.keys(servers).filter((key) => key !== MCP_SERVER_KEY) };
}

/** Записать конфиг, сохранив резервную копию прежнего. */
export function writeClaudeDesktopConfig({ configPath, entry }) {
  const existing = existsSync(configPath) ? readFileSync(configPath, "utf8") : "";
  const { config, replaced, otherServers } = mergeIntoConfig(existing, entry);
  mkdirSync(path.dirname(configPath), { recursive: true });
  let backupPath = "";
  if (existing.trim()) {
    backupPath = `${configPath}.retkit-backup`;
    copyFileSync(configPath, backupPath);
  }
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return { configPath, backupPath, replaced, otherServers };
}

/* ─── Скилл студии ────────────────────────────────────────────────────────── */

/**
 * Скилл — это то, что превращает подключённого Клода из «дёргателя ручек» в
 * человека, понимающего студию: правила проекта, устройство, форматы блоков и
 * локалей. Он лежит в самой студии (`.claude/skills/retkit-studio/`), поэтому
 * обновляется вместе с ней и не расходится с кодом.
 *
 * Два пути, и оба нужны:
 *   • Claude Code, открытый В папке студии, подхватывает скилл сам — там
 *     ничего делать не надо;
 *   • Клод, работающий из другой папки (или Claude Desktop), скилла не видит —
 *     для него копируем папку скилла в ~/.claude/skills/.
 *
 * Копируем, а не символическую ссылку: ссылка сломается, если студию
 * перенесут, и человек получит скилл-призрак, о котором никто не вспомнит.
 */
export const SKILL_NAME = "retkit-studio";

/** Где скилл живёт в самой студии. */
export function studioSkillSource(repoRoot) {
  return path.join(repoRoot, ".claude", "skills", SKILL_NAME);
}

/** Куда его ставить, чтобы видел любой Клод этого человека. */
export function userSkillTarget(home = os.homedir()) {
  return path.join(home, ".claude", "skills", SKILL_NAME);
}

/** Есть ли скилл в студии и из чего он состоит. */
export function describeStudioSkill(repoRoot) {
  const source = studioSkillSource(repoRoot);
  const manifest = path.join(source, "SKILL.md");
  if (!existsSync(manifest)) return { available: false, source, files: [] };
  return { available: true, source, files: listSkillFiles(source) };
}

function listSkillFiles(dir, prefix = "") {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...listSkillFiles(path.join(dir, entry.name), relative));
    else if (entry.isFile()) out.push(relative);
  }
  return out.sort();
}

/**
 * Поставить скилл человеку.
 *
 * Прежнюю версию сохраняем рядом: если мы что-то испортим обновлением, человек
 * не должен остаться без того, что у него работало.
 */
export function installStudioSkill({ repoRoot, home = os.homedir(), now = Date.now() } = {}) {
  const described = describeStudioSkill(repoRoot);
  if (!described.available) {
    throw new Error(`Скилл студии не найден: ожидалась папка ${described.source}`);
  }
  const target = userSkillTarget(home);
  let backupPath = "";
  if (existsSync(target)) {
    backupPath = `${target}.retkit-backup-${now}`;
    cpSync(target, backupPath, { recursive: true });
  }
  mkdirSync(path.dirname(target), { recursive: true });
  cpSync(described.source, target, { recursive: true, force: true });
  return { target, backupPath, files: described.files, replaced: Boolean(backupPath) };
}

/* ─── Метка агента ────────────────────────────────────────────────────────── */

/**
 * Постоянная метка для агентов этой студии.
 *
 * Метка должна пережить перезапуск: к ней привязаны черновики агента. Если бы
 * она менялась, каждый новый сеанс Клода начинал бы с чистого листа и не
 * находил собственную вчерашнюю работу.
 *
 * Это имя, а не ключ: само по себе оно ничего не открывает — студия локальная,
 * и доступ к ней определяется тем, что человек её запустил.
 */
export function ensureAgentToken(repoRoot) {
  const file = path.join(repoRoot, ".retkit", "agent-token");
  if (existsSync(file)) {
    const stored = readFileSync(file, "utf8").trim();
    if (/^[0-9a-f]{32}$/.test(stored)) return stored;
  }
  const token = randomBytes(16).toString("hex");
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${token}\n`, "utf8");
  return token;
}

/* ─── Что уже подключено ──────────────────────────────────────────────────── */

/**
 * Состояние подключения, каким его видит диск, а не интерфейс.
 *
 * Раньше «Подключено» было состоянием кнопки: нажал — надпись сменилась.
 * Открыл студию во втором окне (или просто обновил страницу) — и мастер снова
 * предлагал подключиться, хотя всё уже стояло. Человек делал это по второму
 * разу и не понимал, сработало ли вообще.
 *
 * Поэтому спрашиваем диск: есть ли наш блок в конфиге Claude Desktop и лежит
 * ли скилл в папке скиллов. Тогда любое окно студии показывает одно и то же.
 */
export function describeConnection({ repoRoot, home = os.homedir(), serverPath = "" } = {}) {
  const configPath = claudeDesktopConfigPath(process.platform, home);
  let configEntry = null;
  try {
    const raw = readFileSync(configPath, "utf8");
    const parsed = JSON.parse(raw);
    const entry = parsed?.mcpServers?.[MCP_SERVER_KEY];
    if (entry && typeof entry === "object") configEntry = entry;
  } catch { /* нет конфига или он повреждён — считаем, что не подключено */ }

  const skillManifest = path.join(userSkillTarget(home), "SKILL.md");
  const expected = serverPath || (repoRoot ? path.join(repoRoot, "mcp", "retkit-mcp-server.mjs") : "");
  const actual = Array.isArray(configEntry?.args) ? String(configEntry.args[0] || "") : "";

  return {
    configPath,
    connected: Boolean(configEntry),
    // Студию могли перенести или запустить из другой папки — тогда в конфиге
    // остался путь к прежней копии, и Клод ходит не туда.
    pathMatches: Boolean(configEntry) && Boolean(expected) && actual === expected,
    configuredServerPath: actual,
    configuredStudioUrl: String(configEntry?.env?.STUDIO_URL || ""),
    hasToken: Boolean(configEntry?.env?.RETKIT_TOKEN),
    configuredCommand: String(configEntry?.command || ""),
    // Node по прописанному пути могли удалить (nvm uninstall, обновление) —
    // тогда Claude молча не видит студию. Голое "node" проверить нельзя.
    commandMissing: Boolean(configEntry) && path.isAbsolute(String(configEntry?.command || "")) &&
      !existsSync(String(configEntry.command)),
    skillInstalled: existsSync(skillManifest),
    skillPath: userSkillTarget(home),
  };
}
