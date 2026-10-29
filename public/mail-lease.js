/**
 * public/mail-lease.js — «письмо занято» на стороне интерфейса.
 *
 * Сервер уже не даст двоим переписать одно письмо. Но отказ при сохранении —
 * это плохая новость в самый неподходящий момент: человек уже потратил час.
 * Поэтому занятость показывается сразу при открытии, вместе с выходом:
 * посмотреть, сделать копию или перехватить, если тот, кто держит, явно ушёл.
 *
 * Пока письмо держим мы, вкладка подтверждает это heartbeat'ом. Закрыли
 * вкладку — подтверждения прекращаются, и через полторы минуты письмо
 * освобождается само. Это важнее строгости: запертое навсегда письмо хуже,
 * чем изредка перехваченное.
 */
(() => {
  "use strict";

  const BEAT_MS = 25_000;
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]
  ));

  let held = null;      // { brand, mail }
  let timer = null;
  let hooks = {};

  const post = async (action, body) => {
    const response = await fetch(`/api/mail-lease/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: response.status, data: await response.json().catch(() => ({})) };
  };

  function banner() {
    let el = document.getElementById("mailLeaseBanner");
    if (!el) {
      el = document.createElement("div");
      el.id = "mailLeaseBanner";
      el.className = "mail-lease-banner";
      el.hidden = true;
      document.body.appendChild(el);
    }
    return el;
  }

  function hideBanner() { banner().hidden = true; }

  function showBusy(brand, mail, holder) {
    const el = banner();
    const who = holder?.name || "кто-то";
    const age = holder?.age ? `, последняя активность ${holder.age}` : "";
    el.hidden = false;
    el.innerHTML = `
      <span class="mail-lease-text"><b>${esc(mail)}</b> сейчас правит ${esc(who)}${esc(age)}.
        Сохранить не получится, пока письмо занято.</span>
      <span class="mail-lease-actions">
        <button type="button" data-lease="copy">Работать в черновике</button>
        <button type="button" data-lease="steal">Перехватить</button>
        <button type="button" data-lease="close">Смотреть так</button>
      </span>`;

    el.querySelector('[data-lease="close"]').onclick = hideBanner;

    el.querySelector('[data-lease="steal"]').onclick = async () => {
      // Перехват — осознанное действие: «ушёл в отпуск с открытой вкладкой»
      // бывает, но и «перехватил у работающего коллеги» тоже.
      const ok = window.confirm(
        `Перехватить письмо у ${who}? Если он сейчас работает, его правки могут пропасть.`
      );
      if (!ok) return;
      const res = await post("take", { brand, mail, force: true });
      if (res.status === 200) { startBeat(brand, mail); hideBanner(); hooks.onTaken?.(); }
      else window.alert(res.data?.error || "Перехватить не вышло");
    };

    el.querySelector('[data-lease="copy"]').onclick = async () => {
      // Черновик здесь лучше обычной копии: он привязан к письму, знает, от
      // какой версии отпочковался, и возвращается в базу одной кнопкой. Имя
      // придумывать не надо, и в списке писем он не мусорит.
      if (window.RetkitDrafts) {
        hideBanner();
        await window.RetkitDrafts.open(brand, mail);
        return;
      }
      const suggested = `${String(mail).replace(/^mail-/, "")}-copy`;
      const name = window.prompt("Имя копии:", suggested);
      if (!name) return;
      const response = await fetch("/api/wb/email-clone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brand, mail, newName: name }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) { window.alert(data.error || "Копия не создалась"); return; }
      hideBanner();
      hooks.onCopy?.({ brand, mail: data.mail || `mail-${name}` });
    };
  }

  function startBeat(brand, mail) {
    held = { brand, mail };
    stopBeat(false);
    timer = setInterval(() => {
      post("beat", { brand, mail }).catch(() => { /* сеть моргнула — переживём */ });
    }, BEAT_MS);
  }

  function stopBeat(clear = true) {
    if (timer) clearInterval(timer);
    timer = null;
    if (clear) held = null;
  }

  /**
   * Занять письмо при открытии.
   * @returns {Promise<boolean>} держим ли мы его сейчас
   */
  async function hold(brand, mail) {
    if (!brand || !mail) return false;
    if (held && (held.brand !== brand || held.mail !== mail)) await release();
    const res = await post("take", { brand, mail });
    if (res.status === 200 && res.data?.ok) {
      startBeat(brand, mail);
      hideBanner();
      return true;
    }
    if (res.status === 409) {
      showBusy(brand, mail, res.data?.holder);
      return false;
    }
    // Любая другая беда — молчим: замок полезен, но мешать работе он не должен.
    console.warn("[lease] письмо занять не вышло:", res.data?.error || res.status);
    return false;
  }

  /** Отпустить письмо: закрыли вкладку или ушли на другое письмо. */
  async function release() {
    if (!held) return;
    const { brand, mail } = held;
    stopBeat();
    try {
      // sendBeacon переживает закрытие вкладки, обычный fetch — не всегда.
      const payload = JSON.stringify({ brand, mail });
      if (navigator.sendBeacon) {
        navigator.sendBeacon("/api/mail-lease/release", new Blob([payload], { type: "application/json" }));
      } else {
        await post("release", { brand, mail });
      }
    } catch { /* не отпустили — протухнет само через полторы минуты */ }
  }

  window.addEventListener("pagehide", () => { release(); });

  window.RetkitLease = {
    hold,
    release,
    get held() { return held ? { ...held } : null; },
    configure(next) { hooks = { ...hooks, ...(next || {}) }; },
  };
})();
