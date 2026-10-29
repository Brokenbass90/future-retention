/**
 * src/preview-autorender.js — превью каталога перерисовываются сами.
 *
 * Раньше картинки каталога обновлялись только руками: `npm run previews`.
 * Теперь студия делает это сама — фоном, по одному прогону за раз:
 *   - при запуске студии: инкрементальный прогон (рисует только изменённое);
 *   - после сохранения блока: прогон только этого блока.
 * После каждого прогона пересчитываются одинаковые плитки (group-block-duplicates).
 *
 * Нужен браузер: Chrome на маке или chromium из playwright-core. На Heroku
 * (DYNO) и без браузера ничего не запускается — каталог показывает то, что
 * лежит в data/block-previews. Выключить: RETKIT_AUTO_PREVIEWS=0.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync } from "node:fs";
import path from "node:path";

const MAC_CHROME = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
];

async function browserAvailable() {
  if (process.platform === "darwin" && MAC_CHROME.some((p) => existsSync(p))) return true;
  try {
    const { chromium } = await import("playwright-core");
    const bundled = chromium.executablePath();
    return Boolean(bundled && existsSync(bundled));
  } catch {
    return false;
  }
}

export function createPreviewAutoRender({ repoRoot, nodeBinary = process.execPath, log = console } = {}) {
  const disabled = process.env.RETKIT_AUTO_PREVIEWS === "0" || Boolean(process.env.DYNO);
  let available = null;          // null — ещё не проверяли
  let running = false;
  let pendingFull = false;
  const pendingOnly = new Set();
  const logDir = path.join(repoRoot, "data", "block-previews");

  function run(args) {
    return new Promise((resolve) => {
      mkdirSync(logDir, { recursive: true });
      const out = openSync(path.join(logDir, ".autorender.log"), "a");
      const child = spawn(nodeBinary, args, { cwd: repoRoot, stdio: ["ignore", out, out] });
      child.on("close", (code) => resolve(code));
      child.on("error", () => resolve(1));
    });
  }

  async function drain() {
    if (running) return;
    running = true;
    try {
      while (pendingFull || pendingOnly.size) {
        const args = ["scripts/render-block-previews.mjs"];
        if (pendingFull) {
          pendingFull = false;
          pendingOnly.clear();
        } else {
          const [id] = pendingOnly;
          pendingOnly.delete(id);
          args.push("--only", id);
        }
        const code = await run(args);
        if (code === 0) await run(["scripts/group-block-duplicates.mjs"]);
        else log.warn?.(`[previews] автоперерисовка завершилась с кодом ${code} — см. data/block-previews/.autorender.log`);
      }
    } finally {
      running = false;
    }
  }

  async function schedule(only = "") {
    if (disabled) return false;
    if (available === null) available = await browserAvailable();
    if (!available) return false;
    if (only) pendingOnly.add(String(only));
    else pendingFull = true;
    drain();
    return true;
  }

  return { schedule, get running() { return running; } };
}
