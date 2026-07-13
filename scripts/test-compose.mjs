#!/usr/bin/env node
/**
 * scripts/test-compose.mjs
 *
 * End-to-end smoke test for composeEmailFromBlocks (Phase 6).
 *
 * What it does:
 *   1. Composes a real email from the current IQ tree: outer → hero/regular
 *      sections → atomic image, copy and CTA blocks, with custom slot values.
 *   2. Runs the actual build-mail.js pipeline on it.
 *   3. Asserts the resulting dist HTML contains the slot values
 *      (proving slot substitution worked end-to-end).
 *
 * No API key needed. No tokens. Pure local pipeline.
 *
 * This is the equivalent of "user clicks Compose in the constructor"
 * minus the UI: composition → build → check.
 */

import { composeEmailFromBlocks } from "../src/compose-email.js";
import { spawn } from "node:child_process";
import { readFileSync, existsSync, rmSync, mkdirSync, symlinkSync, readdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, "..");
const EMAIL_BASE = path.join(REPO_ROOT, "email-base");
const TEMP_ROOT = path.join(os.tmpdir(), "retkit-compose-test");

const C = { reset: "\x1b[0m", red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m", dim: "\x1b[2m", bold: "\x1b[1m" };
const ok = (s) => `${C.green}${s}${C.reset}`;
const bad = (s) => `${C.red}${s}${C.reset}`;
const dim = (s) => `${C.dim}${s}${C.reset}`;
const head = (s) => `${C.bold}${s}${C.reset}`;

let failed = 0;
function assert(cond, label) {
  if (cond) console.log("  " + ok("✓") + " " + label);
  else { console.log("  " + bad("✗") + " " + label); failed++; }
}

function section(s) { console.log("\n" + dim("━━ ") + s + dim(" ━━")); }

function setupTempRoot() {
  try { rmSync(TEMP_ROOT, { recursive: true, force: true }); } catch {}
  mkdirSync(TEMP_ROOT, { recursive: true });
  for (const item of ["vendor", "tools", "node_modules"]) {
    const src = path.join(EMAIL_BASE, item);
    const dst = path.join(TEMP_ROOT, item);
    if (existsSync(src) && !existsSync(dst)) {
      try { symlinkSync(src, dst, "dir"); } catch { /* fallback skipped */ }
    }
  }
}

function runBuild(brand, mailName) {
  return new Promise((resolve) => {
    const args = ["tools/build-mail.js", "--category", brand, "--mail", mailName, "--locales", "en", "--pretty"];
    const child = spawn("node", args, { cwd: TEMP_ROOT, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.stderr.on("data", (d) => { stderr += d.toString(); });
    const timeout = setTimeout(() => { try { child.kill("SIGKILL"); } catch {} }, 30_000);
    child.on("close", (code) => { clearTimeout(timeout); resolve({ code, stdout, stderr }); });
    child.on("error", (err) => { clearTimeout(timeout); resolve({ code: -1, stdout, stderr: String(err) }); });
  });
}

async function main() {
  console.log(head("\n══ Phase 6 — compose_email_from_blocks end-to-end ══\n"));

  section("Setup temp root");
  setupTempRoot();
  console.log("  scaffold root: " + dim(TEMP_ROOT));

  section("Compose mail from the canonical IQ block tree");
  const composeResult = composeEmailFromBlocks({
    brand: "X_assembled",
    mailName: "test-compose-demo",
    destRoot: TEMP_ROOT,
    blocks: [
      { uid: "outer", blockId: "iq-outer-wrapper", parentUid: null, slotId: null, slots: {} },
      { uid: "hero", blockId: "iq-section-hero-bg", parentUid: "outer", slotId: "sections", slots: {} },
      {
        uid: "hero-logo",
        blockId: "iq-hero-logo",
        parentUid: "hero",
        slotId: "media",
        slots: {
          href: "https://test-brand.example/",
          image: "https://placehold.co/280x60?text=TEST-LOGO",
          alt: "TestBrand",
        },
      },
      {
        uid: "hero-image",
        blockId: "iq-hero-image",
        parentUid: "hero",
        slotId: "media",
        slots: {
          image: "https://placehold.co/480x240?text=Hero",
          alt: "Hero",
          href: "https://test-brand.example/welcome",
        },
      },
      {
        uid: "hero-copy",
        blockId: "iq-hero-copy",
        parentUid: "hero",
        slotId: "content",
        slots: {
          title: "TESTCOMPOSE-TITLE",
          body: "TESTCOMPOSE-BODY a short hero paragraph.",
        },
      },
      {
        uid: "hero-cta",
        blockId: "iq-cta-button",
        parentUid: "hero",
        slotId: "content",
        slots: {
          label: "TESTCOMPOSE-CTA",
          href: "https://test-brand.example/start",
        },
      },
      { uid: "banner", blockId: "iq-section", parentUid: "outer", slotId: "sections", slots: {} },
      {
        uid: "banner-copy",
        blockId: "iq-text-title",
        parentUid: "banner",
        slotId: "content",
        slots: {
          title: "TESTCOMPOSE-BANNER-TITLE",
          body: "TESTCOMPOSE-BANNER-SUB",
        },
      },
      {
        uid: "banner-cta",
        blockId: "iq-cta-button",
        parentUid: "banner",
        slotId: "content",
        slots: {
          label: "TESTCOMPOSE-BANNER-CTA",
          href: "https://test-brand.example/signup",
        },
      },
    ],
  });
  console.log("  destDir   : " + dim(composeResult.destDir));
  console.log("  blocksUsed: " + composeResult.blocksUsed + "/" + composeResult.totalBlocks);
  if (composeResult.warnings.length) console.log("  warnings  : " + composeResult.warnings.join("; "));
  assert(composeResult.blocksUsed === 8, "all 8 renderable IQ blocks resolved");
  assert(composeResult.totalBlocks === 9, "outer context is retained but not counted as rendered content");
  assert(composeResult.warnings.length === 0, "tree composes without placement warnings");
  assert(existsSync(composeResult.headerPugPath), "header.pug written");
  assert(existsSync(composeResult.mainStylPath), "main.styl written");

  section("Verify composed pug contains slot values");
  const composedPug = readFileSync(composeResult.headerPugPath, "utf8");
  assert(composedPug.includes("TESTCOMPOSE-TITLE"), "hero title substituted");
  assert(composedPug.includes("TESTCOMPOSE-BODY"), "hero body substituted");
  assert(composedPug.includes("TESTCOMPOSE-CTA"), "hero CTA label substituted");
  assert(composedPug.includes("TESTCOMPOSE-BANNER-TITLE"), "banner title substituted");
  assert(composedPug.includes("//- block-start: iq-section-hero-bg"), "block boundary marker present (hero section)");
  assert(composedPug.includes("//- block-end: iq-cta-button"), "block boundary marker present (CTA)");
  assert(!composedPug.match(/\{\{\s*[a-z]/i), "no unsubstituted {{ slot }} tokens remain");

  section("Build the composed mail via tools/build-mail.js");
  const t0 = Date.now();
  const built = await runBuild("X_assembled", "test-compose-demo");
  const ms = Date.now() - t0;
  if (built.code !== 0) {
    console.log(bad("  build failed (" + ms + "ms):"));
    console.log(dim((built.stderr || built.stdout).split("\n").slice(0, 10).map((l) => "    " + l).join("\n")));
    assert(false, "build-mail.js exited 0");
  } else {
    console.log("  build ok (" + ms + "ms)");
    assert(true, "build-mail.js exited 0");
  }

  section("Assert dist HTML contains the slot values");
  const distHtml = path.join(TEMP_ROOT, "dist", "X_assembled", "mail-test-compose-demo", "en", "index.html");
  assert(existsSync(distHtml), "dist HTML exists at " + path.relative(TEMP_ROOT, distHtml));
  if (existsSync(distHtml)) {
    const html = readFileSync(distHtml, "utf8");
    console.log("  dist HTML size: " + dim(html.length + " bytes"));
    assert(html.length > 1000, "dist HTML > 1 KB");
    assert(html.includes("TESTCOMPOSE-TITLE"), "TESTCOMPOSE-TITLE visible in dist HTML");
    assert(html.includes("TESTCOMPOSE-BODY"), "TESTCOMPOSE-BODY visible in dist HTML");
    assert(html.includes("TESTCOMPOSE-CTA"), "TESTCOMPOSE-CTA visible in dist HTML");
    assert(html.includes("TESTCOMPOSE-BANNER-TITLE"), "TESTCOMPOSE-BANNER-TITLE visible in dist HTML");
    assert(html.includes("TESTCOMPOSE-BANNER-CTA"), "TESTCOMPOSE-BANNER-CTA visible in dist HTML");
    assert(html.includes("test-compose-demo") || html.includes("test-brand.example"), "brand/mail context propagated");
  }

  section("Verdict");
  if (failed === 0) {
    console.log(ok("\n✓ All assertions passed — composing emails from blocks works end-to-end.\n"));
    console.log(dim("  Compose output: " + composeResult.destDir));
    console.log(dim("  Built HTML    : " + distHtml));
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
