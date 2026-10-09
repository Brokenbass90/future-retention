/**
 * src/brands.js — бренд как сущность, а не имя папки.
 *
 * До этого «бренд» существовал в двух видах: имя каталога `email-base/X_*` и
 * захардкоженный список активных в `active-base-policy.js`. Нельзя было ни
 * завести новый бренд из интерфейса, ни привязать к нему фирменные цвета.
 *
 * Здесь появляется реестр: название, папка, тема (цветовые токены) и признак
 * активности. Реестр самозасевается из того, что уже лежит на диске, поэтому
 * подключение ничего не ломает: до первой правки он просто отражает текущее
 * состояние.
 *
 * Тема — это именованные токены (`primary`, `text`, `background`…), а не
 * произвольный CSS. Из них потом собираются универсальные блоки, которые
 * перекрашиваются переключением бренда. Значения только HEX: в почтовой
 * вёрстке цвет должен быть явным `#RRGGBB`, без `rgb()` и именованных.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import path from "node:path";
import url from "node:url";
import { ACTIVE_EMAIL_BASE_BRANDS, SERVICE_EMAIL_BASE_BRANDS } from "./active-base-policy.js";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const emailBase = path.join(repoRoot, "email-base");
export const BRANDS_PATH = path.join(repoRoot, "data", "brands.json");

/** Токены темы. Порядок важен: в таком виде показываем в интерфейсе. */
export const THEME_TOKENS = Object.freeze([
  { id: "primary", label: "Основной", fallback: "#FF7700" },
  { id: "primary_text", label: "Текст на основном", fallback: "#FFFFFF" },
  { id: "text", label: "Текст", fallback: "#393A44" },
  { id: "muted", label: "Второстепенный текст", fallback: "#6B7280" },
  { id: "background", label: "Фон письма", fallback: "#F9F9F9" },
  { id: "surface", label: "Фон карточки", fallback: "#FFFFFF" },
  { id: "border", label: "Рамки и линии", fallback: "#ECECED" },
  { id: "link", label: "Ссылки", fallback: "#2563EB" },
]);

const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

export class BrandError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = "BrandError";
    this.statusCode = statusCode;
  }
}

/* ─── Нормализация ───────────────────────────────────────────────────────── */

/** `#f70` → `#FF7700`. Всё, что не HEX, отвергаем: см. комментарий в шапке. */
export function normalizeHex(value, { field = "цвет" } = {}) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const m = HEX_RE.exec(raw);
  if (!m) throw new BrandError(`${field}: ожидается HEX вида #RRGGBB, получено "${raw.slice(0, 20)}"`);
  const body = m[1].length === 3
    ? m[1].split("").map((c) => c + c).join("")
    : m[1];
  return `#${body.toUpperCase()}`;
}

/** Кириллица в имени папки недопустима, но и терять её нельзя: транслитерируем. */
const TRANSLIT = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i",
  й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t",
  у: "u", ф: "f", х: "h", ц: "c", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "",
  э: "e", ю: "yu", я: "ya",
};

function transliterate(word) {
  return [...word].map((char) => {
    const lower = char.toLowerCase();
    const mapped = TRANSLIT[lower];
    if (mapped === undefined) return char;
    // Сохраняем регистр первой буквы: «Бренд» → «Brend», а не «brend».
    return char === lower ? mapped : mapped.charAt(0).toUpperCase() + mapped.slice(1);
  }).join("");
}

/** «IQ Broker» → `X_IQBroker`, «Новый бренд» → `X_NovyyBrend`. */
export function brandFolderFromLabel(label) {
  const words = String(label || "").trim().split(/[\s_-]+/).filter(Boolean);
  const camel = words
    .map((w) => transliterate(w).replace(/[^a-zA-Z0-9]/g, ""))
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join("");
  if (!camel || !/[a-zA-Z]/.test(camel)) {
    throw new BrandError(
      "из названия не получается имя папки — добавь буквы или задай id вручную",
    );
  }
  return `X_${camel}`.slice(0, 48);
}

function normalizeTheme(theme, { partial = false } = {}) {
  const out = {};
  for (const token of THEME_TOKENS) {
    const raw = theme?.[token.id];
    if (raw === undefined || raw === null || raw === "") {
      if (!partial) out[token.id] = token.fallback;
      continue;
    }
    out[token.id] = normalizeHex(raw, { field: token.label });
  }
  return out;
}

/**
 * Метка бренда в библиотеке блоков.
 *
 * Блоки помечены тегом семьи (`iq`, `iqbroker`) — по нему каталог понимает,
 * чьи это блоки. Тег выводится из папки, но его можно задать руками: имя папки
 * и имя семьи в библиотеке совпадают не всегда.
 */
export function blockTagFromId(id) {
  return String(id || "").replace(/^X_/, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalizeBrand(entry) {
  const id = String(entry?.id || "").trim();
  if (!/^X_[A-Za-z0-9_]{1,45}$/.test(id)) {
    throw new BrandError(`некорректный id бренда: "${id.slice(0, 30)}"`);
  }
  return {
    id,
    label: String(entry?.label || id.replace(/^X_/, "")).trim().slice(0, 80),
    active: entry?.active !== false,
    service: Boolean(entry?.service),
    blockTag: String(entry?.blockTag || blockTagFromId(id)).toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 40),
    // Порядок вкладок задаётся руками: первый в списке становится брендом по
    // умолчанию, а по алфавиту первым оказывался служебный X_assembled.
    order: Number.isFinite(Number(entry?.order)) ? Number(entry.order) : 100,
    theme: normalizeTheme(entry?.theme),
    createdAt: String(entry?.createdAt || new Date().toISOString()),
    updatedAt: String(entry?.updatedAt || new Date().toISOString()),
  };
}

/* ─── Чтение и посев ─────────────────────────────────────────────────────── */

/** Папки брендов, реально лежащие на диске. */
export function brandFoldersOnDisk() {
  if (!existsSync(emailBase)) return [];
  return readdirSync(emailBase)
    .filter((name) => name.startsWith("X_"))
    .filter((name) => {
      try { return statSync(path.join(emailBase, name)).isDirectory(); } catch { return false; }
    })
    .sort();
}

/**
 * Реестр брендов. Если файла нет — собираем из того, что на диске, и из
 * прежнего захардкоженного списка активных. Так подключение реестра не меняет
 * поведение студии, пока никто ничего не создал.
 */
export function loadBrands() {
  let stored = null;
  try { stored = JSON.parse(readFileSync(BRANDS_PATH, "utf8")); } catch { /* нет файла — засеем */ }

  const byId = new Map();
  for (const raw of Array.isArray(stored?.brands) ? stored.brands : []) {
    try { const b = normalizeBrand(raw); byId.set(b.id, b); } catch { /* битую запись пропускаем */ }
  }

  const activeSet = new Set(ACTIVE_EMAIL_BASE_BRANDS);
  const serviceSet = new Set(SERVICE_EMAIL_BASE_BRANDS);
  for (const folder of brandFoldersOnDisk()) {
    if (byId.has(folder)) continue;
    byId.set(folder, normalizeBrand({
      id: folder,
      label: folder.replace(/^X_/, ""),
      // Пока реестр не тронут руками, видимость повторяет прежнюю политику.
      active: activeSet.has(folder) || serviceSet.has(folder),
      service: serviceSet.has(folder),
    }));
  }

  return [...byId.values()].sort((a, b) => {
    if (a.service !== b.service) return a.service ? 1 : -1;
    if (a.active !== b.active) return a.active ? -1 : 1;
    if (a.order !== b.order) return a.order - b.order;
    return a.label.localeCompare(b.label);
  });
}

export function saveBrands(brands) {
  const normalized = brands.map(normalizeBrand);
  mkdirSync(path.dirname(BRANDS_PATH), { recursive: true });
  writeFileSync(BRANDS_PATH, JSON.stringify({
    updatedAt: new Date().toISOString(),
    brands: normalized,
  }, null, 2) + "\n");
  return normalized;
}

export function getBrand(id) {
  return loadBrands().find((b) => b.id === String(id || "")) || null;
}

/* ─── Изменения ──────────────────────────────────────────────────────────── */

/**
 * Завести бренд. Папка письма создаётся сразу пустой — иначе бренд есть в
 * списке, а положить в него письмо некуда, и это выглядит как поломка.
 */
export function createBrand({ label, id, theme, blockTag, order } = {}) {
  const brands = loadBrands();
  const folder = id ? String(id).trim() : brandFolderFromLabel(label);
  if (brands.some((b) => b.id === folder)) {
    throw new BrandError(`бренд ${folder} уже есть`, 409);
  }
  const brand = normalizeBrand({
    id: folder,
    label: label || folder.replace(/^X_/, ""),
    active: true,
    theme,
    // Тег блоков и порядок вкладки можно задать сразу: заводя бренд руками,
    // человек обычно уже знает, как назвать его блоки и где ему стоять.
    ...(blockTag ? { blockTag } : {}),
    ...(order !== undefined ? { order } : {}),
  });
  mkdirSync(path.join(emailBase, folder), { recursive: true });
  saveBrands([...brands, brand]);
  return brand;
}

export function updateBrand(id, patch = {}) {
  const brands = loadBrands();
  const index = brands.findIndex((b) => b.id === String(id || ""));
  if (index < 0) throw new BrandError(`бренд ${id} не найден`, 404);

  const current = brands[index];
  const next = normalizeBrand({
    ...current,
    ...(patch.label !== undefined ? { label: patch.label } : {}),
    ...(patch.active !== undefined ? { active: Boolean(patch.active) } : {}),
    ...(patch.blockTag !== undefined ? { blockTag: patch.blockTag } : {}),
    ...(patch.order !== undefined ? { order: patch.order } : {}),
    // Служебный бренд не показывается вкладкой: это не рабочий контекст,
    // а техническая папка (превью конструктора, архив, свалка сборок).
    ...(patch.service !== undefined ? { service: Boolean(patch.service) } : {}),
    // Тему мержим, а не заменяем: интерфейс присылает один изменённый токен.
    theme: { ...current.theme, ...normalizeTheme(patch.theme, { partial: true }) },
    createdAt: current.createdAt,
    updatedAt: new Date().toISOString(),
  });
  const nextList = [...brands];
  nextList[index] = next;
  saveBrands(nextList);
  return next;
}

/* ─── Тема в вёрстку ─────────────────────────────────────────────────────── */

/**
 * Токены темы как Stylus-переменные — чтобы блок мог написать
 * `color: $brand_text` и перекрашиваться вместе с брендом.
 */
export function themeAsStylus(brand) {
  const theme = brand?.theme || {};
  return THEME_TOKENS
    .map((token) => `$brand_${token.id} = ${theme[token.id] || token.fallback}`)
    .join("\n") + "\n";
}

/** Тема для подстановки в слоты блока: { brand_primary: "#FF7700", … }. */
export function themeSlotValues(brand) {
  const theme = brand?.theme || {};
  const out = {};
  for (const token of THEME_TOKENS) out[`brand_${token.id}`] = theme[token.id] || token.fallback;
  return out;
}
