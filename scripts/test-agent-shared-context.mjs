#!/usr/bin/env node
/**
 * Оператор в конструкторе: знает бренд и каталог, видит результат своей
 * сборки, и ведёт ОДИН разговор с оператором в коде. Zero-AI, без сети.
 */
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";
import { normalizeConstructorCatalog, catalogAllows, describeCatalogForAgent, filterByCatalog } from "../src/constructor-catalog.js";
import { appendTurn, readThread, historyForModel, describeOtherSurface, noteSurface, clearThread, threadForClient } from "../src/agent-thread.js";
import { TOOL_HANDLERS } from "../src/ai-tools.js";
import { listCanonicalBlocks } from "../src/compose-email.js";

const repoRoot = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
let fail = 0, ok = 0;
const check = (name, cond, detail = "") => {
  if (cond) { ok += 1; console.log(`  ✓ ${name}`); }
  else { fail += 1; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
};
const read = (...p) => readFileSync(path.join(repoRoot, ...p), "utf8");

/* 1. Каталог конструктора */
const library = listCanonicalBlocks();
const iqLogo = library.find((b) => b.id === "iq-logo-link");
const brLogo = library.find((b) => b.id === "iqbr-logo");
check("в библиотеке есть логотипы обоих брендов", Boolean(iqLogo && brLogo));
const catalog = normalizeConstructorCatalog({
  brand: { id: "X_IQ", label: "IQ Option", blockTag: "iq", theme: { primary: "#FF7700" } },
  kit: "promo",
  blocks: ["iq-outer-wrapper", "iq-logo-link", "iq-image-link", "iq-footer", "iq-combo-store-footer"]
    .map((id) => library.find((b) => b.id === id)).filter(Boolean)
    .map((b) => ({ id: b.id, source: b.source, label: b.label, placement: b.placement, category: b.category })),
});
check("каталог разобран", catalog && catalog.blocks.length >= 4, JSON.stringify(catalog?.blocks?.length));
check("свой логотип разрешён", catalogAllows(catalog, iqLogo));
check("логотип чужого бренда запрещён", !catalogAllows(catalog, brLogo));
check("без каталога ничего не сужаем", catalogAllows(null, brLogo) && filterByCatalog(null, library).length === library.length);
check("пустой каталог = нет каталога", normalizeConstructorCatalog({ blocks: [] }) === null);
const note = describeCatalogForAgent(catalog);
check("в контексте бренд и набор", /IQ Option/.test(note) && /promo/.test(note), note.slice(0, 120));
check("в контексте список блоков", /iq-logo-link/.test(note) && !/iqbr-logo/.test(note));
check("в контексте цвета бренда", /#FF7700/.test(note));

/* 2. Инструменты слушаются каталога */
{
  const ctx = { surface: "constructor", canvasSummary: [], constructorCatalog: catalog };
  const refused = await TOOL_HANDLERS.add_canvas_block({ blockId: "iqbr-logo" }, ctx);
  check("чужой блок не ставится", refused.code === "BLOCK_NOT_IN_CATALOG", JSON.stringify(refused).slice(0, 160));
  check("и предложены свои похожие", Array.isArray(refused.alternatives) && refused.alternatives.some((a) => a.id === "iq-logo-link"),
    JSON.stringify(refused.alternatives));
  const placed = await TOOL_HANDLERS.add_canvas_block({ blockId: "iq-logo-link" }, ctx);
  check("свой блок ставится", placed.ok === true, JSON.stringify(placed).slice(0, 160));
  const found = await TOOL_HANDLERS.find_blocks_by_look({ query: "логотип", limit: 40 }, ctx);
  const ids = JSON.stringify(found);
  check("поиск ищет только в каталоге", !/iqbr-logo/.test(ids), ids.slice(0, 200));
  const listed = await TOOL_HANDLERS.list_canonical_blocks({}, ctx);
  check("список блоков = каталог", listed.blocks.every((b) => catalogAllows(catalog, b)) && listed.count === catalog.blocks.length,
    `${listed.count} vs ${catalog.blocks.length}`);
  const legacyCtx = { surface: "workbench" };
  const all = await TOOL_HANDLERS.list_canonical_blocks({}, legacyCtx);
  check("без каталога список прежний (canonical)", all.count > catalog.blocks.length);
}

/* 3. Общий разговор */
{
  const root = mkdtempSync(path.join(os.tmpdir(), "retkit-thread-"));
  try {
    const actor = { token: "a".repeat(32) };
    const other = { token: "b".repeat(32) };
    appendTurn(root, actor, { surface: "constructor", user: "Собери письмо: лого, картинка", assistant: "Собрал каркас" });
    appendTurn(root, actor, { surface: "workbench", user: "Поправь отступ", assistant: "" });
    const thread = readThread(root, actor);
    check("реплики обеих поверхностей в одном разговоре", thread.messages.length === 3, JSON.stringify(thread.messages));
    const history = historyForModel(thread);
    check("история помечает, где что сказано", /^\[конструктор\]/.test(history[0].content) && /^\[код\]/.test(history[2].content),
      JSON.stringify(history));
    check("разговоры людей не смешиваются", readThread(root, other).messages.length === 0);
    noteSurface(root, actor, "constructor", { письмо: "welcome-demo", блоков: 7 });
    const told = describeOtherSurface(readThread(root, actor), "workbench");
    check("код знает, что открыто в конструкторе", /конструктор/.test(told) && /welcome-demo/.test(told), told);
    check("для интерфейса — без лишнего", threadForClient(readThread(root, actor)).every((m) => m.role && m.content && m.surface));
    clearThread(root, actor);
    check("очистка стирает разговор", readThread(root, actor).messages.length === 0);
    check("но не записки поверхностей", Boolean(readThread(root, actor).surfaces.constructor));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/* 4. Проводка */
{
  const server = read("server.js");
  check("сервер берёт историю из общего разговора", /history: sharedHistory/.test(server));
  check("сервер пишет ход в общий разговор", /appendTurn\(__dirname, actor/.test(server));
  const routes = read("src", "routes", "agent-thread-routes.js");
  check("есть ручки разговора (в маршрутизаторе)", routes.includes('"/api/studio/agent/thread"') && routes.includes('"/api/studio/agent/thread/clear"') && /registerAgentThreadRoutes\(studioRouter/.test(server));
  check("круг проверки для конструктора", /constructorVerifyMessage/.test(server) && /body\?\.verify === true/.test(server));
  check("конструктору больше шагов", /maxSteps: surface === "constructor" \? 24/.test(server));
  const chat = read("public", "studio-chat.js");
  check("окно подтягивает общий разговор", /loadThread\(\)/.test(chat) && /\/api\/studio\/agent\/thread/.test(chat));
  check("окно умеет круг проверки", /verifyBuild\(report\)/.test(chat) && /verify: true, verifyReport/.test(chat));
  const ctor = read("public", "constructor.js");
  check("конструктор шлёт каталог и бренд", /studio: agentCatalogContext\(\)/.test(ctor));
  check("проверка один раз, не по кругу", /meta\.verifyRound/.test(ctor) && /verifyBuild\(\{ problems: outcome\.problems, live \}\)/.test(ctor));
  check("ждём свежее превью", /await waitForLivePreview\(\)/.test(ctor) && /settleLiveWaiters\(\{\s*ok: true,\s*blocksUsed/.test(ctor));
  const wb = read("public", "workbench.js");
  check("код подтягивает тот же разговор", /loadSharedAgentThread/.test(wb));
  const prompt = read("src", "ai-agent.js");
  check("правила сборки по плану: лого, картинка, белый фон, футер", /BUILDING FROM AN OUTLINE/.test(prompt) && /на белом фоне/.test(prompt) && /store badges \+ socials/.test(prompt));
}

console.log(`\nagent-shared-context: ${ok} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
