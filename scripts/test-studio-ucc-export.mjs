// Мост «Код» → UCC: студия отдаёт userscript'у RetKit UCC Export готовый HTML каждой локали.
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const js = readFileSync(new URL("../public/workbench.js", import.meta.url), "utf8");
const block = js.slice(js.indexOf("(function exposeStudioExport()"));
assert.ok(block.length > 100, "блок моста есть");
assert.match(block, /window\.RetKitStudioExport = \{ info, allLocales: async \(\) => prettify\(await allLocales\(\)\) \}/, "наружу отдаются info и allLocales (читаемый HTML)");
assert.match(block, /\/api\/wb\/code-html\?brand=/, "письмо из базы — готовый HTML с сервера");
assert.match(block, /applyNamespaceLocale\(html, ns\.name, blocks, false\)/, "HTML с плейсхолдерами — подстановка без служебной обёртки");
assert.match(block, /zh: 'cn', sv: 'se'/, "коды локалей как в UCC");
assert.ok(!/method:\s*'(PUT|DELETE|PATCH)'/.test(block), "студия ничего не пишет");
assert.match(block, /\/api\/wb\/pretty-html/, "в UCC уходит читаемый (не минифицированный) HTML");
console.log("✓ studio → UCC: info/allLocales, оба режима «Кода», коды UCC, только чтение");

// Тема из txt локали: «Subject:/Assunto:/Тема:» первой строкой; такие подписи — не «текст вне блоков».
{
  const start = js.indexOf("const TXT_LABEL_LINE_RE");
  const end = js.indexOf("function parseTxtDetailed");
  const fn = new Function(`${js.slice(start, end)}; return { subjectFromTxt, TXT_LABEL_LINE_RE };`)();
  assert.equal(fn.subjectFromTxt("Assunto: Seu contrato foi rescindido\nPreheader: {{Retire}}\n\n{{Rescisão}}"), "Seu contrato foi rescindido");
  assert.equal(fn.subjectFromTxt("Тема: Привет\n{{Текст}}"), "Привет");
  assert.equal(fn.subjectFromTxt("{{Только блоки}}"), "");
  assert.ok(fn.TXT_LABEL_LINE_RE.test("Preheader: "));
  assert.ok(!fn.TXT_LABEL_LINE_RE.test("Por meio deste e-mail, informamos: x"), "обычная фраза с двоеточием — не подпись");
  assert.match(block, /subject = subjectFromTxt\(ns\.localeRaw\?\.\[code\]\)/, "тема уходит в UCC");
  console.log("✓ тема из txt (Subject/Assunto/Тема) уходит в UCC; подписи не считаются текстом вне блоков");
}

{
  const html = readFileSync(new URL("../public/workbench.html", import.meta.url), "utf8");
  assert.match(html, /id="toUccBtn"[\s\S]*Перенести в UCC/, "кнопка «Перенести в UCC» в нижней панели");
  assert.match(js, /\.bottom-tool-btn\[data-panel\]/, "кнопка не открывает пустую панель");
  assert.match(js, /window\.__retkitUccBridge/, "кнопка зовёт мост userscript");
  console.log("✓ кнопка «Перенести в UCC» в студии");
}

{
  const { prettyHtml } = await import("../src/routes/locale-tools-routes.js");
  const out = prettyHtml('<table><tr><td><p>Hi</p></td></tr></table>');
  assert.ok(out.split("\n").length > 4, "компактный HTML раскладывается по строкам");
  console.log("✓ /api/wb/pretty-html: читаемый HTML для UCC");
}
