#!/usr/bin/env node

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applyOuterWrapperBackgroundToPug, composeEmailFromBlocks } from "../src/compose-email.js";
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
const catalogSourceAllowed = Function(`return (${functionSource("catalogSourceAllowed")})`)();
const clientBlockReviewStatus = Function(`return (${functionSource("blockReviewStatus")})`)();
const blockCatalogUsable = Function(
  "blockReviewStatus",
  `return (${functionSource("blockCatalogUsable")})`,
)(clientBlockReviewStatus);
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
assert.equal(catalogSourceAllowed({ source: "canonical" }, "curated"), true, "curated catalog contains canonical blocks");
assert.equal(catalogSourceAllowed({ source: "user", review: { status: "approved" } }, "curated"), true, "curated catalog contains approved user blocks");
assert.equal(catalogSourceAllowed({ source: "user", review: { status: "candidate" } }, "curated"), false, "candidate user blocks stay out of the release-safe catalog");
assert.equal(catalogSourceAllowed({ source: "user" }, "user"), true, "manual drafts and candidates have an explicit My blocks scope");
assert.equal(catalogSourceAllowed({ source: "imported" }, "curated"), false, "curated catalog hides legacy imported slices by default");
assert.equal(catalogSourceAllowed({ source: "imported" }, "all"), true, "legacy archive is available only through the explicit all-sources scope");
assert.equal(catalogSourceAllowed({ source: "parsed" }, "all"), false, "mail-local parsed definitions never leak into the reusable catalog");
assert.equal(blockCatalogUsable({ source: "canonical" }), true, "canonical blocks remain insertable");
assert.equal(blockCatalogUsable({ source: "user", review: { status: "approved" } }), true, "approved user blocks are insertable");
assert.equal(blockCatalogUsable({ source: "user", review: { status: "candidate" } }), false, "candidate user blocks are review-only until approval");
assert.equal(blockCatalogUsable({ source: "imported" }), false, "legacy imported blocks are quarantined/read-only");
assert.match(constructorHtml, /id="catSourceScope"[\s\S]*?Проверенные блоки[\s\S]*?Мои блоки[\s\S]*?Все, включая legacy/, "catalog separates approved blocks, manual lifecycle and the legacy archive");
assert.match(constructorHtml, /Авто → Внутри/, "auto-advance toggle says what it actually does");

const approvedUserDefinition = {
  id: "approved-user-cta",
  source: "user",
  label: "Approved user CTA",
  placement: "inner",
  category: "cta",
  pug: "table.approved-user-cta\n  tr\n    td Approved",
  styl: "",
  slots: [],
  review: { status: "approved" },
};
const parsedDefinition = {
  id: "parsed-source-section",
  source: "parsed",
  label: "Parsed source section",
  placement: "section",
  category: "imported",
  pug: "table.parsed-source-section\n  tr\n    td Parsed",
  styl: "",
  slots: [],
};
const canvasPayloadState = {
  canvas: [
    {
      uid: "user-1",
      blockId: approvedUserDefinition.id,
      blockSource: "user",
      parentUid: null,
      slotId: null,
      slots: {},
    },
    {
      uid: "parsed-1",
      blockId: parsedDefinition.id,
      blockSource: "parsed",
      parentUid: null,
      slotId: null,
      slots: {},
    },
  ],
};
const canvasToBlocksForPolicyTest = Function(
  "state",
  "blockForEntry",
  "assertCanvasAssetsPublic",
  `return (${functionSource("canvasToBlocks")})`,
)(
  canvasPayloadState,
  (entry) => entry.blockSource === "user" ? approvedUserDefinition : parsedDefinition,
  () => {},
);
const releaseCanvasPayload = canvasToBlocksForPolicyTest({ allowLocalAssets: true });
assert.equal(releaseCanvasPayload[0].source, "user", "approved user block keeps its library provenance");
assert.equal(
  Object.prototype.hasOwnProperty.call(releaseCanvasPayload[0], "def"),
  false,
  "approved user block is sent by id so compose reloads and verifies its current on-disk review",
);
assert.equal(
  releaseCanvasPayload[1].def?.pug,
  parsedDefinition.pug,
  "mail-local parsed block still carries the exact definition required for server provenance verification",
);

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
const scheduleLiveSource = functionSource("scheduleLivePreview");
assert.match(scheduleLiveSource, /!state\.canvas\.length[\s\S]*?_livePreviewToken \+= 1[\s\S]*?frame\.srcdoc = ""/, "emptying the canvas invalidates in-flight preview work before clearing the iframe");

const loadBlockReason = Function(`return (${functionSource("parsedEmailLoadBlockReason")})`)();
assert.equal(loadBlockReason({ studioModelStale: false }), "", "fresh studio model is allowed back into the constructor");
assert.match(loadBlockReason({ studioModelStale: true }), /отвязано.*Workbench|Workbench.*копию/i, "stale studio model is blocked with an actionable workbench/copy message");
const loadParsedSource = functionSource("loadParsedEmail");
assert.ok(loadParsedSource.indexOf("parsedEmailLoadBlockReason(d)") < loadParsedSource.indexOf("state.canvas ="), "stale guard runs before any constructor state mutation");
assert.match(loadParsedSource, /blockedReason\)[\s\S]*?return false/, "stale parse reports an explicit unsuccessful load");
assert.match(loadParsedSource, /scheduleLivePreview\(\);\s*return true/, "constructor reports success only after the canvas is hydrated");

const deepLinkSource = functionSource("loadConstructorDeepLink");
assert.ok(
  deepLinkSource.indexOf("await loadParsedEmail") < deepLinkSource.indexOf("history.replaceState"),
  "deep-link query is not removed before the constructor load finishes",
);
assert.match(deepLinkSource, /if \(!loaded\) return false;[\s\S]*?history\.replaceState/,
  "failed or stale deep links retain brand/mail for reload and diagnosis");
const deepLinkHistoryCalls = [];
const deepLinkLoadCalls = [];
let deepLinkLoadResult = false;
const loadConstructorDeepLink = Function(
  "URLSearchParams",
  "history",
  "loadParsedEmail",
  `return (async ${deepLinkSource});`,
)(
  URLSearchParams,
  { replaceState: (...args) => deepLinkHistoryCalls.push(args) },
  async (brand, mail) => {
    deepLinkLoadCalls.push([brand, mail]);
    return deepLinkLoadResult;
  },
);
assert.equal(await loadConstructorDeepLink("?brand=X_preview&mail=mail-stale"), false, "stale deep link remains unsuccessful");
assert.deepEqual(deepLinkHistoryCalls, [], "stale deep link keeps its query string");
deepLinkLoadResult = true;
assert.equal(await loadConstructorDeepLink("?brand=X_preview&mail=mail-fresh"), true, "fresh deep link succeeds");
assert.deepEqual(deepLinkLoadCalls, [["X_preview", "mail-stale"], ["X_preview", "mail-fresh"]], "deep link forwards the exact source identity");
assert.deepEqual(deepLinkHistoryCalls, [[null, "", "/constructor"]], "query is cleared exactly once, after successful hydration");

const markExplicitSlot = Function(`return (${functionSource("markEntrySlotExplicit")})`)();
const clearExplicitSlot = Function(`return (${functionSource("clearEntrySlotExplicit")})`)();
const explicitSlotEntry = { slots: {} };
markExplicitSlot(explicitSlotEntry, "preheader");
markExplicitSlot(explicitSlotEntry, "preheader");
assert.deepEqual(explicitSlotEntry.explicitSlots, ["preheader"], "explicit slot tracking is unique and stable");
clearExplicitSlot(explicitSlotEntry, "preheader");
assert.equal(Object.prototype.hasOwnProperty.call(explicitSlotEntry, "explicitSlots"), false, "resetting a slot restores inherited source behaviour");
assert.match(functionSource("setEntrySlotValue"), /markEntrySlotExplicit\(entry, slotId\)/, "asset and generated-image slot updates are marked explicit");
const inspectorSource = functionSource("renderInspector");
assert.match(inspectorSource, /entry\.slots\[id\] = v;\s*markEntrySlotExplicit\(entry, id\)/, "manual inspector edits are marked explicit");
assert.match(inspectorSource, /data-reset-slot[\s\S]*?clearEntrySlotExplicit\(entry, id\)/, "slot reset clears the explicit override marker");
assert.match(functionSource("openPlaceholderMenu"), /entry\.slots\[forId\] = input\.value;\s*markEntrySlotExplicit\(entry, forId\)/, "placeholder insertion marks the affected slot explicit");

const innerDivider = canonical("iq-spacer");
const outerDivider = canonical("iq-section-spacer");
const outerWrapper = canonical("iq-outer-wrapper");
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
const wrapperBackground = outerWrapper.slots.find((slot) => slot.id === "background_color");
assert.equal(wrapperBackground?.kind, "color", "outer wrapper exposes a real background color control");
assert.equal(wrapperBackground?.default, "#F9F9F9", "outer wrapper starts with the same light gray surface as the footer");
assert.match(outerWrapper.pug, /body\.body\(style="background-color:\{\{ background_color \}\}"\)/, "outer wrapper definition documents its background binding");

const patchedOuter = applyOuterWrapperBackgroundToPug(`body.body\n  table.body\n    tr\n      td(align="center", valign="top").center.bg-col`, "#F9F9F9");
assert.equal((patchedOuter.match(/background-color:#F9F9F9/g) || []).length, 3, "outer background reaches body, body table and centered email shell");
const outerTmp = mkdtempSync(path.join(os.tmpdir(), "retkit-outer-background-"));
try {
  const result = composeEmailFromBlocks({
    brand: "X_outer_test",
    mailName: "gray-wrapper",
    destRoot: outerTmp,
    blocks: [
      { uid: "outer", id: "iq-outer-wrapper", parentUid: null, slotId: "root", slots: { preheader: "Reusable preview" }, appearance: { background_color: "#EDEDED" } },
      { uid: "gap", id: "iq-section-spacer", parentUid: "outer", slotId: "sections", slots: { background_color: "transparent", height: "20" } },
      { uid: "section", id: "iq-section", parentUid: "outer", slotId: "sections", slots: {} },
    ],
  });
  const indexPug = readFileSync(path.join(result.destDir, "app", "templates", "index.pug"), "utf8");
  assert.equal((indexPug.match(/background-color:#EDEDED/g) || []).length, 3, "compose transfers a generic outer appearance color to the actual scaffold, not the context-only outer node");
  const preheaderPug = readFileSync(path.join(result.destDir, "app", "templates", "helpers", "preheader.pug"), "utf8");
  assert.match(preheaderPug, /Reusable preview/, "fresh constructor compose writes the reusable outer preheader value");
  assert.doesNotMatch(preheaderPug, /welcome-broker|\$\{\{\s*[a-z0-9_.-]+\s*\}\}\$/i, "fresh constructor compose never inherits a campaign namespace from the default skeleton");
  const headerPug = readFileSync(result.headerPugPath, "utf8");
  assert.doesNotMatch(headerPug, /(?:padding-top|padding-right|padding-bottom|padding-left)\s*:\s*(?:;|["'])/i, "empty optional CSS overrides are removed instead of emitting property: ;");
} finally {
  rmSync(outerTmp, { recursive: true, force: true });
}

const sourceSkeleton = path.join(root, "email-base", "X_IQBroker", "mail-welcome");
const preservedPreheader = readFileSync(path.join(sourceSkeleton, "app", "templates", "helpers", "preheader.pug"), "utf8");
const sourceRoundTripTmp = mkdtempSync(path.join(os.tmpdir(), "retkit-source-preheader-"));
try {
  const result = composeEmailFromBlocks({
    brand: "X_source_roundtrip",
    mailName: "preserve-preheader",
    destRoot: sourceRoundTripTmp,
    skeleton: sourceSkeleton,
    preserveSkeletonPreheader: true,
    blocks: [{
      id: "roundtrip-section",
      def: { label: "source section", placement: "section", pug: "table.row\n  tr\n    td SOURCE-ROUNDTRIP", styl: "", slots: [] },
      slots: {},
    }],
  });
  assert.equal(
    readFileSync(path.join(result.destDir, "app", "templates", "helpers", "preheader.pug"), "utf8"),
    preservedPreheader,
    "an explicit source skeleton keeps its authored preheader during a code/constructor round-trip",
  );

  const noOpOuterResult = composeEmailFromBlocks({
    brand: "X_source_roundtrip",
    mailName: "preserve-default-outer-preheader",
    destRoot: sourceRoundTripTmp,
    skeleton: sourceSkeleton,
    preserveSkeletonPreheader: true,
    blocks: [
      { uid: "outer", id: "iq-outer-wrapper", parentUid: null, slotId: "root", slots: { preheader: "" } },
      { uid: "section", id: "iq-section", parentUid: "outer", slotId: "sections", slots: {} },
    ],
  });
  assert.equal(
    readFileSync(path.join(noOpOuterResult.destDir, "app", "templates", "helpers", "preheader.pug"), "utf8"),
    preservedPreheader,
    "a synthesized outer default preheader does not erase the authored skeleton during a no-op round-trip",
  );

  const explicitClearResult = composeEmailFromBlocks({
    brand: "X_source_roundtrip",
    mailName: "explicitly-clear-outer-preheader",
    destRoot: sourceRoundTripTmp,
    skeleton: sourceSkeleton,
    preserveSkeletonPreheader: true,
    blocks: [
      { uid: "outer", id: "iq-outer-wrapper", parentUid: null, slotId: "root", slots: { preheader: "" }, explicitSlots: ["preheader"] },
      { uid: "section", id: "iq-section", parentUid: "outer", slotId: "sections", slots: {} },
    ],
  });
  const explicitlyClearedPreheader = readFileSync(path.join(explicitClearResult.destDir, "app", "templates", "helpers", "preheader.pug"), "utf8");
  assert.notEqual(explicitlyClearedPreheader, preservedPreheader, "an explicitly edited empty preheader still clears the skeleton value");
  assert.doesNotMatch(explicitlyClearedPreheader, /welcome-broker\.block_00/i, "explicit preheader clear removes the inherited campaign placeholder");
  const persistedModel = JSON.parse(readFileSync(explicitClearResult.studioModelPath, "utf8"));
  assert.deepEqual(persistedModel.entries[0].explicitSlots, ["preheader"], "studio model persists the explicit preheader decision across reloads");
} finally {
  rmSync(sourceRoundTripTmp, { recursive: true, force: true });
}

for (const id of ["iq-hero-logo", "iq-hero-image", "iq-hero-date", "iq-socials", "iq-hero-copy", "iq-text-title", "iq-section"]) {
  const block = canonical(id);
  const alignSlot = block.slots.find((slot) => slot.id === "align");
  assert.ok(alignSlot, `${id} has an alignment control`);
  assert.match(block.pug, /text-align:\{\{ align \}\}/, `${id} applies alignment as inline CSS instead of relying only on a weak HTML align attribute`);
}

const socials = canonical("iq-socials");
const socialsCombo = canonical("iq-combo-socials-row");
const socialsRecipe = socialsCombo.children.find((child) => child.id === "iq-socials");
for (let index = 0; index < 4; index += 1) {
  const iconId = `icon_${index}`;
  const canonicalDefault = socials.slots.find((slot) => slot.id === iconId)?.default;
  assert.equal(socialsRecipe?.slots?.[iconId], canonicalDefault, `social combo keeps ${iconId} attached to the same semantic icon as the reusable socials block`);
  assert.equal(socials.slots.find((slot) => slot.id === `link_${index}`)?.default, "#", `social link ${index + 1} has a portable editable default`);
  assert.equal(socialsRecipe?.slots?.[`link_${index}`], "#", `social combo link ${index + 1} does not inherit a campaign namespace`);
}

const canonicalDir = path.join(root, "data", "block-library", "canonical");
for (const file of readdirSync(canonicalDir).filter((name) => name.endsWith(".json"))) {
  const block = JSON.parse(readFileSync(path.join(canonicalDir, file), "utf8"));
  if (block.category === "footer") continue;
  const defaultsAndRecipes = JSON.stringify({ slots: block.slots || [], children: block.children || [] });
  assert.doesNotMatch(defaultsAndRecipes, /\$\{\{\s*[a-z0-9_.-]+\s*\}\}\$/i, `${block.id} has no campaign-specific namespace in reusable defaults`);
}
assert.match(functionSource("modelCampaignBindings"), /category !== "footer"/, "existing saved non-footer campaign bindings are diagnosed without rewriting the model");

assert.match(
  constructorSource,
  /for \(const groupId of \["appearance", "content", "assets", "advanced"\]\)/,
  "block appearance is shown before long content and asset fields",
);
assert.match(constructorSource, /Поверхность блока/, "every rendered selected block gets one common appearance panel");
assert.doesNotMatch(functionSource("renderInspector"), /placementOf\(block\) === "outer" \? \[\]/, "outer is no longer excluded from the common surface panel");
assert.match(constructorSource, /background_color[\s\S]*?border[\s\S]*?radius[\s\S]*?padding/, "common appearance covers background, border, radius and padding");
assert.match(functionSource("canvasToBlocks"), /out\.appearance/, "generic appearance overrides survive constructor save and code transfer");
assert.match(functionSource("saveSelectedAsUserBlock"), /payload\.appearance/, "generic appearance becomes a default when saving a reusable user block");
assert.match(constructorSource, /function instantiateCombo[\s\S]*?appearance:\s*child\.appearance/, "combo recipes pass child surface tuning into editable instances");
assert.match(constructorSource, /data-transparent-slot=/, "background controls provide an explicit transparent/inherit action");
assert.match(constructorSource, /data-reset-appearance-all/, "common appearance has one clear reset action");
const parseEmailColor = Function(`return (${functionSource("parseEmailColor")})`)();
assert.equal(parseEmailColor("#f70"), "#FF7700", "short HEX is expanded for email output");
assert.equal(parseEmailColor("#ff7700"), "#FF7700", "full HEX is normalized to uppercase");
assert.equal(parseEmailColor(" transparent "), "transparent", "transparent remains an explicit email background value");
assert.equal(parseEmailColor("INHERIT"), "inherit", "inherit remains available for nested block backgrounds");
assert.equal(parseEmailColor("", { allowEmpty: true }), "", "empty fallback appearance removes its override");
for (const unsafeColor of ["rgb(255, 119, 0)", "rgba(255, 119, 0, .5)", "#FF770080", "orange", "#12", "#12345G"]) {
  assert.equal(parseEmailColor(unsafeColor), null, `${unsafeColor} is rejected instead of leaking non-HEX colour into authored email styles`);
}
assert.doesNotMatch(constructorSource, /type="color"/, "constructor uses its own HEX palette instead of the OS RGB colour dialog");
assert.match(functionSource("bindEmailColorControls"), /scheduleLivePreview\(\)/, "a committed valid HEX value refreshes the rendered email");
assert.match(
  functionSource("bindEmailColorControls"),
  /input\.addEventListener\("input", \(\) => \{[\s\S]*?if \(parsed !== null\) syncVisual\(input, parsed\);\s*\}\);/,
  "unfinished HEX typing only updates validation/swatch state and waits for a committed change",
);
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
assert.match(constructorHtml, /draft нельзя вставить[\s\S]*?candidate[\s\S]*?AI-review опционален/i, "manual author explains the deterministic lifecycle and optional AI advice");

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
assert.match(transferSource, /const brand = "X_preview"/, "transfer-to-code uses a hidden temporary working copy");
assert.doesNotMatch(transferSource, /chooseSaveTarget|confirm\(/, "transfer-to-code never asks to save a version or choose a permanent destination");
assert.match(transferSource, /res\.status === 409/, "temporary working copy handles an existing draft deterministically");

const previewBuildArgs = constructorBuildMailArgs({ brand: "X_preview", mailName: "live", preview: true });
const handoffBuildArgs = constructorBuildMailArgs({ brand: "X_preview", mailName: "handoff", preview: false });
const persistentBuildArgs = constructorBuildMailArgs({ brand: "X_saved", mailName: "mail", preview: false });
assert.equal(previewBuildArgs.includes("--pretty"), false, "iframe preview must not pay for a second pretty build");
assert.equal(handoffBuildArgs.includes("--pretty"), false, "temporary code handoff must not pay for a second pretty build");
assert.equal(persistentBuildArgs.includes("--pretty"), true, "persistent constructor save keeps review-friendly pretty HTML");
assert.equal(previewBuildArgs.includes("--failOnWeight"), false, "live preview stays warning-only while the user edits");
assert.equal(handoffBuildArgs.includes("--failOnWeight"), false, "temporary code handoff stays warning-only");
assert.equal(persistentBuildArgs.includes("--failOnWeight"), true, "persistent constructor save enforces the compact email weight gate");
assert.deepEqual(previewBuildArgs.slice(-2), ["--locales", "en"], "temporary preview remains limited to en");
assert.deepEqual(handoffBuildArgs.slice(-2), ["--locales", "en"], "hidden code handoff initially builds only en");
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
      trustedSkeletonRoots: [staged.skeleton],
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
  const builtHtml = readFileSync(path.join(localeRoot, "dist", "X_locale_test", "mail-selector-save", "en", "index.html"), "utf8");
  assert.doesNotMatch(
    builtHtml,
    /(?:padding-top|padding-right|padding-bottom|padding-left)\s*:\s*;/i,
    "canonical compose build never leaves an empty optional padding declaration in final HTML",
  );
  assert.doesNotMatch(builtHtml, /welcome-broker\.block_00/i, "fresh constructor output has no namespace leaked from the default skeleton preheader");
  const workspace = await listCodeWorkspace({ emailBaseRoot: localeRoot, brand: "X_locale_test", mail: "mail-selector-save" });
  assert.deepEqual(workspace.locales.map((entry) => entry.code), ["base", "en", "ru"], "HTML selector sees base plus every locale after persistent save");
} finally {
  rmSync(localeRoot, { recursive: true, force: true });
}

console.log("constructor tree policy: ok");
