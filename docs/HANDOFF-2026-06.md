# HANDOFF — Retention Future Email Studio

**Last updated:** 2026-06-11
**Cовместимо с:** node 22, Stylus + Pug toolchain (sacred — не трогать)

---

## 🆕 Сессия 2026-06-10 — Конструктор, локализация, Figma-интеграция

Крупный апдейт. Всё ниже протестировано в Node (регрессия зелёная, см. Часть 4),
КРОМЕ браузерных / AI / Figma частей — они помечены ⚠️ «нужна проверка у пользователя».

### Видение продукта (зафиксировано с пользователем)
Редактор писем с 3 слоями глубины на одном фундаменте (канонические блоки, всегда
Outlook-safe): (1) верстальщику — code-first workbench; (2) тому, кто «немного шарит» —
DnD-конструктор с правкой текста/цветов/радиусов; (3) новичку — AI собирает из блоков.
Главный принцип: **единый источник истины = код блока**. Любая визуальная правка =
правка слотов = подстановка в Pug/Stylus = пересборка. Без расхождения «визуал ≠ код».

### Конструктор (`/constructor`) — визуальный DnD
- **Живой preview**: 4-я колонка — iframe с письмом, debounce 650мс на любую правку
  (add/remove/reorder/слоты). Device toggle desktop/mobile, fullscreen. Переиспользует
  `/api/compose-preview`. Файлы: `public/constructor.{html,css,js}`.
- **Drop прямо в письмо + клик-выбор**: `compose-email.js` получил опцию `markBlocks` →
  инжектит `<!-- rk:block-start:N:id -->` маркеры ТОЛЬКО в preview-путь (save-путь чист).
  Фронт рисует линию вставки реальным DOM-узлом ВНУТРИ iframe (без пиксельной математики),
  клик по блоку выделяет карточку. ⚠️ Drag/select внутри iframe НЕ проверены в браузере.

### Стиль-слоты блоков (точечная настройка)
- Все 5 ключевых блоков (`button-primary`, `cta-banner`, `hero-stack`, `text-block`,
  `header-logo`) получили редактируемые `color`/`number` слоты: фон, цвета текста/кнопки,
  радиусы, ширина лого. Подставляются в Stylus через `{{ }}`. Инспектор конструктора их
  уже рисует (палитра + hex, number). Правка → live preview → Save пишет в код.
  ⚠️ Минификатор укорачивает hex (`#ff7700`→`#f70` — это норма, не баг).

### Локализация (zero-AI слой, протестирован)
- `placeholder-inference.js`: 3 фикса — уникальные имена токенов (нет коллизий
  `amount`/`amount_2`), отсев generic-имён («Dear Customer» ≠ `user_name`), replace-all
  всех вхождений.
- `locale-analyze.js`: глобальный best-first матчинг якорей вместо жадного по порядку блоков.
- ⚠️ AI-функции (`placeholderizeHtml`/`fixLocaleTxt`/`translateLocaleTxt`) НЕ менялись.
  Из sandbox сеть до OpenAI закрыта (`fetch failed`) — прогонять ТОЛЬКО в приложении с токеном.

### Figma → письмо (last mile + плагин для ЗАКРЫТОЙ Figma)
- **`src/design-compose.js`** (НОВЫЙ): `schema → compose-план [{id,slots}]`. Маппит роли
  секций → канонические section-блоки, заполняет контентные слоты из текста/картинок
  дизайна (по `sectionId`), переносит стиль-токены в стиль-слоты. `styleSlotGap` закрывается
  когда блок впитал стили.
- Подключён в `/api/figma/import` → ответ теперь содержит `composePlan` (проверено живым HTTP).
- **`figma-plugin/`** (НОВЫЙ): плагин работает ИЗНУТРИ закрытой Figma (без REST-токена).
  `manifest.json` + `code.js` (обход фрейма → контракт `figma-contract.js`) + `ui.html`
  (Copy/Send). Установка — `figma-plugin/README.md`. Студия уже имеет приёмник
  (`figmaPayloadInput` в `public/index.html`). ⚠️ Эвристики плагина (роли секций, что
  считать кнопкой) калибровать на реальных макетах; плагин в Figma отсюда не запускался.

### 🆕 Дополнение той же сессии — Locale CRUD для AI + авторинг блоков

**AI-агент теперь умеет полный CRUD локалей** (всё hermetic-протестировано):
- `create_locale` — новая локаль: AI-перевод с reference (translate=true, default) или
  копия-заглушка (translate=false, работает без токена). Отказ если локаль уже есть.
- `delete_locale` — ставит удаление в очередь (`ctx.pendingLocaleDeletes`); reference
  локаль — только с force=true. Реальное удаление — ТОЛЬКО после клика+confirm юзера в UI.
- `edit_locale_block` — точечная правка одного блока одной локали (zero-AI). Несколько
  правок одной локали схлопываются в один update. Guard на `${{ }}$` внутри текста.
- Плюмбинг: `localeDeletes` идёт через ai-agent.js → server `/api/wb/ai/agent` final →
  workbench рисует кнопку «🗑 Удалить локаль ns/code» с confirm.
- **Фикс бага**: кнопка «↩ Применить локаль» в agent-timeline передавала СТРОКУ namespace
  в `setLocaleRawContent` (ждёт объект) — падало молча. Теперь резолвит/создаёт ns.

**UX локалей в workbench**:
- ✕ на каждой вкладке локали (hover) — удаление с confirm из всех namespace.
- Модал «Добавить локаль»: чекбокс «🌐 Сразу перевести через AI из [select]» — создание
  локали сразу с переводом (через `/api/wb/ai/translate-locale-txt`). ⚠️ Нужен OpenAI токен.

**Конструктор — авторинг блока с нуля** (`/constructor`):
- Кнопка «➕ Создать блок» над каталогом → модал: id/label/placement/категория/описание,
  Pug + Stylus textarea, слоты автоопределяются из `{{ token }}` (kind угадывается по
  имени: *color*→color, *url*→url, *img*→image, *width/radius*→number), живое превью
  через РЕАЛЬНЫЙ build (ad-hoc `def`-блоки в `composeEmailFromBlocks` — entry.def
  {pug,styl,slots} вместо чтения из библиотеки). Save → `data/block-library/user/`.
- ✎ на user-блоках каталога — редактирование существующего блока в том же модале.
- ⚠️ Браузерная часть (модал, live preview, edit) НЕ проверена в браузере — нужен прогон.

**🔥 Багфикс 2026-06-11 — «письмо превратилось в один плейсхолдер»:**
Юзер попросил в чате «расставь плейсхолдеры» → письмо уничтожено (95 строк → 22,
весь body = один `${{ ns.block_02 }}$`). Виновник — НЕ AI: клиентский zero-AI шорткат
`maybeApplyPlaceholdersFromLocales` → `replaceVisibleTextWithPlaceholders` (workbench.js).
Две дыры: (1) «лист» определялся по ПРЯМЫМ детям, а `<center>` не был в списке
контейнеров → `td.center > center > table…` прошёл как лист, его textContent = всё
письмо; (2) containment-правило `entry.norm.includes(norm) || norm.includes(entry.norm)`
без ограничения размера → «элемент содержит текст блока» = матч → `el.innerHTML =
плейсхолдер` снёс всё. Фикс: контейнеры ищутся `el.querySelector()` на любой глубине
(+`center` в списке), containment-матч только при ratio 0.6–1.67, потолок 1200 симв.
Регрессия: `node scripts/test-placeholder-dom-swap.mjs` (vm-sandbox + linkedom,
воспроизводит точную структуру убитого письма; linkedom добавлен в devDependencies).

**Новые тесты (все зелёные, плюс вся старая регрессия):**
```bash
node scripts/test-locale-crud-tools.mjs    # 35 ассертов: handlers + agent loop plumbing
node scripts/test-block-author.mjs         # ad-hoc def compose + реальный build
node scripts/test-placeholder-dom-swap.mjs # NEW 2026-06-11 — фикс «огрызка» (см. выше)
```

**🆕 2026-06-11 — агент как «ретеншн-команда» (план→действие→верификация):**
- Новые инструменты `find_in_html` + `replace_in_html` — хирургическая правка HTML
  (bold фразы, замена лого/ссылки). Guard'ы: search должен быть уникален (иначе ошибка
  с количеством — модель уточняет контекст), запрет правок-перезаписей (усадка >40% →
  отказ), staged через ctx.modifiedHtml → применяется кнопкой после finish.
- `read_open_html` теперь видит pending-правки (ctx.modifiedHtml) — агент читает
  собственные изменения.
- Системный промпт переписан: роль «команда-в-коробке» для 3 уровней юзеров, принципы
  DISCOVER→PLAN→ACT (минимальный точный инструмент)→VERIFY (обязательная проверка после
  каждой мутации: re-read блоков / analyze / find_in_html). maxSteps 8→12.
- `scripts/demo-ai-team.mjs` — демо+регрессия: 3 сценария на реальных handlers
  (правка блока RU + новая локаль + верификация; bold+лого+верификация; самокоррекция
  после ошибки инструмента). Все зелёные. `--quiet` для CI-режима.

**🆕 2026-06-11 (2) — доменные конвенции локалей (см. docs/PROJECT-RULES.md):**
Кейс юзера: `{{текст {{embedded.company_email}}.}}` ломал ленивый парсер → AI «чинил»
неправильно → плейсхолдеры вставали криво. Зафиксированы конвенции (подтверждены юзером):
переменные платформы (идентификатор с ./_, без $) не живут внутри блоков — блок
разбивается `{{текст}} {{var}}{{хвост}}`; в HTML переменная литералом; Subject-строка
вне блоков — норма; @@ зеркалит жирность вёрстки.
- `src/locale-conventions.js` — НОВЫЙ: nesting-aware токенизатор, `normalizeLocaleConventions`
  (детерминированная починка, идемпотентна, воспроизводит эталон юзера 1:1),
  `buildAnchorUnits` (текст+вар+хвост одного абзаца = один анкер-юнит).
- `placeholderizeHtml` анкерит по юнитам: замена = `${{ ns.block_NN }}$ {{var}}${{ ns.block_MM }}$`.
  Анти-swallow лимит стал относительным к длине эталона (был «25% документа» — резал
  длинные абзацы коротких писем).
- Агент: инструмент `normalize_locale_conventions` (zero-AI, 'all' = весь namespace);
  промпт требует звать его ДО placeholderize/fix. Клиент шлёт агенту `localeRaw`
  (сырой TXT — разобранные блоки уже испорчены ленивым парсером).
- Workbench: «Авточинить» сначала чинит конвенции через POST `/api/wb/locale-normalize`,
  потом структуру; валидатор: вложенная переменная = ошибка `nested_variable` с подсказкой,
  Subject вне блоков больше не warning; zero-AI placeholderize пропускает блоки-переменные.
- Тесты: `test-locale-conventions.mjs` (фикстур юзера побайтно), `test-placeholderize-units.mjs`
  (mock AI, реальная подстановка), normalize-кейсы в `test-locale-crud-tools.mjs`. Все зелёные.

**🔥 Багфикс 2026-06-11 (3) — «Не вижу загруженных локалей» при загруженных локалях:**
`/api/chat/stream` прогоняет тело через `normalizePayload` (whitelist!), который
ВЫБРАСЫВАЛ `namespaces`/`activeNamespaceName`/`activeLocale` — клиент честно слал,
диспетчер получал пусто. Маскировалось тем, что обычно запрос перехватывал клиентский
zero-AI шорткат; юзерское «пл**э**йсхолдеры» (через Э) его регекс не матчил → запрос
дошёл до сервера → бац. Фикс: normalizePayload пробрасывает эти поля; «плэйс» добавлен
в клиентские регексы интентов. Проверено живым HTTP: диспетчер доходит до
`placeholderize-dom-<ns>` (в sandbox падает только на fetch к OpenAI — ожидаемо).
Урок: whitelist-нормализаторы — проверяй при добавлении новых полей payload'а.

**🆕 2026-06-11 (4) — чат-шорткат «расставь плейсхолдеры» стал полным zero-AI конвейером:**
Симптом юзера: плейсхолдеры ставились по новой 13-блочной нумерации EN, а остальные
локали оставались 9-блочными → `${{ ns.block_09 }}$` торчали сырыми в AR. Теперь
`maybeApplyPlaceholdersFromLocales` (async): (1) ВСЕ локали namespace прогоняются через
`/api/wb/locale-normalize` — нумерация выравнивается; (2) endpoint при `namespace` в теле
возвращает `units` (buildAnchorUnits на сервере — единый источник истины); (3) новый
клиентский pure-матчер `replaceUnitsWithPlaceholders` ставит юниты по DOM: составной
абзац → `${{ block_NN }}$ {{var}}${{ block_MM }}$`. Fallback на старый матчер, если
сервер не отдал юниты. Отчёт в чате: сколько локалей починено + сколько юнитов
расставлено + сколько не нашлось. Тест: unit-секция в `test-placeholder-dom-swap.mjs`;
endpoint проверен живым HTTP.

**🆕 2026-06-11 (5) — выравнивание локалей по эталону + сохранение ссылок + вкладки:**
- **Выравнивание**: `alignLocaleToReference` (locale-conventions.js) — все локали
  приводятся к структуре reference (EN): одинаковое число блоков, переменные на тех же
  позициях (якоря для сегментации), нехватка текста → пустой блок-спейсер `{{}}`
  (рендерится &nbsp;). Перебор в сегменте → склейка в последний слот (без потери контента).
  Это решает «block_NN в RU ≠ block_NN в EN» — переводы встают на свои места, жёлтые
  обводки уходят. Endpoint `/api/wb/locale-prepare` (normalize всех + align всех + units
  reference) — один вызов. Клиентский конвейер `maybeApplyPlaceholdersFromLocales`
  переписан на него; отчёт «выровнял N локалей, добавил M спейсеров».
- **Багфикс ссылок**: `<a>` добавлен в `containerSelector` обоих матчеров — `<td><a>Terms</a></td>`
  больше не затирается целиком; матчер спускается к `<a>`, меняет текст ВНУТРИ, href цел.
- **Вкладки**: двусторонняя синхронизация — пустой редактор (для обычного HTML, не
  email-base источников) закрывает вкладку (`maybeCloseTabOnEmptyEditor` в change-handler);
  закрытие крестиком уже чистило редактор. footer_upload (builtin 🔒) всегда последним
  в namespaces-баре и исключён из `validateLocales` (не влияет на жёлтые обводки/счётчик).
- **Про жёлтую обводку вкладок локалей** (вопрос юзера): оранжевая рамка = `data-valid="warning"`
  — блоков больше эталона ИЛИ есть warning-проблемы (вложенная переменная, текст вне блоков);
  красная = error (блоков меньше эталона / hard-ошибка); без рамки = всё совпадает с EN.
  После выравнивания обводки должны исчезнуть.
- Тесты: `test-locale-align.mjs` (выравнивание, спейсеры, Subject), link-ассерт в
  `test-placeholder-dom-swap.mjs`, endpoint проверен живым HTTP. Вся регрессия зелёная.

**🔥 Багфикс 2026-06-11 (6) — «всё ломает»: голые переменные + мигание вкладки:**
- **Корень «всё ломает»**: в письме iqoption_payout_cancelled переменные `{{amount}}`,
  `{{currency}}`, `{{reason}}` — БЕЗ точки/подчёркивания. Старый `isSystemVariable`
  (требовал `.`/`_`) их не узнавал → нормализатор оставлял вложенными → при разбивке
  блока с несколькими переменными получался мусор скобок (`{{for a total amount of{
  {{amount}}`, `at}}}}`, `{{{{.}}`), валидатор ругался «незакрытый блок». Фикс:
  `isSystemVariable` теперь ловит и голые слова-плейсхолдеры (нижний регистр, ≥2 симв.,
  без пробелов: amount/currency/reason) — `VAR_BARE_RE`. Текст (Hi, Reason:, фразы,
  запятая) не задевается. Проверено живым HTTP: EN с op_id/amount/currency нормализуется
  в 16 чистых блоков, скобки сбалансированы. Тест `test-locale-vars-bare.mjs`.
- **Мигание вкладки**: при закрытии вкладки с активной локалью редактор очищался, но
  `updatePreview` видел пустоту, «возвращался к Original» и восстанавливал
  `_originalEditorBackup` — старый код мигал и возвращался. Фикс: `closeFile` при закрытии
  активного файла сбрасывает `activeLocale='original'` и `_originalEditorBackup=null` ДО
  очистки (оба пути: последний файл и переключение на другой) + renderLocalesBar.
- PROJECT-RULES уточнить: переменная = `{{embedded.x}}` ИЛИ `{{snake_case}}` ИЛИ
  `{{голоеслово}}` в нижнем регистре. Всё это в HTML литералом, не переводится.

**🆕 2026-06-11 (7) — умное замещение со ссылками ВНУТРИ абзаца:**
Проблема: абзац с инлайн-ссылкой (`{{embedded.company_email}}` обёрнут в `<a mailto>`)
вообще не получал плейсхолдеров — мой прошлый фикс (добавил `<a>` в containerSelector)
сделал такой абзац «не листом», и он пропускался целиком. Фикс:
- `buildAnchorUnits` теперь отдаёт `parts: [{kind:'text'|'var', token, source, sep}]` —
  структуру юнита для точной реконструкции.
- Клиентский `applyUnitToElement(el, unit)`: нет `<a>` внутри → плоско ставим
  replacement (как было; `<b>` схлопывается, @@ восстановит). Есть `<a>` → собираем по
  parts, оборачивая плейсхолдер/литерал в исходный `<a href>`, если ссылка обёртывала
  этот кусок. Ссылка вокруг переменной ИЛИ вокруг текстового блока — сохраняется живой.
- `containerSelector` вернули БЕЗ `<a>` (только блочные) — абзац с инлайн-ссылкой снова
  лист. legacy-матчер тоже сохраняет ссылку вокруг целого блока.
- Тесты в `test-placeholder-dom-swap.mjs`: инлайн-ссылка вокруг переменной (mailto) и
  вокруг текстового блока — обе сохраняются, текст вокруг → плейсхолдеры.
- ВАЖНО для пользователя: чтобы ссылка вокруг КУСКА текста (не переменной) встала
  правильно, этот кусок должен быть отдельным блоком в локали — выдели фразу-ссылку и
  нажми «Разбить выделение» (создаёт блок во всех локалях синхронно).

**🔥 Багфикс 2026-06-11 (8) — слово с точкой в конце ломало матчинг + переменная в href:**
- Симптом: абзац, заканчивающийся словом с точкой (`...anytime.`, `...below.`),
  вообще не получал плейсхолдеров. Причина: `VAR_DOTUS_RE` разрешал хвостовую точку
  без символов после (`[A-Za-z0-9._-]*` допускал пусто) → `anytime.`/`info.`/`below.`
  ошибочно считались ПЕРЕМЕННЫМИ → блок оборачивался как `{{anytime.}}` → visibleText
  юнита не совпадал с текстом абзаца → 0 матчей. Фикс: после каждой `.`/`_` обязан идти
  хотя бы один символ — `/^[A-Za-z][A-Za-z0-9-]*(?:[._][A-Za-z0-9-]+)+$/`.
- Заодно подтверждён случай «переменная в HREF ссылки» (`<a href="mailto:{{embedded.company_email}}">текст</a>`):
  `applyUnitToElement` берёт открывающий тег `<a href>` целиком (с переменной в href),
  оборачивает плейсхолдер видимого текста → `${{ block_00 }}$ <a href="mailto:{{embedded.company_email}}">${{ block_01 }}$</a> ${{ block_02 }}$`.
  Работает без доп. кода — переменная в href сохраняется автоматически.
- Тесты: трейлинг-точка в `test-locale-vars-bare.mjs`, href-переменная в `test-placeholder-dom-swap.mjs`.

---

## 📋 Сводка сессии 2026-06-10/11 (для следующего Claude)

Большой блок работы по локалям/AI/UX. Все изменения покрыты тестами, регрессия зелёная.

**Что добавлено в продукт:**
- AI-агент = «ретеншн-команда»: CRUD локалей (create/delete/edit_locale_block),
  точечная правка HTML (find/replace_in_html), нормализация конвенций, план→действие→
  верификация в промпте. maxSteps 12.
- Конвенции локалей (`src/locale-conventions.js`, zero-AI): переменные платформы
  ({{embedded.x}}, {{snake_case}}, {{голоеслово}}) выносятся из текстовых блоков,
  Subject вне блоков = норма, @@ зеркалит жирность. Нормализатор + анкер-юниты +
  выравнивание локалей по эталону с пустыми спейсерами.
- Конструктор: авторинг блока с нуля (модал pug/styl/слоты + живое превью).
- UX: управление локалями из вкладок (+/✕/перевод), footer_upload всегда последним и
  вне валидации, двусторонняя синхронизация вкладка↔код.

**Новые/ключевые файлы:**
- `src/locale-conventions.js` — конвенции, выравнивание, анкер-юниты (СЕРДЦЕ локалей).
- `docs/PROJECT-RULES.md` — доменные правила (читать перед правками локалей!).
- Endpoints: `/api/wb/locale-normalize`, `/api/wb/locale-prepare` (normalize+align+units).
- `public/workbench.js`: `maybeApplyPlaceholdersFromLocales` (zero-AI конвейер),
  `replaceUnitsWithPlaceholders` + `applyUnitToElement` (умное замещение со ссылками).

**Регрессия (все exit 0, гонять пачками по 3-4):**
```bash
node scripts/test-locale-conventions.mjs      # конвенции, фикстур юзера 1:1
node scripts/test-locale-vars-bare.mjs        # голые переменные + трейлинг-точка
node scripts/test-locale-align.mjs            # выравнивание по эталону, спейсеры
node scripts/test-placeholderize-units.mjs    # placeholderize по юнитам (mock AI)
node scripts/test-placeholder-dom-swap.mjs    # анти-«огрызок» + ссылки (inline/href/text)
node scripts/test-locale-crud-tools.mjs       # CRUD-инструменты агента + normalize
node scripts/demo-ai-team.mjs --quiet         # 3 сценария «команда в работе»
node scripts/test-agent-loop.mjs              # базовый agent loop
node scripts/test-block-author.mjs            # ad-hoc def блок + реальный build
```

**Что НЕ доделано / следующие кандидаты:**
1. Расходящиеся переводы (HI инлайнил `amount`/`currency` словами без `{{ }}`) —
   выравнивание подтянет под EN, но идеально не сматчит. Решение: AI-перевод заново из EN.
2. Агент пока не умеет выравнивать локали одной фразой (только кнопочный путь) —
   можно добавить инструмент `align_locales_to_reference`.
3. Ссылка вокруг куска текста требует ручного «Разбить выделение» (отдельный блок).
4. Из песочницы нет сети до OpenAI → AI-части проверяются только в приложении с токеном.

---

**Чек-лист ручной проверки (нужен пользователь + OpenAI токен):**
1. Workbench → вкладки локалей: hover → ✕ → confirm → локаль удалена.
2. «+ локаль» → код `de`, чекбокс AI-перевода → локаль создана переведённой.
3. Agent-чат: «добавь немецкую локаль» → create_locale → кнопка применить.
4. Agent-чат: «удали локаль ar» → кнопка «🗑 Удалить» → confirm.
5. Agent-чат: «в ru в блоке 2 замени X на Y» → edit_locale_block → применить.
6. /constructor → «➕ Создать блок» → pug с `{{ text }}` → слот появился → превью
   живое → Save → блок в каталоге с 👤 → ✎ открывает его на правку.

### Следующие цели (по убыванию пользы)
1. Кнопка «собрать письмо из импорта» в UI студии — `composePlan` уже в ответе, нет UI.
2. Авторинг нового блока с нуля в конструкторе (сейчас только «сохранить вариант» через
   inspector → «💾 Сохранить как мой блок»).
3. Калибровка эвристик Figma-плагина на реальных файлах.
4. Шрифт как токен в блоки; thumbnail'ы (hover-превью — headless-браузера в sandbox нет).
5. Зона 5 — удобство редактора workbench до уровня VS Code.

---

## Часть 1. Что протестировать СЕЙЧАС (Outline mode)

Это новые куски этой сессии. Старые компоненты регресс-тестятся скриптами (см. Часть 4).

### A. Outline rail в workbench

1. Открой студию → workbench.
2. Открой любое письмо из `email-base/X_AffSystem/mail-ib-affiliate-termination` (на нём отлажено).
3. Кликни во вкладках на `header.pug`.
4. **Ожидание:** в правом верхнем углу editor-toolbar появилась кнопка **📑**. До открытия .pug файла её быть не должно.
5. Нажми **📑**.
6. **Ожидание:** слева от кода появилась узкая колонка "📑 Структура" с 3 блоками (`#1 L1-9`, `#2 L10-39`, `#3 L40-60`).

### B. Навигация

7. Кликни на блок `#2` в outline.
8. **Ожидание:**
   - в CodeMirror скроллит на строку 10 и выделяет строки 10–39
   - в правом preview iframe соответствующая секция прокручивается в центр (best-effort)
   - этот блок в outline подсвечен синим (`.active`)

### C. Вставка в середину

9. Между блоком #2 и #3 наведи на кнопку `＋ вставить блок` (она dim до hover'а).
10. Нажми.
11. **Ожидание:** справа от кнопки появился popover "Вставить блок" с вкладками Canonical / User и списком из 8 канонических блоков.
12. Кликни на `header-logo`.
13. **Ожидание:**
    - popover закрылся
    - в CodeMirror между строкой 39 и 40 появился pug канонического блока
    - через ~800мс autosave сохранил файл и iframe пересобрался
    - через ~350мс outline re-парсится — теперь 4 блока, новый в позиции #3

### D. Вставка в начало

14. Нажми **`＋ В начало`** в footer'е rail'а.
15. Выбери `divider-spacer`.
16. **Ожидание:** блок вставлен перед всеми остальными, теперь outline показывает 5 блоков.

### E. Удаление

17. Наведи на любой блок в outline → справа появится `✕`.
18. Кликни.
19. **Ожидание:** confirm "Удалить блок #N (label)? Строки X–Y будут удалены". OK.
20. Блок удалён из source, outline перерисован, iframe пересобран.

### F. Что НЕ должно появляться

21. **Нижний floating "Блоки" FAB** — снят. Не должен показываться нигде.
22. **`Конструктор блоков` плашка** — снята.
23. **Pencil mode (🖊)** — остался, проверь что всё ещё работает (клик по preview → Inspector popup с цветом/шрифтом/padding).
24. **Bottom-bar (HTML-аудит / Export / Бренды / База / PDF)** — не тронут.

### G. Что НЕ работает в этом MVP (по дизайну)

- Письма без top-level `table.row` (например с `extends ../layout`) показывают пустой outline. Парсер видит 16/20 реальных писем; остальные 4 — для v2.
- При вставке слотовые токены `{{ text }}` остаются raw. Редактируй вручную в CodeMirror. v2 — slot-fill popup сразу после picker.
- Drop-zones поверх iframe — нет, только outline-кнопки.
- Reorder через drag — нет.
- Background-image swap в Inspector'е — нет (отдельная задача).

---

## Часть 2. Что работает в студии сегодня (по доменам)

### RTL рендеринг
**Состояние:** стабильно. Минимальная модель: `dir="rtl"` только на p/h*/li/leaf-div/butt-td. Физический CSS-зеркал делает остальное. Idempotent (strip stale dir в начале pipeline). См. `email-base/tools/rtl.js`.

### AI агент (workbench chat)
**Состояние:** tool-use loop на OpenAI Responses API. 8 tool'ов (list_namespaces, read_open_html, analyze_email, placeholderize_html, fix_locale, compose_email_from_blocks, list_canonical_blocks, finish). NDJSON streaming в UI. Mock-hook `globalThis.__OPENAI_TEST_MOCK` для hermetic-тестов. Журналит решения в `data/studio-journal.jsonl`.

### Block library
**Состояние:** 8 канонических блоков (clean, hand-crafted, все компилируются) + поддержка user-saved blocks. JSON-схема с `placement: section|inline|helper`, slots с типами text/richText/url/image/color/number/select. Endpoint'ы `/api/blocks-library` (GET/save/delete user).

### Constructor (greenfield mail-from-scratch)
**Состояние:** standalone page `/constructor` с drag-and-drop, slot-инспектор, preview-modal, save в `email-base/X_assembled/`. Phase 4: user-saved blocks с 👤 badge и × delete. См. `public/constructor.html|css|js`.

### Outline mode (workbench in-place editing) ← НОВОЕ
**Состояние:** rail + picker для вставки канонических блоков в произвольную позицию существующего письма. Удаление, навигация, авто-reparse на изменения. См. Часть 1 + `docs/OUTLINE-MODE-SPEC.md`.

### Validators / smart analysis
**Состояние:** `analyzeLocaleAgainstHtml` дает coverage/drift report без AI. Two-pass validator для missed refBlocks. `journal-stats.mjs` CLI показывает историю AI-решений.

---

## Часть 3. Pending phases (roadmap)

Записаны в `docs/STUDIO-ROADMAP.md`. В порядке приоритета:

1. **Phase 7 — Figma → blocks pipeline.** Самое зрелищное: загрузил Figma-фрейм → получил email. Требует Figma API + конвертер frame→pug.
2. **Phase 8 — unified patch API + undo.** Все правки (human + AI + outline + constructor) проходят через один endpoint `POST /api/wb/patch` с dryRun, журналят diff, поддерживают Cmd+Z. Дисциплинирующий шаг.
3. **Outline mode v2** — sub-blocks (вглубь `block content`), slot-fill popup при вставке, background-image picker в Inspector'е, drag-reorder.
4. **AI calibration loop** — анализ накопленного `studio-journal.jsonl`, автогенерация few-shot для placeholderize.

---

## Часть 4. Регрессия — что прогнать прежде чем catch up

Все эти скрипты — Node.js, без OpenAI токенов, runnable:

```bash
node scripts/test-blocks.mjs              # canonical compile (все 5 ключевых + legacy)
node scripts/test-compose.mjs             # compose_email_from_blocks end-to-end
node scripts/test-agent-loop.mjs          # agent tool-use loop with mocked OpenAI
node scripts/test-agent-compose.mjs       # agent calls compose tool end-to-end
node scripts/test-outline-parse.mjs       # parser, fixtures + real files
node scripts/test-outline-insert.mjs      # end-to-end insert path
node scripts/test-placeholder-infer.mjs   # NEW 2026-06-10 — placeholder placement (3 фикса)
node scripts/test-locale-analyze.mjs      # NEW 2026-06-10 — global best-first locale↔HTML matching
node scripts/test-style-slots.mjs         # NEW 2026-06-10 — style-slot правка → built CSS
node scripts/test-design-compose.mjs      # NEW 2026-06-10 — schema → план → сборка
node scripts/test-figma-plugin-intake.mjs # NEW 2026-06-10 — plugin payload → план → сборка
```

Ожидаемые exit codes: все **0**.
ВНИМАНИЕ: прогон всех сразу превышает 45с (билд-тяжёлые) — гонять пачками по 2-4.

---

## Часть 5. Gotchas / песочница

Эти грабли наступали несколько раз — фиксирую:

| Что | Симптом | Workaround |
|---|---|---|
| `workbench.js` слишком большой для Edit | EPERM | `python3 << 'EOF'` heredoc через `mcp__workspace__bash` |
| `server.js` — то же самое | EPERM | То же |
| Background-серверы умирают между bash-вызовами | curl возвращает refused | Тестировать через прямой вызов функций, не HTTP |
| FUSE-mount `unlink` падает на некоторых файлах | EPERM на rmSync | Тесты не cleanup'ят tmp файлы; работает в реальной FS |
| Package `"type":"module"` | CJS-require не работает на `.js` | Загружать browser-side JS через `vm.createContext` + sandbox |
| Pug интерпретирует `&nbsp;` в начале строки как тег | parser error | Префикс `\| ` для текстовых строк |
| `existsSync(...)` в Pug-attribute | parser error | Не вызывать функции внутри `(...)` |
| ESM modules не позволяют monkey-patch exports | мок не подменяется | `globalThis.__OPENAI_TEST_MOCK` hook |

---

## Часть 6. File map (key entry points)

Если нужно быстро найти что где:

```
email-base/tools/build-mail.js          ← Pug+Stylus build (sacred)
email-base/tools/rtl.js                 ← RTL post-processor
src/locale-ai.js                        ← placeholderize/fix-locale via OpenAI
src/locale-analyze.js                   ← zero-AI structural report
src/ai-tools.js                         ← 8 tool definitions + handlers
src/ai-agent.js                         ← tool-use loop, NDJSON onFrame
src/compose-email.js                    ← assemble pug from canonical blocks (+ markBlocks opt)
src/design-compose.js                   ← NEW schema → compose-план [{id,slots}] (last mile)
src/design-schema.js                    ← figma/screenshot payload → нормализованная schema
src/design-decomposition.js             ← schema → секции/роли
src/design-mapping.js                   ← schema+decomp → подсказки блоков
src/figma.js                            ← Figma REST API (нужен FIGMA_API_TOKEN)
src/figma-contract.js                   ← контракт payload для плагина
src/placeholder-inference.js            ← zero-AI расстановка плейсхолдеров (3 фикса)
src/locale-analyze.js                   ← zero-AI матчинг локали↔HTML (global best-first)
src/locale-ai.js                        ← AI placeholderize/fix/translate (нужен OpenAI)
data/block-library/canonical/*.json     ← 5 ключевых блоков со стиль-слотами + legacy
data/block-library/user/*.json          ← user-saved blocks (growing)
data/studio-journal.jsonl               ← AI decisions history

server.js                               ← all HTTP endpoints (~16700 строк; Edit даёт EPERM → python heredoc)
public/workbench.html|js|css            ← main editor UI (~9100 строк JS)
public/outline-parse.js | outline-mode.js ← outline rail + picker
public/constructor.html|css|js          ← /constructor: DnD + живой preview + drop-в-письмо + стиль-слоты
public/app.js | index.html              ← главный чат-UI; figmaPayloadInput = поле вставки Figma JSON

figma-plugin/manifest.json|code.js|ui.html ← NEW Figma-плагин (закрытая Figma → JSON → студия)
figma-plugin/README.md                  ← установка плагина

scripts/test-*.mjs                      ← all regression tests (11 шт., см. Часть 4)
docs/*.md                               ← roadmaps, audits, specs (this file)
```

---

## Часть 7. Как новой сессии Claude'а подхватить

1. **Прочитай этот файл целиком.**
2. **Прочитай `docs/STUDIO-ROADMAP.md`** — там общий план и история phase'ов.
3. Прогони `scripts/test-outline-parse.mjs` и `scripts/test-outline-insert.mjs` чтобы убедиться что новейший слой жив.
4. Узнай у пользователя:
   - Что выбираем — Phase 7 (Figma), Phase 8 (unified patch), или Outline v2?
   - Есть ли новые жалобы на UX после ручного теста (Часть 1)?
5. Используй `AskUserQuestion` перед серьёзными pivot'ами.
6. **Никогда не генерируй Pug/HTML с нуля для писем** — только через канонические блоки. AI пишет через `compose_email_from_blocks` или outline insert.
7. **Сохраняй sacred toolchain** — Stylus + Pug + email-base structure. Не предлагай React, MJML, Foundation и т.д.
8. **Перед коммитом / большими правками** — прогони все 6 тестов в Части 4.

---

## Часть 8. Контакт-points с пользователем

- Письма "Дальше" / "продолжи" — продолжай текущий phase в порядке roadmap'а.
- Письма со скриншотами — внимательно читай визуальные подсказки.
- Письма "Все глючно работает" — НЕ программировать сразу. Сначала собрать описание боли, затем `AskUserQuestion` с 2-3 вариантами решения.
- Письма с "Стилус и Pug это священное" — да, это аксиома проекта.
- Пользователь не может запускать тесты сам. Всегда — Node-скрипт + bash, чтобы я мог сам проверить.
