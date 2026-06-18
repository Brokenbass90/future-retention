# RetKit Email Studio — аудит и дорожная карта

> Документ-снапшот. Что мы строим, что уже работает, что сломано, и что
> делать в следующие 4-6 итераций. Обновляется в конце каждой сессии.

---

## Что мы строим (одной фразой)

Студия для команды email-маркетинга, в которой можно:
- держать **базу шаблонов писем** (Pug + Stylus → HTML, локали в TXT),
- **редактировать любое письмо** (HTML или Pug-исходник) с превью,
- **локализовать** (вручную или AI) на 19+ языков, включая RTL (ar/ur/he/fa),
- **собирать новые письма** drag-and-drop из готовых блоков,
- **разговаривать со студией** через AI-чат: «расставь плейсхолдеры», «переведи во все локали», «почини локаль ar», «вставь CTA-блок из базы».

Это не конструктор для конечных пользователей. Это инструмент верстальщика +
менеджера локализации, в котором AI ускоряет рутину.

---

## Архитектура

```
retantion-future/
├── server.js                    HTTP server (node:http, ESM, no Express),
│                                AI orchestration, REST для студии и AI-tools.
├── src/
│   ├── ai-client.js             OpenAI Responses API wrapper, retry/backoff.
│   ├── locale-ai.js             AI helpers: placeholderize / fix locale TXT /
│   │                            translate locale TXT (под TXT-формат студии).
│   ├── catalog.js               Block catalog — нарезка реальных писем на
│   │                            переиспользуемые секции.
│   └── ...                      figma, design-decomposition, eval, ...
├── email-base/
│   ├── X_IQ, X_IQBroker, ...    Папки брендов с письмами (Pug + Stylus + assets).
│   ├── vendor/
│   │   ├── data/<locale>/*.json Локали в JSON для встроенного {{key}} flow.
│   │   └── helpers, blocks, ... shared partials.
│   └── tools/
│       ├── build-mail.js        Pipeline: Stylus → CSS → Pug render → CSS inline
│       │                        → localize ${{ ns.key }}$ → RTL post-process.
│       └── rtl.js               Конвертер LTR → RTL (text-align flip + dir на
│                                p/h/li/leaf div). Используется и в build, и в
│                                preview (через server.js → workbench.js).
├── public/
│   ├── workbench.html, .js, .css   Студия: редактор, превью, локали, чат, drag-drop.
│   └── app.js, index.html       Старый chat-only UI (мы его не трогаем).
├── data/
│   ├── block-catalog.json       15 шаблонных блоков из реальной базы.
│   ├── block-snippets.json      Pug-снипеты для каждого (для шелфа).
│   └── studio.db (sqlite)       AI history.
└── scripts/
    └── extract-block-snippets.mjs  Re-генерация snippets из base.
```

Работает локально на `npm start` → http://localhost:3000.
OpenAI key — через `.env` (`OPENAI_API_KEY`).

---

## Что УЖЕ работает

### Редактор + превью
- HTML-редактор на CodeMirror с подсветкой, минимапом, fullscreen, split-view.
- Pug-редактор с подсветкой плейсхолдеров (overlay `pug-with-placeholders`).
- Stylus/CSS-редактор с подсветкой плейсхолдеров.
- Превью с подстановкой локали, viewport toggle (desktop/mobile/fit),
  click-в-превью → подсветка блока в коде.

### Локали (TXT-формат)
- Загрузка папки/файлов TXT с блоками `{{...}}` (`@@bold@@` для жирного).
- Парсер с диагностикой: непарные скобки, пустые блоки, текст вне блоков,
  расхождение количества блоков между локалями.
- Редактор локали в попапе с подсветкой и валидацией.
- Превью переключается между Original / EN / RU / AR / UR / ... на лету.

### RTL (ar/ur/he/fa)
- Один источник правды: `email-base/tools/rtl.js`. Зеркалится в `applyRtl`
  в `public/workbench.js` (превью) и `applyLocaleDirectionToHtml` в `server.js`.
- Поведение **консервативное**: только `text-align: left → right` (в `<style>`
  блоках и в каждом `style=""` атрибуте) + `dir="rtl"` на `<p>`/`<h1-6>`/`<li>`
  и на leaf `<div>` с текстом. **НЕ** свапается padding/margin/float — layout
  не «плывёт», ширина письма не меняется.

### AI tools
| Endpoint | Что делает |
|---|---|
| `POST /api/wb/ai/placeholderize` | HTML или Pug source → расставить `${{ ns.block_NN }}$` по reference TXT. Literal-string match, отказ при ambiguous/missing. |
| `POST /api/wb/ai/fix-locale-txt` | Сломанный TXT → починить (парные `{{}}`, балансировать `@@`, выровнять блоки с reference). |
| `POST /api/wb/ai/translate-locale-txt` | Исходный TXT + target-язык → переведённый TXT (сохраняет `%%`/`${{ }}$`/`@@`/inline-теги/URL). |
| `POST /api/wb/auto-translate-locale` (legacy) | Перевод JSON-локалей в `email-base/vendor/data/`. |

UI:
- Кнопки `✱ 🌐 🩹` рядом с табами локалей.
- Пресеты-чипы под полем чата (тот же набор операций).
- **Чат-диспетчер**: интенты «расставь плейсхолдеры» / «переведи во все локали»
  / «почини локаль» детектируются в `resolveChatResponse` и идут в наши AI-tools
  напрямую, **минуя** сломанный draft-orchestrator.
- После AI-апдейта: `cm.replaceRange(...)` (не `setValue`) → подсветка/overlay
  не теряются, `cm.refresh()` форсируется.

### Drag-and-drop конструктор
- Шелф `Блоки`: 10 захардкоженных универсальных блоков + секция «Из базы»
  (15 items из `data/block-catalog.json` + Pug-снипеты).
- Drag в любую точку preview/code: подсветка точки вставки + ghost-outline
  целевого блока.
- Insertion работает не только по `table.row`, но и по любым top-level `<table>`.

### Build pipeline (`email-base/tools/build-mail.js`)
- Stylus → CSS, split на head (`@media`/`@font-face`) и inline.
- Pug render → инжект headCss → CSS-inline → localize → опционально RTL.
- Trim неиспользуемых класс/id-only правил.
- Per-locale output: `dist/<brand>/mail-<id>/<locale>/index.html`.

---

## Что СЛОМАНО или работает плохо

1. **Старый chat draft-orchestrator** (`resolveDraftResponse`) часто возвращает
   усечённый HTML. Студия его правильно блокирует («AI вернул пустой `<body>`»),
   но это сбивает с толку. Решение: всё больше операций гнать через intent-
   диспетчер, а draft-orchestrator оставить только для «собери новое письмо
   с нуля». Или вообще выпилить.

2. **Snippet-extractor** для каталога берёт первый source-файл целиком, поэтому
   разные catalog-items могут получить одинаковый snippet (`header.jade`).
   Нужна нарезка по `evidence`/`order` из `src/catalog.js`.

3. **Validation не блокирует apply**: AI-translate сейчас фоллбэк'ает
   пропущенные блоки на source-текст и помечает `skipped`, но в UI это
   никак не подсвечивается.

4. **Drag-and-drop в письмах без `table.row`**: fallback по соотношению Y
   неточный.

5. **Stylus mode**: `EXT_MODE.styl` мапится на `css` (нет stylus.js mode).
   Indentation-based syntax не подсвечивается корректно. Низкий приоритет.

6. **Чат не «оператор студии» полностью**: умеет 4 операции (placeholderize /
   translate / fix / discuss). Не умеет: открыть письмо из базы, сохранить как
   новое, вставить блок из каталога в нужное место, переключить локаль, экспорт.

---

## Roadmap (предлагаемый)

### Итерация 1 — «чат как оператор студии» (1 день)
- Расширить intent dispatcher:
  - «открой `mail-asap` бренда X_System» → вернуть `aiToolResult.openMail`,
    frontend вызывает `loadMailFromBase`.
  - «сохрани как `mail-erase-received-v2`» → POST `/api/wb/email-clone` +
    `email-rename`.
  - «вставь CTA-блок после Dear Client» → `aiToolResult.insertBlock`,
    frontend вызывает `insertEmailBlock` с найденной позицией.
  - «переключись на ar» → `aiToolResult.activateLocale`.
- Каждый новый intent + обработчик во фронте + обновление `applyAiToolResult`.

### Итерация 2 — улучшить нарезку базы и AI-сборку писем (1-2 дня)
- В `src/catalog.js` использовать `evidence` для точной нарезки секций
  внутри каждого source-файла → каждый item получает чистый Pug-фрагмент.
- Добавить embeddings для блоков (OpenAI text-embedding-3-small) →
  `data/block-embeddings.json`.
- Новый endpoint `POST /api/wb/ai/compose-email`: на вход `brief`/требования,
  на выход — список блоков из каталога + порядок + базовая склейка.
- Чат-команда «собери письмо: hero, 2 параграфа, CTA, footer».

### Итерация 3 — лучше валидация и UX-сигналы (1 день)
- В `placeholderizeHtml`: возвращать pre/post diff, рендерить в чат-сообщении
  как «применено 14 / пропущено 2 (block_07: «Effects of cancelling…»)» с
  кликом по блокам → подсветка в коде.
- В `translateLocaleTxt`: помечать skipped блоки красной рамкой в превью.
- В `fixLocaleTxt`: показать diff before/after.

### Итерация 4 — block library в шелфе (1 день)
- Лучше snippets (см. #2) → каждый catalog item с превью миниатюры.
- Категории в шелфе: header / hero / cta / list / footer.
- Поиск по тексту/тегам.
- Drag прямо в превью с snap к существующим `table.row`.

### Итерация 5 — экспорт и production-hooks (1 день)
- Кнопка «Export to email-base» которая правильно сохраняет
  HTML/Pug/Stylus + JSON-локали.
- Кнопка «Build all locales» которая зовёт `build-mail.js` для текущего
  письма по всем 19 локалям.
- ZIP-экспорт `dist/<mail>/<all-locales>/`.

### Итерация 6 — drag-and-drop из произвольных кусков HTML (опционально)
- Принимать paste HTML → анализировать → предлагать как новый block candidate.
- AI: «вытащи кусок ____ из этого письма как новый блок» → добавить в каталог.

---

## Следующий конкретный шаг

**Итерация 1** — расширить intent dispatcher до 6-8 операций. После неё чат
действительно станет оператором студии: можно будет говорить ему всё, что
сейчас делается мышкой, и он сделает.

---

_Последнее обновление: см. `docs/DEVELOPMENT-JOURNAL.md` для пошагового лога._

---

## Правильная модель работы (UX-контракт)

После нескольких итераций накопилось понимание, что студия работает в **трёх режимах**, и каждый должен быть чётко разделён, а не конкурировать в одном месте экрана.

### Режим 1 — «Локализатор» (default)
Левая панель: HTML/Pug код только для **просмотра** (отключаем drag-drop инструменты).
Правая панель: превью с подстановкой текущей локали.
Шапка: вкладки локалей `Original / EN / RU / AR / UR / …`.
Что можно делать:
- Загружать TXT-локали (drop в чат или папка через `Локали ▾`).
- Прыгать по локалям → preview обновляется + код в редакторе тоже (на конкретной локали — read-only с подставленным текстом, на Original — редактируемый исходник с плейсхолдерами).
- Просить AI расставить плейсхолдеры / перевести / починить локаль (через чат или пресет-чипы).
**Переключатели режима** в правом верху: `📝 Локализатор / 🧰 Конструктор / ✏️ Inline-edit`.

### Режим 2 — «Конструктор» (drag-drop)
Активируется тогглом «🧰 Конструктор». Только тогда:
- Открывается левая боковая панель «Блоки» (захардкоженные + из базы).
- В preview подсвечиваются «слоты вставки» (между `table.row`, внутри `<center>`).
- Перетаскивание блока показывает синюю линию-индикатор + ghost блока-кандидата.
- Drop вставляет блок **рядом** с целевым `table.row`, никогда не overwriting весь файл.
- Code editor становится read-only (показывает результат), чтобы случайно не перепутать с конструктором.
В выключенном режиме «Конструктор» drag-drop полностью отключен — никаких случайных drop в редактор кода.

### Режим 3 — «Inline-edit» (правка контента)
Активируется тогглом «✏️ Inline-edit». Только тогда:
- В preview каждый текстовый блок получает обводку при наведении.
- Click открывает Inspector в правом drawer (не floating panel) с полями: text, color, font-size, padding, bg, border-radius, для image — src/alt.
- Apply правит **только outerHTML конкретного блока** в исходном HTML, через надёжный anchor по data-retkit-id (добавляется при render preview, удаляется при export).
- В выключенном режиме обычный click в preview просто подсвечивает блок в коде.

### Чат — поверх всего
- Виден всегда внизу правой панели.
- Понимает свободный ввод через intent-классификатор (regex + AI fallback), не только пресеты.
- Отвечает короткими summary'ями.
- Применяет результаты прямо в state (HTML editor + locale TXTs).

### Что не должно случаться
- ❌ Drop блока в редактор кода **не должен** перезаписать файл целиком (фикс через `application/x-retkit-block` mime + safety guard в `insertEmailBlock`).
- ❌ Hover-pencil **не должен** мешать обычному кликnю по блоку (заменён на Cmd+click для inspector).
- ❌ Ширина письма **не должна** меняться при переключении на RTL-локали (фиксировано: `text-align`-only, никаких padding/margin swap).
- ❌ AI **не должен** «удалять `<body>`» — все его правки идут через json_schema endpoints, не через draft-orchestrator.

### Что доделать чтобы это стало реальностью
1. **Тоггл-переключатель режимов** в верхнем баре. Пока режимы смешаны.
2. **Cmd+click для inspector** (только что добавил, заменил hover-pencil).
3. **Inspector в правом drawer**, а не floating panel.
4. **AI-классификатор намерения**: если regex-dispatcher не нашёл, делаем 1 вызов к дешёвой модели «classify intent: …» → возвращает один из {placeholderize, translate, fix, edit_html, none}.
5. **Auto-audit локалей** после placeholderize: пройтись AI по каждой локали, подсветить блоки которые «съехали» / содержат литералы вместо переводов.


---

## Roadmap v3 — конкретные крупные фичи (по запросу пользователя)

### A. Pencil-редактор по клику в превью
**Цель:** в правом окне при клике на ✎ у каждого блока появляется панель с
полями `text / colors / paddings / margins / border-radius / bg-image / link`.
Каждое изменение сразу видно в превью И в коде.

Шаги:
1. На render preview каждый «редактируемый» элемент (`p/h*/td с текстом/img`)
   получает `data-retkit-id="r{auto-counter}"`. На стороне студии — Map от id
   к диапазону в cm-источнике (line/ch start..end).
2. Hover в iframe → подсветка outline + ✎ badge в углу.
3. Click ✎ → postMessage `{type: 'inspect', id, tag, attrs, computed-style}`.
4. Студия открывает правый Inspector drawer (не floating panel).
5. Inspector: text, color, font-size, padding (с +/- степперами), bg-color,
   border-radius, для img — src/alt/width/bg-color, для a — href.
6. На каждое изменение поля → DOM-mutation в iframe (instant feedback) +
   через id находим anchor в cm и пишем style/attribute через replaceRange.
7. ESC / × — закрыть. История: Cmd+Z откатывает.

### B. Drag-and-drop outer/inner блоков
**Цель:** выкатить библиотеку блоков, отделить «обёрточные» (outer:
`table.row.brad-full`, разделители, hero-секции с фоном) от «контентных»
(inner: `p`, `table.w280` кнопки, `ul/li` списки, картинки), и научить
вставку различать слоты.

Шаги:
1. Новая структура `data/block-library.json`:
   ```json
   {
     "outer": [
       {"id":"row-white", "label":"Row (white bg)", "pug":"table.row.white-bg\n  tr\n    td.wrapper.last.offset-by-one\n      table.ten.columns\n        tr\n          td.text-pad-small.pb44.pt44\n            // SLOT", "slots":["//SLOT"]},
       {"id":"row-bg-image", "label":"Hero with bg image", "pug":"...", "slots":["//SLOT"]},
       {"id":"divider-h20", "label":"Spacer 20px", "pug":".h-20 &nbsp;", "slots":[]}
     ],
     "inner": [
       {"id":"p-text", "label":"Параграф текста", "pug":"p.text ${{ ns.block_NN }}$"},
       {"id":"button", "label":"Кнопка CTA", "pug":"table.w280(align=\"left\")\n  tr\n    td.butt.butt-grad\n      a.butt-link(href=\"#\" target=\"_blank\") ${{ ns.block_NN }}$"},
       {"id":"image", "label":"Картинка", "pug":"img.center(src=\"#\")"},
       {"id":"list-ul", "label":"Список", "pug":"ul\n  li.text ${{ ns.block_NN }}$"}
     ]
   }
   ```
2. Шелф разбит на две вкладки: «Внешние блоки» / «Контентные».
3. **Drag outer на превью:** подсветка точки вставки **между** существующими
   `table.row` (синяя линия). Drop вставляет в код в правильное место по
   indent'у Pug.
4. **Drag inner на превью:** подсветка SLOT-зон **внутри** `td.text-pad-small`
   (зелёная dashed-обводка). Drop вставляет в код в нужный indent внутри
   найденного `td`.
5. Перетаскивание уже размещённых блоков (drag-handle сверху каждого блока в
   превью — для перемещения вверх/вниз).
6. Удаление блока — иконка крестик при hover.
7. Работает и в HTML-режиме (вставка готового HTML), и в Pug-режиме (вставка
   `.jade`-фрагмента, с auto-rebuild через Pug).

### C. AI-conversational аудит локалей
**Цель:** AI просматривает все локали (EN reference + остальные), находит:
- блоки которые отсутствуют (пустой `{{}}` в одной, текст в другой),
- блоки где число `@@` непарное,
- блоки где в EN есть `<b>`, а в локали нет,
- блоки где перевод подозрительно короткий/длинный относительно EN.
Возвращает в чат **отчёт с предложениями правок**, и пользователь может
**подтвердить каждую** (или отклонить, или дать комментарий).

### D. Чат как полный оператор студии
- Открыть письмо из базы: «открой mail-asap бренда X_System».
- Сохранить как новое: «сохрани как mail-erase-received-v2».
- Вставить блок в нужное место: «вставь CTA-блок после Dear Client».
- Переключить локаль: «покажи AR».
- Экспортировать.
Каждая команда — новый intent в `tryAiToolsDispatch` + новый case в
frontend `applyAiToolResult`.

### E. Indicator незакрытых тегов в HTML
Lightweight HTML lint бар внизу редактора:
- стек открытых тегов сравнивается с закрытыми,
- при дисбалансе — красная плашка «незакрытый `<table>` на строке 124».

### F. Артефакты при перематывании в локали-редакторе
Это CodeMirror reflow-баг. Виноват скорее всего overlay-mode + scroll.
Лечится `cm.refresh()` после scroll-end, или замена на CM6.

### G. Удалить email из вкладки → закрыть таб
Текущий поведение: остаётся пустая таба «pasted.html». Должна закрываться,
плюс state.activeLocale → 'original' (это уже есть).

### H. Heroku redeploy
После итерации B-D — push новой версии в Heroku, заменить старую.

---

## КОНТРАКТ AI: что куда пишет (важно!)

Эти три операции **никогда не должны путаться**. Каждая имеет свой целевой объект:

| Операция | Что читает | Что меняет | Что НЕ трогает |
|---|---|---|---|
| **`placeholderize`** | • HTML/Pug код письма<br>• EN-локаль TXT (как reference) | **Код письма** (HTML или Pug):<br>заменяет видимый текст на `${{ ns.block_NN }}$` | **Никогда** не пишет в TXT-локали |
| **`translate-locale`** | • TXT исходной локали (EN)<br>• Целевой язык | **TXT целевой локали**:<br>каждый `{{...}}` блок переведён на target-язык,<br>`@@bold@@`/HTML-теги/URL/`%%vars%%` сохранены | **Никогда** не пишет в код письма |
| **`fix-locale`** | • TXT кривой локали<br>• Опц. EN-локаль как reference | **TXT той же локали**:<br>парные `{{}}`, балансировка `@@`, выравнивание<br>числа блоков с reference | **Никогда** не вставляет `${{...}}$` внутрь TXT-блоков |

### Жёсткий guard от перепутывания (реализовано)

- **regex-диспетчер**: если в сообщении есть «плейсхолдер/placeholder/`${{`» — ВСЕГДА `placeholderize`. Никакие другие интенты не рассматриваются.
- **AI-классификатор-fallback**: системный prompt усилен явным правилом «mentions of placeholders → ALWAYS placeholderize».
- **Backend guard** в `translateLocaleTxt`/`fixLocaleTxt`: если AI вернул блок с литеральным `${{...}}$` внутри — отказ, локаль не перезаписывается.
- **Frontend guard** в `applyAiToolResult`: даже если backend пропустит — фронт проверяет каждый `localeUpdates[].txt` и отказывается писать испорченное содержимое.

### Что AI делает «по умолчанию» при разных формулировках

| Юзер пишет | AI выполняет |
|---|---|
| «расставь плейсхолдеры», «put placeholders», «размечай блоки» | `placeholderizeHtml` (правит HTML/Pug код) |
| «переведи в UR», «переведи в эту локаль» | `translateLocaleTxt` для активной локали |
| «переведи во все локали» | `translateLocaleTxt` для каждой загруженной локали |
| «почини локаль», «проверь скобки» | `fixLocaleTxt` для активной локали |
| Свободный текст без триггеров | `classifyAiIntent` (AI выбирает один из 5 интентов) |

---

## КОНТРАКТ компиляции Pug+Stylus → HTML

Студия должна работать как **VS Code Live Preview** для writeLine flow `email-base`:

1. **Открытие письма из базы** (`X_IQ/mail-rfm-311`):
   - Студия читает `app/templates/header.pug` (или `index.jade`) + `app/styles/main.styl` (или `common.styl`)
   - В выпадашке файлов сверху редактора — **все исходники** + `index.html (compiled)` в самом верху как read-only
   - Активный по умолчанию: `index.html (compiled)` в **read-only** режиме → правое окно показывает **renderedHTML**

2. **При открытии исходника** (`header.pug`):
   - Левый редактор → редактируемый Pug
   - Правое окно → продолжает показывать **последний скомпилированный HTML** (не raw Pug!)
   - При сохранении (Cmd+S) → автоматический re-build через `/api/wb/build-email`
   - При успехе → правое окно перерендеривается с новым HTML

3. **Не должно быть параллельных «подвкладок»**: одна вкладка = один файл. Split-view — отдельная фича (Cmd+\ или кнопка), но НЕ автоматическое поведение.

4. **При клонировании письма** (`mail-rfm-311 → mail-rfm-311-copy`):
   - Сервер копирует папку через `/api/wb/email-clone`
   - Студия открывает клон **точно так же** как оригинал: src files + compiled HTML preview
   - Никаких дубликатов вкладок, никаких новых открытых файлов

5. **Build pipeline на бэкенде** (уже работает):
   - `POST /api/wb/build-email { brand, mail }` → spawn `node tools/build-mail.js --category X --mail Y`
   - Pipeline: Stylus → CSS split (head/inline) → Pug render → CSS-inline → localize → опц. RTL
   - `GET /api/wb/email?brand=&mail=` → отдаёт `dist/<brand>/mail-<mail>/index.html`

**Что сейчас сломано (наблюдение по скриншотам пользователя):**
- При открытии письма из базы открываются 2 подвкладки (`header.pug` и `main.styl`), и правое окно показывает CSS-код вместо скомпилированного HTML.
- Это означает что `rebuildSourceEmail` не вызывается автоматически при `openSourceContext`, ИЛИ что preview-iframe рисует `cm.getValue()` напрямую вместо `ctx.compiledHtml`.

**Шаги починки (next iteration):**
- В `openSourceContext` или `loadMailFromBase`: гарантировать вызов `rebuildSourceEmail()` после загрузки.
- В `updatePreview()`: если `ctx.compiledHtml` присутствует и активный файл это Pug/Stylus — показывать `ctx.compiledHtml`, а не `cm.getValue()`.
- Tab UI: одна вкладка = один файл, не более. Никаких автоматических split.

---

## Полноэкранный конструктор для не-программистов

Полная Roadmap-секция (см. ниже B):

- Кнопка **«⛶ Конструктор»** в верхнем баре переключает в полноэкранный режим:
  - Скрывает левую панель с кодом полностью
  - Показывает preview на весь экран
  - Слева — выезжающий шелф «Блоки» (outer + inner)
  - Правый sidebar — Inspector (открывается при клике на блок в preview)
- В этом режиме обычный пользователь:
  - **Drag** блок из шелфа в preview → подсветка слотов → drop → блок появляется в письме
  - **Click** на любой блок → правый Inspector с полями: текст, цвета, паддинги, картинки, ссылки
  - **Hover** на блок → крестик удаления + handle для drag-перемещения
  - Без необходимости видеть HTML/Pug код вообще
- AI-кнопка в Inspector: «Подсказать стиль на основе остальных блоков письма», «Перевести этот блок на все локали», и т.п.

---

## Roadmap v4 — AI с визуалом, paste-flows, многомодельный анализ

Эти запросы пользователя поверх v3:

### I. AI видит и код, и визуал (vision mode)
Сейчас `placeholderizeHtml` получает только HTML-текст и reference TXT. Для сложных писем с непривычной вёрсткой этого мало — AI может не сопоставить «текст на картинке» с блоком из локали.

Шаги:
1. Frontend: после render preview в iframe, через `html2canvas` или native `Element.captureStream` сделать screenshot → base64 PNG.
2. Frontend: при запросе placeholderize отправить `screenshot` дополнительно в payload.
3. Backend `placeholderizeHtml`: использовать OpenAI Responses API `input_image` (vision), передать оба контекста: HTML source + screenshot + reference TXT.
4. System prompt усиливается: «You have BOTH the source code AND a rendered visual screenshot. Use the visual to confirm which text in the reference TXT maps to which visible element in the HTML.»

Это серьёзно повысит accuracy для писем, где текст разрезан тегами, обёрнут в `<strong>`, или содержит дочерние элементы.

### J. Paste-flow для Pug/HTML из других баз
**Сейчас (исправлено в этой итерации):** VS Code syntax-highlighting `<span>`-markup при paste в Pug-редактор автоматически детектится и strip'ается до plain text.

**Что ещё в paste-flow:**
1. Paste plain Pug в `header.pug` → save → auto-rebuild через `build-mail.js` → правое окно показывает скомпилированный HTML.
2. Paste plain HTML в pasted-tab → отображается как есть в preview.
3. Paste HTML с embedded `<style>` → CSS-extract + сохранение как `head-extra.styl` (опционально).

### K. Многомодельный анализ для drag-and-drop
Когда юзер перетаскивает блок из «Из базы» в письмо:
- Определить, какой brand сейчас открыт и подменить логотип/токены под него.
- Спросить AI: «адаптируй цвета этого блока под палитру письма» (через `assets/styles/variables.styl`).
- Если в письме уже есть похожий блок — предложить заменить, а не добавить.

### L. Сложная локализация: AI видит ВСЕ локали разом
- При запросе «переведи во все локали» AI получает не только source TXT, но и **все существующие переводы как примеры** (для согласованности термина «account», bold-маркеров, etc.).
- AI учитывается tone-of-voice уже накопленный в других локалях.

---

## Краткие ответы пользователя на вопросы (записаны для memory)

**Q: «Сборка/корректировка письма именно в Pug и Stylus возможна?»**
Да. `build-mail.js` запускается через `/api/wb/build-email` → spawn `node tools/build-mail.js --category X --mail Y`. Pipeline: Stylus → CSS split → Pug render → CSS-inline → localize → опц. RTL. Compiled HTML отображается в правом preview.

**Q: «Могу скопировать Pug из другой базы?»**
Да. Если копируешь plain Pug — вставляй как есть. Если копируешь подсвеченный код из VS Code — paste-handler автоматически strip'ит syntax-spans (только что добавлено).

**Q: «Drag-and-drop умеет вставлять HTML / Pug?»**
Да, в зависимости от расширения активного файла. Каждый блок в шелфе имеет два варианта: `block.html` для HTML-режима, `block.pug` для Pug-режима. Selection логика выбирает правильный по `state.editorType`.

**Q: «В правом окне визуал?»**
Для Pug-источника — после `rebuildSourceEmail` правое окно показывает скомпилированный HTML. Для HTML-режима — текущий HTML из cm.
