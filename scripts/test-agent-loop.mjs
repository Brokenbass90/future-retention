#!/usr/bin/env node
/**
 * scripts/test-agent-loop.mjs
 *
 * Validates the tool-use agent loop (src/ai-agent.js) with a MOCKED
 * OpenAI client — no API calls, no tokens spent. Catches structural
 * bugs in the loop's tool dispatch, ctx accumulation, and finish
 * handling before they hit a real user session.
 *
 * The mock returns a scripted sequence of "Responses API" payloads,
 * each producing one or more function_call items. The agent loop
 * dispatches the tool, gets a result, and feeds it back; the mock's
 * next reply pretends to be the model's next decision.
 *
 * Run:  node scripts/test-agent-loop.mjs
 * Exits 0 on success, 1 on any assertion failure.
 */

import { runAgent } from "../src/ai-agent.js";

// ─── ANSI helpers ───────────────────────────────────────────────────────
const C = { reset: "\x1b[0m", red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m", dim: "\x1b[2m" };
const ok = (s) => `${C.green}${s}${C.reset}`;
const bad = (s) => `${C.red}${s}${C.reset}`;
const dim = (s) => `${C.dim}${s}${C.reset}`;

let failed = 0;
const assert = (cond, label) => {
  if (cond) console.log("  " + ok("✓") + " " + label);
  else { console.log("  " + bad("✗") + " " + label); failed++; }
};
const section = (s) => console.log("\n" + dim("━━━ ") + s + dim(" ━━━"));

// ─── Mock OpenAI client ─────────────────────────────────────────────────
// We replace callOpenAiWithRetry with a function that returns the next
// scripted Responses API payload from a queue. Each entry is what the
// model would have returned on a given turn.
function mkFunctionCall(call_id, name, args) {
  return { type: "function_call", call_id, name, arguments: JSON.stringify(args) };
}
function mkMessage(text) {
  return { type: "message", content: [{ type: "output_text", text }] };
}
function mkResponsesPayload(items) {
  return { output: items };
}

function mockClient(scriptedResponses) {
  let turn = 0;
  globalThis.__OPENAI_TEST_MOCK = async () => {
    if (turn >= scriptedResponses.length) {
      throw new Error(`mock ran out of scripted responses at turn ${turn}`);
    }
    const r = scriptedResponses[turn++];
    return r;
  };
  return () => { delete globalThis.__OPENAI_TEST_MOCK; };
}

// ─── Test fixture ───────────────────────────────────────────────────────
const HTML = `<table><tr><td class="text-pad"><p class="title">Hello world</p></td></tr></table>`;
const NS = {
  namespace: "demo_ns",
  name: "demo_ns",
  referenceLocale: "en",
  locales: {
    en: ["Hello world", "Click here"],
    ar: ["مرحبا بالعالم", "اضغط هنا"],
  },
};
const CTX = {
  html: HTML,
  namespaces: [NS],
  activeNamespace: NS,
  activeLocale: "ar",
};

// Scripted turns — each is what the model returns on turn N.
const SCRIPT = [
  // Turn 0: model discovers state.
  mkResponsesPayload([
    mkFunctionCall("call_1", "list_namespaces", {}),
  ]),
  // Turn 1: read the HTML.
  mkResponsesPayload([
    mkFunctionCall("call_2", "read_open_html", {}),
  ]),
  // Turn 2: analyze.
  mkResponsesPayload([
    mkFunctionCall("call_3", "analyze_email", { namespace: "demo_ns" }),
  ]),
  // Turn 3: placeholderize. (Mocked AI inside placeholderizeHtml? It also calls
  // callOpenAiWithRetry — so we need to feed it a mock response too.)
  mkResponsesPayload([
    mkFunctionCall("call_4", "placeholderize_html", { namespace: "demo_ns" }),
  ]),
  // Inside placeholderize: primary mapping call.
  {
    output: [{ type: "message", content: [{
      type: "output_text",
      text: JSON.stringify({ mappings: [
        { blockIndex: 0, elementId: 0, confidence: 0.95 },
        { blockIndex: 1, elementId: 1, confidence: 0.92 },
      ] }),
    }] }],
  },
  // (no second-pass call expected since all blocks mapped — but if it triggers,
  // we add a noop here.)
  // Turn 4: finish.
  mkResponsesPayload([
    mkFunctionCall("call_5", "finish", {
      summary: "Расставил 2 плейсхолдера в HTML по namespace demo_ns.",
    }),
  ]),
];

// ─── Run ────────────────────────────────────────────────────────────────
async function main() {
  section("Setup");
  const restore = mockClient(SCRIPT);
  const frames = [];
  let err = null;
  let result = null;

  try {
    result = await runAgent({
      userMessage: "Расставь плейсхолдеры",
      ctx: CTX,
      apiKey: "sk-mock",
      onFrame: (f) => frames.push(f),
      maxSteps: 8,
    });
  } catch (e) {
    err = e;
  } finally {
    restore();
  }

  section("Loop terminated");
  assert(!err, `no exception thrown (got: ${err?.message || "none"})`);
  assert(!!result, "result returned");
  assert(typeof result?.summary === "string" && result.summary.length > 0, "summary is a non-empty string");

  section("Frame sequence");
  const kinds = frames.map((f) => f.kind).join(" → ");
  console.log(dim("  observed: ") + kinds);
  const toolCalls = frames.filter((f) => f.kind === "tool_call").map((f) => f.name);
  console.log(dim("  tools  : ") + toolCalls.join(", "));

  assert(toolCalls.includes("list_namespaces"), "list_namespaces was called");
  assert(toolCalls.includes("read_open_html"), "read_open_html was called");
  assert(toolCalls.includes("analyze_email"), "analyze_email was called");
  assert(toolCalls.includes("placeholderize_html"), "placeholderize_html was called");
  assert(toolCalls.includes("finish"), "finish was called");

  section("Tool results carry meaningful data");
  const byName = {};
  for (const f of frames) if (f.kind === "tool_result") byName[f.name] = f.result;
  assert(byName.list_namespaces?.count === 1, "list_namespaces.count === 1");
  assert(byName.read_open_html?.length === HTML.length, `read_open_html.length === ${HTML.length}`);
  assert(byName.analyze_email?.summary?.refBlockCount === 2, "analyze_email.summary.refBlockCount === 2");
  assert(typeof byName.placeholderize_html?.anchors === "number", "placeholderize_html.anchors is a number");

  section("Final payload");
  assert(typeof result.summary === "string", "summary present");
  console.log(dim("  summary: ") + result.summary);
  assert(typeof result.modifiedHtml === "string", "modifiedHtml present (string)");
  assert(Array.isArray(result.localeUpdates), "localeUpdates is an array");

  section("Bookkeeping");
  // Ctx was populated by placeholderize handler if anchors were placed.
  if (byName.placeholderize_html?.anchors > 0) {
    assert(CTX.modifiedHtml && CTX.modifiedHtml !== HTML, "ctx.modifiedHtml diverged from input HTML");
  } else {
    console.log(dim("  (placeholderize anchored 0 — modifiedHtml stays equal to input, OK)"));
  }

  section("Verdict");
  if (failed === 0) {
    console.log(ok(`\n✓ All assertions passed.\n`));
    process.exit(0);
  } else {
    console.log(bad(`\n✗ ${failed} assertion(s) failed.\n`));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(bad("unhandled: ") + (e?.stack || e?.message || e));
  process.exit(1);
});
