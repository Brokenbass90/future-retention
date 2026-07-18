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
  ].join("\n"));

  await execFileAsync(process.execPath, [
    buildMailPath,
    "--category", "X_Test",
    "--mail", "css",
    "--skip-locales",
    "--no-minifyCss",
  ], { cwd: root, maxBuffer: 2 * 1024 * 1024 });

  const html = await readFile(path.join(root, "dist/X_Test/mail-css/index.html"), "utf8");

  assert.match(html, /<table[^>]+class="card"[^>]+style="[^"]*background-color:\s*#e5e7eb/i);
  assert.match(html, /<td[^>]+class="card__cell"[^>]+style="[^"]*color:\s*#123456/i);
  assert.match(html, /<td[^>]+class="card__cell"[^>]+style="[^"]*padding:\s*12px 24px/i);
  assert.match(html, /<style[^>]*>[\s\S]*@media only screen and \(max-width:\s*600px\)/i);
  assert.match(html, /@media[\s\S]*\.card[\s\S]*width:\s*100%\s*!important/i);
  assert.doesNotMatch(html, /<style[^>]*>[\s\S]*\.card\s*\{\s*background-color:\s*#e5e7eb/i);

  console.log("✓ build-mail CSS pipeline: Stylus inline styles + media queries in head");
} finally {
  await rm(root, { recursive: true, force: true });
}
