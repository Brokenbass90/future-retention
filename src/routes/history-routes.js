/**
 * src/routes/history-routes.js — история генераций студии.
 *
 * Третий домен, переехавший из лестницы `if` в server.js, и первый, который
 * переезд чинит, а не просто переносит.
 *
 * В лестнице первой стояла проверка `url.startsWith("/api/history")`, а
 * ниже — `startsWith("/api/history/")` для открытия одной записи. Первая
 * подходит и под вторую: запрос `/api/history/<id>` до своей ветки не
 * доходил никогда и получал в ответ СПИСОК вместо вёрстки. Интерфейс
 * (`public/app.js`) этой ручкой открывает сохранённую генерацию — то есть
 * кнопка «открыть» в истории не работала, и никто этого не замечал, потому
 * что ответ был похож на успех: не ошибка, а просто не то.
 *
 * Именно так тихо ломается лестница из сотни `if`-ов: порядок веток решает
 * больше, чем их содержимое, и увидеть это в девятнадцати тысячах строк
 * нельзя. В маршрутизаторе точный путь всегда старше префикса, и подобрать
 * чужой запрос ветка не может.
 */

/**
 * @param {object} deps
 * @param {Function} deps.sendJson
 * @param {object} deps.history — историю держит src/db.js, роут её не знает
 */
export function registerHistoryRoutes(router, deps) {
  const { sendJson, history } = deps;

  /** Идентификатор записи из пути. Чужого сюда попасть не может. */
  const idOf = (tail) => decodeURIComponent(String(tail || "").split("?")[0].split("/")[0] || "");

  router.get("/api/history", (request, response, { query }) => {
    const limit = Math.min(Number(query.get("limit")) || 50, 200);
    sendJson(response, 200, { items: history.list(limit) });
  });

  router.post("/api/history/clear", (request, response) => {
    history.clear();
    sendJson(response, 200, { ok: true });
  });

  router.prefix("GET", "/api/history/", (request, response, { tail }) => {
    const id = idOf(tail);
    if (!id) { sendJson(response, 404, { error: "Not found" }); return; }
    const html = history.getHtml(id);
    if (html === null) { sendJson(response, 404, { error: "Not found" }); return; }
    sendJson(response, 200, { id, html });
  });

  router.prefix("DELETE", "/api/history/", (request, response, { tail }) => {
    const id = idOf(tail);
    if (!id) { sendJson(response, 404, { error: "Not found" }); return; }
    sendJson(response, 200, history.delete(id));
  });

  return router;
}
