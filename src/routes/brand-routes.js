/**
 * src/routes/brand-routes.js — бренды и их темы.
 *
 * Домен переехал из лестницы `if` и по дороге потерял мёртвую ветку.
 * В лестнице `GET /api/brands` был объявлен ДВАЖДЫ: первый раз — реестр
 * брендов с токенами темы (его и получал интерфейс), второй, тремя сотнями
 * строк ниже, — список сохранённых тем. Второй не срабатывал никогда, и
 * узнать об этом, читая код сверху вниз, было нельзя: обе ветки выглядят
 * одинаково законно. В маршрутизаторе так просто не получится — два
 * обработчика на один путь он не принимает и падает при старте.
 *
 * Бренд — это папка в базе писем плюс тема (цвета). Поэтому реестр брендов и
 * темы живут рядом, но отвечают на разные вопросы: «какие бренды есть» и
 * «какими цветами красить этот».
 */

/**
 * @param {object} deps
 * @param {Function} deps.sendJson
 * @param {Function} deps.readRequestBody
 * @param {object} deps.brands — list, create, update, tokens, readTheme
 * @param {Function} deps.journal — запись в журнал студии
 */
export function registerBrandRoutes(router, deps) {
  const { sendJson, readRequestBody, brands, journal } = deps;

  // У ошибок брендов есть свой statusCode (занятое имя, кривой HEX) — его и
  // отдаём: человеку нужно «так нельзя», а не «сервер сломался».
  const fail = (response, error, fallback = 400) => sendJson(
    response,
    Number(error?.statusCode) || fallback,
    { error: String(error?.message || error) },
  );

  router.get("/api/brands", (request, response) => {
    try {
      sendJson(response, 200, { ok: true, brands: brands.list(), tokens: brands.tokens });
    } catch (error) {
      fail(response, error, 500);
    }
  });

  router.post("/api/brands", async (request, response) => {
    try {
      const body = await readRequestBody(request);
      const brand = brands.create({
        label: body?.label, id: body?.id, theme: body?.theme,
        blockTag: body?.blockTag, order: body?.order,
      });
      // Журнал не должен ронять ответ: бренд уже создан на диске, и отказ
      // из-за неудачной записи в журнал был бы враньём.
      try {
        await journal({
          area: "brands",
          title: `Бренд создан: ${brand.label}`,
          message: `папка ${brand.id}`,
          meta: { id: brand.id },
        });
      } catch { /* журнал не важнее ответа */ }
      sendJson(response, 200, { ok: true, brand });
    } catch (error) {
      fail(response, error);
    }
  });

  router.prefix("PATCH", "/api/brands/", async (request, response, { tail }) => {
    try {
      const id = decodeURIComponent(String(tail || "").split("?")[0]);
      const body = await readRequestBody(request);
      sendJson(response, 200, { ok: true, brand: brands.update(id, body || {}) });
    } catch (error) {
      fail(response, error);
    }
  });

  router.prefix("GET", "/api/brands/", async (request, response, { tail }) => {
    const id = String(tail || "").split("?")[0];
    try {
      const theme = await brands.readTheme(id);
      if (!theme) { sendJson(response, 404, { error: "Theme not found" }); return; }
      sendJson(response, 200, { theme });
    } catch (error) {
      fail(response, error, 500);
    }
  });

  return router;
}
