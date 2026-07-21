/**
 * studio-smoke.mjs — быстрый smoke текущего ядра студии.
 *
 * Проверяет живой сервер (или сам поднимает его на время прогона):
 *   1. /api/status отвечает
 *   2. /api/wb/emails — база отдаёт бренды и письма
 *   3. /api/blocks-library — библиотека блоков не пустая
 *   4. /api/placeholders — реестр плейсхолдеров доступен
 *   5. Round-trip: parse-email существующего письма → compose-save в X_preview
 *      → собранный HTML доступен через /api/wb/code-html → уборка за собой.
 *
 * Легаси-сценарии старого chat-flow (X_AffSystem / figma) удалены вместе с
 * зачисткой базы 2026-07-15 — прошлая версия лежит в git-истории.
 */
import assert from "node:assert/strict";
import path from "node:path";
import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, "..");
const port = Number(process.env.PORT || 3000);
const studioUrl = process.env.STUDIO_URL || `http://127.0.0.1:${port}`;
const SMOKE_MAIL = `smoke-roundtrip-${Date.now()}`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchJson(pathname, options = {}) {
  const response = await fetch(`${studioUrl}${pathname}`, {
    method: options.method || "GET",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    body: options.body,
  });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${pathname}${text ? ` :: ${text.slice(0, 200)}` : ""}`);
  }
  return data;
}

async function isStudioUp() {
  try { await fetchJson("/api/status"); return true; } catch { return false; }
}

let spawnedServer = null;
async function ensureStudio() {
  if (await isStudioUp()) return;
  console.log(`· студия не запущена — поднимаю node server.js (порт ${port})…`);
  spawnedServer = spawn(process.execPath, ["server.js"], {
    cwd: projectRoot,
    stdio: ["ignore", "ignore", "pipe"],
    env: { ...process.env, PORT: String(port) },
  });
  let stderr = "";
  spawnedServer.stderr.on("data", (d) => { stderr += d.toString(); });
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await sleep(700);
    if (await isStudioUp()) return;
    if (spawnedServer.exitCode !== null) break;
  }
  throw new Error(`сервер не поднялся: ${stderr.slice(0, 400)}`);
}

function stopStudio() {
  if (spawnedServer && spawnedServer.exitCode === null) spawnedServer.kill();
}

async function cleanupSmokeMail() {
  for (const folder of [
    path.join(projectRoot, "email-base", "X_preview", `mail-${SMOKE_MAIL}`),
    path.join(projectRoot, "email-base", "dist", "X_preview", `mail-${SMOKE_MAIL}`),
  ]) {
    await rm(folder, { recursive: true, force: true }).catch((error) => {
      console.warn(`⚠ не удалось убрать за собой ${folder}: ${error.message} — удалите вручную`);
    });
  }
}

const results = [];
async function check(label, fn) {
  try {
    const detail = await fn();
    results.push({ label, ok: true });
    console.log(`PASS ${label}${detail ? ` — ${detail}` : ""}`);
  } catch (error) {
    results.push({ label, ok: false });
    console.error(`FAIL ${label} — ${error.message}`);
  }
}

await ensureStudio();
try {
  await check("status", async () => {
    await fetchJson("/api/status");
  });

  let firstBuilt = null;
  await check("email-base list", async () => {
    const data = await fetchJson("/api/wb/emails");
    assert.equal(data.ok, true);
    const brands = (data.emails || []).map((g) => g.brand);
    assert.ok(brands.length >= 1, "нет ни одного бренда");
    for (const group of data.emails || []) {
      const built = (group.mails || []).find((m) => m.built);
      if (built && !firstBuilt) firstBuilt = { brand: group.brand, mail: built.name };
    }
    assert.ok(firstBuilt, "нет ни одного собранного письма");
    return `бренды: ${brands.join(", ")}`;
  });

  await check("blocks library", async () => {
    const data = await fetchJson("/api/blocks-library");
    const count = (data.blocks || []).length;
    assert.ok(count > 0, "библиотека блоков пустая");
    return `${count} блоков`;
  });

  await check("placeholders registry", async () => {
    const data = await fetchJson("/api/placeholders");
    assert.ok(Array.isArray(data.groups), "нет groups");
    return `${data.groups.length} групп`;
  });

  let parsedBlocks = null;
  let parsedSource = null;
  await check("parse-email", async () => {
    const { brand, mail } = firstBuilt;
    const data = await fetchJson(`/api/constructor/parse-email?brand=${encodeURIComponent(brand)}&mail=${encodeURIComponent(mail)}`);
    assert.equal(data.ok, true, data.error || "parse failed");
    const blocks = data.source === "studio-model" ? (data.entries || data.blocks) : data.blocks;
    assert.ok(Array.isArray(blocks) && blocks.length, "письмо разобралось в 0 блоков");
    parsedBlocks = data;
    parsedSource = firstBuilt;
    return `${brand}/${mail} → ${blocks.length} блоков (${data.source})`;
  });

  await check("compose-save round-trip", async () => {
    assert.ok(parsedBlocks, "нет разобранных блоков из предыдущего шага");
    let payloadBlocks;
    if (parsedBlocks.source === "studio-model") {
      payloadBlocks = (parsedBlocks.entries || parsedBlocks.blocks).map((entry) => ({
        ...entry,
        id: entry.blockId || entry.id,
      }));
    } else {
      payloadBlocks = parsedBlocks.blocks.map((b, i) => ({
        uid: i + 1,
        blockId: b.id,
        id: b.id,
        source: b.source || "parsed",
        parentUid: null,
        slotId: null,
        slots: {},
        def: {
          id: b.id, label: b.label, placement: b.placement, category: b.category,
          pug: b.pug, styl: b.styl || "", slots: b.slots || [], childSlots: b.childSlots || [],
        },
      }));
    }
    const data = await fetchJson("/api/compose-save", {
      method: "POST",
      body: JSON.stringify({
        brand: "X_preview",
        mailName: SMOKE_MAIL,
        blocks: payloadBlocks,
        force: true,
        sourceBrand: parsedSource.brand,
        sourceMail: parsedSource.mail,
      }),
    });
    assert.equal(data.ok, true, data.error || "compose-save failed");
    return `сохранено и собрано: ${data.path || data.mail}`;
  });

  await check("built html readable", async () => {
    const workspace = await fetchJson(`/api/wb/code-workspace?brand=X_preview&mail=mail-${SMOKE_MAIL}`);
    assert.equal(workspace.ok, true, workspace.error || "no workspace");
    const locale = workspace.defaultLocale || workspace.locales?.[0]?.code;
    assert.ok(locale, "нет локалей у собранного письма");
    const html = await fetchJson(`/api/wb/code-html?brand=X_preview&mail=mail-${SMOKE_MAIL}&locale=${encodeURIComponent(locale)}`);
    assert.equal(html.ok, true, html.error || "no html");
    assert.ok(String(html.html || "").length > 500, "собранный HTML подозрительно маленький");
    return `${locale}: ${String(html.html).length} байт`;
  });
} finally {
  await cleanupSmokeMail();
  stopStudio();
}

const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `\n✗ smoke: ${failed.length} из ${results.length} проверок упало` : `\n✓ smoke: все ${results.length} проверок прошли`);
process.exit(failed.length ? 1 : 0);
