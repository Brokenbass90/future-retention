# ROADMAP — Retention Future Studio

> Живой рабочий журнал. Обновляется по ходу разработки.
> Для каждой задачи: статус, приоритет, подзадачи, заметки.

---

## Легенда статусов
- `[ ]` — ожидает
- `[~]` — в процессе
- `[x]` — сделано
- `[!]` — заблокировано / требует решения

---

## ФАЗА 1 — Критичные фиксы (делаем сейчас)

### [x] 1.1 Создать ROADMAP.md
Этот файл.

---

### [x] 1.2 Расширить AI-контекст — дать AI реальную базу

**Проблема:** AI не видит реальные шаблоны из email-base. Генерирует generic JSON,
не зная ни названия блоков, ни формата ключей перевода, ни структуры include-дерева.

**Что сделать:**
- [x] Добавить `buildEmailBaseDeepContext()` — читает реальные `.jade`/`.pug` файлы,
  извлекает блоки, include-цепочки, ключи перевода
- [x] Добавить формат токенов перевода в systemPrompt: `${{ namespace.key_name }}$`
- [x] Инжектировать block catalog в `buildUserContext()` и `buildDiscussionContext()`
- [x] Показать AI реальные mailId по каждой категории
- [x] Добавить в system prompt знание о Pug/Jade + Stylus + vendor/helpers структуре

**Ожидаемый результат:** AI начинает ссылаться на реальные блоки, генерирует
корректные ключи переводов, предлагает существующие mail templates.

---

### [x] 1.3 Система памяти ошибок (AI Learning Log)

**Проблема:** AI делает ошибки, пользователь поправляет, но в следующей сессии
AI снова делает то же самое.

**Что сделать:**
- [x] Создать `data/ai-lessons.json` — хранит уроки
- [x] Добавить `readAiLessons()`, `appendAiLesson()` на сервере
- [x] Добавить `buildLessonsContext()` — форматирует уроки для AI контекста
- [x] Инжектировать уроки в `buildUserContext()` и `buildDiscussionContext()`
- [x] Добавить API endpoint `POST /api/ai/lesson` — сохранение урока
- [x] Добавить API endpoint `GET /api/ai/lessons` — список уроков
- [x] Добавить UI кнопку "Запомни это" в чат (в следующей итерации UI)

**Формат урока:**
```json
{
  "id": "uuid",
  "createdAt": "ISO date",
  "category": "layout|translation|copy|technical|general",
  "mistake": "Что AI сделал неправильно",
  "correction": "Как должно быть",
  "source": "user|auto",
  "tags": ["block-name", "brand"]
}
```

---

### [x] 1.4 Figma REST API интеграция

**Проблема:** Пользователь вставляет ссылку на frame в Figma, но студия
не умеет её парсить и достать структуру дизайна.

**Что сделать:**
- [x] Парсить Figma URL → извлечь fileKey + nodeId
- [x] Добавить endpoint `POST /api/figma/inspect` — вызывает Figma REST API
- [x] Возвращать: layers, texts, colors, component names
- [x] AI получает эту структуру и видит реальный макет, а не только скрин
- [ ] Добавить визуализацию Figma layer tree в UI

**Поддерживаемые форматы ссылок:**
```
https://www.figma.com/design/FILEKEY/Name?node-id=123:456
https://www.figma.com/file/FILEKEY/Name?node-id=123%3A456
https://www.figma.com/proto/FILEKEY/Name?node-id=123-456
```

---

### [x] 1.5 AI Error Handling + Retry logic

**Проблема:** Если OpenAI вернул невалидный JSON или timeout — поведение
непредсказуемо, ошибки скрыты.

**Что сделано:**
- [x] `callOpenAiWithRetry()` — универсальный враппер (3 попытки, exponential backoff 1s/2s/4s)
- [x] 45-секундный AbortController timeout на каждый запрос
- [x] Все ошибки логируются в studio journal
- [x] Умный NO-RETRY для fatal ошибок (invalid_api_key, billing, 400)
- [x] Все 4 AI-функции переключены на враппер

---

## ФАЗА 2 — Архитектура (следующий этап)

### [x] 2.1 Разбить server.js на модули

**Проблема:** 9700 строк в одном файле — невозможно работать с кодом.

**Структура:**
```
src/
  config.js          — env, constants, paths
  utils.js           — pure utility functions
  catalog.js         — block catalog generation
  assets.js          — asset handling
  email-base.js      — email base operations, build pipeline
  templates.js       — template selection, family profiles
  ai-context.js      — buildUserContext, buildDiscussionContext, AI prompts
  ai-client.js       — OpenAI calls, retry, error handling
  lessons.js         — AI learning system
  figma.js           — Figma REST API integration
  batch.js           — batch generation, job queue
  router.js          — HTTP request routing
server.js            — точка входа (import + listen)
```

**Что сделано:**
- [x] `src/config.js` — env, paths, API keys
- [x] `src/db.js` — SQLite DatabaseSync
- [x] `src/assembler.js` — block assembly pipeline
- [x] `src/figma.js` — parseFigmaUrl, flattenFigmaLayers, fetchFigmaNodeData, inspectFigmaUrl
- [x] `src/ai-schemas.js` — responseSchema, translationResponseSchema, designAnalysisSchema
- [x] `src/ai-client.js` — callOpenAiWithRetry, extractResponseText, makeOpenAiClient
- [x] `src/utils.js` — cleanText, dedupeStrings, toRelativePath, dedupeCatalogSources, mergeCatalogTraits
- [x] `src/catalog.js` — block catalog generation (~500 строк убрано из server.js)
- server.js: ~10 200 → **9 300 строк** (-900)

---

### [x] 2.2 SQLite вместо JSON-файлов

**Проблема:** Плоские JSON-файлы — race conditions при параллельных записях,
медленный поиск при росте базы.

**Что сделано:**
- [x] `src/db.js` — DatabaseSync (node:sqlite встроенный, без npm deps), WAL mode, FK
- [x] Таблицы: `studio_journal`, `project_rules`, `ai_lessons`, `asset_registry`
- [x] `migrateFromJson()` — автоматически мигрирует данные из JSON при старте
- [x] Все функции переключены: journal, rules, lessons, assets → SQLite
- [x] JSON-функции сохранены как backward-compat no-op wrapper'ы

---

### [x] 2.3 Block-Assembly Pipeline (ключевая фича)

**Что сделано:**
- [x] `src/assembler.js` — CANONICAL_BLOCK_MAP + assembleEmail() pipeline
- [x] `POST /api/email-base/assemble` — полный pipeline через assembler.js
- [x] `GET /api/email-base/blocks` — список блоков с enriched paths
- [x] AI schema: `suggested_blocks` уже в responseSchema
- [x] Block catalog + 6 новых детекторов: social-icons-row, awards-showcase-row, dark-banner-cta-block, countdown-timer-block, image-banner-block

---

## ФАЗА 3 — Новые фичи (после архитектуры)

### [x] 3.1 Batch режим и Job Queue

**Для производства писем в больших объёмах.**

- [x] `POST /api/batch/queue` — принять список задач
- [x] In-memory job queue (`src/batch.js` — FSM: pending→running→done|failed|cancelled)
- [x] `GET /api/batch/status` — статистика очереди + список jobs
- [x] `GET /api/batch/job/:jobId` — результат конкретного job
- [x] `POST /api/batch/cancel/:id` — отмена pending job
- [x] `POST /api/batch/clear` — очистка завершённых jobs
- [x] `startWorker()` — background loop, processorFn для `generate-draft` type
- [ ] UI: страница batch заданий, прогресс бар
- [ ] Export batch results: zip с HTML-файлами

---

### [x] 3.2 Template Browser UI

**Было скрыто за кнопкой "Load base email".**

- [x] Кнопка "📂 Templates" в топбаре
- [x] Slide-out drawer: аккордеон брендов → mails (`GET /api/email-base/tree`)
- [x] Зелёная точка = build уже есть в dist/
- [x] По клику на mail — quick bar: "Load →" + кнопки конкретных локалей
- [x] Поиск по mailId + бренду (live filter)
- [x] Клик на "Load" — прописывает category/mailId/locale в brief + вызывает handleLoadBaseEmail

---

### [x] 3.3 Переделать Attach UX (частично)

**Проблема:** Кнопки прикрепления размазаны по 3 местам.

- [ ] Единая attachment-зона рядом с полем ввода (paperclip dropdown)
- [ ] Drag-and-drop прямо в textarea
- [ ] Pill-индикаторы что приложено: `🖼 Design`, `📄 3 locales`, `🔗 Figma`
- [ ] Убрать дублирующие кнопки из intake zone

---

### [x] 3.4 История генераций

- [x] SQLite таблица `generation_history` в `src/db.js` (max 200 записей)
- [x] `historyAppend()` — автосохранение после каждой успешной генерации в `/api/chat`
- [x] `GET /api/history` — список последних 50 записей
- [x] `GET /api/history/:id` — html_head (первые 8KB HTML)
- [x] `DELETE /api/history/:id` — удаление записи
- [x] `POST /api/history/clear` — очистка
- [x] UI: кнопка "🕐 History" в топбаре → modal со списком
- [x] Каждая запись: тема, preheader, category/mailId/locale, время назад
- [x] "Восстановить brief →" — restore из истории

---

### [x] 3.5 DeepL автоперевод локалей

**DEEPL_API_KEY теперь полностью используется.**

- [x] `createDeepLTranslations()` — батч-перевод через DeepL `/v2/translate`
- [x] `deeplTranslateTexts()` — universal helper: subject/preheader/cta_labels/body_blocks за один запрос
- [x] `studioLocaleToDeepL()` — маппинг студийных кодов (en_US, pt_BR, ru) → DeepL коды
- [x] DeepL как `providerId: "deepl"` в `generateMissingLocales` (до OpenAI fallback)
- [x] `GET /api/deepl/status` — проверка конфигурации
- [x] `POST /api/deepl/translate` — прямой endpoint для UI (texts + targetLocale)
- [x] Кнопка "🌐 DeepL auto-translate" в modal локалей (видна только если DEEPL_API_KEY есть)
- [x] DeepL добавлен в `getProviderCatalog()` как отдельный provider
- [x] Settings → Runtime info показывает "DeepL: ✓" если ключ есть

---

### [x] 3.6 Diff view перед сохранением в base

- [x] `GET /api/email-base/read` — загружает существующий HTML из dist/locale/index.html
- [x] `handleCreateBaseMail` → открывает diff modal ПЕРЕД сохранением
- [x] LCS-алгоритм (Myers-style) для line-level diff в браузере (до 5000 строк)
- [x] Цветная разметка: зелёный +added, красный -removed, серый context
- [x] Статистика: сколько строк добавлено/удалено/без изменений
- [x] Кнопка "Сохранить в email-base →" только в конце diff modal (guard)
- [x] Если шаблон ещё не существует — показывает весь файл как новый (зелёный)
- [x] После сохранения — сброс кэша template browser

---

## ФАЗА 4 — UI Redesign

### [ ] 4.1 Onboarding экран

**Первый экран для новых пользователей должен быть понятным.**

- [ ] Большой CTA: "Начать новое письмо"
- [ ] 3 шага в одну строку с иконками
- [ ] Для вернувшихся: shortcuts row — "последние 3 письма"

---

### [ ] 4.2 Упростить топбар

- [ ] Settings поглощает Rules и Journal
- [ ] Убрать "Заполнить демо" (или только dev mode)
- [ ] Оставить максимум 3 кнопки в топбаре

---

### [ ] 4.3 Modal system → Sidebar panels

- [ ] Заменить 8 модалей на collapsible sidebar panels
- [ ] Анимированные переходы
- [ ] Нет перекрывающихся модалей

---

### [ ] 4.4 Preview improvements

- [ ] Loading skeleton при генерации
- [ ] Active state у Desktop/Mobile/Fit кнопок
- [ ] Кнопка "Copy HTML" всегда видна над preview

---

## ФАЗА 5 — Design Intelligence (ключевое направление)

> Цель: программа реально умеет читать Figma-дизайн и верстать по нему письмо,
> опираясь на email-base. Не угадывать — а структурно маппить дизайн → блоки → HTML.

---

### [x] 5.0 Clone & Edit — редактирование существующего HTML email

- [x] `extractEmailHtmlContentMap()` — парсит HTML: тексты, картинки, ссылки, subject
- [x] `POST /api/email/extract-content` — endpoint для фронтенда
- [x] "📧 Письмо" pill в attachment row → открывает Design modal + scroll к секции
- [x] Drag & drop .html файла, File upload, Paste HTML
- [x] Content map в UI: текстовые блоки, картинки, ссылки — всё видно до разговора с AI
- [x] `buildBaseEmailContext()` — инжектирует content map в AI контекст (оба режима: chat + discussion)
- [x] AI получает: "edit mode, preserve HTML structure, replace only what user asks"
- [x] Persist в localStorage (без самого HTML для экономии места — только contentMap)
- [x] **КРИТИЧЕСКИЙ ФИX (сессия 5):** отдельный `cloneEditSystemPrompt` — AI не использует каталог блоков при Clone & Edit
- [x] **КРИТИЧЕСКИЙ ФИX (сессия 5):** `buildUserContext()` не инжектирует `buildEmailBaseDeepContext()` в clone-edit режиме
- [x] `mail.modified_html` исправлен в `ai-schemas.js` — был вне `properties`, вызывал синтаксическую ошибку

### [x] 5.0b Figma Scan UI redesign

- [x] Вкладки "Figma URL" / "Screenshot" в Design modal
- [x] "Scan →" кнопка → вызывает `/api/figma/inspect` → показывает результат: N слоёв, тексты, компоненты
- [x] Screenshot tab — большая paste-зона с инструкцией Cmd+C из Figma → Cmd+V
- [x] Design Status bar (всегда виден под вкладками)

### [ ] 5.1 Двухпроходной анализ дизайна

**Проблема:** AI сейчас пытается «понять дизайн» и «собрать письмо» в одном промте — это ненадёжно.

**Решение:** два отдельных шага с явным промежуточным состоянием.

**Шаг 1 — Analyze:** AI получает Figma layers + PNG-скрин и отвечает ТОЛЬКО структурой:
```json
{
  "sections": [
    { "order": 1, "kind": "hero", "title": "Добро пожаловать", "has_image": true },
    { "order": 2, "kind": "feature-list", "items": ["Пункт 1", "Пункт 2", "Пункт 3"] },
    { "order": 3, "kind": "cta", "label": "Начать", "href_placeholder": true }
  ],
  "subject_guess": "...",
  "preheader_guess": "...",
  "block_catalog_matches": ["hero-banner", "icon-feature-row", "cta-block"]
}
```

**Шаг 2 — Build:** AI получает эту структуру (не сырой дизайн) + email-base и собирает письмо.

- [ ] Добавить `POST /api/design/analyze` → возвращает structured DesignBrief
- [ ] Добавить `analyzeDesignToStructure()` с отдельным промтом
- [ ] Промт Шага 1 явно показывает AI доступные блоки из block catalog (чтобы AI маппил на реальные блоки, а не придумывал)
- [ ] `POST /api/chat` при наличии дизайна автоматически проходит Шаг 1, затем Шаг 2

---

### [ ] 5.2 Design Analysis Panel в UI

**Проблема:** Пользователь не видит что AI извлёк из дизайна. Нет возможности исправить до верстки.

**Что сделать:**
- [ ] Modal/panel: "Вот как я понял дизайн" — список секций с типами, текстами, маппингом на блоки
- [ ] Пользователь может редактировать секции (drag to reorder, change kind, edit text)
- [ ] Кнопка "Верстать по этой структуре →" — запускает Шаг 2
- [ ] "Пересканировать" — повторить Шаг 1 если AI ошибся

---

### [ ] 5.3 Улучшить Figma context pipeline

**Проблема:** Сейчас `flattenFigmaLayers()` даёт плоский список 100 слоёв. AI с ним работает хуже чем мог бы.

**Что сделать:**
- [ ] Добавить `groupFigmaLayersBySection()` — группирует слои по Z-позиции (верх→низ = секции письма)
- [ ] Извлекать image-placeholder-ы (RECTANGLE или FRAME без текста) → `image_slot`
- [ ] Экспортировать выбранный фрейм как PNG через Figma Images API (вместо требования скрина от пользователя)
- [ ] Передавать в AI: `sections_by_position`, `text_hierarchy` (h1/h2/body по font-size), `brand_colors`

---

### [ ] 5.4 Design-to-Base matching — обучение на примерах

**Идея:** Каждый раз когда пользователь сохраняет письмо в email-base после работы с дизайном,
сохранять пару (figma_structure → email_blocks_used). Это создаёт датасет для улучшения маппинга.

- [ ] При `handleCreateBaseMail` опционально сохранять `design_snapshot` в SQLite
- [ ] `GET /api/design/examples` — примеры успешных маппингов
- [ ] Инжектировать топ-3 примера в промт Шага 1 (few-shot)

---

### [ ] 5.5 Figma Plugin (долгосрок)

**Даёт максимальную точность, но отдельный проект (2-3 недели).**

- [ ] Figma Plugin: кнопка "Send to RF Studio" → POST на localhost:3002
- [ ] Передаёт: выбранный frame как JSON (компоненты, токены, тексты)
- [ ] Студия принимает на `POST /api/figma/plugin-push`
- [ ] Полностью убирает необходимость в PNG-скрине

---

## Известные баги

| # | Описание | Приоритет | Статус |
|---|----------|-----------|--------|
| B1 | template-family-profiles.json пустой — профили семей не генерируются | HIGH | [x] Файл содержит items, работает |
| B2 | mail-structure-profiles.json пустой — структурные профили не работают | HIGH | [x] Файл содержит items, работает |
| B3 | IBM Plex Mono не подгружается (нет @import) — code editor без моноширинного | LOW | [ ] |
| B4 | Summary card показывает технические поля постоянно | MEDIUM | [ ] |
| B5 | Block catalog только 12 items — catalog generation не читает все блоки | HIGH | [x] +6 новых детекторов: socials, awards, dark-bg, countdown, image-banner |
| B6 | Clone & Edit: AI игнорирует инструкцию не использовать каталог | CRITICAL | [x] Отдельный cloneEditSystemPrompt + branched buildUserContext() |
| B7 | Skeleton loading остаётся видимым после загрузки | MEDIUM | [ ] |
| B8 | Code editor scroll sync иногда слетает | LOW | [ ] |
| B9 | renderDraftHtml для X_System не рендерит body — превью пустое | MEDIUM | [x] `rebuildSystemEmailHtml()` + детекция X_System в `rebuildDraftHtmlFromMail()` |
| B10 | CANONICAL_BLOCK_MAP в assembler.js ищет blocks/hero, blocks/text — таких путей нет | HIGH | [ ] Нужен маппинг или переименование |

---

## Заметки по архитектуре

### Сколько брендов может быть
Брендов (категорий в email-base) может быть сколько угодно. Каждый бренд —
отдельная папка `X_BrandName/` в email-base. Новые бренды студия создаёт
самостоятельно (или пользователь добавляет папку).

### Формат токенов перевода
```
${{ namespace.key_name }}$
```
Пример: `${{ welcome-broker.block_01 }}$`
Namespace = ID письма без `mail-` префикса, с дефисами.

### Структура нового письма
```
email-base/
  X_BrandName/
    mail-{type}/
      app/
        templates/
          index.jade (или .pug)
          blocks/
            header.jade
            [additional blocks]
          helpers/
            footer.jade
            preheader.jade
        styles/
          common.styl
          blocks/main.styl
          helpers/variables.styl
```

### Как работает build
`build-mail.js` запускает Gulp → компилирует Pug → инлайнит Stylus → выдаёт HTML.
Для нового бренда нужно: скопировать структуру из существующего, поменять variables.styl.

---

---

## ФАЗА 6 — Картинки и блоки (текущий приоритет)

> Цель: студия умеет работать с реальными картинками (своё хранилище + внешние ссылки)
> и собирать письма с нуля из параметризованных блоков.

---

### [x] 6.1 Внутреннее хранилище картинок

**Для кого:** разработка / тестирование, когда нет CDN.

- [x] Файлы хранятся в `data/assets/` + запись в `asset-registry` (SQLite через `registerUploadedAssets`)
- [x] Serve endpoint `GET /studio-assets/:filename` — уже работает через `serveStudioAsset()`
- [x] Upload через base64 dataUrl → `/api/assets/register` — уже поддерживается
- [x] UI: image slot panel — drag & drop картинки прямо на placeholder, кнопка ↑ для выбора файла
- [x] `uploadAssetFile()` в `app.js` — FileReader → base64 → POST → получаем URL `/studio-assets/`
- [x] Превью автоматически обновляется через `rebuildDraftHtmlFromMail()`
- [ ] **TODO:** AI должен получать список уже загруженных ассетов при генерации (чтобы повторно использовать)

---

### [x] 6.2 Image URL input при генерации

**Для кого:** production, картинки уже на CDN клиента.

- [x] Image slot panel появляется после генерации черновика с `mail.assets[]`
- [x] Для каждого слота: поле ввода URL, превью thumbnail
- [x] Drag & drop файла прямо на thumbnail → автозагрузка в хранилище → URL заполняется
- [x] Live preview rebuild через `rebuildDraftHtmlFromMail()` — без обращения к серверу
- [x] Панель скрывается кнопкой ✕, сбрасывается при новой генерации
- [x] CSS: `image-slot-panel`, `image-slot-item`, `image-slot-thumb`, `image-slot-upload-btn`

---

### [x] 6.3 Аудит блоков — автоматический скрипт

**Скрипт `tools/block-audit.js`:**

- [x] Сканирует все 708 .pug/.jade файлов в email-base (116 уникальных block-файлов)
- [x] Для каждого блока: тип, бренд, хардкодные img URL, токены перевода
- [x] Группирует дубликаты — 47 групп структурных дубликатов
- [x] Выявляет повторяющиеся URL (216 уникальных, 63 URL встречаются 3+ раз)
- [x] Генерирует `data/block-audit-report.json`

**⚠️ Важное открытие:** Блоки в реальной базе называются НЕ семантически:
- `blocks/header` = главная картинка письма (хедер дизайна)
- `blocks/second`, `blocks/third` = дополнительные секции
- `helpers/footer` = footer с unsubscribe
- В **X_System** все 22 письма имеют ОДИНАКОВУЮ структуру: только `header` + `footer`. Контент ВЕСЬ внутри блока `header`. Нет отдельных секций-блоков для body.
- Assembler ожидает `blocks/hero`, `blocks/text`, `blocks/cta` — этих путей в базе НЕТ.
  Нужна либо переименование, либо маппинг в `CANONICAL_BLOCK_MAP`.

---

### [ ] 6.4 Параметризация image URL — скрипт + ручная доработка

**Новая стратегия (с учётом открытия выше):**

Не автоматизировать параметризацию существующих блоков —
они слишком специфичны и имеют непредсказуемые имена.
Вместо этого: создать НОВЫЕ canonical блоки вручную, начиная с X_System.

**Скрипт `tools/parameterize-blocks.js`:**
- [ ] Читает block-audit-report.json
- [ ] Находит топ-30 повторяющихся img URLs (logo, bg, icons) — кандидаты на `_logoUrl` и т.п.
- [ ] Создаёт шаблон параметризованного блока для каждого типа (preview, не готовый к prod)
- [ ] Отчёт: сколько URL будет параметризовано, какие переменные нужны

---

### [x] 6.5 Scaffold system для X_AffSystem — клонирование шаблона письма

**Стратегия: не переписывать существующие блоки вручную — клонировать письмо целиком и переименовать токены.**

X_AffSystem = 16 писем, все на Jade, все с токенами `${{ mail-id.block_XX }}$`.
Дизайн (цвета, кнопки, скругления) — отличается по бренду, но структура одна.
Новые письма создаются клонированием существующего с переименованием namespace.

**Что сделано:**

- [x] `tools/scaffold-system-mail.js` — клонирует папку письма, переименовывает namespace токенов
  - `scaffoldMail({ category, templateMail, newMailId, dryRun })` → `{ mailRoot, namespace, tokenKeys, blockCount, localeTemplate }`
  - Поддержка dry-run (проверка без записи файлов)
  - Dry-run протестирован: 9 token keys (block_00–block_08), 27 файлов для `mail-password-retrieving-affiliate`

- [x] `POST /api/email-base/scaffold` — HTTP endpoint
  - Тело: `{ category, templateMail, newMailId, localeContent?, buildAfter? }`
  - Клонирует + опционально делает Gulp build сразу
  - Если `localeContent` передан → резолвит токены для превью (`resolveTokensForPreview`)
  - Ответ: `{ mailRoot, namespace, tokenKeys, blockCount, safeMailId, buildLog, previewHtml }`

- [x] `resolveTokensForPreview(html, namespace, localeContent)` в server.js
  - Заменяет `${{ namespace.key }}$` токены из `localeContent` map
  - Сохраняет shared токены (affbot, footer)

- [x] AI scaffold mode в `buildUserContext()` — ветка `=== SCAFFOLD MODE ===`
  - Получает `payload.scaffoldContext` с токен-ключами
  - Инструктирует AI заполнить все ключи в `mail.locale_entries`

- [x] `mail.locale_entries` добавлен в `src/ai-schemas.js`
  - Тип: `Array<{ key: string, value: string }>`
  - Strict-compatible с OpenAI structured output
  - Обязателен (пустой массив по умолчанию вне scaffold режима)

- [x] `materializeDraft()` — извлекает `locale_entries` → `localeContent` map в ответе
  - Клиент получает `{ localeContent, scaffoldMailId, scaffoldCategory }` для последующего вызова scaffold endpoint

- [x] `normalizePayload()` — добавлено поле `scaffoldContext` для передачи scaffold context в AI

**Workflow:**
```
POST /api/email-base/scaffold → клонирует, строит, возвращает tokenKeys[] + raw HTML
↓
POST /api/chat (с scaffoldContext: { newMailId, namespace, tokenKeys }) → localeContent{} + brandTheme
↓
POST /api/email-base/rebuild (с localeContent) → rebuildds + resolves ${{ ns.key }}$ → previewHtml
```

- [x] `POST /api/email-base/rebuild` — лёгкий rebuild без клонирования
  - Тело: `{ category, mailId, locale?, localeContent? }`
  - Если `localeContent` передан → резолвит scaffold-токены в результирующем HTML
  - Используется `applyScaffoldLocaleContent()` и `triggerScaffoldRebuildAfterTheme()` на клиенте
  - Фикс: ранее `applyScaffoldLocaleContent` вызывал scaffold повторно с `buildAfter: false`, что возвращало null previewHtml

**Marketing emails (позже):**
- [ ] `hero-full.jade` — hero + картинка + CTA, параметры: `_heroUrl`, `_title`, `_body`
- [ ] `cta-block.jade` — кнопка-блок
- [ ] `feature-list.jade` — список преимуществ
- [ ] `footer-legal.jade` — footer с unsubscribe

**TODO:**
- [ ] UI в студии для запуска scaffold (кнопка или команда в чате)
- [ ] Получение пользовательского драфта системного письма → адаптация в canonical template

---

### [x] 6.6 Brand theme конфиг + авто-патч стилей

**Проблема:** AI генерирует письма с чужими стилями (цвета, радиус кнопки, логотип) потому что шаблон клонируется с IQ Option и их hardcoded стилями.

**Решение:** AI видит дизайн-скрин → извлекает тему → сервер патчит Stylus/Jade файлы до build.

**Что сделано:**

- [x] `tools/theme-patcher.js` — патчит стили клонированного шаблона:
  - `patchTheme(mailRoot, theme)` → патчит `main.styl` + `variables.styl` + `header.jade`
  - `main.styl`: кнопка (background, border-radius), текст (.text color), заголовок (.subtitle color), фон (table.body, html), бордер (.bg-bord*)
  - `header.jade`: логотип img src
  - `normalizeTheme(raw)` — валидирует hex-цвета, px-радиусы, https URLs
  - `saveTheme(theme)` / `readTheme(brandId)` / `listThemes()` → `data/brands/{brandId}/theme.json`

- [x] `mail.brand_theme` добавлен в `src/ai-schemas.js`
  - 10 полей: primaryColor, primaryTextColor, buttonRadius, contentRadius, textColor, headingColor, linkColor, bgColor, borderColor, logoUrl
  - Strict-compatible, все поля required (пустая строка '' если не видно)

- [x] System prompt — AI инструктирован: при дизайн-скрине извлечь hex-цвета и px-радиусы
- [x] `POST /api/email-base/patch-theme` — HTTP endpoint для ручного патча
- [x] `GET /api/brands` + `GET /api/brands/:brandId` — просмотр сохранённых тем
- [x] `materializeDraft()` — извлекает `brand_theme` из AI ответа, передаёт клиенту
- [x] Авто-патч в `/api/chat` — если scaffold context активен + AI вернул brand_theme → `patchTheme()` применяется сразу, тема сохраняется
- [x] Client: `triggerScaffoldRebuildAfterTheme(mailId, category, localeContent?)` — вызывает `POST /api/email-base/rebuild`
  - Фикс: ранее вызывал patch-theme с пустой темой только ради rebuild — теперь использует выделенный endpoint
  - Если `localeContent` передан — токены резолвятся за один rebuild (тема + контент за один запрос)

**Полный auto-flow:**
```
Design скрин → AI → brand_theme: { primaryColor: "#BDFF00", buttonRadius: "12px", ... }
↓ сервер (materializeDraft + авто-патч)
patchTheme(mail-new-id, theme) → main.styl ← #BDFF00, 12px / header.jade ← logoUrl
↓
Gulp rebuild → preview HTML с правильными стилями
↓
data/brands/category/theme.json — сохранено для переиспользования
```

**TODO:**
- [ ] UI: Brand themes страница в Settings (просмотр + редактирование сохранённых тем)
- [ ] Использовать сохранённую тему при повторном scaffold того же бренда

---

## ФАЗА 7 — Умная сборка с нуля

### [ ] 7.1 Full "from scratch" через canonical blocks

- [ ] Assembler использует canonical blocks (не только копии из писем)
- [ ] AI выбирает блоки → assembler подставляет canonical template для каждого
- [ ] Image-слоты определяются автоматически → передаются в 6.2 (URL input)
- [ ] Финальный Pug компилируется с реальными URL и brand theme

### [ ] 7.2 Background image support (VML + CSS fallback)

- [ ] Canonical hero-full поддерживает `_bgImageUrl`
- [ ] Pug-mixin `+vml-bg(_bgImageUrl)` параметризован
- [ ] CSS background fallback для не-Outlook клиентов
- [ ] AI может указать `background_image_key` в секции

---

## Известные баги (новые, сессия 4)

| # | Описание | Приоритет | Статус |
|---|----------|-----------|--------|
| B6 | Clone & Edit: AI игнорирует инструкцию не использовать каталог | CRITICAL | [~] Отдельный systemPrompt |
| B7 | Skeleton loading остаётся видимым после загрузки | MEDIUM | [ ] |
| B8 | Code editor scroll sync иногда слетает | LOW | [ ] |
| B9 | `renderDraftHtml` для X_System не рендерит image секции | MEDIUM | [ ] |

---

*Последнее обновление: 2026-03-13 (сессия 6)*
