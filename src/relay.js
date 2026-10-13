/**
 * src/relay.js — связь «ваш агент ↔ расширение RetKit в MoEngage».
 *
 * Агент (Claude, Codex) приходит в студию по личной ссылке. Письмо же открыто
 * не в студии, а во вкладке MoEngage, где работает расширение RetKit. Прямо
 * из облака до той вкладки не достучаться, поэтому связь идёт через студию:
 *
 *   агент ──MCP──▶ студия ◀──опрос── окно связи (студия) ◀─postMessage─▶ RetKit
 *
 * Окно связи открывает само расширение кнопкой «Агент»: это страница студии,
 * поэтому у неё та же метка браузера, что и у студии, — и одна ссылка
 * обслуживает и студию, и MoEngage.
 *
 * Всё в памяти и по метке человека: команды одного человека никогда не уходят
 * в чужую вкладку. Перезапуск студии рвёт только незавершённые команды.
 */
import { randomBytes } from "node:crypto";

const POLL_WAIT_MS = 20_000;
const ONLINE_WINDOW_MS = 35_000;

/** @type {Map<string, {queue:any[], waiters:Function[], pending:Map<string,any>, lastPollAt:number, status:any}>} */
const relays = new Map();

function relayFor(token) {
  let relay = relays.get(token);
  if (!relay) {
    relay = { queue: [], waiters: [], pending: new Map(), lastPollAt: 0, status: null };
    relays.set(token, relay);
  }
  return relay;
}

function deliver(relay) {
  while (relay.queue.length && relay.waiters.length) {
    const waiter = relay.waiters.shift();
    waiter(relay.queue.shift());
  }
}

/** Расширение на связи: окно связи опрашивало студию только что. */
export function relayOnline(token, now = Date.now()) {
  const relay = relays.get(token);
  return Boolean(relay && now - relay.lastPollAt < ONLINE_WINDOW_MS);
}

export function relayStatus(token) {
  const relay = relays.get(token);
  return {
    online: relayOnline(token),
    lastPollAt: relay?.lastPollAt || 0,
    moengage: relay?.status || null,
  };
}

/**
 * Окно связи спрашивает: «есть для меня работа?» Ждёт до 20 секунд.
 * @returns {Promise<object|null>} команда или null, если работы не было
 */
export function pollRelay(token, status = null, { waitMs = POLL_WAIT_MS } = {}) {
  const relay = relayFor(token);
  relay.lastPollAt = Date.now();
  if (status && typeof status === "object") relay.status = { ...status, at: Date.now() };
  if (relay.queue.length) return Promise.resolve(relay.queue.shift());
  return new Promise((resolve) => {
    const waiter = (command) => { clearTimeout(timer); resolve(command); };
    const timer = setTimeout(() => {
      relay.waiters = relay.waiters.filter((item) => item !== waiter);
      resolve(null);
    }, waitMs);
    relay.waiters.push(waiter);
  });
}

/** Ответ расширения на команду. */
export function resolveRelay(token, id, payload = {}) {
  const relay = relays.get(token);
  const pending = relay?.pending.get(String(id || ""));
  if (!pending) return false;
  relay.pending.delete(String(id));
  clearTimeout(pending.timer);
  pending.resolve(payload);
  return true;
}

/**
 * Агент просит расширение что-то сделать и ждёт ответа.
 * @returns {Promise<{ok:boolean, result?:any, error?:string}>}
 */
export function callRelay(token, tool, args = {}, { timeoutMs = 90_000 } = {}) {
  if (!relayOnline(token)) {
    return Promise.resolve({
      ok: false,
      error: "Расширение RetKit не на связи. Попросите человека открыть письмо в MoEngage, " +
        "открыть RetKit и нажать в нём кнопку «Агент» (откроется маленькое окно связи — его не закрывать).",
    });
  }
  const relay = relayFor(token);
  const id = randomBytes(8).toString("hex");
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      relay.pending.delete(id);
      relay.queue = relay.queue.filter((item) => item.id !== id);
      resolve({ ok: false, error: "RetKit не ответил вовремя. Возможно, вкладка MoEngage закрыта или занята — попробуйте ещё раз." });
    }, timeoutMs);
    relay.pending.set(id, { resolve, timer });
    relay.queue.push({ id, tool: String(tool || ""), args: args && typeof args === "object" ? args : {} });
    deliver(relay);
  });
}
