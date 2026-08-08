#!/usr/bin/env node
/**
 * scripts/render-block-previews.mjs — пререндер превью всех блоков библиотеки.
 *
 * Зачем: карточка каталога должна показывать блок картинкой сразу, а AI —
 * получать машиночитаемое описание внешнего вида. Живой iframe на
 * /api/compose-preview делал полную сборку письма на каждую карточку
 * (~1.6 с в подпроцессе), кэшировался только в памяти вкладки и молча прятал
 * карточку при любой ошибке.
 *
 * Как: блоки группируются в «контактные листы» по N штук, каждый лист
 * собирается ОДИН раз (composeEmailFromBlocks с markBlocks → в HTML остаются
 * <!-- rk:block-start:UID:ID --> ... <!-- rk:block-end -->), скриншотится
 * целиком, а каждый блок вырезается по своему диапазону маркеров.
 * 1029 блоков ≈ 50-100 сборок вместо 1029.
 *
 * Результат:
 *   data/block-previews/<source>/<id>.desktop.png
 *   data/block-previews/<source>/<id>.mobile.png
 *   data/block-previews/index.json   — hash, размеры, визуальная сигнатура
 *
 * Инкрементально: блок перерисовывается только если изменился хеш
 * pug+styl+slots+childSlots+version. Индекс — отдельный файл, JSON'ы блоков
 * не трогаются (иначе 1029 файлов в диффе на каждый прогон).
 *
 * Usage:
 *   node scripts/render-block-previews.mjs                    # всё, инкрементально
 *   node scripts/render-block-previews.mjs --source canonical # только ручные
 *   node scripts/render-block-previews.mjs --only iq-hero     # фильтр по id
 *   node scripts/render-block-previews.mjs --limit 20         # первые N (отладка)
 *   node scripts/render-block-previews.mjs --sheet 6          # блоков на сборку
 *   node scripts/render-block-previews.mjs --force            # игнорировать кэш
 *   node scripts/render-block-previews.mjs --no-mobile        # только desktop
 *
 * Разовая настройка: npx playwright-core install --only-shell chromium
 */
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync, rmSync, symlinkSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import url from "node:url";
import { chromium } from "playwright-core";
import { PNG } from "pngjs";

import { composeEmailFromBlocks } from "../src/compose-email.js";
import { blockPreviewSourceHash } from "../src/block-previews.js";
import { contentSamplingRect, previewKeysToPrune } from "../src/block-preview-renderer-policy.js";

/* ─── Песочница/CI без root: локальные стабы системных библиотек ─────────── */
if (process.platform === "linux") {
  const stub = path.join(os.homedir(), "pwlibs");
  if (existsSync(stub)) {
    process.env.LD_LIBRARY_PATH = [stub, process.env.LD_LIBRARY_PATH].filter(Boolean).join(":");
    process.env.PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS = "true";
  }
}

const here = path.dirname(url.fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const emailBase = path.join(repoRoot, "email-base");
const libraryRoot = path.join(repoRoot, "data", "block-library");
const outRoot = path.join(repoRoot, "data", "block-previews");
const indexPath = path.join(outRoot, "index.json");

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : fallback;
};

const SOURCE = opt("source", "all");
const ONLY = opt("only", null);
const LIMIT = Number(opt("limit", 0)) || Infinity;
const SHEET_SIZE = Math.max(1, Number(opt("sheet", 8)) || 8);
const FORCE = flag("force");
const SYSTEM_CHROME_CANDIDATES = process.platform === "darwin"
  ? [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
    ]
  : [];
/**
 * Ширины окна для съёмки.
 *
 * ВАЖНО: десктоп снимаем в окне 700px, а не 600. Письмо всё равно 600px и
 * центрируется, но мобильные медиазапросы семьи написаны как
 * `max-width: 600px` — в окне ровно 600 они СРАБАТЫВАЮТ, и «десктопное»
 * превью показывало мобильную раскладку: колонки в столбик, всё по центру.
 * Ловушка тихая, поэтому меняем окно, а не медиазапросы.
 */
const WIDTHS = [
  { name: "desktop", width: 700 },
  ...(flag("no-mobile") ? [] : [{ name: "mobile", width: 375 }]),
];

/**
 * Заглушка вместо внешних картинок — прогон не должен зависеть от сети.
 *
 * Раньше здесь был серый пиксель 1×1. Беда в том, что у картинки без явных
 * размеров он схлопывался в точку, и блоки, состоящие ИЗ картинки (hero,
 * логотип, чипсы), выглядели пустыми белыми прямоугольниками — по превью
 * их было не отличить друг от друга.
 *
 * Теперь это SVG с собственными размерами и понятным узором: любой размер
 * рисуется чётко, а блок читается как «здесь картинка».
 */
const IMAGE_PLACEHOLDER = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400" viewBox="0 0 600 400">
  <defs>
    <pattern id="d" width="28" height="28" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <rect width="28" height="28" fill="#E9ECF2"/>
      <rect width="14" height="28" fill="#E1E5ED"/>
    </pattern>
  </defs>
  <rect width="600" height="400" fill="url(#d)"/>
  <rect x="1" y="1" width="598" height="398" fill="none" stroke="#C7CEDA" stroke-width="2"/>
  <g fill="#A7B0C0">
    <circle cx="228" cy="150" r="26"/>
    <path d="M150 268l86-92 60 64 44-42 110 70z"/>
  </g>
</svg>`, "utf8");
const PLACEHOLDER_TYPE = "image/svg+xml";

/* ─── Демо-наполнение пустых обёрток ─────────────────────────────────────── */
// Секция-обёртка без содержимого визуально неотличима от любой другой.
// В превью мы подставляем в её childSlots канонические атомы, помечая их
// как декорацию — они не попадают в индекс как самостоятельные блоки.
const DEMO_FOR_MARKER = {
  MEDIA_BLOCKS: "iq-image-link",
  CONTENT_BLOCKS: "iq-text-title",
  INNER_BLOCKS: "iq-text-title",
  SECTION_BLOCKS: "iq-section",
};
const DEFAULT_SECTION = "iq-section";
const DEFAULT_OUTER = "iq-outer-wrapper";

/* ─── Загрузка библиотеки ────────────────────────────────────────────────── */
const SOURCES = ["canonical", "imported", "user"];

function loadLibrary() {
  const wanted = SOURCE === "all" ? SOURCES : [SOURCE];
  const out = [];
  for (const src of wanted) {
    const dir = path.join(libraryRoot, src);
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".json")) continue;
      if (file === "index.json" || file === "_validation.json") continue;
      let block;
      try { block = JSON.parse(readFileSync(path.join(dir, file), "utf8")); }
      catch { continue; }
      if (!block || !block.id) continue;
      if (block.validated === false) continue;
      out.push({ ...block, source: src });
    }
  }
  return out;
}

/* ─── Хеш содержимого блока ──────────────────────────────────────────────── */
function blockHash(b) {
  return blockPreviewSourceHash(b);
}

/* ─── Сборка одного контактного листа ────────────────────────────────────── */
let demoUid = 0;
const nextUid = (p) => `${p}-${++demoUid}`;

/**
 * Строит дерево entries для листа блоков.
 * Возвращает { entries, marked } где marked: uid → блок, который мы вырезаем.
 */
function buildSheetTree(blocks) {
  const rootUid = "sheet-root";
  const entries = [{
    uid: rootUid, blockId: DEFAULT_OUTER, parentUid: null, slotId: null, slots: {},
  }];
  const marked = new Map();

  for (const b of blocks) {
    const placement = b.placement || "inner";

    if (placement === "outer") {
      // Обёртка письма — сама себе корень; отдельный лист, см. renderOuterAlone.
      continue;
    }

    let ownUid;
    if (placement === "section" || placement === "both") {
      ownUid = nextUid("blk");
      entries.push({ uid: ownUid, blockId: b.id, source: b.source, parentUid: rootUid, slotId: "sections", slots: {} });
    } else {
      // inner / inline / helper — кладём в стандартную секцию-обёртку.
      const wrapUid = nextUid("wrap");
      entries.push({ uid: wrapUid, blockId: DEFAULT_SECTION, parentUid: rootUid, slotId: "sections", slots: {} });
      ownUid = nextUid("blk");
      entries.push({ uid: ownUid, blockId: b.id, source: b.source, parentUid: wrapUid, slotId: "content", slots: {} });
    }
    marked.set(ownUid, b);

    // Пустые childSlots наполняем демо-содержимым, иначе обёртка на превью пустая.
    for (const cs of b.childSlots || []) {
      const demoId = DEMO_FOR_MARKER[cs.marker] || "iq-text-title";
      const demoUidLocal = nextUid("demo");
      entries.push({ uid: demoUidLocal, blockId: demoId, parentUid: ownUid, slotId: cs.id, slots: {} });
      // Вложенная секция внутри outer-обёртки тоже должна быть не пустой.
      if (demoId === DEFAULT_SECTION) {
        entries.push({ uid: nextUid("demo"), blockId: "iq-text-title", parentUid: demoUidLocal, slotId: "content", slots: {} });
      }
    }
  }
  return { entries, marked };
}

function makeSandbox() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "retkit-block-preview-"));
  for (const item of ["vendor", "tools", "node_modules"]) {
    const src = path.join(emailBase, item);
    if (!existsSync(src)) continue;
    try { symlinkSync(src, path.join(dir, item), "dir"); } catch { /* ignore */ }
  }
  return dir;
}

function buildSheet(sandbox, mailName, entries) {
  composeEmailFromBlocks({
    brand: "X_preview",
    mailName,
    blocks: entries,
    destRoot: sandbox,
    markBlocks: true,
    force: true,
  });
  const r = spawnSync(process.execPath, [
    "tools/build-mail.js", "--category", "X_preview", "--mail", mailName, "--locales", "en",
  ], { cwd: sandbox, stdio: ["ignore", "pipe", "pipe"], timeout: 180000 });
  if (r.status !== 0) {
    const tail = String(r.stderr || "").split("\n").filter(Boolean).slice(-1)[0] || "build failed";
    throw new Error(tail.slice(0, 300));
  }
  const html = path.join(sandbox, "dist", "X_preview", `mail-${mailName}`, "en", "index.html");
  if (!existsSync(html)) throw new Error("build ok, but dist HTML missing");
  return html;
}

/* ─── Измерение и вырезание блоков в браузере ────────────────────────────── */
/**
 * В странице: для каждого uid найти диапазон между комментариями-маркерами и
 * вернуть суммарный bounding box + структурные признаки содержимого.
 */
const MEASURE = /* js */ `(uids) => {
  const contentSamplingRect = ${contentSamplingRect.toString()};
  const walker = document.createNodeIterator(document.documentElement, NodeFilter.SHOW_COMMENT);
  const starts = new Map(), ends = new Map();
  let c;
  while ((c = walker.nextNode())) {
    const m = /^\\s*rk:block-(start|end):([^:]+):(.*?)\\s*$/.exec(c.nodeValue || "");
    if (!m) continue;
    (m[1] === "start" ? starts : ends).set(m[2], c);
  }
  // Горизонтальные границы колонки письма. Клип по ним, а не по bbox блока:
  // ширина таблицы внутри листа зависит от соседей (браузер согласовывает
  // ширины ячеек), и один и тот же блок в разных листах давал 560 или 580 px.
  // Из-за этого превью нельзя было сравнивать между прогонами — а сравнение
  // «до/после» это главный способ проверять миграции библиотеки.
  // Колонка письма в этом фреймворке всегда 600px и центрируется. Берём её
  // геометрию из ширины окна, а не измеряем в DOM: измеренная ширина зависит
  // от того, какие блоки попали в тот же лист, и один блок в разных прогонах
  // давал 560/580/600. Фиксированное окно делает превью сравнимыми.
  const EMAIL_COLUMN = 600;
  const viewport = document.documentElement.clientWidth;
  const column = viewport >= EMAIL_COLUMN
    ? { x: Math.floor((viewport - EMAIL_COLUMN) / 2), width: EMAIL_COLUMN }
    : { x: 0, width: viewport };

  const out = {};
  for (const uid of uids) {
    const s = starts.get(uid), e = ends.get(uid);
    if (!s || !e) { out[uid] = { error: "markers not found in HTML" }; continue; }
    // Собираем узлы между маркерами на их общем уровне.
    const nodes = [];
    let n = s.nextSibling;
    while (n && n !== e) { nodes.push(n); n = n.nextSibling; }
    if (!nodes.length && s.parentElement) nodes.push(s.parentElement);

    let top = Infinity, left = Infinity, right = -Infinity, bottom = -Infinity;
    let text = "", images = 0, links = 0, listItems = 0, maxCols = 0, buttons = 0;
    const bgs = [];
    const visit = (el) => {
      if (!el || el.nodeType !== 1) return;
      const tag = el.tagName.toLowerCase();
      if (tag === "img") images++;
      if (tag === "a") { links++; }
      if (tag === "li") listItems++;
      if (tag === "tr") maxCols = Math.max(maxCols, el.children.length);
      const cs = getComputedStyle(el);
      const bg = cs.backgroundColor;
      if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") bgs.push(bg);
      if (cs.backgroundImage && cs.backgroundImage !== "none") images++;
      if (tag === "a" && bg && bg !== "rgba(0, 0, 0, 0)") buttons++;
      for (const ch of el.children) visit(ch);
    };
    for (const node of nodes) {
      if (node.nodeType === 3) { text += node.nodeValue || ""; continue; }
      if (node.nodeType !== 1) continue;
      const r = node.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        top = Math.min(top, r.top + scrollY); left = Math.min(left, r.left + scrollX);
        right = Math.max(right, r.right + scrollX); bottom = Math.max(bottom, r.bottom + scrollY);
      }
      text += node.innerText || node.textContent || "";
      visit(node);
    }
    if (!isFinite(top) || bottom <= top) { out[uid] = { error: "block rendered with zero size" }; continue; }
    out[uid] = {
      box: { x: column.x, y: Math.max(0, Math.floor(top)),
             width: column.width, height: Math.ceil(bottom - top) },
      content: contentSamplingRect(left, right, column),
      dom: {
        textChars: text.replace(/\\s+/g, " ").trim().length,
        images, links, listItems, buttons,
        columns: maxCols,
        backgrounds: bgs.slice(0, 12),
      },
    };
  }
  return out;
}`;

/**
 * Доминирующие цвета по PNG: квантизация до сетки 32 и топ-4.
 *
 * `content` ограничивает выборку реальными границами блока. Снимок берётся по
 * всей колонке письма (чтобы превью были сравнимы между прогонами), и без
 * этого ограничения доминирующим цветом узкой кнопки становится белое поле
 * вокруг неё — поиск «оранжевая кнопка» переставал находить оранжевые кнопки.
 */
function dominantColors(pngBuffer, content = null) {
  let img;
  try { img = PNG.sync.read(pngBuffer); } catch { return []; }
  const counts = new Map();
  const { data, width, height } = img;
  const x0 = content ? Math.max(0, Math.min(content.dx, width - 1)) : 0;
  const x1 = content ? Math.min(width, x0 + content.width) : width;
  const step = Math.max(1, Math.floor(Math.sqrt(((x1 - x0) * height) / 20000)));
  for (let y = 0; y < height; y += step) {
    for (let x = x0; x < x1; x += step) {
      const i = (width * y + x) << 2;
      if (data[i + 3] < 128) continue;
      const key = `${data[i] >> 5},${data[i + 1] >> 5},${data[i + 2] >> 5}`;
      const cur = counts.get(key) || { n: 0, r: 0, g: 0, b: 0 };
      cur.n++; cur.r += data[i]; cur.g += data[i + 1]; cur.b += data[i + 2];
      counts.set(key, cur);
    }
  }
  const total = [...counts.values()].reduce((s, c) => s + c.n, 0) || 1;
  return [...counts.values()]
    .sort((a, b) => b.n - a.n).slice(0, 4)
    .map((c) => ({
      hex: "#" + [c.r, c.g, c.b].map((v) => Math.round(v / c.n).toString(16).padStart(2, "0")).join(""),
      share: Math.round((c.n / total) * 100) / 100,
    }));
}

/** Человеко- и машиночитаемая сигнатура внешнего вида. */
function buildSignature(block, measured, colorsByWidth, shots) {
  const dom = measured.dom || {};
  const desktop = shots.desktop || {};
  const colors = colorsByWidth.desktop || [];
  const bg = colors[0]?.hex || null;
  // «Адаптивный» — не только @media в собственном styl блока (у импортированных
  // блоков медиазапросы часто остались в CSS семьи), но и фактическая разница
  // высоты на 600 и 375 px.
  const reflows = Boolean(shots.mobile && desktop.height && shots.mobile.height !== desktop.height);
  const responsive = /@media/.test(block.styl || "") || reflows;
  const tags = [];
  if (dom.images > 0) tags.push("image");
  if (dom.buttons > 0) tags.push("button");
  if (dom.listItems > 0) tags.push("list");
  if (dom.columns >= 2) tags.push(`${dom.columns}-col`);
  if (dom.links > 0) tags.push("link");
  if (dom.textChars > 200) tags.push("long-text");
  else if (dom.textChars > 0) tags.push("short-text");
  if ((desktop.height || 0) > 400) tags.push("tall");
  if (responsive) tags.push("responsive");
  if (!responsive) tags.push("fixed-width");

  return {
    width: desktop.width || null,
    height: desktop.height || null,
    mobileHeight: shots.mobile?.height || null,
    background: bg,
    palette: colors.map((c) => c.hex),
    images: dom.images || 0,
    links: dom.links || 0,
    buttons: dom.buttons || 0,
    listItems: dom.listItems || 0,
    columns: dom.columns || 0,
    textChars: dom.textChars || 0,
    responsive,
    ownMediaQueries: /@media/.test(block.styl || ""),
    tags,
  };
}

/* ─── Основной проход ────────────────────────────────────────────────────── */
async function main() {
  let library = loadLibrary();
  if (ONLY) library = library.filter((b) => b.id.includes(ONLY));
  library.sort((a, b) => (a.source + a.id).localeCompare(b.source + b.id));

  // Индекс читаем ВСЕГДА, даже с --force. Иначе прогон с фильтром
  // (`--only ... --force`) стирал записи всех остальных блоков: картинки на
  // диске оставались, а каталог считал, что превью у них нет.
  // --force влияет только на проверку хеша ниже.
  const index = existsSync(indexPath)
    ? JSON.parse(readFileSync(indexPath, "utf8"))
    : { generatedAt: null, blocks: {} };
  index.blocks ||= {};

  // Блок удалили из библиотеки — запись и картинки должны уйти следом.
  // Иначе каталог показывает превью несуществующего блока, а релизный тест
  // (test-canonical-preview-release) справедливо падает на «сироте».
  // При выборочном прогоне (--only) не чистим: библиотека здесь урезана
  // фильтром, и всё остальное выглядело бы удалённым. При --source чистим
  // только выбранный namespace: canonical-прогон не владеет imported/user.
  let pruned = 0;
  if (!ONLY) {
    for (const key of previewKeysToPrune(index, library, { source: SOURCE, only: ONLY })) {
      const entry = index.blocks[key];
      for (const shot of Object.values(entry?.shots || {})) {
        try { if (shot?.file) rmSync(path.join(repoRoot, shot.file), { force: true }); } catch { /* нет файла — и ладно */ }
      }
      delete index.blocks[key];
      pruned += 1;
      console.log(`  удалена запись превью: ${key} (блока больше нет)`);
    }
  }

  const todo = [];
  for (const b of library) {
    const hash = blockHash(b);
    const key = `${b.source}:${b.id}`;
    const prev = index.blocks[key];
    const filesOk = prev && !prev.error && WIDTHS.every((w) =>
      prev.shots?.[w.name]?.file && existsSync(path.join(repoRoot, prev.shots[w.name].file)));
    if (!FORCE && prev && prev.hash === hash && filesOk) continue;
    todo.push({ block: b, hash, key });
    if (todo.length >= LIMIT) break;
  }

  console.log(`библиотека: ${library.length} блоков · к перерисовке: ${todo.length}`);
  if (!todo.length) {
    // Перерисовывать нечего, но чистку записей всё равно надо сохранить —
    // иначе удалённый блок остаётся в индексе до следующего рендера.
    if (pruned) {
      index.total = Object.keys(index.blocks).length;
      index.failed = Object.values(index.blocks).filter((b) => b.error).length;
      writeFileSync(indexPath, JSON.stringify(index, null, 2) + "\n");
      console.log(`индекс обновлён: убрано ${pruned} записей`);
    }
    console.log("всё актуально");
    return;
  }

  const sheets = [];
  for (let i = 0; i < todo.length; i += SHEET_SIZE) sheets.push(todo.slice(i, i + SHEET_SIZE));

  // Chromium на прогоне в тысячу блоков уходит по памяти и падает
  // ("Target page, context or browser has been closed"). Держим его
  // одноразовым: перезапуск каждые RECYCLE_EVERY листов и по любому падению.
  const RECYCLE_EVERY = Math.max(1, Number(opt("recycle", 25)) || 25);
  let browser = null;
  const contexts = {};

  async function openBrowser() {
    // `playwright-core` does not download a browser on npm install. Local
    // Studio machines already have Chrome, so use it as an explicit fallback
    // instead of making preview refresh depend on a separate 200MB download.
    const bundledExecutable = chromium.executablePath();
    const executablePath = existsSync(bundledExecutable)
      ? bundledExecutable
      : SYSTEM_CHROME_CANDIDATES.find((candidate) => existsSync(candidate));
    browser = await chromium.launch({
      headless: true,
      ...(executablePath ? { executablePath } : {}),
      args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
    });
    for (const w of WIDTHS) {
      const ctx = await browser.newContext({
        viewport: { width: w.width, height: 900 }, deviceScaleFactor: 1, reducedMotion: "reduce",
      });
      await ctx.route(/^https?:\/\//, (route) =>
        route.request().resourceType() === "image"
          ? route.fulfill({ contentType: PLACEHOLDER_TYPE, body: IMAGE_PLACEHOLDER })
          : route.abort());
      contexts[w.name] = { ctx, page: await ctx.newPage() };
    }
  }
  async function closeBrowser() {
    try { await browser?.close(); } catch { /* уже мёртв */ }
    browser = null;
  }
  async function recycleBrowser() { await closeBrowser(); await openBrowser(); }

  await openBrowser();

  const sandbox = makeSandbox();
  let done = 0, failed = 0, sheetNo = 0;

  // Индекс пишем после каждого листа: прогон по 1000 блоков легко прервать
  // (ctrl-c, таймаут CI, песочница), и терять всю работу из-за этого нельзя.
  const flushIndex = () => {
    index.generatedAt = new Date().toISOString();
    index.total = Object.keys(index.blocks).length;
    index.failed = Object.values(index.blocks).filter((b) => b.error).length;
    mkdirSync(outRoot, { recursive: true });
    writeFileSync(indexPath, JSON.stringify(index, null, 2) + "\n");
  };

  /** Рендер листа; при падении сборки — поблочный ретрай, чтобы один битый
   *  блок не утаскивал за собой девять здоровых. */
  async function renderSheet(items, { retry = true } = {}) {
    sheetNo++;
    const mailName = `blockshot-${String(sheetNo).padStart(4, "0")}`;
    const { entries, marked } = buildSheetTree(items.map((t) => t.block));

    // outer-блоки в лист не попадают — рисуем их отдельным проходом.
    const outers = items.filter((t) => (t.block.placement || "") === "outer");
    for (const t of outers) await renderOuter(t);
    if (!marked.size) return;

    let htmlPath;
    try {
      htmlPath = buildSheet(sandbox, mailName, entries);
    } catch (e) {
      if (retry && items.length > 1) {
        for (const one of items) await renderSheet([one], { retry: false });
        return;
      }
      for (const t of items) {
        index.blocks[t.key] = { id: t.block.id, source: t.block.source, hash: t.hash, error: String(e.message || e) };
        failed++;
        console.log(`  ✗ ${t.block.source}/${t.block.id}: ${String(e.message || e).slice(0, 120)}`);
      }
      return;
    }

    const uids = [...marked.keys()];
    const measuredByWidth = {};
    const pngByWidth = {};
    try {
      for (const w of WIDTHS) {
        const { page } = contexts[w.name];
        await page.goto(url.pathToFileURL(htmlPath).href, { waitUntil: "load", timeout: 30000 });
        await page.evaluate(() => document.fonts && document.fonts.ready);
        measuredByWidth[w.name] = await page.evaluate(new Function(`return ${MEASURE}`)(), uids);
        pngByWidth[w.name] = page;
      }
    } catch (e) {
      // Почти всегда это упавший chromium. Поднимаем заново и повторяем лист
      // один раз — иначе один сдохший браузер отправляет в ошибки сотни блоков.
      if (retry) {
        console.log(`  ⟳ браузер упал на листе ${sheetNo}, перезапуск`);
        await recycleBrowser();
        sheetNo--;
        return renderSheet(items, { retry: false });
      }
      for (const t of items) {
        index.blocks[t.key] = { id: t.block.id, source: t.block.source, hash: t.hash, error: `рендер: ${String(e.message || e).slice(0, 160)}` };
        failed++;
      }
      return;
    }

    for (const [uid, block] of marked) {
      const t = items.find((x) => x.block.id === block.id && x.block.source === block.source);
      if (!t) continue;
      const shots = {}; const colorsByWidth = {}; let firstError = null;
      for (const w of WIDTHS) {
        const m = measuredByWidth[w.name][uid];
        if (!m || m.error) { firstError ||= m?.error || "не удалось измерить блок"; continue; }
        const dir = path.join(outRoot, block.source);
        mkdirSync(dir, { recursive: true });
        const file = path.join(dir, `${block.id}.${w.name}.png`);
        // Клип не должен вылезать за границы страницы — иначе playwright ругается.
        const clip = {
          x: m.box.x, y: m.box.y,
          width: Math.max(1, Math.min(m.box.width, w.width - m.box.x)),
          height: Math.max(1, m.box.height),
        };
        let buf;
        // fullPage обязателен: блок почти всегда ниже вьюпорта, а clip без
        // fullPage режется по видимой области и падает с "clipped area is empty".
        try { buf = await pngByWidth[w.name].screenshot({ clip, path: file, fullPage: true }); }
        catch (e) { firstError ||= `скриншот не снялся: ${String(e.message || e).slice(0, 80)}`; continue; }
        shots[w.name] = {
          file: path.relative(repoRoot, file), width: clip.width, height: clip.height,
        };
        colorsByWidth[w.name] = dominantColors(buf, m.content);
      }

      if (!shots.desktop) {
        index.blocks[t.key] = { id: block.id, source: block.source, hash: t.hash, error: firstError || "нет превью" };
        failed++;
        console.log(`  ✗ ${block.source}/${block.id}: ${firstError}`);
        continue;
      }
      index.blocks[t.key] = {
        id: block.id,
        source: block.source,
        label: block.label || block.id,
        placement: block.placement || null,
        category: block.category || null,
        hash: t.hash,
        shots,
        signature: buildSignature(block, measuredByWidth.desktop[uid], colorsByWidth, shots),
      };
      done++;
    }
    process.stdout.write(`  лист ${sheetNo}: ${marked.size} блоков\n`);
  }

  /** outer-обёртка: рисуем её как настоящий корень письма с демо-секцией. */
  async function renderOuter(t) {
    const b = t.block;
    const mailName = `blockshot-outer-${b.id.replace(/[^a-z0-9_-]/gi, "-").toLowerCase()}`;
    const rootUid = "outer-root";
    const secUid = "outer-sec";
    const entries = [
      { uid: rootUid, blockId: b.id, source: b.source, parentUid: null, slotId: null, slots: {} },
      { uid: secUid, blockId: DEFAULT_SECTION, parentUid: rootUid, slotId: (b.childSlots?.[0]?.id) || "sections", slots: {} },
      { uid: "outer-txt", blockId: "iq-text-title", parentUid: secUid, slotId: "content", slots: {} },
    ];
    try {
      const htmlPath = buildSheet(sandbox, mailName, entries);
      const shots = {}; const colorsByWidth = {};
      for (const w of WIDTHS) {
        const { page } = contexts[w.name];
        await page.goto(url.pathToFileURL(htmlPath).href, { waitUntil: "load", timeout: 30000 });
        const dir = path.join(outRoot, b.source);
        mkdirSync(dir, { recursive: true });
        const file = path.join(dir, `${b.id}.${w.name}.png`);
        const buf = await page.screenshot({ path: file, fullPage: true });
        const dim = PNG.sync.read(buf);
        shots[w.name] = { file: path.relative(repoRoot, file), width: dim.width, height: dim.height };
        colorsByWidth[w.name] = dominantColors(buf);
      }
      index.blocks[t.key] = {
        id: b.id, source: b.source, label: b.label || b.id, placement: "outer",
        category: b.category || null, hash: t.hash, shots,
        signature: buildSignature(b, { dom: {} }, colorsByWidth, shots),
      };
      done++;
    } catch (e) {
      index.blocks[t.key] = { id: b.id, source: b.source, hash: t.hash, error: String(e.message || e).slice(0, 200) };
      failed++;
    }
  }

  for (const [i, sheet] of sheets.entries()) {
    await renderSheet(sheet);
    flushIndex();
    if ((i + 1) % RECYCLE_EVERY === 0) await recycleBrowser();
  }

  await closeBrowser();
  try { rmSync(sandbox, { recursive: true, force: true }); } catch { /* ignore */ }
  flushIndex();

  console.log(`\nготово: ${done} превью · ошибок ${failed} · индекс ${path.relative(repoRoot, indexPath)}`);
  if (index.failed) {
    console.log(`в индексе ${index.failed} блоков без превью — каталог покажет их честным бейджем, а не пустотой`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
