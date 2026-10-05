#!/usr/bin/env node
/**
 * mcp/retkit-mcp-server.mjs — студия как набор инструментов для чужой модели.
 *
 * ЗАЧЕМ. Платить за API студии на каждого пользователя невозможно: ключи
 * раздавать некому и не на что. Здесь роль переворачивается — модель приносит
 * сам пользователь (его Claude, его подписка, его контекст), а студия отдаёт
 * ему инструменты. Расходы владельца студии на генерацию — ноль.
 *
 * Транспорт stdio: сервер запускается рядом с человеком и ходит в студию по
 * HTTP (локальную или на Heroku). Никаких ключей моделей внутри — только адрес
 * студии и, если она закрыта Basic Auth, её логин с паролем.
 *
 *   STUDIO_URL       адрес студии (по умолчанию http://127.0.0.1:3000)
 *   STUDIO_USER      логин Basic Auth, если включён
 *   STUDIO_PASSWORD  пароль Basic Auth
 *
 * Ответы намеренно компактные: собранное письмо весит десятки килобайт, и
 * складывать его в контекст модели на каждый чих — значит выжечь окно за
 * несколько шагов. HTML отдаётся только по явному запросу.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFileSync } from "node:fs";
import path from "node:path";
import url from "node:url";

const STUDIO_URL = String(process.env.STUDIO_URL || "http://127.0.0.1:3000").replace(/\/+$/, "");
const STUDIO_USER = process.env.STUDIO_USER || "";
/**
 * Метка агента. Студия по ней понимает, что пишет не человек, а чей-то Клод:
 * от этого зависят замки на письма («не трогай то, что человек правит прямо
 * сейчас») и то, в чей черновик уходит работа. Без метки агент выглядел бы
 * новым безымянным человеком на каждый запрос.
 */
const STUDIO_TOKEN = (process.env.RETKIT_TOKEN || process.env.STUDIO_TOKEN || "").trim();
const STUDIO_PASSWORD = process.env.STUDIO_PASSWORD || "";

/* ─── Обращение к студии ──────────────────────────────────────────────────── */

function authHeaders() {
  if (!STUDIO_USER || !STUDIO_PASSWORD) return {};
  const token = Buffer.from(`${STUDIO_USER}:${STUDIO_PASSWORD}`).toString("base64");
  return { Authorization: `Basic ${token}` };
}

/**
 * Ошибки формулируем так, чтобы модель поняла, что делать дальше, а не просто
 * увидела код. «ECONNREFUSED» ничего не подсказывает; «студия не отвечает,
 * запустите npm start» — подсказывает.
 */
async function studioFetch(pathname, { method = "GET", body } = {}) {
  let response;
  try {
    response = await fetch(`${STUDIO_URL}${pathname}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...authHeaders(),
        ...(/^[0-9a-f]{32}$/.test(STUDIO_TOKEN) ? { "x-retkit-token": STUDIO_TOKEN } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch (error) {
    throw new Error(
      `Студия не отвечает по адресу ${STUDIO_URL} (${error.message}). ` +
      `Запустите её командой npm start в папке проекта или задайте другой STUDIO_URL.`
    );
  }
  if (response.status === 401) {
    throw new Error(
      "Студия закрыта Basic Auth. Задайте STUDIO_USER и STUDIO_PASSWORD в настройках MCP-сервера."
    );
  }
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* не JSON — покажем как есть */ }
  if (!response.ok) {
    const detail = data?.error || text.slice(0, 300) || `HTTP ${response.status}`;
    throw new Error(`Студия ответила ошибкой: ${detail}`);
  }
  return data;
}

/**
 * Забрать со студии картинку, а не JSON.
 *
 * Отдельная функция, потому что studioFetch разбирает ответ как текст: PNG,
 * пропущенный через строку, приезжает битым, и починить это в вызывающем
 * нельзя — байты уже потеряны.
 *
 * @returns {Promise<{base64:string, bytes:number, mimeType:string}>}
 */
async function studioImage(pathname, { method = "GET", body } = {}) {
  let response;
  try {
    response = await fetch(`${STUDIO_URL}${pathname}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...authHeaders(),
        ...(/^[0-9a-f]{32}$/.test(STUDIO_TOKEN) ? { "x-retkit-token": STUDIO_TOKEN } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch (error) {
    throw new Error(
      `Студия не отвечает по адресу ${STUDIO_URL} (${error.message}). ` +
      `Запустите её командой npm start в папке проекта.`
    );
  }
  if (!response.ok) {
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { /* не JSON */ }
    // Браузера на машине нет — говорим об этом человеческим языком, а не
    // кодом ошибки: чинится это одной командой, но догадаться нельзя.
    if (data?.code === "NO_BROWSER") throw new Error(data.error);
    throw new Error(data?.error || text.slice(0, 300) || `HTTP ${response.status}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  return {
    base64: buffer.toString("base64"),
    bytes: buffer.length,
    mimeType: response.headers.get("content-type") || "image/png",
  };
}

/* ─── Каталог блоков ──────────────────────────────────────────────────────── */

let _catalogCache = null;
let _catalogAt = 0;
const CATALOG_TTL_MS = 30_000;

async function loadCatalog() {
  if (_catalogCache && Date.now() - _catalogAt < CATALOG_TTL_MS) return _catalogCache;
  const data = await studioFetch("/api/blocks-library");
  _catalogCache = Array.isArray(data?.blocks) ? data.blocks : [];
  _catalogAt = Date.now();
  return _catalogCache;
}

/** Набор блока: пусто значит promo (см. src/block-library-schema.js). */
function blockKits(block) {
  return Array.isArray(block?.kits) && block.kits.length ? block.kits : ["promo"];
}

function briefBlock(block) {
  return {
    id: block.id,
    label: block.label || block.id,
    placement: block.placement || "inner",
    category: block.category || "misc",
    kits: blockKits(block),
    combo: block.combo === true || (block.tags || []).includes("combo"),
    slots: (block.slots || []).map((slot) => slot.id),
    // Не сама картинка, а признак: список из полусотни блоков с картинками
    // внутри не прочитает ни одна модель. За картинкой — retkit_block_preview.
    has_preview: block?.preview?.status === "ok",
  };
}

/* ─── Что модель обязана знать про студию ─────────────────────────────────── */

/**
 * Короткая инструкция вместо угадывания.
 *
 * Без неё модель видит плоский список блоков и не понимает ни иерархии, ни
 * того, что внутренний блок нельзя положить в обёртку напрямую. Отдаём тремя
 * способами сразу — инструментом, ресурсом и готовым сценарием, — потому что
 * клиенты MCP поддерживают разное: одни читают ресурсы, другие работают только
 * с инструментами.
 *
 * Текст лежит отдельным файлом: его правят как документацию, без риска сломать
 * экранирование в коде. И он намеренно короткий — попадает в контекст
 * пользователя и тратит его токены.
 */
const MCP_DIR = path.dirname(url.fileURLToPath(import.meta.url));
const REPO_DIR = path.join(MCP_DIR, "..");
const SKILL_DIR = path.join(REPO_DIR, ".claude", "skills", "retkit-studio");

/**
 * Инструкции по темам.
 *
 * Одним куском это отдавать нельзя: подключившийся Клод чаще всего собирает
 * письмо, и вываливать ему заодно устройство репозитория — значит потратить
 * его контекст на то, что не понадобится. Поэтому темы раздельные, а в
 * instructions сервера лежит только карта: что спросить, когда понадобится.
 */
const GUIDE_TOPICS = {
  emails: { file: path.join(MCP_DIR, "studio-guide.md"), title: "Как собирать письма" },
  development: { file: path.join(SKILL_DIR, "SKILL.md"), title: "Работа над кодом студии" },
  architecture: { file: path.join(SKILL_DIR, "references", "architecture.md"), title: "Устройство студии внутри" },
  blocks: { file: path.join(SKILL_DIR, "references", "blocks.md"), title: "Блоки: формат, наборы, слоты" },
  locales: { file: path.join(SKILL_DIR, "references", "locales.md"), title: "Локали и плейсхолдеры" },
};

const _guideCache = new Map();
function studioGuide(topic = "emails") {
  const key = Object.prototype.hasOwnProperty.call(GUIDE_TOPICS, topic) ? topic : "emails";
  if (_guideCache.has(key)) return _guideCache.get(key);
  let text;
  try {
    text = readFileSync(GUIDE_TOPICS[key].file, "utf8");
  } catch {
    text = `Инструкция по теме «${key}» не найдена: ожидался файл ${GUIDE_TOPICS[key].file}.`;
  }
  _guideCache.set(key, text);
  return text;
}

/**
 * instructions клиент загружает САМ при подключении — это единственное место,
 * которое модель видит без единого вызова. Поэтому здесь не инструкция, а
 * карта: чем это подключение является, чего делать нельзя и что спросить,
 * когда понадобится подробность.
 */
const SERVER_INSTRUCTIONS = [
  "Вы подключены к RetKit — студии email-писем. Через эти инструменты вы работаете в реальной студии человека: читаете каталог блоков, собираете письма и сохраняете их в его базу.",
  "",
  "Порядок для НОВОГО письма: retkit_studio_guide (тема emails) → retkit_list_blocks → retkit_get_block → retkit_compose_preview → retkit_render_mail (посмотреть глазами) → retkit_save_mail, и только после подтверждения человека.",
  "",
  "Про внешний вид не рассуждайте вслепую. Вид блока показывает retkit_block_preview, вид собранного письма — retkit_render_mail, оба отдают картинку. Прежде чем сказать человеку, что письмо выглядит хорошо, или обсуждать дизайн, посмотрите на него. Мобильную вёрстку снимайте отдельно (view: mobile): ломается она чаще десктопной.",
  "",
  "Порядок для СУЩЕСТВУЮЩЕГО письма: retkit_open_draft (личная копия) → правки и retkit_save_mail в имя черновика → показать человеку → retkit_publish_draft, когда он подтвердит. В саму базу напрямую не пишите: там работает человек.",
  "",
  "Структура письма жёсткая: outer (обёртка, одна) → section → inner (содержимое). Внутренний блок нельзя положить в обёртку напрямую. Набор system — короткие сервисные письма, promo — весь каталог.",
  "",
  "Работа над кодом самой студии: retkit_find_in_code (найти место) → retkit_read_code (прочитать вокруг) → retkit_studio_guide с темой development. Правки кода отсюда не делаются — для них человек открывает Claude Code в папке студии, где есть git и откат. Не выдумывайте устройство студии по названиям: прочитайте.",
  "",
  "Если в каталоге нет нужного блока, его можно создать: retkit_block_source у ближайшего соседа (взять приёмы вёрстки) → retkit_create_block. Свой блок правится через retkit_update_block; канонический блок студии не правится вовсе — с него делают копию под новым id. Новый блок проходит проверку студии; не прошёл — остаётся черновиком и в письмо не встанет. Создавать блок — запись на диск человека: спросите согласие заранее.",
  "",
  "Темы инструкций (retkit_studio_guide): emails — сборка писем; development — работа над кодом самой студии; architecture — устройство изнутри; blocks — формат блоков и слотов; locales — плейсхолдеры и переводы. Берите тему под задачу, а не всё сразу.",
  "",
  "Чего не делать: не публиковать черновик и не сохранять письмо без подтверждения человека; не трогать письмо, которое студия называет занятым (его сейчас правит человек или другой агент); не выдумывать id блоков и имена слотов — спрашивайте retkit_get_block.",
].join("\n");

const server = new McpServer(
  { name: "retkit-email-studio", version: "1.0.0" },
  { instructions: SERVER_INSTRUCTIONS }
);

/* ─── Инструменты ─────────────────────────────────────────────────────────── */

server.registerTool(
  "retkit_list_blocks",
  {
    title: "Каталог блоков письма",
    description:
      "Список блоков, из которых собирается письмо. Возвращает только краткие карточки " +
      "(id, назначение, набор, имена слотов) — за подробностями по конкретному блоку " +
      "вызывайте retkit_get_block.\n\n" +
      "Наборы: system — короткий набор простых блоков для сервисных писем; promo — весь каталог.\n" +
      "Размещение: outer (обёртка письма) → section (секция) → inner (содержимое секции).",
    inputSchema: {
      kit: z.enum(["system", "promo"]).optional().describe("Набор блоков. Без него — все."),
      placement: z.enum(["outer", "section", "inner", "both"]).optional().describe("Уровень блока."),
      category: z.string().optional().describe("Категория: text, cta, layout, footer, media…"),
      query: z.string().optional().describe("Поиск по id, названию и описанию."),
      limit: z.number().int().min(1).max(200).default(50).describe("Сколько вернуть."),
      offset: z.number().int().min(0).default(0).describe("Сдвиг для постраничного обхода."),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ({ kit, placement, category, query, limit = 50, offset = 0 }) => {
    const all = await loadCatalog();
    const needle = String(query || "").trim().toLowerCase();
    const matched = all.filter((block) => {
      if (block?.retired) return false;
      if (block?.source === "parsed") return false;
      if (kit && !blockKits(block).includes(kit)) return false;
      if (placement && (block.placement || "inner") !== placement) return false;
      if (category && (block.category || "misc") !== category) return false;
      if (needle) {
        const hay = `${block.id} ${block.label || ""} ${block.description || ""}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
    const page = matched.slice(offset, offset + limit).map(briefBlock);
    const payload = { total: matched.length, offset, count: page.length, blocks: page };
    return {
      content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
      structuredContent: payload,
    };
  }
);

server.registerTool(
  "retkit_get_block",
  {
    title: "Блок целиком: слоты и значения",
    description:
      "Полное описание блока: какие у него слоты, какого типа, что стоит по умолчанию и " +
      "какие значения допустимы. Вызывайте перед сборкой, чтобы заполнять реальные поля, " +
      "а не выдуманные.",
    inputSchema: { id: z.string().describe("Идентификатор блока, например sys-title.") },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ({ id }) => {
    const all = await loadCatalog();
    const block = all.find((candidate) => candidate.id === id);
    if (!block) {
      const near = all
        .filter((candidate) => String(candidate.id).includes(String(id).split("-")[0] || ""))
        .slice(0, 8)
        .map((candidate) => candidate.id);
      throw new Error(
        `Блок "${id}" не найден.` +
        (near.length ? ` Похожие: ${near.join(", ")}.` : " Посмотрите retkit_list_blocks.")
      );
    }
    const payload = {
      ...briefBlock(block),
      description: block.description || "",
      childSlots: (block.childSlots || []).map((slot) => ({ id: slot.id, accepts: slot.accepts })),
      slots: (block.slots || []).map((slot) => ({
        id: slot.id,
        kind: slot.kind || "text",
        label: slot.label || slot.id,
        default: slot.default,
        ...(slot.options ? { options: slot.options } : {}),
      })),
    };
    return {
      content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
      structuredContent: payload,
    };
  }
);

server.registerTool(
  "retkit_block_preview",
  {
    title: "Посмотреть блок картинкой",
    description:
      "Отдаёт готовое превью блока из каталога — то же изображение, которое видит человек " +
      "в библиотеке. Вызывайте, когда речь о внешнем виде: подходит ли блок, как он выглядит " +
      "рядом с соседним, что в нём не так. По описанию слотов этого не увидеть.\n\n" +
      "Превью нарисованы заранее. Если у блока его нет, ответ честно скажет об этом — " +
      "не выдумывайте, как блок выглядит.",
    inputSchema: {
      id: z.string().describe("Идентификатор блока из retkit_list_blocks."),
      view: z.enum(["desktop", "mobile"]).default("desktop").describe("Какой из двух снимков."),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ({ id, view = "desktop" }) => {
    const all = await loadCatalog();
    const block = all.find((candidate) => candidate.id === id);
    if (!block) throw new Error(`Блок "${id}" не найден. Посмотрите retkit_list_blocks.`);
    const preview = block.preview || {};
    if (preview.status !== "ok") {
      throw new Error(
        `У блока "${id}" нет готового превью` +
        (preview.error ? ` (${preview.error})` : "") +
        ". Как он выглядит — можно узнать только собрав письмо: retkit_compose_preview " +
        "и retkit_render_mail. Не описывайте вид блока по имени и слотам."
      );
    }
    const url = view === "mobile" ? preview.mobile : preview.desktop;
    if (!url) throw new Error(`У блока "${id}" нет снимка «${view}». Попробуйте другой вид.`);
    const image = await studioImage(url);
    return {
      content: [
        { type: "text", text: `Блок ${id}, вид ${view === "mobile" ? "на телефоне" : "на десктопе"}.` },
        { type: "image", data: image.base64, mimeType: image.mimeType },
      ],
    };
  }
);

server.registerTool(
  "retkit_block_source",
  {
    title: "Исходник блока: pug и стили",
    description:
      "Отдаёт разметку (pug) и стили (styl) блока — то, из чего он сделан. " +
      "Берите его ПЕРЕД тем, как создавать свой блок: новый блок должен быть похож на " +
      "соседей по каталогу, а не написан с нуля по общим соображениям. Разметка писем " +
      "держится на таблицах и мixin-ах семьи, и сверстать «как на сайте» здесь нельзя.",
    inputSchema: { id: z.string().describe("Идентификатор блока из retkit_list_blocks.") },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ({ id }) => {
    const all = await loadCatalog();
    const block = all.find((candidate) => candidate.id === id);
    if (!block) throw new Error(`Блок "${id}" не найден. Посмотрите retkit_list_blocks.`);
    const payload = {
      id: block.id,
      source: block.source || "canonical",
      placement: block.placement || "inner",
      scoped: block.scoped === true,
      pug: String(block.pug || ""),
      styl: String(block.styl || ""),
      slots: (block.slots || []).map((slot) => ({ id: slot.id, kind: slot.kind || "text" })),
    };
    return {
      content: [{
        type: "text",
        text: `# ${payload.id} (${payload.source}, ${payload.placement})\n\n` +
          `## pug\n${payload.pug}\n\n## styl\n${payload.styl || "(нет своих стилей)"}`,
      }],
      structuredContent: payload,
    };
  }
);

server.registerTool(
  "retkit_create_block",
  {
    title: "Создать блок в библиотеке",
    description:
      "Создаёт новый блок и кладёт его в пользовательскую часть библиотеки. Нужен, когда " +
      "в каталоге нет подходящего: подобрать похожий и подогнать значения — первый выбор, " +
      "новый блок — когда такой формы в каталоге нет вовсе.\n\n" +
      "Порядок обязателен: retkit_list_blocks (убедиться, что похожего нет) → " +
      "retkit_block_source у ближайшего соседа (взять его приёмы вёрстки) → создать здесь.\n\n" +
      "Блок проходит проверку студии. Не прошёл — остаётся черновиком и в письмо не встанет; " +
      "ответ вернёт список претензий, их надо починить и сохранить снова с force=true. " +
      "Канонические блоки студии этой ручкой не переписываются — только свои.\n\n" +
      "Это запись на диск человека: спрашивайте согласие до вызова, а не после.",
    inputSchema: {
      id: z.string().describe("Идентификатор: буквы, цифры, дефис. Например iq-promo-badge."),
      pug: z.string().describe("Разметка блока на pug."),
      label: z.string().optional().describe("Человеческое название для каталога."),
      description: z.string().optional().describe("Зачем блок и когда его брать."),
      placement: z.enum(["outer", "section", "inner", "both"]).default("inner")
        .describe("Уровень блока в письме."),
      category: z.string().optional().describe("Категория: text, cta, layout, footer, media…"),
      styl: z.string().optional().describe("Стили блока на stylus."),
      slots: z.array(z.object({
        id: z.string(),
        kind: z.string().optional().describe("text, html, url, color, image, enum…"),
        label: z.string().optional(),
        default: z.union([z.string(), z.number()]).optional(),
        options: z.array(z.string()).optional(),
      })).optional().describe("Поля блока, которые человек заполняет в конструкторе."),
      kits: z.array(z.enum(["system", "promo"])).optional().describe("В какие наборы попадёт."),
      tags: z.array(z.string()).optional(),
      force: z.boolean().default(false).describe("Перезаписать свой блок с таким же id."),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  },
  async ({ id, force = false, ...block }) => {
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(String(id || ""))) {
      throw new Error("id: латиница, цифры, дефис и подчёркивание, до 64 символов.");
    }
    let data;
    try {
      data = await studioFetch("/api/blocks-library/save", {
        method: "POST",
        body: { ...block, id, force },
      });
    } catch (error) {
      // Проверка блока — главная причина отказа, и её текст нужен целиком:
      // по нему видно, что именно чинить, а «HTTP 400» не говорит ничего.
      throw new Error(
        `Блок "${id}" не сохранён: ${error.message}\n` +
        "Если это претензии проверки — почините разметку и вызовите снова с force=true. " +
        "Посмотрите, как сделан похожий блок: retkit_block_source."
      );
    }
    const review = data?.review || {};
    // Черновик в письмо не встанет. Это не формальность: проверка ловит
    // непортируемую вёрстку, из-за которой блок разъезжается в почтовиках.
    const usable = review.status === "approved" || review.status === "candidate";
    const problems = [
      ...(review.deterministic?.errors || []),
      ...(review.deterministic?.warnings || []),
    ];
    const payload = { ok: true, id, path: data?.path || "", review, usable, problems };
    return {
      content: [{
        type: "text",
        text: `Блок ${id} сохранён (${payload.path}).\n` +
          `Проверка: ${review.status || "неизвестно"}.` +
          (usable
            ? " Блок можно ставить в письмо."
            : " Блок остался ЧЕРНОВИКОМ и в письмо не встанет — почините замечания и сохраните снова с force=true.") +
          (problems.length ? `\nЗамечания проверки:\n- ${problems.join("\n- ")}` : ""),
      }],
      structuredContent: payload,
    };
  }
);

server.registerTool(
  "retkit_update_block",
  {
    title: "Поправить свой блок",
    description:
      "Меняет части уже существующего СВОЕГО блока: разметку, стили, название, слоты. " +
      "Остальное остаётся как было — присылать блок целиком не нужно.\n\n" +
      "Канонические блоки студии так не правятся: они общие, и на них стоят письма, " +
      "собранные раньше. Чтобы изменить канонический — сделайте копию под новым id " +
      "через retkit_create_block и правьте её.\n\n" +
      "После правки блок перепроверяется. Не прошёл проверку — становится черновиком и " +
      "выпадает из конструктора, даже если до правки работал. Это видно в ответе.\n\n" +
      "Это запись на диск человека: спрашивайте согласие до вызова.",
    inputSchema: {
      id: z.string().describe("Идентификатор своего блока."),
      pug: z.string().optional().describe("Новая разметка целиком."),
      styl: z.string().optional().describe("Новые стили целиком."),
      label: z.string().optional(),
      description: z.string().optional(),
      category: z.string().optional(),
      placement: z.enum(["outer", "section", "inner", "both"]).optional(),
      slots: z.array(z.object({
        id: z.string(),
        kind: z.string().optional(),
        label: z.string().optional(),
        default: z.union([z.string(), z.number()]).optional(),
        options: z.array(z.string()).optional(),
      })).optional().describe("Новый набор полей ЦЕЛИКОМ — он заменяет прежний, а не дополняет."),
      kits: z.array(z.enum(["system", "promo"])).optional(),
      tags: z.array(z.string()).optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  },
  async ({ id, ...patch }) => {
    const all = await loadCatalog();
    const block = all.find((candidate) => candidate.id === id);
    if (!block) throw new Error(`Блок "${id}" не найден. Посмотрите retkit_list_blocks.`);
    if ((block.source || "canonical") !== "user") {
      throw new Error(
        `Блок "${id}" — канонический блок студии, он общий и на нём стоят собранные письма. ` +
        "Сделайте копию под новым id через retkit_create_block (исходник возьмёте " +
        "через retkit_block_source) и правьте её."
      );
    }
    const changed = Object.entries(patch).filter(([, value]) => value !== undefined);
    if (!changed.length) throw new Error("Нечего менять: не передано ни одного поля.");

    // Шлём целиком прежний блок с наложенными правками: ручка сохранения
    // принимает блок, а не заплатку, и недосланное поле она бы потеряла —
    // блок молча лишился бы стилей или половины слотов.
    const body = {
      id,
      label: block.label,
      description: block.description,
      placement: block.placement,
      category: block.category,
      pug: block.pug,
      styl: block.styl,
      slots: block.slots,
      ...(block.kits ? { kits: block.kits } : {}),
      ...(block.tags ? { tags: block.tags } : {}),
      ...(block.childSlots ? { childSlots: block.childSlots } : {}),
      ...(block.scoped !== undefined ? { scoped: block.scoped } : {}),
      ...Object.fromEntries(changed),
      force: true,
    };

    let data;
    try {
      data = await studioFetch("/api/blocks-library/save", { method: "POST", body });
    } catch (error) {
      throw new Error(
        `Блок "${id}" не сохранён: ${error.message}\n` +
        "Прежняя версия на месте. Почините замечания и вызовите снова."
      );
    }
    const review = data?.review || {};
    const usable = review.status === "approved" || review.status === "candidate";
    const problems = [
      ...(review.deterministic?.errors || []),
      ...(review.deterministic?.warnings || []),
    ];
    return {
      content: [{
        type: "text",
        text: `Блок ${id} обновлён (изменено: ${changed.map(([key]) => key).join(", ")}).\n` +
          `Проверка: ${review.status || "неизвестно"}.` +
          (usable
            ? " Блок по-прежнему можно ставить в письмо."
            : " Блок стал ЧЕРНОВИКОМ и выпал из конструктора — почините замечания и сохраните снова.") +
          (problems.length ? `\nЗамечания проверки:\n- ${problems.join("\n- ")}` : ""),
      }],
      structuredContent: { ok: true, id, changed: changed.map(([key]) => key), review, usable, problems },
    };
  }
);

/** Дерево письма. Одна форма на превью и на сохранение — не расходится. */
const blockTreeSchema = z
  .array(
    z.object({
      uid: z.string().describe("Уникальный идентификатор узла внутри письма."),
      blockId: z.string().describe("id блока из каталога."),
      parentUid: z.string().nullable().describe("uid родителя; null только у обёртки."),
      slotId: z.string().optional().describe("Слот родителя: sections у обёртки, content у секции."),
      slots: z.record(z.union([z.string(), z.number()])).optional().describe("Значения полей блока."),
    })
  )
  .min(1)
  .describe(
    "Дерево письма: обёртка (placement outer, parentUid null) → секции (slotId sections) → " +
    "внутренние блоки (slotId content). Порядок узлов задаёт порядок в письме."
  );

server.registerTool(
  "retkit_compose_preview",
  {
    title: "Собрать письмо и проверить",
    description:
      "Собирает письмо из дерева блоков и возвращает результат сборки: размер, предупреждения, " +
      "сколько блоков попало в вёрстку. Ничего не сохраняет — это проверка перед сохранением. " +
      "Готовый HTML возвращается только при include_html=true: письмо весит десятки килобайт.",
    inputSchema: {
      blocks: blockTreeSchema,
      mail_name: z.string().optional().describe("Имя для временной сборки, буквы/цифры/дефис."),
      include_html: z.boolean().default(false).describe("Вернуть собранный HTML целиком."),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  async ({ blocks, mail_name, include_html = false }) => {
    const data = await studioFetch("/api/compose-preview", {
      method: "POST",
      body: { mailName: String(mail_name || "mcp-preview").replace(/[^a-z0-9_-]/gi, "-"), blocks },
    });
    const payload = {
      ok: true,
      html_bytes: Number(data?.htmlLength || 0),
      warnings: data?.warnings || [],
      blocks_in_tree: blocks.length,
      ...(include_html ? { html: data?.html || "" } : {}),
    };
    const summary = include_html
      ? JSON.stringify(payload, null, 2)
      : `Письмо собралось: ${payload.html_bytes} байт, узлов в дереве ${payload.blocks_in_tree}.` +
        (payload.warnings.length ? `\nПредупреждения:\n- ${payload.warnings.join("\n- ")}` : "\nПредупреждений нет.");
    return { content: [{ type: "text", text: summary }], structuredContent: payload };
  }
);

server.registerTool(
  "retkit_render_mail",
  {
    title: "Посмотреть собранное письмо",
    description:
      "Собирает письмо из дерева блоков и возвращает СНИМОК — картинку, а не вёрстку. " +
      "Вызывайте, прежде чем показывать работу человеку и прежде чем рассуждать о том, " +
      "как письмо выглядит: размер в байтах и список предупреждений про внешний вид " +
      "не говорят ничего.\n\n" +
      "Можно снять то же письмо в виде mobile — мобильная вёрстка ломается чаще десктопной.\n" +
      "Ничего не сохраняет. Требует браузера на машине студии; если его нет, ответ скажет, " +
      "какой командой его поставить.",
    inputSchema: {
      blocks: blockTreeSchema,
      view: z.enum(["desktop", "mobile"]).default("desktop").describe("Десктоп или телефон."),
      mail_name: z.string().optional().describe("Имя временной сборки."),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  async ({ blocks, view = "desktop", mail_name }) => {
    const data = await studioFetch("/api/compose-preview", {
      method: "POST",
      body: {
        mailName: String(mail_name || "mcp-shot").replace(/[^a-z0-9_-]/gi, "-"),
        blocks,
      },
    });
    const html = String(data?.html || "");
    if (!html) {
      throw new Error(
        "Студия собрала письмо, но не отдала вёрстку — снимать нечего. " +
        "Проверьте дерево через retkit_compose_preview."
      );
    }
    // HTML через модель не гоняем: он весит десятки килобайт и модели не
    // нужен — нужен снимок. Поэтому вёрстка идёт со студии на студию.
    const image = await studioImage("/api/render-shot", {
      method: "POST",
      body: { html, view },
    });
    const warnings = Array.isArray(data?.warnings) ? data.warnings : [];
    return {
      content: [
        {
          type: "text",
          text: `Письмо на ${view === "mobile" ? "телефоне" : "десктопе"}: ` +
            `${Number(data?.htmlLength || 0)} байт вёрстки, узлов ${blocks.length}.` +
            (warnings.length ? `\nПредупреждения:\n- ${warnings.join("\n- ")}` : "\nПредупреждений нет."),
        },
        { type: "image", data: image.base64, mimeType: image.mimeType },
      ],
    };
  }
);

server.registerTool(
  "retkit_save_mail",
  {
    title: "Сохранить письмо в базу",
    description:
      "Сохраняет собранное письмо в email-base и собирает его. Пишет на диск: сначала " +
      "проверьте вёрстку через retkit_compose_preview. Если письмо с таким именем есть, " +
      "вызов будет отклонён — перезапись только с force=true.",
    inputSchema: {
      mail_name: z.string().describe("Имя письма: буквы, цифры, дефис, подчёркивание."),
      blocks: blockTreeSchema,
      brand: z.string().optional().describe("Папка бренда, по умолчанию X_assembled."),
      force: z.boolean().default(false).describe("Перезаписать существующее письмо."),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  },
  async ({ mail_name, blocks, brand, force = false }) => {
    if (!/^[a-z0-9_-]+$/i.test(String(mail_name || ""))) {
      throw new Error("mail_name: только буквы, цифры, дефис и подчёркивание.");
    }
    const data = await studioFetch("/api/compose-save", {
      method: "POST",
      body: { mailName: mail_name, blocks, ...(brand ? { brand } : {}), force },
    });
    const payload = {
      ok: true,
      mail: data?.mail || `mail-${mail_name}`,
      brand: data?.brand || brand || "X_assembled",
      warnings: data?.warnings || [],
    };
    return {
      content: [{ type: "text", text: `Сохранено: ${payload.brand}/${payload.mail}` }],
      structuredContent: payload,
    };
  }
);

server.registerTool(
  "retkit_open_draft",
  {
    title: "Взять письмо в черновик",
    description:
      "Делает вашу личную копию существующего письма и возвращает её имя. Правьте копию — " +
      "общая база при этом не меняется, и человеку не нужно подтверждать каждую вашу правку.\n\n" +
      "Так следует работать с ЛЮБЫМ существующим письмом: прямая правка письма базы мешает " +
      "человеку и отвергается, если он сейчас его открыл.",
    inputSchema: {
      mail: z.string().describe("Имя письма в базе, например mail-welcome."),
      brand: z.string().describe("Папка бренда, например X_IQ."),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async ({ mail, brand }) => {
    const data = await studioFetch("/api/drafts/open", { method: "POST", body: { brand, mail } });
    const payload = { ok: true, draft: data?.draft, brand: data?.brand || brand, created: Boolean(data?.created) };
    return {
      content: [{
        type: "text",
        text: `Черновик: ${payload.brand}/${payload.draft}. ` +
          `Сохраняйте работу в него (retkit_save_mail с mail_name «${payload.draft}»), ` +
          `а в базу переносите через retkit_publish_draft — и только когда человек это подтвердит.`,
      }],
      structuredContent: payload,
    };
  }
);

server.registerTool(
  "retkit_list_drafts",
  {
    title: "Мои черновики",
    description:
      "Ваши незаконченные копии писем: что взято, изменено ли, и не поменялся ли оригинал " +
      "в базе, пока вы работали. Смотрите сюда, прежде чем начинать письмо заново — вчерашняя " +
      "работа могла остаться здесь.",
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async () => {
    const data = await studioFetch("/api/drafts");
    const drafts = (data?.drafts || []).filter((entry) => !entry.discardedAt);
    const payload = { count: drafts.length, drafts };
    return {
      content: [{
        type: "text",
        text: drafts.length
          ? drafts.map((entry) =>
              `${entry.brand}/${entry.draft} — копия ${entry.mail}` +
              `${entry.changed ? ", изменён" : ", без правок"}` +
              `${entry.baseChanged ? ", ВНИМАНИЕ: оригинал в базе изменился" : ""}`
            ).join("\n")
          : "Черновиков нет.",
      }],
      structuredContent: payload,
    };
  }
);

server.registerTool(
  "retkit_publish_draft",
  {
    title: "Опубликовать черновик в базу",
    description:
      "Переносит вашу копию в общую базу. Это единственный необратимый шаг в работе с письмом, " +
      "поэтому вызывайте его ТОЛЬКО когда человек прямо попросил опубликовать — не «заодно» и не " +
      "по собственному решению.\n\n" +
      "Если оригинал в базе изменился, пока вы работали, вызов будет отклонён: покажите человеку " +
      "расхождение и спросите, публиковать ли поверх (force=true). Прежняя версия сохраняется в " +
      "истории письма, откатить можно.",
    inputSchema: {
      mail: z.string().describe("Имя письма в базе (без части __draft-…), например mail-welcome."),
      brand: z.string().describe("Папка бренда."),
      force: z.boolean().default(false)
        .describe("Публиковать поверх изменившегося оригинала. Только с явного согласия человека."),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  },
  async ({ mail, brand, force = false }) => {
    const data = await studioFetch("/api/drafts/publish", { method: "POST", body: { brand, mail, force } });
    const payload = { ok: true, brand: data?.brand || brand, mail: data?.mail || mail, snapshot: data?.snapshot || null };
    return {
      content: [{
        type: "text",
        text: `Опубликовано в базу: ${payload.brand}/${payload.mail}. Прежняя версия сохранена в истории письма.`,
      }],
      structuredContent: payload,
    };
  }
);

server.registerTool(
  "retkit_discard_draft",
  {
    title: "Отказаться от черновика",
    description:
      "Убирает вашу копию, не трогая базу. Копия уходит в корзину студии, поэтому отказ обратим. " +
      "Вызывайте, когда человек сказал, что этот вариант не нужен.",
    inputSchema: {
      mail: z.string().describe("Имя письма в базе, например mail-welcome."),
      brand: z.string().describe("Папка бренда."),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  },
  async ({ mail, brand }) => {
    await studioFetch("/api/drafts/discard", { method: "POST", body: { brand, mail } });
    return {
      content: [{ type: "text", text: `Черновик ${brand}/${mail} отложен в корзину. База не изменилась.` }],
      structuredContent: { ok: true, brand, mail },
    };
  }
);

server.registerTool(
  "retkit_mail_history",
  {
    title: "История письма",
    description:
      "Снимки письма: когда, кем и зачем оно менялось. Отсюда же берётся момент для отката, если " +
      "человек говорит, что изменение было лишним.",
    inputSchema: {
      mail: z.string().describe("Имя письма, например mail-welcome."),
      brand: z.string().describe("Папка бренда."),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ({ mail, brand }) => {
    const data = await studioFetch(
      `/api/drafts?brand=${encodeURIComponent(brand)}&mail=${encodeURIComponent(mail)}`
    );
    const history = data?.history || [];
    return {
      content: [{
        type: "text",
        text: history.length
          ? history.map((entry) =>
              `${new Date(entry.at).toISOString()} — ${entry.by || "неизвестно кто"}` +
              `${entry.note ? ` (${entry.note})` : ""}; для отката: at=${entry.at}`
            ).join("\n")
          : "Снимков пока нет.",
      }],
      structuredContent: { count: history.length, history },
    };
  }
);

server.registerTool(
  "retkit_list_mails",
  {
    title: "Письма в базе",
    description: "Список писем в email-base — чтобы взять существующее за образец или проверить имя перед сохранением.",
    inputSchema: {
      brand: z.string().optional().describe("Фильтр по папке бренда."),
      limit: z.number().int().min(1).max(500).default(100),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ({ brand, limit = 100 }) => {
    const data = await studioFetch("/api/wb/emails");
    const groups = Array.isArray(data?.groups) ? data.groups : [];
    const mails = [];
    for (const group of groups) {
      if (brand && group.brand !== brand) continue;
      for (const mail of group.mails || group.emails || []) {
        mails.push({ brand: group.brand, mail: typeof mail === "string" ? mail : mail?.name });
        if (mails.length >= limit) break;
      }
      if (mails.length >= limit) break;
    }
    const payload = { count: mails.length, mails };
    return {
      content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
      structuredContent: payload,
    };
  }
);

/* ─── Код самой студии ─────────────────────────────────────────────────────── */
// Claude Code, открытый в папке студии, читает исходники сам — эти три
// инструмента для клиентов, у которых доступа к файлам нет вовсе.

server.registerTool(
  "retkit_find_in_code",
  {
    title: "Найти в коде студии",
    description:
      "Поиск по исходникам студии: где объявлена функция, кто зовёт ручку, откуда берётся " +
      "текст ошибки. Начинайте отсюда — студия это сотни файлов, и открывать их подряд " +
      "бессмысленно.\n\n" +
      "Ищет регулярным выражением по коду, скриптам, интерфейсу и документации. " +
      "node_modules и файлы, похожие на ключи, не читаются вовсе.",
    inputSchema: {
      query: z.string().describe("Строка или регулярное выражение."),
      in: z.string().optional().describe("Сузить до пути: src/, public/, scripts/test-"),
      limit: z.number().int().min(1).max(200).default(60),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ({ query, in: where = "", limit = 60 }) => {
    const params = new URLSearchParams({ q: query, in: where, limit: String(limit) });
    const data = await studioFetch(`/api/source/search?${params}`);
    const lines = (data?.hits || []).map((hit) => `${hit.file}:${hit.line}  ${hit.text}`);
    return {
      content: [{
        type: "text",
        text: lines.length
          ? `Найдено ${data.count}${data.capped ? " (показаны не все)" : ""}:\n${lines.join("\n")}`
          : `По запросу «${query}» ничего не найдено.` +
            " Попробуйте часть слова или уберите сужение по пути — но не делайте вывода, что этого в студии нет.",
      }],
      structuredContent: data,
    };
  }
);

server.registerTool(
  "retkit_read_code",
  {
    title: "Прочитать файл студии",
    description:
      "Отдаёт исходник студии с номерами строк. Большие файлы читаются окном: server.js — " +
      "это двадцать тысяч строк, целиком его читать не нужно и не выйдет. Найдите место " +
      "через retkit_find_in_code и прочитайте вокруг него.\n\n" +
      "Только чтение. Править код студии отсюда нельзя — правки идут через Claude Code, " +
      "открытый в папке студии, где есть git и откат.",
    inputSchema: {
      file: z.string().describe("Путь от корня студии: src/router.js, public/constructor.js."),
      from: z.number().int().min(1).default(1).describe("С какой строки."),
      lines: z.number().int().min(1).max(1200).default(400).describe("Сколько строк."),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ({ file, from = 1, lines = 400 }) => {
    const params = new URLSearchParams({ file, from: String(from), lines: String(lines) });
    const data = await studioFetch(`/api/source/read?${params}`);
    return {
      content: [{
        type: "text",
        text: `${data.file} — строки ${data.from}–${data.to} из ${data.totalLines}` +
          `${data.truncated ? " (дальше есть ещё)" : ""}\n\n${data.text}`,
      }],
      structuredContent: data,
    };
  }
);

server.registerTool(
  "retkit_list_code",
  {
    title: "Что лежит в папке студии",
    description:
      "Список файлов папки студии с размером в строках. Нужен, чтобы понять устройство, " +
      "а не угадывать имена файлов.",
    inputSchema: { dir: z.string().default("src").describe("Папка: src, public, scripts, mcp, docs.") },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ({ dir = "src" }) => {
    const data = await studioFetch(`/api/source/list?${new URLSearchParams({ dir })}`);
    const rows = (data?.entries || []).map((entry) => (
      entry.kind === "dir" ? `${entry.name}/` : `${entry.name}${entry.lines ? `  (${entry.lines} строк)` : ""}`
    ));
    return {
      content: [{ type: "text", text: `${data.dir}:\n${rows.join("\n")}` }],
      structuredContent: data,
    };
  }
);

server.registerTool(
  "retkit_studio_guide",
  {
    title: "Инструкции студии по темам",
    description:
      "Инструкция по студии. Темы: emails — структура письма, наборы блоков, слоты и " +
      "порядок вызовов (читайте ПЕРВОЙ, до сборки письма); development — работа над кодом " +
      "самой студии и её правила; architecture — как студия устроена внутри; blocks — " +
      "формат блоков и слотов; locales — плейсхолдеры и переводы. Берите тему под задачу.",
    inputSchema: {
      topic: z.enum(["emails", "development", "architecture", "blocks", "locales"])
        .default("emails")
        .describe("Тема инструкции. По умолчанию emails — сборка письма."),
    },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  },
  async ({ topic = "emails" }) => ({ content: [{ type: "text", text: studioGuide(topic) }] })
);

server.registerResource(
  "studio-guide",
  "retkit://guide",
  {
    title: "Правила сборки писем RetKit",
    description: "Структура письма, наборы блоков, слоты и порядок работы.",
    mimeType: "text/markdown",
  },
  async (uri) => ({ contents: [{ uri: uri.href, mimeType: "text/markdown", text: studioGuide() }] })
);

// Остальные темы — тоже ресурсами: часть клиентов читает ресурсы и не вызывает
// инструменты, и для них подключение без этого выглядело бы пустым.
for (const [topic, meta] of Object.entries(GUIDE_TOPICS)) {
  if (topic === "emails") continue;
  server.registerResource(
    `studio-guide-${topic}`,
    `retkit://guide/${topic}`,
    { title: meta.title, description: meta.title, mimeType: "text/markdown" },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: "text/markdown", text: studioGuide(topic) }] })
  );
}

server.registerPrompt(
  "retkit_build_email",
  {
    title: "Собрать письмо в студии",
    description: "Готовый сценарий: от описания задачи до сохранённого письма.",
    argsSchema: {
      task: z.string().describe("Что за письмо нужно, обычными словами."),
      mail_name: z.string().optional().describe("Имя для сохранения, если уже известно."),
    },
  },
  ({ task, mail_name }) => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text:
            `Собери письмо в студии RetKit.\n\nЗадача: ${task}\n` +
            (mail_name ? `Имя письма: ${mail_name}\n` : "") +
            `\nПорядок: сначала вызови retkit_studio_guide и прочитай правила. ` +
            `Дальше подбери блоки через retkit_list_blocks (для сервисного письма kit "system"), ` +
            `уточни поля через retkit_get_block, собери дерево и проверь его retkit_compose_preview. ` +
            `Покажи мне, что получилось, и сохрани только после моего подтверждения.`,
        },
      },
    ],
  })
);

/* ─── Полный набор студии ──────────────────────────────────────────────────
 *
 * Здесь заканчиваются инструменты, написанные для MCP вручную, и начинается
 * то, чем студия пользуется сама. Оператор студии умеет много такого, чего у
 * подключённого агента не было вовсе: править локали, хирургически менять
 * вёрстку, вставлять и убирать блоки в открытом письме, расставлять
 * плейсхолдеры, менять исходники и стили письма, смотреть на письмо и на блок
 * картинкой. Человек этой границы не видит и видеть не должен — он спрашивает
 * и ждёт работы.
 *
 * Поэтому набор объявлен в студии один раз, а сюда приезжает по HTTP. Новый
 * инструмент появляется у обоих сразу, и разойтись они больше не могут.
 * Студия не отвечает — подключаем только то, что написано здесь вручную: без
 * сборки писем агент бесполезен, а без правки локалей ещё поработает.
 */

/** Параметры инструмента студии описаны JSON Schema — переводим в zod. */
function zodFromJsonSchema(schema) {
  const shape = {};
  const properties = schema?.properties || {};
  const required = new Set(Array.isArray(schema?.required) ? schema.required : []);
  for (const [key, spec] of Object.entries(properties)) {
    let field;
    if (Array.isArray(spec?.enum) && spec.enum.length) field = z.enum(spec.enum);
    else if (spec?.type === "number" || spec?.type === "integer") field = z.number();
    else if (spec?.type === "boolean") field = z.boolean();
    else if (spec?.type === "array") field = z.array(z.any());
    else if (spec?.type === "object") field = z.record(z.any());
    else field = z.string();
    if (spec?.description) field = field.describe(String(spec.description).slice(0, 900));
    shape[key] = required.has(key) ? field : field.optional();
  }
  return shape;
}

/** Инструменты студии, у которых уже есть своя обёртка выше. */
const ALREADY_WRAPPED = new Set([
  "finish", "compose_email_from_blocks", "list_canonical_blocks", "get_block_source",
  "save_user_block", "delete_user_block",
  // Черновики и история: свои обёртки выше ходят от имени агента (его метка в
  // заголовке запроса), а через мост они пришли бы от имени студии — и агент
  // писал бы в чужую копию.
  "open_draft", "list_drafts", "draft_changes", "publish_draft", "discard_draft", "mail_history",
]);

try {
  const listed = await studioFetch("/api/agent/tools");
  for (const tool of listed?.tools || []) {
    if (tool.browserOnly || ALREADY_WRAPPED.has(tool.name)) continue;
    const name = `retkit_${tool.name}`;
    server.registerTool(
      name,
      {
        title: tool.name,
        description: `${tool.description}\n\n(Инструмент студии. Работает с письмом, которое вы укажете: brand и mail.)`,
        inputSchema: {
          ...zodFromJsonSchema(tool.parameters),
          brand: z.string().optional().describe("Папка бренда открытого письма, например X_IQ."),
          mail: z.string().optional().describe("Имя письма, например mail-welcome."),
        },
        annotations: { openWorldHint: false },
      },
      async ({ brand, mail, ...args }) => {
        const data = await studioFetch("/api/agent/call", {
          method: "POST",
          body: { tool: tool.name, args, context: { brand, mail, surface: "workbench" } },
        });
        const content = [{ type: "text", text: JSON.stringify(data?.result ?? {}, null, 2).slice(0, 24000) }];
        // Снимок письма или блока приходит картинкой — показываем её, а не
        // пересказываем: ради этого всё и делалось.
        for (const image of data?.images || []) {
          const base64 = String(image?.dataUrl || "").split(",")[1] || "";
          if (base64) content.push({ type: "image", data: base64, mimeType: "image/png" });
        }
        return { content };
      }
    );
  }
} catch (error) {
  console.error(`[retkit] полный набор студии недоступен (${error.message}) — работают только встроенные инструменты.`);
}

await server.connect(new StdioServerTransport());
