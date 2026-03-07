# Project Overview

## Что это за программа

`Future Retention Studio` — это локальная email-studio для подготовки маркетинговых писем на основе вашей собственной `email-base`.

Идея продукта:
- не генерировать произвольный HTML;
- не хранить логику письма только в prompt;
- не привязывать процесс только к одному чату;
- а строить структурированный рабочий процесс вокруг:
  - чата,
  - канонических блоков,
  - переводов,
  - asset-ов,
  - preview,
  - и сохранения результата обратно в `email-base`.

## Главная цель

Заменить ручной разрозненный процесс на единый рабочий инструмент, в котором можно:
- обсудить письмо с ассистентом;
- приложить design, локали и картинки;
- получить draft и preview;
- увидеть, чего не хватает;
- поправить тексты и код;
- сохранить готовый вариант как новое письмо в базе.

## Как выглядит текущий workflow

1. Пользователь пишет в чат задачу по письму.
2. В то же окно чата можно:
   - вставить скрин дизайна,
   - перетащить папку с переводами,
   - загрузить картинки.
3. Ассистент:
   - обсуждает письмо,
   - задает уточняющие вопросы,
   - либо обновляет draft.
4. Студия строит:
   - preview HTML,
   - Pug sketch,
   - locales bundle,
   - asset manifest,
   - mail spec,
   - diagnostics.
5. Пользователь может:
   - открыть `Locales` и редактировать переводы по вкладкам,
   - открыть `Assets` и переназначить картинки,
   - открыть `Code` и править raw данные.
6. Draft можно сохранить в `email-base` как новый `mail-*`.

## Что уже реализовано

### 1. Chat-centric intake

Главная точка входа — чат.

Прямо в чат можно:
- вставить изображение из clipboard;
- drag-and-drop translation files;
- drag-and-drop целую папку локалей;
- загрузить design image;
- загрузить content images.

Сейчас интерфейс специально упрощен:
- бренд вверху без лишнего описательного текста;
- меньше постоянных пояснений на экране;
- короткие tooltip-подсказки по важным полям;
- chat actions разделены на обычное общение и применение к письму.

### 2. Streaming chat

Ответы идут потоково, а не одним куском.

Есть два режима:
- `Отправить в чат` — только диалог;
- `Применить к письму` — применить изменения к письму.

### 3. Формат переводов

Поддерживается ваш рабочий текстовый формат:

```txt
Subject: This Is A Bitcoin Nostalgia Email 😢
Snippet: {{BTC memes & tweets we’ll remember}}

{{Первый блок}}
{{Текст с @@жирным@@ акцентом}}

PUSH
CTA 1
CTA 2
```

Поддерживаются:
- `Subject:`
- `Snippet:`
- блоки `{{...}}`
- жирность `@@...@@`
- batch upload нескольких локалей
- определение локали из имени файла

### 4. Email-base bridge

Студия уже умеет:
- читать текущую `email-base`;
- собирать реальный build существующего письма;
- создавать новое `mail-*`;
- записывать locale JSON в `vendor/data/<locale>/`;
- сохранять generated template/style/spec.

### 5. Block catalog v1

Студия начала разбирать базу на повторяющиеся канонические блоки.

Сейчас catalog строится из текущей `email-base` и уже выделяет реальные паттерны вроде:
- header logo row
- hero image with two CTA
- numbered feature stack
- switch CTA row
- VML background hero
- store badges row

Это первая версия. Она нужна как фундамент, чтобы дальше собирать письма из approved blocks, а не из случайной верстки.

### 6. Client diagnostics

Полной замены Litmus тут пока нет.

Зато уже есть встроенный слой:
- heuristic preview profiles;
- отдельное окно `Тесты`;
- summary по нескольким client profiles;
- diagnostics по картинкам и mapping;
- предупреждение о concept preview vs real build;
- база для дальнейшего lint/check pipeline.

Дополнительно уже есть viewport toggle в preview:
- `Fit`
- `Desktop`
- `Mobile`

Это не симуляция почтового клиента, но быстрый способ оценить адаптивность письма прямо в студии.

### 7. Asset registry

Теперь картинки могут жить не только в сессии браузера, но и в самом проекте.

Что уже есть:
- upload design и image files в локальное хранилище проекта;
- библиотека картинок в `Assets`;
- повторное использование картинок между письмами;
- возможность скачать локальный файл;
- поле `External / CDN URL`, чтобы потом вручную подменить локальную картинку на ссылку из корпоративного файлового хранилища.

Это закрывает первый реальный workflow:
1. загрузили картинку в студию;
2. она сохранилась в проект;
3. при необходимости скачали;
4. залили в ваше файловое хранилище;
5. вставили CDN URL обратно в asset registry.

## Архитектура

### Frontend

- [public/index.html](/Users/nikolay.bulgakov/Documents/retantion-future/public/index.html)
- [public/app.js](/Users/nikolay.bulgakov/Documents/retantion-future/public/app.js)
- [public/styles.css](/Users/nikolay.bulgakov/Documents/retantion-future/public/styles.css)

Frontend хранит рабочий state студии, рендерит chat-first UI, попапы и preview.

### Backend

- [server.js](/Users/nikolay.bulgakov/Documents/retantion-future/server.js)

Backend отвечает за:
- OpenAI/mock generation;
- streaming chat;
- missing locale generation;
- email-base build/create flows;
- block catalog generation;
- preview data preparation.

### Email base

- [email-base](/Users/nikolay.bulgakov/Documents/retantion-future/email-base)

Это рабочая база, вокруг которой строится студия.

### Generated data

- [data/block-catalog.json](/Users/nikolay.bulgakov/Documents/retantion-future/data/block-catalog.json)

Сюда студия складывает generated catalog и похожие артефакты.

## Ограничения текущей версии

- Без `OPENAI_API_KEY` студия работает в `mock mode`, поэтому не делает настоящий vision-разбор макета.
- Preview не является точной заменой Litmus/Email on Acid.
- Block catalog пока основан на ограниченном количестве писем.
- Design ingest пока строится вокруг скринов и ручных attach/paste сценариев.
- Чат живой, но еще не хранит долгую серверную память по проекту.

## Что нужно дальше

### Ближайшие продуктовые шаги

- сделать внутреннее хранилище картинок и asset manifest как source of truth;
- научить ассистента задавать более точные вопросы по missing data;
- расширить block catalog на письма последних лет;
- добавить richer code/locales editing flow перед сохранением в базу.

### Journal layer

Теперь у студии есть внутренний operational journal.

Это не память модели, а журнал самой тулзы:
- ошибки;
- build actions;
- refresh catalog;
- save in email-base;
- locale generation;
- asset updates.

Журнал нужен, потому что:
- студия становится наблюдаемой;
- можно быстрее понять, где и почему что-то сломалось;
- можно не повторять одни и те же operational mistakes.

### Дальние шаги

- provider adapters для разных AI;
- design-to-block mapping по скрину/референсу;
- controlled import публичных reference pages;
- release pipeline с более сильным email-client lint;
- блоки draft/new-candidate с review flow.
