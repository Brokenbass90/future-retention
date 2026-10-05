#!/usr/bin/env node
/**
 * test-figma-plugin-path.mjs — путь без токена: плагин Figma → студия.
 *
 * Почему этот путь главный, а не запасной. Персональный токен Figma нельзя
 * ограничить одним файлом: он открывает ВСЁ, что видит его владелец. Для
 * рабочего аккаунта компании это значит «выдать студии всю базу макетов», и
 * правильный ответ здесь — не выдавать токен вообще. Плагин делает ту же
 * работу иначе: он живёт внутри Figma под собственным доступом человека и шлёт
 * разобранный фрейм на его же машину.
 *
 * Чего не хватало. Плагин слал макет на `/api/figma/import`, сервер отвечал
 * ПЛАГИНУ — и всё. Человек нажимал «Отправить в студию», переключался в
 * студию и не видел там ничего. Путь формально работал и практически был
 * бесполезен.
 *
 * Что стережём:
 *   1. Посылка плагина разбирается ТЕМ ЖЕ разбором, что и Ctrl+V. Два разных
 *      разбора разъедутся молча, и человек получит разный результат в
 *      зависимости от того, каким путём приехал макет.
 *   2. Ящик отдаёт новое ровно один раз: показать один макет дважды — соврать
 *      про «приехало».
 *   3. Пустая посылка (одна ссылка, один снимок) ящик не портит.
 *   4. Студия умеет объяснить установку плагина сама, а не «смотри README».
 *   5. Подсказки не зовут за токеном там, где токен — неверный путь.
 *
 * Zero-AI, без сети, без Figma. Exit 0 = pass.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import url from "node:url";
import {
  receiveFigmaPluginImport, peekFigmaInbox, resetFigmaInbox, figmaInboxRevision,
} from "../src/figma-inbox.js";
import { planFromFigmaImport } from "../src/figma-intake.js";
import { createRouter } from "../src/router.js";
import { registerFigmaRoutes } from "../src/routes/figma-routes.js";

const repoRoot = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const check = (name, cond, extra = "") => {
  if (cond) { pass++; console.log("  \x1b[32m✓\x1b[0m", name); }
  else { fail++; console.error(`  \x1b[31m✗ ${name}\x1b[0m ${extra}`); }
};
const read = (...parts) => readFileSync(path.join(repoRoot, ...parts), "utf8");

/** Посылка ровно той формы, которую отдаёт figma-plugin/code.js. */
const pluginPayload = () => ({
  source: "figma-plugin",
  fileKey: "ABC123",
  nodeId: "10:42",
  selectionName: "Welcome email",
  pageName: "Ready for dev",
  frameSize: { width: 600, height: 900 },
  previewImage: { url: "https://figma.example/preview.png" },
  sections: [
    { id: "s1", role: "header", name: "Header", x: 0, y: 0, width: 600, height: 120, style: { bgColor: "#101828" } },
    { id: "s2", role: "hero", name: "Hero", x: 0, y: 120, width: 600, height: 420, style: { bgColor: "#ffffff" } },
    { id: "s3", role: "footer", name: "Footer", x: 0, y: 700, width: 600, height: 200, style: { bgColor: "#f2f4f7" } },
  ],
  texts: [
    { id: "t1", roleHint: "heading", text: "Добро пожаловать", x: 40, y: 200, width: 520, height: 48, fontSize: 32, fontFamily: "Inter" },
    { id: "t2", roleHint: "body", text: "Коротко о том, что дальше", x: 40, y: 270, width: 520, height: 60, fontSize: 16, fontFamily: "Inter" },
    { id: "t3", roleHint: "cta", text: "Начать", x: 40, y: 400, width: 200, height: 48, fontSize: 16, fontFamily: "Inter" },
  ],
  images: [
    { id: "i1", roleHint: "logo", name: "logo", x: 40, y: 30, width: 120, height: 40, sectionId: "s1", alt: "logo" },
  ],
});

/* ─── 1. Тот же разбор, что и у вставки ──────────────────────────────────── */
{
  resetFigmaInbox();
  const payload = pluginPayload();
  const taken = receiveFigmaPluginImport(payload);
  check("посылка принята", taken.ok === true && taken.revision === 1, JSON.stringify(taken));

  const { design } = peekFigmaInbox(0);
  const direct = planFromFigmaImport(payload);
  // Один разбор на оба пути: иначе результат зависит от того, каким путём
  // приехал макет, а человеку это различие не объяснить.
  check("разбор совпадает с путём через Ctrl+V",
    JSON.stringify(design.plan) === JSON.stringify(direct),
    "плагин и вставка дают разные планы");
  check("секции разобраны", design.plan.sections.length === 3);
  check("тексты легли в свои секции",
    design.plan.sections[1].texts.some((text) => /Добро пожаловать/.test(text.text)),
    JSON.stringify(design.plan.sections.map((s) => s.texts.length)));
  check("человеку есть что прочитать", typeof design.summary === "string" && design.summary.length > 10);
  check("фрейм назван", design.selection.name === "Welcome email");
  check("источник записан", design.source === "figma-plugin");
}

/* ─── 2. Ящик отдаёт новое ровно один раз ────────────────────────────────── */
{
  resetFigmaInbox();
  check("пустой ящик молчит", peekFigmaInbox(0).fresh === false && peekFigmaInbox(0).design === null);

  receiveFigmaPluginImport(pluginPayload());
  const first = peekFigmaInbox(0);
  check("новое видно", first.fresh === true && first.revision === 1);
  check("увиденное второй раз не показывается", peekFigmaInbox(first.revision).fresh === false);

  receiveFigmaPluginImport(pluginPayload());
  check("следующая посылка снова новая", peekFigmaInbox(first.revision).fresh === true);
  check("номер растёт", figmaInboxRevision() === 2);
}

/* ─── 3. Посылка без макета ящик не портит ───────────────────────────────── */
{
  resetFigmaInbox();
  receiveFigmaPluginImport(pluginPayload());
  const before = peekFigmaInbox(0).design;

  // Плагин мог прислать одну ссылку или один снимок — это не поломка.
  const empty = receiveFigmaPluginImport({ source: "figma-plugin", sections: [] });
  check("пустая посылка отклонена честно", empty.ok === false && /нет секций/.test(empty.reason));
  check("и прежний макет на месте",
    JSON.stringify(peekFigmaInbox(0).design) === JSON.stringify(before));
  check("номер не сдвинулся", figmaInboxRevision() === 1);

  const broken = receiveFigmaPluginImport({ sections: "не массив" });
  check("мусор не роняет приём", broken.ok === false);
}

/* ─── 4. Студия объясняет установку сама ─────────────────────────────────── */
{
  const router = createRouter({ name: "test" });
  const answers = [];
  registerFigmaRoutes(router, {
    sendJson: (_response, status, body) => answers.push({ status, body }),
    readRequestBody: async () => ({}),
    apiToken: () => "",
    figma: {},
    repoRoot,
    importSecret: () => "",
  });
  const ids = router.list().map((entry) => entry.id);
  check("ручка ящика есть", ids.includes("GET /api/figma/inbox"), ids.join(", "));
  check("ручка про плагин есть", ids.includes("GET /api/figma/plugin"));

  router.dispatch({ method: "GET", url: "/api/figma/plugin" }, {});
  const help = answers.pop().body;
  check("сказано, где лежит манифест", /figma-plugin[\\/]manifest\.json$/.test(help.manifestPath), help.manifestPath);
  check("шаги установки перечислены", Array.isArray(help.steps) && help.steps.length >= 4);
  check("сказано прямо: токен не нужен", help.tokenNeeded === false && /Токен .* не нужен/.test(help.note));
  check("и почему — тоже", /под вашим доступом/.test(help.note));

  resetFigmaInbox();
  receiveFigmaPluginImport(pluginPayload());
  router.dispatch({ method: "GET", url: "/api/figma/inbox?since=0" }, {});
  const inbox = answers.pop().body;
  check("ящик отдаётся наружу", inbox.fresh === true && inbox.design.plan.sections.length === 3);
  router.dispatch({ method: "GET", url: `/api/figma/inbox?since=${inbox.revision}` }, {});
  check("и не повторяется", answers.pop().body.fresh === false);
}

/* ─── 4б. Чужой макет: только просмотр → копия → удалить ─────────────────── */
{
  // Так это и выглядит на практике: присылают ССЫЛКУ на чужой файл, и почти
  // всегда «только просмотр». Плагины в таком файле Figma не запускает вовсе,
  // поэтому человек делает Duplicate, работает в копии — и копия чужого
  // макета остаётся у него в Drafts навсегда, если о ней не напомнить.
  resetFigmaInbox();
  receiveFigmaPluginImport({ ...pluginPayload(), fileName: "Welcome email (Copy)" });
  const copy = peekFigmaInbox(0).design;
  check("файл, из которого взят макет, записан", copy.selection.file === "Welcome email (Copy)");
  check("копия опознана", copy.looksLikeCopy === true);

  resetFigmaInbox();
  receiveFigmaPluginImport({ ...pluginPayload(), fileName: "Копия Welcome email" });
  check("русское имя копии тоже", peekFigmaInbox(0).design.looksLikeCopy === true);

  resetFigmaInbox();
  receiveFigmaPluginImport({ ...pluginPayload(), fileName: "Кампании 2026" });
  check("свой файл копией не считается", peekFigmaInbox(0).design.looksLikeCopy === false);

  const plugin = read("figma-plugin", "code.js");
  check("плагин шлёт имя файла, а не только фрейма", /fileName: \(figma\.root/.test(plugin));

  const panel = read("public", "figma-paste.js");
  check("студия напоминает удалить копию", /удалите её в Figma/.test(panel));
  check("и показывает, из какого файла макет", /data\.selection\.file/.test(panel));

  const routes = read("src", "routes", "figma-routes.js");
  check("случай «только просмотр» описан в шагах", /viewOnly/.test(routes));
  check("сказано, что плагины там не запускаются",
    /Плагины в файле без права правки Figma не запускает/.test(routes));
  check("и сказано удалить копию", /Копию удалить, когда макет разобран/.test(routes));
}

/* ─── 5. Посылка плагина доезжает до ящика из сервера ────────────────────── */
{
  const server = read("server.js");
  // Ответ уходил плагину, и на этом путь заканчивался. Без этой строчки
  // всё остальное бессмысленно: студия о посылке просто не узнает.
  check("сервер кладёт посылку в ящик", /receiveFigmaPluginImport\(pluginImport/.test(server));
  check("и говорит плагину, дошло ли", /studioInbox: inbox/.test(server));
  check("ящик подключён к серверу", /from "\.\/src\/figma-inbox\.js"/.test(server));
}

/* ─── 6. Подсказки не зовут за токеном ───────────────────────────────────── */
{
  const panel = read("public", "figma-paste.js");
  check("окно ждёт макет из плагина, пока открыто", /function watchInbox/.test(panel));
  check("и перестаёт ждать при закрытии", /stopInbox\(\);/.test(panel));
  check("установка плагина открывается из окна", /function showPluginSteps/.test(panel));
  check("видно, что студия ждёт", /Жду макет из плагина/.test(panel));
  check("видно, что макет приехал плагином", /приехал из плагина Figma/.test(panel));
  check("про рабочую Figma сказано в самом окне", /Рабочая Figma компании/.test(panel));

  const workspace = read("public", "app.js");
  // Студия говорила «токен хранится локально, никуда не отправляется» — и
  // умалчивала главное: он открывает все файлы, которые видит владелец.
  check("про токен сказано честно", /открывает \*\*все файлы Figma, которые видишь ты\*\*/.test(workspace));
  check("плагин назван первым", workspace.indexOf("Плагин — путь для рабочей Figma")
    < workspace.indexOf("Токен — только для личного аккаунта"));
}

console.log(`\nfigma-plugin-path: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
