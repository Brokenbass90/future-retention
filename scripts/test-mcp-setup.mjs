#!/usr/bin/env node
/**
 * test-mcp-setup.mjs — мастер «подключите своего агента».
 *
 * Здесь опасны две вещи, и обе тихие.
 *
 * Первая: кнопка «в один клик» дописывает конфиг Claude Desktop. Если она
 * снесёт чужие MCP-серверы или молча перезапишет повреждённый JSON, человек
 * потеряет свои подключения и не поймёт, из-за чего. Поэтому слияние
 * проверяем построчно, а не «работает же».
 *
 * Вторая: автоустановка допустима, только когда студия и Claude — одна
 * машина. На Heroku сервер физически не может тронуть конфиг пользователя,
 * и обещать там «в один клик» — враньё. Значит isLocalStudioRequest()
 * обязана быть строгой.
 *
 * Плюс проверяем, что мастер вообще подключён к обоим окнам разговора с ИИ:
 * код, который никто не вызывает, — это не фича.
 *
 * Zero-AI, без сети. Ничего не пишет за пределами временной папки. Exit 0 = pass.
 */
import {
  MCP_SERVER_KEY,
  describeConnection,
  SKILL_NAME,
  studioSkillSource,
  userSkillTarget,
  describeStudioSkill,
  installStudioSkill,
  claudeDesktopConfigPath,
  isLocalStudioRequest,
  mcpServerEntry,
  manualConfigSnippet,
  claudeCodeCommand,
  mergeIntoConfig,
  writeClaudeDesktopConfig,
} from "../src/mcp-setup.js";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";

const repoRoot = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const check = (name, cond, extra = "") => {
  if (cond) { pass++; console.log("  \x1b[32m✓\x1b[0m", name); }
  else { fail++; console.error(`  \x1b[31m✗ ${name}\x1b[0m ${extra}`); }
};
const read = (...parts) => readFileSync(path.join(repoRoot, ...parts), "utf8");

const ENTRY = mcpServerEntry({ serverPath: "/srv/retkit/mcp/retkit-mcp-server.mjs", studioUrl: "http://127.0.0.1:3000" });

/* ─── 1. Где лежит конфиг Claude Desktop ─────────────────────────────────── */
{
  const mac = claudeDesktopConfigPath("darwin", "/Users/x");
  check("macOS: Application Support/Claude",
    mac === "/Users/x/Library/Application Support/Claude/claude_desktop_config.json", mac);

  const previousAppData = process.env.APPDATA;
  process.env.APPDATA = "C:\\Users\\x\\AppData\\Roaming";
  const win = claudeDesktopConfigPath("win32", "C:\\Users\\x");
  check("Windows: берём %APPDATA%", win.includes("AppData") && win.endsWith("claude_desktop_config.json"), win);
  delete process.env.APPDATA;
  const winNoEnv = claudeDesktopConfigPath("win32", "C:\\Users\\x");
  check("Windows без %APPDATA%: собираем путь сами", winNoEnv.includes("Roaming"), winNoEnv);
  if (previousAppData === undefined) delete process.env.APPDATA; else process.env.APPDATA = previousAppData;

  const linux = claudeDesktopConfigPath("linux", "/home/x");
  check("Linux: ~/.config/Claude", linux === "/home/x/.config/Claude/claude_desktop_config.json", linux);
}

/* ─── 2. Локальная студия или чужой сервер ───────────────────────────────── */
{
  check("localhost + локальный сокет — своя машина",
    isLocalStudioRequest({ host: "localhost:3000", remoteAddress: "127.0.0.1" }));
  check("127.0.0.1 — своя машина",
    isLocalStudioRequest({ host: "127.0.0.1:3000", remoteAddress: "::ffff:127.0.0.1" }));
  check("Heroku — чужая машина, автоустановки нет",
    !isLocalStudioRequest({ host: "retkit.herokuapp.com", remoteAddress: "10.0.0.4" }));
  // Тонкий случай: студия слушает 0.0.0.0, но зашли к ней по сети с другого
  // компьютера. Host выглядит «локальным» — адрес выдаёт правду.
  check("локальный host при удалённом адресе не считается своим",
    !isLocalStudioRequest({ host: "localhost:3000", remoteAddress: "192.168.1.14" }));
  check("пустой запрос не считается локальным", !isLocalStudioRequest({}));
}

/* ─── 3. Что человек копирует ────────────────────────────────────────────── */
{
  check("ключ сервера — retkit", MCP_SERVER_KEY === "retkit");
  check("в конфиге адрес студии", ENTRY.env.STUDIO_URL === "http://127.0.0.1:3000");
  check("без авторизации логин/пароль не пишем",
    !("STUDIO_USER" in ENTRY.env) && !("STUDIO_PASSWORD" in ENTRY.env), JSON.stringify(ENTRY.env));

  const withAuth = mcpServerEntry({ serverPath: "/x.mjs", studioUrl: "https://s", user: "u", password: "p" });
  check("с авторизацией — пишем оба поля",
    withAuth.env.STUDIO_USER === "u" && withAuth.env.STUDIO_PASSWORD === "p");
  check("половинчатую авторизацию не пишем",
    !("STUDIO_USER" in mcpServerEntry({ serverPath: "/x.mjs", studioUrl: "https://s", user: "u" }).env));

  const snippet = manualConfigSnippet(ENTRY);
  const parsed = JSON.parse(snippet);
  check("сниппет — валидный JSON с mcpServers.retkit", Boolean(parsed.mcpServers?.retkit));
  check("сниппет читаемый, с отступами", snippet.includes("\n  "));

  const command = claudeCodeCommand(ENTRY);
  check("команда для Claude Code начинается с claude mcp add", command.startsWith("claude mcp add retkit"), command);
  check("команда несёт STUDIO_URL", command.includes("STUDIO_URL="), command);
  check("путь к серверу в кавычках", command.includes('"/srv/retkit/mcp/retkit-mcp-server.mjs"'), command);
}

/* ─── 4. Слияние конфига: чужое не трогаем ───────────────────────────────── */
{
  const foreign = JSON.stringify({
    mcpServers: { filesystem: { command: "npx", args: ["-y", "@mcp/fs"] } },
    globalShortcut: "Alt+Space",
  });
  const merged = mergeIntoConfig(foreign, ENTRY);
  check("чужой MCP-сервер остался на месте", Boolean(merged.config.mcpServers.filesystem));
  check("чужие ключи верхнего уровня остались", merged.config.globalShortcut === "Alt+Space");
  check("наш сервер добавлен", merged.config.mcpServers.retkit.command === "node");
  check("это добавление, а не замена", merged.replaced === false);
  check("отчёт перечисляет чужие серверы", merged.otherServers.join() === "filesystem", JSON.stringify(merged.otherServers));

  const again = mergeIntoConfig(JSON.stringify(merged.config), ENTRY);
  check("повторное подключение — замена, а не дубль", again.replaced === true);
  check("повторное подключение не плодит ключи",
    Object.keys(again.config.mcpServers).sort().join() === "filesystem,retkit");

  const empty = mergeIntoConfig("", ENTRY);
  check("пустой конфиг — создаём с нуля", Object.keys(empty.config.mcpServers).join() === "retkit");
  check("у пустого конфига нечего замещать", empty.replaced === false && empty.otherServers.length === 0);

  const noServers = mergeIntoConfig(JSON.stringify({ theme: "dark" }), ENTRY);
  check("конфиг без mcpServers не ломается", noServers.config.theme === "dark" && Boolean(noServers.config.mcpServers.retkit));

  let broke = "";
  try { mergeIntoConfig("{ это не json", ENTRY); } catch (error) { broke = error.message; }
  check("повреждённый JSON не перезаписываем молча", broke.includes("повреждён"), broke);

  let notObject = "";
  try { mergeIntoConfig("[1,2,3]", ENTRY); } catch (error) { notObject = error.message; }
  check("массив вместо объекта — тоже отказ", notObject.includes("повреждён"), notObject);
}

/* ─── 5. Запись на диск (во временной папке) ─────────────────────────────── */
{
  const dir = mkdtempSync(path.join(os.tmpdir(), "retkit-mcp-setup-"));
  try {
    // 5.1 Конфига ещё нет — пишем с нуля, бэкап не выдумываем.
    const fresh = path.join(dir, "nested", "claude_desktop_config.json");
    const first = writeClaudeDesktopConfig({ configPath: fresh, entry: ENTRY });
    check("папку под конфиг создаём сами", existsSync(fresh));
    check("нового конфига нечем резервировать", first.backupPath === "");
    check("записан валидный JSON", Boolean(JSON.parse(readFileSync(fresh, "utf8")).mcpServers.retkit));

    // 5.2 Конфиг был — старое содержимое обязано уцелеть в резервной копии.
    const owned = path.join(dir, "claude_desktop_config.json");
    writeFileSync(owned, JSON.stringify({ mcpServers: { github: { command: "gh-mcp" } } }, null, 2));
    const second = writeClaudeDesktopConfig({ configPath: owned, entry: ENTRY });
    const after = JSON.parse(readFileSync(owned, "utf8"));
    check("чужой сервер пережил запись", after.mcpServers.github.command === "gh-mcp");
    check("наш сервер записан", after.mcpServers.retkit.args[0].endsWith("retkit-mcp-server.mjs"));
    check("резервная копия рядом", second.backupPath.endsWith(".retkit-backup") && existsSync(second.backupPath));
    check("в резервной копии — прежний конфиг",
      !JSON.parse(readFileSync(second.backupPath, "utf8")).mcpServers.retkit);
    check("отчёт называет чужие серверы", second.otherServers.join() === "github");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/* ─── 6. Сервер отдаёт мастеру то, что тот ждёт ──────────────────────────── */
{
  // Ручки подключения уехали из лестницы server.js в свой модуль — смотрим
  // туда, где они теперь живут.
  const server = read("src", "routes", "mcp-routes.js");
  check("есть GET /api/mcp/setup", /router\.get\("\/api\/mcp\/setup"/.test(server));
  check("есть POST /api/mcp\/install", /router\.post\("\/api\/mcp\/install"/.test(server));
  check("автоустановка только для локальной студии",
    /\/api\/mcp\/install"[\s\S]{0,700}if \(!isLocal\(request\)\) \{\s*\n\s*throw new Error\(/.test(server));
  check("canInstall учитывает наличие файла сервера", /canInstall: local && existsSync\(serverPath\)/.test(server));
  check("ошибка установки уходит человеку текстом", /\{ ok: false, error: error\.message \}/.test(server));
}

/* ─── 7. Мастер подключён к обоим окнам разговора с ИИ ───────────────────── */
{
  const wizard = read("public", "mcp-connect.js");
  check("мастер публикует API", /window\.RetkitMcpConnect = \{ render/.test(wizard));
  check("мастер честен про удалённую студию", /setup\.canInstall\s*\n?\s*\?/.test(wizard));
  check("есть копирование конфига", /data-copy/.test(wizard));

  // Конструктор больше ничего не предлагает сам: в шапке висит состояние, и
  // этого достаточно. Предложение, которое всплывало при знакомстве, уехало —
  // оно перекрывало первый же ответ оператора и приходило не тем, кому надо.
  const chat = read("public", "studio-chat.js");
  check("состояние подключения видно с первого открытия", /this\.refreshAgentState\(\)/.test(chat));
  check("мастер больше не всплывает при знакомстве", !/hello\(\)[\s\S]{0,400}offerAgent/.test(chat));
  check("состояние показывается независимо от своей модели",
    !/openAiConfigured/.test(chat));
  check("мастер зовётся словами в разговоре", /showAgentWizard\(\);\s*\n\s*return;/.test(chat));

  const wb = read("public", "workbench.js");
  check("воркбенч тоже умеет предлагать", /async function offerAgentIfNeeded\(/.test(wb));
  check("предложение при открытии ai-drawer", /offerAgentIfNeeded\(\);\s*\}\s*\n\}/.test(wb));
  check("предложение в настройках AI", /getElementById\('aiSettingsConnect'\)/.test(wb));

  const wbHtml = read("public", "workbench.html");
  const consHtml = read("public", "constructor.html");
  check("скрипт мастера подключён в конструкторе", consHtml.includes('src="/mcp-connect.js"'));
  check("скрипт мастера подключён в воркбенче", wbHtml.includes('src="/mcp-connect.js"'));
  check("стили мастера подключены в конструкторе", consHtml.includes('href="/mcp-connect.css"'));
  check("стили мастера подключены в воркбенче", wbHtml.includes('href="/mcp-connect.css"'));
  check("в настройках AI есть место под мастер", wbHtml.includes('id="aiSettingsConnect"'));

  // Без стилей мастер — простыня текста, поэтому классы из разметки и из CSS
  // сверяем поимённо: молча разъехаться им нельзя.
  const css = read("public", "mcp-connect.css");
  for (const cls of [
    "mcp-connect", "mcp-connect-head", "mcp-hint", "mcp-step", "mcp-step-no",
    "mcp-primary", "mcp-manual", "mcp-code", "mcp-copy", "mcp-result",
    "mcp-connect-loading", "mcp-connect-error",
  ]) {
    check(`есть стиль .${cls}`, css.includes(`.${cls}`));
  }
  check("состояния результата стилизованы",
    css.includes('.mcp-result[data-state="ok"]') && css.includes('.mcp-result[data-state="err"]'));
  check("пузырь мастера в чате конструктора расстилован", css.includes(".chat-msg.mcp"));
  check("сообщение мастера в воркбенче расстилано", css.includes(".ai-message.ai-mcp-offer"));
}

/* ─── 8. Агент приходит не вслепую ───────────────────────────────────────── */
{
  const mcp = read("mcp", "retkit-mcp-server.mjs");
  check("есть инструмент с инструкцией по студии", /retkit_studio_guide/.test(mcp));
  check("инструкция отдаётся и как ресурс", /retkit:\/\/guide/.test(mcp));
  const guide = read("mcp", "studio-guide.md");
  check("инструкция не пустая", guide.trim().length > 400);
  check("инструкция объясняет наборы promo/system", /system/.test(guide) && /promo/.test(guide));
}

/* ─── 9. Скилл студии ────────────────────────────────────────────────────── */
{
  // Скилл — то, ради чего подключение вообще имеет смысл: без него агент видит
  // плоский список ручек и угадывает правила проекта по названиям файлов.
  // Поэтому проверяем не «файл есть», а что в нём написаны именно те правила,
  // нарушение которых дорого стоит.
  const described = describeStudioSkill(repoRoot);
  check("скилл лежит в студии", described.available, described.source);
  check("скилл раскладывается на файлы", described.files.includes("SKILL.md"), described.files.join());
  check("к скиллу приложены подробности",
    described.files.some((f) => f.startsWith("references/")), described.files.join());

  const skill = read(".claude", "skills", SKILL_NAME, "SKILL.md");
  check("у скилла есть frontmatter с именем", /^---[\s\S]*?name: retkit-studio/.test(skill));
  check("описание говорит, когда его брать", /description:.*(студи|RetKit)/i.test(skill));
  check("скилл запрещает писать в базу мимо двери", /mail-store\.js/.test(skill));
  check("скилл объясняет замки и актёров", /mail-locks\.js/.test(skill) && /actor\.js/.test(skill));
  check("скилл называет ворота проверки", /npm test/.test(skill));
  check("скилл предупреждает про удаление писем", /_trash/.test(skill));

  const arch = read(".claude", "skills", SKILL_NAME, "references", "architecture.md");
  check("подробности описывают порядок обработки запроса", /retkitActor/.test(arch));
  const locales = read(".claude", "skills", SKILL_NAME, "references", "locales.md");
  check("подробности предупреждают про отвязанные локали", /html-overrides/.test(locales));

  // Ставится скилл копированием: символическая ссылка сломалась бы при
  // переносе студии, и человек остался бы со скиллом-призраком.
  const home = mkdtempSync(path.join(os.tmpdir(), "retkit-skill-home-"));
  try {
    const first = installStudioSkill({ repoRoot, home, now: 1 });
    check("скилл поставлен человеку", existsSync(path.join(first.target, "SKILL.md")), first.target);
    check("подробности поехали следом",
      existsSync(path.join(first.target, "references", "architecture.md")));
    check("в первый раз нечего резервировать", first.backupPath === "");
    check("цель — папка скиллов Клода", first.target === userSkillTarget(home), first.target);

    writeFileSync(path.join(first.target, "SKILL.md"), "моя правка");
    const second = installStudioSkill({ repoRoot, home, now: 2 });
    check("повторная установка обновляет", read(".claude", "skills", SKILL_NAME, "SKILL.md")
      === readFileSync(path.join(second.target, "SKILL.md"), "utf8"));
    check("прежняя версия сохранена", second.backupPath && existsSync(second.backupPath), second.backupPath);
    check("в резервной копии — то, что было",
      readFileSync(path.join(second.backupPath, "SKILL.md"), "utf8") === "моя правка");
    check("повторная установка так и называется", second.replaced === true);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }

  const missing = (() => {
    try { installStudioSkill({ repoRoot: os.tmpdir(), home: os.tmpdir() }); return ""; }
    catch (error) { return error.message; }
  })();
  check("без скилла в студии — понятный отказ", /не найден/.test(missing), missing);

  const server = read("src", "routes", "mcp-routes.js");
  check("есть ручка установки скилла", /router\.post\("\/api\/mcp\/install-skill"/.test(server));
  check("скилл ставится только на своей машине",
    /install-skill[\s\S]{0,500}if \(!isLocal\(request\)\)/.test(server));
  check("мастер знает про скилл", /skill: \{/.test(server));

  const wizard = read("public", "mcp-connect.js");
  // Отдельной кнопки скилла больше нет: он ставится вместе с подключением.
  // Шаг остался объяснением — без него человек не понимает, что вообще стоит.
  check("в мастере есть шаг про скилл", /Скилл студии|скилл/i.test(wizard));
  check("кнопки установки скилла больше нет", !/mcpSkillBtn/.test(wizard));
  check("мастер объясняет ручной путь", /\.claude\/skills\/retkit-studio/.test(wizard));
}

/* ─── 9b. Дверь к своему агенту видна всегда ─────────────────────────────── */
{
  // Мастер показывался сам и только когда у студии НЕТ своей модели. У всех,
  // у кого модель настроена (а это рабочий случай), двери к своему Клоду не
  // было вовсе: человек открывал студию и не находил, где подключаться.
  // Теперь на этом месте не приглашение, а состояние: подключён или нет.
  const chat = read("public", "studio-chat.js");
  check("в шапке разговора виден индикатор подключения", /chat-agent-state/.test(chat));
  check("состояние читается у студии, а не помнится в интерфейсе",
    /RetkitMcpConnect\.status\(\)/.test(chat));
  check("мастер открывается по нажатию", /showAgentWizard\(\)/.test(chat));
  check("мастер больше не всплывает сам", !/offerAgentIfNeeded/.test(chat));
  check("подключение можно попросить словами", /wantsSetup\?\.\(text\)/.test(chat));
  check("индикатор не зависит от наличия своей модели",
    !/refreshAgentState[\s\S]{0,200}openAiConfigured/.test(chat));

  const wb = read("public", "workbench.js");
  check("в воркбенче есть кнопка подключения", /aiAgentBtn/.test(wb));
  check("она открывает мастер принудительно", /offerAgentIfNeeded\(box\)/.test(wb));
  check("в настройках AI мастер тоже есть", /getElementById\('aiSettingsConnect'\)/.test(wb));

  const wbHtml = read("public", "workbench.html");
  check("кнопка есть в разметке воркбенча", wbHtml.includes('id="aiAgentBtn"'));

  // И вторая половина жалобы: разговор в конструкторе жил кнопкой в левом
  // рейле среди фильтров каталога — её принимали за фильтр и не нажимали.
  const consHtml = read("public", "constructor.html");
  check("кнопки разговора в рейле больше нет", !consHtml.includes('id="openChatBtn"'));
  check("вместо неё круглая кнопка внизу справа", consHtml.includes('id="chatFab"'));
  check("у круглой кнопки есть подпись для доступности", /chatFab[\s\S]{0,200}aria-label/.test(consHtml));

  const cons = read("public", "constructor.js");
  check("круглая кнопка открывает разговор", /\$\("chatFab"\)[\s\S]{0,200}toggle\(\)/.test(cons));
  check("старого обработчика не осталось", !/openChatBtn/.test(cons));

  const css = read("public", "constructor.css");
  check("круглая кнопка расстилована", css.includes(".chat-fab"));
  check("она стоит внизу справа", /\.chat-fab \{[\s\S]{0,220}bottom:/.test(css));
  // Окно шире области сборки на ширину инспектора: «внизу справа окна» — это
  // поверх свойств блока. Кнопка обязана держаться за угол колонки сборки.
  check("кнопка держится за угол области сборки", /placeChatFab/.test(cons) && /canvas-pane/.test(cons));
  check("положение пересчитывается при изменении окна", /resize", placeChatFab/.test(cons));
  check("окно разговора перетаскивается", /makeDraggable/.test(chat));
  // Растянуть окно можно было и раньше, но размер не переживал закрытие —
  // человек тянул его заново на каждом разговоре.
  check("окно разговора тянется за угол", css.includes("resize: both"));
  check("размер ограничен экраном", /max-width: calc\(100vw/.test(css) && /max-height: calc\(100vh/.test(css));
  check("размер запоминается", /saveBox/.test(chat) && /width: Math\.round/.test(chat));
  check("сохранённый размер не больше экрана", /Math\.min\(saved\.width, window\.innerWidth/.test(chat));
  check("угол растягивания не накрывает кнопку отправки",
    /\.chat-panel \.chat-form \{ padding-bottom/.test(css));
}

/* ─── 9c. Состояние подключения читается с диска ─────────────────────────── */
{
  // «Подключено» было состоянием кнопки: нажал — надпись сменилась. Второе
  // окно студии (или просто F5) снова предлагало подключиться к тому, что уже
  // стоит, и человек делал это по второму разу, не понимая, сработало ли.
  const home = mkdtempSync(path.join(os.tmpdir(), "retkit-conn-"));
  try {
    const serverPath = path.join(repoRoot, "mcp", "retkit-mcp-server.mjs");
    const clean = describeConnection({ repoRoot, home, serverPath });
    check("на чистой машине не подключено", clean.connected === false && clean.skillInstalled === false);
    check("но путь к конфигу известен", clean.configPath.endsWith("claude_desktop_config.json"));

    writeClaudeDesktopConfig({
      configPath: claudeDesktopConfigPath(process.platform, home),
      entry: mcpServerEntry({ serverPath, studioUrl: "http://127.0.0.1:3000", token: "a".repeat(32) }),
    });
    const after = describeConnection({ repoRoot, home, serverPath });
    check("после подключения видно, что подключено", after.connected === true);
    check("и что путь ведёт в эту студию", after.pathMatches === true, after.configuredServerPath);
    check("видно адрес студии", after.configuredStudioUrl === "http://127.0.0.1:3000");
    check("видно, что у агента есть метка", after.hasToken === true);

    // Студию перенесли или запустили из другой копии — Клод ходит не сюда, и
    // это надо показать, а не молча рисовать «подключено».
    const moved = describeConnection({ repoRoot, home, serverPath: "/другая/копия/mcp/retkit-mcp-server.mjs" });
    check("подключение к другой копии видно", moved.connected === true && moved.pathMatches === false);

    installStudioSkill({ repoRoot, home });
    check("установленный скилл виден", describeConnection({ repoRoot, home, serverPath }).skillInstalled === true);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }

  const wizard = read("public", "mcp-connect.js");
  check("мастер показывает «уже подключено»", /Уже подключено/.test(wizard));
  check("мастер предупреждает о чужой копии", /ходит не сюда/.test(wizard));
  check("мастер показывает, что скилл уже стоит", /Скилл стоит/.test(wizard));
  check("после установки состояние перечитывается", /_setup = null/.test(wizard));

  // И то, из-за чего вся путаница: человек написал в окно студии и ждал ответа
  // от своего Клода, а отвечал оператор студии.
  check("мастер говорит, где разговаривать с агентом", /в его окне, а не здесь/.test(wizard));
  check("и прямо называет, кто отвечает здесь", /отвечает оператор\s*\n?\s*студии/.test(wizard));

  const server = read("src", "routes", "mcp-routes.js");
  check("сервер отдаёт состояние подключения", /connection: local \? describeConnection/.test(server));
}

/* ─── 10. Агент узнаёт о студии без единого вызова ───────────────────────── */
{
  // instructions клиент загружает сам при подключении. Это единственное место,
  // которое модель видит до первого вызова, — если там пусто, «подхватывает
  // сам» превращается в «человек должен догадаться спросить».
  const mcp = read("mcp", "retkit-mcp-server.mjs");
  check("сервер отдаёт instructions при подключении", /instructions: SERVER_INSTRUCTIONS/.test(mcp));
  check("instructions объясняют структуру письма", /outer[\s\S]{0,200}section[\s\S]{0,200}inner/.test(mcp));
  check("instructions запрещают сохранять без подтверждения",
    /не сохранять письмо без подтверждения/.test(mcp));
  check("instructions предупреждают про занятое письмо", /занятым/.test(mcp));
  check("instructions перечисляют темы", /development[\s\S]{0,80}architecture/.test(mcp));
  check("инструкция разбита по темам", /GUIDE_TOPICS/.test(mcp));
  check("темы читаются из скилла, а не дублируются", /SKILL_DIR/.test(mcp));
  check("темы отдаются и ресурсами", /retkit:\/\/guide\/\$\{topic\}|retkit:\/\/guide\//.test(mcp));
}

console.log(`\nmcp-setup: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
