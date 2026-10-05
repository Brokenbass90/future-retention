/**
 * public/mcp-connect.js — «Подключить своего агента».
 *
 * Человек открывает окно разговора с ИИ и упирается в то, что модели нет.
 * Раньше он видел только сухое «MOCK / FALLBACK» и уходил. Здесь вместо этого
 * мастер: студия сама собирает конфиг, показывает три шага и, если запущена
 * локально, прописывает подключение за него.
 *
 * Модель приносит пользователь — его Claude, его подписка. Студия не хранит и
 * не спрашивает никаких ключей моделей.
 */
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]
  ));

  let _setup = null;

  async function loadSetup() {
    if (_setup) return _setup;
    const response = await fetch("/api/mcp/setup");
    const data = await response.json();
    if (!response.ok || !data?.ok) throw new Error(data?.error || `HTTP ${response.status}`);
    _setup = data;
    return _setup;
  }

  function stepsHtml(setup) {
    const link = setup.connection || {};
    // Локальная студия и удалённая — это два разных первых шага, и путать их
    // нельзя: на Heroku сервер физически не может тронуть конфиг на машине
    // человека, обещать «в один клик» там было бы враньём.
    const connected = Boolean(link.connected);
    const wrongPath = connected && link.pathMatches === false;

    const connectBlock = !setup.canInstall
      ? `<p class="mcp-hint">Студия открыта не с этого компьютера, поэтому прописать настройки
         сама она не может — скопируйте блок ниже.</p>`
      : connected && !wrongPath
        ? `<p class="mcp-hint mcp-done">✓ Уже подключено${link.configuredStudioUrl
            ? ` к <code>${esc(link.configuredStudioUrl)}</code>` : ""}.
           Переподключать нужно, только если студия переехала или сменила порт.</p>
           <button type="button" class="mcp-copy" id="mcpInstallBtn">Переподключить</button>`
        : wrongPath
          ? `<p class="mcp-hint mcp-warn">⚠ В настройках Claude прописана другая копия студии:
             <code>${esc(link.configuredServerPath)}</code>. Ваш агент ходит не сюда.</p>
             <button type="button" class="mcp-primary" id="mcpInstallBtn">Переподключить на эту студию</button>`
          : `<button type="button" class="mcp-primary" id="mcpInstallBtn">Подключить автоматически</button>
             <p class="mcp-hint">Студия сама пропишет подключение в настройки Claude Desktop.
             Прежний файл сохранится рядом как резервная копия.</p>`;

    // Отдельной кнопки для скилла нет: он ставится тем же действием, что и
    // подключение. Шаг остался объяснением, а не работой для человека —
    // подключение без скилла давало агента, который видит ручки, но не
    // понимает студию, и этот шаг просто пропускали.
    const skillBlock = !setup.skill?.canInstall
      ? `<p class="mcp-hint">Скопируйте папку <code>.claude/skills/retkit-studio</code> из студии
         в <code>~/.claude/skills/</code>.</p>`
      : link.skillInstalled
        ? `<p class="mcp-hint mcp-done">✓ Скилл стоит в <code>${esc(link.skillPath)}</code> и
           обновляется при каждом переподключении.</p>`
        : `<p class="mcp-hint">Поставится сам вместе с подключением — отдельно ставить не нужно.</p>`;

    return `
      <div class="mcp-step">
        <span class="mcp-step-no">1</span>
        <div>
          <b>Нужен Claude Desktop или Claude Code</b>
          <p class="mcp-hint">Подойдёт любой клиент с поддержкой MCP. Модель — ваша,
          студия ничего за неё не платит и ключей не спрашивает.</p>
        </div>
      </div>

      <div class="mcp-step">
        <span class="mcp-step-no">2</span>
        <div>
          <b>Подключите студию</b>
          ${connectBlock}
          <details class="mcp-manual">
            <summary>Сделать вручную</summary>
            <p class="mcp-hint">Claude Desktop — добавьте в <code>${esc(setup.desktopConfigPath)}</code>:</p>
            <pre class="mcp-code" id="mcpConfigSnippet">${esc(setup.configSnippet)}</pre>
            <button type="button" class="mcp-copy" data-copy="mcpConfigSnippet">Скопировать конфиг</button>
            <p class="mcp-hint">Claude Code — одна команда в терминале:</p>
            <pre class="mcp-code" id="mcpCliCommand">${esc(setup.claudeCodeCommand)}</pre>
            <button type="button" class="mcp-copy" data-copy="mcpCliCommand">Скопировать команду</button>
          </details>
        </div>
      </div>

      <div class="mcp-step">
        <span class="mcp-step-no">3</span>
        <div>
          <b>Дайте ему знания о студии</b>
          <p class="mcp-hint">Скилл студии — правила проекта, устройство, форматы блоков и
          локалей. С ним агент работает как разработчик студии, а не угадывает по названиям.
          Claude Code, открытый в папке студии, берёт его сам.</p>
          ${skillBlock}
        </div>
      </div>

      <div class="mcp-step mcp-step-where">
        <span class="mcp-step-no">4</span>
        <div>
          <b>Разговаривайте с ним в его окне, а не здесь</b>
          <p class="mcp-hint">Это важно, и это легко перепутать. <b>Здесь отвечает оператор
          студии</b> — её собственная модель. Ваш Клод после подключения работает
          <b>из Claude Desktop или Claude Code</b>: открываете его окно, говорите «покажи каталог
          блоков студии» или «собери системное письмо про отсутствие платёжки», и он делает это
          инструментами студии — а результат вы видите здесь, в конструкторе.</p>
          <p class="mcp-hint">Перезапустите Claude после подключения, иначе он не увидит студию.</p>
        </div>
      </div>

      <div class="mcp-result" id="mcpResult" hidden></div>`;
  }

  function wire(root) {
    root.querySelectorAll("[data-copy]").forEach((button) => {
      button.addEventListener("click", async () => {
        const source = $(button.dataset.copy);
        if (!source) return;
        try {
          await navigator.clipboard.writeText(source.textContent || "");
          const previous = button.textContent;
          button.textContent = "Скопировано";
          setTimeout(() => { button.textContent = previous; }, 1600);
        } catch {
          // Буфер обмена может быть закрыт политикой браузера — тогда просто
          // выделяем текст, чтобы человек скопировал сам.
          const range = document.createRange();
          range.selectNodeContents(source);
          const selection = window.getSelection();
          selection?.removeAllRanges();
          selection?.addRange(range);
        }
      });
    });

    $("mcpInstallBtn")?.addEventListener("click", async () => {
      const button = $("mcpInstallBtn");
      const result = $("mcpResult");
      button.disabled = true;
      button.textContent = "Подключаю…";
      try {
        const response = await fetch("/api/mcp/install", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        const data = await response.json();
        if (!response.ok || !data?.ok) throw new Error(data?.error || `HTTP ${response.status}`);
        const kept = data.otherServers?.length
          ? ` Другие ваши подключения сохранены: ${data.otherServers.join(", ")}.`
          : "";
        result.hidden = false;
        result.dataset.state = "ok";
        const skill = data.skill?.ok
          ? ` Скилл студии ${data.skill.replaced ? "обновлён" : "поставлен"}.`
          : ` Скилл поставить не вышло (${data.skill?.error || "неизвестно"}) — агент дойдёт до студии и без него, знания возьмёт инструментом retkit_studio_guide.`;
        result.textContent =
          `Готово. ${data.replaced ? "Подключение обновлено" : "Подключение добавлено"} в ${data.configPath}.` +
          skill + kept + " Перезапустите Claude Desktop, чтобы он увидел студию. " +
          "Разговаривать с ним нужно в его окне — здесь отвечает оператор студии.";
        button.textContent = "Подключено";
        _setup = null; // следующее открытие мастера прочитает состояние заново
      } catch (error) {
        result.hidden = false;
        result.dataset.state = "err";
        result.textContent = `Не получилось: ${error.message} Скопируйте конфиг вручную — блок ниже.`;
        button.disabled = false;
        button.textContent = "Подключить автоматически";
      }
    });
  }

  /** Показать мастер в переданный контейнер. */
  async function render(host) {
    if (!host) return;
    host.innerHTML = `<div class="mcp-connect-loading">Готовлю подключение…</div>`;
    try {
      const setup = await loadSetup();
      host.innerHTML = `
        <div class="mcp-connect">
          <div class="mcp-connect-head">
            <b>Подключите своего агента</b>
            <p class="mcp-hint">Студия умеет работать с вашим Claude: он видит каталог блоков,
            собирает письмо и сохраняет его сюда. Своей модели у студии нет — и платить за неё не нужно.</p>
          </div>
          ${stepsHtml(setup)}
        </div>`;
      wire(host);
    } catch (error) {
      host.innerHTML = `<div class="mcp-connect-error">Не удалось подготовить подключение: ${esc(error.message)}</div>`;
    }
  }

  /**
   * Состояние подключения одной строкой — для индикатора в шапке разговора.
   *
   * Индикатор заменил всплывающий мастер: раньше он показывался сам и только
   * тем, у кого не настроена своя модель, — то есть ровно тем, кому был не
   * нужен, и мешал остальным. Теперь состояние видно всегда и молча, а мастер
   * открывается по нажатию на индикатор или по просьбе в разговоре.
   *
   * @returns {Promise<{state:string,label:string,title:string}>}
   */
  async function status() {
    try {
      const setup = await loadSetup();
      const link = setup.connection || {};
      if (!setup.local) {
        return {
          state: "remote",
          label: "агент: не отсюда",
          title: "Студия открыта не с этого компьютера — подключение придётся прописать вручную.",
        };
      }
      if (link.connected && link.pathMatches === false) {
        return {
          state: "wrong",
          label: "агент: другая студия",
          title: `В настройках Claude прописана другая копия студии: ${link.configuredServerPath || "?"}. Ваш агент ходит не сюда.`,
        };
      }
      if (link.connected) {
        return {
          state: "on",
          label: "свой агент подключён",
          title: `Подключено к ${link.configuredStudioUrl || "студии"}.` +
            (link.skillInstalled ? " Скилл студии на месте." : " Скилл студии не найден — переподключите.") +
            " Разговаривать с ним нужно в его окне: здесь отвечает оператор студии.",
        };
      }
      return {
        state: "off",
        label: "свой агент не подключён",
        title: "Здесь отвечает оператор студии. Нажмите, чтобы подключить своего Клода — или просто попросите об этом в разговоре.",
      };
    } catch (error) {
      return { state: "unknown", label: "агент: состояние неизвестно", title: String(error?.message || error) };
    }
  }

  /**
   * Просьба про подключение, узнанная без модели.
   *
   * Мастер больше не всплывает сам, поэтому его надо уметь позвать словами.
   * Проверка нарочно строгая: нужно и действие, и то, к чему оно относится —
   * иначе «подключи этот блок к шапке» открывало бы мастер посреди работы.
   */
  function wantsSetup(text) {
    const value = String(text || "").toLowerCase();
    if (!value.trim()) return false;
    if (/\bmcp\b/.test(value)) return true;
    const action = /(подключ|переподключ|подцеп|присоедин|сменить агент|поменять агент)/.test(value);
    const subject = /(агент|кло[дт]|claude|сво(его|й|ю) ии|второ(го|й) ии|нейрон)/.test(value);
    return action && subject;
  }

  window.RetkitMcpConnect = { render, loadSetup, status, wantsSetup, forget: () => { _setup = null; } };
})();
