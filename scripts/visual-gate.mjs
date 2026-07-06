#!/usr/bin/env node
/**
 * scripts/visual-gate.mjs — visual regression gate for emails + block library.
 *
 * What it does:
 *   1. Builds target mails (tests/visual-targets.json) for the given locales.
 *   2. Screenshots each dist HTML at desktop (600px) and mobile (375px) widths
 *      via headless Chromium (playwright-core).
 *   3. Composes "gallery" mails from top library blocks and screenshots them too.
 *   4. Compares against tests/visual-baseline/ with pixelmatch; writes diff PNGs
 *      and an HTML report to tests/visual-report/.
 *
 * External images are stubbed with a deterministic gray PNG so runs don't
 * depend on the network. Baselines are environment-specific (fonts!) — keep
 * baseline and CI on the same OS image.
 *
 * Usage:
 *   node scripts/visual-gate.mjs                  # compare vs baseline
 *   node scripts/visual-gate.mjs --update         # (re)write baseline
 *   node scripts/visual-gate.mjs --no-build       # reuse existing dist
 *   node scripts/visual-gate.mjs --only rfm-311   # filter targets by substring
 *   node scripts/visual-gate.mjs --max-shots 12   # limit (sandbox-friendly)
 * One-time setup: npx playwright-core install --only-shell chromium
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, copyFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import url from "node:url";
import { chromium } from "playwright-core";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";

// Sandbox/CI without root: local lib stubs + skip host validation (set BEFORE
// playwright inspects the host). No-op on machines with a normal Chromium setup.
if (process.platform === "linux") {
  const stub = path.join(os.homedir(), "pwlibs");
  if (existsSync(stub)) {
    process.env.LD_LIBRARY_PATH = [stub, process.env.LD_LIBRARY_PATH].filter(Boolean).join(":");
    process.env.PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS = "true";
  }
}

const here = path.dirname(url.fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const emailBase = path.join(repoRoot, "email-base");
const testsDir = path.join(repoRoot, "tests");
const baselineDir = path.join(testsDir, "visual-baseline");
const currentDir = path.join(testsDir, "visual-current");
const reportDir = path.join(testsDir, "visual-report");
const targetsPath = path.join(testsDir, "visual-targets.json");

const argv = process.argv.slice(2);
const UPDATE = argv.includes("--update");
const NO_BUILD = argv.includes("--no-build");
const ONLY = (() => { const i = argv.indexOf("--only"); return i >= 0 ? argv[i + 1] : null; })();
const MAX_SHOTS = (() => { const i = argv.indexOf("--max-shots"); return i >= 0 ? Number(argv[i + 1]) : Infinity; })();
const DIFF_RATIO_FAIL = 0.001; // >0.1% pixels differ → fail

const WIDTHS = [{ name: "desktop", width: 600 }, { name: "mobile", width: 375 }];
const GRAY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mPcvHHDfwAGkgLZQpcPhQAAAABJRU5ErkJggg==", "base64");

function defaultTargets() {
  return {
    mails: [
      { category: "X_IQ", mail: "rfm-311", locales: ["en", "ur"] },
      { category: "X_IQ", mail: "rfm-segmentation-2-232", locales: ["en", "ar"] },
      { category: "X_IQBroker", mail: "welcome", locales: ["en", "ur"] },
    ],
    galleries: [
      { id: "gallery-top-sections", placement: "section", top: 10 },
      { id: "gallery-top-inline", placement: "inline", top: 10 },
    ],
  };
}

function loadTargets() {
  if (!existsSync(targetsPath)) {
    mkdirSync(testsDir, { recursive: true });
    writeFileSync(targetsPath, JSON.stringify(defaultTargets(), null, 2) + "\n");
  }
  return JSON.parse(readFileSync(targetsPath, "utf8"));
}

function run(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"], timeout: 120000 });
  return { code: r.status, out: String(r.stdout || ""), err: String(r.stderr || "") };
}

function buildMail(category, mail, locales) {
  return run("node", ["tools/build-mail.js", "--category", category, "--mail", mail,
    "--locales", locales.join(","), "--pretty"], emailBase);
}

async function composeGallery(g) {
  const { composeEmailFromBlocks } = await import(url.pathToFileURL(path.join(repoRoot, "src", "compose-email.js")).href);
  const idx = JSON.parse(readFileSync(path.join(repoRoot, "data", "block-library", "imported", "index.json"), "utf8"));
  const picks = idx.blocks
    .filter((b) => b.placement === g.placement && b.validated !== false)
    .sort((a, b) => (b.usageCount || 0) - (a.usageCount || 0))
    .slice(0, g.top || 10)
    .map((b) => ({ id: b.id }));
  if (!picks.length) return null;
  composeEmailFromBlocks({ brand: "X_assembled", mailName: g.id, blocks: picks, force: true });
  const r = buildMail("X_assembled", g.id, ["en"]);
  if (r.code !== 0) throw new Error(`gallery build failed: ${g.id}: ${r.err.split("\n").filter(Boolean).slice(-1)[0]}`);
  return { category: "X_assembled", mail: g.id, locales: ["en"] };
}

async function screenshot(page, htmlPath, outPng, width) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(url.pathToFileURL(htmlPath).href, { waitUntil: "load", timeout: 20000 });
  await page.evaluate(() => document.fonts && document.fonts.ready);
  await page.screenshot({ path: outPng, fullPage: true });
}

function compare(name, basePng, curPng, diffPng) {
  if (!existsSync(basePng)) return { name, status: "new" };
  const a = PNG.sync.read(readFileSync(basePng));
  const b = PNG.sync.read(readFileSync(curPng));
  if (a.width !== b.width || a.height !== b.height) return { name, status: "size", detail: `${a.width}x${a.height} → ${b.width}x${b.height}` };
  const diff = new PNG({ width: a.width, height: a.height });
  const n = pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold: 0.1 });
  const ratio = n / (a.width * a.height);
  if (ratio > DIFF_RATIO_FAIL) {
    writeFileSync(diffPng, PNG.sync.write(diff));
    return { name, status: "diff", detail: `${(ratio * 100).toFixed(3)}% (${n}px)` };
  }
  return { name, status: "ok" };
}

async function main() {
  const targets = loadTargets();
  mkdirSync(baselineDir, { recursive: true });
  mkdirSync(currentDir, { recursive: true });
  mkdirSync(reportDir, { recursive: true });

  // 1) resolve all shot jobs
  const jobs = []; // { name, htmlPath }
  const mails = [...targets.mails];
  for (const g of targets.galleries || []) {
    if (ONLY && !g.id.includes(ONLY)) continue; // don't compose galleries we won't shoot
    try { const m = await composeGallery(g); if (m) mails.push(m); }
    catch (e) { console.error("[gallery]", e.message); }
  }
  for (const t of mails) {
    const label = `${t.category}__${t.mail}`;
    if (ONLY && !label.includes(ONLY)) continue;
    if (!NO_BUILD) {
      const r = buildMail(t.category, t.mail, t.locales);
      if (r.code !== 0) { console.error(`[build FAIL] ${label}: ${r.err.split("\n").filter(Boolean).slice(-1)[0]}`); continue; }
    }
    for (const loc of t.locales) {
      const html = path.join(emailBase, "dist", t.category, `mail-${t.mail}`, loc, "index.html");
      if (!existsSync(html)) { console.error(`[missing dist] ${label}/${loc}`); continue; }
      for (const w of WIDTHS) jobs.push({ name: `${label}__${loc}@${w.name}`, htmlPath: html, width: w.width });
    }
  }
  const limited = jobs.slice(0, MAX_SHOTS);

  // 2) shoot
  const browser = await chromium.launch({ headless: true, env: { ...process.env } });
  const ctx = await browser.newContext({ deviceScaleFactor: 1, reducedMotion: "reduce" });
  // deterministic: stub all external images, block other external requests
  await ctx.route(/^https?:\/\//, (route) =>
    route.request().resourceType() === "image"
      ? route.fulfill({ contentType: "image/png", body: GRAY_PNG })
      : route.abort());
  const page = await ctx.newPage();
  for (const j of limited) {
    await screenshot(page, j.htmlPath, path.join(currentDir, j.name + ".png"), j.width);
    process.stdout.write(".");
  }
  await browser.close();
  console.log(` ${limited.length} shots`);

  // 3) compare or update
  const results = [];
  for (const j of limited) {
    const cur = path.join(currentDir, j.name + ".png");
    const base = path.join(baselineDir, j.name + ".png");
    if (UPDATE) { copyFileSync(cur, base); results.push({ name: j.name, status: "updated" }); continue; }
    results.push(compare(j.name, base, cur, path.join(reportDir, j.name + ".diff.png")));
  }

  // 4) report
  const bad = results.filter((r) => r.status === "diff" || r.status === "size");
  const fresh = results.filter((r) => r.status === "new");
  const rows = results.map((r) => {
    const cls = r.status === "ok" || r.status === "updated" ? "ok" : r.status === "new" ? "new" : "bad";
    const imgs = r.status === "diff"
      ? `<div class=imgs><img src="../visual-baseline/${r.name}.png"><img src="../visual-current/${r.name}.png"><img src="${r.name}.diff.png"></div>` : "";
    return `<tr class=${cls}><td>${r.name}</td><td>${r.status}</td><td>${r.detail || ""}</td></tr>${imgs ? `<tr><td colspan=3>${imgs}</td></tr>` : ""}`;
  }).join("\n");
  writeFileSync(path.join(reportDir, "index.html"),
    `<!doctype html><meta charset=utf-8><title>visual gate</title><style>
    body{font:13px/1.4 system-ui;margin:20px} table{border-collapse:collapse;width:100%}
    td{border:1px solid #ddd;padding:4px 8px} tr.ok td{background:#f4fff4} tr.bad td{background:#fff2f2} tr.new td{background:#fffbe8}
    .imgs{display:flex;gap:8px} .imgs img{max-width:32%;border:1px solid #ccc}</style>
    <h2>Visual gate — ${new Date().toISOString()}</h2>
    <p>${results.length} shots · ok ${results.filter(r=>r.status==="ok").length} · diff ${bad.length} · new ${fresh.length}${UPDATE ? " · BASELINE UPDATED" : ""}</p>
    <table><tr><th>shot</th><th>status</th><th>detail</th></tr>${rows}</table>`);

  console.log(`ok:${results.filter(r=>r.status==="ok"||r.status==="updated").length} diff:${bad.length} new:${fresh.length} → tests/visual-report/index.html`);
  if (bad.length) { bad.forEach((r) => console.error(`  DIFF ${r.name} ${r.detail || ""}`)); process.exit(1); }
  if (fresh.length && !UPDATE) { console.error(`  ${fresh.length} shots have no baseline — run with --update`); process.exit(2); }
}
main().catch((e) => { console.error(e); process.exit(1); });
