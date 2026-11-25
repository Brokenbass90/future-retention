#!/usr/bin/env node
/**
 * Разделители между секциями ставятся сами: человек добавляет секцию или
 * комбо из каталога — сверху (от «потолка») и между соседними секциями
 * появляется разделитель, если его там нет. Агентские вставки не трогаются.
 */
import { readFileSync } from "node:fs";
import vm from "node:vm";
import path from "node:path";
import url from "node:url";
import assert from "node:assert/strict";

const repoRoot = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const src = readFileSync(path.join(repoRoot, "public", "constructor.js"), "utf8");
const extractFn = (name) => {
  const m = new RegExp(`(?:^|\\n)function ${name}\\s*\\(`).exec(src);
  if (!m) throw new Error(`нет функции ${name}`);
  const start = m.index === 0 ? 0 : m.index + 1;
  const endRe = /\n\}/g; endRe.lastIndex = start;
  return src.slice(start, endRe.exec(src).index + 2);
};
const sandbox = {
  console, JSON, alert() {},
  document: { getElementById: () => null, querySelectorAll: () => [], querySelector: () => null },
  renderCanvas() {}, renderInspector() {}, syncPaletteToSelection() {}, scheduleLivePreview() {}, maybeOpenInnerCatalog() {},
};
vm.createContext(sandbox);
vm.runInContext([
  "sameUid", "blockById", "blockForEntry", "entryByUid", "placementOf", "isInnerBlock", "childSlotsFor",
  "slotAcceptsBlock", "chooseChildSlot", "childrenOf", "descendantUids", "rootOuterEntry", "latestSectionEntry",
  "createEntry", "defaultSlotsFor", "insertEntryAfterSiblings", "addToCanvas", "instantiateCombo",
  "ensureOuterForMutation", "finishCanvasMutation", "isSectionSpacerBlock", "sectionSpacerBlock", "autoSpaceSections",
].map(extractFn).join("\n\n") + `
function nextUid() { return state._uid++; }
function findDefaultBlock(p) { return state.library.find((b) => placementOf(b) === p) || null; }
function slotPresetAssignments() { return null; }
function markEntrySlotExplicit() {}
function catalogSourceAllowed() { return true; }
function blockAllowedInKit() { return true; }
function blockBelongsToOtherBrand() { return false; }
let _canvasUndo = [];
function pushCanvasUndo() {}
`, sandbox);

const LIB = [
  { id: "wrap", placement: "outer", source: "canonical", slots: [], childSlots: [{ id: "sections", marker: "S", accepts: ["section", "both"] }] },
  { id: "card", placement: "section", source: "canonical", slots: [], childSlots: [{ id: "content", marker: "INNER_BLOCKS", accepts: ["inner"] }] },
  { id: "iq-section-spacer", placement: "section", source: "canonical", tags: ["combo-divider"], slots: [{ id: "height", kind: "number", default: "20" }] },
  { id: "foot", placement: "section", source: "canonical", slots: [] },
  { id: "combo2", placement: "section", source: "canonical", combo: true, slots: [],
    children: [{ id: "card", role: "container", slots: {} }, { id: "foot", role: "tail", slots: {} }] },
];
const reset = () => { sandbox.state = { _uid: 1, selectedUid: null, library: LIB, canvas: [] }; };
const add = (id, origin = "catalog") => vm.runInContext(`addToCanvas(blockById(${JSON.stringify(id)}), { origin: ${JSON.stringify(origin)} })`, sandbox);
const order = () => vm.runInContext("childrenOf(rootOuterEntry().uid, 'sections').map((e) => e.blockId + (e.blockId === 'iq-section-spacer' ? ':' + e.slots.height : ''))", sandbox);

reset(); add("card");
assert.deepEqual(order(), ["iq-section-spacer:30", "card"], "первой секции — отбивка от потолка");
add("card");
assert.deepEqual(order(), ["iq-section-spacer:30", "card", "iq-section-spacer:12", "card"], "между секциями — разделитель");
add("iq-section-spacer"); add("card");
assert.deepEqual(order(), ["iq-section-spacer:30", "card", "iq-section-spacer:12", "card", "iq-section-spacer:20", "card"],
  "после разделителя, поставленного руками, второй не ставится");
console.log("✓ отбивка сверху и разделители между секциями ставятся сами");

reset(); add("combo2");
assert.deepEqual(order(), ["iq-section-spacer:30", "card", "foot"], "части одного комбо идут вплотную");
console.log("✓ части одного комбо — без разделителя между ними");

reset(); add("card", "agent"); add("card", "agent");
assert.deepEqual(order(), ["card", "card"], "агентские вставки не трогаются");
console.log("✓ вставки агента правило не трогает");
console.log("\nauto-section-spacers: ok");
