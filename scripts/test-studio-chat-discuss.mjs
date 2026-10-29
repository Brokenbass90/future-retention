#!/usr/bin/env node
/**
 * test-studio-chat-discuss.mjs — «обсудить с ИИ» по правой кнопке.
 *
 * Правая кнопка по блоку — самый короткий путь к разговору: человек видит
 * блок, который ему не нравится, и хочет спросить про него, не набирая
 * заново «тот синий баннер сверху». Путь работает только если выполняются
 * три вещи подряд: окно появилось, оно открыто, и в поле ввода стоит ссылка
 * на блок. Пропущено любое — и оператор отвечает про что-то другое.
 *
 * Раньше эта передача жила в конструкторе, внутри обработчика меню, и
 * проверить её можно было только глазами. Теперь она — метод самой панели
 * (`discuss`), и здесь панель поднимается в настоящем DOM: нажатие
 * воспроизводится, а не пересказывается.
 *
 * Отдельно стережём две вещи, на которых путь ломался молча:
 *   1) уже набранный текст не затирается — ссылка дописывается перед ним;
 *   2) круглая кнопка внизу справа узнаёт, что окно открылось, даже если его
 *      открыли меню, а не нажатием на саму кнопку.
 *
 * Zero-AI, без сети. Exit 0 = pass.
 */
import { readFileSync } from "node:fs";
import vm from "node:vm";
import path from "node:path";
import url from "node:url";
import { parseHTML } from "linkedom";

const repoRoot = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const check = (name, cond, extra = "") => {
  if (cond) { pass++; console.log("  \x1b[32m✓\x1b[0m", name); }
  else { fail++; console.error(`  \x1b[31m✗ ${name}\x1b[0m ${extra}`); }
};

const read = (...parts) => readFileSync(path.join(repoRoot, ...parts), "utf8");

/** Поднять настоящую панель в настоящем DOM. */
function mountChat(options = {}) {
  const { window, document } = parseHTML("<html><body></body></html>");
  const store = new Map();
  // linkedom не считает геометрию: панели она нужна только чтобы запомнить
  // положение окна, к разговору отношения не имеет.
  window.Element.prototype.getBoundingClientRect = () => ({
    left: 0, top: 0, width: 420, height: 520, right: 420, bottom: 520,
  });
  const sandbox = {
    window, document, console,
    innerWidth: 1440, innerHeight: 900,
    setTimeout: (fn) => { fn(); return 0; },
    clearTimeout: () => {},
    TextEncoder,
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
    },
    // Состояние модели не спрашиваем по сети: мастер подключения к разговору
    // про блок отношения не имеет.
    fetch: async () => ({ ok: true, json: async () => ({ openAiConfigured: true }) }),
  };
  sandbox.globalThis = sandbox;
  window.innerWidth = 1440;
  window.innerHeight = 900;
  window.localStorage = sandbox.localStorage;
  vm.createContext(sandbox);
  vm.runInContext(read("public", "studio-chat.js"), sandbox, { filename: "studio-chat.js" });

  const StudioChat = window.StudioChat;
  if (!StudioChat) throw new Error("public/studio-chat.js не отдал StudioChat");
  const sent = [];
  sandbox.fetch = async (input, init) => {
    sent.push({ url: String(input), init });
    if (String(input) === "/api/studio/agent") {
      return { ok: true, json: async () => ({ ok: true, reply: "ответ оператора" }) };
    }
    return { ok: true, json: async () => ({ openAiConfigured: true }) };
  };
  window.fetch = sandbox.fetch;
  const chat = new StudioChat({ surface: "constructor", buildContext: () => ({}), ...options });
  return { chat, document, window, sandbox, sent };
}


/** Настоящее правило узнавания просьбы — из public/mcp-connect.js. */
function loadWantsSetup() {
  const { window, document } = parseHTML("<html><body></body></html>");
  const sandbox = { window, document, console, fetch: async () => ({ ok: true, json: async () => ({}) }) };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(read("public", "mcp-connect.js"), sandbox, { filename: "mcp-connect.js" });
  const fn = window.RetkitMcpConnect?.wantsSetup;
  if (typeof fn !== "function") throw new Error("public/mcp-connect.js не отдал wantsSetup");
  return fn;
}
const realWantsSetup = loadWantsSetup();

/* ─── 1. Правая кнопка по блоку письма ───────────────────────────────────── */
{
  const opened = [];
  const { chat, document } = mountChat({ onOpenChange: (v) => opened.push(v) });

  check("до нажатия окна нет", !document.querySelector(".chat-panel"));

  const placed = chat.discuss({ text: "Блок «Шапка» (id: iq-header-01) в этом письме." });

  const panel = document.querySelector(".chat-panel");
  check("окно появилось", Boolean(panel));
  check("окно открыто, а не свёрнуто", panel?.classList.contains("open") === true);
  check("ссылка на блок попала в поле", placed === true && /iq-header-01/.test(chat.input.value), chat.input?.value);
  check("поле готово к дописыванию — курсор за ссылкой",
    chat.input.value.endsWith(" "), JSON.stringify(chat.input.value));
  check("поверхность узнала, что окно открылось", opened.at(-1) === true, JSON.stringify(opened));
}

/* ─── 2. Набранный текст не затирается ───────────────────────────────────── */
{
  const { chat } = mountChat();
  chat.mount();
  chat.input.value = "почему он ломается в Gmail?";
  chat.discuss({ text: "Блок «Кнопка» (id: iq-cta-35) в этом письме." });

  check("вопрос человека остался", /Gmail/.test(chat.input.value), chat.input.value);
  check("и ссылка на блок добавилась", /iq-cta-35/.test(chat.input.value), chat.input.value);
  check("ссылка стоит перед вопросом",
    chat.input.value.indexOf("iq-cta-35") < chat.input.value.indexOf("Gmail"), chat.input.value);

  // Второе нажатие по тому же блоку не должно множить ссылку.
  chat.discuss({ text: "Блок «Кнопка» (id: iq-cta-35) в этом письме." });
  check("повторное нажатие не дублирует ссылку",
    chat.input.value.match(/iq-cta-35/g).length === 1, chat.input.value);
}

/* ─── 3. Свернуть и снова открыть ────────────────────────────────────────── */
{
  const opened = [];
  const { chat, document } = mountChat({ onOpenChange: (v) => opened.push(v) });
  chat.discuss({ text: "Блок «Футер» (id: iq-footer-02) из каталога." });
  chat.close();
  check("после сворачивания окно закрыто",
    document.querySelector(".chat-panel").classList.contains("open") === false);
  check("кнопка узнала о сворачивании", opened.at(-1) === false, JSON.stringify(opened));

  chat.discuss({ text: "Блок «Футер» (id: iq-footer-02) из каталога." });
  check("повторное «обсудить» открывает то же окно",
    document.querySelectorAll(".chat-panel").length === 1);
  check("и оно снова открыто",
    document.querySelector(".chat-panel").classList.contains("open") === true);
}

/* ─── 4. Меню действительно ведёт сюда ───────────────────────────────────── */
{
  const constructorJs = read("public", "constructor.js");

  check("пункт меню есть у блока письма и у карточки каталога",
    (constructorJs.match(/key: "ai", label: "Обсудить с ИИ"/g) || []).length === 2);
  check("оба пункта зовут одну передачу",
    (constructorJs.match(/discussBlockWithAi\(/g) || []).length === 3, "два вызова из меню и объявление");
  check("передача идёт через панель, а не через свою копию логики",
    /chat\.discuss\(\{ text:/.test(constructorJs));
  check("подсветка кнопки приходит от панели",
    /onOpenChange: \(open\) =>/.test(constructorJs));
  check("панель отдаёт discuss наружу",
    /discuss\(subject\) \{/.test(read("public", "studio-chat.js")));
}

/* ─── 5. Индикатор подключения вместо всплывающего мастера ───────────────── */
{
  const wizards = [];
  const { chat, document, window } = mountChat();
  window.RetkitMcpConnect = {
    status: async () => ({ state: "on", label: "свой агент подключён", title: "Подключено." }),
    render: (host) => { wizards.push(host); },
    forget: () => {},
  };
  chat.mount();

  // Мастер, который показывался сам, перекрывал первый же ответ оператора —
  // и приходил тем, кому был не нужен. Теперь при открытии только состояние.
  check("мастер не всплывает при открытии", wizards.length === 0);

  const badge = document.querySelector(".chat-agent-state");
  check("индикатор есть в шапке", Boolean(badge));
}

/* ─── 6. Состояние читается у студии ─────────────────────────────────────── */
{
  const run = async (state) => {
    const { chat, document, window } = mountChat();
    window.RetkitMcpConnect = {
      status: async () => state,
      render: () => {},
      forget: () => {},
    };
    chat.mount();
    await chat.refreshAgentState();
    return document.querySelector(".chat-agent-state");
  };

  const on = await run({ state: "on", label: "свой агент подключён", title: "Подключено к студии." });
  check("подключён — видно словом", /подключён/.test(on.textContent), on.textContent);
  check("и помечено состоянием для цвета", on.getAttribute("data-state") === "on");

  const off = await run({ state: "off", label: "свой агент не подключён", title: "Здесь отвечает оператор." });
  check("не подключён — тоже видно", /не подключён/.test(off.textContent), off.textContent);
  check("и это другое состояние", off.getAttribute("data-state") === "off");

  const wrong = await run({ state: "wrong", label: "агент: другая студия", title: "Ходит не сюда." });
  check("агент, смотрящий в другую студию, не выдаётся за подключённого",
    wrong.getAttribute("data-state") === "wrong" && !/^●/.test(wrong.textContent), wrong.textContent);
}

/* ─── 7. Подключение просится словами ────────────────────────────────────── */
{
  const wizards = [];
  const { chat, window, sent } = mountChat();
  window.RetkitMcpConnect = {
    status: async () => ({ state: "off", label: "свой агент не подключён", title: "" }),
    render: (host) => { wizards.push(host); },
    forget: () => {},
    // Правило берём настоящее, из самого мастера: копия здесь разошлась бы с
    // оригиналом, и тест начал бы проверять сам себя.
    wantsSetup: realWantsSetup,
  };
  chat.mount();

  chat.input.value = "переподключи моего клода";
  await chat.send();
  check("просьба открывает подключение", wizards.length === 1);
  // Оператор студии про чужие настройки ничего не знает: отправить ему этот
  // вопрос значит получить выдуманный ответ.
  check("и не уходит оператору", !sent.some((call) => call.url === "/api/studio/agent"),
    JSON.stringify(sent.map((c) => c.url)));

  chat.input.value = "подключи этот блок к шапке";
  await chat.send();
  check("обычная просьба про блок мастер не открывает", wizards.length === 1);
  check("она уходит оператору", sent.some((call) => call.url === "/api/studio/agent"),
    JSON.stringify(sent.map((c) => c.url)));
}

/* ─── 8. Правило узнавания живёт в мастере ───────────────────────────────── */
{
  const wizard = read("public", "mcp-connect.js");
  check("мастер публикует правило наружу", /wantsSetup/.test(wizard));
  check("и состояние подключения", /async function status\(\)/.test(wizard));
  check("скилл ставится вместе с подключением",
    /installStudioSkill\(\{ repoRoot \}\)/.test(read("src", "routes", "mcp-routes.js")));
  check("неудача скилла не отменяет подключения",
    /skill = \{ ok: false, error: error\.message \}/.test(read("src", "routes", "mcp-routes.js")));
}

/* ─── 9. Правило узнавания не срабатывает вхолостую ──────────────────────── */
{
  for (const text of [
    "подключи моего клода",
    "переподключи агента",
    "настрой mcp",
    "давай подключим второго ии",
  ]) check(`просьба узнана: «${text}»`, realWantsSetup(text) === true);

  // Ложное срабатывание здесь дороже пропуска: мастер выскочит посреди работы
  // и съест вопрос, на который человек ждал ответа.
  for (const text of [
    "подключи этот блок к шапке",
    "агент собрал письмо, проверь",
    "почему кнопка не подключается к ссылке",
    "",
  ]) check(`не путается: «${text}»`, realWantsSetup(text) === false);
}

console.log(`\nstudio-chat-discuss: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
