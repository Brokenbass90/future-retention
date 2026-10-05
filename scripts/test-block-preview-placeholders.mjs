#!/usr/bin/env node
/**
 * test-block-preview-placeholders.mjs — в карточке каталога виден блок, а не скобки.
 *
 * Тонкое место, которое легко «починить» не там. В собранном письме
 * `{{embedded.company_address}}` и `${{ NS.block_01 }}$` ОСТАЮТСЯ: их
 * подставляет платформа рассылки и словарь локали. Трогать ради превью сборку
 * писем нельзя — это сломает рассылку.
 *
 * Поэтому проверяем ровно границу: сборка плейсхолдеры сохраняет, а картинка
 * каталога их не показывает. И третье, что ломается тихо: в блок добавили
 * новый `{{embedded.что-то}}`, а демо-значения для него нет — карточка снова
 * показывает скобки, и никто не замечает, пока дизайнер не пожалуется.
 *
 * Браузер здесь не нужен: скриншот не снимаем, проверяем HTML, из которого он
 * снимается. Exit 0 = pass.
 */
import {
  substitutePreviewPlaceholders,
  findLeftoverPlaceholders,
  previewPlaceholderDictionary,
} from "../src/block-previews.js";
import { composeEmailFromBlocks } from "../src/compose-email.js";
import { spawnSync } from "node:child_process";
import {
  existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";

const repoRoot = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const emailBase = path.join(repoRoot, "email-base");
let pass = 0, fail = 0;
const check = (name, cond, extra = "") => {
  if (cond) { pass++; console.log("  \x1b[32m✓\x1b[0m", name); }
  else { fail++; console.error(`  \x1b[31m✗ ${name}\x1b[0m ${extra}`); }
};

/* ─── 1. Подстановка ─────────────────────────────────────────────────────── */
{
  const dictionary = previewPlaceholderDictionary();
  check("словарь демо-значений читается", Object.keys(dictionary.embedded || {}).length > 3,
    JSON.stringify(Object.keys(dictionary.embedded || {})));

  const filled = substitutePreviewPlaceholders(
    "<p>{{embedded.company_address}}</p><p>${{ ns.block_01 }}$</p>"
  );
  check("адрес подставлен", filled.includes(dictionary.embedded.company_address), filled);
  check("перевод подставлен", filled.includes(dictionary.translation), filled);
  check("скобок не осталось", findLeftoverPlaceholders(filled).length === 0, filled);

  // Незнакомый ключ — самая частая будущая поломка: блок добавили, значение
  // забыли. Заглушка хотя бы читается как текст, а не как обломок шаблона.
  const unknown = substitutePreviewPlaceholders("<p>{{embedded.some_new_key}}</p>");
  check("незнакомый ключ читается по-человечески", unknown.includes("Some new key"), unknown);
  check("и скобок после него нет", findLeftoverPlaceholders(unknown).length === 0, unknown);

  // Сборка разводит соседние скобки внутри <style>, чтобы платформа рассылки
  // не приняла CSS за шаблон. Подстановка обязана это пережить.
  const spaced = substitutePreviewPlaceholders("<p>{ {embedded.company_email} }</p>");
  check("разведённые скобки тоже подставляются", spaced.includes(dictionary.embedded.company_email), spaced);

  check("пустой ввод безопасен", substitutePreviewPlaceholders("") === "");
  check("обычный текст не портится",
    substitutePreviewPlaceholders("<p>Просто текст</p>") === "<p>Просто текст</p>");
}

/* ─── 2. Все ключи блоков покрыты демо-значениями ────────────────────────── */
{
  // Ворота на будущее: новый {{embedded.x}} в блоке без демо-значения снова
  // превратит карточку в скобки. Пусть это ловится здесь, а не глазами.
  const dictionary = previewPlaceholderDictionary();
  const used = new Set();
  for (const source of ["canonical", "imported", "user"]) {
    const dir = path.join(repoRoot, "data", "block-library", source);
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".json")) continue;
      const text = readFileSync(path.join(dir, file), "utf8");
      for (const match of text.matchAll(/\{\{\s*embedded\.([A-Za-z0-9_]+)\s*\}\}/g)) used.add(match[1]);
    }
  }
  check("в блоках вообще есть embedded-плейсхолдеры", used.size > 0, String(used.size));
  const missing = [...used].filter((key) => !Object.prototype.hasOwnProperty.call(dictionary.embedded, key));
  check(
    "у каждого ключа из блоков есть демо-значение",
    missing.length === 0,
    missing.length ? `нет значений для: ${missing.join(", ")} — добавьте их в data/preview-placeholders.json` : "",
  );
}

/* ─── 3. Граница: письмо сохраняет плейсхолдеры, картинка — нет ──────────── */
{
  const sandbox = mkdtempSync(path.join(os.tmpdir(), "retkit-preview-ph-"));
  try {
    for (const item of ["vendor", "tools", "node_modules"]) {
      const src = path.join(emailBase, item);
      if (!existsSync(src)) continue;
      try { symlinkSync(src, path.join(sandbox, item), "dir"); } catch { /* уже есть */ }
    }

    // Футер — как раз тот блок, который в каталоге показывал скобки вместо
    // адреса компании и предупреждения о рисках.
    composeEmailFromBlocks({
      brand: "X_preview",
      mailName: "placeholder-check",
      blocks: [
        { uid: "o1", blockId: "sys-outer", parentUid: null, slotId: "root", slots: {} },
        { uid: "s1", blockId: "sys-section", parentUid: "o1", slotId: "sections", slots: {} },
        { uid: "t1", blockId: "sys-title", parentUid: "s1", slotId: "content", slots: { text: "Проверка" } },
        { uid: "f1", blockId: "sys-footer", parentUid: "o1", slotId: "sections", slots: {} },
      ],
      destRoot: sandbox,
      markBlocks: true,
      force: true,
    });

    const build = spawnSync(process.execPath, [
      "tools/build-mail.js", "--category", "X_preview", "--mail", "placeholder-check", "--locales", "en",
    ], { cwd: sandbox, stdio: ["ignore", "pipe", "pipe"], timeout: 180000 });
    const htmlPath = path.join(sandbox, "dist", "X_preview", "mail-placeholder-check", "en", "index.html");
    check("письмо собралось", build.status === 0 && existsSync(htmlPath),
      String(build.stderr || "").split("\n").filter(Boolean).slice(-1)[0] || "");

    if (existsSync(htmlPath)) {
      const built = readFileSync(htmlPath, "utf8");
      // Это НЕ баг: платформа рассылки подставит их сама. Если тут станет
      // пусто — значит кто-то «починил» превью в сборке, и в рассылку уйдёт
      // письмо без адреса компании.
      check("в собранном письме плейсхолдеры на месте", /\{\s?\{\s?embedded\./.test(built),
        built.slice(0, 0) || "сборка перестала их сохранять");

      const filled = substitutePreviewPlaceholders(built);
      const leftover = findLeftoverPlaceholders(filled);
      check("в картинке каталога плейсхолдеров нет", leftover.length === 0, leftover.join(", "));
      check("вместо них видно демо-текст",
        filled.includes(previewPlaceholderDictionary().embedded.company_address), "адрес не подставился");
      check("сам текст письма не пострадал", filled.includes("Проверка"));
    }
  } finally {
    try { rmSync(sandbox, { recursive: true, force: true }); }
    catch { console.log("  (песочница осталась во временной папке — удалите вручную)"); }
  }
}

/* ─── 4. Подключение в рендерере ─────────────────────────────────────────── */
{
  const renderer = readFileSync(path.join(repoRoot, "scripts", "render-block-previews.mjs"), "utf8");
  check("рендерер подставляет значения перед скриншотом",
    /substitutePreviewPlaceholders\(built\)/.test(renderer));
  check("снимок делается с отдельного файла, письмо не портится",
    /preview\.html/.test(renderer));
  check("остатки плейсхолдеров попадают в отчёт", /findLeftoverPlaceholders/.test(renderer));
}

console.log(`\nblock-preview-placeholders: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
