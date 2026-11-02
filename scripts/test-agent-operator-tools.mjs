// Инструменты оператора-агента: статус студии, пакет правок холста, недостающие картинки.
import assert from "node:assert/strict";
import fs from "node:fs";
import { imageNeedsFrom } from "../src/canvas-images.js";
import { BUILD_ID } from "../src/build-id.js";

assert.match(BUILD_ID, /^[0-9a-f]{10}$/);
const sample = new Map([["hero:bg_image", "https://x/sample.png"]]);
const summary = [
  { uid: 1, blockId: "hero", slots: { bg_image: "https://x/sample.png" }, slotSchema: [{ id: "bg_image", kind: "image", label: "Фон" }] },
  { uid: 2, blockId: "banner", slots: { image: "" }, slotSchema: [{ id: "image", kind: "image", label: "Баннер" }] },
  { uid: 3, blockId: "banner", slots: { image: "https://real/pic.png" }, slotSchema: [{ id: "image", kind: "image" }] },
  { uid: 4, blockId: "iq-socials-row", slots: { icon_tiktok: "" }, slotSchema: [{ id: "icon_tiktok", kind: "image" }] },
];
const needs = imageNeedsFrom(summary, null, sample);
assert.deepEqual(needs.needs.map((n) => n.uid), [1, 2]);
assert.match(needs.message, /Нужны ссылки на 2/);

const routes = fs.readFileSync(new URL("../src/routes/agent-routes.js", import.meta.url), "utf8");
assert.match(routes, /router\.get\("\/api\/agent\/status"/);
assert.match(routes, /outdated: true/);
assert.match(routes, /batch остановлен на шаге/);
const mcp = fs.readFileSync(new URL("../mcp/retkit-mcp-server.mjs", import.meta.url), "utf8");
for (const name of ["retkit_studio_status", "retkit_canvas_batch", "retkit_canvas_images"]) assert.ok(mcp.includes(`"${name}"`), name);
for (const name of ["studio_status", "canvas_batch", "canvas_images", "open_in_constructor"]) assert.ok(mcp.includes(`tool === "${name}"`) || mcp.includes(`"${name}" ||`) || mcp.includes(`|| tool === "${name}"`), `retkit_call ${name}`);
const relay = fs.readFileSync(new URL("../src/routes/relay-routes.js", import.meta.url), "utf8");
assert.match(relay, /build: BUILD_ID/);
console.log("✓ operator tools: status, canvas batch, image needs");

// Агент открывает любое письмо сам, не теряя чужую работу.
const cjs = fs.readFileSync(new URL("../public/constructor.js", import.meta.url), "utf8");
const wbjs = fs.readFileSync(new URL("../public/workbench.js", import.meta.url), "utf8");
assert.match(cjs, /command\.tool === "goto" \|\| command\.tool === "open_mail"/);
assert.match(cjs, /state\.canvas\.length && !args\.discard/);
assert.match(cjs, /endsWith\(workspaceSuffix\)/, "no double workspace suffix on round trips");
assert.match(wbjs, /command\.tool === 'goto'/);
assert.match(routes, /router\.post\("\/api\/agent\/open-mail"/);
assert.ok(mcp.includes('"retkit_open_mail"'));
console.log("✓ agent opens any mail itself");
