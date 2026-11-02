/**
 * public/relay.js — окно связи между агентом и расширением RetKit в MoEngage.
 * Открывает его само расширение («Подключить AI» в панели AI). Устройство — src/relay.js.
 */
(() => {
  "use strict";
  const RETKIT_ORIGIN = /^https:\/\/dashboard-\d+\.moengage\.com$/;
  const $ = (id) => document.getElementById(id);
  let target = null;          // окно MoEngage с RetKit
  let targetOrigin = "";
  let lastStatus = null;
  let lastSeenRetkit = 0;
  let link = null;

  const show = (text, good) => { const el = $("st"); el.textContent = text; el.className = `st ${good ? "ok" : "bad"}`; };
  const retkitAlive = () => target && !target.closed && Date.now() - lastSeenRetkit < 15000;

  function agentPrompt(url) {
    return [
      "Подключи студию писем RetKit (MCP-сервер, Streamable HTTP, без входа). Адрес:",
      url,
      "",
      "• Ты Codex — выполни команду:  codex mcp add retkit --url " + url,
      "• Ты Claude Code — выполни команду:  claude mcp add --transport http --scope user retkit " + url,
      "• Ты Claude в приложении или на claude.ai (сам добавить не можешь) — скажи мне коротко: " +
        "Настройки → Коннекторы → Добавить → «Добавить пользовательский коннектор», Имя: RetKit, URL: адрес выше, Аутентификация: «Без входа» (не «Войти сейчас») → Добавить → Подключить; " +
        "потом новый чат → + → Коннекторы → RetKit.",
      "",
      "После подключения нужна новая сессия. Проверь, что есть инструменты retkit_* и moengage_*, " +
        "вызови retkit_studio_guide и moengage_status. Ссылка личная — никуда её не публикуй.",
    ].join("\n");
  }

  async function copy(text, button, label) {
    try { await navigator.clipboard.writeText(text); button.textContent = "Скопировано ✓"; }
    catch { window.prompt("Скопируйте:", text); }
    setTimeout(() => { button.textContent = label; }, 1800);
  }

  // RetKit в MoEngage показывает статус агента и копирует текст «для агента»
  // сам, поэтому окно связи передаёт ему ссылку и «когда агент заходил».
  function sendLink() {
    if (!target || target.closed || !link?.url) return;
    try {
      target.postMessage({ source: "retkit-relay", type: "link", prompt: agentPrompt(link.url),
        lastSeenAt: Number(link.lastSeenAt || 0), lastClient: String(link.lastClient || "") }, targetOrigin);
    } catch { /* окно MoEngage закрыли */ }
  }
  function refreshLink() {
    return fetch("/api/mcp/link").then((r) => r.json()).then((data) => { if (data?.ok) { link = data; sendLink(); } }).catch(() => {});
  }
  refreshLink();
  setInterval(refreshLink, 15000);
  $("copyPrompt").addEventListener("click", (e) => link && copy(agentPrompt(link.url), e.currentTarget, "Скопировать для агента"));

  window.addEventListener("message", (event) => {
    if (!RETKIT_ORIGIN.test(event.origin)) return;
    const msg = event.data;
    if (!msg || msg.source !== "retkit") return;
    target = event.source; targetOrigin = event.origin; lastSeenRetkit = Date.now();
    if (msg.type === "hello") { target.postMessage({ source: "retkit-relay", type: "hello-ack" }, targetOrigin); sendLink(); }
    if (msg.type === "status") lastStatus = msg.status || null;
    if (msg.type === "result") {
      fetch("/api/relay/result", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: msg.id, ok: msg.ok === true, result: msg.result, error: msg.error }) }).catch(() => {});
    }
  });

  function showOpenPage({ url, label }) {
    if (!/^https?:\/\//.test(String(url || ""))) return;
    let box = $("openPage");
    if (!box) {
      box = document.createElement("div");
      box.id = "openPage";
      box.style.cssText = "margin:10px 0;padding:10px;border-radius:9px;background:#1b2a44;border:1px solid #3b5ea8";
      $("st").insertAdjacentElement("afterend", box);
    }
    box.replaceChildren();
    const p = document.createElement("p");
    p.style.cssText = "margin:0 0 8px;color:#dce6f4";
    p.textContent = "Агент просит открыть страницу студии:";
    const b = document.createElement("button");
    b.textContent = label || "Открыть";
    b.addEventListener("click", () => { window.open(url, "retkit-studio"); box.remove(); });
    box.append(p, b);
    // Браузер может разрешить и без клика — пробуем; не вышло — кнопка ждёт.
    try { const w = window.open(url, "retkit-studio"); if (w) box.remove(); } catch { /* ждёт клика */ }
  }

  async function loop() {
    for (;;) {
      if (!retkitAlive()) {
        show(target ? "RetKit отключился. В RetKit внизу, в панели AI, нажмите «Окно связи»." : "Жду RetKit… Откройте письмо в MoEngage → RetKit → панель AI внизу → «Подключить AI».", false);
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }
      const s = lastStatus || {};
      show(`✓ На связи: ${s.workspaceOpen ? `письмо открыто, локаль ${s.locale || "?"}` : "MoEngage, RetKit закрыт"}`, true);
      try {
        const response = await fetch("/api/relay/poll", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: lastStatus }) });
        const data = await response.json();
        const command = data?.command;
        if (command && command.tool === "open_page") {
          // Это команда самому окну связи, а не RetKit в MoEngage.
          showOpenPage(command.args || {});
          fetch("/api/relay/result", { method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: command.id, ok: true, result: { shown: true } }) }).catch(() => {});
          continue;
        }
        if (command && retkitAlive()) target.postMessage({ source: "retkit-relay", type: "command", ...command }, targetOrigin);
        else if (command) fetch("/api/relay/result", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: command.id, ok: false, error: "Вкладка MoEngage с RetKit закрыта" }) }).catch(() => {});
      } catch {
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  }
  loop();
})();
