/**
 * public/studio-chat.js — панель разговора с оператором студии.
 *
 * Одна и та же сущность на обеих поверхностях: конструктор и код письма
 * говорят с агентом через `/api/studio/agent`, отличается только контекст,
 * который поверхность собирает про себя (`buildContext`).
 *
 * Панель намеренно не знает про конструктор ничего лишнего: ей передают
 * функцию контекста и функцию применения результата. Так её можно повесить
 * на workbench без единой правки внутри.
 */
(function () {
  const MAX_IMAGES = 4;
  const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
  const MAX_TOTAL_IMAGE_BYTES = 12 * 1024 * 1024;

  function dataUrlByteLength(value) {
    const dataUrl = String(value || "");
    const comma = dataUrl.indexOf(",");
    if (comma < 0) return dataUrl.length;
    const header = dataUrl.slice(0, comma);
    const payload = dataUrl.slice(comma + 1);
    if (/;base64(?:;|$)/i.test(header)) {
      const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
      return Math.max(0, Math.floor(payload.length * 3 / 4) - padding);
    }
    try {
      return new TextEncoder().encode(decodeURIComponent(payload)).length;
    } catch {
      return payload.length;
    }
  }

  function imageByteLength(image) {
    const declared = Number(image?.bytes);
    return Math.max(
      Number.isFinite(declared) && declared >= 0 ? declared : 0,
      dataUrlByteLength(image?.dataUrl)
    );
  }

  function validateImageAttachments(images) {
    const list = Array.isArray(images) ? images : [];
    if (list.length > MAX_IMAGES) {
      return `Можно приложить не больше ${MAX_IMAGES} изображений.`;
    }
    const sizes = list.map(imageByteLength);
    if (sizes.some((size) => size > MAX_IMAGE_BYTES)) {
      return "Каждое изображение должно быть не больше 4 МБ.";
    }
    if (sizes.reduce((sum, size) => sum + size, 0) > MAX_TOTAL_IMAGE_BYTES) {
      return "Общий размер изображений должен быть не больше 12 МБ.";
    }
    return "";
  }

  function el(tag, cls, html) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (html != null) node.innerHTML = html;
    return node;
  }

  function escapeHtml(text) {
    return String(text ?? "").replace(/[&<>"']/g, (c) => (
      { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
    ));
  }

  /** Человеческие названия инструментов: «tool_call: find_blocks_by_look» никому не помогает. */
  const TOOL_LABELS = {
    find_blocks_by_look: "ищу блок по внешнему виду",
    list_canonical_blocks: "смотрю библиотеку блоков",
    get_block_source: "читаю исходник блока",
    compose_email_from_blocks: "собираю письмо из блоков",
    read_open_html: "читаю письмо",
    analyze_email: "разбираю структуру письма",
    validate_html: "проверяю вёрстку",
    compare_locales: "сверяю локали",
    list_namespaces: "смотрю локали",
    get_namespace_blocks: "читаю блоки локали",
    find_in_html: "ищу в вёрстке",
    replace_in_html: "правлю вёрстку",
    insert_block: "вставляю блок в вёрстку",
    remove_block: "убираю блок из вёрстки",
    update_canvas_block: "правлю блок в письме",
    add_canvas_block: "ставлю блок в письмо",
    remove_canvas_block: "убираю блок из письма",
    move_canvas_block: "переставляю блок",
    clear_canvas: "очищаю письмо",
    check_canvas_ready: "проверяю, дособрано ли письмо",
    see_email: "смотрю на письмо",
    see_block: "смотрю на блок",
    open_draft: "беру письмо в черновик",
    publish_draft: "публикую черновик",
    list_mail_files: "смотрю исходники письма",
    read_mail_file: "читаю исходник письма",
    write_mail_file: "правлю исходник письма",
    align_locales_to_reference: "выравниваю локали по эталону",
    placeholderize_html: "расставляю плейсхолдеры",
    translate_locale_txt: "перевожу",
    fix_locale_txt: "чиню локаль",
    finish: "подвожу итог",
  };

  /**
   * Перевод отказа модели на человеческий.
   *
   * «429», «insufficient_quota», «rate limit» — это не поломка студии, и
   * чинить человеку нечего: у модели кончились токены или она занята. Показать
   * ему сырой код значит отправить его искать баг там, где бага нет; показать
   * «ошибка» — значит скрыть, что надо просто подождать.
   */
  function describeFailure(message) {
    var text = String(message || "");
    if (/insufficient_quota|exceeded your current quota|billing/i.test(text)) {
      return "⏳ У модели кончились токены — счёт исчерпан. Работа не потеряна: допишите " +
        "квоту у провайдера модели или подключите своего агента (значок в шапке этого окна), " +
        "и продолжим с этого же места.";
    }
    if (/\b429\b|rate[ _-]?limit|too many requests/i.test(text)) {
      return "⏳ Модель сейчас занята — слишком много запросов подряд. Подождите полминуты " +
        "и повторите: студия ничего не потеряла.";
    }
    if (/\b(408|504)\b|timeout|timed out/i.test(text)) {
      return "⏳ Модель не ответила вовремя. Повторите — обычно со второго раза проходит.";
    }
    if (/OPENAI_API_KEY is not configured/i.test(text)) {
      return "Своей модели у студии нет — это нормально. Подключите своего агента: " +
        "значок состояния в шапке этого окна.";
    }
    return text;
  }

  class StudioChat {
    /**
     * @param {object} options
     * @param {string} options.surface        — "constructor" | "workbench"
     * @param {() => object} options.buildContext — что поверхность знает о себе прямо сейчас
     * @param {(payload:object) => void} [options.onResult] — применить результат
     * @param {string} [options.title]
     */
    constructor(options) {
      this.surface = options.surface;
      this.buildContext = options.buildContext || (() => ({}));
      this.onResult = options.onResult || (() => {});
      // Поверхность хочет знать, открыто ли окно: круглая кнопка внизу справа
      // подсвечивается, пока идёт разговор. Раньше она об этом не узнавала,
      // если окно открыли правой кнопкой по блоку, и выглядела погашенной.
      this.onOpenChange = options.onOpenChange || (() => {});
      this.title = options.title || "Оператор студии";
      this.messages = [];
      this.images = [];
      this.imageAddQueue = Promise.resolve();
      this.busy = false;
      this.root = null;
    }

    mount() {
      if (this.root) { this.open(); return; }
      const root = el("div", "chat-panel");
      root.id = `studioChat-${this.surface}`;
      root.innerHTML = `
        <header class="chat-head">
          <span class="chat-title">🤖 ${escapeHtml(this.title)}</span>
          <button class="chat-agent-state" type="button" data-state="unknown"
                  title="Состояние подключения своего агента">·&nbsp;проверяю подключение</button>
          <button class="chat-clear" type="button" title="Очистить переписку">Очистить</button>
          <button class="chat-close" type="button" title="Свернуть (Esc)">✕</button>
        </header>
        <div class="chat-log" role="log" aria-live="polite"></div>
        <div class="chat-attachments"></div>
        <form class="chat-form">
          <textarea class="chat-input" rows="2" placeholder="Опиши задачу. Картинку можно вставить из буфера или перетащить сюда."></textarea>
          <div class="chat-actions">
            <label class="chat-attach" title="Приложить картинку">
              📎<input type="file" accept="image/*" multiple hidden>
            </label>
            <button class="chat-send btn" type="submit">Отправить</button>
          </div>
        </form>`;
      document.body.appendChild(root);
      this.root = root;
      this.log = root.querySelector(".chat-log");
      this.input = root.querySelector(".chat-input");
      this.attachments = root.querySelector(".chat-attachments");

      this.makeDraggable(root.querySelector(".chat-head"));
      root.querySelector(".chat-form").addEventListener("submit", (e) => { e.preventDefault(); this.send(); });
      root.querySelector(".chat-close").addEventListener("click", () => this.close());
      root.querySelector(".chat-clear").addEventListener("click", () => {
        this.messages = []; this.log.innerHTML = ""; this.hello();
        // Очищаем и общий разговор — иначе в коде он всплывёт снова.
        fetch("/api/studio/agent/thread/clear", { method: "POST" }).catch(() => {});
      });
      // Мастер подключения нужен по нажатию, а не только когда у студии нет
      // своей модели. Раньше он показывался сам и только в этом случае —
      // поэтому у тех, у кого модель настроена, двери к своему агенту просто
      // не было.
      root.querySelector(".chat-agent-state").addEventListener("click", () => this.showAgentWizard());
      this.refreshAgentState();
      root.querySelector(".chat-attach input").addEventListener("change", (e) => {
        this.addImages([...e.target.files]);
        e.target.value = "";
      });
      this.input.addEventListener("keydown", (e) => {
        // Enter отправляет, Shift+Enter — перенос строки: как в любом мессенджере.
        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); this.send(); }
      });
      this.input.addEventListener("paste", (e) => {
        const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith("image/"));
        if (files.length) { e.preventDefault(); this.addImages(files); }
      });
      root.addEventListener("dragover", (e) => { e.preventDefault(); root.classList.add("drag"); });
      root.addEventListener("dragleave", () => root.classList.remove("drag"));
      root.addEventListener("drop", (e) => {
        e.preventDefault();
        root.classList.remove("drag");
        this.addImages([...(e.dataTransfer?.files || [])].filter((f) => f.type.startsWith("image/")));
      });

      this.loadThread();
      this.open();
    }

    /**
     * Разговор общий для конструктора и кода: подтягиваем его с сервера,
     * чтобы, перейдя на другую страницу, человек продолжал тот же разговор.
     */
    async loadThread() {
      let messages = [];
      try {
        const res = await fetch("/api/studio/agent/thread");
        const data = res.ok ? await res.json() : null;
        messages = Array.isArray(data?.messages) ? data.messages.slice(-12) : [];
      } catch { messages = []; }
      if (!messages.length) { this.hello(); return; }
      const where = { constructor: "конструктор", workbench: "код" };
      for (const m of messages) {
        const tag = m.surface && m.surface !== this.surface ? `[${where[m.surface] || m.surface}] ` : "";
        this.append(m.role === "assistant" ? "assistant" : "user", `${tag}${m.content}`);
      }
      this.messages = messages.map((m) => ({ role: m.role, content: m.content }));
    }

    /**
     * Окно двигается за заголовок. Это не украшательство: панель перекрывает
     * то самое письмо, про которое идёт разговор, и её постоянно нужно
     * отодвигать. Позиция запоминается — иначе каждый раз двигать заново.
     */
    makeDraggable(handle) {
      if (!handle) return;
      handle.classList.add("chat-drag-handle");
      const key = `retkit.chatPos.${this.surface}`;

      const clamp = (left, top) => {
        const w = this.root.offsetWidth || 430;
        const h = 44; // за верхнюю полосу окно всегда можно поймать обратно
        return {
          left: Math.max(8 - w + 80, Math.min(left, window.innerWidth - 80)),
          top: Math.max(0, Math.min(top, window.innerHeight - h)),
        };
      };

      const place = (left, top) => {
        const p = clamp(left, top);
        this.root.style.left = `${p.left}px`;
        this.root.style.top = `${p.top}px`;
        this.root.style.right = "auto";
        this.root.style.bottom = "auto";
        return p;
      };

      /**
       * Размер запоминается вместе с положением.
       *
       * Растянуть окно можно было и раньше (CSS resize), но на следующем
       * открытии оно снова становилось узким — и человек тянул его заново
       * каждый раз. Разговор о письме идёт длинный, и ширина тут не каприз.
       */
      const saveBox = () => {
        const rect = this.root.getBoundingClientRect();
        try {
          localStorage.setItem(key, JSON.stringify({
            left: rect.left, top: rect.top,
            width: Math.round(rect.width), height: Math.round(rect.height),
          }));
        } catch { /* не критично */ }
      };

      try {
        const saved = JSON.parse(localStorage.getItem(key) || "null");
        if (saved && Number.isFinite(saved.left) && Number.isFinite(saved.top)) place(saved.left, saved.top);
        if (saved && Number.isFinite(saved.width) && Number.isFinite(saved.height)) {
          // Окно не должно оказаться больше экрана: вчера человек работал на
          // большом мониторе, сегодня открыл студию на ноутбуке.
          this.root.style.width = `${Math.min(saved.width, window.innerWidth - 24)}px`;
          this.root.style.height = `${Math.min(saved.height, window.innerHeight - 24)}px`;
        }
      } catch { /* ничего не запомнили — откроемся на месте по умолчанию */ }

      // Растягивание идёт мимо всех обработчиков (это делает сам браузер),
      // поэтому размер ловим наблюдателем, а не событием мыши.
      if (typeof ResizeObserver === "function") {
        let first = true;
        const observer = new ResizeObserver(() => {
          if (first) { first = false; return; } // первая отрисовка — не правка размера
          clearTimeout(this._resizeSaveTimer);
          this._resizeSaveTimer = setTimeout(saveBox, 400);
        });
        observer.observe(this.root);
      }

      handle.addEventListener("pointerdown", (e) => {
        // Кнопки в заголовке остаются кнопками, а не ручкой перетаскивания.
        if (e.target.closest("button")) return;
        e.preventDefault();
        const rect = this.root.getBoundingClientRect();
        const dx = e.clientX - rect.left;
        const dy = e.clientY - rect.top;
        handle.setPointerCapture(e.pointerId);
        this.root.classList.add("dragging");

        const move = (ev) => place(ev.clientX - dx, ev.clientY - dy);
        const up = (ev) => {
          handle.removeEventListener("pointermove", move);
          handle.removeEventListener("pointerup", up);
          this.root.classList.remove("dragging");
          place(ev.clientX - dx, ev.clientY - dy);
          saveBox();
        };
        handle.addEventListener("pointermove", move);
        handle.addEventListener("pointerup", up);
      });

      // Окно осталось за пределами экрана после смены разрешения — вернём.
      window.addEventListener("resize", () => {
        if (!this.root.classList.contains("open")) return;
        const rect = this.root.getBoundingClientRect();
        if (rect.left > window.innerWidth - 80 || rect.top > window.innerHeight - 44) {
          place(rect.left, rect.top);
        }
      });
    }

    hello() {
      this.append("assistant", this.surface === "constructor"
        ? "Помогу собрать письмо. Кинь скрин нужного блока — найду похожий в библиотеке. Могу проверить, что уже собрано, или собрать письмо с нуля по картинке."
        : "Помогу с вёрсткой и локалями открытого письма. Опиши задачу словами или приложи скрин.");
    }

    /**
     * Подключён ли свой агент — одной строкой в шапке окна.
     *
     * Раньше на этом месте был всплывающий мастер, и показывался он только
     * тем, у кого не настроена своя модель студии, — то есть ровно тем, кому
     * подключение было не нужно, а остальным не показывался вовсе: человек с
     * настроенной моделью не видел двери к своему агенту. Состояние честнее
     * кнопки: оно читается с диска и отвечает на вопрос «работает ли».
     */
    async refreshAgentState() {
      const badge = this.root?.querySelector(".chat-agent-state");
      if (!badge || !window.RetkitMcpConnect?.status) return;
      const dots = { on: "●", off: "○", wrong: "⚠", remote: "○", unknown: "·" };
      const state = await window.RetkitMcpConnect.status();
      badge.dataset.state = state.state;
      badge.textContent = `${dots[state.state] || "·"} ${state.label}`;
      badge.title = `${state.title}\n\nНажмите, чтобы открыть подключение — или попросите об этом словами в разговоре.`;
    }

    /** Показать мастер подключения по явной просьбе — своей или человека. */
    showAgentWizard() {
      if (!window.RetkitMcpConnect) return;
      const host = el("div", "chat-msg mcp");
      this.log?.appendChild(host);
      window.RetkitMcpConnect.render(host);
      this.log.scrollTop = this.log.scrollHeight;
      // Мастер меняет состояние на диске, но индикатор об этом не узнает сам.
      // Дёшево и честно: перечитать, когда человек закончил с мастером.
      setTimeout(() => { window.RetkitMcpConnect.forget?.(); this.refreshAgentState(); }, 4000);
    }

    open() {
      this.root?.classList.add("open");
      this.onOpenChange(true);
      setTimeout(() => this.input?.focus(), 40);
    }

    close() {
      this.root?.classList.remove("open");
      this.onOpenChange(false);
    }

    toggle() { if (!this.root) this.mount(); else this.root.classList.contains("open") ? this.close() : this.open(); }

    /**
     * Открыть разговор о конкретном предмете — блоке в письме или карточке
     * каталога. Вопрос за человека не задаём: подставляем в поле ссылку на
     * предмет, чтобы он дописал своё и отправил.
     *
     * Набранный текст не затираем — дописываем ссылку перед ним. Раньше при
     * непустом поле подстановка молча пропускалась: человек нажимал «обсудить
     * с ИИ» по блоку, окно открывалось, а о каком блоке речь — нигде не
     * говорилось, и оператор отвечал невпопад.
     *
     * @param {{text:string}} subject — как назвать предмет разговора
     * @returns {boolean} попала ли ссылка в поле
     */
    discuss(subject) {
      this.mount();
      this.open();
      const text = String(subject?.text || "").trim();
      if (!text || !this.input) return false;
      const current = String(this.input.value || "");
      if (current.includes(text)) {
        this.input.focus();
        return true;
      }
      const draft = `${text} `;
      this.input.value = `${draft}${current}`;
      this.input.focus();
      try { this.input.setSelectionRange(draft.length, draft.length); } catch {}
      return true;
    }

    attachmentError(message) {
      if (!message) return;
      if (this.log) this.append("error", message);
      else console.warn(`[studio-chat] ${message}`);
    }

    addImages(files) {
      const pendingFiles = Array.from(files || []);
      this.imageAddQueue = this.imageAddQueue
        .then(() => this.addImagesNow(pendingFiles))
        .catch((error) => this.attachmentError(String(error?.message || error)));
      return this.imageAddQueue;
    }

    async addImagesNow(files) {
      let countRejected = 0;
      for (const file of files) {
        if (this.images.length >= MAX_IMAGES) {
          countRejected += 1;
          continue;
        }

        const fileBytes = Number(file?.size) || 0;
        if (fileBytes > MAX_IMAGE_BYTES) {
          this.attachmentError(`«${file?.name || "Изображение"}» больше 4 МБ и не добавлено.`);
          continue;
        }

        const currentTotal = this.images.reduce((sum, image) => sum + imageByteLength(image), 0);
        if (currentTotal + fileBytes > MAX_TOTAL_IMAGE_BYTES) {
          this.attachmentError(`«${file?.name || "Изображение"}» не добавлено: общий лимит — 12 МБ.`);
          continue;
        }

        const dataUrl = await new Promise((res) => {
          const reader = new FileReader();
          reader.onload = () => res(String(reader.result || ""));
          reader.onerror = () => res("");
          reader.readAsDataURL(file);
        });
        if (!dataUrl) {
          this.attachmentError(`Не удалось прочитать «${file?.name || "изображение"}».`);
          continue;
        }

        const nextImage = { name: file.name, dataUrl, bytes: fileBytes };
        const validationError = validateImageAttachments([...this.images, nextImage]);
        if (validationError) {
          this.attachmentError(validationError);
          continue;
        }
        this.images.push(nextImage);
      }
      if (countRejected > 0) {
        this.attachmentError(`Можно приложить не больше ${MAX_IMAGES} изображений.`);
      }
      this.renderAttachments();
    }

    renderAttachments() {
      if (!this.attachments) return;
      this.attachments.innerHTML = this.images.map((img, i) =>
        `<span class="chat-thumb"><img src="${escapeHtml(img.dataUrl)}" alt="${escapeHtml(img.name)}">
           <button type="button" data-drop="${i}" title="Убрать">✕</button></span>`).join("");
      this.attachments.querySelectorAll("[data-drop]").forEach((btn) => {
        btn.addEventListener("click", () => {
          this.images.splice(Number(btn.dataset.drop), 1);
          this.renderAttachments();
        });
      });
    }

    append(role, text) {
      const node = el("div", `chat-msg chat-${role}`);
      node.textContent = text;
      this.log.appendChild(node);
      this.log.scrollTop = this.log.scrollHeight;
      return node;
    }

    /** Живой лог шагов агента: человеку важно видеть, что он не завис. */
    appendStep(frame) {
      if (frame.kind === "tool_call") {
        const label = TOOL_LABELS[frame.name] || frame.name;
        const node = el("div", "chat-step", `<span class="chat-step-dot"></span>${escapeHtml(label)}…`);
        node.dataset.stepFor = frame.name;
        this.log.appendChild(node);
      } else if (frame.kind === "tool_result") {
        const pending = [...this.log.querySelectorAll(`[data-step-for="${CSS.escape(frame.name || "")}"]`)].pop();
        if (pending) {
          pending.classList.add("done");
          const found = frame.result && typeof frame.result === "object"
            ? (frame.result.count ?? frame.result.blocks?.length ?? null)
            : null;
          if (found != null) pending.innerHTML += ` <b>${found}</b>`;
        }
      } else if (frame.kind === "text" && frame.text) {
        this.append("assistant", frame.text);
      }
      this.log.scrollTop = this.log.scrollHeight;
    }

    async send() {
      if (this.busy) return;
      const text = this.input.value.trim();
      if (!text && !this.images.length) return;
      // Мастер вызывается словами, а не кнопкой: «подключи ещё одного агента»,
      // «переподключи Клода». Проверяем до отправки — оператору студии этот
      // вопрос задавать бессмысленно, он про свои настройки ничего не знает и
      // начнёт выдумывать.
      // «вставлю макет», «есть дизайн в фигме» — открываем ту же дверь, что и
      // кнопка в конструкторе. Второго такого окна не заводим.
      if (!this.images.length && window.RetkitFigmaPaste?.wantsFigma?.(text)) {
        this.append("user", text);
        this.input.value = "";
        this.append("assistant", "Открыл окно вставки макета: ⌘C на фрейме в Figma (или ⌘L на выделении) — и Ctrl+V туда.");
        window.RetkitFigmaPaste.open();
        return;
      }

      if (!this.images.length && window.RetkitMcpConnect?.wantsSetup?.(text)) {
        this.append("user", text);
        this.input.value = "";
        this.append("assistant", "Подключение своего агента — ниже. Скилл студии поставится вместе с ним.");
        window.RetkitMcpConnect.forget?.();
        this.showAgentWizard();
        return;
      }

      const attachmentValidationError = validateImageAttachments(this.images);
      if (attachmentValidationError) {
        this.attachmentError(attachmentValidationError);
        return;
      }

      this.append("user", text || "(картинка)");
      this.messages.push({ role: "user", content: text });
      this.input.value = "";
      const images = this.images.map((i) => i.dataUrl);
      this.images = [];
      this.renderAttachments();
      await this.ask(text, images);
    }

    /**
     * Проверка собранного: поверхность применила правки агента, пересобрала
     * превью и отдаёт отчёт. Агент смотрит на настоящий результат (see_email)
     * и чинит то, что не вышло. Один круг — чтобы не зациклиться.
     */
    async verifyBuild(report) {
      if (this.busy) return;
      const problems = Array.isArray(report?.problems) ? report.problems : [];
      this.append("assistant", problems.length
        ? "Студия не приняла часть правок — исправляю…"
        : "Смотрю, что получилось…");
      await this.ask("Проверь собранное письмо.", [], { verify: true, report });
    }

    async ask(text, images, { verify = false, report = null } = {}) {
      this.busy = true;
      this.root.classList.add("busy");
      const thinking = this.append("assistant", "думаю…");

      try {
        const res = await fetch("/api/studio/agent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            surface: this.surface,
            message: text,
            images,
            messages: this.messages.slice(-8),
            ...(verify ? { verify: true, verifyReport: report || {} } : {}),
            ...this.buildContext(),
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || `сервер ответил ${res.status}`);
        }
        thinking.remove();

        // NDJSON: каждая строка — отдельный кадр работы агента.
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let final = null;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) {
            if (!line.trim()) continue;
            let frame;
            try { frame = JSON.parse(line); } catch { continue; }
            if (frame.kind === "final") { final = frame.payload; continue; }
            if (frame.kind === "error") { this.append("error", describeFailure(frame.message)); continue; }
            this.appendStep(frame);
          }
        }

        if (final) {
          // Агент отдаёт итог дважды: сначала кадром `text` по ходу работы,
          // потом тем же текстом в `final.summary`. Показывать одно и то же
          // двумя пузырями — выглядит как заедание, поэтому сверяем с
          // последним сообщением.
          const lastShown = this.log.querySelector(".chat-assistant:last-of-type")?.textContent?.trim();
          if (final.summary && final.summary.trim() !== lastShown) {
            this.append("assistant", final.summary);
          }
          if (final.summary) this.messages.push({ role: "assistant", content: final.summary });
          // Результат применяется, а проверка (если поверхность её хочет)
          // идёт уже после того, как разговор освободился.
          this._afterTurn = { final, verify };
        }
      } catch (err) {
        thinking.remove();
        this.append("error", describeFailure(String(err.message || err)));
      } finally {
        this.busy = false;
        this.root.classList.remove("busy");
        this.input.focus();
      }
      const after = this._afterTurn;
      this._afterTurn = null;
      if (after) {
        try { await this.onResult(after.final, { verifyRound: after.verify }); }
        catch (error) { this.append("error", describeFailure(String(error?.message || error))); }
      }
    }
  }

  window.StudioChat = StudioChat;
})();
