// Живая проверка агента 02.11: две находки.
import assert from "node:assert/strict";
import { placeholderizePugSource } from "../src/pug-placeholderize.js";
import { looksLikeSetting } from "../src/canvas-completeness.js";

// 1. &nbsp; между текстом и ссылкой остаётся вне плейсхолдера.
const pug = 'p.x Note text&nbsp;\n    a(href="u") Link text\n    | .\n';
const out = placeholderizePugSource({ pug, refLocaleTxt: "{{Note text}}\n{{Link text}}", namespace: "ns" }).pug;
assert.match(out, /\$\{\{ ns\.block_00 \}\}\$&nbsp;\n/, "nbsp kept after placeholder");

// 2. Отступы, ссылки, рамки, номера и подстановки — не «образцовый текст».
for (const [slot, value] of [["media_padding", "30px 0 0"], ["href", "https://x"], ["border", "4px solid #FF7700"],
  ["align_css", "margin:0"], ["tail", "."], ["number", "1"], ["font_size", "48px"], ["link_tiktok", "${{ a.b }}$"],
  ["company_address", "{{embedded.company_address}}"]]) {
  assert.equal(looksLikeSetting(slot, value), true, `${slot}=${value} is a setting`);
}
for (const [slot, value] of [["text", "Title text"], ["label", "Перейти"], ["promo_code", "PROMOCODE"], ["link_label", "Link text"]]) {
  assert.equal(looksLikeSetting(slot, value), false, `${slot}=${value} is visible text`);
}
console.log("✓ agent live fixes: nbsp kept, settings are not leftovers");

// 3. Агент не вешает «Код» на confirm(): несохранённые правки → отказ или discard.
import fs from "node:fs";
const wb = fs.readFileSync(new URL("../public/workbench.js", import.meta.url), "utf8");
const toC = wb.slice(wb.indexOf("command.tool === 'to_constructor'"), wb.indexOf("Неизвестная команда"));
assert.match(toC, /ctx\.modified && !command\.args\?\.discard/);
assert.match(toC, /skipConfirm: true/);
assert.match(wb, /ctx\.modified && !skipConfirm && !confirm\(/);
const routes = fs.readFileSync(new URL("../src/routes/agent-routes.js", import.meta.url), "utf8");
assert.match(routes, /discard: body\?\.discard === true/);
assert.match(routes, /retkit_open_in_code/, "open-page points to in-studio navigation");
console.log("✓ agent to_constructor never blocks on confirm()");

// 4. Возврат в конструктор, заблокированный устаревшей моделью, — ответ агенту, а не тост.
const toC2 = wb.slice(wb.indexOf("command.tool === 'to_constructor'"), wb.indexOf("Неизвестная команда"));
assert.ok(toC2.indexOf("requestConstructorReturn") < toC2.indexOf("navigateBackToConstructor"), "check before navigating");
assert.match(toC2, /availability\.blockedReason/);
console.log("✓ blocked return to constructor is reported to the agent");
