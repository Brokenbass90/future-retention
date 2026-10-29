#!/usr/bin/env node
/**
 * test-mail-drafts.mjs — личный черновик и история письма.
 *
 * Черновик закрывает страх, который замок закрыть не может: «агент поменял в
 * общей базе не то, и я не знаю, что было раньше». Правки идут в личную копию,
 * общая база меняется один раз — по кнопке, с показом разницы.
 *
 * Что проверяем — ровно то, что дорого стоит, если сломается:
 *   1. правка в черновике НЕ видна в базе (иначе смысл теряется целиком);
 *   2. публикация поверх изменившейся базы ОТБИВАЕТСЯ: пока человек правил
 *      копию, кто-то мог поменять оригинал, и молча его затереть нельзя;
 *   3. прежняя версия сохраняется в историю и возвращается — «поменял не то»
 *      должно лечиться кнопкой, а не расследованием;
 *   4. откат тоже снимается: вернуть можно и то, что откатили по ошибке;
 *   5. черновики не показываются в списке писем — это чужая незаконченная
 *      копия, а не письмо базы.
 *
 * Zero-AI, диск во временной папке. Exit 0 = pass.
 */
import {
  draftFolderName,
  isDraftFolder,
  parseDraftFolder,
  ownerTag,
  mailFingerprint,
  openDraft,
  listDrafts,
  draftChanges,
  publishDraft,
  discardDraft,
  snapshotMail,
  listSnapshots,
  restoreSnapshot,
  withoutDrafts,
} from "../src/mail-drafts.js";
import {
  createMail,
  writeMailFile,
  readMailFile,
  mailExists,
  mailPaths,
  setMailWriteGuard,
  mailStoreStatus,
  MailStoreError,
} from "../src/mail-store.js";
import { createLeaseGuard } from "../src/mail-locks.js";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";

const repoRoot = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const check = (name, cond, extra = "") => {
  if (cond) { pass++; console.log("  \x1b[32m✓\x1b[0m", name); }
  else { fail++; console.error(`  \x1b[31m✗ ${name}\x1b[0m ${extra}`); }
};
const caught = async (fn) => {
  try { await fn(); return null; } catch (error) { return error; }
};
const read = (...parts) => readFileSync(path.join(repoRoot, ...parts), "utf8");

const KOLYA = { token: "a1b2c3d4".padEnd(32, "0"), name: "Коля", kind: "human" };
const SASHA = { token: "b2c3d4e5".padEnd(32, "0"), name: "Саша", kind: "human" };
const AGENT = { token: "c3d4e5f6".padEnd(32, "0"), name: "Коля", kind: "agent" };
const HEADER = "app/templates/blocks/header.pug";

/* ─── 1. Имена черновиков ────────────────────────────────────────────────── */
{
  const name = draftFolderName("welcome", KOLYA);
  check("черновик назван по письму и владельцу", name === "mail-welcome__draft-a1b2c3d4", name);
  check("черновик узнаётся по имени", isDraftFolder(name));
  check("обычное письмо черновиком не считается", !isDraftFolder("mail-welcome"));
  check("черновик черновика не плодится", draftFolderName(name, KOLYA) === name);

  const parsed = parseDraftFolder(name);
  check("из имени читается письмо", parsed.mail === "mail-welcome", JSON.stringify(parsed));
  check("из имени читается владелец", parsed.owner === "a1b2c3d4");
  check("у разных людей разные черновики",
    draftFolderName("welcome", KOLYA) !== draftFolderName("welcome", SASHA));
  check("метка владельца короткая", ownerTag(KOLYA).length === 8);
  check("метка — только начало токена, не весь токен",
    ownerTag(KOLYA).length < KOLYA.token.length && KOLYA.token.startsWith(ownerTag(KOLYA)));

  const noActor = (() => { try { draftFolderName("welcome", null); return ""; } catch (e) { return e.code; } })();
  check("безымянному черновик не заводится", noActor === "BAD_NAME", noActor);
}

/* ─── 2. Отпечаток письма ────────────────────────────────────────────────── */
{
  const root = mkdtempSync(path.join(os.tmpdir(), "retkit-drafts-fp-"));
  try {
    setMailWriteGuard(null);
    await createMail(root, { brand: "X_Test", mail: "welcome" });
    await writeMailFile(root, { brand: "X_Test", mail: "welcome", relative: HEADER, content: "h1 раз" });
    const first = mailFingerprint(root, "X_Test", "welcome");
    check("отпечаток считается", first.length === 40, first);

    await writeMailFile(root, { brand: "X_Test", mail: "welcome", relative: HEADER, content: "h1 раз" });
    check("та же запись — тот же отпечаток", mailFingerprint(root, "X_Test", "welcome") === first);

    await writeMailFile(root, { brand: "X_Test", mail: "welcome", relative: HEADER, content: "h1 два" });
    check("правка меняет отпечаток", mailFingerprint(root, "X_Test", "welcome") !== first);
    // Имя из букв и цифр, но такого письма нет: кириллицу дверь режет ещё
    // раньше, и это отдельная (тоже правильная) ошибка BAD_NAME.
    check("у несуществующего письма отпечатка нет", mailFingerprint(root, "X_Test", "missing-mail") === "");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/* ─── 3. Главное: правка в черновике не видна в базе ─────────────────────── */
{
  const root = mkdtempSync(path.join(os.tmpdir(), "retkit-drafts-"));
  setMailWriteGuard(createLeaseGuard());
  try {
    await createMail(root, { brand: "X_Test", mail: "welcome", actor: KOLYA });
    await writeMailFile(root, { brand: "X_Test", mail: "welcome", relative: HEADER, content: "h1 база", actor: KOLYA });

    const opened = await openDraft(root, { brand: "X_Test", mail: "welcome", actor: KOLYA });
    check("черновик создан копией письма", opened.created === true && mailExists(root, "X_Test", opened.draft.mail));
    check("в копии то же содержимое",
      (await readMailFile(root, { brand: "X_Test", mail: opened.draft.mail, relative: HEADER })) === "h1 база");

    await writeMailFile(root, {
      brand: "X_Test", mail: opened.draft.mail, relative: HEADER, content: "h1 черновик", actor: KOLYA,
    });
    check("база не тронута",
      (await readMailFile(root, { brand: "X_Test", mail: "welcome", relative: HEADER })) === "h1 база");

    const reopened = await openDraft(root, { brand: "X_Test", mail: "welcome", actor: KOLYA });
    check("повторное открытие не стирает работу", reopened.created === false);
    check("работа в черновике цела",
      (await readMailFile(root, { brand: "X_Test", mail: opened.draft.mail, relative: HEADER })) === "h1 черновик");

    const mine = listDrafts(root, KOLYA);
    check("черновик виден в своём списке", mine.length === 1, JSON.stringify(mine));
    check("видно, что он изменён", mine[0].changed === true);
    check("видно, что база не менялась", mine[0].baseChanged === false);
    check("чужие черновики в своём списке не видны", listDrafts(root, SASHA).length === 0);

    const changes = draftChanges(root, { brand: "X_Test", mail: "welcome", actor: KOLYA });
    check("разница названа поимённо", changes.changed.includes(HEADER), JSON.stringify(changes));
    check("лишнего в разнице нет", changes.total === 1, JSON.stringify(changes));

    // Публикация: база меняется один раз и с сохранением прежней версии.
    const published = await publishDraft(root, { brand: "X_Test", mail: "welcome", actor: KOLYA });
    check("публикация прошла", published.published === true);
    check("в базе теперь работа из черновика",
      (await readMailFile(root, { brand: "X_Test", mail: "welcome", relative: HEADER })) === "h1 черновик");
    check("черновик после публикации убран", !mailExists(root, "X_Test", opened.draft.mail));
    check("прежняя версия попала в историю", listSnapshots(root, { brand: "X_Test", mail: "welcome" }).length === 1);
  } finally {
    setMailWriteGuard(null);
    rmSync(root, { recursive: true, force: true });
  }
}

/* ─── 4. База изменилась, пока правили копию ─────────────────────────────── */
{
  const root = mkdtempSync(path.join(os.tmpdir(), "retkit-drafts-race-"));
  setMailWriteGuard(null); // здесь проверяем расхождение базы, а не замки
  try {
    await createMail(root, { brand: "X_Test", mail: "welcome", actor: KOLYA });
    await writeMailFile(root, { brand: "X_Test", mail: "welcome", relative: HEADER, content: "h1 было", actor: KOLYA });

    const opened = await openDraft(root, { brand: "X_Test", mail: "welcome", actor: KOLYA });
    await writeMailFile(root, {
      brand: "X_Test", mail: opened.draft.mail, relative: HEADER, content: "h1 моя правка", actor: KOLYA,
    });

    // Пока Коля правил копию, Саша поменял оригинал.
    await writeMailFile(root, {
      brand: "X_Test", mail: "welcome", relative: HEADER, content: "h1 Сашина правка", actor: SASHA,
    });

    const refused = await caught(() => publishDraft(root, { brand: "X_Test", mail: "welcome", actor: KOLYA }));
    check("публикация поверх изменившейся базы отбита", refused?.code === "BASE_CHANGED", String(refused?.message));
    check("отказ объясняет развилку", /перенести правки руками/.test(String(refused?.message)));
    check("к отказу приложена разница", Boolean(refused?.changes), JSON.stringify(refused?.changes || {}));
    check("Сашина работа цела",
      (await readMailFile(root, { brand: "X_Test", mail: "welcome", relative: HEADER })) === "h1 Сашина правка");

    check("в списке черновиков видно расхождение", listDrafts(root, KOLYA)[0].baseChanged === true);

    // Человек посмотрел разницу и решил публиковать поверх — это его право.
    const forced = await publishDraft(root, { brand: "X_Test", mail: "welcome", actor: KOLYA, force: true });
    check("по явной просьбе публикуем поверх", forced.published === true);
    check("в базе то, что опубликовали",
      (await readMailFile(root, { brand: "X_Test", mail: "welcome", relative: HEADER })) === "h1 моя правка");
    check("затёртая Сашина работа сохранена в историю",
      listSnapshots(root, { brand: "X_Test", mail: "welcome" }).length >= 1);
  } finally {
    setMailWriteGuard(null);
    rmSync(root, { recursive: true, force: true });
  }
}

/* ─── 5. История и откат ─────────────────────────────────────────────────── */
{
  const root = mkdtempSync(path.join(os.tmpdir(), "retkit-history-"));
  setMailWriteGuard(null);
  try {
    await createMail(root, { brand: "X_Test", mail: "welcome", actor: KOLYA });
    await writeMailFile(root, { brand: "X_Test", mail: "welcome", relative: HEADER, content: "h1 первое", actor: KOLYA });
    const snap = await snapshotMail(root, { brand: "X_Test", mail: "welcome", actor: KOLYA, now: 1000, note: "до правки" });
    check("снимок сделан", Boolean(snap?.at), JSON.stringify(snap));

    // Агент поменял не то — ровно тот случай, ради которого история заведена.
    await writeMailFile(root, {
      brand: "X_Test", mail: "welcome", relative: HEADER, content: "h1 агент напортил", actor: AGENT,
    });

    const history = listSnapshots(root, { brand: "X_Test", mail: "welcome" });
    check("история письма читается", history.length === 1, JSON.stringify(history));
    check("в истории записано, кто и зачем", history[0].by === "Коля" && history[0].note === "до правки");

    const restored = await restoreSnapshot(root, { brand: "X_Test", mail: "welcome", at: 1000, actor: KOLYA, now: 2000 });
    check("откат выполнен", restored.restored === true);
    check("вернулось то, что было",
      (await readMailFile(root, { brand: "X_Test", mail: "welcome", relative: HEADER })) === "h1 первое");
    check("перед откатом снят ещё один снимок",
      listSnapshots(root, { brand: "X_Test", mail: "welcome" }).length === 2);
    check("значит откат обратим",
      listSnapshots(root, { brand: "X_Test", mail: "welcome" }).some((entry) => /перед откатом/.test(entry.note || "")));

    const missing = await caught(() => restoreSnapshot(root, { brand: "X_Test", mail: "welcome", at: 999, actor: KOLYA }));
    check("несуществующий снимок — понятный отказ", missing?.code === "MAIL_NOT_FOUND");
  } finally {
    setMailWriteGuard(null);
    rmSync(root, { recursive: true, force: true });
  }
}

/* ─── 6. Отказ от черновика ──────────────────────────────────────────────── */
{
  const root = mkdtempSync(path.join(os.tmpdir(), "retkit-drafts-discard-"));
  setMailWriteGuard(null);
  try {
    await createMail(root, { brand: "X_Test", mail: "welcome", actor: KOLYA });
    await writeMailFile(root, { brand: "X_Test", mail: "welcome", relative: HEADER, content: "h1 база", actor: KOLYA });
    const opened = await openDraft(root, { brand: "X_Test", mail: "welcome", actor: KOLYA });
    await writeMailFile(root, {
      brand: "X_Test", mail: opened.draft.mail, relative: HEADER, content: "h1 мусор", actor: KOLYA,
    });

    await discardDraft(root, { brand: "X_Test", mail: "welcome", actor: KOLYA, now: 7 });
    check("черновик убран", !mailExists(root, "X_Test", opened.draft.mail));
    check("база не пострадала",
      (await readMailFile(root, { brand: "X_Test", mail: "welcome", relative: HEADER })) === "h1 база");
    // Отказ от черновика — не уничтожение: человек мог нажать не туда.
    const trash = mailPaths(root, "X_Test", "welcome").trashRoot;
    check("отказанная копия лежит в корзине",
      existsSync(path.join(trash, `${opened.draft.mail}__discarded-7`)), trash);
    check("в своём списке его больше нет", listDrafts(root, KOLYA).length === 0);

    const twice = await caught(() => discardDraft(root, { brand: "X_Test", mail: "missing-mail", actor: KOLYA }));
    check("отказ от несуществующего черновика — 404", twice?.code === "MAIL_NOT_FOUND");
  } finally {
    setMailWriteGuard(null);
    rmSync(root, { recursive: true, force: true });
  }
}

/* ─── 7. Черновики не засоряют список писем ──────────────────────────────── */
{
  const mails = [{ folder: "mail-welcome" }, { folder: "mail-welcome__draft-a1b2c3d4" }, { folder: "mail-promo" }];
  const clean = withoutDrafts(mails).map((entry) => entry.folder);
  check("черновик убран из списка писем", clean.join() === "mail-welcome,mail-promo", clean.join());
  check("статус BASE_CHANGED превращается в 409",
    mailStoreStatus(new MailStoreError("BASE_CHANGED", "x")) === 409);

  const server = read("server.js");
  check("список писем студии фильтрует черновики",
    (server.match(/!isDraftFolder\(/g) || []).length >= 3, String((server.match(/!isDraftFolder\(/g) || []).length));
  // Домен переехал в src/routes/workspace-routes.js — там и проверяем.
  const routes = read("src", "routes", "workspace-routes.js");
  check("есть ручки черновиков", /router\.prefix\("POST", "\/api\/drafts\/"/.test(routes));
  check("есть список своих черновиков", /listDrafts\(repoRoot, actor\)/.test(routes));
  check("публикация отдаёт разницу при расхождении", /changes: error\.changes/.test(routes));
  check("перезапись письма из конструктора делает снимок",
    /hadExistingOutput && force[\s\S]{0,300}snapshotMail\(__dirname/.test(server));
  check("черновики не уезжают в репозиторий",
    read(".gitignore").includes("mail-*__draft-*"));
}

/* ─── 8. Интерфейс говорит, с чем человек работает ───────────────────────── */
{
  // Черновик бесполезен, если про него не видно: можно неделю править копию,
  // думая, что правишь письмо базы, и удивиться ушедшей старой рассылке.
  const client = read("public", "mail-drafts.js");
  check("черновик узнаётся на клиенте по имени", /__draft-/.test(client));
  check("над черновиком висит полоса", /ваш черновик/.test(client));
  check("полоса предупреждает о расхождении базы", /изменилось с тех пор/.test(client));
  check("публикация спрашивает подтверждение", /window\.confirm/.test(client));
  check("при расхождении базы спрашивает отдельно", /BASE_CHANGED/.test(client));
  check("над оригиналом с черновиком тоже предупреждаем", /У вас есть черновик/.test(client));
  check("имена экранируются", /esc\(mail\)/.test(client));

  const wb = read("public", "workbench.js");
  check("воркбенч показывает состояние при открытии", /RetkitDrafts\?\.reflect\(brand, mail\)/.test(wb));
  check("после публикации письмо переоткрывается", /onPublished:/.test(wb));

  const lease = read("public", "mail-lease.js");
  check("занятое письмо предлагает черновик, а не безымянную копию",
    /RetkitDrafts[\s\S]{0,120}\.open\(brand, mail\)/.test(lease));
  check("кнопка названа по смыслу", /Работать в черновике/.test(lease));

  for (const page of ["constructor.html", "workbench.html"]) {
    check(`черновики подключены в ${page}`, read("public", page).includes('src="/mail-drafts.js"'));
  }
  check("у полосы черновика свой вид", read("public", "mail-lease.css").includes(".mail-draft-banner"));
}

console.log(`\nmail-drafts: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
