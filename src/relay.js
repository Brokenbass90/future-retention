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

/**
 * Канал — кто на том конце: "moengage" (окно связи расширения RetKit) или
 * "constructor" (открытая вкладка конструктора). У каждого своя очередь,
 * иначе правка холста могла бы уехать в MoEngage.
 */
const keyOf = (token, channel = "moengage") => `${token}:${channel === "constructor" ? "constructor" : "moengage"}`;

function relayFor(token, channel) {
  const key = keyOf(token, channel);
  let relay = relays.get(key);
  if (!relay) {
    relay = { queue: [], waiters: [], pending: new Map(), lastPollAt: 0, status: null };
    relays.set(key, relay);
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
export function relayOnline(token, now = Date.now(), channel = "moengage") {
  const relay = relays.get(keyOf(token, channel));
  return Boolean(relay && now - relay.lastPollAt < ONLINE_WINDOW_MS);
}

export function relayStatus(token, channel = "moengage") {
  const relay = relays.get(keyOf(token, channel));
  return {
    online: relayOnline(token, Date.now(), channel),
    lastPollAt: relay?.lastPollAt || 0,
    moengage: relay?.status || null,
  };
}

/**
 * Окно связи спрашивает: «есть для меня работа?» Ждёт до 20 секунд.
 * @returns {Promise<object|null>} команда или null, если работы не было
 */
export function pollRelay(token, status = null, { waitMs = POLL_WAIT_MS, channel = "moengage" } = {}) {
  const relay = relayFor(token, channel);
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
export function resolveRelay(token, id, payload = {}, channel = "moengage") {
  const relay = relays.get(keyOf(token, channel));
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
export function callRelay(token, tool, args = {}, { timeoutMs = 90_000, channel = "moengage" } = {}) {
  if (!relayOnline(token, Date.now(), channel)) {
    return Promise.resolve({
      ok: false,
      error: channel === "constructor"
        ? "Конструктор не открыт. Попросите человека открыть конструктор студии в этом же браузере (вкладку можно не трогать)."
        : "Расширение RetKit не на связи. Попросите человека открыть письмо в MoEngage, " +
          "открыть RetKit и нажать в нём кнопку «Агент» (откроется маленькое окно связи — его не закрывать).",
    });
  }
  const relay = relayFor(token, channel);
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
