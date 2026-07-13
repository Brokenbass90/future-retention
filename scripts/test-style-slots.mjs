/**
 * test-style-slots.mjs — proves that editable STYLE slots (bg color, text
 * color, border-radius) on canonical blocks flow all the way into the built
 * email CSS. This is the foundation for "change a block's background / radius
 * in the constructor and see it in the code".
 *
 * Zero-AI, no network. Exit 0 = pass.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync, symlinkSync, mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";
import { applyBlockAppearanceToPug, composeEmailFromBlocks } from "../src/compose-email.js";

const REPO = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) { pass++; console.log("✓", name); } else { fail++; console.log("✗ FAIL", name); } };

const tmp = path.join(os.tmpdir(), "retkit-style-slots-test");
mkdirSync(tmp, { recursive: true });
for (const item of ["vendor", "tools", "node_modules"]) {
  const src = path.join(REPO, "email-base", item);
  const dst = path.join(tmp, item);
  if (existsSync(src) && !existsSync(dst)) { try { symlinkSync(src, dst, "dir"); } catch {} }
}

async function buildOnce(mailName, blocks) {
  const dest = path.join(tmp, "X_preview", `mail-${mailName}`);
  if (existsSync(dest)) { try { rmSync(dest, { recursive: true, force: true }); } catch {} }
  composeEmailFromBlocks({ brand: "X_preview", mailName, blocks, destRoot: tmp });
  const built = await new Promise((res) => {
    const ch = spawn(process.execPath, ["tools/build-mail.js", "--category", "X_preview", "--mail", mailName, "--locales", "en", "--pretty"], { cwd: tmp, stdio: ["ignore", "pipe", "pipe"] });
    let err = ""; ch.stderr.on("data", (d) => err += d); ch.on("close", (code) => res({ code, err }));
  });
  const distHtml = path.join(tmp, "dist", "X_preview", `mail-${mailName}`, "en", "index.html");
  return { code: built.code, html: existsSync(distHtml) ? readFileSync(distHtml, "utf8") : "" };
}

function tree(sectionId, sectionSlots, children = []) {
  const outerUid = `${sectionId}-outer`;
  const sectionUid = `${sectionId}-section`;
  return [
    { uid: outerUid, blockId: "iq-outer-wrapper", parentUid: null, slotId: null, slots: {} },
    { uid: sectionUid, blockId: sectionId, parentUid: outerUid, slotId: "sections", slots: sectionSlots },
    ...children.map((child, index) => ({
      uid: `${sectionId}-child-${index}`,
      parentUid: sectionUid,
      ...child,
    })),
  ];
}

// NOTE: the build's CSS optimizer shortens hex colors (#ff7700 → #f70,
// #ffffff → #fff). We therefore assert with colors that do NOT shorten
// (#123456, #abcdef) so the test reads cleanly.

// 1) Default IQ section + CTA → original orange (shortened to #f70).
const def = await buildOnce("style-default", tree("iq-section", {}, [
  { blockId: "iq-cta-button", slotId: "content", slots: {} },
]));
check("default build succeeds", def.code === 0);
check("default keeps orange background (#ff7700/#f70)", /#f70\b|#ff7700\b/i.test(def.html));

// 2) Edited style slots → new colors + radius appear in the built CSS.
const edited = await buildOnce("style-edited", tree("iq-section", {
  bg: "",
  background_color: "#123456",
  radius: "4px",
}, [{
  blockId: "iq-cta-button",
  slotId: "content",
  slots: { background_color: "#abcdef", text_color: "#654321", radius: "4px" },
}]));
check("edited build succeeds", edited.code === 0);
check("edited section background #123456 present in built HTML", /#123456/i.test(edited.html));
check("edited radius 4px present in built HTML", /border-radius:\s*4px/i.test(edited.html));
check("edited button bg #abcdef present", /#abcdef/i.test(edited.html));
check("no orange (#f70/#ff7700) left after override", !/#f70\b|#ff7700\b/i.test(edited.html));

// 3) The IQ hero recipe exposes style slots across its composed inner blocks.
const hero = await buildOnce("style-hero", tree("iq-section-hero-bg", {}, [
  {
    blockId: "iq-hero-image",
    slotId: "media",
    slots: { radius: "2px" },
  },
  {
    blockId: "iq-hero-copy",
    slotId: "content",
    slots: { title_color: "#123456", body_color: "#654321" },
  },
  {
    blockId: "iq-cta-button",
    slotId: "content",
    slots: { background_color: "#abcdef" },
  },
]));
check("hero build succeeds", hero.code === 0);
check("hero title color #123456 present", /#123456/i.test(hero.html));
check("hero body color #654321 present", /#654321/i.test(hero.html));
check("hero button bg #abcdef present", /#abcdef/i.test(hero.html));
check("hero image radius 2px present", /border-radius:\s*2px/i.test(hero.html));

// 4) Both divider levels expose a real background slot. Transparent is the
// safe default; a chosen color is emitted on the exact inner/outer gap.
const dividers = await buildOnce("style-dividers", [
  { uid: "divider-outer", blockId: "iq-outer-wrapper", parentUid: null, slotId: null, slots: {} },
  {
    uid: "divider-section",
    blockId: "iq-section",
    parentUid: "divider-outer",
    slotId: "sections",
    slots: { bg: "", background_color: "#102938", radius: "0" },
  },
  {
    uid: "divider-inner-gap",
    blockId: "iq-spacer",
    parentUid: "divider-section",
    slotId: "content",
    slots: { height: "16", background_color: "#234567" },
  },
  {
    uid: "divider-outer-gap",
    blockId: "iq-section-spacer",
    parentUid: "divider-outer",
    slotId: "sections",
    slots: { height: "24", background_color: "#bcdef0" },
  },
]);
check("divider build succeeds", dividers.code === 0);
check("inner divider background #234567 present", /background-color:\s*#234567/i.test(dividers.html));
check("outer divider background #bcdef0 present", /background-color:\s*#bcdef0/i.test(dividers.html));

// 5) Blocks without native surface slots still receive the four common
// inspector overrides on email-safe nodes (surface on root, padding on td).
const decoratedPug = applyBlockAppearanceToPug(
  "table.demo(role='presentation' style='color:#123456')\n    tr\n        td Demo",
  { background_color: "#345678", border: "2px solid #456789", radius: "13px", padding: "7px 11px" },
);
check("generic appearance merges with an existing root style", /style='color:#123456;background-color:#345678;border:2px solid #456789;border-radius:13px'/.test(decoratedPug));
check("generic padding targets the first email cell", /td\(style="padding:7px 11px"\)/.test(decoratedPug));
check("unsafe generic CSS is ignored", !applyBlockAppearanceToPug("p Demo", { border: "none; color:red" }).includes("color:red"));

const generic = await buildOnce("style-generic-surface", tree("iq-section", {}, [{
  blockId: "iq-text-title",
  slotId: "content",
  slots: { title: "Generic surface", body: "Safe fallback" },
  appearance: { background_color: "#345678", border: "2px solid #456789", radius: "13px", padding: "7px 11px" },
}]));
check("generic surface build succeeds", generic.code === 0);
check("generic background reaches built HTML", /background-color:\s*#345678/i.test(generic.html));
check("generic border reaches built HTML", /border:\s*2px solid #456789/i.test(generic.html));
check("generic radius reaches built HTML", /border-radius:\s*13px/i.test(generic.html));
check("generic padding reaches built HTML", /padding:\s*7px 11px/i.test(generic.html));

console.log("\n" + (fail === 0 ? `✓ ALL PASS (${pass})` : `✗ ${fail} FAILED, ${pass} passed`));
process.exit(fail === 0 ? 0 : 1);
