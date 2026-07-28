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
    insert_block: "вставляю блок",
    remove_block: "удаляю блок",
    align_locales_to_reference: "выравниваю локали по эталону",
    placeholderize_html: "расставляю плейсхолдеры",
    translate_locale_txt: "перевожу",
    fix_locale_txt: "чиню локаль",
    finish: "подвожу итог",
  };

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
      root.querySelector(".chat-clear").addEventListener("click", () => { this.messages = []; this.log.innerHTML = ""; this.hello(); });
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

      this.hello();
      this.open();
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

      try {
        const saved = JSON.parse(localStorage.getItem(key) || "null");
        if (saved && Number.isFinite(saved.left) && Number.isFinite(saved.top)) place(saved.left, saved.top);
      } catch { /* ничего не запомнили — откроемся на месте по умолчанию */ }

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
          const p = place(ev.clientX - dx, ev.clientY - dy);
          try { localStorage.setItem(key, JSON.stringify(p)); } catch { /* не критично */ }
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

    open() { this.root?.classList.add("open"); setTimeout(() => this.input?.focus(), 40); }
    close() { this.root?.classList.remove("open"); }
    toggle() { if (!this.root) this.mount(); else this.root.classList.contains("open") ? this.close() : this.open(); }

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
            if (frame.kind === "error") { this.append("error", frame.message); continue; }
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
          this.onResult(final);
        }
      } catch (err) {
        thinking.remove();
        this.append("error", String(err.message || err));
      } finally {
        this.busy = false;
        this.root.classList.remove("busy");
        this.input.focus();
      }
    }
  }

  window.StudioChat = StudioChat;
})();
