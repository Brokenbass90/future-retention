/**
 * public/actor-badge.js — «кто сейчас работает» в углу студии.
 *
 * Маленькая деталь с большой задачей: пока человек не видит, что студия знает
 * его по имени, баннер «правит Коля» на замках будет выглядеть магией. Здесь
 * имя становится видимым и меняемым — и появляется место, где видно, что в
 * студии есть кто-то ещё (второй человек или чей-то агент).
 *
 * Сам по себе бейдж ничего не решает: он только показывает то, что сервер уже
 * знает из метки актёра.
 */
(() => {
  "use strict";

  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]
  ));

  let state = null;

  async function load() {
    const response = await fetch("/api/me");
    const data = await response.json();
    if (!response.ok || !data?.ok) throw new Error(data?.error || `HTTP ${response.status}`);
    state = data;
    return data;
  }

  function render(root) {
    if (!root || !state?.me) return;
    const me = state.me;
    const others = Array.isArray(state.others) ? state.others : [];
    // Показываем ровно то, что важно: своё имя и факт, что рядом кто-то есть.
    // Список имён — в подсказке, чтобы не разрастаться в шапке.
    const othersTitle = others.length
      ? `Сейчас в студии кроме вас: ${others.map((o) => o.displayName).join(", ")}`
      : "Кроме вас сейчас никого";
    root.innerHTML = `
      <button type="button" class="actor-name" title="Нажмите, чтобы изменить имя. Оно видно другим, когда письмо занято."
        >${esc(me.displayName)}${me.named ? "" : " ✎"}</button>
      ${others.length ? `<span class="actor-others" title="${esc(othersTitle)}">+${others.length}</span>` : ""}
      ${state.readOnly ? `<span class="actor-readonly" title="Витрина: правки не сохраняются">только чтение</span>` : ""}`;

    root.querySelector(".actor-name")?.addEventListener("click", async () => {
      const next = window.prompt("Как вас зовут? Имя увидят те, кто откроет занятое вами письмо.", me.name || "");
      if (next === null) return;
      try {
        const response = await fetch("/api/me/name", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: next }),
        });
        const data = await response.json();
        if (!response.ok || !data?.ok) throw new Error(data?.error || `HTTP ${response.status}`);
        state.me = data.me;
        render(root);
      } catch (error) {
        console.warn("[actor] имя не сохранилось:", error.message);
      }
    });
  }

  /** Смонтировать бейдж. Молча ничего не делаем, если сервер не ответил. */
  async function mount(host) {
    const root = typeof host === "string" ? document.querySelector(host) : host;
    if (!root) return null;
    try {
      await load();
    } catch (error) {
      console.warn("[actor] метка не получена:", error.message);
      return null;
    }
    render(root);
    // Кто ещё в студии — величина живая, но не срочная: раз в минуту хватает.
    setInterval(async () => {
      try { await load(); render(root); } catch { /* сеть моргнула — не беда */ }
    }, 60_000);
    return state.me;
  }

  window.RetkitActor = {
    mount,
    get me() { return state?.me || null; },
    get readOnly() { return Boolean(state?.readOnly); },
    reload: load,
  };

  // Бейдж один и тот же в обеих поверхностях, поэтому монтируем себя сами —
  // чтобы не заводить по строчке инициализации в каждом окне.
  const boot = () => { if (document.getElementById("actorBadge")) mount("#actorBadge"); };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
