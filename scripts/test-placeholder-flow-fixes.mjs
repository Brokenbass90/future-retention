// Плейсхолдеры через Original: одинаковые тексты и кривой код локали.
import assert from "node:assert/strict";
import { textEditsBetween, applyTextEditsToPug } from "../src/original-text-sync.js";
import { planWorkbenchLocaleSync, recoverLocaleCode } from "../src/workbench-localization.js";

// 1. «Title text» в двух блоках: заменили второй — меняется второй в Pug.
{
  const pug = "td.hero\n  h1 Title text\n  p Body text\ntd.card\n  h2 Title text\n  p Step one text\n";
  const before = "<body><h1>Title text</h1><p>Body text</p><h2>Title text</h2><p>Step one text</p></body>";
  const after = before.replace("<h2>Title text</h2>", "<h2>${{ aff-contest.block_04 }}$</h2>");
  const edits = textEditsBetween(before, after);
  assert.equal(edits.length, 1);
  assert.equal(edits[0].ordinal, 1);
  assert.equal(edits[0].total, 2);
  const out = applyTextEditsToPug(pug, edits);
  assert.equal(out.skipped.length, 0, JSON.stringify(out.skipped));
  assert.match(out.pug, /h1 Title text/, "first stays");
  assert.match(out.pug, /h2 \$\{\{ aff-contest\.block_04 \}\}\$/, "second replaced");
}

// 2. Оба заменили разными ключами — оба на своих местах.
{
  const pug = "h1 Title text\nh2 Title text\n";
  const before = "<body><h1>Title text</h1><h2>Title text</h2></body>";
  const after = "<body><h1>${{ ns.block_02 }}$</h1><h2>${{ ns.block_04 }}$</h2></body>";
  const out = applyTextEditsToPug(pug, textEditsBetween(before, after));
  assert.equal(out.pug, "h1 ${{ ns.block_02 }}$\nh2 ${{ ns.block_04 }}$\n");
}

// 3. В Pug текст есть ещё где-то (комментарий) — число не сходится, честный пропуск.
{
  const pug = "//- Title text\nh1 Title text\nh2 Title text\n";
  const before = "<body><h1>Title text</h1><h2>Title text</h2></body>";
  const after = "<body><h1>Title text</h1><h2>X</h2></body>";
  const out = applyTextEditsToPug(pug, textEditsBetween(before, after));
  assert.equal(out.applied.length, 0);
  assert.match(out.skipped[0].reason, /3 раза, а в письме 2/);
}

// 4. Одиночный текст — как раньше.
{
  const out = applyTextEditsToPug("p Body text\n", textEditsBetween("<p>Body text</p>", "<p>${{ ns.block_03 }}$</p>"));
  assert.equal(out.pug, "p ${{ ns.block_03 }}$\n");
}

// 5. Имя файла вместо кода локали больше не роняет сборку.
{
  assert.equal(recoverLocaleCode("1589_cn_cn_approved"), "cn");
  assert.equal(recoverLocaleCode("ar_KW"), "ar_KW");
  assert.equal(recoverLocaleCode("12345"), null);
  const plan = planWorkbenchLocaleSync([{ name: "aff-contest", locales: { en: ["A"], "1589_cn_cn_approved": ["B"], "999": ["C"] } }]);
  assert.deepEqual(plan.locales, ["cn", "en"]);
  assert.deepEqual(plan.renamedLocales, [{ namespace: "aff-contest", from: "1589_cn_cn_approved", to: "cn" }]);
  assert.equal(plan.skippedLocales.length, 1);
  // Уже есть настоящая cn — кривую дублирующую пропускаем, а не перетираем.
  const dup = planWorkbenchLocaleSync([{ name: "n", locales: { cn: ["real"], "1589_cn_cn_approved": ["file"] } }]);
  assert.equal(dup.entries.find((e) => e.locale === "cn").payload.block_00, "real");
}

console.log("✓ placeholder flow: duplicate texts by order, bad locale codes recovered");
