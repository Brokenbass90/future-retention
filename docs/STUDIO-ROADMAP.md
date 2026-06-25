# Email Studio — Consolidated Roadmap

> Living document. Top = свежий статус. Подробный план тестов — `docs/CODEX-TEST-PLAN.md`.

## 🎯 Оценка зрелости и роадмап «довести до ума» (2026-06-25)

**Сильное (фундамент верный):** единый источник истины = код блока; Pug+Stylus→build;
3 глубины правки; AI-слой по локалям (align/compare/CRUD/placeholderize с гардами,
agent-loop) — самый зрелый и ценный; чистая библиотека блоков (14, 25/25);
конструктор сборки из блоков; связка конструктор→workbench.

**Сырое (по убыванию боли):**
1. **Карандаш на произвольном HTML** — хрупкое сопоставление DOM↔исходник (браузер
   пере-сериализует атрибуты). Сейчас сделан безопасным (применяет точно или
   отказывает, не ломает). Полную надёжность даёт правка-в-DOM + пере-сериализация
   или стабильный id-маппинг.
2. **DnD/добавление в готовое письмо** — нужна разметка на блоки (AI-ингест с
   аппрувом). Начато: панель «Структура» (перестановка/удаление по `table.row`).
3. **RTL** — работает (серверный rtl), осталось зеркало двухъячеечных `img|text`.
4. **Долг по верификации** — много фронта поехало без визуальной проверки; нужен
   прогон CODEX-TEST-PLAN + авто-скриншот-регрессия (puppeteer).
5. **Figma/скриншот → блоки** — частично есть, не сведено end-to-end.

**Принципы доведения до ума:**
- *Никогда не ломать* — любая мутация применяется чисто или не применяется (как теперь карандаш).
- *Верификация-первая* — агент не видит рендер; каждый фронт-шаг закрывать визуальным/скриншот-тестом.
- *Единый mutation-API c dryRun+undo* — один путь записи с превью-диффом и откатом.

**Фазы:**
- **A. Стабилизация (долг):** прогон тест-плана, авто-скриншот-регрессия (EN/AR/UR
  на 5–6 эталонах), надёжный карандаш (DOM-apply), `dryRun`+undo на write-эндпоинтах.
- **B. Редактирование готовых писем:** AI-ингест с аппрувом (любое письмо → блоки),
  точная вставка/перестановка/удаление поверх разметки.
- **C. Конструктор → прод:** больше базовых блоков + тумбы, вложенные (inline) блоки,
  управление пользовательскими блоками.
- **D. AI-авторинг:** сборка по описанию, Figma/скрин → блоки end-to-end, цикл
  «построил → проверил» с авто-верификацией.
- **E. Безопасность/релиз:** review-лог, email-client lint (Litmus-подобный), release-pipeline.

---



> Living document. Top = свежий статус. Подробный план тестов — `docs/CODEX-TEST-PLAN.md`.

## ✅ Сделано (сессия 2026-06-25)

**AI / локали:** авто-маршрутизация правок в агента (без тумблера); vision (картинки из чата → агенту); `compare_locales` (сверка); `align_locales_to_reference` (выравнивание всех локалей под reference, `{{embedded.*}}` на месте); `insert_block`/`remove_block` (блок в открытом письме по якорю); `validate_html` (незакрытые теги / разбаланс `{{ }}` / `${{ }}$` / `@@`).

**Карандаш (инспектор превью):** Pug-aware (стиль → `(style=…)` в строку Pug по токену, текст → активная локаль; на внешнем HTML — как раньше); цвет хексом + пипетка; фоновая картинка (URL → `background-image+position+repeat+size:cover`); слияние стилей по свойствам (без задвоения); навигация по глубине ⬆/⬇ (выбор родителя) из обоих обработчиков, всегда видна.

**Workbench UX:** разворот превью ⛶ (прячет код); меню «⋯» (Outline, палитра); Monaco убран, вместо него автозакрытие тегов/скобок в обычном редакторе; нижняя планка тянется почти на весь экран; футер `footer_upload` приглушён/последний/не в экспорте; экспорт TXT — папкой.

**Конструктор `/constructor`:** 3 колонки (каталог | живое письмо | инспектор), «Структура» убрана, перенос/удаление блока — в инспекторе.

**🔴 Критические фиксы:** «Сохранить» затирал исходник объектом события (`[object PointerEvent]`) — починено, `header.pug/jade` восстановлены; doctype при сборке (`<!DOCTYPE public>` → корректный XHTML); preview-артефакты чистятся перед сохранением.

**Тесты:** `npm test` (6 наборов offline — align/cross-check/html-blocks/agent-loop/locale-crud/html-validate, всё зелёное); `npm run test:blocks`; `docs/CODEX-TEST-PLAN.md`.

## 🧱 Библиотека блоков (пункт 1 — ✅ фундамент готов)

`data/block-library/canonical/` — **14 блоков**, все компилируются через реальный пайплайн (`npm run test:blocks`: **25/25, 0 битых**):
divider-spacer, paragraph, button-primary, cta-banner, two-cta-row, hero-stack, hero-image,
header-logo, social-icons, store-badges, text-block, content-card, footer-legal, pill-label.
4 битых legacy-сниппета (71 КБ) удалены из `data/block-snippets.json`.

Дальше при желании: ещё узкие паттерны (numbered-features, three-column, VML-bg-hero для Outlook) — добавляются тем же методом (pug+styl+slots → валидация сборкой).

## ✎ Карандаш — ближайшие доработки
- ✅ href (ссылки), line-height, border, box-model подсветка (паддинг зелёный / маргин красный / бордер синий), прозрачный фон не как #000000.
- ⏳ **Адаптивный размер тайтла (mobile).** Нужно отдельным механизмом: размер для мобилы живёт не в инлайне, а в `@media (max-width:600px)` в head-`<style>` (например `.title { font-size: 32px !important }`). План: поле «Мобильный размер шрифта» → инжект/обновление media-правила по классу элемента (на HTML — в head style; на Pug — в соответствующий `.styl`). Требует, чтобы у элемента был стабильный класс.

## 🗺️ План вперёд (по порядку, как договорились)

1. **Блоки из базы** (выше) — фундамент. Гейтит DnD и AI-сборку.
2. **Достроить DnD-конструктор:** внутренние блоки (drop внутрь секций), перестановка перетаскиванием, ручное создание блока (save-as-block уже есть), undo на N ходов (стек на 20 уже в коде — подключить к DnD-операциям + кнопка ↶ над превью).
3. **Привязать к нейронке полностью:** `compose_email_from_blocks` (с нуля) + `insert_block`/`remove_block` (менять/добавлять/убирать) — отполировать, прогнать вживую.
4. **Figma-ссылка / скриншот → блоки:** vision уже есть; `design-compose.js`/figma частично готовы; ИИ читает макет → подбирает блоки → пользователь докидывает картинки. Нужен Figma-токен от пользователя.

---



Living document. Top = done, bottom = next.

---

## ✅ Done (this session)

### RTL pipeline — `email-base/tools/rtl.js` + `src/rtl.js` + `public/workbench.js`
- Strip-pass at step 0 removes stale `dir="rtl"` from prior builds.
- `text-align: left/start/end → right` in CSS + inline (respects `!important`).
- Physical mirror: `padding-left ↔ right`, `margin-left ↔ right`, `float: left ↔ right`, `background-position: left ↔ right`, `background:` shorthand with url() protection.
- `align="left|start|end" → align="right"` on all tags (no dir added).
- Button shells (innermost `<table>` containing `<td class="butt…">`) → `align="right"`.
- `<p>` / `<h1-6>` / `<li>` → `dir="rtl"` + `text-align: right` (if missing).
- Leaf `<div>` with real text → `dir="rtl"` + alignment.
- `<td class="butt…">` → `dir="rtl"`.
- Smart icon-text mirror via `direction: rtl` style on `<a>`/`<button>`.
- Client-side mirror in `workbench.js` (Phase F1.5 — found this was the real source of "RTL still folds" — the browser was using its own outdated copy).
- Hot-reload in `src/rtl.js` via mtime stat → no server restart needed for `rtl.js` changes.

### AI smart placeholderize — `src/locale-ai.js` + `src/locale-analyze.js`
- `extractVisibleElements` rewritten as stack-tokenizer with parentChain (3 ancestor descriptors per element).
- Two-pass validator: unmapped refBlocks get a focused retry with top-5 unused candidates.
- Structured decision report (anchored / missed / ambiguous / per-block decisions / stats).
- Smart Analysis module — zero-AI structural report (anchor / candidate / orphan tiers, hardcoded HTML, cross-locale drift).

### AI chat & tools — `server.js` + `src/ai-tools.js` + `src/ai-agent.js`
- Intent classifier: tolerant to typos (плэйсхолдер), "приведи к единому виду" routed to fix-locale.
- `pickRelevantNamespace` — explicit active hint > non-utility filter > largest namespace.
- Workbench namespace state surfaced into discussion-mode AI prompt.
- `fix-locale` batch mode — fixes every locale in namespace against reference in one call.
- `<bdi>` wrapping in `localizeHtmlPlaceholders` for RTL locales — isolates each block's bidi context.
- **Tool-use agent loop** (`src/ai-agent.js`): 8 tools (read_open_html, list_namespaces, get_namespace_blocks, analyze_email, placeholderize_html, fix_locale_txt, translate_locale_txt, finish). NDJSON streaming.
- Endpoint `POST /api/wb/ai/agent` — agent with live tool-call frames.
- Workbench UI: 🤖 Agent toggle + 🔍 Анализ button + live tool-timeline cards + per-step apply buttons.
- Mock client hook (`globalThis.__OPENAI_TEST_MOCK`) for hermetic testing.
- Smoke test `scripts/test-agent-loop.mjs` — passes all assertions on full agent loop.

### Tooling & observability
- `scripts/demo-placeholderize.mjs` — `--auto`, `--analyze`, `--json` modes.
- `scripts/journal-stats.mjs` — AI usage history, success rates, tool-call distribution.
- Decision journaling for every placeholderize + agent run → `data/studio-journal.jsonl`.

### Docs
- `docs/AI-VISIBILITY-AUDIT.md` — what AI sees, what it can write.
- `docs/DND-CONSTRUCTOR-AUDIT.md` — block library state + DnD architecture plan.
- `docs/UX-IMPROVEMENTS.md` — UX/UI revision proposals.
- `docs/STUDIO-ROADMAP.md` (this file).
- `docs/TEST-CHECKLIST.md` — step-by-step verification list.

---

## 🚧 In flight / planned

### Phase 0 — Validate + rebuild block library (1 day)
Test every snippet in `data/block-snippets.json` through `build-mail.js`. Convert passing blocks to the new schema (`{ id, placement, pug, styl, slots, preview }`) under `data/block-library/canonical/`. Manually rebuild the 4 corrupted 71 KB snippets. Generate thumbnails via puppeteer.

**Output:** `data/block-library/canonical/` with 15 working blocks + `tests/blocks/test-blocks.mjs`.

### Phase 1 — Pencil mode (1.5 days)
Toggle 🖊 in preview toolbar. While ON, click any element → floating inspector (text / image / colors / border-radius / padding). Live patch the Pug source.

### Phase 2 — Canvas + section-drag (1 day)
`public/constructor.html` separate page. Left = catalog. Center = vertical canvas of section blocks. Right = block inspector (Phase 1 component reused).

### Phase 3 — Inner-block drag + smart zones (1 day)
Inline blocks (`placement: "inline"`) get their own tab. `dragover` traces DOM ancestors to find compatible drop targets. Cards drop INTO sections.

### Phase 4 — User-saved blocks (1 day)
Right-click in preview → "Save as block". Auto-detect slots. Auto-thumbnail. Persist to `data/block-library/user/`.

### Phase 5 — Export to email-base (½ day)
Canvas → real pug/styl/json files under `email-base/<brand>/mail-<name>/`. Reuses existing `/api/wb/email-create`.

### Phase 6 — AI tool `compose_email_from_blocks` (½ day)
Agent tool that takes ordered `[{block_id, slots}]` → assembles + saves. Guaranteed renderable output (every block pre-tested).

### Phase 7 — Figma → blocks pipeline (1.5 days)
AI reads Figma JSON (via existing `src/figma.js`), matches sections to canonical blocks, returns `[{block_id, slots}]` + `needs_user_input` array. User uploads required assets (background images) in chat → final composition.

### Phase 8 — Unified patch API + undo (1 day)
`POST /api/wb/template/patch` — single write endpoint with dryRun + diff. All other write paths (workbench, agent, constructor) route through it. Backed by `data/edit-history.jsonl` for revert.

### Phase UX — quick wins (1.5 days, can interleave)
From `docs/UX-IMPROVEMENTS.md`:
- AI welcome screen (2 h)
- Review-changes panel (4 h)
- Undo for AI edits (3 h, depends on Phase 8)
- Top-bar AI status (1 h)
- Active-namespace card (2 h)

### Phase 9 — Idle auto-analysis (½ day, optional)
After N seconds of inactivity with HTML + namespace loaded, run zero-AI Smart Analysis in background. Show "💡 N suggestions" badge.

---

## 🔭 Beyond MVP

### F1.6 — Visual regression for RTL (1 day)
`scripts/rtl-visual-baseline.mjs` — puppeteer screenshots of 5-6 reference emails in EN/AR/UR at 600px. Diff against baseline via pixelmatch. Any regression > 1% pixel diff fails CI.

### T1 — Translation context (1 day)
`translateLocaleTxt` sees sibling locales + brand glossary (`data/brand-glossary.json`). Stylistically consistent translations across runs.

### T2 — DeepL hybrid (½ day)
DeepL for plain-text blocks, OpenAI for blocks with `@@bold@@` / `%%placeholder%%` markers (DeepL strips them).

### T3 — Cross-locale validator endpoint (½ day)
`/api/wb/ai/compare-locales` — feeds N locales to AI, returns structured `[{blockIndex, locales, issue}]`. Surfaces in Translator workspace.

### S1-S3 — Write safety (1 day total)
- `dryRun: true` on every write endpoint.
- Allowlist of file extensions in `/api/wb/email-file`.
- Studio review-log UI in workbench.

### A4 — Auto-calibration of thresholds (½ day, after 50+ journal entries)
Read `data/studio-journal.jsonl`, compute per-namespace similarity histograms, propose threshold adjustments. Optional auto-apply.

### Q1 — Block-ranking in AI context (½ day)
`src/block-ranking.js` exists but isn't wired. Use it to send AI top-N relevant blocks per request instead of the whole catalog.

### Q4 — A/B preview (½ day)
"Show me 3 variants of this button" — AI generates 3 `compose_email_from_blocks` calls with different slot values, server builds 3 previews, UI shows side-by-side.

---

## Dependency graph

```
Phase 0 (blocks valid)
   │
   ├─→ Phase 1 (pencil mode)        ← unlocks visual editing
   │      │
   │      └─→ Phase 2 (section drag)
   │             │
   │             └─→ Phase 3 (inner drag)
   │                    │
   │                    └─→ Phase 4 (user-saved blocks)
   │                           │
   │                           └─→ Phase 5 (export)
   │                                  │
   │                                  └─→ Phase 6 (AI compose tool)
   │                                         │
   │                                         └─→ Phase 7 (Figma)
   │
   └─→ UX phase (parallel)
   └─→ Phase 8 (patch API + undo, parallel)
```

Phase 0 gates the whole DnD track. Everything else can run in parallel after that.

---

## Total effort

- DnD constructor MVP (Phases 0-6): ~6 days
- Figma pipeline (Phase 7): 1.5 days
- Safety / undo (Phase 8): 1 day
- UX quick wins: 1.5 days
- Translation improvements (T1-T3): 2 days
- Visual regression (F1.6): 1 day
- Beyond-MVP qualities: 2 days

**Total to a fully-realized vision:** ~15 working days. The DnD track + Figma pipeline alone (7.5 days) is what produces the "AI builds emails from Figma" demo.

---

## How to pick what's next

If you want:
- **"AI does something visibly smart"** → finish testing the agent (no new code), run on 3 real emails, share screenshots.
- **"Humans can build emails today"** → Phase 0 → Phase 1 → Phase 2 (3.5 days to a working drag canvas).
- **"AI builds from Figma"** → Phase 0 → Phase 6 → Phase 7 (3 days; skips full DnD UI, AI does it directly).
- **"Stop breaking things"** → Phase 8 + UX-7 undo (1.5 days, gives safety net).
- **"Translators happy"** → UX-6 Translator workspace + T1 + T3 (2.5 days).
