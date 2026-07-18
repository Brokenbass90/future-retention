# Конструктор писем — 3-уровневая модель блоков (актуальный план)

> Живой документ. Заменяет прежнюю нарезку (canonical/imported), которая давала
> самодостаточные, но «не те» блоки. Эталон структуры — реальное письмо
> `email-base/X_IQ/mail-rfm-segmentation-2-233`.

## 1. Суть: три уровня вложенности

Письмо собирается из блоков трёх уровней (в конструкторе — три колонки):

| Уровень | Что это | Где живёт в базе | Примеры из rfm-233 |
|---|---|---|---|
| **Outer** (обёртка) | наружная часть письма: `doctype/html`, `include head` (стили проекта), `body.body`, `table.body → center → table.container → td`, preheader, footer, gmail-fix, и слот `include blocks/header` под контент | `index.jade` | одна на письмо |
| **Section** (внутренне-внешний) | секция-обёртка `table.row.*` с колоночной сеткой (`twelve/eleven/ten`), offset, паддингами | строки `table.row…` в `header.jade` | `brad-full.bgr-image`, `brad-full.white-bg`, `row` (плоская) |
| **Inner** (внутренний) | контент внутри секции: текст, картинка, кнопка, карточка, стор-бейджи, соцсети, разделители | содержимое `td` секций | `.gray-block`, `table.w280` CTA, `.asset-block`, `.stor`, `.socials`, `.h-12` |

Сборка вкладывается: **outer → (section)\* → (inner)\***.

## 2. Слой авторинга: Pug + Stylus (сейчас), HTML (на будущее)

**Сейчас** блоки авторятся и хранятся как `{ pug, styl, slots }` и компилируются
студией через `build-mail.js` в нормальный HTML вашей базы. Ключевое поведение
компайла (`vendor/helpers/head.pug`, переменная `headCss`):

- обычные CSS-правила **инлайнятся** в элементы;
- в `<style>` головы остаются **только** `@media / @supports / @font-face / @keyframes`.

Поэтому «стили собираются в этом теге» = в голову стекается **мобильный
адаптив (`@media`)**, остальное расходится инлайном. На сборке письма все `@media`
всех блоков объединяются и **дедупятся** в один `<style>`.

**На будущее (второй режим): самодостаточный HTML.** Блок = HTML-кусок со своим
инлайном и своим `<style>`; ассемблер склеивает и дедупит `<style>` в один.
Прототип и рабочий ассемблер уже есть: `email-base/_blocks-proto/` +
`assemble.mjs` (собирает `_test/assembled.html`). Пригодится для drag-and-drop
произвольного HTML. Пока в проде — Pug-путь.

## 3. Правило разделения стилей (одинаково для обоих режимов)

- **Outer несёт фреймворк-голову проекта**: ресеты/клиентские фиксы, грид
  Foundation (`.row/.columns/.one…twelve/offsets`), базовую типографику,
  универсальные утилиты отступов (`.pbNN/.ptNN/.plrNN/.mlN`), мобильную раму
  (`table[class=body] …`). В Pug это `include vendor/helpers/head`.
- **Section/Inner несут ТОЛЬКО свои компонентные классы** (+ их `@media`).
  Каркасные классы (`.row/.columns/.wrapper/.offset-*/.pbNN`) не дублируются.
- На сборке всё объединяется; одинаковые правила/`@media` из разных блоков
  схлопываются (дедуп по нормализованному тексту правила).

## 4. Локали-токены и пер-локальные блоки

Контент несёт токены переводов вида `${{ <mail>.block_NN }}$`
(напр. `${{ RFM-2-3-3-second.block_05 }}$`) — их заполняет ваш locale-пайплайн
на экспорте, отдельно на каждый язык.

Часть блоков — **пер-локальные**: у соцсетей ссылки свои на язык
(`${{ socials-3.block_01 }}$` и т.д.). То есть слот может быть не только «текст»,
но и «ссылка, различающаяся по локали». Конструктор должен позволять создать
такой блок с наборами значений по локалям.

## 5. Схема блока (расширение существующей)

Текущая схема (`server.js`, `/api/blocks-library/save`): `placement ∈ {section, inline, helper}`.
Расширяем под три колонки:

```jsonc
{
  "id": "iq-section-white-ten",
  "label": "Секция — белая, 10 колонок",
  "placement": "outer" | "section" | "inner",   // + helper (служебное)
  "category": "hero|cta|text|image|feature-list|footer|utility|wrapper",
  "source": "canonical" | "user" | "imported",
  "pug":  "...",     // Pug-фрагмент
  "styl": "...",     // ТОЛЬКО свои классы + @media
  "slots": [ { "id":"block_05", "kind":"text|richText|url|image|color|number|localizedUrl", "perLocale": true? } ]
}
```

- Расширить enum `placement` → добавить `outer` и `inner` (можно маппить
  `inner`↔старый `inline`).
- Добавить kind `localizedUrl` (значения по локалям) для соцсетей и подобного.
- **Ручное создание блока сохраняется** (`POST /api/blocks-library/save` → `user/`).

## 6. Дедуп при нарезке

Похожие section/inner схлопываем в один блок по «скелету» (структура без
контента). Из rfm-233: 4 карточки `.asset-block` → один inner-блок; две
`table.row.brad-full.white-bg` (10 колонок) → один section (паддинги — параметры).
Контент/картинки → слоты-заглушки, реальные значения подставляются на вёрстке.

## 7. Инвентарь блоков из rfm-233 (что пересобрать)

**Outer (1):** обёртка `index.jade`.

**Section (уникальные скелеты):**
- `row.brad-full.bgr-image` · `td.wrapper.last.pt0` · `twelve.columns` (hero с фоном)
- `row.brad-full.white-bg[.line-mob]` · `offset-by-one` · `eleven.columns`
- `row.brad-full.white-bg` · `offset-by-one` · `ten.columns` (паддинги — параметр)
- `row` (плоская) · `offset-by-one` · `ten.columns` (стор-бейджи)
- `row` (плоская) · `twelve.columns` (соцсети)
- разделители: `.h-12 / .h-20 / .h-32` → один inner-блок «спейсер» с параметром высоты

**Inner:**
- лого + картинка-хедер (ссылка+img)
- заголовок на фоне: `p.white-title` + `p.white-text`
- `p.middle-title` + `p.text` (текстовый блок)
- CTA-кнопка `table.w280 > td.butt > a.butt-link`
- `.w280-2` + `img.bottom-img` (текст слева + картинка)
- `.asset-block` — карточка «иконка + название» (×4 → 1)
- `p.data` — пилюля-плашка
- центрированная картинка `img.center`
- `.stor` — стор-бейджи (App Store / Google Play)
- `.socials` — соцсети, ссылки **пер-локальные**

## 8. Статус и порядок работ

- [x] Старые canonical-блоки (14) убраны в `data/block-library/_deprecated-canonical/` (обратимо). `user/` цел.
- [x] Эталон определён: `mail-rfm-segmentation-2-233`.
- [x] Прототип HTML-режима + ассемблер: `email-base/_blocks-proto/` (записан на будущее).
- [ ] Расширить `placement` (+`outer`,`inner`) и слот-kind `localizedUrl` в `server.js` + палитре.
- [ ] Собрать outer-блок (из `index.jade`) в новую схему.
- [ ] Нарезать section-блоки (уникальные скелеты, п.7) → `canonical/`.
- [ ] Нарезать inner-блоки (п.7, с дедупом `.asset-block`) → `canonical/`.
- [ ] Конструктор: три колонки (Outer / Section / Inner) вместо Outer/Inner.
- [ ] Компоновка: вкладывать section в outer, inner в section; проверить дедуп `@media` на живой сборке.
- [ ] Экспорт → locale-пайплайн → финальные HTML по языкам.

---

## Журнал реализации (сессии 2026-07-08)

### Сделано и проверено сборкой (`build=0`)
- **3-уровневая модель + параметрическая секция.** `placement` расширен: `outer / section / inner / both / helper`. Средний блок `iq-section` — параметрический (фон/колонки/offset/паддинги/рамка = слоты). Старые canonical (14) в `data/block-library/_deprecated-canonical/`.
- **Библиотека блоков (canonical, новые):** `iq-outer-wrapper`, `iq-section`, `iq-section-hero-bg`, `iq-spacer` (both), `iq-text-title`, `iq-cta-button`, `iq-socials`, `iq-footer`, `iq-step-card`, `iq-promocode`, комбо: `iq-combo-hero-233`, `iq-combo-socials-row`, `iq-combo-promo-steps` (с `children`).
- **Вкладываемая компоновка** (`src/compose-email.js`): section — контейнер, inner вкладывается в слот `INNER_BLOCKS`; спейсер вкладывается в секцию, top-level только если следующий блок — секция. Outer исключён из контента (рама = скелет). Футер из скелета гасится (отдельный блок).
- **Стили:** блоки несут свои классы + `@media`; на сборке `build-mail` инлайнит обычный CSS, `@media` собирает в голову. Стили совпадают с реальными письмами.
- **Три вкладки палитры** Outer/Section/Inner/**Комбо**/All.
- **Комбо-пресеты:** дроп комбо с `children` → раскладывается на отдельные редактируемые/удаляемые блоки (`addToCanvas`).
- **Вложенная канва (дерево):** секции — контейнеры с зоной «＋ внутренний блок сюда», inner дропается ВНУТРЬ секции (section-aware drop). Reorder, Delete/Backspace-удаление.
- **Инспектор:** кнопка **⟨⟩ Код** (редактирование pug/styl блока), кнопка **﹢⟦⟧** у text/url слотов — вставка системного плейсхолдера.
- **Системные плейсхолдеры:** `data/placeholders.json` (`embedded.*`, `socials.*`, `app.*` — по локалям) + `GET /api/placeholders`.
- **База писем в конструкторе:** кнопка «🗂 База» → `/api/wb/emails` (те же данные, что в главном окне). Клик → открывает письмо в workbench (роут `/workbench?brand=&mail=` починен, workbench читает query).
- **Перенос в код:** `Save mail` → «Открыть в workbench?» → письмо в кодовом окне.
- **Превью шире**, мобильный вид — кнопка 📱.

### НЕ доделано (следующие заходы)
- **Парсер «письмо базы → блоки конструктора»** — 2-я логика открытия: из конструктора открыть готовое письмо и разобрать по тегам/классам на outer/section/inner. СЕЙЧАС «Открыть из Базы» ведёт в код (workbench), не в конструктор.
- **Неймспейсы по брендам** — создать по имени, свои блоки/стили.
- **Комбо hero/socials → children** (нужны атомарные блоки лого/иконок).
- **Подсветка drop-зон при drag section между секциями** (сейчас — по позиции).

### Добавлено (парсер + вложенная канва)
- **Вложенная канва (дерево)** — `public/constructor.js`: секции = контейнеры с зоной «＋ внутренний блок сюда», inner дропается ВНУТРЬ секции (section-aware drop, `flatIndexAfterSectionChildren`). CSS `.section-group/.section-children/.child-dropzone`.
- **Парсер «письмо базы → блоки» (2-я логика открытия)** — `GET /api/constructor/parse-email?brand=&mail=` разбирает `blocks/header.jade` по верхнеуровневой индентации на блоки (секции + спейсеры, placement/label/pug). В Базе кнопка «в конструктор» → `loadParsedEmail` грузит блоки на канву; «в код» → workbench. Проверено round-trip на rfm-233: разбор→пересборка со скелетом исходника→`build=0`.
- **Скелет исходника** пробрасывается в `compose-preview` и `compose-save` (`sourceBrand/sourceMail`), чтобы стили бренда сохранялись при пересборке parsed-письма.
- **Код блока редактируемый** (кнопка ⟨⟩ Код → asNew), **Delete/Backspace** удаляет, превью шире.

### Ещё осталось
- **Глубокий разбор** parsed-секций на атомарные inner (сейчас каждая `table.row` = один section-блок с контентом внутри; редактируется через ⟨⟩ Код).
- **Неймспейсы по брендам** в конструкторе.
- Комбо hero/socials → `children` (нужны атомарные лого/иконки).

### Аудит 2026-07-13 (read-only, без изменений кода)
- **RTL ломает письма — причина найдена и воспроизведена.** `email-base/tools/rtl.js` (после `ba416f1`) переписывает весь `<head>`-фреймворк (`common.css`), а не стили блока: `transformHeadStyles` глобально флипает `text-align:left→right` на базовых `table/td/p/h*`, а `swapPhysicalSidesInHeadStyles` свопит `padding/margin/float/background left↔right`. Главный виновник — `img{float:left}` во фреймворке становится `float:right`, и все картинки (лого/баннеры) уезжают. Раньше RTL был точечный → отсюда «работает не так, как раньше». Полный диагноз + минимальный безопасный фикс (вариант A: убрать оба head-прохода, оставить инлайн+точечные) + шаги проверки (`scripts/test-rtl.mjs`, визуальный гейт) → `docs/RTL-REGRESSION-FIX-FOR-CODEX.md`. **Фикс — код (`rtl.js` + паритетная копия в `public/workbench.js`), передан кодексу; вслепую не трогаю.**
- **Что проверено по data-only задачам:** imported-блоки (965 шт.) уже скрыты из палитры фильтром в `constructor.js` (`applyCatalogFilters`, строки 394-395 — `source==="imported"` → `false`); категории `misc` в данных нет. Отдельного data-фикса не требуется. Единственный оставшийся минус imported — они всё ещё грузятся с сервера в `state.library` (payload/counter «X из 985»); урезание — код в `server.js`/`compose-email.js`, к кодексу.
