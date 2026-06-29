#!/usr/bin/env node
/**
 * scripts/preview-sliced-blocks.mjs
 *
 * Takes the JSON produced by slice-mail-to-blocks.mjs and, for every SECTION
 * block, runs it through the real build-mail.js pipeline (scaffold → compile
 * Pug+Stylus → dist HTML). Captures pass/fail and the rendered <body> so we can
 * assemble a visual review gallery.
 *
 * Output:
 *   - data/imports/sliced/<file>.preview.json  (pass/fail + sizes)
 *   - data/imports/sliced/<file>.review.html   (visual gallery, open in browser)
 *
 * Usage:
 *   node scripts/preview-sliced-blocks.mjs data/imports/sliced/X_IQ__mail-rfm-segmentation-2-232.json
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, readdirSync, statSync } from "node:fs";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import url from "node:url";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const emailBase = path.join(repoRoot, "email-base");
const TEMPLATE_SOURCE = path.join(emailBase, "X_IQBroker", "mail-welcome");
const TEMP_ROOT = path.join(os.tmpdir(), "retkit-sliced-preview");
const OUTPUT_CATEGORY = "_slicedpreview";

function setupTempRoot() {
  try { rmSync(TEMP_ROOT, { recursive: true, force: true }); } catch {}
  mkdirSync(path.join(TEMP_ROOT, OUTPUT_CATEGORY), { recursive: true });
  for (const item of ["vendor", "tools", "node_modules"]) {
    const src = path.join(emailBase, item);
    const dst = path.join(TEMP_ROOT, item);
    if (existsSync(src) && !existsSync(dst)) {
      try { require("node:fs").symlinkSync(src, dst, "dir"); }
      catch { if (item !== "node_modules") require("node:fs").cpSync(src, dst, { recursive: true }); }
    }
  }
}

function copyTemplateSkippingDist(src, dst) {
  if (!existsSync(dst)) mkdirSync(dst, { recursive: true });
  for (const e of readdirSync(src, { withFileTypes: true })) {
    if (e.name === "dist") continue;
    const sp = path.join(src, e.name), dp = path.join(dst, e.name);
    if (e.isDirectory()) copyTemplateSkippingDist(sp, dp);
    else if (e.isFile() && !/\.jade$/i.test(e.name)) require("node:fs").copyFileSync(sp, dp);
  }
}

// Replace ${{ ns.block_NN }}$ tokens with readable sample text for preview only.
function sampleForToken(block, category) {
  const n = block || "";
  if (/title/i.test(n)) return "Заголовок секции письма";
  if (/block_0?1$/.test(n)) return "Заголовок секции письма";
  return "Образец текста блока для предпросмотра вёрстки и адаптива.";
}
function fillSampleText(pug) {
  return pug.replace(/\$\{\{\s*([\w-]+)\.([\w-]+)\s*\}\}\$/g, (_, ns, block) => sampleForToken(block, ns));
}

function scaffoldMail(id, pug, styl) {
  const dest = path.join(TEMP_ROOT, OUTPUT_CATEGORY, `mail-${id}`);
  try { rmSync(dest, { recursive: true, force: true }); } catch {}
  copyTemplateSkippingDist(TEMPLATE_SOURCE, dest);
  const headerPath = path.join(dest, "app", "templates", "blocks", "header.pug");
  writeFileSync(headerPath, fillSampleText(pug) + "\n", "utf8");
  const jadeHeader = path.join(dest, "app", "templates", "blocks", "header.jade");
  if (existsSync(jadeHeader)) rmSync(jadeHeader, { force: true });
  // append block CSS to blocks/main.styl (framework helpers already there)
  const mainStyl = path.join(dest, "app", "styles", "blocks", "main.styl");
  let base = "";
  try { base = readFileSync(mainStyl, "utf8"); } catch {}
  writeFileSync(mainStyl, base + "\n\n/* sliced block css */\n" + (styl || ""), "utf8");
  return dest;
}

function runBuild(id) {
  return new Promise((resolve) => {
    const args = ["tools/build-mail.js", "--category", OUTPUT_CATEGORY, "--mail", id, "--locales", "en", "--pretty"];
    const child = spawn("node", args, { cwd: TEMP_ROOT, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", (d) => stdout += d);
    child.stderr.on("data", (d) => stderr += d);
    const to = setTimeout(() => { try { child.kill("SIGKILL"); } catch {} }, 30000);
    child.on("close", (code) => { clearTimeout(to); resolve({ code, stdout, stderr }); });
    child.on("error", (err) => { clearTimeout(to); resolve({ code: -1, stdout, stderr: String(err.message || err) }); });
  });
}

function readDistBody(id) {
  const distHtml = path.join(TEMP_ROOT, "dist", OUTPUT_CATEGORY, `mail-${id}`, "en", "index.html");
  if (!existsSync(distHtml)) return { ok: false, reason: "no dist HTML", html: "" };
  const html = readFileSync(distHtml, "utf8");
  if (html.length < 400) return { ok: false, reason: `too short (${html.length}b)`, html };
  return { ok: true, size: html.length, html };
}

function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

async function main() {
  const inFile = process.argv[2];
  if (!inFile || !existsSync(inFile)) { console.error("usage: node scripts/preview-sliced-blocks.mjs <sliced.json>"); process.exit(1); }
  const data = JSON.parse(readFileSync(inFile, "utf8"));
  setupTempRoot();

  const results = [];
  for (let bi = 0; bi < data.blocks.length; bi++) {
    const b = data.blocks[bi];
    const id = `b${bi}`;
    scaffoldMail(id, b.pug, b.styl);
    const build = await runBuild(id);
    const dist = readDistBody(id);
    const mediaCount = (b.styl.match(/@media/g) || []).length;
    const pass = build.code === 0 && dist.ok;
    results.push({
      index: bi, label: b.label, placement: b.placement, category: b.category,
      classes: b.classes.length, slots: b.slots.length, stylBytes: b.styl.length,
      mediaQueries: mediaCount, inlineChildren: b.inlineChildren.length,
      pass, reason: pass ? "" : (dist.reason || (build.stderr || "").split("\n").filter(Boolean).slice(-1)[0] || `exit ${build.code}`),
      html: dist.html,
    });
    console.log(`[${pass ? "PASS" : "FAIL"}] block ${bi} «${b.label}» (${b.placement}/${b.category}) media:${mediaCount}${pass ? "" : "  ← " + results[results.length - 1].reason}`);
  }

  // preview JSON (no html)
  const previewJson = { ...data, validatedAt: new Date().toISOString(), results: results.map(({ html, ...r }) => r) };
  const pjPath = inFile.replace(/\.json$/, ".preview.json");
  writeFileSync(pjPath, JSON.stringify(previewJson, null, 2) + "\n", "utf8");

  // review gallery HTML
  const cards = results.map((r) => {
    const bodyMatch = r.html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
    const iframeDoc = r.html ? r.html : `<p>${esc(r.reason)}</p>`;
    return `
    <div class="card ${r.pass ? "pass" : "fail"}">
      <div class="meta">
        <span class="badge">${r.index}</span>
        <strong>${esc(r.label)}</strong>
        <span class="tag">${r.placement} · ${r.category}</span>
        <span class="nums">classes ${r.classes} · slots ${r.slots} · css ${r.stylBytes}b · @media ${r.mediaQueries} · inline ${r.inlineChildren}</span>
        <span class="status">${r.pass ? "✓ собралось" : "✗ " + esc(r.reason)}</span>
      </div>
      <iframe srcdoc="${esc(iframeDoc)}" sandbox></iframe>
    </div>`;
  }).join("\n");

  const passCount = results.filter((r) => r.pass).length;
  const gallery = `<!doctype html><html lang="ru"><head><meta charset="utf-8">
<title>Распиловка ${esc(data.category)}/mail-${esc(data.mailId)}</title>
<style>
  body { font: 14px/1.5 -apple-system, "Segoe UI", Roboto, sans-serif; margin: 0; background: #0f1115; color: #e6e8ee; }
  header { padding: 18px 24px; background: #161922; border-bottom: 1px solid #262b38; position: sticky; top: 0; }
  header h1 { margin: 0 0 4px; font-size: 18px; }
  header .sum { color: #9aa3b2; font-size: 13px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 18px; padding: 24px; }
  .card { background: #161922; border: 1px solid #262b38; border-radius: 12px; overflow: hidden; }
  .card.fail { border-color: #5a2330; }
  .meta { padding: 12px 14px; display: flex; flex-direction: column; gap: 4px; border-bottom: 1px solid #262b38; }
  .meta strong { font-size: 14px; }
  .badge { display: inline-block; background: #2a3142; border-radius: 6px; padding: 1px 7px; font-size: 12px; color: #9aa3b2; width: fit-content; }
  .tag { color: #6fb1ff; font-size: 12px; }
  .nums { color: #8a93a5; font-size: 11px; }
  .status { font-size: 12px; }
  .card.pass .status { color: #5fd08a; }
  .card.fail .status { color: #ff7a90; }
  iframe { width: 100%; height: 380px; border: 0; background: #fff; }
</style></head><body>
<header>
  <h1>Распиловка ${esc(data.category)}/mail-${esc(data.mailId)}</h1>
  <div class="sum">${passCount}/${results.length} section-блоков собрались · каждый блок несёт свой CSS + @media (адаптив)</div>
</header>
<div class="grid">${cards}</div>
</body></html>`;
  const ghPath = inFile.replace(/\.json$/, ".review.html");
  writeFileSync(ghPath, gallery, "utf8");

  console.log(`\n${passCount}/${results.length} blocks built OK`);
  console.log(`→ ${path.relative(repoRoot, pjPath)}`);
  console.log(`→ ${path.relative(repoRoot, ghPath)}`);
}

import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
main().catch((e) => { console.error(e); process.exit(1); });
