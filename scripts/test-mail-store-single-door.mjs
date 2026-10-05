#!/usr/bin/env node
/**
 * test-mail-store-single-door.mjs — храповик на пути к письмам.
 *
 * Задача двери (src/mail-store.js) в том, чтобы путь к письму собирался в
 * ОДНОМ месте. Пока это не так, замок «письмо занято» и личный черновик
 * работают ровно в тех ручках, куда их вписали, а остальные пишут мимо.
 *
 * Переписать сразу шесть десятков мест — верный способ сломать работающую
 * студию. Поэтому здесь храповик: число мест, где путь в базу писем
 * собирают вручную, зафиксировано по файлам и может только УМЕНЬШАТЬСЯ.
 * Новый файл начинает с нуля — то есть новый код обязан ходить через дверь.
 *
 * Когда бюджет доходит до нуля, этап «одна дверь» закрыт, а этот тест
 * превращается в обычный запрет.
 *
 * Как чинить падение:
 *   • стало больше — переведите новое место на src/mail-store.js;
 *   • стало меньше — опустите число в таблице ниже (это хорошая новость).
 *
 * Zero-AI, только чтение исходников. Exit 0 = pass.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import url from "node:url";

const repoRoot = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const check = (name, cond, extra = "") => {
  if (cond) { pass++; console.log("  \x1b[32m✓\x1b[0m", name); }
  else { fail++; console.error(`  \x1b[31m✗ ${name}\x1b[0m ${extra}`); }
};

/**
 * Бюджет ручной сборки путей в базу писем. Цель — нули.
 * Снимок на 14.09.2026, когда дверь только появилась.
 */
const BUDGET = {
  "server.js": 61,
  "src/code-workspace.js": 2,
  "src/style-registry.js": 1,
  "src/placeholders-index.js": 1,
  "src/config.js": 1,
  "src/compose-email.js": 1,
  "src/brands.js": 1,
  "src/blocks-by-mail.js": 1,
};

/** Сама дверь путь собирать обязана — с неё и спроса нет. */
const DOOR = "src/mail-store.js";

/** Ручная сборка пути в базу писем. */
const HANDMADE_PATH = /path\.join\([^)]*(emailBaseRoot|"email-base")[^)]*/g;

function countHandmade(relative) {
  const file = path.join(repoRoot, relative);
  if (!existsSync(file)) return 0;
  return (readFileSync(file, "utf8").match(HANDMADE_PATH) || []).length;
}

function sourceFiles() {
  const files = ["server.js"];
  for (const name of readdirSync(path.join(repoRoot, "src"))) {
    if (name.endsWith(".js")) files.push(`src/${name}`);
  }
  return files;
}

/* ─── 1. Дверь на месте ──────────────────────────────────────────────────── */
{
  const door = readFileSync(path.join(repoRoot, DOOR), "utf8");
  for (const fn of ["mailPaths", "assertMailWritable", "writeMailFile", "createMail",
                    "copyMail", "renameMail", "trashMail", "setMailWriteGuard"]) {
    check(`дверь умеет ${fn}`, door.includes(`export function ${fn}`) || door.includes(`export async function ${fn}`));
  }
  check("проверку прав можно подменить — сюда встанут замки", /let writeGuard/.test(door));
}

/* ─── 2. Храповик ────────────────────────────────────────────────────────── */
{
  let total = 0;
  for (const relative of sourceFiles()) {
    if (relative === DOOR) continue;
    const found = countHandmade(relative);
    total += found;
    const allowed = BUDGET[relative] ?? 0;
    if (!found && !allowed) continue;
    check(
      `${relative}: ручных путей ${found} при бюджете ${allowed}`,
      found <= allowed,
      found > allowed
        ? "стало больше — переведите новое место на src/mail-store.js"
        : "",
    );
    if (found < allowed) {
      console.log(`    \x1b[36m↓ бюджет можно опустить до ${found}\x1b[0m`);
    }
  }
  console.log(`  всего ручных путей вне двери: ${total} (цель — 0)`);
  check("бюджет не раздут сверх снимка", total <= Object.values(BUDGET).reduce((a, b) => a + b, 0));
}

/* ─── 3. Новый код обязан ходить через дверь ─────────────────────────────── */
{
  const unknown = sourceFiles().filter((relative) =>
    relative !== DOOR && !(relative in BUDGET) && countHandmade(relative) > 0);
  check(
    "нет новых файлов, собирающих путь к письму вручную",
    unknown.length === 0,
    unknown.join(", "),
  );
}

/* ─── 4. Уже переведённые ручки не откатываются ──────────────────────────── */
{
  const server = readFileSync(path.join(repoRoot, "server.js"), "utf8");
  const migrated = [
    ["email-clone", "copyMail"],
    ["email-rename", "renameMail"],
    ["email-delete", "trashMail"],
    ["email-import", "createMail"],
  ];
  for (const [endpoint, fn] of migrated) {
    check(`${endpoint} по-прежнему ходит через дверь`,
      new RegExp(`${endpoint}[\\s\\S]{0,1600}await ${fn}\\(__dirname`).test(server));
  }
  check("самодельной санитизации имён в ручках не осталось",
    !/const safe = s => s\.replace/.test(server));
}

console.log(`\nmail-store-single-door: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
