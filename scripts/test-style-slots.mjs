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
import { composeEmailFromBlocks } from "../src/compose-email.js";

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

// NOTE: the build's CSS optimizer shortens hex colors (#ff7700 → #f70,
// #ffffff → #fff). We therefore assert with colors that do NOT shorten
// (#123456, #abcdef) so the test reads cleanly.

// 1) Default slots → original orange (shortened to #f70) + 16px radius.
const def = await buildOnce("style-default", [{ id: "cta-banner", slots: {} }]);
check("default build succeeds", def.code === 0);
check("default keeps orange background (#ff7700/#f70)", /#f70\b|#ff7700\b/i.test(def.html));

// 2) Edited style slots → new colors + radius appear in the built CSS.
const edited = await buildOnce("style-edited", [{
  id: "cta-banner",
  slots: { bg_color: "#123456", radius: 4, button_bg: "#abcdef", button_text_color: "#654321" },
}]);
check("edited build succeeds", edited.code === 0);
check("edited banner background #123456 present in built HTML", /#123456/i.test(edited.html));
check("edited radius 4px present in built HTML", /border-radius:\s*4px/i.test(edited.html));
check("edited button bg #abcdef present", /#abcdef/i.test(edited.html));
check("no orange (#f70/#ff7700) left after override", !/#f70\b|#ff7700\b/i.test(edited.html));

// 3) hero-stack also exposes style slots (title color, button bg, radii).
const hero = await buildOnce("style-hero", [{
  id: "hero-stack",
  slots: { title_color: "#123456", body_color: "#654321", button_bg: "#abcdef", image_radius: 2 },
}]);
check("hero build succeeds", hero.code === 0);
check("hero title color #123456 present", /#123456/i.test(hero.html));
check("hero body color #654321 present", /#654321/i.test(hero.html));
check("hero image radius 2px present", /border-radius:\s*2px/i.test(hero.html));

console.log("\n" + (fail === 0 ? `✓ ALL PASS (${pass})` : `✗ ${fail} FAILED, ${pass} passed`));
process.exit(fail === 0 ? 0 : 1);
