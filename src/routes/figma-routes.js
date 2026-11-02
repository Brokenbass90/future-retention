/**
 * src/routes/figma-routes.js — работа с макетом в Figma.
 *
 * Три ручки, которыми студия ходит в Figma сама: посмотреть узел по ссылке,
 * перечислить страницы и фреймы файла, выгрузить картинки в библиотеку
 * студии. Все три бесполезны без токена Figma, и это первое, что они
 * проверяют: без токена честный отказ с объяснением, а не пустой ответ,
 * который выглядит как «в макете ничего нет».
 *
 * Чего здесь НЕТ: `POST /api/figma/import` — приём макета из плагина. Он
 * остался в лестнице сознательно: это не обёртка над одной функцией, а сто
 * строк, завязанных на десяток внутренних помощников server.js. Такой
 * переезд — это не перенос ручки, а вынос логики приёма в отдельный модуль,
 * и делать его заодно, между делом, значит сломать единственный путь, по
 * которому макеты вообще попадают в студию.
 */

/**
 * @param {object} deps
 * @param {Function} deps.sendJson
 * @param {Function} deps.readRequestBody
 * @param {() => string} deps.apiToken — токен Figma; пусто значит «не настроен»
 * @param {object} deps.figma — parseUrl, inspect, browse, exportImages, saveImage
 */
import { readFigmaClipboard, figmaUrlFor } from "../figma-clipboard.js";
import { planFromFigmaImport, describePlan } from "../figma-intake.js";
import { matchSectionsToBlocks, describeMatches } from "../design-to-blocks.js";
import { peekFigmaInbox } from "../figma-inbox.js";
import path from "node:path";

export function registerFigmaRoutes(router, deps) {
  const {
    sendJson, readRequestBody, apiToken, figma, catalog = () => [],
    repoRoot = process.cwd(), importSecret = () => "",
  } = deps;
  const text = (value) => String(value ?? "").trim();
  const pluginManifestPath = () => path.join(repoRoot, "figma-plugin", "manifest.json");

  /** Без токена ни одна из этих ручек работать не может. */
  const needsToken = (response, extra = null) => {
    if (apiToken()) return false;
    sendJson(response, 400, {
      error: "FIGMA_API_TOKEN is not configured. Add it to your .env file to enable Figma inspection.",
      ...(extra ? { parsed: extra } : {}),
    });
    return true;
  };

  /**
   * Вставка макета из буфера — вход без плагина и без ручного копания в API.
   *
   * Человек жмёт ⌘C в Figma (или ⌘L на выделении) и Ctrl+V в студии. Мы
   * разбираем буфер настолько, насколько это надёжно: закрытый двоичный
   * формат не трогаем, ключ файла и ссылку читаем. Дальше макет забирается
   * через открытый API Figma — тот же путь, что и у плагина.
   */
  router.post("/api/figma/paste", async (request, response) => {
    try {
      const body = await readRequestBody(request);
      const clip = readFigmaClipboard({ html: body?.html, text: body?.text });

      if (clip.kind === "text" || clip.kind === "empty") {
        sendJson(response, 200, { ok: true, ...clip, plan: null });
        return;
      }
      if (!apiToken()) {
        sendJson(response, 200, {
          ok: true,
          ...clip,
          plan: null,
          // Без токена макет по API не забрать — но токен здесь не
          // единственный и не лучший путь. Для рабочей Figma компании он
          // вообще неверный: персональный токен нельзя ограничить одним
          // файлом, он открывает всё, что видит владелец. Поэтому первым
          // называем плагин, а токен — как вариант для личного аккаунта.
          tokenMissing: true,
          note: `${clip.note} Чтобы студия забрала макет целиком, поставьте плагин Figma `
            + `(он работает под вашим доступом и токена не требует). Токен в .env — `
            + `вариант для личного аккаунта: персональный токен открывает все ваши файлы.`,
        });
        return;
      }

      const url = clip.url || figmaUrlFor(clip);
      let imported;
      try {
        imported = await figma.importFromUrl(url, apiToken());
      } catch (error) {
        // Буфер мы разобрали, а вот сходить в Figma не вышло. Это разные
        // беды, и валить их в одну ошибку нельзя: человеку важно знать, что
        // макет опознан и чинить надо доступ, а не вставку.
        //
        // Истёкший токен — самая частая из них, и «403 Token expired» об этом
        // не говорит ничего: человек идёт проверять доступ к файлу, хотя
        // файл ни при чём. Разбираем по тексту ответа Figma.
        const message = String(error?.message || error);
        const expired = /token[\s_]?expired|invalid[\s_]?token|\b401\b/i.test(message);
        const forbidden = !expired && /\b403\b|not[\s_]?allowed|permission/i.test(message);
        sendJson(response, 200, {
          ok: true,
          ...clip,
          plan: null,
          tokenProblem: expired || forbidden,
          note: expired
            ? "Макет опознан, но токен Figma истёк. Вставку чинить не нужно — она сработала. " +
              "Если Figma рабочая, токен заводить заново не стоит: поставьте плагин — он " +
              "работает внутри Figma под вашим доступом и шлёт макет на эту же машину."
            : forbidden
              ? "Макет опознан, но у токена нет доступа к этому файлу. Для файлов компании " +
                "надёжнее плагин: он работает под вашим собственным доступом, и выпускать " +
                "токен на всю базу макетов не нужно."
              : `${clip.note} Но забрать макет не вышло: ${message}.`,
        });
        return;
      }
      const plan = planFromFigmaImport(imported);
      // Разобрать макет мало: человеку и агенту нужен следующий шаг — какими
      // блоками это собирать. Подбор структурный, по подписям превью: имена
      // блоков внешность не описывают.
      const match = matchSectionsToBlocks({ plan, blocks: catalog() });
      sendJson(response, 200, {
        ok: true,
        match,
        matchSummary: describeMatches(match),
        ...clip,
        selection: {
          name: imported?.selectionName || "",
          page: imported?.pageName || "",
          preview: imported?.previewImage?.url || "",
        },
        plan,
        summary: describePlan(plan),
      });
    } catch (error) {
      sendJson(response, 400, { ok: false, error: error.message });
    }
  });

  /**
   * Что лежит в почтовом ящике: макет, присланный плагином Figma.
   *
   * Окно вставки спрашивает это, пока открыто. Нового нет — ответ пустой и
   * дешёвый; появилось — отдаём тот же разбор, что и при Ctrl+V, чтобы
   * человеку было безразлично, каким путём макет приехал.
   */
  router.get("/api/figma/inbox", (request, response) => {
    const since = Number(new URL(request.url, "http://studio").searchParams.get("since")) || 0;
    sendJson(response, 200, { ok: true, ...peekFigmaInbox(since) });
  });

  /**
   * Как поставить плагин.
   *
   * Это не справка ради справки. Для корпоративной Figma персональный токен —
   * неверный путь: его нельзя ограничить одним файлом, он открывает всё, что
   * видит владелец. Плагин работает внутри Figma под доступом самого человека
   * и шлёт фрейм на его же машину. Значит, студия обязана уметь объяснить, где
   * лежит манифест, а не отправлять человека читать README в репозитории.
   */
  router.get("/api/figma/plugin", (_request, response) => {
    sendJson(response, 200, {
      ok: true,
      manifestPath: pluginManifestPath(),
      endpoint: "/api/figma/import",
      secretRequired: Boolean(importSecret()),
      tokenNeeded: false,
      steps: [
        "В Figma (desktop): Plugins → Development → Import plugin from manifest…",
        `Выбрать файл: ${pluginManifestPath()}`,
        "Выделить один фрейм письма и запустить: Plugins → Development → RetKit — Send frame to Studio",
        "Нажать «Отправить в студию» — макет появится здесь сам",
      ],
      // Самый частый случай на практике — не свой файл, а чужой по ссылке, и
      // почти всегда «только просмотр». Плагины в таком файле Figma не
      // запускает вообще, и человек упрётся в это на третьем шаге, если не
      // сказать заранее.
      viewOnly: {
        title: "Если ссылка на файл «только просмотр» (обычный случай для чужого макета)",
        steps: [
          "Плагины в файле без права правки Figma не запускает — сначала нужна своя копия",
          "В Figma: File → Save as copy (или правый клик по файлу → Duplicate) — копия ляжет в ваши Drafts",
          "В копии выделить фрейм и запустить плагин — дальше всё как обычно",
          "Копию удалить, когда макет разобран: чужой макет незачем хранить у себя",
        ],
      },
      note: "Токен Figma для этого пути не нужен: плагин работает внутри Figma под вашим доступом "
        + "и шлёт макет на эту же машину. Наружу ничего не уходит.",
    });
  });

  router.post("/api/figma/inspect", async (request, response) => {
    const body = await readRequestBody(request);
    const figmaUrl = text(body?.url);
    if (!figmaUrl) { sendJson(response, 400, { error: "url is required" }); return; }
    // Разбор ссылки показываем даже без токена: человеку видно, что студия
    // ссылку поняла и дело только в токене.
    if (needsToken(response, figma.parseUrl(figmaUrl))) return;
    try {
      sendJson(response, 200, { ok: true, ...await figma.inspect(figmaUrl, apiToken()) });
    } catch (error) {
      sendJson(response, 400, { error: error.message });
    }
  });

  router.post("/api/figma/browse", async (request, response) => {
    const body = await readRequestBody(request);
    if (needsToken(response)) return;
    let fileKey = text(body?.fileKey);
    if (!fileKey && body?.url) {
      const parsed = figma.parseUrl(text(body.url));
      if (!parsed) { sendJson(response, 400, { error: "Could not parse Figma URL" }); return; }
      fileKey = parsed.fileKey;
    }
    if (!fileKey) { sendJson(response, 400, { error: "fileKey or url required" }); return; }
    try {
      sendJson(response, 200, await figma.browse(fileKey, apiToken()));
    } catch (error) {
      sendJson(response, 400, { error: error.message });
    }
  });

  router.post("/api/figma/export-images", async (request, response) => {
    const body = await readRequestBody(request);
    if (needsToken(response)) return;
    const fileKey = text(body?.fileKey);
    const nodeIds = Array.isArray(body?.nodeIds) ? body.nodeIds.map(String) : [];
    const format = ["png", "jpg", "svg", "pdf"].includes(body?.format) ? body.format : "png";
    const scale = [1, 2, 3].includes(Number(body?.scale)) ? Number(body.scale) : 2;
    const save = body?.save !== false;
    if (!fileKey || !nodeIds.length) {
      sendJson(response, 400, { error: "fileKey and nodeIds[] required" });
      return;
    }
    try {
      const urlMap = await figma.exportImages(fileKey, nodeIds, apiToken(), { format, scale });
      const images = [];
      for (const [nodeId, figmaUrl] of Object.entries(urlMap)) {
        if (!figmaUrl) {
          images.push({ nodeId, url: null, error: "Figma returned no URL for this node" });
          continue;
        }
        if (!save) { images.push({ nodeId, url: figmaUrl }); continue; }
        // Одна неудачная картинка не должна ронять весь экспорт: остальные
        // уже скачаны, и терять их из-за соседа незачем.
        try {
          images.push({ nodeId, url: figmaUrl, ...await figma.saveImage(figmaUrl, nodeId, format) });
        } catch (error) {
          images.push({ nodeId, url: figmaUrl, error: error.message });
        }
      }
      sendJson(response, 200, { images });
    } catch (error) {
      sendJson(response, 400, { error: error.message });
    }
  });

  return router;
}
