# Аудит AI и производительности — 2026-07-14

## Короткий вывод

ИИ не запускается при обычном drag-and-drop, выборе блока, смене локали,
сохранении Pug или HTML-сборке. Эти задержки создаёт локальный production-like
email pipeline: Stylus → Pug → CSS trim → CSS inline → локализация → RTL → запись
`dist`.

ИИ вызывается из явных AI-действий (чат, перевод, placeholderize, исправление
локали, анализ дизайна, HTML→Pug, генерация картинки). Есть два исключения:

- создание draft по дизайну может автоматически сначала сделать AI-анализ
  дизайна, а затем AI-draft;
- draft с запрошенными отсутствующими локалями может автоматически сделать
  ещё один AI-вызов перевода.

## Где реально вызывается AI

| UI / сценарий | Endpoint | Реальная работа |
|---|---|---|
| Основная студия, Send | `POST /api/chat/stream` | Discussion или draft через OpenAI. Draft по новому дизайну может состоять из 2 AI-вызовов: design analysis + draft. |
| «Analyze design» | `POST /api/design/analyze` | OpenAI design analysis. |
| «Generate missing locales» | `POST /api/translations/generate` | OpenAI translation; при выбранном DeepL — DeepL, не OpenAI. |
| Автоперевод после draft | внутренний `generateMissingLocales` | Только если запрошено больше одной локали, локали отсутствуют и пользователь запросил автоперевод либо ещё не загрузил translation TXT. |
| Вставленный HTML → команда «конвертируй в Pug» | `POST /api/email-base/html-to-pug` | OpenAI возвращает полный набор Pug-блоков. |
| `+ Locale` → engine OpenAI | `POST /api/email-base/add-locale` | OpenAI переводит локаль; затем локальная email-сборка. |
| Конструктор → изображение → `✨ Создать` | `POST /api/assets/generate` | OpenAI Images API, модель из `OPENAI_IMAGE_MODEL` (`gpt-image-2` по умолчанию). |
| Workbench AI drawer, Agent mode / edit intent | `POST /api/wb/ai/agent` | Tool-use agent. До 12 model steps; отдельные AI-tools могут вызвать дополнительные model calls. |
| Workbench AI drawer, обычный Send | `POST /api/chat/stream` | Discussion/draft или точечный locale tool. После исправления в этом аудите обычный разговор больше не делает предварительный AI intent call. |
| Workbench `✱` | `POST /api/wb/ai/placeholderize` | AI placeholderize, возможен второй проход для пропусков. |
| Workbench `🌐` | `POST /api/wb/ai/translate-locale-txt` | AI перевод выбранной locale TXT. |
| Workbench `🩹` | `POST /api/wb/ai/fix-locale-txt` | AI исправление TXT относительно reference. |
| Workbench HTML→Pug legacy endpoint | `POST /api/wb/html-to-pug` | AI endpoint существует, но текущего прямого UI-вызова не найдено. |
| Batch `generate-draft` | worker из `/api/batch/queue` | OpenAI draft, только после явной постановки batch job. |

Не используют AI: `/api/compose-preview`, `/api/compose-save`,
`/api/wb/build-email`, `/api/wb/code-html`, locale tabs,
`/api/wb/locale-normalize`, `/api/wb/locale-prepare`, `/api/wb/rtl`,
`/api/mail/infer-placeholders`, `/api/mail/apply-placeholders`, загрузка базы и
обычные настройки блока.

## Почему конструктор казался медленным

До исправления каждая мутация канваса через 650 мс делала
`POST /api/compose-preview`. Сервер для каждого запроса:

1. полностью копировал skeleton письма во временную папку;
2. создавал новый дочерний Node-процесс;
3. компилировал Stylus и Pug;
4. триммил и инлайнил CSS;
5. локализовал EN;
6. из-за `--pretty` повторял Pug + CSS-inline второй раз для
   `index.pretty.html`, хотя iframe читает только `index.html`.

Одновременно lazy thumbnails использовали тот же тяжёлый endpoint. При открытии
палитры могло стартовать много build-процессов, из-за чего активный preview
ждал CPU/IO и рос риск connection reset/исчерпания ресурсов. Сам текст
`Failed to fetch` означает, что браузер вообще не получил HTTP-ответ
(сервер остановлен/перезапущен, соединение оборвано или запрос отменён), а не
ошибку Pug и не AI-ошибку. Уникальное имя каждого live-preview также оставляло
временные source/dist каталоги.

### Сделанные исправления

- preview больше не строит ненужный pretty-вариант;
- одновременно работает максимум 2 preview-build (настраивается
  `PREVIEW_BUILD_CONCURRENCY`);
- live canvas / ручной Preview имеют приоритет над миниатюрами;
- одинаковые in-flight запросы объединяются;
- результаты хранятся в коротком LRU (30 секунд, 80 entries; оба параметра
  настраиваются через env);
- временные source/dist папки удаляются после чтения HTML;
- `/api/status` показывает `previewBuilds` (`running`, `queued`, `cacheEntries`,
  `inFlight`).

Локальный smoke на простом section-spacer: первый production preview — около
`0.765 s`, повтор того же содержимого — около `0.0015 s` из LRU. Сложные письма
будут собираться дольше, но больше не должны запускать неограниченное число
компиляторов.

## Почему Workbench долго сохраняет и меняет локаль

- Через 2 секунды после последнего изменения Pug/Stylus срабатывает autosave.
- Файл записывается быстро, но затем `/api/wb/build-email` запускает полный
  production pipeline в отдельном Node-процессе.
- Перед build сервер синхронизирует snapshot всех загруженных namespaces в
  `vendor/data/<locale>/<namespace>.json`.
- Во время активного build новая правка ставит ещё один полный build в очередь,
  чтобы последняя версия не потерялась.
- Клик по локали при dirty source обязан сначала сохранить и дождаться именно
  этой версии Pug, иначе показал бы устаревший HTML. Поэтому этот клик выглядит
  как «долгая загрузка».
- При clean source locale switch делает только чтение workspace/HTML. Если
  локаль отсутствует в `dist`, запускается полный rebuild.

## AI-задержки и учёт стоимости

- Общий retry budget OpenAI сейчас до трёх попыток по 120 секунд плюс backoff.
  Поэтому сетевой/429 сбой может выглядеть как очень долгая операция.
- Agent mode делает до 12 последовательных model steps.
- Кнопка Cancel прерывает browser fetch, но серверный OpenAI request пока не
  получает этот AbortSignal — запрос может продолжить работу и расход токенов.
- `tokenUsage` в `/api/status` пока неполный: `_aiCall` учитывается, но agent,
  locale-ai helpers и Images API используют собственные вызовы и не попадают в
  общий счётчик.
- До этого аудита любой обычный текст 7–399 символов при загруженных namespaces
  мог сделать отдельный AI intent-classifier, а затем основной discussion call.
  Теперь classifier включается только для неоднозначной команды, где есть и
  locale vocabulary, и действие. Обычное обсуждение сразу идёт в chat.

## Следующие шаги производительности к 1.0

1. P0 — передавать AbortSignal клиента до OpenAI и завершать child build при
   закрытии preview request.
2. P0 — content-hash/no-op для Workbench build: если source + locale snapshot не
   изменились, не запускать compiler повторно.
3. P0 — разделить build на base compile и дешёвую locale materialization, чтобы
   смена/изменение перевода не перекомпилировала Stylus/Pug/CSS.
4. P1 — генерировать thumbnails при сохранении/обновлении block library и
   раздавать готовые картинки/HTML, а не собирать каждую карточку при скролле.
5. P1 — добавить `Server-Timing` по стадиям: queue, compose, Stylus, Pug,
   inline-css, locale, RTL, IO.
6. P1 — объединить учёт всех AI-вызовов и показывать по операции: model,
   latency, retries, input/output tokens, estimated cost.
7. P1 — уменьшить agent max steps и ввести budget на один пользовательский
   запрос; offline tools не должны требовать нового model round-trip каждый раз.
