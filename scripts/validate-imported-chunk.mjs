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
async function main() {
  setup();
  const files = readdirSync(importedDir).filter((f) => f.endsWith(".json") && f !== "index.json" && !f.startsWith("_"));
  let done = 0, pass = 0, fail = 0, remaining = 0;
  const t0 = Date.now();
  for (const f of files) {
    const fp = path.join(importedDir, f);
    const b = JSON.parse(readFileSync(fp, "utf8"));
    if (typeof b.validated === "boolean") continue;
    if (done >= limit || Date.now() - t0 > 36000) { remaining++; continue; }
    const vid = "v" + b.id.replace(/[^a-z0-9]/gi, "");
    const dest = path.join(TEMP_ROOT, OUT, `mail-${vid}`);
    try { rmSync(dest, { recursive: true, force: true }); } catch {}
    copyTpl(TEMPLATE_SOURCE, dest);
    writeFileSync(path.join(dest, "app", "templates", "blocks", "header.pug"), fill(b.pug, b.slots) + "\n");
    const ms = path.join(dest, "app", "styles", "blocks", "main.styl");
    let base = ""; try { base = readFileSync(ms, "utf8"); } catch {}
    writeFileSync(ms, base + "\n/* block */\n" + fill(b.styl || "", b.slots));
    const r = await build(vid);
    const distHtml = path.join(TEMP_ROOT, "dist", OUT, `mail-${vid}`, "en", "index.html");
    const ok = r.code === 0 && existsSync(distHtml) && readFileSync(distHtml, "utf8").length > 400;
    b.validated = ok;
    if (!ok) b.failReason = (r.err.split("\n").filter(Boolean).slice(-1)[0] || `exit ${r.code}`).slice(0, 200);
    writeFileSync(fp, JSON.stringify(b, null, 2) + "\n");
    done++; ok ? pass++ : fail++;
  }
  console.log(`validated ${done} (pass ${pass} / fail ${fail}), remaining: ${remaining}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
