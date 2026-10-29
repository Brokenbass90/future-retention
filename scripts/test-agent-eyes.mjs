#!/usr/bin/env node
/**
 * test-agent-eyes.mjs — агент должен видеть, а не догадываться.
 *
 * До этого агент через MCP работал вслепую: собирал письмо и получал обратно
 * размер в байтах и список предупреждений. О том, что заголовок налез на
 * картинку, кнопка уехала за край, а на телефоне текст обрезан, так узнать
 * нельзя — и «выглядит хорошо» он говорил, ничего не видя. Обсуждать дизайн
 * с таким собеседником бессмысленно.
 *
 * Здесь стережём три вещи:
 *   1) снимок меряет высоту по содержимому, а не по окну (иначе письмо на
 *      150 пикселей приезжает с восемью сотнями пустоты и на нём не видно
 *      ничего);
 *   2) отсутствие браузера — это внятный совет человеку, а не «500»;
 *   3) вёрстка не ходит через модель: письмо весит десятки килобайт, модели
 *      нужен снимок, а не исходник, и путь «студия → студия» это правило
 *      закрепляет.
 *
 * Zero-AI, без сети и без браузера. Exit 0 = pass.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import url from "node:url";
import { SHOT_VIEWS, ShotUnavailableError, renderHtmlShot } from "../src/shot.js";
import { createRouter } from "../src/router.js";
import { registerShotRoutes } from "../src/routes/shot-routes.js";

const repoRoot = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const check = (name, cond, extra = "") => {
  if (cond) { pass++; console.log("  \x1b[32m✓\x1b[0m", name); }
  else { fail++; console.error(`  \x1b[31m✗ ${name}\x1b[0m ${extra}`); }
};
const read = (...parts) => readFileSync(path.join(repoRoot, ...parts), "utf8");

/* ─── 1. Два вида съёмки, и десктоп шире письма ──────────────────────────── */
{
  check("есть десктоп и телефон", Boolean(SHOT_VIEWS.desktop && SHOT_VIEWS.mobile));
  // Письмо 600px. Снимать его в окне 600 нельзя: мобильные медиазапросы
  // семьи написаны как max-width:640 — десктопный снимок вышел бы мобильным.
  check("десктоп снимается в окне шире письма", SHOT_VIEWS.desktop.width > 640,
    String(SHOT_VIEWS.desktop.width));
  check("телефон — узкое окно", SHOT_VIEWS.mobile.width <= 400, String(SHOT_VIEWS.mobile.width));
}

/* ─── 2. Пустой запрос не доходит до браузера ────────────────────────────── */
{
  let message = "";
  try { await renderHtmlShot({ html: "   " }); } catch (error) { message = error.message; }
  check("пустой html отвергается сразу", /Нечего снимать/.test(message), message);
  check("и это не ошибка про браузер", !/браузер/i.test(message), message);
}

/* ─── 3. Нет браузера — понятный совет ───────────────────────────────────── */
{
  const source = read("src", "shot.js");
  check("отсутствие браузера — отдельный вид ошибки", /class ShotUnavailableError/.test(source));
  check("у неё есть код для вызывающего", /this\.code = "NO_BROWSER"/.test(source));
  check("ошибка говорит, что сделать", /playwright-core install --only-shell chromium/.test(source));
  check("системный браузер ищется как запасной", /Google Chrome\.app/.test(source));

  const error = new ShotUnavailableError("тест");
  check("вид ошибки узнаётся снаружи", error instanceof Error && error.code === "NO_BROWSER");
}

/* ─── 4. Высота по содержимому, а не по окну ─────────────────────────────── */
{
  const source = read("src", "shot.js");
  check("высота меряется по нижнему краю содержимого",
    /getBoundingClientRect\(\)\.bottom/.test(source));
  check("и не по scrollHeight", !/document\.body\.scrollHeight/.test(source),
    "для страницы короче окна scrollHeight отдаёт высоту окна");
  check("снимок ограничен сверху", /maxHeight/.test(source));

  // Внешние картинки не грузим: письмо ссылается на боевой CDN, и снимок
  // начал бы зависеть от сети и чужого сервера.
  check("внешние картинки подменяются заглушкой", /route\.fulfill\(\{ contentType: "image\/png"/.test(source));
  check("остальное снаружи режется", /route\.abort\(\)/.test(source));
}

/* ─── 5. Ручка снимка на месте и отвечает картинкой ──────────────────────── */
{
  const router = createRouter({ name: "test" });
  registerShotRoutes(router, { sendJson: () => {}, readRequestBody: async () => ({}) });
  check("ручка зарегистрирована", router.list().some((entry) => entry.id === "POST /api/render-shot"),
    JSON.stringify(router.list()));

  const routes = read("src", "routes", "shot-routes.js");
  check("ответ — картинка, а не json", /"Content-Type": "image\/png"/.test(routes));
  check("снимок не кладётся на диск", !/writeFile/.test(routes),
    "это разговор, а не артефакт");
  check("нет браузера — отдельный ответ, а не 500", /501 : 400/.test(routes));

  // Ручка берёт html телом, а не именем письма: агент уже собрал письмо и
  // держит его у себя, лезть отсюда в базу значило бы снимать не то.
  check("снимается присланная вёрстка", /body\?\.html/.test(routes));
}

/* ─── 6. Инструменты агента ──────────────────────────────────────────────── */
{
  const mcp = read("mcp", "retkit-mcp-server.mjs");
  check("есть retkit_block_preview", /"retkit_block_preview"/.test(mcp));
  check("есть retkit_render_mail", /"retkit_render_mail"/.test(mcp));
  // Считать точное число нельзя: с тех пор к этим двум добавился мост к
  // полному набору студии, и он тоже отдаёт картинки.
  check("инструменты возвращают картинку, а не описание",
    (mcp.match(/type: "image"/g) || []).length >= 2,
    String((mcp.match(/type: "image"/g) || []).length));

  // Главное: вёрстка идёт со студии на студию, а не через модель. Иначе
  // каждый снимок стоил бы десятков килобайт контекста — и агент перестал
  // бы снимать.
  check("html не гоняется через модель", /body: \{ html, view \}/.test(mcp));
  check("картинка тянется отдельной функцией, не текстовой",
    /async function studioImage\(/.test(mcp));
  check("иначе PNG приехал бы битым", /пропущенный через строку/.test(mcp));

  // Пустое превью — повод посмотреть иначе, а не повод выдумать вид блока.
  check("без превью агенту прямо запрещено выдумывать вид",
    /Не описывайте вид блока по имени и слотам/.test(mcp));
  check("и предложен обходной путь",
    /собрав письмо: retkit_compose_preview/.test(mcp) && /retkit_render_mail/.test(mcp));

  check("в карточке блока есть признак картинки", /has_preview/.test(mcp));
  check("но не сама картинка", /has_preview: block\?\.preview\?\.status === "ok"/.test(mcp),
    "полсотни картинок в одном списке не прочитает ни одна модель — отдаём признак");

  // Инструкция при подключении — единственное, что модель читает гарантированно.
  check("инструкция требует смотреть перед оценкой",
    /Про внешний вид не рассуждайте вслепую/.test(mcp));
  check("и отдельно напоминает про телефон", /view: mobile/.test(mcp));
}

console.log(`\nagent-eyes: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
