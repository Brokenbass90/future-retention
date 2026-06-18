# RetKit Email Workbench — Roadmap

## Что это такое
Профессиональная студия для команды email-маркетинга. Не конструктор для конечного юзера, но с drag-and-drop и AI на борту. Рабочий процесс: письмо из базы → расставить плейсхолдеры → локализовать (руками или AI) → экспорт.

---

## ГОТОВО

- Редактор HTML с подсветкой плейсхолдеров
- Pug / Stylus вкладки редактора
- Minimap (28px обычный, 72px в fullscreen, красный = ошибка)
- Locale tabs — en, ru, ar, tr...
- Блоки переводов с редактором
- Превью с подстановкой локали
- Click в превью → подсветка блока в коде
- PDF экспорт (html2pdf.js)
- TXT / ZIP экспорт локалей
- HTML аудит
- База писем — список 5 брендов, 19 писем
- Загрузка письма из базы в редактор
- Вкладки исходников (Pug/Styl файлы письма)
- Сборка Pug+Stylus → HTML (авто после Ctrl+S)
- AI-ассистент (OpenAI streaming)
- Fullscreen режим
- RTL post-processor для ar/he/fa/ur: флип text-align, флип `align=`, dir="rtl" на p/h*/li/td/leaf-div, smart icon mirroring в кнопках
- **(2026-05) RTL v2:** `align="left"` теперь автоматически добавляет `dir="rtl"` к тегу; leaf div без явного text-align получает `text-align: right` (паритет с p/h*/li)

---

## ПРИОРИТЕТЫ — текущий цикл

Порядок отражает соотношение impact / risk / unlock-других-фич.
Метки P0 = блокер развития, P1 = ключевой UX-апгрейд, P2 = nice-to-have / отложено.

### P0.1 — Распил `server.js` (696 KB одним файлом)
**Зачем:** любая новая фича сейчас рискует регрессом, скорость разработки падает экспоненциально. Без этого autocomplete / placeholders / multi-base будут наращивать боль.
**Как:** инкрементально, без big-bang. Извлекать чистые подсистемы по одной, каждый раз проверяя `npm start`. Целевая структура:
- `src/server/routes/` — HTTP endpoints по доменам (mail, locales, figma, assets, chat).
- `src/server/ai/` — оркестрация моделей, prompts, streaming.
- `src/server/email-base/` — bridge к локальной email-base (read/save/list).
- `src/server/rtl/` — обёртка над `email-base/tools/rtl.js` + локальный fallback (сейчас `rtlInlineFallback`).
- `src/server/figma/` — import endpoints, contract validation.
- `src/server/assets/` — asset registry.
- `server.js` — только bootstrap, env, http listener, mount routes.

**Acceptance:** `server.js` < 5 KB, все эндпоинты работают, smoke-test превью на одном письме проходит.

### P0.2 — AI auto-placeholders
**Зачем:** самый частый ручной труд при заведении нового письма. Большой выигрыш по времени менеджера.
**Как:** не отдавать AI всё подряд, а двухпроходный pipeline:
1. **Детерминированный pass** (`src/placeholder-inference.js`): regex + правила распознавания (суммы, account id, имена клиентов, даты, ссылки с tracking-параметрами, бренды).
2. Сравнение с реестром существующих плейсхолдеров письма (`${{namespace.block_XX}}$`).
3. **AI pass** только на спорных кусках с явным reasoning prompt "это персонализация или контент?".
4. Замена inline + запись в `placeholders.json` рядом с письмом.

Эндпоинт: `POST /api/mail/infer-placeholders { mailId, html }` → `{ proposals: [{range, current, suggested, confidence, reason}] }`.
В UI — diff-вью с per-proposal accept/reject.

### P1.1 — Monaco editor + IntelliSense
**Зачем:** "VS Code feel" — главный UX-блокер. Сейчас редактор — CM5, без proper completion provider'а.
**Как:**
1. Заменить редактор на Monaco (`@monaco-editor/loader` через CDN, чтобы не тянуть в npm).
2. Подключить `monaco-html`, `monaco-css` для подсветки + base IntelliSense.
3. Custom completion provider'ы:
   - имена блоков из текущего каталога (`data/block-catalog.json`),
   - плейсхолдеры из `placeholders.json` (плюс уже existing matches в текущем письме),
   - локальные ассеты (картинки из `app/assets/`),
   - snippets: bulletproof button, hero, footer, RTL-safe table row.
4. Hover provider: для placeholder показывать значение в текущей локали.
5. Email-client lint поверх: подчёркивать `flexbox`, `grid`, `position:fixed`, неподдерживаемые свойства в Outlook.

### P1.2 — Cross-base block import
**Зачем:** "тянуть код из других баз" — текущий запрос. У `src/catalog.js` уже есть основа.
**Как:**
1. Доразвить block registry (`data/block-catalog.json`): каждый блок получает метаданные — placeholders[], assets[], min-css[], client-support{}, source-mail.
2. UI: палитра блоков с фильтром по бренду / типу / поддержке клиентов.
3. Endpoint `POST /api/blocks/import { fromMailId, blockId, intoMailId, position }` — переносит блок + ассеты + регистрирует плейсхолдеры в целевом письме. Конфликты имён → диалог "переименовать / merge / skip".

### P1.3 — Live recompile / watch mode
**Зачем:** "база сама всё компилирует" — сейчас сборка только ручная / on-save.
**Как:**
1. `npm run watch:mail` — chokidar watcher на `email-base/X_new/**/*.{jade,styl}` → дебаунс 200ms → инкрементальный rebuild только изменённого письма.
2. Sub-process управляется студией: кнопка "Watch on/off" в header, состояние в localStorage.
3. WebSocket push: после rebuild фронт сам триггерит reload текущего превью.
4. Унифицированный CLI: `node email-base/tools/build-mail.js <mail-id> --locales=ar,ur,en --watch`.

### P2.1 — UI consolidation (SPA, VS-Code-like)
**Зачем:** сейчас `index.html` и `workbench.html` — два разных UI, путаница.
**Как (большой кусок, после P0/P1):**
- Single page, три зоны: левый sidebar (explorer писем/блоков) | центр (Monaco + 3-viewport превью) | правый (chat / диагностика).
- Журнал — как Terminal в VS Code (выдвижная панель снизу), не popup.
- Persist всех панелей и settings в localStorage.
- Превью — 3 viewport одновременно (desktop / mobile / dark), не toggle.

### P2.2 — Email-client lint pipeline
**Зачем:** release-readiness. Сейчас только heuristic warnings.
**Как:**
- Static analyzer: Outlook (mso) / Gmail clip / dark-mode hazards / inline-style coverage.
- CI script `npm run lint:mail -- <mail-id>` с exit codes для pre-push hook.

### P2.3 — Asset CDN / shared storage
**Зачем:** сейчас asset registry локальный; неудобно при работе нескольких людей.
**Отложено** до того, как несколько маркетологов будут реально работать одновременно.

---

## Архитектура

- Плейсхолдеры: ${{ namespace.block_00 }}$ (0-индекс, 2 цифры)
- Email base: email-base/{brand}/{mail}/app/ → dist через build-mail.js
- RTL post-processor: `email-base/tools/rtl.js` (используется на build и preview). Серверная обёртка с lazy require — `applyLocaleDirectionToHtml` в `server.js`.
- CM5: кастомный overlay-режим для плейсхолдеров (в P1.1 заменяется на Monaco)
- Minimap: canvas, красный = ошибка CM
- Сборка: node email-base/tools/build-mail.js (авто после сохранения исходника)
- Server: ESM, node:http без Express, SQLite для AI истории чата
