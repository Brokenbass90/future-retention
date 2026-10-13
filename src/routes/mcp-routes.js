/**
 * src/routes/mcp-routes.js — подключение своего агента к студии.
 *
 * Второй домен, переехавший из лестницы `if` в server.js. Выбран потому, что
 * держится целиком на одном модуле (`src/mcp-setup.js`) и ничего не знает про
 * остальной сервер: три ручки, все зависимости — из одного места.
 *
 * Здесь нет и не должно быть ключей моделей. Студия готовит конфиг и, когда
 * открыта на том же компьютере, кладёт его на место; модель человек приносит
 * свою. Поэтому каждая пишущая ручка сначала спрашивает, местный ли запрос:
 * ставить конфиг и скилл в чужой домашней папке нельзя — их там просто нет.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import {
  MCP_SERVER_KEY,
  claudeDesktopConfigPath,
  isLocalStudioRequest,
  mcpServerEntry,
  manualConfigSnippet,
  claudeCodeCommand,
  writeClaudeDesktopConfig,
  describeStudioSkill,
  installStudioSkill,
  userSkillTarget,
  ensureAgentToken,
  describeConnection,
} from "../mcp-setup.js";
import { makeMcpKey, publicOrigin, mcpSeen } from "../mcp-link.js";

/**
 * @param {object} deps
 * @param {string} deps.repoRoot
 * @param {Function} deps.sendJson
 * @param {Function} deps.readRequestBody
 * @param {() => boolean} deps.isAuthEnabled — витрине с паролем конфиг нужен
 *   другой, и знать об этом должна ручка, а не интерфейс.
 */
export function registerMcpRoutes(router, deps) {
  const { repoRoot, sendJson, readRequestBody, isAuthEnabled } = deps;

  const serverPathOf = () => path.join(repoRoot, "mcp", "retkit-mcp-server.mjs");

  const isLocal = (request) => isLocalStudioRequest({
    host: request.headers.host || "",
    remoteAddress: request.socket?.remoteAddress || "",
  });

  router.get("/api/mcp/setup", (request, response) => {
    const serverPath = serverPathOf();
    const local = isLocal(request);
    const studioUrl = local
      ? `http://${request.headers.host || "127.0.0.1:3000"}`
      : `https://${request.headers.host || ""}`;
    // Метка агента постоянна: к ней привязаны его черновики, и менять её
    // между сеансами значило бы терять его вчерашнюю работу.
    const entry = mcpServerEntry({ serverPath, studioUrl, token: ensureAgentToken(repoRoot) });
    const skill = describeStudioSkill(repoRoot);
    sendJson(response, 200, {
      ok: true,
      key: MCP_SERVER_KEY,
      serverPath,
      serverExists: existsSync(serverPath),
      studioUrl,
      local,
      canInstall: local && existsSync(serverPath),
      desktopConfigPath: claudeDesktopConfigPath(),
      configSnippet: manualConfigSnippet(entry),
      claudeCodeCommand: claudeCodeCommand(entry),
      needsAuth: Boolean(isAuthEnabled()),
      // Скилл — то, что превращает подключённого Клода из «дёргателя ручек»
      // в понимающего студию. В папке студии Claude Code берёт его сам;
      // всем остальным его надо скопировать к себе.
      skill: {
        ...skill,
        target: claudeDesktopConfigPath() ? userSkillTarget() : "",
        canInstall: local && skill.available,
      },
      // Состояние спрашиваем у диска, а не помним в интерфейсе: иначе второе
      // окно студии снова предлагает подключиться к тому, что уже стоит.
      connection: local ? describeConnection({ repoRoot, serverPath }) : null,
    });
  });

  /**
   * Личная ссылка для своего Claude или Codex — главный способ подключения.
   * Ничего не ставится: человек копирует ссылку и вставляет её в настройки
   * своего клиента. Ссылка привязана к этому браузеру — агент работает в
   * черновиках этого человека и в его же разговоре с оператором.
   */
  router.get("/api/mcp/link", (request, response) => {
    const token = request.retkitActor?.token;
    if (!token) {
      sendJson(response, 503, { ok: false, error: "Студия не смогла узнать этот браузер — обновите страницу." });
      return;
    }
    const seen = mcpSeen(token);
    sendJson(response, 200, {
      ok: true,
      url: `${publicOrigin(request)}/mcp/${makeMcpKey(token)}`,
      // Облако Claude не достучится до студии на 127.0.0.1 — ссылка оттуда
      // годится только для Codex и Claude Code на этом же компьютере.
      reachableFromCloud: !/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])/i.test(publicOrigin(request)),
      lastSeenAt: seen?.at || 0,
      lastClient: seen?.client || "",
    });
  });

  router.post("/api/mcp/install-skill", (request, response) => {
    try {
      if (!isLocal(request)) {
        throw new Error(
          "Скилл ставится в вашу папку ~/.claude/skills, а студия открыта не с этого компьютера. " +
          "Скопируйте папку .claude/skills/retkit-studio из студии вручную."
        );
      }
      sendJson(response, 200, { ok: true, ...installStudioSkill({ repoRoot }) });
    } catch (error) {
      sendJson(response, 400, { ok: false, error: error.message });
    }
  });

  router.post("/api/mcp/install", async (request, response) => {
    try {
      if (!isLocal(request)) {
        throw new Error(
          "Автоматическая установка работает только когда студия запущена на вашем компьютере. " +
          "Скопируйте конфиг из окна подключения."
        );
      }
      const serverPath = serverPathOf();
      if (!existsSync(serverPath)) throw new Error("Файл MCP-сервера не найден: mcp/retkit-mcp-server.mjs");
      const body = await readRequestBody(request);
      const entry = mcpServerEntry({
        serverPath,
        studioUrl: `http://${request.headers.host || "127.0.0.1:3000"}`,
        user: String(body?.user || ""),
        password: String(body?.password || ""),
        token: ensureAgentToken(repoRoot),
      });
      const installed = writeClaudeDesktopConfig({ configPath: claudeDesktopConfigPath(), entry });

      // Скилл ставится тем же действием, а не отдельной кнопкой. Подключение
      // без скилла — это агент, который видит ручки, но не понимает студию:
      // отдельный шаг здесь давал ровно один результат — его пропускали.
      // Неудача скилла не отменяет подключения: агент уже дойдёт до студии,
      // а знания подтянет retkit_studio_guide.
      let skill = null;
      try {
        skill = { ok: true, ...installStudioSkill({ repoRoot }) };
      } catch (error) {
        skill = { ok: false, error: error.message };
      }

      sendJson(response, 200, { ok: true, ...installed, skill });
    } catch (error) {
      sendJson(response, 400, { ok: false, error: error.message });
    }
  });

  return router;
}
