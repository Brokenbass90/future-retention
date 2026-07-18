# RTL-регрессия: диагноз и безопасный фикс (для кодекса)

Дата: 2026-07-13. Автор записки: аудит без изменений кода.
Симптом от пользователя: «RTL/локали сейчас работают не так, как раньше — они ломают письмо».

## Короткий вывод

`email-base/tools/rtl.js` (после коммита `ba416f1`) перестал следовать собственному
принципу «менять как можно меньше». Появились проходы, которые переписывают **весь
`<style>` в `<head>`** — то есть общий фреймворк (`common.css`), а не стили конкретного
блока. Раньше RTL точечно ставил `dir` + `text-align:right` на текстовые элементы; теперь
он глобально флипает выравнивание, `float`, `padding/margin` и `background` во всём каркасе.
Это и есть «работает не так, как раньше».

## Воспроизведение (read-only, подтверждено)

```js
const { applyRtl } = require("./email-base/tools/rtl.js");
const head = `<style>
td.offset-by-one{padding-left:50px}
.fl-l{float:left}.fl-r{float:right}
table,tbody,tr{padding:0;text-align:left}
h1,h2,h3,h4,h5,h6,p,table.body,td{color:#222;text-align:left}
img{float:left}
</style>`;
console.log(applyRtl(head));
```

Результат:

```
td.offset-by-one{padding-right: 50px}     // сдвиг всей колоночной сетки
.fl-l{float: right}.fl-r{float: left}
table,tbody,tr{...text-align: right}      // базовый дефолт всего документа
h1..h6,p,td{...text-align: right}
img{float: right}                         // КАЖДАЯ картинка в письме
```

Самое разрушительное — `img{outline:none;...float:left;clear:both}` во фреймворке это
глобальный сброс для всех изображений. RTL переворачивает его в `float:right`, и все
некартинки-по-центру (логотипы, баннеры, иконки) уезжают на другую сторону. Плюс
глобальный флип `text-align:left→right` на базовых `table/td/p/h*` меняет выравнивание
даже там, где дизайнер явно ждал `left`.

## Где именно в коде

`email-base/tools/rtl.js`, функция `applyRtl` (около строки 631). Проблемные проходы,
которые работают по всему документу, включая head-фреймворк:

- `transformHeadStyles(out)` — флипает `text-align` внутри каждого `<style>`.
- `swapPhysicalSidesInHeadStyles(out)` — свопит `padding-left↔right`, `margin-left↔right`,
  `float:left↔right`, `background-position left↔right` внутри `<style>`.
- `flipAllInlineStyles` / `swapPhysicalSidesOnAllTags` — то же на инлайн-стилях всех тегов
  (это менее опасно, т.к. касается контента, но `img{float}` из head — главный виновник).

Структурные проходы `mirrorTwoColumnRows` (переставляет ячейки `m-w`/`w-a`) и
`smartMirrorButtonIcons` — вторичный риск: они физически двигают DOM по offset'ам и на
вложенных случаях могут побить разметку. Не главный виновник, но стоит перепроверить.

Важно: браузерная копия в `public/workbench.js` (функция `applyRtl`) должна остаться в
паритете — правку надо продублировать там же, иначе превью в студии и билд разойдутся.
Регресс-тест `scripts/test-rtl.mjs` уже проверяет оба трансформера.

## Минимальный безопасный фикс

Суть: не переписывать общий `<head>`-фреймворк, флипать только контент блоков.

Вариант A (самый простой и безопасный):
в `applyRtl` убрать `transformHeadStyles(out)` и `swapPhysicalSidesInHeadStyles(out)`.
Оставить инлайн-проходы (`flipAllInlineStyles`, `swapPhysicalSidesOnAllTags`,
`flipAlignOnAllTags`) и точечные `dir`/`text-align` на `p/h*/li`/leaf-div/butt-cell.
Тогда каркас (`common.css`) остаётся нетронутым, а RTL применяется к содержимому.

Вариант B (если нужна зеркальная колоночная сетка):
оставить head-проходы, но прогонять их через allowlist классов блоков (например только
`text-pad-small`, `offset-by-*`), а `img{float:left}` и базовые `table/td/p/h*` дефолты
исключить явным blocklist'ом. Дороже и рискованнее — начинать стоит с A.

## Как проверить, что не сломалось

1. `node scripts/test-rtl.mjs` — все кейсы зелёные (centered кнопки, left→mirror,
   idempotency, m-w/w-a).
2. Визуальный гейт: `scripts/visual-gate.mjs` (playwright+pixelmatch) на en/ur/ar для
   эталонных писем (`rfm-311`, `welcome`, `rfm-segmentation-2-232`). Сравнить с baseline
   в `tests/visual-baseline/`.
3. Ручной прогон одного письма build-mail в en и ur: логотип/картинки не должны менять
   сторону, колонка остаётся центрированной, текст выравнивается вправо.

## Что НЕ надо делать

- Не добавлять `dir="rtl"` на обёртки/layout-таблицы (это уже было и ломало сетку —
  см. `stripStaleDirRtl`).
- Не флипать `!important`-декларации (дизайнерский интент побеждает — уже соблюдается).
- Не трогать шорткат `padding: a b c d` (4-значный) регексом.
