#!/usr/bin/env node
/**
 * test-agent-hands.mjs — руки агента: создать блок и прочитать код студии.
 *
 * Две дыры, которые закрывались вместе.
 *
 * Первая: если в каталоге нет нужного блока, агент не мог сделать новый — он
 * подбирал похожий и подгонял значения, а человеку говорил «такого нет».
 * Теперь может; и здесь стережём главное свойство этой возможности —
 * созданный блок проходит ту же проверку, что и блок, написанный руками.
 * Черновик в письмо не встанет, и агент обязан узнать об этом из ответа, а
 * не обнаружить позже, что письмо не собирается.
 *
 * Вторая: код студии агенту не виден, если он подключён не из Claude Code.
 * Чтение открыто узко и только на чтение — в домашнюю папку человека, в его
 * ключи и в node_modules ходить незачем. Побег из папки студии проверяется
 * не строкой «нет ли тут ..», а сравнением готового пути с разрешёнными
 * корнями: строковую проверку обходит симлинк и кодирование.
 *
 * Zero-AI, без сети. Exit 0 = pass.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import url from "node:url";
import {
  readSource, searchSource, listSource, resolveSourcePath,
  SourceAccessError, SOURCE_ROOTS,
} from "../src/source-reader.js";
import { createRouter } from "../src/router.js";
import { registerSourceRoutes } from "../src/routes/source-routes.js";

const repoRoot = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const check = (name, cond, extra = "") => {
  if (cond) { pass++; console.log("  \x1b[32m✓\x1b[0m", name); }
  else { fail++; console.error(`  \x1b[31m✗ ${name}\x1b[0m ${extra}`); }
};
const read = (...parts) => readFileSync(path.join(repoRoot, ...parts), "utf8");
const refused = (work) => {
  try { work(); return ""; } catch (error) { return error instanceof SourceAccessError ? error.message : `НЕ ТОТ ТИП: ${error.message}`; }
};

/* ─── 1. Из папки студии не выйти ────────────────────────────────────────── */
{
  for (const escape of [
    "../../../etc/passwd",
    "/etc/passwd",
    "src/../../secrets.json",
    "node_modules/pug/index.js",
    "email-base/X_IQ/mail-welcome/index.pug",
  ]) {
    check(`отказ: ${escape}`, Boolean(refused(() => resolveSourcePath(repoRoot, escape))));
  }
  // Письма — не код студии, и читать их этой дверью незачем: для них есть
  // свои инструменты, знающие про черновики и замки.
  check("письма читаются не отсюда", Boolean(refused(() => resolveSourcePath(repoRoot, "email-base/X_IQ"))));
}

/* ─── 2. Ключи не отдаются даже из разрешённой папки ─────────────────────── */
{
  for (const secret of [".env", ".env.local", "src/.env", "src/private.key", "tools/aws-credentials.json"]) {
    const message = refused(() => resolveSourcePath(repoRoot, secret));
    check(`не отдаём: ${secret}`, /ключи или чужие данные/.test(message), message);
  }
}

/* ─── 3. Код студии читается ─────────────────────────────────────────────── */
{
  const file = readSource(repoRoot, { file: "src/router.js", from: 23, lines: 3 });
  check("файл читается окном", file.from === 23 && file.to === 25, JSON.stringify(file).slice(0, 120));
  check("строки пронумерованы", /^23\t/.test(file.text), file.text.slice(0, 40));
  check("видно, что файл длиннее", file.truncated === true && file.totalLines > 25);

  // Скилл студии лежит в папке с точкой — и это единственное место, где он
  // лежит. Срезание точек в начале пути однажды его спрятало.
  const skill = readSource(repoRoot, { file: ".claude/skills/retkit-studio/SKILL.md", lines: 3 });
  check("скилл студии читается", skill.totalLines > 10, String(skill.totalLines));

  check("двоичное не читаем", Boolean(refused(() => readSource(repoRoot, { file: "data/block-previews/index.json.png" }))));
}

/* ─── 4. Поиск: без него чтение бесполезно ───────────────────────────────── */
{
  const found = searchSource(repoRoot, { query: "createRouter", limit: 10 });
  check("поиск находит объявление", found.hits.some((hit) => hit.file === "src/router.js"),
    found.hits.map((h) => h.file).join(", "));
  check("у попадания есть файл и строка", found.hits.every((hit) => hit.file && hit.line > 0));

  const narrowed = searchSource(repoRoot, { query: "createRouter", glob: "scripts/", limit: 10 });
  check("поиск сужается по пути", narrowed.hits.every((hit) => hit.file.startsWith("scripts/")),
    narrowed.hits.map((h) => h.file).join(", "));

  check("кривое выражение — внятный отказ", /Неверное выражение/.test(refused(() => searchSource(repoRoot, { query: "([" }))));
  check("пустой запрос отвергается", Boolean(refused(() => searchSource(repoRoot, { query: "  " }))));

  const listed = listSource(repoRoot, { dir: "src/routes" });
  check("папка перечисляется с размерами",
    listed.entries.some((entry) => entry.name === "router.js") === false
    && listed.entries.every((entry) => entry.kind !== "file" || entry.lines > 0),
    JSON.stringify(listed.entries).slice(0, 160));
}

/* ─── 5. Ручки только на чтение ──────────────────────────────────────────── */
{
  const router = createRouter({ name: "test" });
  registerSourceRoutes(router, { repoRoot, sendJson: () => {} });
  const ids = router.list().map((entry) => entry.id);
  for (const expected of ["GET /api/source/read*", "GET /api/source/search*", "GET /api/source/list*"]) {
    check(`ручка ${expected}`, ids.includes(expected), ids.join(", "));
  }
  // Запись кода по сети — это потерянный день работы без git и без отката.
  check("записи в код нет", !ids.some((id) => id.startsWith("POST /api/source")), ids.join(", "));

  const routes = read("src", "routes", "source-routes.js");
  check("модуль не пишет на диск", !/writeFile|rmSync|unlink/.test(routes));
  check("отказ доступа — 400, а не 500", /refused \? 400 : 500/.test(routes));
}

/* ─── 6. Инструменты агента ──────────────────────────────────────────────── */
{
  const mcp = read("mcp", "retkit-mcp-server.mjs");
  for (const tool of ["retkit_create_block", "retkit_block_source", "retkit_find_in_code", "retkit_read_code", "retkit_list_code"]) {
    check(`есть ${tool}`, new RegExp(`"${tool}"`).test(mcp));
  }

  // Создание блока — запись на диск человека. Про подтверждение агент должен
  // прочитать в описании инструмента, а не догадаться.
  check("создание блока помечено как разрушающее",
    /"retkit_create_block"[\s\S]{0,3000}destructiveHint: true/.test(mcp));
  check("и требует согласия заранее",
    /"retkit_create_block"[\s\S]{0,2500}спрашивайте согласие до вызова/.test(mcp));

  // Главная ловушка: сохранённый блок мог не пройти проверку. Если агент об
  // этом не скажет, человек узнает об этом, когда письмо не соберётся.
  check("агент узнаёт, что блок остался черновиком", /остался ЧЕРНОВИКОМ/.test(mcp));
  check("и получает замечания проверки целиком", /Замечания проверки/.test(mcp));

  // Новый блок должен быть похож на соседей: вёрстка писем держится на
  // таблицах и мixin-ах семьи, «как на сайте» здесь не работает.
  check("перед созданием велено посмотреть исходник соседа",
    /retkit_block_source у ближайшего соседа/.test(mcp));

  check("правка кода отсюда прямо запрещена",
    /Правк[аи] кода отсюда не делаются|Править код студии отсюда нельзя/.test(mcp));
  check("пустой поиск не повод для вывода",
    /не делайте вывода, что этого в студии нет/.test(mcp));
  check("большой файл читается окном", /целиком его читать не нужно/.test(mcp));
}

/* ─── 6б. Правка блока ───────────────────────────────────────────────────── */
{
  const mcp = read("mcp", "retkit-mcp-server.mjs");
  check("есть retkit_update_block", /"retkit_update_block"/.test(mcp));

  // Канонический блок общий, и на нём стоят собранные раньше письма. Правка
  // такого блока меняет их задним числом — поэтому только копия.
  check("канонический блок править нельзя",
    /"retkit_update_block"[\s\S]{0,4000}канонический блок студии, он общий/.test(mcp));
  check("и предложен обход — копия под новым id",
    /"retkit_update_block"[\s\S]{0,4200}копию под новым id/.test(mcp));

  // Ручка сохранения принимает блок целиком, а не заплатку: недосланное поле
  // она потеряет, и блок молча лишится стилей или половины слотов.
  check("правка шлёт блок целиком, а не заплатку", /\.\.\.Object\.fromEntries\(changed\)/.test(mcp));
  check("и это объяснено рядом", /недосланное поле она бы потеряла/.test(mcp));

  // Рабочий блок после правки может стать черновиком и выпасть из
  // конструктора. Молча этого допускать нельзя.
  check("агент узнаёт, что блок выпал из конструктора", /стал ЧЕРНОВИКОМ и выпал из конструктора/.test(mcp));
  check("при отказе сказано, что прежняя версия цела", /Прежняя версия на месте/.test(mcp));
  check("замена слотов помечена как полная", /заменяет прежний, а не дополняет/.test(mcp));
}

/* ─── 6в. Скилл знает про новые возможности ──────────────────────────────── */
{
  const skill = read(".claude", "skills", "retkit-studio", "SKILL.md");
  check("скилл объясняет чтение кода без файлов", /retkit_find_in_code/.test(skill));
  check("и разделяет два случая", /Claude Code, открытый в папке студии/.test(skill));
  check("и запрещает правку по сети", /Править код этими инструментами нельзя/.test(skill));
  check("скилл требует смотреть, а не описывать", /не рассуждайте о внешнем виде вслепую/i.test(skill));
  check("скилл объясняет создание блока", /retkit_create_block/.test(skill));
  check("и запрещает исполняемый pug", /Исполняемый pug/.test(skill));
}

/* ─── 7. Что открыто — то и заявлено ─────────────────────────────────────── */
{
  check("корни чтения перечислены явно", SOURCE_ROOTS.includes("src") && SOURCE_ROOTS.includes("public"));
  check("email-base целиком не открыт", !SOURCE_ROOTS.includes("email-base"),
    "письма читаются своими инструментами, знающими про замки и черновики");
  check("данные студии не открыты", !SOURCE_ROOTS.includes("data"));
}

console.log(`\nagent-hands: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
