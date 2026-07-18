import assert from "node:assert/strict";
import { shouldClassifyAiToolIntent } from "../src/ai-intent-routing.js";

assert.equal(shouldClassifyAiToolIntent({ text: "Расскажи, как устроена студия", hasNamespaceWorkspace: true }), false);
assert.equal(shouldClassifyAiToolIntent({ text: "Почему арабская локаль выглядит странно?", hasNamespaceWorkspace: true }), false);
assert.equal(shouldClassifyAiToolIntent({ text: "Проведи аудит переводов", hasNamespaceWorkspace: true }), false);
assert.equal(shouldClassifyAiToolIntent({ text: "Сделай арабскую локаль нормально", hasNamespaceWorkspace: true }), true);
assert.equal(shouldClassifyAiToolIntent({ text: "Синхронизируй текстовые блоки переводов", hasNamespaceWorkspace: true }), true);
assert.equal(shouldClassifyAiToolIntent({ text: "Переведи на AR", hasNamespaceWorkspace: true }), true);
assert.equal(shouldClassifyAiToolIntent({ text: "Поправь пятый блок в EN", hasNamespaceWorkspace: true }), true);
assert.equal(shouldClassifyAiToolIntent({ text: "Сделай арабскую локаль нормально", hasNamespaceWorkspace: false }), false);
assert.equal(shouldClassifyAiToolIntent({ text: "привет", hasNamespaceWorkspace: true }), false);

console.log("AI intent routing: ok");
