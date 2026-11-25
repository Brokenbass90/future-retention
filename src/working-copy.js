/**
 * src/working-copy.js — рабочая копия «В код» переживает деплой.
 *
 * «→ В код» кладёт письмо в служебную базу email-base/X_preview на диске
 * сервера. На Heroku диск временный: деплой или ежедневный перезапуск — и
 * копии нет, а у человека открыт «Код» с этим письмом. Живой случай 02.11:
 * после деплоя «Сохранить» ничего не переносил, сборка падала с «Workbench
 * mail not found», локали не собирались.
 *
 * Решение без базы данных: вкладка «Код» держит у себя снимок копии (исходники
 * письма и тексты его локалей), а когда сервер говорит «письма нет», молча
 * возвращает его на диск и повторяет запрос. Касается только служебного
 * бренда X_preview — настоящая база этим путём не пишется никогда.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { mailPaths } from "./mail-store.js";

export const WORKING_COPY_BRAND = "X_preview";
const SOURCE_EXT = /\.(pug|jade|styl|css|json)$/i;
const MAX_BYTES = 3 * 1024 * 1024;
const SAFE_SEGMENT = /^[A-Za-z0-9._ -]+$/;
const SAFE_NS = /^[A-Za-z0-9_-]+$/;

function safeMail(mail) {
  const value = String(mail || "");
  if (!/^mail-[A-Za-z0-9_.-]+$/.test(value) || value.includes("..")) throw new Error("bad mail name");
  return value;
}

function safeRel(rel) {
  const parts = String(rel || "").split("/");
  if (!parts.length || parts.some((p) => !p || p === "." || p === ".." || !SAFE_SEGMENT.test(p))) throw new Error(`bad path: ${rel}`);
  if (!SOURCE_EXT.test(rel)) throw new Error(`not a source file: ${rel}`);
  return parts.join(path.sep);
}

/** Пространства текстов, на которые ссылается письмо: ${{ ns.block_00 }}$. */
export function namespacesIn(text) {
  const out = new Set();
  for (const m of String(text || "").matchAll(/\$\{\{\s*([A-Za-z0-9_-]+)\.[A-Za-z0-9_]+\s*\}\}\$/g)) out.add(m[1]);
  return [...out];
}

export function snapshotWorkingCopy({ repoRoot, mail }) {
  const name = safeMail(mail);
  const { mailRoot, base } = mailPaths(repoRoot, WORKING_COPY_BRAND, name);
  if (!existsSync(mailRoot)) return { ok: false, missing: true };
  const files = {};
  let bytes = 0;
  let pugText = "";
  const walk = (dir, rel) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "dist") continue;
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(abs, relPath); continue; }
      if (!SOURCE_EXT.test(entry.name) || !SAFE_SEGMENT.test(entry.name)) continue;
      const size = statSync(abs).size;
      if (bytes + size > MAX_BYTES) continue;
      const content = readFileSync(abs, "utf8");
      bytes += size;
      files[relPath] = content;
      if (/\.(pug|jade)$/i.test(entry.name)) pugText += `\n${content}`;
    }
  };
  walk(mailRoot, "");
  // Тексты локалей лежат не в письме, а в общей vendor/data/<locale>/<ns>.json.
  const locales = {};
  const dataRoot = path.join(base, "vendor", "data");
  for (const ns of namespacesIn(pugText)) {
    if (!SAFE_NS.test(ns) || !existsSync(dataRoot)) continue;
    for (const locale of readdirSync(dataRoot)) {
      if (!SAFE_NS.test(locale)) continue;
      const file = path.join(dataRoot, locale, `${ns}.json`);
      if (!existsSync(file)) continue;
      const content = readFileSync(file, "utf8");
      if (bytes + content.length > MAX_BYTES) continue;
      bytes += content.length;
      (locales[ns] ||= {})[locale] = content;
    }
  }
  return { ok: true, brand: WORKING_COPY_BRAND, mail: name, files, locales, bytes, at: Date.now() };
}

/**
 * Вернуть копию на диск. Пишет только туда, где ничего нет: существующее
 * письмо и чужие локали не перезаписываются.
 */
export function restoreWorkingCopy({ repoRoot, mail, snapshot }) {
  const name = safeMail(mail);
  if (snapshot?.mail !== name) throw new Error("snapshot is for another mail");
  const { mailRoot, base } = mailPaths(repoRoot, WORKING_COPY_BRAND, name);
  const restored = { files: 0, locales: 0, skipped: 0 };
  const writeIfMissing = (abs, content) => {
    if (existsSync(abs)) { restored.skipped += 1; return false; }
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, String(content), "utf8");
    return true;
  };
  let total = 0;
  for (const [rel, content] of Object.entries(snapshot?.files || {})) {
    total += String(content).length;
    if (total > MAX_BYTES) throw new Error("snapshot too large");
    if (writeIfMissing(path.join(mailRoot, safeRel(rel)), content)) restored.files += 1;
  }
  const dataRoot = path.join(base, "vendor", "data");
  for (const [ns, perLocale] of Object.entries(snapshot?.locales || {})) {
    if (!SAFE_NS.test(ns)) continue;
    for (const [locale, content] of Object.entries(perLocale || {})) {
      if (!SAFE_NS.test(locale)) continue;
      try { JSON.parse(content); } catch { continue; }
      if (writeIfMissing(path.join(dataRoot, locale, `${ns}.json`), content)) restored.locales += 1;
    }
  }
  return { ok: true, ...restored };
}

export function registerWorkingCopyRoutes(router, { repoRoot, sendJson, readRequestBody }) {
  router.get("/api/wb/working-copy", (request, response) => {
    try {
      const params = new URL(request.url, "http://localhost").searchParams;
      if (params.get("brand") !== WORKING_COPY_BRAND) { sendJson(response, 400, { ok: false, error: "only X_preview working copies" }); return; }
      sendJson(response, 200, snapshotWorkingCopy({ repoRoot, mail: params.get("mail") }));
    } catch (error) { sendJson(response, 400, { ok: false, error: error.message }); }
  });
  router.post("/api/wb/working-copy/restore", async (request, response) => {
    try {
      const body = await readRequestBody(request);
      if (body?.brand !== WORKING_COPY_BRAND) { sendJson(response, 400, { ok: false, error: "only X_preview working copies" }); return; }
      sendJson(response, 200, restoreWorkingCopy({ repoRoot, mail: body?.mail, snapshot: body?.snapshot }));
    } catch (error) { sendJson(response, 400, { ok: false, error: error.message }); }
  });
}
