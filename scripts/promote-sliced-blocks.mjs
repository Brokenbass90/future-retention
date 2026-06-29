#!/usr/bin/env node
/**
 * scripts/promote-sliced-blocks.mjs
 *
 * Reads every per-mail JSON produced by slice-mail-to-blocks.mjs, DEDUPLICATES
 * blocks by their normalized Pug skeleton (layout), tokenizes content into
 * editable slots, VALIDATES each unique block through the real build-mail.js
 * pipeline, and writes the survivors to data/block-library/imported/<id>.json
 * in the canonical block schema. Builds data/block-library/imported/index.json.
 *
 * Usage:
 *   node scripts/promote-sliced-blocks.mjs --category X_IQ
 *   node scripts/promote-sliced-blocks.mjs --category X_IQ --no-validate   (faster)
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, readdirSync, copyFileSync, symlinkSync, cpSync } from "node:fs";
import { spawn } from "node:child_process";
import os from "node:os";
import crypto from "node:crypto";
import path from "node:path";
import url from "node:url";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const emailBase = path.join(repoRoot, "email-base");
const slicedDir = path.join(repoRoot, "data", "imports", "sliced");
const importedDir = path.join(repoRoot, "data", "block-library", "imported");
const TEMPLATE_SOURCE = path.join(emailBase, "X_IQBroker", "mail-welcome");
const TEMP_ROOT = path.join(os.tmpdir(), "retkit-promote");
const OUTPUT_CATEGORY = "_promote";

// ─── args ────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const category = (() => { const i = argv.indexOf("--category"); return i >= 0 ? argv[i + 1] : "X_IQ"; })();
const validate = !argv.includes("--no-validate");

// ─── content tokenization → slots ─────────────────────────────────────────
// Replace locale text tokens, hrefs and image srcs with {{ slot }} tokens
// (compose pipeline substitutes these) + sample defaults so blocks render
// standalone and are editable in the constructor inspector.
function tokenize(pug) {
  const slots = [];
  let out = pug;
  let ti = 0, hi = 0, ii = 0;

  // locale text tokens ${{ ns.block_NN }}$ → {{ text_N }}
  const textTokens = new Map();
  out = out.replace(/\$\{\{\s*([\w-]+)\.([\w-]+)\s*\}\}\$/g, (m) => {
    if (!textTokens.has(m)) {
      const id = `text_${++ti}`;
      textTokens.set(m, id);
      slots.push({ id, kind: "richText", label: `Текст ${ti}`, default: ti === 1 ? "Заголовок блока" : "Текст блока — отредактируйте под кампанию." });
    }
    return `{{ ${textTokens.get(m)} }}`;
  });

  // hrefs (skip "#")
  const hrefMap = new Map();
  out = out.replace(/href\s*=\s*"([^"]*)"/g, (m, u) => {
    if (u === "#" || !u.trim()) return m;
    if (!hrefMap.has(u)) { const id = `href_${++hi}`; hrefMap.set(u, id); slots.push({ id, kind: "url", label: `Ссылка ${hi}`, default: u }); }
    return `href="{{ ${hrefMap.get(u)} }}"`;
  });

  // image srcs
  const srcMap = new Map();
  out = out.replace(/\bsrc\s*=\s*"([^"]*)"/g, (m, u) => {
    if (!srcMap.has(u)) { const id = `image_${++ii}`; srcMap.set(u, id); slots.push({ id, kind: "image", label: `Картинка ${ii}`, default: u }); }
    return `src="{{ ${srcMap.get(u)} }}"`;
  });

  return { pug: out, slots };
}

// ─── dedup key: normalized layout skeleton ────────────────────────────────
function skeleton(pug) {
  return pug
    .replace(/\$\{\{[^}]*\}\}\$/g, "T")          // locale tokens
    .replace(/\{\{[^}]*\}\}/g, "T")              // slot tokens
    .replace(/href\s*=\s*"[^"]*"/g, 'href="U"')  // urls
    .replace(/\bsrc\s*=\s*"[^"]*"/g, 'src="I"')  // images
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}
function hash(s) { return crypto.createHash("sha1").update(s).digest("hex").slice(0, 10); }

// ─── validation harness (scaffold + build) ────────────────────────────────
function setupTempRoot() {
  try { rmSync(TEMP_ROOT, { recursive: true, force: true }); } catch {}
  mkdirSync(path.join(TEMP_ROOT, OUTPUT_CATEGORY), { recursive: true });
  for (const item of ["vendor", "tools", "node_modules"]) {
    const src = path.join(emailBase, item), dst = path.join(TEMP_ROOT, item);
    if (existsSync(src) && !existsSync(dst)) { try { symlinkSync(src, dst, "dir"); } catch { if (item !== "node_modules") cpSync(src, dst, { recursive: true }); } }
  }
}
function copyTemplateSkippingDist(src, dst) {
  if (!existsSync(dst)) mkdirSync(dst, { recursive: true });
  for (const e of readdirSync(src, { withFileTypes: true })) {
    if (e.name === "dist") continue;
    const sp = path.join(src, e.name), dp = path.join(dst, e.name);
    if (e.isDirectory()) copyTemplateSkippingDist(sp, dp);
    else if (e.isFile() && !/\.jade$/i.test(e.name)) copyFileSync(sp, dp);
  }
}
function fillDefaults(pug, slots) {
  let out = pug;
  for (const s of slots) out = out.replace(new RegExp(`\\{\\{\\s*${s.id}\\s*\\}\\}`, "g"), String(s.default ?? "X"));
  return out;
}
function runBuild(id) {
  return new Promise((resolve) => {
    const child = spawn("node", ["tools/build-mail.js", "--category", OUTPUT_CATEGORY, "--mail", id, "--locales", "en", "--pretty"], { cwd: TEMP_ROOT, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (d) => stderr += d);
    const to = setTimeout(() => { try { child.kill("SIGKILL"); } catch {} }, 30000);
    child.on("close", (code) => { clearTimeout(to); resolve({ code, stderr }); });
    child.on("error", (err) => { clearTimeout(to); resolve({ code: -1, stderr: String(err.message || err) }); });
  });
}
async function validateBlock(block) {
  const id = "v" + block.hash;
  const dest = path.join(TEMP_ROOT, OUTPUT_CATEGORY, `mail-${id}`);
  try { rmSync(dest, { recursive: true, force: true }); } catch {}
  copyTemplateSkippingDist(TEMPLATE_SOURCE, dest);
  const headerPath = path.join(dest, "app", "templates", "blocks", "header.pug");
  writeFileSync(headerPath, fillDefaults(block.pug, block.slots) + "\n", "utf8");
  const jadeHeader = path.join(dest, "app", "templates", "blocks", "header.jade");
  if (existsSync(jadeHeader)) rmSync(jadeHeader, { force: true });
  const mainStyl = path.join(dest, "app", "styles", "blocks", "main.styl");
  let base = ""; try { base = readFileSync(mainStyl, "utf8"); } catch {}
  writeFileSync(mainStyl, base + "\n/* block */\n" + (block.styl || ""), "utf8");
  const r = await runBuild(id);
  const distHtml = path.join(TEMP_ROOT, "dist", OUTPUT_CATEGORY, `mail-${id}`, "en", "index.html");
  const ok = r.code === 0 && existsSync(distHtml) && readFileSync(distHtml, "utf8").length > 400;
  return { ok, reason: ok ? "" : (r.stderr.split("\n").filter(Boolean).slice(-1)[0] || `exit ${r.code}`) };
}

// ─── main ──────────────────────────────────────────────────────────────────
function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""); }

async function main() {
  const files = readdirSync(slicedDir).filter((f) => f.startsWith(`${category}__`) && f.endsWith(".json") && !f.endsWith("preview.json"));
  // gather candidates: section blocks + inline children
  const candidates = [];
  for (const f of files) {
    const data = JSON.parse(readFileSync(path.join(slicedDir, f), "utf8"));
    const mailRef = `${data.category}/mail-${data.mailId}`;
    for (const b of data.blocks) {
      if (b.kind === "empty") continue;
      candidates.push({ ...b, mailRef, scope: "section" });
      for (const c of b.inlineChildren || []) candidates.push({ ...c, mailRef, scope: "inline" });
    }
  }

  // dedup by skeleton
  const byKey = new Map();
  for (const c of candidates) {
    const key = (c.placement || "") + "|" + skeleton(c.pug);
    if (!byKey.has(key)) byKey.set(key, { rep: c, count: 0, mails: new Set() });
    const e = byKey.get(key);
    e.count += 1; e.mails.add(c.mailRef);
  }

  // build canonical blocks
  const catCounters = {};
  const blocks = [];
  for (const [key, e] of byKey) {
    const rep = e.rep;
    // skip degenerate: empty pug or no design + no slots + not a recognized utility
    const isSpacer = /^\.h-\d+/.test(rep.pug.trim());
    if (!rep.pug.trim()) continue;
    const cat = rep.category || "section";
    catCounters[cat] = (catCounters[cat] || 0) + 1;
    const { pug, slots } = isSpacer ? { pug: rep.pug, slots: [] } : tokenize(rep.pug);
    const h = hash(key);
    const id = `iq-${slug(cat)}-${String(catCounters[cat]).padStart(2, "0")}`;
    blocks.push({
      id,
      hash: h,
      label: rep.label || cat,
      description: `Импортирован из X_IQ (${e.count} писем). ${rep.scope === "inline" ? "Inline-элемент." : "Секция."}`,
      placement: rep.placement || (rep.scope === "inline" ? "inline" : "section"),
      category: cat,
      version: 1,
      source: "imported",
      pug,
      styl: rep.styl || "",
      slots,
      tags: Array.from(new Set([cat, rep.scope, "X_IQ"])),
      usageCount: e.count,
      sourceMails: Array.from(e.mails).sort().slice(0, 20),
      createdAt: new Date().toISOString(),
    });
  }

  // sort: section first, by usage desc
  blocks.sort((a, b) => (a.placement === b.placement ? b.usageCount - a.usageCount : a.placement === "section" ? -1 : 1));

  // validate
  let passed = blocks, failed = [];
  if (validate) {
    setupTempRoot();
    passed = []; failed = [];
    for (const b of blocks) {
      const r = await validateBlock(b);
      if (r.ok) { b.validated = true; passed.push(b); }
      else { b.validated = false; b.failReason = r.reason; failed.push(b); }
    }
  }

  // write library
  mkdirSync(importedDir, { recursive: true });
  // clear previous imported (best-effort)
  for (const f of readdirSync(importedDir)) { if (f.endsWith(".json") && f !== "index.json") { try { rmSync(path.join(importedDir, f)); } catch {} } }
  const index = [];
  for (const b of passed) {
    const { hash: _h, failReason, ...clean } = b;
    writeFileSync(path.join(importedDir, `${b.id}.json`), JSON.stringify(clean, null, 2) + "\n", "utf8");
    index.push({ id: b.id, label: b.label, placement: b.placement, category: b.category, usageCount: b.usageCount, slots: b.slots.length, hasMedia: /@media/.test(b.styl) });
  }
  writeFileSync(path.join(importedDir, "index.json"), JSON.stringify({ generatedAt: new Date().toISOString(), category, count: index.length, blocks: index }, null, 2) + "\n", "utf8");

  // report
  console.log(`\ncandidates: ${candidates.length}  →  unique skeletons: ${byKey.size}  →  promoted: ${passed.length}${validate ? `  (failed validation: ${failed.length})` : " (not validated)"}`);
  const byCat = {};
  for (const b of passed) { byCat[b.category] = (byCat[b.category] || 0) + 1; }
  console.log("by category:", JSON.stringify(byCat));
  if (failed.length) console.log("failed:", failed.map((b) => `${b.id}(${b.failReason})`).slice(0, 15).join(", "));
  console.log(`→ ${path.relative(repoRoot, importedDir)}/  (+ index.json)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
