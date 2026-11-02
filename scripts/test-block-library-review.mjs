#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  assertBlockReleaseApproved,
  blockReviewStatus,
  buildUserBlockReview,
  inspectPortableBlockSource,
  saveUserBlockWithLifecycle,
  userBlockReviewIsCurrent,
  validateUserBlockDeterministically,
} from "../src/block-library-review.js";

const validBlock = {
  id: "my-safe-card",
  source: "user",
  placement: "inner",
  category: "text",
  pug: "table.my-safe-card(role='presentation' width='100%' style='background-color:{{ background_color }}')\n  tr\n    td {{ text }}",
  styl: ".my-safe-card\n  width 100%\n  color {{ text_color }}",
  slots: [
    { id: "text", kind: "text", label: "Text", default: "Safe copy" },
    { id: "text_color", kind: "color", label: "Text color", default: "#393A44" },
    { id: "background_color", kind: "color", label: "Background", default: "transparent" },
  ],
};

const valid = await validateUserBlockDeterministically(validBlock, { checkedAt: "2026-07-16T00:00:00.000Z" });
assert.equal(valid.passed, true, `valid hand-authored Pug/Stylus passes: ${valid.errors.join("; ")}`);
assert.deepEqual(valid.errors, [], "valid block has no deterministic errors");
assert.deepEqual(valid.checks, {
  schema: true,
  tokenContract: true,
  security: true,
  portablePug: true,
  pugCompile: true,
  stylusCompile: true,
  emailSafe: true,
  desktop: true,
  mobile: true,
  rtl: true,
  dependencies: true,
});

const candidate = buildUserBlockReview({ validation: valid, requestedStatus: "candidate" });
assert.equal(candidate.status, "candidate", "a successful save enters candidate, not approved");
assert.equal(candidate.ai.status, "not-requested", "AI review is optional advisory metadata");
assert.equal(blockReviewStatus({ ...validBlock, review: candidate }), "candidate", "catalog reads persisted candidate status");

const approved = buildUserBlockReview({ validation: valid, requestedStatus: "approved", previousReview: candidate });
assert.equal(approved.status, "approved", "manual approval can release a deterministically valid candidate");
assert.equal(blockReviewStatus({ source: "canonical" }), "approved", "canonical blocks remain release-approved");
assert.equal(userBlockReviewIsCurrent({ ...validBlock, review: approved }), true, "approved review is tied to the exact current source and validator");
assert.doesNotThrow(() => assertBlockReleaseApproved({ ...validBlock, review: approved }, "user"), "current approved user block passes release enforcement");
assert.equal(
  blockReviewStatus({ ...validBlock, pug: `${validBlock.pug}\n// hand-edited`, review: approved }),
  "draft",
  "editing JSON/source behind the lifecycle fails closed instead of retaining approved",
);

for (const [label, patch, failedCheck, expected] of [
  [
    "interactive form markup",
    { pug: "form\n  p Unsafe", styl: "", slots: [] },
    "emailSafe",
    /not portable across email clients/i,
  ],
  [
    "desktop width above the email canvas",
    { pug: "table(role='presentation' width='640')\n  tr\n    td Too wide", styl: "", slots: [] },
    "desktop",
    /above the 600px email canvas/i,
  ],
  [
    "mobile min-width overflow",
    { pug: "table.mobile-test(role='presentation')\n  tr\n    td Mobile", styl: ".mobile-test\n  min-width 500px", slots: [] },
    "mobile",
    /375px validation viewport/i,
  ],
  [
    "hard-coded LTR direction",
    { pug: "p(dir='ltr') Direction", styl: "", slots: [] },
    "rtl",
    /hard-coded LTR/i,
  ],
]) {
  const result = await validateUserBlockDeterministically({ ...validBlock, id: `bad-${failedCheck}`, ...patch });
  assert.equal(result.passed, false, `${label} cannot become a candidate`);
  assert.equal(result.checks[failedCheck], false, `${label} fails the ${failedCheck} release check`);
  assert.match(result.errors.join("\n"), expected, `${label} has an actionable diagnostic`);
}

const quarantinedCombo = await validateUserBlockDeterministically({
  ...validBlock,
  id: "combo-with-imported-child",
  combo: true,
  children: [{ id: "legacy-child", slots: {} }],
}, {
  resolveDependency: () => ({ origin: "imported", block: { id: "legacy-child", source: "imported" } }),
});
assert.equal(quarantinedCombo.passed, false, "a combo cannot promote quarantined imported content");
assert.equal(quarantinedCombo.checks.dependencies, false, "combo dependency gate fails closed");
assert.match(quarantinedCombo.errors.join("\n"), /quarantined legacy\/imported/i);

const missingSlot = await validateUserBlockDeterministically({
  ...validBlock,
  id: "missing-slot",
  pug: "p {{ undeclared_copy }}",
  styl: "",
  slots: [],
});
assert.equal(missingSlot.passed, false, "an undeclared template token fails validation");
assert.match(missingSlot.errors.join("\n"), /undeclared_copy.*no slot/i);
assert.equal(buildUserBlockReview({ validation: missingSlot, requestedStatus: "approved" }).status, "draft", "failed validation can never be approved");

const executable = await validateUserBlockDeterministically({
  ...validBlock,
  id: "unsafe-pug",
  pug: "- process.exit(1)\np Unsafe",
  styl: "",
  slots: [],
});
assert.equal(executable.passed, false, "executable Pug is rejected before preview/build");
assert.match(executable.errors.join("\n"), /executable Pug/i);

for (const [label, patch, expected] of [
  ["inline process.env expression", { pug: "p= process.env.HOME", styl: "" }, /AST node Code|executable Pug/i],
  ["Pug interpolation", { pug: "p #{process.env.HOME}", styl: "" }, /interpolation|AST node Code/i],
  ["newline code", { pug: "p Safe\n- process.exit(1)", styl: "" }, /executable Pug/i],
  ["include", { pug: "include /etc/passwd", styl: "" }, /includes|AST node RawInclude/i],
  ["mixin call", { pug: "+danger()", styl: "" }, /mixin calls|AST node Mixin/i],
  ["dynamic attribute", { pug: "p(class=process.env.HOME) Unsafe", styl: "" }, /dynamic\/unquoted|static literal/i],
  ["Stylus import", { pug: "p Safe", styl: "@import '/etc/passwd'" }, /import\/require\/use/i],
  ["Stylus require", { pug: "p Safe", styl: "@require '/etc/passwd'" }, /import\/require\/use/i],
]) {
  const result = inspectPortableBlockSource({ ...validBlock, ...patch, slots: [] });
  assert.equal(result.passed, false, `${label} is rejected by the shared preview/save gate`);
  assert.match(result.errors.join("\n"), expected, `${label} has an actionable diagnostic`);
}

const unsafeDefault = await validateUserBlockDeterministically({
  ...validBlock,
  id: "unsafe-default",
  pug: "p {{ text }}",
  styl: "",
  slots: [{ id: "text", kind: "text", default: "#{process.env.HOME}" }],
});
assert.equal(unsafeDefault.passed, false, "slot defaults cannot become Pug interpolation before validation");
assert.match(unsafeDefault.errors.join("\n"), /slot .* default.*interpolation/i);

const brokenStylus = await validateUserBlockDeterministically({
  ...validBlock,
  id: "broken-stylus",
  pug: "p Safe",
  styl: ".broken\n  color (",
  slots: [],
});
assert.equal(brokenStylus.passed, false, "invalid Stylus remains a draft");
assert.match(brokenStylus.errors.join("\n"), /Stylus:/i);

assert.equal(blockReviewStatus({ source: "user" }), "draft", "legacy user JSON without review metadata is fail-closed");

const aiAdvisory = { status: "completed", note: "same-source advice" };
const sameSourceReview = buildUserBlockReview({
  validation: valid,
  requestedStatus: "candidate",
  previousReview: { sourceHash: valid.sourceHash, ai: aiAdvisory },
});
assert.deepEqual(sameSourceReview.ai, aiAdvisory, "same-source optional AI advice survives a status transition");
const changedValidation = await validateUserBlockDeterministically({ ...validBlock, pug: `${validBlock.pug}\n// changed` });
const changedReview = buildUserBlockReview({
  validation: changedValidation,
  requestedStatus: "candidate",
  previousReview: sameSourceReview,
});
assert.equal(changedReview.ai.status, "not-requested", "editing source clears stale AI advice");
assert.notEqual(changedReview.sourceHash, sameSourceReview.sourceHash, "source hash identifies the exact reviewed bytes/contract");

const lifecycleRoot = mkdtempSync(path.join(os.tmpdir(), "retkit-user-block-lifecycle-"));
const lifecycleTarget = path.join(lifecycleRoot, "atomic-candidate.json");
try {
  const simultaneous = await Promise.allSettled([
    saveUserBlockWithLifecycle({ payload: { ...validBlock, id: "atomic-candidate" }, target: lifecycleTarget }),
    saveUserBlockWithLifecycle({ payload: { ...validBlock, id: "atomic-candidate" }, target: lifecycleTarget }),
  ]);
  assert.equal(simultaneous.filter((item) => item.status === "fulfilled").length, 1, "keyed lifecycle lock permits one create");
  assert.equal(simultaneous.filter((item) => item.status === "rejected").length, 1, "racing create receives a deterministic conflict");
  const saved = simultaneous.find((item) => item.status === "fulfilled").value;
  assert.equal(saved.review.status, "candidate", "unified save lifecycle persists a candidate");
  assert.equal(saved.review.sourceHash, saved.validation.sourceHash, "persisted review is tied to validation source hash");
  assert.deepEqual(readdirSync(lifecycleRoot), ["atomic-candidate.json"], "atomic writer leaves no temporary files behind");
} finally {
  rmSync(lifecycleRoot, { recursive: true, force: true });
}

console.log("block library review: ok");
