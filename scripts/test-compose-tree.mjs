#!/usr/bin/env node
/**
 * Regression coverage for the constructor's explicit tree model.
 * Pure local test: composes into a temporary directory and inspects sources.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { composeEmailFromBlocks } from "../src/compose-email.js";
import { compareStudioModelSourceSignatures } from "../src/studio-model-signatures.js";

const tempRoot = mkdtempSync(path.join(os.tmpdir(), "retkit-compose-tree-"));
let failed = 0;

function check(condition, label) {
  if (condition) console.log(`  \x1b[32m✓\x1b[0m ${label}`);
  else {
    failed += 1;
    console.error(`  \x1b[31m✗ ${label}\x1b[0m`);
  }
}

function def(placement, pug, childSlots = undefined) {
  return {
    label: `test ${placement}`,
    placement,
    pug,
    styl: "",
    slots: [],
    ...(childSlots ? { childSlots } : {}),
  };
}

const entries = [
  {
    uid: "outer-root",
    blockId: "tree-outer",
    source: "test",
    parentUid: null,
    slotId: null,
    slots: {},
    recipeInstanceId: "recipe-tree-1",
    def: def("outer", "//- structural outer context"),
  },
  {
    uid: "section-main",
    blockId: "tree-section",
    parentUid: "outer-root",
    slotId: "sections",
    slots: {},
    def: def("section", [
      "table.row.tree-main",
      "  tr",
      "    td.tree-content",
      "      //- {{ INNER_BLOCKS }}",
    ].join("\n")),
  },
  // Input order is the sibling order, regardless of labels/UIDs.
  {
    uid: "inner-b",
    blockId: "tree-inner-b",
    parentUid: "section-main",
    slotId: "inner",
    slots: {},
    def: def("inner", "p TREE-INNER-B"),
  },
  {
    uid: "inner-a",
    blockId: "tree-inner-a",
    parentUid: "section-main",
    slotId: "inner",
    slots: {},
    def: def("inner", "p TREE-INNER-A"),
  },
  {
    uid: "section-named",
    id: "tree-named-section",
    parentUid: "outer-root",
    slotId: "sections",
    slots: {},
    def: def("section", [
      "table.row.tree-named",
      "  tr",
      "    td.tree-left",
      "      //- {{ LEFT_BLOCKS }}",
      "    td.tree-right",
      "      //- {{ RIGHT_BLOCKS }}",
    ].join("\n"), [
      { id: "left", marker: "{{ LEFT_BLOCKS }}", accepts: ["inner"] },
      { id: "right", marker: "{{ RIGHT_BLOCKS }}", accepts: ["inner"] },
    ]),
  },
  {
    uid: "named-right",
    blockId: "tree-right",
    parentUid: "section-named",
    slotId: "right",
    slots: {},
    def: def("inner", "p TREE-RIGHT"),
  },
  {
    uid: "named-left-b",
    blockId: "tree-left-b",
    parentUid: "section-named",
    slotId: "left",
    slots: {},
    def: def("inner", "p TREE-LEFT-B"),
  },
  {
    uid: "named-left-a",
    blockId: "tree-left-a",
    parentUid: "section-named",
    slotId: "left",
    slots: {},
    def: def("inner", "p TREE-LEFT-A"),
  },
  {
    uid: "section-no-slot",
    blockId: "tree-no-slot",
    parentUid: "outer-root",
    slotId: "sections",
    slots: {},
    def: def("section", "table.row.no-slot\n  tr\n    td NO-SLOT-SECTION"),
  },
  {
    uid: "rejected-no-slot",
    blockId: "tree-rejected-no-slot",
    parentUid: "section-no-slot",
    slotId: "inner",
    slots: {},
    def: def("inner", "p MUST-NOT-APPEND-AFTER-SECTION"),
  },
  {
    uid: "orphan-inner",
    blockId: "tree-orphan",
    parentUid: "missing-parent",
    slotId: "inner",
    slots: {},
    def: def("inner", "p MUST-NOT-RENDER-ORPHAN"),
  },
];

try {
  console.log("\nExplicit tree compose");
  const result = composeEmailFromBlocks({
    brand: "X_tree_test",
    mailName: "explicit-tree",
    blocks: entries,
    destRoot: tempRoot,
    markBlocks: true,
  });
  const pug = readFileSync(result.headerPugPath, "utf8");

  check(result.blocksUsed === 8, "blocksUsed counts only 8 actually emitted nodes");
  check(result.totalBlocks === entries.length, "totalBlocks still reports all input entries");
  check(pug.includes("table.row.tree-main"), "section under outer is emitted");
  check(pug.indexOf("TREE-INNER-B") < pug.indexOf("TREE-INNER-A"), "siblings preserve input-array order");
  check(pug.includes("td.tree-content\n      //- block-start: tree-inner-b"), "legacy INNER_BLOCKS marker nests inner inside section indentation");

  const leftB = pug.indexOf("TREE-LEFT-B");
  const leftA = pug.indexOf("TREE-LEFT-A");
  const right = pug.indexOf("TREE-RIGHT");
  check(leftB >= 0 && leftB < leftA, "same named-slot siblings preserve input order");
  check(leftA < right, "named children are injected into their marker-defined columns");
  check(!pug.includes("LEFT_BLOCKS") && !pug.includes("RIGHT_BLOCKS") && !pug.includes("INNER_BLOCKS"), "all populated child markers are consumed");

  check(!pug.includes("MUST-NOT-APPEND-AFTER-SECTION"), "inner is not appended when parent has no child slot");
  check(!pug.includes("MUST-NOT-RENDER-ORPHAN"), "orphan with missing parent is rejected");
  check(result.warnings.some((w) => w.includes("has no child slot")), "missing child slot produces a warning");
  check(result.warnings.some((w) => w.includes("orphan skipped")), "orphan rejection produces a warning");

  check(pug.includes("rk:block-start:section-main:tree-section"), "preview marker uses stable string uid");
  check(pug.includes("rk:block-start:inner-b:tree-inner-b"), "nested preview marker also uses its uid");

  check(existsSync(result.studioModelPath), "studio-model.json is written beside the mail");
  const model = JSON.parse(readFileSync(result.studioModelPath, "utf8"));
  check(model.schemaVersion === 1, "studio model schemaVersion is 1");
  check(model.entries.length === entries.length, "studio model preserves every original entry");
  check(
    compareStudioModelSourceSignatures(result.destDir, model.sourceSignatures).matches,
    "studio model signatures match generated Pug/Stylus sources",
  );
  check(model.entries[0].recipeInstanceId === "recipe-tree-1", "recipeInstanceId survives round-trip");
  check(model.entries[4].id === "tree-named-section" && model.entries[4].def.childSlots.length === 2, "id alias and inline def survive round-trip");

  console.log("\nLegacy flat compose");
  const legacy = composeEmailFromBlocks({
    brand: "X_tree_test",
    mailName: "legacy-flat",
    destRoot: tempRoot,
    blocks: [
      {
        id: "legacy-section",
        slots: {},
        def: def("section", "table.row.legacy\n  tr\n    td\n      //- {{ INNER_BLOCKS }}"),
      },
      {
        id: "legacy-inner",
        slots: {},
        def: def("inner", "p LEGACY-FLAT-INNER"),
      },
    ],
  });
  const legacyPug = readFileSync(legacy.headerPugPath, "utf8");
  check(legacy.blocksUsed === 2, "legacy flat array still emits both valid blocks");
  check(legacyPug.includes("LEGACY-FLAT-INNER") && !legacyPug.includes("INNER_BLOCKS"), "legacy flat inner still nests through INNER_BLOCKS");

  console.log("\nCanonical tree compose");
  const canonical = composeEmailFromBlocks({
    brand: "X_tree_test",
    mailName: "canonical-tree",
    destRoot: tempRoot,
    blocks: [
      { uid: 101, blockId: "iq-outer-wrapper", parentUid: null, slotId: null, slots: {} },
      { uid: 102, blockId: "iq-section", parentUid: 101, slotId: "sections", slots: {} },
      {
        uid: 103,
        blockId: "iq-text-title",
        parentUid: 102,
        slotId: "content",
        slots: { title: "CANONICAL-TREE-TITLE", body: "CANONICAL-TREE-BODY" },
      },
      {
        uid: 104,
        blockId: "iq-spacer",
        parentUid: 102,
        slotId: "content",
        slots: { height: "16" },
      },
      {
        uid: 108,
        blockId: "iq-text-title",
        parentUid: 102,
        slotId: "content",
        slots: { title: "CANONICAL-INNER-AFTER-SPACER", body: "Same section" },
      },
      {
        uid: 105,
        blockId: "iq-section-spacer",
        parentUid: 101,
        slotId: "sections",
        slots: { height: "28" },
      },
      { uid: 106, blockId: "iq-section", parentUid: 101, slotId: "sections", slots: {} },
      {
        uid: 107,
        blockId: "iq-text-title",
        parentUid: 106,
        slotId: "content",
        slots: { title: "CANONICAL-SECOND-SECTION", body: "After the outer divider" },
      },
    ],
  });
  const canonicalPug = readFileSync(canonical.headerPugPath, "utf8");
  check(canonical.blocksUsed === 7, "canonical outer remains context while sections, inner and both explicit divider levels are counted");
  check(canonicalPug.includes("CANONICAL-TREE-TITLE") && canonicalPug.includes("CANONICAL-TREE-BODY"), "real canonical childSlots marker accepts and nests inner");
  const innerSpacer = '.h-16(style="background-color:transparent") &nbsp;';
  check(canonicalPug.includes(innerSpacer), "inner divider renders inside its section content slot");
  check(
    canonicalPug.indexOf("CANONICAL-TREE-TITLE") < canonicalPug.indexOf(innerSpacer)
      && canonicalPug.indexOf(innerSpacer) < canonicalPug.indexOf("CANONICAL-INNER-AFTER-SPACER"),
    "inner A → inner divider → inner B order is preserved inside section A",
  );
  check(canonicalPug.includes("table.row.iq-section-spacer") && canonicalPug.includes('height="28"'), "outer divider renders as a section-level sibling");
  check(
    canonicalPug.indexOf("CANONICAL-TREE-TITLE") < canonicalPug.indexOf("table.row.iq-section-spacer")
      && canonicalPug.indexOf("table.row.iq-section-spacer") < canonicalPug.indexOf("CANONICAL-SECOND-SECTION"),
    "outer divider stays between the two section/combo positions",
  );
  check(canonical.warnings.length === 0, "explicit inner/outer divider levels compose without tree warnings");
  check(!canonicalPug.includes("INNER_BLOCKS"), "real canonical marker string is consumed");
} catch (error) {
  failed += 1;
  console.error("\x1b[31mUnexpected error:\x1b[0m", error?.stack || error);
} finally {
  try { rmSync(tempRoot, { recursive: true, force: true }); } catch {}
}

if (failed) {
  console.error(`\n\x1b[31m✗ ${failed} compose-tree assertion(s) failed\x1b[0m\n`);
  process.exit(1);
}
console.log("\n\x1b[32m✓ compose tree regression passed\x1b[0m\n");
