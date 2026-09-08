#!/usr/bin/env node
/**
 * test-auto-gaps.mjs — автоотступы между блоками.
 *
 * Отступ здесь — свойство раскладки, а не блок в дереве: конструктор не
 * вставляет узел-разделитель, а compose сам ставит промежуток МЕЖДУ соседями.
 * Проверяем ровно то, что человек видит и на что жалуется, если сломается:
 *
 *  1. Один блок в секции — отступа нет. Положил второй — отступ появился.
 *  2. После последнего блока отступа нет (иначе снизу лишний воздух).
 *  3. Письмо не притирается к верхнему краю.
 *  4. Существующие блоки без слота `gap` не получают НИ ОДНОГО отступа —
 *     иначе у всех ранее собранных писем поехала бы геометрия.
 *
 * Zero-AI, без сети, без сборки почты: смотрим сгенерированный header.pug.
 * Exit 0 = pass.
 */
import { mkdtempSync, readFileSync, existsSync, symlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";
import { composeEmailFromBlocks } from "../src/compose-email.js";

const repoRoot = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const check = (name, cond, extra = "") => {
  if (cond) { pass++; console.log("  \x1b[32m✓\x1b[0m", name); }
  else { fail++; console.error(`  \x1b[31m✗ ${name}\x1b[0m ${extra}`); }
};

function sandbox() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "retkit-gaps-"));
  for (const item of ["vendor", "tools", "node_modules"]) {
    const src = path.join(repoRoot, "email-base", item);
    if (existsSync(src)) { try { symlinkSync(src, path.join(dir, item), "dir"); } catch { /* ignore */ } }
  }
  return dir;
}

/** Собрать письмо и вернуть сгенерированный header.pug. */
let mailCounter = 0;
function headerPugFor(blocks) {
  const dir = sandbox();
  const mailName = `gaps${++mailCounter}`;
  composeEmailFromBlocks({ brand: "X_preview", mailName, blocks, destRoot: dir, force: true });
  return readFileSync(path.join(dir, "X_preview", `mail-${mailName}`, "app", "templates", "blocks", "header.pug"), "utf8");
}

const countGaps = (pug) => (pug.match(/table\.rk-gap\(/g) || []).length;

const outer = (slots = {}) => ({ uid: "o1", blockId: "sys-outer", parentUid: null, slotId: "root", slots });
const section = (uid, slots = {}) => ({ uid, blockId: "sys-section", parentUid: "o1", slotId: "sections", slots });
const inner = (uid, blockId, parentUid) => ({ uid, blockId, parentUid, slotId: "content", slots: {} });

/* ─── 1. Один блок — без отступа, два — с отступом ───────────────────────── */
{
  const one = headerPugFor([
    outer({ space_top: 0, gap: 0 }), section("s1"), inner("b1", "sys-title", "s1"),
  ]);
  check("один блок в секции — отступа нет", countGaps(one) === 0, String(countGaps(one)));

  const two = headerPugFor([
    outer({ space_top: 0, gap: 0 }), section("s1"),
    inner("b1", "sys-title", "s1"), inner("b2", "sys-text", "s1"),
  ]);
  check("под заголовком появился текст — отступ возник сам", countGaps(two) === 1, String(countGaps(two)));

  const four = headerPugFor([
    outer({ space_top: 0, gap: 0 }), section("s1"),
    inner("b1", "sys-title", "s1"), inner("b2", "sys-text", "s1"),
    inner("b3", "sys-image", "s1"), inner("b4", "sys-button", "s1"),
  ]);
  check("четыре блока — три отступа, не четыре", countGaps(four) === 3, String(countGaps(four)));
}

/* ─── 2. После последнего блока отступа нет ──────────────────────────────── */
{
  const pug = headerPugFor([
    outer({ space_top: 0, gap: 0 }), section("s1"),
    inner("b1", "sys-title", "s1"), inner("b2", "sys-button", "s1"),
  ]);
  const lastGap = pug.lastIndexOf("table.rk-gap(");
  const lastBlock = pug.lastIndexOf("block-end: sys-button");
  check("последний отступ стоит ДО последнего блока", lastGap >= 0 && lastGap < lastBlock);
}

/* ─── 3. Отступы между секциями и над письмом ────────────────────────────── */
{
  const pug = headerPugFor([
    outer({ space_top: 24, gap: 16 }),
    section("s1"), inner("b1", "sys-title", "s1"),
    { uid: "s2", blockId: "sys-footer", parentUid: "o1", slotId: "sections", slots: {} },
  ]);
  check("между секциями появился отступ, и ещё один над письмом", countGaps(pug) === 2, String(countGaps(pug)));
  check("верхний отступ идёт раньше первой секции",
    pug.indexOf("table.rk-gap(") < pug.indexOf("block-start: sys-section"));
  check("верхний отступ именно той высоты, что задана", /height="24"/.test(pug));

  const flat = headerPugFor([
    outer({ space_top: 0, gap: 0 }),
    section("s1"), inner("b1", "sys-title", "s1"),
    { uid: "s2", blockId: "sys-footer", parentUid: "o1", slotId: "sections", slots: {} },
  ]);
  check("нулевой отступ — значит вплотную", countGaps(flat) === 0, String(countGaps(flat)));
}

/* ─── 4. Старые блоки без слота gap не трогаем ───────────────────────────── */
{
  const pug = headerPugFor([
    { uid: "o1", blockId: "iq-outer-wrapper", parentUid: null, slotId: "root", slots: {} },
    { uid: "s1", blockId: "iq-section", parentUid: "o1", slotId: "sections", slots: {} },
    { uid: "b1", blockId: "iq-text-title", parentUid: "s1", slotId: "content", slots: {} },
    { uid: "b2", blockId: "iq-text-plain", parentUid: "s1", slotId: "content", slots: {} },
    { uid: "s2", blockId: "iq-footer", parentUid: "o1", slotId: "sections", slots: {} },
  ]);
  check("промо-письмо не получило ни одного автоотступа", countGaps(pug) === 0, String(countGaps(pug)));
}

/* ─── 5. Высота отступа берётся из слота, а не зашита ────────────────────── */
{
  const pug = headerPugFor([
    outer({ space_top: 0, gap: 0 }), section("s1", { gap: 40 }),
    inner("b1", "sys-title", "s1"), inner("b2", "sys-text", "s1"),
  ]);
  check("высота отступа управляется слотом секции", /height="40"/.test(pug), pug.match(/height="\d+"/)?.[0]);
}

console.log(`\nauto-gaps: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
