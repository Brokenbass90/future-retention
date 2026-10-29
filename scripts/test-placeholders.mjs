#!/usr/bin/env node
/**
 * test-placeholders.mjs — четыре вида скобок и кто их подставляет.
 *
 * В письме одновременно живут четыре разных вида фигурных скобок. Путать их
 * дорого, и ошибка тихая:
 *   • раскрыл перевод в сборке — в рассылку ушёл текст одной локали во всех;
 *   • раскрыл переменную платформы — письмо без адреса компании и без
 *     предупреждения о рисках, то есть с юридической дырой;
 *   • не узнал формат MoEngage — человек правит его в редакторе как обычный
 *     текст и ломает подстановку, не понимая почему.
 *
 * Поэтому проверяем: каждый вид узнаётся, ни один не путается с соседним, и
 * подстановка демо-значений (нужная ТОЛЬКО для картинки каталога) делает
 * ровно то, что обещает.
 *
 * Zero-AI, без сети и диска. Exit 0 = pass.
 */
import {
  PLACEHOLDER_DIALECTS,
  findPlaceholders,
  classifyPlaceholder,
  replacePlaceholders,
  highlightPatterns,
} from "../src/placeholders.js";
import {
  substitutePreviewPlaceholders,
  findLeftoverPlaceholders,
  previewPlaceholderDictionary,
} from "../src/block-previews.js";
import { extractPugTextCandidates } from "../src/pug-placeholderize.js";
import { readFileSync } from "node:fs";
import path from "node:path";
import url from "node:url";

const repoRoot = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const check = (name, cond, extra = "") => {
  if (cond) { pass++; console.log("  \x1b[32m✓\x1b[0m", name); }
  else { fail++; console.error(`  \x1b[31m✗ ${name}\x1b[0m ${extra}`); }
};
const read = (...parts) => readFileSync(path.join(repoRoot, ...parts), "utf8");

/** Настоящий кусок письма MoEngage — ради него всё и затевалось. */
const MOENGAGE = `
table.row.footer.bg-col
    tr
        td.pb30
            table.twelve.columns
                tr
                    td
                        .mobile-paddding
                            p.address-text {{ContentBlock['iq_company_address_text']}}
                            p.warning.pt20 {{ContentBlock['iq_risk_warning_noreg_text']}}
                            p.subscribe
                                a.left(href="{{ContentBlock['iq_terms_noreg_url']}}")  \${{ footer.footer.conditions }}$
                                a.right(href="{{ContentBlock['iq_unsubscribe']}}")  \${{ footer.footer.unsubscribe }}$
                            p {{embedded.company_email}}
                            p {% if user %}привет{% endif %}
`;

/* ─── 1. Виды описаны в одном месте ──────────────────────────────────────── */
{
  const ids = PLACEHOLDER_DIALECTS.map((dialect) => dialect.id);
  check("описаны все четыре вида", ids.join() === "translate,contentBlock,embedded,style", ids.join());
  check("у каждого вида сказано, кто подставляет",
    PLACEHOLDER_DIALECTS.every((dialect) => dialect.who && dialect.example));
  // Порядок не косметика: широкое правило {{ … }} съело бы ${{ … }}$.
  check("перевод разбирается раньше остальных", ids[0] === "translate");
}

/* ─── 2. Настоящее письмо разбирается правильно ──────────────────────────── */
{
  const found = findPlaceholders(MOENGAGE);
  const byDialect = found.reduce((acc, entry) => {
    acc[entry.dialect] = (acc[entry.dialect] || 0) + 1;
    return acc;
  }, {});
  check("блоки MoEngage найдены", byDialect.contentBlock === 4, JSON.stringify(byDialect));
  check("переводы найдены", byDialect.translate === 2, JSON.stringify(byDialect));
  check("переменная письма найдена", byDialect.embedded === 1, JSON.stringify(byDialect));
  check("служебная разметка найдена", byDialect.style === 2, JSON.stringify(byDialect));

  const keys = found.filter((entry) => entry.dialect === "contentBlock").map((entry) => entry.key);
  check("ключ MoEngage вынут без кавычек и скобок",
    keys.includes("iq_company_address_text") && keys.includes("iq_unsubscribe"), keys.join());
  // Ссылка внутри href — тот же плейсхолдер: если бы правило требовало текст
  // между тегами, адрес отписки остался бы неузнанным.
  check("плейсхолдер внутри href узнан", keys.includes("iq_terms_noreg_url"), keys.join());

  const translateKeys = found.filter((entry) => entry.dialect === "translate").map((entry) => entry.key);
  check("составной ключ перевода читается целиком",
    translateKeys.includes("footer.footer.unsubscribe"), translateKeys.join());
}

/* ─── 3. Виды не путаются между собой ────────────────────────────────────── */
{
  check("перевод", classifyPlaceholder("${{ footer.footer.unsubscribe }}$") === "translate");
  check("MoEngage с одинарными кавычками",
    classifyPlaceholder("{{ContentBlock['iq_unsubscribe']}}") === "contentBlock");
  check("MoEngage с двойными кавычками",
    classifyPlaceholder('{{ContentBlock["iq_unsubscribe"]}}') === "contentBlock");
  check("MoEngage с пробелами", classifyPlaceholder("{{ ContentBlock[ 'x' ] }}") === "contentBlock");
  check("переменная письма", classifyPlaceholder("{{embedded.company_address}}") === "embedded");
  check("служебная разметка", classifyPlaceholder("{% if user %}") === "style");
  check("обычный текст плейсхолдером не считается", classifyPlaceholder("{{ просто текст }}") === null);
  check("незакрытая скобка не считается", classifyPlaceholder("{{embedded.x") === null);
  check("MoEngage не принимается за переменную письма",
    classifyPlaceholder("{{ContentBlock['x']}}") !== "embedded");
}

/* ─── 4. Подстановка только там, где нужна ───────────────────────────────── */
{
  const dictionary = previewPlaceholderDictionary();
  check("в словаре есть раздел MoEngage",
    Object.keys(dictionary.contentBlock || {}).length >= 4, JSON.stringify(Object.keys(dictionary.contentBlock || {})));

  const filled = substitutePreviewPlaceholders(MOENGAGE);
  check("адрес компании подставлен", filled.includes(dictionary.contentBlock.iq_company_address_text));
  check("предупреждение о рисках подставлено", filled.includes(dictionary.contentBlock.iq_risk_warning_noreg_text));
  check("перевод подставлен", filled.includes(dictionary.translation));
  check("скобок в картинке не осталось", findLeftoverPlaceholders(filled).length === 0,
    findLeftoverPlaceholders(filled).join(", "));

  // Служебная разметка — не наше дело: она остаётся в письме, и подменять её
  // на превью нечем.
  check("служебная разметка не тронута", filled.includes("{% if user %}"), filled.slice(0, 0));

  const unknown = substitutePreviewPlaceholders("{{ContentBlock['iq_brand_new_thing']}}");
  check("незнакомый ключ MoEngage читается по-человечески", unknown.includes("Iq brand new thing"), unknown);

  // И обратное: значения, которых нет, не должны молча превращаться в пустоту.
  const kept = replacePlaceholders("{{embedded.x}}", () => null);
  check("без значения плейсхолдер остаётся на месте", kept === "{{embedded.x}}", kept);
}

/* ─── 5. Редактор показывает MoEngage как плейсхолдер ────────────────────── */
{
  // Неподсвеченный плейсхолдер человек правит как обычный текст — и ломает
  // подстановку, не понимая, что сломал.
  const wb = read("public", "workbench.js");
  const overlay = wb.slice(wb.indexOf("function buildHtmlPhOverlay"), wb.indexOf("function initCodeMirror"));
  check("подсветка знает ContentBlock", overlay.includes("ContentBlock"), "нет правила");
  // Порядок правил важен: общее правило {{имя.что-то}} не ловит ContentBlock
  // (там нет точки), но если когда-нибудь его расширят, узкое правило должно
  // стоять первым — иначе MoEngage снова станет обычным текстом.
  check("правило MoEngage стоит раньше общего правила переменных",
    overlay.indexOf("ContentBlock") < overlay.indexOf("[a-zA-Z0-9_]+"), "порядок правил");
  check("подсветка ссылается на общий модуль видов", /src\/placeholders\.js/.test(wb));

  const patterns = highlightPatterns();
  check("модуль отдаёт шаблоны для подсветки", patterns.length === 4 && patterns.every((p) => p.source));
}

/* ─── 6. Расстановка не съедает плейсхолдеры платформы ───────────────────── */
{
  // Самая дорогая из найденных ошибок. Кнопка «Расставить плейсхолдеры»
  // считала строку `p.address-text {{ContentBlock['iq_company_address_text']}}`
  // обычным текстом, заменяла её на ${{ NS.block_00 }}$ и клала плейсхолдер
  // платформы в словарь локали как «перевод». В рассылку уходило письмо без
  // адреса компании и без предупреждения о рисках — юридическая дыра, видимая
  // только глазами.
  const candidates = extractPugTextCandidates(MOENGAGE);
  const raws = candidates.map((entry) => entry.raw);

  check("строка из одного блока MoEngage не идёт в перевод",
    !raws.some((raw) => /^\{\{\s*ContentBlock/.test(raw.trim())), JSON.stringify(raws));
  check("переменная письма в одиночку тоже не идёт в перевод",
    !raws.some((raw) => /^\{\{\s*embedded\./.test(raw.trim())), JSON.stringify(raws));

  // Обратная сторона: текст с переменной внутри переводить НУЖНО, иначе
  // «Привет, {{embedded.user_first_name}}!» останется без перевода вовсе.
  const mixed = extractPugTextCandidates("p Привет, {{embedded.user_first_name}}!");
  check("смешанный текст остаётся переводимым", mixed.length === 1, JSON.stringify(mixed.map((c) => c.raw)));
  check("переменная внутри перевода сохраняется",
    mixed[0]?.raw.includes("{{embedded.user_first_name}}"), mixed[0]?.raw);

  // И обычный текст рядом с ними никуда не делся.
  const plain = extractPugTextCandidates("p Внимание: платёжка временно недоступна");
  check("обычный текст по-прежнему переводится", plain.length === 1, JSON.stringify(plain));
}

/* ─── 7. Зеркало для браузера не разошлось с оригиналом ──────────────────── */
{
  // В проекте нет сборки: модуль из src в страницу не подключить, поэтому у
  // браузера своё зеркало. Разойдутся — и подсветка снова начнёт «не видеть»
  // то, что видит сервер. Сверяем шаблоны, а не текст файла.
  const browser = read("public", "placeholders.js");
  for (const dialect of PLACEHOLDER_DIALECTS) {
    check(`зеркало знает вид ${dialect.id}`, browser.includes(`id: "${dialect.id}"`));
    check(`шаблон ${dialect.id} совпадает с оригиналом`,
      browser.includes(dialect.pattern.source),
      dialect.pattern.source);
  }
  check("зеркало публикует себя в window", /window\.RetkitPlaceholders/.test(browser));

  const sidebar = read("public", "placeholders-sidebar.js");
  check("боковая панель берёт виды из общего модуля", /RetkitPlaceholders/.test(sidebar));
  check("служебная разметка в список не попадает", /dialect !== 'style'/.test(sidebar));
}

console.log(`\nplaceholders: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
