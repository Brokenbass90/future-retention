# Future Retention Studio

Локальная студия для сборки email-кампаний вокруг вашей `email-base`.

Сейчас это уже не просто демо, а рабочий MVP со следующими возможностями:
- live chat со streaming-ответами;
- chat-centric intake для design, локалей и картинок;
- первый `design workspace` слой: upload скрина/export, public image URL, public Figma frame URL, reference URL;
- `link-first` Figma flow: менеджеру достаточно frame link или скрина, а студия сама подсказывает, нужен ли open draft/share link;
- подготовленный server endpoint `/api/figma/import` под будущий `Send to Studio` plugin/push;
- локальный asset registry с переиспользованием картинок внутри проекта;
- preview + heuristic diagnostics по email clients;
- отдельное окно `Тесты` с client profile summary и warnings;
- viewport toggle `Fit / Desktop / Mobile` в preview;
- редакторы локалей, assets и кода в попапах;
- автогенерация missing locales;
- сохранение нового письма в `email-base` как новый `mail-*`;
- первый `block catalog`, собранный из реальных шаблонов в базе;
- `block candidate` flow для новых layout-паттернов, которых еще нет в каталоге.

## Запуск

```bash
npm start
```

Открыть: [http://localhost:3000](http://localhost:3000)

Production deployment на Heroku, обязательные переменные окружения, Basic Auth
и ограничение ephemeral filesystem описаны в
[`docs/HEROKU-DEPLOYMENT.md`](docs/HEROKU-DEPLOYMENT.md).

Для live-режима OpenAI можно больше не делать `export` вручную. Достаточно создать `.env` рядом с [server.js](/Users/nikolay.bulgakov/Documents/retantion-future/server.js):

```bash
cp .env.example .env
# потом вписать ключ в .env
npm start
```

Для следующего шага по Figma можно дополнительно настроить:

```bash
FIGMA_API_TOKEN=...
FIGMA_IMPORT_SECRET=...
```

- `FIGMA_API_TOKEN` нужен для будущего server-side fetch из приватной Figma.
- `FIGMA_IMPORT_SECRET` защищает `POST /api/figma/import`, если будете слать данные из plugin/push flow.

Без ключа приложение работает в `mock mode`.
В `mock mode` чат, тесты и сохранение работают, но pixel-level разбор design reference и осмысленный vision-анализ недоступны.

Если `OPENAI_API_KEY` загружен, в верхней панели увидишь `LIVE AI`. Если ключа нет, там будет `MOCK / FALLBACK`.

## Как пользоваться

1. Вставляйте задачу в чат.
2. Туда же attach/drop/paste:
   - design screenshot,
   - translation files или целую папку,
   - картинки для письма.
3. Жмите `Отправить`.
4. Вопросы останутся обычным диалогом, а команды вроде `добавь 3 колонки` студия трактует как изменение текущего draft.
5. Пользуйтесь быстрыми кнопками `Локали`, `Картинки`, `Код`, `Тесты`.
6. Открывайте `Block candidates`, если студия увидела новый layout, которого пока нет в каноническом catalog.
7. Сохраняйте результат в `email-base` кнопкой `Save as new email-base mail`.
8. Для design reference можно открыть `Картинки` и нажать `Analyze design`. В live-режиме студия попробует разобрать макет на блоки и missing pieces.

### Figma flow сейчас

- Для обычного пользователя лучший путь: вставить `Figma frame link` или приложить `скрин/export`.
- Если frame приватный, студия должна просить `open draft/share link` или `скрин/export` этого frame.
- Пользователь не должен руками готовить JSON.
- `JSON/plugin import` оставлен как advanced/internal bridge до полноценного `Send to Studio`.

## Что очищает что

- `Очистить чат` — очищает только переписку.
- `Очистить` — очищает текущий workspace: draft, brief, design, bundle локалей и attachments.
- `Journal -> Clear journal` — очищает внутренний operational journal студии.

## Основные директории

- [public](/Users/nikolay.bulgakov/Documents/retantion-future/public) — frontend студии
- [server.js](/Users/nikolay.bulgakov/Documents/retantion-future/server.js) — HTTP server, AI orchestration, email-base bridge
- [email-base](/Users/nikolay.bulgakov/Documents/retantion-future/email-base) — локальная копия базы писем
- [data](/Users/nikolay.bulgakov/Documents/retantion-future/data) — generated artifacts студии, включая `block-catalog.json`
- [docs](/Users/nikolay.bulgakov/Documents/retantion-future/docs) — overview и журнал разработки

## Документация

- [PROJECT-OVERVIEW.md](/Users/nikolay.bulgakov/Documents/retantion-future/docs/PROJECT-OVERVIEW.md)
- [DEVELOPMENT-JOURNAL.md](/Users/nikolay.bulgakov/Documents/retantion-future/docs/DEVELOPMENT-JOURNAL.md)
- [AI-SANDBOX.md](/Users/nikolay.bulgakov/Documents/retantion-future/docs/AI-SANDBOX.md)
- [DESIGN-WORKSPACE-PLAN.md](/Users/nikolay.bulgakov/Documents/retantion-future/docs/DESIGN-WORKSPACE-PLAN.md)

## Что дальше

Следующие сильные шаги:
- связка asset registry с внешним CDN / файловым хранилищем;
- более точный block catalog и reusable block definitions;
- richer save-flow в `email-base` с редактированием generated файлов;
- provider adapters для других моделей;
- более сильный email-client lint и release-check pipeline.
