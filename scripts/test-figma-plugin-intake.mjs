/**
 * test-figma-plugin-intake.mjs — end-to-end contract test for the Figma plugin.
 *
 * Feeds a payload shaped EXACTLY like figma-plugin/code.js emits, through the
 * real studio pipeline: buildInternalDesignSchema → buildComposePlanFromDesign
 * → composeEmailFromBlocks → build-mail. Proves a CLOSED-Figma paste/send flow
 * yields a buildable email with the design's content, while any exact style
 * tokens that current canonical combos cannot absorb stay explicit as a gap.
 *
 * Zero-AI, no network, no Figma. Exit 0 = pass.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync, symlinkSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";
import { buildInternalDesignSchema } from "../src/design-schema.js";
import { buildComposePlanFromDesign } from "../src/design-compose.js";
import { composeEmailFromBlocks } from "../src/compose-email.js";

const REPO = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const check = (n, c) => { if (c) { pass++; console.log("✓", n); } else { fail++; console.log("✗ FAIL", n); } };

// Payload exactly as figma-plugin/code.js produces.
const pluginPayload = {
  source: "figma-plugin",
  fileKey: "ABC123", nodeId: "10:42", selectionName: "Welcome email", pageName: "Ready for dev",
  frameSize: { width: 600, height: 1200 },
  styles: {
    bgColor: "#0D1117", textColor: "#4A4A4A", headingColor: "#101820", linkColor: "",
    primaryColor: "#FF7700", primaryTextColor: "#FFFFFF", buttonRadius: "12px",
    contentRadius: "8px", borderColor: "", fontFamily: "Inter",
  },
  sections: [
    { id: "sec_01", role: "header", name: "Header", x: 0, y: 0, width: 600, height: 80, style: { bgColor: "", radius: 0 } },
    { id: "sec_02", role: "hero", name: "Hero", x: 0, y: 80, width: 600, height: 500, style: { bgColor: "", radius: 0 } },
    { id: "sec_03", role: "cta", name: "CTA", x: 0, y: 580, width: 600, height: 200, style: { bgColor: "#FF7700", radius: 16 } },
  ],
  texts: [
    { id: "txt_01", roleHint: "body", text: "BrandCo", sectionId: "sec_01", color: "#101820", fontFamily: "Inter", fontSize: 18 },
    { id: "txt_02", roleHint: "heading", text: "Welcome aboard, trader", sectionId: "sec_02", color: "#101820", fontFamily: "Inter", fontSize: 32 },
    { id: "txt_03", roleHint: "body", text: "Your account is ready to go.", sectionId: "sec_02", color: "#4A4A4A", fontFamily: "Inter", fontSize: 16 },
    { id: "txt_04", roleHint: "heading", text: "Start trading today", sectionId: "sec_03", color: "#FFFFFF", fontFamily: "Inter", fontSize: 24 },
    { id: "txt_05", roleHint: "cta", text: "Open account", sectionId: "sec_03", color: "#FF7700", fontFamily: "Inter", fontSize: 16 },
  ],
  images: [
    { id: "img_01", roleHint: "logo", name: "Logo", sectionId: "sec_01", alt: "BrandCo logo" },
    { id: "img_02", roleHint: "hero", name: "Hero image", sectionId: "sec_02", alt: "Trading dashboard" },
  ],
  componentNames: ["Header", "Hero", "CTA"],
  directionHint: "ltr",
};

// buildInternalDesignSchema expects the payload under design.figmaImport.
const schema = buildInternalDesignSchema({ design: { figmaImport: pluginPayload } });
check("schema built from plugin payload", !!schema);
check("exact style tokens normalized", schema && schema.tokens.primaryColor === "#FF7700" && schema.tokens.fontFamily === "Inter");

const result = buildComposePlanFromDesign({ schema });
const ids = result.plan.map((p) => p.id);
console.log("  plan:", JSON.stringify(ids));
check("plan uses release-safe canonical hero/cta combos only",
  JSON.stringify(ids) === JSON.stringify(["iq-combo-hero-bgr", "iq-combo-steps-promocode"]));
check("legacy header fallback is refused and reported",
  result.sections.find((section) => section.role === "header")?.status === "no-canonical-block");
check("hero heading content carried over", result.plan.find((p) => p.id === "iq-combo-hero-bgr")?.slots.title_text === "Welcome aboard, trader");
check("unabsorbed exact style tokens remain visible as a gap", result.styleSlotsFilled === 0 && result.styleSlotGap === true);

// Must actually build.
const tmp = path.join(os.tmpdir(), "retkit-figma-intake-test");
mkdirSync(tmp, { recursive: true });
for (const item of ["vendor", "tools", "node_modules"]) {
  const src = path.join(REPO, "email-base", item), dst = path.join(tmp, item);
  if (existsSync(src) && !existsSync(dst)) { try { symlinkSync(src, dst, "dir"); } catch {} }
}
composeEmailFromBlocks({ brand: "X_preview", mailName: "figma-intake", blocks: result.plan, destRoot: tmp });
const built = await new Promise((res) => {
  const ch = spawn(process.execPath, ["tools/build-mail.js", "--category", "X_preview", "--mail", "figma-intake", "--locales", "en", "--pretty"], { cwd: tmp, stdio: ["ignore", "pipe", "pipe"] });
  let e = ""; ch.stderr.on("data", (d) => e += d); ch.on("close", (code) => res({ code }));
});
const distHtml = path.join(tmp, "dist", "X_preview", "mail-figma-intake", "en", "index.html");
const html = existsSync(distHtml) ? readFileSync(distHtml, "utf8") : "";
check("plan builds via build-mail (exit 0)", built.code === 0);
check("built HTML carries the hero heading", html.includes("Welcome aboard, trader"));

console.log("\n" + (fail === 0 ? `✓ ALL PASS (${pass})` : `✗ ${fail} FAILED, ${pass} passed`));
process.exit(fail === 0 ? 0 : 1);
