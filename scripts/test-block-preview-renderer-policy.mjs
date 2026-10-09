#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  contentSamplingRect,
  previewKeysToPrune,
} from "../src/block-preview-renderer-policy.js";
import { previewBackdropForBlock } from "../src/block-previews.js";

// A narrow block is sampled inside the fixed 600px screenshot, not across
// the surrounding white column.
assert.deepEqual(
  contentSamplingRect(210, 490, { x: 50, width: 600 }),
  { dx: 160, width: 280 },
);

// Fractional and overflowing browser bounds are clamped to valid PNG pixels.
assert.deepEqual(
  contentSamplingRect(49.2, 651.8, { x: 50, width: 600 }),
  { dx: 0, width: 600 },
);
assert.deepEqual(
  contentSamplingRect(900, 920, { x: 50, width: 600 }),
  { dx: 599, width: 1 },
);

const index = {
  blocks: {
    "canonical:keep": {},
    "canonical:stale": {},
    "imported:keep": {},
    "imported:stale": {},
    "user:keep": {},
    "user:stale": {},
  },
};
const library = [
  { source: "canonical", id: "keep" },
  { source: "imported", id: "keep" },
  { source: "user", id: "keep" },
];

assert.deepEqual(
  previewKeysToPrune(index, library, { source: "canonical" }),
  ["canonical:stale"],
  "a canonical-only render must not prune imported or user previews",
);
assert.deepEqual(
  previewKeysToPrune(index, library, { source: "imported" }),
  ["imported:stale"],
  "an imported-only render must not prune canonical or user previews",
);
assert.deepEqual(
  previewKeysToPrune(index, library, { source: "user" }),
  ["user:stale"],
  "a user-only render must not prune canonical or imported previews",
);
assert.deepEqual(
  previewKeysToPrune(index, library, { source: "all" }),
  ["canonical:stale", "imported:stale", "user:stale"],
);
assert.deepEqual(
  previewKeysToPrune(index, [], { source: "canonical", only: "one-block" }),
  [],
  "a partial --only render never owns enough context to prune",
);

assert.equal(previewBackdropForBlock({
  slots: [{ id: "color", kind: "color", default: "#ECECED" }],
}), "#101314", "transparent light text gets a contrast backdrop in screenshots");
assert.equal(previewBackdropForBlock({
  slots: [{ id: "color", kind: "color", default: "#393A44" }],
}), "", "dark text remains on the normal light preview surface");
assert.equal(previewBackdropForBlock({
  slots: [
    { id: "text_color", kind: "color", default: "#FFFFFF" },
    { id: "background_color", kind: "color", default: "#FF5500" },
  ],
}), "", "a block with its own surface does not receive a wrapper override");

console.log("block preview renderer policy: content bounds and source-safe pruning ok");
