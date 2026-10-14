/**
 * src/routes/relay-routes.js — ручки связи агента с расширением RetKit.
 * Устройство описано в src/relay.js.
 *
 * Окно связи приходит как человек (cookie браузера), агент — со своей меткой
 * в заголовке; метка у них одна и та же, поэтому они находят друг друга.
 */
import { pollRelay, resolveRelay, callRelay, relayStatus } from "../relay.js";

const RELAY_TOOLS = new Set([
  "status", "read_email", "write_email", "switch_locale", "find_across_locales", "validator",
]);

export function registerRelayRoutes(router, { sendJson, readRequestBody }) {
  const tokenOf = (request) => request.retkitActor?.token || "";

  router.post("/api/relay/poll", async (request, response) => {
    const token = tokenOf(request);
    if (!token) { sendJson(response, 503, { ok: false, error: "Студия не узнала браузер" }); return; }
    const body = await readRequestBody(request).catch(() => ({}));
    const command = await pollRelay(token, body?.status || null, { channel: body?.channel });
    sendJson(response, 200, { ok: true, command });
  });

  router.post("/api/relay/result", async (request, response) => {
    const body = await readRequestBody(request).catch(() => ({}));
    const done = resolveRelay(tokenOf(request), body?.id, {
      ok: body?.ok === true,
      result: body?.result ?? null,
      error: body?.ok === true ? undefined : String(body?.error || "Ошибка в RetKit"),
    }, body?.channel);
    sendJson(response, 200, { ok: done });
  });

  router.get("/api/relay/status", (request, response) => {
    sendJson(response, 200, { ok: true, ...relayStatus(tokenOf(request)) });
  });

  router.post("/api/relay/call", async (request, response) => {
    const body = await readRequestBody(request).catch(() => ({}));
    const tool = String(body?.tool || "");
    if (!RELAY_TOOLS.has(tool)) { sendJson(response, 400, { ok: false, error: `Неизвестная команда RetKit: ${tool}` }); return; }
    const reply = await callRelay(tokenOf(request), tool, body?.args || {});
    sendJson(response, 200, reply);
  });

  return router;
}
