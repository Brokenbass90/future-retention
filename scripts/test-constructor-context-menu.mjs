#!/usr/bin/env node
/**
 * Контекстное меню конструктора срабатывает каждый раз, а не через раз.
 *
 * Было: каждое открытие меню вешало свой mousedown на document и не снимало
 * его после клика по пункту. При следующем открытии старый обработчик
 * закрывал НОВОЕ меню на mousedown — click до пункта не доходил: то не
 * удалялось, то не копировалось, то не вставлялось.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import url from "node:url";
import vm from "node:vm";

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const src = readFileSync(path.join(root, "public", "constructor.js"), "utf8");
const fn = (name) => {
  const m = new RegExp(`(?:^|\\n)function ${name}\\s*\\(`).exec(src);
  const start = m.index === 0 ? 0 : m.index + 1;
  const re = /\n\}/g; re.lastIndex = start;
  return src.slice(start, re.exec(src).index + 2);
};

// Мини-DOM: считаем живые обработчики mousedown на document.
const listeners = new Map();
const doc = {
  body: { appendChild(el) { doc._menus.push(el); el.isConnected = true; } },
  _menus: [],
  addEventListener(type, fn) { (listeners.get(type) || listeners.set(type, new Set()).get(type)).add(fn); },
  removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
  querySelector(sel) { return sel === ".canvas-ctx-menu" ? doc._menus.find((m) => m.isConnected) || null : null; },
  createElement() {
    return { isConnected: false, style: {}, setAttribute() {}, addEventListener() {},
      getBoundingClientRect: () => ({ width: 100, height: 100 }),
      remove() { this.isConnected = false; }, contains: () => false, set innerHTML(v) {} };
  },
};
const sandbox = { document: doc, window: { innerWidth: 1000, innerHeight: 800 }, escapeHtml: (s) => s, iframeDoc: () => null };
vm.createContext(sandbox);
vm.runInContext(`${src.match(/let _ctxMenuDismiss = null;/)[0]}\n${fn("closeCanvasContextMenu")}\n${fn("renderContextMenu")}`, sandbox);

for (let i = 0; i < 3; i += 1) {
  vm.runInContext("closeCanvasContextMenu(); renderContextMenu(10, 10, [{ key: 'copy', label: 'Копировать' }]);", sandbox);
  assert.equal(listeners.get("mousedown")?.size, 1, `после ${i + 1}-го открытия ровно один обработчик закрытия`);
}
vm.runInContext("closeCanvasContextMenu();", sandbox);
assert.equal(listeners.get("mousedown")?.size || 0, 0, "закрытое меню не оставляет обработчиков");
console.log("✓ меню не копит обработчики закрытия и не закрывает само себя");

assert.match(fn("wireIframeInteractions"), /addEventListener\("keydown", onCanvasClipboardHotkey\)/);
assert.match(fn("wireIframeInteractions"), /addEventListener\("keydown", onCanvasDeleteHotkey\)/);
console.log("✓ Ctrl+C/X/V/D и Delete работают и при фокусе в превью письма");
console.log("\nconstructor-context-menu: ok");
