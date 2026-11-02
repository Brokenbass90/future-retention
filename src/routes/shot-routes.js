/**
 * src/routes/shot-routes.js — отдать снимок письма картинкой.
 *
 * Ручка нужна не интерфейсу (он показывает живой iframe), а агенту: через
 * MCP он до сих пор видел только размер и предупреждения и обсуждать дизайн
 * мог лишь на словах. Снимок он видит по-настоящему.
 *
 * HTML приходит телом запроса, а не именем письма, нарочно: агент уже собрал
 * письмо через compose-preview и держит его у себя, а лезть отсюда в базу
 * значило бы снимать не то, что он собрал. Сохранять снимок тоже не будем —
 * это разговор, а не артефакт.
 */
import { renderHtmlShot, ShotUnavailableError, SHOT_VIEWS } from "../shot.js";

/**
 * @param {object} deps
 * @param {Function} deps.sendJson
 * @param {Function} deps.readRequestBody
 */
export function registerShotRoutes(router, deps) {
  const { sendJson, readRequestBody } = deps;

  router.post("/api/render-shot", async (request, response) => {
    try {
      const body = await readRequestBody(request);
      const html = String(body?.html || "");
      if (!html.trim()) throw new Error("Нечего снимать: в запросе нет html.");
      const view = SHOT_VIEWS[body?.view] ? body.view : "desktop";

      const shot = await renderHtmlShot({
        html,
        view,
        fullPage: body?.full_page !== false,
        maxHeight: Number(body?.max_height) || 4000,
      });
      response.writeHead(200, {
        "Content-Type": "image/png",
        "Content-Length": shot.png.length,
        "Cache-Control": "no-store",
        "X-Shot-View": shot.view,
        "X-Shot-Width": String(shot.width),
        "X-Shot-Height": String(shot.height),
      });
      response.end(shot.png);
    } catch (error) {
      // Нет браузера — это не поломка студии, а отсутствующая на машине
      // возможность. Отдельный код, чтобы вызывающий сказал человеку, что
      // делать, а не показывал «500».
      const noBrowser = error instanceof ShotUnavailableError;
      sendJson(response, noBrowser ? 501 : 400, {
        ok: false,
        error: error.message,
        ...(noBrowser ? { code: error.code } : {}),
      });
    }
  });

  return router;
}
