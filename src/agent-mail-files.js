/**
 * src/agent-mail-files.js — исходники открытого письма в руках у оператора.
 *
 * «Меняй стили рендера» — это не метафора: у каждого письма свои
 * `app/styles/*.styl` и `app/templates/*.pug`, и именно из них собирается
 * HTML. Оператор до этого видел только результат сборки и на просьбу
 * «поправь отступ» мог лишь переписать готовый HTML — правка жила до первой
 * пересборки и терялась.
 *
 * Здесь он работает с теми же файлами, что человек открывает в редакторе
 * кода: перечислить, прочитать, записать. Запись идёт через ту же дверь
 * (src/mail-store.js), что и всё остальное: замки, черновики и режим витрины
 * действуют и на агента — иначе он писал бы в письмо, которое человек прямо
 * сейчас правит.
 */
import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";
import path from "node:path";
import { mailPaths, assertMailWritable, MailStoreError } from "./mail-store.js";

/** Что в письме считается исходником. dist — вывод сборки, его не трогаем. */
const EDITABLE = new Set([".styl", ".pug", ".jade", ".css", ".txt", ".json", ".html"]);
const SKIP_DIRS = new Set(["dist", "node_modules", ".git"]);

function mailRoot(ctx) {
  const brand = String(ctx?.brand || "").trim();
  const mail = String(ctx?.mail || "").trim();
  if (!brand || !mail) {
    throw new MailStoreError("BAD_NAME", "Не понятно, какое письмо открыто: нет бренда или имени письма.");
  }
  return mailPaths(ctx.repoRoot, brand, mail).mailRoot;
}

/** Путь внутри письма — или отказ. Наружу не выпускаем. */
function resolveInside(root, relative) {
  const rel = String(relative || "").trim().replace(/^(?:\.\/)+/, "").replace(/^\/+/, "");
  if (!rel) throw new MailStoreError("BAD_NAME", "Не указан файл.");
  const abs = path.resolve(root, rel);
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    throw new MailStoreError("BAD_NAME", `Файл "${relative}" вне письма.`);
  }
  if (abs.split(path.sep).includes("dist")) {
    throw new MailStoreError("BAD_NAME", "dist — это вывод сборки, править нужно исходник.");
  }
  return abs;
}

/** Перечислить исходники письма. */
export function listMailFiles(args, ctx) {
  const root = mailRoot(ctx);
  if (!existsSync(root)) throw new MailStoreError("MAIL_NOT_FOUND", `Письмо не найдено: ${ctx.brand}/${ctx.mail}`);
  const files = [];
  const walk = (dir, depth = 0) => {
    if (depth > 5) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(abs, depth + 1); continue; }
      if (!EDITABLE.has(path.extname(entry.name).toLowerCase())) continue;
      files.push({
        file: path.relative(root, abs),
        lines: (() => { try { return readFileSync(abs, "utf8").split("\n").length; } catch { return null; } })(),
      });
    }
  };
  walk(root);
  files.sort((a, b) => a.file.localeCompare(b.file));
  return { brand: ctx.brand, mail: ctx.mail, count: files.length, files };
}

/** Прочитать исходник письма. */
export function readMailFile(args, ctx) {
  const root = mailRoot(ctx);
  const abs = resolveInside(root, args?.file);
  if (!existsSync(abs) || !statSync(abs).isFile()) {
    throw new MailStoreError("MAIL_NOT_FOUND", `Файл "${args?.file}" в письме не найден.`);
  }
  const all = readFileSync(abs, "utf8").split("\n");
  const from = Math.max(1, Number(args?.from) || 1);
  const count = Math.max(1, Math.min(Number(args?.lines) || 400, 1200));
  const slice = all.slice(from - 1, from - 1 + count);
  return {
    file: path.relative(root, abs),
    totalLines: all.length,
    from,
    to: Math.min(all.length, from + slice.length - 1),
    truncated: from + slice.length - 1 < all.length,
    text: slice.map((line, index) => `${from + index}\t${line}`).join("\n"),
  };
}

/**
 * Записать исходник письма.
 *
 * Пишем целиком, а не заплаткой: заплатка в stylus требует точного совпадения
 * отступов, а промах здесь стоит сломанной сборки всего письма. Файл целиком
 * агент уже прочитал.
 *
 * Права спрашиваем у общей двери: занято человеком — отказ с его именем,
 * витрина — отказ с объяснением. Агент не исключение.
 */
export async function writeMailFile(args, ctx, { writeFileSync }) {
  const root = mailRoot(ctx);
  const abs = resolveInside(root, args?.file);
  const content = String(args?.content ?? "");
  if (!content.trim()) throw new MailStoreError("BAD_NAME", "Пустое содержимое — это не правка, а стирание файла.");
  if (!existsSync(abs)) {
    throw new MailStoreError("MAIL_NOT_FOUND", `Файла "${args?.file}" в письме нет. Создание файлов идёт через студию.`);
  }
  await assertMailWritable(ctx.repoRoot, {
    brand: ctx.brand,
    mail: ctx.mail,
    actor: ctx.actor,
    readOnly: ctx.readOnly,
    reason: `правка ${path.relative(root, abs)} оператором`,
  });
  const before = readFileSync(abs, "utf8");
  writeFileSync(abs, content, "utf8");
  return {
    ok: true,
    file: path.relative(root, abs),
    linesBefore: before.split("\n").length,
    linesAfter: content.split("\n").length,
    note: "Письмо нужно пересобрать, чтобы правка попала в HTML.",
  };
}
