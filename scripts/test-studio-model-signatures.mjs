import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, rm, unlink, writeFile } from "node:fs/promises";

import {
  buildStudioModelSourceSignatures,
  compareStudioModelSourceSignatures,
  STUDIO_MODEL_SIGNATURES_ALGORITHM,
  STUDIO_MODEL_SIGNATURES_VERSION,
} from "../src/studio-model-signatures.js";

const root = await mkdtemp(path.join(os.tmpdir(), "retkit-studio-signatures-"));

async function put(relativePath, contents) {
  const target = path.join(root, relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, contents);
}

function sha256(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

try {
  await put("app/templates/blocks/header.pug", "p HEADER-PUG\n");
  await put("app/templates/blocks/header.jade", "p HEADER-JADE\n");
  await put("app/styles/blocks/main.styl", ".mail\n  color #111\n");
  await put("app/templates/helpers/footer.pug", "p FOOTER-PUG\n");
  await put("app/templates/helpers/footer.jade", "p FOOTER-JADE\n");

  const initial = buildStudioModelSourceSignatures(root);
  assert.equal(initial.version, STUDIO_MODEL_SIGNATURES_VERSION);
  assert.equal(initial.algorithm, STUDIO_MODEL_SIGNATURES_ALGORITHM);
  assert.equal(initial.sources.header.path, "app/templates/blocks/header.pug");
  assert.equal(initial.sources.header.sha256, sha256("p HEADER-PUG\n"));
  assert.equal(initial.sources.header.bytes, Buffer.byteLength("p HEADER-PUG\n"));
  assert.equal(initial.sources.footer.path, "app/templates/helpers/footer.pug");
  assert.equal(initial.sources.mainStyl.path, "app/styles/blocks/main.styl");
  assert.equal(compareStudioModelSourceSignatures(root, initial).matches, true);

  // A lower-priority Jade alias is inactive while its Pug counterpart exists.
  await put("app/templates/blocks/header.jade", "p CHANGED-INACTIVE-JADE\n");
  await put("app/templates/helpers/footer.jade", "p CHANGED-INACTIVE-JADE\n");
  assert.equal(compareStudioModelSourceSignatures(root, initial).matches, true);

  await put("app/templates/blocks/header.pug", "p CHANGED-HEADER\n");
  let compared = compareStudioModelSourceSignatures(root, initial);
  assert.equal(compared.matches, false);
  assert.deepEqual(compared.mismatches.map((item) => [item.key, item.reason]), [
    ["header", "content-changed"],
  ]);

  // Re-baseline, then ensure a priority switch from Pug to Jade is detected
  // even if both files happen to contain identical bytes.
  await put("app/templates/blocks/header.pug", "p SAME\n");
  await put("app/templates/blocks/header.jade", "p SAME\n");
  const beforeHeaderFallback = buildStudioModelSourceSignatures(root);
  await unlink(path.join(root, "app/templates/blocks/header.pug"));
  compared = compareStudioModelSourceSignatures(root, beforeHeaderFallback);
  assert.equal(compared.matches, false);
  assert.equal(compared.mismatches[0].key, "header");
  assert.equal(compared.mismatches[0].reason, "preferred-source-changed");
  assert.equal(compared.current.sources.header.path, "app/templates/blocks/header.jade");

  const beforeStylChange = buildStudioModelSourceSignatures(root);
  await put("app/styles/blocks/main.styl", ".mail\n  color #222\n");
  compared = compareStudioModelSourceSignatures(root, beforeStylChange);
  assert.deepEqual(compared.mismatches.map((item) => [item.key, item.reason]), [
    ["mainStyl", "content-changed"],
  ]);

  const beforeFooterFallback = buildStudioModelSourceSignatures(root);
  await unlink(path.join(root, "app/templates/helpers/footer.pug"));
  compared = compareStudioModelSourceSignatures(root, beforeFooterFallback);
  assert.equal(compared.mismatches.some((item) => (
    item.key === "footer" && item.reason === "preferred-source-changed"
  )), true);
  assert.equal(compared.current.sources.footer.path, "app/templates/helpers/footer.jade");

  // Missing is a signed state. Adding a previously absent source invalidates it.
  await unlink(path.join(root, "app/templates/helpers/footer.jade"));
  const withoutFooter = buildStudioModelSourceSignatures(root);
  assert.deepEqual(withoutFooter.sources.footer, {
    path: null,
    exists: false,
    bytes: 0,
    sha256: null,
  });
  await put("app/templates/helpers/footer.jade", "p NEW-FOOTER\n");
  compared = compareStudioModelSourceSignatures(root, withoutFooter);
  assert.equal(compared.mismatches.some((item) => (
    item.key === "footer" && item.reason === "source-added"
  )), true);

  const legacy = compareStudioModelSourceSignatures(root, null);
  assert.equal(legacy.matches, false);
  assert.equal(legacy.verifiable, false);
  assert.equal(legacy.reason, "missing-signatures");

  const unsupported = compareStudioModelSourceSignatures(root, {
    ...buildStudioModelSourceSignatures(root),
    version: 999,
  });
  assert.equal(unsupported.matches, false);
  assert.equal(unsupported.verifiable, false);
  assert.equal(unsupported.reason, "unsupported-version");

  // The persisted shape must remain stable through studio-model JSON storage.
  const roundTrip = JSON.parse(JSON.stringify(buildStudioModelSourceSignatures(root)));
  assert.equal(compareStudioModelSourceSignatures(root, roundTrip).matches, true);

  console.log("✓ studio-model signatures: priority, fallback, content, missing and legacy cases");
} finally {
  await rm(root, { recursive: true, force: true });
}
