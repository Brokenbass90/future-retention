import assert from "node:assert/strict";
import {
  BlockLibrarySchemaError,
  normalizeBlockLibrarySavePayload,
} from "../src/block-library-schema.js";

const source = {
  id: "combo-test",
  label: "Combo test",
  placement: "section",
  category: "test",
  combo: true,
  pug: "table.row\n  tr\n    td\n      //- {{ INNER_BLOCKS }}",
  styl: "",
  appearance: { background_color: "transparent", border: "1px solid #abcdef", radius: "16px", padding: "12px 24px" },
  childSlots: [{ id: "content", marker: "INNER_BLOCKS", accepts: ["inner", "both"] }],
  slots: [{
    id: "footer_link",
    kind: "localizedUrl",
    label: "Footer link",
    default: "#",
    perLocale: true,
    allowSystemPlaceholder: true,
    uiGroup: "footer",
  }],
  children: [{
    id: "iq-text-title",
    source: "canonical",
    role: "copy",
    parentRole: "hero-container",
    slotId: "content",
    slots: { body: "Hello" },
    appearance: { background_color: "#abcdef", padding: "8px 12px" },
    children: [{ id: "iq-spacer", slots: { height: 12 } }],
  }],
};

const normalized = normalizeBlockLibrarySavePayload(source, { createdAt: "2026-07-12T00:00:00.000Z" });
assert.equal(normalized.combo, true);
assert.deepEqual(normalized.childSlots, source.childSlots);
assert.equal(normalized.slots[0].perLocale, true);
assert.equal(normalized.slots[0].allowSystemPlaceholder, true);
assert.equal(normalized.slots[0].uiGroup, "footer");
assert.equal(normalized.children[0].slotId, "content");
assert.equal(normalized.children[0].role, "copy");
assert.equal(normalized.children[0].parentRole, "hero-container");
assert.equal(normalized.children[0].children[0].slots.height, 12);
assert.deepEqual({ ...normalized.children[0].appearance }, source.children[0].appearance);
assert.deepEqual({ ...normalized.appearance }, source.appearance);

for (const [name, patch] of [
  ["placement", { placement: "sidebar" }],
  ["empty placement", { placement: "" }],
  ["marker", { childSlots: [{ id: "content", marker: "{{ INNER_BLOCKS }}", accepts: ["inner"] }] }],
  ["accepts", { childSlots: [{ id: "content", marker: "INNER_BLOCKS", accepts: ["sidebar"] }] }],
  ["child id", { children: [{ id: "../escape", slots: {} }] }],
  ["child role", { children: [{ id: "iq-spacer", role: "../escape", slots: {} }] }],
  ["appearance key", { appearance: { box_shadow: "none" } }],
  ["appearance injection", { appearance: { border: "none; color:red" } }],
]) {
  assert.throws(
    () => normalizeBlockLibrarySavePayload({ ...source, ...patch }),
    BlockLibrarySchemaError,
    `${name} should be rejected`
  );
}

console.log("block-library schema: ok");
