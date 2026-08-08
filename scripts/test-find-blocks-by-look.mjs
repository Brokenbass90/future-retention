#!/usr/bin/env node
/**
 * test-find-blocks-by-look.mjs — поиск блока по внешнему виду.
 *
 * Это инструмент, ради которого делались пререндер и сигнатуры: до него
 * агент выбирал блок вслепую, по категории и авто-описанию вида
 * «Импортирован из X_IQ (1 писем)». Проверяем, что фильтры действительно
 * фильтруют, а не делают вид.
 *
 * Требует прогнанных превью (npm run previews) и группировки
 * (npm run previews:group) — без них тест честно скажет, чего не хватает.
 *
 * Zero-AI, без сети. Exit 0 = pass.
 */
import { TOOL_DEFINITIONS, TOOL_HANDLERS } from "../src/ai-tools.js";
import { loadPreviewIndex } from "../src/block-previews.js";

let pass = 0, fail = 0;
const check = (name, cond, extra = "") => {
  if (cond) { pass++; console.log("  \x1b[32m✓\x1b[0m", name); }
  else { fail++; console.error(`  \x1b[31m✗ ${name}\x1b[0m ${extra}`); }
};

const index = loadPreviewIndex();
if (!index?.blocks || !Object.keys(index.blocks).length) {
  console.error("нет data/block-previews/index.json — сначала: npm run previews");
  process.exit(1);
}

const find = (args) => TOOL_HANDLERS.find_blocks_by_look(args, {});

/* ─── Инструмент объявлен агенту ─────────────────────────────────────────── */
{
  const def = TOOL_DEFINITIONS.find((d) => d.name === "find_blocks_by_look");
  check("инструмент объявлен в TOOL_DEFINITIONS", Boolean(def));
  check("у инструмента есть структурные фильтры",
    Boolean(def?.parameters?.properties?.hasButton && def.parameters.properties.minColumns));
}

/* ─── Структурные фильтры действительно фильтруют ────────────────────────── */
{
  const withButton = await find({ hasButton: true, limit: 20 });
  check("нашлись блоки с кнопкой", withButton.count > 0, `count=${withButton.count}`);
  check("у всех найденных кнопка есть",
    withButton.blocks.every((b) => b.appearance?.buttons > 0),
    JSON.stringify(withButton.blocks.slice(0, 2).map((b) => [b.id, b.appearance?.buttons])));

  const withoutButton = await find({ hasButton: false, limit: 20 });
  check("обратный фильтр отдаёт блоки БЕЗ кнопки",
    withoutButton.count > 0 && withoutButton.blocks.every((b) => !b.appearance?.buttons));

  const ids = new Set(withButton.blocks.map((b) => b.id));
  check("выдачи не пересекаются", withoutButton.blocks.every((b) => !ids.has(b.id)));
}

{
  const twoCol = await find({ minColumns: 2, limit: 15 });
  check("фильтр по колонкам работает",
    twoCol.count > 0 && twoCol.blocks.every((b) => b.appearance?.columns >= 2),
    `count=${twoCol.count}`);
}

{
  const tall = await find({ minHeight: 500, limit: 15 });
  check("фильтр по высоте работает",
    tall.count > 0 && tall.blocks.every((b) => b.appearance?.height >= 500));

  const short = await find({ maxHeight: 120, limit: 15 });
  check("верхняя граница высоты работает",
    short.count > 0 && short.blocks.every((b) => b.appearance?.height <= 120));
}

/* ─── Поиск по цвету: близкие оттенки да, чужие нет ──────────────────────── */
{
  const orange = await find({ backgroundLike: "#FF7700", limit: 10 });
  check("поиск по цвету что-то находит", orange.count > 0, `count=${orange.count}`);
  const parse = (hex) => {
    const n = parseInt(String(hex).replace("#", ""), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  // Цвет ищется по ВСЕЙ палитре блока, а не только по доминирующему фону:
  // у кнопки доминирует белое поле вокруг неё, и по одному фону ни одна
  // оранжевая кнопка не нашлась бы. Значит и проверять надо палитру.
  const far = orange.blocks.filter((b) => {
    const palette = [b.appearance?.background, ...(b.appearance?.palette || [])].filter(Boolean);
    if (!palette.length) return false;
    return palette.every((hex) => {
      const [r, g, bl] = parse(hex);
      return Math.sqrt((r - 255) ** 2 + (g - 119) ** 2 + bl ** 2) > 120;
    });
  });
  check("блоки без близкого к запросу цвета отсеяны", far.length === 0,
    JSON.stringify(far.slice(0, 3).map((b) => [b.id, b.appearance.palette])));
}

/* ─── Схлопывание дублей в выдаче ────────────────────────────────────────── */
{
  const collapsed = await find({ placement: "inner", limit: 25 });
  const groups = collapsed.blocks.map((b) => b.id);
  check("выдача без дублей уникальна по id", new Set(groups).size === groups.length);

  const expanded = await find({ placement: "inner", includeDuplicates: true, limit: 25 });
  check("includeDuplicates возвращает не меньше позиций", expanded.count >= collapsed.count,
    `${expanded.count} vs ${collapsed.count}`);
  check("у схлопнутых позиций видно число похожих",
    collapsed.blocks.some((b) => typeof b.looksTheSameAs === "number"));
}

/* ─── Размещение и источник ──────────────────────────────────────────────── */
{
  const sections = await find({ placement: "section", limit: 20 });
  check("фильтр размещения работает",
    sections.count > 0 && sections.blocks.every((b) => b.placement === "section"),
    JSON.stringify(sections.blocks.slice(0, 3).map((b) => b.placement)));

  const safe = await find({ includeLegacy: false, limit: 30 });
  check("includeLegacy:false убирает legacy-нарезку",
    safe.count > 0 && safe.blocks.every((b) => b.source !== "imported"));
}

/* ─── Выдача пригодна для следующего шага агента ─────────────────────────── */
{
  const r = await find({ placement: "section", hasImage: true, limit: 5 });
  check("у результатов есть id для compose_email_from_blocks",
    r.blocks.every((b) => typeof b.id === "string" && b.id.length));
  check("у результатов есть ссылка на превью",
    r.blocks.every((b) => typeof b.previewUrl === "string" && b.previewUrl.endsWith(".png")));
  check("перечислены слоты блока", r.blocks.every((b) => Array.isArray(b.slots)));
}

/* ─── Ничего не нашлось — объясняем, а не молчим ─────────────────────────── */
{
  const none = await find({ hasImage: true, hasButton: true, hasList: true, minColumns: 9, minHeight: 9000 });
  check("невозможный запрос даёт пустую выдачу", none.count === 0);
  check("подсказка объясняет, что делать", /Loosen|loosen/.test(none.hint || ""), none.hint);
}

/* ─── Лимит соблюдается и ограничен сверху ───────────────────────────────── */
{
  const three = await find({ limit: 3 });
  check("лимит соблюдается", three.count <= 3);
  const huge = await find({ limit: 5000 });
  check("лимит ограничен сверху", huge.count <= 40, `count=${huge.count}`);
}

console.log(`\nfind-blocks-by-look: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
