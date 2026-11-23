/**
 * src/app-version.js — какая версия студии запущена и где (Heroku или своя машина).
 *
 * Зачем: одна и та же студия бывает открыта на Heroku и на localhost, и по
 * поведению не понять, где старый код. Показываем рядом с логотипом RetKit:
 * версия из package.json, сборка (BUILD_ID — отпечаток фронта, совпадает у
 * одинакового кода) и коммит, если он известен.
 */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BUILD_ID } from "./build-id.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function packageVersion() {
  try { return JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).version || "0.0.0"; } catch { return "0.0.0"; }
}

function commitId() {
  const fromEnv = process.env.SOURCE_VERSION || process.env.HEROKU_SLUG_COMMIT || "";
  if (fromEnv) return fromEnv.slice(0, 7);
  try {
    return execFileSync("git", ["rev-parse", "--short=7", "HEAD"], { cwd: root, stdio: ["ignore", "pipe", "ignore"], timeout: 2000 }).toString().trim();
  } catch { return ""; }
}

export const APP_VERSION = Object.freeze({
  version: packageVersion(),
  build: BUILD_ID.slice(0, 7),
  commit: commitId(),
  env: process.env.DYNO ? "heroku" : "local",
  startedAt: new Date().toISOString(),
});
