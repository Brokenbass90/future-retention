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
    .replace(/\.h-\d+/g, ".h-N")                 // spacer heights are content, not layout
    .replace(/\balt\s*=\s*"[^"]*"/g, 'alt="A"') // alt text is content
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
  writeFileSync(mainStyl, base + "\n/* block */\n" + fillDefaults(block.styl || "", block.slots), "utf8");
  const r = await runBuild(id);
  const distHtml = path.join(TEMP_ROOT, "dist", OUTPUT_CATEGORY, `mail-${id}`, "en", "index.html");
  const ok = r.code === 0 && existsSync(distHtml) && readFileSync(distHtml, "utf8").length > 400;
  return { ok, reason: ok ? "" : (r.stderr.split("\n").filter(Boolean).slice(-1)[0] || `exit ${r.code}`) };
}


// ─── CSS scoping (per-block namespace) ─────────────────────────────────────
// Blocks sliced from DIFFERENT mails may define the same class (.banner,
// .grey-block…) differently. When two such blocks land in one composed mail,
// their styles collide. Fix: every promoted block gets a marker class
// `b-<id>` on its root pug element, and every selector in its styl is scoped
// to that marker. @media rules are scoped too → mobile adaptation survives
// and stays block-local.
function parseCssRulesLite(css) {
  const rules = [];
  let i = 0;
  const n = css.length;
  function readBlockBody() {
    let depth = 0, start = i;
    for (; i < n; i++) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}") { depth--; if (depth === 0) { i++; return css.slice(start + 1, i - 1); } }
    }
    return css.slice(start + 1);
  }
  while (i < n) {
    while (i < n && /\s/.test(css[i])) i++;
    if (i >= n) break;
    if (css[i] === "}") { i++; continue; }
    const preludeStart = i;
    while (i < n && css[i] !== "{" && css[i] !== "}" && css[i] !== ";") i++;
    const prelude = css.slice(preludeStart, i).trim();
    if (css[i] === ";") { i++; continue; }
    if (css[i] !== "{") { i++; continue; }
    const body = readBlockBody();
    if (/^@media/i.test(prelude)) {
      rules.push({ type: "media", query: prelude, rules: parseCssRulesLite(body) });
    } else if (/^@/.test(prelude)) {
      rules.push({ type: "raw", selector: prelude, body });
    } else {
      rules.push({ type: "rule", selector: prelude, body });
    }
  }
  return rules;
}

function rootClassesOfPug(pug) {
  const set = new Set();
  for (const line of String(pug).split("\n")) {
    if (!line.trim() || /^\s/.test(line)) continue; // root lines only (indent 0)
    const m = line.trim().match(/^([A-Za-z][\w-]*)?((?:[.#][\w-]+)*)/);
    if (m && m[2]) for (const tok of m[2].match(/\.[\w-]+/g) || []) set.add(tok.slice(1));
  }
  return set;
}

function addMarkerToPugRoot(pug, marker) {
  return String(pug).split("\n").map((line) => {
    if (/^\s/.test(line) || !line.trim()) return line;      // children untouched
    const t = line;
    const m = t.match(/^([A-Za-z][\w-]*)?((?:[.#][\w-]+)*)/);
    if (!m || (!m[1] && !m[2])) return line;                  // text/pipe/comment root
    if (/^\/\//.test(t) || /^\|/.test(t)) return line;
    const head = m[0];
    return head + "." + marker + t.slice(head.length);
  }).join("\n");
}

function scopeSelector(selector, marker, rootClasses) {
  return selector.split(",").map((one) => {
    const s = one.trim();
    if (!s) return s;
    // split into compounds, keep combinators
    const parts = s.split(/(\s*[>+~]\s*|\s+)/);
    let attached = false;
    for (let i = 0; i < parts.length; i += 2) {
      const compound = parts[i];
      if (!compound) continue;
      const classes = (compound.match(/\.[\w-]+/g) || []).map((x) => x.slice(1));
      if (classes.some((c) => rootClasses.has(c))) {
        // attach marker before any pseudo (:hover etc.)
        const pi = compound.search(/:(?!:)/);
        parts[i] = pi === -1
          ? compound + "." + marker
          : compound.slice(0, pi) + "." + marker + compound.slice(pi);
        attached = true;
        break;
      }
    }
    return attached ? parts.join("") : "." + marker + " " + s;
  }).join(", ");
}

function scopeCss(css, marker, rootClasses) {
  if (!css || !css.trim()) return css || "";
  const out = [];
  for (const r of parseCssRulesLite(css)) {
    if (r.type === "rule") {
      out.push(`${scopeSelector(r.selector, marker, rootClasses)} { ${r.body} }`);
    } else if (r.type === "media") {
      const inner = r.rules
        .filter((ir) => ir.type === "rule")
        .map((ir) => `  ${scopeSelector(ir.selector, marker, rootClasses)} { ${ir.body} }`)
        .join("\n");
      if (inner) out.push(`${r.query} {\n${inner}\n}`);
    } else {
      out.push(`${r.selector} { ${r.body} }`); // @font-face etc. — as-is
    }
  }
  return out.join("\n");
}

// ─── Parametric spacer ─────────────────────────────────────────────────────
// Every `.h-NN &nbsp;` spacer collapses into ONE imported block with a
// height slot — instead of dozens of h-8/h-12/h-40 duplicates.
const SPACER_PUG_RE = /^\.h-(\d+)\s*(?:&nbsp;)?\s*$/;
function spacerHeightOf(pug) {
  const m = String(pug).trim().match(SPACER_PUG_RE);
  return m ? Number(m[1]) : null;
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

  // dedup by skeleton; ALL spacers collapse into one parametric key
  const byKey = new Map();
  const spacerHeights = [];
  for (const c of candidates) {
    const sh = spacerHeightOf(c.pug);
    const key = sh !== null ? "inline|SPACER" : (c.placement || "") + "|" + skeleton(c.pug);
    if (sh !== null) spacerHeights.push(sh);
    if (!byKey.has(key)) byKey.set(key, { rep: c, count: 0, mails: new Set() });
    const e = byKey.get(key);
    e.count += 1; e.mails.add(c.mailRef);
  }

  // build canonical blocks
  const catCounters = {};
  const blocks = [];
  for (const [key, e] of byKey) {
    const rep = e.rep;
    if (!rep.pug.trim()) continue;
    const isSpacer = key === "inline|SPACER";
    const cat = isSpacer ? "utility" : (rep.category || "section");
    catCounters[cat] = (catCounters[cat] || 0) + 1;
    let pug, slots, styl;
    const h = hash(key);
    const id = isSpacer ? "iq-spacer" : `iq-${slug(cat)}-${String(catCounters[cat]).padStart(2, "0")}`;
    if (isSpacer) {
      const def = spacerHeights.length
        ? spacerHeights.sort((a, b) => a - b)[Math.floor(spacerHeights.length / 2)]
        : 24;
      pug = ".h-sp-{{ height }} &nbsp;";
      styl = ".h-sp-{{ height }} { font-size: 0; line-height: {{ height }}px; height: {{ height }}px; }";
      slots = [{ id: "height", kind: "number", label: "Высота, px", default: def, min: 4, max: 120 }];
    } else {
      const t = tokenize(rep.pug);
      // scope: marker class on root pug element + all selectors namespaced
      const marker = `b-${id}`;
      const rootCls = rootClassesOfPug(t.pug);
      pug = addMarkerToPugRoot(t.pug, marker);
      styl = scopeCss(rep.styl || "", marker, rootCls);
      slots = t.slots;
    }
    blocks.push({
      id,
      hash: h,
      label: isSpacer ? "Спейсер (настраиваемая высота)" : (rep.label || cat),
      description: `Импортирован из X_IQ (${e.count} писем). ${rep.scope === "inline" ? "Inline-элемент." : "Секция."}`,
      placement: rep.placement || (rep.scope === "inline" ? "inline" : "section"),
      category: cat,
      version: 1,
      source: "imported",
      pug,
      styl,
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
