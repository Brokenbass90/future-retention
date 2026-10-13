/**
 * public/relay.js — окно связи между агентом и расширением RetKit в MoEngage.
 * Открывает его само расширение (кнопка «Агент»). Устройство — src/relay.js.
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
        "Настройки → Коннекторы → Добавить → «Добавить пользовательский коннектор», Имя: RetKit, URL: адрес выше → Продолжить; " +
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

  fetch("/api/mcp/link").then((r) => r.json()).then((data) => { if (data?.ok) link = data; }).catch(() => {});
  $("copyPrompt").addEventListener("click", (e) => link && copy(agentPrompt(link.url), e.currentTarget, "Скопировать для агента"));

  window.addEventListener("message", (event) => {
    if (!RETKIT_ORIGIN.test(event.origin)) return;
    const msg = event.data;
    if (!msg || msg.source !== "retkit") return;
    target = event.source; targetOrigin = event.origin; lastSeenRetkit = Date.now();
    if (msg.type === "hello") target.postMessage({ source: "retkit-relay", type: "hello-ack" }, targetOrigin);
    if (msg.type === "status") lastStatus = msg.status || null;
    if (msg.type === "result") {
      fetch("/api/relay/result", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: msg.id, ok: msg.ok === true, result: msg.result, error: msg.error }) }).catch(() => {});
    }
  });

  async function loop() {
    for (;;) {
      if (!retkitAlive()) {
        show(target ? "RetKit отключился. Нажмите «Агент» в RetKit ещё раз." : "Жду RetKit… Откройте письмо в MoEngage → RetKit → «Агент».", false);
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
