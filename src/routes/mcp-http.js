/**
 * src/routes/mcp-http.js — студия как MCP-сервер по ссылке.
 *
 * Адрес: POST /mcp/<ключ>. Ключ — личный (см. src/mcp-link.js), его человек
 * копирует из окна «Свой агент» и вставляет в Claude («Добавить свой
 * коннектор») или в Codex («Add server» → Streamable HTTP).
 *
 * Сервер без сессий: на каждый запрос собирается заново и сразу закрывается.
 * Сессии пришлось бы держать в памяти, а Heroku её теряет при перезапуске —
 * подключение молча отваливалось бы раз в сутки.
 *
 * Внутри это тот же набор, что и у stdio-сервера (mcp/retkit-mcp-server.mjs):
 * он ходит в студию по HTTP — сюда же, на 127.0.0.1, с паролем студии и с
 * меткой человека. Поэтому все правила студии (черновики, проверки, только
 * свои письма) работают для агента ровно так же, как раньше.
 *
 * Ручка стоит ДО проверки пароля студии: облако Claude пароль Basic Auth не
 * знает. Пускает её подпись в ключе — подделать её без секрета нельзя.
 */
import { createRetkitMcpServer } from "../../mcp/retkit-mcp-server.mjs";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { mcpKeyFromUrl, verifyMcpKey, noteMcpSeen } from "../mcp-link.js";

const MAX_BODY_BYTES = 4 * 1024 * 1024;

/** Запрос к нашей ссылке или к служебным адресам OAuth, которые Claude проверяет. */
export function isMcpHttpRequest(request) {
  const url = String(request?.url || "");
  return url.startsWith("/mcp/") || url === "/mcp" || url.startsWith("/.well-known/oauth-");
}

function sendJsonRpcError(response, status, message, extra = {}) {
  if (response.headersSent) return;
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extra });
  response.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message }, id: null }));
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) { reject(new Error("Слишком большой запрос")); request.destroy(); return; }
      chunks.push(chunk);
    });
    request.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      if (!text.trim()) { resolve(undefined); return; }
      try { resolve(JSON.parse(text)); } catch { reject(new Error("Тело запроса — не JSON")); }
    });
    request.on("error", reject);
  });
}

function clientNameOf(body) {
  const messages = Array.isArray(body) ? body : [body];
  for (const message of messages) {
    if (message?.method === "initialize") {
      const info = message?.params?.clientInfo || {};
      return [info.name, info.version].filter(Boolean).join(" ");
    }
  }
  return "";
}

/**
 * Как студии дозвониться до самой себя. На Heroku сервер может слушать только
 * IPv6 — тогда 127.0.0.1 молчит, и все инструменты агента падали с
 * «fetch failed». Пробуем адреса по очереди и запоминаем тот, что ответил.
 */
let _selfUrl = "";
async function selfUrl(request, port) {
  if (_selfUrl) return _selfUrl;
  const local = String(request.socket?.localAddress || "").replace(/^::ffff:/, "");
  const localPort = Number(request.socket?.localPort) || port;
  const candidates = [
    `http://127.0.0.1:${port}`,
    `http://[::1]:${port}`,
    `http://localhost:${port}`,
    local ? `http://${local.includes(":") ? `[${local}]` : local}:${localPort}` : "",
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      const response = await fetch(`${candidate}/healthz`, { signal: AbortSignal.timeout(2500) });
      if (response.ok) { _selfUrl = candidate; return candidate; }
    } catch { /* следующий адрес */ }
  }
  console.error("[mcp-http] студия не дозвонилась до себя ни по одному адресу:", candidates.join(", "));
  return candidates[0];
}

/**
 * @param {import("node:http").IncomingMessage} request
 * @param {import("node:http").ServerResponse} response
 * @param {{ port:number, env?:NodeJS.ProcessEnv }} deps
 */
export async function handleMcpHttp(request, response, { port, env = process.env }) {
  const url = String(request.url || "");

  // Claude перед подключением ищет OAuth. Его у нас нет: доступ даёт сама
  // ссылка. Честный 404 говорит клиенту «входить не нужно»; пароль студии,
  // отданный вместо него, выглядел бы как требование авторизации.
  if (url.startsWith("/.well-known/oauth-")) {
    response.writeHead(404, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    response.end(JSON.stringify({ error: "OAuth не используется: доступ даёт личная ссылка" }));
    return;
  }

  const key = mcpKeyFromUrl(url);
  const token = key ? verifyMcpKey(key) : null;
  if (!token) {
    sendJsonRpcError(response, 404,
      "Ссылка студии неверна или устарела. Откройте студию → «Свой агент» и скопируйте ссылку заново.");
    return;
  }

  // Без сессий нечего слушать (GET) и нечего закрывать (DELETE).
  if (request.method !== "POST") {
    sendJsonRpcError(response, 405, "Используйте POST", { Allow: "POST" });
    return;
  }

  let body;
  try {
    body = await readBody(request);
  } catch (error) {
    sendJsonRpcError(response, 400, error.message);
    return;
  }

  noteMcpSeen(token, clientNameOf(body));

  let server = null;
  let transport = null;
  try {
    server = await createRetkitMcpServer({
      studioUrl: await selfUrl(request, port),
      user: String(env.APP_AUTH_USER || ""),
      password: String(env.APP_AUTH_PASSWORD || ""),
      token,
    });
    transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    response.on("close", () => {
      transport?.close().catch(() => {});
      server?.close().catch(() => {});
    });
    await server.connect(transport);
    await transport.handleRequest(request, response, body);
  } catch (error) {
    console.error("[mcp-http]", error);
    sendJsonRpcError(response, 500, `Студия не смогла ответить: ${error.message}`);
  }
}
