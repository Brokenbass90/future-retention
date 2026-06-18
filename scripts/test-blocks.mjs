#!/usr/bin/env node
/**
 * scripts/test-blocks.mjs
 *
 * Phase 0 of the DnD constructor track: validate every entry in
 * data/block-snippets.json by running it through the real build-mail.js
 * pipeline.
 *
 * For each snippet:
 *   1. Scaffold a temp mail folder under email-base/_blockstest/mail-<id>/
 *      with the snippet as the content of blocks/header.pug and minimal
 *      wrappers everywhere else.
 *   2. Run `node email-base/tools/build-mail.js --category _blockstest
 *      --mail <id> --locales en --pretty` and capture stdout/stderr.
 *   3. Read the produced dist HTML and check it's non-empty + contains
 *      a recognizable body section.
 *   4. Record pass / fail + reason.
 *
 * Output: a colored CLI report + a Markdown summary at
 *   docs/BLOCK-LIBRARY-STATUS.md
 *
 * No tokens spent, no AI calls. Pure compile-time validation.
 *
 * Run:  node scripts/test-blocks.mjs
 * Exit: 0 on at least one passing block; 1 if every block fails.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, cpSync, symlinkSync, statSync, readdirSync } from "node:fs";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import url from "node:url";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const emailBase = path.join(repoRoot, "email-base");
const snippetsPath = path.join(repoRoot, "data", "block-snippets.json");

// Use a temp workspace OUTSIDE the (possibly FUSE-mounted, read-only) email-base.
// We mirror the structure that build-mail.js expects (<root>/<category>/mail-<name>,
// <root>/vendor, <root>/tools), then run the compiler with cwd at this temp root.
const TEMP_ROOT = path.join(os.tmpdir(), "retkit-blocktests");

// ─── ANSI ──────────────────────────────────────────────────────────
const C = { reset: "\x1b[0m", dim: "\x1b[2m", bold: "\x1b[1m", red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m", cyan: "\x1b[36m", magenta: "\x1b[35m" };
const c = (color, s) => `${C[color]}${s}${C.reset}`;
const ok = (s) => c("green", s);
const bad = (s) => c("red", s);
const warn = (s) => c("yellow", s);
const dim = (s) => c("dim", s);
function pad(s, n) { s = String(s); return s.length >= n ? s : s + " ".repeat(n - s.length); }

// ─── scaffolding ───────────────────────────────────────────────────
// Each test mail needs the same minimal skeleton. We copy from a
// known-good mail (mail-welcome) and overwrite only blocks/header.pug
// with the snippet under test. That gives us the wrapper layout +
// helpers + styles for free.
const TEMPLATE_SOURCE = path.join(emailBase, "X_IQBroker", "mail-welcome");
const OUTPUT_CATEGORY = "_blockstest";

function setupTempRoot() {
  // Best-effort clean previous run (don't fail if it doesn't exist).
  try { rmSync(TEMP_ROOT, { recursive: true, force: true }); } catch { /* ignore */ }
  mkdirSync(TEMP_ROOT, { recursive: true });
  mkdirSync(path.join(TEMP_ROOT, OUTPUT_CATEGORY), { recursive: true });
  // build-mail.js looks up vendor/helpers/, vendor/styles/, tools/ relative
  // to process.cwd(). Symlink them from the real email-base so we don't
  // duplicate the data.
  for (const item of ["vendor", "tools", "node_modules"]) {
    const src = path.join(emailBase, item);
    const dst = path.join(TEMP_ROOT, item);
    if (existsSync(src) && !existsSync(dst)) {
      try {
        symlinkSync(src, dst, "dir");
      } catch (err) {
        // fall back to copy if symlinks aren't allowed
        if (item !== "node_modules") cpSync(src, dst, { recursive: true });
      }
    }
  }
}

function copyTemplateSkippingDist(src, dst) {
  // Manual recursive copy that skips `dist/` directories and `*.jade` files
  // (we re-create what we need from the .pug versions).
  if (!existsSync(dst)) mkdirSync(dst, { recursive: true });
  const entries = readdirSync(src, { withFileTypes: true });
  for (const e of entries) {
    if (e.name === "dist") continue;
    const sp = path.join(src, e.name);
    const dp = path.join(dst, e.name);
    if (e.isDirectory()) copyTemplateSkippingDist(sp, dp);
    else if (e.isFile()) {
      try {
        const data = readFileSync(sp);
        writeFileSync(dp, data);
      } catch { /* ignore unreadable files */ }
    }
  }
}

function scaffoldMail(id, snippetPug) {
  const dest = path.join(TEMP_ROOT, OUTPUT_CATEGORY, `mail-${id}`);
  if (existsSync(dest)) {
    try { rmSync(dest, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  copyTemplateSkippingDist(TEMPLATE_SOURCE, dest);
  // Overwrite the header block with our snippet.
  const headerPath = path.join(dest, "app", "templates", "blocks", "header.pug");
  writeFileSync(headerPath, snippetPug + "\n", "utf8");
  // Nuke any leftover .jade variant of header so Pug uses ours.
  try {
    const jadeHeader = path.join(dest, "app", "templates", "blocks", "header.jade");
    if (existsSync(jadeHeader)) rmSync(jadeHeader, { force: true });
  } catch { /* ignore */ }
  return dest;
}

function runBuild(id) {
  return new Promise((resolve) => {
    const args = ["tools/build-mail.js", "--category", OUTPUT_CATEGORY, "--mail", id, "--locales", "en", "--pretty"];
    const child = spawn("node", args, { cwd: TEMP_ROOT, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.stderr.on("data", (d) => { stderr += d.toString(); });
    const timeout = setTimeout(() => { try { child.kill("SIGKILL"); } catch {} }, 30_000);
    child.on("close", (code) => {
      clearTimeout(timeout);
      resolve({ code, stdout, stderr });
    });
    child.on("error", (err) => {
      clearTimeout(timeout);
      resolve({ code: -1, stdout, stderr: String(err.message || err) });
    });
  });
}

function checkOutput(id) {
  const distHtml = path.join(TEMP_ROOT, "dist", OUTPUT_CATEGORY, `mail-${id}`, "en", "index.html");
  if (!existsSync(distHtml)) return { ok: false, reason: "no dist HTML produced" };
  const html = readFileSync(distHtml, "utf8");
  if (html.length < 500) return { ok: false, reason: `dist HTML suspiciously short (${html.length} bytes)` };
  if (!/<body[\s>]/i.test(html)) return { ok: false, reason: "no <body> tag in output" };
  const bodyMatch = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  const bodyText = bodyMatch ? bodyMatch[1] : "";
  if (bodyText.length < 200) return { ok: false, reason: `<body> content too short (${bodyText.length} bytes)` };
  return { ok: true, size: html.length, bodyChars: bodyText.length };
}

// ─── main ──────────────────────────────────────────────────────────
async function main() {
  if (!existsSync(snippetsPath)) {
    console.error(bad(`Snippets file not found: ${snippetsPath}`));
    process.exit(1);
  }
  // Source 1: legacy auto-extracted snippets (data/block-snippets.json).
  const legacySnippets = JSON.parse(readFileSync(snippetsPath, "utf8")).items;
  const legacy = Object.keys(legacySnippets).map((id) => ({
    id, pug: legacySnippets[id].pug, sectionKind: legacySnippets[id].sectionKind, source: "legacy",
  }));

  // Source 2: hand-crafted canonical blocks (data/block-library/canonical/*.json).
  // These are the curated, logical, minimal blocks meant for production use.
  const canonicalDir = path.join(repoRoot, "data", "block-library", "canonical");
  const handCrafted = [];
  if (existsSync(canonicalDir)) {
    for (const fname of readdirSync(canonicalDir)) {
      if (!fname.endsWith(".json")) continue;
      try {
        const obj = JSON.parse(readFileSync(path.join(canonicalDir, fname), "utf8"));
        handCrafted.push({
          id: obj.id || fname.replace(/\.json$/, ""),
          pug: obj.pug,
          sectionKind: obj.category || obj.placement || "(none)",
          placement: obj.placement,
          source: "canonical",
        });
      } catch (err) {
        console.warn(dim(`  ! could not parse ${fname}: ${err.message}`));
      }
    }
  }

  // Merge — canonical first so they appear at the top of the report.
  const all = [...handCrafted, ...legacy];
  console.log(c("bold", `\n══ Validating ${all.length} blocks (${handCrafted.length} hand-crafted + ${legacy.length} legacy) ══\n`));
  console.log(dim(`  scaffold root: ${TEMP_ROOT}\n`));
  setupTempRoot();

  const results = [];
  for (const entry of all) {
    const { id, pug, sectionKind, source } = entry;
    const pugLen = (pug || "").length;
    const sourceLabel = source === "canonical" ? c("magenta", "[canonical]") : dim("[legacy]   ");
    process.stdout.write(`  ${sourceLabel} ${pad(id, 28)} ${dim(`(${sectionKind}, ${pugLen}B)`)}  `);
    if (!pug || !pug.trim()) {
      console.log(bad("✗ empty pug"));
      results.push({ id, sectionKind, pugLen, source, status: "fail", reason: "empty pug" });
      continue;
    }
    if (pugLen > 50_000) {
      console.log(warn(`⚠ pug ${pugLen}B — skipped (corrupted)`));
      results.push({ id, sectionKind, pugLen, source, status: "skip-corrupted", reason: "pug > 50KB — needs manual rebuild" });
      continue;
    }
    try {
      scaffoldMail(id, pug);
    } catch (err) {
      console.log(bad("✗ scaffold failed: " + err.message));
      results.push({ id, sectionKind, pugLen, source, status: "fail", reason: "scaffold: " + err.message });
      continue;
    }
    const t0 = Date.now();
    const built = await runBuild(id);
    const ms = Date.now() - t0;
    if (built.code !== 0) {
      const firstErr = (built.stderr || built.stdout).split("\n").find((l) => /error|fail/i.test(l)) || built.stderr.split("\n")[0] || "build exit " + built.code;
      console.log(bad(`✗ build failed (${ms}ms): ${firstErr.slice(0, 80)}`));
      results.push({ id, sectionKind, pugLen, source, status: "fail", reason: firstErr.slice(0, 200), ms });
      continue;
    }
    const check = checkOutput(id);
    if (!check.ok) {
      console.log(bad(`✗ ${check.reason}`));
      results.push({ id, sectionKind, pugLen, source, status: "fail", reason: check.reason, ms });
      continue;
    }
    console.log(ok(`✓ ${check.size}B (${ms}ms)`));
    results.push({ id, sectionKind, pugLen, source, status: "pass", size: check.size, bodyChars: check.bodyChars, ms });
  }

  // ── Summary ──────────────────────────────────────────────────────
  const passed = results.filter((r) => r.status === "pass");
  const failed = results.filter((r) => r.status === "fail");
  const skipped = results.filter((r) => r.status === "skip-corrupted");
  console.log();
  console.log(c("bold", "── Summary ─────────────────────────"));
  console.log(`  ${ok("✓ pass")}   ${passed.length}/${results.length}`);
  console.log(`  ${bad("✗ fail")}    ${failed.length}/${results.length}`);
  console.log(`  ${warn("⚠ skipped")} ${skipped.length}/${results.length}  (corrupted, need manual rebuild)`);

  // ── Markdown report ──────────────────────────────────────────────
  const canonicalRes = results.filter((r) => r.source === "canonical");
  const legacyRes    = results.filter((r) => r.source === "legacy");
  const md = [];
  md.push("# Block Library — Validation Report");
  md.push("");
  md.push(`Generated: ${new Date().toISOString()}`);
  md.push("");
  md.push(`**Hand-crafted blocks** (\`data/block-library/canonical/*.json\`): ${canonicalRes.length}`);
  md.push(`**Legacy auto-extracted blocks** (\`data/block-snippets.json\`): ${legacyRes.length}`);
  md.push("");
  md.push(`**Pass:** ${passed.length} · **Fail:** ${failed.length} · **Skipped (corrupted):** ${skipped.length}`);
  md.push("");
  md.push("Pass criteria: block scaffolds into a minimal mail wrapper, compiles via `build-mail.js` without errors, produces a dist HTML with a `<body>` containing ≥200 chars of content.");
  md.push("");
  md.push("## ✓ Passed blocks");
  md.push("");
  if (!passed.length) md.push("_(none)_");
  else {
    md.push("| id | section | pug size | output | build time |");
    md.push("|---|---|---|---|---|");
    for (const r of passed) {
      md.push(`| \`${r.id}\` | ${r.sectionKind} | ${r.pugLen} B | ${r.size} B (body: ${r.bodyChars} B) | ${r.ms} ms |`);
    }
  }
  md.push("");
  md.push("## ✗ Failed blocks");
  md.push("");
  if (!failed.length) md.push("_(none — all clean!)_");
  else {
    md.push("| id | section | pug size | reason |");
    md.push("|---|---|---|---|");
    for (const r of failed) {
      md.push(`| \`${r.id}\` | ${r.sectionKind} | ${r.pugLen} B | ${String(r.reason).replace(/\|/g, "\\|").slice(0, 120)} |`);
    }
  }
  md.push("");
  md.push("## ⚠ Skipped (need manual rebuild)");
  md.push("");
  if (!skipped.length) md.push("_(none)_");
  else {
    md.push("| id | section | pug size | reason |");
    md.push("|---|---|---|---|");
    for (const r of skipped) {
      md.push(`| \`${r.id}\` | ${r.sectionKind} | ${r.pugLen} B | ${r.reason} |`);
    }
  }
  md.push("");
  md.push("## Next steps");
  md.push("");
  md.push("1. Each **passed** block can be promoted to `data/block-library/canonical/<id>.json` in the new schema. A separate script (`scripts/promote-blocks.mjs`) does that — see Phase 0 of the DnD roadmap.");
  md.push("2. Each **failed** block needs investigation — most likely missing surrounding helpers or unresolvable mixin reference. Reason column hints at the fix.");
  md.push("3. **Skipped** blocks have pug > 50 KB, meaning the original extractor captured an entire mail instead of a single section. Re-extract them by hand from their `sourceFile`.");
  md.push("");
  md.push("Re-run with `node scripts/test-blocks.mjs` after any change.");

  const reportPath = path.join(repoRoot, "docs", "BLOCK-LIBRARY-STATUS.md");
  writeFileSync(reportPath, md.join("\n"), "utf8");
  console.log();
  console.log(dim(`Report written: ${path.relative(repoRoot, reportPath)}`));
  console.log();

  // ── Exit ─────────────────────────────────────────────────────────
  if (!passed.length) {
    console.log(bad("✗ Every block failed — something is structurally wrong with the test scaffold, not the blocks."));
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(bad("Unhandled: ") + (err?.stack || err?.message || err));
  process.exit(1);
});
