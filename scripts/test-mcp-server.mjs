#!/usr/bin/env node
/**
 * test-mcp-server.mjs — MCP-сервер студии проверяется настоящим MCP-клиентом.
 *
 * Смысл этой обвязки в том, что модель пользователя (его Claude, его подписка)
 * собирает письма инструментами студии, а владелец студии не платит за API.
 * Значит проверять надо не «файл существует», а то, что клиент реально видит
 * инструменты и получает от них рабочий результат.
 *
 * Сценарий: поднимаем студию → подключаем клиент по stdio → каталог → блок со
 * слотами → сборка письма → внятная ошибка на выдуманный блок.
 *
 * Zero-AI: STUDIO_PUBLIC_DEMO=1 выключает все AI-провайдеры и Basic Auth.
 * Exit 0 = pass.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { spawn } from "node:child_process";
import { readFileSync, existsSync, rmSync, mkdirSync, renameSync } from "node:fs";
import path from "node:path";
import url from "node:url";

const repoRoot = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.MCP_TEST_PORT || 3987);
const AGENT_TOKEN = "9".repeat(32);
let pass = 0, fail = 0;
const check = (name, cond, extra = "") => {
  if (cond) { pass++; console.log("  \x1b[32m✓\x1b[0m", name); }
  else { fail++; console.error(`  \x1b[31m✗ ${name}\x1b[0m ${extra}`); }
};

const studio = spawn(process.execPath, ["server.js"], {
  cwd: repoRoot,
  // STUDIO_PUBLIC_DEMO выключает AI и Basic Auth — ради этого он тут и стоит.
  // Но он же включает режим витрины «только чтение», а нам нужно проверить
  // именно запись (черновик → публикация), поэтому запись возвращаем явно.
  env: { ...process.env, PORT: String(PORT), STUDIO_PUBLIC_DEMO: "1", STUDIO_READONLY: "0" },
  stdio: ["ignore", "pipe", "pipe"],
});
const stopStudio = () => { try { studio.kill("SIGTERM"); } catch { /* уже умер */ } };
process.on("exit", stopStudio);

async function waitForStudio(timeoutMs = 40_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/api/blocks-library`);
      if (res.ok) return true;
    } catch { /* ещё поднимается */ }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

const up = await waitForStudio();
if (!up) { console.error("студия не поднялась — проверка невозможна"); stopStudio(); process.exit(1); }

const client = new Client({ name: "retkit-mcp-test", version: "1.0.0" });
await client.connect(new StdioClientTransport({
  command: process.execPath,
  args: [path.join(repoRoot, "mcp", "retkit-mcp-server.mjs")],
  // Метка агента обязательна: по ней студия отличает Клода от человека, и от
  // неё зависит, в чей черновик уходит работа. Без неё каждый запрос выглядел
  // бы новым безымянным человеком, и своих же черновиков агент бы не нашёл.
  env: { ...process.env, STUDIO_URL: `http://127.0.0.1:${PORT}`, RETKIT_TOKEN: AGENT_TOKEN },
}));

const structured = (result) => result.structuredContent || JSON.parse(result.content[0].text);

/**
 * Ошибка инструмента в MCP — это НЕ исключение транспорта: клиент получает
 * обычный результат с isError и текстом. Модель читает именно этот текст,
 * поэтому проверяем его, а не факт падения.
 */
async function toolError(cl, name, args) {
  const result = await cl.callTool({ name, arguments: args });
  if (!result.isError) return "";
  return String(result.content?.[0]?.text || "");
}

/* ─── 1. Клиент видит инструменты ────────────────────────────────────────── */
{
  const { tools } = await client.listTools();
  const names = tools.map((tool) => tool.name).sort();
  check("клиент видит инструменты студии", names.length >= 5, names.join(", "));
  for (const expected of ["retkit_list_blocks", "retkit_get_block", "retkit_compose_preview", "retkit_save_mail"]) {
    check(`есть ${expected}`, names.includes(expected));
  }
  const save = tools.find((tool) => tool.name === "retkit_save_mail");
  check("запись помечена как разрушающая", save?.annotations?.destructiveHint === true);
  const list = tools.find((tool) => tool.name === "retkit_list_blocks");
  check("чтение помечено как безопасное", list?.annotations?.readOnlyHint === true);
}

/* ─── 2. Каталог отдаётся компактно и фильтруется ────────────────────────── */
let firstTitle = null;
{
  const all = structured(await client.callTool({ name: "retkit_list_blocks", arguments: { limit: 5 } }));
  check("каталог не пустой", all.total > 0, String(all.total));
  check("страница ограничена limit", all.blocks.length <= 5, String(all.blocks.length));
  check("в карточке нет тяжёлого pug", !("pug" in (all.blocks[0] || {})), Object.keys(all.blocks[0] || {}).join(","));

  const system = structured(await client.callTool({ name: "retkit_list_blocks", arguments: { kit: "system", limit: 100 } }));
  check("набор system фильтруется", system.blocks.every((block) => block.kits.includes("system")));
  check("в system есть блоки", system.total > 0, String(system.total));

  const titles = structured(await client.callTool({
    name: "retkit_list_blocks", arguments: { kit: "system", placement: "inner", query: "заголовок" },
  }));
  firstTitle = titles.blocks[0]?.id || null;
  check("поиск по названию работает", Boolean(firstTitle), JSON.stringify(titles.blocks.map((b) => b.id)));
}

/* ─── 3. Блок отдаёт слоты, а не догадки ─────────────────────────────────── */
{
  const block = structured(await client.callTool({ name: "retkit_get_block", arguments: { id: "sys-button" } }));
  check("у блока есть слоты", Array.isArray(block.slots) && block.slots.length > 0);
  const width = block.slots.find((slot) => slot.id === "width");
  check("варианты значений видны модели", Array.isArray(width?.options) && width.options.length > 0,
    JSON.stringify(width?.options));

  const message = await toolError(client, "retkit_get_block", { id: "sys-nope" });
  check("выдуманный блок даёт внятную ошибку", /не найден/.test(message), message.slice(0, 140));
  check("и подсказывает, где искать", /Похожие|retkit_list_blocks/.test(message), message.slice(0, 140));
}

/* ─── 4. Письмо реально собирается ───────────────────────────────────────── */
{
  const blocks = [
    { uid: "o1", blockId: "sys-outer", parentUid: null, slotId: "root", slots: { background_color: "#F9F9F9" } },
    { uid: "s1", blockId: "sys-section", parentUid: "o1", slotId: "sections", slots: {} },
    { uid: "b1", blockId: "sys-title", parentUid: "s1", slotId: "content", slots: { text: "Письмо от MCP" } },
    { uid: "b2", blockId: "sys-text", parentUid: "s1", slotId: "content", slots: { text: "Собрано моделью пользователя." } },
    { uid: "b3", blockId: "sys-button", parentUid: "s1", slotId: "content", slots: { label: "Открыть" } },
    { uid: "f1", blockId: "sys-footer", parentUid: "o1", slotId: "sections", slots: {} },
  ];
  const built = structured(await client.callTool({
    name: "retkit_compose_preview", arguments: { blocks, mail_name: "mcp-check" },
  }));
  check("письмо собралось", built.ok === true && built.html_bytes > 3000, String(built.html_bytes));
  check("без HTML ответ остаётся лёгким", !("html" in built));

  const withHtml = structured(await client.callTool({
    name: "retkit_compose_preview", arguments: { blocks, mail_name: "mcp-check", include_html: true },
  }));
  check("по запросу HTML отдаётся", typeof withHtml.html === "string" && withHtml.html.includes("Письмо от MCP"));
}

/* ─── 4b. Агент приходит не вслепую ──────────────────────────────────────── */
{
  // Ради этого всё и затевалось: чужая модель должна понимать студию с
  // первого захода, а не угадывать структуру писем по названиям блоков.
  const guide = (await client.callTool({ name: "retkit_studio_guide", arguments: {} })).content[0].text;
  check("инструкция отдаётся инструментом", guide.length > 400, String(guide.length));
  check("инструкция объясняет дерево письма", /outer/.test(guide) && /section/.test(guide));
  check("инструкция объясняет наборы", /system/.test(guide) && /promo/.test(guide));
  check("инструкция не заглушка", !/Инструкция не найдена/.test(guide), guide.slice(0, 120));

  const tools = (await client.listTools()).tools.map((tool) => tool.name);
  check("инструмент инструкции виден в каталоге", tools.includes("retkit_studio_guide"), tools.join());

  const resources = (await client.listResources()).resources.map((res) => res.uri);
  check("инструкция доступна и ресурсом", resources.includes("retkit://guide"), resources.join());
  const read = await client.readResource({ uri: "retkit://guide" });
  check("ресурс отдаёт тот же текст", read.contents[0].text === guide);

  // Главная проверка «агент в курсе сам»: instructions клиент загружает при
  // подключении, без единого вызова. Пусто здесь — и всё знание о студии
  // держится на том, догадается ли человек попросить инструкцию.
  const instructions = client.getInstructions?.() || "";
  check("сервер представляется при подключении", instructions.length > 200, String(instructions.length));
  check("сразу объясняет структуру письма", /outer/.test(instructions) && /inner/.test(instructions));
  check("сразу запрещает сохранять без подтверждения", /подтверждения/.test(instructions));
  check("сразу называет темы инструкций", /development/.test(instructions) && /locales/.test(instructions));

  const dev = (await client.callTool({
    name: "retkit_studio_guide", arguments: { topic: "development" },
  })).content[0].text;
  check("тема development отдаёт скилл студии", /mail-store\.js/.test(dev), dev.slice(0, 120));
  check("темы не путаются между собой", dev !== guide);
  const unknown = (await client.callTool({
    name: "retkit_studio_guide", arguments: {},
  })).content[0].text;
  check("без темы отдаём сборку писем", unknown === guide);

  const prompts = (await client.listPrompts()).prompts.map((prompt) => prompt.name);
  check("есть готовый промпт сборки письма", prompts.includes("retkit_build_email"), prompts.join());
  const prompt = await client.getPrompt({ name: "retkit_build_email", arguments: { task: "письмо про подтверждение почты" } });
  const promptText = prompt.messages.map((m) => m.content?.text || "").join("\n");
  check("промпт несёт задачу пользователя", promptText.includes("подтверждение почты"), promptText.slice(0, 160));
}

/* ─── 4c. Агент работает в черновике, а не в общей базе ──────────────────── */
{
  // Это и есть ответ на «пусть ИИ работает в базе нормально и без ошибок»:
  // агент правит личную копию, общая база меняется один раз и по просьбе
  // человека, а прежняя версия остаётся в истории.
  const stamp = `${process.pid}-${Date.now().toString(36)}`;
  const mailName = `mcp-draft-${stamp}`;
  const brand = "X_assembled";
  const blocks = [
    { uid: "o1", blockId: "sys-outer", parentUid: null, slotId: "root", slots: { background_color: "#F9F9F9" } },
    { uid: "s1", blockId: "sys-section", parentUid: "o1", slotId: "sections", slots: {} },
    { uid: "b1", blockId: "sys-title", parentUid: "s1", slotId: "content", slots: { text: "Первая версия" } },
    { uid: "f1", blockId: "sys-footer", parentUid: "o1", slotId: "sections", slots: {} },
  ];

  const saved = structured(await client.callTool({
    name: "retkit_save_mail", arguments: { mail_name: mailName, blocks, brand },
  }));
  check("агент создал письмо в базе", saved.ok === true, JSON.stringify(saved));

  const draft = structured(await client.callTool({
    name: "retkit_open_draft", arguments: { brand, mail: `mail-${mailName}` },
  }));
  check("письмо взято в черновик", Boolean(draft.draft) && draft.draft.includes("__draft-"), JSON.stringify(draft));

  const drafts = structured(await client.callTool({ name: "retkit_list_drafts", arguments: {} }));
  check("агент видит свой черновик", drafts.drafts.some((entry) => entry.draft === draft.draft),
    JSON.stringify(drafts).slice(0, 200));

  const draftBlocks = blocks.map((block) => block.uid === "b1"
    ? { ...block, slots: { text: "Вторая версия" } }
    : block);
  const savedDraft = structured(await client.callTool({
    name: "retkit_save_mail",
    arguments: { mail_name: draft.draft.replace(/^mail-/, ""), blocks: draftBlocks, brand, force: true },
  }));
  check("работа сохранена в черновик", savedDraft.ok === true, JSON.stringify(savedDraft).slice(0, 160));

  // Главное: пока черновик не опубликован, база остаётся прежней.
  const baseHtml = readFileSync(
    path.join(repoRoot, "email-base", brand, `mail-${mailName}`, "app", "templates", "blocks", "header.pug"),
    "utf8",
  );
  check("база всё ещё первой версии", baseHtml.includes("Первая версия") && !baseHtml.includes("Вторая версия"),
    baseHtml.slice(0, 120));

  const published = structured(await client.callTool({
    name: "retkit_publish_draft", arguments: { brand, mail: `mail-${mailName}` },
  }));
  check("черновик опубликован по просьбе", published.ok === true, JSON.stringify(published).slice(0, 160));
  const afterHtml = readFileSync(
    path.join(repoRoot, "email-base", brand, `mail-${mailName}`, "app", "templates", "blocks", "header.pug"),
    "utf8",
  );
  check("в базе теперь вторая версия", afterHtml.includes("Вторая версия"), afterHtml.slice(0, 120));

  const history = structured(await client.callTool({
    name: "retkit_mail_history", arguments: { brand, mail: `mail-${mailName}` },
  }));
  check("прежняя версия осталась в истории", history.count >= 1, JSON.stringify(history).slice(0, 200));

  // Уборка: удалять нельзя не везде, поэтому уносим в корзину переименованием.
  for (const folder of [`mail-${mailName}`, draft.draft]) {
    const target = path.join(repoRoot, "email-base", brand, folder);
    if (!existsSync(target)) continue;
    try { rmSync(target, { recursive: true, force: true }); }
    catch {
      try {
        const aside = path.join(repoRoot, "email-base", "_trash", `__mcp-leftover-${Date.now()}-${folder}`);
        mkdirSync(path.dirname(aside), { recursive: true });
        renameSync(target, aside);
      } catch { console.log(`  (осталась папка ${folder} — уберите вручную)`); }
    }
  }
}

/* ─── 5. Студия недоступна — говорим, что делать ─────────────────────────── */
{
  const offline = new Client({ name: "retkit-mcp-offline", version: "1.0.0" });
  await offline.connect(new StdioClientTransport({
    command: process.execPath,
    args: [path.join(repoRoot, "mcp", "retkit-mcp-server.mjs")],
    env: { ...process.env, STUDIO_URL: "http://127.0.0.1:1" },
  }));
  const message = await toolError(offline, "retkit_list_blocks", {});
  check("оффлайн-ошибка подсказывает решение", /npm start/.test(message) && /STUDIO_URL/.test(message),
    message.slice(0, 200));
  await offline.close();
}

await client.close();
stopStudio();
console.log(`\nmcp-server: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
