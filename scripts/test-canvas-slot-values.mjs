#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import "../public/canvas-slot-values.js";
import { TOOL_HANDLERS } from "../src/ai-tools.js";
import { resolveBlockSlotValues } from "../src/compose-email.js";

const slots = globalThis.RetkitCanvasSlots;
assert.ok(slots?.normalizeSlotValue, "shared canvas slot normalizer is installed");

// Screenshot regression: the operator wrote a paragraph into iq-white-text's
// single-line `text` slot and the next compose failed. Reject it before an op
// reaches the browser and keep the current canvas summary unchanged.
const ctx = {
  canvasSummary: [{
    uid: 42,
    blockId: "iq-white-text",
    slots: { text: "Existing safe copy" },
    slotSchema: [{ id: "text", kind: "text", label: "Text" }],
  }],
};
const rejected = await TOOL_HANDLERS.update_canvas_block({
  uid: 42,
  slots: { text: "First line\nSecond line" },
}, ctx);
assert.equal(rejected.code, "INVALID_CANVAS_SLOT_VALUE");
assert.match(rejected.error, /single line/i);
assert.equal(ctx.canvasOps, undefined, "invalid AI update does not enqueue a canvas operation");
assert.equal(ctx.canvasSummary[0].slots.text, "Existing safe copy", "invalid AI update does not mutate canvas context");

for (const kind of ["text", "url", "image", "localizedUrl", "color", "number", "select"]) {
  const result = slots.normalizeSlotValue({ id: kind, kind }, "one\ntwo");
  assert.equal(result.ok, false, `${kind} remains a single-line slot`);
  assert.equal(result.code, "SLOT_LINE_BREAK");
}

const richCtx = {
  canvasSummary: [{
    uid: "rich-1",
    blockId: "copy",
    slots: { body: "Old" },
    slotSchema: [{ id: "body", kind: "richText", label: "Body" }],
  }],
};
const accepted = await TOOL_HANDLERS.update_canvas_block({
  uid: "rich-1",
  slots: { body: "First paragraph\r\nSecond paragraph" },
}, richCtx);
assert.equal(accepted.ok, true);
assert.deepEqual(accepted.normalizedRichTextSlots, ["body"]);
assert.equal(richCtx.canvasOps[0].slots.body, "First paragraph<br>Second paragraph");
assert.equal(richCtx.canvasSummary[0].slots.body, "First paragraph<br>Second paragraph");

const control = slots.normalizeSlotValue({ id: "body", kind: "richText" }, "safe\u2028unsafe");
assert.equal(control.ok, false, "richText still rejects control separators");
assert.equal(control.code, "SLOT_CONTROL_SEPARATOR");

const unknown = slots.normalizeSlotPatch(
  [{ id: "title", kind: "text" }],
  { invented: "value" },
);
assert.equal(unknown.ok, false, "schema-aware patches reject invented slot ids");
assert.equal(unknown.errors[0].code, "SLOT_UNKNOWN");

const textBlock = {
  id: "iq-white-text",
  pug: "p {{ text }}",
  styl: "",
  slots: [{ id: "text", kind: "text" }],
};
assert.throws(
  () => resolveBlockSlotValues(textBlock, { text: "First line\nSecond line" }),
  /single line/i,
  "compose reports the same early validation error for a manual bad value",
);

const richBlock = {
  id: "iq-rich-copy",
  pug: "p {{ body }}",
  styl: "",
  slots: [{ id: "body", kind: "richText" }],
};
assert.equal(
  resolveBlockSlotValues(richBlock, { body: "First\nSecond" }).body,
  "First<br>Second",
  "compose preserves intentional richText lines as email-safe <br> markup",
);

const constructorHtml = readFileSync(new URL("../public/constructor.html", import.meta.url), "utf8");
const slotScriptAt = constructorHtml.indexOf("/canvas-slot-values.js");
const constructorScriptAt = constructorHtml.indexOf("/constructor.js");
assert.ok(slotScriptAt >= 0 && slotScriptAt < constructorScriptAt, "browser loads the shared guard before constructor.js");

const serverSource = readFileSync(new URL("../server.js", import.meta.url), "utf8");
assert.match(
  serverSource,
  /ctx\.canvasSummary\s*=\s*canvas\.map[\s\S]*?slotSchema:\s*Array\.isArray\(entry\?\.slotSchema\)/,
  "server preserves the sanitized slot schema used by the AI tool guard",
);

console.log("✓ canvas slot kind validation and AI multiline regression tests passed");
