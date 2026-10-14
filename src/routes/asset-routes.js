/**
 * src/routes/asset-routes.js — библиотека картинок студии.
 *
 * Что здесь важно понимать: картинка, лежащая только на этой машине, в
 * рассылке не откроется. Поэтому у библиотеки есть отдельная ручка статуса —
 * интерфейс по ней честно предупреждает, что локальные ссылки в письме не
 * работают, а не выясняется это после отправки.
 *
 * Работа с реестром и с генерацией картинок приходит снаружи: роут знает
 * порядок и ответы, а не устройство хранилища.
 */

/**
 * @param {object} deps
 * @param {Function} deps.sendJson
 * @param {Function} deps.readRequestBody
 * @param {object} deps.assets — status, read, summarize, register, generate, update
 * @param {() => boolean} deps.canGenerate — есть ли у студии своя модель
 * @param {Function} deps.journal — запись в журнал студии
 */
export function registerAssetRoutes(router, deps) {
  const { sendJson, readRequestBody, assets, canGenerate, journal } = deps;

  const label = (item) => String(item?.label || item?.id || "").trim();

  router.get("/api/assets/status", (request, response) => {
    sendJson(response, 200, assets.status());
  });

  router.get("/api/assets", async (request, response) => {
    const registry = await assets.read();
    sendJson(response, 200, { items: registry.items, summary: assets.summarize(registry) });
  });

  router.post("/api/assets/register", async (request, response) => {
    const payload = await readRequestBody(request);
    const result = await assets.register(Array.isArray(payload?.files) ? payload.files : []);
    await journal({
      area: "assets",
      title: "Assets uploaded",
      message: `Registered ${result.items.length} file(s) in asset library.`,
      meta: { count: result.items.length },
    });
    sendJson(response, 200, result);
  });

  router.post("/api/assets/generate", async (request, response) => {
    // Своей модели у студии может не быть вовсе — это обычное состояние, а не
    // поломка: человек приносит своего агента. Отвечаем 503, а не 500.
    if (!canGenerate()) {
      sendJson(response, 503, { error: "OPENAI_API_KEY is not configured" });
      return;
    }
    try {
      const payload = await readRequestBody(request);
      const result = await assets.generate({
        prompt: payload?.prompt,
        size: payload?.size,
        quality: payload?.quality,
      });
      await journal({
        area: "assets",
        title: "AI image generated",
        message: `Generated ${label(result.item) || "image"} with ${result.model}.`,
        meta: { assetId: result.item?.id, model: result.model, size: result.size, quality: result.quality },
      });
      sendJson(response, 200, { ok: true, ...result });
    } catch (error) {
      const message = String(error?.message || error);
      // Короткий запрос — вина ввода, всё остальное — вина внешней службы.
      sendJson(response, /prompt is too short/i.test(message) ? 400 : 502, { error: message });
    }
  });

  router.post("/api/assets/update", async (request, response) => {
    const payload = await readRequestBody(request);
    try {
      const result = await assets.update(payload?.id, payload?.patch || {});
      await journal({
        area: "assets",
        title: "Asset updated",
        message: String(payload?.patch?.externalUrl || "").trim()
          ? `Linked asset ${label(result.item)} to external URL.`
          : `Updated asset ${label(result.item)}.`,
        meta: { assetId: String(result.item?.id || "").trim() },
      });
      sendJson(response, 200, result);
    } catch (error) {
      sendJson(response, 400, { ok: false, error: String(error?.message || error) });
    }
  });

  return router;
}
