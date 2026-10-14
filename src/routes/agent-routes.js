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
import { callRelay, relayOnline, relayStatus } from "../relay.js";
import { canvasSummaryFrom } from "../canvas-summary.js";
import { normalizeConstructorCatalog } from "../constructor-catalog.js";

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

  /**
   * Холст конструктора для своего агента. Холст живёт во вкладке человека,
   * поэтому: забираем его оттуда через связь (src/relay.js, канал
   * constructor), прогоняем тем же инструментом, что и оператор студии, и
   * отправляем получившиеся правки обратно во вкладку — она применяет их
   * так же, как правки оператора, с отменой по Ctrl+Z.
   */
  router.post("/api/agent/canvas-call", async (request, response) => {
    try {
      const body = await readRequestBody(request);
      const name = String(body?.tool || "").trim();
      const token = request.retkitActor?.token || "";
      if (name !== "read_canvas" && !BROWSER_ONLY.has(name)) {
        sendJson(response, 400, { ok: false, error: `"${name}" — не инструмент холста.` });
        return;
      }
      const read = await callRelay(token, "canvas_read", {}, { channel: "constructor", timeoutMs: 20_000 });
      if (!read.ok) { sendJson(response, 200, read); return; }
      const canvas = Array.isArray(read.result?.canvas) ? read.result.canvas : [];
      const summary = canvasSummaryFrom(canvas);
      if (name === "read_canvas") {
        sendJson(response, 200, { ok: true, result: { mailName: read.result?.mailName || "", blocks: summary } });
        return;
      }
      const ctx = {
        surface: "constructor",
        repoRoot,
        readOnly: Boolean(isReadOnly()),
        actor: request.retkitActor || null,
        apiKey: apiKey(),
        canvas,
        canvasSummary: summary,
        constructorCatalog: normalizeConstructorCatalog(read.result?.studio),
        constructorMailName: String(read.result?.mailName || ""),
        pendingLocaleUpdates: [],
        pendingLocaleDeletes: [],
        pendingImages: [],
        html: "",
      };
      const result = await TOOL_HANDLERS[name](body?.args && typeof body.args === "object" ? body.args : {}, ctx);
      if (result?.error || !Array.isArray(ctx.canvasOps) || !ctx.canvasOps.length) {
        sendJson(response, 200, { ok: !result?.error, result });
        return;
      }
      const applied = await callRelay(token, "canvas_apply", { ops: ctx.canvasOps }, { channel: "constructor", timeoutMs: 30_000 });
      sendJson(response, 200, {
        ok: applied.ok && !(applied.result?.problems || []).length,
        result: { tool: result, onCanvas: applied.ok ? applied.result : null },
        ...(applied.ok ? {} : { error: applied.error }),
      });
    } catch (error) {
      sendJson(response, 500, { ok: false, error: error.message });
    }
  });

  /**
   * Переход между конструктором и кодом по просьбе агента. Нажимает ту же
   * кнопку, что человек («→ В код» / «В конструктор»), и ждёт, пока на том
   * конце откроется вкладка — тогда агент сразу может работать дальше.
   */
  router.post("/api/agent/navigate", async (request, response) => {
    try {
      const body = await readRequestBody(request);
      const to = body?.to === "constructor" ? "constructor" : "workbench";
      const from = to === "constructor" ? "workbench" : "constructor";
      const token = request.retkitActor?.token || "";
      const started = await callRelay(token, to === "workbench" ? "to_code" : "to_constructor", {}, { channel: from, timeoutMs: 15_000 });
      if (!started.ok) { sendJson(response, 200, started); return; }
      const deadline = Date.now() + 25_000;
      // Старая вкладка ещё «на связи» несколько секунд: ждём именно новую.
      const before = relayStatus(token, to).lastPollAt || 0;
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 700));
        const status = relayStatus(token, to);
        if (status.online && status.lastPollAt > before) {
          sendJson(response, 200, { ok: true, result: { opened: to === "workbench" ? "Код" : "Конструктор", ...started.result, tab: status.moengage || null } });
          return;
        }
      }
      sendJson(response, 200, { ok: false, error: "Переход начат, но новая вкладка не ответила за 25 секунд — возможно, студия показала человеку вопрос или ошибку." });
    } catch (error) {
      sendJson(response, 500, { ok: false, error: error.message });
    }
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
      // Свой агент по ссылке: письмо и локали, открытые у человека во вкладке
      // «Код», берём оттуда (src/relay.js, канал workbench) — иначе агент не
      // видел локалей и его правки некуда было применить.
      const token = request.retkitActor?.token || "";
      let live = null;
      if (request.retkitActor?.kind === "agent" && relayOnline(token, Date.now(), "workbench")) {
        const got = await callRelay(token, "wb_context", {}, { channel: "workbench", timeoutMs: 15_000 });
        const wanted = (value, open) => !String(value || "").trim() || String(value).trim() === String(open || "").trim();
        if (got.ok && got.result && wanted(given.brand, got.result.brand) && wanted(given.mail, got.result.mail)) live = got.result;
      }
      const brand = String(live?.brand || given.brand || "").trim();
      const mail = String(live?.mail || given.mail || "").trim();
      const liveNamespaces = Array.isArray(live?.namespaces) ? live.namespaces.map((n) => ({
        ...n,
        name: String(n.namespace || n.name || ""),
        namespace: String(n.namespace || n.name || ""),
      })) : null;

      const ctx = {
        surface: given.surface === "constructor" ? "constructor" : "workbench",
        brand,
        mail,
        repoRoot,
        readOnly: Boolean(isReadOnly()),
        actor: request.retkitActor || null,
        apiKey: apiKey(),
        activeLocale: String(live?.activeLocale || given.locale || "").trim(),
        namespaces: liveNamespaces || (Array.isArray(given.namespaces) ? given.namespaces : []),
        canvasSummary: Array.isArray(given.canvas) ? given.canvas : [],
        pendingLocaleUpdates: [],
        pendingLocaleDeletes: [],
        pendingImages: [],
        html: String(live?.html || given.html || "").trim(),
      };
      if (liveNamespaces) {
        ctx.activeNamespace = liveNamespaces.find((n) => n.name === live.activeNamespaceName) || liveNamespaces[0] || null;
      }

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

      // Правки письма и локалей — предложение человеку во вкладке «Код»: там
      // они показываются с diff и кнопкой «Применить», как у оператора.
      const hasEdits = Boolean(ctx.modifiedHtml) || ctx.pendingLocaleUpdates.length || (ctx.pendingLocaleDeletes || []).length;
      let delivery = null;
      if (hasEdits && request.retkitActor?.kind === "agent") {
        if (live) {
          const shown = await callRelay(token, "wb_apply", {
            note: String(body?.args?.reason || name),
            modifiedHtml: ctx.modifiedHtml || "",
            localeUpdates: ctx.pendingLocaleUpdates,
            localeDeletes: ctx.pendingLocaleDeletes || [],
          }, { channel: "workbench", timeoutMs: 15_000 });
          delivery = shown.ok
            ? "Правка показана человеку во вкладке «Код» с diff и кнопкой «Применить». Скажите ему проверить и нажать."
            : `Правку не удалось показать во вкладке «Код»: ${shown.error}`;
        } else {
          delivery = "Правка НЕ сохранена: письмо не открыто у человека во вкладке «Код». Попросите открыть его там и повторите.";
        }
      }

      sendJson(response, 200, {
        ok: !result?.error,
        tool: name,
        result: delivery ? { ...result, delivery } : result,
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
