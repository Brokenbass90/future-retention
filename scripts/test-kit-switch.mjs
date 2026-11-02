#!/usr/bin/env node
/**
 * test-kit-switch.mjs — набор блоков (promo / system) как отдельная ось.
 *
 * Что здесь по-настоящему опасно и потому проверяется:
 *
 *  1. Дефолт «блок без kits виден везде». Ошибись в нём — и подключение оси
 *     разом спрячет всю существующую библиотеку из каталога.
 *  2. Совпадение правила на клиенте и на сервере. Разойдутся — человек увидит
 *     в каталоге блок, который сервер в этом наборе не признаёт.
 *  3. Ось не сливается с брендом: набор хранится своим ключом, и переключение
 *     набора не трогает канвас (иначе теряется собранное письмо).
 *
 * Zero-AI, без сети. Exit 0 = pass.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import url from "node:url";
import { BLOCK_KITS, normalizeKits, blockAllowedInKit, normalizeBlockLibrarySavePayload }
  from "../src/block-library-schema.js";

const repoRoot = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const check = (name, cond, extra = "") => {
  if (cond) { pass++; console.log("  \x1b[32m✓\x1b[0m", name); }
  else { fail++; console.error(`  \x1b[31m✗ ${name}\x1b[0m ${extra}`); }
};

const kitSource = readFileSync(path.join(repoRoot, "public", "kit-switch.js"), "utf8");
const constructorHtml = readFileSync(path.join(repoRoot, "public", "constructor.html"), "utf8");
const constructorJs = readFileSync(path.join(repoRoot, "public", "constructor.js"), "utf8");
const barSource = readFileSync(path.join(repoRoot, "public", "brand-bar.js"), "utf8");
const css = readFileSync(path.join(repoRoot, "public", "constructor.css"), "utf8");

/** Вырезать объявление функции целиком, считая фигурные скобки. */
function extractFn(source, name) {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`не найдена функция ${name}`);
  let depth = 0, started = false;
  for (let i = start; i < source.length; i += 1) {
    if (source[i] === "{") { depth += 1; started = true; }
    else if (source[i] === "}" && started && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`функция ${name} не закрыта`);
}

/* ─── 1. Схема набора ────────────────────────────────────────────────────── */
{
  check("наборов ровно два", BLOCK_KITS.length === 2 && BLOCK_KITS.includes("promo") && BLOCK_KITS.includes("system"),
    JSON.stringify(BLOCK_KITS));
  check("пустой kits допустим", normalizeKits(null).length === 0);
  check("регистр не важен", normalizeKits(["SYSTEM"])[0] === "system");
  check("дубли схлопываются", normalizeKits(["promo", "promo"]).length === 1);
  let threw = false;
  try { normalizeKits(["legacy"]); } catch { threw = true; }
  check("выдуманный набор отвергнут", threw);
  threw = false;
  try { normalizeKits("system"); } catch { threw = true; }
  check("строка вместо массива отвергнута", threw);
}

/* ─── 2. Несимметричный дефолт: promo fail-open, system whitelist ────────── */
{
  // promo обязан оставаться fail-open: 78 существующих блоков не размечены,
  // и обратный дефолт спрятал бы весь каталог в момент подключения оси.
  check("блок без kits виден в promo", blockAllowedInKit({ id: "x" }, "promo"));
  check("пустой массив тоже виден в promo", blockAllowedInKit({ id: "x", kits: [] }, "promo"));
  // system обязан быть whitelist: смысл набора в том, что кусков МЕНЬШЕ.
  check("НЕразмеченный блок в system не показывается", blockAllowedInKit({ id: "x" }, "system") === false);
  check("пустой массив в system не показывается", blockAllowedInKit({ id: "x", kits: [] }, "system") === false);
  check("system-only не лезет в promo", blockAllowedInKit({ id: "x", kits: ["system"] }, "promo") === false);
  check("system-блок виден в system", blockAllowedInKit({ id: "x", kits: ["system"] }, "system"));
  // Простые sys-блоки живут в обоих наборах: они же кубики для промки.
  const both = { id: "x", kits: ["system", "promo"] };
  check("блок обоих наборов виден в promo", blockAllowedInKit(both, "promo"));
  check("блок обоих наборов виден в system", blockAllowedInKit(both, "system"));
}

/* ─── 3. Клиент и сервер судят одинаково ─────────────────────────────────── */
{
  const client = new Function([
    "const window = { RetkitKit: { current: () => 'system' } };",
    extractFn(constructorJs, "activeKit"),
    extractFn(constructorJs, "blockAllowedInKit"),
    "return blockAllowedInKit;",
  ].join("\n"))();

  const cases = [
    { id: "a" },
    { id: "b", kits: [] },
    { id: "c", kits: ["system"] },
    { id: "d", kits: ["promo"] },
    { id: "e", kits: ["promo", "system"] },
  ];
  for (const block of cases) {
    for (const kit of BLOCK_KITS) {
      const mine = client(block, kit);
      const theirs = blockAllowedInKit(block, kit);
      check(`клиент = сервер: ${block.id} в ${kit}`, mine === theirs, `${mine} vs ${theirs}`);
    }
  }
}

/* ─── 4. Сохранение блока пропускает kits ────────────────────────────────── */
{
  const saved = normalizeBlockLibrarySavePayload({
    id: "sys-probe", pug: "p Текст", kits: ["system"],
  });
  check("kits доезжает до сохранённого блока", JSON.stringify(saved.kits) === '["system"]', JSON.stringify(saved.kits));
  const without = normalizeBlockLibrarySavePayload({ id: "sys-probe", pug: "p Текст" });
  check("без kits поле не выдумывается", !Object.prototype.hasOwnProperty.call(without, "kits"));
}

/* ─── 5. Разметка и подключение ──────────────────────────────────────────── */
{
  check("в разметке есть #kitSwitch", constructorHtml.includes('id="kitSwitch"'));
  check("оба набора — кнопки радиогруппы",
    /data-kit="promo"/.test(constructorHtml) && /data-kit="system"/.test(constructorHtml)
    && /role="radiogroup"/.test(constructorHtml));
  check("kit-switch.js подключён", constructorHtml.includes('src="/kit-switch.js"'));
  check("подключён до constructor.js",
    constructorHtml.indexOf('src="/kit-switch.js"') < constructorHtml.indexOf('src="/constructor.js"'));
  check("каталог перерисовывается на смену набора", /RetkitKit\?\.onChange/.test(constructorJs));
  check("фильтр набора стоит в applyCatalogFilters",
    /applyCatalogFilters[\s\S]{0,600}blockAllowedInKit/.test(constructorJs));
  check("у набора свой ключ хранения, не брендовый",
    /retkit-active-kit/.test(kitSource) && !/retkit-active-kit/.test(barSource));
}

/* ─── 6. Переключение набора не трогает канвас ───────────────────────────── */
{
  const setKit = kitSource.slice(kitSource.indexOf("function setKit("));
  const body = setKit.slice(0, setKit.indexOf("\n  }"));
  check("setKit не лезет в канвас", !/canvas/i.test(body), body.slice(0, 200));
  check("в счётчике каталога видно чужие блоки в письме",
    /другого набора/.test(constructorJs));
}

/* ─── 7. Дропдаун брендов не срезается полосой ───────────────────────────── */
{
  // Комментарии вырезаем: в правиле есть строка «Не overflow:hidden», и без
  // этого тест ловил бы собственное объяснение вместо настоящего свойства.
  const bar = css.slice(css.indexOf(".brandbar {"), css.indexOf(".brandbar-label"))
    .replace(/\/\*[\s\S]*?\*\//g, "");
  check("у полосы брендов нет overflow:hidden", !/overflow:\s*hidden/.test(bar), bar);
  check("меню бренда позиционируется абсолютно", /\.brandbar-menu\s*\{[^}]*position:\s*absolute/.test(css));
  check("триггер бренда есть в brand-bar.js", /brandbar-trigger/.test(barSource) && /id="brandTrigger"/.test(barSource));
  check("полоса вкладок бренда убрана целиком",
    !/brandbar-tabs/.test(css) && !/brandbar-tab\b/.test(barSource) && !/brandbar-tabs/.test(constructorHtml));
  check("выбор и закрытие в одном слушателе (иначе список схлопывается сразу)",
    (barSource.match(/document\.addEventListener\("click"/g) || []).length === 1);
}

/* ─── 8. Что реально лежит в наборе system ───────────────────────────────── */
{
  const dir = path.join(repoRoot, "data", "block-library", "canonical");
  const lib = readdirSync(dir).filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(path.join(dir, f), "utf8")));

  const inSystem = lib.filter((b) => blockAllowedInKit(b, "system")).map((b) => b.id).sort();
  const sysFiles = lib.filter((b) => String(b.id).startsWith("sys-")).map((b) => b.id).sort();

  check("набор system собран только из блоков sys-*",
    JSON.stringify(inSystem) === JSON.stringify(sysFiles),
    `system=${inSystem.length}, sys-*=${sysFiles.length}`);
  check("набор system заметно короче промо-каталога",
    inSystem.length > 0 && inSystem.length < lib.length / 3,
    `${inSystem.length} из ${lib.length}`);

  // Скелет письма, который просили: логотип, заголовок, приветствие, два
  // абзаца, кнопка, футер — и всё это отдельными удаляемыми блоками.
  for (const id of ["sys-outer", "sys-section", "sys-logo", "sys-title", "sys-subtitle",
                    "sys-text", "sys-button", "sys-footer", "sys-callout", "sys-starter"]) {
    check(`в наборе есть ${id}`, inSystem.includes(id));
  }

  const starter = lib.find((b) => b.id === "sys-starter");
  check("стартер — комбо и раскладывается на блоки",
    starter?.combo === true && Array.isArray(starter.children) && starter.children.length >= 8,
    String(starter?.children?.length));
  check("стартер собран только из системных блоков",
    (starter?.children || []).every((c) => String(c.id).startsWith("sys-")));

  const footer = lib.find((b) => b.id === "sys-footer");
  check("в системном футере нет соцсетей и сторов",
    !/social|store|appsflyer|appstore|google-?play/i.test(JSON.stringify(footer)),
    "нашлись следы соцсетей/сторов");
  check("в системном футере есть адрес, риск, условия и отписка",
    ["company_address", "risk_warning", "terms_href", "unsubscribe_href"]
      .every((id) => (footer?.slots || []).some((sl) => sl.id === id)));

  // Тона плашки обязаны считаться от темы бренда, иначе зеленоватый блок
  // станет нечитаемым на тёмном IQ Broker — ради этого он и делался.
  const callout = lib.find((b) => b.id === "sys-callout");
  // Тона у плашки больше нет. Список «успех / внимание / ошибка» был лишним
  // слоем поверх обычных полей цвета: он не срабатывал из инспектора и всё
  // равно дублировал палитру письма. Остались три честных цвета, а частые
  // оттенки лежат в палитре конструктора.
  check("у плашки нет выбора тона", !(callout?.slots || []).some((sl) => sl.id === "tone"));
  check("у плашки нет пресетов тона", !callout?.slotPresets);
  const bgc = (callout?.slots || []).find((sl) => sl.id === "background_color");
  const acc = (callout?.slots || []).find((sl) => sl.id === "accent_color");
  check("фон плашки — обычный цветовой слот с готовым значением",
    bgc?.kind === "color" && /^#[0-9A-F]{6}$/i.test(String(bgc.default)), String(bgc?.default));
  check("полоса слева — обычный цветовой слот", acc?.kind === "color" && /^#[0-9A-F]{6}$/i.test(String(acc.default)));
  check("текст плашки не красится подсветкой", !/sys-callout--ink-/.test(callout?.pug || ""));

  // Футер целиком по центру: и ячейка, и абзацы.
  check("футер выровнен по центру",
    /text-align:center/.test(footer?.pug || "")
    && /\.sys-footer--pad\{[\s\S]*?text-align:center\}/.test(footer?.styl || ""));

  // Вендорное ink-правило `table.container table.row{display:block}` делает
  // секцию блочным боксом, и её ячейка сжимается по содержимому — из-за этого
  // футер центрировался внутри 208px вместо 560px. Класс `row` секциям больше
  // не даём и держим display:table явно.
  for (const id of ["sys-section", "sys-section-bordered", "sys-footer", "sys-starter"]) {
    const box = lib.find((b) => b.id === id);
    check(`${id} не берёт вендорный класс row`, !/^table\.row\b/.test(String(box?.pug || "")), String(box?.pug || "").slice(0, 40));
    check(`${id} остаётся настоящей таблицей`, /display:table/.test(String(box?.styl || "")));
  }

  // Пресеты обязаны применяться из инспектора: он пишет слот напрямую, и без
  // этого выбор ширины кнопки молча не менял CSS-ширину.
  check("инспектор применяет связанные слоты",
    /slotPresetAssignments\(block, id, v\)/.test(constructorJs),
    "inspector input handler must apply slot presets");
  check("в палитре письма есть цвета статусов",
    /#3FB950/.test(constructorJs) && /#E3A008/.test(constructorJs) && /#F85149/.test(constructorJs));
  check("рядом с палитрой есть колесо выбора цвета",
    /data-email-color-wheel/.test(constructorJs) && /type="color"/.test(constructorJs));

  // Кнопка: ширина выбирается, «классические» 280px среди вариантов.
  const btn = lib.find((b) => b.id === "sys-button");
  const width = (btn?.slots || []).find((sl) => sl.id === "width");
  check("у кнопки выбирается ширина", width?.kind === "select" && (width.options || []).length === 3);
  check("среди вариантов кнопки есть классические 280px",
    (width?.options || []).some((o) => String(o.value) === "280"));

  // Кнопка: 280px по умолчанию и рабочее выравнивание. Атрибут align на
  // таблице понимают не все клиенты, поэтому тон задаёт ещё и margin.
  check("кнопка по умолчанию 280px", String(width?.default) === "280", String(width?.default));
  check("ширина кнопки уезжает в CSS отдельным пресетом",
    Object.keys(btn?.slotPresets?.width || {}).length === 3);
  check("выравнивание кнопки подставляет margin",
    (btn?.slotPresets?.align?.center?.align_css || "").includes("auto")
    && (btn?.slotPresets?.align?.right?.align_css || "").includes("auto"));

  // Две колонки и две кнопки обязаны схлопываться на мобильном, иначе на
  // телефоне колонки станут по 40px и письмо развалится.
  for (const id of ["sys-two-columns", "sys-two-buttons"]) {
    const two = lib.find((b) => b.id === id);
    check(`${id} есть в наборе`, Boolean(two) && inSystem.includes(id));
    check(`${id} схлопывается на мобильном`,
      /@media[^{]*max-width:\s*600px[\s\S]*display:block[^;]*!important[\s\S]*width:100%/.test(String(two?.styl || "")),
      "нет media-запроса со схлопыванием");
  }

  const divider = lib.find((b) => b.id === "sys-divider");
  check("разделительная линия есть и это не отбивка",
    Boolean(divider) && /background-color:\{\{ color \}\}/.test(String(divider.pug || "")));

  const imageBlock = lib.find((b) => b.id === "sys-image");
  check("у картинки стоит заглушка",
    /nigeria-welcome-chain-trust/.test(String((imageBlock?.slots || []).find((sl) => sl.id === "image")?.default || "")));

  // Блоки должны быть доступны и в промо: простая промка без дизайнера — это
  // ровно те же кубики.
  check("простые блоки доступны и в промо-наборе",
    sysFiles.every((id) => blockAllowedInKit(lib.find((b) => b.id === id), "promo")));
}

console.log(`\nkit-switch: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
