/**
 * src/block-previews.js — доступ к пререндеренным превью блоков.
 *
 * Картинки и сигнатуры делает `scripts/render-block-previews.mjs`, здесь только
 * чтение: индекс кэшируется в памяти и перечитывается по mtime файла, чтобы
 * прогон рендера подхватывался без перезапуска сервера.
 *
 * Сигнатура — это то, чем блок описывается для AI: размер, палитра, есть ли
 * картинка/кнопка/список/колонки, адаптивный ли. До неё модель выбирала блок
 * только по категории и авто-описанию вида «Импортирован из X_IQ (1 писем)».
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import url from "node:url";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
export const PREVIEW_ROOT = path.join(repoRoot, "data", "block-previews");
const INDEX_PATH = path.join(PREVIEW_ROOT, "index.json");

let cache = { mtimeMs: -1, index: { blocks: {} } };

function parseHexColor(value) {
  const match = String(value || "").trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!match) return null;
  const full = match[1].length === 3
    ? match[1].split("").map((char) => char + char).join("")
    : match[1];
  const number = Number.parseInt(full, 16);
  return [(number >> 16) & 255, (number >> 8) & 255, number & 255];
}

function relativeLuminance(rgb) {
  if (!rgb) return null;
  const linear = rgb.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return (0.2126 * linear[0]) + (0.7152 * linear[1]) + (0.0722 * linear[2]);
}

/**
 * Transparent light-text atoms are nearly invisible on the renderer's white
 * technical section. Give only their screenshot wrapper a dark backdrop;
 * this metadata never enters the real email or the constructor slot values.
 */
export function previewBackdropForBlock(block) {
  const slots = Array.isArray(block?.slots) ? block.slots : [];
  const hasOwnSurface = slots.some((slot) =>
    slot?.kind === "color" && /(?:background|surface|(?:^|_)bg(?:_|$))/i.test(String(slot?.id || ""))
  );
  if (hasOwnSurface) return "";

  const textColors = slots
    .filter((slot) => slot?.kind === "color" && /^(?:color|text_?color|font_?color)$/i.test(String(slot?.id || "")))
    .map((slot) => relativeLuminance(parseHexColor(slot?.default)))
    .filter((value) => Number.isFinite(value));
  // Contrast of white against a foreground with luminance L is
  // 1.05 / (L + .05). Below 3:1 the thumbnail is not legible.
  return textColors.some((luminance) => 1.05 / (luminance + 0.05) < 3)
    ? "#101314"
    : "";
}

/** Exact source identity used by both the renderer and the release gate. */
export function blockPreviewSourceHash(block) {
  const identity = [
    block?.pug || "",
    block?.styl || "",
    block?.slots || [],
    block?.childSlots || [],
    block?.version || 0,
    block?.appearance || {},
  ];
  const previewBackdrop = previewBackdropForBlock(block);
  if (previewBackdrop) identity.push({ previewBackdrop });
  // Preserve existing hashes for atomic blocks while making recipe previews
  // correctly stale when their embedded composition changes.
  if (block?.combo === true || (Array.isArray(block?.children) && block.children.length)) {
    identity.push(Boolean(block?.combo), block?.children || []);
  }
  return createHash("sha1").update(JSON.stringify(identity)).digest("hex").slice(0, 16);
}

export function loadPreviewIndex() {
  try {
    const stat = statSync(INDEX_PATH);
    if (stat.mtimeMs !== cache.mtimeMs) {
      cache = { mtimeMs: stat.mtimeMs, index: JSON.parse(readFileSync(INDEX_PATH, "utf8")) };
    }
  } catch {
    cache = { mtimeMs: -1, index: { blocks: {} } };
  }
  return cache.index;
}

export function invalidatePreviewIndex() { cache = { mtimeMs: -1, index: { blocks: {} } }; }

/** Превью одного блока в форме, пригодной для UI и для AI. */
export function previewForBlock(block) {
  if (!block || !block.id) return null;
  const index = loadPreviewIndex();
  const entry = index.blocks?.[`${block.source || "canonical"}:${block.id}`]
    // Блок мог переехать между директориями — ищем по id как запасной вариант.
    || Object.values(index.blocks || {}).find((b) => b.id === block.id);
  if (!entry) return null;
  if (entry.error) return { status: "failed", error: entry.error };
  // Группа одинаковых на вид блоков (scripts/group-block-duplicates.mjs):
  // каталог показывает одну плитку за группу, остальные прячет под бейдж.
  const group = entry.groupId && index.groups?.[entry.groupId]
    ? {
      id: entry.groupId,
      size: entry.groupSize || index.groups[entry.groupId].size || 1,
      primary: Boolean(entry.groupPrimary),
      members: index.groups[entry.groupId].members || [],
    }
    : null;
  return {
    status: "ok",
    desktop: entry.shots?.desktop ? toUrl(entry.shots.desktop) : null,
    mobile: entry.shots?.mobile ? toUrl(entry.shots.mobile) : null,
    signature: entry.signature || null,
    group,
  };
}

function toUrl(shot) {
  // data/block-previews/canonical/x.desktop.png → /block-previews/canonical/x.desktop.png
  const rel = String(shot.file || "").split(path.sep).join("/").replace(/^data\//, "");
  return { url: `/${rel}`, width: shot.width, height: shot.height };
}

export function attachPreviews(blocks) {
  return (blocks || []).map((b) => ({ ...b, preview: previewForBlock(b) }));
}

/**
 * Резолв пути картинки для статической раздачи. Возвращает абсолютный путь
 * внутри PREVIEW_ROOT или null — выход за корень не допускается.
 */
export function resolvePreviewFile(requestPath) {
  const rel = decodeURIComponent(String(requestPath || ""))
    .replace(/^\/+block-previews\/+/, "")
    .split("?")[0];
  if (!rel || rel.includes("\0")) return null;
  const abs = path.resolve(PREVIEW_ROOT, rel);
  if (abs !== PREVIEW_ROOT && !abs.startsWith(PREVIEW_ROOT + path.sep)) return null;
  if (!abs.endsWith(".png")) return null;
  return existsSync(abs) ? abs : null;
}

/** Компактная сводка для промпта AI: одна строка на блок. */
export function describeBlockForAi(block) {
  const p = previewForBlock(block);
  if (!p || p.status !== "ok" || !p.signature) return null;
  const s = p.signature;
  const parts = [
    `${s.width}×${s.height}px`,
    s.background ? `фон ${s.background}` : null,
    s.images ? `картинок ${s.images}` : null,
    s.buttons ? `кнопок ${s.buttons}` : null,
    s.listItems ? `пунктов списка ${s.listItems}` : null,
    s.columns >= 2 ? `${s.columns} колонки` : null,
    s.textChars ? `текста ${s.textChars} симв.` : null,
    s.responsive ? "адаптивный" : "фиксированной ширины",
  ].filter(Boolean);
  return parts.join(", ");
}
