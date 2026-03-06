# Auto Email Base

## Быстрый старт (macOS / Linux)

```bash
git clone https://github.com/Brokenbass90/email-base.git
cd email-base
nvm use
npm i
chmod +x ./mail
```

## Быстрый старт (Windows)

```bash
git clone https://github.com/Brokenbass90/email-base.git
cd email-base
npm i
```

## Основные команды

```bash
./mail dev X_IQ rfm-311
./mail build-min X_IQ rfm-311
./mail build-pretty X_IQ rfm-311
./mail clean
```

- `dev` — watch + локальный сервер
- `build-min` — minify head (по умолчанию)
- `build-pretty` — без минификации, + `index.pretty.html`
- `clean` — удаляет `dist/` (в git не попадает)

### Windows команды (если `./mail` не работает)

```bash
node mail dev X_IQ rfm-311
node mail build-min X_IQ rfm-311
node mail build-pretty X_IQ rfm-311
```

## Где результат

```
dist/<CATEGORY>/mail-<MAIL>/<LOCALE>/index.html
```

`index.pretty.html` создаётся только через `build-pretty` или флаг `--pretty`.

## Полезные флаги

- `--pretty` — дополнительно создать `index.pretty.html`
- `--no-trimCss` — отключить трим неиспользуемых правил
- `--minifyHtml` — минимизировать HTML (осторожно)
- `--minifyAll` — минимизировать HTML + head CSS + inline CSS
- `--locales en,es` — собрать только выбранные локали

## Как работают стили

- `app/styles/common.styl` или `app/styles/inline.styl`
  Основной файл. Обычные правила инлайнятся в HTML, а в `<head>` остаются только head-safe at-rules: `@media`, `@supports`, `@font-face`, `@keyframes`.
- `app/styles/head-extra.styl`
  Дополнительный файл. Его правила и инлайнятся, и целиком остаются в `<head>`.
- `app/styles/head-only.styl`
  Технический файл для редких случаев. Его правила остаются только в `<head>` и не инлайнятся.

## Как сделать новое письмо

```
X_IQ/mail-rfm-311  ->  X_IQ/mail-rfm-999
```

И запустить:

```bash
./mail dev X_IQ rfm-999
```
