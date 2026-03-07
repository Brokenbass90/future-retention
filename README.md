# Future Retention Studio

Локальная студия для сборки email-кампаний вокруг вашей `email-base`.

Сейчас это уже не просто демо, а рабочий MVP со следующими возможностями:
- live chat со streaming-ответами;
- chat-centric intake для design, локалей и картинок;
- локальный asset registry с переиспользованием картинок внутри проекта;
- preview + heuristic diagnostics по email clients;
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

Для live-режима OpenAI:

```bash
export OPENAI_API_KEY="your_key_here"
export OPENAI_MODEL="gpt-4.1-mini"
npm start
```

Без ключа приложение работает в `mock mode`.

## Как пользоваться

1. Вставляйте задачу в чат.
2. Туда же attach/drop/paste:
   - design screenshot,
   - translation files или целую папку,
   - картинки для письма.
3. Жмите `Обсудить`, если хотите просто поговорить о письме.
4. Жмите `Обновить драфт`, если хотите применить решения к preview и коду.
5. Правьте тексты в `Locales`, assets в `Assets`, код и spec в `Code`.
6. Сохраняйте результат в `email-base` кнопкой `Save as new email-base mail`.

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
