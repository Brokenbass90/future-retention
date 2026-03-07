# Future Retention Studio

Локальная студия для сборки email-кампаний вокруг вашей `email-base`.

Сейчас это уже не просто демо, а рабочий MVP со следующими возможностями:
- live chat со streaming-ответами;
- chat-centric intake для design, локалей и картинок;
- локальный asset registry с переиспользованием картинок внутри проекта;
- preview + heuristic diagnostics по email clients;
- отдельное окно `Тесты` с client profile summary и warnings;
- viewport toggle `Fit / Desktop / Mobile` в preview;
- редакторы локалей, assets и кода в попапах;
- автогенерация missing locales;
- сохранение нового письма в `email-base` как новый `mail-*`;
- первый `block catalog`, собранный из реальных шаблонов в базе.

## Запуск

```bash
npm start
```

Открыть: [http://localhost:3000](http://localhost:3000)

Для live-режима OpenAI можно больше не делать `export` вручную. Достаточно создать `.env` рядом с [server.js](/Users/nikolay.bulgakov/Documents/retantion-future/server.js):

```bash
cp .env.example .env
# потом вписать ключ в .env
npm start
```

Без ключа приложение работает в `mock mode`.
В `mock mode` чат, тесты и сохранение работают, но pixel-level разбор design reference и осмысленный vision-анализ недоступны.

Если `OPENAI_API_KEY` загружен, в верхней панели увидишь `LIVE AI`. Если ключа нет, там будет `MOCK / FALLBACK`.

## Как пользоваться

1. Вставляйте задачу в чат.
2. Туда же attach/drop/paste:
   - design screenshot,
   - translation files или целую папку,
   - картинки для письма.
3. Жмите `Отправить в чат`, если хотите просто поговорить о письме.
4. Жмите `Применить к письму`, если хотите применить решения к preview и коду.
5. Пользуйтесь быстрыми кнопками `Локали`, `Картинки`, `Код`, `Тесты`.
6. Сохраняйте результат в `email-base` кнопкой `Save as new email-base mail`.
7. Для design reference можно открыть `Картинки` и нажать `Analyze design`. В live-режиме студия попробует разобрать макет на блоки и missing pieces.

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

## Что дальше

Следующие сильные шаги:
- связка asset registry с внешним CDN / файловым хранилищем;
- более точный block catalog и reusable block definitions;
- richer save-flow в `email-base` с редактированием generated файлов;
- provider adapters для других моделей;
- более сильный email-client lint и release-check pipeline.
