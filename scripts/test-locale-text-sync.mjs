// Правка текста в HTML-локали уходит в TXT этой локали, а не в ручную версию.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

// Файл грузится в браузер обычным <script>: проверяем ровно его.
const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync(new URL("../public/locale-text-sync.js", import.meta.url), "utf8"), sandbox);
const api = sandbox.window.RetkitLocaleTextSync;
// Результат из другого vm-контекста — приводим к обычным объектам для deepEqual.
const sync = { planLocaleTextSync: (input) => JSON.parse(JSON.stringify(api.planLocaleTextSync(input))) };

const compiled = `<html><head><style>.a{color:red}</style></head><body><table><tr><td class="t">Hello&nbsp;world</td></tr>
<tr><td><a href="https://x">Go <b>now</b></a></td></tr><tr><td>{{embedded.user_first_name}}, hi</td></tr></table></body></html>`;
// Тот же HTML, но «красиво» переформатированный, как в редакторе.
const pretty = compiled.replace(/></g, ">\n    <");

const blocks = ["Hello&nbsp;world", "Go @@now@@", "{{embedded.user_first_name}}, hi"];
const sources = [{ ns: "blog071223", key: "en", blocks }];

// 1. Переформатирование без правок — не правка.
{
  const plan = sync.planLocaleTextSync({ beforeHtml: compiled, afterHtml: pretty, sources });
  assert.equal(plan.ok, true);
  assert.equal(plan.unchanged, true, "whitespace/pretty print is not an edit");
}

// 2. Правка простого текста → блок 00, &nbsp; сохраняется.
{
  const edited = pretty.replace("Hello&nbsp;world", "Hello&nbsp;there");
  const plan = sync.planLocaleTextSync({ beforeHtml: compiled, afterHtml: edited, sources });
  assert.equal(plan.ok, true, plan.reason);
  assert.deepEqual(plan.updates.map((u) => [u.index, u.after]), [[0, "Hello&nbsp;there"]]);
}

// 3. Правка жирного куска внутри @@…@@ — меняется только он.
{
  const edited = pretty.replace("<b>now</b>", "<b>today</b>");
  const plan = sync.planLocaleTextSync({ beforeHtml: compiled, afterHtml: edited, sources });
  assert.equal(plan.ok, true, plan.reason);
  assert.deepEqual(plan.updates.map((u) => [u.index, u.after]), [[1, "Go @@today@@"]]);
}

// 4. Две правки в одном блоке складываются.
{
  const edited = pretty.replace("Go ", "Run ").replace("<b>now</b>", "<b>fast</b>");
  const plan = sync.planLocaleTextSync({ beforeHtml: compiled, afterHtml: edited, sources });
  assert.equal(plan.ok, true, plan.reason);
  assert.deepEqual(plan.updates.map((u) => [u.index, u.after]), [[1, "Run @@fast@@"]]);
}

// 5. Поменялась вёрстка — не трогаем TXT, объясняем.
{
  const edited = pretty.replace("Hello&nbsp;world", "<i>Hello</i> world");
  const plan = sync.planLocaleTextSync({ beforeHtml: compiled, afterHtml: edited, sources });
  assert.equal(plan.ok, false);
  assert.match(plan.reason, /вёрстка/);
}

// 6. Атрибут поменялся — тоже вёрстка.
{
  const edited = pretty.replace('href="https://x"', 'href="https://y"');
  const plan = sync.planLocaleTextSync({ beforeHtml: compiled, afterHtml: edited, sources });
  assert.equal(plan.ok, false);
}

// 7. Текст не из TXT (захардкожен в Pug) — честный отказ.
{
  const html = compiled.replace("{{embedded.user_first_name}}, hi", "Static footer");
  const plan = sync.planLocaleTextSync({ beforeHtml: html, afterHtml: html.replace("Static footer", "Footer"), sources });
  assert.equal(plan.ok, false);
  assert.match(plan.reason, /нет в TXT/);
}

// 8. Одинаковый текст в двух блоках — не угадываем.
{
  const dup = [{ ns: "n", key: "en", blocks: ["Same", "Same"] }];
  const html = "<body><p>Same</p><p>Same</p></body>";
  const plan = sync.planLocaleTextSync({ beforeHtml: html, afterHtml: html.replace("Same", "Other"), sources: dup });
  assert.equal(plan.ok, false);
  assert.match(plan.reason, /несколько раз/);
}

// 9. Спецсимволы экранируются, переменные не ломаются.
{
  const edited = pretty.replace("{{embedded.user_first_name}}, hi", "{{embedded.user_first_name}}, hi &amp; welcome");
  const plan = sync.planLocaleTextSync({ beforeHtml: compiled, afterHtml: edited, sources });
  assert.equal(plan.ok, true, plan.reason);
  assert.equal(plan.updates[0].after, "{{embedded.user_first_name}}, hi &amp; welcome");
}

console.log("test-locale-text-sync: OK");
