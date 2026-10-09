#!/usr/bin/env node
/**
 * test-figma-paste.mjs — макет из Figma через Ctrl+V.
 *
 * Про формат буфера важно понимать одно: он закрытый. Когда в Figma жмут ⌘C,
 * в буфер уходит HTML с двумя полями — `figmeta` (обычный JSON в base64) и
 * `data-buffer` (весь макет в приватном двоичном формате kiwi+zstd).
 *
 * Разбирать двоичный буфер мы НЕ беремся, и здесь это зафиксировано как
 * решение. Формат недокументированный и уже менялся — сцена переехала с
 * deflate на zstd и сломала все сторонние парсеры разом. Ломается такой
 * разбор молча: вставка «срабатывает» и отдаёт мусор, а человек узнаёт об
 * этом из кривого письма. Ключ файла из `figmeta` — это base64 от JSON,
 * ломаться там нечему; дальше студия идёт в Figma по её открытому API.
 *
 * Второе, что здесь стережём, — разбор макета на части. Решение «картинка
 * фоном или в контенте» детерминированное, а не на усмотрение модели: в
 * письме это две разные вёрстки, и половина почтовиков фоновые картинки не
 * показывает. Перепутать — значит отправить письмо, которое в Outlook
 * выглядит пустым прямоугольником.
 *
 * Zero-AI, без сети. Exit 0 = pass.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import url from "node:url";
import { readFigmaClipboard, figmaUrlFor } from "../src/figma-clipboard.js";
import { planFromFigmaImport, describePlan } from "../src/figma-intake.js";
import { createRouter } from "../src/router.js";
import { registerFigmaRoutes } from "../src/routes/figma-routes.js";

const repoRoot = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const check = (name, cond, extra = "") => {
  if (cond) { pass++; console.log("  \x1b[32m✓\x1b[0m", name); }
  else { fail++; console.error(`  \x1b[31m✗ ${name}\x1b[0m ${extra}`); }
};
const read = (...parts) => readFileSync(path.join(repoRoot, ...parts), "utf8");

const figmeta = (payload) => Buffer.from(JSON.stringify(payload)).toString("base64");
const sceneHtml = (payload, buffer = "AAAABBBB") =>
  `<meta charset="utf-8"><span data-metadata="<!--(figmeta)${figmeta(payload)}(/figmeta)-->"></span>` +
  `<span data-buffer="<!--(figma)${buffer}(/figma)-->"></span>`;

/* ─── 1. Что приехало из буфера ──────────────────────────────────────────── */
{
  const scene = readFigmaClipboard({
    html: sceneHtml({ fileKey: "4XvKUK38NtRPZASgUJiZ87", pasteID: 1261442360, dataType: "scene" }),
  });
  check("макет опознан", scene.kind === "scene", JSON.stringify(scene));
  check("ключ файла прочитан", scene.fileKey === "4XvKUK38NtRPZASgUJiZ87");
  check("размер закрытого буфера назван", scene.bufferBytes > 0);
  check("честно сказано, что фрейм неизвестен", /какой именно фрейм/.test(scene.note), scene.note);

  const link = readFigmaClipboard({ text: "https://www.figma.com/design/ABC123/Mail?node-id=145-982" });
  check("ссылка на выделение опознана", link.kind === "link" && link.nodeId === "145:982", JSON.stringify(link));
  check("ссылка названа самым точным случаем", /самый точный/.test(link.note));

  // Если в буфере и макет, и ссылка — ссылка важнее: в ней есть конкретный узел.
  const both = readFigmaClipboard({
    html: sceneHtml({ fileKey: "ZZZ" }),
    text: "https://www.figma.com/design/ABC123/M?node-id=1-2",
  });
  check("ссылка перевешивает макет", both.kind === "link" && both.nodeId === "1:2", JSON.stringify(both));

  check("обычный текст — это текст", readFigmaClipboard({ text: "Просто текст" }).kind === "text");
  check("пустой буфер — пусто", readFigmaClipboard({}).kind === "empty");
  check("мусор в html не выдаётся за макет",
    readFigmaClipboard({ html: "<p>обычная копия со страницы</p>" }).kind === "empty");

  check("адрес собирается из ключа и узла",
    figmaUrlFor({ fileKey: "ABC", nodeId: "145:982" }).includes("node-id=145-982"));
  check("без ключа адреса нет", figmaUrlFor({}) === "");
}

/* ─── 2. Двоичный буфер не разбираем — и это записано ────────────────────── */
{
  const source = read("src", "figma-clipboard.js");
  check("решение не разбирать буфер объяснено", /осознанное решение, а не лень/.test(source));
  check("названа причина: формат уже менялся", /deflate на\s*\n?\s*\*?\s*zstd/.test(source.replace(/\s+/g, " ")));
  check("и главное — ломается молча", /ломается такой разбор молча/.test(source));
}

/* ─── 3. Разбор макета на части ──────────────────────────────────────────── */
const imported = {
  frameSize: { width: 600, height: 900 },
  styles: { bgColor: "#F4F6F8", textColor: "#22303C", headingColor: "#0F2B46", primaryColor: "#FF7A00" },
  sections: [
    { name: "CTA", y: 700, x: 24, width: 552, height: 120, columnCount: 1, style: { bgColor: "#FF7A00" } },
    { name: "Hero", y: 0, x: 0, width: 600, height: 320, columnCount: 1, style: {} },
    { name: "Текст", y: 340, x: 24, width: 552, height: 300, columnCount: 2, style: {} },
  ],
  texts: [
    { x: 40, y: 120, text: "This $50 Mistake", fontSize: 28, color: "#FFFFFF" },
    { x: 40, y: 380, text: "We asked our pro trader", fontSize: 15, color: "#22303C" },
  ],
  images: [
    { x: 0, y: 0, width: 600, height: 320, name: "hero-bg" },
    { x: 40, y: 420, width: 200, height: 140, name: "chart" },
  ],
};
{
  const plan = planFromFigmaImport(imported);

  // В Figma слои лежат в любом порядке. Взять их «как есть» — собрать письмо
  // задом наперёд: CTA окажется первым.
  check("секции идут сверху вниз", plan.sections.map((s) => s.name).join(",") === "Hero,Текст,CTA",
    plan.sections.map((s) => s.name).join(","));

  const hero = plan.sections[0];
  const body = plan.sections[1];
  check("картинка под текстом — это фон",
    hero.images[0].role === "background", JSON.stringify(hero.images));
  check("и об этом предупреждают",
    plan.warnings.some((w) => /фон не покажет/.test(w)), JSON.stringify(plan.warnings));
  check("картинка рядом с текстом — контент",
    body.images[0].role === "content", JSON.stringify(body.images));

  check("отступ слева посчитан", body.padding.left === 24, String(body.padding.left));
  check("отступ справа посчитан", body.padding.right === 24, String(body.padding.right));
  check("отступ сверху — от предыдущей секции", body.padding.top === 20, String(body.padding.top));
  check("колонки посчитаны", body.columns === 2);
  check("тексты разложены по секциям",
    hero.texts[0].text === "This $50 Mistake" && body.texts[0].text.startsWith("We asked"));
  check("размер текста сохранён", hero.texts[0].size === 28);
  check("палитра собрана", plan.palette.primary === "#FF7A00" && plan.palette.background === "#F4F6F8");

  const text = describePlan(plan);
  check("пересказ читается человеком", /Макет 600×900px, секций 3/.test(text), text.slice(0, 80));
  check("и в нём видно фоновую картинку", /ФОНОМ под текстом/.test(text));
}

/* ─── 4. Края ────────────────────────────────────────────────────────────── */
{
  const empty = planFromFigmaImport({ frameSize: { width: 600 }, sections: [] });
  check("макет без секций не молчит",
    empty.warnings.some((w) => /не нашлось секций/.test(w)), JSON.stringify(empty.warnings));

  // Письма верстаются под 600px. Макет на 1440 — это макет лендинга, и
  // собрать из него письмо без потерь нельзя.
  const wide = planFromFigmaImport({ frameSize: { width: 1440 }, sections: [{ name: "a", y: 0, x: 0, width: 1440, height: 100 }] });
  check("широкий макет отмечен", wide.warnings.some((w) => /Письма верстаются под 600px/.test(w)));

  const noStyles = planFromFigmaImport({ frameSize: { width: 600 }, sections: [{ name: "a", y: 0, x: 0, width: 600, height: 50 }] });
  check("пустые стили не роняют разбор", noStyles.sections.length === 1 && noStyles.sections[0].texts.length === 0);
}

/* ─── 5. Ручка приёма ────────────────────────────────────────────────────── */
{
  const router = createRouter({ name: "test" });
  registerFigmaRoutes(router, {
    sendJson: () => {}, readRequestBody: async () => ({}), apiToken: () => "", figma: {},
  });
  check("ручка вставки зарегистрирована",
    router.list().some((entry) => entry.id === "POST /api/figma/paste"),
    JSON.stringify(router.list()));

  const routes = read("src", "routes", "figma-routes.js");
  // Разобрать буфер и сходить в Figma — разные беды. Свалить их в одну
  // ошибку значит послать человека чинить вставку, когда сломан доступ.
  check("неудача похода в Figma отделена от разбора буфера",
    /Буфер мы разобрали, а вот сходить в Figma не вышло/.test(routes));
  // Токен здесь не единственный путь и для рабочей Figma — неверный:
  // персональный токен нельзя ограничить одним файлом, он открывает всё, что
  // видит владелец. Раньше студия звала за токеном первым делом.
  check("без токена зовём к плагину, а не к токену",
    /поставьте плагин Figma/.test(routes) && !/нужен FIGMA_API_TOKEN/.test(routes));
  check("и сказано, чем плох персональный токен",
    /персональный токен открывает все ваши файлы/.test(routes));
  check("истёкший токен назван своим именем", /токен Figma истёк/.test(routes));
  check("истёкший токен на рабочей Figma не предлагают заводить заново",
    /токен заводить заново не стоит/.test(routes));
  check("нет доступа к файлу — это другая беда", /нет доступа к этому файлу/.test(routes));
  check("и человеку сказано, что вставка сработала", /Вставку чинить не нужно/.test(routes));
}

/* ─── 6. Одна дверь, а не две ────────────────────────────────────────────── */
{
  const panel = read("public", "figma-paste.js");
  check("окно вставки одно", /Одна дверь, а не две/.test(panel));

  // Первый заход был неудобным ровно из-за этого: вставку ловило маленькое
  // поле в углу, в которое надо было попасть мышью. Человек жмёт Ctrl+V сразу.
  check("вставка ловится на всём окне, а не в поле",
    /document\.addEventListener\("paste", onPaste, true\)/.test(panel));
  check("и отпускается при закрытии", /removeEventListener\("paste", onPaste, true\)/.test(panel),
    "иначе окно продолжит перехватывать вставку после закрытия");
  // Решение по МЕСТУ курсора было ошибкой: фокус после открытия доставался
  // строке ссылки, макет уезжал в неё простым текстом, и человек видел «это
  // обычный текст, а не макет» — при том что макет лежал в буфере рядом.
  check("что вставили — решает содержимое, а не место курсора",
    /function looksLikeDesign/.test(panel));
  check("макет опознаётся по полям буфера Figma",
    /\\\(figmeta\\\)\|\\\(figma\\\)\|data-buffer=/.test(panel), "по figmeta/figma/data-buffer");
  check("обычная вставка в строку ссылки не перехватывается",
    /if \(!looksLikeDesign\(html, text\)\) return;/.test(panel));
  check("окно умеет принять фокус", /tabindex="-1"/.test(panel),
    "без этого focus() молча не срабатывает и курсор достаётся строке");
  check("Esc закрывает", /event\.key === "Escape"/.test(panel));
  // Первый Ctrl+V раньше уходил мимо: фокус доставался строке ссылки или
  // оставался в рамке предпросмотра. Ловушка — настоящее поле, которому
  // браузер отдаёт вставку всегда.
  check("вставку ловит настоящее поле", /id="fmCatch"/.test(panel));
  check("фокус ставится и повторяется кадром позже", /requestAnimationFrame\(grab\)/.test(panel),
    "пока окно появляется, focus\(\) иногда не доезжает");
  check("видно, готово ли окно принять вставку", /function markReady/.test(panel));
  check("и видно, когда НЕ готово", /нажмите сюда, чтобы окно поймало вставку/.test(panel));

  // Ключ файла без фрейма был тупиком: окно советовало «выберите нужный», а
  // выбирать было негде.
  check("фреймы файла можно выбрать", /function renderFrames/.test(panel));
  check("выбор фрейма ведёт к разбору", /node-id=/.test(panel));
  check("проблема с токеном не выдаётся за отсутствие фрейма",
    /!data\.tokenProblem/.test(panel));

  // Тексты макета лежат в буфере обычной строкой и доезжают даже когда до
  // Figma не достучаться. Терять их из-за протухшего токена — расточительство.
  check("тексты макета предлагаются отдельно", /function textOffer/.test(panel));
  check("и уходят оператору как содержимое письма",
    /RetkitFigmaPaste\.onTexts/.test(read("public", "constructor.js")));
  check("оператору сказано разложить их по местам",
    /а не абзацами в тело/.test(read("public", "constructor.js")));
  check("«Забрать» не гоняет разбор на не-ссылке",
    /Это не ссылка на макет Figma/.test(panel));

  // Картинка и макет приезжают в буфере вместе (⌘⇧C). Забрать одно и
  // потерять другое — это либо разбор без картинки, либо картинка без разбора.
  check("картинка и разбор не теряют друг друга", /keepShot\(image\)/.test(panel));
  check("картинка показывается сразу, не дожидаясь Figma",
    /Снимок из буфера — показываем сразу/.test(panel));
  check("и остаётся видна, когда до Figma не достучались",
    /ТОТ ли макет он вставил/.test(panel));
  check("нет картинки — сказано, как получить сейчас", /function noShotHint/.test(panel));
  check("и назван работающий без токена путь", /Copy as PNG/.test(panel));

  // Неподвижная строчка «разбираю…» читается как «зависло».
  check("индикация живая, а не строчка текста", /fm-spinner/.test(panel));
  check("снимок забывается при новом открытии", /shotUrl = "";/.test(panel));

  const css = read("public", "constructor.css");
  check("окно по центру, а не в углу", /\.fm-dialog/.test(css) && /margin: 7vh auto 0/.test(css));
  check("и объяснено, почему так", /спорил за место с окном разговора/.test(css));
  check("у индикации есть анимация", /@keyframes fm-spin/.test(css));
  check("снимок из буфера отличается от макета",
    /Это снимок макета, а не сам макет/.test(panel));
  check("панель узнаёт просьбу словами", /function wantsFigma/.test(panel));

  const chat = read("public", "studio-chat.js");
  check("просьба в разговоре открывает то же окно", /RetkitFigmaPaste\?\.wantsFigma/.test(chat));

  const constructorJs = read("public", "constructor.js");
  check("кнопка в конструкторе открывает то же окно", /RetkitFigmaPaste\.open\(/.test(constructorJs));
  // Перевод секций в блоки — решение, а не пересчёт: молча собранное «по
  // макету» письмо это ровно тот случай, из-за которого в письме оставался
  // образцовый текст.
  check("план уходит оператору, а не собирается молча",
    /Собери письмо, отступы возьми из плана/.test(constructorJs));
  check("снимок уходит на поиск похожих блоков", /Найди похожие блоки/.test(constructorJs));

  const html = read("public", "constructor.html");
  check("кнопка есть в разметке", html.includes('id="figmaPasteBtn"'));
  check("панель подключена", html.includes("/figma-paste.js"));
}

/* ─── 7. Разбор ответа Figma ─────────────────────────────────────────────── */
{
  const verdict = (message) => {
    const expired = /token[\s_]?expired|invalid[\s_]?token|\b401\b/i.test(message);
    const forbidden = !expired && /\b403\b|not[\s_]?allowed|permission/i.test(message);
    return expired ? "expired" : forbidden ? "forbidden" : "other";
  };
  check("Token expired опознан",
    verdict('Figma API 403: {"status":403,"err":"Token expired"}') === "expired");
  check("Not allowed — это доступ, а не токен",
    verdict('Figma API 403: {"status":403,"err":"Not allowed"}') === "forbidden");
  check("сеть не выдаётся за истёкший токен", verdict("fetch failed") === "other");
}

console.log(`\nfigma-paste: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
