#!/usr/bin/env node
/**
 * test-mail-store.mjs — одна дверь к письмам.
 *
 * Смысл двери: пока путь к письму собирают в сорока местах, а пишут из
 * девяноста, ни замок «письмо занято», ни личный черновик, ни витрина
 * «только чтение» не работают — любая проверка живёт там, куда её вписали, а
 * остальные места пишут мимо неё.
 *
 * Поэтому проверяем ровно три обещания двери:
 *   1. имя письма снаружи не может увести запись за пределы базы;
 *   2. изменение проходит через проверку прав, и её МОЖНО подменить —
 *      иначе замки на следующем этапе придётся вписывать в каждый вызов;
 *   3. удаление не уничтожает работу безвозвратно, а dist не переживает
 *      письмо (иначе удалённое продолжает показываться в превью).
 *
 * Плюс живая проверка по HTTP: ручки клонирования, переименования и удаления
 * действительно ходят через дверь, а не мимо неё.
 *
 * Zero-AI. Диск — во временной папке; по HTTP работаем в X_assembled, который
 * и так вне репозитория. Exit 0 = pass.
 */
import {
  safeSegment,
  mailFolderName,
  mailShortName,
  mailPaths,
  mailFilePath,
  mailExists,
  listMails,
  writeMailFile,
  readMailFile,
  createMail,
  copyMail,
  renameMail,
  trashMail,
  assertMailWritable,
  setMailWriteGuard,
  mailStoreStatus,
  MailStoreError,
} from "../src/mail-store.js";
import { mkdtempSync, rmSync, existsSync, readdirSync, writeFileSync, mkdirSync, readFileSync, renameSync } from "node:fs";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import url from "node:url";

const repoRoot = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.MAIL_STORE_TEST_PORT || 3994);
let pass = 0, fail = 0;
const check = (name, cond, extra = "") => {
  if (cond) { pass++; console.log("  \x1b[32m✓\x1b[0m", name); }
  else { fail++; console.error(`  \x1b[31m✗ ${name}\x1b[0m ${extra}`); }
};
const caught = async (fn) => {
  try { await fn(); return null; } catch (error) { return error; }
};

/* ─── 1. Имена ───────────────────────────────────────────────────────────── */
{
  check("точки-точки вырезаются", safeSegment("../../etc") === "etc", safeSegment("../../etc"));
  check("слэши вырезаются", safeSegment("a/b") === "ab");
  check("пробелы и кириллица вырезаются", safeSegment("моё имя") === "");
  check("нормальное имя не портится", safeSegment("X_IQBroker") === "X_IQBroker");

  check("префикс добавляется", mailFolderName("welcome") === "mail-welcome");
  check("префикс не удваивается", mailFolderName("mail-welcome") === "mail-welcome");
  check("короткое имя без префикса", mailShortName("mail-welcome") === "welcome");
  check("пустое имя остаётся пустым", mailFolderName("   ") === "");
}

/* ─── 2. Пути ────────────────────────────────────────────────────────────── */
{
  const paths = mailPaths("/repo", "X_IQ", "welcome");
  check("папка письма собрана верно", paths.mailRoot === "/repo/email-base/X_IQ/mail-welcome", paths.mailRoot);
  check("знаем, где pug письма", paths.headerPug.endsWith("app/templates/blocks/header.pug"), paths.headerPug);
  check("знаем, где styl письма", paths.mainStyl.endsWith("app/styles/blocks/main.styl"), paths.mainStyl);
  check("dist лежит отдельно от исходников",
    paths.distRoot === "/repo/email-base/dist/X_IQ/mail-welcome", paths.distRoot);
  check("корзина у бренда своя", paths.trashRoot.endsWith("_trash/X_IQ"), paths.trashRoot);

  const noBrand = await caught(async () => mailPaths("/repo", "", "welcome"));
  check("без бренда — понятная ошибка", noBrand?.code === "BAD_NAME", String(noBrand?.message));

  // Главное обещание: имя приходит снаружи, и оно не должно уметь вывести
  // запись за пределы письма — ни через имя файла, ни через имя папки.
  const escape = await caught(async () => mailFilePath("/repo", "X_IQ", "welcome", "../../../../etc/passwd"));
  check("выход по ../ пресечён", escape?.code === "OUTSIDE_BASE", String(escape?.message));
  const absolute = await caught(async () => mailFilePath("/repo", "X_IQ", "welcome", "/etc/passwd"));
  check("абсолютный путь пресечён", absolute?.code === "OUTSIDE_BASE", String(absolute?.message));
  check("обычный путь внутри письма проходит",
    mailFilePath("/repo", "X_IQ", "welcome", "app/templates/index.pug")
      .endsWith("mail-welcome/app/templates/index.pug"));
  const sneaky = mailPaths("/repo", "X_IQ", "../../../etc");
  check("попытка сбежать через имя письма остаётся внутри базы",
    sneaky.mailRoot.startsWith("/repo/email-base/X_IQ/"), sneaky.mailRoot);
}

/* ─── 3. Изменения на диске ──────────────────────────────────────────────── */
{
  const root = mkdtempSync(path.join(os.tmpdir(), "retkit-mail-store-"));
  try {
    setMailWriteGuard(null);

    await createMail(root, { brand: "X_Test", mail: "welcome" });
    check("письмо заведено", mailExists(root, "X_Test", "welcome"));

    const again = await caught(() => createMail(root, { brand: "X_Test", mail: "welcome" }));
    check("поверх существующего не создаём", again?.code === "MAIL_EXISTS", String(again?.message));

    await writeMailFile(root, {
      brand: "X_Test", mail: "welcome",
      relative: "app/templates/blocks/header.pug",
      content: "h1 Привет",
    });
    check("файл письма записан", (await readMailFile(root, {
      brand: "X_Test", mail: "welcome", relative: "app/templates/blocks/header.pug",
    })) === "h1 Привет");

    const missing = await caught(() => readMailFile(root, {
      brand: "X_Test", mail: "welcome", relative: "app/templates/nope.pug",
    }));
    check("чтения несуществующего файла не выдумываем", missing?.code === "MAIL_NOT_FOUND");

    await copyMail(root, { brand: "X_Test", mail: "welcome", newName: "welcome-copy" });
    check("копия создана", mailExists(root, "X_Test", "welcome-copy"));
    check("оригинал на месте", mailExists(root, "X_Test", "welcome"));
    check("содержимое скопировано", (await readMailFile(root, {
      brand: "X_Test", mail: "welcome-copy", relative: "app/templates/blocks/header.pug",
    })) === "h1 Привет");

    const clash = await caught(() => copyMail(root, { brand: "X_Test", mail: "welcome", newName: "welcome-copy" }));
    check("копией не затираем чужую работу", clash?.code === "MAIL_EXISTS");

    const ghost = await caught(() => copyMail(root, { brand: "X_Test", mail: "нет-такого", newName: "x" }));
    check("копировать несуществующее нельзя", ghost?.code === "BAD_NAME" || ghost?.code === "MAIL_NOT_FOUND",
      String(ghost?.code));

    // dist переезжает вместе с письмом: иначе после переименования превью
    // показывает сборку под старым именем и выглядит это как «не сохранилось».
    const distDir = mailPaths(root, "X_Test", "welcome-copy").distRoot;
    mkdirSync(distDir, { recursive: true });
    writeFileSync(path.join(distDir, "index.html"), "<b>dist</b>");
    await renameMail(root, { brand: "X_Test", mail: "welcome-copy", newName: "welcome-final" });
    check("переименование сработало", mailExists(root, "X_Test", "welcome-final"));
    check("старого имени не осталось", !mailExists(root, "X_Test", "welcome-copy"));
    check("сборка переехала следом",
      existsSync(path.join(mailPaths(root, "X_Test", "welcome-final").distRoot, "index.html")));
    check("сборки под старым именем нет", !existsSync(distDir));

    const list = listMails(root, "X_Test").map((m) => m.name);
    check("письма перечисляются", list.join() === "welcome,welcome-final", list.join());

    const { trashDest } = await trashMail(root, { brand: "X_Test", mail: "welcome-final", now: 111 });
    check("письмо ушло из базы", !mailExists(root, "X_Test", "welcome-final"));
    check("но лежит в корзине, а не уничтожено", existsSync(trashDest), trashDest);
    check("в корзине его содержимое цело",
      existsSync(path.join(trashDest, "app", "templates", "blocks", "header.pug")));
    check("сборка удалённого письма тоже убрана",
      !existsSync(mailPaths(root, "X_Test", "welcome-final").distRoot));

    const gone = await caught(() => trashMail(root, { brand: "X_Test", mail: "welcome-final" }));
    check("удалить дважды нельзя", gone?.code === "MAIL_NOT_FOUND");
  } finally {
    setMailWriteGuard(null);
    rmSync(root, { recursive: true, force: true });
  }
}

/* ─── 4. Права на запись ─────────────────────────────────────────────────── */
{
  const root = mkdtempSync(path.join(os.tmpdir(), "retkit-mail-guard-"));
  try {
    const readOnly = await caught(() => writeMailFile(root, {
      brand: "X_Test", mail: "welcome", relative: "app/templates/index.pug",
      content: "p", readOnly: true,
    }));
    check("на витрине запись запрещена", readOnly?.code === "READ_ONLY", String(readOnly?.message));
    check("отказ объясняет, что делать", /Запустите студию у себя/.test(String(readOnly?.message)));
    check("на витрине файл не появился", !mailExists(root, "X_Test", "welcome"));

    // Ради этого проверка и вынесена наружу: на следующем этапе сюда встанут
    // замки, и ни одна вызывающая ручка не поменяется.
    const seen = [];
    setMailWriteGuard(async ({ paths, actor, reason }) => {
      seen.push({ mail: paths.mail, actor: actor?.name || "", reason });
      if (paths.mail === "mail-busy") {
        throw new MailStoreError("MAIL_LOCKED", "Письмо сейчас правит Саша");
      }
    });

    await createMail(root, { brand: "X_Test", mail: "free", actor: { name: "Коля" } });
    check("проверку прав вызывают при записи", seen.length === 1, JSON.stringify(seen));
    check("проверка знает, кто пишет", seen[0].actor === "Коля");
    check("проверка знает, зачем пишут", seen[0].reason === "создание письма", seen[0].reason);

    const busy = await caught(() => createMail(root, { brand: "X_Test", mail: "busy", actor: { name: "Коля" } }));
    check("занятое письмо не даёт себя менять", busy?.code === "MAIL_LOCKED", String(busy?.message));
    check("отказ называет, кто занял", /Саша/.test(String(busy?.message)));
    check("занятое письмо не создалось", !mailExists(root, "X_Test", "busy"));

    // Чтение остаётся свободным: смотреть чужое письмо можно всегда, иначе
    // второй человек не сможет даже понять, что там делает первый.
    await writeMailFile(root, {
      brand: "X_Test", mail: "free", relative: "app/templates/index.pug", content: "p ок",
    });
    setMailWriteGuard(async () => { throw new MailStoreError("MAIL_LOCKED", "занято"); });
    const text = await readMailFile(root, { brand: "X_Test", mail: "free", relative: "app/templates/index.pug" });
    check("занятое письмо можно читать", text === "p ок");
  } finally {
    setMailWriteGuard(null);
    rmSync(root, { recursive: true, force: true });
  }
}

/* ─── 5. Коды ошибок превращаются в понятные статусы ─────────────────────── */
{
  check("занято → 409", mailStoreStatus(new MailStoreError("MAIL_LOCKED", "x")) === 409);
  check("нет письма → 404", mailStoreStatus(new MailStoreError("MAIL_NOT_FOUND", "x")) === 404);
  check("витрина → 403", mailStoreStatus(new MailStoreError("READ_ONLY", "x")) === 403);
  check("кривое имя → 400", mailStoreStatus(new MailStoreError("BAD_NAME", "x")) === 400);
  check("чужая ошибка → 500", mailStoreStatus(new Error("бум")) === 500);
}

/* ─── 6. Ручки студии ходят через дверь ──────────────────────────────────── */
{
  const server = readFileSync(path.join(repoRoot, "server.js"), "utf8");
  check("клонирование идёт через дверь", /email-clone[\s\S]{0,400}await copyMail\(__dirname/.test(server));
  check("переименование идёт через дверь", /email-rename[\s\S]{0,400}await renameMail\(__dirname/.test(server));
  check("удаление идёт через дверь", /email-delete[\s\S]{0,400}await trashMail\(__dirname/.test(server));
  check("ручки знают, кто пришёл", (server.match(/actor: request\.retkitActor/g) || []).length >= 3);
  check("ручки знают про витрину", (server.match(/readOnly: studioRuntimeFlags\.readOnly/g) || []).length >= 3);
  check("коды ошибок превращаются в статусы", /mailStoreStatus\(e\)/.test(server));
  check("самодельной санитизации в этих ручках больше нет",
    !/const safe = s => s\.replace\(\/\\\.\\\.\/g/.test(server));
}

/* ─── 7. Живая проверка по HTTP ──────────────────────────────────────────── */
{
  const brand = "X_assembled";
  const base = path.join(repoRoot, "email-base", brand);
  // Имена уникальны для прогона: остаток от прошлого прогона (удалить его на
  // смонтированной ФС получается не всегда) не должен влиять на проверку.
  const stamp = `${process.pid}-${Date.now().toString(36)}`;
  const SEED = `doorway-${stamp}`;
  const COPY = `${SEED}-copy`;
  const FINAL = `${SEED}-final`;
  const names = [`mail-${SEED}`, `mail-${COPY}`, `mail-${FINAL}`];
  // Убирать за собой надо, но не любой ценой: на смонтированных файловых
  // системах удаление может быть запрещено, и тогда тест обязан отчитаться о
  // мусоре, а не рухнуть на уборке, потеряв результат проверки.
  const leftovers = [];
  const safeRemove = (target) => {
    if (!existsSync(target)) return;
    try {
      rmSync(target, { recursive: true, force: true });
    } catch {
      try {
        const aside = path.join(repoRoot, "email-base", "_trash", `__test-leftover-${Date.now()}-${path.basename(target)}`);
        mkdirSync(path.dirname(aside), { recursive: true });
        renameSync(target, aside);
        leftovers.push(aside);
      } catch {
        leftovers.push(target);
      }
    }
  };
  const cleanup = () => {
    for (const name of names) safeRemove(path.join(base, name));
    const trash = path.join(repoRoot, "email-base", "_trash", brand);
    if (existsSync(trash)) {
      for (const entry of readdirSync(trash)) {
        if (entry.startsWith(`mail-${SEED}`)) safeRemove(path.join(trash, entry));
      }
    }
  };
  cleanup();
  mkdirSync(path.join(base, `mail-${SEED}`, "app", "templates", "blocks"), { recursive: true });
  writeFileSync(path.join(base, `mail-${SEED}`, "app", "templates", "blocks", "header.pug"), "h1 дверь");

  const studio = spawn(process.execPath, ["server.js"], {
    cwd: repoRoot,
    env: { ...process.env, PORT: String(PORT), STUDIO_PUBLIC_DEMO: "0", APP_AUTH_ENABLED: "0", STUDIO_AI_ENABLED: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stop = () => { try { studio.kill("SIGTERM"); } catch { /* уже умер */ } };
  process.on("exit", stop);

  // Все запросы идут от ОДНОГО актёра — как из одного браузера с его cookie.
  // Без этого каждый запрос был бы новым человеком, и второй упирался бы в
  // замок, поставленный первым: проверяли бы не дверь, а замок.
  const ACTOR = "f".repeat(32);
  const post = async (url, body) => {
    const response = await fetch(`http://127.0.0.1:${PORT}${url}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-retkit-token": ACTOR },
      body: JSON.stringify(body),
    });
    return { status: response.status, data: await response.json().catch(() => ({})) };
  };

  const started = Date.now();
  let up = false;
  while (Date.now() - started < 40_000) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/healthz`);
      if (res.ok) { up = true; break; }
    } catch { /* поднимается */ }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }

  if (!up) {
    check("студия поднялась", false, "не дождались");
  } else {
    const clone = await post("/api/wb/email-clone", { brand, mail: `mail-${SEED}`, newName: COPY });
    check("клон по HTTP работает", clone.status === 200 && clone.data.ok === true, JSON.stringify(clone));
    check("копия появилась на диске", existsSync(path.join(base, `mail-${COPY}`)));

    const dup = await post("/api/wb/email-clone", { brand, mail: `mail-${SEED}`, newName: COPY });
    check("повторный клон отбит понятным статусом", dup.status === 409 && dup.data.code === "MAIL_EXISTS",
      JSON.stringify(dup));

    const bad = await post("/api/wb/email-clone", { brand, mail: `mail-${SEED}`, newName: "" });
    check("пустое имя отбито", bad.status === 400 && bad.data.code === "BAD_NAME", JSON.stringify(bad));

    const ren = await post("/api/wb/email-rename", { brand, mail: `mail-${COPY}`, newName: FINAL });
    check("переименование по HTTP работает", ren.status === 200, JSON.stringify(ren));
    check("новое имя на диске", existsSync(path.join(base, `mail-${FINAL}`)));
    check("старого имени нет", !existsSync(path.join(base, `mail-${COPY}`)));

    const del = await post("/api/wb/email-delete", { brand, mail: `mail-${FINAL}` });
    check("удаление по HTTP работает", del.status === 200, JSON.stringify(del));
    check("письмо ушло из базы", !existsSync(path.join(base, `mail-${FINAL}`)));
    const trash = path.join(repoRoot, "email-base", "_trash", brand);
    check("и лежит в корзине",
      existsSync(trash) && readdirSync(trash).some((e) => e.startsWith(`mail-${FINAL}__`)));

    const ghost = await post("/api/wb/email-delete", { brand, mail: `mail-${FINAL}` });
    check("удаление несуществующего → 404", ghost.status === 404, JSON.stringify(ghost));
  }

  stop();
  cleanup();
  if (leftovers.length) {
    console.log(`  (не удалось стереть ${leftovers.length} тестовых папок — они отложены в email-base/_trash)`);
  }
}

console.log(`\nmail-store: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
