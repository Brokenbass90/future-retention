/**
 * src/routes/agent-routes.js — один набор инструментов на всех агентов.
 *
 * До этого в студии жили ДВА агента, у которых не было ни одного общего
 * инструмента. Оператор студии (её собственная модель, чат в окне) умел
 * править локали, хирургически менять HTML, вставлять блоки в открытое
 * письмо — но работал вслепую и не знал про черновики. Подключённый по MCP
 * Клод видел письмо картинкой, работал в личном черновике и читал код — но
 * не трогал ни локали, ни вёрстку.
 *
 * Человек этого различия не знает и знать не должен: он спрашивает в окне
 * студии и ждёт работы. Поэтому набор инструментов теперь один, объявлен в
 * одном месте (`src/ai-tools.js`), а эти две ручки — мост: оператор зовёт
 * инструменты напрямую в процессе, MCP-сервер ходит сюда по HTTP. Новый
 * инструмент появляется у обоих сразу, и разойтись они больше не могут.
 *
 * Контекст приходит снаружи, потому что он разный: у оператора его собирает
 * браузер (открытый HTML, дерево канваса), у MCP — имя письма, по которому
 * студия читает то же самое с диска.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { TOOL_DEFINITIONS, TOOL_HANDLERS } from "../ai-tools.js";

/** Инструменты, которым нужен живой браузер человека, а не имя письма. */
// Канвас конструктора существует только в браузере: на диске его нет, и
// внешнему агенту через MCP менять его нечем. Поэтому весь набор канвас-
// инструментов помечен как browserOnly — иначе MCP-клиент получал бы «ок» на
// правку, которой никто не увидит.
const BROWSER_ONLY = new Set([
  "update_canvas_block",
  "add_canvas_block",
  "remove_canvas_block",
  "move_canvas_block",
  "clear_canvas",
  "check_canvas_ready",
]);

/**
 * @param {object} deps
 * @param {string} deps.repoRoot
 * @param {Function} deps.sendJson
 * @param {Function} deps.readRequestBody
 * @param {() => boolean} deps.isReadOnly
 * @param {() => string} deps.apiKey — некоторым инструментам нужна модель
 */
export function registerAgentRoutes(router, deps) {
  const { repoRoot, sendJson, readRequestBody, isReadOnly, apiKey } = deps;

  router.get("/api/agent/tools", (request, response) => {
    sendJson(response, 200, {
      ok: true,
      count: TOOL_DEFINITIONS.length,
      tools: TOOL_DEFINITIONS.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
        // Что нельзя вызвать снаружи браузера — говорим заранее, а не
        // молчаливой ошибкой на середине работы агента.
        browserOnly: BROWSER_ONLY.has(tool.name),
      })),
    });
  });

  router.post("/api/agent/call", async (request, response) => {
    try {
      const body = await readRequestBody(request);
      const name = String(body?.tool || "").trim();
      const handler = TOOL_HANDLERS[name];
      if (!handler) {
        sendJson(response, 404, {
          ok: false,
          error: `Инструмент "${name}" студии неизвестен.`,
          hint: "Список — GET /api/agent/tools",
        });
        return;
      }
      if (BROWSER_ONLY.has(name)) {
        sendJson(response, 400, {
          ok: false,
          error: `"${name}" работает только в окне студии: он меняет то, что человек собрал на канвасе прямо сейчас, а канвас живёт в браузере и на диске не лежит.`,
        });
        return;
      }

      const given = body?.context && typeof body.context === "object" ? body.context : {};
      const brand = String(given.brand || "").trim();
      const mail = String(given.mail || "").trim();

      const ctx = {
        surface: given.surface === "constructor" ? "constructor" : "workbench",
        brand,
        mail,
        repoRoot,
        readOnly: Boolean(isReadOnly()),
        actor: request.retkitActor || null,
        apiKey: apiKey(),
        activeLocale: String(given.locale || "").trim(),
        namespaces: Array.isArray(given.namespaces) ? given.namespaces : [],
        canvasSummary: Array.isArray(given.canvas) ? given.canvas : [],
        pendingLocaleUpdates: [],
        pendingLocaleDeletes: [],
        pendingImages: [],
        html: String(given.html || "").trim(),
      };

      // Вёрстку письма читаем с диска, если её не прислали: у агента без
      // браузера нет «открытого редактора», но письмо в базе есть.
      if (!ctx.html && brand && mail) {
        try {
          ctx.html = await readFile(
            path.join(repoRoot, "email-base", "dist", brand, mail, "index.html"),
            "utf8",
          );
        } catch { /* письмо не собрано — инструмент скажет об этом сам */ }
      }

      const result = await handler(body?.args && typeof body.args === "object" ? body.args : {}, ctx);

      sendJson(response, 200, {
        ok: !result?.error,
        tool: name,
        result,
        // Картинки инструмент кладёт в очередь: у оператора их показывает цикл
        // агента, а вызывающему по HTTP надо отдать их явно.
        images: (ctx.pendingImages || []).map((shot) => ({ note: shot.note, dataUrl: shot.dataUrl })),
        ...(ctx.pendingLocaleUpdates.length ? { localeUpdates: ctx.pendingLocaleUpdates } : {}),
        ...(ctx.modifiedHtml ? { modifiedHtml: ctx.modifiedHtml } : {}),
      });
    } catch (error) {
      sendJson(response, 400, { ok: false, error: String(error?.message || error) });
    }
  });

  return router;
}
