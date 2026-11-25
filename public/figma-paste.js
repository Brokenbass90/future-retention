/**
 * public/figma-paste.js — «вставь макет из Figma».
 *
 * Одна дверь, а не две: кнопка в конструкторе и просьба в разговоре открывают
 * одно и то же окно. Второй такой же экран мы бы потом чинили дважды.
 *
 * Первый заход был неудобным, и вот чем именно:
 *   • окно висело в углу и спорило за место с разговором — его не было видно;
 *   • вставка ловилась только внутри маленького поля, куда сначала надо было
 *     попасть мышью. Человек жмёт Ctrl+V сразу, как только видит окно, —
 *     поэтому теперь вставка ловится на всём окне, пока оно открыто;
 *   • если из буфера приехал ключ файла без фрейма, окно писало «выберите
 *     нужный», но выбирать было негде. Теперь список фреймов тут же.
 *
 * Ссылку (⌘L на выделении) можно не вставлять в поле, а вбить в строку — так
 * привычнее, и это самый точный путь: в ссылке есть конкретный узел.
 */
(function () {
  "use strict";

  var esc = function (value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  };

  var root = null;
  var lastData = null;
  var onPlanReady = null;
  // Ожидание макета из плагина: пока окно открыто, студия спрашивает почтовый
  // ящик. Номер последней увиденной посылки нужен, чтобы не показывать один и
  // тот же макет по кругу.
  var inboxTimer = null;
  var inboxSeen = 0;

  function build() {
    var node = document.createElement("div");
    node.className = "figma-modal";
    node.innerHTML =
      '<div class="fm-backdrop"></div>' +
      '<div class="fm-dialog" role="dialog" aria-label="Макет из Figma" tabindex="-1">' +
        '<header class="fm-head">' +
          '<b>🎨 Макет из Figma</b>' +
          '<button type="button" class="fm-close" title="Закрыть (Esc)">✕</button>' +
        '</header>' +
        '<div class="fm-body">' +
          '<label class="fm-drop" id="fmDrop" for="fmCatch">' +
            // Настоящее поле ввода, растянутое на всю мишень и прозрачное.
            // Браузер отдаёт событие вставки сфокусированному полю — это
            // единственный надёжный способ поймать первый же Ctrl+V. Слушать
            // документ мало: если фокус остался в рамке предпросмотра или на
            // кнопке, вставка уходит туда, и человек жмёт «ещё раз».
            '<textarea id="fmCatch" spellcheck="false" aria-label="Вставьте макет"></textarea>' +
            '<div class="fm-drop-big">Нажмите <b>Ctrl+V</b></div>' +
            '<div class="fm-drop-sub" id="fmReady">готово к вставке</div>' +
          '</label>' +
          '<div class="fm-or">или вставьте ссылку на макет</div>' +
          '<div class="fm-link">' +
            '<input type="text" id="fmLink" placeholder="https://www.figma.com/design/…?node-id=1-2" spellcheck="false">' +
            '<button type="button" class="fm-go" id="fmGo">Забрать</button>' +
          '</div>' +
          '<p class="fm-hint">В Figma: <b>⌘C</b> на фрейме — разберём на секции и отступы. ' +
          '<b>⌘L</b> — ссылка на выделение, самый точный путь. ' +
          '<b>⌘⇧C</b> — картинкой: макет видно сразу, без токена Figma.</p>' +
          // Корпоративная Figma — это не «частный случай», а обычный рабочий
          // аккаунт. Персональный токен там неверный путь: его нельзя
          // ограничить одним файлом. Плагин делает то же самое и лучше,
          // поэтому он должен быть виден в окне, а не в README.
          '<p class="fm-hint">Рабочая Figma компании? Токен не нужен и не нужен вовсе: ' +
          '<button type="button" class="fm-link-btn" id="fmPlugin">поставить плагин</button> — ' +
          'он работает внутри Figma под вашим доступом, и макет приедет сюда сам.</p>' +
          '<div class="fm-result" id="fmResult" hidden></div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(node);

    node.querySelector(".fm-close").addEventListener("click", close);
    var catcher = node.querySelector("#fmCatch");
    // Человек должен видеть, поймает окно вставку или нет. «Не понятно,
    // выбрано окно или нет» — это ровно про отсутствие такой отметки.
    catcher.addEventListener("focus", markReady);
    catcher.addEventListener("blur", markLost);
    // Набирать в ловушке нечего: её дело — принять вставку.
    catcher.addEventListener("input", function () { catcher.value = ""; });
    node.querySelector(".fm-drop").addEventListener("click", function () { catcher.focus(); });
    node.querySelector(".fm-backdrop").addEventListener("click", close);
    node.querySelector("#fmGo").addEventListener("click", function () {
      var value = node.querySelector("#fmLink").value.trim();
      if (!value) return;
      if (!/figma\.com\/(?:design|file|proto)\//.test(value)) {
        busy("Это не ссылка на макет Figma. Нужна ссылка вида figma.com/design/… — её даёт ⌘L на выделении.");
        return;
      }
      busy("Забираю макет…");
      send({ text: value });
    });
    node.querySelector("#fmPlugin").addEventListener("click", showPluginSteps);
    node.querySelector("#fmLink").addEventListener("keydown", function (event) {
      if (event.key === "Enter") node.querySelector("#fmGo").click();
    });
    return node;
  }

  /* ─── Вставка ловится на всём окне, пока оно открыто ────────────────────── */

  /** Похоже ли вставленное на макет, а не на обычный текст. */
  function looksLikeDesign(html, text) {
    if (/\(figmeta\)|\(figma\)|data-buffer=/.test(html)) return true;
    return /figma\.com\/(?:design|file|proto)\//.test(text) || /figma\.com\/(?:design|file|proto)\//.test(html);
  }

  function onPaste(event) {
    if (!root || !root.classList.contains("open")) return;
    var data = event.clipboardData;
    if (!data) return;

    // Картинка и макет приезжают в буфере ВМЕСТЕ, если копировали через
    // ⌘⇧C. Раньше мы забирали картинку и уходили — и теряли разбор; или
    // забирали разбор — и человек не видел макета. Берём оба: картинку
    // показываем сразу, разбор догоняет.
    var image = null;
    for (var i = 0; i < (data.items || []).length; i++) {
      if (String(data.items[i].type || "").indexOf("image/") === 0) {
        image = data.items[i].getAsFile();
        if (image) break;
      }
    }

    var html = data.getData("text/html") || "";
    var text = data.getData("text/plain") || "";

    if (image && !looksLikeDesign(html, text)) {
      event.preventDefault();
      showImage(image);
      return;
    }
    if (image) {
      event.preventDefault();
      keepShot(image);
      busy("Разбираю макет…");
      send({ html: html.slice(0, 2000000), text: text.slice(0, 20000) });
      return;
    }

    // Решаем по СОДЕРЖИМОМУ, а не по тому, где стоял курсор.
    //
    // Первый заход решал по месту: вставку в строку ссылки пропускали, чтобы
    // она работала как обычная вставка. А фокус после открытия окна как раз
    // и оказывался в этой строке — и макет из Figma молча уезжал в неё
    // простым текстом: человек видел в поле кусок текста письма и «это
    // обычный текст, а не макет». Макет при этом лежал в буфере рядом, в
    // html-флейворе, и его никто не читал.
    if (!looksLikeDesign(html, text)) return;

    event.preventDefault();
    busy("Разбираю вставленное…");
    send({ html: html.slice(0, 2000000), text: text.slice(0, 20000) });
  }

  function onKey(event) {
    if (event.key === "Escape" && root && root.classList.contains("open")) close();
  }

  var shotUrl = "";

  function markReady() {
    if (!root) return;
    root.querySelector(".fm-drop").classList.add("ready");
    root.querySelector("#fmReady").textContent = "готово к вставке";
  }

  function markLost() {
    if (!root) return;
    root.querySelector(".fm-drop").classList.remove("ready");
    root.querySelector("#fmReady").textContent = "нажмите сюда, чтобы окно поймало вставку";
  }

  /** Снимок из буфера — показываем сразу, не дожидаясь похода в Figma. */
  function keepShot(file) {
    var reader = new FileReader();
    reader.onload = function () {
      shotUrl = reader.result;
      var slot = root.querySelector("#fmShot");
      if (slot) slot.innerHTML = '<img class="fm-shot" src="' + shotUrl + '" alt="">';
    };
    reader.readAsDataURL(file);
  }

  /**
   * Индикация работы.
   *
   * Строчка «разбираю…» без движения читается как «зависло»: поход в Figma
   * занимает несколько секунд, и всё это время окно выглядело мёртвым.
   */
  function busy(message) {
    var box = root.querySelector("#fmResult");
    box.hidden = false;
    box.innerHTML =
      '<div class="fm-busy"><span class="fm-spinner"></span><span>' + esc(message) + "</span></div>" +
      '<div id="fmShot">' + (shotUrl ? '<img class="fm-shot" src="' + shotUrl + '" alt="">' : "") + "</div>";
  }

  function send(payload) {
    fetch("/api/figma/paste", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
      .then(function (response) { return response.json(); })
      .then(render)
      .catch(function (error) { render({ ok: false, error: String((error && error.message) || error) }); });
  }

  function showImage(file) {
    var box = root.querySelector("#fmResult");
    box.hidden = false;
    var reader = new FileReader();
    reader.onload = function () {
      box.innerHTML =
        '<p class="fm-note">Это снимок макета, а не сам макет: секции и отступы по картинке ' +
        'не посчитать. Зато по нему можно найти похожие блоки в библиотеке.</p>' +
        '<img class="fm-shot" src="' + reader.result + '" alt="">' +
        '<button type="button" class="fm-primary" id="fmToChat">Обсудить снимок с оператором</button>';
      box.querySelector("#fmToChat").addEventListener("click", function () {
        if (window.RetkitFigmaPaste.onImage) window.RetkitFigmaPaste.onImage(reader.result);
        close();
      });
    };
    reader.readAsDataURL(file);
  }

  /* ─── Что показать после разбора ────────────────────────────────────────── */

  function render(data) {
    var box = root.querySelector("#fmResult");
    box.hidden = false;
    lastData = data && data.plan ? data : null;

    if (!data || data.ok === false) {
      box.innerHTML = '<p class="fm-note fm-err">Не получилось: ' + esc(data && data.error) + "</p>";
      return;
    }
    if (data.plan) { renderPlan(box, data); return; }

    // Ключа файла нет и плана нет — но тексты из макета в буфере есть почти
    // всегда. Половину работы по письму они закрывают, и терять их из-за
    // протухшего токена незачем.
    if (data.fileKey && !data.tokenProblem) { renderFrames(box, data); return; }
    box.innerHTML = '<p class="fm-note' + (data.tokenProblem ? " fm-err" : "") + '">' +
      esc(data.note || "Макет не опознан.") + "</p>" +
      // Картинку показываем, даже когда до Figma не достучались: человеку
      // важно видеть, ТОТ ли макет он вставил.
      (shotUrl ? '<img class="fm-shot" src="' + shotUrl + '" alt="">' : noShotHint(data)) +
      textOffer(data);
    wireTextOffer(box, data);
    wirePluginLink(box);
  }

  /**
   * Чем собирать. Разобранный макет без этого — просто список секций: человек
   * всё равно остаётся один на один с вопросом «а какими блоками?».
   */
  function matchRows(data) {
    var sections = (data && data.match && data.match.sections) || [];
    if (!sections.length) return "";
    var rows = sections.map(function (section) {
      if (section.needsNewBlock) {
        return '<li class="fm-nomatch"><b>' + section.order + "</b> — похожего блока нет, нужен новый</li>";
      }
      var best = section.candidates[0];
      var rest = section.candidates.slice(1).map(function (c) { return c.id; }).join(", ");
      return "<li><b>" + section.order + "</b> → <code>" + esc(best.id) + "</code>" +
        (best.why.length ? ' <span class="fm-dim">(' + esc(best.why.join(", ")) + ")</span>" : "") +
        (rest ? ' <span class="fm-dim">или ' + esc(rest) + "</span>" : "") + "</li>";
    });
    return '<p class="fm-note">Чем собирать:</p><ul class="fm-match">' + rows.join("") + "</ul>";
  }

  /**
   * Почему картинки нет и как получить её сейчас.
   *
   * ⌘C кладёт в буфер описание макета, но не его изображение — картинку
   * студия берёт из Figma по токену. Токен мёртв? Есть путь без него:
   * ⌘⇧C кладёт в буфер сам снимок.
   */
  function noShotHint(data) {
    if (!data || data.kind === "text" || data.kind === "empty") return "";
    return '<p class="fm-note fm-tip">Картинки макета здесь нет: ⌘C кладёт в буфер описание, ' +
      'а само изображение по буферу не восстановить. Увидеть макет прямо сейчас — ' +
      'в Figma <b>⌘⇧C</b> (Copy as PNG) и вставить сюда ещё раз. ' +
      'А чтобы студия забирала макеты целиком и без токена — ' +
      '<button type="button" class="fm-link-btn" id="fmPluginInline">поставьте плагин</button>.</p>';
  }

  /** Тексты макета — их можно взять в письмо и без похода в Figma. */
  function textOffer(data) {
    var text = String((data && data.text) || "").trim();
    if (!text) return "";
    var lines = text.split(/\n+/).filter(function (line) { return line.trim(); });
    if (!lines.length) return "";
    return '<p class="fm-note">Зато в буфере лежат тексты макета — ' + lines.length +
      " строк. Их можно взять в письмо прямо сейчас, картинки добавите потом.</p>" +
      '<pre class="fm-texts">' + esc(lines.slice(0, 14).join("\n")) +
      (lines.length > 14 ? "\n… ещё " + (lines.length - 14) : "") + "</pre>" +
      '<button type="button" class="fm-primary" id="fmTexts">Взять тексты в письмо</button>';
  }

  /** Ссылка «поставьте плагин» встречается и внутри результата разбора. */
  function wirePluginLink(box) {
    var link = box.querySelector("#fmPluginInline");
    if (link) link.addEventListener("click", showPluginSteps);
  }

  function wireTextOffer(box, data) {
    var button = box.querySelector("#fmTexts");
    if (!button) return;
    button.addEventListener("click", function () {
      if (window.RetkitFigmaPaste.onTexts) window.RetkitFigmaPaste.onTexts(String(data.text || ""));
      close();
    });
  }

  function renderFrames(box, data) {
    box.innerHTML = '<p class="fm-note">' + esc(data.note || "") + "</p>" +
      '<p class="fm-note">Смотрю, какие фреймы есть в файле…</p>';
    fetch("/api/figma/browse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileKey: data.fileKey }),
    })
      .then(function (response) { return response.json(); })
      .then(function (file) {
        if (file && file.error) {
          box.innerHTML = '<p class="fm-note fm-err">Файл не открылся: ' + esc(file.error) + "</p>";
          return;
        }
        var rows = [];
        (file.pages || []).forEach(function (page) {
          (page.frames || []).forEach(function (frame) {
            rows.push('<button type="button" class="fm-frame" data-node="' + esc(frame.id) + '">' +
              esc(frame.name) + ' <span class="fm-dim">' + Math.round(frame.width) + "×" +
              Math.round(frame.height) + " · " + esc(page.name) + "</span></button>");
          });
        });
        box.innerHTML = '<p class="fm-note">Файл «' + esc(file.fileName || "") + "». " +
          "Выберите фрейм письма:</p>" +
          (rows.length ? '<div class="fm-frames">' + rows.join("") + "</div>"
            : '<p class="fm-note">Фреймов в файле не нашлось.</p>');
        Array.prototype.forEach.call(box.querySelectorAll(".fm-frame"), function (button) {
          button.addEventListener("click", function () {
            busy("Забираю фрейм…");
            send({ text: "https://www.figma.com/design/" + data.fileKey + "/x?node-id=" +
              String(button.dataset.node).replace(":", "-") });
          });
        });
      })
      .catch(function (error) {
        box.innerHTML = '<p class="fm-note fm-err">Файл не открылся: ' + esc(error.message) + "</p>";
      });
  }

  function renderPlan(box, data) {
    var plan = data.plan;
    var rows = plan.sections.map(function (section) {
      var bits = [section.width + "×" + section.height + "px"];
      if (section.columns > 1) bits.push(section.columns + " колонки");
      if (section.padding.top) bits.push("отступ сверху " + section.padding.top);
      if (section.background) bits.push("фон " + section.background);
      var texts = section.texts.slice(0, 3).map(function (text) {
        return "<li>«" + esc(text.text.slice(0, 70)) + "» " + text.size + "px</li>";
      }).join("");
      var images = section.images.map(function (image) {
        return '<li class="fm-' + image.role + '">' + image.width + "×" + image.height + " — " +
          (image.role === "background" ? "фоном под текстом" : "картинкой в контенте") + "</li>";
      }).join("");
      return '<div class="fm-section"><b>' + section.order + ". " + esc(section.name || "секция") +
        '</b> <span class="fm-dim">' + esc(bits.join(", ")) + "</span>" +
        (texts || images ? "<ul>" + texts + images + "</ul>" : "") + "</div>";
    }).join("");

    box.innerHTML =
      (data.viaPlugin
        ? '<p class="fm-note fm-tip">Макет приехал из плагина Figma — без токена.' +
          (data.selection && data.selection.file ? " Файл: «" + esc(data.selection.file) + "»." : "") +
          "</p>"
        : "") +
      // Копия чужого файла делается ради плагина и остаётся в Drafts навсегда,
      // если о ней не напомнить в тот момент, когда она ещё открыта.
      (data.viaPlugin && data.looksLikeCopy
        ? '<p class="fm-note fm-warn-line">Это копия чужого файла — удалите её в Figma, ' +
          "когда макет разобран. Студии копия больше не нужна: всё, что нужно, уже здесь.</p>"
        : "") +
      '<p class="fm-note">Макет ' + plan.frame.width + "×" + plan.frame.height + "px, секций " +
        plan.sections.length + "." +
        (data.selection && data.selection.name ? " Фрейм «" + esc(data.selection.name) + "»." : "") + "</p>" +
      (data.selection && data.selection.preview
        ? '<img class="fm-shot" src="' + esc(data.selection.preview) + '" alt="">'
        : shotUrl ? '<img class="fm-shot" src="' + shotUrl + '" alt="">' : "") +
      rows +
      matchRows(data) +
      (plan.warnings.length
        ? '<ul class="fm-warn">' + plan.warnings.map(function (w) { return "<li>" + esc(w) + "</li>"; }).join("") + "</ul>"
        : "") +
      '<button type="button" class="fm-primary" id="fmBuild">Собрать письмо по макету</button>';

    var build = box.querySelector("#fmBuild");
    if (build) build.addEventListener("click", function () {
      if (onPlanReady) onPlanReady(lastData);
      close();
    });
  }

  /* ─── Путь без токена: плагин Figma ─────────────────────────────────────── */

  /**
   * Как поставить плагин — прямо в окне, а не «смотри README».
   *
   * Человек с корпоративной Figma приходит сюда именно за этим: токен ему
   * заводить нельзя, а из окна раньше следовало обратное.
   */
  function showPluginSteps() {
    var box = root.querySelector("#fmResult");
    box.hidden = false;
    box.innerHTML = '<div class="fm-busy"><span class="fm-spinner"></span><span>Смотрю, где лежит плагин…</span></div>';
    fetch("/api/figma/plugin")
      .then(function (response) { return response.json(); })
      .then(function (data) {
        var steps = (data && data.steps) || [];
        box.innerHTML =
          '<p class="fm-note">' + esc((data && data.note) || "") + "</p>" +
          '<ol class="fm-steps">' + steps.map(function (step) {
            return "<li>" + esc(step) + "</li>";
          }).join("") + "</ol>" +
          // Чужой макет почти всегда приходит ссылкой «только просмотр», а
          // плагины в таком файле Figma не запускает вовсе. Человек упрётся в
          // это на третьем шаге, если не сказать заранее.
          (data && data.viewOnly
            ? '<p class="fm-note fm-tip"><b>' + esc(data.viewOnly.title) + "</b></p>" +
              '<ol class="fm-steps">' + (data.viewOnly.steps || []).map(function (step) {
                return "<li>" + esc(step) + "</li>";
              }).join("") + "</ol>"
            : "") +
          (data && data.secretRequired
            ? '<p class="fm-note fm-tip">У студии задан FIGMA_IMPORT_SECRET — впишите его в поле ' +
              '«secret» в окне плагина, иначе посылку студия не примет.</p>'
            : "") +
          '<div class="fm-busy" id="fmWaiting"><span class="fm-spinner"></span>' +
          "<span>Жду макет из плагина — окно можно не закрывать</span></div>";
      })
      .catch(function (error) {
        box.innerHTML = '<p class="fm-note fm-err">Не вышло спросить студию про плагин: ' +
          esc(error.message) + "</p>";
      });
  }

  /**
   * Пока окно открыто, студия спрашивает почтовый ящик.
   *
   * Плагин шлёт макет на эту же машину, но сам о студии ничего не знает:
   * раньше человек нажимал «Отправить в студию», переключался сюда и не видел
   * ничего. Ожидание дешёвое — ответ пустой, пока посылки нет.
   */
  function watchInbox() {
    stopInbox();
    inboxTimer = setInterval(function () {
      fetch("/api/figma/inbox?since=" + inboxSeen)
        .then(function (response) { return response.json(); })
        .then(function (data) {
          if (!data || !data.fresh || !data.design) return;
          inboxSeen = data.revision;
          var design = data.design;
          render({
            ok: true,
            viaPlugin: true,
            plan: design.plan,
            match: design.match || null,
            matchSummary: design.matchSummary || "",
            selection: design.selection || null,
            looksLikeCopy: design.looksLikeCopy === true,
            summary: design.summary || "",
          });
        })
        .catch(function () { /* студия перезапускается — придём в следующий раз */ });
    }, 1500);
  }

  function stopInbox() {
    if (inboxTimer) { clearInterval(inboxTimer); inboxTimer = null; }
  }

  /* ─── Открыть / закрыть ─────────────────────────────────────────────────── */

  function open(options) {
    if (!root) root = build();
    onPlanReady = (options && options.onPlan) || window.RetkitFigmaPaste.onPlan || null;
    root.classList.add("open");
    root.querySelector("#fmResult").hidden = true;
    root.querySelector("#fmLink").value = "";
    shotUrl = "";
    document.addEventListener("paste", onPaste, true);
    document.addEventListener("keydown", onKey, true);
    // Макет, присланный ДО открытия окна, показываем: обычный порядок —
    // отправить из Figma, а потом переключиться в студию. Второй раз тот же
    // макет не покажем: увиденную посылку ожидание запоминает.
    watchInbox();

    // Фокус — в ловушку вставки, а не в строку ссылки и не в «никуда».
    // Ставим сразу и повторяем кадром позже: пока окно только появляется,
    // focus() иногда не доезжает, и первый Ctrl+V уходит мимо.
    var catcher = root.querySelector("#fmCatch");
    var grab = function () {
      if (!root.classList.contains("open")) return;
      try { catcher.focus({ preventScroll: true }); } catch (error) { catcher.focus(); }
      markReady();
    };
    grab();
    requestAnimationFrame(grab);
    setTimeout(grab, 120);
  }

  function close() {
    if (!root) return;
    root.classList.remove("open");
    stopInbox();
    document.removeEventListener("paste", onPaste, true);
    document.removeEventListener("keydown", onKey, true);
  }

  /** Просьба словами: «вставлю макет», «есть макет в фигме». */
  function wantsFigma(text) {
    var value = String(text || "").toLowerCase();
    if (/figma|фигм/.test(value)) return true;
    return /(вставл|вставить|скопир|загруз)/.test(value) && /(макет|дизайн|layout)/.test(value);
  }

  window.RetkitFigmaPaste = {
    open: open, close: close, wantsFigma: wantsFigma,
    onPlan: null, onImage: null, onTexts: null,
  };
})();
