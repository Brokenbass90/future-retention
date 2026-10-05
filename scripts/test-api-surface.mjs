#!/usr/bin/env node
/**
 * test-api-surface.mjs — храповик на поверхность API.
 *
 * Ручка, которую никто не зовёт, не бесплатна. Она живёт в коде, ломается при
 * рефакторинге, тянет за собой модули, которые иначе можно было бы удалить, и
 * попадает в глаза агенту как рабочая возможность — а потом он идёт ею
 * пользоваться и получает неожиданное. Двадцать пять таких накопились молча.
 *
 * Здесь их число зафиксировано и может только УМЕНЬШАТЬСЯ. Новая ручка без
 * вызывающего валит проверку сразу: её либо подключают к интерфейсу, либо не
 * добавляют вовсе.
 *
 * Считается по фактам: есть в коде студии строка с этим путём или нет.
 * Упоминания в старых отчётах (docs/) вызовом не считаются — иначе любая
 * заметка воскрешала бы мёртвую ручку.
 *
 * Zero-AI, только чтение исходников. Exit 0 = pass.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import url from "node:url";

const repoRoot = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const check = (name, cond, extra = "") => {
  if (cond) { pass++; console.log("  \x1b[32m✓\x1b[0m", name); }
  else { fail++; console.error(`  \x1b[31m✗ ${name}\x1b[0m ${extra}`); }
};

/**
 * Сколько ручек позволено иметь без вызывающего. Снимок после чистки
 * 14.09.2026: было 25, стало 0. Цель — держать ноль.
 */
const ALLOWED_UNUSED = 0;

const read = (file) => { try { return readFileSync(file, "utf8"); } catch { return ""; } };
const filesIn = (dir, pattern) => {
  const full = path.join(repoRoot, dir);
  if (!existsSync(full)) return [];
  return readdirSync(full).filter((name) => pattern.test(name)).map((name) => path.join(full, name));
};

const server = read(path.join(repoRoot, "server.js"));
const routes = new Set();
for (const match of server.matchAll(/["'`](\/api\/[a-z0-9/_-]+)["'`]/gi)) routes.add(match[1]);

// Кто может звать ручку: интерфейс, страницы, MCP-сервер, тесты, скрипты,
// плагин Figma и вспомогательные инструменты.
const callerText = [
  ...filesIn("public", /\.(js|html)$/),
  ...filesIn("src", /\.js$/),
  ...filesIn("scripts", /\.mjs$/),
  ...filesIn("mcp", /\.mjs$/),
  ...filesIn("figma-plugin", /\.(js|html)$/),
  ...filesIn("tools", /\.js$/),
  ...filesIn("email-base/tools", /\.js$/),
].map(read).join("\n");

const unused = [...routes].sort().filter((route) => {
  if (callerText.includes(route)) return false;
  const prefix = route.replace(/\/$/, "");
  return !callerText.includes(`${prefix}/`) && !callerText.includes(`${prefix}?`);
});

console.log(`  ручек всего: ${routes.size}, без вызывающего: ${unused.length} (бюджет ${ALLOWED_UNUSED})`);
check(
  "новых ручек без вызывающего не появилось",
  unused.length <= ALLOWED_UNUSED,
  unused.length ? `никто не зовёт: ${unused.join(", ")} — подключите к интерфейсу или не добавляйте` : "",
);
if (unused.length < ALLOWED_UNUSED) {
  console.log(`    \x1b[36m↓ бюджет можно опустить до ${unused.length}\x1b[0m`);
}

/* ─── Убранное не должно вернуться тихо ──────────────────────────────────── */
{
  // Эти ручки сняты осознанно: их не звал никто, а часть тянула за собой
  // целые модули и фоновый воркер. Если они понадобятся снова — это
  // отдельное решение, а не случайный возврат при слиянии веток.
  const removed = [
    "/api/wb/ai/agent-legacy",
    "/api/deepl/translate",
    "/api/eval/score",
    "/api/batch/queue",
    "/api/scenarios/save",
    "/api/email-base/patch-theme",
    "/api/layout-model/inspect",
    "/api/wb/html-to-pug",
  ];
  const back = removed.filter((route) => server.includes(`"${route}"`));
  check("снятые ручки не вернулись", back.length === 0, back.join(", "));

  // Студия не должна обещать то, чего нет: план подключения Figma рекламировал
  // ручку контракта, которой больше нет, — плагин пошёл бы по ней и получил 404.
  check("студия не рекламирует несуществующие ручки",
    !server.includes('contractEndpoint: "/api/figma/contract"'));

  // Воркер очереди опрашивал очередь, наполнить которую стало нечем.
  check("фоновый воркер пустой очереди убран", !/startWorker\(/.test(server));
  check("и его модуль больше не импортируется", !/from "\.\/src\/batch\.js"/.test(server));
}

/* ─── Осиротевшие модули названы, а не забыты ────────────────────────────── */
{
  // Удалять их сейчас не обязательно — они инертны. Но знать о них надо, иначе
  // через полгода никто не вспомнит, почему они лежат.
  // src/scenarios.js в список не входит: его импортирует scripts/studio-benchmark.mjs.
  // Проверять надо по факту, а не по памяти — на этом список уже ошибся один раз.
  const orphans = ["src/batch.js", "src/figma-contract.js"]
    .filter((file) => existsSync(path.join(repoRoot, file)));
  const importers = orphans.filter((file) => {
    const stem = path.basename(file, ".js");
    const pattern = new RegExp(`from\\s+["'][^"']*${stem}\\.js["']`);
    return [server, callerText].some((text) => pattern.test(text));
  });
  check("осиротевшие модули действительно никем не импортируются",
    importers.length === 0, importers.join(", "));
  if (orphans.length) console.log(`    (лежат без дела: ${orphans.join(", ")} — удалить можно отдельным решением)`);
}

console.log(`\napi-surface: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
