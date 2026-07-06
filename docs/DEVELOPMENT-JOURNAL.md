# Development Journal

## 2026-03-07

### Текущий статус

Проект перешел из стадии "визуальное демо" в стадию "рабочий MVP вокруг email-base".

### Что уже сделано

1. Поднят отдельный проект студии рядом с `email-base`.
2. Добавлен базовый chat UI и preview.
3. Подключен mock/OpenAI provider flow.
4. Подключена локальная копия `email-base`.
5. Добавлены:
   - settings drawer,
   - heuristic client diagnostics,
   - real email-base build loading.
6. Реализован parsing translation `.txt`-формата:
   - `Subject`
   - `Snippet`
   - `{{...}}`
   - `@@...@@`
7. Добавлена генерация missing locales.
8. Добавлен streaming chat.
9. UI переведен в chat-centric режим:
   - attach design
   - attach locale files
   - attach locale folder
   - attach images
   - paste/drop прямо в чат
10. Добавлены отдельные рабочие модальные окна:
   - `Locales`
   - `Assets`
   - `Code`
11. Реализовано сохранение нового письма в `email-base`.
12. Добавлен `block catalog v1`, который строится из реальных шаблонов в базе.
13. Добавлен локальный `asset registry` с библиотекой картинок и ручной подменой на CDN URL.
14. UI упрощен: меньше текста, tooltip-подсказки, более понятные chat actions, viewport toggle в preview.
15. Ассистент начал видеть `asset library` и подсказывать, какие картинки из проекта подходят к блокам текущего письма.
16. Добавлен `studio journal` с серверной записью событий и очисткой.
17. Добавлены быстрые кнопки `Локали`, `Картинки`, `Код`, `Тесты`, чтобы не искать эти функции по экрану.
18. Добавлено отдельное окно `Тесты` с heuristic summary по нескольким client profiles.
19. Починен chat intake: drag-and-drop теперь работает не только по маленькой зоне, но и по самому блоку чата; ссылки из сообщений тоже сохраняются как reference.
20. Mock-режим стал честнее: он явно сообщает, что без `OPENAI_API_KEY` не делает pixel-level vision, и при этом старается переиспользовать текущую структуру письма вместо случайного demo layout.
21. Добавлена загрузка `.env` на стороне сервера, чтобы live OpenAI можно было включать без ручного `export`.
22. Добавлен явный индикатор `LIVE AI / MOCK / FALLBACK` в интерфейсе.
23. Добавлен первый `Analyze design` endpoint и UI-блок для design analysis.
24. Добавлен `Block candidates` flow: если секция draft не совпадает с catalog, студия показывает ее как кандидат в новый канонический блок с черновым контрактом.
25. Зафиксирован roadmap по отдельному `Design workspace`, controlled Figma import и отдельному adapter slot под design-model.
26. Добавлен первый рабочий `Design workspace` слой: студия различает upload скрина/export, public image URL, public Figma frame URL и generic reference URL как разные типы design input.

## Текущие продуктовые принципы

- Чат — главный вход в систему.
- Письмо должно описываться структурой, а не свободным HTML.
- Переводы должны жить в явном формате и быть редактируемыми.
- Картинки должны быть осмысленно размечены по ролям.
- Реальный source of truth для прод-письма — `email-base`, а не локальный preview.

## Текущие сильные стороны MVP

- Можно реально обсуждать письмо в приложении.
- Можно прикладывать входные материалы без множества разрозненных экранов.
- Можно генерить локали и потом редактировать их по вкладкам.
- Можно сохранить результат обратно в рабочую базу.
- Уже есть зацепка под reusable blocks, а не только под ad-hoc draft.

## Что еще пока не завершено

- asset registry с локальным storage и стабильными ключами;
- полноценный block authoring flow;
- richer diff/review перед save в `email-base`;
- долгоживущая память проекта для ассистента;
- более сильная имитация email clients;
- глубокий импорт исторических писем последних лет.

## Практические соглашения

### Переводы

Источником перевода может быть:
- `.txt`
- `.json`
- папка с translation files

Внутри студии bundle хранится как единый текстовый пакет с разделителями:

```txt
=== FILE: 10495_en_US_original.txt ===
Subject: ...
Snippet: ...
{{...}}
```

### Картинки

Пока используются asset placements:
- `hero`
- `logo`
- `section`
- `feature`
- `footer`
- `background`
- `reference`
- `auto`

Картинки теперь могут:
- храниться локально в проекте;
- переиспользоваться из asset library;
- получать внешний CDN URL вручную после загрузки в корпоративное файловое хранилище.

### Сохранение в email-base

Текущий save flow:
- берет текущий draft;
- создает новый `mail-*`;
- пишет generated files;
- пишет locale JSON;
- запускает build и возвращает preview.

## Следующие задачи высокой ценности

1. Asset registry с локальным upload-ом файлов в проект.
2. Более зрелый block catalog на нескольких письмах.
3. Больше вопросов от ассистента по missing data до генерации.
4. Улучшение preview/test strategy для разных клиентов.
5. Import свежих исторических писем как source для канонических блоков.
6. Design workspace с zoning, mapping и review flow для новых макетов.

## Что открыть в новом чате в первую очередь

Если новая сессия должна быстро понять проект, сначала открыть:

1. [README.md](/Users/nikolay.bulgakov/Documents/retantion-future/README.md)
2. [PROJECT-OVERVIEW.md](/Users/nikolay.bulgakov/Documents/retantion-future/docs/PROJECT-OVERVIEW.md)
3. [DEVELOPMENT-JOURNAL.md](/Users/nikolay.bulgakov/Documents/retantion-future/docs/DEVELOPMENT-JOURNAL.md)
4. [server.js](/Users/nikolay.bulgakov/Documents/retantion-future/server.js)
5. [public/app.js](/Users/nikolay.bulgakov/Documents/retantion-future/public/app.js)

---

## Сессия 2026-07-06 — RTL-кнопки, пересборка библиотеки блоков, scoping, AI-доступ

### 1. RTL (ur/ar): центрированные кнопки остаются по центру
- `email-base/tools/rtl.js` → `alignButtonShellsRight()` больше НЕ перезаписывает
  `align="center"` на `align="right"`. Кнопка считается «центрированной по дизайну»,
  если: свой `align="center"`, или `margin: … auto` в inline-style, или сидит внутри
  `<center>` / td с `align="center"` / `text-align: center` (новые
  `isSelfCentered()` + `findCenteredContextStarts()`). Лево-прибитые кнопки
  по-прежнему зеркалятся вправо.
- Тот же фикс в fallback-трансформере `src/rtl.js`.

### 2. Слайсер базы (slice-mail-to-blocks.mjs) — стили и мобильная адаптация
- **Главный баг прошлой сессии**: framework-классы определялись по common.styl
  ИСХОДНОГО письма, а CSS брался только из blocks/dist/main.css. Итог: @media
  правила из common.css письма (.grey-block, .plr32, .banner…) выбрасывались,
  а в скелете compose их нет → мобильная адаптация терялась.
- Теперь: baseline = классы, ГАРАНТИРОВАННЫЕ скелетом (vendor + X_IQBroker/mail-welcome
  common/helpers); CSS тянется из blocks/dist/main.css + assets/styles/common.css
  письма; всё, чего нет в скелете, блок несёт с собой (base + @media). Дубли правил
  дедуплицируются. classesInPug ловит и `class="…"`-атрибуты.

### 3. Промоут (promote-sliced-blocks.mjs) — scoping и унификация
- **CSS scoping**: каждый imported-блок получает маркер-класс `b-<id>` на корневом
  pug-элементе, все селекторы styl (включая @media) скоупятся к маркеру →
  блоки из разных писем с одинаковыми классами (.banner и т.п.) больше не конфликтуют.
- **Параметрический спейсер**: все `.h-NN &nbsp;` схлопнуты в один блок `iq-spacer`
  со слотом height. Нормализация skeleton-ключа: `.h-\d+`→`.h-N`, `alt="…"`→`alt="A"`.
- Валидация подставляет слоты и в styl (не только pug).
- `scripts/validate-imported-chunk.mjs` (НОВЫЙ) — чанковая валидация через реальный
  build, re-runnable (пропускает блоки с полем `validated`).
- Итог: 1348 кандидатов → 284 уникальных → **281 валидных** (265 с mobile @media,
  149 section / 132 inline). Провалены 3: iq-cta-37 (текст в плохой позиции),
  iq-hero-23 (нецитированный кириллический url() в css), iq-cta-51 (смешанные
  отступы) — исключены из index.json, лежат с validated:false.
- E2E проверено: compose (canonical + imported + spacer) → build en+ur →
  scoped-селекторы и @media в финальном head, кнопка по центру на ur.

### 4. AI-агент — полная видимость и управление блоками (src/ai-tools.js)
- `list_canonical_blocks` теперь отдаёт source/tags/usageCount/hasMobileStyles/stylBytes.
- НОВЫЕ тулы: `get_block_source` (полный pug/styl/slots любого блока),
  `save_user_block` (создать/обновить user-блок, canonical/imported защищены от
  перезаписи), `delete_user_block`.

### Известные хвосты
- 3 невалидных блока (см. выше) — чинить в слайсере: квотирование url() и
  нормализация отступов в reconstructPug.
- Категории кроме X_IQ ещё не нарезаны новым слайсером (запуск:
  `node scripts/slice-mail-to-blocks.mjs --category <cat> --all` → promote → chunk-validate).

---

## Сессия 2026-07-06 (часть 2) — Visual gate, RTL parity, умные RTL-флипы

### Visual regression gate (НОВОЕ) — `scripts/visual-gate.mjs`
- `npm run visual` / `npm run visual:update`. Цели в `tests/visual-targets.json`
  (письма+локали — редактируемо) + авто-галереи топ-блоков библиотеки (section/inline).
- Скриншоты dist HTML: desktop 600px + mobile 375px, headless Chromium
  (playwright-core; setup: `npx playwright-core install --only-shell chromium`).
- Внешние картинки стабятся серым PNG (сеть не нужна, прогоны детерминированы).
- Diff через pixelmatch (fail > 0.1% пикселей), отчёт `tests/visual-report/index.html`
  (baseline|current|diff рядом). Baseline в `tests/visual-baseline/` (в git),
  current/report — в .gitignore. Exit 1 = diff, exit 2 = нет baseline.
- В песочницах без root: стаб libXdamage кладётся в ~/pwlibs (см. верх скрипта).

### Починка битых писем
- 5 писем имели header.pug и/или index.pug, куда прошлая сессия сохранила ГОТОВЫЙ
  HTML (перекрывал .jade → «unexpected text @medi»). header.pug удалены (регенерируются
  из .jade), index.pug восстановлены из git (318481b) / скопированы с rfm-311:
  mail-rfm-311, mail-test, mail-rfm-311-copy-213, mail-rfm-313-copy, mail-rfm-311-v2604300622.

### RTL: кнопки «всё ещё уезжали» — причина найдена
- В `public/workbench.js` живёт ТРЕТЬЯ (браузерная) копия applyRtl — она была старой
  и перезаписывала align="center" → right. Портирован центр-фикс (isSelfCentered +
  centered-context) в браузерную копию. ВАЖНО: при любой правке RTL менять ОБА файла:
  email-base/tools/rtl.js (истина) и public/workbench.js (parity).

### RTL: новые умные флипы (в ОБОИХ трансформерах)
- **Инверсия двухколоночных рядов**: `<tr>` ровно с двумя td классов `m-w` (номер/иконка)
  + `w-a` (текст) — td меняются местами, номер уходит вправо. Маркер
  `data-rtl-swapped="1"` на tr → повторный прогон no-op (идемпотентность).
  Прочие 2-td ряды не трогаются.
- Asset-карточки (.gray-block с фоновой иконкой) уже флипались ядром правильно
  (background right 24px → left 24px, direction:rtl на <a>, padding img) — теперь
  так же работает и в браузере.
- **Регрессия**: `scripts/test-rtl.mjs` (30 ассертов, гоняет ОБЕ копии на одних кейсах),
  включён первым в `npm test`.

### Проверено на реальных письмах
- rfm-311 ar/ur: 2 ряда инвертированы, 2 центрированные кнопки остались по центру.
- rfm-segmentation-2-215 ar: кнопки center сохранены, forced-right = 0.
- Baseline gate: 16 шотов (rfm-311 en/ur, rfm-seg-2-232 en/ar, welcome en/ur,
  2 галереи × desktop+mobile), контрольный прогон — zero diff.
