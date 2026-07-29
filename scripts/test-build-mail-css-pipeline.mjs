import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";

const execFileAsync = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const buildMailPath = path.resolve(here, "../email-base/tools/build-mail.js");
const root = await mkdtemp(path.join(os.tmpdir(), "retkit-build-css-"));

async function put(relativePath, content) {
  const target = path.join(root, relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content, "utf8");
}

try {
  await put("X_Test/mail-css/app/templates/index.pug", [
    "doctype html",
    "html",
    "  head",
    "    meta(charset='utf-8')",
    "    style!= headCss",
    "  body",
    "    table.card(role='presentation')",
    "      tr",
    "        td.card__cell Pipeline check",
  ].join("\n"));

  await put("X_Test/mail-css/app/styles/common.styl", [
    ".card",
    "  background-color #e5e7eb",
    "  width 580px",
    ".card__cell",
    "  color #123456",
    "  padding 12px 24px",
    "@media only screen and (max-width: 600px)",
    "  .card",
    "    width 100% !important",
    "  .card__cell",
    "    padding 8px !important",
    "@supports (display: grid)",
    "  .card",
    "    display grid",
    "@font-face",
    "  font-family PipelineFont",
    "  src url('https://cdn.example.test/pipeline.woff2') format('woff2')",
    "@keyframes pipeline-pulse",
    "  from",
    "    opacity .9",
    "  to",
    "    opacity 1",
  ].join("\n"));
  await put("X_Test/mail-css/app/styles/head-only.styl", [
    ".ExternalClass",
    "  line-height 100%",
  ].join("\n"));
  await put("X_Test/mail-css/app/styles/head-extra.styl", [
    ".card__cell",
    "  letter-spacing 1px",
  ].join("\n"));

  const regularBuild = await execFileAsync(process.execPath, [
    buildMailPath,
    "--category", "X_Test",
    "--mail", "css",
    "--skip-locales",
    "--no-minifyCss",
  ], { cwd: root, maxBuffer: 2 * 1024 * 1024 });

  const html = await readFile(path.join(root, "dist/X_Test/mail-css/index.html"), "utf8");
  const head = html.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i)?.[1] || "";

  assert.match(html, /<table[^>]+class="card"[^>]+style="[^"]*background-color:\s*#e5e7eb/i);
  assert.match(html, /<td[^>]+class="card__cell"[^>]+style="[^"]*color:\s*#123456/i);
  assert.match(html, /<td[^>]+class="card__cell"[^>]+style="[^"]*padding:\s*12px 24px/i);
  assert.match(html, /<td[^>]+class="card__cell"[^>]+style="[^"]*letter-spacing:\s*1px/i);
  assert.match(head, /@media only screen and \(max-width:\s*600px\)/i);
  assert.match(head, /@media[\s\S]*\.card[\s\S]*width:\s*100%\s*!important/i);
  assert.match(head, /@supports\s*\(display:\s*grid\)/i);
  assert.match(head, /@font-face/i);
  assert.match(head, /@keyframes pipeline-pulse/i);
  assert.match(head, /\.ExternalClass\s*\{\s*line-height:\s*100%/i);
  assert.match(head, /\.card__cell\s*\{\s*letter-spacing:\s*1px/i);
  assert.doesNotMatch(head, /\.card\s*\{\s*background-color:\s*#e5e7eb/i);
  assert.match(regularBuild.stdout, /\[build\] CSS split: head=/);
  assert.match(regularBuild.stdout, /\[build\] Weight: largest HTML=/);

  await put("X_Test/mail-heavy/app/templates/index.pug", [
    "doctype html",
    "html",
    "  head",
    "    meta(charset='utf-8')",
    "    style!= headCss",
    "  body",
    "    p ${{ weight.block }}$",
  ].join("\n"));
  await put("X_Test/mail-heavy/app/styles/common.styl", [
    "p",
    "  color #123456",
    "@media only screen and (max-width: 600px)",
    "  p",
    "    font-size 16px !important",
  ].join("\n"));
  await put("vendor/data/en/weight.json", JSON.stringify({
    block: "x".repeat(110 * 1024),
  }));
  await put("vendor/data/ar/weight.json", JSON.stringify({
    block: "y".repeat(112 * 1024),
  }));

  const heavyBuild = await execFileAsync(process.execPath, [
    buildMailPath,
    "--category", "X_Test",
    "--mail", "heavy",
    "--locales", "en,ar",
    "--no-base",
  ], { cwd: root, maxBuffer: 2 * 1024 * 1024 });
  assert.match(heavyBuild.stderr, /WARN weight: ar HTML[\s\S]*102\.0 KiB client-clipping risk threshold/i);
  assert.match(heavyBuild.stderr, /Gmail may clip the message/i);

  let strictError = null;
  try {
    await execFileAsync(process.execPath, [
      buildMailPath,
      "--category", "X_Test",
      "--mail", "heavy",
      "--locales", "en,ar",
      "--no-base",
      "--failOnWeight",
    ], { cwd: root, maxBuffer: 2 * 1024 * 1024 });
  } catch (error) {
    strictError = error;
  }
  assert.ok(strictError, "strict weight gate must reject HTML at/above the clipping threshold");
  assert.match(String(strictError.stderr || ""), /Email weight limit exceeded/i);
  assert.match(String(strictError.stderr || ""), /limit 102\.0 KiB/i);
  assert.match(String(strictError.stderr || ""), /en: 110\.\d KiB[\s\S]*ar: 112\.\d KiB/i,
    "strict weight gate must inspect and report every overweight locale before failing");

  console.log("✓ build-mail CSS/head contract + non-blocking weight warning + opt-in strict gate");
} finally {
  await rm(root, { recursive: true, force: true });
}
