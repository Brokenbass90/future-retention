#!/usr/bin/env node
/**
 * scripts/slice-mail-to-blocks.mjs
 *
 * Deterministic "распиловка" of an X_<brand> mail into reusable blocks for the
 * DnD constructor + AI library.
 *
 * For each mail it:
 *   1. Reads app/templates/blocks/*.jade (the content) + app/templates/index.jade.
 *   2. Slices the content by Pug indentation into SECTION blocks (top-level
 *      `table.row…` / `.h-NN` spacers at the outer indent).
 *   3. Within each section, detects INLINE sub-blocks by anchor classes
 *      (w280 CTA, asset-block, gray-block, gmail-blend, white-title/text,
 *      socials, stor/store-badges, single image, h-NN spacer).
 *   4. Pulls the matching CSS — including @media (mobile/adaptive) — from the
 *      mail's compiled dist/main.css for every class the block references.
 *   5. Auto-detects slots from ${{ ns.block_NN }}$, href="…", img(src=…).
 *   6. Classifies placement (section|inline|helper) + category.
 *
 * Output (pilot mode): a JSON report under data/imports/sliced/<category>__<mail>.json
 * plus a human-readable summary printed to stdout. Validation + promotion to
 * data/block-library/imported/ is a separate step once rules are calibrated.
 *
 * Usage:
 *   node scripts/slice-mail-to-blocks.mjs --category X_IQ --mail rfm-segmentation-2-232
 *   node scripts/slice-mail-to-blocks.mjs --category X_IQ --mail rfm-311 --mail rfm-321
 */

import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { globSync } from "node:fs";
import path from "node:path";
import url from "node:url";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const emailBase = path.join(repoRoot, "email-base");

// ─── Framework class set (provided by the scaffold/wrapper for free) ──────
// vendor styles are shared by every mail; each mail also has its own
// common.styl + helpers/*.styl (the layout/grid/spacing framework). A block
// only needs to CARRY its DESIGN classes (those defined in blocks/main.styl).
let _vendorFwCache = null;
function classNamesIn(text) {
  const s = new Set();
  for (const m of text.match(/\.[A-Za-z][\w-]+/g) || []) s.add(m.slice(1));
  return s;
}
async function readSafeText(p) { try { return await readFile(p, "utf8"); } catch { return ""; } }
async function vendorFrameworkClasses() {
  if (_vendorFwCache) return _vendorFwCache;
  const set = new Set();
  let files = [];
  try { files = globSync(path.join(emailBase, "vendor", "**", "*.{styl,css}")); } catch { files = []; }
  for (const f of files) classNamesIn(await readSafeText(f)).forEach((c) => set.add(c));
  _vendorFwCache = set;
  return set;
}
// The classes GUARANTEED by the compose scaffold (vendor + skeleton mail's
// common.styl/helpers). A block may rely on these for free. Every OTHER class
// the block references must carry its own CSS (base + @media) — otherwise
// styles and mobile adaptation are silently lost when the block is composed
// into a different mail (the exact bug this rewrite fixes).
const SKELETON_MAIL = path.join(emailBase, "X_IQBroker", "mail-welcome");
let _skelFwCache = null;
async function skeletonFrameworkClasses() {
  if (_skelFwCache) return _skelFwCache;
  const set = new Set(await vendorFrameworkClasses());
  const stylesDir = path.join(SKELETON_MAIL, "app", "styles");
  const srcFiles = [path.join(stylesDir, "common.styl")];
  try { srcFiles.push(...globSync(path.join(stylesDir, "helpers", "*.styl"))); } catch {}
  for (const f of srcFiles) classNamesIn(await readSafeText(f)).forEach((c) => set.add(c));
  _skelFwCache = set;
  return set;
}
async function frameworkClassesForMail() {
  return skeletonFrameworkClasses();
}

// ─────────────────────────────────────────────────────────────────────────
// Anchor rules — how a class on a line maps to a block kind.
// Order matters: first match wins. `scope: inline` blocks are detected INSIDE
// a section; `scope: section` describes the whole top-level row.
// ─────────────────────────────────────────────────────────────────────────
const INLINE_ANCHORS = [
  { test: (cls) => cls.has("butt-link") || (cls.has("w280") && !cls.has("asset-block")), id: "cta-button", category: "cta", label: "CTA-кнопка (w280)" },
  { test: (cls) => cls.has("asset-block"), id: "asset-card", category: "feature-list", label: "Asset-карточка (лого + название)" },
  { test: (cls) => cls.has("gray-block"), id: "numbered-item", category: "feature-list", label: "Нумерованный пункт (gray-block)" },
  { test: (cls) => cls.has("gmail-blend-screen") || cls.has("gmail-blend-diff"), id: "gmail-blend", category: "utility", label: "Gmail blend wrapper" },
  { test: (cls) => cls.has("stor"), id: "store-badges", category: "footer", label: "Store badges (App Store / Google Play)" },
  { test: (cls) => cls.has("socials"), id: "socials", category: "footer", label: "Соцсети (иконки)" },
];

// Text anchors (paragraph-level) — these become inline text blocks.
const TEXT_CLASSES = ["white-title", "white-text", "middle-title", "small-title", "big-title", "hello", "text", "terms", "title"];

function classKindForText(cls) {
  if (cls.has("white-title") || cls.has("middle-title") || cls.has("big-title") || cls.has("small-title") || cls.has("hello") || cls.has("title")) return { id: "heading", category: "text", label: "Заголовок" };
  if (cls.has("white-text") || cls.has("text") || cls.has("terms")) return { id: "paragraph", category: "text", label: "Текстовый абзац" };
  return null;
}

// Spacer: `.h-NN &nbsp;`
const SPACER_RE = /^\.h-(\d+)\b/;

// ─────────────────────────────────────────────────────────────────────────
// Pug line parsing
// ─────────────────────────────────────────────────────────────────────────
function leadingWidth(line) {
  let w = 0;
  for (const ch of line) {
    if (ch === " ") w += 1;
    else if (ch === "\t") w += 4;
    else break;
  }
  return w;
}

function parseLines(text) {
  const rawLines = text.replace(/\r\n?/g, "\n").split("\n");
  const out = [];
  rawLines.forEach((raw, i) => {
    if (!raw.trim()) return; // skip blank
    out.push({ i, raw, indent: leadingWidth(raw), trimmed: raw.trim() });
  });
  return out;
}

// First token of a pug line → tag + classes. e.g. "table.row.brad-full.bgr-image(...)"
function parseClasses(trimmed) {
  // token before whitespace or '(' or '='
  const m = trimmed.match(/^([A-Za-z][\w-]*)?((?:[.#][\w-]+)*)/);
  const tag = (m && m[1]) || (trimmed.startsWith(".") || trimmed.startsWith("#") ? "div" : "");
  const classes = new Set();
  let id = null;
  if (m && m[2]) {
    for (const tok of m[2].match(/[.#][\w-]+/g) || []) {
      if (tok[0] === ".") classes.add(tok.slice(1));
      else id = tok.slice(1);
    }
  }
  return { tag, classes, id };
}

// Group lines into top-level segments at the minimum indentation present.
function topLevelSegments(lines) {
  if (!lines.length) return [];
  const minIndent = Math.min(...lines.map((l) => l.indent));
  const segs = [];
  let cur = null;
  for (const l of lines) {
    if (l.indent === minIndent) {
      if (cur) segs.push(cur);
      cur = { lines: [l] };
    } else if (cur) {
      cur.lines.push(l);
    } else {
      cur = { lines: [l] };
    }
  }
  if (cur) segs.push(cur);
  return segs;
}

// ─────────────────────────────────────────────────────────────────────────
// CSS extraction (with @media)
// ─────────────────────────────────────────────────────────────────────────
function parseCssRules(css) {
  // Returns flat list: { type:'rule', selector, body } or
  // { type:'media', query, rules:[{selector,body}] }
  const rules = [];
  let i = 0;
  const n = css.length;
  function skipWs() { while (i < n && /\s/.test(css[i])) i++; }
  function readBlockBody() {
    // assumes css[i] === '{'
    let depth = 0, start = i;
    for (; i < n; i++) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}") { depth--; if (depth === 0) { i++; return css.slice(start + 1, i - 1); } }
    }
    return css.slice(start + 1);
  }
  while (i < n) {
    skipWs();
    if (i >= n) break;
    if (css[i] === "}") { i++; continue; }
    // read selector / at-rule prelude until '{' or ';'
    let preludeStart = i;
    while (i < n && css[i] !== "{" && css[i] !== "}" && css[i] !== ";") i++;
    const prelude = css.slice(preludeStart, i).trim();
    if (css[i] === ";") { i++; continue; } // at-rule w/o block (e.g. @import)
    if (css[i] !== "{") { i++; continue; }
    if (/^@media/i.test(prelude)) {
      const body = readBlockBody();
      const inner = parseCssRules(body);
      rules.push({ type: "media", query: prelude, rules: inner.filter((r) => r.type === "rule") });
    } else if (/^@/.test(prelude)) {
      // other at-rule with block (e.g. @font-face) — keep as raw rule
      const body = readBlockBody();
      rules.push({ type: "rule", selector: prelude, body: body.trim() });
    } else {
      const body = readBlockBody();
      rules.push({ type: "rule", selector: prelude, body: body.trim() });
    }
  }
  return rules;
}

function selectorReferencesClass(selector, classSet) {
  for (const cls of classSet) {
    const re = new RegExp("\\." + cls.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&") + "(?![\\w-])");
    if (re.test(selector)) return true;
  }
  return false;
}

// Emit only rules whose selector references at least one DESIGN class
// (block classes minus framework). Rules touching only framework helpers
// (.pb20, .columns, .wrapper, …) are dropped — the scaffold provides them.
function cssForClasses(parsedRules, designSet) {
  if (!designSet || designSet.size === 0) return "";
  const parts = [];
  const seen = new Set(); // dedupe identical rules (blocks/main.css ∩ common.css)
  const push = (s) => { const k = s.replace(/\s+/g, " "); if (!seen.has(k)) { seen.add(k); parts.push(s); } };
  for (const r of parsedRules) {
    if (r.type === "rule") {
      if (selectorReferencesClass(r.selector, designSet)) {
        push(`${r.selector} { ${r.body} }`);
      }
    } else if (r.type === "media") {
      const matched = r.rules.filter((ir) => selectorReferencesClass(ir.selector, designSet));
      if (matched.length) {
        const inner = matched.map((ir) => `  ${ir.selector} { ${ir.body} }`).join("\n");
        push(`${r.query} {\n${inner}\n}`);
      }
    }
  }
  return parts.join("\n");
}

// All class names referenced anywhere in a pug fragment.
function classesInPug(pugLines) {
  const set = new Set();
  for (const l of pugLines) {
    const { classes } = parseClasses(l.trimmed);
    classes.forEach((c) => set.add(c));
    // class="a b" / class='a b' attribute form
    for (const m of l.trimmed.matchAll(/\bclass\s*=\s*(["'])([^"']*)\1/g)) {
      m[2].split(/\s+/).filter(Boolean).forEach((c) => set.add(c));
    }
  }
  return set;
}

// ─────────────────────────────────────────────────────────────────────────
// Slot detection
// ─────────────────────────────────────────────────────────────────────────
const PLACEHOLDER_RE = /\$\{\{\s*([\w-]+)\.([\w-]+)\s*\}\}\$/g;
const HREF_RE = /href\s*=\s*"([^"]*)"/g;
const SRC_RE = /\bsrc\s*=\s*"([^"]*)"/g;

function detectSlots(pugText) {
  const slots = [];
  const seen = new Set();
  let m;
  PLACEHOLDER_RE.lastIndex = 0;
  while ((m = PLACEHOLDER_RE.exec(pugText)) !== null) {
    const id = `${m[2]}`;
    if (seen.has("ph:" + m[0])) continue;
    seen.add("ph:" + m[0]);
    slots.push({ id: `text_${m[2]}`, kind: "richText", label: `Текст ${m[1]}.${m[2]}`, token: m[0], ns: m[1], block: m[2] });
  }
  let idx = 0;
  HREF_RE.lastIndex = 0;
  while ((m = HREF_RE.exec(pugText)) !== null) {
    if (m[1] === "#" || !m[1].trim()) continue;
    if (seen.has("href:" + m[1])) continue;
    seen.add("href:" + m[1]);
    slots.push({ id: `href_${idx++}`, kind: "url", label: "Ссылка", default: m[1] });
  }
  idx = 0;
  SRC_RE.lastIndex = 0;
  while ((m = SRC_RE.exec(pugText)) !== null) {
    if (seen.has("src:" + m[1])) continue;
    seen.add("src:" + m[1]);
    slots.push({ id: `image_${idx++}`, kind: "image", label: "Картинка", default: m[1] });
  }
  return slots;
}

// ─────────────────────────────────────────────────────────────────────────
// Classification of a section segment
// ─────────────────────────────────────────────────────────────────────────
function classifySection(seg) {
  const first = seg.lines[0];
  const sp = first.trimmed.match(SPACER_RE);
  if (sp) return { kind: "spacer", placement: "inline", category: "utility", label: `Спейсер ${sp[1]}px`, height: Number(sp[1]) };
  const allText = seg.lines.map((l) => l.trimmed).join(" ");
  const cls = classesInPug(seg.lines);
  // empty / comment-only segment → drop
  const meaningful = seg.lines.filter((l) => !l.trimmed.startsWith("//") && l.trimmed !== "&nbsp;");
  const hasImg = /\bimg\b/.test(allText) || /src\s*=/.test(allText);
  const hasText = /\$\{\{/.test(allText) || seg.lines.some((l) => /^[pa]\b|\bp\.|\ba\(/.test(l.trimmed));
  if (meaningful.length === 0 || (!hasImg && !hasText && !cls.has("socials") && !cls.has("stor"))) {
    return { kind: "empty", placement: "helper", category: "utility", label: "Пустая секция" };
  }
  let category = "section";
  let label = "Секция";
  if (cls.has("bgr-image") || cls.has("bgr")) { category = "hero"; label = "Hero с фоновой картинкой"; }
  else if (cls.has("socials")) { category = "footer"; label = "Соцсети"; }
  else if (cls.has("stor")) { category = "footer"; label = "Store badges"; }
  else if (cls.has("gray-block")) { category = "feature-list"; label = "Список преимуществ (нумерованный)"; }
  else if (cls.has("asset-block")) { category = "feature-list"; label = "Asset-секция"; }
  else if ((cls.has("logo") || /logo\.png|logo"/.test(allText)) && !cls.has("butt-link")) { category = "header"; label = "Шапка с логотипом"; }
  else if (cls.has("butt-link") || cls.has("w280")) { category = "cta"; label = "CTA-секция"; }
  else if (cls.has("white-bg")) { category = "text"; label = "Контентная карточка"; }
  return { kind: "section", placement: "section", category, label };
}

// Find inline sub-blocks inside a section (a line matching an inline anchor +
// its indented children form one inline block).
function findInlineBlocks(seg) {
  const out = [];
  const lines = seg.lines;
  for (let i = 1; i < lines.length; i++) {
    const { classes, tag } = parseClasses(lines[i].trimmed);
    // spacer inline
    const sp = lines[i].trimmed.match(SPACER_RE);
    if (sp) { out.push({ anchorIdx: i, lines: [lines[i]], meta: { id: "spacer", category: "utility", label: `Спейсер ${sp[1]}px` } }); continue; }
    let matched = null;
    for (const a of INLINE_ANCHORS) { if (a.test(classes)) { matched = a; break; } }
    // text paragraphs
    if (!matched && tag === "p") { const tk = classKindForText(classes); if (tk) matched = tk; }
    if (matched) {
      const baseIndent = lines[i].indent;
      const sub = [lines[i]];
      let j = i + 1;
      while (j < lines.length && lines[j].indent > baseIndent) { sub.push(lines[j]); j++; }
      out.push({ anchorIdx: i, lines: sub, meta: { id: matched.id, category: matched.category, label: matched.label } });
      i = j - 1;
    }
  }
  return out;
}

// Reconstruct pug from a set of lines, dedented so the shallowest line is at col 0.
function reconstructPug(segLines) {
  const minIndent = Math.min(...segLines.map((l) => l.indent));
  return segLines.map((l) => " ".repeat(l.indent - minIndent) + l.trimmed).join("\n");
}

function slugify(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 48);
}

// ─────────────────────────────────────────────────────────────────────────
// Per-mail slicing
// ─────────────────────────────────────────────────────────────────────────
async function readMailContent(mailAbs) {
  const blocksDir = path.join(mailAbs, "app", "templates", "blocks");
  let files = [];
  try {
    const ents = await readdir(blocksDir, { withFileTypes: true });
    files = ents.filter((e) => e.isFile() && /\.(jade|pug)$/i.test(e.name)).map((e) => e.name);
  } catch { files = []; }
  // Prefer .jade (source of truth here); dedupe header.jade/header.pug → keep .jade
  const names = new Set();
  const chosen = [];
  for (const f of files) {
    const base = f.replace(/\.(jade|pug)$/i, "");
    if (names.has(base)) continue;
    // prefer .jade
    const jade = path.join(blocksDir, base + ".jade");
    const pick = existsSync(jade) ? base + ".jade" : f;
    names.add(base);
    chosen.push(pick);
  }
  const out = [];
  for (const f of chosen) {
    const text = await readFile(path.join(blocksDir, f), "utf8");
    out.push({ file: f, text });
  }
  return out;
}

async function readCompiledCss(mailAbs) {
  // Block design layer + the mail's full compiled common.css. The latter is
  // where most @media (mobile) rules live — including rules for classes that
  // LOOK like framework helpers but are mail-specific (.grey-block, .plr32…).
  // cssForClasses() filters by the block's non-skeleton classes, so skeleton
  // framework rules (.row, .wrapper…) are still dropped.
  const parts = [
    await readSafeText(path.join(mailAbs, "app", "styles", "blocks", "dist", "main.css")),
    await readSafeText(path.join(mailAbs, "app", "assets", "styles", "common.css")),
  ];
  return parts.filter(Boolean).join("\n");
}

async function sliceMail(category, mailId) {
  const mailAbs = path.join(emailBase, category, "mail-" + mailId);
  if (!existsSync(mailAbs)) throw new Error("mail not found: " + mailAbs);
  const contents = await readMailContent(mailAbs);
  const css = await readCompiledCss(mailAbs);
  const parsedCss = parseCssRules(css);
  const fw = await frameworkClassesForMail();
  const designOf = (classSet) => new Set([...classSet].filter((c) => !fw.has(c)));

  const blocks = [];
  for (const { file, text } of contents) {
    const lines = parseLines(text);
    const segs = topLevelSegments(lines);
    segs.forEach((seg, si) => {
      const cls = classifySection(seg);
      if (cls.kind === "empty") return; // drop empty / comment-only segments
      const pug = reconstructPug(seg.lines);
      const classSet = classesInPug(seg.lines);
      const designSet = designOf(classSet);
      const blockCss = cssForClasses(parsedCss, designSet);
      const slots = detectSlots(pug);
      const baseId = slugify(`${category}-${mailId}-${file.replace(/\.\w+$/, "")}-${cls.category}-${si}`);
      const sectionBlock = {
        id: baseId,
        label: cls.label,
        placement: cls.placement,
        category: cls.category,
        kind: cls.kind,
        sourceFile: `${category}/mail-${mailId}/app/templates/blocks/${file}`,
        pug,
        styl: blockCss,
        classes: Array.from(classSet).sort(),
        designClasses: Array.from(designSet).sort(),
        slots,
        inlineChildren: [],
      };
      // inline sub-blocks
      if (cls.kind === "section") {
        const inlines = findInlineBlocks(seg);
        inlines.forEach((ib, ii) => {
          const ipug = reconstructPug(ib.lines);
          const iClassSet = classesInPug(ib.lines);
          const iDesignSet = designOf(iClassSet);
          sectionBlock.inlineChildren.push({
            id: slugify(`${baseId}-${ib.meta.id}-${ii}`),
            label: ib.meta.label,
            placement: "inline",
            category: ib.meta.category,
            pug: ipug,
            styl: cssForClasses(parsedCss, iDesignSet),
            classes: Array.from(iClassSet).sort(),
            designClasses: Array.from(iDesignSet).sort(),
            slots: detectSlots(ipug),
          });
        });
      }
      blocks.push(sectionBlock);
    });
  }
  return { category, mailId, mailAbs: path.relative(repoRoot, mailAbs), blockCount: blocks.length, blocks };
}

// ─────────────────────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = { category: "X_IQ", mails: [], all: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--category") out.category = argv[++i];
    else if (argv[i] === "--mail") out.mails.push(argv[++i]);
    else if (argv[i] === "--all") out.all = true;
  }
  return out;
}

// Unique mails in a category: drop obvious dup/old/copy/version variants.
async function listUniqueMails(category) {
  const dir = path.join(emailBase, category);
  let ents = [];
  try { ents = (await readdir(dir, { withFileTypes: true })).filter((e) => e.isDirectory() && e.name.startsWith("mail-")); } catch { return []; }
  const names = ents.map((e) => e.name.replace(/^mail-/, ""));
  // Drop only true variants: -copy[-N], -old[-N], -vYYMMDDHHMM, macOS " 2"/" 3" dups.
  const skip = (n) => /-copy(-\d+)?$/i.test(n) || /-old(-\d+)?$/i.test(n) || /-v\d{8,}$/i.test(n) || /\s\d+$/.test(n) || n === "test";
  return names.filter((n) => !skip(n)).sort();
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.all) args.mails = await listUniqueMails(args.category);
  if (!args.mails.length) {
    console.error("usage: node scripts/slice-mail-to-blocks.mjs --category X_IQ (--all | --mail <id> ...)");
    process.exit(1);
  }
  const outDir = path.join(repoRoot, "data", "imports", "sliced");
  await mkdir(outDir, { recursive: true });
  for (const mailId of args.mails) {
    const res = await sliceMail(args.category, mailId);
    const outFile = path.join(outDir, `${args.category}__mail-${mailId}.json`);
    await writeFile(outFile, JSON.stringify(res, null, 2) + "\n", "utf8");
    // human summary
    console.log(`\n=== ${args.category}/mail-${mailId} → ${res.blockCount} section blocks ===`);
    res.blocks.forEach((b, i) => {
      console.log(`  [${i}] ${b.placement}/${b.category}  «${b.label}»  classes:${b.classes.length} slots:${b.slots.length} styl:${b.styl.length}b inline:${b.inlineChildren.length}`);
      b.inlineChildren.forEach((c) => console.log(`        └ inline ${c.category} «${c.label}» slots:${c.slots.length} styl:${c.styl.length}b`));
    });
    console.log(`  → ${path.relative(repoRoot, outFile)}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
