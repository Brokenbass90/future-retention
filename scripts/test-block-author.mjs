#!/usr/bin/env node
/**
 * scripts/test-block-author.mjs — NEW 2026-06-10
 *
 * Validates the ad-hoc `def` block path in composeEmailFromBlocks —
 * the backend of the constructor's "Создать блок" authoring preview.
 * Composes a draft (unsaved) block + a canonical block into a tmp mail
 * and runs the REAL build-mail.js to prove the pug+styl compile.
 *
 * Run:  node scripts/test-block-author.mjs
 * Exits 0 on success, 1 on any assertion failure.
 */

import { composeEmailFromBlocks } from "../src/compose-email.js";
import { readFileSync, existsSync, mkdirSync, symlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import url from "node:url";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const REPO = path.resolve(here, "..");

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

// ─── Fixture: draft block exactly as the author modal would send it ─────
const DRAFT = {
  uid: "draft-banner",
  id: "my-test-banner",
  parentUid: "outer-root",
  slotId: "sections",
  def: {
    label: "Test banner",
    placement: "section",
    pug: [
      "table.row.my-test-banner(width='100%' cellpadding='0' cellspacing='0')",
      "  tr",
      "    td.my-test-banner-td",
      "      p.my-test-banner-text {{ text }}",
      "      //- {{ INNER_BLOCKS }}",
    ].join("\n"),
    styl: [
      ".my-test-banner-td",
      "  padding 24px",
      "  background {{ bg_color }}",
      "  text-align center",
      ".my-test-banner-text",
      "  color #ffffff",
      "  font-size 18px",
    ].join("\n"),
    slots: [
      { id: "text", kind: "text", label: "Текст", default: "Привет из драфт-блока" },
      { id: "bg_color", kind: "color", label: "Фон", default: "#ff7700" },
    ],
    childSlots: [
      { id: "content", marker: "INNER_BLOCKS", accepts: ["inner", "both"] },
    ],
  },
  slots: {},
};

section("compose with ad-hoc def + canonical mix");
const tmpRoot = path.join(os.tmpdir(), "retkit-test-block-author-" + Date.now());
mkdirSync(tmpRoot, { recursive: true });
for (const item of ["vendor", "tools", "node_modules"]) {
  const src = path.join(REPO, "email-base", item);
  const dst = path.join(tmpRoot, item);
  if (existsSync(src) && !existsSync(dst)) {
    try { symlinkSync(src, dst, "dir"); } catch { /* ignore */ }
  }
}

let composed;
try {
  composed = composeEmailFromBlocks({
    brand: "X_authortest",
    mailName: "author-preview",
    blocks: [
      { uid: "outer-root", blockId: "iq-outer-wrapper", parentUid: null, slotId: null, slots: {} },
      DRAFT,
      { uid: "draft-spacer", blockId: "iq-spacer", parentUid: "draft-banner", slotId: "content", slots: {} },
    ],
    destRoot: tmpRoot,
  });
} catch (err) {
  assert(false, `compose threw: ${err.message}`);
}

if (composed) {
  assert(composed.blocksUsed === 2, `draft + canonical child rendered (used=${composed.blocksUsed ?? "?"})`);
  assert(composed.totalBlocks === 3, "outer context is preserved in the explicit tree");
  assert((composed.warnings || []).length === 0, `no warnings (${(composed.warnings || []).join("; ") || "none"})`);
  const headerPug = readFileSync(path.join(composed.destDir, "app", "templates", "blocks", "header.pug"), "utf8");
  assert(headerPug.includes("Привет из драфт-блока"), "slot default substituted into pug");
  assert(headerPug.includes("block-start: my-test-banner"), "draft block marker present");
  const mainStyl = readFileSync(path.join(composed.destDir, "app", "styles", "blocks", "main.styl"), "utf8");
  assert(mainStyl.includes("#ff7700"), "color slot substituted into styl");

  section("real build-mail.js compiles the draft");
  const r = spawnSync(process.execPath, [
    "tools/build-mail.js", "--category", "X_authortest", "--mail", "author-preview", "--locales", "en",
  ], { cwd: tmpRoot, encoding: "utf8", timeout: 40000 });
  assert(r.status === 0, `build exit 0 (got ${r.status}; stderr: ${(r.stderr || "").slice(0, 300)})`);
  const distHtml = path.join(tmpRoot, "dist", "X_authortest", "mail-author-preview", "en", "index.html");
  assert(existsSync(distHtml), "dist HTML produced");
  if (existsSync(distHtml)) {
    const html = readFileSync(distHtml, "utf8");
    assert(html.includes("Привет из драфт-блока"), "draft text in built HTML");
    assert(/#f70|#ff7700/i.test(html), "draft bg color in built HTML (minifier may shorten hex)");
  }
}

section("guards");
{
  // def with empty pug falls back to library lookup → unknown id is skipped.
  let threw = false;
  try {
    composeEmailFromBlocks({
      brand: "X_authortest", mailName: "author-bad",
      blocks: [{ id: "nonexistent-block-xyz", def: { pug: "" } }],
      destRoot: tmpRoot,
    });
  } catch { threw = true; }
  assert(threw, "empty-def + unknown id → no resolvable blocks → throws");
}

section("Verdict");
if (failed) {
  console.log(bad(`\n✗ ${failed} assertion(s) failed.\n`));
  process.exit(1);
} else {
  console.log(ok("\n✓ All assertions passed. Ad-hoc block authoring path is solid.\n"));
  process.exit(0);
}
