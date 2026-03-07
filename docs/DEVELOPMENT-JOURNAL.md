# Development Journal

## 2026-03-07

### Текущий статус

Проект перешел из стадии "визуальное демо" в стадию "рабочий MVP вокруг email-base".

### Что уже сделано

1. Поднят отдельный проект студии рядом с `email-base`.
2. Добавлен базовый chat UI и preview.
3. Подключен mock/OpenAI provider flow.
4. Подключена локальная копия `email-base`.
5. Добавлены:
   - settings drawer,
   - heuristic client diagnostics,
   - real email-base build loading.
6. Реализован parsing translation `.txt`-формата:
   - `Subject`
   - `Snippet`
   - `{{...}}`
   - `@@...@@`
7. Добавлена генерация missing locales.
8. Добавлен streaming chat.
9. UI переведен в chat-centric режим:
   - attach design
   - attach locale files
   - attach locale folder
   - attach images
   - paste/drop прямо в чат
10. Добавлены отдельные рабочие модальные окна:
   - `Locales`
   - `Assets`
   - `Code`
11. Реализовано сохранение нового письма в `email-base`.
12. Добавлен `block catalog v1`, который строится из реальных шаблонов в базе.
13. Добавлен локальный `asset registry` с библиотекой картинок и ручной подменой на CDN URL.
14. UI упрощен: меньше текста, tooltip-подсказки, более понятные chat actions, viewport toggle в preview.
15. Ассистент начал видеть `asset library` и подсказывать, какие картинки из проекта подходят к блокам текущего письма.
16. Добавлен `studio journal` с серверной записью событий и очисткой.
17. Добавлены быстрые кнопки `Локали`, `Картинки`, `Код`, `Тесты`, чтобы не искать эти функции по экрану.
18. Добавлено отдельное окно `Тесты` с heuristic summary по нескольким client profiles.
19. Починен chat intake: drag-and-drop теперь работает не только по маленькой зоне, но и по самому блоку чата; ссылки из сообщений тоже сохраняются как reference.
20. Mock-режим стал честнее: он явно сообщает, что без `OPENAI_API_KEY` не делает pixel-level vision, и при этом старается переиспользовать текущую структуру письма вместо случайного demo layout.

## Текущие продуктовые принципы

- Чат — главный вход в систему.
- Письмо должно описываться структурой, а не свободным HTML.
- Переводы должны жить в явном формате и быть редактируемыми.
- Картинки должны быть осмысленно размечены по ролям.
- Реальный source of truth для прод-письма — `email-base`, а не локальный preview.

## Текущие сильные стороны MVP

- Можно реально обсуждать письмо в приложении.
- Можно прикладывать входные материалы без множества разрозненных экранов.
- Можно генерить локали и потом редактировать их по вкладкам.
- Можно сохранить результат обратно в рабочую базу.
- Уже есть зацепка под reusable blocks, а не только под ad-hoc draft.

## Что еще пока не завершено

- asset registry с локальным storage и стабильными ключами;
- полноценный block authoring flow;
- richer diff/review перед save в `email-base`;
- долгоживущая память проекта для ассистента;
- более сильная имитация email clients;
- глубокий импорт исторических писем последних лет.

## Практические соглашения

### Переводы

Источником перевода может быть:
- `.txt`
- `.json`
- папка с translation files

Внутри студии bundle хранится как единый текстовый пакет с разделителями:

```txt
=== FILE: 10495_en_US_original.txt ===
Subject: ...
Snippet: ...
{{...}}
```

### Картинки

Пока используются asset placements:
- `hero`
- `logo`
- `section`
- `feature`
- `footer`
- `background`
- `reference`
- `auto`

Картинки теперь могут:
- храниться локально в проекте;
- переиспользоваться из asset library;
- получать внешний CDN URL вручную после загрузки в корпоративное файловое хранилище.

### Сохранение в email-base

Текущий save flow:
- берет текущий draft;
- создает новый `mail-*`;
- пишет generated files;
- пишет locale JSON;
- запускает build и возвращает preview.

## Следующие задачи высокой ценности

1. Asset registry с локальным upload-ом файлов в проект.
2. Более зрелый block catalog на нескольких письмах.
3. Больше вопросов от ассистента по missing data до генерации.
4. Улучшение preview/test strategy для разных клиентов.
5. Import свежих исторических писем как source для канонических блоков.

## Что открыть в новом чате в первую очередь

Если новая сессия должна быстро понять проект, сначала открыть:

1. [README.md](/Users/nikolay.bulgakov/Documents/retantion-future/README.md)
2. [PROJECT-OVERVIEW.md](/Users/nikolay.bulgakov/Documents/retantion-future/docs/PROJECT-OVERVIEW.md)
3. [DEVELOPMENT-JOURNAL.md](/Users/nikolay.bulgakov/Documents/retantion-future/docs/DEVELOPMENT-JOURNAL.md)
4. [server.js](/Users/nikolay.bulgakov/Documents/retantion-future/server.js)
5. [public/app.js](/Users/nikolay.bulgakov/Documents/retantion-future/public/app.js)
