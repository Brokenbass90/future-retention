#!/usr/bin/env node
/**
 * scripts/group-block-duplicates.mjs — схлопывание одинаковых на вид блоков.
 *
 * В каталоге 1004 блока, и добрая половина — авто-нарезка из старых писем:
 * десятки «Текстовый абзац» и «CTA-секция», которые отличаются одним
 * пикселем отступа или вообще ничем. Искать в такой стене невозможно.
 *
 * Группируем НЕ по названию и не по коду (у одинаковых на вид блоков и pug
 * разный — разные обёртки, разные классы), а по тому, как блок выглядит:
 * по перцептивному хешу его пререндеренного превью.
 *
 * dHash: превью приводится к 9×8 в градациях серого, каждый пиксель
 * сравнивается с соседом справа → 64 бита. Устойчив к мелкой разнице в
 * сжатии и антиалиасинге, но честно разводит блоки с разной композицией.
 * Пропорции сравниваем отдельно: одинаковый узор при высоте 60px и 600px —
 * это разные блоки, а не дубли.
 *
 * Результат дописывается в data/block-previews/index.json:
 *   blocks[key].dhash        — хеш превью
 *   blocks[key].groupId      — id группы одинаковых на вид
 *   blocks[key].groupPrimary — true у представителя группы
 *   groups                   — { id: { primary, members[], size } }
 *
 * Ничего не удаляется с диска: каталог просто показывает одну плитку с
 * бейджем «ещё N похожих».
 *
 * Usage:
 *   node scripts/group-block-duplicates.mjs
 *   node scripts/group-block-duplicates.mjs --distance 5   # мягче
 *   node scripts/group-block-duplicates.mjs --report       # что схлопнулось
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import url from "node:url";
import { PNG } from "pngjs";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const indexPath = path.join(repoRoot, "data", "block-previews", "index.json");

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d; };
const has = (n) => argv.includes(`--${n}`);

/** Максимальное расстояние Хэмминга, при котором блоки считаем одинаковыми. */
const MAX_DISTANCE = Number(opt("distance", 4));
/** Пропорции не должны расходиться больше чем на четверть. */
const MAX_RATIO_DRIFT = 0.25;

/* ─── dHash ──────────────────────────────────────────────────────────────── */

const HASH_W = 9, HASH_H = 8;

/** Среднее значение яркости в прямоугольнике исходника. */
function boxLuma(png, x0, y0, x1, y1) {
  const { data, width } = png;
  let sum = 0, n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (width * y + x) << 2;
      const a = data[i + 3] / 255;
      // Прозрачное считаем белым: в почте под блоком всё равно белый фон,
      // иначе одинаковые блоки с прозрачной и белой подложкой разъедутся.
      const r = data[i] * a + 255 * (1 - a);
      const g = data[i + 1] * a + 255 * (1 - a);
      const b = data[i + 2] * a + 255 * (1 - a);
      sum += 0.299 * r + 0.587 * g + 0.114 * b;
      n++;
    }
  }
  return n ? sum / n : 255;
}

export function dhashFromPng(buffer) {
  let png;
  try { png = PNG.sync.read(buffer); } catch { return null; }
  if (!png.width || !png.height) return null;

  const cell = [];
  for (let gy = 0; gy < HASH_H; gy++) {
    const row = [];
    const y0 = Math.floor((gy * png.height) / HASH_H);
    const y1 = Math.max(y0 + 1, Math.floor(((gy + 1) * png.height) / HASH_H));
    for (let gx = 0; gx < HASH_W; gx++) {
      const x0 = Math.floor((gx * png.width) / HASH_W);
      const x1 = Math.max(x0 + 1, Math.floor(((gx + 1) * png.width) / HASH_W));
      row.push(boxLuma(png, x0, y0, x1, y1));
    }
    cell.push(row);
  }

  let bits = "";
  for (let y = 0; y < HASH_H; y++) {
    for (let x = 0; x < HASH_W - 1; x++) bits += cell[y][x] > cell[y][x + 1] ? "1" : "0";
  }
  // 64 бита → 16 hex-символов.
  let hex = "";
  for (let i = 0; i < bits.length; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);

  // Разброс яркости: по нему отличаем содержательное превью от пустого.
  const flat = cell.flat();
  const mean = flat.reduce((a, b) => a + b, 0) / flat.length;
  const contrast = Math.sqrt(flat.reduce((a, b) => a + (b - mean) ** 2, 0) / flat.length);
  return { hash: hex, contrast };
}

/** Ниже этого стандартного отклонения яркости превью считаем невыразительным. */
const LOW_CONTRAST_THRESHOLD = 6;

export function hammingDistance(a, b) {
  if (!a || !b || a.length !== b.length) return Infinity;
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (x) { d += x & 1; x >>= 1; }
  }
  return d;
}

/* ─── Группировка ────────────────────────────────────────────────────────── */

/**
 * Структурный отпечаток блока. Одного dHash мало: превью почти пустого
 * спейсера, абзаца текста и подписи мелким серым дают почти одинаковую
 * картинку, и хеш честно схлопывает их в одну группу — а это разные блоки.
 * Поэтому сливаем только внутри одинакового строения.
 */
function structureKey(item) {
  const s = item.signature || {};
  const textBucket = !s.textChars ? "0" : s.textChars < 60 ? "s" : s.textChars < 240 ? "m" : "l";
  return [
    s.images > 0 ? "img" : "-",
    s.buttons > 0 ? "btn" : "-",
    s.listItems > 0 ? "list" : "-",
    `c${s.columns || 0}`,
    `t${textBucket}`,
  ].join("|");
}

/**
 * Контраст превью. У блоков без выраженной картинки (пустая обёртка, строка
 * текста) все ячейки dHash почти равны, биты определяются шумом сжатия —
 * такие превью группировать по хешу нельзя, получится каша.
 */
function isLowContrast(item) {
  return item.contrast != null && item.contrast < LOW_CONTRAST_THRESHOLD;
}

export function groupByLook(items, { maxDistance = MAX_DISTANCE } = {}) {
  // Блоки с невыразительным превью оставляем каждый сам по себе: лучше
  // лишняя плитка, чем спейсер, склеенный с абзацем текста.
  const groupable = items.filter((i) => i.dhash && !isLowContrast(i));
  const singles = items.filter((i) => !i.dhash || isLowContrast(i))
    .map((i) => ({ dhash: i.dhash, ratio: null, members: [i] }));

  // Сначала точные совпадения хеша — их большинство и они бесплатны.
  const exact = new Map();
  for (const item of groupable) {
    const key = `${structureKey(item)}#${item.dhash}`;
    if (!exact.has(key)) exact.set(key, []);
    exact.get(key).push(item);
  }

  // Затем сливаем близкие бакеты. Сравниваем представителей, а не все пары:
  // 1000 блоков попарно — миллион сравнений, представителей на порядок меньше.
  const buckets = [...exact.entries()].map(([key, members]) => ({
    structure: key.split("#")[0],
    dhash: key.split("#")[1],
    members,
  }));
  buckets.sort((a, b) => b.members.length - a.members.length);

  const groups = [];
  for (const bucket of buckets) {
    const ratio = medianRatio(bucket.members);
    const near = groups.find((g) => g.structure === bucket.structure
      && hammingDistance(g.dhash, bucket.dhash) <= maxDistance
      && ratioClose(g.ratio, ratio));
    if (near) { near.members.push(...bucket.members); continue; }
    groups.push({ structure: bucket.structure, dhash: bucket.dhash, ratio, members: [...bucket.members] });
  }
  return [...groups, ...singles];
}

function medianRatio(members) {
  const ratios = members
    .map((m) => (m.height && m.width ? m.height / m.width : null))
    .filter(Boolean).sort((a, b) => a - b);
  return ratios.length ? ratios[Math.floor(ratios.length / 2)] : null;
}

function ratioClose(a, b) {
  if (!a || !b) return true;
  return Math.abs(a - b) / Math.max(a, b) <= MAX_RATIO_DRIFT;
}

/**
 * Кого показывать за всю группу. Приоритет: canonical важнее импорта,
 * дальше — больше использований в письмах, дальше — осмысленное описание,
 * дальше — короткий id (авто-нарезка любит длинные хвосты вроде -03-copy).
 */
function pickPrimary(members) {
  return [...members].sort((a, b) => {
    const src = (m) => (m.source === "canonical" ? 0 : m.source === "user" ? 1 : 2);
    if (src(a) !== src(b)) return src(a) - src(b);
    if ((b.usageCount || 0) !== (a.usageCount || 0)) return (b.usageCount || 0) - (a.usageCount || 0);
    const generic = (m) => (/^(Текстовый абзац|Заголовок|CTA-секция|Секция)$/i.test(m.label || "") ? 1 : 0);
    if (generic(a) !== generic(b)) return generic(a) - generic(b);
    return String(a.id).length - String(b.id).length;
  })[0];
}

/* ─── main ───────────────────────────────────────────────────────────────── */

if (!existsSync(indexPath)) {
  console.error("нет data/block-previews/index.json — сначала: npm run previews");
  process.exit(1);
}
const index = JSON.parse(readFileSync(indexPath, "utf8"));

if (has("report")) {
  const groups = Object.entries(index.groups || {})
    .map(([id, g]) => ({ id, ...g }))
    .filter((g) => g.size > 1)
    .sort((a, b) => b.size - a.size);
  if (!groups.length) { console.log("групп нет — сначала прогони без --report"); process.exit(0); }
  const collapsed = groups.reduce((s, g) => s + g.size - 1, 0);
  console.log(`групп-дублей: ${groups.length} · плиток скроется: ${collapsed}`);
  console.log(`каталог: ${index.total} → ${index.total - collapsed} видимых плиток\n`);
  for (const g of groups.slice(0, Number(opt("limit", 20)))) {
    console.log(`  ${g.size}× ${g.primary}`);
    console.log(`     ${g.members.filter((m) => m !== g.primary).slice(0, 6).join(", ")}${g.size > 7 ? " …" : ""}`);
  }
  process.exit(0);
}

const items = [];
for (const [key, entry] of Object.entries(index.blocks || {})) {
  if (entry.error || !entry.shots?.desktop?.file) continue;
  const file = path.join(repoRoot, entry.shots.desktop.file);
  if (!existsSync(file)) continue;
  const computed = dhashFromPng(readFileSync(file));
  if (!computed) continue;
  entry.dhash = computed.hash;
  entry.previewContrast = Math.round(computed.contrast * 10) / 10;
  items.push({
    key, dhash: computed.hash, contrast: computed.contrast,
    id: entry.id, source: entry.source, label: entry.label,
    signature: entry.signature || {},
    usageCount: entry.usageCount || 0,
    width: entry.shots.desktop.width, height: entry.shots.desktop.height,
  });
}
console.log(`блоков с превью: ${items.length}`);

const groups = groupByLook(items);
index.groups = {};
for (const [key, entry] of Object.entries(index.blocks || {})) {
  delete entry.groupId; delete entry.groupPrimary; delete entry.groupSize;
}
let collapsed = 0;
for (const group of groups) {
  const primary = pickPrimary(group.members);
  const groupId = `g-${primary.source}-${primary.id}`;
  index.groups[groupId] = {
    primary: primary.key,
    size: group.members.length,
    members: group.members.map((m) => m.key),
  };
  for (const member of group.members) {
    const entry = index.blocks[member.key];
    entry.groupId = groupId;
    entry.groupSize = group.members.length;
    entry.groupPrimary = member.key === primary.key;
  }
  if (group.members.length > 1) collapsed += group.members.length - 1;
}

index.groupedAt = new Date().toISOString();
writeFileSync(indexPath, JSON.stringify(index, null, 2) + "\n");

const multi = groups.filter((g) => g.members.length > 1).length;
console.log(`групп: ${groups.length} · из них с дублями: ${multi}`);
console.log(`каталог схлопывается: ${items.length} → ${items.length - collapsed} плиток (скрыто ${collapsed})`);
console.log(`подробности: node scripts/group-block-duplicates.mjs --report`);
