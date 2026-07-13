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
const root = await mkdtemp(path.join(os.tmpdir(), "retkit-build-localization-"));

async function put(relativePath, content) {
  const target = path.join(root, relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content, "utf8");
}

try {
  await put("X_Test/mail-demo/app/templates/index.html", [
    "<!doctype html><html><body>",
    "<p>${{ flat.block_00 }}$</p>",
    "<p>${{ wrapped.block_00 }}$</p>",
    "<p>${{ missing.block_00 }}$</p>",
    "<p>${{ flat.constructor.name }}$</p>",
    "</body></html>",
  ].join(""));
  await put("vendor/data/en/flat.json", JSON.stringify({ block_00: "Flat value" }));
  await put("vendor/data/en/wrapped.json", JSON.stringify({ wrapped: { block_00: "Wrapped value" } }));

  const result = await execFileAsync(process.execPath, [
    buildMailPath,
    "--category", "X_Test",
    "--mail", "demo",
    "--locales", "en",
  ], { cwd: root, maxBuffer: 2 * 1024 * 1024 });

  const base = await readFile(path.join(root, "dist/X_Test/mail-demo/index.html"), "utf8");
  const localized = await readFile(path.join(root, "dist/X_Test/mail-demo/en/index.html"), "utf8");
  assert.match(base, /\$\{\{ flat\.block_00 \}\}\$/);
  assert.match(localized, /Flat value/);
  assert.match(localized, /Wrapped value/);
  assert.match(localized, /\$\{\{ missing\.block_00 \}\}\$/);
  assert.match(localized, /\$\{\{ flat\.constructor\.name \}\}\$/);
  assert.match(result.stderr, /2 unresolved placeholder/);

  // An explicitly empty Workbench locale workspace must build Original only,
  // not silently expand to every historical vendor/data locale.
  await execFileAsync(process.execPath, [
    buildMailPath,
    "--category", "X_Test",
    "--mail", "demo",
    "--skip-locales",
  ], { cwd: root, maxBuffer: 2 * 1024 * 1024 });
  await readFile(path.join(root, "dist/X_Test/mail-demo/index.html"), "utf8");
  await assert.rejects(
    readFile(path.join(root, "dist/X_Test/mail-demo/en/index.html"), "utf8"),
    (error) => error?.code === "ENOENT",
  );
  console.log("✓ build-mail localization: flat + wrapped JSON, Original, missing diagnostics");
} finally {
  await rm(root, { recursive: true, force: true });
}
