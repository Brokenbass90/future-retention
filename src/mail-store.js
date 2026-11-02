/**
 * src/mail-store.js — единственная дверь к файлам писем.
 *
 * Зачем она нужна. Раньше путь к письму собирали в сорока местах, а писали в
 * него из девяноста. Пока это так, нельзя ни занять письмо («его сейчас правит
 * Коля»), ни увести правку в личный черновик, ни включить витрину только для
 * чтения: любая такая проверка живёт ровно там, куда её вписали, а остальные
 * восемьдесят девять мест продолжают писать мимо.
 *
 * Поэтому здесь собраны три вещи, которые раньше были размазаны:
 *   1. как называется папка письма и что внутри неё лежит (mailPaths);
 *   2. кому сейчас можно писать в это письмо (assertMailWritable);
 *   3. сами изменения: создать, записать файл, скопировать, переименовать,
 *      убрать в корзину.
 *
 * Проверка «можно ли писать» вынесена в отдельную заменяемую функцию (guard)
 * нарочно: на следующем этапе туда встанут замки на письма, и ни один
 * вызывающий код от этого не поменяется.
 *
 * Ошибки бросаются с кодом — сервер превращает код в понятный HTTP-статус, а
 * не в безликую пятисотку.
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { cp, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export const MAIL_PREFIX = "mail-";

export class MailStoreError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "MailStoreError";
    this.code = code;
    Object.assign(this, details);
  }
}

/** Код ошибки → HTTP-статус. Одно место, чтобы ручки отвечали одинаково. */
export const MAIL_STORE_STATUS = Object.freeze({
  BAD_NAME: 400,
  MAIL_NOT_FOUND: 404,
  MAIL_EXISTS: 409,
  MAIL_LOCKED: 409,
  READ_ONLY: 403,
  OUTSIDE_BASE: 400,
  // База изменилась, пока человек правил копию: это не ошибка, а развилка —
  // публиковать поверх или перенести правки руками. Решает человек.
  BASE_CHANGED: 409,
});

export function mailStoreStatus(error) {
  return MAIL_STORE_STATUS[error?.code] || 500;
}

/* ─── Имена и пути ────────────────────────────────────────────────────────── */

/**
 * Безопасный кусок пути.
 *
 * Имена брендов и писем приходят из запроса, то есть снаружи. Отрезаем всё,
 * кроме букв, цифр, дефиса и подчёркивания: так `..` и слэш не превратятся в
 * выход за пределы базы, и это не зависит от того, вспомнил ли о проверке
 * автор конкретной ручки.
 */
export function safeSegment(value) {
  return String(value ?? "").replace(/\.\./g, "").replace(/[^a-zA-Z0-9_\-]/g, "");
}

/** Имя папки письма. Принимаем и «welcome», и «mail-welcome» — кладём одинаково. */
export function mailFolderName(mail) {
  const safe = safeSegment(mail);
  if (!safe) return "";
  return safe.startsWith(MAIL_PREFIX) ? safe : `${MAIL_PREFIX}${safe}`;
}

/** Короткое имя письма без служебного префикса — то, что видит человек. */
export function mailShortName(mail) {
  const safe = safeSegment(mail);
  return safe.startsWith(MAIL_PREFIX) ? safe.slice(MAIL_PREFIX.length) : safe;
}

export function emailBaseRoot(repoRoot) {
  return path.join(repoRoot, "email-base");
}

/**
 * Все пути одного письма.
 *
 * Раньше каждый вызывающий собирал `app/templates/blocks/header.pug` сам, и
 * расхождения вылезали молча. Теперь структура описана один раз здесь.
 */
export function mailPaths(repoRoot, brand, mail) {
  const safeBrand = safeSegment(brand);
  const folder = mailFolderName(mail);
  if (!safeBrand || !folder) {
    throw new MailStoreError("BAD_NAME", "Нужны бренд и имя письма", { brand, mail });
  }
  const base = emailBaseRoot(repoRoot);
  const mailRoot = path.join(base, safeBrand, folder);
  const templatesRoot = path.join(mailRoot, "app", "templates");
  const stylesRoot = path.join(mailRoot, "app", "styles");
  return {
    base,
    brand: safeBrand,
    mail: folder,
    shortName: mailShortName(folder),
    mailRoot,
    appRoot: path.join(mailRoot, "app"),
    templatesRoot,
    blocksDir: path.join(templatesRoot, "blocks"),
    helpersDir: path.join(templatesRoot, "helpers"),
    indexPug: path.join(templatesRoot, "index.pug"),
    headerPug: path.join(templatesRoot, "blocks", "header.pug"),
    stylesRoot,
    mainStyl: path.join(stylesRoot, "blocks", "main.styl"),
    distRoot: path.join(base, "dist", safeBrand, folder),
    trashRoot: path.join(base, "_trash", safeBrand),
  };
}

/** Путь внутри письма — с гарантией, что он не ведёт наружу. */
export function mailFilePath(repoRoot, brand, mail, relative) {
  const paths = mailPaths(repoRoot, brand, mail);
  const target = path.resolve(paths.mailRoot, String(relative || ""));
  const inside = path.relative(paths.mailRoot, target);
  if (!inside || inside.startsWith("..") || path.isAbsolute(inside)) {
    throw new MailStoreError("OUTSIDE_BASE", "Путь ведёт за пределы письма", { relative });
  }
  return target;
}

export function mailExists(repoRoot, brand, mail) {
  try {
    return existsSync(mailPaths(repoRoot, brand, mail).mailRoot);
  } catch {
    return false;
  }
}

/** Письма бренда. Порядок — по имени, чтобы список не прыгал между заходами. */
export function listMails(repoRoot, brand) {
  const safeBrand = safeSegment(brand);
  const brandRoot = path.join(emailBaseRoot(repoRoot), safeBrand);
  if (!safeBrand || !existsSync(brandRoot)) return [];
  return readdirSync(brandRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(MAIL_PREFIX))
    .map((entry) => ({
      folder: entry.name,
      name: mailShortName(entry.name),
      brand: safeBrand,
      mtimeMs: safeMtime(path.join(brandRoot, entry.name)),
    }))
    .sort((a, b) => a.folder.localeCompare(b.folder));
}

function safeMtime(target) {
  try { return statSync(target).mtimeMs; } catch { return 0; }
}

/* ─── Кому сейчас можно писать ────────────────────────────────────────────── */

/**
 * Сюда на следующем этапе встанут замки: «письмо занято другим актёром».
 * Пока проверяем то, что уже есть: режим только для чтения и корректность имён.
 *
 * Заменяется через setMailWriteGuard — ровно чтобы замки появились, не трогая
 * ни одного вызывающего.
 */
let writeGuard = null;

export function setMailWriteGuard(guard) {
  writeGuard = typeof guard === "function" ? guard : null;
}

/**
 * Разрешено ли этому актёру менять это письмо.
 *
 * @param {object} options.actor  кто пишет (см. src/actor.js)
 * @param {boolean} options.readOnly  витрина: никто не пишет
 */
export async function assertMailWritable(repoRoot, { brand, mail, actor = null, readOnly = false, reason = "" } = {}) {
  const paths = mailPaths(repoRoot, brand, mail);
  if (readOnly) {
    throw new MailStoreError(
      "READ_ONLY",
      "Это витрина студии — здесь можно смотреть и собирать, но не сохранять. " +
      "Запустите студию у себя, чтобы работать с письмами."
    );
  }
  if (writeGuard) await writeGuard({ repoRoot, paths, actor, reason });
  return paths;
}

/* ─── Изменения ───────────────────────────────────────────────────────────── */

/** Записать файл внутри письма, создав недостающие папки. */
export async function writeMailFile(repoRoot, { brand, mail, relative, content, actor, readOnly } = {}) {
  await assertMailWritable(repoRoot, { brand, mail, actor, readOnly, reason: `запись ${relative}` });
  const target = mailFilePath(repoRoot, brand, mail, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content, "utf8");
  return target;
}

/** Прочитать файл письма. Чтение не требует прав: смотреть можно всем. */
export async function readMailFile(repoRoot, { brand, mail, relative } = {}) {
  const target = mailFilePath(repoRoot, brand, mail, relative);
  if (!existsSync(target)) {
    throw new MailStoreError("MAIL_NOT_FOUND", `В письме нет файла ${relative}`, { relative });
  }
  return readFile(target, "utf8");
}

/** Завести папку письма. Существующее не трогаем — это всегда чья-то работа. */
export async function createMail(repoRoot, { brand, mail, actor, readOnly } = {}) {
  const paths = await assertMailWritable(repoRoot, { brand, mail, actor, readOnly, reason: "создание письма" });
  if (existsSync(paths.mailRoot)) {
    throw new MailStoreError("MAIL_EXISTS", `Письмо ${paths.mail} уже есть в ${paths.brand}`, { paths });
  }
  await mkdir(paths.templatesRoot, { recursive: true });
  return paths;
}

/** Копия письма под новым именем. */
export async function copyMail(repoRoot, { brand, mail, newName, actor, readOnly } = {}) {
  const source = mailPaths(repoRoot, brand, mail);
  if (!existsSync(source.mailRoot)) {
    throw new MailStoreError("MAIL_NOT_FOUND", `Письмо ${source.mail} не найдено`, { paths: source });
  }
  const target = await assertMailWritable(repoRoot, { brand, mail: newName, actor, readOnly, reason: "копирование" });
  if (existsSync(target.mailRoot)) {
    throw new MailStoreError("MAIL_EXISTS", `Письмо ${target.mail} уже есть`, { paths: target });
  }
  await cp(source.mailRoot, target.mailRoot, { recursive: true });
  return { source, target };
}

/**
 * Переименование.
 *
 * Права спрашиваем на ОБА имени: исходное могут прямо сейчас править, а под
 * новым именем может лежать чужая работа.
 */
export async function renameMail(repoRoot, { brand, mail, newName, actor, readOnly } = {}) {
  const source = await assertMailWritable(repoRoot, { brand, mail, actor, readOnly, reason: "переименование" });
  if (!existsSync(source.mailRoot)) {
    throw new MailStoreError("MAIL_NOT_FOUND", `Письмо ${source.mail} не найдено`, { paths: source });
  }
  const target = await assertMailWritable(repoRoot, { brand, mail: newName, actor, readOnly, reason: "переименование" });
  if (existsSync(target.mailRoot)) {
    throw new MailStoreError("MAIL_EXISTS", `Письмо ${target.mail} уже есть`, { paths: target });
  }
  await rename(source.mailRoot, target.mailRoot);
  await moveDist(source, target);
  return { source, target };
}

async function moveDist(source, target) {
  if (!existsSync(source.distRoot)) return;
  await mkdir(path.dirname(target.distRoot), { recursive: true });
  await rename(source.distRoot, target.distRoot).catch(() => {});
}

/**
 * Убрать письмо в корзину.
 *
 * Именно в корзину, а не в rm: письмо — это чья-то работа, и «удалил не то»
 * должно чиниться возвратом папки, а не восстановлением из памяти. Собранный
 * dist уносим следом, иначе удалённое письмо продолжает показываться в превью.
 */
export async function trashMail(repoRoot, { brand, mail, actor, readOnly, now = Date.now() } = {}) {
  const paths = await assertMailWritable(repoRoot, { brand, mail, actor, readOnly, reason: "удаление" });
  if (!existsSync(paths.mailRoot)) {
    throw new MailStoreError("MAIL_NOT_FOUND", `Письмо ${paths.mail} не найдено`, { paths });
  }
  await mkdir(paths.trashRoot, { recursive: true });
  const trashDest = path.join(paths.trashRoot, `${paths.mail}__${now}`);
  await rename(paths.mailRoot, trashDest);
  if (existsSync(paths.distRoot)) {
    await rename(paths.distRoot, `${trashDest}__dist`).catch(() => {});
  }
  return { paths, trashDest };
}
