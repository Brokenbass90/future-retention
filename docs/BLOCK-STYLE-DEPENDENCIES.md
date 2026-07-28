# Зависимости стилей блоков — что придётся втянуть при автоскоупе

Сгенерировано: 2026-07-27T12:48:33.419Z · `node scripts/audit-block-styles.mjs`

Отчёт отвечает на вопрос «что сломается, если оторвать блоки от `main.styl` семьи».
Каждый класс из разметки блока разложен на: свой (в `styl` блока), фреймворковый
(ink/vendor, остаётся глобальным), из семьи (надо втянуть внутрь блока) и
отсутствующий (CSS нет нигде).

## Сводка

| | блоков |
|---|---|
| всего в библиотеке | 492 |
| **уже самодостаточны** (только свои + фреймворк) | **256** |
| опираются на классы семьи | 236 |
| используют классы, которых нет нигде | 187 |
| используют фреймворковые классы, переопределённые семьёй | 278 |
| требуют решения руками (многозначный класс) | 61 |

Реестр: 675 классов, 56634 правил, 96 писем.

## Классы семьи, которые надо втянуть в блоки

| класс | в скольких блоках | смыслов в базе | вердикт |
|---|---|---|---|
| `.m-w` | 57 | 10 | ⚠️ решать руками |
| `.w100` | 9 | 1 | ✅ переносится автоматом |
| `.bgr-image` | 2 | 30 | ⚠️ решать руками |
| `.link` | 2 | 1 | ✅ переносится автоматом |
| `.first-td` | 1 | 1 | ✅ переносится автоматом |
| `.last-td` | 1 | 1 | ✅ переносится автоматом |
| `.h-12` | 1 | 3 | ⚠️ решать руками |
| `.h-40` | 1 | 4 | ⚠️ решать руками |
| `.header` | 1 | 3 | ⚠️ решать руками |

## Классы без CSS — в разметке есть, стилей нет

Это либо опечатки, либо остатки от удалённых семей. Втягивать нечего:
класс надо либо убрать из разметки, либо дописать ему правила.

| класс | в скольких блоках |
|---|---|
| `.centet` | 31 |
| `.first-link` | 11 |
| `.last-link` | 11 |
| `.pt` | 2 |
| `.pt8` | 2 |
| `.button-wrapper_left` | 2 |
| `.code` | 2 |
| `.offset` | 1 |
| `.cols` | 1 |
| `.pb` | 1 |
| `.iq-footer-socials` | 1 |
| `.table-margin` | 1 |
| `.iq-asset-chip` | 1 |
| `.spacing` | 1 |
| `.iq-combo-assets-orange` | 1 |
| `.no-gap` | 1 |
| `.iq-combo-hero-space` | 1 |
| `.iq-section-text-row` | 1 |
| `.apps` | 1 |
| `.iq-combo-hero-bgr` | 1 |
| `.iq-combo-steps-promocode` | 1 |
| `.iq-combo-store-footer` | 1 |
| `.iq-cta-w280` | 1 |
| `.iq-gray-step-promo` | 1 |
| `.iq-gray-step` | 1 |
| `.iq-hold-spacer` | 1 |
| `.iq-image-link` | 1 |
| `.iq-lead-bold` | 1 |
| `.iq-logo-link` | 1 |
| `.iq-note-gray` | 1 |

## Блоки, которые нельзя мигрировать автоматом

| блок | источник | многозначных классов | какие |
|---|---|---|---|
| `iq-combo-promo-steps` | canonical | 2 | `.h-12`(3), `.h-40`(4) |
| `iq-feature-list-06` | imported | 1 | `.m-w`(10) |
| `iq-feature-list-10` | imported | 1 | `.m-w`(10) |
| `iq-combo-hero-space` | canonical | 1 | `.bgr-image`(30) |
| `iq-cta-04` | imported | 1 | `.m-w`(10) |
| `iq-cta-15` | imported | 1 | `.m-w`(10) |
| `iq-cta-20` | imported | 1 | `.m-w`(10) |
| `iq-cta-21` | imported | 1 | `.m-w`(10) |
| `iq-feature-list-07` | imported | 1 | `.m-w`(10) |
| `iq-feature-list-08` | imported | 1 | `.m-w`(10) |
| `iq-feature-list-09` | imported | 1 | `.m-w`(10) |
| `iq-feature-list-11` | imported | 1 | `.m-w`(10) |
| `iq-feature-list-12` | imported | 1 | `.m-w`(10) |
| `iq-feature-list-13` | imported | 1 | `.m-w`(10) |
| `iq-feature-list-20` | imported | 1 | `.m-w`(10) |
| `iq-feature-list-42` | imported | 1 | `.m-w`(10) |
| `iq-feature-list-43` | imported | 1 | `.m-w`(10) |
| `iq-feature-list-55` | imported | 1 | `.m-w`(10) |
| `iq-feature-list-57` | imported | 1 | `.m-w`(10) |
| `iq-feature-list-58` | imported | 1 | `.m-w`(10) |
| `iqbroker-cta-14` | imported | 1 | `.m-w`(10) |
| `system-header-01` | imported | 1 | `.header`(3) |
| `iq-section-hero-bg` | canonical | 1 | `.bgr-image`(30) |
| `iq-cta-23` | imported | 1 | `.m-w`(10) |
| `iq-feature-list-21` | imported | 1 | `.m-w`(10) |
| `iq-feature-list-22` | imported | 1 | `.m-w`(10) |
| `iq-feature-list-23` | imported | 1 | `.m-w`(10) |
| `iq-feature-list-24` | imported | 1 | `.m-w`(10) |
| `iq-feature-list-25` | imported | 1 | `.m-w`(10) |
| `iq-feature-list-26` | imported | 1 | `.m-w`(10) |

## Блоки, готовые к скоупу прямо сейчас

256 шт. — все их классы либо свои, либо фреймворковые.

`iq-combo-hero-233`, `iq-cta-button`, `iq-date-badge`, `iq-footer`, `iq-hero-copy`, `iq-hero-date`, `iq-hero-image`, `iq-hero-logo`, `iq-middle-title`, `iq-outer-wrapper`, `iq-promocode`, `iq-section-spacer`, `iq-socials`, `iq-step-card`, `iq-text-title`, `iq-white-text`, `iq-white-title`, `iq-cta-01`, `iq-cta-12`, `iq-cta-14`, `iq-cta-17`, `iq-cta-18`, `iq-cta-19`, `iq-cta-24`, `iq-cta-25`, `iq-cta-26`, `iq-cta-27`, `iq-cta-29`, `iq-cta-30`, `iq-cta-31`, `iq-cta-33`, `iq-cta-34`, `iq-cta-35`, `iq-cta-36`, `iq-cta-38`, `iq-cta-39`, `iq-cta-40`, `iq-cta-41`, `iq-cta-42`, `iq-cta-43`, `iq-cta-44`, `iq-cta-45`, `iq-cta-46`, `iq-cta-47`, `iq-cta-48`, `iq-cta-49`, `iq-cta-50`, `iq-cta-52`, `iq-cta-53`, `iq-cta-54`, `iq-feature-list-02`, `iq-feature-list-03`, `iq-feature-list-04`, `iq-feature-list-05`, `iq-feature-list-14`, `iq-feature-list-15`, `iq-feature-list-16`, `iq-feature-list-18`, `iq-feature-list-19`, `iq-feature-list-29`, `iq-feature-list-30`, `iq-feature-list-31`, `iq-feature-list-32`, `iq-feature-list-33`, `iq-feature-list-39`, `iq-feature-list-40`, `iq-feature-list-50`, `iq-feature-list-51`, `iq-feature-list-52`, `iq-feature-list-53`, `iq-feature-list-54`, `iq-feature-list-70`, `iq-feature-list-71`, `iq-footer-01`, `iq-footer-02`, `iq-footer-05`, `iq-footer-06`, `iq-footer-07`, `iq-footer-08`, `iq-footer-11` … и ещё 176

## Попутно

- Блоков с мёртвым собственным CSS (класс определён в `styl`, но в разметке блока не используется): **302**.
