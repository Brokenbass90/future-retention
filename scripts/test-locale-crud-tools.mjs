#!/usr/bin/env node
/**
 * scripts/test-locale-crud-tools.mjs — NEW 2026-06-10
 *
 * Validates the locale CRUD agent tools (create_locale / delete_locale /
 * edit_locale_block) added in src/ai-tools.js, plus the localeDeletes
 * plumbing through the agent loop (src/ai-agent.js). Fully hermetic:
 * direct handler calls + mocked OpenAI client. No tokens spent.
 *
 * Run:  node scripts/test-locale-crud-tools.mjs
 * Exits 0 on success, 1 on any assertion failure.
 */

import { TOOL_HANDLERS, TOOL_DEFINITIONS } from "../src/ai-tools.js";
import { runAgent } from "../src/ai-agent.js";

const C = { reset: "\x1b[0m", red: "\x1b[31m", green: "\x1b[32m", dim: "\x1b[2m" };
const ok = (s) => `${C.green}${s}${C.reset}`;
const bad = (s) => `${C.red}${s}${C.reset}`;
const dim = (s) => `${C.dim}${s}${C.reset}`;

let failed = 0;
const assert = (cond, label) => {
  if (cond) console.log("  " + ok("✓") + " " + label);
  else { console.log("  " + bad("✗") + " " + label); failed++; }
};
const section = (s) => console.log("\n" + dim("━━━ ") + s + dim(" ━━━"));

function freshCtx() {
  const NS = {
    namespace: "demo_ns",
    name: "demo_ns",
    referenceLocale: "en",
    locales: {
      en: ["Hello world", "Click here"],
      ar: ["مرحبا بالعالم", "اضغط هنا"],
    },
  };
  return {
    html: `<p>Hello world</p>`,
    namespaces: [NS],
    activeNamespace: NS,
    activeLocale: "en",
    pendingLocaleUpdates: [],
    pendingLocaleDeletes: [],
  };
}

// ─── 1. Tool definitions exist ──────────────────────────────────────────
section("Tool definitions");
for (const name of ["create_locale", "delete_locale", "edit_locale_block"]) {
  assert(TOOL_DEFINITIONS.some((t) => t.name === name), `definition present: ${name}`);
  assert(typeof TOOL_HANDLERS[name] === "function", `handler present: ${name}`);
}

// ─── 2. create_locale (stub copy, no apiKey needed) ─────────────────────
section("create_locale — stub copy (translate=false)");
{
  const ctx = freshCtx();
  const r = await TOOL_HANDLERS.create_locale({ locale: "de", translate: false }, ctx);
  assert(!r.error, `no error: ${r.error || "ok"}`);
  assert(r.mode === "stub-copy", `mode is stub-copy (got ${r.mode})`);
  assert(r.from === "en", `source defaulted to reference 'en' (got ${r.from})`);
  assert(ctx.pendingLocaleUpdates.length === 1, "one pending locale update queued");
  const upd = ctx.pendingLocaleUpdates[0];
  assert(upd?.locale === "de" && upd?.namespace === "demo_ns", "update targets demo_ns/de");
  assert(/\{\{Hello world\}\}/.test(upd?.txt || ""), "stub txt contains source blocks");
}

section("create_locale — guards");
{
  const ctx = freshCtx();
  const r1 = await TOOL_HANDLERS.create_locale({ locale: "ar", translate: false }, ctx);
  assert(!!r1.error, "refuses to create existing locale (ar)");
  const r2 = await TOOL_HANDLERS.create_locale({ locale: "no!pe", translate: false }, ctx);
  assert(!!r2.error, "rejects invalid locale code");
  const r3 = await TOOL_HANDLERS.create_locale({ locale: "fr" }, ctx); // translate=true default, no apiKey
  assert(!!r3.error && /OPENAI_API_KEY/.test(r3.error), "translate=true without apiKey → clear error");
}

// ─── 3. delete_locale ───────────────────────────────────────────────────
section("delete_locale");
{
  const ctx = freshCtx();
  const r = await TOOL_HANDLERS.delete_locale({ locale: "ar" }, ctx);
  assert(!r.error, `queues delete: ${r.error || "ok"}`);
  assert(ctx.pendingLocaleDeletes.length === 1, "one pending delete queued");
  assert(ctx.pendingLocaleDeletes[0].locale === "ar", "delete targets ar");

  const rRef = await TOOL_HANDLERS.delete_locale({ locale: "en" }, ctx);
  assert(!!rRef.error && /reference/.test(rRef.error), "refuses reference locale without force");
  const rForce = await TOOL_HANDLERS.delete_locale({ locale: "en", force: true }, ctx);
  assert(!rForce.error && ctx.pendingLocaleDeletes.length === 2, "force=true allows reference delete");

  const rMiss = await TOOL_HANDLERS.delete_locale({ locale: "zz" }, ctx);
  assert(!!rMiss.error, "missing locale → error");
}

// ─── 4. edit_locale_block ───────────────────────────────────────────────
section("edit_locale_block");
{
  const ctx = freshCtx();
  const r = await TOOL_HANDLERS.edit_locale_block({ locale: "en", index: 1, text: "Tap here" }, ctx);
  assert(!r.error, `edit ok: ${r.error || "ok"}`);
  assert(r.before === "Click here" && r.after === "Tap here", "returns before/after");
  assert(ctx.activeNamespace.locales.en[1] === "Tap here", "ctx copy mutated for subsequent reads");
  assert(ctx.pendingLocaleUpdates.length === 1, "one pending update");
  assert(/\{\{Tap here\}\}/.test(ctx.pendingLocaleUpdates[0].txt), "serialized txt contains edit");

  // Second edit of the SAME locale collapses into one update.
  await TOOL_HANDLERS.edit_locale_block({ locale: "en", index: 0, text: "Hi world" }, ctx);
  assert(ctx.pendingLocaleUpdates.length === 1, "edits of same locale collapse to one update");
  assert(/\{\{Hi world\}\}/.test(ctx.pendingLocaleUpdates[0].txt) && /\{\{Tap here\}\}/.test(ctx.pendingLocaleUpdates[0].txt),
    "final txt has both edits");

  const rOob = await TOOL_HANDLERS.edit_locale_block({ locale: "en", index: 9, text: "x" }, ctx);
  assert(!!rOob.error && /out of range/.test(rOob.error), "index out of range → error");
  const rTok = await TOOL_HANDLERS.edit_locale_block({ locale: "en", index: 0, text: "bad ${{ ns.block_1 }}$" }, ctx);
  assert(!!rTok.error, "literal ${{...}}$ in text → rejected");
}

// ─── 4b. normalize_locale_conventions ───────────────────────────────────
section("normalize_locale_conventions");
{
  const ctx = freshCtx();
  const ns = ctx.activeNamespace;
  ns.localeRaw = {
    en: "Subject: hi\n\n{{Contact us at {{embedded.company_email}}.}}\n\n{{Bye}}",
    ar: "{{اتصل بنا {{embedded.company_email}}.}}",
  };
  const r = await TOOL_HANDLERS.normalize_locale_conventions({ locale: "all" }, ctx);
  assert(!r.error, `no error: ${r.error || "ok"}`);
  assert(r.changedCount === 2, `обе локали починены (got ${r.changedCount})`);
  const enUpd = ctx.pendingLocaleUpdates.find((u) => u.locale === "en");
  assert(/\{\{Contact us at\}\} \{\{embedded\.company_email\}\}\{\{\.\}\}/.test(enUpd?.txt || ""),
    "en: блок разбит вокруг переменной");
  assert(/^Subject: hi/.test(enUpd?.txt || ""), "Subject-строка сохранена вне блоков");
  assert(ns.locales.en.includes("embedded.company_email"), "ctx-блоки обновлены для последующих инструментов");
  // Идемпотентность через повторный вызов.
  const r2 = await TOOL_HANDLERS.normalize_locale_conventions({ locale: "en" }, ctx);
  assert(r2.changedCount === 0, "повторный вызов: уже чисто");
}

// ─── 5. Agent loop end-to-end with mock: create stub + delete + finish ──
section("agent loop — localeUpdates + localeDeletes plumbing");
{
  const mkCall = (call_id, name, args) => ({ type: "function_call", call_id, name, arguments: JSON.stringify(args) });
  const SCRIPT = [
    { output: [mkCall("c1", "list_namespaces", {})] },
    { output: [mkCall("c2", "create_locale", { locale: "de", translate: false })] },
    { output: [mkCall("c3", "delete_locale", { locale: "ar" })] },
    { output: [mkCall("c4", "finish", { summary: "Создал de (заглушка), поставил ar в очередь на удаление." })] },
  ];
  let turn = 0;
  globalThis.__OPENAI_TEST_MOCK = async () => {
    if (turn >= SCRIPT.length) throw new Error(`mock exhausted at turn ${turn}`);
    return SCRIPT[turn++];
  };
  try {
    const ctx = freshCtx();
    const result = await runAgent({
      userMessage: "добавь немецкую локаль копией и удали арабскую",
      ctx,
      apiKey: "test-key-not-used",
      maxSteps: 8,
    });
    assert(result.summary.includes("de"), "finish summary surfaced");
    assert(Array.isArray(result.localeUpdates) && result.localeUpdates.length === 1, "result.localeUpdates has the stub create");
    assert(result.localeUpdates[0]?.locale === "de", "update is for de");
    assert(Array.isArray(result.localeDeletes) && result.localeDeletes.length === 1, "result.localeDeletes has the queued delete");
    assert(result.localeDeletes[0]?.locale === "ar" && result.localeDeletes[0]?.namespace === "demo_ns", "delete is demo_ns/ar");
    const toolCalls = result.steps.filter((s) => s.kind === "tool_call").map((s) => s.name);
    assert(toolCalls.join(",") === "list_namespaces,create_locale,delete_locale,finish", `tool order sane (${toolCalls.join(",")})`);
  } finally {
    delete globalThis.__OPENAI_TEST_MOCK;
  }
}

// ─── Verdict ────────────────────────────────────────────────────────────
section("Verdict");
if (failed) {
  console.log(bad(`\n✗ ${failed} assertion(s) failed.\n`));
  process.exit(1);
} else {
  console.log(ok("\n✓ All assertions passed. Locale CRUD tools are solid.\n"));
  process.exit(0);
}
