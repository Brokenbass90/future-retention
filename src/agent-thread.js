/**
 * src/agent-thread.js — один разговор с оператором на обе поверхности.
 *
 * Конструктор и редактор кода говорят с одним и тем же агентом, но раньше
 * каждая страница помнила свою переписку сама: собрал письмо в конструкторе,
 * перешёл в код — а там агент «впервые видит» человека. Теперь переписка
 * хранится на сервере, по одной на человека (метка retkit_actor), и каждая
 * поверхность ещё оставляет короткую записку о себе: что в ней сейчас открыто.
 *
 * Хранится немного: последние MAX_MESSAGES реплик, тексты обрезаны.
 * Это память разговора, а не журнал — журнал студии ведётся отдельно.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import path from "node:path";

export const MAX_MESSAGES = 40;
const MAX_TEXT = 4000;
const SURFACES = new Set(["constructor", "workbench"]);
const SURFACE_LABEL = { constructor: "конструктор", workbench: "код" };

function threadKey(actor) {
  const token = String(actor?.token || "");
  return /^[0-9a-f]{32}$/.test(token) ? token : "local";
}

function threadPath(repoRoot, actor) {
  return path.join(repoRoot, "data", "agent-threads", `${threadKey(actor)}.json`);
}

function empty() {
  return { messages: [], surfaces: {} };
}

export function readThread(repoRoot, actor) {
  const file = threadPath(repoRoot, actor);
  if (!existsSync(file)) return empty();
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    return {
      messages: Array.isArray(parsed?.messages) ? parsed.messages.slice(-MAX_MESSAGES) : [],
      surfaces: parsed?.surfaces && typeof parsed.surfaces === "object" ? parsed.surfaces : {},
    };
  } catch {
    return empty(); // повреждённый файл не должен ронять разговор
  }
}

function writeThread(repoRoot, actor, thread) {
  const file = threadPath(repoRoot, actor);
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({
    messages: thread.messages.slice(-MAX_MESSAGES),
    surfaces: thread.surfaces,
  }, null, 1));
  renameSync(tmp, file);
}

/** Записать реплику человека и ответ оператора. */
export function appendTurn(repoRoot, actor, { surface, user, assistant, at = new Date().toISOString() }) {
  const where = SURFACES.has(surface) ? surface : "workbench";
  const thread = readThread(repoRoot, actor);
  const push = (role, content) => {
    const text = String(content || "").trim();
    if (text) thread.messages.push({ role, content: text.slice(0, MAX_TEXT), surface: where, at });
  };
  push("user", user);
  push("assistant", assistant);
  writeThread(repoRoot, actor, thread);
  return thread;
}

/** Записка поверхности о себе: что в ней сейчас открыто. */
export function noteSurface(repoRoot, actor, surface, state, at = new Date().toISOString()) {
  if (!SURFACES.has(surface)) return;
  const thread = readThread(repoRoot, actor);
  const clean = {};
  for (const [key, value] of Object.entries(state || {})) {
    if (value === undefined || value === null || value === "") continue;
    clean[String(key).slice(0, 40)] = typeof value === "number" ? value : String(value).slice(0, 200);
  }
  thread.surfaces[surface] = { ...clean, at };
  writeThread(repoRoot, actor, thread);
}

export function clearThread(repoRoot, actor) {
  const thread = readThread(repoRoot, actor);
  writeThread(repoRoot, actor, { messages: [], surfaces: thread.surfaces });
}

/** История для модели: реплики с пометкой, где они прозвучали. */
export function historyForModel(thread, limit = 10) {
  return (thread?.messages || []).slice(-limit).map((m) => ({
    role: m.role === "assistant" ? "assistant" : "user",
    content: `[${SURFACE_LABEL[m.surface] || "студия"}] ${m.content}`,
  }));
}

function ago(at, now) {
  const ms = now - Date.parse(at || "");
  if (!Number.isFinite(ms) || ms < 0) return "";
  const min = Math.round(ms / 60000);
  if (min < 1) return "только что";
  if (min < 60) return `${min} мин назад`;
  const h = Math.round(min / 60);
  return h < 48 ? `${h} ч назад` : `${Math.round(h / 24)} дн назад`;
}

/** Что сейчас на другой поверхности — одной строкой для контекста. */
export function describeOtherSurface(thread, surface, now = Date.now()) {
  const other = surface === "constructor" ? "workbench" : "constructor";
  const note = thread?.surfaces?.[other];
  if (!note) return "";
  const parts = Object.entries(note)
    .filter(([key]) => key !== "at")
    .map(([key, value]) => `${key}: ${value}`);
  if (!parts.length) return "";
  return `[Другая поверхность студии — ${SURFACE_LABEL[other]} (${ago(note.at, now) || "давно"}): ${parts.join(", ")}. `
    + "Это тот же человек и тот же разговор; ты — тот же оператор.]";
}

/** Для интерфейса: реплики без служебных полей. */
export function threadForClient(thread) {
  return (thread?.messages || []).map((m) => ({
    role: m.role, content: m.content, surface: m.surface, at: m.at,
  }));
}
