#!/usr/bin/env node
/**
 * test-custom-style-layer.mjs — слой ручных стилей письма.
 *
 * Проверяет три обещания, которые мы даём пользователю:
 *   1. custom.styl создаётся сам и подключается ПОСЛЕДНИМ;
 *   2. конструктор его НИКОГДА не перезаписывает — правки переживают
 *      пересохранение письма;
 *   3. правило из custom.styl бьёт дефолт блока в собранном письме,
 *      но проигрывает inline-стилю, заданному слотом.
 *
 * Zero-AI, без сети. Exit 0 = pass.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";
import { composeEmailFromBlocks } from "../src/compose-email.js";

const REPO = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const check = (name, cond, extra = "") => {
  if (cond) { pass++; console.log("  \x1b[32m✓\x1b[0m", name); }
  else { fail++; console.error(`  \x1b[31m✗ ${name}\x1b[0m ${extra}`); }
};

const tmp = path.join(os.tmpdir(), "retkit-custom-styl-test");
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });
for (const item of ["vendor", "tools", "node_modules"]) {
  const src = path.join(REPO, "email-base", item);
  const dst = path.join(tmp, item);
  if (existsSync(src) && !existsSync(dst)) { try { symlinkSync(src, dst, "dir"); } catch { /* ignore */ } }
}

const MAIL = "custom-layer";
const destDir = path.join(tmp, "X_preview", `mail-${MAIL}`);
const customPath = path.join(destDir, "app", "styles", "custom.styl");
const entryPath = path.join(destDir, "app", "styles", "common.styl");

const tree = (titleSlots) => [
  { uid: "o", blockId: "iq-outer-wrapper", parentUid: null, slotId: null, slots: {} },
  { uid: "s", blockId: "iq-section", parentUid: "o", slotId: "sections", slots: {} },
  { uid: "t", blockId: "iq-text-title", parentUid: "s", slotId: "content", slots: titleSlots },
];

function compose(slots) {
  composeEmailFromBlocks({ brand: "X_preview", mailName: MAIL, blocks: tree(slots), destRoot: tmp, force: true });
}

async function build() {
  const built = await new Promise((res) => {
    const ch = spawn(process.execPath,
      ["tools/build-mail.js", "--category", "X_preview", "--mail", MAIL, "--locales", "en"],
      { cwd: tmp, stdio: ["ignore", "pipe", "pipe"] });
    let err = ""; ch.stderr.on("data", (d) => { err += d; });
    ch.on("close", (code) => res({ code, err }));
  });
  const dist = path.join(tmp, "dist", "X_preview", `mail-${MAIL}`, "en", "index.html");
  return { ...built, html: existsSync(dist) ? readFileSync(dist, "utf8") : "" };
}

/* ─── 1. Создание и порядок импорта ──────────────────────────────────────── */
compose({ title: "TITLE-A" });

check("custom.styl создан", existsSync(customPath));
check("в нём есть объясняющий заголовок", readFileSync(customPath, "utf8").includes("Каскад:"));

const entry = readFileSync(entryPath, "utf8");
check("common.styl импортирует custom", /@import\s+'custom'/.test(entry));
check(
  "импорт custom стоит ПОСЛЕ блоков",
  entry.lastIndexOf("@import 'custom'") > entry.lastIndexOf("blocks/"),
  "custom должен идти последним, иначе main.styl его перебьёт",
);

/* ─── 2. Пересохранение из конструктора не трогает ручные правки ─────────── */
// Важно: берём свойство, которого НЕТ в inline-стиле блока. `color` блок
// пишет инлайном через слот, и никакой класс его не перебьёт — это штатное
// поведение почтовой вёрстки, а не дефект слоя (см. заголовок custom.styl).
// Класс берём из блока ПОСЛЕ автоскоупа: имена стали `<id>--<class>`.
// Это, кстати, реальное последствие миграции — ручной CSS, написанный под
// старые имена, перестаёт совпадать и его надо переписать один раз.
const TITLE_CLASS = "iq-text-title--iq-middle-title";
const HAND_WRITTEN = `\n.${TITLE_CLASS}\n  text-transform: uppercase\n  color: #654321\n`;
writeFileSync(customPath, readFileSync(customPath, "utf8") + HAND_WRITTEN, "utf8");

compose({ title: "TITLE-B" });
check(
  "ручная правка пережила пересохранение письма",
  readFileSync(customPath, "utf8").includes("text-transform"),
);
const entryAfter = readFileSync(entryPath, "utf8");
check(
  "импорт не задублировался при повторном composе",
  (entryAfter.match(/@import\s+'custom'/g) || []).length === 1,
);

/* ─── 3. Каскад в собранном письме ───────────────────────────────────────── */
{
  // Дефолт цвета заголовка у iq-text-title — #393A44. Слот не задаём, чтобы
  // inline-стиль нёс дефолт, а не пользовательское значение.
  const built = await build();
  check("письмо собралось", built.code === 0, built.err.split("\n").filter(Boolean).slice(-1)[0] || "");

  if (built.html) {
    // custom.styl попал в сборку: правило видно либо в head, либо заинлайнено.
    check(
      "правило из custom.styl доехало до письма",
      /text-transform:\s*uppercase/i.test(built.html),
      "правила из custom.styl в HTML нет",
    );
    // А вот color из custom.styl проиграл inline-стилю блока — и это правильно.
    const titleAt = built.html.indexOf(">TITLE-B");
    const titleAround = built.html.slice(Math.max(0, titleAt - 320), titleAt);
    check(
      "inline-стиль блока сильнее color из custom.styl",
      !titleAround.includes("#654321"),
      titleAround.slice(-140),
    );
  }
}

/* ─── 4. Inline-стиль слота остаётся сильнее custom.styl ─────────────────── */
{
  compose({ title: "TITLE-C", title_color: "#abcdef" });
  const built = await build();
  check("письмо со слотом собралось", built.code === 0);
  if (built.html) {
    const at = built.html.indexOf(">TITLE-C");
    const around = built.html.slice(Math.max(0, at - 320), at);
    check(
      "значение слота выиграло у custom.styl на самом элементе",
      around.includes("#abcdef"),
      around.slice(-140),
    );
  }
}

rmSync(tmp, { recursive: true, force: true });
console.log(`\ncustom-style-layer: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
