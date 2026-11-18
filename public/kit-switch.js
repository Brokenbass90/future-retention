/**
 * public/kit-switch.js — набор блоков (kit), ось, независимая от бренда.
 *
 * Бренд отвечает на вопрос «чьё письмо»: цвета темы и папка сохранения
 * (см. brand-bar.js). Набор отвечает на другой вопрос — «какое это письмо»:
 *
 *   promo  — весь текущий каталог: комбо, герои, сторы, соцсети;
 *   system — короткий список простых блоков для сервисных писем.
 *
 * Оси намеренно ортогональны: `IQ Broker × system` обязано существовать, иначе
 * системное письмо потеряло бы бренд. Поэтому набор — не третий пункт в списке
 * брендов, а отдельный переключатель со своим состоянием.
 *
 * Модуль знает только про своё состояние и подписчиков. Фильтрация каталога
 * живёт в constructor.js: здесь нет ни одного знания о блоках.
 */
(() => {
  "use strict";

  const STORAGE_KEY = "retkit-active-kit";
  const KITS = Object.freeze(["promo", "system"]);
  const DEFAULT_KIT = "promo";

  const state = {
    kit: DEFAULT_KIT,
    listeners: [],
  };

  const $ = (id) => document.getElementById(id);

  function normalizeKit(value) {
    const raw = String(value || "").trim().toLowerCase();
    return KITS.includes(raw) ? raw : DEFAULT_KIT;
  }

  function restore() {
    let stored = "";
    try { stored = localStorage.getItem(STORAGE_KEY) || ""; } catch { /* приватный режим */ }
    state.kit = normalizeKit(stored);
  }

  function notify() {
    for (const fn of state.listeners) {
      try { fn(state.kit); } catch { /* один слушатель не должен ронять остальные */ }
    }
  }

  function render() {
    const host = $("kitSwitch");
    if (!host) return;
    for (const button of host.querySelectorAll("[data-kit]")) {
      const active = button.dataset.kit === state.kit;
      button.classList.toggle("active", active);
      button.setAttribute("aria-checked", String(active));
      button.tabIndex = active ? 0 : -1;
    }
  }

  /**
   * Переключение набора меняет только каталог. Канвас не трогаем осознанно:
   * человек мог собрать половину письма, и молча выкинуть его блоки — значит
   * потерять чужую работу. Что в письме остались блоки другого набора, видно
   * по счётчику каталога.
   */
  function setKit(value, { silent = false } = {}) {
    const next = normalizeKit(value);
    if (next === state.kit) { render(); return; }
    state.kit = next;
    try { localStorage.setItem(STORAGE_KEY, next); } catch { /* приватный режим */ }
    render();
    if (!silent) notify();
  }

  function wire() {
    const host = $("kitSwitch");
    if (!host) return;
    host.addEventListener("click", (event) => {
      const button = event.target.closest?.("[data-kit]");
      if (button) setKit(button.dataset.kit);
    });
    // Стрелками — как в настоящей радиогруппе: она объявлена role="radiogroup".
    host.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      const index = KITS.indexOf(state.kit);
      const delta = event.key === "ArrowRight" ? 1 : -1;
      setKit(KITS[(index + delta + KITS.length) % KITS.length]);
      host.querySelector(`[data-kit="${state.kit}"]`)?.focus();
      event.preventDefault();
    });
  }

  function init() {
    restore();
    wire();
    render();
  }

  window.RetkitKit = {
    init,
    all: () => KITS.slice(),
    current: () => state.kit,
    isSystem: () => state.kit === "system",
    setKit,
    onChange: (fn) => { if (typeof fn === "function") state.listeners.push(fn); },
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
