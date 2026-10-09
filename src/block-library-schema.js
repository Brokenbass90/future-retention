const BLOCK_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const MARKER_RE = /^[A-Z][A-Z0-9_]{0,63}$/;
const SOURCE_RE = /^[a-z][a-z0-9_-]{0,39}$/i;
const ROLE_RE = /^[a-z][a-z0-9_-]{0,63}$/i;
const APPEARANCE_KEYS = new Set(["background_color", "border", "radius", "padding"]);

export const BLOCK_PLACEMENTS = Object.freeze([
  "outer",
  "section",
  "inner",
  "inline",
  "helper",
  "both",
]);

const placementSet = new Set(BLOCK_PLACEMENTS);

/**
 * Набор блоков — ось, независимая от бренда и от placement.
 *
 *   promo  — рекламное письмо: комбо, герои, соцсети, сторы;
 *   system — сервисное письмо: короткий список простых блоков.
 *
 * Отдельное поле, а не тег: теги уже несут владельца-бренд (`iq`, `iqbroker`),
 * `combo` и `combo-divider`, и brandOf()/фильтр комбо разбирают их по строкам.
 * Новая ось в той же куче начала бы цепляться за чужие правила.
 *
 * Оси намеренно НЕсимметричны, и это главное решение здесь:
 *
 *   promo  — fail-open: блок без `kits` виден. Иначе подключение оси разом
 *            спрятало бы всю существующую библиотеку.
 *   system — whitelist: блок виден, только если сам себя объявил системным.
 *            Смысл набора в том, что кусков МЕНЬШЕ; fail-open здесь вернул бы
 *            в короткий список все 78 промо-блоков и обнулил бы набор.
 *
 * Блок может состоять в обоих наборах — так и сделаны простые `sys-*`: они и
 * скелет системного письма, и кубики для промки без дизайнера.
 */
export const BLOCK_KITS = Object.freeze(["promo", "system"]);

const kitSet = new Set(BLOCK_KITS);

export function normalizeKits(value, path = "kits") {
  if (value == null) return [];
  if (!Array.isArray(value)) fail(path, `must be an array of: ${BLOCK_KITS.join(", ")}`);
  const out = [];
  for (const [index, raw] of value.entries()) {
    const kit = String(raw ?? "").trim().toLowerCase();
    if (!kitSet.has(kit)) fail(`${path}[${index}]`, `must be one of: ${BLOCK_KITS.join(", ")}`);
    if (!out.includes(kit)) out.push(kit);
  }
  return out;
}

/**
 * `slotPresets` — «выбрал вариант в одном слоте, подставились значения в другие».
 *
 * Нужен ровно для того, чтобы человек НЕ подбирал цвета руками и при этом
 * ВИДЕЛ, что стоит сейчас. Плашка с тоном «успех» кладёт в поля фона и полосы
 * конкретные HEX; поля перестают быть пустыми, и их можно переопределить.
 * Держать цвет только в стилях нельзя: инспектор показывал бы пустоту и правка
 * фона молча ничего не делала бы.
 *
 * Форма: { <slotId>: { <значение слота>: { <другойSlotId>: "значение" } } }.
 */
export function normalizeSlotPresets(value, path = "slotPresets") {
  if (value == null) return {};
  if (typeof value !== "object" || Array.isArray(value)) fail(path, "must be an object");
  const out = {};
  for (const [driverId, byValue] of Object.entries(value)) {
    const at = `${path}.${driverId}`;
    normalizeId(driverId, `${at} (slot id)`);
    if (!byValue || typeof byValue !== "object" || Array.isArray(byValue)) fail(at, "must be an object");
    const branch = {};
    for (const [optionValue, assignments] of Object.entries(byValue)) {
      const where = `${at}["${optionValue}"]`;
      if (!assignments || typeof assignments !== "object" || Array.isArray(assignments)) {
        fail(where, "must be an object of slotId → value");
      }
      const target = {};
      for (const [targetId, targetValue] of Object.entries(assignments)) {
        normalizeId(targetId, `${where}.${targetId}`);
        if (!["string", "number", "boolean"].includes(typeof targetValue)) {
          fail(`${where}.${targetId}`, "must be a string, number or boolean");
        }
        target[targetId] = String(targetValue);
      }
      branch[String(optionValue)] = target;
    }
    out[driverId] = branch;
  }
  return out;
}

/** Значения, которые подставляет выбор `value` в слоте `slotId`. */
export function slotPresetAssignments(block, slotId, value) {
  const presets = block?.slotPresets;
  if (!presets || typeof presets !== "object") return null;
  const branch = presets[String(slotId)];
  if (!branch || typeof branch !== "object") return null;
  const assignments = branch[String(value)];
  return assignments && typeof assignments === "object" ? assignments : null;
}

/** Правило видимости блока в наборе — см. комментарий выше. */
export function blockAllowedInKit(block, kit) {
  const kits = Array.isArray(block?.kits) ? block.kits : [];
  const target = String(kit || "").toLowerCase();
  if (target === "system") return kits.includes("system");
  return !kits.length || kits.includes(target);
}

export class BlockLibrarySchemaError extends Error {
  constructor(message) {
    super(message);
    this.name = "BlockLibrarySchemaError";
    this.statusCode = 400;
  }
}

function fail(path, message) {
  throw new BlockLibrarySchemaError(`${path} ${message}`);
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function copyJsonValue(value, path) {
  if (value === undefined) return undefined;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    fail(path, "must be JSON-serializable");
  }
}

function normalizeId(value, path) {
  const id = String(value ?? "").trim();
  if (!BLOCK_ID_RE.test(id)) {
    fail(path, "must be 1-64 chars and contain only letters, digits, _ or -");
  }
  return id;
}

function normalizePlacement(value, path) {
  if (value == null || value === "") {
    fail(path, "is required");
  }
  if (typeof value !== "string" || !placementSet.has(value)) {
    fail(path, `must be one of: ${BLOCK_PLACEMENTS.join(", ")}`);
  }
  return value;
}

function normalizeBoolean(value, path) {
  if (typeof value !== "boolean") fail(path, "must be a boolean");
  return value;
}

function normalizeSlots(value) {
  if (value == null) return [];
  if (!Array.isArray(value)) fail("slots", "must be an array");

  const seen = new Set();
  return value.map((raw, index) => {
    const at = `slots[${index}]`;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail(at, "must be an object");
    const id = normalizeId(raw.id, `${at}.id`);
    if (seen.has(id)) fail(`${at}.id`, `duplicates slot id "${id}"`);
    seen.add(id);

    const slot = {
      id,
      kind: String(raw.kind || "text").trim().slice(0, 40) || "text",
      label: String(raw.label || id).trim().slice(0, 120),
    };
    for (const key of ["default", "min", "max", "options"]) {
      if (hasOwn(raw, key)) slot[key] = copyJsonValue(raw[key], `${at}.${key}`);
    }
    if (hasOwn(raw, "perLocale")) {
      slot.perLocale = normalizeBoolean(raw.perLocale, `${at}.perLocale`);
    }
    if (hasOwn(raw, "allowSystemPlaceholder")) {
      slot.allowSystemPlaceholder = normalizeBoolean(
        raw.allowSystemPlaceholder,
        `${at}.allowSystemPlaceholder`
      );
    }
    if (hasOwn(raw, "uiGroup")) {
      if (typeof raw.uiGroup !== "string") fail(`${at}.uiGroup`, "must be a string");
      slot.uiGroup = raw.uiGroup.trim().slice(0, 80);
    }
    return slot;
  });
}

function normalizeChildSlots(value, pug) {
  if (value == null) return [];
  if (!Array.isArray(value)) fail("childSlots", "must be an array");

  const ids = new Set();
  const markers = new Set();
  return value.map((raw, index) => {
    const at = `childSlots[${index}]`;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail(at, "must be an object");
    const id = normalizeId(raw.id, `${at}.id`);
    if (ids.has(id)) fail(`${at}.id`, `duplicates child slot id "${id}"`);
    ids.add(id);

    const marker = String(raw.marker ?? "").trim();
    if (!MARKER_RE.test(marker)) {
      fail(`${at}.marker`, "must be a bare uppercase token such as INNER_BLOCKS");
    }
    if (markers.has(marker)) fail(`${at}.marker`, `duplicates marker "${marker}"`);
    markers.add(marker);
    const markerPattern = new RegExp(`\\{\\{\\s*${marker}\\s*\\}\\}`);
    if (!markerPattern.test(pug)) {
      fail(`${at}.marker`, `"${marker}" is not present in pug as {{ ${marker} }}`);
    }

    if (!Array.isArray(raw.accepts) || raw.accepts.length === 0) {
      fail(`${at}.accepts`, "must be a non-empty array");
    }
    const accepts = [...new Set(raw.accepts.map((placement, placementIndex) =>
      normalizePlacement(placement, `${at}.accepts[${placementIndex}]`)
    ))];
    return { id, marker, accepts };
  });
}

function normalizeSlotValues(value, path) {
  if (value == null) return {};
  if (typeof value !== "object" || Array.isArray(value)) fail(path, "must be an object");
  const out = Object.create(null);
  for (const [key, raw] of Object.entries(value)) {
    const id = normalizeId(key, `${path}.${key}`);
    out[id] = copyJsonValue(raw, `${path}.${key}`);
  }
  return out;
}

function normalizeAppearance(value, path = "appearance") {
  if (value == null) return {};
  if (typeof value !== "object" || Array.isArray(value)) fail(path, "must be an object");
  const out = Object.create(null);
  for (const [key, raw] of Object.entries(value)) {
    if (!APPEARANCE_KEYS.has(key)) fail(`${path}.${key}`, "is not a supported appearance field");
    if (typeof raw !== "string" && typeof raw !== "number") fail(`${path}.${key}`, "must be a CSS string or number");
    const cssValue = String(raw).trim().slice(0, 180);
    if (!cssValue) continue;
    if (/[;{}<>"'\r\n]/.test(cssValue) || !/^[a-z0-9#().,%+\-\s/]+$/i.test(cssValue)) {
      fail(`${path}.${key}`, "contains unsafe CSS characters");
    }
    out[key] = cssValue;
  }
  return out;
}

function normalizeChildren(value, parentChildSlots, depth = 0) {
  if (value == null) return [];
  if (!Array.isArray(value)) fail("children", "must be an array");
  if (depth > 12) fail("children", "nesting is deeper than 12 levels");
  if (value.length > 500) fail("children", "must contain at most 500 items per level");

  const validSlotIds = new Set(parentChildSlots.map((slot) => slot.id));
  return value.map((raw, index) => {
    const at = `${"children.".repeat(depth)}children[${index}]`;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail(at, "must be an object");
    const child = {
      id: normalizeId(raw.id, `${at}.id`),
    };
    if (hasOwn(raw, "source")) {
      if (typeof raw.source !== "string" || !SOURCE_RE.test(raw.source.trim())) {
        fail(`${at}.source`, "must be a short source id");
      }
      child.source = raw.source.trim();
    }
    for (const key of ["role", "parentRole"]) {
      if (!hasOwn(raw, key)) continue;
      if (typeof raw[key] !== "string" || !ROLE_RE.test(raw[key].trim())) {
        fail(`${at}.${key}`, "must be a short role id");
      }
      child[key] = raw[key].trim();
    }
    if (hasOwn(raw, "slotId") && raw.slotId != null && raw.slotId !== "") {
      child.slotId = normalizeId(raw.slotId, `${at}.slotId`);
      if (validSlotIds.size && !validSlotIds.has(child.slotId)) {
        fail(`${at}.slotId`, `references unknown child slot "${child.slotId}"`);
      }
    }
    child.slots = normalizeSlotValues(raw.slots, `${at}.slots`);
    if (hasOwn(raw, "appearance")) child.appearance = normalizeAppearance(raw.appearance, `${at}.appearance`);
    if (hasOwn(raw, "children")) {
      // Nested child-slot definitions belong to the referenced block and are not
      // duplicated in a recipe entry. Their slotId values are validated when
      // that referenced definition itself is saved.
      child.children = normalizeChildren(raw.children, [], depth + 1);
    }
    return child;
  });
}

/**
 * Validate and normalize the JSON persisted by POST /api/blocks-library/save.
 * This helper intentionally knows nothing about HTTP or the filesystem so the
 * schema can be regression-tested without starting the large studio server.
 */
export function normalizeBlockLibrarySavePayload(body, { createdAt = new Date().toISOString() } = {}) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    fail("body", "must be a JSON object");
  }

  const id = normalizeId(body.id, "id");
  const placement = hasOwn(body, "placement")
    ? normalizePlacement(body.placement, "placement")
    : "inner";
  const pug = String(body.pug || "");
  if (!pug.trim()) fail("pug", "content is required");
  const childSlots = normalizeChildSlots(body.childSlots, pug);

  const normalized = {
    id,
    label: String(body.label || id).trim().slice(0, 120),
    description: String(body.description || "").trim().slice(0, 400),
    placement,
    category: String(body.category || "misc").trim().slice(0, 40) || "misc",
    version: 1,
    source: "user",
    pug,
    styl: String(body.styl || ""),
    slots: normalizeSlots(body.slots),
    tags: Array.isArray(body.tags) ? body.tags.slice(0, 12).map((tag) => String(tag).slice(0, 40)) : [],
    createdAt,
  };

  if (hasOwn(body, "kits")) normalized.kits = normalizeKits(body.kits);
  if (hasOwn(body, "slotPresets")) normalized.slotPresets = normalizeSlotPresets(body.slotPresets);
  if (hasOwn(body, "childSlots")) normalized.childSlots = childSlots;
  if (hasOwn(body, "combo")) normalized.combo = normalizeBoolean(body.combo, "combo");
  // Признак «классы блока в собственном скоупе». Нужен и людям (видно, что
  // блок не столкнётся с чужими стилями), и инструментам: по нему отличают
  // мигрированную библиотеку от legacy-нарезки.
  if (hasOwn(body, "scoped")) normalized.scoped = normalizeBoolean(body.scoped, "scoped");
  if (hasOwn(body, "children")) normalized.children = normalizeChildren(body.children, childSlots);
  if (hasOwn(body, "appearance")) normalized.appearance = normalizeAppearance(body.appearance);
  if (hasOwn(body, "outlookSafe")) {
    normalized.outlookSafe = normalizeBoolean(body.outlookSafe, "outlookSafe");
  }
  if (hasOwn(body, "note")) normalized.note = String(body.note || "").slice(0, 1000);

  return normalized;
}
