#!/usr/bin/env node
/**
 * scripts/render-library-gallery.mjs
 * Renders a visual gallery of the imported block library: the top-by-usage
 * blocks per category are built through build-mail.js and shown as live cards;
 * the full catalog is listed below. Output: data/imports/library-gallery.html
 *
 *   node scripts/render-library-gallery.mjs [--per-category 3]
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
const TEMP_ROOT = path.join(os.tmpdir(), "retkit-gallery");
const OUT_CAT = "_gallery";
const perCat = Number((() => { const i = process.argv.indexOf("--per-category"); return i >= 0 ? process.argv[i + 1] : 3; })());

function setup() {
  try { rmSync(TEMP_ROOT, { recursive: true, force: true }); } catch {}
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
    if (e.isDirectory()) copyTpl(sp, dp); else if (e.isFile() && !/\.jade$/i.test(e.name)) copyFileSync(sp, dp);
  }
}
function fill(pug, slots) { let o = pug; for (const s of slots || []) o = o.replace(new RegExp(`\\{\\{\\s*${s.id}\\s*\\}\\}`, "g"), String(s.default ?? "X")); return o; }
function build(id) {
  return new Promise((res) => {
    const c = spawn("node", ["tools/build-mail.js", "--category", OUT_CAT, "--mail", id, "--locales", "en", "--pretty"], { cwd: TEMP_ROOT, stdio: ["ignore", "ignore", "ignore"] });
    const to = setTimeout(() => { try { c.kill("SIGKILL"); } catch {} }, 25000);
    c.on("close", (code) => { clearTimeout(to); res(code); });
    c.on("error", () => { clearTimeout(to); res(-1); });
  });
}
function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }

async function renderBlock(probe, b) {
  writeFileSync(probe.header, fill(b.pug, b.slots) + "\n", "utf8");
  writeFileSync(probe.styl, probe.base + "\n/* block */\n" + (b.styl || ""), "utf8");
  await build(probe.id);
  const dist = path.join(TEMP_ROOT, "dist", OUT_CAT, `mail-${probe.id}`, "en", "index.html");
  return existsSync(dist) ? readFileSync(dist, "utf8") : "";
}

async function main() {
  const index = JSON.parse(readFileSync(path.join(importedDir, "index.json"), "utf8")).blocks;
  const byCat = {};
  for (const b of index) (byCat[b.category] ||= []).push(b);
  const featured = [];
  for (const cat of Object.keys(byCat)) featured.push(...byCat[cat].sort((a, b) => b.usageCount - a.usageCount).slice(0, perCat));

  setup();
  const probe = (() => {
    const id = "g", dest = path.join(TEMP_ROOT, OUT_CAT, `mail-${id}`);
    copyTpl(TEMPLATE_SOURCE, dest);
    const jh = path.join(dest, "app", "templates", "blocks", "header.jade"); if (existsSync(jh)) rmSync(jh, { force: true });
    const styl = path.join(dest, "app", "styles", "blocks", "main.styl");
    let base = ""; try { base = readFileSync(styl, "utf8"); } catch {}
    return { id, header: path.join(dest, "app", "templates", "blocks", "header.pug"), styl, base };
  })();

  const cards = [];
  for (const meta of featured) {
    const b = JSON.parse(readFileSync(path.join(importedDir, `${meta.id}.json`), "utf8"));
    const html = await renderBlock(probe, b);
    cards.push(`<div class="card"><div class="m"><span class="b">${esc(b.id)}</span><strong>${esc(b.label)}</strong>
      <span class="t">${b.placement} · ${b.category} · в ${b.usageCount} письмах · слотов ${b.slots.length}${/@media/.test(b.styl) ? " · 📱 адаптив" : ""}</span></div>
      <iframe srcdoc="${esc(html)}" sandbox></iframe></div>`);
  }

  const rows = index.map((b) => `<tr><td>${esc(b.id)}</td><td>${esc(b.label)}</td><td>${b.placement}</td><td>${b.category}</td><td>${b.usageCount}</td><td>${b.slots}</td><td>${b.hasMedia ? "📱" : ""}</td></tr>`).join("");

  const out = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Библиотека блоков X_IQ</title>
<style>
 body{font:14px/1.5 -apple-system,"Segoe UI",Roboto,sans-serif;margin:0;background:#0f1115;color:#e6e8ee}
 header{padding:18px 24px;background:#161922;border-bottom:1px solid #262b38;position:sticky;top:0;z-index:5}
 header h1{margin:0 0 4px;font-size:18px} .sum{color:#9aa3b2;font-size:13px}
 h2{padding:18px 24px 0;font-size:15px;color:#cdd3df}
 .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:18px;padding:18px 24px}
 .card{background:#161922;border:1px solid #262b38;border-radius:12px;overflow:hidden}
 .m{padding:11px 13px;display:flex;flex-direction:column;gap:3px;border-bottom:1px solid #262b38}
 .b{background:#2a3142;border-radius:6px;padding:1px 7px;font-size:11px;color:#9aa3b2;width:fit-content}
 .t{color:#8a93a5;font-size:11px} .m strong{font-size:13px}
 iframe{width:100%;height:340px;border:0;background:#fff}
 table{width:calc(100% - 48px);margin:8px 24px 40px;border-collapse:collapse;font-size:12px}
 th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #222734} th{color:#9aa3b2;position:sticky;top:64px;background:#0f1115}
 td:nth-child(5){color:#6fb1ff}
</style></head><body>
<header><h1>Библиотека блоков X_IQ — распиловка 45 писем</h1>
<div class="sum">${index.length} валидных блоков · собраны реальной сборкой Pug+Stylus · каждый несёт свой CSS + адаптив · доступны в DnD-конструкторе и AI</div></header>
<h2>Витрина (топ ${perCat} по частоте на категорию)</h2>
<div class="grid">${cards.join("\n")}</div>
<h2>Полный каталог (${index.length})</h2>
<table><thead><tr><th>id</th><th>label</th><th>placement</th><th>категория</th><th>писем</th><th>слотов</th><th>адаптив</th></tr></thead><tbody>${rows}</tbody></table>
</body></html>`;
  const outDir = path.join(repoRoot, "data", "imports");
  mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, "library-gallery.html");
  writeFileSync(outFile, out, "utf8");
  console.log(`featured ${featured.length} blocks, catalog ${index.length}`);
  console.log(`→ ${path.relative(repoRoot, outFile)}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
