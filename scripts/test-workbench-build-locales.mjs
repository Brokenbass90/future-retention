import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";

import {
  chooseWorkbenchBuildLocalePolicy,
  listExistingCompiledLocales,
  resolveWorkbenchBuildLocalePolicy,
} from "../src/workbench-build-locales.js";

const root = await mkdtemp(path.join(os.tmpdir(), "retkit-workbench-build-locales-"));

async function put(relativePath, content = "html") {
  const target = path.join(root, relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content, "utf8");
}

try {
  await put("en/index.html");
  await put("ru/index.html");
  await put("pt_BR/index.html");
  await put("de/not-index.txt");
  await put("invalid_locale/index.html");
  await put("index.html", "Original");

  assert.deepEqual(await listExistingCompiledLocales(root), ["en", "pt_BR", "ru"]);

  assert.deepEqual(
    await resolveWorkbenchBuildLocalePolicy({
      namespacesProvided: true,
      syncedLocales: [],
      distRoot: root,
    }),
    { mode: "selected", locales: ["en", "pt_BR", "ru"], source: "existing-dist" },
    "builtin-only snapshot must preserve this mail's compiled locale set",
  );

  assert.deepEqual(
    chooseWorkbenchBuildLocalePolicy({
      namespacesProvided: true,
      syncedLocales: ["fr", "en", "fr"],
      existingLocales: ["ru"],
    }),
    { mode: "selected", locales: ["en", "fr"], source: "snapshot" },
    "an editable snapshot remains authoritative",
  );

  assert.deepEqual(
    await resolveWorkbenchBuildLocalePolicy({
      namespacesProvided: true,
      syncedLocales: [],
      distRoot: path.join(root, "missing"),
    }),
    { mode: "skip", locales: [], source: "empty-workspace" },
  );
  assert.deepEqual(
    chooseWorkbenchBuildLocalePolicy({ namespacesProvided: false }),
    { mode: "discover", locales: [], source: "vendor" },
  );

  console.log("✓ workbench build locales: snapshot, existing dist fallback, Original-only fallback");
} finally {
  await rm(root, { recursive: true, force: true });
}
