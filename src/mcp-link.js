/**
 * src/mcp-link.js — личная ссылка на студию для своего Claude или Codex.
 *
 * ЗАЧЕМ. Прежнее подключение требовало терминала, node и правки конфигов на
 * компьютере человека — и работало только со студией, запущенной там же.
 * Теперь студия сама отдаёт свои инструменты по HTTPS (MCP, Streamable HTTP),
 * а человек вставляет ссылку в «Добавить свой коннектор» в Claude или
 * «Add server» в Codex. Ни установки, ни терминала, ни платы — на Mac и
 * Windows одинаково.
 *
 * ССЫЛКА = МЕТКА ЧЕЛОВЕКА + ПОДПИСЬ. Метка (retkit_actor из cookie браузера)
 * говорит, чей это агент: его работа ложится в черновики этого человека и в
 * его же разговор с оператором — одна сущность в конструкторе, в коде и в
 * Claude. Подпись нужна там, где студия закрыта паролем: без неё любой мог бы
 * придумать метку и обойти пароль. Подпись считается из секрета, который
 * переживает перезапуск Heroku, иначе ссылки ломались бы каждые сутки.
 *
 * Хранить на сервере ничего не надо: ключ проверяется арифметикой.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { isActorToken } from "./actor.js";

const SIG_LENGTH = 16;

/** Секрет подписи. Стабилен между перезапусками, пока не меняются env. */
export function mcpLinkSecret(env = process.env) {
  const explicit = String(env.STUDIO_MCP_SECRET || "").trim();
  if (explicit) return explicit;
  const user = String(env.APP_AUTH_USER || "");
  const password = String(env.APP_AUTH_PASSWORD || "");
  // Пароль студии и так секрет; если его нет, студия открыта всем, и подпись
  // защищает только от опечатки — метка сама по себе 128 бит случайности.
  return `retkit-mcp:${user}:${password}`;
}

function sign(token, secret) {
  return createHmac("sha256", secret).update(`mcp-link:${token}`).digest("hex").slice(0, SIG_LENGTH);
}

/** Ключ ссылки для метки человека. */
export function makeMcpKey(token, secret = mcpLinkSecret()) {
  if (!isActorToken(token)) throw new Error("Некорректная метка человека");
  return `${token}${sign(token, secret)}`;
}

/** Метка человека из ключа — или null, если ключ подделан или испорчен. */
export function verifyMcpKey(key, secret = mcpLinkSecret()) {
  const value = String(key || "").trim().toLowerCase();
  if (!/^[0-9a-f]{48}$/.test(value)) return null;
  const token = value.slice(0, 32);
  const expected = Buffer.from(sign(token, secret));
  const given = Buffer.from(value.slice(32));
  return expected.length === given.length && timingSafeEqual(expected, given) ? token : null;
}

/** Ключ из пути /mcp/<ключ> (с хвостовым / и параметрами или без). */
export function mcpKeyFromUrl(rawUrl) {
  const match = /^\/mcp\/([0-9a-fA-F]{48})\/?(?:\?.*)?$/.exec(String(rawUrl || ""));
  return match ? match[1] : null;
}

/** Публичный адрес студии из запроса браузера (Heroku стоит за прокси). */
export function publicOrigin(request) {
  const headers = request?.headers || {};
  const host = String(headers["x-forwarded-host"] || headers.host || "127.0.0.1:3000").split(",")[0].trim();
  const forwarded = String(headers["x-forwarded-proto"] || "").split(",")[0].trim();
  const local = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(host);
  const proto = forwarded || (local ? "http" : "https");
  return `${proto}://${host}`;
}

/**
 * Когда агент этого человека заходил последний раз — чтобы студия могла
 * честно сказать «ваш Claude подключён», а не гадать. Живёт в памяти: после
 * перезапуска студия просто ждёт следующего обращения.
 */
const lastSeen = new Map();
export function noteMcpSeen(token, client = "", now = Date.now()) {
  if (!isActorToken(token)) return;
  const name = String(client || "").slice(0, 80) || lastSeen.get(token)?.client || "";
  lastSeen.set(token, { at: now, client: name });
  if (lastSeen.size > 5000) lastSeen.delete(lastSeen.keys().next().value);
}
export function mcpSeen(token) {
  return lastSeen.get(token) || null;
}
