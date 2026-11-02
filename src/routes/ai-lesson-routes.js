/**
 * src/routes/ai-lesson-routes.js — уроки, которым научили студию.
 *
 * Человек поправляет модель, и поправка не должна пропадать: «в этом бренде
 * кнопка всегда зелёная», «в системных письмах не бывает картинок». Уроки
 * подмешиваются к запросам к модели, поэтому пустой урок здесь хуже, чем
 * отсутствие урока, — он занимает место и ничего не говорит.
 *
 * Хранилище приходит снаружи: роут знает форму ответа, а не устройство базы.
 */

/**
 * @param {object} deps
 * @param {Function} deps.sendJson
 * @param {Function} deps.readRequestBody
 * @param {object} deps.lessons — read, append, remove, clear
 * @param {Function} deps.journal
 */
export function registerAiLessonRoutes(router, deps) {
  const { sendJson, readRequestBody, lessons, journal } = deps;
  const text = (value) => String(value ?? "").trim();

  router.get("/api/ai/lessons", async (request, response) => {
    sendJson(response, 200, await lessons.read());
  });

  router.post("/api/ai/lesson", async (request, response) => {
    const body = await readRequestBody(request);
    // Урок без сути молча уходил в базу и потом подмешивался к каждому
    // запросу пустой строкой. Отказ понятнее, чем тихий мусор.
    if (!text(body?.mistake) && !text(body?.correction)) {
      sendJson(response, 400, { ok: false, error: "Урок пустой: нужно, что было не так или как правильно." });
      return;
    }
    const lesson = await lessons.append({
      category: text(body?.category) || "general",
      mistake: text(body?.mistake),
      correction: text(body?.correction),
      tags: Array.isArray(body?.tags) ? body.tags : [],
      source: text(body?.source) || "user",
    });
    await journal({
      area: "ai-lessons",
      title: "AI lesson saved",
      message: `Lesson: ${String(lesson.mistake || "").slice(0, 80)}...`,
    });
    sendJson(response, 200, { ok: true, lesson });
  });

  router.post("/api/ai/lessons/clear", async (request, response) => {
    await lessons.clear();
    sendJson(response, 200, { ok: true });
  });

  router.prefix("DELETE", "/api/ai/lesson/", async (request, response, { tail }) => {
    const id = decodeURIComponent(String(tail || "").split("?")[0]);
    if (!id) { sendJson(response, 404, { ok: false, error: "Не указан урок" }); return; }
    sendJson(response, 200, await lessons.remove(id));
  });

  return router;
}
