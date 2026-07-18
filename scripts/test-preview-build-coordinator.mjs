import assert from "node:assert/strict";
import {
  createPreviewBuildCoordinator,
  createPreviewBuildKey,
  previewBuildPriority,
} from "../src/preview-build-coordinator.js";

const keyA = createPreviewBuildKey({ blocks: [{ id: "a" }], sourceBrand: "X" });
assert.equal(keyA, createPreviewBuildKey({ blocks: [{ id: "a" }], sourceBrand: "X" }));
assert.notEqual(keyA, createPreviewBuildKey({ blocks: [{ id: "b" }], sourceBrand: "X" }));
assert.equal(previewBuildPriority("thumb-card-1"), 0);
assert.equal(previewBuildPriority("block-author-preview"), 10);
assert.equal(previewBuildPriority("welcome-live-session-4"), 20);

// In-flight requests for the same render share one task, then the completed
// value is served from the short-lived cache.
{
  const coordinator = createPreviewBuildCoordinator({ maxConcurrent: 2, ttlMs: 1000 });
  let calls = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const task = async () => { calls += 1; await gate; return { html: "ok" }; };
  const first = coordinator.run({ key: "same", task });
  const shared = coordinator.run({ key: "same", task });
  await Promise.resolve();
  release();
  const [a, b] = await Promise.all([first, shared]);
  assert.equal(calls, 1);
  assert.equal(a.cacheStatus, "miss");
  assert.equal(b.cacheStatus, "shared");
  const hit = await coordinator.run({ key: "same", task });
  assert.equal(hit.cacheStatus, "hit");
  assert.equal(calls, 1);
}

// A live canvas render jumps ahead of queued thumbnail work.
{
  const coordinator = createPreviewBuildCoordinator({ maxConcurrent: 1, ttlMs: 1000 });
  const order = [];
  let releaseFirst;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  const first = coordinator.run({ key: "first", priority: 0, task: async () => { order.push("first"); await firstGate; return 1; } });
  await Promise.resolve();
  const low = coordinator.run({ key: "low", priority: 0, task: async () => { order.push("low"); return 2; } });
  const high = coordinator.run({ key: "high", priority: 20, task: async () => { order.push("high"); return 3; } });
  releaseFirst();
  await Promise.all([first, low, high]);
  assert.deepEqual(order, ["first", "high", "low"]);
}

// Expiration and LRU eviction both force a fresh render.
{
  let clock = 0;
  const coordinator = createPreviewBuildCoordinator({ maxCacheEntries: 1, ttlMs: 10, now: () => clock });
  let calls = 0;
  const task = async () => ++calls;
  await coordinator.run({ key: "a", task });
  await coordinator.run({ key: "b", task });
  await coordinator.run({ key: "a", task });
  assert.equal(calls, 3, "a must be evicted when the one-entry cache stores b");
  clock = 20;
  await coordinator.run({ key: "a", task });
  assert.equal(calls, 4, "expired result must rebuild");
}

console.log("preview build coordinator: ok");
