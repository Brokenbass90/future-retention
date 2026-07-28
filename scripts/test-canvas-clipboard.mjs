#!/usr/bin/env node
/**
 * scripts/test-canvas-clipboard.mjs — буфер блоков конструктора.
 *
 * Копирование/вставка живут в браузерном public/constructor.js, поэтому,
 * как и в других тестах браузерного слоя, вытаскиваем функции по имени
 * в vm-песочницу и подсовываем им синтетический канвас. Это позволяет
 * проверить логику дерева без запуска браузера.
 *
 * Что важно не сломать:
 *   - копируется ВСЁ поддерево, а не один узел (иначе комбо и секции
 *     вставляются пустыми);
 *   - у вставленных блоков СВЕЖИЕ uid — два экземпляра не должны делить
 *     идентификатор, иначе выделение и удаление начнут бить не туда;
 *   - вставка соседом сохраняет порядок: копия встаёт сразу за оригиналом;
 *   - «вставить внутрь» уважает совместимость слотов;
 *   - буфер переживает удаление оригинала (вырезание).
 *
 * Zero-AI, без сети. Exit 0 = pass.
 */
import { readFileSync } from "node:fs";
import vm from "node:vm";
import path from "node:path";
import url from "node:url";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const REPO = path.resolve(here, "..");
const src = readFileSync(path.join(REPO, "public", "constructor.js"), "utf8");

let pass = 0, fail = 0;
const check = (name, cond, extra = "") => {
  if (cond) { pass++; console.log("  \x1b[32m✓\x1b[0m", name); }
  else { fail++; console.error(`  \x1b[31m✗ ${name}\x1b[0m ${extra}`); }
};

/** Функции верхнего уровня в constructor.js начинаются с колонки 0 и
 *  заканчиваются одиночной `}` в колонке 0 — как и в workbench.js. */
function extractFn(name) {
  const startRe = new RegExp(`(?:^|\\n)function ${name}\\s*\\(`);
  const m = startRe.exec(src);
  if (!m) throw new Error(`функция не найдена в constructor.js: ${name}`);
  const start = m.index === 0 ? 0 : m.index + 1;
  const endRe = /\n\}/g;
  endRe.lastIndex = start;
  const e = endRe.exec(src);
  if (!e) throw new Error(`не найден конец функции: ${name}`);
  return src.slice(start, e.index + 2);
}

/* ─── Песочница: настоящие функции дерева + заглушки на UI ───────────────── */
const sandbox = {
  console,
  localStorage: {
    _v: new Map(),
    getItem(k) { return this._v.has(k) ? this._v.get(k) : null; },
    setItem(k, v) { this._v.set(k, String(v)); },
  },
  document: { querySelectorAll: () => [], querySelector: () => null, getElementById: () => null },
  JSON,
  // UI-побочки нам не нужны, но вызываются из проверяемого кода.
  renderCanvas() {}, renderInspector() {}, syncPaletteToSelection() {},
  scheduleLivePreview() {}, maybeOpenInnerCatalog() {}, applyIframeSelection() {},
  flashCanvasHint(text) { sandbox._hints.push(text); },
  updateClipboardAffordances() {},
  _hints: [],
  _canvasUndo: [],
  pushCanvasUndo() { sandbox._canvasUndo.push(JSON.stringify(sandbox.state.canvas)); },
};
vm.createContext(sandbox);

const code = [
  extractFn("sameUid"),
  extractFn("blockById"),
  extractFn("blockForEntry"),
  extractFn("entryByUid"),
  extractFn("placementOf"),
  extractFn("childSlotsFor"),
  extractFn("slotAcceptsBlock"),
  extractFn("chooseChildSlot"),
  extractFn("childrenOf"),
  extractFn("descendantUids"),
  extractFn("createEntry"),
  extractFn("defaultSlotsFor"),
  extractFn("rebuildCanvasOrder"),
  extractFn("normalizeCanvasOrder"),
  extractFn("removeFromCanvas"),
  extractFn("finishCanvasMutation"),
  extractFn("serializeSubtree"),
  extractFn("instantiateClipboard"),
  extractFn("copyBlock"),
  extractFn("cutBlock"),
  extractFn("pasteBlock"),
  extractFn("duplicateBlock"),
  extractFn("readBlockClipboard"),
  extractFn("writeBlockClipboard"),
  "function nextUid() { return state._uidCounter++; }",
  "function ensureOuterForMutation() { return state.canvas.find((e) => e.parentUid == null) || null; }",
  "const BLOCK_CLIPBOARD_KEY = 'retkit.blockClipboard.v1';",
  "let _blockClipboard = null;",
].join("\n\n");
vm.runInContext(code, sandbox);

/* ─── Фикстура: обёртка → секция → два внутренних блока ──────────────────── */
const LIBRARY = [
  { id: "wrap", label: "Обёртка", placement: "outer", source: "canonical", slots: [],
    childSlots: [{ id: "sections", marker: "SECTION_BLOCKS", accepts: ["section", "both"] }] },
  { id: "sec", label: "Секция", placement: "section", source: "canonical", slots: [],
    childSlots: [{ id: "content", marker: "INNER_BLOCKS", accepts: ["inner", "inline", "both"] }] },
  { id: "txt", label: "Текст", placement: "inner", source: "canonical",
    slots: [{ id: "title", kind: "text", default: "Заголовок" }] },
];

function resetCanvas() {
  sandbox.state = {
    _uidCounter: 100,
    selectedUid: null,
    library: LIBRARY,
    canvas: [
      { uid: 1, blockId: "wrap", parentUid: null, slotId: "root", slots: {} },
      { uid: 2, blockId: "sec", parentUid: 1, slotId: "sections", slots: {} },
      { uid: 3, blockId: "txt", parentUid: 2, slotId: "content", slots: { title: "ПЕРВЫЙ" } },
      { uid: 4, blockId: "txt", parentUid: 2, slotId: "content", slots: { title: "ВТОРОЙ" } },
    ],
  };
  sandbox._hints = [];
  sandbox._canvasUndo = [];
  vm.runInContext("_blockClipboard = null;", sandbox);
  sandbox.localStorage._v.clear();
}
const run = (expr) => vm.runInContext(expr, sandbox);

/* ─── 1. Копирование забирает поддерево целиком ──────────────────────────── */
resetCanvas();
run("copyBlock(2)");
{
  const clip = run("readBlockClipboard()");
  check("буфер содержит секцию и оба вложенных блока", clip.entries.length === 3, `entries=${clip.entries?.length}`);
  check("корень буфера — секция", clip.entries[0].blockId === "sec");
  check("корень отвязан от прежнего родителя", clip.entries[0].parentUid === null);
  check("значения слотов скопированы", clip.entries.some((e) => e.slots?.title === "ПЕРВЫЙ"));
  check("подсказка показана пользователю", sandbox._hints.some((h) => h.includes("Скопировано")));
}

/* ─── 2. Вставка соседом: свежие uid и правильный порядок ────────────────── */
resetCanvas();
run("copyBlock(2)");
run("pasteBlock(2, { inside: false })");
{
  const canvas = run("state.canvas");
  const sections = canvas.filter((e) => e.blockId === "sec");
  check("секций стало две", sections.length === 2, `sections=${sections.length}`);

  const uids = canvas.map((e) => String(e.uid));
  check("uid'ы уникальны", new Set(uids).size === uids.length, uids.join(","));

  const inWrapper = canvas.filter((e) => String(e.parentUid) === "1" && e.slotId === "sections");
  check("копия встала сразу после оригинала",
    String(inWrapper[0].uid) === "2" && String(inWrapper[1].uid) !== "2",
    inWrapper.map((e) => e.uid).join(","));

  const copyRoot = sections.find((e) => String(e.uid) !== "2");
  const copyChildren = canvas.filter((e) => sameUidStr(e.parentUid, copyRoot.uid));
  check("вложенные блоки переехали вместе с копией", copyChildren.length === 2, `children=${copyChildren.length}`);
  check("тексты внутри копии сохранились",
    copyChildren.map((e) => e.slots.title).sort().join("|") === "ВТОРОЙ|ПЕРВЫЙ");
  check("дети копии не ссылаются на старого родителя",
    copyChildren.every((e) => String(e.parentUid) !== "2"));
}
function sameUidStr(a, b) { return a != null && b != null && String(a) === String(b); }

/* ─── 3. Вставка внутрь уважает совместимость слотов ─────────────────────── */
resetCanvas();
run("copyBlock(3)");              // внутренний блок
run("pasteBlock(2, { inside: true })");
{
  const content = run("state.canvas").filter((e) => String(e.parentUid) === "2" && e.slotId === "content");
  check("внутренний блок лёг в слот содержимого секции", content.length === 3, `content=${content.length}`);
}

resetCanvas();
run("copyBlock(2)");              // секция
run("pasteBlock(3, { inside: true })");
{
  const canvas = run("state.canvas");
  check("секцию нельзя положить внутрь текстового блока", canvas.filter((e) => e.blockId === "sec").length === 1);
  check("пользователю объяснили отказ", sandbox._hints.some((h) => h.includes("нельзя положить внутрь")));
}

/* ─── 4. Вставка соседом тоже проверяет уровень родительского слота ─────────
 * Нельзя полагаться только на то, что цель уже стоит в валидном месте:
 * корень буфера может быть другого placement. Иначе inner рядом с section
 * попадал прямо в outer.sections, а section рядом с inner — в content.
 */
resetCanvas();
run("copyBlock(3)");              // внутренний блок
run("pasteBlock(2, { inside: false })"); // рядом с секцией → outer.sections
{
  const canvas = run("state.canvas");
  check("inner нельзя вставить соседом секции в outer.sections",
    canvas.filter((e) => e.blockId === "txt").length === 2);
  check("отказ sibling-вставки объяснён пользователю",
    sandbox._hints.some((h) => h.includes("нельзя вставить рядом")));
}

resetCanvas();
run("copyBlock(2)");              // секция
run("pasteBlock(3, { inside: false })"); // рядом с inner → section.content
{
  const canvas = run("state.canvas");
  check("section нельзя вставить соседом inner в section.content",
    canvas.filter((e) => e.blockId === "sec").length === 1);
}

/* ─── 5. Вырезание: буфер переживает удаление оригинала ──────────────────── */
resetCanvas();
run("cutBlock(3)");
{
  check("оригинал удалён с канваса", !run("state.canvas").some((e) => String(e.uid) === "3"));
  const clip = run("readBlockClipboard()");
  check("буфер сохранился после удаления", clip?.entries?.[0]?.slots?.title === "ПЕРВЫЙ");
  run("pasteBlock(4, { inside: false })");
  const titles = run("state.canvas").filter((e) => e.blockId === "txt").map((e) => e.slots.title).sort();
  check("вырезанный блок вставляется обратно", titles.join("|") === "ВТОРОЙ|ПЕРВЫЙ", titles.join("|"));
}

/* ─── 6. Дублирование не затирает то, что копировали раньше ──────────────── */
resetCanvas();
run("copyBlock(3)");              // в буфере «ПЕРВЫЙ»
run("duplicateBlock(4)");         // дублируем «ВТОРОЙ»
{
  const titles = run("state.canvas").filter((e) => e.blockId === "txt").map((e) => e.slots.title);
  check("дубль создан", titles.filter((t) => t === "ВТОРОЙ").length === 2, titles.join("|"));
  const clip = run("readBlockClipboard()");
  check("в буфере остался ранее скопированный блок", clip.entries[0].slots.title === "ПЕРВЫЙ",
    clip.entries[0].slots.title);
}

/* ─── 7. Пустой буфер и исчезнувший блок не роняют вставку ───────────────── */
resetCanvas();
run("pasteBlock(3, { inside: false })");
check("вставка из пустого буфера — предупреждение, а не падение",
  sandbox._hints.some((h) => h.includes("Буфер пуст")));

resetCanvas();
run("copyBlock(3)");
run("state.library = state.library.filter((b) => b.id !== 'txt')");
run("pasteBlock(4, { inside: false })");
check("удалённый из библиотеки блок не вставляется молча",
  sandbox._hints.some((h) => h.includes("больше не существует")));

console.log(`\ncanvas-clipboard: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
