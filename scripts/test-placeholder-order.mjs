#!/usr/bin/env node
/** Плейсхолдеры по порядку, без ИИ: счёт сошёлся — ставим, не сошёлся — отказ. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import url from "node:url";
import { placeholderizeByOrder, referenceTextBlocks, extractHtmlTextCandidates } from "../src/placeholder-order.js";

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
let pass = 0;
const ok = (name, fn) => { fn(); pass += 1; console.log("✓", name); };
const refused = (fn) => { try { fn(); } catch (e) { return e; } return null; };

const PUG = "p.title Title text\np.text Body text\na.btn(href=\"#\") Button text\n";
const TXT3 = "{{Заголовок письма}}\n\n{{Текст письма}}\n\n{{Кнопка письма}}";

ok("каждый следующий текст занимает следующий блок", () => {
  const r = placeholderizeByOrder({ source: PUG, kind: "pug", refLocaleTxt: TXT3, namespace: "demo" });
  assert.equal(r.placed, 3);
  assert.equal(r.source, "p.title ${{ demo.block_00 }}$\np.text ${{ demo.block_01 }}$\na.btn(href=\"#\") ${{ demo.block_02 }}$\n");
});

ok("текстов в TXT больше, чем мест — отказ, письмо не тронуто", () => {
  const e = refused(() => placeholderizeByOrder({ source: PUG, kind: "pug", refLocaleTxt: TXT3 + "\n\n{{Лишний текст}}", namespace: "demo" }));
  assert.equal(e?.code, "MORE_TEXTS_THAN_PLACES");
  assert.equal(e.details.texts, 4);
  assert.equal(e.details.places, 3);
  assert.deepEqual(e.details.extra, ["Лишний текст"]);
});

ok("мест больше, чем текстов — тоже отказ", () => {
  const e = refused(() => placeholderizeByOrder({ source: PUG + "p.note Small note\n", kind: "pug", refLocaleTxt: TXT3, namespace: "demo" }));
  assert.equal(e?.code, "MORE_PLACES_THAN_TEXTS");
});

ok("уже стоящие плейсхолдеры заняты — доделываем остальное", () => {
  const partial = "p.title ${{ demo.block_00 }}$\np.text Body text\na.btn(href=\"#\") Button text\n";
  const r = placeholderizeByOrder({ source: partial, kind: "pug", refLocaleTxt: TXT3, namespace: "demo" });
  assert.equal(r.alreadyPlaced, 1);
  assert.match(r.source, /p\.text \$\{\{ demo\.block_01 \}\}\$/);
  assert.match(r.source, /\$\{\{ demo\.block_02 \}\}\$/);
});

ok("системные переменные TXT не считаются текстами и не сдвигают номера", () => {
  const blocks = referenceTextBlocks("{{Привет}}\n{{embedded.company_address}}\n{{Пока}}", "n");
  assert.deepEqual(blocks.map((b) => b.index), [0, 2]);
});

ok("голое слово ({{from}}) — текст, если в письме нет литерала {{from}}", () => {
  const html = "<body><p>Bitcoin</p><span>from</span><span>to</span></body>";
  const r = placeholderizeByOrder({ source: html, kind: "html", refLocaleTxt: "{{Bitcoin}}\n{{desde}}\n{{hasta}}", namespace: "n" });
  assert.equal(r.placed, 3);
  const withVar = "<body><p>Через {{days}} дней</p></body>";
  assert.deepEqual(referenceTextBlocks("{{days}}", "n", withVar), []);
});

ok("HTML: текст между тегами, без <style>, комментариев и хвоста прехедера", () => {
  const html = "<html><head><style>p{color:red}</style><title>T</title></head><body>"
    + "<div class=\"preheader\">Hi there&nbsp;&raquo;&nbsp;&raquo;</div><!-- note --><p>Title text</p>"
    + "<a href=\"#\">{{embedded.risk_warning}}</a><p> Body text &nbsp;</p></body></html>";
  assert.deepEqual(extractHtmlTextCandidates(html).map((c) => c.raw), ["Hi there", "Title text", "Body text"]);
  const r = placeholderizeByOrder({ source: html, kind: "html", refLocaleTxt: "{{Привет}}\n{{Заголовок}}\n{{Текст}}", namespace: "n" });
  assert.match(r.source, /\$\{\{ n\.block_00 \}\}\$&nbsp;&raquo;/);
  assert.match(r.source, /\{\{embedded\.risk_warning\}\}/);
});

ok("кнопка «Плейсхолдеры» работает без ИИ и громко отказывает", () => {
  const js = readFileSync(path.join(root, "public", "workbench.js"), "utf8");
  const handler = js.slice(js.indexOf("pBtn.addEventListener('click'"), js.indexOf("function notifyPlaceholderRefusal"));
  assert.doesNotMatch(handler, /\/api\/wb\/ai\/placeholderize/);
  assert.match(handler, /\/api\/wb\/placeholderize-order/);
  assert.match(js, /new Notify\('Плейсхолдеры не расставлены'/);
});

console.log(`\nplaceholder-order: ${pass} ok, 0 fail`);
