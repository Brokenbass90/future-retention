import assert from "node:assert/strict";

import {
  acquireKeyedOperationLock,
  withKeyedOperationLock,
} from "../src/keyed-operation-lock.js";

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

const firstEntered = deferred();
const releaseFirst = deferred();
const differentKeyEntered = deferred();
const events = [];

const first = withKeyedOperationLock("mail:X/mail-a", async () => {
  events.push("first-enter");
  firstEntered.resolve();
  await releaseFirst.promise;
  events.push("first-exit");
});
await firstEntered.promise;

let secondEntered = false;
const second = withKeyedOperationLock("mail:X/mail-a", async () => {
  secondEntered = true;
  events.push("second-enter");
});
const different = withKeyedOperationLock("mail:X/mail-b", async () => {
  events.push("different-enter");
  differentKeyEntered.resolve();
});

await differentKeyEntered.promise;
assert.equal(secondEntered, false, "same-mail operation must wait");
assert.deepEqual(events, ["first-enter", "different-enter"]);
releaseFirst.resolve();
await Promise.all([first, second, different]);
assert.deepEqual(events, ["first-enter", "different-enter", "first-exit", "second-enter"]);

await assert.rejects(
  withKeyedOperationLock("mail:X/mail-error", async () => { throw new Error("synthetic failure"); }),
  /synthetic failure/,
);
let ranAfterFailure = false;
await withKeyedOperationLock("mail:X/mail-error", async () => { ranAfterFailure = true; });
assert.equal(ranAfterFailure, true, "a failed operation must release its key");

const release = await acquireKeyedOperationLock("mail:X/mail-idempotent");
release();
release();
await withKeyedOperationLock("mail:X/mail-idempotent", async () => {});

console.log("✓ keyed operation lock: same-key serialization, cross-key concurrency, failure release");
