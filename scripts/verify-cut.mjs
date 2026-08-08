#!/usr/bin/env node
/**
 * scripts/verify-cut.mjs — проверить автонарезку письма и откатить, если не сошлось.
 *
 * Нарезка считается удавшейся только тогда, когда собранное из блоков письмо
 * совпадает с оригиналом ПОПИКСЕЛЬНО. Всё остальное — «на глаз похоже», а
 * похожее письмо в рассылке означает съехавшую вёрстку у получателя.
 *
 * Если сверка не сходится, скрипт удаляет блоки, которые завела нарезка:
 * лучше пустая библиотека, чем библиотека с блоками, которым нельзя верить.
 *
 *   node scripts/cut-email.mjs --brand X_IQBroker --mail tools --apply
 *   node scripts/verify-cut.mjs --brand X_IQBroker --mail tools
 */
import { readFileSync, existsSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import url from "node:url";
import { chromium } from "playwright-core";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import { composeEmailFromBlocks } from "../src/compose-email.js";

const repoRoot = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const opt = (name, fallback = null) => {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 && process.argv[at + 1] && !process.argv[at + 1].startsWith("--") ? process.argv[at + 1] : fallback;
};

const brand = opt("brand", "X_IQBroker");
const mail = opt("mail");
if (!mail) { console.error("нужен --mail"); process.exit(1); }

const planPath = path.join(repoRoot, "data", `cut-${mail}.json`);
if (!existsSync(planPath)) { console.error(`нет ${planPath} — сначала cut-email.mjs --apply`); process.exit(1); }
const plan = JSON.parse(readFileSync(planPath, "utf8"));

const CHECK_MAIL = `cut-check-${mail}`;
const emailBase = path.join(repoRoot, "email-base");

function build(category, name) {
  const r = spawnSync(process.execPath, ["tools/build-mail.js", "--category", category, "--mail", name, "--locales", "en"],
    { cwd: emailBase, encoding: "utf8", timeout: 240000 });
  return r.status === 0;
}

function rollback(why) {
  console.error(`\n✗ ${why}`);
  for (const id of plan.created || []) {
    const file = path.join(repoRoot, "data", "block-library", "canonical", `${id}.json`);
    try { rmSync(file, { force: true }); } catch { /* уже нет */ }
  }
  console.error(`откачено блоков: ${(plan.created || []).length}`);
  process.exit(1);
}

/* Сборка проверочной копии из дерева нарезки. */
try {
  composeEmailFromBlocks({ brand: "X_preview", mailName: CHECK_MAIL, blocks: plan.blocks });
} catch (error) {
  rollback(`письмо не собирается из нарезки: ${String(error.message || error).slice(0, 200)}`);
}
if (!build("X_preview", CHECK_MAIL)) rollback("проверочная копия не компилируется");
const originalName = mail.startsWith("mail-") ? mail.slice(5) : mail;
if (!build(brand, originalName)) rollback("оригинал не компилируется — сравнивать не с чем");

const A = path.join(emailBase, "dist", brand, `mail-${originalName}`, "en", "index.html");
const B = path.join(emailBase, "dist", "X_preview", `mail-${CHECK_MAIL}`, "en", "index.html");

const browser = await chromium.launch({ args: ["--no-sandbox"] });
async function shot(file, width) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  // Картинки из сети в песочнице не грузятся; подменяем обеим сборкам одинаково,
  // иначе высота поедет случайным образом и сравнение потеряет смысл.
  await page.route("**/*.{png,jpg,jpeg,gif,webp}", (route) => route.fulfill({
    status: 200, contentType: "image/svg+xml",
    body: `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="300"><rect width="600" height="300" fill="#888"/></svg>`,
  }));
  await page.setContent(readFileSync(file, "utf8"), { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.setViewportSize({ width, height: Math.min(height, 8000) });
  const buffer = await page.screenshot({ fullPage: true });
  await page.close();
  return PNG.sync.read(buffer);
}

let failed = null;
for (const [name, width] of [["desktop", 700], ["mobile", 375]]) {
  const a = await shot(A, width), b = await shot(B, width);
  if (a.width !== b.width || a.height !== b.height) {
    console.log(`${name}: высота ${a.height} против ${b.height}`);
    failed = `${name}: размеры разошлись на ${Math.abs(a.height - b.height)}px`;
    continue;
  }
  const diff = pixelmatch(a.data, b.data, null, a.width, a.height, { threshold: 0.1 });
  console.log(`${name}: ${a.width}x${a.height} · различий ${diff} px`);
  if (diff > 0) failed = `${name}: ${diff} различающихся пикселей`;
}
await browser.close();

if (failed) rollback(failed);

rmSync(path.join(emailBase, "X_preview", `mail-${CHECK_MAIL}`), { recursive: true, force: true });
rmSync(path.join(emailBase, "dist", "X_preview", `mail-${CHECK_MAIL}`), { recursive: true, force: true });
console.log(`\n✓ нарезка ${brand}/${mail} совпадает с оригиналом попиксельно`);
console.log(`  новых блоков в библиотеке: ${(plan.created || []).length}`);
