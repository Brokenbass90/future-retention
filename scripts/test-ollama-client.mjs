import assert from "node:assert/strict";
import { callOllamaChat, toOllamaMessages } from "../src/ollama-client.js";

const input = [
  { role: "developer", content: [{ type: "input_text", text: "Return JSON." }] },
  { role: "user", content: [
    { type: "input_text", text: "Build an email." },
    { type: "input_image", image_url: "data:image/png;base64,YWJj" },
  ] },
];
assert.deepEqual(toOllamaMessages(input), [
  { role: "system", content: "Return JSON." },
  { role: "user", content: "Build an email.", images: ["YWJj"] },
]);

let request = null;
const result = await callOllamaChat({
  baseUrl: "http://127.0.0.1:11434/",
  model: "qwen-test",
  input,
  format: { type: "object", properties: { ok: { type: "boolean" } } },
  fetchImpl: async (url, options) => {
    request = { url, options, body: JSON.parse(options.body) };
    return {
      ok: true,
      status: 200,
      json: async () => ({ message: { content: '{"ok":true}' }, prompt_eval_count: 12, eval_count: 3 }),
    };
  },
});

assert.equal(request.url, "http://127.0.0.1:11434/api/chat");
assert.equal(request.body.stream, false);
assert.equal(request.body.model, "qwen-test");
assert.deepEqual(request.body.format, { type: "object", properties: { ok: { type: "boolean" } } });
assert.equal(result.text, '{"ok":true}');
assert.deepEqual(result.usage, { input_tokens: 12, output_tokens: 3, total_tokens: 15 });

await assert.rejects(
  () => callOllamaChat({ model: "", input: [], fetchImpl: async () => ({}) }),
  /OLLAMA_MODEL is not configured/,
);

console.log("ollama client: message conversion + native structured request ok");
