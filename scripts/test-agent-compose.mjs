#!/usr/bin/env node
/**
 * scripts/test-agent-compose.mjs
 *
 * Validates that the agent loop can compose a new email from blocks
 * end-to-end via tool-use. Scripts the model's tool calls so we don't
 * spend tokens; the actual handler runs for real (including writing
 * the mail folder to disk via composeEmailFromBlocks).
 *
 * Sequence under test:
 *   1. list_canonical_blocks → discover available blocks
 *   2. compose_email_from_blocks → assemble a real mail
 *   3. finish → return summary + path
 */

import { runAgent } from "../src/ai-agent.js";
import { TOOL_HANDLERS } from "../src/ai-tools.js";
import { existsSync, mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import url from "node:url";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, "..");

const C = { reset: "\x1b[0m", red: "\x1b[31m", green: "\x1b[32m", dim: "\x1b[2m", bold: "\x1b[1m" };
const ok = (s) => `${C.green}${s}${C.reset}`;
const bad = (s) => `${C.red}${s}${C.reset}`;
const dim = (s) => `${C.dim}${s}${C.reset}`;

let failed = 0;
const assert = (cond, label) => {
  if (cond) console.log("  " + ok("✓") + " " + label);
  else { console.log("  " + bad("✗") + " " + label); failed++; }
};
const section = (s) => console.log("\n" + dim("━━ ") + s + dim(" ━━"));

const TEST_BRAND = "X_assembled";
const TEST_MAIL = "agent-compose-test";
const TEST_DEST = path.join(REPO_ROOT, "email-base", TEST_BRAND, "mail-" + TEST_MAIL);
const TEST_DIST = path.join(REPO_ROOT, "email-base", "dist", TEST_BRAND, "mail-" + TEST_MAIL);

function mkFnCall(call_id, name, args) {
  return { type: "function_call", call_id, name, arguments: JSON.stringify(args) };
}

function setMock(queue) {
  let turn = 0;
  globalThis.__OPENAI_TEST_MOCK = async () => {
    if (turn >= queue.length) throw new Error(`mock exhausted at turn ${turn}`);
    return queue[turn++];
  };
  return () => { delete globalThis.__OPENAI_TEST_MOCK; };
}

async function main() {
  console.log("\n" + C.bold + "══ Agent compose-from-blocks (tool-use) ══" + C.reset);

  // Clean any prior test mail.
  for (const target of [TEST_DEST, TEST_DIST]) {
    if (existsSync(target)) {
      try { rmSync(target, { recursive: true, force: true }); } catch {}
    }
  }

  // Script the model's three turns.
  const SCRIPT = [
    // Turn 0: list available blocks.
    { output: [mkFnCall("c1", "list_canonical_blocks", {})] },
    // Turn 1: compose using three current, release-safe canonical sections.
    { output: [mkFnCall("c2", "compose_email_from_blocks", {
      brand: TEST_BRAND,
      mailName: TEST_MAIL,
      blocks: [
        { id: "iq-combo-hero-233", slots: { title: "AGENT-HERO-TITLE", body: "AGENT-HERO-BODY" } },
        { id: "iq-combo-promo-steps", slots: { title: "AGENT-BANNER", cta_label: "Click" } },
        { id: "iq-footer", slots: {} },
      ],
    })] },
    // Turn 2: finish.
    { output: [mkFnCall("c3", "finish", {
      summary: "Собрал email из трёх canonical-секций: hero, promo и footer.",
    })] },
  ];

  const restore = setMock(SCRIPT);
  const frames = [];
  let result = null;
  let error = null;

  section("Run agent");
  try {
    result = await runAgent({
      userMessage: "Собери welcome-email из блоков (header → hero → cta).",
      ctx: { html: "", namespaces: [], activeNamespace: null, activeLocale: null },
      apiKey: "sk-mock",
      onFrame: (f) => frames.push(f),
      maxSteps: 6,
    });
  } catch (e) {
    error = e;
  } finally {
    restore();
  }

  section("Flow assertions");
  assert(!error, "agent completed without exception (got: " + (error?.message || "none") + ")");
  const toolCalls = frames.filter((f) => f.kind === "tool_call").map((f) => f.name);
  console.log("  tool calls: " + dim(toolCalls.join(" → ")));
  assert(toolCalls[0] === "list_canonical_blocks", "first call: list_canonical_blocks");
  assert(toolCalls[1] === "compose_email_from_blocks", "second call: compose_email_from_blocks");
  assert(toolCalls[2] === "finish", "third call: finish");

  section("Tool result content");
  const byName = {};
  for (const f of frames) if (f.kind === "tool_result") byName[f.name] = f.result;
  assert(byName.list_canonical_blocks?.count >= 8, "list returned ≥ 8 blocks");
  assert(byName.list_canonical_blocks?.blocks?.every((block) => block.source === "canonical"), "list excludes imported/user blocks");
  assert(byName.compose_email_from_blocks?.blocksUsed === 3, "compose used 3 blocks");
  assert(byName.compose_email_from_blocks?.brand === TEST_BRAND, "compose returned brand");
  assert(byName.compose_email_from_blocks?.mailName === TEST_MAIL, "compose returned mailName");
  assert(result?.composed?.brand === TEST_BRAND, "final result exposes composed brand");
  assert(result?.composed?.mailName === TEST_MAIL, "final result exposes composed mailName");

  section("Mail folder created on disk");
  const headerPug = path.join(TEST_DEST, "app", "templates", "blocks", "header.pug");
  const mainStyl = path.join(TEST_DEST, "app", "styles", "blocks", "main.styl");
  assert(existsSync(TEST_DEST), `mail folder exists at email-base/${TEST_BRAND}/mail-${TEST_MAIL}/`);
  assert(existsSync(headerPug), "header.pug present");
  assert(existsSync(mainStyl), "main.styl present");
  if (existsSync(headerPug)) {
    const pug = readFileSync(headerPug, "utf8");
    assert(pug.includes("AGENT-HERO-TITLE"), "hero title from agent's slot is in composed pug");
    assert(pug.includes("AGENT-BANNER"),     "banner title from agent's slot is in composed pug");
    assert(pug.includes("//- block-start: iq-combo-hero-233"), "block boundary marker for hero combo");
    assert(pug.includes("//- block-end: iq-footer"),           "block boundary marker for footer");
  }

  section("Existing mail protection + transactional rollback");
  const sourceSentinel = path.join(TEST_DEST, "sentinel.txt");
  const distSentinel = path.join(TEST_DIST, "EN", "index.html");
  mkdirSync(path.dirname(distSentinel), { recursive: true });
  writeFileSync(sourceSentinel, "KEEP EXISTING SOURCE", "utf8");
  writeFileSync(distSentinel, "KEEP EXISTING DIST", "utf8");
  const protectedResult = await TOOL_HANDLERS.compose_email_from_blocks({
    brand: TEST_BRAND,
    mailName: TEST_MAIL,
    blocks: [{ id: "iq-combo-hero-233", slots: { title: "MUST NOT REPLACE" } }],
  }, {});
  assert(protectedResult?.code === "COMPOSE_SAVE_TARGET_EXISTS", "existing mail is refused without force");
  assert(readFileSync(sourceSentinel, "utf8") === "KEEP EXISTING SOURCE", "source sentinel unchanged without force");
  assert(readFileSync(distSentinel, "utf8") === "KEEP EXISTING DIST", "dist sentinel unchanged without force");

  const failedForcedResult = await TOOL_HANDLERS.compose_email_from_blocks({
    brand: TEST_BRAND,
    mailName: TEST_MAIL,
    force: true,
    blocks: [{ id: "iq-combo-hero-233", slots: { title: "unsafe\nslot" } }],
  }, {});
  assert(/line breaks/i.test(String(failedForcedResult?.error || "")), "forced compose surfaces the synthetic slot-validation failure");
  assert(readFileSync(sourceSentinel, "utf8") === "KEEP EXISTING SOURCE", "source restored after failed forced compose");
  assert(readFileSync(distSentinel, "utf8") === "KEEP EXISTING DIST", "dist restored after failed forced compose");

  section("Cleanup");
  for (const target of [TEST_DEST, TEST_DIST]) {
    try {
      rmSync(target, { recursive: true, force: true });
      console.log("  removed " + dim(target));
    } catch (e) {
      console.log("  (could not remove test mail folder — manual cleanup needed)");
    }
  }

  section("Verdict");
  if (failed === 0) {
    console.log(ok("\n✓ Agent can compose new emails from blocks via tool-use. End-to-end works.\n"));
    process.exit(0);
  } else {
    console.log(bad("\n✗ " + failed + " assertion(s) failed.\n"));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(bad("unhandled: ") + (err?.stack || err?.message || err));
  process.exit(1);
});
