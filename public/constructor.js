/**
 * constructor.js — block-based email assembly UI.
 *
 * State model:
 *   state = {
 *     library:        [{ id, label, description, placement, category, slots, ... }, ...],
 *     canvas:         [{ uid, blockId, blockSource, parentUid, slotId, slots }, ...],
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
  filter: "outer",
  q: "",
  brand: "all",
  cat: "all",
  mobileOnly: false,
  sourceScope: "curated",
  renderCap: 60,
  railMode: "blocks",
  autoPalette: true,
  sourceSkeleton: null,
  _uidCounter: 1,
};

const $ = (id) => document.getElementById(id);
const TRANSPARENT_PREVIEW_PIXEL = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";

function isUnsafePreviewUrl(url) {
  const v = String(url || "").trim();
  if (!v || v[0] === "#") return false;
  if (/^(?:data:|blob:|cid:|mailto:|tel:)/i.test(v)) return false;
  if (/^https?:\/\//i.test(v)) {
    try {
      return new URL(v).origin === window.location.origin;
    } catch {
      return true;
    }
  }
  if (v.startsWith("//")) return false;
  return true;
}

function sanitizeIframePreviewHtml(html) {
  let s = String(html || "");
  s = s.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "");
  s = s.replace(/<script\b[^>]*\/?>/gi, "");
  s = s.replace(/<\s*(iframe|object|embed)\b[^>]*>[\s\S]*?<\/\s*\1\s*>/gi, "");
  s = s.replace(/<\s*(iframe|object|embed)\b[^>]*\/?>/gi, "");
  s = s.replace(/<base\b[^>]*>/gi, "");
  s = s.replace(/<link\b(?=[^>]*\bhref\s*=\s*(['"])(.*?)\1)[^>]*>/gi, (tag, _q, href) => (
    isUnsafePreviewUrl(href) ? "" : tag
  ));
  s = s.replace(/\s+on[a-z][\w:-]*\s*=\s*"[^"]*"/gi, "");
  s = s.replace(/\s+on[a-z][\w:-]*\s*=\s*'[^']*'/gi, "");
  s = s.replace(/\s+on[a-z][\w:-]*\s*=\s*[^\s>]+/gi, "");
  s = s.replace(/\s(src|poster|background)\s*=\s*(['"])(.*?)\2/gi, (m, attr, q, url) => (
    isUnsafePreviewUrl(url) ? ` ${attr}=${q}${TRANSPARENT_PREVIEW_PIXEL}${q}` : m
  ));
  s = s.replace(/\ssrcset\s*=\s*(['"])(.*?)\1/gi, (m, q, value) => {
    const parts = String(value || "").split(",").map((x) => x.trim()).filter(Boolean);
    const safe = parts.filter((part) => !isUnsafePreviewUrl(part.split(/\s+/)[0]));
    return safe.length ? ` srcset=${q}${safe.join(", ")}${q}` : "";
  });
  return s;
}

const PLACEMENT_ICON = {
  outer:   "🖼️",
  section: "📦",
  inner:   "🧩",
  inline:  "🧩",
  both:    "↕️",
  helper:  "🔧",
};

function nextUid() { return state._uidCounter++; }

function sameUid(a, b) {
  return a != null && b != null && String(a) === String(b);
}

function blockById(id, source) {
  if (source) {
    const exact = state.library.find((b) => b.id === id && b.source === source);
    if (exact) return exact;
  }
  return state.library.find((b) => b.id === id) || null;
}

function blockForEntry(entry) {
  return entry ? blockById(entry.blockId || entry.id, entry.blockSource || entry.source) : null;
}

function entryByUid(uid) {
  return state.canvas.find((entry) => sameUid(entry.uid, uid)) || null;
}

function placementOf(block) {
  const p = block?.placement;
  return p === "inline" ? "inner" : p;
}

function isInnerBlock(block) {
  const p = placementOf(block);
  return p === "inner" || p === "both";
}

function defaultSlotsFor(block, overrides) {
  const slots = {};
  for (const slot of block?.slots || []) {
    if (Object.prototype.hasOwnProperty.call(slot, "default")) slots[slot.id] = slot.default;
  }
  return Object.assign(slots, overrides || {});
}

function childSlotsFor(block) {
  if (Array.isArray(block?.childSlots) && block.childSlots.length) {
    return block.childSlots.map((slot, index) => ({
      id: slot.id || `children-${index + 1}`,
      marker: slot.marker || slot.id || `CHILDREN_${index + 1}`,
      label: slot.label || slot.id || "Содержимое",
      accepts: Array.isArray(slot.accepts) && slot.accepts.length
        ? slot.accepts.map((x) => x === "inline" ? "inner" : x)
        : [placementOf(block) === "outer" ? "section" : "inner"],
    }));
  }
  if (placementOf(block) === "outer") {
    return [{ id: "sections", marker: "SECTIONS", label: "Секции письма", accepts: ["section"] }];
  }
  if (placementOf(block) === "section") {
    if (/\bINNER_BLOCKS\b/.test(String(block?.pug || ""))) {
      return [{ id: "content", marker: "INNER_BLOCKS", label: "Содержимое", accepts: ["inner", "both"] }];
    }
    return [];
  }
  return [];
}

function slotAcceptsBlock(slot, block) {
  const p = placementOf(block);
  return (slot?.accepts || []).some((accept) => accept === p || (p === "both" && accept === "inner"));
}

function chooseChildSlot(parentBlock, childBlock, preferredSlotId) {
  const slots = childSlotsFor(parentBlock);
  if (preferredSlotId) {
    const preferred = slots.find((slot) => slot.id === preferredSlotId);
    if (preferred && slotAcceptsBlock(preferred, childBlock)) return preferred;
  }
  const compatible = slots.filter((slot) => slotAcceptsBlock(slot, childBlock));
  if (compatible.length <= 1) return compatible[0] || null;
  const childHint = `${childBlock?.id || ""} ${childBlock?.category || ""}`.toLowerCase();
  const wantsMedia = /image|logo|media|photo|picture|banner/.test(childHint)
    || (childBlock?.slots || []).some((slot) => slot.kind === "image") && !(childBlock?.slots || []).some((slot) => /text|richText/i.test(slot.kind));
  const semantic = compatible.find((slot) => wantsMedia ? /media|image|visual/.test(slot.id) : /content|text|body/.test(slot.id));
  return semantic || compatible[0] || null;
}

function childrenOf(parentUid, slotId) {
  return state.canvas.filter((entry) => sameUid(entry.parentUid, parentUid) && (!slotId || entry.slotId === slotId));
}

function descendantUids(uid) {
  const out = new Set();
  const visit = (parentUid) => {
    for (const child of childrenOf(parentUid)) {
      if (out.has(String(child.uid))) continue;
      out.add(String(child.uid));
      visit(child.uid);
    }
  };
  visit(uid);
  return out;
}

function rootOuterEntry() {
  return state.canvas.find((entry) => placementOf(blockForEntry(entry)) === "outer" && entry.parentUid == null) || null;
}

function latestSectionEntry(childBlock = null) {
  const selected = entryByUid(state.selectedUid);
  if (selected) {
    const selectedBlock = blockForEntry(selected);
    if (placementOf(selectedBlock) === "section" && (!childBlock || chooseChildSlot(selectedBlock, childBlock))) return selected;
    if (isInnerBlock(selectedBlock)) {
      const parent = entryByUid(selected.parentUid);
      if (placementOf(blockForEntry(parent)) === "section" && (!childBlock || chooseChildSlot(blockForEntry(parent), childBlock))) return parent;
    }
  }
  return [...state.canvas].reverse().find((entry) => (
    placementOf(blockForEntry(entry)) === "section"
    && (!childBlock || chooseChildSlot(blockForEntry(entry), childBlock))
  )) || null;
}

/**
 * Блок, который студия подставляет сама: обёртка при первом добавлении и
 * секция-хозяин для внутреннего блока, положенного в пустой канвас.
 *
 * Сначала ищем среди блоков АКТИВНОГО бренда: подставлять письму IQ Broker
 * секцию IQ Option — значит незаметно смешать две семьи. Замечено на комбо
 * с двойным блоком: в канвас приезжал чужой `iq-section`.
 */
function findDefaultBlock(placement) {
  const fits = (b) => placementOf(b) === placement && b.source !== "parsed";
  const ownBrand = state.library.filter((b) => fits(b) && !blockBelongsToOtherBrand(b));

  const preferred = placement === "outer"
    ? ["iqbr-outer-wrapper", "iq-outer-wrapper"]
    : ["iqbr-section-bordered", "iq-section", "iq-content-section"];
  for (const id of preferred) {
    const block = ownBrand.find((b) => b.id === id);
    if (block) return block;
  }
  return ownBrand[0] || state.library.find(fits) || null;
}

function markEntrySlotExplicit(entry, slotId) {
  if (!entry || !slotId) return;
  const id = String(slotId);
  if (!Array.isArray(entry.explicitSlots)) entry.explicitSlots = [];
  if (!entry.explicitSlots.includes(id)) entry.explicitSlots.push(id);
}

function clearEntrySlotExplicit(entry, slotId) {
  if (!entry || !Array.isArray(entry.explicitSlots)) return;
  const id = String(slotId);
  entry.explicitSlots = entry.explicitSlots.filter((candidate) => candidate !== id);
  if (!entry.explicitSlots.length) delete entry.explicitSlots;
}

function createEntry(block, opts = {}) {
  const entry = {
    uid: opts.uid ?? nextUid(),
    blockId: block.id,
    blockSource: opts.blockSource || block.source || undefined,
    parentUid: opts.parentUid ?? null,
    slotId: opts.slotId || (placementOf(block) === "outer" ? "root" : null),
    slots: defaultSlotsFor(block, opts.slots),
    ...(opts.recipeInstanceId ? { recipeInstanceId: opts.recipeInstanceId } : {}),
  };
  if (Array.isArray(opts.explicitSlots) && opts.explicitSlots.length) {
    entry.explicitSlots = [...new Set(opts.explicitSlots.map(String).filter(Boolean))];
  }
  if (opts.appearance && typeof opts.appearance === "object" && Object.keys(opts.appearance).length) {
    entry.appearance = { ...opts.appearance };
  }
  return entry;
}

function insertEntryAfterSiblings(entry, afterUid, beforeUid) {
  if (beforeUid != null) {
    const before = entryByUid(beforeUid);
    const sameParent = before && sameUid(before.parentUid, entry.parentUid) && before.slotId === entry.slotId;
    if (sameParent) {
      const idx = state.canvas.findIndex((candidate) => sameUid(candidate.uid, before.uid));
      if (idx >= 0) {
        state.canvas.splice(idx, 0, entry);
        return;
      }
    }
  }
  if (afterUid != null) {
    const idx = state.canvas.findIndex((candidate) => sameUid(candidate.uid, afterUid));
    if (idx >= 0) {
      const subtree = descendantUids(afterUid);
      let end = idx + 1;
      while (end < state.canvas.length && subtree.has(String(state.canvas[end].uid))) end += 1;
      state.canvas.splice(end, 0, entry);
      return;
    }
  }
  const siblings = childrenOf(entry.parentUid, entry.slotId);
  if (siblings.length) {
    const last = siblings[siblings.length - 1];
    const idx = state.canvas.findIndex((candidate) => sameUid(candidate.uid, last.uid));
    const subtree = descendantUids(last.uid);
    let end = idx + 1;
    while (end < state.canvas.length && subtree.has(String(state.canvas[end].uid))) end += 1;
    state.canvas.splice(end, 0, entry);
    return;
  }
  const parentIndex = state.canvas.findIndex((candidate) => sameUid(candidate.uid, entry.parentUid));
  state.canvas.splice(parentIndex >= 0 ? parentIndex + 1 : state.canvas.length, 0, entry);
}

function setCatalogFilter(filter, { manual = false } = {}) {
  state.filter = filter;
  state.renderCap = 60;
  document.querySelectorAll(".cat-tab").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.filter === filter);
  });
  updatePaletteAutoButton();
  renderCatalog();
}

function updatePaletteAutoButton() {
  const button = $("paletteAutoBtn");
  if (!button) return;
  button.classList.toggle("active", state.autoPalette);
  button.setAttribute("aria-pressed", String(state.autoPalette));
}

function isComboBlock(block) {
  return block?.combo === true || (block?.tags || []).includes("combo");
}

/**
 * The rail only advances from a ready section container to its inner blocks
 * when that section was chosen in the catalog. Merely selecting a node in the
 * outline/preview must never move the user's catalog tab underneath them.
 * Kept deliberately pure so the interaction policy can be regression-tested.
 */
function shouldAutoOpenInnerForCatalogBlock(block, origin) {
  const combo = block?.combo === true || (block?.tags || []).includes("combo");
  if (origin !== "catalog" || block?.placement !== "section" || combo) return false;
  return (block.childSlots || []).some((slot) =>
    (slot.accepts || []).some((placement) => placement === "inner" || placement === "inline")
  );
}

function canAutoAddCatalogDrop(block, draggingCanvasUid) {
  if (draggingCanvasUid != null || !block) return false;
  const placement = block.placement === "inline" ? "inner" : block.placement;
  return placement === "outer" || placement === "section" || placement === "inner" || placement === "both";
}

function maybeOpenInnerCatalog(block, origin) {
  if (!state.autoPalette || !shouldAutoOpenInnerForCatalogBlock(block, origin)) return;
  setRailMode("blocks");
  setCatalogFilter("inner");
}

function setRailMode(mode) {
  state.railMode = mode === "outline" ? "outline" : "blocks";
  $("blocksModePanel")?.classList.toggle("hidden", state.railMode !== "blocks");
  $("outlineModePanel")?.classList.toggle("hidden", state.railMode !== "outline");
  $("paletteBlocksMode")?.classList.toggle("active", state.railMode === "blocks");
  $("paletteOutlineMode")?.classList.toggle("active", state.railMode === "outline");
  if (state.railMode === "outline") renderCanvas();
}

function selectionPath(entry) {
  const path = [];
  const seen = new Set();
  let current = entry;
  while (current && !seen.has(String(current.uid))) {
    seen.add(String(current.uid));
    const block = blockForEntry(current);
    path.unshift(block?.label || block?.id || current.blockId);
    current = entryByUid(current.parentUid);
  }
  return path;
}

function syncPaletteToSelection() {
  const selected = entryByUid(state.selectedUid);
  const block = blockForEntry(selected);
  let hint = "Начни с обёртки или готового комбо";

  if (!state.canvas.length) {
    hint = "Начни с обёртки, секции или готового комбо";
  } else if (!selected) {
    hint = rootOuterEntry() ? "Добавь следующую секцию или комбо" : hint;
  } else if (placementOf(block) === "outer") {
    hint = "В эту обёртку можно добавить секцию";
  } else if (placementOf(block) === "section") {
    const slots = childSlotsFor(block);
    hint = slots.length > 1
      ? `Добавь содержимое в ${slots.map((x) => x.label).join(" / ")}`
      : slots.length
        ? "Добавь текст, картинку, кнопку или колонки"
        : "Готовый блок без вложений — добавь следующую секцию";
  } else {
    const parent = entryByUid(selected.parentUid);
    hint = parent ? `Следующий блок попадёт рядом в «${selected.slotId || "content"}»` : "Выбери контейнер для блока";
  }

  updatePaletteAutoButton();

  const path = selected ? selectionPath(selected) : ["Письмо"];
  if ($("paletteBreadcrumb")) $("paletteBreadcrumb").textContent = path.join("  ›  ");
  if ($("paletteContextHint")) $("paletteContextHint").textContent = hint;
  $("paletteParentBtn")?.classList.toggle("hidden", !selected?.parentUid);
}

// ─── Catalog ────────────────────────────────────────────────────────────
async function loadLibrary() {
  try {
    const res = await fetch("/api/blocks-library");
    const data = await res.json();
    state.library = Array.isArray(data?.blocks) ? data.blocks : [];
    populateCatalogFilters();
    renderCatalog();
    restoreCanvasState();
    setRailMode(state.railMode);
    syncPaletteToSelection();
  } catch (err) {
    $("catalogList").innerHTML = `<div class="cat-empty">Не удалось загрузить блоки: ${err.message}</div>`;
  }
}

// brand = who the block belongs to: canonical / user, or the source
// category prefix for imported ones (iq, exnova, system, …).
/**
 * Блок принадлежит ДРУГОМУ бренду, чем открытая вкладка?
 *
 * Семья блока помечена тегом (`iq`, `iqbroker`) — он совпадает с blockTag
 * бренда в реестре. Правила ровно два, и оба нужны:
 *   – блок без тега семьи виден всегда (общие, импортированные, свои);
 *   – если тег активного бренда в библиотеке не встречается (X_assembled,
 *     X_preview), фильтр не применяется — иначе каталог опустел бы целиком.
 */
function knownBrandTags() {
  const tags = (window.RetkitBrands?.all?.() || [])
    .map((b) => String(b.blockTag || "").toLowerCase())
    .filter(Boolean);
  return new Set(tags);
}

function blockBelongsToOtherBrand(block) {
  const active = String(window.RetkitBrands?.active?.()?.blockTag || "").toLowerCase();
  if (!active) return false;
  const known = knownBrandTags();
  const tags = (block.tags || []).map((t) => String(t).toLowerCase());
  const owners = tags.filter((t) => known.has(t));
  if (!owners.length) return false;
  // Тег активного бренда ни на одном блоке — фильтровать нечем и незачем.
  if (!state.library.some((b) => (b.tags || []).some((t) => String(t).toLowerCase() === active))) return false;
  return !owners.includes(active);
}

function brandOf(b) {
  if (b.source === "canonical" || b.source === "user") return b.source;
  return String(b.id || "").split("-")[0] || "imported";
}
function hasMobile(b) { return /@media/i.test(b.styl || ""); }

function blockReviewStatus(block) {
  if (block?.source === "canonical") return "approved";
  const status = block?.review?.status;
  return ["draft", "candidate", "approved"].includes(status) ? status : "draft";
}

function blockReviewLabel(block) {
  const status = blockReviewStatus(block);
  if (status === "approved") return "approved";
  if (status === "candidate") return "candidate";
  return "draft";
}

function blockCatalogUsable(block) {
  return block?.source === "canonical"
    || (block?.source === "user" && blockReviewStatus(block) === "approved");
}

function catalogSourceAllowed(block, scope = "curated") {
  if (!block || block.source === "parsed") return false;
  if (block.retired) return false; // устаревшие комбо: скрыты, но остаются в библиотеке для старых писем
  if (scope === "all") return true;
  if (scope === "user") return block.source === "user";
  const reviewStatus = block?.review?.status;
  return block.source === "canonical"
    || (block.source === "user" && reviewStatus === "approved");
}

function applyCatalogFilters() {
  const f = state.filter;
  const q = state.q.trim().toLowerCase();
  return state.library.filter((b) => {
    if (!catalogSourceAllowed(b, state.sourceScope)) return false;
    const isCombo = isComboBlock(b);
    const isComboDivider = b.placement === "section" && (b.tags || []).includes("combo-divider");
    if (f === "combo") { if (!isCombo && !isComboDivider) return false; }
    else if (f !== "all") {
      if (isCombo) return false;
      if (b.placement !== f && b.placement !== "both" && !(f === "inner" && b.placement === "inline")) return false;
    }
    if (state.brand !== "all" && brandOf(b) !== state.brand) return false;
    if (blockBelongsToOtherBrand(b)) return false;
    if (state.cat !== "all" && (b.category || "") !== state.cat) return false;
    if (state.mobileOnly && !hasMobile(b)) return false;
    if (q) {
      const hay = `${b.id} ${b.label || ""} ${b.description || ""} ${b.category || ""} ${b.pug || ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

/**
 * Схлопывание одинаковых на вид блоков в боковой колонке.
 * Группы считает scripts/group-block-duplicates.mjs по перцептивному хешу
 * превью; здесь мы просто оставляем представителя. Ничего не теряется:
 * у плитки есть счётчик, а полный список открывается в галерее.
 */
function collapseDuplicateBlocks(list) {
  const seen = new Set();
  const out = [];
  for (const b of list) {
    const gid = b.preview?.group?.id;
    if (!gid) { out.push(b); continue; }
    if (seen.has(gid)) continue;
    seen.add(gid);
    out.push(list.find((c) => c.preview?.group?.id === gid && c.preview.group.primary) || b);
  }
  return out;
}

function renderCatalog() {
  const list = $("catalogList");
  const unfiltered = applyCatalogFilters();
  const filtered = collapseDuplicateBlocks(unfiltered);
  // Счётчик на карточке считает только те блоки группы, что прошли фильтры:
  // иначе «×8» на плитке, за которой стоит один доступный блок.
  const catalogGroupCounts = new Map();
  for (const b of unfiltered) {
    const gid = b.preview?.group?.id;
    if (gid) catalogGroupCounts.set(gid, (catalogGroupCounts.get(gid) || 0) + 1);
  }
  const counter = $("catCount");
  const sourceTotal = state.library.filter((block) => catalogSourceAllowed(block, state.sourceScope)).length;
  if (counter) {
    const hidden = unfiltered.length - filtered.length;
    const brandLabel = window.RetkitBrands?.active?.()?.label || "";
    const otherBrand = state.library.filter((b) => catalogSourceAllowed(b, state.sourceScope) && blockBelongsToOtherBrand(b)).length;
    counter.textContent = `${filtered.length} из ${sourceTotal} блоков`
      + (hidden > 0 ? ` · ${hidden} одинаковых скрыто` : "")
      + (otherBrand > 0 ? ` · ${otherBrand} чужих брендов скрыто (бренд: ${brandLabel})` : "");
  }
  const sourceWarning = $("catLegacyWarning");
  if (sourceWarning) {
    sourceWarning.classList.toggle("hidden", state.sourceScope === "curated");
    sourceWarning.textContent = state.sourceScope === "user"
      ? "Draft не прошёл release-проверку. Candidate можно изучить и одобрить, но вставлять в письмо можно только approved-блоки. AI-review остаётся советом, не пропуском."
      : "Legacy-блоки вырезаны из старых писем и находятся в карантине: их можно изучить, но нельзя вставить в выпускаемое письмо.";
  }
  if (!filtered.length) {
    list.innerHTML = `<div class="cat-empty">Ничего не найдено. Сбрось фильтры или поменяй запрос.</div>`;
    return;
  }
  list.innerHTML = "";
  const visible = filtered.slice(0, state.renderCap);
  for (const b of visible) {
    const el = document.createElement("div");
    const reviewStatus = blockReviewStatus(b);
    const usable = blockCatalogUsable(b);
    el.className = "cat-item" + (b.source === "user" ? ` cat-item-user review-${reviewStatus}` : "") + (b.source === "imported" ? " cat-item-legacy" : "") + (!usable ? " cat-item-disabled" : "");
    el.draggable = usable;
    el.dataset.blockId = b.id;
    el.dataset.blockSource = b.source || "";
    el.dataset.placement = b.placement || "";
    el.title = usable
      ? "Перетащи на канвас (или клик чтобы добавить в конец)"
      : b.source === "imported"
        ? "Legacy-блок в карантине: скопируй его в «Мои блоки», проверь и одобри перед использованием"
        : "Вставлять можно только approved-блок: исправь release-проверки и нажми ✓";
    const slotCount = (b.slots || []).length;
    const isUser = b.source === "user";
    el.innerHTML = `
      <div class="cat-item-thumb" style="width:100%;height:140px;overflow:hidden;border-radius:8px;background:#fff;margin-bottom:8px;position:relative;display:flex;align-items:flex-start;justify-content:center;">${catalogThumbMarkup(b)}</div>
      <div class="cat-item-head">
        <span class="cat-item-icon">${PLACEMENT_ICON[b.placement] || "📐"}</span>
        <span>${escapeHtml(b.label || b.id)}</span>
        ${isUser ? `<span class="cat-item-badge block-review-badge review-${reviewStatus}" title="Статус ручного блока: ${reviewStatus}">${blockReviewLabel(b)}</span>` : ""}
        ${b.source === "imported" ? `<span class="cat-item-badge" title="Legacy: стили и ассеты из конкретного старого письма">legacy</span>` : ""}
        ${(catalogGroupCounts.get(b.preview?.group?.id) || 1) > 1 ? `<span class="cat-item-badge" title="Ещё ${catalogGroupCounts.get(b.preview.group.id) - 1} блоков выглядят так же — открой каталог плиткой">×${catalogGroupCounts.get(b.preview.group.id)}</span>` : ""}
        <button class="cat-item-view" data-view-id="${escapeHtml(b.id)}" title="Посмотреть исходник (pug/styl/слоты)">👁</button>
        ${isUser && reviewStatus === "candidate" ? `<button class="cat-item-approve" data-approve-id="${escapeHtml(b.id)}" title="Повторно проверить и перевести в approved">✓</button>` : ""}
        ${isUser ? `<button class="cat-item-edit" data-edit-id="${escapeHtml(b.id)}" title="Редактировать pug/styl/слоты этого блока">✎</button>` : ""}
        ${isUser ? `<button class="cat-item-del" data-del-id="${escapeHtml(b.id)}" title="Удалить этот user-блок">✕</button>` : ""}
      </div>
      <div class="cat-item-desc">${escapeHtml(b.description || "")}${b.source === "imported" ? `<div class="cat-legacy-note">Картинки и CSS из исходной кампании — проверь перед использованием.</div>` : ""}</div>
      <div class="cat-item-meta">
        <span class="pill">${b.placement || "?"}</span>
        <span class="pill">${b.category || "?"}</span>
        <span class="pill pill-brand">${escapeHtml(brandOf(b))}</span>
        <span class="pill">${slotCount} slot${slotCount === 1 ? "" : "s"}</span>
        ${hasMobile(b) ? `<span class="pill pill-mobile" title="Есть мобильные @media правила">📱</span>` : ""}
        ${b.preview && b.preview.signature ? `<span class="pill" title="Высота блока на 600px">${b.preview.signature.height}px</span>` : ""}
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
      // Клик по самой картинке — это «покажи крупно», а не «добавь в письмо».
      // Человек первым делом тыкает в превью, чтобы разглядеть блок.
      if (e.target.closest(".cat-item-thumb")) {
        e.stopPropagation();
        openBlockView(b);
        return;
      }
      const viewBtn = e.target.closest(".cat-item-view");
      if (viewBtn) {
        e.stopPropagation();
        const blk = state.library.find((x) => x.id === viewBtn.dataset.viewId);
        if (blk) openBlockView(blk);
        return;
      }
      const editBtn = e.target.closest(".cat-item-edit");
      if (editBtn) {
        e.stopPropagation();
        const blk = state.library.find((x) => x.id === editBtn.dataset.editId);
        if (blk) openBlockAuthor(blk);
        return;
      }
      const approveBtn = e.target.closest(".cat-item-approve");
      if (approveBtn) {
        e.stopPropagation();
        approveUserBlock(approveBtn.dataset.approveId);
        return;
      }
      if (!usable) {
        alert("Этот блок пока draft: он не прошёл проверку Pug/Stylus или контрактов слотов. Открой ✎, исправь ошибку и сохрани снова.");
        return;
      }
      addToCanvas(b, { origin: "catalog" });
    });
    el.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      openCatalogContextMenu(e.clientX, e.clientY, b);
    });
    el.addEventListener("dragstart", (e) => {
      if (!usable) { e.preventDefault(); return; }
      e.dataTransfer.effectAllowed = "copy";
      e.dataTransfer.setData("application/x-retkit-block", b.id);
      e.dataTransfer.setData("application/x-retkit-block-source", b.source || "");
      // Also set text/plain as fallback for browsers that strip the custom type.
      e.dataTransfer.setData("text/plain", b.id);
      _draggingBlockId = b.id;
      _draggingBlockSource = b.source || "";
      _draggingPlacement = b.placement || "";
      document.body.classList.add("dragging-from-catalog");
      document.body.dataset.dragPlacement = b.placement || "";
    });
    el.addEventListener("dragend", () => {
      _draggingBlockId = null;
      _draggingBlockSource = "";
      _draggingPlacement = "";
      document.body.classList.remove("dragging-from-catalog");
      delete document.body.dataset.dragPlacement;
      clearDropIndicators();
      clearIframeDropLine();
    });
    list.appendChild(el);
    // Пререндеренное превью уже в разметке. Живая сборка остаётся только для
    // блоков без картинки — например, только что сохранённого user-блока,
    // который ещё не попал в прогон render-block-previews.
    if (!(b.preview && b.preview.status === "ok" && b.preview.desktop)) {
      try { _thumbObserver.observe(el); } catch {}
    }
  }
  if (filtered.length > state.renderCap) {
    const more = document.createElement("button");
    more.className = "btn cat-more-btn";
    more.textContent = `Показать ещё (${filtered.length - state.renderCap})`;
    more.addEventListener("click", () => { state.renderCap += 60; renderCatalog(); });
    list.appendChild(more);
  }
}

/* ─── Большой каталог плиткой ────────────────────────────────────────────
 * Узкая колонка слева годится, когда блоков десяток. При тысяче искать в
 * ней невозможно: карточки идут в один столбец, превью ужато до 140px.
 * Галерея — то же содержимое, но во весь экран, плиткой и с поиском.
 *
 * Два принципиальных отличия от боковой колонки:
 *   1. одинаковые на вид блоки схлопнуты в одну плитку (группировка по
 *      перцептивному хешу превью, см. scripts/group-block-duplicates.mjs) —
 *      иначе половина экрана это 79 одинаковых «Текстовый абзац»;
 *   2. по умолчанию показываем только то, что можно положить в текущее
 *      место письма, но одним кликом снимаем это ограничение — человек
 *      должен видеть, что библиотека больше, чем ему сейчас предлагают.
 */
let _galleryState = { query: "", cat: "all", showAll: false, expandedGroup: null, ignoreContext: false };

function openBlockGallery() {
  closeBlockGallery();
  const overlay = document.createElement("div");
  overlay.className = "gallery-overlay";
  overlay.id = "blockGallery";
  overlay.innerHTML = `
    <div class="gallery-box" role="dialog" aria-label="Каталог блоков">
      <header class="gallery-head">
        <input id="galleryQuery" class="gallery-search" type="search" autocomplete="off"
               placeholder="Поиск: название, id, тег, категория…" />
        <select id="galleryCat" class="gallery-select" aria-label="Категория"></select>
        <label class="gallery-toggle" title="Показать блоки, которые не подходят в выбранное место">
          <input type="checkbox" id="galleryIgnoreContext" /> вся библиотека
        </label>
        <label class="gallery-toggle" title="Не схлопывать одинаковые на вид блоки">
          <input type="checkbox" id="galleryShowAll" /> показывать дубли
        </label>
        <span class="gallery-count" id="galleryCount"></span>
        <button class="btn" id="galleryClose" type="button" title="Закрыть (Esc)">✕</button>
      </header>
      <div class="gallery-grid" id="galleryGrid"></div>
    </div>`;
  document.body.appendChild(overlay);

  const cats = [...new Set(state.library.map((b) => b.category).filter(Boolean))].sort();
  $("galleryCat").innerHTML = `<option value="all">все категории</option>`
    + cats.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
  $("galleryCat").value = _galleryState.cat;
  $("galleryQuery").value = _galleryState.query;
  $("galleryIgnoreContext").checked = _galleryState.ignoreContext;
  $("galleryShowAll").checked = _galleryState.showAll;

  $("galleryQuery").addEventListener("input", (e) => { _galleryState.query = e.target.value; renderGallery(); });
  $("galleryCat").addEventListener("change", (e) => { _galleryState.cat = e.target.value; renderGallery(); });
  $("galleryIgnoreContext").addEventListener("change", (e) => { _galleryState.ignoreContext = e.target.checked; renderGallery(); });
  $("galleryShowAll").addEventListener("change", (e) => { _galleryState.showAll = e.target.checked; renderGallery(); });
  $("galleryClose").addEventListener("click", closeBlockGallery);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeBlockGallery(); });
  document.addEventListener("keydown", galleryEscHandler, true);

  renderGallery();
  setTimeout(() => $("galleryQuery")?.focus(), 30);
}

function galleryEscHandler(e) {
  if (e.key !== "Escape") return;
  if (!document.getElementById("blockGallery")) return;
  if (_galleryState.expandedGroup) { _galleryState.expandedGroup = null; renderGallery(); e.stopPropagation(); return; }
  closeBlockGallery();
  e.stopPropagation();
}

function closeBlockGallery() {
  document.getElementById("blockGallery")?.remove();
  document.removeEventListener("keydown", galleryEscHandler, true);
  _galleryState.expandedGroup = null;
}

/** Блоки для галереи с учётом всех фильтров и схлопывания групп. */
function galleryBlocks() {
  const q = _galleryState.query.trim().toLowerCase();
  // Контекстный фильтр — тот же, что у боковой колонки: галерея не должна
  // предлагать положить секцию внутрь текстового блока.
  let list = _galleryState.ignoreContext
    ? state.library.filter((b) => catalogSourceAllowed(b, state.sourceScope))
    : applyCatalogFilters();

  if (_galleryState.cat !== "all") list = list.filter((b) => b.category === _galleryState.cat);
  if (q) {
    list = list.filter((b) => [b.label, b.id, b.description, b.category, ...(b.tags || [])]
      .filter(Boolean).join(" ").toLowerCase().includes(q));
  }

  if (_galleryState.expandedGroup) {
    return list.filter((b) => b.preview?.group?.id === _galleryState.expandedGroup);
  }
  if (_galleryState.showAll) return list;

  // Схлопывание: оставляем представителя группы. Если он отфильтрован
  // (не подходит по контексту или поиску), представителем становится первый
  // уцелевший — иначе целая группа молча исчезла бы из выдачи.
  const seen = new Set();
  const out = [];
  for (const b of list) {
    const gid = b.preview?.group?.id;
    if (!gid) { out.push(b); continue; }
    if (seen.has(gid)) continue;
    seen.add(gid);
    out.push(list.find((c) => c.preview?.group?.id === gid && c.preview.group.primary) || b);
  }
  return out;
}

/** gid → сколько блоков этой группы проходит текущие фильтры галереи. */
function groupCountsForVisible() {
  const saved = _galleryState.expandedGroup;
  _galleryState.expandedGroup = null;
  const showAll = _galleryState.showAll;
  _galleryState.showAll = true;                 // без схлопывания — считаем всех
  const counts = new Map();
  for (const b of galleryBlocks()) {
    const gid = b.preview?.group?.id;
    if (gid) counts.set(gid, (counts.get(gid) || 0) + 1);
  }
  _galleryState.showAll = showAll;
  _galleryState.expandedGroup = saved;
  return counts;
}

function renderGallery() {
  const grid = $("galleryGrid");
  if (!grid) return;
  const list = galleryBlocks();
  // Бейдж «ещё N» должен считать только те блоки, которые человек реально
  // увидит при раскрытии. Группа может быть из 8 блоков, но если 7 из них
  // отсечены источником или поиском, обещать «ещё 7» — врать.
  const visibleInGroup = groupCountsForVisible();
  const total = state.library.filter((b) => catalogSourceAllowed(b, state.sourceScope)).length;

  const counter = $("galleryCount");
  if (counter) {
    counter.textContent = _galleryState.expandedGroup
      ? `${list.length} похожих блоков · Esc чтобы вернуться`
      : `${list.length} из ${total}`;
  }

  if (!list.length) {
    grid.innerHTML = `<div class="gallery-empty">Ничего не нашлось.
      ${_galleryState.ignoreContext ? "" : "Попробуй включить «вся библиотека» — сейчас показаны только блоки, подходящие в выбранное место."}</div>`;
    return;
  }

  grid.innerHTML = list.map((b) => {
    const group = b.preview?.group;
    const sameLook = group ? (visibleInGroup.get(group.id) || 1) : 1;
    const dupes = group && !_galleryState.showAll && !_galleryState.expandedGroup && sameLook > 1
      ? `<button class="gallery-dupes" data-group="${escapeHtml(group.id)}"
           title="Показать ${sameLook - 1} блоков, которые выглядят так же">ещё ${sameLook - 1}</button>`
      : "";
    const usable = blockCatalogUsable(b);
    const sig = b.preview?.signature;
    return `
      <figure class="gallery-tile${usable ? "" : " disabled"}" data-block-id="${escapeHtml(b.id)}"
              data-block-source="${escapeHtml(b.source || "")}" tabindex="0">
        <div class="gallery-thumb">${catalogThumbMarkup(b)}${dupes}</div>
        <figcaption>
          <div class="gallery-title">${escapeHtml(b.label || b.id)}</div>
          <div class="gallery-meta">
            <span class="pill">${escapeHtml(b.placement || "?")}</span>
            <span class="pill">${escapeHtml(b.category || "?")}</span>
            ${sig ? `<span class="pill">${sig.height}px</span>` : ""}
            ${b.source === "imported" ? `<span class="pill">legacy</span>` : ""}
          </div>
        </figcaption>
      </figure>`;
  }).join("");

  grid.querySelectorAll(".gallery-tile").forEach((tile) => {
    const pick = () => {
      const b = blockById(tile.dataset.blockId, tile.dataset.blockSource);
      if (!b) return;
      if (!blockCatalogUsable(b)) { flashCanvasHint("Этот блок пока draft — открой его код и исправь ошибки"); return; }
      addToCanvas(b, { origin: "gallery" });
      flashCanvasHint(`Добавлено: ${b.label || b.id}`);
    };
    tile.addEventListener("click", (e) => {
      const dupBtn = e.target.closest(".gallery-dupes");
      if (dupBtn) { _galleryState.expandedGroup = dupBtn.dataset.group; renderGallery(); return; }
      pick();
    });
    tile.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); }
    });
  });
}

/* ─── Block source view modal ─────────────────────────────────────── */
let _viewBlock = null;
function openBlockView(b) {
  _viewBlock = b;
  $("viewTitle").textContent = `👁 ${b.label || b.id} — ${b.id}`;
  $("viewMeta").innerHTML = [
    ["placement", b.placement], ["category", b.category], ["источник", brandOf(b)],
    ...(b.source === "user" ? [["review", blockReviewStatus(b)]] : []),
    ["используется в", (b.usageCount || 0) + " письмах"],
    ["мобильные стили", hasMobile(b) ? "да" : "нет"],
  ].map(([k, v]) => `<span class="pill">${escapeHtml(k)}: ${escapeHtml(String(v ?? "?"))}</span>`).join(" ")
    + signaturePillsMarkup(b)
    + previewPairMarkup(b);
  $("viewPug").textContent = b.pug || "";
  $("viewStyl").textContent = b.styl || "(нет)";
  $("viewSlots").innerHTML = (b.slots || []).length
    ? b.slots.map((sl) => `<span class="pill" title="${escapeHtml(sl.kind || "text")}">${escapeHtml(sl.id)}${sl.default != null ? " = " + escapeHtml(String(sl.default).slice(0, 40)) : ""}</span>`).join(" ")
    : "<span class='cat-empty'>нет слотов</span>";
  $("viewModal").classList.remove("hidden");
  wireBlockViewTabs(b);
}
function closeBlockView() { $("viewModal").classList.add("hidden"); _viewBlock = null; }
function duplicateToUserBlock(b) {
  if (!b) return;
  // Editable copy: new user id, author modal opens prefilled, id editable.
  const copy = {
    ...b,
    id: `${b.id}-copy`,
    label: `${b.label || b.id} (копия)`,
    source: "user",
  };
  closeBlockView();
  openBlockAuthor(copy, { asNew: true });
}

/* ─── Пререндеренные превью блоков ──────────────────────────────────────────
 * Картинки делает scripts/render-block-previews.mjs, сервер отдаёт их из
 * data/block-previews. Раньше каждая карточка запускала полную сборку письма
 * (~1.6 с в подпроцессе) и при любой ошибке молча пряталась — сломанный блок
 * выглядел ровно как нормальный. Теперь: картинка сразу, а если превью не
 * собралось — честный бейдж с причиной.
 */
function catalogThumbMarkup(b) {
  const p = b && b.preview;
  if (p && p.status === "ok" && p.desktop) {
    const alt = escapeHtml(`${b.label || b.id} — превью блока`);
    return `<img class="cat-thumb-img" src="${escapeHtml(p.desktop.url)}" alt="${alt}" loading="lazy" decoding="async"
      style="width:100%;height:auto;display:block;object-fit:cover;object-position:top center;">`;
  }
  if (p && p.status === "failed") {
    return `<span class="cat-thumb-failed" title="${escapeHtml(p.error || "")}"
      style="align-self:center;color:#c2410c;font-size:11px;text-align:center;padding:0 8px;line-height:1.35">
      превью не собралось<br><span style="color:#9aa3b2">блок не рендерится</span></span>`;
  }
  // Нет записи в индексе — блок новый; ниже подхватит живой iframe-фолбэк.
  return `<span style="color:#9aa3b2;font-size:11px;align-self:center">…</span>`;
}

/** Визуальная сигнатура блока пилюлями — то же, что видит AI. */
function signaturePillsMarkup(b) {
  const sig = b && b.preview && b.preview.signature;
  if (!sig) return "";
  const pills = (sig.tags || []).map((t) => `<span class="pill">${escapeHtml(t)}</span>`).join(" ");
  const swatches = (sig.palette || []).slice(0, 4).map((hex) =>
    `<span title="${escapeHtml(hex)}" style="display:inline-block;width:14px;height:14px;border-radius:3px;border:1px solid #d1d5db;background:${escapeHtml(hex)};vertical-align:middle"></span>`
  ).join(" ");
  return `<div style="margin-top:6px">${pills} ${swatches}</div>`;
}

/**
 * Крупный просмотр блока: одна большая картинка и переключатель ширины.
 *
 * Две маленькие картинки рядом (как было) не отвечали на вопрос «что это за
 * блок»: превью высотой в сотню пикселей нечитаемо. Здесь блок показан в
 * натуральную величину колонки письма, с прокруткой если он длинный.
 */
function previewPairMarkup(b) {
  const p = b && b.preview;
  if (p && p.status === "failed") {
    return `<div class="block-view-preview-failed">Превью не собралось: ${escapeHtml(p.error || "неизвестная причина")}</div>`;
  }
  if (!p || p.status !== "ok" || !p.desktop) return "";
  const has = (s) => Boolean(s && s.url);
  return `
    <div class="block-view-preview">
      <div class="block-view-tabs">
        <button type="button" class="block-view-tab active" data-shot="desktop">🖥 Десктоп · ${p.desktop.width}×${p.desktop.height}</button>
        ${has(p.mobile) ? `<button type="button" class="block-view-tab" data-shot="mobile">📱 Мобильный · ${p.mobile.width}×${p.mobile.height}</button>` : ""}
      </div>
      <div class="block-view-stage">
        <img id="blockViewShot" src="${escapeHtml(p.desktop.url)}" alt="Превью блока">
      </div>
    </div>`;
}

/** Переключение desktop/mobile в окне просмотра блока. */
function wireBlockViewTabs(block) {
  const root = document.getElementById("viewMeta");
  if (!root) return;
  const img = root.querySelector("#blockViewShot");
  if (!img) return;
  root.querySelectorAll(".block-view-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      const shot = block?.preview?.[tab.dataset.shot];
      if (!shot?.url) return;
      img.src = shot.url;
      root.querySelectorAll(".block-view-tab").forEach((t) => t.classList.toggle("active", t === tab));
    });
  });
}

// ─── Lazy block thumbnails (live mini-render via /api/compose-preview) ──────
const _thumbCache = new Map();
let _thumbRequestCounter = 0;
const _thumbObserver = (typeof IntersectionObserver !== "undefined")
  ? new IntersectionObserver((entries) => {
      for (const en of entries) {
        if (en.isIntersecting) { _thumbObserver.unobserve(en.target); loadBlockThumb(en.target); }
      }
    }, { rootMargin: "300px" })
  : { observe(){}, unobserve(){} };

async function loadBlockThumb(el) {
  const id = el.dataset.blockId;
  const source = el.dataset.blockSource || "";
  const holder = el.querySelector(".cat-item-thumb");
  if (!id || !holder) return;
  const _bt = blockById(id, source);
  if (_bt && _bt.placement === "outer") { holder.style.display = "none"; return; }
  try {
    const cacheKey = `${source}:${id}`;
    let html = _thumbCache.get(cacheKey);
    if (!html) {
      const spec = { id };
      if (_bt && _bt.source !== "canonical") {
        spec.def = { id: _bt.id, label: _bt.label, placement: _bt.placement, pug: _bt.pug, styl: _bt.styl || "", slots: _bt.slots || [], childSlots: _bt.childSlots || [], appearance: _bt.appearance || {} };
      }
      const r = await fetch("/api/compose-preview", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mailName: `thumb-${String(id).replace(/[^a-z0-9_-]/gi, "-")}-${++_thumbRequestCounter}`, blocks: [spec] }),
      });
      const j = await r.json();
      if (!j || !j.ok || !j.html) { holder.style.display = "none"; return; }
      html = j.html; _thumbCache.set(cacheKey, html);
    }
    holder.innerHTML = "";
    const f = document.createElement("iframe");
    f.setAttribute("sandbox", "");
    f.setAttribute("scrolling", "no");
    f.style.cssText = "width:600px;min-height:760px;border:0;transform:scale(.43);transform-origin:top center;pointer-events:none;background:#fff;";
    holder.appendChild(f);
    f.srcdoc = sanitizeIframePreviewHtml(html);
  } catch { holder.style.display = "none"; }
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
  syncPaletteToSelection();
  scheduleLivePreview();
  const btn = document.getElementById("undoBtn");
  if (btn) btn.disabled = _canvasUndo.length === 0;
}

function ensureOuterForMutation() {
  const existing = rootOuterEntry();
  if (existing) return existing;
  const outer = findDefaultBlock("outer");
  if (!outer) return null;
  const entry = createEntry(outer, { parentUid: null, slotId: "root" });
  state.canvas.unshift(entry);
  return entry;
}

function finishCanvasMutation(selectedUid, catalogBlock = null, origin = null) {
  if (selectedUid != null) state.selectedUid = selectedUid;
  renderCanvas();
  renderInspector();
  syncPaletteToSelection();
  maybeOpenInnerCatalog(catalogBlock, origin);
  scheduleLivePreview();
}

function instantiateCombo(block, opts = {}) {
  const recipeInstanceId = `recipe-${nextUid()}`;
  const outer = ensureOuterForMutation();
  let container = null;
  let last = null;
  let lastSection = null;
  let firstSection = true;
  const roleEntries = new Map();

  for (const child of block.children || []) {
    const def = blockById(child.id, child.source);
    if (!def) continue;
    const placement = placementOf(def);
    let parent = null;
    let slot = null;

    // Блок с размещением «both» (отбивка) годится и в секции, и внутрь.
    // Раньше он всегда шёл по внутреннему пути: если подходящего контейнера
    // не было, движок создавал ДЕФОЛТНУЮ секцию — из чужого бренда — и прятал
    // отбивку в неё. Решает не размещение, а есть ли куда положить внутрь.
    const fitsCurrentContainer = placement === "both"
      && container
      && Boolean(chooseChildSlot(blockForEntry(container), def, child.slotId));
    const asSection = placement === "section"
      || (placement === "both" && !child.parentRole && !fitsCurrentContainer);

    if (placement === "outer") {
      const current = rootOuterEntry();
      if (current) {
        current.blockId = def.id;
        current.blockSource = def.source || undefined;
        current.slots = defaultSlotsFor(def, child.slots);
        if (Array.isArray(child.explicitSlots) && child.explicitSlots.length) {
          current.explicitSlots = [...new Set(child.explicitSlots.map(String).filter(Boolean))];
        } else {
          delete current.explicitSlots;
        }
        current.appearance = child.appearance && typeof child.appearance === "object" ? { ...child.appearance } : {};
        current.recipeInstanceId = recipeInstanceId;
        last = current;
        roleEntries.set(child.role || "outer", current);
        continue;
      }
    } else if (asSection) {
      const requestedParent = opts.parentUid != null ? entryByUid(opts.parentUid) : null;
      parent = placementOf(blockForEntry(requestedParent)) === "outer" ? requestedParent : outer;
      slot = chooseChildSlot(blockForEntry(parent), def, firstSection ? (opts.slotId || child.slotId) : child.slotId);
    } else {
      // Родителем может быть не только секция, но и inner-контейнер —
      // например двойной блок с колонками. Раньше такой parentRole молча
      // отбрасывался (проверялось placement), и рецепт «карточка → две
      // колонки → содержимое колонок» собрать было нельзя. Важно не
      // размещение родителя, а наличие у него подходящего слота.
      parent = child.parentRole ? roleEntries.get(child.parentRole) : null;
      if (parent && !chooseChildSlot(blockForEntry(parent), def, child.slotId)) parent = null;
      if (!parent) parent = container || latestSectionEntry(def);
      if (parent && !chooseChildSlot(blockForEntry(parent), def, child.slotId)) parent = latestSectionEntry(def);
      if (!parent) {
        const sectionDef = findDefaultBlock("section");
        if (sectionDef && outer) {
          const outerSlot = chooseChildSlot(blockForEntry(outer), sectionDef);
          parent = createEntry(sectionDef, { parentUid: outer.uid, slotId: outerSlot?.id || "sections", recipeInstanceId });
          insertEntryAfterSiblings(parent);
          container = parent;
        }
      }
      slot = chooseChildSlot(blockForEntry(parent), def, child.slotId);
    }

    if (placement !== "outer" && (!parent || !slot)) continue;
    const entry = createEntry(def, {
      parentUid: parent?.uid ?? null,
      slotId: slot?.id || "root",
      slots: child.slots,
      explicitSlots: child.explicitSlots,
      appearance: child.appearance,
      recipeInstanceId,
    });
    const followsLast = last && sameUid(last.parentUid, entry.parentUid) && last.slotId === entry.slotId;
    const sectionAfter = asSection && lastSection ? lastSection.uid : undefined;
    insertEntryAfterSiblings(
      entry,
      followsLast ? last.uid : sectionAfter ?? (firstSection ? opts.afterUid : undefined),
      asSection && firstSection ? opts.beforeUid : undefined,
    );
    if (asSection) {
      // Контейнером считаем только настоящую секцию: отбивка ничего в себя
      // не принимает, и следующий внутренний блок должен идти в карточку.
      if (placement === "section") container = entry;
      lastSection = entry;
      firstSection = false;
    }
    if (child.role) roleEntries.set(child.role, entry);
    last = entry;
  }
  return last || container || outer;
}

function addToCanvas(block, options = {}) {
  if (!block) return;
  const opts = (typeof options === "number") ? {} : (options || {});
  pushCanvasUndo();

  if (Array.isArray(block.children) && block.children.length) {
    const selected = instantiateCombo(block, opts);
    finishCanvasMutation(selected?.uid, block, opts.origin);
    return;
  }

  const placement = placementOf(block);
  if (placement === "outer") {
    const existing = rootOuterEntry();
    if (existing) {
      existing.blockId = block.id;
      existing.blockSource = block.source || undefined;
      existing.slots = defaultSlotsFor(block, opts.slots);
      if (Array.isArray(opts.explicitSlots) && opts.explicitSlots.length) {
        existing.explicitSlots = [...new Set(opts.explicitSlots.map(String).filter(Boolean))];
      } else {
        delete existing.explicitSlots;
      }
      existing.slotId = "root";
      finishCanvasMutation(existing.uid, block, opts.origin);
      return;
    }
    const entry = createEntry(block, { parentUid: null, slotId: "root", slots: opts.slots, explicitSlots: opts.explicitSlots });
    state.canvas.unshift(entry);
    finishCanvasMutation(entry.uid, block, opts.origin);
    return;
  }

  const outer = ensureOuterForMutation();
  if (!outer) {
    _canvasUndo.pop();
    alert("В библиотеке нет блока-обёртки. Сначала добавь outer-блок.");
    return;
  }

  let parent = opts.parentUid != null ? entryByUid(opts.parentUid) : null;
  let slot = parent ? chooseChildSlot(blockForEntry(parent), block, opts.slotId) : null;

  if (placement === "section") {
    parent = outer;
    slot = chooseChildSlot(blockForEntry(outer), block, opts.slotId);
  } else if (!parent || !slot) {
    const selected = entryByUid(state.selectedUid);
    const selectedBlock = blockForEntry(selected);
    if (placementOf(selectedBlock) === "section") parent = selected;
    else if (isInnerBlock(selectedBlock)) parent = entryByUid(selected.parentUid);
    if (!parent || placementOf(blockForEntry(parent)) !== "section" || !chooseChildSlot(blockForEntry(parent), block, opts.slotId)) {
      parent = latestSectionEntry(block);
    }
    if (!parent) {
      const sectionDef = findDefaultBlock("section");
      const outerSlot = chooseChildSlot(blockForEntry(outer), sectionDef);
      if (sectionDef && outerSlot) {
        parent = createEntry(sectionDef, { parentUid: outer.uid, slotId: outerSlot.id });
        insertEntryAfterSiblings(parent);
      }
    }
    slot = chooseChildSlot(blockForEntry(parent), block, opts.slotId);
  }

  if (!parent || !slot) {
    _canvasUndo.pop();
    alert(`Блок «${block.label || block.id}» нельзя вставить в выбранный контейнер.`);
    return;
  }

  const entry = createEntry(block, {
    parentUid: parent.uid,
    slotId: slot.id,
    slots: opts.slots,
    explicitSlots: opts.explicitSlots,
    recipeInstanceId: opts.recipeInstanceId,
  });
  insertEntryAfterSiblings(entry, opts.afterUid, opts.beforeUid);
  finishCanvasMutation(entry.uid, block, opts.origin);
}

function moveCanvasUid(uid, toIndex) {
  const entry = entryByUid(uid);
  if (!entry || entry.parentUid == null) return;
  const target = state.canvas[Math.max(0, Math.min(Number(toIndex) || 0, state.canvas.length - 1))] || null;
  const targetParent = target?.parentUid != null ? entryByUid(target.parentUid) : entryByUid(entry.parentUid);
  const targetSlotId = target?.slotId || entry.slotId;
  const slot = chooseChildSlot(blockForEntry(targetParent), blockForEntry(entry), targetSlotId);
  if (!targetParent || !slot || descendantUids(entry.uid).has(String(targetParent.uid))) return;
  pushCanvasUndo();
  entry.parentUid = targetParent.uid;
  entry.slotId = slot.id;
  moveSubtreeBefore(entry.uid, target && !sameUid(target.uid, entry.uid) ? target.uid : null);
  finishCanvasMutation(entry.uid);
}

function removeFromCanvas(uid) {
  pushCanvasUndo();
  const entry = entryByUid(uid);
  if (!entry) { _canvasUndo.pop(); return; }
  const removeIds = descendantUids(uid);
  removeIds.add(String(uid));
  state.canvas = state.canvas.filter((candidate) => !removeIds.has(String(candidate.uid)));
  if (removeIds.has(String(state.selectedUid))) state.selectedUid = entry.parentUid ?? null;
  finishCanvasMutation(state.selectedUid);
}

function clearCanvas() {
  if (!state.canvas.length) return;
  if (!confirm("Очистить всё письмо? Все блоки на канве будут удалены.")) return;
  pushCanvasUndo();
  state.canvas = [];
  state.selectedUid = null;
  state.sourceSkeleton = null;
  renderCanvas();
  renderInspector();
  syncPaletteToSelection();
  scheduleLivePreview();
}

function moveInCanvas(uid, delta) {
  const entry = entryByUid(uid);
  if (!entry || entry.parentUid == null) return;
  const siblings = childrenOf(entry.parentUid, entry.slotId);
  const index = siblings.findIndex((candidate) => sameUid(candidate.uid, uid));
  const targetIndex = index + delta;
  if (index < 0 || targetIndex < 0 || targetIndex >= siblings.length) return;
  pushCanvasUndo();
  const order = siblings.map((candidate) => candidate.uid);
  [order[index], order[targetIndex]] = [order[targetIndex], order[index]];
  rebuildCanvasOrder(entry.parentUid, entry.slotId, order);
  finishCanvasMutation(entry.uid);
}

function selectCanvas(uid) {
  state.selectedUid = uid;
  renderCanvas();
  renderInspector();
  syncPaletteToSelection();
  applyIframeSelection();
}

function moveSubtreeBefore(uid, beforeUid) {
  const ids = descendantUids(uid);
  ids.add(String(uid));
  const bundle = state.canvas.filter((entry) => ids.has(String(entry.uid)));
  const remaining = state.canvas.filter((entry) => !ids.has(String(entry.uid)));
  const beforeIndex = beforeUid == null
    ? remaining.length
    : remaining.findIndex((entry) => sameUid(entry.uid, beforeUid));
  remaining.splice(beforeIndex >= 0 ? beforeIndex : remaining.length, 0, ...bundle);
  state.canvas = remaining;
  normalizeCanvasOrder();
}

function rebuildCanvasOrder(parentUid, slotId, orderedUids) {
  const rank = new Map(orderedUids.map((uid, index) => [String(uid), index]));
  normalizeCanvasOrder({ parentUid, slotId, rank });
}

function normalizeCanvasOrder(override) {
  const original = [...state.canvas];
  const emitted = new Set();
  const out = [];
  const direct = (parentUid) => original.filter((entry) => (
    parentUid == null ? entry.parentUid == null : sameUid(entry.parentUid, parentUid)
  ));
  const visit = (entry) => {
    if (!entry || emitted.has(String(entry.uid))) return;
    emitted.add(String(entry.uid));
    out.push(entry);
    let kids = direct(entry.uid);
    if (override && sameUid(override.parentUid, entry.uid)) {
      kids = kids.sort((a, b) => {
        if (a.slotId !== override.slotId || b.slotId !== override.slotId) return 0;
        return (override.rank.get(String(a.uid)) ?? 99999) - (override.rank.get(String(b.uid)) ?? 99999);
      });
    }
    const slotOrder = childSlotsFor(blockForEntry(entry)).map((slot) => slot.id);
    kids.sort((a, b) => {
      const ai = slotOrder.indexOf(a.slotId), bi = slotOrder.indexOf(b.slotId);
      if (ai < 0 && bi < 0) return 0;
      if (ai < 0) return 1;
      if (bi < 0) return -1;
      return ai - bi;
    });
    kids.forEach(visit);
  };
  direct(null).forEach(visit);
  original.forEach(visit);
  state.canvas = out;
}

/**
 * Мини-превью на карточке блока в дереве. Дерево из десяти строк «Текст ·
 * inner · 7 полей» нечитаемо: по названию блоки не отличаются, особенно
 * внутренние. Берём пререндеренную картинку; если её нет (только что
 * созданный user-блок) — оставляем иконку размещения, как было.
 */
function canvasCardThumbMarkup(block) {
  const shot = block?.preview?.status === "ok" && block.preview.desktop;
  if (!shot) return `<span class="canvas-card-icon">${PLACEMENT_ICON[block.placement] || "📐"}</span>`;
  return `<span class="canvas-card-thumb" title="${escapeHtml(block.label || block.id)}">
      <img src="${escapeHtml(shot.url)}" alt="" loading="lazy" decoding="async">
    </span>`;
}

function makeCanvasCard(entry, block) {
  const li = document.createElement("li");
  li.className = "canvas-card" + (sameUid(entry.uid, state.selectedUid) ? " selected" : "");
  li.draggable = true;
  li.dataset.uid = String(entry.uid);
  li.dataset.blockId = block.id;
  li.dataset.placement = block.placement || "";
  li.dataset.source = entry.blockSource || block.source || "";
  const siblings = entry.parentUid == null ? [] : childrenOf(entry.parentUid, entry.slotId);
  const siblingIndex = siblings.findIndex((candidate) => sameUid(candidate.uid, entry.uid));
  const recipeBadge = entry.recipeInstanceId ? `<span class="pill" title="Часть готового комбо">комбо</span>` : "";
  li.innerHTML = `
      <span class="canvas-card-handle" title="Перетащи чтобы переставить">⠿</span>
      ${canvasCardThumbMarkup(block)}
      <div class="canvas-card-body">
        <div class="canvas-card-title">${escapeHtml(block.label || block.id)}</div>
        <div class="canvas-card-sub">${escapeHtml(block.placement || "")} · ${(block.slots || []).length} полей ${recipeBadge}</div>
      </div>
      <div class="canvas-card-actions">
        <button title="Вверх" data-act="up" ${siblingIndex <= 0 ? "disabled" : ""}>▲</button>
        <button title="Вниз" data-act="down" ${siblingIndex < 0 || siblingIndex >= siblings.length - 1 ? "disabled" : ""}>▼</button>
        <button title="Удалить" data-act="del">✕</button>
      </div>`;
  li.addEventListener("click", (e) => { if (e.target.closest("button")) return; selectCanvas(entry.uid); });
  li.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    e.stopPropagation();
    // Меню всегда работает с тем блоком, по которому кликнули, поэтому сначала
    // выделяем его: иначе Ctrl+C после меню скопировал бы предыдущий выбор.
    if (!sameUid(state.selectedUid, entry.uid)) selectCanvas(entry.uid);
    openCanvasContextMenu(e.clientX, e.clientY, entry.uid);
  });
  li.querySelector('[data-act="up"]').addEventListener("click", (e) => { e.stopPropagation(); moveInCanvas(entry.uid, -1); });
  li.querySelector('[data-act="down"]').addEventListener("click", (e) => { e.stopPropagation(); moveInCanvas(entry.uid, +1); });
  li.querySelector('[data-act="del"]').addEventListener("click", (e) => { e.stopPropagation(); removeFromCanvas(entry.uid); });
  li.addEventListener("dragstart", (e) => {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("application/x-retkit-canvas-uid", String(entry.uid));
    e.dataTransfer.setData("text/plain", "canvas:" + entry.uid);
    document.body.classList.add("dragging-canvas-card");
    document.body.dataset.dragPlacement = block.placement || "";
    _draggingCanvasUid = entry.uid;
    _draggingPlacement = block.placement || "";
    li.classList.add("dragging");
  });
  li.addEventListener("dragend", () => {
    document.body.classList.remove("dragging-canvas-card");
    delete document.body.dataset.dragPlacement;
    li.classList.remove("dragging");
    _draggingCanvasUid = null;
    _draggingPlacement = "";
    clearDropIndicators();
  });
  return li;
}

/* ─── Буфер блоков: копировать / вырезать / вставить / дублировать ─────────
 * Копируется всё поддерево вместе со значениями слотов и оформлением, а не
 * один узел: комбо и секции с наполнением иначе вставлялись бы пустыми.
 * Uid'ы в буфере нормализуются в 0..N, при вставке выдаются свежие — два
 * экземпляра одного блока не должны делить идентификатор.
 * Дублируется и в localStorage, чтобы копия переживала перезагрузку вкладки.
 */
const BLOCK_CLIPBOARD_KEY = "retkit.blockClipboard.v1";
let _blockClipboard = null;

function readBlockClipboard() {
  if (_blockClipboard) return _blockClipboard;
  try {
    const raw = localStorage.getItem(BLOCK_CLIPBOARD_KEY);
    if (raw) _blockClipboard = JSON.parse(raw);
  } catch { /* приватный режим / переполнение — работаем в памяти */ }
  return _blockClipboard;
}

function writeBlockClipboard(clip) {
  _blockClipboard = clip;
  try { localStorage.setItem(BLOCK_CLIPBOARD_KEY, JSON.stringify(clip)); } catch { /* не критично */ }
  updateClipboardAffordances();
}

/** Поддерево блока в переносимом виде: корень всегда uid 0, parentUid null. */
function serializeSubtree(uid) {
  const root = entryByUid(uid);
  if (!root) return null;
  const ids = descendantUids(uid);
  ids.add(String(uid));
  const bundle = state.canvas.filter((e) => ids.has(String(e.uid)));
  // Порядок важен: сначала корень, дальше в исходном порядке канваса —
  // так вставка сохраняет и вложенность, и очерёдность соседей.
  const ordered = [root, ...bundle.filter((e) => !sameUid(e.uid, uid))];
  const remap = new Map(ordered.map((e, i) => [String(e.uid), i]));
  return {
    label: blockForEntry(root)?.label || root.blockId,
    entries: ordered.map((e, i) => ({
      uid: i,
      blockId: e.blockId || e.id,
      blockSource: e.blockSource || e.source || undefined,
      parentUid: i === 0 ? null : (remap.has(String(e.parentUid)) ? remap.get(String(e.parentUid)) : null),
      slotId: i === 0 ? null : e.slotId,
      slots: e.slots ? JSON.parse(JSON.stringify(e.slots)) : {},
      ...(e.explicitSlots ? { explicitSlots: [...e.explicitSlots] } : {}),
      ...(e.appearance ? { appearance: { ...e.appearance } } : {}),
    })),
    rootPlacement: placementOf(blockForEntry(root)) || null,
  };
}

/** Разложить буфер на канвас под указанного родителя. */
function instantiateClipboard(clip, { parentUid, slotId }) {
  const created = [];
  const uidMap = new Map();
  for (const item of clip.entries) {
    const block = blockById(item.blockId, item.blockSource);
    if (!block) continue;  // блок удалили из библиотеки после копирования
    const entry = createEntry(block, {
      blockSource: item.blockSource,
      parentUid: item.parentUid == null ? parentUid : uidMap.get(item.parentUid),
      slotId: item.parentUid == null ? slotId : item.slotId,
      slots: item.slots,
      explicitSlots: item.explicitSlots,
      appearance: item.appearance,
    });
    uidMap.set(item.uid, entry.uid);
    created.push(entry);
  }
  return created;
}

function copyBlock(uid) {
  const clip = serializeSubtree(uid);
  if (!clip) return false;
  writeBlockClipboard(clip);
  flashCanvasHint(`Скопировано: ${clip.label}${clip.entries.length > 1 ? ` (+${clip.entries.length - 1} внутри)` : ""}`);
  return true;
}

function cutBlock(uid) {
  if (!copyBlock(uid)) return;
  removeFromCanvas(uid);
}

/**
 * Вставка. По умолчанию — соседом сразу после цели: это единственное место,
 * где вставка заведомо корректна структурно (раз цель там стоит, то и копия
 * влезет). `inside: true` кладёт внутрь цели, если её слот принимает такой блок.
 */
function pasteBlock(targetUid, { inside = false } = {}) {
  const clip = readBlockClipboard();
  if (!clip || !clip.entries?.length) { flashCanvasHint("Буфер пуст"); return; }

  const rootBlock = blockById(clip.entries[0].blockId, clip.entries[0].blockSource);
  if (!rootBlock) { flashCanvasHint("Блок из буфера больше не существует в библиотеке"); return; }

  const target = entryByUid(targetUid) || entryByUid(state.selectedUid);
  let parentUid = null;
  let slotId = null;
  let afterUid = null;

  if (target && inside) {
    const slot = chooseChildSlot(blockForEntry(target), rootBlock);
    if (!slot) { flashCanvasHint("Этот блок нельзя положить внутрь выбранного"); return; }
    parentUid = target.uid;
    slotId = slot.id;
  } else if (target && target.parentUid != null) {
    const parent = entryByUid(target.parentUid);
    const siblingSlot = childSlotsFor(blockForEntry(parent))
      .find((candidate) => candidate.id === target.slotId);
    if (!parent || !siblingSlot || !slotAcceptsBlock(siblingSlot, rootBlock)) {
      flashCanvasHint("Этот блок нельзя вставить рядом: родительский слот принимает другой уровень блоков");
      return;
    }
    parentUid = parent.uid;
    slotId = siblingSlot.id;
    afterUid = target.uid;
  } else {
    // Ничего не выбрано (или выбрана внешняя обёртка) — кладём как секцию.
    const outer = ensureOuterForMutation();
    if (!outer) { flashCanvasHint("Некуда вставить: на канвасе нет обёртки письма"); return; }
    const slot = chooseChildSlot(blockForEntry(outer), rootBlock);
    if (!slot) { flashCanvasHint("Этот блок нельзя вставить на верхний уровень письма"); return; }
    parentUid = outer.uid;
    slotId = slot.id;
  }

  pushCanvasUndo();
  const created = instantiateClipboard(clip, { parentUid, slotId });
  if (!created.length) { _canvasUndo.pop(); flashCanvasHint("Нечего вставлять"); return; }
  state.canvas.push(...created);
  if (afterUid != null) {
    const siblings = childrenOf(parentUid, slotId).map((e) => e.uid);
    const rootUid = created[0].uid;
    const withoutRoot = siblings.filter((u) => !sameUid(u, rootUid));
    const at = withoutRoot.findIndex((u) => sameUid(u, afterUid));
    withoutRoot.splice(at < 0 ? withoutRoot.length : at + 1, 0, rootUid);
    rebuildCanvasOrder(parentUid, slotId, withoutRoot);
  }
  normalizeCanvasOrder();
  finishCanvasMutation(created[0].uid);
  flashCanvasHint(`Вставлено: ${clip.label}`);
}

function duplicateBlock(uid) {
  const entry = entryByUid(uid);
  if (!entry) return;
  const saved = readBlockClipboard();
  const clip = serializeSubtree(uid);
  if (!clip) return;
  _blockClipboard = clip;
  pasteBlock(uid, { inside: false });
  // Дублирование не должно молча затирать то, что человек копировал раньше.
  if (saved) _blockClipboard = saved;
}

/** Короткая подсказка в углу канваса вместо alert'ов на каждое действие. */
let _canvasHintTimer = null;
function flashCanvasHint(text, duration = 1800) {
  let el = document.getElementById("canvasHint");
  if (!el) {
    el = document.createElement("div");
    el.id = "canvasHint";
    el.className = "canvas-hint";
    document.body.appendChild(el);
  }
  el.textContent = text;
  el.classList.add("visible");
  clearTimeout(_canvasHintTimer);
  _canvasHintTimer = setTimeout(() => el.classList.remove("visible"), duration);
}

/** Пункты меню, зависящие от буфера, должны гаснуть, когда он пуст. */
function updateClipboardAffordances() {
  const has = Boolean(readBlockClipboard()?.entries?.length);
  document.querySelectorAll("[data-needs-clipboard]").forEach((el) => {
    el.disabled = !has;
    el.classList.toggle("disabled", !has);
  });
}

/* ─── Контекстное меню блока на канвасе ──────────────────────────────────── */

function closeCanvasContextMenu() {
  document.querySelector(".canvas-ctx-menu")?.remove();
}

function openCanvasContextMenu(x, y, uid) {
  closeCanvasContextMenu();
  const entry = entryByUid(uid);
  if (!entry) return;
  const block = blockForEntry(entry);
  const clip = readBlockClipboard();
  const clipRoot = clip?.entries?.length ? blockById(clip.entries[0].blockId, clip.entries[0].blockSource) : null;
  const canPasteInside = Boolean(clipRoot && chooseChildSlot(block, clipRoot));
  const siblings = entry.parentUid == null ? [] : childrenOf(entry.parentUid, entry.slotId);
  const index = siblings.findIndex((c) => sameUid(c.uid, entry.uid));

  const items = [
    { key: "copy", label: "Копировать", hint: "Ctrl+C" },
    { key: "cut", label: "Вырезать", hint: "Ctrl+X" },
    { key: "duplicate", label: "Дублировать", hint: "Ctrl+D" },
    { separator: true },
    { key: "paste", label: "Вставить после", hint: "Ctrl+V", disabled: !clipRoot },
    { key: "paste-inside", label: "Вставить внутрь", disabled: !canPasteInside },
    { separator: true },
    { key: "up", label: "Переместить выше", disabled: index <= 0 },
    { key: "down", label: "Переместить ниже", disabled: index < 0 || index >= siblings.length - 1 },
    { separator: true },
    { key: "code", label: "Открыть код блока" },
    { key: "ai", label: "Обсудить с ИИ" },
    { key: "delete", label: "Удалить", hint: "Delete", danger: true },
  ];

  const menu = renderContextMenu(x, y, items);

  menu.addEventListener("click", (ev) => {
    const btn = ev.target.closest("[data-ctx]");
    if (!btn || btn.disabled) return;
    closeCanvasContextMenu();
    switch (btn.dataset.ctx) {
      case "copy": copyBlock(uid); break;
      case "cut": cutBlock(uid); break;
      case "duplicate": duplicateBlock(uid); break;
      case "paste": pasteBlock(uid, { inside: false }); break;
      case "paste-inside": pasteBlock(uid, { inside: true }); break;
      case "up": moveInCanvas(uid, -1); break;
      case "down": moveInCanvas(uid, +1); break;
      case "code": selectCanvas(uid); openBlockAuthor(block, { asNew: true }); break;
      case "ai": discussBlockWithAi(block, entry); break;
      case "delete": removeFromCanvas(uid); break;
    }
  });
}

/** Общая отрисовка меню: и для блока в письме, и для карточки каталога. */
function renderContextMenu(x, y, items) {
  const menu = document.createElement("div");
  menu.className = "canvas-ctx-menu";
  menu.setAttribute("role", "menu");
  menu.innerHTML = items.map((item) => item.separator
    ? `<div class="ctx-sep"></div>`
    : `<button type="button" role="menuitem" data-ctx="${item.key}" ${item.disabled ? "disabled" : ""}
         class="${item.danger ? "ctx-danger" : ""}">
         <span>${escapeHtml(item.label)}</span>${item.hint ? `<kbd>${escapeHtml(item.hint)}</kbd>` : ""}
       </button>`).join("");
  document.body.appendChild(menu);

  // Держим меню в пределах экрана — у нижних блоков оно иначе уезжает за край.
  const rect = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - rect.width - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - rect.height - 8))}px`;

  const dismiss = (ev) => {
    if (menu.contains(ev.target)) return;
    closeCanvasContextMenu();
    document.removeEventListener("mousedown", dismiss, true);
  };
  document.addEventListener("mousedown", dismiss, true);
  return menu;
}

/** ПКМ по карточке каталога: добавить, посмотреть, спросить у оператора. */
function openCatalogContextMenu(x, y, block) {
  closeCanvasContextMenu();
  if (!block) return;
  const usable = blockCatalogUsable(block);
  const group = block.preview?.group;
  const items = [
    { key: "add", label: "Добавить в письмо", disabled: !usable },
    { key: "view", label: "Посмотреть исходник" },
    { key: "copy-id", label: "Скопировать id блока" },
    { separator: true },
    { key: "similar", label: `Показать похожие${group?.size > 1 ? ` (${group.size - 1})` : ""}`, disabled: !(group?.size > 1) },
    { key: "ai", label: "Обсудить с ИИ" },
    ...(block.source === "user" ? [{ separator: true }, { key: "edit", label: "Редактировать блок" }] : []),
  ];
  const menu = renderContextMenu(x, y, items);
  menu.addEventListener("click", (ev) => {
    const btn = ev.target.closest("[data-ctx]");
    if (!btn || btn.disabled) return;
    closeCanvasContextMenu();
    switch (btn.dataset.ctx) {
      case "add": addToCanvas(block, { origin: "catalog-menu" }); break;
      case "view": openBlockView(block); break;
      case "copy-id":
        navigator.clipboard?.writeText(block.id).catch(() => {});
        flashCanvasHint(`Скопирован id: ${block.id}`);
        break;
      case "similar":
        openBlockGallery();
        _galleryState.expandedGroup = group.id;
        _galleryState.ignoreContext = true;
        setTimeout(() => {
          const box = $("galleryIgnoreContext");
          if (box) box.checked = true;
          renderGallery();
        }, 30);
        break;
      case "ai": discussBlockWithAi(block, null); break;
      case "edit": openBlockAuthor(block); break;
    }
  });
}

/**
 * Открыть оператора с этим блоком в контексте. Вопрос не задаём за человека —
 * подставляем заготовку в поле ввода, чтобы он дописал своё и отправил.
 */
function discussBlockWithAi(block, entry) {
  const chat = ensureStudioChat();
  if (!chat) { alert("Панель оператора не загрузилась — обнови страницу"); return; }
  chat.mount();
  chat.open();
  const name = block?.label || block?.id || "блок";
  const where = entry ? " в этом письме" : "";
  const draft = `Блок «${name}» (id: ${block?.id})${where}. `;
  if (chat.input && !chat.input.value.trim()) {
    chat.input.value = draft;
    chat.input.focus();
    chat.input.setSelectionRange(draft.length, draft.length);
  }
}

/* ─── Горячие клавиши буфера ─────────────────────────────────────────────── */

function isTypingTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

document.addEventListener("keydown", (e) => {
  if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
  // Пока курсор в поле ввода, Ctrl+C/V принадлежат тексту, а не блокам.
  if (isTypingTarget(document.activeElement)) return;
  // И если человек выделил текст мышью — Ctrl+C должен скопировать текст.
  // Без этой проверки нельзя было скопировать ответ оператора из чата:
  // мы перехватывали сочетание и копировали блок канваса.
  const selection = window.getSelection?.();
  if (selection && !selection.isCollapsed && String(selection).trim()) return;
  const key = String(e.key || "").toLowerCase();
  const uid = state.selectedUid;

  if (key === "c" && uid != null) { e.preventDefault(); copyBlock(uid); return; }
  if (key === "x" && uid != null) { e.preventDefault(); cutBlock(uid); return; }
  if (key === "d" && uid != null) { e.preventDefault(); duplicateBlock(uid); return; }
  if (key === "v") { e.preventDefault(); pasteBlock(uid, { inside: false }); return; }
});

function isChildPlacement(p) { return p === "inner" || p === "inline" || p === "both"; }

// Explicit tree: every card owns named child slots with their own drop zones.
function renderCanvas() {
  const ol = $("canvas");
  if (!state.canvas.length) {
    ol.innerHTML = `<li class="canvas-empty" data-canvas-empty="1">Канвас пуст. Перетащи блок слева или кликни по нему.</li>`;
    return;
  }
  ol.innerHTML = "";
  const rendered = new Set();
  const renderNode = (entry) => {
    const block = blockForEntry(entry);
    if (!block || rendered.has(String(entry.uid))) return null;
    rendered.add(String(entry.uid));
    const node = document.createElement("li");
    node.className = "tree-node";
    node.dataset.uid = String(entry.uid);
    node.appendChild(makeCanvasCard(entry, block));

    for (const childSlot of childSlotsFor(block)) {
      const slotEl = document.createElement("ul");
      slotEl.className = "tree-slot";
      slotEl.dataset.parentUid = String(entry.uid);
      slotEl.dataset.slotId = childSlot.id;
      slotEl.dataset.accepts = childSlot.accepts.join(",");
      const children = childrenOf(entry.uid, childSlot.id);
      const head = document.createElement("li");
      head.className = "tree-slot-head";
      head.innerHTML = `<span>${escapeHtml(childSlot.label || childSlot.id)}</span><span class="tree-slot-count">${children.length}</span>`;
      slotEl.appendChild(head);
      children.forEach((child) => {
        const childNode = renderNode(child);
        if (childNode) slotEl.appendChild(childNode);
      });
      const dz = document.createElement("li");
      dz.className = "child-dropzone";
      dz.dataset.parentUid = String(entry.uid);
      dz.dataset.slotId = childSlot.id;
      dz.textContent = childSlot.accepts.includes("section") ? "＋ секция сюда" : "＋ блок внутрь";
      slotEl.appendChild(dz);
      node.appendChild(slotEl);
    }
    return node;
  };

  state.canvas.filter((entry) => entry.parentUid == null).forEach((entry) => {
    const node = renderNode(entry);
    if (node) ol.appendChild(node);
  });
  state.canvas.filter((entry) => !rendered.has(String(entry.uid))).forEach((entry) => {
    const node = renderNode(entry);
    if (!node) return;
    node.querySelector(":scope > .canvas-card")?.classList.add("orphan");
    ol.appendChild(node);
  });
}

// ─── Drag-and-drop logic on canvas ──────────────────────────────────────
// Insert an indicator line between cards as the user drags. The line shows
// the insertion point (above the hovered card if cursor is in its top half,
// below if in the bottom half).
function clearDropIndicators() {
  document.querySelectorAll(".canvas-drop-indicator").forEach((el) => el.remove());
  document.querySelectorAll(".canvas-card.drop-target").forEach((el) => el.classList.remove("drop-target"));
  document.querySelectorAll(".tree-slot.drop-compatible").forEach((el) => el.classList.remove("drop-compatible"));
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

  const dropContext = (target, clientY) => {
    const slotEl = target?.closest?.(".tree-slot");
    if (slotEl) {
      const parentUid = slotEl.dataset.parentUid;
      const slotId = slotEl.dataset.slotId;
      const targetNode = target.closest?.(".tree-node");
      const targetEntry = targetNode ? entryByUid(targetNode.dataset.uid) : null;
      const isDirectSibling = targetEntry
        && sameUid(targetEntry.parentUid, parentUid)
        && targetEntry.slotId === slotId;
      let beforeUid = isDirectSibling ? targetEntry.uid : null;
      if (isDirectSibling && Number.isFinite(clientY)) {
        const card = targetNode.querySelector(":scope > .canvas-card");
        const rect = card?.getBoundingClientRect();
        if (rect && clientY > rect.top + rect.height / 2) {
          const siblings = childrenOf(parentUid, slotId);
          const index = siblings.findIndex((entry) => sameUid(entry.uid, targetEntry.uid));
          beforeUid = siblings[index + 1]?.uid ?? null;
        }
      }
      return {
        parentUid,
        slotId,
        slotEl,
        beforeUid,
      };
    }
    return { parentUid: null, slotId: null, slotEl: null, beforeUid: null };
  };

  const draggedBlock = () => {
    if (_draggingCanvasUid != null) return blockForEntry(entryByUid(_draggingCanvasUid));
    return blockById(_draggingBlockId, _draggingBlockSource);
  };

  // Прощающий дроп: если бросили НЕ в конкретный слот, а мимо (пустое место/низ),
  // и это не обёртка — направляем в первый подходящий контейнер (в конец слота).
  const resolveTarget = (target, clientY) => {
    const ctx = dropContext(target, clientY);
    if (ctx.slotEl) return ctx;
    const block = draggedBlock();
    if (!block || placementOf(block) === "outer") return ctx;
    if (isInnerBlock(block) && placementOf(block) !== "both") {
      const section = latestSectionEntry(block);
      const sectionBlock = blockForEntry(section);
      const childSlot = childSlotsFor(sectionBlock).find((candidate) => chooseChildSlot(sectionBlock, block, candidate.id));
      if (section && childSlot) {
        const el = canvasEl.querySelector(`.tree-slot[data-parent-uid="${section.uid}"][data-slot-id="${childSlot.id}"]`);
        if (el) return { parentUid: String(section.uid), slotId: childSlot.id, slotEl: el, beforeUid: null };
      }
    }
    for (const oe of state.canvas.filter((e) => e.parentUid == null)) {
      const ob = blockForEntry(oe);
      const cs = childSlotsFor(ob).find((sl) => chooseChildSlot(ob, block, sl.id));
      if (cs) {
        const el = canvasEl.querySelector(`.tree-slot[data-parent-uid="${oe.uid}"][data-slot-id="${cs.id}"]`);
        if (el) return { parentUid: String(oe.uid), slotId: cs.id, slotEl: el, beforeUid: null };
      }
    }
    if (canAutoAddCatalogDrop(block, _draggingCanvasUid)) {
      return { ...ctx, autoAdd: true };
    }
    return ctx;
  };

  canvasEl.addEventListener("dragover", (e) => {
    const fromCatalog = document.body.classList.contains("dragging-from-catalog");
    const fromCanvas  = document.body.classList.contains("dragging-canvas-card");
    if (!fromCatalog && !fromCanvas) return;
    const context = resolveTarget(e.target, e.clientY);
    const parent = entryByUid(context.parentUid);
    const compatible = context.autoAdd || (context.slotEl
      ? !!chooseChildSlot(blockForEntry(parent), draggedBlock(), context.slotId)
      : placementOf(draggedBlock()) === "outer");
    if (!compatible) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = fromCatalog ? "copy" : "move";
    clearDropIndicators();
    context.slotEl?.classList.add("drop-compatible");
  });

  canvasEl.addEventListener("dragleave", (e) => {
    // Only clear when leaving the canvas pane entirely.
    if (e.target === canvasEl) clearDropIndicators();
  });

  canvasEl.addEventListener("drop", (e) => {
    const canvasUid = e.dataTransfer.getData("application/x-retkit-canvas-uid");
    const blockId   = e.dataTransfer.getData("application/x-retkit-block");
    const source = e.dataTransfer.getData("application/x-retkit-block-source") || _draggingBlockSource;
    const context = resolveTarget(e.target, e.clientY);
    const parent = entryByUid(context.parentUid);
    const moving = canvasUid ? entryByUid(canvasUid) : null;
    const block = moving ? blockForEntry(moving) : blockById(blockId, source);
    const slot = context.slotEl ? chooseChildSlot(blockForEntry(parent), block, context.slotId) : null;
    if (!block || (context.slotEl && !slot) || (!context.slotEl && !context.autoAdd && placementOf(block) !== "outer")) return;
    e.preventDefault();
    clearDropIndicators();
    if (moving) {
      if (!parent || descendantUids(moving.uid).has(String(parent.uid))) return;
      pushCanvasUndo();
      moving.parentUid = parent.uid;
      moving.slotId = slot.id;
      moveSubtreeBefore(moving.uid, context.beforeUid && !sameUid(context.beforeUid, moving.uid) ? context.beforeUid : null);
      finishCanvasMutation(moving.uid);
      return;
    }
    if (blockId) {
      addToCanvas(block, context.slotEl ? {
        parentUid: parent.uid,
        slotId: slot.id,
        beforeUid: context.beforeUid,
        origin: "catalog",
      } : { origin: "catalog" });
    }
  });
}

// The iframe does not exist yet on an empty letter, so its own drop handlers
// cannot bootstrap the first block. Accept catalog drops on the preview stage
// and delegate to the exact same addToCanvas path as a catalog click.
function wirePreviewStageDnd() {
  const stage = $("previewStage");
  if (!stage) return;
  const catalogBlock = (dataTransfer) => {
    const id = dataTransfer?.getData("application/x-retkit-block") || _draggingBlockId;
    const source = dataTransfer?.getData("application/x-retkit-block-source") || _draggingBlockSource;
    return blockById(id, source);
  };
  stage.addEventListener("dragover", (event) => {
    if (!document.body.classList.contains("dragging-from-catalog")) return;
    const block = catalogBlock(event.dataTransfer);
    if (!canAutoAddCatalogDrop(block, null)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    stage.classList.add("catalog-drop-ready");
  });
  stage.addEventListener("dragleave", (event) => {
    if (!event.relatedTarget || !stage.contains(event.relatedTarget)) stage.classList.remove("catalog-drop-ready");
  });
  stage.addEventListener("drop", (event) => {
    const block = catalogBlock(event.dataTransfer);
    if (!canAutoAddCatalogDrop(block, null)) return;
    event.preventDefault();
    stage.classList.remove("catalog-drop-ready");
    addToCanvas(block, { origin: "catalog" });
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

/* ─── Фактически применённые стили блока ─────────────────────────────────
 * Поля «Поверхность блока» показывали только ПЕРЕОПРЕДЕЛЕНИЕ: пока его нет,
 * поле пустое с подсказкой «как в блоке / #RRGGBB», и человек не видит, какой
 * же цвет там на самом деле. Правильный источник правды — не JSON блока
 * (в нём значения могут быть слотами, классами или вовсе прийти из семьи),
 * а то, что реально посчитал браузер в живом превью.
 *
 * Значение поля НЕ подменяем: пустое поле по-прежнему значит «как в блоке»,
 * иначе сброс и «унаследовать» перестанут работать. Показываем отдельной
 * строкой «сейчас: …» со свотчем.
 */
const APPLIED_STYLE_READERS = {
  background_color(cs, el) {
    // Прозрачный корень блока — обычное дело: фон рисует ячейка внутри.
    // Идём вглубь до первого непрозрачного, иначе покажем «нет фона» там,
    // где человек отчётливо видит цвет.
    let node = el;
    let guard = 0;
    while (node && guard++ < 4) {
      const value = node.ownerDocument.defaultView.getComputedStyle(node).backgroundColor;
      if (value && value !== "rgba(0, 0, 0, 0)" && value !== "transparent") return value;
      node = node.querySelector?.("td, div, table") || null;
    }
    return "прозрачный";
  },
  border(cs) {
    const width = parseFloat(cs.borderTopWidth) || 0;
    if (!width) return "нет";
    // Браузер отдаёт цвет как rgb(255, 119, 0). В студии цвета везде HEX —
    // и в полях, и в сохранённом Pug/Stylus, — поэтому показываем так же,
    // иначе значение из подсказки нельзя просто скопировать в поле.
    const colour = rgbToHex(cs.borderTopColor) || cs.borderTopColor;
    return `${cs.borderTopWidth} ${cs.borderTopStyle} ${colour}`;
  },
  radius(cs) {
    const r = cs.borderTopLeftRadius;
    return !r || r === "0px" ? "нет" : r;
  },
  padding(cs, el) {
    const read = (node) => {
      const s = node.ownerDocument.defaultView.getComputedStyle(node);
      return [s.paddingTop, s.paddingRight, s.paddingBottom, s.paddingLeft];
    };
    let parts = read(el);
    // padding применяется к первой email-ячейке, а не к корню таблицы —
    // читаем оттуда же, куда его и пишем.
    if (parts.every((p) => parseFloat(p) === 0)) {
      const cell = el.querySelector?.("td");
      if (cell) parts = read(cell);
    }
    if (parts.every((p) => parseFloat(p) === 0)) return "нет";
    const [t, r, b, l] = parts;
    if (t === r && r === b && b === l) return t;
    if (t === b && r === l) return `${t} ${r}`;
    return `${t} ${r} ${b} ${l}`;
  },
};

/** uid → { background_color, border, radius, padding } из живого превью. */
let _appliedStyles = new Map();

function refreshAppliedStyles() {
  const doc = iframeDoc();
  if (!doc || !doc.defaultView) return;
  const next = new Map();
  for (const range of _blockRanges) {
    const el = range.firstEl;
    if (!el || el.nodeType !== 1) continue;
    let cs;
    try { cs = doc.defaultView.getComputedStyle(el); } catch { continue; }
    const applied = {};
    for (const [key, read] of Object.entries(APPLIED_STYLE_READERS)) {
      try { applied[key] = read(cs, el); } catch { /* пропускаем нечитаемое */ }
    }
    next.set(String(range.uid), applied);
  }
  _appliedStyles = next;
}

function appliedStyleFor(uid, key) {
  return _appliedStyles.get(String(uid))?.[key] ?? null;
}

/** Строка «сейчас: …» под полем переопределения. */
function appliedStyleNote(uid, key) {
  const value = appliedStyleFor(uid, key);
  if (!value) return "";
  const isColor = /^rgba?\(/.test(value);
  const swatch = isColor
    ? `<span class="applied-swatch" style="background:${escapeHtml(value)}"></span>`
    : "";
  const shown = isColor ? rgbToHex(value) || value : value;
  return `<div class="insp-applied" title="Значение, которое реально применено к блоку прямо сейчас">
      ${swatch}<span class="insp-applied-label">сейчас</span><code>${escapeHtml(shown)}</code>
    </div>`;
}

/** rgb(255, 119, 0) → #FF7700; всё остальное отдаём как есть. */
function rgbToHex(value) {
  const m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/.exec(String(value).trim());
  if (!m) return null;
  if (m[4] !== undefined && Number(m[4]) === 0) return "прозрачный";
  const hex = "#" + [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, "0")).join("").toUpperCase();
  return m[4] !== undefined && Number(m[4]) < 1 ? `${hex} (${Math.round(Number(m[4]) * 100)}%)` : hex;
}

const EMAIL_HEX_PALETTE = Object.freeze([
  "#000000", "#222222", "#393A44", "#6B7280",
  "#FFFFFF", "#F9F9F9", "#ECECED", "#FF7700",
  "#F59E0B", "#E02424", "#2563EB", "#16A34A",
]);

/**
 * Email-safe colour accepted by the constructor.
 *
 * We intentionally do not accept rgb()/rgba(), alpha HEX or named colours:
 * the authored Pug/Stylus and the compiled inline CSS stay explicit #RRGGBB.
 * `transparent` and `inherit` remain available for nested backgrounds.
 */
function parseEmailColor(value, options) {
  const allowEmpty = Boolean(options?.allowEmpty);
  const raw = String(value ?? "").trim();
  if (!raw) return allowEmpty ? "" : null;
  const keyword = raw.toLowerCase();
  if (keyword === "transparent" || keyword === "inherit") return keyword;
  const short = /^#([0-9a-f]{3})$/i.exec(raw);
  if (short) {
    return "#" + short[1].split("").map((char) => char + char).join("").toUpperCase();
  }
  const full = /^#([0-9a-f]{6})$/i.exec(raw);
  return full ? `#${full[1].toUpperCase()}` : null;
}

function renderEmailColorControl({ target, id, value, placeholder }) {
  const normalized = parseEmailColor(value, { allowEmpty: true });
  const shown = normalized === null ? String(value ?? "") : normalized;
  const swatch = /^#[0-9A-F]{6}$/.test(normalized || "") ? normalized : "#000000";
  const transparent = !/^#[0-9A-F]{6}$/.test(normalized || "");
  const key = `${target}:${id}`;
  const dataId = target === "slot"
    ? `data-slot-id="${escapeHtml(id)}"`
    : `data-appearance-id="${escapeHtml(id)}"`;
  const presets = EMAIL_HEX_PALETTE.map((color) =>
    `<button type="button" class="email-color-preset" data-email-color-value="${color}" style="--email-swatch:${color}" title="${color}" aria-label="${color}"></button>`
  ).join("");
  return `<button type="button" class="email-color-swatch${transparent ? " is-transparent" : ""}" data-email-color-open="${escapeHtml(key)}" style="--email-swatch:${escapeHtml(swatch)}" title="Открыть HEX-палитру"><span class="email-color-swatch-chip"></span><span>HEX</span></button>
    <input type="text" class="email-hex-input" data-email-color="${escapeHtml(target)}" ${dataId} value="${escapeHtml(shown)}" placeholder="${escapeHtml(placeholder)}" maxlength="11" inputmode="text" autocomplete="off" spellcheck="false" aria-label="Цвет в формате HEX" />
    <div class="email-color-popover" data-email-color-popover="${escapeHtml(key)}" hidden>
      <div class="email-color-popover-title">HEX-палитра</div>
      <div class="email-color-presets">${presets}</div>
      <div class="email-color-popover-hint">Любой цвет можно ввести как <code>#RRGGBB</code></div>
    </div>`;
}

// ─── Inspector ──────────────────────────────────────────────────────────
const COMMON_APPEARANCE_FIELDS = Object.freeze([
  { key: "background_color", label: "Фон блока", kind: "color", slotIds: ["background_color", "bg_color"] },
  { key: "border", label: "Обводка", kind: "text", slotIds: ["border"] },
  { key: "radius", label: "Скругление", kind: "text", slotIds: ["radius", "border_radius"] },
  { key: "padding", label: "Внутренние отступы", kind: "text", slotIds: ["padding"] },
]);

function commonAppearanceBindings(block) {
  const slots = Array.isArray(block?.slots) ? block.slots : [];
  const fields = placementOf(block) === "outer"
    ? COMMON_APPEARANCE_FIELDS.filter((field) => field.key === "background_color")
    : COMMON_APPEARANCE_FIELDS;
  return fields.map((field) => {
    const slot = slots.find((candidate) => field.slotIds.includes(String(candidate.id || "").toLowerCase())
      && (field.kind !== "color" || String(candidate.kind || "").toLowerCase() === "color"));
    return { ...field, slot: slot || null };
  });
}

function renderFallbackAppearanceControl(binding, entry, block) {
  const own = entry?.appearance && Object.prototype.hasOwnProperty.call(entry.appearance, binding.key);
  const inherited = block?.appearance && Object.prototype.hasOwnProperty.call(block.appearance, binding.key);
  const value = own ? entry.appearance[binding.key] : (inherited ? block.appearance[binding.key] : "");
  const id = escapeHtml(binding.key);
  const label = `<label>${escapeHtml(binding.label)} <span class="slot-kind">общий</span></label>`;
  const reset = `<button type="button" class="slot-value-btn" data-reset-appearance="${id}" title="Убрать переопределение и вернуть оформление блока">↺</button>`;
  if (binding.kind === "color") {
    const colorControl = renderEmailColorControl({
      target: "appearance",
      id: binding.key,
      value,
      placeholder: "как в блоке / #RRGGBB",
    });
    return `<div class="insp-slot insp-style-slot style-background">${label}<div class="insp-value-row insp-color-row">${colorControl}<button type="button" class="slot-value-btn transparent" data-transparent-appearance="${id}" title="Прозрачный: будет виден фон родительского блока">Как родитель</button>${reset}</div></div>`;
  }
  const placeholder = binding.key === "border" ? "как в блоке / 1px solid #ECECED"
    : binding.key === "radius" ? "как в блоке / 16px"
      : "как в блоке / 16px 24px";
  return `<div class="insp-slot insp-style-slot style-${escapeHtml(binding.key)}">${label}<div class="insp-value-row"><input type="text" data-appearance-id="${id}" value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}" maxlength="180" />${reset}</div></div>`;
}

/**
 * Точечно обновить строки «сейчас: …» в открытом инспекторе.
 * Полная перерисовка тут не годится: она сбрасывает фокус и каретку в поле,
 * которое человек прямо сейчас редактирует, — а превью пересобирается как
 * раз после его правок.
 */
function refreshInspectorAppliedNotes() {
  const uid = state.selectedUid;
  if (uid == null) return;
  document.querySelectorAll("[data-applied-for]").forEach((holder) => {
    const markup = appliedStyleNote(uid, holder.dataset.appliedFor);
    const existing = holder.querySelector(":scope > .insp-applied");
    if (existing) existing.remove();
    if (markup) holder.insertAdjacentHTML("beforeend", markup);
  });
}

function renderCommonAppearance(block, entry, bindings) {
  const hint = placementOf(block) === "outer"
    ? "Фон применяется к реальным body, внешней таблице и оболочке письма."
    : "Фон, рамка и радиус применяются к корню блока; padding — к первой email-ячейке.";
  return `<section class="insp-group insp-surface-group" data-group="surface">
    <div class="insp-group-title"><span>◐</span><span>Поверхность блока</span><button type="button" class="insp-reset-appearance" data-reset-appearance-all title="Вернуть оформление к настройкам блока">Сбросить</button></div>
    <div class="insp-surface-hint">${hint}</div>
    ${bindings.map((binding) => {
      // Заметка «сейчас: …» вешается на ОБА варианта поля. Раньше она была
      // только у fallback-контрола, и у блоков, где фон/рамка/радиус заведены
      // настоящими слотами, фактическое значение так и не показывалось.
      const control = binding.slot
        ? renderSlotControl(binding.slot, entry.slots[binding.slot.id], block)
        : renderFallbackAppearanceControl(binding, entry, block);
      return `<div class="insp-surface-field" data-applied-for="${escapeHtml(binding.key)}">${control}${appliedStyleNote(entry?.uid, binding.key)}</div>`;
    }).join("")}
  </section>`;
}

function bindEmailColorControls(body, entry, block) {
  const closePalettes = (exceptKey = "") => {
    body.querySelectorAll("[data-email-color-popover]").forEach((popover) => {
      if (popover.dataset.emailColorPopover !== exceptKey) popover.hidden = true;
    });
    body.querySelectorAll("[data-email-color-open]").forEach((button) => {
      button.setAttribute("aria-expanded", button.dataset.emailColorOpen === exceptKey ? "true" : "false");
    });
  };

  const syncVisual = (input, normalized) => {
    const target = input.dataset.emailColor;
    const id = target === "slot" ? input.dataset.slotId : input.dataset.appearanceId;
    const key = `${target}:${id}`;
    const swatch = body.querySelector(`[data-email-color-open="${CSS.escape(key)}"]`);
    if (!swatch) return;
    const isHex = /^#[0-9A-F]{6}$/.test(normalized || "");
    swatch.classList.toggle("is-transparent", !isHex);
    if (isHex) swatch.style.setProperty("--email-swatch", normalized);
  };

  const commit = (input, { captureUndo = true, report = true } = {}) => {
    const target = input.dataset.emailColor;
    const id = target === "slot" ? input.dataset.slotId : input.dataset.appearanceId;
    const allowEmpty = target === "appearance";
    const normalized = parseEmailColor(input.value, { allowEmpty });
    if (normalized === null) {
      input.setCustomValidity("Используй #RGB, #RRGGBB, transparent или inherit. RGB/RGBA для email не сохраняются.");
      input.setAttribute("aria-invalid", "true");
      if (report) input.reportValidity();
      return false;
    }
    input.setCustomValidity("");
    input.removeAttribute("aria-invalid");
    input.value = normalized;
    syncVisual(input, normalized);

    let changed = false;
    if (target === "slot") {
      const current = String(entry.slots[id] ?? "");
      if (current !== normalized) {
        if (captureUndo && input.dataset.undoCaptured !== "1") pushCanvasUndo();
        entry.slots[id] = normalized;
        markEntrySlotExplicit(entry, id);
        changed = true;
      }
    } else {
      if (!entry.appearance || typeof entry.appearance !== "object") entry.appearance = {};
      const hasCurrent = Object.prototype.hasOwnProperty.call(entry.appearance, id);
      const current = hasCurrent ? String(entry.appearance[id] ?? "") : "";
      if (normalized === "") {
        if (hasCurrent) {
          if (captureUndo && input.dataset.undoCaptured !== "1") pushCanvasUndo();
          delete entry.appearance[id];
          changed = true;
        }
      } else if (!hasCurrent || current !== normalized) {
        if (captureUndo && input.dataset.undoCaptured !== "1") pushCanvasUndo();
        entry.appearance[id] = normalized;
        changed = true;
      }
    }
    if (changed) scheduleLivePreview();
    return true;
  };

  body.querySelectorAll("[data-email-color]").forEach((input) => {
    const initial = parseEmailColor(input.value, { allowEmpty: input.dataset.emailColor === "appearance" });
    if (initial !== null) {
      input.value = initial;
      syncVisual(input, initial);
    }
    input.addEventListener("focus", () => {
      if (input.dataset.undoCaptured !== "1") {
        pushCanvasUndo();
        input.dataset.undoCaptured = "1";
      }
    });
    input.addEventListener("input", () => {
      const parsed = parseEmailColor(input.value, { allowEmpty: input.dataset.emailColor === "appearance" });
      input.setCustomValidity("");
      input.removeAttribute("aria-invalid");
      if (parsed !== null) syncVisual(input, parsed);
    });
    input.addEventListener("change", () => commit(input, { captureUndo: false }));
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        if (commit(input, { captureUndo: false })) input.blur();
      } else if (event.key === "Escape") {
        closePalettes();
        input.blur();
      }
    });
    input.addEventListener("blur", () => { delete input.dataset.undoCaptured; });
  });

  body.querySelectorAll("[data-email-color-open]").forEach((button) => {
    button.setAttribute("aria-expanded", "false");
    button.addEventListener("click", () => {
      const key = button.dataset.emailColorOpen;
      const popover = body.querySelector(`[data-email-color-popover="${CSS.escape(key)}"]`);
      if (!popover) return;
      const opening = popover.hidden;
      closePalettes(opening ? key : "");
      popover.hidden = !opening;
      button.setAttribute("aria-expanded", opening ? "true" : "false");
    });
  });

  body.querySelectorAll("[data-email-color-value]").forEach((button) => {
    button.addEventListener("click", () => {
      const popover = button.closest("[data-email-color-popover]");
      const key = popover?.dataset.emailColorPopover || "";
      const [target, ...idParts] = key.split(":");
      const id = idParts.join(":");
      const selector = target === "slot"
        ? `[data-email-color="slot"][data-slot-id="${CSS.escape(id)}"]`
        : `[data-email-color="appearance"][data-appearance-id="${CSS.escape(id)}"]`;
      const input = body.querySelector(selector);
      if (!input) return;
      pushCanvasUndo();
      input.dataset.undoCaptured = "1";
      input.value = button.dataset.emailColorValue;
      commit(input, { captureUndo: false });
      closePalettes();
      input.focus();
    });
  });
}

function renderInspector() {
  const body = $("inspectorBody");
  if (!state.selectedUid) {
    if ($("inspectorTitle")) $("inspectorTitle").textContent = "Свойства блока";
    body.innerHTML = `<div class="insp-empty">Выбери блок на канвасе чтобы редактировать его поля.</div>`;
    return;
  }
  const entry = entryByUid(state.selectedUid);
  if (!entry) {
    state.selectedUid = null;
    renderInspector();
    return;
  }
  const block = blockForEntry(entry);
  if (!block) return;
  if ($("inspectorTitle")) $("inspectorTitle").textContent = block.label || block.id;
  const parent = entryByUid(entry.parentUid);
  const parentBlock = blockForEntry(parent);
  let html = `<div class="insp-block-id">${escapeHtml(block.id)} · ${escapeHtml(block.placement)}</div>`;
  if (parentBlock) {
    html += `<div class="insp-parent">Внутри: ${escapeHtml(parentBlock.label || parentBlock.id)} → ${escapeHtml(entry.slotId || "content")}</div>`;
  }
  // Move / delete the selected block (these lived in the removed «Структура» column).
  html += `<div class="insp-actions">
    <button class="btn" data-act="up" type="button" title="Переместить выше">▲ Выше</button>
    <button class="btn" data-act="down" type="button" title="Переместить ниже">▼ Ниже</button>
    <button class="btn" data-act="code" type="button" title="Открыть код блока (pug+styl)">⟨⟩ Код</button>
    <button class="btn" data-act="del" type="button" title="Удалить блок из письма">🗑</button>
  </div>`;
  const appearanceBindings = commonAppearanceBindings(block);
  const commonSlotIds = new Set(appearanceBindings.map((binding) => binding.slot?.id).filter(Boolean));
  if (appearanceBindings.length) html += renderCommonAppearance(block, entry, appearanceBindings);
  const groups = { content: [], assets: [], appearance: [], advanced: [] };
  for (const slot of block.slots || []) {
    if (commonSlotIds.has(slot.id)) continue;
    groups[slotInspectorGroup(slot)]?.push(slot);
  }
  groups.appearance.sort((a, b) => appearanceSlotRank(a) - appearanceSlotRank(b));
  const groupMeta = {
    content: ["✎", "Контент и ссылки"],
    assets: ["▧", "Изображения"],
    appearance: ["◐", "Точные настройки"],
    advanced: ["⚙", "Дополнительно"],
  };
  // Оформление идёт первым: дополнительные размеры/цвета не должны прятаться
  // после длинного списка контента. Четыре общих поля выше переиспользуют
  // native slots, а при их отсутствии используют email-safe fallback.
  for (const groupId of ["appearance", "content", "assets", "advanced"]) {
    const slots = groups[groupId];
    if (!slots.length) continue;
    const [icon, title] = groupMeta[groupId];
    html += `<section class="insp-group" data-group="${groupId}"><div class="insp-group-title"><span>${icon}</span>${title}</div>`;
    for (const slot of slots) html += renderSlotControl(slot, entry.slots[slot.id], block);
    html += `</section>`;
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
  body.querySelectorAll("[data-slot-id]:not([data-email-color])").forEach((el) => {
    el.addEventListener("focus", () => {
      if (el.dataset.undoCaptured === "1") return;
      pushCanvasUndo();
      el.dataset.undoCaptured = "1";
      const id = el.getAttribute("data-slot-id");
      const slot = (block.slots || []).find((candidate) => candidate.id === id);
      if (String(slot?.kind || "").toLowerCase() === "image") {
        el.dataset.lastPublicAssetValue = String(entry.slots[id] || "");
        el.dataset.lastPublicAssetExplicit = Array.isArray(entry.explicitSlots)
          && entry.explicitSlots.includes(String(id)) ? "1" : "0";
      }
    });
    el.addEventListener("blur", () => {
      delete el.dataset.undoCaptured;
      if (el.validationMessage && el.dataset.lastPublicAssetValue !== undefined) {
        const id = el.getAttribute("data-slot-id");
        entry.slots[id] = el.dataset.lastPublicAssetValue;
        if (el.dataset.lastPublicAssetExplicit === "1") markEntrySlotExplicit(entry, id);
        else clearEntrySlotExplicit(entry, id);
        el.value = el.dataset.lastPublicAssetValue;
        el.setCustomValidity("");
        flashCanvasHint("Локальный /studio-assets URL не применён: вставь публичный HTTPS-адрес");
      }
      delete el.dataset.lastPublicAssetValue;
      delete el.dataset.lastPublicAssetExplicit;
    });
    el.addEventListener("input", () => {
      const id = el.getAttribute("data-slot-id");
      let v = el.value;
      if (el.type === "number") v = Number(v);
      const slot = (block.slots || []).find((candidate) => candidate.id === id);
      if (String(slot?.kind || "").toLowerCase() === "image" && isLocalStudioAssetUrl(v)) {
        el.setCustomValidity("Локальный /studio-assets URL нельзя отправить получателям. Укажи публичный HTTPS-адрес.");
        return;
      }
      el.setCustomValidity("");
      entry.slots[id] = v;
      markEntrySlotExplicit(entry, id);
      scheduleLivePreview();
    });
  });
  body.querySelectorAll("[data-appearance-id]:not([data-email-color])").forEach((el) => {
    el.addEventListener("focus", () => {
      if (el.dataset.undoCaptured === "1") return;
      pushCanvasUndo();
      el.dataset.undoCaptured = "1";
    });
    el.addEventListener("blur", () => { delete el.dataset.undoCaptured; });
    el.addEventListener("input", () => {
      const id = el.dataset.appearanceId;
      const value = el.value;
      if (!entry.appearance || typeof entry.appearance !== "object") entry.appearance = {};
      if (String(value).trim()) entry.appearance[id] = value;
      else delete entry.appearance[id];
      scheduleLivePreview();
    });
  });
  bindEmailColorControls(body, entry, block);
  body.querySelectorAll("[data-reset-slot]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.resetSlot;
      const slot = (block.slots || []).find((candidate) => candidate.id === id);
      if (!slot) return;
      pushCanvasUndo();
      entry.slots[id] = Object.prototype.hasOwnProperty.call(slot, "default") ? slot.default : "";
      clearEntrySlotExplicit(entry, id);
      renderInspector();
      scheduleLivePreview(100);
    });
  });
  body.querySelectorAll("[data-transparent-slot]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.transparentSlot;
      if (!(block.slots || []).some((slot) => slot.id === id)) return;
      pushCanvasUndo();
      entry.slots[id] = "transparent";
      markEntrySlotExplicit(entry, id);
      renderInspector();
      scheduleLivePreview(100);
    });
  });
  body.querySelectorAll("[data-reset-appearance]").forEach((button) => {
    button.addEventListener("click", () => {
      pushCanvasUndo();
      if (entry.appearance && typeof entry.appearance === "object") delete entry.appearance[button.dataset.resetAppearance];
      renderInspector();
      scheduleLivePreview(100);
    });
  });
  body.querySelectorAll("[data-transparent-appearance]").forEach((button) => {
    button.addEventListener("click", () => {
      pushCanvasUndo();
      if (!entry.appearance || typeof entry.appearance !== "object") entry.appearance = {};
      entry.appearance[button.dataset.transparentAppearance] = "transparent";
      renderInspector();
      scheduleLivePreview(100);
    });
  });
  body.querySelector("[data-reset-appearance-all]")?.addEventListener("click", () => {
    pushCanvasUndo();
    entry.appearance = {};
    for (const binding of appearanceBindings) {
      if (!binding.slot) continue;
      entry.slots[binding.slot.id] = Object.prototype.hasOwnProperty.call(binding.slot, "default") ? binding.slot.default : "";
      clearEntrySlotExplicit(entry, binding.slot.id);
    }
    renderInspector();
    scheduleLivePreview(100);
  });
  body.querySelector("#insp-save-as-block")?.addEventListener("click", () => saveSelectedAsUserBlock());
  body.querySelector('[data-act="up"]')?.addEventListener("click", () => { moveInCanvas(entry.uid, -1); renderInspector(); });
  body.querySelector('[data-act="down"]')?.addEventListener("click", () => { moveInCanvas(entry.uid, +1); renderInspector(); });
  body.querySelector('[data-act="del"]')?.addEventListener("click", () => removeFromCanvas(entry.uid));
  body.querySelector('[data-act="code"]')?.addEventListener("click", () => openBlockAuthor(block, { asNew: true }));
  body.querySelectorAll(".ph-insert").forEach((btn) => btn.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); openPlaceholderMenu(btn, entry); }));
  body.querySelectorAll("[data-asset-for]").forEach((btn) => btn.addEventListener("click", () => openAssetPicker(entry, btn.dataset.assetFor)));
  body.querySelectorAll("[data-upload-for]").forEach((btn) => btn.addEventListener("click", () => uploadAssetForSlot(entry, btn.dataset.uploadFor)));
  body.querySelectorAll("[data-generate-for]").forEach((btn) => btn.addEventListener("click", () => openImageGenerator(entry, btn.dataset.generateFor, block)));
}

function slotInspectorGroup(slot) {
  const explicit = String(slot?.uiGroup || "").toLowerCase();
  if (["content", "assets", "appearance", "advanced"].includes(explicit)) return explicit;
  const id = String(slot?.id || "").toLowerCase();
  const kind = String(slot?.kind || "text").toLowerCase();
  if (kind === "image") return "assets";
  if (kind === "color" || /(?:^|_)(bg|background|border|radius|padding|margin|align|width|height|cols|offset|pt|pb)(?:_|$)/.test(id)) return "appearance";
  if (["text", "richtext", "url", "localizedurl", "number", "select"].includes(kind)) return "content";
  return "advanced";
}

function appearanceSlotRole(slot) {
  const id = String(slot?.id || "").toLowerCase();
  if (/(?:^|_)(?:bg|background)(?:_color)?(?:_|$)/.test(id)) return "background";
  if (/(?:^|_)(?:radius|border_radius)(?:_|$)/.test(id)) return "radius";
  if (/(?:^|_)border(?:_|$)/.test(id)) return "border";
  if (/(?:^|_)(?:padding|pt|pb|gap|margin|spacing)(?:_|$)/.test(id)) return "spacing";
  if (/(?:^|_)(?:align|position)(?:_|$)/.test(id)) return "alignment";
  if (/(?:^|_)(?:width|height|size|cols|offset)(?:_|$)/.test(id)) return "size";
  return "other";
}

function appearanceSlotRank(slot) {
  const rank = { background: 0, border: 10, radius: 20, spacing: 30, alignment: 40, size: 50, other: 90 };
  return rank[appearanceSlotRole(slot)] ?? rank.other;
}

function canUseSystemPlaceholder(block, slot) {
  return block?.category === "footer" && (
    slot?.allowSystemPlaceholder === true || slot?.perLocale === true || slot?.kind === "localizedUrl"
  );
}

async function saveSelectedAsUserBlock() {
  const entry = entryByUid(state.selectedUid);
  if (!entry) return;
  const base = blockForEntry(entry);
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
    childSlots: base.childSlots,
    combo: base.combo === true,
    children: base.children,
  };
  const savedAppearance = {
    ...(base.appearance && typeof base.appearance === "object" ? base.appearance : {}),
    ...(entry.appearance && typeof entry.appearance === "object" ? entry.appearance : {}),
  };
  if (Object.keys(savedAppearance).length) payload.appearance = savedAppearance;

  let res = await fetch("/api/blocks-library/save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  let data = await res.json();
  if (res.status === 409) {
    if (/protected/i.test(String(data.error || ""))) {
      alert(`ID "${id}" принадлежит системному блоку. Выбери новое имя для своей копии — системные и legacy-определения нельзя затереть.`);
      return;
    }
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
  state.sourceScope = "user";
  if ($("catSourceScope")) $("catSourceScope").value = "user";
  await loadLibrary();
  const status = data.review?.status || "draft";
  const errors = data.review?.deterministic?.errors || [];
  alert(status === "candidate"
    ? `✓ Блок "${id}" прошёл детерминированную проверку и сохранён как candidate.\nПроверь превью и нажми ✓ в «Мои блоки», чтобы перевести его в approved.`
    : `Блок "${id}" сохранён как draft и пока не вставляется в письмо.\n${errors.slice(0, 3).join("\n") || "Исправь Pug/Stylus и сохрани снова."}`);
}

async function approveUserBlock(id) {
  if (!confirm(`Одобрить блок "${id}"?\n\nСервер ещё раз проверит Pug, Stylus и соответствие слотов. AI-review для этого не требуется.`)) return;
  const res = await fetch(`/api/blocks-library/user/${encodeURIComponent(id)}/review`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "approved" }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const errors = data.validation?.errors || [];
    alert(`Не получилось одобрить: ${data.error || res.status}${errors.length ? `\n\n${errors.slice(0, 4).join("\n")}` : ""}`);
    return;
  }
  await loadLibrary();
  alert(`✓ Блок "${id}" approved. Теперь он виден в «Проверенных блоках».`);
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

function renderSlotControl(slot, current, block) {
  const v = current ?? slot.default ?? "";
  const kind = slot.kind || "text";
  const id = slot.id;
  const isAppearance = slotInspectorGroup(slot) === "appearance";
  const appearanceRole = isAppearance ? appearanceSlotRole(slot) : "";
  const wrapClass = `insp-slot${isAppearance ? ` insp-style-slot style-${appearanceRole}` : ""}`;
  const label = `<label>${escapeHtml(slot.label || id)} <span class="slot-kind">${escapeHtml(kind)}</span></label>`;
  const resetButton = isAppearance
    ? `<button type="button" class="slot-value-btn" data-reset-slot="${escapeHtml(id)}" title="Вернуть значение блока по умолчанию">↺</button>`
    : "";
  const placeholderButton = canUseSystemPlaceholder(block, slot)
    ? `<button type="button" class="ph-insert" data-ph-for="${escapeHtml(id)}" title="Вставить системный плейсхолдер">﹢ Системное поле</button>`
    : "";
  if (kind === "richText") {
    return `<div class="${wrapClass}">${label}<textarea data-slot-id="${escapeHtml(id)}" maxlength="${slot.max || 1000}">${escapeHtml(v)}</textarea>${placeholderButton}</div>`;
  }
  if (kind === "select") {
    const options = (slot.options || []).map((o) => `<option value="${escapeHtml(o)}" ${o === v ? "selected" : ""}>${escapeHtml(o)}</option>`).join("");
    return `<div class="${wrapClass}">${label}<div class="insp-value-row"><select data-slot-id="${escapeHtml(id)}">${options}</select>${resetButton}</div></div>`;
  }
  if (kind === "number") {
    return `<div class="${wrapClass}">${label}<div class="insp-value-row"><input type="number" data-slot-id="${escapeHtml(id)}" value="${escapeHtml(v)}" min="${slot.min ?? ''}" max="${slot.max ?? ''}" />${resetButton}</div></div>`;
  }
  if (kind === "url" || kind === "localizedUrl") {
    return `<div class="${wrapClass}">${label}<input type="url" data-slot-id="${escapeHtml(id)}" value="${escapeHtml(v)}" />${placeholderButton}</div>`;
  }
  if (kind === "image") {
    return `<div class="${wrapClass}">${label}<input type="url" data-slot-id="${escapeHtml(id)}" value="${escapeHtml(v)}" placeholder="https://..." />
      <div class="slot-tools">
        <button type="button" class="slot-tool" data-asset-for="${escapeHtml(id)}">▧ Библиотека</button>
        <button type="button" class="slot-tool" data-upload-for="${escapeHtml(id)}">↑ Загрузить</button>
        <button type="button" class="slot-tool ai" data-generate-for="${escapeHtml(id)}">✨ Создать</button>
      </div></div>`;
  }
  if (kind === "color") {
    const transparentButton = appearanceRole === "background"
      ? `<button type="button" class="slot-value-btn transparent" data-transparent-slot="${escapeHtml(id)}" title="Прозрачный: показывать фон родительского блока">Как родитель</button>`
      : "";
    const colorControl = renderEmailColorControl({
      target: "slot",
      id,
      value: v,
      placeholder: "#RRGGBB или transparent",
    });
    return `<div class="${wrapClass}">${label}<div class="insp-value-row insp-color-row">${colorControl}${transparentButton}${resetButton}</div></div>`;
  }
  // default: text
  const stylePlaceholder = appearanceRole === "border" ? "none или 1px solid #ECECED"
    : appearanceRole === "radius" ? "0 или 16px"
      : appearanceRole === "spacing" ? "напр. 16px 24px"
        : "";
  const input = `<input type="text" data-slot-id="${escapeHtml(id)}" value="${escapeHtml(v)}" maxlength="${slot.max || 200}"${stylePlaceholder ? ` placeholder="${escapeHtml(stylePlaceholder)}"` : ""} />`;
  return `<div class="${wrapClass}">${label}${isAppearance ? `<div class="insp-value-row">${input}${resetButton}</div>` : input}${placeholderButton}</div>`;
}

function setEntrySlotValue(entry, slotId, value) {
  if (!entry || !slotId) return;
  if (isLocalStudioAssetUrl(value)) {
    flashCanvasHint("Локальный /studio-assets URL не применён: для письма нужен публичный HTTPS-адрес");
    return false;
  }
  pushCanvasUndo();
  entry.slots[slotId] = value;
  markEntrySlotExplicit(entry, slotId);
  renderInspector();
  scheduleLivePreview(100);
  return true;
}

function closeAssetModal() {
  document.querySelector(".asset-modal")?.remove();
}

function createAssetModal(title, bodyHtml, footerHtml = "") {
  closeAssetModal();
  const modal = document.createElement("div");
  modal.className = "asset-modal";
  modal.innerHTML = `<div class="asset-dialog" role="dialog" aria-modal="true">
    <div class="asset-dialog-head"><strong>${escapeHtml(title)}</strong><button class="btn" data-modal-close type="button">✕</button></div>
    <div class="asset-dialog-body">${bodyHtml}</div>
    ${footerHtml ? `<div class="asset-dialog-foot">${footerHtml}</div>` : ""}
  </div>`;
  modal.querySelectorAll("[data-modal-close]").forEach((btn) => btn.addEventListener("click", closeAssetModal));
  modal.addEventListener("click", (event) => { if (event.target === modal) closeAssetModal(); });
  document.body.appendChild(modal);
  return modal;
}

const LOCAL_STUDIO_ASSET_PREFIX = "/studio-assets/";
let _assetStorageStatusCache = null;
let _assetStorageStatusRequest = null;

/**
 * `/studio-assets/…` is a preview-only path served by the Studio process.
 * Even when somebody pastes an absolute URL with that path, it still points
 * at app-local/ephemeral storage and must not leak into the sent email.
 */
function isLocalStudioAssetUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return false;
  if (/^\/studio-assets(?:\/|$)/i.test(raw)) return true;
  try {
    return /^\/studio-assets(?:\/|$)/i.test(new URL(raw).pathname);
  } catch {
    return false;
  }
}

function isPrivateEmailAssetHostname(hostname) {
  const host = String(hostname || "").trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!host) return false;
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true;
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const octets = ipv4.slice(1).map(Number);
    if (octets.some((part) => part > 255)) return true;
    const [a, b] = octets;
    return a === 0
      || a === 10
      || a === 127
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || (a === 100 && b >= 64 && b <= 127);
  }
  if (host.includes(":")) {
    return host === "::"
      || host === "::1"
      || host === "0:0:0:0:0:0:0:1"
      || /^f[cd][0-9a-f]*:/i.test(host)
      || /^fe[89ab][0-9a-f]*:/i.test(host)
      || host.startsWith("::ffff:");
  }
  return false;
}

function isPublicEmailAssetUrl(value) {
  const raw = String(value || "").trim();
  if (!raw || isLocalStudioAssetUrl(raw)) return false;
  try {
    const parsed = new URL(raw.startsWith("//") ? `https:${raw}` : raw);
    return (parsed.protocol === "https:" || parsed.protocol === "http:")
      && !isPrivateEmailAssetHostname(parsed.hostname);
  } catch {
    return false;
  }
}

async function loadAssetStorageStatus() {
  if (_assetStorageStatusCache) return _assetStorageStatusCache;
  if (_assetStorageStatusRequest) return _assetStorageStatusRequest;
  _assetStorageStatusRequest = fetch("/api/assets/status")
    .then(async (response) => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      _assetStorageStatusCache = data;
      return data;
    })
    .catch((error) => ({
      driver: "unknown",
      ready: false,
      publicUrls: false,
      note: `Не удалось проверить публичность хранилища: ${error.message}`,
    }))
    .finally(() => { _assetStorageStatusRequest = null; });
  return _assetStorageStatusRequest;
}

/** URL, который можно безопасно записать в разметку отправляемого письма. */
function preferredAssetUrl(item) {
  const candidates = [item?.externalUrl, item?.preferredUrl, item?.url];
  return candidates.find((candidate) => isPublicEmailAssetUrl(candidate)) || "";
}

/** URL только для миниатюры внутри Studio; он никогда не пишется в письмо. */
function assetPreviewUrl(item) {
  return preferredAssetUrl(item) || item?.localUrl || "";
}

function nonPublicAssetMessage(status) {
  const storageNote = String(status?.note || "").trim();
  return "Этот файл доступен только внутри Studio по /studio-assets/ и не откроется у получателей."
    + (storageNote ? `\n\n${storageNote}` : "")
    + "\n\nВставь публичный HTTPS-адрес картинки:";
}

async function applyAssetItemToSlot(entry, slotId, item, status = null) {
  const publicUrl = preferredAssetUrl(item);
  if (publicUrl) return setEntrySlotValue(entry, slotId, publicUrl);

  const storageStatus = status || await loadAssetStorageStatus();
  const externalUrl = prompt(nonPublicAssetMessage(storageStatus), String(item?.externalUrl || ""));
  if (externalUrl == null || !String(externalUrl).trim()) {
    flashCanvasHint("Локальная картинка сохранена в библиотеке, но не применена к письму без публичного URL");
    return false;
  }
  if (!isPublicEmailAssetUrl(externalUrl)) {
    alert("Нужен полный внешний URL вида https://cdn.example.com/image.png. Локальный /studio-assets/ использовать нельзя.");
    return false;
  }
  return setEntrySlotValue(entry, slotId, String(externalUrl).trim());
}

async function openAssetPicker(entry, slotId) {
  const modal = createAssetModal("Библиотека изображений", `<div class="asset-status">Загружаю библиотеку…</div>`);
  const body = modal.querySelector(".asset-dialog-body");
  try {
    const [response, storageStatus] = await Promise.all([
      fetch("/api/assets"),
      loadAssetStorageStatus(),
    ]);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    const items = (data.items || []).filter((item) => (
      String(item.mimeType || "").startsWith("image/") && assetPreviewUrl(item)
    ));
    if (!items.length) {
      body.innerHTML = `<div class="asset-status">В библиотеке пока нет изображений. Используй «Загрузить» рядом с полем.</div>`;
      return;
    }
    const storageWarning = storageStatus?.publicUrls ? "" : `<div class="asset-status asset-status-warning">
      Локальные файлы можно смотреть в Studio, но в письмо они попадут только после указания публичного HTTPS-адреса.
    </div>`;
    body.innerHTML = `${storageWarning}<div class="asset-grid">${items.map((item) => `<button class="asset-card" type="button" data-asset-id="${escapeHtml(item.id)}">
      <img src="${escapeHtml(assetPreviewUrl(item))}" alt="${escapeHtml(item.alt || item.label || "")}" loading="lazy" />
      <span>${escapeHtml(item.label || item.fileName || item.id)}${preferredAssetUrl(item) ? "" : " · только Studio"}</span>
    </button>`).join("")}</div>`;
    body.querySelectorAll("[data-asset-id]").forEach((button) => button.addEventListener("click", async () => {
      const item = items.find((candidate) => candidate.id === button.dataset.assetId);
      if (await applyAssetItemToSlot(entry, slotId, item, storageStatus)) closeAssetModal();
    }));
  } catch (error) {
    body.innerHTML = `<div class="asset-status">Не удалось открыть библиотеку: ${escapeHtml(error.message)}</div>`;
  }
}

function uploadAssetForSlot(entry, slotId) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file) return;
    if (file.size > 12 * 1024 * 1024) {
      alert("Файл больше 12 МБ. Сожми изображение перед загрузкой.");
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      const modal = createAssetModal("Загрузка изображения", `<div class="asset-status">Загружаю ${escapeHtml(file.name)}…</div>`);
      try {
        const response = await fetch("/api/assets/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ files: [{ name: file.name, dataUrl: reader.result, kind: "asset" }] }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
        const item = data.items?.[0];
        if (!item) throw new Error("Сервер не вернул загруженное изображение");
        const applied = await applyAssetItemToSlot(entry, slotId, item);
        if (applied) {
          closeAssetModal();
        } else {
          modal.querySelector(".asset-dialog-body").innerHTML = `<div class="asset-status">
            Файл сохранён в библиотеке, но не применён к письму: укажи для него публичный HTTPS-адрес.
          </div>`;
        }
      } catch (error) {
        modal.querySelector(".asset-dialog-body").innerHTML = `<div class="asset-status">Ошибка загрузки: ${escapeHtml(error.message)}</div>`;
      }
    };
    reader.readAsDataURL(file);
  });
  input.click();
}

function openImageGenerator(entry, slotId, block) {
  const current = String(entry?.slots?.[slotId] || "").trim();
  const modal = createAssetModal(
    "Создать изображение с AI",
    `<label class="insp-slot">Описание изображения
      <textarea class="asset-prompt" id="assetAiPrompt" placeholder="Например: абстрактная оранжевая 3D-композиция для hero-баннера финтех-письма, без текста"></textarea>
    </label>
    ${current ? `<div class="asset-status">Текущее изображение останется без изменений, пока генерация не завершится.</div>` : ""}
    <div class="asset-options">
      <select id="assetAiSize" aria-label="Размер"><option value="1536x1024">Hero · 1536×1024</option><option value="1024x1024">Квадрат · 1024×1024</option><option value="1024x1536">Вертикальное · 1024×1536</option></select>
      <select id="assetAiQuality" aria-label="Качество"><option value="medium">Среднее качество</option><option value="low">Черновик быстрее</option><option value="high">Высокое качество</option></select>
    </div><div class="asset-status" id="assetAiStatus">Результат автоматически сохранится в библиотеке изображений.</div>`,
    `<button class="btn" data-modal-close type="button">Отмена</button><button class="btn btn-primary" id="assetAiGenerate" type="button">✨ Создать</button>`,
  );
  const prompt = modal.querySelector("#assetAiPrompt");
  prompt.value = `Изображение для email-блока «${block?.label || block?.id || "баннер"}». `;
  prompt.focus();
  prompt.setSelectionRange(prompt.value.length, prompt.value.length);
  modal.querySelector("#assetAiGenerate")?.addEventListener("click", async () => {
    const textValue = prompt.value.trim();
    if (textValue.length < 8) { prompt.focus(); return; }
    const button = modal.querySelector("#assetAiGenerate");
    const status = modal.querySelector("#assetAiStatus");
    button.disabled = true;
    status.textContent = "Генерирую изображение — это может занять до пары минут…";
    try {
      const response = await fetch("/api/assets/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: textValue,
          size: modal.querySelector("#assetAiSize").value,
          quality: modal.querySelector("#assetAiQuality").value,
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || `HTTP ${response.status}`);
      if (!data.item) throw new Error("Генератор не вернул изображение");
      const applied = await applyAssetItemToSlot(entry, slotId, data.item);
      if (applied) {
        closeAssetModal();
      } else {
        status.textContent = "Изображение сохранено в библиотеке, но не применено: нужен публичный HTTPS-адрес.";
        button.disabled = false;
      }
    } catch (error) {
      status.textContent = `Не получилось: ${error.message}`;
      button.disabled = false;
    }
  });
}

// Канва → массив для сборки. Для parsed-блоков передаём полный def (их нет в canonical).
function localCanvasAssetReferences() {
  const findings = [];
  for (const entry of state.canvas) {
    for (const [slotId, value] of Object.entries(entry.slots || {})) {
      if (!isLocalStudioAssetUrl(value)) continue;
      findings.push({
        uid: entry.uid,
        blockId: entry.blockId || entry.id,
        slotId,
        value: String(value),
      });
    }
  }
  return findings;
}

function assertCanvasAssetsPublic() {
  const localAssets = localCanvasAssetReferences();
  if (!localAssets.length) return;
  const first = localAssets[0];
  throw new Error(
    `Нельзя собрать письмо: ${first.blockId}.${first.slotId} содержит локальный /studio-assets URL. `
    + "Открой свойства блока и укажи публичный HTTPS-адрес изображения.",
  );
}

function canvasToBlocks(options) {
  const allowLocalAssets = options?.allowLocalAssets === true;
  if (!allowLocalAssets) assertCanvasAssetsPublic();
  return state.canvas.map((c) => {
    const b = blockForEntry(c);
    const out = {
      uid: c.uid,
      blockId: c.blockId,
      id: c.blockId,
      source: c.blockSource || b?.source || undefined,
      parentUid: c.parentUid ?? null,
      slotId: c.slotId || null,
      slots: c.slots || {},
      ...(c.recipeInstanceId ? { recipeInstanceId: c.recipeInstanceId } : {}),
    };
    if (c.appearance && typeof c.appearance === "object" && Object.keys(c.appearance).length) {
      out.appearance = { ...c.appearance };
    }
    // Saved user blocks are release artifacts: send only their id/source so
    // compose reloads the current on-disk record and verifies its approval.
    // Inline definitions are reserved for server-verifiable parsed mail
    // fragments (and unsaved authoring previews, which release-save rejects).
    if (b && !["canonical", "user"].includes(b.source)) {
      out.def = {
        id: b.id,
        label: b.label,
        placement: b.placement,
        category: b.category,
        pug: b.pug,
        styl: b.styl || "",
        slots: b.slots || [],
        childSlots: b.childSlots || [],
        appearance: b.appearance && typeof b.appearance === "object" ? b.appearance : {},
      };
    }
    return out;
  });
}
/**
 * Метка кампании письма.
 *
 * У блоков в ссылках лежат чужие `afftrack`/`retrack` — блок берут в новое
 * письмо, и метка едет с ним. При сборке студия переписывает их на эту.
 * Поле пустое — ничего не трогаем, ссылки остаются как в блоках.
 */
function campaignPayload() {
  const value = ($("campaignName")?.value || "").trim();
  return value ? { campaign: value } : {};
}

function sourceSkeletonPayload() {
  const s = state.sourceSkeleton;
  // A studio-model can contain only canonical entries while still depending on
  // its original branded skeleton. Preserve the chosen source independently of
  // the current entries' source tags.
  return (s && s.brand && s.mail) ? { sourceBrand: s.brand, sourceMail: s.mail } : {};
}

// ─── Live preview (always-on, debounced) ────────────────────────────────
let _livePreviewTimer = null;
let _livePreviewToken = 0;
let _lastLiveHtml = "";
const _livePreviewSessionNonce = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

function livePreviewRequestMailName(rawName, token, nonce = _livePreviewSessionNonce) {
  const base = String(rawName || "preview").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-").slice(0, 48) || "preview";
  const safeNonce = String(nonce || "session").toLowerCase().replace(/[^a-z0-9_-]/g, "-").slice(0, 24) || "session";
  return `${base}-live-${safeNonce}-${Number(token) || 0}`;
}

function setLiveStatus(text, cls) {
  const el = $("livePreviewStatus");
  if (!el) return;
  el.textContent = text;
  el.className = "preview-pane-status" + (cls ? " " + cls : "");
}

function scheduleLivePreview(delay = 650) {
  saveCanvasState();
  if (_livePreviewTimer) clearTimeout(_livePreviewTimer);
  _livePreviewTimer = null;
  const stage = $("previewStage");
  if (!state.canvas.length) {
    // Invalidate a build that may already be in flight. Without this token bump,
    // its late response can paint the deleted email back into an empty canvas.
    _livePreviewToken += 1;
    _lastLiveHtml = "";
    _blockRanges = [];
    stage?.classList.remove("has-content");
    const frame = $("liveFrame");
    if (frame) {
      frame.onload = null;
      frame.srcdoc = "";
      frame.style.height = "";
    }
    $("previewOverlay")?.classList.add("hidden");
    const placeholder = $("previewPlaceholder");
    if (placeholder) placeholder.innerHTML = "Добавь блоки слева — здесь появится живое превью письма.<br><br>Можно перетаскивать блоки прямо сюда, в письмо, а клик по блоку выделяет его для правки.";
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
  // Нет ни одной секции (только обёртка) — не мучаем сборку, показываем подсказку.
  const _hasContent = state.canvas.some((c) => placementOf(blockForEntry(c)) !== "outer");
  if (!_hasContent) {
    stage?.classList.remove("has-content");
    try { $("liveFrame").srcdoc = ""; } catch {}
    const _ph = $("previewPlaceholder"); if (_ph) _ph.textContent = "Добавь секцию или комбо слева — здесь появится письмо.";
    setLiveStatus("добавь секцию", "");
    overlay?.classList.add("hidden");
    return;
  }
  overlay?.classList.remove("hidden");
  setLiveStatus("сборка…");
  try {
    const blocks = canvasToBlocks({ allowLocalAssets: true });
    const previewMailName = livePreviewRequestMailName($("mailName").value, token);
    const res = await fetch("/api/compose-preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mailName: previewMailName, blocks, ...campaignPayload(), ...sourceSkeletonPayload() }),
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
    _lastLiveHtml = sanitizeIframePreviewHtml(data.html);
    stage?.classList.add("has-content");
    const frame = $("liveFrame");
    frame.onload = () => {
      sizeIframeToContent();
      indexIframeBlocks();
      wireIframeInteractions();
      applyIframeSelection();
    };
    frame.srcdoc = _lastLiveHtml;
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
let _draggingBlockSource = "";
let _draggingCanvasUid = null;  // reorder: uid of the placed block being dragged
let _draggingPlacement = "";
let _blockRanges = [];          // [{ uid, index, id, startComment, endComment, firstEl, lastEl }]
let _iframeWired = false;
let _iframeDropContext = null;

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
  const starts = new Map();
  const ends = new Map();
  let node;
  while ((node = walker.nextNode())) {
    const m = /^\s*rk:block-(start|end):([^:]+):([a-z0-9_-]+)\s*$/i.exec(node.nodeValue || "");
    if (!m) continue;
    let uid = m[2];
    try { uid = decodeURIComponent(uid.replace(/~/g, "%")); } catch {}
    if (m[1] === "start") starts.set(uid, { node, id: m[3] });
    else ends.set(uid, { node, id: m[3] });
  }
  starts.forEach((s, uid) => {
    const e = ends.get(uid);
    if (!s || !e) return;
    _blockRanges.push({
      uid,
      index: state.canvas.findIndex((entry) => sameUid(entry.uid, uid)),
      id: s.id,
      startComment: s.node,
      endComment: e.node,
      firstEl: (function(){ const fe = nextElementAfter(s.node); if (fe) { try { fe.setAttribute("draggable","true"); fe.style.cursor = "grab"; } catch {} } return fe; })(),
      lastEl: prevElementBefore(e.node),
    });
  });
  // Превью пересобралось — значит фактические стили могли поменяться.
  refreshAppliedStyles();
  refreshInspectorAppliedNotes();
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
  const range = _blockRanges.find((candidate) => candidate.index === idx);
  return range ? entryByUid(range.uid)?.uid ?? range.uid : (state.canvas[idx]?.uid ?? null);
}

function wireIframeInteractions() {
  const doc = iframeDoc();
  if (!doc) return;
  // Listeners are attached to the fresh document on every load, so the flag is
  // per-document; reset by reload. We attach idempotently.
  doc.addEventListener("click", onIframeClick, true);
  doc.addEventListener("contextmenu", onIframeContextMenu, true);
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
  let best = null;
  for (const r of _blockRanges) {
    if (!r.firstEl) continue;
    // el is within this block if it comes at-or-after firstEl and at-or-before lastEl.
    const afterStart = r.firstEl === el || (r.firstEl.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) || r.firstEl.contains(el);
    const beforeEnd = !r.lastEl || r.lastEl === el || (r.lastEl.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING) || r.lastEl.contains(el);
    if (afterStart && beforeEnd) best = r;
  }
  return best;
}

function onIframeClick(e) {
  if (_draggingBlockId) return;
  const r = rangeForTarget(e.target);
  if (!r) return;
  e.preventDefault();
  const uid = entryByUid(r.uid)?.uid ?? r.uid;
  if (uid != null) selectCanvas(uid);
}

/**
 * ПКМ по блоку прямо в письме. Человек смотрит на превью и кликает по тому,
 * что видит, а не по строке в дереве — меню обязано открываться и здесь.
 * Координаты пересчитываем из системы координат iframe в систему окна,
 * иначе меню уедет на высоту шапки и на величину прокрутки.
 */
function onIframeContextMenu(e) {
  const r = rangeForTarget(e.target);
  if (!r) return;
  e.preventDefault();
  const uid = entryByUid(r.uid)?.uid ?? r.uid;
  if (uid == null) return;
  if (!sameUid(state.selectedUid, uid)) selectCanvas(uid);
  const frame = $("liveFrame");
  const box = frame ? frame.getBoundingClientRect() : { left: 0, top: 0 };
  openCanvasContextMenu(box.left + e.clientX, box.top + e.clientY, uid);
}

function onIframeBlockDragStart(e) {
  if (_draggingBlockId) return;            // a catalog drag wins
  const r = rangeForTarget(e.target);
  if (!r) return;
  const uid = entryByUid(r.uid)?.uid ?? r.uid;
  if (uid == null) return;
  _draggingCanvasUid = uid;
  try { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", ""); } catch {}
}
function onIframeBlockDragEnd() {
  _draggingCanvasUid = null;
  _iframeDropContext = null;
  clearIframeDropLine();
}

function renderedRangeMidpoint(uid) {
  const range = _blockRanges.find((candidate) => sameUid(candidate.uid, uid));
  const firstRect = range?.firstEl?.getBoundingClientRect();
  if (!firstRect) return null;
  const lastRect = (range.lastEl || range.firstEl).getBoundingClientRect();
  return firstRect.top + (lastRect.bottom - firstRect.top) / 2;
}

function siblingBeforeUidAtPointer(parentUid, slotId, anchorUid, clientY) {
  const anchor = entryByUid(anchorUid);
  if (!anchor || !sameUid(anchor.parentUid, parentUid) || anchor.slotId !== slotId) return null;
  const midpoint = renderedRangeMidpoint(anchor.uid);
  if (midpoint == null || clientY <= midpoint) return anchor.uid;
  const siblings = childrenOf(parentUid, slotId);
  const index = siblings.findIndex((entry) => sameUid(entry.uid, anchor.uid));
  return siblings[index + 1]?.uid ?? null;
}

function iframeDropContextFor(target, clientY) {
  const movingEntry = entryByUid(_draggingCanvasUid);
  const block = movingEntry ? blockForEntry(movingEntry) : blockById(_draggingBlockId, _draggingBlockSource);
  if (!block) return null;
  const placement = placementOf(block);
  const targetRange = rangeForTarget(target);
  const targetEntry = targetRange ? entryByUid(targetRange.uid) : null;
  const targetBlock = blockForEntry(targetEntry);

  if (placement === "outer") return { root: true, rangeIndex: iframeInsertionIndex(clientY) };
  if (placement === "section") {
    const outer = rootOuterEntry();
    const slot = chooseChildSlot(blockForEntry(outer), block);
    if (!outer || !slot) return null;
    const targetSection = placementOf(targetBlock) === "section"
      ? targetEntry
      : (targetEntry ? entryByUid(targetEntry.parentUid) : null);
    const beforeUid = targetSection
      ? siblingBeforeUidAtPointer(outer.uid, slot.id, targetSection.uid, clientY)
      : null;
    return { parentUid: outer.uid, slotId: slot.id, beforeUid, rangeIndex: iframeInsertionIndex(clientY) };
  }
  if (placement === "both") {
    // Спейсер: на/между секциями → МЕЖДУ секциями (уровень обёртки); на inner → внутрь секции.
    if (placementOf(targetBlock) === "section" || !targetEntry) {
      const outer = rootOuterEntry();
      const slot = outer ? chooseChildSlot(blockForEntry(outer), block) : null;
      if (outer && slot) {
        const targetSection = placementOf(targetBlock) === "section"
          ? targetEntry
          : (targetEntry ? entryByUid(targetEntry.parentUid) : null);
        const beforeUid = targetSection
          ? siblingBeforeUidAtPointer(outer.uid, slot.id, targetSection.uid, clientY)
          : null;
        return { parentUid: outer.uid, slotId: slot.id, beforeUid, rangeIndex: iframeInsertionIndex(clientY) };
      }
    }
  }

  let parent = null;
  let preferredSlot = null;
  let beforeUid = null;
  if (placementOf(targetBlock) === "section") {
    parent = targetEntry;
  } else if (targetEntry && isInnerBlock(targetBlock)) {
    parent = entryByUid(targetEntry.parentUid);
    preferredSlot = targetEntry.slotId;
    beforeUid = siblingBeforeUidAtPointer(parent?.uid, preferredSlot, targetEntry.uid, clientY);
  } else {
    parent = latestSectionEntry(block);
  }
  const slot = chooseChildSlot(blockForEntry(parent), block, preferredSlot);
  if (!parent || !slot) return null;
  return { parentUid: parent.uid, slotId: slot.id, beforeUid, rangeIndex: iframeInsertionIndex(clientY) };
}

function onIframeDragOver(e) {
  if (!_draggingBlockId && _draggingCanvasUid == null) return;
  const context = iframeDropContextFor(e.target, e.clientY);
  if (!context) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = _draggingCanvasUid == null ? "copy" : "move";
  _iframeDropContext = context;
  showIframeDropLine(context);
}

function onIframeDragLeave(e) {
  // Only clear when leaving the document entirely.
  if (!e.relatedTarget) clearIframeDropLine();
}

function onIframeDrop(e) {
  if (!_draggingBlockId && _draggingCanvasUid == null) return;
  const context = _iframeDropContext || iframeDropContextFor(e.target, e.clientY);
  if (!context) return;
  e.preventDefault();
  _iframeDropContext = null;
  clearIframeDropLine();
  if (_draggingCanvasUid != null) {           // reorder an existing block
    const moving = entryByUid(_draggingCanvasUid);
    _draggingCanvasUid = null;
    if (!moving || context.root) return;
    const parent = entryByUid(context.parentUid);
    const slot = chooseChildSlot(blockForEntry(parent), blockForEntry(moving), context.slotId);
    if (!parent || !slot || descendantUids(moving.uid).has(String(parent.uid))) return;
    pushCanvasUndo();
    moving.parentUid = parent.uid;
    moving.slotId = slot.id;
    moveSubtreeBefore(moving.uid, context.beforeUid && !sameUid(context.beforeUid, moving.uid) ? context.beforeUid : null);
    finishCanvasMutation(moving.uid);
    return;
  }
  const block = blockById(_draggingBlockId, _draggingBlockSource);
  _draggingBlockId = null;
  _draggingBlockSource = "";
  document.body.classList.remove("dragging-from-catalog");
  if (block) addToCanvas(block, context.root ? { origin: "catalog" } : { ...context, origin: "catalog" });
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

function showIframeDropLine(contextOrIndex) {
  const doc = iframeDoc();
  if (!doc) return;
  clearIframeDropLine();
  const line = doc.createElement("div");
  line.id = "__rk_drop_line";
  line.style.cssText =
    "height:4px;background:#2563eb;border-radius:3px;margin:0;box-shadow:0 0 8px #2563eb;" +
    "position:relative;z-index:99999;pointer-events:none;";
  if (contextOrIndex && typeof contextOrIndex === "object" && contextOrIndex.parentUid != null) {
    const beforeRange = contextOrIndex.beforeUid != null
      ? _blockRanges.find((range) => sameUid(range.uid, contextOrIndex.beforeUid))
      : null;
    if (beforeRange?.firstEl) {
      beforeRange.firstEl.insertAdjacentElement("beforebegin", line);
      return;
    }
    const siblings = childrenOf(contextOrIndex.parentUid, contextOrIndex.slotId)
      .filter((entry) => !sameUid(entry.uid, _draggingCanvasUid));
    const last = [...siblings].reverse()
      .map((entry) => _blockRanges.find((range) => sameUid(range.uid, entry.uid)))
      .find((range) => range?.lastEl || range?.firstEl);
    const lastAnchor = last?.lastEl || last?.firstEl;
    if (lastAnchor) {
      lastAnchor.insertAdjacentElement("afterend", line);
      return;
    }
  }
  const insertAt = typeof contextOrIndex === "number"
    ? contextOrIndex
    : (contextOrIndex?.rangeIndex ?? _blockRanges.length);
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
  const r = _blockRanges.find((rr) => sameUid(rr.uid, state.selectedUid));
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
    const blocks = canvasToBlocks({ allowLocalAssets: true });
    const res = await fetch("/api/compose-preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mailName: $("mailName").value.trim() || "preview", blocks, ...campaignPayload(), ...sourceSkeletonPayload() }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      $("previewFrame").srcdoc = `<pre style="padding:20px;color:red;font-family:monospace">${escapeHtml(data.error || "build failed")}\n${escapeHtml(data.stderr || "")}</pre>`;
      $("previewStats").textContent = "Ошибка";
      return;
    }
    $("previewFrame").srcdoc = sanitizeIframePreviewHtml(data.html);
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
  let blocks;
  try {
    blocks = canvasToBlocks();
  } catch (error) {
    alert(error.message);
    return;
  }
  const brand = await chooseSaveTarget();
  if (!brand) return;

  const doSave = async (force) => {
    const res = await fetch("/api/compose-save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ brand, mailName, blocks, force: !!force, ...campaignPayload(), ...sourceSkeletonPayload() }),
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
  childSlots: [],         // structural {{ *_BLOCKS }} markers
  appearance: {},         // generic surface defaults without native style slots
};

const AUTHOR_TEMPLATES = {
  section: {
    id: "my-section",
    label: "Моя средняя секция",
    placement: "section",
    category: "layout",
    description: "Средняя секция-контейнер: внутренние блоки вставляются в content.",
    pug: "table.row.my-section(role='presentation' width='100%' style='background-color:{{ background_color }};border:{{ border }};border-radius:{{ radius }}')\n    tr\n        td.my-section-content(style='padding:{{ padding }};text-align:{{ align }}')\n            //- {{ INNER_BLOCKS }}",
    styl: ".my-section{width:100%;border-collapse:separate!important}.my-section-content{font-family:Helvetica,Arial,sans-serif}",
    slots: {
      background_color: { kind: "color", label: "Цвет фона", default: "#FFFFFF" },
      border: { kind: "text", label: "Обводка", default: "none" },
      radius: { kind: "text", label: "Скругление", default: "24px" },
      padding: { kind: "text", label: "Внутренние отступы", default: "32px 24px" },
      align: { kind: "text", label: "Выравнивание", default: "left" },
    },
  },
  "outer-divider": {
    id: "my-section-spacer",
    label: "Мой внешний разделитель",
    placement: "section",
    category: "utility",
    description: "Разделитель между средними секциями и комбо на уровне обёртки письма.",
    pug: "table.row.my-section-spacer(role='presentation' width='100%' style='background-color:{{ background_color }}')\n    tr\n        td(height='{{ height }}' style='height:{{ height }}px;font-size:1px;line-height:1px;background-color:{{ background_color }}') &nbsp;",
    styl: ".my-section-spacer{width:100%;border-collapse:collapse}",
    slots: {
      background_color: { kind: "color", label: "Цвет промежутка", default: "transparent" },
      height: { kind: "number", label: "Высота, px", default: 24 },
    },
  },
  "inner-divider": {
    id: "my-inner-spacer",
    label: "Мой внутренний разделитель",
    placement: "inner",
    category: "utility",
    description: "Разделитель между элементами внутри одной средней секции.",
    pug: "table.my-inner-spacer(role='presentation' width='100%' style='background-color:{{ background_color }}')\n    tr\n        td(height='{{ height }}' style='height:{{ height }}px;font-size:1px;line-height:1px;background-color:{{ background_color }}') &nbsp;",
    styl: ".my-inner-spacer{width:100%;border-collapse:collapse}",
    slots: {
      background_color: { kind: "color", label: "Цвет промежутка", default: "transparent" },
      height: { kind: "number", label: "Высота, px", default: 16 },
    },
  },
  inner: {
    id: "my-text-block",
    label: "Мой внутренний блок",
    placement: "inner",
    category: "text",
    description: "Редактируемый элемент, который вставляется внутрь средней секции.",
    pug: "table.my-text-block(role='presentation' width='100%' style='background-color:{{ background_color }};border:{{ border }};border-radius:{{ radius }}')\n    tr\n        td(style='padding:{{ padding }};text-align:{{ align }}')\n            p.my-text(style='color:{{ text_color }};text-align:{{ align }}') {{ text }}",
    styl: ".my-text-block{width:100%;border-collapse:separate!important}.my-text{margin:0;font-family:Helvetica,Arial,sans-serif;font-size:18px;line-height:26px}",
    slots: {
      text: { kind: "richText", label: "Текст", default: "Текст блока" },
      text_color: { kind: "color", label: "Цвет текста", default: "#393A44" },
      background_color: { kind: "color", label: "Цвет фона", default: "transparent" },
      border: { kind: "text", label: "Обводка", default: "none" },
      radius: { kind: "text", label: "Скругление", default: "0" },
      padding: { kind: "text", label: "Внутренние отступы", default: "0" },
      align: { kind: "text", label: "Выравнивание", default: "left" },
    },
  },
};

const SLOT_KINDS = ["text", "richText", "url", "image", "color", "number", "select"];

function guessSlotKind(id) {
  if (/color/i.test(id) || /(?:^|_)(?:bg|background)(?:_color)?$/i.test(id)) return "color";
  if (/href|url|link/i.test(id)) return "url";
  // CSS shorthands often contain units and several values ("16px 24px"),
  // therefore treating them as a number silently produces broken styles.
  if (/border|radius|padding|margin|spacing|gap/i.test(id)) return "text";
  if (/width|height|size/i.test(id)) return "number";
  if (/image|img|logo|icon|photo|picture/i.test(id)) return "image";
  return "text";
}

function defaultForKind(kind, id) {
  if (kind === "color") return /background|(^|_)bg($|_)/i.test(id) ? "transparent" : "#393A44";
  if (kind === "number") return 16;
  if (kind === "url" || kind === "image") return "https://example.com";
  if (/border/i.test(id)) return "none";
  if (/radius|padding|margin|spacing|gap/i.test(id)) return "0";
  if (/align/i.test(id)) return "left";
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
      if (/^[A-Z][A-Z0-9_]*_BLOCKS$/.test(t)) continue;
      if (!seen.has(t)) { seen.add(t); tokens.push(t); }
    }
  }
  return tokens;
}

function childSlotIdForMarker(marker) {
  if (marker === "SECTION_BLOCKS") return "sections";
  if (marker === "INNER_BLOCKS") return "content";
  return marker.toLowerCase().replace(/_blocks$/, "").replace(/_/g, "-").slice(0, 64) || "content";
}

function buildAuthorChildSlots() {
  const placement = $("abPlacement").value;
  if (placement !== "outer" && placement !== "section") return [];
  const previous = new Map((authorState.childSlots || []).map((slot) => [slot.marker, slot]));
  const markers = [];
  const seen = new Set();
  const re = /\{\{\s*([A-Z][A-Z0-9_]*_BLOCKS)\s*\}\}/g;
  let match;
  while ((match = re.exec($("abPug").value || ""))) {
    const marker = match[1];
    if (seen.has(marker)) continue;
    seen.add(marker);
    const old = previous.get(marker);
    markers.push({
      id: old?.id || childSlotIdForMarker(marker),
      marker,
      accepts: placement === "outer" ? ["section"] : ["inner"],
    });
  }
  authorState.childSlots = markers;
  return markers;
}

function refreshAuthorTreeHint() {
  const placement = $("abPlacement").value;
  const childSlots = buildAuthorChildSlots();
  const hint = $("abTreeHint");
  if (!hint) return;
  hint.className = "author-tree-hint";
  if (placement === "section" && childSlots.length) {
    hint.textContent = `✓ Средняя секция-контейнер: ${childSlots.map((slot) => slot.id).join(" / ")} принимает внутренние блоки.`;
    hint.classList.add("ok");
  } else if (placement === "section") {
    hint.textContent = "Самостоятельная section без вложений — подходит для внешнего разделителя. Для составной секции используй заготовку «Средняя секция».";
    hint.classList.add("warn");
  } else if (placement === "inner") {
    hint.textContent = "Внутренний блок: конструктор разрешит вставку только внутрь средней секции.";
  } else if (placement === "outer") {
    hint.textContent = "Outer — логическая рамка дерева. Реальный head/body-каркас берётся из скелета проекта; произвольный Outer Pug не заменяет его при сборке.";
    hint.classList.add("warn");
  } else {
    hint.textContent = "Старый уровень both сохранён только для совместимости. Выбери явный section или inner.";
    hint.classList.add("warn");
  }
}

function applyAuthorTemplate(templateId) {
  const template = AUTHOR_TEMPLATES[templateId];
  if (!template) return;
  if ($("abPug").value.trim() && !confirm("Заменить текущую Pug/Stylus-заготовку выбранным шаблоном?")) return;
  if (!$("abId").disabled && !$("abId").value.trim()) $("abId").value = template.id;
  $("abLabel").value = template.label;
  $("abPlacement").value = template.placement;
  $("abCategory").value = template.category;
  $("abDesc").value = template.description;
  $("abPug").value = template.pug;
  $("abStyl").value = template.styl;
  authorState.slotMeta = JSON.parse(JSON.stringify(template.slots || {}));
  authorState.childSlots = [];
  authorState.appearance = {};
  renderAuthorSlots();
  refreshAuthorTreeHint();
  scheduleAuthorPreview(150);
}

function openBlockAuthor(block, opts = {}) {
  const asNew = !!opts.asNew;
  authorState.editingId = block && !asNew ? block.id : null;
  authorState.slotMeta = {};
  authorState.childSlots = Array.isArray(block?.childSlots)
    ? block.childSlots.map((slot) => ({ ...slot, accepts: [...(slot.accepts || [])] }))
    : [];
  authorState.appearance = block?.appearance && typeof block.appearance === "object"
    ? { ...block.appearance }
    : {};
  $("authorTitle").textContent = block
    ? (asNew ? `⧉ Копия блока «${block.label || block.id}»` : `✎ Редактировать блок «${block.label || block.id}»`)
    : "➕ Новый блок";
  $("abId").value = block ? block.id : "";
  $("abId").disabled = !!block && !asNew;
  $("abLabel").value = block ? (block.label || "") : "";
  $("abPlacement").value = block && block.placement ? block.placement : "inner";
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
  refreshAuthorTreeHint();
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
  refreshAuthorTreeHint();

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
    uiGroup: slotInspectorGroup({ id, kind: m.kind || "text" }),
  }));
}

function buildAuthorDef() {
  const def = {
    label: $("abLabel").value.trim() || $("abId").value.trim() || "draft",
    placement: $("abPlacement").value,
    pug: $("abPug").value,
    styl: $("abStyl").value,
    slots: buildAuthorSlots(),
  };
  const childSlots = buildAuthorChildSlots();
  if (childSlots.length) def.childSlots = childSlots;
  if (authorState.appearance && Object.keys(authorState.appearance).length) {
    def.appearance = { ...authorState.appearance };
  }
  return def;
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
    $("abFrame").srcdoc = sanitizeIframePreviewHtml(data.html);
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
  const childSlots = buildAuthorChildSlots();
  const placement = $("abPlacement").value;
  const category = $("abCategory").value.trim() || "misc";
  const structuralTags = ["user", "authored"];
  const dividerHint = `${id} ${category} ${$("abLabel").value}`;
  if (placement === "section" && !childSlots.length && /spacer|divider|разделител|utility/i.test(dividerHint)) {
    structuralTags.push("outer-divider", "combo-divider");
  } else if (placement === "inner" && /spacer|divider|разделител|utility/i.test(dividerHint)) {
    structuralTags.push("inner-divider");
  }
  const payload = {
    id,
    label: $("abLabel").value.trim() || id,
    description: $("abDesc").value.trim(),
    placement,
    category,
    pug: $("abPug").value,
    styl: $("abStyl").value,
    slots: buildAuthorSlots(),
    tags: structuralTags,
    force: !!authorState.editingId,
  };
  if (childSlots.length) payload.childSlots = childSlots;
  if (authorState.appearance && Object.keys(authorState.appearance).length) {
    payload.appearance = { ...authorState.appearance };
  }
  let res = await fetch("/api/blocks-library/save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  let data = await res.json();
  if (res.status === 409) {
    if (/protected/i.test(String(data.error || ""))) {
      alert(`ID "${id}" принадлежит системному блоку. Сохрани ручной вариант под новым ID — оригинал защищён от перезаписи.`);
      $("abId").focus();
      return;
    }
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
  state.sourceScope = "user";
  if ($("catSourceScope")) $("catSourceScope").value = "user";
  await loadLibrary();
  closeBlockAuthor();
  const reviewStatus = data.review?.status || "draft";
  const reviewErrors = data.review?.deterministic?.errors || [];
  alert(reviewStatus === "candidate"
    ? `✓ Блок "${id}" сохранён как candidate. После визуальной проверки нажми ✓ в «Мои блоки», чтобы одобрить его.`
    : `Блок "${id}" сохранён как draft и пока не вставляется.\n${reviewErrors.slice(0, 3).join("\n") || "Исправь код и повтори сохранение."}`);
  // If the edited block is on the canvas, refresh preview so changes show up.
  if (state.canvas.some((c) => c.blockId === id)) scheduleLivePreview(100);
}

$("newBlockBtn")?.addEventListener("click", () => openBlockAuthor(null));
$("authorClose")?.addEventListener("click", closeBlockAuthor);
$("abCancel")?.addEventListener("click", closeBlockAuthor);
$("abSave")?.addEventListener("click", saveAuthorBlock);
document.querySelectorAll("[data-author-template]").forEach((button) => {
  button.addEventListener("click", () => applyAuthorTemplate(button.dataset.authorTemplate));
});
["abPug", "abStyl"].forEach((fid) => {
  $(fid)?.addEventListener("input", () => { renderAuthorSlots(); scheduleAuthorPreview(); });
});
["abPlacement", "abId"].forEach((fid) => {
  $(fid)?.addEventListener("input", () => { refreshAuthorTreeHint(); scheduleAuthorPreview(); });
});

// ─── Wire up ────────────────────────────────────────────────────────────
document.querySelectorAll(".cat-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    setRailMode("blocks");
    setCatalogFilter(tab.dataset.filter, { manual: true });
  });
});

$("openGalleryBtn")?.addEventListener("click", openBlockGallery);

/* ─── Оператор студии в конструкторе ────────────────────────────────────────
 * Та же сущность, что и в коде письма: общий эндпоинт, общий набор
 * инструментов, общая история. Конструктор лишь рассказывает о себе —
 * какое дерево блоков собрано прямо сейчас.
 */
/**
 * Применить правки канваса, которые агент накопил через update_canvas_block.
 * Сервер их только передаёт: канвас существует лишь в браузере.
 * Одна отмена на весь пакет — человек говорил одну фразу, откатывать он
 * тоже захочет одним Ctrl+Z, а не по слоту.
 */
function applyAgentCanvasOps(ops) {
  if (!Array.isArray(ops) || !ops.length) return;
  const slotValues = globalThis.RetkitCanvasSlots;
  const prepared = [];
  const missed = [];
  const rejected = [];

  for (const op of ops) {
    const entry = entryByUid(op?.uid);
    if (!entry) { missed.push(op?.uid); continue; }
    let slots = null;
    if (op.slots && typeof op.slots === "object") {
      if (!slotValues?.normalizeSlotPatch) {
        rejected.push("проверка типов слотов недоступна");
        continue;
      }
      const checked = slotValues.normalizeSlotPatch(blockForEntry(entry)?.slots, op.slots);
      if (!checked.ok) {
        rejected.push(...checked.errors.map((item) => item.error));
        continue;
      }
      slots = checked.values;
    }
    prepared.push({ entry, slots, appearance: op.appearance });
  }

  // The package is one operator action and therefore atomic: one invalid
  // single-line slot must not leave half of the requested edits on canvas.
  if (rejected.length) {
    console.warn("[constructor] rejected agent canvas operation", rejected);
    flashCanvasHint(`Оператор не применил правку: ${rejected[0]}`, 6000);
    return;
  }
  if (!prepared.length) {
    flashCanvasHint(`Оператор не нашёл блок на канвасе${missed.length ? ` (uid ${missed.join(", ")})` : ""}`);
    return;
  }

  const applied = [];
  pushCanvasUndo();
  for (const { entry, slots, appearance } of prepared) {
    if (slots) {
      entry.slots = { ...(entry.slots || {}), ...slots };
      Object.keys(slots).forEach((slotId) => markEntrySlotExplicit(entry, slotId));
    }
    if (appearance && typeof appearance === "object") {
      entry.appearance = { ...(entry.appearance || {}), ...appearance };
    }
    applied.push(entry.uid);
  }
  if (applied.length) state.selectedUid = applied[0];
  finishCanvasMutation(state.selectedUid);
  flashCanvasHint(applied.length === 1
    ? "Оператор изменил блок — Ctrl+Z отменит"
    : `Оператор изменил ${applied.length} блока — Ctrl+Z отменит`);
}

let _studioChat = null;
function ensureStudioChat() {
  if (_studioChat) return _studioChat;
  if (typeof StudioChat === "undefined") return null;
  _studioChat = new StudioChat({
    surface: "constructor",
    title: "Оператор — конструктор",
    buildContext: () => ({
      // Дерево отдаём как есть: сервер не хранит несохранённый канвас,
      // а агент должен видеть именно текущее состояние сборки.
      canvas: state.canvas.map((e) => {
        const block = blockForEntry(e);
        return {
          uid: e.uid, blockId: e.blockId || e.id, blockSource: e.blockSource || e.source,
          parentUid: e.parentUid, slotId: e.slotId, slots: e.slots || {},
          slotSchema: (block?.slots || []).map((slot) => ({
            id: slot.id,
            kind: slot.kind || "text",
            label: slot.label || slot.id,
            ...(Array.isArray(slot.options) ? { options: slot.options } : {}),
          })),
        };
      }),
      html: _lastLiveHtml || "",
    }),
    onResult: (payload) => {
      applyAgentCanvasOps(payload?.canvasOps);
      // Агент собрал письмо своим инструментом — предлагаем открыть результат,
      // но не подменяем канвас молча: человек мог не этого хотеть.
      if (payload?.composed?.brand && payload.composed.mailName) {
        const { brand, mailName } = payload.composed;
        if (confirm(`Оператор собрал письмо ${brand}/${mailName}. Открыть его в конструкторе?`)) {
          loadParsedEmail(brand, `mail-${String(mailName).replace(/^mail-/, "")}`);
        }
      }
    },
  });
  return _studioChat;
}
$("openChatBtn")?.addEventListener("click", () => ensureStudioChat()?.toggle());
document.addEventListener("keydown", (e) => {
  // Esc закрывает чат, но только если не открыто что-то поверх него.
  if (e.key !== "Escape") return;
  if (document.getElementById("blockGallery") || document.querySelector(".canvas-ctx-menu")) return;
  _studioChat?.close();
});
$("paletteBlocksMode")?.addEventListener("click", () => setRailMode("blocks"));
$("paletteOutlineMode")?.addEventListener("click", () => setRailMode("outline"));
$("paletteAutoBtn")?.addEventListener("click", () => {
  state.autoPalette = !state.autoPalette;
  updatePaletteAutoButton();
  if (state.autoPalette) syncPaletteToSelection();
  saveCanvasState();
});
$("paletteParentBtn")?.addEventListener("click", () => {
  const selected = entryByUid(state.selectedUid);
  if (selected?.parentUid != null) selectCanvas(selected.parentUid);
});

$("previewBtn").addEventListener("click", preview);
$("saveBtn").addEventListener("click", save);
$("previewClose").addEventListener("click", () => $("previewModal").classList.add("hidden"));
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    $("previewModal").classList.add("hidden");
    if (!$("authorModal").classList.contains("hidden")) closeBlockAuthor();
    if (!$("viewModal").classList.contains("hidden")) closeBlockView();
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

// ─── Catalog filter controls ────────────────────────────────────────────
function populateCatalogFilters() {
  const brandSel = $("catBrand"), catSel = $("catCategory");
  if (!brandSel || !catSel) return;
  const keepBrand = brandSel.value, keepCat = catSel.value;
  const eligible = state.library.filter((block) => catalogSourceAllowed(block, state.sourceScope));
  const brands = Array.from(new Set(eligible.map(brandOf))).sort();
  const cats = Array.from(new Set(eligible.map((b) => b.category || "misc"))).sort();
  brandSel.innerHTML = '<option value="all">Все бренды</option>' +
    brands.map((x) => `<option value="${escapeHtml(x)}">${escapeHtml(x)}</option>`).join("");
  catSel.innerHTML = '<option value="all">Все категории</option>' +
    cats.map((x) => `<option value="${escapeHtml(x)}">${escapeHtml(x)}</option>`).join("");
  if (brands.includes(keepBrand)) brandSel.value = keepBrand;
  if (cats.includes(keepCat)) catSel.value = keepCat;
}
let _searchDebounce = null;
$("catSearch")?.addEventListener("input", (e) => {
  clearTimeout(_searchDebounce);
  _searchDebounce = setTimeout(() => {
    state.q = e.target.value || "";
    state.renderCap = 60;
    renderCatalog();
  }, 150);
});
$("catBrand")?.addEventListener("change", (e) => { state.brand = e.target.value; state.renderCap = 60; renderCatalog(); });
$("catCategory")?.addEventListener("change", (e) => { state.cat = e.target.value; state.renderCap = 60; renderCatalog(); });
$("catMobile")?.addEventListener("change", (e) => { state.mobileOnly = e.target.checked; state.renderCap = 60; renderCatalog(); });
$("catSourceScope")?.addEventListener("change", (e) => {
  state.sourceScope = ["curated", "user", "all"].includes(e.target.value) ? e.target.value : "curated";
  state.brand = "all";
  state.cat = "all";
  state.renderCap = 60;
  populateCatalogFilters();
  renderCatalog();
});

// View modal wiring
$("viewCloseBtn")?.addEventListener("click", closeBlockView);
$("viewDupBtn")?.addEventListener("click", () => duplicateToUserBlock(_viewBlock));
$("viewModal")?.addEventListener("click", (e) => { if (e.target === $("viewModal")) closeBlockView(); });

wireCanvasDnd();
wirePreviewStageDnd();
/* Deep-link из workbench: /constructor?brand=..&mail=.. — разобрать письмо
   из базы обратно в канвас (кнопка «🎨 В конструктор» в окне кода). */
async function loadConstructorDeepLink(search = window.location.search) {
  try {
    const query = new URLSearchParams(search);
    const brand = query.get("brand");
    const mail = query.get("mail");
    if (!brand || !mail) return false;
    const loaded = await loadParsedEmail(brand, mail);
    if (!loaded) return false;
    // Query остаётся в адресе при ошибке/stale, поэтому reload может повторить
    // загрузку. Убираем его только после успешной гидрации канваса.
    history.replaceState(null, "", "/constructor");
    return true;
  } catch { return false; }
}
loadLibrary().then(() => loadConstructorDeepLink());

// Переключили вкладку бренда — каталог перерисовывается: часть блоков
// принадлежит другой семье и в чужом бренде только мешает.
window.RetkitBrands?.onChange?.(() => {
  state.renderCap = 60;
  if (state.library.length) renderCatalog();
});


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

try { console.log('%c[RetKit] constructor build 2026-07-13-style-surface: explicit gaps + block appearance', 'color:#f70;font-weight:bold'); } catch {}
const RETKIT_CONSTRUCTOR_BUILD = '2026-07-13-style-surface';

/* ─── База писем в конструкторе: переиспользуем workbench-эндпоинт /api/wb/emails.
   Кнопка «🗂 База» → модалка (поиск) → клик открывает письмо в редакторе. */
(function initBaseBrowser() {
  const btn = document.getElementById("baseBtn");
  if (!btn) return;
  let overlay = null;
  const htmlCache = new Map(); // "brand/mail" -> sanitized html | null (не собрано/ошибка)
  const close = () => { if (overlay) { overlay.remove(); overlay = null; } };

  async function fetchList() {
    const r = await fetch("/api/wb/emails");
    const data = await r.json();
    const flat = [];
    for (const g of (data.emails || [])) for (const m of (g.mails || [])) flat.push({ brand: g.brand, name: m.name, built: m.built });
    return flat;
  }

  async function builtHtmlFor(brand, mail) {
    const key = brand + "/" + mail;
    if (htmlCache.has(key)) return htmlCache.get(key);
    try {
      const r = await fetch(`/api/wb/email?brand=${encodeURIComponent(brand)}&mail=${encodeURIComponent(mail)}`);
      const d = await r.json();
      const html = d && d.ok && d.html ? sanitizeIframePreviewHtml(d.html) : null;
      htmlCache.set(key, html);
      return html;
    } catch { htmlCache.set(key, null); return null; }
  }

  function normalizeMailFolderName(raw) {
    let name = String(raw || "").trim().replace(/[^a-zA-Z0-9_-]/g, "-").replace(/^-+|-+$/g, "");
    if (!name) return null;
    if (!/^mail-/.test(name)) name = "mail-" + name;
    return name;
  }

  function render(initialList) {
    let listData = initialList;
    overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9999;display:flex;align-items:center;justify-content:center;";
    const box = document.createElement("div");
    box.style.cssText = "background:#1c1f26;color:#e6e6e6;width:min(980px,95vw);height:min(660px,90vh);border-radius:12px;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 10px 40px rgba(0,0,0,.5);";
    box.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;padding:13px 16px;border-bottom:1px solid #2c313c;flex:none;">
        <b style="font-size:15px;">База писем</b>
        <span id="baseCount" style="color:#8b93a3;font-size:12px;"></span>
        <input id="baseSearch" placeholder="Поиск: бренд / имя…" style="margin-left:auto;background:#12151b;border:1px solid #2c313c;color:#e6e6e6;border-radius:8px;padding:7px 10px;width:230px;" />
        <button id="baseClose" style="background:#2c313c;border:none;color:#e6e6e6;border-radius:8px;padding:7px 11px;cursor:pointer;">✕</button>
      </div>
      <div style="display:flex;flex:1;min-height:0;">
        <div id="baseBrands" style="width:186px;flex:none;overflow:auto;padding:8px 6px;border-right:1px solid #2c313c;background:#171b22;"></div>
        <div id="baseList" style="flex:1;overflow:auto;padding:8px;border-right:1px solid #2c313c;"></div>
        <div style="width:344px;flex:none;display:flex;flex-direction:column;background:#12151b;min-height:0;">
          <div id="basePreviewLabel" style="padding:8px 12px;font-size:11px;color:#8b93a3;border-bottom:1px solid #2c313c;flex:none;">Наведи на письмо — предпросмотр</div>
          <div id="basePreviewWrap" style="flex:1;overflow-y:auto;overflow-x:hidden;position:relative;">
            <div id="basePreviewScaler" style="position:relative;width:340px;height:0;overflow:hidden;">
              <iframe id="basePreviewFrame" title="Предпросмотр письма" sandbox="allow-same-origin"
                style="position:absolute;top:0;left:0;width:640px;height:2400px;transform:scale(0.53);transform-origin:0 0;border:0;background:#fff;pointer-events:none;display:none;"></iframe>
            </div>
            <div id="basePreviewEmpty" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#5b6472;font-size:12px;padding:0 20px;text-align:center;">Наведи на письмо в списке</div>
          </div>
        </div>
      </div>
      <div style="padding:6px 16px;border-top:1px solid #2c313c;color:#5b6472;font-size:11px;flex:none;">Правый клик по письму: дублировать · переименовать · удалить. Клик — закрепить предпросмотр.</div>`;
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    const listEl = box.querySelector("#baseList");
    const searchEl = box.querySelector("#baseSearch");

    /* ── Предпросмотр справа ── */
    let previewToken = 0;
    let pinnedKey = null; // клик «закрепляет» письмо: hover больше не перебивает
    async function showPreview(entry, { pinned = false } = {}) {
      if (!pinned && pinnedKey) return;
      const token = ++previewToken;
      const label = box.querySelector("#basePreviewLabel");
      const frame = box.querySelector("#basePreviewFrame");
      const scaler = box.querySelector("#basePreviewScaler");
      const empty = box.querySelector("#basePreviewEmpty");
      label.textContent = `${entry.brand} / ${entry.name.replace(/^mail-/, "")}${pinned ? " 📌" : ""}`;
      if (!entry.built) {
        frame.style.display = "none"; scaler.style.height = "0";
        empty.style.display = "flex"; empty.textContent = "Письмо ещё не собрано — нет HTML для предпросмотра";
        return;
      }
      empty.style.display = "flex"; empty.textContent = "Загрузка…";
      const html = await builtHtmlFor(entry.brand, entry.name);
      if (token !== previewToken) return;
      if (!html) {
        frame.style.display = "none"; scaler.style.height = "0";
        empty.textContent = "Не удалось загрузить HTML";
        return;
      }
      frame.srcdoc = html;
      frame.style.display = "block";
      scaler.style.height = Math.round(2400 * 0.53) + "px";
      empty.style.display = "none";
    }

    /* ── Мини-превью в строках (лениво, только для видимых) ── */
    const thumbObserver = new IntersectionObserver((entries) => {
      for (const it of entries) {
        if (!it.isIntersecting) continue;
        const el = it.target;
        thumbObserver.unobserve(el);
        const brand = el.dataset.brand, mail = el.dataset.mail;
        builtHtmlFor(brand, mail).then((html) => {
          if (!html || !el.isConnected) return;
          const f = document.createElement("iframe");
          f.setAttribute("sandbox", "allow-same-origin");
          f.style.cssText = "width:640px;height:840px;transform:scale(0.0625);transform-origin:0 0;border:0;background:#fff;pointer-events:none;";
          f.srcdoc = html;
          el.textContent = "";
          el.appendChild(f);
        });
      }
    }, { root: listEl, rootMargin: "120px" });

    /* ── Контекстное меню (ПКМ) ── */
    function ctxAction(label, fn, danger = false) {
      const b = document.createElement("button");
      b.textContent = label;
      b.style.cssText = `display:block;width:100%;text-align:left;background:none;border:none;color:${danger ? "#ff8b8b" : "#e6e6e6"};padding:8px 11px;border-radius:7px;cursor:pointer;font-size:13px;`;
      b.addEventListener("mouseenter", () => b.style.background = danger ? "#4a2430" : "#2c3a5a");
      b.addEventListener("mouseleave", () => b.style.background = "none");
      b.addEventListener("click", fn);
      return b;
    }

    async function mailAction(url, payload, okMessage) {
      try {
        const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
        const d = await r.json();
        if (!r.ok || d.error) { alert("Не получилось: " + (d.error || r.status)); return false; }
        if (okMessage) console.log("[base]", okMessage);
        return true;
      } catch (e) { alert("Ошибка: " + e.message); return false; }
    }

    async function refreshList() {
      try {
        listData = await fetchList();
        // Счётчики в папках берутся из listData — без пересчёта после
        // удаления письма папка показывала бы старое число.
        drawBrandFolders();
        draw(searchEl.value);
      } catch (e) { alert("Не удалось обновить базу: " + e.message); }
    }

    function openContextMenu(x, y, entry) {
      document.querySelectorAll(".base-ctx-menu").forEach((m) => m.remove());
      const menu = document.createElement("div");
      menu.className = "base-ctx-menu";
      menu.style.cssText = `position:fixed;left:${x}px;top:${y}px;z-index:10001;background:#232833;border:1px solid #2c313c;border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.5);padding:6px;min-width:230px;`;
      const closeMenu = () => menu.remove();
      menu.appendChild(ctxAction("🎨 Открыть в конструкторе", () => { closeMenu(); close(); loadParsedEmail(entry.brand, entry.name); }));
      menu.appendChild(ctxAction("⟨⟩ Открыть в коде", () => {
        window.location.href = `/workbench?brand=${encodeURIComponent(entry.brand)}&mail=${encodeURIComponent(entry.name)}`;
      }));
      const hr = document.createElement("div");
      hr.style.cssText = "height:1px;background:#2c313c;margin:5px 4px;";
      menu.appendChild(hr);
      menu.appendChild(ctxAction("📋 Дублировать…", async () => {
        closeMenu();
        const suggested = entry.name + "-copy";
        const raw = prompt("Имя копии письма:", suggested);
        if (raw == null) return;
        const newName = normalizeMailFolderName(raw);
        if (!newName) { alert("Некорректное имя."); return; }
        if (await mailAction("/api/wb/email-clone", { brand: entry.brand, mail: entry.name, newName }, `clone → ${newName}`)) refreshList();
      }));
      menu.appendChild(ctxAction("✏️ Переименовать…", async () => {
        closeMenu();
        const raw = prompt("Новое имя письма:", entry.name);
        if (raw == null || raw === entry.name) return;
        const newName = normalizeMailFolderName(raw);
        if (!newName) { alert("Некорректное имя."); return; }
        if (await mailAction("/api/wb/email-rename", { brand: entry.brand, mail: entry.name, newName }, `rename → ${newName}`)) {
          htmlCache.delete(entry.brand + "/" + entry.name);
          refreshList();
        }
      }));
      menu.appendChild(ctxAction("🗑 Удалить (в _trash)", async () => {
        closeMenu();
        if (!confirm(`Убрать «${entry.name.replace(/^mail-/, "")}» из ${entry.brand} в корзину (_trash)?`)) return;
        if (await mailAction("/api/wb/email-delete", { brand: entry.brand, mail: entry.name }, "moved to _trash")) {
          htmlCache.delete(entry.brand + "/" + entry.name);
          if (pinnedKey === entry.brand + "/" + entry.name) pinnedKey = null;
          refreshList();
        }
      }, true));
      document.body.appendChild(menu);
      const rect = menu.getBoundingClientRect();
      if (rect.right > window.innerWidth - 8) menu.style.left = Math.max(8, window.innerWidth - rect.width - 8) + "px";
      if (rect.bottom > window.innerHeight - 8) menu.style.top = Math.max(8, window.innerHeight - rect.height - 8) + "px";
      const dismiss = (ev) => {
        if (!menu.contains(ev.target)) { closeMenu(); document.removeEventListener("mousedown", dismiss, true); }
      };
      setTimeout(() => document.addEventListener("mousedown", dismiss, true), 0);
    }

    /* ── Папки брендов слева ──
       Бренд здесь берётся из реестра (/api/brands), а не из имён папок: у
       бренда есть название и фирменный цвет, и в списке должен быть виден
       даже тот, в котором писем ещё нет — иначе непонятно, куда сохранять. */
    let selectedBrand = window.RetkitBrands?.activeId?.() || "all";
    function drawBrandFolders() {
      const host = box.querySelector("#baseBrands");
      if (!host) return;
      const counts = new Map();
      for (const e of listData) counts.set(e.brand, (counts.get(e.brand) || 0) + 1);
      const registry = (window.RetkitBrands?.all?.() || []);
      const known = new Map(registry.map((b) => [b.id, b]));
      const ids = [...new Set([...registry.map((b) => b.id), ...counts.keys()])]
        .sort((a, b) => (counts.get(b) || 0) - (counts.get(a) || 0) || a.localeCompare(b));
      if (selectedBrand !== "all" && !ids.includes(selectedBrand)) selectedBrand = "all";

      const row = (id, label, count, color) => {
        const on = selectedBrand === id;
        const dot = color
          ? `<span style="width:9px;height:9px;border-radius:50%;background:${color};flex:none;"></span>`
          : `<span style="width:9px;flex:none;"></span>`;
        return `<button class="base-brand" data-brand="${escapeHtml(id)}" title="${escapeHtml(label)} · ${count} писем"
          style="display:flex;align-items:center;gap:7px;width:100%;text-align:left;border:none;cursor:pointer;font:inherit;font-size:12px;padding:6px 8px;border-radius:7px;margin-bottom:2px;background:${on ? "#2c3a5a" : "transparent"};color:${on ? "#cfe0ff" : "#c3cad6"};">
          ${dot}
          <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(label)}</span>
          <span style="color:#6d7787;font-size:11px;">${count}</span>
        </button>`;
      };

      host.innerHTML = row("all", "Все письма", listData.length, "")
        + `<div style="height:1px;background:#2c313c;margin:6px 2px;"></div>`
        + ids.map((id) => {
            const brand = known.get(id);
            return row(id, brand?.label || id.replace(/^X_/, ""), counts.get(id) || 0, brand?.theme?.primary || "#5b6472");
          }).join("");

      host.querySelectorAll(".base-brand").forEach((el) => {
        el.addEventListener("click", () => {
          selectedBrand = el.dataset.brand;
          drawBrandFolders();
          draw(searchEl.value);
        });
      });
    }

    /* ── Список ── */
    let hoverTimer = null;
    const draw = (q) => {
      const ql = (q || "").trim().toLowerCase();
      const rows = listData
        .filter((e) => selectedBrand === "all" || e.brand === selectedBrand)
        .filter((e) => !ql || (e.brand + " " + e.name).toLowerCase().includes(ql));
      const scopeNote = selectedBrand === "all" ? "" : ` · папка ${selectedBrand}`;
      box.querySelector("#baseCount").textContent = `${rows.length} из ${listData.length} писем${scopeNote}`;
      listEl.innerHTML = rows.slice(0, 500).map((e) => `
        <div class="base-row" data-brand="${e.brand}" data-mail="${e.name}" style="display:flex;align-items:center;gap:10px;padding:6px 10px;border-radius:8px;cursor:default;">
          <div class="base-thumb" data-brand="${e.brand}" data-mail="${e.name}"
               style="width:40px;height:52px;flex:none;border-radius:5px;overflow:hidden;background:${e.built ? "#0d1015" : "#181c24"};border:1px solid #2c313c;display:flex;align-items:center;justify-content:center;color:#3f4757;font-size:15px;">${e.built ? "…" : "∅"}</div>
          <span style="width:8px;height:8px;border-radius:50%;background:${e.built ? "#3ad07a" : "#5b6472"};flex:none;" title="${e.built ? "собрано" : "не собрано"}"></span>
          <span style="color:#8b93a3;font-size:11px;min-width:110px;">${e.brand}</span>
          <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${e.name.replace(/^mail-/, "")}</span>
          <button class="base-ctor" style="background:#2c3a5a;border:none;color:#cfe0ff;border-radius:6px;padding:5px 9px;cursor:pointer;font-size:11px;">в конструктор</button>
          <button class="base-wb" style="background:#2c313c;border:none;color:#e6e6e6;border-radius:6px;padding:5px 9px;cursor:pointer;font-size:11px;">в код</button>
        </div>`).join("") || `<div style="padding:20px;color:#8b93a3;">Ничего не найдено</div>`;
      listEl.querySelectorAll(".base-thumb").forEach((el) => {
        if (el.textContent === "…") thumbObserver.observe(el);
      });
      listEl.querySelectorAll(".base-row").forEach((r) => {
        const entry = { brand: r.dataset.brand, name: r.dataset.mail, built: !!listData.find((e) => e.brand === r.dataset.brand && e.name === r.dataset.mail && e.built) };
        r.addEventListener("mouseenter", () => {
          r.style.background = "#232833";
          clearTimeout(hoverTimer);
          hoverTimer = setTimeout(() => showPreview(entry), 140);
        });
        r.addEventListener("mouseleave", () => { r.style.background = ""; clearTimeout(hoverTimer); });
        r.addEventListener("click", () => {
          const key = entry.brand + "/" + entry.name;
          pinnedKey = pinnedKey === key ? null : key;
          if (pinnedKey) showPreview(entry, { pinned: true });
        });
        r.addEventListener("contextmenu", (ev) => {
          ev.preventDefault();
          openContextMenu(ev.clientX, ev.clientY, entry);
        });
        r.querySelector(".base-wb").addEventListener("click", (ev) => {
          ev.stopPropagation();
          window.location.href = `/workbench?brand=${encodeURIComponent(entry.brand)}&mail=${encodeURIComponent(entry.name)}`;
        });
        r.querySelector(".base-ctor").addEventListener("click", (ev) => {
          ev.stopPropagation();
          close();
          loadParsedEmail(entry.brand, entry.name);
        });
      });
    };
    drawBrandFolders();
    draw("");
    searchEl.addEventListener("input", (e) => draw(e.target.value));
    box.querySelector("#baseClose").addEventListener("click", close);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
    document.addEventListener("keydown", function esc(ev) {
      if (ev.key === "Escape") {
        const menu = document.querySelector(".base-ctx-menu");
        if (menu) { menu.remove(); return; }
        close(); document.removeEventListener("keydown", esc);
      }
    });
  }

  btn.addEventListener("click", async () => {
    try {
      render(await fetchList());
    } catch (err) { alert("Не удалось загрузить базу: " + err.message); }
  });
})();

/* Удаление выделенного блока по Delete/Backspace (если фокус не в поле ввода). */
document.addEventListener("keydown", (e) => {
  if (e.key !== "Delete" && e.key !== "Backspace") return;
  const t = e.target;
  if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
  if (!state.selectedUid) return;
  e.preventDefault();
  removeFromCanvas(state.selectedUid);
});

/* ─── Системные плейсхолдеры: реестр + вставка в слот ───────────────────── */
state.placeholders = [];
(function loadPlaceholders() {
  fetch("/api/placeholders").then((r) => r.json()).then((d) => {
    state.placeholders = Array.isArray(d.groups) ? d.groups : [];
  }).catch(() => {});
})();

function openPlaceholderMenu(btn, entry) {
  document.querySelectorAll(".ph-menu").forEach((m) => m.remove());
  const forId = btn.getAttribute("data-ph-for");
  const menu = document.createElement("div");
  menu.className = "ph-menu";
  menu.style.cssText = "position:fixed;z-index:10000;background:#1c1f26;color:#e6e6e6;border:1px solid #2c313c;border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.5);max-height:60vh;overflow:auto;min-width:250px;padding:6px;";
  const groups = state.placeholders || [];
  if (!groups.length) {
    menu.innerHTML = `<div style="padding:10px;color:#8b93a3;">Реестр плейсхолдеров пуст</div>`;
  } else {
    menu.innerHTML = groups.map((g) => `
      <div style="padding:6px 8px 2px;color:#8b93a3;font-size:11px;text-transform:uppercase;">${g.label || g.ns}</div>
      ${(g.items || []).map((it) => `
        <div class="ph-item" data-token="${it.token.replace(/"/g,'&quot;')}" style="padding:7px 9px;border-radius:7px;cursor:pointer;font-size:13px;">
          <b>${it.label}</b> ${it.perLocale ? '<span style="color:#f79b3a;font-size:10px;">по локалям</span>' : ''}
          <div style="color:#5b6472;font-size:11px;font-family:ui-monospace,Menlo,monospace;">${it.token}</div>
        </div>`).join("")}`).join("");
  }
  document.body.appendChild(menu);
  const r = btn.getBoundingClientRect();
  menu.style.top = Math.min(r.bottom + 4, window.innerHeight - menu.offsetHeight - 8) + "px";
  menu.style.left = Math.max(8, Math.min(r.left, window.innerWidth - menu.offsetWidth - 8)) + "px";

  menu.querySelectorAll(".ph-item").forEach((el) => {
    el.addEventListener("mouseenter", () => el.style.background = "#232833");
    el.addEventListener("mouseleave", () => el.style.background = "");
    el.addEventListener("click", () => {
      const token = el.getAttribute("data-token");
      const input = document.querySelector(`[data-slot-id="${CSS.escape(forId)}"]`);
      if (input) {
        // вставляем в позицию курсора (или в конец)
        pushCanvasUndo();
        const start = input.selectionStart ?? input.value.length;
        const end = input.selectionEnd ?? input.value.length;
        input.value = input.value.slice(0, start) + token + input.value.slice(end);
        entry.slots[forId] = input.value;
        markEntrySlotExplicit(entry, forId);
        scheduleLivePreview();
      }
      menu.remove();
    });
  });
  const close = (ev) => { if (!menu.contains(ev.target) && ev.target !== btn) { menu.remove(); document.removeEventListener("mousedown", close); } };
  setTimeout(() => document.addEventListener("mousedown", close), 0);
}


/* ─── Открыть письмо базы В КОНСТРУКТОРЕ: разбор на блоки (parse-email) ──── */
function parsedEmailLoadBlockReason(data) {
  if (!data?.studioModelStale) return "";
  return "Письмо отвязано от конструктора после правок кода. Чтобы не затереть Pug/Stylus и локали, продолжайте работу в Workbench или создайте копию письма с новым именем.";
}

function modelCampaignBindings(entries) {
  const findings = [];
  const visit = (items) => {
    for (const entry of Array.isArray(items) ? items : []) {
      if (!entry || typeof entry !== "object") continue;
      const blockId = entry.blockId || entry.id || "unknown";
      const inlineDef = entry.def || entry.definition || entry.block;
      const known = blockById(blockId, entry.blockSource || entry.source);
      const category = String(inlineDef?.category || known?.category || "").toLowerCase();
      // Footer placeholders are an explicit product feature. Everywhere else a
      // campaign namespace makes a reusable block silently depend on one mail.
      if (category !== "footer") {
        for (const [slotId, raw] of Object.entries(entry.slots || {})) {
          if (typeof raw !== "string") continue;
          const matches = raw.match(/\$\{\{\s*[a-z0-9_.-]+\s*\}\}\$/gi) || [];
          matches.forEach((token) => findings.push({ blockId, slotId, token }));
        }
      }
      if (Array.isArray(entry.children)) visit(entry.children);
    }
  };
  visit(entries);
  return findings;
}

function showLoadedSourceNotice(data) {
  const notice = $("loadedLegacyWarning");
  if (!notice) return;
  if (data?.source === "parsed-source") {
    notice.textContent = "Открыто legacy-письмо без модели конструктора. Секции, картинки и стили сохранены в исходном порядке как цельный код; отдельные поля внутри них не распознаны.";
    notice.classList.remove("hidden");
    return;
  }
  const bindings = modelCampaignBindings(data?.entries || data?.blocks || []);
  if (bindings.length) {
    const sample = bindings.slice(0, 2).map((item) => `${item.blockId}.${item.slotId}`).join(", ");
    notice.textContent = `В сохранённой модели найдено ${bindings.length} привязок к namespace конкретной кампании (${sample}). Они оставлены без изменений; замени их вручную перед повторным использованием.`;
    notice.classList.remove("hidden");
    return;
  }
  notice.classList.add("hidden");
}

async function loadParsedEmail(brand, mail) {
  try {
    const r = await fetch(`/api/constructor/parse-email?brand=${encodeURIComponent(brand)}&mail=${encodeURIComponent(mail)}`);
    const d = await r.json();
    const blockedReason = parsedEmailLoadBlockReason(d);
    if (blockedReason) { alert(blockedReason); return false; }
    if (!d.ok || !Array.isArray(d.blocks) || !d.blocks.length) { alert("Не удалось разобрать письмо: " + (d.error || "пусто")); return false; }
    const defs = d.source === "studio-model" ? (d.defs || []) : d.blocks;
    const existing = new Set(state.library.map((b) => `${b.source || ""}:${b.id}`));
    for (const rawDef of defs) {
      if (!rawDef?.id || typeof rawDef.pug !== "string") continue;
      const def = { ...rawDef, source: rawDef.source || "parsed" };
      const key = `${def.source}:${def.id}`;
      if (!existing.has(key)) { state.library.push(def); existing.add(key); }
    }
    if (d.source === "studio-model") {
      for (const modelEntry of d.entries || d.blocks) {
        if (!modelEntry?.def || typeof modelEntry.def.pug !== "string") continue;
        const id = modelEntry.blockId || modelEntry.id;
        const def = { ...modelEntry.def, id, source: modelEntry.source || "parsed" };
        const key = `${def.source}:${def.id}`;
        if (!existing.has(key)) { state.library.push(def); existing.add(key); }
      }
      state.canvas = migrateCanvasTree(d.entries || d.blocks);
    } else {
      state.canvas = migrateCanvasTree(d.blocks.map((b) => ({
        uid: nextUid(),
        blockId: b.id,
        blockSource: b.source || "parsed",
        slots: defaultSlotsFor(b),
      })));
    }
    state.sourceSkeleton = { brand, mail };
    showLoadedSourceNotice(d);
    state.selectedUid = null;
    const nameInput = document.getElementById("mailName");
    if (nameInput) nameInput.value = mail.replace(/^mail-/, "");
    // Метку кампании письмо хранит рядом с деревом — возвращаем её в поле,
    // иначе при пересохранении ссылки уехали бы обратно к меткам блоков.
    const campaignInput = document.getElementById("campaignName");
    if (campaignInput) campaignInput.value = String(d.model?.campaign || "");
    populateCatalogFilters();
    renderCanvas(); renderInspector(); syncPaletteToSelection(); scheduleLivePreview();
    return true;
  } catch (e) { alert("Ошибка разбора: " + e.message); return false; }
}


/* ─── Автосохранение канвы (письмо не пропадает между сессиями) ─────────── */
function migrateCanvasTree(rawEntries) {
  const raw = Array.isArray(rawEntries) ? rawEntries.filter(Boolean).map((entry) => {
    const copy = { ...entry, slots: { ...(entry.slots || {}) } };
    const explicitSlots = Array.isArray(entry.explicitSlots)
      ? [...new Set(entry.explicitSlots.map(String).filter(Boolean))]
      : [];
    if (explicitSlots.length) copy.explicitSlots = explicitSlots;
    else delete copy.explicitSlots;
    return copy;
  }) : [];
  const used = new Set();
  for (const entry of raw) {
    let uid = entry.uid;
    if (uid == null || used.has(String(uid))) uid = nextUid();
    entry.uid = uid;
    used.add(String(uid));
    entry.blockId = entry.blockId || entry.id;
    entry.blockSource = entry.blockSource || entry.source || undefined;
    if (typeof uid === "number" && Number.isFinite(uid)) state._uidCounter = Math.max(state._uidCounter, uid + 1);
  }
  const hasExplicitRelations = raw.some((entry) => Object.prototype.hasOwnProperty.call(entry, "parentUid"));
  if (hasExplicitRelations) {
    // Compatibility with the short-lived ambiguous iq-spacer definition: old
    // saved trees could place it directly under outer. Keep those layouts, but
    // migrate them to the explicit section-level divider definition.
    for (const entry of raw) {
      const parent = raw.find((candidate) => sameUid(candidate.uid, entry.parentUid));
      if (entry.blockId === "iq-spacer" && placementOf(blockForEntry(parent)) === "outer" && blockById("iq-section-spacer")) {
        entry.blockId = "iq-section-spacer";
        entry.blockSource = blockById("iq-section-spacer").source || entry.blockSource;
      } else if (entry.blockId === "iq-section-spacer" && placementOf(blockForEntry(parent)) === "section" && blockById("iq-spacer")) {
        entry.blockId = "iq-spacer";
        entry.blockSource = blockById("iq-spacer").source || entry.blockSource;
      }
    }
    for (const entry of raw) {
      const block = blockForEntry(entry);
      if (placementOf(block) === "outer") {
        entry.parentUid = null;
        entry.slotId = entry.slotId || "root";
      } else if (!Object.prototype.hasOwnProperty.call(entry, "parentUid")) {
        entry.parentUid = null;
      }
    }
    state.canvas = raw;
    normalizeCanvasOrder();
    return state.canvas;
  }

  const result = [];
  let outer = raw.find((entry) => placementOf(blockForEntry(entry)) === "outer") || null;
  if (!outer) {
    const def = findDefaultBlock("outer");
    if (def) outer = createEntry(def, { parentUid: null, slotId: "root" });
  }
  if (outer) {
    outer.parentUid = null;
    outer.slotId = "root";
    result.push(outer);
  }
  let section = null;
  for (const entry of raw) {
    if (sameUid(entry.uid, outer?.uid)) continue;
    const block = blockForEntry(entry);
    const placement = placementOf(block);
    if (placement === "outer") continue;
    if (placement === "section") {
      const slot = chooseChildSlot(blockForEntry(outer), block);
      entry.parentUid = outer?.uid ?? null;
      entry.slotId = slot?.id || "sections";
      section = entry;
      result.push(entry);
      continue;
    }
    if (!section) {
      const sectionDef = findDefaultBlock("section");
      if (sectionDef && outer) {
        const outerSlot = chooseChildSlot(blockForEntry(outer), sectionDef);
        section = createEntry(sectionDef, { parentUid: outer.uid, slotId: outerSlot?.id || "sections" });
        result.push(section);
      }
    }
    const slot = chooseChildSlot(blockForEntry(section), block);
    entry.parentUid = section?.uid ?? null;
    entry.slotId = slot?.id || "content";
    result.push(entry);
  }
  state.canvas = result;
  normalizeCanvasOrder();
  return state.canvas;
}

function saveCanvasState() {
  try {
    const parsedDefs = state.library.filter((b) => b.source === "parsed");
    localStorage.setItem("retkit-constructor-canvas", JSON.stringify({
      canvas: state.canvas,
      sourceSkeleton: state.sourceSkeleton || null,
      mailName: document.getElementById("mailName")?.value || "",
      parsedDefs,
      _uidCounter: state._uidCounter,
      schemaVersion: 2,
      railMode: state.railMode,
      autoPalette: state.autoPalette,
    }));
  } catch (e) { /* ignore */ }
}
function restoreCanvasState() {
  try {
    const raw = localStorage.getItem("retkit-constructor-canvas");
    if (!raw) return;
    const d = JSON.parse(raw);
    if (Array.isArray(d.parsedDefs)) {
      const have = new Set(state.library.map((b) => b.id));
      for (const b of d.parsedDefs) if (!have.has(b.id)) state.library.push(b);
    }
    if (typeof d._uidCounter === "number") state._uidCounter = Math.max(state._uidCounter, d._uidCounter);
    if (Array.isArray(d.canvas) && d.canvas.length) {
      // оставляем только те, чей блок есть в библиотеке
      state.canvas = migrateCanvasTree(d.canvas.filter((e) => blockById(e.blockId || e.id, e.blockSource || e.source)));
      state.sourceSkeleton = d.sourceSkeleton || null;
      state.autoPalette = d.autoPalette !== false;
      setRailMode(d.railMode || "blocks");
      const nameInput = document.getElementById("mailName");
      if (nameInput && d.mailName) nameInput.value = d.mailName;
      renderCanvas(); renderInspector(); syncPaletteToSelection(); scheduleLivePreview();
    }
  } catch (e) { /* ignore */ }
}


/* ─── Выбор целевого бренда для сохранения письма ──────────────────────── */
async function chooseSaveTarget({ allowTemp = false } = {}) {
  let brands = [];
  try {
    const r = await fetch("/api/wb/emails");
    const data = await r.json();
    brands = (data.emails || []).map((g) => g.brand).filter((b) => b && b !== "X_preview");
  } catch { /* сеть упала — останется ручной ввод нового бренда */ }
  // Бренд из реестра может быть заведён только что и ещё не иметь писем —
  // по одному лишь /api/wb/emails он бы не появился в списке, и сохранить
  // в него было бы некуда.
  for (const brand of (window.RetkitBrands?.all?.() || [])) {
    if (brand.id && !brands.includes(brand.id)) brands.push(brand.id);
  }
  if (!brands.includes("X_assembled")) brands.push("X_assembled");
  // Предвыбор — активная вкладка бренда: обычно сохраняют туда, где работают.
  const activeBrandId = window.RetkitBrands?.activeId?.() || "";
  const brandLabel = (id) => {
    const found = (window.RetkitBrands?.all?.() || []).find((b) => b.id === id);
    return found && found.label !== id.replace(/^X_/, "") ? `${found.label} (${id})` : id;
  };

  return new Promise((resolve) => {
    const row = "display:flex;gap:8px;align-items:center;padding:8px 10px;border-radius:8px;cursor:pointer;background:#12151b;";
    const overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;display:flex;align-items:center;justify-content:center;";
    const options = [
      ...(allowTemp ? [`<label style="${row}"><input type="radio" name="saveTarget" value="__temp__" checked /> ⏱ Временно (X_preview) — только доработать сейчас</label>`] : []),
      ...brands.map((b, i) => {
        const preselect = allowTemp
          ? false
          : (activeBrandId ? b === activeBrandId : i === 0);
        return `<label style="${row}"><input type="radio" name="saveTarget" value="${escapeHtml(b)}" ${preselect ? "checked" : ""} /> 📁 ${escapeHtml(brandLabel(b))}</label>`;
      }),
      `<label style="${row}"><input type="radio" name="saveTarget" value="__new__" /> ➕ Новый бренд: <input id="newBrandName" type="text" placeholder="X_MyBrand" style="flex:1;background:#0d1015;border:1px solid #2c313c;color:#e6e6e6;border-radius:6px;padding:5px 8px;" /></label>`,
    ].join("");
    overlay.innerHTML = `
      <div style="background:#1c1f26;color:#e6e6e6;width:min(460px,92vw);border-radius:12px;padding:16px;box-shadow:0 10px 40px rgba(0,0,0,.5);display:flex;flex-direction:column;gap:10px;">
        <div style="font-weight:600;font-size:14px;">Куда сохранить письмо?</div>
        ${options}
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:4px;">
          <button id="saveTargetCancel" style="background:#2c313c;border:none;color:#e6e6e6;border-radius:8px;padding:7px 14px;cursor:pointer;">Отмена</button>
          <button id="saveTargetOk" style="background:#2c3a5a;border:none;color:#cfe0ff;border-radius:8px;padding:7px 14px;cursor:pointer;">Продолжить</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const done = (value) => { overlay.remove(); resolve(value); };
    overlay.querySelector("#newBrandName").addEventListener("focus", () => {
      overlay.querySelector('input[name="saveTarget"][value="__new__"]').checked = true;
    });
    overlay.querySelector("#saveTargetCancel").addEventListener("click", () => done(null));
    overlay.addEventListener("click", (e) => { if (e.target === overlay) done(null); });
    overlay.querySelector("#saveTargetOk").addEventListener("click", () => {
      const picked = overlay.querySelector('input[name="saveTarget"]:checked')?.value;
      if (!picked) { done(null); return; }
      if (picked === "__temp__") { done("X_preview"); return; }
      if (picked === "__new__") {
        let name = (overlay.querySelector("#newBrandName").value || "").trim().replace(/[^a-zA-Z0-9_]/g, "");
        if (!name) { alert("Введи имя нового бренда (буквы/цифры/подчёркивание)."); return; }
        if (!/^X_/i.test(name)) name = "X_" + name;
        done(name); return;
      }
      done(picked);
    });
  });
}

/* ─── «→ В код»: перенос собранного письма в workbench ─────────────────── */
async function transferToCode() {
  if (!state.canvas.length) { alert("Канвас пуст — сначала собери письмо."); return; }
  const rawName = (document.getElementById("mailName")?.value || "").trim() || "draft";
  if (!/^[a-z0-9_-]+$/i.test(rawName)) { alert("Имя письма: только буквы, цифры, дефис, подчёркивание."); return; }
  // Opening the code workspace is not a permanent save/version action.
  // Persist the working copy in the hidden service base; the explicit
  // “Save mail” button remains the only path that asks for a destination.
  const brand = "X_preview";
  const button = document.getElementById("toCodeBtn");
  if (button) {
    button.disabled = true;
    button.textContent = "→ Готовлю Pug…";
  }
  try {
    const send = async (force) => {
      const response = await fetch("/api/compose-save", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brand, mailName: rawName, blocks: canvasToBlocks(), force, ...campaignPayload(), ...sourceSkeletonPayload() }),
      });
      return { response, data: await response.json() };
    };
    let { response: res, data: d } = await send(false);
    if (res.status === 409) {
      ({ response: res, data: d } = await send(true));
    }
    if (res.status === 200 && d.ok) {
      const mid = d.mail || ("mail-" + rawName);
      window.location.href = "/workbench?brand=" + encodeURIComponent(brand) + "&mail=" + encodeURIComponent(mid);
    } else {
      alert("Не удалось перенести:\n" + (d.error || "unknown") + (d.stderr ? "\n\n" + d.stderr.slice(0, 300) : ""));
    }
  } catch (e) {
    alert("Ошибка переноса: " + e.message);
  } finally {
    if (button && window.location.pathname === "/constructor") {
      button.disabled = false;
      button.textContent = "→ В код";
    }
  }
}
document.getElementById("toCodeBtn")?.addEventListener("click", transferToCode);

document.getElementById("clearCanvasBtn")?.addEventListener("click", clearCanvas);

/* ─── Ссылки письма в одном списке ───────────────────────────────────────────
   Ссылки разбросаны по слотам десятка блоков, и найти их все, кликая по
   каждому блоку, невозможно. Здесь они собраны в одно окно: видно, где какая
   стоит, любую можно заменить, а можно заменить все разом — например, поменяв
   заглушки на боевые адреса перед выпуском. */
function collectCanvasLinks() {
  const out = [];
  for (const entry of state.canvas) {
    const def = blockForEntry(entry);
    for (const slot of (def?.slots || [])) {
      if (slot.kind !== "url" && slot.kind !== "link") continue;
      const value = Object.prototype.hasOwnProperty.call(entry.slots || {}, slot.id)
        ? entry.slots[slot.id]
        : slot.default;
      out.push({
        uid: entry.uid,
        slotId: slot.id,
        where: `${def.label || def.id} · ${slot.label || slot.id}`,
        value: String(value ?? ""),
      });
    }
  }
  return out;
}

function openLinksDialog() {
  const links = collectCanvasLinks();
  const overlay = document.createElement("div");
  overlay.className = "brandbar-overlay";
  const rows = links.map((link, index) => `
    <div class="links-row">
      <span class="links-where" title="${escapeHtml(link.where)}">${escapeHtml(link.where)}</span>
      <input type="text" data-link="${index}" value="${escapeHtml(link.value)}" spellcheck="false" />
    </div>`).join("");

  overlay.innerHTML = `
    <div class="brandbar-dialog" style="width:min(760px,94vw)">
      <div class="brandbar-dialog-title">Ссылки письма — ${links.length}</div>
      <div class="brandbar-hint">
        Метка кампании (<code>afftrack</code>, <code>retrack</code>) переписывается при сборке
        отдельно — полем в шапке. Здесь сами адреса.
      </div>
      ${links.length ? `<div class="links-bulk">
        <input type="text" id="linksBulkValue" placeholder="https://… — поставить во все ссылки" spellcheck="false" />
        <button type="button" class="brandbar-btn" id="linksBulkApply">Во все</button>
      </div>` : `<div class="brandbar-hint">В письме пока нет блоков со ссылками.</div>`}
      <div style="max-height:52vh;overflow:auto;">${rows}</div>
      <div class="brandbar-actions">
        <button type="button" class="brandbar-btn" id="linksCancel">Отмена</button>
        <button type="button" class="brandbar-btn primary" id="linksSave">Применить</button>
      </div>
    </div>`;

  const close = () => { overlay.remove(); document.removeEventListener("keydown", onKey); };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  document.addEventListener("keydown", onKey);
  overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) close(); });
  document.body.appendChild(overlay);

  overlay.querySelector("#linksBulkApply")?.addEventListener("click", () => {
    const value = overlay.querySelector("#linksBulkValue").value.trim();
    if (!value) return;
    overlay.querySelectorAll("[data-link]").forEach((input) => { input.value = value; });
  });
  overlay.querySelector("#linksCancel").addEventListener("click", close);
  overlay.querySelector("#linksSave").addEventListener("click", () => {
    pushCanvasUndo();
    let changed = 0;
    overlay.querySelectorAll("[data-link]").forEach((input) => {
      const link = links[Number(input.dataset.link)];
      const next = input.value.trim();
      if (!link || next === link.value) return;
      const entry = entryByUid(link.uid);
      if (!entry) return;
      entry.slots = entry.slots || {};
      entry.slots[link.slotId] = next;
      markEntrySlotExplicit(entry, link.slotId);
      changed += 1;
    });
    close();
    if (changed) {
      renderCanvas(); renderInspector(); scheduleLivePreview();
      flashCanvasHint(`Заменено ссылок: ${changed}`);
    }
  });
}

document.getElementById("linksBtn")?.addEventListener("click", openLinksDialog);
