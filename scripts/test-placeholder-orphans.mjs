#!/usr/bin/env node
/**
 * Живой случай: RU создана и переведена, а плейсхолдеры встали только в 4 из
 * 7 блоков, и студия заблокировала применение «AI удалил большую часть текста».
 * Причины: (1) абзац «…contact {{embedded.company_email}}.» рассыпался на сирот,
 * (2) placeholderize брал локаль ДО нормализации этого же разговора,
 * (3) страж считал плейсхолдеры удалённым текстом. Zero-AI, без сети.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import url from "node:url";
import { buildAnchorUnits } from "../src/locale-conventions.js";
import { TOOL_HANDLERS } from "../src/ai-tools.js";

const repoRoot = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
let ok = 0, fail = 0;
const check = (name, cond, detail = "") => {
  if (cond) { ok += 1; console.log(`  ✓ ${name}`); } else { fail += 1; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
};

/* 1. Абзац с переменной и точкой — один юнит, даже когда блоки на разных строках */
{
  const txt = "{{Dear client,}}\n\n{{Should you have any questions, please do not hesitate to contact}}\n\n{{embedded.company_email}}\n\n{{.}}\n\n{{embedded.company_address}}\n\n{{embedded.risk_warning}}\n";
  const units = buildAnchorUnits(txt, "af");
  const para = units.find((u) => u.visibleText.startsWith("Should"));
  check("абзац собран целиком", para && para.visibleText === "Should you have any questions, please do not hesitate to contact {{embedded.company_email}}.", JSON.stringify(para?.visibleText));
  check("в замене оба текстовых блока и литерал переменной", para && para.replacement === "${{ af.block_01 }}$ {{embedded.company_email}}${{ af.block_03 }}$", JSON.stringify(para?.replacement));
  check("одиночной точки-сироты больше нет", !units.some((u) => u.visibleText === "."));
  check("адрес и риск остаются отдельными", units.filter((u) => /embedded\.(company_address|risk_warning)/.test(u.visibleText) && !u.hasText).length === 2);
  check("нумерация блоков не сдвинулась", JSON.stringify(units.map((u) => u.blockIndexes)) === JSON.stringify([[0], [1, 2, 3], [4], [5]]), JSON.stringify(units.map((u) => u.blockIndexes)));
}

/* 2. Инструменты видят правки этого же разговора */
{
  const ctx = {
    html: "<html><body><p>Hi</p></body></html>",
    namespaces: [{ name: "af", namespace: "af", locales: { en: ["Hello", "World"] }, localeRaw: { en: "{{Hello}} {{World}}\n" } }],
    pendingLocaleUpdates: [{ namespace: "af", locale: "ru", txt: "{{Привет}}\n\n{{Мир}}\n" }],
    pendingLocaleDeletes: [],
  };
  const ru = await TOOL_HANDLERS.get_namespace_blocks({ namespace: "af", locale: "ru" }, ctx);
  check("только что созданная RU видна", Array.isArray(ru.blocks) && ru.blocks.length === 2 && ru.staged === true, JSON.stringify(ru));
  const missing = await TOOL_HANDLERS.get_namespace_blocks({ namespace: "af", locale: "de" }, ctx);
  check("нет локали — говорит, какие есть", /locale not found/.test(missing.error || "") && missing.available.includes("ru"));
  ctx.pendingLocaleUpdates.push({ namespace: "af", locale: "en", txt: "{{Hello}}\n\n{{embedded.x}}\n\n{{World}}\n" });
  const en = await TOOL_HANDLERS.get_namespace_blocks({ namespace: "af", locale: "en" }, ctx);
  check("после нормализации читается нормализованная EN", en.blocks.length === 3, JSON.stringify(en.blocks));
  const report = await TOOL_HANDLERS.analyze_email({ namespace: "af", refLocale: "en" }, ctx);
  check("analyze_email не падает на новой локали", !report.error, JSON.stringify(report).slice(0, 160));
}

/* 3. Страж применения: плейсхолдеры — не удалённый текст */
{
  const wb = readFileSync(path.join(repoRoot, "public", "workbench.js"), "utf8");
  check("страж разворачивает плейсхолдеры перед сравнением", /function expandPlaceholdersForGuard/.test(wb) && /next\.bodyText = expandPlaceholdersForGuard\(next\.bodyText\)/.test(wb));
  const tools = readFileSync(path.join(repoRoot, "src", "ai-tools.js"), "utf8");
  check("placeholderize берёт текущую локаль", /const refTxt = currentLocaleTxt\(ctx, ns, refCode\);\s*\n\s*if \(!refTxt\)[^\n]*\n\s*const result = await placeholderizeHtml/.test(tools));
}

/* 4. Полный проход placeholderize (AI замокан): абзац со ссылкой встаёт целиком */
{
  const { placeholderizeHtml } = await import("../src/locale-ai.js");
  const refTxt = "{{Dear client,}}\n\n{{Should you have any questions, please do not hesitate to contact}}\n\n{{embedded.company_email}}\n\n{{.}}\n\n{{Terms and Conditions}}\n";
  const html = `<!DOCTYPE html><html><body><table><tr><td>
<p>Dear client,</p>
<p>Should you have any questions, please do not hesitate to contact <a href="mailto:{{embedded.company_email}}" style="color:#1a73e8">{{embedded.company_email}}</a>.</p>
<a href="https://x.example/terms">Terms and Conditions</a>
</td></tr></table></body></html>`;
  globalThis.__OPENAI_TEST_MOCK = async ({ body }) => {
    const user = body.input.find((m) => m.role === "user");
    const payload = JSON.parse(user.content[0].text);
    const refs = payload.refBlocks || payload.unmappedBlocks || [];
    const els = payload.elements || refs.flatMap((r) => r.candidates || []);
    const norm = (t) => String(t).replace(/\s+/g, " ").trim();
    const mappings = [];
    for (const rb of refs) {
      const el = els.find((e) => norm(e.text) === norm(rb.text));
      if (el) mappings.push({ blockIndex: rb.blockIndex, elementId: el.id, confidence: 0.95 });
    }
    return { output_text: JSON.stringify({ mappings }) };
  };
  const result = await placeholderizeHtml({ html, refLocaleTxt: refTxt, namespace: "af", apiKey: "test" });
  delete globalThis.__OPENAI_TEST_MOCK;
  check("все текстовые абзацы привязаны", result.missed === 0 || (Array.isArray(result.missed) && !result.missed.length), JSON.stringify(result.missed));
  check("абзац: текст → плейсхолдеры, ссылка с переменной цела",
    /\$\{\{ af\.block_01 \}\}\$ <a href="mailto:\{\{embedded\.company_email\}\}"[^>]*>\{\{embedded\.company_email\}\}<\/a>\$\{\{ af\.block_03 \}\}\$/.test(result.html),
    (result.html.match(/<p>Should[\s\S]*?<\/p>|<p>\$\{\{ af\.block_01[\s\S]*?<\/p>/) || [""])[0]);
  check("исходного английского текста абзаца в HTML не осталось", !/Should you have any questions/.test(result.html));
}

/* 5. Абзац + отдельная кнопка-ссылка внутри: оба блока, ссылка цела */
{
  const { placeholderizeHtml } = await import("../src/locale-ai.js");
  const refTxt = "{{Read the full terms}}\n\n{{click here}}\n";
  const html = `<html><body><p>Read the full terms <a href="https://x.example/t" style="color:red">click here</a></p></body></html>`;
  globalThis.__OPENAI_TEST_MOCK = async ({ body }) => {
    const payload = JSON.parse(body.input.find((m) => m.role === "user").content[0].text);
    const els = payload.elements || [];
    const p = els.find((e) => e.tag === "p");
    const a = els.find((e) => e.tag === "a");
    return { output_text: JSON.stringify({ mappings: payload.refBlocks ? [
      { blockIndex: 0, elementId: p.id, confidence: 0.9 },
      { blockIndex: 1, elementId: a.id, confidence: 0.9 },
    ] : [] }) };
  };
  const result = await placeholderizeHtml({ html, refLocaleTxt: refTxt, namespace: "t", apiKey: "test" });
  delete globalThis.__OPENAI_TEST_MOCK;
  check("абзац и ссылка — каждый своим плейсхолдером, href цел",
    result.html.includes('<p>${{ t.block_00 }}$ <a href="https://x.example/t" style="color:red">${{ t.block_01 }}$</a></p>'), result.html);
}

console.log(`\nplaceholder-orphans: ${ok} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
