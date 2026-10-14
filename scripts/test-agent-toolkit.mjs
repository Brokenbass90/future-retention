#!/usr/bin/env node
/**
 * test-agent-toolkit.mjs — один набор инструментов на всех агентов.
 *
 * В студии жили ДВА агента, у которых не было ни одного общего инструмента.
 * Оператор студии правил локали, менял вёрстку и вставлял блоки — но работал
 * вслепую и не знал про черновики. Подключённый Клод видел письмо картинкой и
 * работал в личном черновике — но локали и вёрстку не трогал вовсе.
 *
 * Человек этой границы не видит: он спрашивает в окне студии и ждёт работы.
 * Поэтому набор объявлен один раз (`src/ai-tools.js`), а оба агента берут его
 * оттуда: оператор напрямую, MCP-сервер — через мост `/api/agent/*`.
 *
 * Здесь стережём именно это свойство. Расхождение наборов — самая вероятная
 * поломка: инструмент добавят в одно место и забудут про другое, а заметит это
 * человек, которому агент скажет «не умею» на то, что студия умеет.
 *
 * Zero-AI, без сети. Exit 0 = pass.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import url from "node:url";
import { TOOL_DEFINITIONS, TOOL_HANDLERS } from "../src/ai-tools.js";
import { createRouter } from "../src/router.js";
import { registerAgentRoutes } from "../src/routes/agent-routes.js";

const repoRoot = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const check = (name, cond, extra = "") => {
  if (cond) { pass++; console.log("  \x1b[32m✓\x1b[0m", name); }
  else { fail++; console.error(`  \x1b[31m✗ ${name}\x1b[0m ${extra}`); }
};
const read = (...parts) => readFileSync(path.join(repoRoot, ...parts), "utf8");

/* ─── 1. Объявления и обработчики не расходятся ──────────────────────────── */
{
  const declared = TOOL_DEFINITIONS.map((tool) => tool.name);
  const handlers = Object.keys(TOOL_HANDLERS);
  check("у каждого инструмента есть обработчик",
    declared.every((name) => handlers.includes(name)),
    declared.filter((name) => !handlers.includes(name)).join(", "));
  check("нет обработчиков без объявления",
    handlers.every((name) => declared.includes(name)),
    handlers.filter((name) => !declared.includes(name)).join(", "));
  check("имена не повторяются", new Set(declared).size === declared.length);
  check("у каждого есть описание",
    TOOL_DEFINITIONS.every((tool) => String(tool.description || "").length > 40),
    TOOL_DEFINITIONS.filter((tool) => String(tool.description || "").length <= 40).map((t) => t.name).join(", "));
}

/* ─── 2. Полный цикл письма закрыт инструментами ─────────────────────────── */
{
  // Не «сколько инструментов», а «что агент умеет по работе». Список — это
  // ровно то, что человек делает руками, собирая письмо.
  const have = new Set(TOOL_DEFINITIONS.map((tool) => tool.name));
  const job = {
    "посмотреть на письмо": ["see_email"],
    "посмотреть на блок": ["see_block"],
    "собрать письмо из блоков": ["compose_email_from_blocks"],
    "поправить блок в письме": ["update_canvas_block"],
    "убрать блок с канваса": ["remove_canvas_block"],
    "очистить письмо целиком": ["clear_canvas"],
    "поставить блок на канвас": ["add_canvas_block"],
    "переставить блок": ["move_canvas_block"],
    "найти блок по виду": ["find_blocks_by_look"],
    "создать свой блок": ["save_user_block"],
    "менять вёрстку точечно": ["find_in_html", "replace_in_html"],
    "вставить и убрать блок": ["insert_block", "remove_block"],
    "менять стили рендера": ["list_mail_files", "read_mail_file", "write_mail_file"],
    "расставить плейсхолдеры": ["placeholderize_html"],
    "читать локали": ["list_namespaces", "get_namespace_blocks"],
    "править локали": ["edit_locale_block", "fix_locale_txt"],
    "заводить и удалять локали": ["create_locale", "delete_locale"],
    "переводить": ["translate_locale_txt"],
    "сверять локали": ["compare_locales", "align_locales_to_reference"],
    "проверять вёрстку": ["validate_html", "analyze_email"],
    "проверить, дособрано ли письмо": ["check_canvas_ready"],
    "взять личную копию письма": ["open_draft", "draft_changes"],
    "опубликовать и отказаться": ["publish_draft", "discard_draft"],
    "посмотреть прежние версии": ["mail_history"],
  };
  for (const [what, tools] of Object.entries(job)) {
    check(`умеет: ${what}`, tools.every((name) => have.has(name)),
      tools.filter((name) => !have.has(name)).join(", "));
  }
}

/* ─── 3. Мост наружу отдаёт тот же набор ─────────────────────────────────── */
{
  const router = createRouter({ name: "test" });
  registerAgentRoutes(router, {
    repoRoot, sendJson: () => {}, readRequestBody: async () => ({}),
    isReadOnly: () => false, apiKey: () => "",
  });
  const ids = router.list().map((entry) => entry.id);
  check("список инструментов отдаётся наружу", ids.includes("GET /api/agent/tools"), ids.join(", "));
  check("вызов инструмента отдаётся наружу", ids.includes("POST /api/agent/call"));

  const routes = read("src", "routes", "agent-routes.js");
  // Канвас живёт в браузере: снаружи его не существует, и молчаливая ошибка
  // на середине работы агента — худший способ об этом сообщить.
  check("канвасные инструменты наружу не выпускаются", /BROWSER_ONLY/.test(routes));
  check("и об этом сказано заранее, в списке", /browserOnly: BROWSER_ONLY\.has/.test(routes));
  check("права витрины действуют и на агента", /isReadOnly\(\)/.test(routes));
  check("картинки отдаются вызывающему", /images: \(ctx\.pendingImages/.test(routes));
}

/* ─── 4. MCP-сервер берёт набор у студии, а не переписывает ──────────────── */
{
  const mcp = read("mcp", "retkit-mcp-server.mjs");
  check("MCP спрашивает список у студии", /studioFetch\("\/api\/agent\/tools"\)/.test(mcp));
  check("и зовёт инструменты через мост", /studioFetch\("\/api\/agent\/call"/.test(mcp));
  check("параметры переводятся из JSON Schema в zod", /function zodFromJsonSchema/.test(mcp));
  check("картинка доезжает до агента, а не пересказывается",
    /type: "image", data: base64/.test(mcp));
  // Студия может быть не запущена — это обычное состояние, а не поломка.
  check("без студии MCP остаётся рабочим", /полный набор студии недоступен/.test(mcp));
  check("свои обёртки не дублируются", /ALREADY_WRAPPED/.test(mcp));
}

/* ─── 5. Глаза работают и молчат честно ──────────────────────────────────── */
{
  const vision = read("src", "agent-vision.js");
  // Результат инструмента — текст: изображение туда не положить. Картинка
  // идёт следующим сообщением, и в ответе об этом сказано прямо.
  check("картинка ставится в очередь, а не теряется", /ctx\.pendingImages/.test(vision));
  check("ответ предупреждает, что снимок идёт следом", /идёт следующим сообщением/.test(vision));
  check("нет превью — выдумывать запрещено", /Не описывайте вид по имени/.test(vision));
  check("нет браузера — работать дальше, но не выдумывать",
    /не выдумывайте, как письмо выглядит/.test(vision));
  check("правки этого разговора в снимок не попали — и это сказано",
    /в снимок ещё не попали/.test(vision));

  const agent = read("src", "ai-agent.js");
  check("цикл агента показывает снимки модели", /type: "input_image", image_url: shot\.dataUrl/.test(agent));
  check("и велит смотреть на них, а не на описание", /Смотрите на них, а не на описание/.test(agent));
  check("правило «сначала посмотри» в промпте", /LOOK before you judge/.test(agent));
  check("правило «стили менять в исходнике» в промпте",
    /change its SOURCE: list_mail_files/.test(agent));
}

/* ─── 5б. Черновик — не формальность ─────────────────────────────────────── */
{
  const tools = read("src", "ai-tools.js");
  // Правка, написанная прямо в общую базу, необратима для того, кто её не
  // делал. Поэтому копия — до правки, а не после.
  check("агенту велено брать копию до правки", /Take a PERSONAL COPY of an email before changing it/.test(tools));
  check("после взятия копии работа идёт с ней",
    /Работайте дальше с «\$\{opened\.draft\.mail\}»/.test(tools), "иначе следующий вызов уйдёт мимо копии");
  check("публикация только по слову человека",
    /NEVER call this on your own initiative/.test(tools));
  check("разъехавшуюся базу поверх не пишем",
    /не публикуйте поверх сами/.test(tools));
  check("разницу показываем до публикации",
    /Show this to the person BEFORE asking them to publish/.test(tools));

  const agent = read("src", "ai-agent.js");
  check("правило про копию есть в промпте", /open_draft first/.test(agent));
  check("и объяснено, почему", /cannot be undone/.test(agent));

  const mcp = read("mcp", "retkit-mcp-server.mjs");
  // У MCP свои обёртки черновиков: они ходят от имени агента. Через мост
  // запрос пришёл бы от имени студии, и агент писал бы в чужую копию.
  check("черновики MCP не дублируются мостом", /"open_draft", "list_drafts"/.test(mcp));
  check("и причина записана", /писал бы в чужую копию/.test(mcp));
}

/* ─── 6. Исходники письма: наружу не выйти ───────────────────────────────── */
{
  const files = read("src", "agent-mail-files.js");
  check("за пределы письма не выпускает", /вне письма/.test(files));
  check("dist не правится — только исходник", /это вывод сборки/.test(files));
  check("запись идёт через общую дверь", /assertMailWritable/.test(files));
  check("пустая запись — не правка, а стирание", /это не правка, а стирание файла/.test(files));
  check("после правки нужна пересборка — и это сказано", /нужно пересобрать/.test(files));
}

console.log(`\nagent-toolkit: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
