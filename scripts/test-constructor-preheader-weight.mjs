// Конструктор: прехедер над письмом и жирность текста 400/700 из инспектора.
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { applyBlockAppearanceToPug } from "../src/compose-email.js";

const bold = applyBlockAppearanceToPug('table.row\n  tr\n    td\n      p.text(style="font-weight: 400") Hi\n      h2 Title', { font_weight: "700" });
assert.match(bold, /p\.text\(style="font-weight: 400;font-weight:700 !important"\)/, "жирный перекрывает 400 у абзаца");
assert.match(bold, /h2\(style="font-weight:700 !important"\)/, "и у заголовка");
assert.doesNotMatch(bold, /td\(style="font-weight/, "ячейки не трогаем");
assert.equal(applyBlockAppearanceToPug("p Hi", { font_weight: "900" }), "p Hi", "только 400 и 700");

const js = readFileSync(new URL("../public/constructor.js", import.meta.url), "utf8");
assert.ok(js.includes('data-weight="700"') && js.includes("entry.appearance.font_weight = btn.dataset.weight"), "переключатель жирности в инспекторе");
assert.ok(js.includes('row.id = "preheaderRow"') && js.includes('id="preheaderInput"'), "строка «Прехедер» над письмом");
const html = readFileSync(new URL("../public/constructor.html", import.meta.url), "utf8");
assert.ok(!html.includes('id="preheaderInput"'), "в шапке поля больше нет — оно над письмом");
const schema = readFileSync(new URL("../src/block-library-schema.js", import.meta.url), "utf8");
assert.match(schema, /"font_weight"/, "«Сохранить как мой блок» принимает жирность");
console.log("✓ прехедер над письмом; жирность 400/700 на текстовых узлах блока");

// Subject: поле подписано по-английски, берётся из локали и пишется в неё.
{
  const fs = await import('node:fs');
  const js = fs.readFileSync(new URL('../public/constructor.js', import.meta.url), 'utf8');
  const loc = fs.readFileSync(new URL('../public/constructor-locales.js', import.meta.url), 'utf8');
  const assert = (await import('node:assert/strict')).default;
  assert.ok(js.includes('<label for="subjectInput">Subject</label>'), 'label Subject');
  assert.ok(js.includes('<label for="preheaderInput">Preheader</label>'), 'label Preheader');
  assert.ok(js.includes('RetKitConstructorLocales.setSubject(code, subject.value)'), 'subject edit → locale');
  assert.ok(/function setSubject\(code, text\)/.test(loc) && /preheaderIndexFromTxt, setSubject/.test(loc), 'setSubject exported');
  console.log('ok subject label + per-locale subject');
}
