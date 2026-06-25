/**
 * constructor.js — block-based email assembly UI.
 *
 * State model:
 *   state = {
 *     library:        [{ id, label, description, placement, category, slots, ... }, ...],
 *     canvas:         [{ uid: 1, blockId: "header-logo", slots: { brand_url: "..." } }, ...],
 *     selectedUid:    1 | null,
 *     filter:         "section" | "inline" | "all",
 *   }
 *
 * Three panes refresh from `state`:
 *   - left  (catalog)   → renderCatalog()
 *   - center (canvas)   → renderCanvas()
 *   - right (inspector) → renderInspector()
 *
 * Click a catalog item → append to canvas.
 * Click a canvas card → selectedUid → inspector shows its slot inputs.
 * Inspector input change → mutate canvas[].slots → save state.
 * Preview button → POST /api/compose-preview → open iframe.
 */

const state = {
  library: [],
  canvas: [],
  selectedUid: null,
  filter: "section",
  _uidCounter: 1,
};

const $ = (id) => document.getElementById(id);

const PLACEMENT_ICON = {
  section: "📦",
  inline:  "🧩",
  helper:  "🔧",
};

function nextUid() { return state._uidCounter++; }

// ─── Catalog ────────────────────────────────────────────────────────────
async function loadLibrary() {
  try {
    const res = await fetch("/api/blocks-library");
    const data = await res.json();
    state.library = Array.isArray(data?.blocks) ? data.blocks : [];
    renderCatalog();
  } catch (err) {
    $("catalogList").innerHTML = `<div class="cat-empty">Не удалось загрузить блоки: ${err.message}</div>`;
  }
}

function renderCatalog() {
  const list = $("catalogList");
  const f = state.filter;
  const filtered = state.library.filter((b) => f === "all" ? true : b.placement === f);
  if (!filtered.length) {
    list.innerHTML = `<div class="cat-empty">В этой категории нет блоков.</div>`;
    return;
  }
  list.innerHTML = "";
  for (const b of filtered) {
    const el = document.createElement("div");
    el.className = "cat-item" + (b.source === "user" ? " cat-item-user" : "");
    el.draggable = true;
    el.dataset.blockId = b.id;
    el.dataset.placement = b.placement || "";
    el.title = "Перетащи на канвас (или клик чтобы добавить в конец)";
    const slotCount = (b.slots || []).length;
    const isUser = b.source === "user";
    el.innerHTML = `
      <div class="cat-item-head">
        <span class="cat-item-icon">${PLACEMENT_ICON[b.placement] || "📐"}</span>
        <span>${escapeHtml(b.label || b.id)}</span>
        ${isUser ? `<span class="cat-item-badge" title="User-saved block">👤</span>` : ""}
        ${isUser ? `<button class="cat-item-edit" data-edit-id="${escapeHtml(b.id)}" title="Редактировать pug/styl/слоты этого блока">✎</button>` : ""}
        ${isUser ? `<button class="cat-item-del" data-del-id="${escapeHtml(b.id)}" title="Удалить этот user-блок">✕</button>` : ""}
      </div>
      <div class="cat-item-desc">${escapeHtml(b.description || "")}</div>
      <div class="cat-item-meta">
        <span class="pill">${b.placement || "?"}</span>
        <span class="pill">${b.category || "?"}</span>
        <span class="pill">${slotCount} slot${slotCount === 1 ? "" : "s"}</span>
      </div>
    `;
    // Catalog click → addToCanvas (skip if user pressed the × button).
    el.addEventListener("click", (e) => {
      const delBtn = e.target.closest(".cat-item-del");
      if (delBtn) {
        e.stopPropagation();
        deleteUserBlock(delBtn.dataset.delId);
        return;
      }
      const editBtn = e.target.closest(".cat-item-edit");
      if (editBtn) {
        e.stopPropagation();
        const blk = state.library.find((x) => x.id === editBtn.dataset.editId);
        if (blk) openBlockAuthor(blk);
        return;
      }
      addToCanvas(b);
    });
    el.addEventListener("dragstart", (e) => {
      e.dataTransfer.effectAllowed = "copy";
      e.dataTransfer.setData("application/x-retkit-block", b.id);
      // Also set text/plain as fallback for browsers that strip the custom type.
      e.dataTransfer.setData("text/plain", b.id);
      _draggingBlockId = b.id;
      _draggingPlacement = b.placement || "";
      document.body.classList.add("dragging-from-catalog");
      document.body.dataset.dragPlacement = b.placement || "";
    });
    el.addEventListener("dragend", () => {
      _draggingBlockId = null;
      _draggingPlacement = "";
      document.body.classList.remove("dragging-from-catalog");
      delete document.body.dataset.dragPlacement;
      clearDropIndicators();
      clearIframeDropLine();
    });
    list.appendChild(el);
  }
}

// ─── Canvas ─────────────────────────────────────────────────────────────
// Undo stack for canvas structure (add / remove / reorder). Snapshot BEFORE each mutation.
let _canvasUndo = [];
function pushCanvasUndo() {
  try { _canvasUndo.push(JSON.stringify(state.canvas)); } catch { return; }
  if (_canvasUndo.length > 50) _canvasUndo.shift();
  const btn = document.getElementById("undoBtn");
  if (btn) btn.disabled = _canvasUndo.length === 0;
}
function undoCanvas() {
  if (!_canvasUndo.length) return;
  let prev;
  try { prev = JSON.parse(_canvasUndo.pop()); } catch { return; }
  state.canvas = prev;
  state.selectedUid = null;
  renderCanvas();
  renderInspector();
  scheduleLivePreview();
  const btn = document.getElementById("undoBtn");
  if (btn) btn.disabled = _canvasUndo.length === 0;
}

function addToCanvas(block, atIndex) {
  pushCanvasUndo();
  const slots = {};
  for (const s of block.slots || []) {
    if ("default" in s) slots[s.id] = s.default;
  }
  const entry = { uid: nextUid(), blockId: block.id, slots };
  if (typeof atIndex === "number" && atIndex >= 0 && atIndex <= state.canvas.length) {
    state.canvas.splice(atIndex, 0, entry);
  } else {
    state.canvas.push(entry);
  }
  state.selectedUid = entry.uid;
  renderCanvas();
  renderInspector();
  scheduleLivePreview();
}

function moveCanvasUid(uid, toIndex) {
  pushCanvasUndo();
  const fromIndex = state.canvas.findIndex((c) => c.uid === uid);
  if (fromIndex < 0) return;
  // Adjust target if removing earlier shifts the array.
  const insertAt = (toIndex > fromIndex) ? toIndex - 1 : toIndex;
  const [moved] = state.canvas.splice(fromIndex, 1);
  state.canvas.splice(Math.max(0, Math.min(insertAt, state.canvas.length)), 0, moved);
  renderCanvas();
  scheduleLivePreview();
}

function removeFromCanvas(uid) {
  pushCanvasUndo();
  state.canvas = state.canvas.filter((c) => c.uid !== uid);
  if (state.selectedUid === uid) state.selectedUid = null;
  renderCanvas();
  renderInspector();
  scheduleLivePreview();
}

function moveInCanvas(uid, delta) {
  pushCanvasUndo();
  const idx = state.canvas.findIndex((c) => c.uid === uid);
  if (idx < 0) return;
  const target = idx + delta;
  if (target < 0 || target >= state.canvas.length) return;
  const [moved] = state.canvas.splice(idx, 1);
  state.canvas.splice(target, 0, moved);
  renderCanvas();
  scheduleLivePreview();
}

function selectCanvas(uid) {
  state.selectedUid = uid;
  renderCanvas();
  renderInspector();
  applyIframeSelection();
}

function renderCanvas() {
  const ol = $("canvas");
  if (!state.canvas.length) {
    ol.innerHTML = `<li class="canvas-empty" data-canvas-empty="1">Канвас пуст. Перетащи блок слева или кликни по нему.</li>`;
    return;
  }
  ol.innerHTML = "";
  state.canvas.forEach((entry, idx) => {
    const block = state.library.find((b) => b.id === entry.blockId);
    if (!block) return;
    const li = document.createElement("li");
    li.className = "canvas-card" + (entry.uid === state.selectedUid ? " selected" : "");
    li.draggable = true;
    li.dataset.uid = String(entry.uid);
    li.dataset.placement = block.placement || "";
    li.innerHTML = `
      <span class="canvas-card-handle" title="Перетащи чтобы переставить">⠿</span>
      <span class="canvas-card-icon">${PLACEMENT_ICON[block.placement] || "📐"}</span>
      <div class="canvas-card-body">
        <div class="canvas-card-title">${escapeHtml(block.label || block.id)}</div>
        <div class="canvas-card-sub">${escapeHtml(block.placement || "")} · ${(block.slots || []).length} slot(s)</div>
      </div>
      <div class="canvas-card-actions">
        <button title="Вверх" data-act="up" ${idx === 0 ? "disabled" : ""}>▲</button>
        <button title="Вниз" data-act="down" ${idx === state.canvas.length - 1 ? "disabled" : ""}>▼</button>
        <button title="Удалить" data-act="del">✕</button>
      </div>
    `;
    li.addEventListener("click", (e) => {
      if (e.target.closest("button")) return;
      selectCanvas(entry.uid);
    });
    li.querySelector('[data-act="up"]').addEventListener("click", (e) => { e.stopPropagation(); moveInCanvas(entry.uid, -1); });
    li.querySelector('[data-act="down"]').addEventListener("click", (e) => { e.stopPropagation(); moveInCanvas(entry.uid, +1); });
    li.querySelector('[data-act="del"]').addEventListener("click", (e) => { e.stopPropagation(); removeFromCanvas(entry.uid); });

    // Drag for reorder.
    li.addEventListener("dragstart", (e) => {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("application/x-retkit-canvas-uid", String(entry.uid));
      e.dataTransfer.setData("text/plain", "canvas:" + entry.uid);
      document.body.classList.add("dragging-canvas-card");
      document.body.dataset.dragPlacement = block.placement || "";
      li.classList.add("dragging");
    });
    li.addEventListener("dragend", () => {
      document.body.classList.remove("dragging-canvas-card");
      delete document.body.dataset.dragPlacement;
      li.classList.remove("dragging");
      clearDropIndicators();
    });

    ol.appendChild(li);
  });
}

// ─── Drag-and-drop logic on canvas ──────────────────────────────────────
// Insert an indicator line between cards as the user drags. The line shows
// the insertion point (above the hovered card if cursor is in its top half,
// below if in the bottom half).
function clearDropIndicators() {
  document.querySelectorAll(".canvas-drop-indicator").forEach((el) => el.remove());
  document.querySelectorAll(".canvas-card.drop-target").forEach((el) => el.classList.remove("drop-target"));
}

function computeInsertionIndex(canvasEl, clientY) {
  const cards = Array.from(canvasEl.querySelectorAll(".canvas-card"));
  for (let i = 0; i < cards.length; i += 1) {
    const r = cards[i].getBoundingClientRect();
    const mid = r.top + r.height / 2;
    if (clientY < mid) return i;
  }
  return cards.length;
}

function wireCanvasDnd() {
  const canvasEl = $("canvas");

  canvasEl.addEventListener("dragover", (e) => {
    // Accept catalog drops AND canvas reorders.
    const fromCatalog = document.body.classList.contains("dragging-from-catalog");
    const fromCanvas  = document.body.classList.contains("dragging-canvas-card");
    if (!fromCatalog && !fromCanvas) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = fromCatalog ? "copy" : "move";

    const insertAt = computeInsertionIndex(canvasEl, e.clientY);
    showInsertionIndicator(canvasEl, insertAt);
  });

  canvasEl.addEventListener("dragleave", (e) => {
    // Only clear when leaving the canvas pane entirely.
    if (e.target === canvasEl) clearDropIndicators();
  });

  canvasEl.addEventListener("drop", (e) => {
    e.preventDefault();
    clearDropIndicators();
    const canvasUid = e.dataTransfer.getData("application/x-retkit-canvas-uid");
    const blockId   = e.dataTransfer.getData("application/x-retkit-block");
    const insertAt  = computeInsertionIndex(canvasEl, e.clientY);

    if (canvasUid) {
      moveCanvasUid(Number(canvasUid), insertAt);
      return;
    }
    if (blockId) {
      const block = state.library.find((b) => b.id === blockId);
      if (block) addToCanvas(block, insertAt);
    }
  });
}

function showInsertionIndicator(canvasEl, insertAt) {
  clearDropIndicators();
  const cards = Array.from(canvasEl.querySelectorAll(".canvas-card"));
  const indicator = document.createElement("div");
  indicator.className = "canvas-drop-indicator";

  if (!cards.length) {
    // Empty canvas — show as a single horizontal bar at top of canvas pane.
    canvasEl.insertBefore(indicator, canvasEl.firstChild);
    return;
  }
  if (insertAt >= cards.length) {
    // After last card.
    cards[cards.length - 1].insertAdjacentElement("afterend", indicator);
  } else {
    cards[insertAt].insertAdjacentElement("beforebegin", indicator);
  }
}

// ─── Inspector ──────────────────────────────────────────────────────────
function renderInspector() {
  const body = $("inspectorBody");
  if (!state.selectedUid) {
    body.innerHTML = `<div class="insp-empty">Выбери блок на канвасе чтобы редактировать его поля.</div>`;
    return;
  }
  const entry = state.canvas.find((c) => c.uid === state.selectedUid);
  if (!entry) {
    state.selectedUid = null;
    renderInspector();
    return;
  }
  const block = state.library.find((b) => b.id === entry.blockId);
  if (!block) return;
  let html = `<div class="insp-block-id">${escapeHtml(block.id)} · ${escapeHtml(block.placement)}</div>`;
  // Move / delete the selected block (these lived in the removed «Структура» column).
  html += `<div class="insp-actions">
    <button class="btn" data-act="up" type="button" title="Переместить выше">▲ Выше</button>
    <button class="btn" data-act="down" type="button" title="Переместить ниже">▼ Ниже</button>
    <button class="btn" data-act="del" type="button" title="Удалить блок из письма">🗑</button>
  </div>`;
  for (const slot of block.slots || []) {
    html += renderSlotControl(slot, entry.slots[slot.id]);
  }
  // "Save as user block" footer — copies current slot values as new defaults.
  html += `
    <div class="insp-save-block">
      <button class="btn" id="insp-save-as-block" type="button"
              title="Сохрани этот блок с текущими значениями slot'ов как новый user-блок в каталоге">
        💾 Сохранить как мой блок
      </button>
    </div>
  `;
  body.innerHTML = html;
  // Wire up change handlers.
  body.querySelectorAll("[data-slot-id]").forEach((el) => {
    el.addEventListener("input", () => {
      const id = el.getAttribute("data-slot-id");
      let v = el.value;
      if (el.type === "number") v = Number(v);
      entry.slots[id] = v;
      // Keep the paired color text/swatch inputs in sync.
      if (el.type === "color" || (el.type === "text" && el.previousElementSibling?.type === "color")) {
        body.querySelectorAll(`[data-slot-id="${CSS.escape(id)}"]`).forEach((other) => {
          if (other !== el && other.value !== v) other.value = v;
        });
      }
      scheduleLivePreview();
    });
  });
  body.querySelector("#insp-save-as-block")?.addEventListener("click", () => saveSelectedAsUserBlock());
  body.querySelector('[data-act="up"]')?.addEventListener("click", () => { moveInCanvas(entry.uid, -1); renderInspector(); });
  body.querySelector('[data-act="down"]')?.addEventListener("click", () => { moveInCanvas(entry.uid, +1); renderInspector(); });
  body.querySelector('[data-act="del"]')?.addEventListener("click", () => removeFromCanvas(entry.uid));
}

async function saveSelectedAsUserBlock() {
  const entry = state.canvas.find((c) => c.uid === state.selectedUid);
  if (!entry) return;
  const base = state.library.find((b) => b.id === entry.blockId);
  if (!base) return;

  const proposedId = prompt(
    "Имя нового блока (буквы/цифры/-/_, до 64 символов).\n\n" +
    "Текущие значения slot'ов станут default'ами в новом блоке.",
    base.id + "-mine"
  );
  if (!proposedId) return;
  const id = proposedId.trim();
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(id)) {
    alert("Имя должно начинаться с буквы/цифры и содержать только буквы/цифры/-/_.");
    return;
  }
  const label = prompt("Подпись (короткая, для каталога):", base.label || id) || id;

  // Bake current slot values as defaults.
  const newSlots = (base.slots || []).map((s) => ({
    ...s,
    default: entry.slots[s.id] !== undefined ? entry.slots[s.id] : s.default,
  }));

  const payload = {
    id, label,
    description: `Сохранено из ${base.id}`,
    placement: base.placement,
    category: base.category || "misc",
    pug: base.pug,
    styl: base.styl,
    slots: newSlots,
    tags: Array.isArray(base.tags) ? base.tags.concat(["user"]) : ["user"],
  };

  let res = await fetch("/api/blocks-library/save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  let data = await res.json();
  if (res.status === 409) {
    if (!confirm(`Блок "${id}" уже есть. Перезаписать?`)) return;
    res = await fetch("/api/blocks-library/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, force: true }),
    });
    data = await res.json();
  }
  if (res.status !== 200) {
    alert("Не получилось сохранить: " + (data.error || res.status));
    return;
  }
  // Refresh library so the new block shows up in the catalog.
  await loadLibrary();
  alert(`✓ Блок "${id}" сохранён.\nТеперь он есть в каталоге, фильтр "All" покажет его сразу.`);
}

async function deleteUserBlock(id) {
  if (!confirm(`Удалить user-блок "${id}"?\nКанвас не тронется, но блок больше не появится в каталоге.`)) return;
  const res = await fetch("/api/blocks-library/user/" + encodeURIComponent(id), { method: "DELETE" });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    alert("Не удалось удалить: " + (data.error || res.status));
    return;
  }
  await loadLibrary();
}

function renderSlotControl(slot, current) {
  const v = current ?? slot.default ?? "";
  const kind = slot.kind || "text";
  const id = slot.id;
  const label = `<label>${escapeHtml(slot.label || id)} <span class="slot-kind">${escapeHtml(kind)}</span></label>`;
  if (kind === "richText") {
    return `<div class="insp-slot">${label}<textarea data-slot-id="${escapeHtml(id)}" maxlength="${slot.max || 1000}">${escapeHtml(v)}</textarea></div>`;
  }
  if (kind === "select") {
    const options = (slot.options || []).map((o) => `<option value="${escapeHtml(o)}" ${o === v ? "selected" : ""}>${escapeHtml(o)}</option>`).join("");
    return `<div class="insp-slot">${label}<select data-slot-id="${escapeHtml(id)}">${options}</select></div>`;
  }
  if (kind === "number") {
    return `<div class="insp-slot">${label}<input type="number" data-slot-id="${escapeHtml(id)}" value="${escapeHtml(v)}" min="${slot.min ?? ''}" max="${slot.max ?? ''}" /></div>`;
  }
  if (kind === "url") {
    return `<div class="insp-slot">${label}<input type="url" data-slot-id="${escapeHtml(id)}" value="${escapeHtml(v)}" /></div>`;
  }
  if (kind === "image") {
    return `<div class="insp-slot">${label}<input type="url" data-slot-id="${escapeHtml(id)}" value="${escapeHtml(v)}" placeholder="https://..." /></div>`;
  }
  if (kind === "color") {
    return `<div class="insp-slot">${label}<input type="color" data-slot-id="${escapeHtml(id)}" value="${escapeHtml(v)}" /><input type="text" data-slot-id="${escapeHtml(id)}" value="${escapeHtml(v)}" /></div>`;
  }
  // default: text
  return `<div class="insp-slot">${label}<input type="text" data-slot-id="${escapeHtml(id)}" value="${escapeHtml(v)}" maxlength="${slot.max || 200}" /></div>`;
}

// ─── Live preview (always-on, debounced) ────────────────────────────────
let _livePreviewTimer = null;
let _livePreviewToken = 0;
let _lastLiveHtml = "";

function setLiveStatus(text, cls) {
  const el = $("livePreviewStatus");
  if (!el) return;
  el.textContent = text;
  el.className = "preview-pane-status" + (cls ? " " + cls : "");
}

function scheduleLivePreview(delay = 650) {
  if (_livePreviewTimer) clearTimeout(_livePreviewTimer);
  const stage = $("previewStage");
  if (!state.canvas.length) {
    // Nothing to render — reset to placeholder.
    _lastLiveHtml = "";
    stage?.classList.remove("has-content");
    $("liveFrame").srcdoc = "";
    setLiveStatus("пусто");
    return;
  }
  setLiveStatus("ожидание правок…");
  _livePreviewTimer = setTimeout(runLivePreview, delay);
}

async function runLivePreview() {
  const token = ++_livePreviewToken;
  const stage = $("previewStage");
  const overlay = $("previewOverlay");
  if (!state.canvas.length) { scheduleLivePreview(0); return; }
  overlay?.classList.remove("hidden");
  setLiveStatus("сборка…");
  try {
    const blocks = state.canvas.map((c) => ({ id: c.blockId, slots: c.slots }));
    const res = await fetch("/api/compose-preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mailName: ($("mailName").value.trim() || "preview"), blocks }),
    });
    const data = await res.json();
    if (token !== _livePreviewToken) return; // a newer build superseded us
    if (!res.ok || !data.ok) {
      stage?.classList.add("has-content");
      _lastLiveHtml = "";
      $("liveFrame").srcdoc =
        `<div style="font:12px/1.5 ui-monospace,Menlo,monospace;color:#b91c1c;white-space:pre-wrap;padding:18px">`
        + `⚠ Ошибка сборки\n\n${escapeHtml(data.error || res.status)}\n\n${escapeHtml((data.stderr || "").slice(0, 700))}</div>`;
      setLiveStatus("ошибка сборки", "err");
      return;
    }
    _lastLiveHtml = data.html;
    stage?.classList.add("has-content");
    const frame = $("liveFrame");
    frame.onload = () => {
      sizeIframeToContent();
      indexIframeBlocks();
      wireIframeInteractions();
      applyIframeSelection();
    };
    frame.srcdoc = data.html;
    const warn = (data.warnings && data.warnings.length) ? ` · ⚠${data.warnings.length}` : "";
    setLiveStatus(`${data.blocksUsed}/${data.totalBlocks} блоков · ${(data.htmlLength/1024).toFixed(1)}KB${warn}`, "ok");
  } catch (err) {
    if (token !== _livePreviewToken) return;
    setLiveStatus("сеть: " + err.message, "err");
  } finally {
    if (token === _livePreviewToken) overlay?.classList.add("hidden");
  }
}

function setPreviewDevice(mode) {
  const stage = $("previewStage");
  if (!stage) return;
  stage.classList.toggle("mobile", mode === "mobile");
  $("devDesktop")?.classList.toggle("active", mode !== "mobile");
  $("devMobile")?.classList.toggle("active", mode === "mobile");
  // Re-measure after width change.
  setTimeout(() => { sizeIframeToContent(); indexIframeBlocks(); }, 60);
}

// ─── In-iframe interactions: click-to-select + drop-into-letter ──────────
// We map rendered DOM → canvas blocks via the <!-- rk:block-start:N:id -->
// comment markers the compose pipeline injects in preview mode. All hit-test
// and insertion-line work happens INSIDE the iframe's own coordinate space —
// the drop line is a real DOM node the email's layout positions for us, so
// there's no fragile cross-frame pixel math.
let _draggingBlockId = null;
let _draggingCanvasUid = null;  // reorder: uid of the placed block being dragged
let _draggingPlacement = "";
let _blockRanges = [];          // [{ index, id, startComment, endComment, firstEl, lastEl }]
let _iframeWired = false;

function iframeDoc() {
  try { return $("liveFrame").contentDocument || null; } catch { return null; }
}

function sizeIframeToContent() {
  const frame = $("liveFrame");
  const doc = iframeDoc();
  if (!frame || !doc || !doc.body) return;
  // Let the stage scroll instead of the iframe, so injected markers line up.
  frame.style.height = "auto";
  const h = Math.max(doc.body.scrollHeight, doc.documentElement.scrollHeight, 400);
  frame.style.height = h + "px";
}

// Walk all comment nodes, pair start/end markers, resolve their element spans.
function indexIframeBlocks() {
  _blockRanges = [];
  const doc = iframeDoc();
  if (!doc) return;
  const walker = doc.createTreeWalker(doc.documentElement, NodeFilter.SHOW_COMMENT, null);
  const starts = {}; // index -> comment node
  const ends = {};
  let node;
  while ((node = walker.nextNode())) {
    const m = /^\s*rk:block-(start|end):(\d+):([a-z0-9_-]+)\s*$/i.exec(node.nodeValue || "");
    if (!m) continue;
    const idx = Number(m[2]);
    if (m[1] === "start") starts[idx] = { node, id: m[3] };
    else ends[idx] = { node, id: m[3] };
  }
  Object.keys(starts).map(Number).sort((a, b) => a - b).forEach((idx) => {
    const s = starts[idx], e = ends[idx];
    if (!s || !e) return;
    _blockRanges.push({
      index: idx,
      id: s.id,
      startComment: s.node,
      endComment: e.node,
      firstEl: (function(){ const fe = nextElementAfter(s.node); if (fe) { try { fe.setAttribute("draggable","true"); fe.style.cursor = "grab"; } catch {} } return fe; })(),
      lastEl: prevElementBefore(e.node),
    });
  });
}

function nextElementAfter(commentNode) {
  let n = commentNode;
  while (n) {
    if (n.nextElementSibling) return n.nextElementSibling;
    if (n.nextSibling) { n = n.nextSibling; if (n.nodeType === 1) return n; continue; }
    n = n.parentNode; // climb out and keep looking after the parent
  }
  return null;
}
function prevElementBefore(commentNode) {
  let n = commentNode;
  while (n) {
    if (n.previousElementSibling) return n.previousElementSibling;
    if (n.previousSibling) { n = n.previousSibling; if (n.nodeType === 1) return n; continue; }
    n = n.parentNode;
  }
  return null;
}

// Which canvas uid does the i-th rendered block correspond to?
// Rendered blocks follow the canvas order 1:1 (preview sends the whole canvas).
function uidForRenderedIndex(idx) {
  return state.canvas[idx] ? state.canvas[idx].uid : null;
}

function wireIframeInteractions() {
  const doc = iframeDoc();
  if (!doc) return;
  // Listeners are attached to the fresh document on every load, so the flag is
  // per-document; reset by reload. We attach idempotently.
  doc.addEventListener("click", onIframeClick, true);
  doc.addEventListener("dragstart", onIframeBlockDragStart, true);
  doc.addEventListener("dragend", onIframeBlockDragEnd, true);
  doc.addEventListener("dragover", onIframeDragOver);
  doc.addEventListener("drop", onIframeDrop);
  doc.addEventListener("dragleave", onIframeDragLeave);
  _iframeWired = true;
}

function rangeForTarget(el) {
  // Find the block range whose [firstEl..lastEl] contains el, by checking
  // whether el is the start comment's following-range. Simplest robust method:
  // walk up from el collecting, then find nearest preceding start marker.
  const doc = iframeDoc();
  if (!doc) return null;
  // Build an ordered list of all marker comments and elements via document order.
  // Cheap approach: for each range, test DOM containment using compareDocumentPosition.
  for (const r of _blockRanges) {
    if (!r.firstEl) continue;
    // el is within this block if it comes at-or-after firstEl and at-or-before lastEl.
    const afterStart = r.firstEl === el || (r.firstEl.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) || r.firstEl.contains(el);
    const beforeEnd = !r.lastEl || r.lastEl === el || (r.lastEl.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING) || r.lastEl.contains(el);
    if (afterStart && beforeEnd) return r;
  }
  return null;
}

function onIframeClick(e) {
  if (_draggingBlockId) return;
  const r = rangeForTarget(e.target);
  if (!r) return;
  e.preventDefault();
  const uid = uidForRenderedIndex(r.index);
  if (uid != null) selectCanvas(uid);
}

function onIframeBlockDragStart(e) {
  if (_draggingBlockId) return;            // a catalog drag wins
  const r = rangeForTarget(e.target);
  if (!r) return;
  const uid = uidForRenderedIndex(r.index);
  if (uid == null) return;
  _draggingCanvasUid = uid;
  try { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", ""); } catch {}
}
function onIframeBlockDragEnd() {
  _draggingCanvasUid = null;
  clearIframeDropLine();
}
function onIframeDragOver(e) {
  if (!_draggingBlockId && _draggingCanvasUid == null) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = "copy";
  const insertAt = iframeInsertionIndex(e.clientY);
  showIframeDropLine(insertAt);
}

function onIframeDragLeave(e) {
  // Only clear when leaving the document entirely.
  if (!e.relatedTarget) clearIframeDropLine();
}

function onIframeDrop(e) {
  if (!_draggingBlockId && _draggingCanvasUid == null) return;
  e.preventDefault();
  const insertAt = iframeInsertionIndex(e.clientY);
  clearIframeDropLine();
  if (_draggingCanvasUid != null) {           // reorder an existing block
    const uid = _draggingCanvasUid;
    _draggingCanvasUid = null;
    moveCanvasUid(uid, insertAt);
    return;
  }
  const block = state.library.find((b) => b.id === _draggingBlockId);
  _draggingBlockId = null;
  document.body.classList.remove("dragging-from-catalog");
  if (block) addToCanvas(block, insertAt);
}

// Decide insertion index among rendered blocks from a Y coordinate (iframe space).
function iframeInsertionIndex(clientY) {
  for (let i = 0; i < _blockRanges.length; i += 1) {
    const r = _blockRanges[i];
    const el = r.firstEl;
    if (!el) continue;
    const rect = el.getBoundingClientRect();
    const lastRect = (r.lastEl || el).getBoundingClientRect();
    const mid = rect.top + (lastRect.bottom - rect.top) / 2;
    if (clientY < mid) return i;
  }
  return _blockRanges.length;
}

function clearIframeDropLine() {
  const doc = iframeDoc();
  if (!doc) return;
  doc.getElementById("__rk_drop_line")?.remove();
}

function showIframeDropLine(insertAt) {
  const doc = iframeDoc();
  if (!doc) return;
  clearIframeDropLine();
  const line = doc.createElement("div");
  line.id = "__rk_drop_line";
  line.style.cssText =
    "height:4px;background:#2563eb;border-radius:3px;margin:0;box-shadow:0 0 8px #2563eb;" +
    "position:relative;z-index:99999;pointer-events:none;";
  if (insertAt >= _blockRanges.length) {
    const last = _blockRanges[_blockRanges.length - 1];
    const anchor = last?.lastEl || last?.firstEl;
    if (anchor) anchor.insertAdjacentElement("afterend", line);
    else doc.body.appendChild(line);
  } else {
    const anchor = _blockRanges[insertAt].firstEl;
    if (anchor) anchor.insertAdjacentElement("beforebegin", line);
  }
}

// Outline the currently-selected block inside the iframe and scroll to it.
function applyIframeSelection() {
  const doc = iframeDoc();
  if (!doc) return;
  // Clear previous outlines.
  _blockRanges.forEach((r) => {
    [r.firstEl, r.lastEl].forEach((el) => { if (el) el.style.outline = ""; });
  });
  if (state.selectedUid == null) return;
  const idx = state.canvas.findIndex((c) => c.uid === state.selectedUid);
  const r = _blockRanges.find((rr) => rr.index === idx);
  if (!r || !r.firstEl) return;
  // Outline every top-level element in the block span.
  outlineSpan(r);
  r.firstEl.scrollIntoView({ behavior: "smooth", block: "center" });
}

function outlineSpan(r) {
  // Walk siblings from firstEl to lastEl at the same level, outline each.
  let el = r.firstEl;
  const stop = r.lastEl;
  let guard = 0;
  while (el && guard++ < 200) {
    if (el.nodeType === 1) el.style.outline = "2px solid #2563eb";
    if (el === stop) break;
    el = el.nextSibling;
  }
}

// ─── Preview / Save ─────────────────────────────────────────────────────
async function preview() {
  if (!state.canvas.length) { alert("Канвас пуст — добавь хотя бы один блок"); return; }
  $("previewStats").textContent = "Собираю…";
  $("previewModal").classList.remove("hidden");
  $("previewFrame").srcdoc = "<p style='padding:32px;font-family:sans-serif'>Building…</p>";
  try {
    const blocks = state.canvas.map((c) => ({ id: c.blockId, slots: c.slots }));
    const res = await fetch("/api/compose-preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mailName: $("mailName").value.trim() || "preview", blocks }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      $("previewFrame").srcdoc = `<pre style="padding:20px;color:red;font-family:monospace">${escapeHtml(data.error || "build failed")}\n${escapeHtml(data.stderr || "")}</pre>`;
      $("previewStats").textContent = "Ошибка";
      return;
    }
    $("previewFrame").srcdoc = data.html;
    $("previewStats").textContent = `${data.blocksUsed}/${data.totalBlocks} blocks · ${data.htmlLength} bytes`;
  } catch (err) {
    $("previewFrame").srcdoc = `<pre style="padding:20px;color:red">${escapeHtml(err.message)}</pre>`;
    $("previewStats").textContent = "Ошибка";
  }
}

async function save() {
  if (!state.canvas.length) { alert("Канвас пуст — добавь хотя бы один блок."); return; }
  const mailName = $("mailName").value.trim();
  if (!mailName || !/^[a-z0-9_-]+$/i.test(mailName)) {
    alert("Введи корректное имя письма (буквы, цифры, дефис, подчёркивание).");
    return;
  }
  const blocks = state.canvas.map((c) => ({ id: c.blockId, slots: c.slots }));
  const brand = "X_assembled";

  const doSave = async (force) => {
    const res = await fetch("/api/compose-save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ brand, mailName, blocks, force: !!force }),
    });
    return { status: res.status, data: await res.json() };
  };

  let { status, data } = await doSave(false);

  if (status === 409) {
    const overwrite = confirm(
      `Письмо уже есть в ${data.existsAt}.\n\n` +
      `Перезаписать? (OK = да, Cancel = выбрать другое имя)`
    );
    if (!overwrite) return;
    ({ status, data } = await doSave(true));
  }

  if (status === 200 && data.ok) {
    const goWorkbench = confirm(
      `✓ Письмо сохранено в ${data.path}\n` +
      `   ${data.blocksUsed}/${data.totalBlocks} блоков, build OK\n\n` +
      `Открыть в workbench для финальной правки?`
    );
    if (goWorkbench) {
      const mid = (data.mail || ("mail-" + mailName));
      window.location.href = "/workbench?brand=" + encodeURIComponent(brand) + "&mail=" + encodeURIComponent(mid);
    }
    return;
  }

  // 422 = saved but build failed, 500 = unexpected, 400 = invalid
  const detail = data.stderr ? `\n\n${data.stderr.slice(0, 400)}` : "";
  alert(`Не получилось сохранить:\n${data.error || "unknown"}${detail}`);
}

// ─── Helpers ────────────────────────────────────────────────────────────
function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ─── Block authoring (create / edit user blocks from scratch) ──────────
// Modal with pug + styl editors, auto-detected {{ token }} slots, and a live
// preview built through the REAL compose pipeline (ad-hoc `def` blocks).
const authorState = {
  editingId: null,        // null = creating new; string = editing existing user block
  slotMeta: {},           // token -> { kind, label, default }
};

const SLOT_KINDS = ["text", "richText", "url", "image", "color", "number", "select"];

function guessSlotKind(id) {
  if (/color|background|(^|_)bg($|_)/i.test(id)) return "color";
  if (/href|url|link/i.test(id)) return "url";
  if (/image|img|logo|icon|photo|picture/i.test(id)) return "image";
  if (/width|height|radius|size|padding|margin|spacing/i.test(id)) return "number";
  return "text";
}

function defaultForKind(kind, id) {
  if (kind === "color") return "#ff7700";
  if (kind === "number") return 16;
  if (kind === "url" || kind === "image") return "https://example.com";
  return id.replace(/_/g, " ");
}

function detectSlotTokens(pug, styl) {
  const tokens = [];
  const seen = new Set();
  for (const src of [pug || "", styl || ""]) {
    const re = /\{\{\s*([a-z][a-z0-9_]*)\s*\}\}/gi;
    let m;
    while ((m = re.exec(src))) {
      const t = m[1];
      if (!seen.has(t)) { seen.add(t); tokens.push(t); }
    }
  }
  return tokens;
}

function openBlockAuthor(block) {
  authorState.editingId = block ? block.id : null;
  authorState.slotMeta = {};
  $("authorTitle").textContent = block ? `✎ Редактировать блок «${block.label || block.id}»` : "➕ Новый блок";
  $("abId").value = block ? block.id : "";
  $("abId").disabled = !!block;
  $("abLabel").value = block ? (block.label || "") : "";
  $("abPlacement").value = block && block.placement === "inline" ? "inline" : "section";
  $("abCategory").value = block ? (block.category || "misc") : "misc";
  $("abDesc").value = block ? (block.description || "") : "";
  $("abPug").value = block ? (block.pug || "") : "";
  $("abStyl").value = block ? (block.styl || "") : "";
  if (block && Array.isArray(block.slots)) {
    for (const s of block.slots) {
      authorState.slotMeta[s.id] = {
        kind: s.kind || "text",
        label: s.label || s.id,
        default: "default" in s ? s.default : defaultForKind(s.kind || "text", s.id),
      };
    }
  }
  renderAuthorSlots();
  $("abFrame").srcdoc = "";
  $("abStatus").textContent = "пусто";
  $("abStatus").className = "preview-pane-status";
  $("authorModal").classList.remove("hidden");
  ($("abId").disabled ? $("abLabel") : $("abId")).focus();
  scheduleAuthorPreview(150);
}

function closeBlockAuthor() {
  $("authorModal").classList.add("hidden");
  if (_authorPreviewTimer) { clearTimeout(_authorPreviewTimer); _authorPreviewTimer = null; }
}

function renderAuthorSlots() {
  const tokens = detectSlotTokens($("abPug").value, $("abStyl").value);
  // Drop meta for tokens no longer in the code; add meta for new tokens.
  const next = {};
  for (const t of tokens) {
    next[t] = authorState.slotMeta[t] || {
      kind: guessSlotKind(t),
      label: t,
      default: defaultForKind(guessSlotKind(t), t),
    };
  }
  authorState.slotMeta = next;

  const list = $("abSlotList");
  if (!tokens.length) {
    list.innerHTML = `<div class="author-hint" style="padding:6px 0">Пока нет {{ token }} в коде — блок будет без настраиваемых полей.</div>`;
    return;
  }
  list.innerHTML = "";
  for (const t of tokens) {
    const meta = authorState.slotMeta[t];
    const row = document.createElement("div");
    row.className = "author-slot-row";
    row.innerHTML = `
      <code class="author-slot-token">{{ ${escapeHtml(t)} }}</code>
      <select data-ab-slot="${escapeHtml(t)}" data-ab-field="kind">
        ${SLOT_KINDS.map((k) => `<option value="${k}" ${k === meta.kind ? "selected" : ""}>${k}</option>`).join("")}
      </select>
      <input type="text" data-ab-slot="${escapeHtml(t)}" data-ab-field="label" value="${escapeHtml(meta.label)}" placeholder="подпись" title="Подпись слота в инспекторе" />
      <input type="text" data-ab-slot="${escapeHtml(t)}" data-ab-field="default" value="${escapeHtml(meta.default)}" placeholder="default" title="Значение по умолчанию (и для превью)" />
    `;
    list.appendChild(row);
  }
  list.querySelectorAll("[data-ab-slot]").forEach((el) => {
    el.addEventListener("input", () => {
      const t = el.getAttribute("data-ab-slot");
      const f = el.getAttribute("data-ab-field");
      if (!authorState.slotMeta[t]) return;
      authorState.slotMeta[t][f] = f === "default" && authorState.slotMeta[t].kind === "number"
        ? Number(el.value) || 0
        : el.value;
      scheduleAuthorPreview();
    });
  });
}

function buildAuthorSlots() {
  return Object.entries(authorState.slotMeta).map(([id, m]) => ({
    id,
    kind: m.kind || "text",
    label: m.label || id,
    default: m.kind === "number" ? (Number(m.default) || 0) : String(m.default ?? ""),
  }));
}

function buildAuthorDef() {
  return {
    label: $("abLabel").value.trim() || $("abId").value.trim() || "draft",
    placement: $("abPlacement").value,
    pug: $("abPug").value,
    styl: $("abStyl").value,
    slots: buildAuthorSlots(),
  };
}

let _authorPreviewTimer = null;
let _authorPreviewToken = 0;

function scheduleAuthorPreview(delay = 700) {
  if (_authorPreviewTimer) clearTimeout(_authorPreviewTimer);
  if (!$("abPug").value.trim()) {
    $("abStatus").textContent = "пусто — напиши pug";
    $("abStatus").className = "preview-pane-status";
    $("abFrame").srcdoc = "";
    return;
  }
  $("abStatus").textContent = "ожидание правок…";
  _authorPreviewTimer = setTimeout(runAuthorPreview, delay);
}

async function runAuthorPreview() {
  const token = ++_authorPreviewToken;
  $("abStatus").textContent = "сборка…";
  try {
    const id = ($("abId").value.trim() || "draft-block").toLowerCase().replace(/[^a-z0-9_-]/g, "-") || "draft-block";
    const res = await fetch("/api/compose-preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mailName: "block-author-preview",
        blocks: [{ id, def: buildAuthorDef() }],
      }),
    });
    const data = await res.json();
    if (token !== _authorPreviewToken) return;
    if (!res.ok || !data.ok) {
      $("abFrame").srcdoc =
        `<div style="font:12px/1.5 ui-monospace,Menlo,monospace;color:#b91c1c;white-space:pre-wrap;padding:18px">`
        + `⚠ Ошибка сборки\n\n${escapeHtml(data.error || res.status)}\n\n${escapeHtml((data.stderr || "").slice(0, 700))}</div>`;
      $("abStatus").textContent = "ошибка сборки";
      $("abStatus").className = "preview-pane-status err";
      return;
    }
    $("abFrame").srcdoc = data.html;
    $("abStatus").textContent = `OK · ${(data.htmlLength / 1024).toFixed(1)}KB`;
    $("abStatus").className = "preview-pane-status ok";
  } catch (err) {
    if (token !== _authorPreviewToken) return;
    $("abStatus").textContent = "сеть: " + err.message;
    $("abStatus").className = "preview-pane-status err";
  }
}

async function saveAuthorBlock() {
  const id = $("abId").value.trim();
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(id)) {
    alert("ID: начинается с буквы/цифры, только буквы/цифры/-/_, до 64 символов.");
    $("abId").focus();
    return;
  }
  if (!$("abPug").value.trim()) {
    alert("Pug-код пустой — блоку нечего рендерить.");
    $("abPug").focus();
    return;
  }
  const payload = {
    id,
    label: $("abLabel").value.trim() || id,
    description: $("abDesc").value.trim(),
    placement: $("abPlacement").value,
    category: $("abCategory").value.trim() || "misc",
    pug: $("abPug").value,
    styl: $("abStyl").value,
    slots: buildAuthorSlots(),
    tags: ["user", "authored"],
    force: !!authorState.editingId,
  };
  let res = await fetch("/api/blocks-library/save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  let data = await res.json();
  if (res.status === 409) {
    if (!confirm(`Блок "${id}" уже существует. Перезаписать?`)) return;
    res = await fetch("/api/blocks-library/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, force: true }),
    });
    data = await res.json();
  }
  if (res.status !== 200) {
    alert("Не получилось сохранить: " + (data.error || res.status));
    return;
  }
  await loadLibrary();
  closeBlockAuthor();
  // If the edited block is on the canvas, refresh preview so changes show up.
  if (state.canvas.some((c) => c.blockId === id)) scheduleLivePreview(100);
}

$("newBlockBtn")?.addEventListener("click", () => openBlockAuthor(null));
$("authorClose")?.addEventListener("click", closeBlockAuthor);
$("abCancel")?.addEventListener("click", closeBlockAuthor);
$("abSave")?.addEventListener("click", saveAuthorBlock);
["abPug", "abStyl"].forEach((fid) => {
  $(fid)?.addEventListener("input", () => { renderAuthorSlots(); scheduleAuthorPreview(); });
});
["abPlacement", "abId"].forEach((fid) => {
  $(fid)?.addEventListener("input", () => scheduleAuthorPreview());
});

// ─── Wire up ────────────────────────────────────────────────────────────
document.querySelectorAll(".cat-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".cat-tab").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    state.filter = tab.dataset.filter;
    renderCatalog();
  });
});

$("previewBtn").addEventListener("click", preview);
$("saveBtn").addEventListener("click", save);
$("previewClose").addEventListener("click", () => $("previewModal").classList.add("hidden"));
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    $("previewModal").classList.add("hidden");
    if (!$("authorModal").classList.contains("hidden")) closeBlockAuthor();
  }
});

// Device toggle for the live preview.
$("devDesktop")?.addEventListener("click", () => setPreviewDevice("desktop"));
$("devMobile")?.addEventListener("click", () => setPreviewDevice("mobile"));

// Fullscreen: reuse the already-built live HTML if present, else build fresh.
$("previewBtnFs")?.addEventListener("click", () => {
  if (_lastLiveHtml) {
    $("previewModal").classList.remove("hidden");
    $("previewFrame").srcdoc = _lastLiveHtml;
    $("previewStats").textContent = $("livePreviewStatus").textContent;
  } else {
    preview();
  }
});

wireCanvasDnd();
loadLibrary();


// ─── Undo wiring ─────────────────────────────────────────────────────────
document.getElementById("undoBtn")?.addEventListener("click", undoCanvas);
document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && !e.shiftKey && (e.key === "z" || e.key === "Z")) {
    const t = e.target;
    if (t && /^(INPUT|TEXTAREA)$/.test(t.tagName)) return;   // let inputs use native undo
    e.preventDefault();
    undoCanvas();
  }
});

try { console.log('%c[RetKit] constructor build 2026-06-25k: drag-reorder + undo', 'color:#f70;font-weight:bold'); } catch {}
const RETKIT_CONSTRUCTOR_BUILD = '2026-06-25k';
