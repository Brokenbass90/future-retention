/**
 * src/routes/agent-routes.js — один набор инструментов на всех агентов.
 *
 * До этого в студии жили ДВА агента, у которых не было ни одного общего
 * инструмента. Оператор студии (её собственная модель, чат в окне) умел
 * править локали, хирургически менять HTML, вставлять блоки в открытое
 * письмо — но работал вслепую и не знал про черновики. Подключённый по MCP
 * Клод видел письмо картинкой, работал в личном черновике и читал код — но
 * не трогал ни локали, ни вёрстку.
 *
 * Человек этого различия не знает и знать не должен: он спрашивает в окне
 * студии и ждёт работы. Поэтому набор инструментов теперь один, объявлен в
 * одном месте (`src/ai-tools.js`), а эти две ручки — мост: оператор зовёт
 * инструменты напрямую в процессе, MCP-сервер ходит сюда по HTTP. Новый
 * инструмент появляется у обоих сразу, и разойтись они больше не могут.
 *
 * Контекст приходит снаружи, потому что он разный: у оператора его собирает
 * браузер (открытый HTML, дерево канваса), у MCP — имя письма, по которому
 * студия читает то же самое с диска.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { TOOL_DEFINITIONS, TOOL_HANDLERS } from "../ai-tools.js";
import { callRelay, relayOnline, relayStatus } from "../relay.js";
import { canvasSummaryFrom } from "../canvas-summary.js";
import { normalizeConstructorCatalog } from "../constructor-catalog.js";
import { extractEmailTexts } from "../email-texts.js";
import { createHash } from "node:crypto";
import { BUILD_ID } from "../build-id.js";
import { imageNeedsFrom } from "../canvas-images.js";

/** Черновик HTML-правок своего агента: правки копятся, а не перетирают друг друга. */
const agentHtmlDrafts = new Map();
const hashOf = (text) => createHash("sha1").update(String(text || "")).digest("hex");

/** Инструменты, которым нужен живой браузер человека, а не имя письма. */
// Канвас конструктора существует только в браузере: на диске его нет, и
// внешнему агенту через MCP менять его нечем. Поэтому весь набор канвас-
// инструментов помечен как browserOnly — иначе MCP-клиент получал бы «ок» на
// правку, которой никто не увидит.
/** Инструменты, которым нужно письмо, открытое во вкладке «Код». */
const NEEDS_OPEN_MAIL = new Set([
  "read_open_html", "list_namespaces", "get_namespace_blocks", "analyze_email", "align_locales_to_reference",
  "compare_locales", "placeholderize_html", "fix_locale_txt", "translate_locale_txt", "find_across_locales",
  "replace_across_locales", "find_in_html", "replace_in_html", "create_locale", "normalize_locale_conventions",
  "delete_locale", "edit_locale_block", "set_locale_blocks", "validate_html", "list_email_sections",
  "insert_block", "remove_block", "see_email", "list_mail_files", "read_mail_file", "write_mail_file",
]);

function studioOrigin(request) {
  const headers = request?.headers || {};
  const host = String(headers["x-forwarded-host"] || headers.host || "").split(",")[0].trim();
  const proto = String(headers["x-forwarded-proto"] || "").split(",")[0].trim() || (/^(localhost|127\.0\.0\.1)/.test(host) ? "http" : "https");
  return host ? `${proto}://${host}` : "";
}

/** Что сказать агенту, если вкладка «Код» не на связи. */
export function codeTabMissingError(origin = "") {
  return "Во вкладке «Код» студии не открыто письмо (или вкладка не на связи с вашей ссылкой). " +
    "Откройте её сами: retkit_open_studio с page=\"code\" и brand/mail письма — человеку останется один клик. " +
    "Или попросите его открыть письмо в «Коде» студии" + (origin ? ` по адресу ${origin}` : "") +
    " в том же браузере. Студия на localhost — другая студия: ваша ссылка туда не ведёт.";
}

const BROWSER_ONLY = new Set([
  "update_canvas_block",
  "add_canvas_block",
  "remove_canvas_block",
  "move_canvas_block",
  "clear_canvas",
  "check_canvas_ready",
]);

/**
 * @param {object} deps
 * @param {string} deps.repoRoot
 * @param {Function} deps.sendJson
 * @param {Function} deps.readRequestBody
 * @param {() => boolean} deps.isReadOnly
 * @param {() => string} deps.apiKey — некоторым инструментам нужна модель
 */
/**
 * Heroku обрывает любой запрос, не ответивший за 30 секунд (H12 → 503). Долгие
 * дела агента (сборка, разбор письма, переход страниц) этого не знают. Поэтому
 * каждая ручка агента через 24 секунды отвечает «ещё выполняется, job=…», а
 * настоящий ответ кладётся сюда и забирается через /api/agent/job.
 */
const AGENT_JOBS = new Map();
const AGENT_RESPONSE_BUDGET_MS = 24_000;

export function registerAgentRoutes(router, deps) {
  const { repoRoot, readRequestBody, isReadOnly, apiKey } = deps;
  const rawSendJson = deps.sendJson;
  const sendJson = (response, status, body) => {
    if (response.__retkitJob) {
      AGENT_JOBS.set(response.__retkitJob, { done: true, status, body, at: Date.now() });
      return;
    }
    if (response.__retkitSent) return;
    response.__retkitSent = true;
    clearTimeout(response.__retkitTimer);
    rawSendJson(response, status, body);
  };
  const post = (pathname, handler) => router.post(pathname, async (request, response, context) => {
    response.__retkitTimer = setTimeout(() => {
      if (response.__retkitSent) return;
      const job = createHash("sha1").update(`${Date.now()}:${Math.random()}`).digest("hex").slice(0, 16);
      for (const [id, entry] of AGENT_JOBS) if (Date.now() - entry.at > 10 * 60_000) AGENT_JOBS.delete(id);
      AGENT_JOBS.set(job, { done: false, at: Date.now() });
      response.__retkitSent = true;
      response.__retkitJob = job;
      rawSendJson(response, 200, { ok: true, result: { pending: true, job,
        note: "Ещё выполняется в студии. Через 5–10 секунд заберите итог: retkit_job с этим job (или retkit_call tool=job, args={job})." } });
    }, Number(deps.responseBudgetMs) || AGENT_RESPONSE_BUDGET_MS);
    try { await handler(request, response, context); }
    finally { clearTimeout(response.__retkitTimer); }
  });

  router.get("/api/agent/job", (request, response) => {
    const id = new URL(request.url, "http://localhost").searchParams.get("id") || "";
    const entry = AGENT_JOBS.get(id);
    if (!entry) { rawSendJson(response, 200, { ok: false, error: "Такого job нет (или он старше 10 минут)." }); return; }
    if (!entry.done) { rawSendJson(response, 200, { ok: true, result: { pending: true, job: id, note: "Всё ещё выполняется — спросите ещё раз через 5–10 секунд." } }); return; }
    AGENT_JOBS.delete(id);
    rawSendJson(response, entry.status || 200, entry.body);
  });

  router.get("/api/agent/tools", (request, response) => {
    sendJson(response, 200, {
      ok: true,
      count: TOOL_DEFINITIONS.length,
      tools: TOOL_DEFINITIONS.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
        // Что нельзя вызвать снаружи браузера — говорим заранее, а не
        // молчаливой ошибкой на середине работы агента.
        browserOnly: BROWSER_ONLY.has(tool.name),
      })),
    });
  });

  /**
   * Холст конструктора для своего агента. Холст живёт во вкладке человека,
   * поэтому: забираем его оттуда через связь (src/relay.js, канал
   * constructor), прогоняем тем же инструментом, что и оператор студии, и
   * отправляем получившиеся правки обратно во вкладку — она применяет их
   * так же, как правки оператора, с отменой по Ctrl+Z.
   */
  post("/api/agent/canvas-call", async (request, response) => {
    try {
      const body = await readRequestBody(request);
      const name = String(body?.tool || "").trim();
      const token = request.retkitActor?.token || "";
      const batch = name === "batch" ? (Array.isArray(body?.args?.ops) ? body.args.ops : null) : null;
      if (name === "batch" && (!batch || !batch.length)) {
        sendJson(response, 400, { ok: false, error: "batch: нужен непустой ops — [{tool, args}, …]." });
        return;
      }
      if (batch) {
        const bad = batch.find((op) => !BROWSER_ONLY.has(String(op?.tool || "")) || op?.tool === "check_canvas_ready");
        if (bad) { sendJson(response, 400, { ok: false, error: `batch: «${bad?.tool}» — не правка холста.` }); return; }
      }
      if (name !== "read_canvas" && name !== "batch" && name !== "image_needs" && !BROWSER_ONLY.has(name)) {
        sendJson(response, 400, { ok: false, error: `"${name}" — не инструмент холста.` });
        return;
      }
      const read = await callRelay(token, "canvas_read", {}, { channel: "constructor", timeoutMs: 20_000 });
      if (!read.ok) { sendJson(response, 200, read); return; }
      const canvas = Array.isArray(read.result?.canvas) ? read.result.canvas : [];
      const summary = canvasSummaryFrom(canvas);
      if (name === "read_canvas") {
        sendJson(response, 200, { ok: true, result: { mailName: read.result?.mailName || "", blocks: summary } });
        return;
      }
      if (name === "image_needs") {
        sendJson(response, 200, { ok: true, result: imageNeedsFrom(summary, normalizeConstructorCatalog(read.result?.studio)) });
        return;
      }
      const ctx = {
        surface: "constructor",
        repoRoot,
        readOnly: Boolean(isReadOnly()),
        actor: request.retkitActor || null,
        apiKey: apiKey(),
        canvas,
        canvasSummary: summary,
        constructorCatalog: normalizeConstructorCatalog(read.result?.studio),
        constructorMailName: String(read.result?.mailName || ""),
        pendingLocaleUpdates: [],
        pendingLocaleDeletes: [],
        pendingImages: [],
        html: "",
      };
      let result;
      if (batch) {
        // Все правки — в одном контексте: следующая видит предыдущие (и временные
        // uid только что добавленных блоков), а на холст уходят одним пакетом.
        const steps = [];
        for (const [index, op] of batch.entries()) {
          const step = await TOOL_HANDLERS[op.tool](op?.args && typeof op.args === "object" ? op.args : {}, ctx);
          steps.push({ index, tool: op.tool, ...(step?.error ? { error: step.error } : { ok: true, uid: step?.uid ?? op?.args?.uid ?? null }) });
          if (step?.error) {
            sendJson(response, 200, { ok: false, error: `batch остановлен на шаге ${index} (${op.tool}): ${step.error}. Ничего не применено.`, result: { steps } });
            return;
          }
        }
        result = { steps };
      } else {
        result = await TOOL_HANDLERS[name](body?.args && typeof body.args === "object" ? body.args : {}, ctx);
      }
      if (result?.error || !Array.isArray(ctx.canvasOps) || !ctx.canvasOps.length) {
        sendJson(response, 200, { ok: !result?.error, result });
        return;
      }
      const applied = await callRelay(token, "canvas_apply", { ops: ctx.canvasOps }, { channel: "constructor", timeoutMs: 30_000 });
      sendJson(response, 200, {
        ok: applied.ok && !(applied.result?.problems || []).length,
        result: { tool: result, onCanvas: applied.ok ? applied.result : null },
        ...(applied.ok ? {} : { error: applied.error }),
      });
    } catch (error) {
      sendJson(response, 500, { ok: false, error: error.message });
    }
  });

  /**
   * Переход между конструктором и кодом по просьбе агента. Нажимает ту же
   * кнопку, что человек («→ В код» / «В конструктор»), и ждёт, пока на том
   * конце откроется вкладка — тогда агент сразу может работать дальше.
   */
  post("/api/agent/navigate", async (request, response) => {
    try {
      const body = await readRequestBody(request);
      const to = body?.to === "constructor" ? "constructor" : "workbench";
      const from = to === "constructor" ? "workbench" : "constructor";
      const token = request.retkitActor?.token || "";
      const started = await callRelay(token, to === "workbench" ? "to_code" : "to_constructor", { discard: body?.discard === true }, { channel: from, timeoutMs: 15_000 });
      if (!started.ok) { sendJson(response, 200, started); return; }
      const deadline = Date.now() + 25_000;
      // Старая вкладка ещё «на связи» несколько секунд: ждём именно новую.
      const before = relayStatus(token, to).lastPollAt || 0;
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 700));
        const status = relayStatus(token, to);
        if (status.online && status.lastPollAt > before) {
          sendJson(response, 200, { ok: true, result: { opened: to === "workbench" ? "Код" : "Конструктор", ...started.result, tab: status.moengage || null } });
          return;
        }
      }
      sendJson(response, 200, { ok: false, error: "Переход начат, но новая вкладка не ответила за 25 секунд — возможно, студия показала человеку вопрос или ошибку." });
    } catch (error) {
      sendJson(response, 500, { ok: false, error: error.message });
    }
  });

  /** Плейсхолдеры по эталонной локали — в Pug открытого письма, сразу. */
  post("/api/agent/placeholders", async (request, response) => {
    try {
      const body = await readRequestBody(request);
      const reply = await callRelay(request.retkitActor?.token || "", "wb_placeholders",
        { namespace: String(body?.namespace || ""), refLocale: String(body?.refLocale || "en") },
        { channel: "workbench", timeoutMs: 45_000 });
      sendJson(response, 200, reply);
    } catch (error) {
      sendJson(response, 500, { ok: false, error: error.message });
    }
  });

  /** Собранный HTML письма с диска: оригинал или локаль. */
  async function readBuilt(brand, mail, locale) {
    const safe = (value) => String(value || "").replace(/[^A-Za-z0-9_.-]/g, "");
    const parts = [repoRoot, "email-base", "dist", safe(brand), safe(mail)];
    const code = String(locale || "").trim();
    if (code && !/^original$/i.test(code)) parts.push(safe(code.toLowerCase()));
    return readFile(path.join(...parts, "index.html"), "utf8");
  }

  /**
   * Собрать письмо так же, как кнопка «Собрать» во вкладке «Код» (она же
   * синхронизирует локали на диск), и вернуть, что получилось: тексты
   * каждой просимой локали и неподставленные плейсхолдеры — проверка итога.
   */
  post("/api/agent/build", async (request, response) => {
    try {
      const body = await readRequestBody(request);
      const token = request.retkitActor?.token || "";
      const built = await callRelay(token, "wb_build", {}, { channel: "workbench", timeoutMs: 120_000 });
      if (!built.ok) { sendJson(response, 200, built); return; }
      const { brand, mail } = built.result || {};
      const wanted = Array.isArray(body?.locales) && body.locales.length ? body.locales.map(String) : ["original"];
      const locales = {};
      for (const code of wanted.slice(0, 8)) {
        try { locales[code] = extractEmailTexts(await readBuilt(brand, mail, code)); }
        catch { locales[code] = { error: `локаль ${code} не собрана` }; }
      }
      sendJson(response, 200, { ok: built.result.built, result: { ...built.result, locales } });
    } catch (error) {
      sendJson(response, 500, { ok: false, error: error.message });
    }
  });

  /**
   * Одним взглядом: какие страницы студии у человека на связи, что в них
   * открыто, есть ли несохранённые правки и не устарел ли JS вкладки после
   * деплоя. Агенту не нужно угадывать состояние по ошибкам.
   */
  router.get("/api/agent/status", (request, response) => {
    const token = request.retkitActor?.token || "";
    const page = (channel) => {
      const status = relayStatus(token, channel);
      const tab = status.moengage || null;
      const tabBuild = tab?.build || "";
      return {
        online: status.online,
        lastSeenSecAgo: status.lastPollAt ? Math.round((Date.now() - status.lastPollAt) / 1000) : null,
        ...(tab ? { tab: { ...tab, build: undefined } } : {}),
        ...(status.online && tabBuild && tabBuild !== BUILD_ID ? { outdated: true, fix: "Вкладка открыта до обновления студии — попросите человека обновить её (F5)." } : {}),
      };
    };
    const constructor = page("constructor");
    const code = page("workbench");
    const moengage = page("moengage");
    const next = constructor.online || code.online
      ? (constructor.online ? "Конструктор на связи: retkit_read_canvas."
        : code.tab?.mail ? "«Код» на связи: retkit_email_texts / retkit_build_mail."
          : "«Код» открыт без письма: попросите человека открыть письмо или Конструктор (retkit_open_studio даст ссылку).")
      : "Студия у человека не открыта: retkit_open_studio — даст ссылку.";
    sendJson(response, 200, { ok: true, result: { build: BUILD_ID, constructor, code, moengage, next } });
  });

  /**
   * Перезагрузить страницу студии или сбросить её локальные настройки — когда
   * вкладка зависла, устарела после деплоя или запуталась в старом состоянии.
   * Данные писем на сервере это не трогает.
   */
  post("/api/agent/page-control", async (request, response) => {
    try {
      const body = await readRequestBody(request);
      const token = request.retkitActor?.token || "";
      const action = body?.action === "reset" ? "reset" : "reload";
      const discard = body?.discard === true;
      const wanted = body?.page === "code" ? ["workbench"] : body?.page === "constructor" ? ["constructor"] : ["constructor", "workbench"];
      const online = wanted.filter((channel) => relayOnline(token, Date.now(), channel));
      if (!online.length) { sendJson(response, 200, { ok: false, error: "Нужная страница студии не на связи — retkit_studio_status." }); return; }
      const results = {};
      for (const channel of online) {
        const before = relayStatus(token, channel).lastPollAt || 0;
        const started = await callRelay(token, action, { discard }, { channel, timeoutMs: 20_000 });
        if (!started.ok) { results[channel] = { ok: false, error: started.error }; continue; }
        // Старая вкладка ещё успевает опросить сервер перед уходом: ждём
        // дольше этого окна и смотрим опрос уже новой страницы.
        await new Promise((resolve) => setTimeout(resolve, 1500));
        const reloadedAfter = Date.now();
        let back = false;
        const deadline = Date.now() + 25_000;
        while (Date.now() < deadline && !back) {
          await new Promise((resolve) => setTimeout(resolve, 700));
          const status = relayStatus(token, channel);
          back = status.online && status.lastPollAt > Math.max(before, reloadedAfter);
        }
        results[channel === "workbench" ? "code" : channel] = back ? { ok: true, action, ...(started.result || {}) } : { ok: false, error: "Страница перезагружается, но ещё не вышла на связь." };
      }
      const ok = Object.values(results).every((item) => item.ok);
      sendJson(response, 200, ok ? { ok: true, result: results } : { ok: false, error: JSON.stringify(results) });
    } catch (error) {
      sendJson(response, 200, { ok: false, error: error.message });
    }
  });

  /**
   * Агент открывает любое письмо сам — в уже открытой у человека вкладке
   * студии (Конструктор или «Код»): та переходит на нужную страницу. Ссылку
   * человеку даём, только если студия у него не открыта вовсе.
   */
  post("/api/agent/open-mail", async (request, response) => {
    try {
      const body = await readRequestBody(request);
      const token = request.retkitActor?.token || "";
      const page = body?.page === "code" ? "code" : "constructor";
      const brand = String(body?.brand || "").replace(/[^A-Za-z0-9_-]/g, "");
      const mail = String(body?.mail || "").replace(/[^A-Za-z0-9_.-]/g, "");
      if (!brand || !mail) { sendJson(response, 200, { ok: false, error: "Нужны brand и mail (retkit_list_mails)." }); return; }
      const discard = body?.discard === true;
      const pagePath = page === "code" ? "/workbench" : "/constructor";
      const url = `${pagePath}?brand=${encodeURIComponent(brand)}&mail=${encodeURIComponent(mail)}`;
      const target = page === "code" ? "workbench" : "constructor";
      const now = Date.now();
      const via = relayOnline(token, now, target) ? target
        : relayOnline(token, now, target === "workbench" ? "constructor" : "workbench") ? (target === "workbench" ? "constructor" : "workbench") : "";
      if (!via) {
        const origin = String(body?.publicUrl || studioOrigin(request) || "").replace(/\/+$/, "");
        sendJson(response, 200, { ok: true, result: { url: origin + url, opened: false,
          note: "Студия у человека не открыта: дайте ему эту ссылку (открыть вкладку может только он). Дальше всё делаете вы." } });
        return;
      }
      // Конструктор открывает письмо на месте, без перехода страницы.
      if (via === "constructor" && target === "constructor") {
        const reply = await callRelay(token, "open_mail", { brand, mail, discard }, { channel: "constructor", timeoutMs: 90_000 });
        sendJson(response, 200, reply);
        return;
      }
      const before = relayStatus(token, target).lastPollAt || 0;
      const started = await callRelay(token, "goto", { url, discard }, { channel: via, timeoutMs: 45_000 });
      if (!started.ok) { sendJson(response, 200, started); return; }
      const deadline = Date.now() + 25_000;
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 700));
        const status = relayStatus(token, target);
        if (status.online && status.lastPollAt > before && (target !== "workbench" || status.moengage?.mail)) {
          sendJson(response, 200, { ok: true, result: { opened: page === "code" ? "Код" : "Конструктор", brand, mail, tab: status.moengage || null } });
          return;
        }
      }
      sendJson(response, 200, { ok: false, error: "Переход начат, но страница не вышла на связь за 25 секунд — спросите retkit_studio_status." });
    } catch (error) {
      sendJson(response, 200, { ok: false, error: error.message });
    }
  });

  /**
   * Агент просит открыть страницу студии (Конструктор или письмо в «Коде»).
   * Сам открыть вкладку браузер не даст никому, кроме человека. Поэтому:
   * окно связи (если открыто) показывает кнопку «Открыть …» и пробует открыть
   * само, а агент получает прямую ссылку, чтобы дать её человеку.
   */
  post("/api/agent/open-page", async (request, response) => {
    try {
      const body = await readRequestBody(request);
      const token = request.retkitActor?.token || "";
      const page = body?.page === "code" ? "code" : "constructor";
      const origin = String(body?.publicUrl || studioOrigin(request) || "").replace(/\/+$/, "");
      const brand = String(body?.brand || "").replace(/[^A-Za-z0-9_-]/g, "");
      const mail = String(body?.mail || "").replace(/[^A-Za-z0-9_.-]/g, "");
      const url = page === "code"
        ? `${origin}/workbench.html${brand && mail ? `?brand=${encodeURIComponent(brand)}&mail=${encodeURIComponent(mail)}` : ""}`
        : `${origin}/constructor.html`;
      const label = page === "code" ? (mail ? `Открыть ${mail} в «Коде»` : "Открыть «Код»") : "Открыть Конструктор";
      if (relayOnline(token, Date.now(), page === "code" ? "workbench" : "constructor") && !(page === "code" && brand && mail)) {
        sendJson(response, 200, { ok: true, result: { already: true, url, note: "Эта страница уже открыта у человека и на связи." } });
        return;
      }
      // Студия уже открыта у человека, но на другой странице — переход делает
      // сама студия (кнопки «→ В код» / «В конструктор»), это без клика человека.
      const other = page === "code" ? "constructor" : "workbench";
      if (relayOnline(token, Date.now(), other)) {
        sendJson(response, 200, { ok: true, result: { url, label, studioOpen: other,
          note: page === "code"
            ? "Студия открыта в Конструкторе — переведите письмо сами: retkit_open_in_code."
            : "Студия открыта в «Коде» — переведите письмо сами: retkit_open_in_constructor." } });
        return;
      }
      let shown = false;
      if (relayOnline(token, Date.now(), "moengage")) {
        const reply = await callRelay(token, "open_page", { url, label }, { channel: "moengage", timeoutMs: 10_000 });
        shown = Boolean(reply?.ok);
      }
      sendJson(response, 200, { ok: true, result: { url, label, shownInRelayWindow: shown,
        note: shown
          ? "В окне связи у человека появилась кнопка «" + label + "» — ему остался один клик. Дождитесь, пока страница выйдет на связь, и повторите."
          : "Студия у человека не открыта, а открыть вкладку браузера может только он. Дайте ему эту ссылку (тот же браузер, где он вставлял ссылку агента); дальше всё делаете вы." } });
    } catch (error) {
      sendJson(response, 200, { ok: false, error: error.message });
    }
  });

  /** Тексты открытого письма по порядку — вместо 25 КБ вёрстки. */
  post("/api/agent/texts", async (request, response) => {
    try {
      const body = await readRequestBody(request);
      const token = request.retkitActor?.token || "";
      let brand = String(body?.brand || ""); let mail = String(body?.mail || "");
      let html = "";
      if ((!brand || !mail) && relayOnline(token, Date.now(), "workbench")) {
        const got = await callRelay(token, "wb_context", {}, { channel: "workbench", timeoutMs: 15_000 });
        if (got.ok) { brand = brand || got.result.brand; mail = mail || got.result.mail; if (!brand || !mail) html = got.result.html || ""; }
      }
      if (!html && (!brand || !mail)) {
        sendJson(response, 200, { ok: false, error: codeTabMissingError(body?.publicUrl || "") });
        return;
      }
      if (!html) html = await readBuilt(brand, mail, body?.locale);
      sendJson(response, 200, { ok: true, result: { brand, mail, locale: body?.locale || "original", ...extractEmailTexts(html) } });
    } catch (error) {
      sendJson(response, 200, { ok: false, error: `Не удалось прочитать письмо: ${error.message}` });
    }
  });

  post("/api/agent/call", async (request, response) => {
    try {
      const body = await readRequestBody(request);
      const name = String(body?.tool || "").trim();
      const handler = TOOL_HANDLERS[name];
      if (!handler) {
        sendJson(response, 404, {
          ok: false,
          error: `Инструмент "${name}" студии неизвестен.`,
          hint: "Список — GET /api/agent/tools",
        });
        return;
      }
      if (BROWSER_ONLY.has(name)) {
        sendJson(response, 400, {
          ok: false,
          error: `"${name}" работает только в окне студии: он меняет то, что человек собрал на канвасе прямо сейчас, а канвас живёт в браузере и на диске не лежит.`,
        });
        return;
      }

      const given = body?.context && typeof body.context === "object" ? body.context : {};
      // Свой агент по ссылке: письмо и локали, открытые у человека во вкладке
      // «Код», берём оттуда (src/relay.js, канал workbench) — иначе агент не
      // видел локалей и его правки некуда было применить.
      const token = request.retkitActor?.token || "";
      let live = null;
      if (request.retkitActor?.kind === "agent" && relayOnline(token, Date.now(), "workbench")) {
        const got = await callRelay(token, "wb_context", {}, { channel: "workbench", timeoutMs: 15_000 });
        const wanted = (value, open) => !String(value || "").trim() || String(value).trim() === String(open || "").trim();
        if (got.ok && got.result && wanted(given.brand, got.result.brand) && wanted(given.mail, got.result.mail)) live = got.result;
      }
      const brand = String(live?.brand || given.brand || "").trim();
      const mail = String(live?.mail || given.mail || "").trim();
      // Раньше без открытого «Кода» инструменты отвечали пустотой («0
      // namespace») — агент думал, что локалей нет. Теперь говорим как есть.
      if (NEEDS_OPEN_MAIL.has(name) && !live && (!brand || !mail) && request.retkitActor?.kind === "agent") {
        sendJson(response, 200, { ok: false, error: codeTabMissingError(given.publicUrl || "") });
        return;
      }
      const liveNamespaces = Array.isArray(live?.namespaces) ? live.namespaces.map((n) => ({
        ...n,
        name: String(n.namespace || n.name || ""),
        namespace: String(n.namespace || n.name || ""),
      })) : null;

      const ctx = {
        surface: given.surface === "constructor" ? "constructor" : "workbench",
        brand,
        mail,
        repoRoot,
        readOnly: Boolean(isReadOnly()),
        actor: request.retkitActor || null,
        apiKey: apiKey(),
        activeLocale: String(live?.activeLocale || given.locale || "").trim(),
        namespaces: liveNamespaces || (Array.isArray(given.namespaces) ? given.namespaces : []),
        canvasSummary: Array.isArray(given.canvas) ? given.canvas : [],
        pendingLocaleUpdates: [],
        pendingLocaleDeletes: [],
        pendingImages: [],
        html: String(live?.html || given.html || "").trim(),
      };
      if (liveNamespaces) {
        ctx.activeNamespace = liveNamespaces.find((n) => n.name === live.activeNamespaceName) || liveNamespaces[0] || null;
      }

      // Вёрстку письма читаем с диска, если её не прислали: у агента без
      // браузера нет «открытого редактора», но письмо в базе есть.
      if (!ctx.html && brand && mail) {
        try {
          ctx.html = await readFile(
            path.join(repoRoot, "email-base", "dist", brand, mail, "index.html"),
            "utf8",
          );
        } catch { /* письмо не собрано — инструмент скажет об этом сам */ }
      }

      const draftKey = request.retkitActor?.kind === "agent" && live ? token : "";
      const baseHash = draftKey ? hashOf(ctx.html) : "";
      const draft = draftKey ? agentHtmlDrafts.get(draftKey) : null;
      if (draft && draft.base === baseHash) ctx.html = draft.html;
      const result = await handler(body?.args && typeof body.args === "object" ? body.args : {}, ctx);
      if (draftKey && ctx.modifiedHtml) agentHtmlDrafts.set(draftKey, { base: baseHash, html: ctx.modifiedHtml });

      // Правки письма и локалей — предложение человеку во вкладке «Код»: там
      // они показываются с diff и кнопкой «Применить», как у оператора.
      const hasEdits = Boolean(ctx.modifiedHtml) || ctx.pendingLocaleUpdates.length || (ctx.pendingLocaleDeletes || []).length;
      let delivery = null;
      if (hasEdits && request.retkitActor?.kind === "agent") {
        if (live) {
          const shown = await callRelay(token, "wb_apply", {
            auto: true,
            note: String(body?.args?.reason || name),
            modifiedHtml: ctx.modifiedHtml || "",
            localeUpdates: ctx.pendingLocaleUpdates,
            localeDeletes: ctx.pendingLocaleDeletes || [],
          }, { channel: "workbench", timeoutMs: 15_000 });
          delivery = shown.ok
            ? (ctx.modifiedHtml
              ? "Локали применены сразу; правка HTML показана человеку с diff и кнопкой «Применить» (прямая правка HTML отвязала бы локаль от Pug)."
              : "Применено во вкладке «Код» сразу; человек может откатить кнопкой под сообщением агента.")
            : `Правку не удалось показать во вкладке «Код»: ${shown.error}`;
        } else {
          delivery = "Правка НЕ сохранена: письмо не открыто у человека во вкладке «Код». Попросите открыть его там и повторите.";
        }
      }

      sendJson(response, 200, {
        ok: !result?.error,
        tool: name,
        result: delivery ? { ...result, delivery } : result,
        // Картинки инструмент кладёт в очередь: у оператора их показывает цикл
        // агента, а вызывающему по HTTP надо отдать их явно.
        images: (ctx.pendingImages || []).map((shot) => ({ note: shot.note, dataUrl: shot.dataUrl })),
        ...(ctx.pendingLocaleUpdates.length ? { localeUpdates: ctx.pendingLocaleUpdates } : {}),
        ...(ctx.modifiedHtml ? { modifiedHtml: ctx.modifiedHtml } : {}),
      });
    } catch (error) {
      sendJson(response, 400, { ok: false, error: String(error?.message || error) });
    }
  });

  return router;
}
