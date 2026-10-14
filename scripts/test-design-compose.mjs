/**
 * test-design-compose.mjs — regression test for the design→blocks "last mile"
 * (src/design-compose.js).
 *
 * Feeds a mock normalized design schema (the shape buildInternalDesignSchema
 * produces from a Figma import) and asserts:
 *   - section roles map to the right canonical SECTION blocks
 *   - content slots are filled from the design's own text/image nodes
 *   - exact style tokens are surfaced (styleSlotGap) rather than silently lost
 *   - the resulting plan actually builds via composeEmailFromBlocks → build-mail
 *
 * Zero-AI, no Figma token. Exit 0 = pass.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync, symlinkSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";
import { buildComposePlanFromDesign } from "../src/design-compose.js";
import { listCanonicalBlocks } from "../src/compose-email.js";
import { composeEmailFromBlocks } from "../src/compose-email.js";

const REPO = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) { pass++; console.log("✓", name); } else { fail++; console.log("✗ FAIL", name); } };

// Mock schema: header + hero + cta, with text/image nodes bound by sectionId.
const schema = {
  source: "figma",
  meta: { width: 600, height: 1200 },
  tokens: { bgColor: "#0D1117", primaryColor: "#FF7700", buttonRadius: "12px", fontFamily: "Inter" },
  sections: [
    { id: "sec_01", role: "header", style: {} },
    { id: "sec_02", role: "hero", style: {} },
    { id: "sec_03", role: "cta", style: {} },
  ],
  textNodes: [
    { id: "t5", sectionId: "sec_01", roleHint: "body", text: "BrandCo" },
    { id: "t1", sectionId: "sec_02", roleHint: "heading", text: "Welcome traders" },
    { id: "t2", sectionId: "sec_02", roleHint: "body", text: "Trade smarter today." },
    { id: "t3", sectionId: "sec_03", roleHint: "heading", text: "Open your account" },
    { id: "t4", sectionId: "sec_03", roleHint: "cta", text: "Sign up" },
  ],
  imageSlots: [
    { id: "i2", sectionId: "sec_01", assetSource: { url: "https://example.com/logo.png" }, alt: "Logo" },
    { id: "i1", sectionId: "sec_02", assetSource: { url: "https://example.com/hero.png" }, alt: "Hero shot" },
  ],
};

const result = buildComposePlanFromDesign({ schema });
const ids = result.plan.map((p) => p.id);
console.log("  plan:", JSON.stringify(ids));

// Проверяем ПРАВИЛО, а не замороженный список: в план попадают только
// release-safe канонические блоки. Раньше здесь стоял точный список из двух
// идентификаторов — он устарел в тот день, когда в каталоге появился
// канонический header (iqbr-section-header), и тест начал падать на
// улучшении. Сам тест при этом никогда не запускался: его не было в npm test.
const canonicalIds = new Set(
  listCanonicalBlocks().filter((block) => block.retired !== true).map((block) => block.id),
);
check("в план попали только канонические блоки",
  ids.length > 0 && ids.every((id) => canonicalIds.has(id)), JSON.stringify(ids));

// Роль header закрывается каноническим блоком, если такой в каталоге есть, и
// честно помечается как незакрытая, если его нет. Legacy-нарезку брать нельзя
// ни при каком раскладе — ради этого запрета тест и написан.
const header = result.sections.find((section) => section.role === "header");
const headerOk = header?.status === "no-canonical-block"
  || (header?.blockId && canonicalIds.has(header.blockId));
check("роль header закрыта каноническим блоком или честно помечена пустой",
  headerOk, JSON.stringify(header || null));

const hero = result.plan.find((p) => p.id === "iq-combo-hero-bgr");
check("hero title filled from design heading", hero?.slots.title_text === "Welcome traders");
check("hero body filled from design body", hero?.slots.body_text === "Trade smarter today.");
check("hero image filled from design image", hero?.slots.head_image === "https://example.com/hero.png");

const cta = result.plan.find((p) => p.id === "iq-combo-steps-promocode");
check("cta label filled from design cta text", cta?.slots.cta_label === "Sign up");

// Current combo recipes expose content slots but not a complete theme surface.
// Keep that limitation explicit instead of silently borrowing campaign CSS.
check("style tokens are not silently written into unrelated content slots", result.styleSlotsFilled === 0);
check("styleSlotGap remains explicit until canonical combos expose theme slots", result.styleSlotGap === true);

// The plan must actually build into a real email.
const tmp = path.join(os.tmpdir(), "retkit-design-compose-test");
mkdirSync(tmp, { recursive: true });
for (const item of ["vendor", "tools", "node_modules"]) {
  const src = path.join(REPO, "email-base", item);
  const dst = path.join(tmp, item);
  if (existsSync(src) && !existsSync(dst)) { try { symlinkSync(src, dst, "dir"); } catch {} }
}
const composed = composeEmailFromBlocks({ brand: "X_preview", mailName: "design-plan", blocks: result.plan, destRoot: tmp });
const built = await new Promise((res) => {
  const ch = spawn(process.execPath, ["tools/build-mail.js", "--category", "X_preview", "--mail", "design-plan", "--locales", "en", "--pretty"], { cwd: tmp, stdio: ["ignore", "pipe", "pipe"] });
  let err = ""; ch.stderr.on("data", (d) => err += d); ch.on("close", (code) => res({ code, err }));
});
const distHtml = path.join(tmp, "dist", "X_preview", "mail-design-plan", "en", "index.html");
const html = existsSync(distHtml) ? readFileSync(distHtml, "utf8") : "";
check("plan builds via build-mail (exit 0)", built.code === 0);
check("built HTML contains the hero heading text", html.includes("Welcome traders"));

console.log("\n" + (fail === 0 ? `✓ ALL PASS (${pass})` : `✗ ${fail} FAILED, ${pass} passed`));
process.exit(fail === 0 ? 0 : 1);
