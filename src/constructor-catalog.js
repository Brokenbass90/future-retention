/**
 * src/constructor-catalog.js — что агенту можно ставить в конструкторе.
 *
 * Конструктор показывает человеку не всю библиотеку (540 блоков), а то, что
 * подходит к выбранному бренду и набору (Promo/System) и прошло проверку.
 * Агент раньше выбирал из всего подряд: ставил блоки чужого бренда и
 * черновые импорты, а браузер на первом же таком блоке обрывал весь пакет
 * правок — «блока нет в каталоге этого режима». Отсюда письма без логотипа
 * и картинки.
 *
 * Клиент присылает свой каталог; сервер сужает по нему инструменты агента.
 * Нет каталога (старый клиент, MCP) — ничего не сужаем.
 */

const clip = (value, max) => String(value ?? "").trim().slice(0, max);

/** Привести присланный клиентом каталог к безопасной форме. */
export function normalizeConstructorCatalog(raw) {
  if (!raw || typeof raw !== "object") return null;
  const list = Array.isArray(raw.blocks) ? raw.blocks.slice(0, 600) : [];
  const blocks = list
    .map((b) => ({
      id: clip(b?.id, 120),
      source: clip(b?.source, 24),
      label: clip(b?.label, 90),
      placement: clip(b?.placement, 16),
      category: clip(b?.category, 40),
      combo: b?.combo === true,
    }))
    .filter((b) => b.id);
  if (!blocks.length) return null;
  const brand = raw.brand && typeof raw.brand === "object" ? {
    id: clip(raw.brand.id, 60),
    label: clip(raw.brand.label, 80),
    blockTag: clip(raw.brand.blockTag, 40),
    theme: Object.fromEntries(Object.entries(raw.brand.theme && typeof raw.brand.theme === "object" ? raw.brand.theme : {})
      .slice(0, 16).map(([k, v]) => [clip(k, 32), clip(v, 32)])),
  } : null;
  const kit = clip(raw.kit, 16) || "promo";
  const keys = new Set();
  for (const b of blocks) { keys.add(b.id); keys.add(`${b.source}:${b.id}`); }
  return { brand, kit, blocks, keys };
}

/** Можно ли поставить этот блок библиотеки в текущем каталоге. */
export function catalogAllows(catalog, block) {
  if (!catalog) return true;
  if (!block?.id) return false;
  if (block.source && catalog.keys.has(`${block.source}:${block.id}`)) return true;
  return catalog.keys.has(block.id);
}

/** Сузить библиотеку до каталога (без каталога — как есть). */
export function filterByCatalog(catalog, blocks) {
  if (!catalog) return blocks;
  return (blocks || []).filter((block) => catalogAllows(catalog, block));
}

/** Похожие блоки из каталога — когда агент попросил чужой. */
export function catalogAlternatives(catalog, block, limit = 6) {
  if (!catalog) return [];
  const placement = String(block?.placement || "");
  const category = String(block?.category || "");
  const scored = catalog.blocks.map((b) => ({
    b,
    score: (b.placement === placement ? 2 : 0) + (category && b.category === category ? 1 : 0),
  })).filter((x) => x.score > 0).sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map(({ b }) => ({ id: b.id, label: b.label, placement: b.placement, category: b.category }));
}

/** Строка контекста для модели: бренд, набор и что можно ставить. */
export function describeCatalogForAgent(catalog) {
  if (!catalog) return "";
  const brand = catalog.brand
    ? `${catalog.brand.label || catalog.brand.id} (${catalog.brand.id}${catalog.brand.blockTag ? `, блоки с тегом ${catalog.brand.blockTag}` : ""})`
    : "не выбран";
  const theme = catalog.brand?.theme && Object.keys(catalog.brand.theme).length
    ? `Цвета бренда: ${Object.entries(catalog.brand.theme).map(([k, v]) => `${k} ${v}`).join(", ")}.`
    : "";
  const groups = new Map();
  for (const b of catalog.blocks) {
    const key = b.combo ? "combo" : (b.placement || "other");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(`${b.id} — ${b.label}${b.category ? ` [${b.category}]` : ""}`);
  }
  const order = ["outer", "section", "combo", "inner", "inline", "both", "other"];
  const lines = [];
  for (const key of order) {
    if (!groups.has(key)) continue;
    lines.push(`  ${key}:`);
    for (const line of groups.get(key)) lines.push(`    ${line}`);
  }
  return [
    `Бренд письма: ${brand}. Набор: ${catalog.kit}. ${theme}`.trim(),
    `Ставить можно ТОЛЬКО эти блоки (${catalog.blocks.length}, ровно то, что человек видит в каталоге):`,
    ...lines,
  ].join("\n");
}
