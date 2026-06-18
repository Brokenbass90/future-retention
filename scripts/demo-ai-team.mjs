#!/usr/bin/env node
/**
 * scripts/demo-ai-team.mjs — NEW 2026-06-11
 *
 * «Ретеншн-команда в одном агенте» — демонстрация + регрессия.
 *
 * Прогоняет агентский цикл (src/ai-agent.js) на РЕАЛЬНЫХ инструментах и
 * реалистичных данных. Решения модели сценированы через __OPENAI_TEST_MOCK
 * (из sandbox нет сети до OpenAI), но каждый tool-вызов исполняется
 * по-настоящему: правки локалей, поиск/замена в HTML, верификация.
 * В приложении с OPENAI_API_KEY те же сценарии работают живьём.
 *
 * Сценарии:
 *   A. «Новичок»: поправь текст кнопки в RU и добавь немецкую локаль
 *   B. «Маркетолог»: сделай 'Dear Client' жирным и замени лого
 *   C. Защита: ошибка инструмента → агент читает её и чинит запрос сам
 *
 * Run:  node scripts/demo-ai-team.mjs          (полный транскрипт)
 *       node scripts/demo-ai-team.mjs --quiet  (только ассерты)
 * Exits 0 on success, 1 on any assertion failure.
 */

import { runAgent } from "../src/ai-agent.js";

const QUIET = process.argv.includes("--quiet");
const C = { reset: "\x1b[0m", red: "\x1b[31m", green: "\x1b[32m", cyan: "\x1b[36m", yellow: "\x1b[33m", dim: "\x1b[2m", bold: "\x1b[1m" };
const ok = (s) => `${C.green}${s}${C.reset}`;
const bad = (s) => `${C.red}${s}${C.reset}`;
const dim = (s) => `${C.dim}${s}${C.reset}`;
const cyan = (s) => `${C.cyan}${s}${C.reset}`;
const bold = (s) => `${C.bold}${s}${C.reset}`;

let failed = 0;
const assert = (cond, label) => {
  if (cond) console.log("  " + ok("✓") + " " + label);
  else { console.log("  " + bad("✗") + " " + label); failed++; }
};
const section = (s) => console.log("\n" + dim("━━━ ") + bold(s) + dim(" ━━━"));

const mkCall = (id, name, args) => ({ type: "function_call", call_id: id, name, arguments: JSON.stringify(args) });

function transcriptPrinter() {
  if (QUIET) return undefined;
  return (frame) => {
    if (frame.kind === "tool_call") {
      const args = JSON.stringify(frame.args);
      console.log(`  ${cyan("🔧 " + frame.name)} ${dim(args.length > 110 ? args.slice(0, 110) + "…" : args)}`);
    } else if (frame.kind === "tool_result") {
      const r = frame.result || {};
      const brief = r.error
        ? `${C.yellow}⚠ ${r.error}${C.reset}`
        : dim(JSON.stringify(r).slice(0, 110) + "…");
      console.log(`     ↳ ${brief}`);
    } else if (frame.kind === "finish") {
      console.log(`  ${ok("✅ finish:")} ${frame.payload.summary}`);
    }
  };
}

function mock(script) {
  let turn = 0;
  globalThis.__OPENAI_TEST_MOCK = async () => {
    if (turn >= script.length) throw new Error(`mock exhausted at turn ${turn}`);
    return script[turn++];
  };
}

function freshCtx() {
  const NS = {
    namespace: "expay_withdrawal_docs",
    name: "expay_withdrawal_docs",
    referenceLocale: "en",
    locales: {
      en: [
        "Your withdrawal request has been put on hold",
        "Dear Client,",
        "Please provide the documents by replying to this email.",
        "Open my account",
      ],
      ru: [
        "Ваш запрос на вывод средств приостановлен",
        "Уважаемый клиент,",
        "Пожалуйста, предоставьте документы ответом на это письмо.",
        "Открыть аккаунт",   // ← юзер хочет «Перейти в кабинет»
      ],
    },
  };
  const HTML = `<!DOCTYPE html><html><body>
<table><tr><td class="center"><center>
<table class="container"><tr><td>
<a href="https://broker.example/lp"><img src="https://static.cdn/old-logo.png" alt="logo" width="120"/></a>
<h1>\${{ expay_withdrawal_docs.block_00 }}$</h1>
<p>Dear Client,</p>
<p>\${{ expay_withdrawal_docs.block_02 }}$</p>
<a class="btn" href="https://broker.example/login">\${{ expay_withdrawal_docs.block_03 }}$</a>
</td></tr></table>
</center></td></tr></table>
</body></html>`;
  return { html: HTML, namespaces: [NS], activeNamespace: NS, activeLocale: "ru", pendingLocaleUpdates: [], pendingLocaleDeletes: [] };
}

// ════════════════════════════════════════════════════════════════════════
section("Сценарий A — новичок: «поправь кнопку в русском и добавь немецкий»");
console.log(dim('  Запрос: "в русской версии кнопка должна быть «Перейти в кабинет», и нужна немецкая локаль"'));
{
  mock([
    { output: [mkCall("a1", "list_namespaces", {})] },
    { output: [mkCall("a2", "get_namespace_blocks", { namespace: "expay_withdrawal_docs", locale: "ru" })] },
    { output: [mkCall("a3", "edit_locale_block", { locale: "ru", index: 3, text: "Перейти в кабинет" })] },
    // ВЕРИФИКАЦИЯ: перечитать блоки после правки.
    { output: [mkCall("a4", "get_namespace_blocks", { namespace: "expay_withdrawal_docs", locale: "ru" })] },
    // Немецкая локаль: в демо без токена → копия-заглушка; вживую translate=true.
    { output: [mkCall("a5", "create_locale", { locale: "de", translate: false })] },
    { output: [mkCall("a6", "finish", { summary: "Готово: кнопка в RU теперь «Перейти в кабинет» (проверил — блок 4 обновился). Немецкая локаль создана; нажмите «Применить» под этим сообщением, чтобы изменения попали во вкладки." })] },
  ]);
  try {
    const ctx = freshCtx();
    const result = await runAgent({
      userMessage: "в русской версии кнопка должна быть «Перейти в кабинет», и нужна немецкая локаль",
      ctx, apiKey: "demo", onFrame: transcriptPrinter(),
    });
    const verifyStep = result.steps.filter((s) => s.kind === "tool_call" && s.name === "get_namespace_blocks").length;
    assert(verifyStep >= 2, "агент перечитал блоки ПОСЛЕ правки (верификация)");
    const ruUpd = result.localeUpdates.find((u) => u.locale === "ru");
    assert(!!ruUpd && /\{\{Перейти в кабинет\}\}/.test(ruUpd.txt), "RU-update содержит новый текст кнопки");
    assert(!/Открыть аккаунт/.test(ruUpd?.txt || ""), "старый текст кнопки ушёл");
    assert(result.localeUpdates.some((u) => u.locale === "de"), "DE-локаль в очереди на применение");
    assert(/кабинет/i.test(result.summary), "summary человеческий, по делу");
  } finally { delete globalThis.__OPENAI_TEST_MOCK; }
}

// ════════════════════════════════════════════════════════════════════════
section("Сценарий B — маркетолог: «сделай Dear Client жирным и замени лого»");
console.log(dim('  Запрос: "сделай Dear Client жирным и поставь новое лого https://static.cdn/new-logo.png"'));
{
  mock([
    { output: [mkCall("b1", "read_open_html", {})] },
    { output: [mkCall("b2", "find_in_html", { query: "<p>Dear Client,</p>" })] },
    { output: [mkCall("b3", "replace_in_html", { search: "<p>Dear Client,</p>", replace: "<p><strong>Dear Client,</strong></p>" })] },
    { output: [mkCall("b4", "replace_in_html", { search: "https://static.cdn/old-logo.png", replace: "https://static.cdn/new-logo.png" })] },
    // ВЕРИФИКАЦИЯ: новый текст на месте, старого лого нет.
    { output: [mkCall("b5", "find_in_html", { query: "<strong>Dear Client,</strong>" })] },
    { output: [mkCall("b6", "find_in_html", { query: "old-logo.png" })] },
    { output: [mkCall("b7", "finish", { summary: "Сделал «Dear Client» жирным и заменил лого на new-logo.png. Проверил: новый тег на месте, старого лого в письме больше нет. Нажмите «Применить HTML», чтобы увидеть в превью." })] },
  ]);
  try {
    const ctx = freshCtx();
    const result = await runAgent({
      userMessage: "сделай Dear Client жирным и поставь новое лого https://static.cdn/new-logo.png",
      ctx, apiKey: "demo", onFrame: transcriptPrinter(),
    });
    assert(/<strong>Dear Client,<\/strong>/.test(result.modifiedHtml), "modifiedHtml: фраза обёрнута в <strong>");
    assert(/new-logo\.png/.test(result.modifiedHtml), "modifiedHtml: новое лого");
    assert(!/old-logo\.png/.test(result.modifiedHtml), "modifiedHtml: старого лого нет");
    assert(/\$\{\{ expay_withdrawal_docs\.block_00 \}\}\$/.test(result.modifiedHtml), "плейсхолдеры не тронуты");
    const verifies = result.steps.filter((s) => s.kind === "tool_call" && s.name === "find_in_html");
    assert(verifies.length >= 3, "агент проверил результат через find_in_html");
    const lastVerify = result.steps.filter((s) => s.kind === "tool_result" && s.name === "find_in_html").pop();
    assert(lastVerify?.result?.total === 0, "верификация подтвердила: старого лого 0 вхождений");
  } finally { delete globalThis.__OPENAI_TEST_MOCK; }
}

// ════════════════════════════════════════════════════════════════════════
section("Сценарий C — самокоррекция: ошибка инструмента = инструкция");
console.log(dim('  Запрос: "замени Client на Customer" (слово встречается дважды — агент уточняет контекст)'));
{
  mock([
    { output: [mkCall("c1", "read_open_html", {})] },
    // Слишком общий search → инструмент откажет (2 вхождения: в <p> и… добавим второе).
    { output: [mkCall("c2", "replace_in_html", { search: "Client", replace: "Customer", })] },
    // Агент читает ошибку, уточняет контекст через find_in_html и повторяет точнее.
    { output: [mkCall("c3", "find_in_html", { query: "Client" })] },
    { output: [mkCall("c4", "replace_in_html", { search: "<p>Dear Client,</p>", replace: "<p>Dear Customer,</p>" })] },
    { output: [mkCall("c5", "finish", { summary: "Заменил обращение на «Dear Customer» (первый Client был ещё и в ссылке — его не тронул, уточнил контекст)." })] },
  ]);
  try {
    const ctx = freshCtx();
    // Введём второе вхождение "Client" чтобы спровоцировать отказ инструмента.
    ctx.html = ctx.html.replace("https://broker.example/login", "https://broker.example/login?src=Client");
    const result = await runAgent({
      userMessage: "замени Client на Customer",
      ctx, apiKey: "demo", onFrame: transcriptPrinter(),
    });
    const errStep = result.steps.find((s) => s.kind === "tool_result" && s.result?.error && /matches 2 places/.test(s.result.error));
    assert(!!errStep, "инструмент отказал на неоднозначном search (2 места)");
    assert(/Dear Customer,/.test(result.modifiedHtml), "после уточнения замена прошла точечно");
    assert(/src=Client/.test(result.modifiedHtml), "Client в URL не пострадал");
  } finally { delete globalThis.__OPENAI_TEST_MOCK; }
}

// ════════════════════════════════════════════════════════════════════════
section("Вердикт");
if (failed) {
  console.log(bad(`\n✗ ${failed} assertion(s) failed.\n`));
  process.exit(1);
} else {
  console.log(ok("\n✓ Все сценарии отработали. Команда готова к живому прогону с OPENAI_API_KEY.\n"));
  process.exit(0);
}
