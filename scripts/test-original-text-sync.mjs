#!/usr/bin/env node
/**
 * test-original-text-sync.mjs — правка Original переносится в Pug.
 *
 * Проверяем ровно тот сценарий, ради которого это сделано: человек ставит
 * плейсхолдер ОДИН раз в Original, а перевод подтягивается во все локали.
 * Значит текст обязан уехать в Pug — иначе правка запирается внутри локали.
 *
 * И вторую половину: где переносить НЕЛЬЗЯ, движок обязан молчаливо
 * отказаться, а не портить письмо наугад.
 *
 * Zero-AI, без сети и файлов. Exit 0 = pass.
 */
import { visibleTextNodes, textEditsBetween, applyTextEditsToPug } from "../src/original-text-sync.js";
import { readFileSync } from "node:fs";
import path from "node:path";
import url from "node:url";

const repoRoot = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const check = (name, cond, extra = "") => {
  if (cond) { pass++; console.log("  \x1b[32m✓\x1b[0m", name); }
  else { fail++; console.error(`  \x1b[31m✗ ${name}\x1b[0m ${extra}`); }
};

const PAGE = (title, body) =>
  `<html><head><style>p{color:red}</style></head><body>` +
  `<div class="preheader">скрытая строка</div>` +
  `<p class="t">${title}</p><p class="b">${body}</p></body></html>`;

/* ─── 1. Что считается текстом ───────────────────────────────────────────── */
{
  const nodes = visibleTextNodes(PAGE("Заголовок письма", "Второй абзац"));
  check("берём только видимый текст", JSON.stringify(nodes) === JSON.stringify(["Заголовок письма", "Второй абзац"]), JSON.stringify(nodes));
  check("preheader не считается текстом письма", !nodes.some((t) => t.includes("скрытая")));
  check("содержимое <style> не считается текстом", !nodes.some((t) => t.includes("color")));
}

/* ─── 2. Главный сценарий: плейсхолдер вместо текста ─────────────────────── */
{
  const before = PAGE("Заголовок письма", "Второй абзац");
  const after = PAGE("${{ NS.block_00 }}$", "Второй абзац");
  const edits = textEditsBetween(before, after);
  check("нашли ровно одну правку", edits.length === 1, JSON.stringify(edits));
  check("правка — это подстановка плейсхолдера",
    edits[0]?.from === "Заголовок письма" && edits[0]?.to === "${{ NS.block_00 }}$");

  const pug = 'p.sys-title--h1(style="") Заголовок письма\np.sys-text--p(style="") Второй абзац';
  const result = applyTextEditsToPug(pug, edits);
  check("плейсхолдер уехал в Pug", result.pug.includes("p.sys-title--h1(style=\"\") ${{ NS.block_00 }}$"), result.pug);
  check("соседний текст не тронут", result.pug.includes("Второй абзац"));
  check("отчёт говорит, что применено", result.applied.length === 1 && result.skipped.length === 0);
}

/* ─── 3. Где переносить нельзя — не переносим ────────────────────────────── */
{
  // Одинаковый текст дважды: какое место имел в виду человек — неизвестно.
  const twice = applyTextEditsToPug("p.a Привет\np.b Привет", [{ from: "Привет", to: "Пока" }]);
  check("неоднозначную замену пропускаем", twice.applied.length === 0 && twice.skipped.length === 1);
  check("и объясняем причину", /встречается в Pug 2/.test(twice.skipped[0].reason), twice.skipped[0]?.reason);
  check("Pug при этом не изменился", twice.pug === "p.a Привет\np.b Привет");

  const missing = applyTextEditsToPug("p.a Другое", [{ from: "Привет", to: "Пока" }]);
  check("текста нет в Pug — пропускаем", missing.applied.length === 0 && missing.skipped.length === 1);

  // Структура изменилась — значит правили не текст, а разметку.
  const structural = textEditsBetween(PAGE("A", "B"), "<html><body><p>A</p></body></html>");
  check("смена структуры не даёт правок текста", structural.length === 0, JSON.stringify(structural));

  check("пустой ввод безопасен", textEditsBetween("", "").length === 0);
}

/* ─── 4. Подключение ─────────────────────────────────────────────────────── */
{
  const server = readFileSync(path.join(repoRoot, "server.js"), "utf8");
  const wb = readFileSync(path.join(repoRoot, "public", "workbench.js"), "utf8");
  check("есть endpoint переноса", /\/api\/wb\/sync-original-text/.test(server));
  check("endpoint пишет header.pug", /app\/templates\/blocks\/header\.pug/.test(server));
  check("клиент отличает Original от локали", /function isOriginalHtmlLocale\(/.test(wb));
  check("правка Original идёт в Pug, а не в override",
    /if \(isOriginalHtmlLocale\(ctx\)\) \{\s*\n\s*syncOriginalTextToPug\(ctx\)/.test(wb));
  check("после переноса письмо пересобирается",
    /syncOriginalTextToPug[\s\S]*rebuildSourceEmail/.test(wb));
}

console.log(`\noriginal-text-sync: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
