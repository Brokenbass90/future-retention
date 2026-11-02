# Handoff: изменения Claude, сессия 2026-07-20

Для Codex: всё ниже сделано и проверено локально, готово к коммиту и деплою.
Рабочее дерево содержит только эти изменения + ранее незакоммиченные
`data/block-library/user/iq-combo-socials-row.json` и `email-base/vendor/data/*/soc-block-2.json`
(они не мои — появились в прошлых сессиях, решите сами, коммитить ли).

## 1. Починка бага «письмо пропало» (Invalid locale namespace)

**Симптом:** `/api/wb/build-email` возвращал 422 `Invalid locale namespace: !TESTEBTVOUMAT`,
preview пустой, выглядело как потеря письма.

**Причина:** имя namespace с `!` (создано до появления валидации) было вшито в
плейсхолдеры `X_preview/mail-welcome-demo-copy-test/app/templates/blocks/header.pug`
и залипло в localStorage. Сервер справедливо отвергает такие имена.

**Исправлено:**
- `email-base/X_preview/mail-welcome-demo-copy-test/app/templates/blocks/header.pug` —
  `${{ !TESTEBTVOUMAT.block_NN }}$` → `${{ TESTEBTVOUMAT.block_NN }}$` (2 места).
- `public/workbench.js` — в легаси-восстановлении из `LS_NAMESPACES`
  (функция загрузки состояния, ~строка 9905) добавлен вызов
  `ensureValidNamespaceNames(state.namespaces)` — самолечение старых сохранений.
  Новые пути уже были закрыты вашими `ensureValidNamespaceNames` / `repairInvalidNamespaceTokens`,
  этот был единственный пропущенный.

## 2. База писем в конструкторе: предпросмотр + контекстное меню

`public/constructor.js` — переписан IIFE `initBaseBrowser` (модалка «🗂 База»):

- **Окно предпросмотра справа (344px):** hover по строке (дебаунс 140мс) показывает
  собранное письмо в масштабированном iframe (`/api/wb/email`, только dist HTML,
  `sanitizeIframePreviewHtml`, `sandbox="allow-same-origin"`, скролл внутри панели).
  Клик по строке «закрепляет» предпросмотр (📌), повторный клик открепляет.
  Несобранные письма — честное «нет HTML для предпросмотра».
- **Мини-превью в строках:** 40×52px iframe в каждой строке, лениво через
  IntersectionObserver (root = список, rootMargin 120px), HTML кэшируется в Map
  и переиспользуется большим предпросмотром.
- **Контекстное меню (ПКМ по строке):**
  - 🎨 Открыть в конструкторе (существующий `loadParsedEmail`)
  - ⟨⟩ Открыть в коде (`/workbench?brand=&mail=`)
  - 📋 Дублировать… → `POST /api/wb/email-clone { brand, mail, newName }`
  - ✏️ Переименовать… → `POST /api/wb/email-rename`
  - 🗑 Удалить (в _trash) → `POST /api/wb/email-delete`
  - Имена нормализуются (`normalizeMailFolderName`: только `[a-zA-Z0-9_-]`,
    автопрефикс `mail-`), после мутаций список перечитывается, кэш инвалидируется.
  - Меню закрывается по клику мимо и Escape (Escape сначала закрывает меню, потом модалку).

Серверные эндпоинты уже существовали — новых API нет.

## 3. Уборка

- Удалён `email-base/X_preview/mail-smoke-roundtrip-1784098344925` (+ dist) —
  остаток прогона smoke.
- Удалён `public/XXX05lrD` — случайная копия constructor.js (мусор).
- `scripts/studio-smoke.mjs` — cleanup теперь пишет warning, если не смог удалить
  за собой (раньше молча глотал ошибку — так и появился остаток).

## 4. Прогнано (всё зелёное)

- Живой e2e всего стека через API: compose-save (DnD-блоки: iq-outer-wrapper →
  iq-section (slotId **"sections"** у обёртки!) → iq-text-title) → чтение Pug →
  `/api/wb/placeholderize-source` (2 плейсхолдера) → сохранение Pug через
  `/api/wb/email-file` (путь относительно `app/`, поле `file`) →
  `/api/wb/build-email` с namespace en+ru → `/api/wb/code-html` обеих локалей
  с переводами. Временное письмо убрано.
- `scripts/audit-ui-controls.mjs` — dead: [], duplicateIds: [] на обеих поверхностях.
- `scripts/test-workbench-code-flow.mjs` — ✓.
- Живая проверка clone/delete эндпоинтов на X_preview — ✓.
- `node --check` на всех правленых файлах.

## 5. Соцсети в футере: builtin namespace `soc-block-2` (сессия 2026-07-20, продолжение)

- **`email-base/vendor/data/<locale>/soc-block-2.json` — во всех 30 локалях.**
  10 локалей со своими ссылками уже были (совпадают с загруженными TXT 10917_*),
  добавлено 20: копия en для всех остальных, ar_KW←ar, ru_RU←ru.
  Сборка не умеет фолбэк между локалями — файл обязан лежать в каждой папке.
- **`data/builtin-namespaces.json`** — зарегистрирован `soc-block-2` (builtin, замок в UI,
  как footer_upload): block_00 TikTok, 01 Instagram, 02 Dashboard, 03 YouTube,
  04 Telegram, 05 Facebook. В `locales` только 10 «родных» локалей.
- **Новый канонический блок `data/block-library/canonical/iq-footer-socials.json`** —
  ряд социконок из присланного jade/stylus (классы .socials/.soc-icon и медиазапросы
  сохранены). href-слоты по умолчанию = `${{ soc-block-2.block_NN }}$` (встроенные ключи
  остаются), любую ссылку/иконку можно переопределить слотом. Добавлены `universal="true"`
  и `alt` — конвенция базы. Проверено сборкой: en — глобальные ссылки, ar — арабские
  IG/TG, ru — фолбэк на en, токенов в HTML не остаётся. `npm run test:blocks` ✓.
- **Старые комбо помечены `retired: true`** (iq-combo-hero-233, iq-combo-promo-steps,
  iq-combo-socials-row): скрыты из каталога конструктора
  (`catalogSourceAllowed` в constructor.js — одна строка), но файлы оставлены,
  потому что на их id завязаны design-compose и тесты
  (test-agent-compose, test-design-compose, test-figma-plugin-intake,
  test-constructor-tree-policy). Когда появятся новые комбо из нарезки —
  заменить id в design-compose/тестах и удалить файлы. Копия из
  `data/block-library/user/iq-combo-socials-row.json` удалена (была untracked).

## 6. Нарезка семьи 233 + инфраструктура (сессия 2026-07-20, вечер)

- **Builtin-неймспейсы всегда в конце.** `public/workbench.js`: новая
  `ensureBuiltinNamespacesLast()` вызывается в `renderNamespaceBar()` —
  footer_upload / soc-block-2 сортируются после рабочих namespace письма,
  даже если пользователь импортирует новые TXT после загрузки builtin'ов.
- **Gmail-blend в встроенной библиотеке стилей.**
  `email-base/vendor/styles/head-extra.styl` (включается глобально в каждую
  сборку, см. build-mail.js ~549): `u + .body .gmail-blend-screen/diff` —
  защита от инверсии цвета в тёмной теме Gmail. Обёртки-div инертны в
  остальных клиентах. Скелетную копию НЕ делал — global head-extra покрывает всё.
- **Два новых комбо** (данные от пользователя, плейсхолдеры заменены стабами
  "Title text"/"Step one text"/"PROMOCODE"…):
  - `data/block-library/canonical/iq-combo-hero-bgr.json` — шапка 233: лого,
    головная картинка, дата-бейдж + белый заголовок/текст в gmail-blend
    обёртке, CTA. Слоты на все тексты/ссылки/картинки.
  - `data/block-library/canonical/iq-combo-steps-promocode.json` — белая карта
    с рамкой (слот border, деф. `4px solid #FF7700`), два шага в .gray-block,
    промокод (dashed) + сноска внутри второго шага (как в оригинале), CTA.
  - Каждое комбо несёт свой styl-сабсет (классы, которых нет в скелете:
    bgr-image, white-bg, gray-block, promocode, small-gray-text, w100 и т.д.).
- **`iq-hero-copy` v2** — title/body обёрнуты в gmail-blend пару.
  `iq-hero-date` НЕ трогал: его фон на самой ячейке, обёртка не защитит;
  для защищённой даты использовать комбо.
- **Проверки:** `npm run test:blocks` ✓ (оба комбо + hero-copy);
  живая сборка «хеддер + шаги + соцфутер»: en — глобальные соцссылки,
  ar — арабские, стабы на месте, blend-CSS в head, неразрешённых токенов нет.
  Замечание: в локали `base` (Original) токены `${{ }}$` остаются — это
  штатно, разрешение происходит в локалях.

## 7. Трёхуровневая пересборка 233 + footer_upload (сессия 2026-07-21)

Пользователь объяснил таксономию: **секции = пустые обёртки** (INNER_BLOCKS),
**внутренние = наполнение**, **комбо = recipe из секций+внутренних** (формат
`combo: true` + `children` — как у старых retired-комбо, механика
`instantiateCombo` в constructor.js раскладывает на отдельные редактируемые блоки).

- **4 новые секции-обёртки** (точная разметка пользователя):
  `iq-section-card-border` (белая карта, слот border, деф. 4px оранж),
  `iq-section-card` (белая без рамки, eleven), `iq-section-center-row`
  (прозрачный центрированный ряд), `iq-section-text-row` (прозрачный текстовый).
  Для hero переиспользован существующий `iq-section-hero-bg` (media+content слоты).
- **13 внутренних атомов** со стаб-текстами: iq-date-badge, iq-white-title,
  iq-white-text (все три в gmail-blend), iq-gray-step, iq-gray-step-promo
  (промокод ВНУТРИ серого шага — как в референсе), iq-lead-bold,
  iq-promocode-box, iq-note-gray, iq-text-plain, iq-middle-title, iq-cta-w280,
  iq-logo-link, iq-image-link.
- **Оба комбо конвертированы в recipe** (children), монолитный pug оставлен
  как fallback для test:blocks/legacy. В hero-комбо добавлен спейсер 40px под CTA.
- **Выравнивание л/ц/п**: слот `align` (select) у всех текстовых атомов
  (text-align на p / blend-diff), у CTA (align на table), у картинок
  (обёртка div c text-align, img без жёсткого .center). Задел под RTL-флип.
- **footer_upload при сборке**: iq-footer v+1 — тексты ссылок теперь
  `${{ footer_upload.block_00/01 }}$`; создано 30 файлов
  `vendor/data/<locale>/footer_upload.json` из переводов builtin-namespaces.json
  (cn←zh, ar_KW←ar, ru_RU←ru, без перевода ← en). ВАЖНО: builtin-неймспейсы
  НЕ синкаются в vendor/data (skippedBuiltins) — для новых builtin-ключей
  файлы нужно раскладывать руками, как здесь и для soc-block-2.
- **Проверки**: test:blocks ✓ (все новые компилируются; полный прогон в
  sandbox упирается в 45с — гонял частями), живая сборка полного письма из
  5 секций: footer_upload en/ar локализуется («الشروط والأحكام»), промокод
  внутри шага, спейсер под кнопкой, align right/center в HTML, blend в hero,
  токенов не остаётся. constructor-tree ✓, ui-audit ✓.
- Горячие клавиши Delete/Backspace для удаления блока уже были (constructor.js
  ~3238) — работают при фокусе вне полей ввода.

## 8. Нарезка семьи 234: оранжевая панель, ассеты, сторы (сессия 2026-07-21)

- **5 новых внутренних атомов** (стабы вместо плейсхолдеров):
  `iq-orange-panel` (оранжевая подложка bcg.png: жирная подводка + ul-список
  из 2 пунктов + картинка справа, мобайл в столбик), `iq-asset-chip`
  (карточка актива: иконка + название, слот spacing mr16/no-gap для
  расстановки парами), `iq-promo-note` (серая сноска по центру),
  `iq-promo-note-link` (сноска с a.link внутри: текст до/ссылка/текст после),
  `iq-store-buttons` (App Store + Google Play, мобайл в столбик).
- **`iq-section-text-row` v2** — верхний отступ стал слотом `pt`
  (select pt0/pt30/pt50/pt68) вместо жёсткого pt50.
- **2 recipe-комбо**: `iq-combo-assets-orange` (карта: заголовок + панель +
  текст + 4 чипса US500/Bitcoin/Mag7/Gold парами) и `iq-combo-store-footer`
  (text-row pt68: сноска + сноска-Policy + сторы). У обоих children для
  instantiateCombo + полный монолитный pug со styl как fallback.
- **Проверено живой сборкой**: развёрнутый рецепт и монолиты компилируются,
  ul/li выживают, mr16 на чипсах, pt68 в секции, ссылка Policy, обе кнопки
  сторов, подложка панели — всё в HTML.

## 9. КРИТИЧНЫЙ ФИКС: compose затирал стили скелета (сессия 2026-07-21, вечер)

**Причина сломанных отступов и мобильного адаптива в композициях:**
`composeEmailFromBlocks` записывал `app/styles/blocks/main.styl` С НУЛЯ из
styl-кусков блоков, затирая родной main.styl скелета (600+ строк семьи:
вся pt/pb-шкала, h-*, center, m-w/w-a, мобильные media). Классы вроде pt44
оставались в разметке, но без CSS.

**Фикс** (`src/compose-email.js`, запись mainStyl): стили блоков теперь
ДОПОЛНЯЮТ скелетный main.styl (скелет первым, блоки после — при конфликте
классов блочные побеждают). Проверено: pt44/pb44/pt68 инлайнятся,
мобильные media чипсов и сторов доезжают до head.

Также:
- Из hero-комбо убран добавленный ранее спейсер-40 под CTA — родной отступ
  секции (content_padding «0 0 50px») вернулся вместе со стилями скелета,
  и вдвоём они давали гигантский зазор.
- В `iq-combo-store-footer` добавлена вторая секция рецепта —
  `iq-footer-socials` (сноски → сторы → соцсети, как в оригинале 234).
- `iq-footer-socials` и `iq-footer` получили тег `combo` — видны в фильтре
  «Комбо» каталога (пользователь ищет готовые ряды там).
- Тесты compose-tree / compose-save-transaction / constructor-tree-policy /
  agent-compose — зелёные после фикса.

## 10. Фикс превью Original: <span> в href ломал соцсети (сессия 2026-07-21)

**Симптом:** в локали Original соцсети рассыпались в столбик; в переводах ок.
**Причина:** подсветка плейсхолдеров в превью workbench оборачивала КАЖДЫЙ
токен `${{ }}$` в кликабельный `<span>`, включая токены внутри
`href="${{ soc-block-2.block_NN }}$"` — span внутри атрибута разрывает якоря.
**Фикс** (`public/workbench.js`): новый хелпер `htmlOffsetIsTextPosition()`
(позиция вне тега = lastIndexOf('>')>=lastIndexOf('<')); Original-подсветка
пропускает токены в атрибутах, `applyNamespaceLocale` в атрибуты подставляет
голое значение без span и без &nbsp;-заглушки.

Также: `iq-image-link` v+1 — на img добавлен `float:none` (базовый ink-стиль
`img{float:left}` ломал центрирование головной картинки hero).

Замечание к письму пользователя welcome-demo: пустой label у ссылки Policy —
артефакт конкретной старой сборки (в свежей композиции дефолт «Link text»
рендерится, проверено), а футер там ещё со старыми `${{ footer.footer.* }}$`
токенами — пересохранение из конструктора переведёт на footer_upload.

## 11. Хеддер 325: фон-сцена + панель с аватаром (сессия 2026-07-21)

- **`iq-hold-spacer`** — держатель места произвольной высоты с ИНЛАЙН
  line-height/height (аналог .h-406, но работает с любым значением без
  зависимости от классов h-*). Слот height, деф. 335.
- **`iq-opacity-panel`** — панель .opacity-block: малый белый заголовок,
  аватар 50px + белый текст. Ячейка аватара на инлайн-ширине 74px —
  НАМЕРЕННО без класса m-w-2 (в 325 он 74px, в 234 — 48px: глобальный класс
  конфликтовал бы между блоками в одном письме).
- **`iq-white-title` v3** — слоты font_size/line_height (деф. 42px/52px, 233);
  325 передаёт 48px/58px инлайн.
- **`iq-combo-hero-space`** — recipe-комбо: hero-секция с фоном-сценой
  3-2-5-head.png (media_padding «0 0 5px»), лого, держатель 335px,
  заголовок 48px, opacity-панель. Монолитный pug+styl как fallback.
- Проверено сборкой: фон, 335px, 48/58 инлайн, панель с orange-bg-opac,
  аватар, blend — всё в HTML. Рецепт и монолит компилируются.

## 12. AI переведён на новую библиотеку (сессия 2026-07-21, ночь)

- **`list_canonical_blocks` (src/ai-tools.js)** — retired-блоки скрыты от AI
  (агент больше не может выбрать устаревшие комбо).
- **`src/design-compose.js`**: кандидаты фильтруются от retired;
  PREFERRED_BLOCK_BY_CATEGORY → новые recipe-комбо (hero: iq-combo-hero-bgr,
  cta/feature-list: iq-combo-steps-promocode); ветка date/eyebrow/kicker/badge
  перенесена ВЫШЕ body-ветки — `date_text` съедал текст тела письма
  (суффикс _text матчился body-паттерном), body_text оставался пустым.
- **`iq-combo-steps-promocode`** — category сменена на `cta` (дизайн-схемы
  размечают такие секции как cta; feature-list не находился при маппинге).
- **Тесты обновлены на новые id и имена слотов** (title_text/body_text/
  head_image): test-design-compose (10/10 ✓), test-figma-plugin-intake (8/8 ✓);
  agent-compose, compose-tree, ai-intent-routing — ✓.
- **Демо `X_assembled / 325-demo`** оставлено в базе: полное письмо 325-й
  семьи (hero-сцена + карта с панелью/чипсами + сноски/сторы + соцсети +
  футер), собрано и локализовано, токенов в en нет.

## Известные зазоры (не делал, кандидаты на следующий цикл)

- У AI-агента (src/ai-tools.js, 25 инструментов) нет прямого
  read/write произвольного Pug/Stylus файла письма — только через открытый
  файл в workbench-чате. Для «AI верстает с нуля» хватает compose_email_from_blocks.
- Мини-превью нет в панели «База писем» самого workbench — портировать при желании.
- `scripts/promote-sliced-blocks.mjs` упоминает старые бренды только в комментарии — безвредно.
