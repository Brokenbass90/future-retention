# Migration notes (legacy -> modern email-only base)

## Цели

1. Убрать всё, что относится к лендингам/общему CSSSR-шаблону
2. Обновить сборку на **современный Node + gulp4**
3. Сделать письма легче: **инлайнить обычный CSS**, а в `<head>` оставлять **только** `@media/@supports/@font-face/@keyframes`
4. Сохранить текущий подход к переводам: плейсхолдеры `${{ file.key }}$` + JSON в `vendor/data/<locale>/...`

## Что сделано

- `gulpfile.js` переписан под gulp4 и теперь просто вызывает `node tools/build-mail.js`
- Добавлен `tools/build-mail.js`:
  - компилирует Stylus (`common.styl` или `inline.styl` если появится)
  - делит CSS на `headCss` и `inlineCss`
  - рендерит Pug (Jade) и инлайнит `inlineCss` без трогания `<head>`
  - делает локализованные копии HTML (по папкам локалей)
- `vendor/helpers/head.jade` больше не подключает внешний `common.css` — в `<head>` кладётся только `headCss`
- Старый gulp v3 сохранён в `_legacy/gulp-v3` (только для справки)
- Старый `dist` перенесён в `_legacy/dist-old`
- Удалены сгенерированные `app/assets/styles/common.css` (они больше не нужны)

## Команды

```bash
npm i

# build одного письма
npm run build -- --category X_IQ --mail roll-300126

# только конкретные локали
npm run build -- --category X_IQ --mail roll-300126 --locales en,es

# при необходимости отключить минификацию CSS
npm run build -- --category X_IQ --mail roll-300126 --no-minifyCss
```

## Возможные несовпадения

1. Если Stylus использует экзотические плагины/фичи (nib, rupture и т.п.) — надо будет добавить зависимости и `use()` в `compileStylus()`.
2. Если какой-то email раньше полагался на внешний `common.css` для web-preview — теперь этот CSS будет инлайном (что и нужно для реальных рассылок).
