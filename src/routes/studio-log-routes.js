/**
 * src/routes/studio-log-routes.js — журнал студии и правила проекта.
 *
 * Две небольшие темы, которые всегда ходили парой: журнал — что студия
 * делала, правила проекта — что ей велено помнить. Обе отвечают одинаково
 * («список плюс сводка»), и обе раньше лежали в лестнице подряд.
 *
 * Работу с хранилищем роут не знает: и журнал, и правила живут в базе
 * студии, а сюда приходят готовыми функциями. Так эти ручки проверяются
 * подставными функциями, без базы и без диска.
 */

/**
 * @param {object} deps
 * @param {Function} deps.sendJson
 * @param {Function} deps.readRequestBody
 * @param {object} deps.journal — read, clear, summarize, append
 * @param {object} deps.rules — read, append, clear, summarize
 */
export function registerStudioLogRoutes(router, deps) {
  const { sendJson, readRequestBody, journal, rules } = deps;

  const sendJournal = (response, data) => sendJson(response, 200, {
    entries: data.entries,
    summary: journal.summarize(data),
  });

  const sendRules = (response, data) => sendJson(response, 200, {
    items: data.items,
    summary: rules.summarize(data),
  });

  router.get("/api/journal", async (request, response) => {
    sendJournal(response, await journal.read());
  });

  router.post("/api/journal/clear", async (request, response) => {
    sendJournal(response, await journal.clear());
  });

  router.get("/api/project-rules", async (request, response) => {
    sendRules(response, await rules.read());
  });

  router.post("/api/project-rules", async (request, response) => {
    const payload = await readRequestBody(request);
    // Пустое правило — не ошибка хранилища, а ошибка ввода: отвечаем понятно,
    // а не пятисоткой из глубины базы.
    try {
      const saved = await rules.append(payload?.text, payload?.source);
      await journal.append({ area: "rules", title: "Project rule saved", message: String(payload?.text || "") });
      sendRules(response, saved);
    } catch (error) {
      sendJson(response, 400, { ok: false, error: error.message });
    }
  });

  router.post("/api/project-rules/clear", async (request, response) => {
    const cleared = await rules.clear();
    await journal.append({
      area: "rules",
      title: "Project rules cleared",
      message: "Project rules list was reset.",
    });
    sendRules(response, cleared);
  });

  return router;
}
