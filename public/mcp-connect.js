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
    const [response, linkResponse] = await Promise.all([
      fetch("/api/mcp/setup"),
      fetch("/api/mcp/link").catch(() => null),
    ]);
    const data = await response.json();
    if (!response.ok || !data?.ok) throw new Error(data?.error || `HTTP ${response.status}`);
    // Ссылка — главный способ; если её не отдали, мастер всё равно покажет
    // прежний путь, а не сломается целиком.
    const link = linkResponse ? await linkResponse.json().catch(() => null) : null;
    data.link = link?.ok ? link : null;
    _setup = data;
    return _setup;
  }

  /** Был ли агент по ссылке за последние сутки. */
  function linkSeen(setup) {
    const at = Number(setup?.link?.lastSeenAt || 0);
    return at && Date.now() - at < 24 * 60 * 60 * 1000 ? at : 0;
  }

  /**
   * Подключение по ссылке: без терминала, без установки, без платы, на Mac и
   * Windows одинаково. Студия сама отдаёт свои инструменты по HTTPS, человек
   * вставляет ссылку в свой Claude или Codex.
   */
  function linkHtml(setup) {
    const link = setup.link;
    if (!link?.url) {
      return `<p class="mcp-hint mcp-warn">Ссылку получить не удалось — обновите страницу.</p>`;
    }
    const seen = linkSeen(setup);
    const seenLine = seen
      ? `<p class="mcp-hint mcp-done">✓ Ваш агент заходил ${esc(new Date(seen).toLocaleString())}${link.lastClient ? ` (${esc(link.lastClient)})` : ""}.</p>`
      : "";
    const localNote = link.reachableFromCloud ? "" :
      `<p class="mcp-hint mcp-warn">⚠ Студия открыта по локальному адресу: такую ссылку увидит Codex
       на этом компьютере, но не Claude — он подключается из своего облака. Для Claude
       откройте студию на Heroku и возьмите ссылку там.</p>`;
    return `
      <div class="mcp-step">
        <span class="mcp-step-no">1</span>
        <div>
          <b>Скопируйте свою ссылку</b>
          <pre class="mcp-code" id="mcpLinkUrl">${esc(link.url)}</pre>
          <button type="button" class="mcp-primary" data-copy="mcpLinkUrl">Скопировать ссылку</button>
          <p class="mcp-hint">Ссылка личная: агент по ней работает в <b>ваших</b> черновиках и письмах. Никому её не пересылайте — её владелец действует от вашего имени.</p>
          ${localNote}
          ${seenLine}
        </div>
      </div>

      <div class="mcp-step">
        <span class="mcp-step-no">2</span>
        <div>
          <b>Вставьте её в свой Claude или Codex</b>
          <p class="mcp-hint"><b>Claude</b> (сайт claude.ai или приложение, любой тариф, включая бесплатный):
          Настройки (Customize) → <b>Коннекторы</b> (Connectors) → <b>+</b> → <b>Добавить свой коннектор</b> (Add custom connector) → имя «RetKit», вставить ссылку →
          вход: <b>«Без входа»</b> (No sign in) → Добавить. Потом в чате: <b>+</b> → Коннекторы → включить RetKit.</p>
          <p class="mcp-hint"><b>Codex</b> (приложение): Settings → <b>MCP servers</b> → <b>Add server</b> →
          тип <b>Streamable HTTP</b>, вставить ссылку → Save → Restart.</p>
          <p class="mcp-hint">В организации Claude Team / Enterprise коннектор добавляет администратор.
          На бесплатном Claude можно держать один свой коннектор.</p>
        </div>
      </div>

      <div class="mcp-step mcp-step-where">
        <span class="mcp-step-no">3</span>
        <div>
          <b>Говорите с ним в его окне</b>
          <p class="mcp-hint">Например: «покажи каталог блоков RetKit» или «собери системное письмо про
          отсутствие платёжки». Он работает инструментами студии, а результат вы видите здесь.
          Здесь, в этом окне, отвечает оператор студии: переписку вашего агента он не видит,
          а письма и черновики, которые тот изменил, — видит.</p>
        </div>
      </div>`;
  }

  function stepsHtml(setup) {
    const link = setup.connection || {};
    // Локальная студия и удалённая — это два разных первых шага, и путать их
    // нельзя: на Heroku сервер физически не может тронуть конфиг на машине
    // человека, обещать «в один клик» там было бы враньём.
    const connected = Boolean(link.connected);
    const wrongPath = connected && (link.pathMatches === false || link.commandMissing === true);

    const connectBlock = !setup.canInstall
      ? `<p class="mcp-hint">Студия открыта не с этого компьютера, поэтому прописать настройки
         сама она не может — скопируйте блок ниже.</p>`
      : connected && !wrongPath
        ? `<p class="mcp-hint mcp-done">✓ Уже подключено${link.configuredStudioUrl
            ? ` к <code>${esc(link.configuredStudioUrl)}</code>` : ""}.
           Переподключать нужно, только если студия переехала или сменила порт.</p>
           <button type="button" class="mcp-copy" id="mcpInstallBtn">Переподключить</button>`
        : wrongPath
          ? (link.commandMissing
            ? `<p class="mcp-hint mcp-warn">⚠ В настройках Claude прописан node, которого больше нет:
               <code>${esc(link.configuredCommand)}</code>. Нажмите — пропишем текущий.</p>`
            : `<p class="mcp-hint mcp-warn">⚠ В настройках Claude прописана другая копия студии:
             <code>${esc(link.configuredServerPath)}</code>. Ваш агент ходит не сюда.</p>`) +
            `<button type="button" class="mcp-primary" id="mcpInstallBtn">Переподключить на эту студию</button>`
          : `<button type="button" class="mcp-primary" id="mcpInstallBtn">Подключить автоматически</button>
             <p class="mcp-hint">Студия сама пропишет подключение в настройки Claude Desktop.
             Прежний файл сохранится рядом как резервная копия.</p>`;

    // Ещё не стоит ни Claude Desktop, ни Claude Code — ставим под систему.
    function installBlock() {
      const ua = String(navigator.userAgentData?.platform || navigator.platform || '').toLowerCase();
      const win = ua.includes('win');
      const desktopUrl = win
        ? 'https://claude.com/download'
        : 'https://claude.ai/api/desktop/darwin/universal/dmg/latest/redirect';
      const cli = win ? 'irm https://claude.ai/install.ps1 | iex' : 'curl -fsSL https://claude.ai/install.sh | bash';
      return `<details class="mcp-manual"><summary>Ещё не установлен — поставить</summary>
        <p class="mcp-hint"><a href="${desktopUrl}" target="_blank" rel="noopener">Скачать Claude Desktop для ${win ? 'Windows' : 'Mac'}</a> — обычная программа, установка как у любого приложения.</p>
        <p class="mcp-hint">Или Claude Code — ${win ? 'PowerShell (Win+X → «Терминал»)' : 'Терминал (⌘ Пробел → «Терминал»)'}, вставить и Enter:</p>
        <pre class="mcp-code" id="mcpInstallCli">${esc(cli)}</pre>
        <button type="button" class="mcp-copy" data-copy="mcpInstallCli">Скопировать команду</button>
        <p class="mcp-hint">Потом войдите своей подпиской Claude (Pro / Max / Team) и вернитесь сюда.</p>
      </details>`;
    }

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
      ${linkHtml(setup)}
      <details class="mcp-manual mcp-advanced">
      <summary>Для разработчиков: локально, через Claude Code или конфиг</summary>
      <div class="mcp-step">
        <span class="mcp-step-no">1</span>
        <div>
          <b>Нужен Claude Desktop или Claude Code</b>
          <p class="mcp-hint">Подойдёт любой клиент с поддержкой MCP. Модель — ваша,
          студия ничего за неё не платит и ключей не спрашивает.</p>
          ${installBlock()}
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
      </details>

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
            <p class="mcp-hint">Ваш Claude или Codex управляет студией: видит каталог блоков,
            собирает и правит письма, сохраняет их сюда. Ничего устанавливать не нужно —
            только ссылка. Платить студии тоже не нужно: модель ваша.</p>
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
      if (linkSeen(setup)) {
        return {
          state: "on",
          label: "свой агент подключён",
          title: `Ваш агент заходил по ссылке ${new Date(linkSeen(setup)).toLocaleString()}` +
            (setup.link?.lastClient ? ` (${setup.link.lastClient})` : "") +
            ". Разговаривать с ним — в его окне; здесь отвечает оператор студии.",
        };
      }
      if (!setup.local) {
        return {
          state: "off",
          label: "свой агент не подключён",
          title: "Нажмите, чтобы получить личную ссылку и вставить её в свой Claude или Codex — без установки и терминала.",
        };
      }
      if (link.connected && link.commandMissing) {
        return {
          state: "wrong",
          label: "агент: нет node",
          title: `В настройках Claude прописан node, которого больше нет: ${link.configuredCommand || "?"}. Откройте «Свой агент» и нажмите «Переподключить».`,
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
