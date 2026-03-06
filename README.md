# Email Studio Demo

Локальная демка email-studio: чат с ассистентом, brief, загрузка design reference, links с картинками, translations, preview письма, настройки тулзы и привязка к реальной `email-base`.

## Что уже есть

- Чат-интерфейс для постановки задачи.
- Панель brief: кампания, локаль, аудитория, goal, tone, CTA.
- Поля для asset links, design image URL, upload дизайна и translations JSON/text.
- Preview письма в `iframe`.
- Вкладки с `HTML`, `Pug`, `Locales`, `Assets`, `Mail spec`.
- Вкладка `Build log`.
- `Mock mode`, если `OPENAI_API_KEY` не задан.
- `Live mode` через OpenAI `Responses API`, если ключ задан.
- Settings drawer: `theme`, `AI provider`, `client preview profile`.
- Heuristic `client diagnostics` вместо внешнего Litmus-подобного сервиса.
- Кнопка сборки реального письма из `email-base`.

## Как запустить

```bash
npm start
```

Сервер стартует на [http://localhost:3000](http://localhost:3000).

Для live-режима задайте переменные окружения:

```bash
export OPENAI_API_KEY=your_key_here
export OPENAI_MODEL=gpt-4.1-mini
npm start
```

Если ключ не задан или запрос к API падает, демка автоматически уходит в `mock mode`.

## Как это работает

1. UI собирает brief, ссылки на картинки, design reference, translations и последние сообщения чата.
2. Сервер либо вызывает OpenAI `Responses API`, либо генерирует mock draft.
3. На выходе получается структурированный `mail spec`.
4. Из `mail spec` локально рендерятся:
   - preview HTML
   - Pug sketch
   - locales JSON
   - assets manifest
5. Отдельно можно собрать настоящее письмо из `email-base` и загрузить его preview/code прямо в UI.

Это важно: preview и код строятся не из произвольного ответа модели, а из одного структурированного draft. Это правильная база для будущего production-продукта.

## GitHub / GitLab

Да, проект стоит хранить в Git, а не только локально.

Рекомендованный базовый поток:

```bash
git init -b main
git add .
git commit -m "Initial email studio demo"
git remote add origin <github-or-gitlab-repo-url>
git push -u origin main
```

Что я бы делал дальше для реальной связки с GitHub/GitLab:

- хранить `mail spec` драфты в репозитории, а не только в браузере;
- делать отдельную ветку на каждый новый draft письма;
- поднимать Pull Request / Merge Request после генерации;
- складывать generated files рядом с canonical block catalog;
- добавить серверные действия `save draft`, `create branch`, `open PR/MR`.

## Следующий инженерный шаг

После этой демки логично добавить 4 вещи:

1. `Block catalog` и JSON-схемы блоков.
2. `Asset registry` с ключами вместо сырых URL.
3. `Email-base bridge` для генерации файлов в вашем формате.
4. Git sync actions для branch / commit / PR(MR).
