#!/usr/bin/env node
/**
 * scripts/validate-imported.mjs — batch validator for data/block-library/imported.
 * Validates a slice [offset, offset+limit) of blocks through build-mail.js and
 * merges pass/fail into data/block-library/imported/_validation.json so it can
 * be run repeatedly (stays under shell time limits).
 *
 *   node scripts/validate-imported.mjs --offset 0 --limit 50
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, readdirSync, copyFileSync, symlinkSync, cpSync } from "node:fs";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import url from "node:url";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const emailBase = path.join(repoRoot, "email-base");
const importedDir = path.join(repoRoot, "data", "block-library", "imported");
const TEMPLATE_SOURCE = path.join(emailBase, "X_IQBroker", "mail-welcome");
const TEMP_ROOT = path.join(os.tmpdir(), "retkit-valimp");
const OUT_CAT = "_valimp";
const valPath = path.join(importedDir, "_validation.json");

const argv = process.argv.slice(2);
const offset = Number((() => { const i = argv.indexOf("--offset"); return i >= 0 ? argv[i + 1] : 0; })());
const limit = Number((() => { const i = argv.indexOf("--limit"); return i >= 0 ? argv[i + 1] : 9999; })());

function setupTempRoot() {
  if (existsSync(TEMP_ROOT)) return;
  mkdirSync(path.join(TEMP_ROOT, OUT_CAT), { recursive: true });
  for (const item of ["vendor", "tools", "node_modules"]) {
    const src = path.join(emailBase, item), dst = path.join(TEMP_ROOT, item);
    if (existsSync(src) && !existsSync(dst)) { try { symlinkSync(src, dst, "dir"); } catch { if (item !== "node_modules") cpSync(src, dst, { recursive: true }); } }
  }
}
function copyTpl(src, dst) {
  if (!existsSync(dst)) mkdirSync(dst, { recursive: true });
  for (const e of readdirSync(src, { withFileTypes: true })) {
    if (e.name === "dist") continue;
    const sp = path.join(src, e.name), dp = path.join(dst, e.name);
    if (e.isDirectory()) copyTpl(sp, dp);
    else if (e.isFile() && !/\.jade$/i.test(e.name)) copyFileSync(sp, dp);
  }
}
function fillDefaults(pug, slots) {
  let out = pug;
  for (const s of slots || []) out = out.replace(new RegExp(`\\{\\{\\s*${s.id}\\s*\\}\\}`, "g"), String(s.default ?? "X"));
  return out;
}
function build(id) {
  return new Promise((res) => {
    const c = spawn("node", ["tools/build-mail.js", "--category", OUT_CAT, "--mail", id, "--locales", "en", "--pretty"], { cwd: TEMP_ROOT, stdio: ["ignore", "ignore", "pipe"] });
    let err = ""; c.stderr.on("data", (d) => err += d);
    const to = setTimeout(() => { try { c.kill("SIGKILL"); } catch {} }, 25000);
    c.on("close", (code) => { clearTimeout(to); res({ code, err }); });
    c.on("error", (e) => { clearTimeout(to); res({ code: -1, err: String(e.message || e) }); });
  });
}

const CONCURRENCY = Number((() => { const i = argv.indexOf("--concurrency"); return i >= 0 ? argv[i + 1] : 5; })());

function makeProbe(slot) {
  const id = `probe${slot}`;
  const dest = path.join(TEMP_ROOT, OUT_CAT, `mail-${id}`);
  if (!existsSync(dest)) copyTpl(TEMPLATE_SOURCE, dest);
  const headerJade = path.join(dest, "app", "templates", "blocks", "header.jade");
  if (existsSync(headerJade)) rmSync(headerJade, { force: true });
  const ms = path.join(dest, "app", "styles", "blocks", "main.styl");
  let baseStyl = ""; try { baseStyl = readFileSync(ms, "utf8"); } catch {}
  return { id, dest, headerPug: path.join(dest, "app", "templates", "blocks", "header.pug"), ms, baseStyl };
}

async function validateOne(probe, b) {
  writeFileSync(probe.headerPug, fillDefaults(b.pug, b.slots) + "\n", "utf8");
  writeFileSync(probe.ms, probe.baseStyl + "\n/* block */\n" + (b.styl || ""), "utf8");
  const r = await build(probe.id);
  const distHtml = path.join(TEMP_ROOT, "dist", OUT_CAT, `mail-${probe.id}`, "en", "index.html");
  const ok = r.code === 0 && existsSync(distHtml) && readFileSync(distHtml, "utf8").length > 400;
  return { ok, reason: ok ? "" : (r.err.split("\n").filter(Boolean).slice(-1)[0] || `exit ${r.code}`).slice(0, 160) };
}

async function main() {
  setupTempRoot();
  const probes = Array.from({ length: CONCURRENCY }, (_, k) => makeProbe(k));
  const files = readdirSync(importedDir).filter((f) => /^iq-.*\.json$/.test(f)).sort();
  const slice = files.slice(offset, offset + limit);
  let results = {};
  if (existsSync(valPath)) { try { results = JSON.parse(readFileSync(valPath, "utf8")).results || {}; } catch {} }
  let cursor = 0, done = 0;
  const flush = () => {
    const passed = Object.values(results).filter((r) => r.ok).length;
    writeFileSync(valPath, JSON.stringify({ updatedAt: new Date().toISOString(), total: Object.keys(results).length, passed, results }, null, 2) + "\n", "utf8");
  };
  async function worker(probe) {
    while (cursor < slice.length) {
      const f = slice[cursor++];
      const b = JSON.parse(readFileSync(path.join(importedDir, f), "utf8"));
      results[b.id] = await validateOne(probe, b);
      if (++done % 5 === 0) flush();
    }
  }
  await Promise.all(probes.map((p) => worker(p)));
  flush();
  const passed = Object.values(results).filter((r) => r.ok).length;
  writeFileSync(valPath, JSON.stringify({ updatedAt: new Date().toISOString(), total: Object.keys(results).length, passed, results }, null, 2) + "\n", "utf8");
  console.log(`validated ${slice.length} (offset ${offset}). cumulative: ${passed}/${Object.keys(results).length} pass`);
}
main().catch((e) => { console.error(e); process.exit(1); });
