#!/usr/bin/env node
// Validate imported blocks through the real build pipeline, N at a time.
// Re-runnable: skips blocks that already carry a `validated` field.
// Usage: node scripts/validate-imported-chunk.mjs [--limit 40]
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, readdirSync, copyFileSync, symlinkSync, cpSync } from "node:fs";
import { spawn } from "node:child_process";
import os from "node:os"; import path from "node:path"; import url from "node:url";
const here = path.dirname(url.fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const emailBase = path.join(repoRoot, "email-base");
const importedDir = path.join(repoRoot, "data", "block-library", "imported");
const TEMPLATE_SOURCE = path.join(emailBase, "X_IQBroker", "mail-welcome");
const TEMP_ROOT = path.join(os.tmpdir(), "retkit-validate");
const OUT = "_promote";
const limit = (() => { const i = process.argv.indexOf("--limit"); return i >= 0 ? Number(process.argv[i+1]) : 40; })();
function setup() {
  mkdirSync(path.join(TEMP_ROOT, OUT), { recursive: true });
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
function fill(t, slots) { let o = t; for (const s of slots||[]) o = o.replace(new RegExp(`\\{\\{\\s*${s.id}\\s*\\}\\}`, "g"), String(s.default ?? "X")); return o; }
function build(id) {
  return new Promise((res) => {
    const c = spawn("node", ["tools/build-mail.js", "--category", OUT, "--mail", id, "--locales", "en", "--pretty"], { cwd: TEMP_ROOT, stdio: ["ignore", "ignore", "pipe"] });
    let err = ""; c.stderr.on("data", (d) => err += d);
    const to = setTimeout(() => { try { c.kill("SIGKILL"); } catch {} }, 25000);
    c.on("close", (code) => { clearTimeout(to); res({ code, err }); });
    c.on("error", (e) => { clearTimeout(to); res({ code: -1, err: String(e) }); });
  });
}
let seq = 0;
async function buildGroup(blocks) {
  // One scaffold, all blocks concatenated. Scoped CSS makes joint compilation
  // safe; on failure the caller bisects to find the culprit.
  const vid = "g" + (++seq);
  const dest = path.join(TEMP_ROOT, OUT, `mail-${vid}`);
  try { rmSync(dest, { recursive: true, force: true }); } catch {}
  copyTpl(TEMPLATE_SOURCE, dest);
  const pug = blocks.map((b) => fill(b.pug, b.slots)).join("\n");
  writeFileSync(path.join(dest, "app", "templates", "blocks", "header.pug"), pug + "\n");
  const ms = path.join(dest, "app", "styles", "blocks", "main.styl");
  let base = ""; try { base = readFileSync(ms, "utf8"); } catch {}
  const styl = blocks.map((b) => fill(b.styl || "", b.slots)).join("\n");
  writeFileSync(ms, base + "\n/* blocks */\n" + styl);
  const r = await build(vid);
  const distHtml = path.join(TEMP_ROOT, "dist", OUT, `mail-${vid}`, "en", "index.html");
  const ok = r.code === 0 && existsSync(distHtml) && readFileSync(distHtml, "utf8").length > 400;
  return { ok, reason: ok ? "" : (r.err.split("\n").filter(Boolean).slice(-1)[0] || `exit ${r.code}`).slice(0, 200) };
}

async function validateSet(blocks, results, deadline) {
  if (!blocks.length) return;
  if (Date.now() > deadline) return; // leave unvalidated for next run
  const r = await buildGroup(blocks);
  if (r.ok) { for (const b of blocks) results.set(b.id, { ok: true }); return; }
  if (blocks.length === 1) { results.set(blocks[0].id, { ok: false, reason: r.reason }); return; }
  const mid = Math.ceil(blocks.length / 2);
  await validateSet(blocks.slice(0, mid), results, deadline);
  await validateSet(blocks.slice(mid), results, deadline);
}

async function main() {
  setup();
  const files = readdirSync(importedDir).filter((f) => f.endsWith(".json") && f !== "index.json" && !f.startsWith("_"));
  const pending = [];
  for (const f of files) {
    const fp = path.join(importedDir, f);
    const b = JSON.parse(readFileSync(fp, "utf8"));
    if (typeof b.validated === "boolean") continue;
    pending.push({ ...b, __file: fp });
  }
  const deadline = Date.now() + 34000;
  const results = new Map();
  const BATCH = 8;
  for (let i = 0; i < Math.min(pending.length, limit) && Date.now() < deadline; i += BATCH) {
    await validateSet(pending.slice(i, i + BATCH), results, deadline);
  }
  let pass = 0, fail = 0;
  for (const b of pending) {
    const r = results.get(b.id);
    if (!r) continue;
    const { __file, ...clean } = b;
    clean.validated = r.ok;
    if (!r.ok) clean.failReason = r.reason;
    writeFileSync(__file, JSON.stringify(clean, null, 2) + "\n");
    r.ok ? pass++ : fail++;
  }
  console.log(`validated ${pass + fail} (pass ${pass} / fail ${fail}), remaining: ${pending.length - pass - fail}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
