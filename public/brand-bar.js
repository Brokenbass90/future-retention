/**
 * public/brand-bar.js — полоса брендов над рабочей областью конструктора.
 *
 * Бренд перестал быть именем папки (см. src/brands.js), и здесь он становится
 * видимым: активный бренд — это рабочий контекст, а не фильтр каталога.
 * Он задаёт три вещи и только их, чтобы не обещать лишнего:
 *   1. куда по умолчанию сохраняется письмо;
 *   2. какие цвета показываются как фирменные (тема);
 *   3. какой бренд подсвечен в базе писем.
 *
 * Фильтр каталога намеренно оставлен отдельным: «бренд» блока выводится из
 * префикса id (`iq-cta-12` → iq) и к реестру отношения не имеет. Свести их в
 * один переключатель значило бы соврать пользователю о том, что происходит.
 *
 * Выбор переживает перезагрузку (localStorage) — иначе после каждого F5
 * пришлось бы заново вспоминать, в каком бренде работаешь.
 */
(() => {
  "use strict";

  const STORAGE_KEY = "retkit-active-brand";
  const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

  const state = {
    brands: [],
    tokens: [],
    activeId: "",
    listeners: [],
  };

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));

  /** `#f70` → `#FF7700`. Правило то же, что на сервере: в письме только HEX. */
  function normalizeHex(value) {
    const raw = String(value || "").trim();
    const m = HEX_RE.exec(raw);
    if (!m) return "";
    const body = m[1].length === 3 ? m[1].split("").map((c) => c + c).join("") : m[1];
    return `#${body.toUpperCase()}`;
  }

  /** Чёрный текст на светлой плашке, белый на тёмной — иначе метка не читается. */
  function readableOn(hex) {
    const n = parseInt(normalizeHex(hex).slice(1) || "888888", 16);
    const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    // Яркость по YIQ: зелёный воспринимается ярче красного и синего.
    // Порог 128 — классический; при 150 фирменный оранжевый #FF7700 (яркость
    // 146) получал белую букву, хотя по контрасту WCAG чёрная читается вчетверо
    // лучше (9.4:1 против 2.2:1).
    return (0.299 * r + 0.587 * g + 0.114 * b) > 128 ? "#101318" : "#FFFFFF";
  }

  function activeBrand() {
    return state.brands.find((b) => b.id === state.activeId) || null;
  }

  function notify() {
    for (const fn of state.listeners) {
      try { fn(activeBrand()); } catch { /* один слушатель не должен ронять остальные */ }
    }
  }

  function setActive(id, { silent = false } = {}) {
    const next = state.brands.find((b) => b.id === id);
    if (!next) return;
    state.activeId = next.id;
    try { localStorage.setItem(STORAGE_KEY, next.id); } catch { /* приватный режим */ }
    renderTabs();
    if (!silent) notify();
  }

  /* ─── Данные ───────────────────────────────────────────────────────────── */

  async function loadBrands() {
    const response = await fetch("/api/brands");
    const data = await response.json();
    if (!response.ok || !data?.ok) throw new Error(data?.error || `HTTP ${response.status}`);
    // Служебные папки (X_preview) — не рабочий контекст, в полосе им не место.
    state.brands = (data.brands || []).filter((b) => !b.service);
    state.tokens = data.tokens || [];
    if (!state.brands.some((b) => b.id === state.activeId)) {
      let stored = "";
      try { stored = localStorage.getItem(STORAGE_KEY) || ""; } catch { /* нет доступа */ }
      const preferred = state.brands.find((b) => b.id === stored)
        || state.brands.find((b) => b.active)
        || state.brands[0];
      state.activeId = preferred?.id || "";
    }
    return state.brands;
  }

  /* ─── Полоса вкладок ───────────────────────────────────────────────────── */

  function renderTabs() {
    const host = $("brandTabs");
    if (!host) return;
    if (!state.brands.length) {
      host.innerHTML = '<span class="brandbar-empty">Брендов нет — заведи первый</span>';
      return;
    }
    host.innerHTML = state.brands.map((brand) => {
      const primary = normalizeHex(brand.theme?.primary) || "#6B7280";
      const activeCls = brand.id === state.activeId ? " active" : "";
      const dimCls = brand.active ? "" : " dim";
      const title = brand.active
        ? `${brand.label} · папка ${brand.id}`
        : `${brand.label} · папка ${brand.id} · архивный, в базе писем скрыт`;
      return `<button type="button" class="brandbar-tab${activeCls}${dimCls}" data-brand="${esc(brand.id)}" title="${esc(title)}">
        <span class="brandbar-swatch" style="background:${esc(primary)};color:${readableOn(primary)}">${esc(brand.label.slice(0, 1).toUpperCase())}</span>
        <span class="brandbar-name">${esc(brand.label)}</span>
      </button>`;
    }).join("");
  }

  /* ─── Диалог: общая обвязка ────────────────────────────────────────────── */

  function openDialog(innerHtml, onMount) {
    const overlay = document.createElement("div");
    overlay.className = "brandbar-overlay";
    overlay.innerHTML = `<div class="brandbar-dialog">${innerHtml}</div>`;
    const close = () => {
      overlay.remove();
      document.removeEventListener("keydown", onKey);
    };
    const onKey = (e) => { if (e.key === "Escape") close(); };
    overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) close(); });
    document.addEventListener("keydown", onKey);
    document.body.appendChild(overlay);
    onMount?.(overlay, close);
    return close;
  }

  /* ─── Создание бренда ──────────────────────────────────────────────────── */

  /**
   * Завести бренд руками — полная форма, а не «имя и один цвет».
   *
   * Блоки в студии создаются вручную целиком (pug, stylus, слоты), и бренд
   * должен заводиться так же: имя папки, тег для блоков и все восемь цветов
   * темы видны сразу. Папка и тег подставляются из названия, но их можно
   * переписать: транслитерация — подсказка, а не приговор.
   */
  function openCreateDialog() {
    const tokenRows = state.tokens.map((token) => {
      const value = normalizeHex(token.fallback) || "#000000";
      return `<label class="brandbar-field token">
        <span>${esc(token.label)}<small>${esc(token.id)}</small></span>
        <span class="brandbar-colorpair">
          <input type="color" data-wheel="${esc(token.id)}" value="${value.toLowerCase()}" />
          <input type="text" data-hex="${esc(token.id)}" value="${value}" spellcheck="false" />
        </span>
      </label>`;
    }).join("");

    openDialog(`
      <div class="brandbar-dialog-title">Новый бренд</div>
      <label class="brandbar-field">
        <span>Название</span>
        <input type="text" id="brandNewLabel" placeholder="Экснова" autocomplete="off" />
      </label>
      <label class="brandbar-field">
        <span>Папка в базе писем<small>только латиница, начинается с X_</small></span>
        <input type="text" id="brandNewFolder" placeholder="X_Eksnova" spellcheck="false" />
      </label>
      <label class="brandbar-field">
        <span>Тег блоков<small>по нему каталог отбирает блоки бренда</small></span>
        <input type="text" id="brandNewTag" placeholder="eksnova" spellcheck="false" />
      </label>
      <div class="brandbar-hint">Цвета темы. Только HEX — в почтовой вёрстке цвет обязан быть явным <code>#RRGGBB</code>.</div>
      <div class="brandbar-tokens">${tokenRows}</div>
      <div class="brandbar-error hidden" id="brandNewError"></div>
      <div class="brandbar-actions">
        <button type="button" class="brandbar-btn" id="brandNewCancel">Отмена</button>
        <button type="button" class="brandbar-btn primary" id="brandNewOk">Создать</button>
      </div>
    `, (overlay, close) => {
      const labelInput = overlay.querySelector("#brandNewLabel");
      const folderInput = overlay.querySelector("#brandNewFolder");
      const tagInput = overlay.querySelector("#brandNewTag");
      const errorBox = overlay.querySelector("#brandNewError");
      for (const token of state.tokens) {
        bindColorPair(overlay.querySelector(`[data-wheel="${token.id}"]`), overlay.querySelector(`[data-hex="${token.id}"]`));
      }

      // Пока папку и тег не трогали руками, они следуют за названием.
      let folderTouched = false, tagTouched = false;
      folderInput.addEventListener("input", () => { folderTouched = true; });
      tagInput.addEventListener("input", () => { tagTouched = true; });
      labelInput.addEventListener("input", () => {
        const suggestion = suggestFolder(labelInput.value);
        if (!folderTouched) folderInput.value = suggestion;
        if (!tagTouched) tagInput.value = suggestion.replace(/^X_/, "").toLowerCase();
      });
      labelInput.focus();

      overlay.querySelector("#brandNewCancel").addEventListener("click", close);
      overlay.querySelector("#brandNewOk").addEventListener("click", async () => {
        const label = labelInput.value.trim();
        if (!label) { showError(errorBox, "Название пустое"); return; }
        const theme = {};
        for (const token of state.tokens) {
          const hex = normalizeHex(overlay.querySelector(`[data-hex="${token.id}"]`).value);
          if (!hex) { showError(errorBox, `${token.label}: нужен HEX вида #RRGGBB`); return; }
          theme[token.id] = hex;
        }
        try {
          const response = await fetch("/api/brands", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              label,
              id: folderInput.value.trim() || undefined,
              blockTag: tagInput.value.trim() || undefined,
              theme,
            }),
          });
          const data = await response.json();
          if (!response.ok || !data?.ok) throw new Error(data?.error || `HTTP ${response.status}`);
          await loadBrands();
          setActive(data.brand.id);
          close();
        } catch (error) {
          showError(errorBox, String(error.message || error));
        }
      });
    });
  }

  /**
   * Подсказка имени папки по названию. Правило то же, что на сервере
   * (`brandFolderFromLabel`), но здесь оно нужно ДО отправки: человек должен
   * видеть, во что превратится «Новый бренд», и успеть поправить.
   */
  const TRANSLIT = {
    а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i",
    й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t",
    у: "u", ф: "f", х: "h", ц: "c", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "",
    э: "e", ю: "yu", я: "ya",
  };

  function suggestFolder(label) {
    const words = String(label || "").trim().split(/[\s_-]+/).filter(Boolean);
    const camel = words.map((word) => [...word].map((char) => {
      const lower = char.toLowerCase();
      const mapped = TRANSLIT[lower];
      if (mapped === undefined) return char;
      return char === lower ? mapped : mapped.charAt(0).toUpperCase() + mapped.slice(1);
    }).join("").replace(/[^a-zA-Z0-9]/g, ""))
      .filter(Boolean)
      .map((word) => word[0].toUpperCase() + word.slice(1))
      .join("");
    // Правило сервера: в имени папки должна быть хотя бы одна буква. Иначе
    // подсказали бы «X_2026», а сервер такое имя отвергает — и человек ловит
    // ошибку уже после нажатия «Создать».
    return camel && /[a-zA-Z]/.test(camel) ? `X_${camel}`.slice(0, 48) : "";
  }

  function showError(box, message) {
    box.textContent = message;
    box.classList.remove("hidden");
  }

  /* ─── Тема бренда: колесо + HEX ────────────────────────────────────────── */

  /**
   * Колесо и текстовое поле — одно значение в двух видах. Колесо всегда отдаёт
   * `#rrggbb`, поэтому источником правды считаем HEX-поле: в него можно
   * вставить цвет из макета, а колесо подстроится.
   */
  function bindColorPair(wheel, hexInput) {
    const sync = (value, target) => {
      const hex = normalizeHex(value);
      if (!hex) { hexInput.classList.add("bad"); return; }
      hexInput.classList.remove("bad");
      if (target !== wheel) wheel.value = hex.toLowerCase();
      if (target !== hexInput) hexInput.value = hex;
    };
    wheel.addEventListener("input", () => sync(wheel.value, wheel));
    hexInput.addEventListener("input", () => sync(hexInput.value, hexInput));
    hexInput.addEventListener("blur", () => {
      const hex = normalizeHex(hexInput.value);
      if (hex) { hexInput.value = hex; hexInput.classList.remove("bad"); }
    });
  }

  function openThemeDialog() {
    const brand = activeBrand();
    if (!brand) { openCreateDialog(); return; }
    const rows = state.tokens.map((token) => {
      const value = normalizeHex(brand.theme?.[token.id]) || normalizeHex(token.fallback) || "#000000";
      return `<label class="brandbar-field token">
        <span>${esc(token.label)}<small>${esc(token.id)}</small></span>
        <span class="brandbar-colorpair">
          <input type="color" data-wheel="${esc(token.id)}" value="${value.toLowerCase()}" />
          <input type="text" data-hex="${esc(token.id)}" value="${value}" spellcheck="false" />
        </span>
      </label>`;
    }).join("");

    openDialog(`
      <div class="brandbar-dialog-title">Цвета бренда — ${esc(brand.label)}</div>
      <div class="brandbar-hint">Только HEX: в почтовой вёрстке цвет обязан быть явным <code>#RRGGBB</code>.
        Эти токены — то, из чего собираются блоки, перекрашивающиеся вместе с брендом.</div>
      <div class="brandbar-tokens">${rows}</div>
      <div class="brandbar-error hidden" id="brandThemeError"></div>
      <div class="brandbar-actions">
        <button type="button" class="brandbar-btn" id="brandThemeCancel">Отмена</button>
        <button type="button" class="brandbar-btn primary" id="brandThemeOk">Сохранить</button>
      </div>
    `, (overlay, close) => {
      const errorBox = overlay.querySelector("#brandThemeError");
      for (const token of state.tokens) {
        bindColorPair(
          overlay.querySelector(`[data-wheel="${token.id}"]`),
          overlay.querySelector(`[data-hex="${token.id}"]`),
        );
      }
      overlay.querySelector("#brandThemeCancel").addEventListener("click", close);
      overlay.querySelector("#brandThemeOk").addEventListener("click", async () => {
        const theme = {};
        for (const token of state.tokens) {
          const hex = normalizeHex(overlay.querySelector(`[data-hex="${token.id}"]`).value);
          if (!hex) { showError(errorBox, `${token.label}: нужен HEX вида #RRGGBB`); return; }
          theme[token.id] = hex;
        }
        try {
          const response = await fetch(`/api/brands/${encodeURIComponent(brand.id)}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ theme }),
          });
          const data = await response.json();
          if (!response.ok || !data?.ok) throw new Error(data?.error || `HTTP ${response.status}`);
          await loadBrands();
          renderTabs();
          notify();
          close();
        } catch (error) {
          showError(errorBox, String(error.message || error));
        }
      });
    });
  }

  /* ─── Подключение ──────────────────────────────────────────────────────── */

  function wire() {
    $("brandTabs")?.addEventListener("click", (event) => {
      const tab = event.target.closest?.("[data-brand]");
      if (tab) setActive(tab.dataset.brand);
    });
    $("brandAddBtn")?.addEventListener("click", openCreateDialog);
    $("brandThemeBtn")?.addEventListener("click", openThemeDialog);
  }

  async function init() {
    wire();
    try {
      await loadBrands();
      renderTabs();
      notify();
    } catch (error) {
      const host = $("brandTabs");
      if (host) host.innerHTML = `<span class="brandbar-empty">Бренды не загрузились: ${esc(error.message || error)}</span>`;
    }
  }

  window.RetkitBrands = {
    init,
    all: () => state.brands.slice(),
    tokens: () => state.tokens.slice(),
    active: activeBrand,
    activeId: () => state.activeId,
    setActive,
    reload: async () => { await loadBrands(); renderTabs(); notify(); },
    onChange: (fn) => { if (typeof fn === "function") state.listeners.push(fn); },
    normalizeHex,
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
