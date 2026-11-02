/**
 * public/mail-drafts.js — черновик письма в интерфейсе.
 *
 * Черновик бесполезен, если про него не видно. Человек (или его агент) правит
 * копию, а потом неделю думает, что правил оригинал, — и удивляется, что
 * рассылка ушла старая. Поэтому полоса сверху говорит прямо: это ваш черновик,
 * в базе пока лежит другое, вот кнопка «опубликовать».
 *
 * И обратная сторона: когда открыто письмо базы, а черновик по нему уже есть,
 * об этом тоже надо сказать — иначе человек начнёт править оригинал параллельно
 * собственной копии.
 */
(() => {
  "use strict";

  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]
  ));
  const DRAFT_MARK = "__draft-";

  let hooks = {};

  const isDraft = (mail) => String(mail || "").includes(DRAFT_MARK);
  const baseNameOf = (mail) => String(mail || "").split(DRAFT_MARK)[0];

  const post = async (action, body) => {
    const response = await fetch(`/api/drafts/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    });
    return { status: response.status, data: await response.json().catch(() => ({})) };
  };

  function bar() {
    let el = document.getElementById("mailDraftBanner");
    if (!el) {
      el = document.createElement("div");
      el.id = "mailDraftBanner";
      el.className = "mail-lease-banner mail-draft-banner";
      el.hidden = true;
      document.body.appendChild(el);
    }
    return el;
  }

  const hide = () => { bar().hidden = true; };

  function describeChanges(changes) {
    if (!changes || !changes.total) return "правок пока нет";
    const parts = [];
    if (changes.changed?.length) parts.push(`изменено ${changes.changed.length}`);
    if (changes.added?.length) parts.push(`добавлено ${changes.added.length}`);
    if (changes.removed?.length) parts.push(`удалено ${changes.removed.length}`);
    return `${parts.join(", ")} — ${(changes.changed || []).concat(changes.added || []).slice(0, 3).join(", ")}`;
  }

  /** Полоса над черновиком: что это, и что с ним делать. */
  async function showDraftBar(brand, draftMail) {
    const mail = baseNameOf(draftMail);
    const el = bar();
    let changes = null;
    try {
      const response = await fetch(`/api/drafts?brand=${encodeURIComponent(brand)}&mail=${encodeURIComponent(mail)}`);
      const data = await response.json();
      if (data?.ok) changes = data.changes;
    } catch { /* разницу не показали — полоса всё равно важнее */ }

    el.hidden = false;
    el.innerHTML = `
      <span class="mail-lease-text">Это <b>ваш черновик</b> письма ${esc(mail)}. В базе пока прежняя версия.
        ${changes ? esc(describeChanges(changes)) : ""}
        ${changes?.baseChanged ? "<b> Внимание: письмо в базе изменилось с тех пор, как вы взяли копию.</b>" : ""}</span>
      <span class="mail-lease-actions">
        <button type="button" data-draft="publish">Опубликовать в базу</button>
        <button type="button" data-draft="discard">Отказаться</button>
        <button type="button" data-draft="close">Позже</button>
      </span>`;

    el.querySelector('[data-draft="close"]').onclick = hide;

    el.querySelector('[data-draft="publish"]').onclick = async () => {
      const summary = changes ? describeChanges(changes) : "изменения";
      if (!window.confirm(`Опубликовать черновик в базу?\n\n${summary}\n\nПрежняя версия сохранится в истории.`)) return;
      let res = await post("publish", { brand, mail });
      if (res.status === 409 && res.data?.code === "BASE_CHANGED") {
        // Самый опасный момент: пока правили копию, оригинал поменяли. Решение
        // тут человека, и он должен видеть, чем рискует.
        const ok = window.confirm(
          `${res.data.error}\n\nОпубликовать поверх? Прежняя версия сохранится в истории, откатить можно.`
        );
        if (!ok) return;
        res = await post("publish", { brand, mail, force: true });
      }
      if (res.status !== 200 || !res.data?.ok) {
        window.alert(res.data?.error || "Опубликовать не вышло");
        return;
      }
      hide();
      hooks.onPublished?.({ brand, mail });
    };

    el.querySelector('[data-draft="discard")]') // защита от опечатки селектора
      || el.querySelector('[data-draft="discard"]').addEventListener("click", async () => {
        if (!window.confirm("Отказаться от черновика? Работа в копии будет отложена в корзину.")) return;
        const res = await post("discard", { brand, mail });
        if (res.status !== 200) { window.alert(res.data?.error || "Не вышло"); return; }
        hide();
        hooks.onDiscarded?.({ brand, mail });
      });
  }

  /** Полоса над оригиналом, по которому уже есть черновик. */
  function showHasDraftBar(brand, mail, draft) {
    const el = bar();
    el.hidden = false;
    el.innerHTML = `
      <span class="mail-lease-text">У вас есть черновик письма <b>${esc(mail)}</b>.
        Правки здесь пойдут мимо него.</span>
      <span class="mail-lease-actions">
        <button type="button" data-draft="open">Открыть черновик</button>
        <button type="button" data-draft="close">Править оригинал</button>
      </span>`;
    el.querySelector('[data-draft="close"]').onclick = hide;
    el.querySelector('[data-draft="open"]').onclick = () => {
      hide();
      hooks.onOpenDraft?.({ brand, mail: draft });
    };
  }

  /** Взять письмо в черновик и открыть копию. */
  async function open(brand, mail) {
    const res = await post("open", { brand, mail });
    if (res.status !== 200 || !res.data?.ok) {
      window.alert(res.data?.error || "Черновик не создался");
      return null;
    }
    hooks.onOpenDraft?.({ brand, mail: res.data.draft });
    return res.data.draft;
  }

  /** Показать то, что уместно для открытого письма. Ошибки молча глотаем. */
  async function reflect(brand, mail) {
    hide();
    if (!brand || !mail) return;
    try {
      if (isDraft(mail)) { await showDraftBar(brand, mail); return; }
      const response = await fetch("/api/drafts");
      const data = await response.json();
      const mine = (data?.drafts || []).find((entry) => entry.brand === brand && entry.mail === mail && !entry.discardedAt);
      if (mine) showHasDraftBar(brand, mail, mine.draft);
    } catch { /* полоса про черновик не должна мешать работе */ }
  }

  window.RetkitDrafts = {
    reflect,
    open,
    isDraft,
    baseNameOf,
    configure(next) { hooks = { ...hooks, ...(next || {}) }; },
  };
})();
