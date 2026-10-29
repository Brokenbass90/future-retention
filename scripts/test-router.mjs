#!/usr/bin/env node
/**
 * test-router.mjs — маршрутизатор и храповик на лестницу `if` в server.js.
 *
 * Лестница разбора запросов в server.js — главное место, обо что спотыкался
 * каждый этап работы: чтобы понять ручку, её надо найти среди сотни соседей;
 * чтобы добавить новую, вклиниться в середину; любая правка рядом задевает всё.
 * Переписывать девятнадцать тысяч строк разом нельзя — там живут ручки, чьё
 * поведение нигде, кроме кода, не описано.
 *
 * Поэтому домены переезжают по одному, а здесь стоит храповик: число ручек,
 * оставшихся в лестнице, зафиксировано и может только УМЕНЬШАТЬСЯ. Новая ручка
 * в лестницу не добавляется — только в маршрутизатор.
 *
 * И отдельно проверяем сам маршрутизатор: он обязан пропускать чужое (иначе
 * переезд по одному домену невозможен) и не давать зарегистрировать две ручки
 * на один путь (иначе вторая молча никогда не сработает).
 *
 * Zero-AI, без сети и диска. Exit 0 = pass.
 */
import { createRouter } from "../src/router.js";
import { registerWorkspaceRoutes } from "../src/routes/workspace-routes.js";
import { registerMcpRoutes } from "../src/routes/mcp-routes.js";
import { registerHistoryRoutes } from "../src/routes/history-routes.js";
import { registerStudioLogRoutes } from "../src/routes/studio-log-routes.js";
import { registerAssetRoutes } from "../src/routes/asset-routes.js";
import { registerBrandRoutes } from "../src/routes/brand-routes.js";
import { registerAiLessonRoutes } from "../src/routes/ai-lesson-routes.js";
import { registerFigmaRoutes } from "../src/routes/figma-routes.js";
import { deadBranches } from "./audit-ladder.mjs";
import { readFileSync } from "node:fs";
import path from "node:path";
import url from "node:url";

const repoRoot = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const check = (name, cond, extra = "") => {
  if (cond) { pass++; console.log("  \x1b[32m✓\x1b[0m", name); }
  else { fail++; console.error(`  \x1b[31m✗ ${name}\x1b[0m ${extra}`); }
};

/** Сколько ручек ещё разбирается лестницей. Снимок 14.09.2026. Цель — 0. */
const LADDER_BUDGET = 69;

const fakeResponse = () => {
  const sent = { status: 0, body: null };
  return { sent, res: {} };
};

/* ─── 1. Маршрутизатор ───────────────────────────────────────────────────── */
{
  const calls = [];
  const router = createRouter({ name: "test" });
  router.get("/api/one", (req, res, ctx) => calls.push(["one", ctx.tail]));
  router.post("/api/two", () => calls.push(["two"]));
  router.prefix("POST", "/api/many/", (req, res, ctx) => calls.push(["many", ctx.tail]));
  router.prefix("GET", "/api/list", (req, res, ctx) => calls.push(["list", ctx.query.get("brand")]));

  const hit = async (method, urlPath) =>
    router.dispatch({ method, url: urlPath }, fakeResponse().res);

  check("точный путь находит ручку", await hit("GET", "/api/one") === true);
  check("метод учитывается", await hit("POST", "/api/one") === false);
  check("хвост пути отдаётся обработчику",
    await hit("POST", "/api/many/publish") === true && calls.at(-1)[1] === "publish", JSON.stringify(calls.at(-1)));
  check("query не попадает в хвост",
    await hit("POST", "/api/many/open?x=1") === true && calls.at(-1)[1] === "open", JSON.stringify(calls.at(-1)));
  check("query разобран заранее",
    await hit("GET", "/api/list?brand=X_IQ") === true && calls.at(-1)[1] === "X_IQ", JSON.stringify(calls.at(-1)));

  // Это главное свойство: без «пропускаю чужое» переезд по одному домену
  // невозможен — пришлось бы переносить все 96 ручек разом.
  check("чужое пропускается", await hit("GET", "/api/совсем-другое") === false);
  check("точное совпадение важнее префикса",
    await hit("GET", "/api/list") === true && calls.at(-1)[0] === "list");

  let duplicate = "";
  try { router.get("/api/one", () => {}); } catch (error) { duplicate = error.message; }
  // Это не придирка. Ровно так в лестнице жили два `GET /api/brands` и два
  // `/api/history`: вторая ветка молча не срабатывала никогда, и увидеть это
  // в девятнадцати тысячах строк было нельзя. Здесь — падение при старте.
  check("две ручки на один путь не регистрируются", /уже зарегистрирован/.test(duplicate), duplicate);

  check("список маршрутов отдаётся для отчётов", router.list().length === 4, JSON.stringify(router.list()));
}

/* ─── 2. Переехавший домен на месте ──────────────────────────────────────── */
{
  const router = createRouter({ name: "studio" });
  registerWorkspaceRoutes(router, {
    repoRoot,
    sendJson: () => {},
    readRequestBody: async () => ({}),
    isReadOnly: () => false,
  });
  registerMcpRoutes(router, {
    repoRoot,
    sendJson: () => {},
    readRequestBody: async () => ({}),
    isAuthEnabled: () => false,
  });
  registerHistoryRoutes(router, { sendJson: () => {}, history: {} });
  registerStudioLogRoutes(router, { sendJson: () => {}, readRequestBody: async () => ({}), journal: {}, rules: {} });
  registerAssetRoutes(router, {
    sendJson: () => {}, readRequestBody: async () => ({}),
    assets: {}, canGenerate: () => false, journal: async () => {},
  });
  registerBrandRoutes(router, {
    sendJson: () => {}, readRequestBody: async () => ({}),
    brands: {}, journal: async () => {},
  });
  registerAiLessonRoutes(router, {
    sendJson: () => {}, readRequestBody: async () => ({}), lessons: {}, journal: async () => {},
  });
  registerFigmaRoutes(router, {
    sendJson: () => {}, readRequestBody: async () => ({}), apiToken: () => "", figma: {},
  });
  const ids = router.list().map((entry) => entry.id);
  for (const expected of [
    "GET /api/me", "POST /api/me/name",
    "POST /api/drafts/*", "GET /api/drafts*",
    "POST /api/mail-lease/*", "GET /api/mail-lease*",
    "GET /api/mcp/setup", "POST /api/mcp/install", "POST /api/mcp/install-skill",
    "GET /api/history", "POST /api/history/clear", "GET /api/history/*", "DELETE /api/history/*",
    "GET /api/journal", "POST /api/journal/clear",
    "GET /api/project-rules", "POST /api/project-rules", "POST /api/project-rules/clear",
    "GET /api/assets", "GET /api/assets/status", "POST /api/assets/register",
    "POST /api/assets/generate", "POST /api/assets/update",
    "GET /api/brands", "POST /api/brands", "PATCH /api/brands/*", "GET /api/brands/*",
    "GET /api/ai/lessons", "POST /api/ai/lesson", "POST /api/ai/lessons/clear", "DELETE /api/ai/lesson/*",
    "POST /api/figma/inspect", "POST /api/figma/browse", "POST /api/figma/export-images",
  ]) {
    check(`маршрут ${expected} зарегистрирован`, ids.includes(expected), ids.join(", "));
  }

  const routes = readFileSync(path.join(repoRoot, "src", "routes", "workspace-routes.js"), "utf8");
  // Модуль домена не должен импортировать сервер: иначе «вынесли» только на
  // словах, а зависимость осталась круговой.
  check("модуль не импортирует server.js", !/from\s+["'][^"']*server\.js["']/.test(routes));
  check("зависимости передаются снаружи", /registerWorkspaceRoutes\(router, deps\)/.test(routes));

  const mcpRoutes = readFileSync(path.join(repoRoot, "src", "routes", "mcp-routes.js"), "utf8");
  check("модуль подключения агента тоже не импортирует server.js",
    !/from\s+["'][^"']*server\.js["']/.test(mcpRoutes));
  check("и принимает зависимости снаружи", /registerMcpRoutes\(router, deps\)/.test(mcpRoutes));

  // Ключей моделей студия не спрашивает и не хранит: агента человек приносит
  // своего. Появившийся здесь ключ — ошибка, а не удобство.
  check("подключение агента не трогает ключи моделей",
    !/OPENAI_API_KEY|apiKey|ANTHROPIC/i.test(mcpRoutes));
}

/* ─── 2б. Из-за чего переезд стоит делать ────────────────────────────────── */
{
  // В лестнице ветка `startsWith("/api/history")` стояла выше, чем
  // `startsWith("/api/history/")`, и подбирала её запросы: открытие одной
  // записи возвращало СПИСОК вместо вёрстки. Интерфейс молча показывал не то
  // — ответ был похож на успех. Здесь это невозможно by design, и вот проверка.
  const calls = [];
  const router = createRouter({ name: "order" });
  registerHistoryRoutes(router, {
    sendJson: (response, status, payload) => calls.push({ status, payload }),
    history: {
      list: () => [{ id: "a" }],
      getHtml: (id) => (id === "a" ? "<html>одна запись</html>" : null),
      delete: (id) => ({ ok: true, id }),
      clear: () => {},
    },
  });

  await router.dispatch({ method: "GET", url: "/api/history?limit=5" }, {});
  check("список отдаёт список", Array.isArray(calls.at(-1)?.payload?.items), JSON.stringify(calls.at(-1)));

  await router.dispatch({ method: "GET", url: "/api/history/a" }, {});
  check("одна запись отдаёт вёрстку, а не список",
    calls.at(-1)?.payload?.html === "<html>одна запись</html>", JSON.stringify(calls.at(-1)));

  await router.dispatch({ method: "GET", url: "/api/history/нет-такой" }, {});
  check("несуществующая — честный 404", calls.at(-1)?.status === 404, JSON.stringify(calls.at(-1)));

  await router.dispatch({ method: "DELETE", url: "/api/history/a" }, {});
  check("удаление берёт id из пути", calls.at(-1)?.payload?.id === "a", JSON.stringify(calls.at(-1)));

  // /clear — точный путь, и он не должен попасть в ветку «открыть запись
  // с id clear»: именно так ломается порядок веток.
  await router.dispatch({ method: "POST", url: "/api/history/clear" }, {});
  check("очистка не путается с записью по имени clear",
    calls.at(-1)?.payload?.ok === true && calls.at(-1)?.payload?.html === undefined,
    JSON.stringify(calls.at(-1)));
}

/* ─── 2в. Детектор недостижимых веток ────────────────────────────────────── */
{
  // Два переезда подряд нашли ветку, которая не срабатывала никогда. Искать
  // третью глазами бессмысленно: ветки выглядят одинаково законно, решает
  // порядок. Детектор сначала проверяем на заведомо битых лестницах — иначе
  // это просто ещё один кусок кода, которому мы верим на слово.

  const history = `
    if (request.method === "GET" && request.url.startsWith("/api/history")) {
    if (request.method === "GET" && request.url.startsWith("/api/history/")) {
  `;
  check("ловит случай истории письма", deadBranches(history).dead.length === 1,
    JSON.stringify(deadBranches(history).dead));

  const brands = `
    if (request.method === "GET" && request.url === "/api/brands") {
    if (request.method === "GET" && request.url === "/api/brands") {
  `;
  check("ловит объявленную дважды ручку", deadBranches(brands).dead.length === 1);

  // Ветка без метода отвечает на любой и накрывает больше, чем кажется.
  const anyMethod = `
    if (request.url.startsWith("/api/x")) {
    if (request.method === "POST" && request.url === "/api/x/save") {
  `;
  check("ветка без метода накрывает все методы", deadBranches(anyMethod).dead.length === 1);

  // А это НЕ поломка, и путать нельзя: разные методы живут независимо.
  const differentMethods = `
    if (request.method === "GET" && request.url.startsWith("/api/drafts")) {
    if (request.method === "POST" && request.url.startsWith("/api/drafts/")) {
  `;
  check("разные методы не считаются накрытыми", deadBranches(differentMethods).dead.length === 0,
    JSON.stringify(deadBranches(differentMethods).dead));

  // Точное сравнение забирает только свой путь — вложенные пути живут дальше.
  const exactFirst = `
    if (request.method === "GET" && request.url === "/api/history") {
    if (request.method === "GET" && request.url.startsWith("/api/history/")) {
  `;
  check("точный путь не накрывает вложенные", deadBranches(exactFirst).dead.length === 0);

  // Похожая на условие строка условием не является.
  const assignment = `
    const requestPath = request.url === "/" ? "/index.html" : request.url;
    if (request.method === "GET" && request.url === "/") {
  `;
  check("присваивание не путается с веткой", deadBranches(assignment).dead.length === 0,
    JSON.stringify(deadBranches(assignment).dead));

  // И главное: в живой лестнице таких пар больше нет.
  const real = deadBranches(readFileSync(path.join(repoRoot, "server.js"), "utf8"));
  check("в server.js недостижимых веток не осталось", real.dead.length === 0,
    real.dead.map((pair) => `${pair.later.method} ${pair.later.value} (строка ${pair.later.line})`).join("; "));
}

/* ─── 3. Храповик на лестницу ────────────────────────────────────────────── */
{
  const server = readFileSync(path.join(repoRoot, "server.js"), "utf8");
  const ladder = (server.match(/request\.url === |request\.url\.startsWith\(/g) || []).length;
  console.log(`  ручек в лестнице: ${ladder} (бюджет ${LADDER_BUDGET}, цель 0)`);
  check(
    "лестница не выросла",
    ladder <= LADDER_BUDGET,
    ladder > LADDER_BUDGET ? "новую ручку добавляйте в маршрутизатор, а не в лестницу" : "",
  );
  if (ladder < LADDER_BUDGET) console.log(`    \x1b[36m↓ бюджет можно опустить до ${ladder}\x1b[0m`);

  check("сервер спрашивает маршрутизатор до лестницы",
    server.indexOf("studioRouter.dispatch") < server.indexOf('request.url.startsWith("/studio-assets/")'),
    "маршрутизатор должен идти раньше");
  check("маршрутизатор собирается один раз при старте",
    (server.match(/createRouter\(/g) || []).length === 1);
  check("переехавших ручек в лестнице не осталось",
    !/request\.url === "\/api\/me"/.test(server)
    && !/request\.url\.startsWith\("\/api\/drafts/.test(server)
    && !/request\.url === "\/api\/mcp\//.test(server)
    && !/request\.url\.startsWith\("\/api\/history/.test(server)
    && !/request\.url === "\/api\/journal"/.test(server)
    && !/request\.url === "\/api\/assets"/.test(server)
    && !/request\.url === "\/api\/brands"/.test(server)
    && !/request\.url === "\/api\/ai\/lessons"/.test(server)
    && !/request\.url === "\/api\/figma\/inspect"/.test(server));

  // Приём макета из плагина остался в лестнице сознательно: это не обёртка
  // над функцией, а сто строк на десятке помощников server.js. Переезд такой
  // ручки — вынос логики приёма в модуль, отдельная работа. Проверка стоит,
  // чтобы этот остаток был решением, а не забытым хвостом.
  check("приём макета из плагина ещё в лестнице — и это записано",
    /request\.url === "\/api\/figma\/import"/.test(server)
    && /приём макета из плагина/.test(
      readFileSync(path.join(repoRoot, "src", "routes", "figma-routes.js"), "utf8")));

  // Второй след того же порядка веток, что сломал историю: `GET /api/brands`
  // был объявлен в лестнице ДВАЖДЫ, и вторая ветка (список сохранённых тем)
  // не срабатывала никогда. Маршрутизатор такое ловит при старте — но пусть
  // и здесь будет сказано, что дубль убран осознанно.
  check("мёртвый дубль списка тем не вернулся",
    !/GET \/api\/brands — list saved brand themes/.test(server));
  check("и его функция больше не импортируется",
    !/listThemes/.test(server), "tools/theme-patcher.js её всё ещё экспортирует — это нормально");
  // Домен уехал целиком, если вместе с ручками из сервера ушёл и его модуль.
  check("и модуль подключения агента больше не тянется в server.js",
    !/from "\.\/src\/mcp-setup\.js"/.test(server));
}

console.log(`\nrouter: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
