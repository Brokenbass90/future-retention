# Chat Handoff

## Что это за проект

`Future Retention Studio` — локальная AI-студия для сборки писем на основе вашей собственной `email-base`.

Цель проекта:
- общаться с ассистентом в одном окне;
- прикладывать дизайн, переводы и картинки прямо в чат;
- собирать draft и preview;
- использовать реальные шаблоны и блоки из `email-base`, а не произвольный HTML;
- сохранять результат обратно в базу.

## Где смотреть код

- [/Users/nikolay.bulgakov/Documents/retantion-future/server.js](/Users/nikolay.bulgakov/Documents/retantion-future/server.js)
- [/Users/nikolay.bulgakov/Documents/retantion-future/public/app.js](/Users/nikolay.bulgakov/Documents/retantion-future/public/app.js)
- [/Users/nikolay.bulgakov/Documents/retantion-future/public/index.html](/Users/nikolay.bulgakov/Documents/retantion-future/public/index.html)
- [/Users/nikolay.bulgakov/Documents/retantion-future/public/styles.css](/Users/nikolay.bulgakov/Documents/retantion-future/public/styles.css)
- [/Users/nikolay.bulgakov/Documents/retantion-future/data/block-catalog.json](/Users/nikolay.bulgakov/Documents/retantion-future/data/block-catalog.json)

## Последний важный коммит

- `cf49914` — `Improve email-base draft mapping and locale preview`

Он уже запушен в `origin/main`.

## Что уже реально работает

### 1. Chat-centric workflow

- чат — главный вход;
- в чат можно вставлять скрины, translation files, locale folder, картинки;
- `Cmd/Ctrl + V` для скрина работает, если в буфере именно image;
- обычный текстовый диалог и команды на сборку draft разделяются автоматически.

### 2. Реальный preview через `email-base`

Студия больше не рендерит только локальный demo-preview.
После сборки draft она создает временный `mail-*`, прогоняет его через реальный `email-base build`, забирает built HTML и удаляет temp-файлы.

### 3. Локали и preview по языкам

- поддерживаются locale tabs под preview;
- можно копировать HTML текущей локали кнопкой `Копировать HTML`;
- locale matching исправлен:
  - `en` матчится на `en_US`,
  - `ar` матчится на `ar_KW`,
  - не создается лишний голый `en`, если уже есть `en_US`.

### 4. Arabic / RTL

Для арабских локалей built HTML уже проходит через RTL post-process:
- добавляется `dir="rtl"`;
- выравнивание уходит вправо;
- preview для `ar_KW` уже это показывает.

### 5. `X_System` system-verification profile

Для системного verification/passbook кейса есть отдельный template profile, который идет через референс из базы, а не через generic promo layout.

### 6. `X_AffSystem/password reset` profile

Для `X_AffSystem/mail-password-retrieving-affiliate` добавлен отдельный профиль `aff-password-reset`.

Smoke-тесты показали:
- `templateProfile = aff-password-reset`
- `previewSource = email-base-draft`
- локали: `en_US`, `ru_RU`, `ar_KW`
- affstore logo реально попадает в built HTML
- английский, русский и арабский заголовки попадают в свои локали
- `ar_KW` идет с `dir="rtl"`

## Что еще не доведено

### 1. Свободный mapping любого макета на базу

Это главный незавершенный кусок.

Сейчас хорошо работают только некоторые явные профили:
- `system-verification`
- `aff-password-reset`

Для произвольного нового письма студия все еще может:
- выбрать не тот reference template;
- уйти в слишком общий built draft;
- недоиспользовать прикрепленный translation bundle.

### 2. Attach UX

Серверная логика уже лучше, но UX еще сырой:
- attach-меню может быть неочевидным;
- человеку не всегда понятно, что ушло в `design`, что в `translation bundle`, а что в `assets`.

Идея, которую пользователь явно хочет:
- рядом с `Отправить` должна быть attach-кнопка;
- все загруженное должно появляться компактными индикаторами сверху;
- по нажатию на индикатор можно заменить/очистить/отредактировать вложение;
- даже неумелый пользователь должен суметь работать через обычный диалог.

### 3. Follow-up правки после первой сборки

Кейс с:
- заменой лого по URL
- просьбой сделать `Dear Client` жирным

частично работает:
- logo override уже доходит до built HTML;
- `bold phrase` сервер распознает и правит структуру;
- но этот поток еще нужно дотестировать на реальном built output для конкретных шаблонов.

### 4. Generic brand/template selection

Пока еще не сделан надежный слой:
- “по такому дизайну и такому бренду выбрать правильный reference mail в базе”

Именно он нужен, чтобы студия не уезжала в “стоковый” шаблон.

## Что пользователь уже четко хочет от продукта

1. Первая картинка или Figma reference обычно считается дизайном письма.
2. Картинки внутри письма должны задаваться отдельно и осмысленно.
3. Студия не должна вставлять design-скрин в письмо как контентную картинку.
4. Студия должна собирать письмо на основе вашей `email-base`.
5. Если в базе нет нужного блока:
   - создать `block candidate`,
   - а не лепить случайную верстку.
6. Диалог должен быть “человеческий”, без технических полей на экране.
7. Локали должны переключаться как вкладки и менять:
   - preview,
   - код,
   - HTML для копирования.
8. Для арабской локали итоговая верстка должна быть RTL.
9. В будущем нужен controlled design workspace:
   - скрин,
   - image export,
   - public Figma frame,
   - а позже plugin/API.

## Что пользователь уже импортировал в базу

Пользователь добавил много старых писем, в том числе:
- `X_System`
- `X_CasaTradeAffiliate`
- `X_AffSystem`
- еще более сложные письма и бренды позже

Каталог блоков уже расширился, но imported `email-base` каталоги пока локально не закоммичены.

## Что сейчас локально НЕ закоммичено

Локально в рабочем дереве остались:
- runtime-файлы:
  - `data/asset-registry.json`
  - `data/studio-journal.json`
  - `data/assets/`
- импортированные пользователем директории и файлы в `email-base/...`

Это важно: их не надо случайно сносить или откатывать.

## Как запустить

```bash
cd /Users/nikolay.bulgakov/Documents/retantion-future
npm start
```

Открыть:

- [http://localhost:3000](http://localhost:3000)

Если страница держит старый фронт:

- `Cmd + Shift + R`

## Проверенные smoke-тесты

### Smoke 1: `X_AffSystem` password reset

Сценарий:
- category: `X_AffSystem`
- campaign: `Affstore password reset`
- design: прикрепленный скрин
- logo override:
  - `https://fsms.iqoption.com/storage/public/cb/db/mkjld2762c0fsgk0/Affstore-Logo.png`
- translation bundle:
  - `en_US`
  - `ru_RU`
  - `ar_KW`

Ожидаемое:
- профиль `aff-password-reset`
- локали `en_US/ru_RU/ar_KW`
- `ar_KW` в RTL
- affstore logo в built HTML
- password reset copy в built HTML

### Smoke 2: `X_System` passbook verification

Сценарий:
- system письмо
- макет как design reference
- `ru` и `pt` локали

Ожидаемое:
- системный verification profile
- design не лезет в письмо как `img`
- preview идет через `email-base build`

## Следующие задачи

### Самые важные

1. Доделать generic template selection:
   - по бренду,
   - по категории,
   - по тексту запроса,
   - по design reference.

2. Доделать attach UX:
   - attach-кнопка рядом с `Отправить`,
   - компактные индикаторы вложений,
   - понятный replace/remove flow.

3. Довести locale UX:
   - tabs под `Тесты / Fit / Desktop / Mobile` уже есть,
   - дотестировать, что они корректно меняют preview и `Код`.

4. Расширять template profiles по реальным письмам из базы:
   - сначала простые системные и affiliate кейсы,
   - потом более сложные бренды и промо-письма.

### Следом

5. Добавить `project rules` как более сильную память студии.
6. Улучшить follow-up edits:
   - замена лого,
   - локальные текстовые правки,
   - bold/replace/cta edits.
7. Доделать design workspace.

## Короткий текст для нового чата

Можно просто вставить это:

```text
Открой /Users/nikolay.bulgakov/Documents/retantion-future/docs/CHAT-HANDOFF.md и сначала прочитай его вместе с README.md, docs/PROJECT-OVERVIEW.md и docs/DEVELOPMENT-JOURNAL.md.

Это проект Future Retention Studio — локальная AI-студия для сборки писем на основе нашей email-base.

Последний важный коммит уже в origin/main: cf49914 Improve email-base draft mapping and locale preview.

Сейчас уже работают:
- реальный preview через email-base build,
- system-verification profile,
- aff-password-reset profile,
- locale matching en/en_US и ar/ar_KW,
- RTL для ar_KW,
- preview locale tabs и копирование HTML текущей локали.

Главная незавершенная задача:
- generic mapping новых писем и новых макетов на реальные шаблоны и блоки из базы, без ухода в generic fallback.

Не откатывай локальные изменения в email-base и data/assets: пользователь импортировал много писем локально, они еще не все закоммичены.
```

