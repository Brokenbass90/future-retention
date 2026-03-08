# Design Workspace Plan

## Зачем нужен отдельный design workspace

Обычного attach скрина для зрелого workflow недостаточно.

Нужен отдельный слой студии, где design reference живет не как случайная картинка, а как рабочий артефакт:
- с зонами макета;
- с mapping на email blocks;
- с asset slots;
- с missing pieces;
- с draft-кандидатами в новые блоки;
- с возможностью подключить отдельную design-model.

## Что должно появиться

### 1. Design intake panel

Отдельное окно `Design workspace`, в которое можно:
- вставить скрин из буфера;
- загрузить export из Figma;
- вставить публичную ссылку на frame;
- загрузить несколько экранов одного письма;
- приложить GIF или отдельные image assets.

### 2. Controlled Figma import

Полная интеграция с Figma сейчас не нужна.

Нужен контролируемый импорт:
- публичный frame URL;
- export PNG/JPG/WebP;
- copy/paste скрина фрейма;
- в будущем, если будет доступ, отдельный Figma token/plugin path.

Идея: студия не должна зависеть от прямого доступа компании к Figma. Она должна уметь жить на экспортированных артефактах.

### 3. Layout zoning

После загрузки design reference студия должна уметь выделить:
- hero;
- logo row;
- 2-col / 3-col rows;
- card sections;
- CTA zones;
- footer/legal area;
- декоративные и контентные изображения.

Это и есть мост между картинкой макета и реальной email-версткой.

### 4. Block mapping

Для каждой зоны нужно одно из трех решений:
- `matched canonical block`
- `matched with edits`
- `new block candidate`

Если нужного блока нет в `email-base`, студия не должна молча придумывать произвольную верстку.
Она должна создать новый block candidate с понятным контрактом.

### 5. Design model adapter slot

Под `Design workspace` нужно заранее держать отдельный adapter slot.

Это позволит подключать отдельную модель только для задач дизайна:
- vision analysis;
- extraction of zones;
- extraction of asset roles;
- screenshot-to-layout reasoning;
- optional design remix.

Центральный чат-ассистент при этом остается главным orchestrator, а design-model работает как специализированный воркер.

## Как студия будет "учиться"

Это не fine-tuning модели.

Внутреннее обучение студии должно идти через явные артефакты:
- `block catalog`
- `block candidates`
- `asset registry`
- `design references`
- `journal`
- проектные правила и naming conventions

То есть студия становится умнее не потому, что модель "помнит", а потому, что сам продукт хранит все важные решения в явном виде.

## Что будет источником правил

Когда вы добавите новые письма, студия должна:
1. разрезать их на блоки;
2. находить повторяющиеся паттерны;
3. предлагать новые canonical blocks;
4. связывать эти блоки с брендом, типом письма и нужными props.

Так формируется собственная система правил компании:
- бренды;
- tone of voice;
- footer/legal differences;
- повторяющиеся layout patterns;
- допустимые mixins и helper blocks.

## Что уже есть как фундамент

- `block catalog v1` на основе первого письма;
- `asset registry`;
- `design analysis`;
- `Block candidates` modal;
- `email-base` save flow;
- `studio journal`.

Первое письмо уже разложено на стартовые канонические блоки. Это первый слой будущей библиотеки.

## Ближайшие шаги

1. Показывать design zones прямо в `Design workspace`.
2. Связывать найденные зоны с `block catalog`.
3. Автоматически создавать `new block candidate`, если match не найден.
4. Показывать, какие assets уже есть в библиотеке под каждый блок.
5. Добавить adapter slot для отдельной design-model.
6. Добавить controlled import публичных Figma frame URLs.
