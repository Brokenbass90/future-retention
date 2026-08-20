#!/usr/bin/env node

import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { blockPreviewSourceHash } from "../src/block-previews.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const canonicalDir = path.join(repoRoot, "data", "block-library", "canonical");
const previewRoot = path.join(repoRoot, "data", "block-previews");
const indexPath = path.join(previewRoot, "index.json");
const index = JSON.parse(readFileSync(indexPath, "utf8"));

const canonical = readdirSync(canonicalDir)
  .filter((file) => file.endsWith(".json") && file !== "index.json" && !file.startsWith("_"))
  .map((file) => JSON.parse(readFileSync(path.join(canonicalDir, file), "utf8")))
  .sort((left, right) => left.id.localeCompare(right.id));

const expectedKeys = new Set();
for (const block of canonical) {
  const key = `canonical:${block.id}`;
  expectedKeys.add(key);
  const entry = index.blocks?.[key];
  assert.ok(entry, `${key} must have a committed preview index entry`);
  assert.equal(entry.error, undefined, `${key} preview must not be an error`);
  assert.equal(
    entry.hash,
    blockPreviewSourceHash(block),
    `${key} preview is stale; run npm run previews -- --source canonical`,
  );

  for (const profile of ["desktop", "mobile"]) {
    const shot = entry.shots?.[profile];
    assert.ok(shot?.file, `${key} must have a ${profile} preview`);
    assert.ok(Number(shot.width) > 0 && Number(shot.height) > 0, `${key} ${profile} dimensions must be positive`);
    const absolute = path.resolve(repoRoot, shot.file);
    assert.ok(
      absolute.startsWith(`${previewRoot}${path.sep}`),
      `${key} ${profile} preview must stay inside data/block-previews`,
    );
    assert.ok(existsSync(absolute), `${key} ${profile} preview file is missing`);
    assert.ok(statSync(absolute).size > 100, `${key} ${profile} preview file is unexpectedly empty`);
    const signature = readFileSync(absolute).subarray(0, 8).toString("hex");
    assert.equal(signature, "89504e470d0a1a0a", `${key} ${profile} preview must be a PNG`);
  }
}

const indexedCanonical = Object.keys(index.blocks || {}).filter((key) => key.startsWith("canonical:"));
assert.deepEqual(
  indexedCanonical.filter((key) => !expectedKeys.has(key)),
  [],
  "preview index must not retain orphan canonical entries",
);

console.log(`canonical preview release: ${canonical.length} blocks × desktop/mobile are present and fresh`);
