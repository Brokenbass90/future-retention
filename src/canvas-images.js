/**
 * src/canvas-images.js — какие картинки письма ещё нужно дать агенту.
 *
 * Сценарий: человек присылает агенту картинку письма, агент собирает его из
 * блоков, а картинки (фон hero, баннер, иллюстрации) сам загрузить не может.
 * После сборки агент спрашивает этот список и просит у человека ссылки
 * ровно на те места, где стоит пустота или образцовая картинка блока.
 */
import { listCanonicalBlocks } from "./compose-email.js";

let defaultsCache = null;
function imageDefaults() {
  if (defaultsCache) return defaultsCache;
  const map = new Map();
  for (const block of listCanonicalBlocks() || []) {
    for (const slot of block?.slots || []) {
      if (String(slot?.kind) !== "image") continue;
      const value = String(slot?.default ?? "").trim();
      if (value) map.set(`${block.id}:${slot.id}`, value);
    }
    for (const child of block?.children || []) {
      for (const [slotId, value] of Object.entries(child?.slots || {})) {
        if (/^https?:/i.test(String(value)) && /\.(png|jpe?g|gif|webp)(\?|$)/i.test(String(value))) {
          const key = `${child.id}:${slotId}`;
          if (!map.has(key)) map.set(key, String(value).trim());
        }
      }
    }
  }
  defaultsCache = map;
  return map;
}

/** Иконки соцсетей, сторов и логотип бренда — это не «картинка письма». */
const SERVICE_SLOT = /(^|_)(icon|logo|app_img|google_img|store)(_|$)/i;

/**
 * @param {Array} summary — read_canvas: uid, blockId, slots, slotSchema
 * @returns {{needs: Array, filled: Array, message: string}}
 */
export function imageNeedsFrom(summary = [], _catalog = null, defaults = imageDefaults()) {
  const needs = [];
  const filled = [];
  for (const entry of summary || []) {
    for (const slot of entry?.slotSchema || []) {
      if (String(slot?.kind) !== "image") continue;
      const value = String(entry?.slots?.[slot.id] ?? "").trim();
      const item = { uid: entry.uid, blockId: entry.blockId, slot: slot.id, label: slot.label || slot.id, current: value || null };
      if (SERVICE_SLOT.test(slot.id) || /logo/i.test(String(entry.blockId))) { filled.push({ ...item, service: true }); continue; }
      const isSample = value && defaults.get(`${entry.blockId}:${slot.id}`) === value;
      if (!value || isSample) needs.push({ ...item, why: value ? "стоит образцовая картинка блока" : "пусто" });
      else filled.push(item);
    }
  }
  const message = needs.length
    ? `Нужны ссылки на ${needs.length} ${needs.length === 1 ? "картинку" : "картинки"}: ` +
      needs.map((n, i) => `${i + 1}) ${n.label} (блок ${n.blockId}, uid ${n.uid})`).join("; ") +
      ". Попросите человека прислать ссылки (картинки уже загружены в хранилище) и поставьте их через retkit_update_canvas_block."
    : "Все картинки письма заданы.";
  return { needs, filled, message };
}
