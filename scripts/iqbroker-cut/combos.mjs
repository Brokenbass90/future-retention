#!/usr/bin/env node
/**
 * scripts/iqbroker-cut/combos.mjs — рецепты (комбо) IQ Broker.
 *
 * Комбо — это не новый блок, а сборка из уже нарезанных: контейнер плюс
 * содержимое с заранее выставленными слотами. Ставится одним кликом, дальше
 * разбирается и правится как обычные блоки.
 *
 * Тексты — заглушки на русском, как в остальном каталоге. Плейсхолдеры локали
 * (`${{ ns.block_01 }}$`) в рецепты не зашиваем: они принадлежат конкретному
 * письму, а не блоку. Исключение — футер: там подставляются системные
 * переменные платформы, они одинаковы во всех письмах.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import url from "node:url";

const repoRoot = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..", "..");
const OUT = path.join(repoRoot, "data", "block-library", "canonical");

const IMG = (n) => `https://fsms.quadcode.com/storage/public/d5/th/${n}`;
const S1 = IMG("oj8ggnfnh4cs77a0/strategies-1.png");
const S2 = IMG("oj0ggnfnh4cs7790/strategies-2.png");
const S3 = IMG("oj7vhhgea139uk10/strategies-3.png");
const S5 = IMG("oj8ggnfnh4cs779g/strategies-5.png");
const S6 = IMG("oj7vhhgea139uk0g/strategies-6.png");

/** Колонка со списком: заголовок, картинка, три пункта. */
const columnList = (role, side, title, image, items) => [
  { id: "iqbr-block-title", parentRole: role, slotId: side, role: `${side}-title`, slots: { text: title, padding_bottom: "16px" } },
  { id: "iqbr-image", parentRole: role, slotId: side, role: `${side}-image`, slots: { image, padding_bottom: "16px" } },
  { id: "iqbr-list-3", parentRole: role, slotId: side, role: `${side}-list`, slots: { item_1: items[0], item_2: items[1], item_3: items[2] } },
];

/** Колонка со сценарием: заголовок, картинка, заметка с цветным итогом. */
const columnNote = (role, side, title, image, note, accent, accentColor) => [
  { id: "iqbr-block-title", parentRole: role, slotId: side, role: `${side}-title`, slots: { text: title, padding_bottom: "16px" } },
  { id: "iqbr-image", parentRole: role, slotId: side, role: `${side}-image`, slots: { image, padding_bottom: "16px" } },
  { id: "iqbr-block-note", parentRole: role, slotId: side, role: `${side}-note`, slots: { text: note, subtitle: "Итог", note: "Результат:", accent, accent_color: accentColor } },
];

const COMBOS = [
  {
    id: "iqbr-combo-header-hero",
    label: "Комбо: Начало письма (лого + тёмный герой)",
    description: "Шапка с логотипом и тёмная панель: картинка, крупный заголовок, два абзаца и кнопка. С этого начинается письмо IQ Broker.",
    placement: "section",
    category: "hero",
    children: [
      { id: "iqbr-section-header", role: "container", slots: {} },
      { id: "iqbr-logo", slotId: "content", role: "logo", slots: {} },
      { id: "iqbr-section-dark", role: "hero", slots: {} },
      { id: "iqbr-image", parentRole: "hero", slotId: "media", role: "hero-image", slots: {
        image: IMG("ok8ggnfnh4cs77ag/strategies-head.png"), padding_bottom: "0",
      } },
      { id: "iqbr-title-white", parentRole: "hero", slotId: "content", role: "hero-title", slots: { text: "Крупный заголовок письма" } },
      { id: "iqbr-text-white", parentRole: "hero", slotId: "content", role: "hero-text-1", slots: { text: "Первый абзац вступления — что предлагаем и кому." } },
      { id: "iqbr-text-white", parentRole: "hero", slotId: "content", role: "hero-text-2", slots: { text: "Второй абзац — что человек получит." } },
      { id: "iqbr-spacer", parentRole: "hero", slotId: "content", role: "hero-gap", slots: { height: "24px" } },
      { id: "iqbr-button", parentRole: "hero", slotId: "content", role: "hero-cta", slots: { label: "Перейти", align: "left" } },
    ],
  },
  {
    id: "iqbr-combo-intro-card",
    label: "Комбо: Карточка с обводкой (заголовок + текст)",
    description: "Скруглённая карточка с обводкой, заголовок и серый абзац под ним. Дальше в неё кладётся что угодно.",
    placement: "section",
    category: "layout",
    children: [
      { id: "iqbr-section-bordered", role: "container", slots: {} },
      { id: "iqbr-title-middle", slotId: "content", role: "title", slots: { text: "Заголовок карточки" } },
      { id: "iqbr-text-gray", slotId: "content", role: "body", slots: { text: "Пояснение под заголовком — одна-две строки." } },
    ],
  },
  {
    id: "iqbr-combo-two-columns-list",
    label: "Комбо: Двойной блок со списками",
    description: "Две тёмные колонки: в каждой заголовок, картинка и список из трёх пунктов. На мобильном — друг под другом.",
    placement: "inner",
    category: "layout",
    children: [
      { id: "iqbr-two-columns", role: "cols", slots: {} },
      ...columnList("cols", "left", "Первый вариант", S2, ["Первый пункт", "Второй пункт", "Третий пункт"]),
      ...columnList("cols", "right", "Второй вариант", S3, ["Первый пункт", "Второй пункт", "Третий пункт"]),
    ],
  },
  {
    id: "iqbr-combo-two-columns-compare",
    label: "Комбо: Двойной блок «плюс и минус»",
    description: "Две колонки со сценариями: картинка, текст под пунктиром и итог — зелёный слева, красный справа.",
    placement: "inner",
    category: "layout",
    children: [
      { id: "iqbr-two-columns", role: "cols", slots: {} },
      ...columnNote("cols", "left", "Как надо", S5, "Что происходит в этом сценарии.", "+10%", "#3BA581"),
      ...columnNote("cols", "right", "Как не надо", S6, "Что происходит в этом сценарии.", "−10%", "#E72828"),
    ],
  },
  {
    id: "iqbr-combo-card-columns",
    label: "Комбо: Карточка с двумя колонками и кнопкой",
    description: "Карточка с обводкой целиком: заголовок, текст, широкая картинка, две колонки со списками и кнопка внизу.",
    placement: "section",
    category: "layout",
    children: [
      { id: "iqbr-section-bordered", role: "container", slots: {} },
      { id: "iqbr-title-middle", slotId: "content", role: "title", slots: { text: "Заголовок карточки" } },
      { id: "iqbr-text-gray", slotId: "content", role: "body", slots: { text: "Пояснение под заголовком — одна-две строки." } },
      { id: "iqbr-image", slotId: "content", role: "image", slots: { image: S1, padding_bottom: "20px" } },
      { id: "iqbr-two-columns", slotId: "content", role: "cols", slots: {} },
      ...columnList("cols", "left", "Первый вариант", S2, ["Первый пункт", "Второй пункт", "Третий пункт"]),
      ...columnList("cols", "right", "Второй вариант", S3, ["Первый пункт", "Второй пункт", "Третий пункт"]),
      { id: "iqbr-spacer", slotId: "content", role: "gap", slots: { height: "40px" } },
      { id: "iqbr-button", slotId: "content", role: "cta", slots: { label: "Перейти", align: "center" } },
    ],
  },
  {
    id: "iqbr-combo-card-compare",
    label: "Комбо: Карточка «плюс и минус» с кнопкой",
    description: "Карточка с обводкой: заголовок, текст, две колонки со сценариями (зелёный и красный итог) и кнопка.",
    placement: "section",
    category: "layout",
    children: [
      { id: "iqbr-section-bordered", role: "container", slots: {} },
      { id: "iqbr-title-middle", slotId: "content", role: "title", slots: { text: "Сравнение двух сценариев" } },
      { id: "iqbr-text-gray", slotId: "content", role: "body", slots: { text: "Коротко о том, что сравниваем." } },
      { id: "iqbr-two-columns", slotId: "content", role: "cols", slots: {} },
      ...columnNote("cols", "left", "Как надо", S5, "Что происходит в этом сценарии.", "+10%", "#3BA581"),
      ...columnNote("cols", "right", "Как не надо", S6, "Что происходит в этом сценарии.", "−10%", "#E72828"),
      { id: "iqbr-spacer", slotId: "content", role: "gap", slots: { height: "40px" } },
      { id: "iqbr-button", slotId: "content", role: "cta", slots: { label: "Перейти", align: "center" } },
    ],
  },
  {
    id: "iqbr-combo-card-list",
    label: "Комбо: Карточка со списком и кнопкой",
    description: "Карточка с обводкой: заголовок, текст, подзаголовок, картинка, список из двух пунктов и кнопка.",
    placement: "section",
    category: "layout",
    children: [
      { id: "iqbr-section-bordered", role: "container", slots: {} },
      { id: "iqbr-title-middle", slotId: "content", role: "title", slots: { text: "Заголовок карточки" } },
      { id: "iqbr-text-gray", slotId: "content", role: "body", slots: { text: "Пояснение под заголовком — одна-две строки." } },
      { id: "iqbr-block-title", slotId: "content", role: "subtitle", slots: { text: "Подзаголовок", padding_bottom: "12px" } },
      { id: "iqbr-image", slotId: "content", role: "image", slots: { image: IMG("ojvvhhgea139uk1g/strategies-4.png"), padding_bottom: "32px" } },
      { id: "iqbr-list-2", slotId: "content", role: "list", slots: { item_1: "Первый пункт", item_2: "Второй пункт" } },
      { id: "iqbr-spacer", slotId: "content", role: "gap", slots: { height: "40px" } },
      { id: "iqbr-button", slotId: "content", role: "cta", slots: { label: "Перейти", align: "center" } },
    ],
  },
  {
    id: "iqbr-combo-footer",
    label: "Комбо: Подвал письма (сторы + соцсети + футер)",
    description: "Конец письма целиком: кнопки магазинов, иконки соцсетей и футер с адресом, предупреждением о рисках и отпиской.",
    placement: "section",
    category: "footer",
    children: [
      { id: "iqbr-stores", role: "container", slots: {} },
      { id: "iqbr-socials", role: "socials", slots: {} },
      { id: "iqbr-footer", role: "footer", slots: {
        company_address: "{{embedded.company_address}}",
        risk_warning: "{{embedded.risk_warning}}",
        terms_href: "{{embedded.company_terms_link}}",
        conditions: "${{ footer.footer.conditions }}$",
        unsubscribe_href: "{{embedded.unsubscribe_link}}",
        unsubscribe: "${{ footer.footer.unsubscribe }}$",
      } },
    ],
  },
];

/* ─── Плоская разметка комбо ─────────────────────────────────────────────── */

/**
 * Комбо в этой студии — вещь двойная: `children` разворачиваются в
 * конструкторе, а `pug`/`styl` нужны, чтобы у комбо было собственное превью и
 * чтобы его можно было вставить как один блок. Поэтому здесь дети ещё и
 * «склеиваются» в готовую разметку с проставленными значениями слотов.
 */
const defOf = (id) => JSON.parse(readFileSync(path.join(OUT, `${id}.json`), "utf8"));

function fillSlots(pug, def, values) {
  let out = String(pug || "");
  for (const slot of def.slots || []) {
    const value = Object.prototype.hasOwnProperty.call(values || {}, slot.id) ? values[slot.id] : slot.default;
    out = out.replaceAll(`{{ ${slot.id} }}`, String(value ?? ""));
  }
  return out;
}

const indent = (text, pad) => text.split("\n").map((l) => (l.trim() ? pad + l : l)).join("\n");

/** Вставить детей на место маркера `//- {{ MARKER }}`, сохранив отступ. */
function spliceChildren(pug, marker, childrenPug) {
  const lines = pug.split("\n");
  const at = lines.findIndex((l) => l.includes(`{{ ${marker} }}`));
  if (at < 0) return pug;
  if (!childrenPug.trim()) { lines.splice(at, 1); return lines.join("\n"); }
  const pad = lines[at].match(/^\s*/)[0];
  lines.splice(at, 1, indent(childrenPug, pad));
  return lines.join("\n");
}

function renderChild(child, all) {
  const def = defOf(child.id);
  let pug = fillSlots(def.pug, def, child.slots);
  for (const childSlot of def.childSlots || []) {
    const nested = all
      .filter((c) => c.parentRole === child.role && (c.slotId || "") === childSlot.id)
      .map((c) => renderChild(c, all))
      .join("\n");
    pug = spliceChildren(pug, childSlot.marker, nested);
  }
  return pug;
}

function flatten(combo) {
  const all = combo.children;
  const container = all[0];
  const containerDef = defOf(container.id);
  const rendered = [];
  const styl = new Map();

  const collectStyl = (id) => {
    const def = defOf(id);
    if (def.styl && !styl.has(id)) styl.set(id, def.styl);
  };
  for (const child of all) collectStyl(child.id);

  if ((containerDef.childSlots || []).length) {
    // Контейнер с содержимым: дети без parentRole идут в его слот.
    let pug = fillSlots(containerDef.pug, containerDef, container.slots);
    for (const childSlot of containerDef.childSlots) {
      const inner = all
        .slice(1)
        // parentRole может указывать на сам контейнер (двойной блок — это и
        // контейнер комбо, и родитель своих колонок).
        .filter((c) => (!c.parentRole || c.parentRole === container.role) && (c.slotId || "") === childSlot.id)
        .map((c) => renderChild(c, all))
        .join("\n");
      pug = spliceChildren(pug, childSlot.marker, inner);
    }
    rendered.push(pug);
    // Секции-соседи (без slotId) идут следом отдельными рядами.
    for (const child of all.slice(1)) {
      if (child.parentRole || child.slotId) continue;
      rendered.push(renderChild(child, all));
    }
  } else {
    for (const child of all) {
      if (child.parentRole) continue;
      rendered.push(renderChild(child, all));
    }
  }
  return { pug: rendered.join("\n\n"), styl: [...styl.values()].join("\n") };
}

for (const combo of COMBOS) {
  const flat = flatten(combo);
  const block = {
    id: combo.id,
    label: combo.label,
    description: combo.description,
    placement: combo.placement,
    category: combo.category,
    version: 1,
    pug: flat.pug,
    styl: flat.styl,
    slots: [],
    combo: true,
    children: combo.children,
    outlookSafe: true,
    tags: ["iqbroker", "combo", combo.category],
    note: "Рецепт: ставит готовый набор блоков IQ Broker. Разбирается и правится как обычные блоки. Собственная разметка нужна для превью и для вставки одним блоком.",
  };
  writeFileSync(path.join(OUT, `${combo.id}.json`), JSON.stringify(block, null, 2) + "\n");
  console.log(`${combo.id.padEnd(32)} ${combo.children.length} блоков · pug ${flat.pug.length}B · styl ${flat.styl.length}B`);
}
