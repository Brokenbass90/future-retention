#!/usr/bin/env node

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { composeEmailFromBlocks } from "../src/compose-email.js";
import { classifyConstructorTopLevelLine } from "../src/constructor-legacy-parse.js";
import { stageComposeSkeletonIfDestination } from "../src/compose-skeleton-stage.js";
import { constructorBuildMailArgs } from "../src/constructor-build-policy.js";
import { listCodeWorkspace } from "../src/code-workspace.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const constructorSource = readFileSync(path.join(root, "public", "constructor.js"), "utf8");
const constructorHtml = readFileSync(path.join(root, "public", "constructor.html"), "utf8");
const canonical = (id) => JSON.parse(readFileSync(path.join(root, "data", "block-library", "canonical", `${id}.json`), "utf8"));

function functionSource(name) {
  const start = constructorSource.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} exists`);
  const brace = constructorSource.indexOf("{", start);
  let depth = 0;
  for (let i = brace; i < constructorSource.length; i += 1) {
    if (constructorSource[i] === "{") depth += 1;
    else if (constructorSource[i] === "}") {
      depth -= 1;
      if (depth === 0) return constructorSource.slice(start, i + 1);
    }
  }
  throw new Error(`unterminated function ${name}`);
}

const shouldAutoOpen = Function(`return (${functionSource("shouldAutoOpenInnerForCatalogBlock")})`)();
const canAutoAddDrop = Function(`return (${functionSource("canAutoAddCatalogDrop")})`)();
const readySection = {
  placement: "section",
  childSlots: [{ id: "content", accepts: ["inner"] }],
};
assert.equal(shouldAutoOpen(readySection, "catalog"), true, "catalog click/add on ready section advances to inner blocks");
assert.equal(shouldAutoOpen(readySection, "selection"), false, "outline selection does not change the catalog tab");
assert.equal(shouldAutoOpen(readySection, "preview"), false, "preview selection does not change the catalog tab");
assert.equal(shouldAutoOpen({ ...readySection, combo: true }, "catalog"), false, "combo insertion keeps the combo workflow open");
assert.equal(shouldAutoOpen({ placement: "section", childSlots: [] }, "catalog"), false, "leaf section divider does not open inner blocks");
assert.equal(canAutoAddDrop({ placement: "section", combo: true }, null), true, "empty canvas accepts a catalog combo/section and lets addToCanvas bootstrap outer");
assert.equal(canAutoAddDrop({ placement: "inner" }, null), true, "empty canvas accepts a catalog inner block and lets addToCanvas bootstrap outer + section");
assert.equal(canAutoAddDrop({ placement: "inner" }, "moving-uid"), false, "bootstrap fallback never reparents an existing canvas drag without a real target");

const syncSource = functionSource("syncPaletteToSelection");
assert.doesNotMatch(syncSource, /state\.filter\s*=/, "selection sync never mutates the active catalog filter");
assert.doesNotMatch(syncSource, /setCatalogFilter\s*\(/, "selection sync never invokes a catalog switch");
const dndSource = functionSource("wireCanvasDnd");
assert.ok(
  dndSource.indexOf("latestSectionEntry(block)") < dndSource.indexOf("state.canvas.filter((e) => e.parentUid == null)"),
  "tree drop fallback routes inner blocks to the selected/latest compatible section before checking outer slots",
);
assert.match(dndSource, /beforeUid: context\.beforeUid/, "tree drop keeps the exact before/after sibling target");
assert.match(dndSource, /context\.autoAdd/, "tree drop accepts catalog blocks through the same bootstrap path as click-add");
const previewStageDndSource = functionSource("wirePreviewStageDnd");
assert.match(previewStageDndSource, /canAutoAddCatalogDrop\(block, null\)/, "empty preview stage accepts section/combo and inner catalog drops");
assert.match(previewStageDndSource, /addToCanvas\(block, \{ origin: "catalog" \}\)/, "preview-stage bootstrap delegates to the click-add tree rules");

const uniquePreviewName = Function(`return (${functionSource("livePreviewRequestMailName")})`)();
const liveOne = uniquePreviewName("Welcome Demo", 41, "test-session");
const liveTwo = uniquePreviewName("Welcome Demo", 42, "test-session");
assert.notEqual(liveOne, liveTwo, "overlapping live preview tokens use different temporary mail folders");
assert.match(liveOne, /^[a-z0-9_-]+$/, "live preview temporary mail name stays server-safe");
const runLiveSource = functionSource("runLivePreview");
assert.match(runLiveSource, /livePreviewRequestMailName\([^,]+, token\)/, "every live preview request uses the unique tokenized name");

const loadBlockReason = Function(`return (${functionSource("parsedEmailLoadBlockReason")})`)();
assert.equal(loadBlockReason({ studioModelStale: false }), "", "fresh studio model is allowed back into the constructor");
assert.match(loadBlockReason({ studioModelStale: true }), /отвязано.*Workbench|Workbench.*копию/i, "stale studio model is blocked with an actionable workbench/copy message");
const loadParsedSource = functionSource("loadParsedEmail");
assert.ok(loadParsedSource.indexOf("parsedEmailLoadBlockReason(d)") < loadParsedSource.indexOf("state.canvas ="), "stale guard runs before any constructor state mutation");

const innerDivider = canonical("iq-spacer");
const outerDivider = canonical("iq-section-spacer");
assert.equal(innerDivider.placement, "inner", "canonical inner divider has an explicit inner level");
assert.equal(outerDivider.placement, "section", "canonical outer divider has an explicit section level");
assert.ok(outerDivider.tags.includes("combo-divider"), "outer divider is available alongside combo blocks");
assert.match(outerDivider.pug, /^table\.row/m, "outer divider is an email-safe section sibling");
assert.match(innerDivider.pug, /^\.h-/m, "inner divider remains compact inside a section");
for (const [label, divider] of [["inner", innerDivider], ["outer", outerDivider]]) {
  const backgroundSlot = divider.slots.find((slot) => slot.id === "background_color");
  assert.equal(backgroundSlot?.kind, "color", `${label} divider exposes its background in the inspector`);
  assert.equal(backgroundSlot?.default, "transparent", `${label} divider does not create a white stripe by default`);
  assert.match(divider.pug, /background-color:\{\{ background_color \}\}/, `${label} divider applies its chosen background to rendered Pug`);
}

assert.match(
  constructorSource,
  /for \(const groupId of \["appearance", "content", "assets", "advanced"\]\)/,
  "block appearance is shown before long content and asset fields",
);
assert.match(constructorSource, /Поверхность блока/, "every rendered selected block gets one common appearance panel");
assert.match(constructorSource, /background_color[\s\S]*?border[\s\S]*?radius[\s\S]*?padding/, "common appearance covers background, border, radius and padding");
assert.match(functionSource("canvasToBlocks"), /out\.appearance/, "generic appearance overrides survive constructor save and code transfer");
assert.match(functionSource("saveSelectedAsUserBlock"), /payload\.appearance/, "generic appearance becomes a default when saving a reusable user block");
assert.match(constructorSource, /function instantiateCombo[\s\S]*?appearance:\s*child\.appearance/, "combo recipes pass child surface tuning into editable instances");
assert.match(constructorSource, /data-transparent-slot=/, "background controls provide an explicit transparent/inherit action");
assert.match(constructorSource, /data-reset-appearance-all/, "common appearance has one clear reset action");
assert.match(functionSource("buildAuthorSlots"), /uiGroup:\s*slotInspectorGroup/, "manual block style slots keep their inspector group when saved");
const authorTemplatesSource = constructorSource.slice(
  constructorSource.indexOf("const AUTHOR_TEMPLATES"),
  constructorSource.indexOf("const SLOT_KINDS"),
);
assert.match(authorTemplatesSource, /"outer-divider"[\s\S]*?background_color/, "manual outer divider template includes a background slot");
assert.match(authorTemplatesSource, /"inner-divider"[\s\S]*?background_color/, "manual inner divider template includes a background slot");
assert.match(authorTemplatesSource, /inner:\s*\{[\s\S]*?border:[\s\S]*?radius:[\s\S]*?padding:/, "manual inner template includes border, radius and padding tuning");
const guessSlotKind = Function(`return (${functionSource("guessSlotKind")})`)();
const defaultForKind = Function(`return (${functionSource("defaultForKind")})`)();
assert.equal(guessSlotKind("content_padding"), "text", "manual CSS padding accepts unit/shorthand values instead of a unitless number");
assert.equal(guessSlotKind("border_radius"), "text", "manual CSS radius accepts px/% values instead of a unitless number");
assert.equal(guessSlotKind("image_height"), "number", "genuine scalar dimensions still use a number input");
assert.equal(guessSlotKind("background_image"), "image", "background image tokens are not mistaken for background colors");
assert.equal(defaultForKind("color", "background_color"), "transparent", "new manual backgrounds start transparent");
assert.equal(defaultForKind("text", "border"), "none", "new manual borders have a safe CSS fallback");

assert.match(constructorHtml, /data-author-template="section"/, "manual author offers a section-container template");
assert.match(constructorHtml, /data-author-template="outer-divider"/, "manual author offers an outer-divider template");
assert.match(constructorHtml, /data-author-template="inner-divider"/, "manual author offers an inner-divider template");
assert.match(constructorHtml, /value="both" disabled/, "ambiguous both placement cannot be selected for a new manual block");
assert.match(constructorSource, /payload\.childSlots = childSlots/, "manual section structural child slots are persisted");

const legacyGap = classifyConstructorTopLevelLine(".h-20 &nbsp;");
assert.equal(legacyGap.placement, "section", "fallback parser classifies a top-level legacy spacer as external");
assert.equal(legacyGap.dividerLevel, "outer", "fallback parser records the external divider level");

const tmp = mkdtempSync(path.join(os.tmpdir(), "retkit-legacy-gap-"));
try {
  const sectionDef = (name) => ({
    label: name,
    placement: "section",
    pug: `table.row.${name}\n  tr\n    td ${name.toUpperCase()}`,
    styl: "",
    slots: [],
  });
  const result = composeEmailFromBlocks({
    brand: "X_tree_test",
    mailName: "legacy-top-level-gap",
    destRoot: tmp,
    blocks: [
      { id: "parsed-a", def: sectionDef("section-a"), slots: {} },
      {
        id: "parsed-gap",
        def: { label: legacyGap.label, placement: legacyGap.placement, pug: ".h-20 &nbsp;", styl: "", slots: [] },
        slots: {},
      },
      { id: "parsed-b", def: sectionDef("section-b"), slots: {} },
    ],
  });
  const pug = readFileSync(result.headerPugPath, "utf8");
  assert.ok(pug.indexOf("SECTION-A") < pug.indexOf(".h-20") && pug.indexOf(".h-20") < pug.indexOf("SECTION-B"), "parse → compose keeps top-level gap between A and B");
  assert.equal(result.warnings.length, 0, "legacy external gap composes without tree warnings");
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

const transferSource = functionSource("transferToCode");
assert.ok(transferSource.indexOf("send(false)") < transferSource.indexOf("send(true)"), "transfer-to-code probes for 409 before any forced overwrite");
assert.match(transferSource, /res\.status === 409/, "transfer-to-code requires an explicit 409 overwrite flow");
assert.match(transferSource, /ручные правки/, "overwrite confirmation warns about manual code changes");

const previewBuildArgs = constructorBuildMailArgs({ brand: "X_preview", mailName: "live", preview: true });
const persistentBuildArgs = constructorBuildMailArgs({ brand: "X_saved", mailName: "mail", preview: false });
assert.deepEqual(previewBuildArgs.slice(-3), ["--locales", "en", "--pretty"], "temporary preview remains limited to en");
assert.equal(persistentBuildArgs.includes("--locales"), false, "persistent compose-save rebuilds every available locale");

const selfRoot = mkdtempSync(path.join(os.tmpdir(), "retkit-self-skeleton-"));
const selfDest = path.join(selfRoot, "X_self", "mail-repeat");
mkdirSync(path.join(selfDest, "app", "templates", "blocks"), { recursive: true });
mkdirSync(path.join(selfDest, "app", "styles", "blocks"), { recursive: true });
writeFileSync(path.join(selfDest, "SKELETON-SENTINEL.txt"), "preserve me\n", "utf8");
let stagedPath = null;
try {
  const staged = await stageComposeSkeletonIfDestination(selfDest, selfDest);
  stagedPath = staged.skeleton;
  assert.equal(staged.staged, true, "repeat-save snapshots a skeleton that is also the destination");
  assert.equal(readFileSync(path.join(staged.skeleton, "SKELETON-SENTINEL.txt"), "utf8"), "preserve me\n", "snapshot contains source-only skeleton files");
  try {
    composeEmailFromBlocks({
      brand: "X_self",
      mailName: "repeat",
      destRoot: selfRoot,
      skeleton: staged.skeleton,
      blocks: [{
        id: "self-save-section",
        def: { label: "self save", placement: "section", pug: "table.row.self-save\n  tr\n    td SAFE-REPEAT-SAVE", styl: "", slots: [] },
        slots: {},
      }],
    });
  } finally {
    await staged.cleanup();
  }
  assert.equal(readFileSync(path.join(selfDest, "SKELETON-SENTINEL.txt"), "utf8"), "preserve me\n", "repeat compose preserves its source skeleton instead of deleting it first");
  assert.equal(existsSync(stagedPath), false, "temporary skeleton snapshot is cleaned after compose");
} finally {
  rmSync(selfRoot, { recursive: true, force: true });
}

const localeRoot = mkdtempSync(path.join(os.tmpdir(), "retkit-all-locales-"));
try {
  mkdirSync(path.join(localeRoot, "vendor", "data", "en"), { recursive: true });
  mkdirSync(path.join(localeRoot, "vendor", "data", "ru"), { recursive: true });
  symlinkSync(path.join(root, "email-base", "vendor", "helpers"), path.join(localeRoot, "vendor", "helpers"), "dir");
  symlinkSync(path.join(root, "email-base", "vendor", "styles"), path.join(localeRoot, "vendor", "styles"), "dir");
  symlinkSync(path.join(root, "email-base", "tools"), path.join(localeRoot, "tools"), "dir");
  composeEmailFromBlocks({
    brand: "X_locale_test",
    mailName: "selector-save",
    destRoot: localeRoot,
    blocks: [
      { uid: "outer", blockId: "iq-outer-wrapper", parentUid: null, slotId: "root", slots: {} },
      { uid: "section", blockId: "iq-section", parentUid: "outer", slotId: "sections", slots: {} },
      { uid: "copy", blockId: "iq-text-title", parentUid: "section", slotId: "content", slots: { title: "LOCALE-SELECTOR", body: "all locales" } },
    ],
  });
  const args = constructorBuildMailArgs({ brand: "X_locale_test", mailName: "selector-save", preview: false });
  const built = spawnSync(process.execPath, args, { cwd: localeRoot, encoding: "utf8", timeout: 40000 });
  assert.equal(built.status, 0, `persistent all-locale build succeeds: ${(built.stderr || "").slice(0, 180)}`);
  const workspace = await listCodeWorkspace({ emailBaseRoot: localeRoot, brand: "X_locale_test", mail: "mail-selector-save" });
  assert.deepEqual(workspace.locales.map((entry) => entry.code), ["base", "en", "ru"], "HTML selector sees base plus every locale after persistent save");
} finally {
  rmSync(localeRoot, { recursive: true, force: true });
}

console.log("constructor tree policy: ok");
