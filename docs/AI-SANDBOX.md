# AI Sandbox

## Идея

Студия не должна зависеть только от одной модели.

Правильная архитектура здесь такая:
- наверху один продуктовый workflow;
- под ним orchestration layer;
- под ним разные AI adapters по задачам.

То есть студия думает не категориями "используем OpenAI" или "используем модель X", а категориями задач:
- обсудить письмо;
- собрать draft;
- перевести локали;
- разобрать дизайн;
- подобрать блоки;
- проверить пробелы во входных данных.

## Базовый provider contract

Условно у каждого AI-провайдера должен быть один и тот же интерфейс:

- `discuss(payload)`
- `draft(payload)`
- `translate(payload)`
- `analyze_design(payload)`
- `classify_blocks(payload)`

Где `payload` — это не сырая пользовательская строка, а уже структурированный контекст студии:
- brief
- chat history
- current draft
- locales
- assets
- asset library
- block catalog
- email-base contract

## Зачем это нужно

Это позволит:
- менять модели без переписывания UI;
- использовать разные модели для разных задач;
- делать fallback;
- распределять стоимость по типам задач.

## Возможный routing

### OpenAI

Подходит для:
- чат-обсуждения;
- draft generation;
- vision по скринам;
- structured output.

### DeepL / другой переводческий сервис

Подходит для:
- чернового машинного перевода локалей;
- массовой генерации locale bundles дешевле, чем LLM.

Правильный hybrid flow:
1. translation engine делает raw перевод;
2. LLM делает post-edit;
3. человек подтверждает.

Это действительно может экономить токены и стоимость, особенно на массовых локалях.

### Design model

Можно подключать отдельную модель под дизайн или image tasks.

Но для email-studio важен не просто "сгенерируй картинку", а такой pipeline:
1. brief -> internal prompt;
2. design/reference output;
3. разбор результата на layout logic;
4. выделение нужных image assets;
5. сборка письма из block catalog.

## Design sandbox

В будущем здесь можно сделать отдельный режим:
- пользователь пишет задачу в чат;
- orchestrator собирает промпт под design model;
- design model генерирует reference;
- студия не верстает это вслепую, а разбирает:
  - hero area
  - body sections
  - CTA zones
  - required assets
  - reusable layout patterns

Это ближе не к "генерации нового хаоса", а к controlled design-to-email pipeline.

## Разбор дизайна без прямого доступа к Figma

Если компания не дает API-доступ к Figma, нормальные варианты такие:
- paste screenshot в чат;
- upload exported frame PNG/JPG;
- attach несколько скринов;
- attach GIF, если нужно понять motion/sequence.

Этого уже достаточно, чтобы:
- увидеть структуру;
- понять, где hero, где body, где CTA;
- вытащить требования к картинкам.

## Разбор дизайна на картинки

Для сложных писем со своими изображениями и GIF логика должна быть такой:
- design/reference не равен production asset;
- студия должна отличать:
  - reference design,
  - reusable project assets,
  - final CDN assets.

Поэтому current architecture уже идет в правильную сторону:
- есть design slot;
- есть asset library;
- есть возможность позже заменить локальный файл на внешний CDN URL.

## Чего не делать

- не давать дизайн-модели сразу писать HTML email;
- не делать source of truth внутри prompt;
- не смешивать translation, design и block decisions в один непрозрачный ответ модели;
- не обходить ваш block catalog свободной генерацией верстки.

## Вывод

Да, песочница для нейросетей внутри этой студии реальна.

И правильная форма для нее:
- одна студия;
- один workflow;
- несколько AI adapters под разные задачи;
- контролируемый orchestration layer;
- человек видит, что происходит и может редактировать результат.
