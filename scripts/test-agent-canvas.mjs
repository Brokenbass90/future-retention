#!/usr/bin/env node
/**
 * test-agent-canvas.mjs — оператор владеет канвасом конструктора целиком.
 *
 * Человек сказал «удали всё, соберём заново». Агент пять раз позвал
 * remove_block — инструмент, который правит HTML открытого письма по якорю, —
 * ничего не удалил и попросил человека «указать уникальный фрагмент HTML
 * каждого блока». Это провал не модели, а набора инструментов: на канвасе у
 * агента была одна-единственная дверь — правка слотов уже стоящего блока.
 * Удалить, добавить, переставить, очистить он не мог физически.
 *
 * Здесь стережём четыре свойства нового набора:
 *   1. Инструменты есть и делают ровно то, что обещают.
 *   2. Очистка письма требует явного подтверждения: «удали всё» — это слова
 *      человека, а не догадка агента.
 *   3. Блок, поставленный на канвас, получает uid СРАЗУ: без этого агент не
 *      может в том же заходе заменить в нём образцовый текст — а именно из-за
 *      образцового текста письмо и уезжало недоделанным.
 *   4. Браузер применяет пакет целиком или не применяет вовсе, и одна отмена
 *      возвращает всё: человек говорил одну фразу.
 *
 * Zero-AI, без сети. Exit 0 = pass.
 */
import { readFileSync } from "node:fs";
import vm from "node:vm";
import path from "node:path";
import url from "node:url";
import { TOOL_DEFINITIONS, TOOL_HANDLERS, mergeCanvasOps } from "../src/ai-tools.js";
import "../public/canvas-slot-values.js";

const canvasSlotValues = globalThis.RetkitCanvasSlots;

const repoRoot = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const check = (name, cond, extra = "") => {
  if (cond) { pass++; console.log("  \x1b[32m✓\x1b[0m", name); }
  else { fail++; console.error(`  \x1b[31m✗ ${name}\x1b[0m ${extra}`); }
};
const read = (...parts) => readFileSync(path.join(repoRoot, ...parts), "utf8");

const canvasCtx = (canvas = []) => ({ surface: "constructor", canvasSummary: canvas, canvasOps: [] });
const entry = (uid, blockId, parentUid = null, slots = {}) => ({
  uid, blockId, parentUid, slotId: parentUid == null ? "root" : "content", slots, slotSchema: [],
});

/* ─── 1. Дерево целиком, а не только правка слотов ───────────────────────── */
{
  const names = new Set(TOOL_DEFINITIONS.map((tool) => tool.name));
  for (const name of ["add_canvas_block", "remove_canvas_block", "move_canvas_block", "clear_canvas"]) {
    check(`инструмент есть: ${name}`, names.has(name) && typeof TOOL_HANDLERS[name] === "function");
  }
}

/* ─── 2. Удаление уносит вложенное ───────────────────────────────────────── */
{
  const ctx = canvasCtx([
    entry(1, "sys-outer"),
    entry(2, "sys-section", 1),
    entry(3, "sys-button", 2),
    entry(4, "sys-note", 2),
    entry(5, "sys-footer", 1),
  ]);
  const result = await TOOL_HANDLERS.remove_canvas_block({ uid: 2, reason: "секция не нужна" }, ctx);
  check("секция удалена", result.ok === true);
  check("вместе с содержимым", result.removed.sort().join(",") === "2,3,4", JSON.stringify(result.removed));
  check("соседи целы", ctx.canvasSummary.map((e) => e.uid).join(",") === "1,5");
  check("операция ушла в браузер", ctx.canvasOps.length === 1 && ctx.canvasOps[0].kind === "remove");
  check("сводка и операции сходятся", mergeCanvasOps(ctx).map((e) => e.uid).join(",") === "1,5");

  const missing = await TOOL_HANDLERS.remove_canvas_block({ uid: 99 }, ctx);
  check("несуществующий блок — честная ошибка", Boolean(missing.error) && Array.isArray(missing.availableUids));
  check("и лишней операции не появилось", ctx.canvasOps.length === 1);
}

/* ─── 3. Очистка письма — только по слову человека ───────────────────────── */
{
  const ctx = canvasCtx([entry(1, "sys-outer"), entry(2, "sys-footer", 1)]);
  const guessed = await TOOL_HANDLERS.clear_canvas({ reason: "решил пересобрать" }, ctx);
  check("без подтверждения письмо не стирается", guessed.code === "CONFIRM_REQUIRED");
  check("и канвас не тронут", ctx.canvasSummary.length === 2 && ctx.canvasOps.length === 0);

  const asked = await TOOL_HANDLERS.clear_canvas({ confirm: true, reason: "человек просил собрать заново" }, ctx);
  check("по подтверждению — стирается", asked.ok === true && asked.removed === 2);
  check("канвас пуст", ctx.canvasSummary.length === 0);
  check("и это одна операция, а не два удаления", ctx.canvasOps.length === 1 && ctx.canvasOps[0].kind === "clear");
}

/* ─── 4. Поставил блок — сразу можешь его заполнить ──────────────────────── */
{
  const ctx = canvasCtx([]);
  const added = await TOOL_HANDLERS.add_canvas_block({ blockId: "sys-button", reason: "нужна кнопка" }, ctx);
  check("блок поставлен", added.ok === true && added.blockId === "sys-button");
  check("uid выдан сразу", Boolean(added.uid));
  check("вместе с образцовыми значениями", typeof added.slots?.label === "string" && added.slots.label.length > 0);

  // Ради этого всё и делалось: «собери заново» — это поставить и тут же
  // заполнить, в одном заходе, а не оставить человеку образцовый текст.
  const filled = await TOOL_HANDLERS.update_canvas_block(
    { uid: added.uid, slots: { label: "Забрать бонус" }, reason: "текст от человека" }, ctx);
  check("и заполнить его в том же заходе", filled.ok === true);
  check("значение доехало до сводки",
    mergeCanvasOps(ctx).find((e) => String(e.uid) === String(added.uid))?.slots.label === "Забрать бонус");

  const unknown = await TOOL_HANDLERS.add_canvas_block({ blockId: "sys-nope" }, ctx);
  check("выдуманный блок — отказ", unknown.code === "UNKNOWN_BLOCK");

  const badSlot = await TOOL_HANDLERS.add_canvas_block({ blockId: "sys-button", slots: { label: "две\nстроки" } }, ctx);
  check("однострочный слот проверяется на входе", badSlot.code === "INVALID_CANVAS_SLOT_VALUE");
}

/* ─── 4б. Комбо разворачивается в блоки, у каждого свой uid ──────────────── */
{
  const ctx = canvasCtx([]);
  const combo = await TOOL_HANDLERS.add_canvas_block({ blockId: "iq-combo-card-cta" }, ctx);
  check("комбо принимается", combo.ok === true && combo.combo === true);
  check("и раскладывается на блоки", Array.isArray(combo.blocks) && combo.blocks.length > 1,
    JSON.stringify(combo.blocks || []));
  check("у каждого блока комбо свой uid",
    new Set((combo.blocks || []).map((b) => b.uid)).size === (combo.blocks || []).length);
  check("браузеру передан порядок детей рецепта",
    Array.isArray(ctx.canvasOps[0].childTempUids) && ctx.canvasOps[0].childTempUids.length >= combo.blocks.length);
}

/* ─── 5. Перестановка — только среди соседей ─────────────────────────────── */
{
  const ctx = canvasCtx([
    entry(1, "sys-outer"),
    entry(2, "sys-section", 1),
    entry(3, "sys-footer", 1),
  ]);
  ctx.canvasSummary[1].slotId = "sections";
  ctx.canvasSummary[2].slotId = "sections";
  const moved = await TOOL_HANDLERS.move_canvas_block({ uid: 3, direction: "up" }, ctx);
  check("блок поднят", moved.ok === true && String(moved.swappedWith) === "2");
  check("порядок в сводке обновился сразу", ctx.canvasSummary.map((e) => e.uid).join(",") === "1,3,2");

  const edge = await TOOL_HANDLERS.move_canvas_block({ uid: 3, direction: "up" }, ctx);
  check("выше первого — отказ с подсказкой", edge.code === "CANVAS_EDGE" && /remove_canvas_block/.test(edge.hint));
  check("порядок не испортился", ctx.canvasSummary.map((e) => e.uid).join(",") === "1,3,2");
  check("перестановка не двоится при пересчёте",
    mergeCanvasOps(ctx).map((e) => e.uid).join(",") === "1,3,2");
}

/* ─── 6. Браузер применяет пакет целиком и откатывает целиком ────────────── */
{
  const ui = read("public", "constructor.js");
  check("браузер различает виды операций", /const kind = String\(op\?\.kind \|\| "update"\)/.test(ui));
  for (const kind of ["clear", "remove", "move", "add"]) {
    check(`браузер умеет: ${kind}`, new RegExp(`kind === "${kind}"`).test(ui));
  }
  check("временный uid связывается с настоящим", /tempUids\.set\(String\(op\.tempUid\), created\.uid\)/.test(ui));
  check("дети комбо — тоже", /op\?\.childTempUids/.test(ui));
  // Половина выполненной просьбы хуже невыполненной: человек не видит, где
  // сборка оборвалась, и продолжает работать с наполовину собранным письмом.
  check("на первой же неудаче пакет откатывается", /state\.canvas = JSON\.parse\(before\)/.test(ui));
  check("одна отмена на весь пакет", /_canvasUndo\.length = undoDepth/.test(ui));
  check("и человеку сказано, что Ctrl+Z отменит всё разом", /Ctrl\+Z отменит всё разом/.test(ui));
  check("окна с вопросом посреди пакета не всплывают", /quiet: true/.test(ui));
}

/* ─── 6б. Пакет проверяется на настоящем коде конструктора ───────────────── */
{
  // Браузерный слой проверяем тем же способом, что и буфер блоков: тащим
  // функции по имени в vm-песочницу и подсовываем синтетический канвас.
  // Регулярка в тесте стережёт слова; здесь стережём поведение.
  const src = read("public", "constructor.js");
  const extractFn = (name) => {
    const startRe = new RegExp(`(?:^|\\n)function ${name}\\s*\\(`);
    const m = startRe.exec(src);
    if (!m) throw new Error(`функция не найдена в constructor.js: ${name}`);
    const start = m.index === 0 ? 0 : m.index + 1;
    const endRe = /\n\}/g;
    endRe.lastIndex = start;
    const e = endRe.exec(src);
    if (!e) throw new Error(`не найден конец функции: ${name}`);
    return src.slice(start, e.index + 2);
  };

  const sandbox = {
    console: { warn: (...args) => sandbox._warnings.push(args.join(" ")), log: () => {} },
    JSON,
    document: { getElementById: () => null, querySelectorAll: () => [], querySelector: () => null },
    globalThis: { RetkitCanvasSlots: canvasSlotValues },
    alert: (text) => { sandbox._alerts.push(text); },
    _warnings: [], _alerts: [], _hints: [],
    renderCanvas() {}, renderInspector() {}, syncPaletteToSelection() {},
    scheduleLivePreview() {}, maybeOpenInnerCatalog() {}, applyIframeSelection() {},
    flashCanvasHint(text) { sandbox._hints.push(text); },
  };
  vm.createContext(sandbox);
  vm.runInContext([
    extractFn("sameUid"),
    extractFn("blockById"),
    extractFn("blockForEntry"),
    extractFn("entryByUid"),
    extractFn("placementOf"),
    extractFn("isInnerBlock"),
    extractFn("childSlotsFor"),
    extractFn("slotAcceptsBlock"),
    extractFn("chooseChildSlot"),
    extractFn("childrenOf"),
    extractFn("descendantUids"),
    extractFn("rootOuterEntry"),
    extractFn("latestSectionEntry"),
    extractFn("markEntrySlotExplicit"),
    extractFn("createEntry"),
    extractFn("defaultSlotsFor"),
    extractFn("insertEntryAfterSiblings"),
    extractFn("moveSubtreeBefore"),
    extractFn("rebuildCanvasOrder"),
    extractFn("normalizeCanvasOrder"),
    extractFn("removeFromCanvas"),
    extractFn("moveInCanvas"),
    extractFn("addToCanvas"),
    extractFn("instantiateCombo"),
    extractFn("ensureOuterForMutation"),
    extractFn("finishCanvasMutation"),
    extractFn("applyAgentCanvasOps"),
    "function nextUid() { return state._uidCounter++; }",
    "function findDefaultBlock(placement) { return state.library.find((b) => placementOf(b) === placement) || null; }",
    "function slotPresetAssignments() { return null; }",
    "let _canvasUndo = [];",
    "function pushCanvasUndo() { _canvasUndo.push(JSON.stringify(state.canvas)); }",
    "function undoCanvas() { state.canvas = JSON.parse(_canvasUndo.pop()); }",
  ].join("\n\n"), sandbox);

  const LIBRARY = [
    { id: "wrap", label: "Обёртка", placement: "outer", source: "canonical", slots: [],
      childSlots: [{ id: "sections", marker: "SECTION_BLOCKS", accepts: ["section", "both"] }] },
    { id: "sec", label: "Секция", placement: "section", source: "canonical", slots: [],
      childSlots: [{ id: "content", marker: "INNER_BLOCKS", accepts: ["inner", "inline", "both"] }] },
    { id: "txt", label: "Текст", placement: "inner", source: "canonical",
      slots: [{ id: "title", kind: "text", default: "Заголовок письма" }] },
    { id: "btn", label: "Кнопка", placement: "inner", source: "canonical",
      slots: [{ id: "label", kind: "text", default: "Перейти" }] },
  ];
  const reset = () => {
    sandbox.state = {
      _uidCounter: 100,
      selectedUid: null,
      autoPalette: false,
      library: LIBRARY,
      canvas: [
        { uid: 1, blockId: "wrap", parentUid: null, slotId: "root", slots: {} },
        { uid: 2, blockId: "sec", parentUid: 1, slotId: "sections", slots: {} },
        { uid: 3, blockId: "txt", parentUid: 2, slotId: "content", slots: { title: "ПЕРВЫЙ" } },
        { uid: 4, blockId: "btn", parentUid: 2, slotId: "content", slots: { label: "ВТОРАЯ" } },
      ],
    };
    sandbox._hints = []; sandbox._warnings = []; sandbox._alerts = [];
    vm.runInContext("_canvasUndo = [];", sandbox);
  };
  const apply = (ops) => {
    sandbox._ops = ops;
    vm.runInContext("applyAgentCanvasOps(_ops)", sandbox);
    return sandbox.state.canvas;
  };
  const undoDepth = () => vm.runInContext("_canvasUndo.length", sandbox);
  const why = () => `${sandbox._hints.join(" | ")} ${sandbox._warnings.join(" | ")}`;
  const uids = () => sandbox.state.canvas.map((e) => e.uid).join(",");

  // Ровно та просьба, на которой агент сломался: «удали всё, соберём заново».
  reset();
  apply([
    { kind: "clear" },
    { kind: "add", blockId: "sec", tempUid: "new-1" },
    { kind: "add", blockId: "txt", tempUid: "new-2" },
    { kind: "update", uid: "new-2", slots: { title: "Ваш бонус начислен" } },
  ]);
  const built = sandbox.state.canvas;
  check("«удали всё и собери заново» проходит целиком", built.length >= 3, `${uids()} :: ${why()}`);
  check("обёртка достроена сама", built.some((e) => e.blockId === "wrap" && e.parentUid == null));
  check("старых блоков не осталось", !built.some((e) => [3, 4].includes(e.uid)));
  check("текст агента доехал до нового блока",
    built.some((e) => e.blockId === "txt" && e.slots.title === "Ваш бонус начислен"),
    JSON.stringify(built.map((e) => e.slots)));
  check("на всю сборку — одна отмена", undoDepth() === 1, String(undoDepth()));
  vm.runInContext("undoCanvas()", sandbox);
  check("и она возвращает письмо целиком", uids() === "1,2,3,4", uids());

  // Удаление секции уносит вложенное — то, чего агент не мог сделать вовсе.
  reset();
  apply([{ kind: "remove", uid: 2 }]);
  check("удаление секции уносит вложенное", uids() === "1", uids());

  reset();
  apply([{ kind: "move", uid: 4, direction: "up" }]);
  check("перестановка меняет порядок соседей",
    sandbox.state.canvas.filter((e) => e.parentUid === 2).map((e) => e.uid).join(",") === "4,3");

  // Невыполнимая операция посреди пакета: письмо должно остаться прежним.
  reset();
  apply([
    { kind: "update", uid: 3, slots: { title: "НОВЫЙ" } },
    { kind: "remove", uid: 777 },
  ]);
  check("неудача в середине откатывает весь пакет",
    sandbox.state.canvas.find((e) => e.uid === 3).slots.title === "ПЕРВЫЙ");
  check("и в стек отмены ничего не кладётся", undoDepth() === 0, String(undoDepth()));
  check("человеку сказано, почему не применилось",
    sandbox._hints.some((text) => /не применил правку/.test(text)), sandbox._hints.join(" | "));

  // Блока нет в каталоге режима — это отказ, а не молчаливый пропуск.
  reset();
  apply([{ kind: "add", blockId: "no-such-block" }]);
  check("неизвестный блок не ломает канвас", uids() === "1,2,3,4");
  check("и окно с вопросом не всплывает", sandbox._alerts.length === 0, sandbox._alerts.join(" | "));
}

/* ─── 7. Промпт не отправляет агента не в ту дверь ───────────────────────── */
{
  const agent = read("src", "ai-agent.js");
  check("на конструкторе remove_block запрещён прямо",
    /NEVER use remove_block \/ insert_block on the constructor/.test(agent));
  check("и сказано, почему просить у человека фрагмент HTML — провал",
    /failing at your own job/.test(agent));
  check("«удали всё и собери заново» описано как одна работа",
    /clear_canvas, then add_canvas_block/.test(agent));
  check("новые инструменты перечислены в каталоге промпта",
    /add_canvas_block, remove_canvas_block, move_canvas_block/.test(agent));

  const routes = read("src", "routes", "agent-routes.js");
  for (const name of ["add_canvas_block", "remove_canvas_block", "move_canvas_block", "clear_canvas"]) {
    check(`наружу не выпускается: ${name}`, new RegExp(`"${name}"`).test(routes.split("BROWSER_ONLY")[1] || ""));
  }
}

console.log(`\nagent-canvas: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
