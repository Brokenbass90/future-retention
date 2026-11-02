/**
 * src/routes/agent-thread-routes.js — общий разговор с оператором.
 *
 * Конструктор и код показывают одну и ту же переписку (см. src/agent-thread.js).
 * Ручки только читают и очищают её; пишет сам оператор после каждого хода.
 */
import { readThread, clearThread, threadForClient } from "../agent-thread.js";

export function registerAgentThreadRoutes(router, deps) {
  const { repoRoot, sendJson } = deps;

  router.get("/api/studio/agent/thread", (request, response) => {
    try {
      sendJson(response, 200, { ok: true, messages: threadForClient(readThread(repoRoot, request.retkitActor || null)) });
    } catch (error) {
      sendJson(response, 500, { error: error.message });
    }
  });

  router.post("/api/studio/agent/thread/clear", (request, response) => {
    try {
      clearThread(repoRoot, request.retkitActor || null);
      sendJson(response, 200, { ok: true });
    } catch (error) {
      sendJson(response, 500, { error: error.message });
    }
  });

  return router;
}
