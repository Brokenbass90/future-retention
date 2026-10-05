#!/usr/bin/env node
/**
 * test-mail-locks.mjs — замок «письмо сейчас правит Коля».
 *
 * Беда, от которой этот замок, тихая: двое открыли одно письмо, оба сохранили,
 * работа первого исчезла — и никакой ошибки при этом не было. Поэтому
 * проверяем не «функция вызывается», а именно исчезновение работы.
 *
 * Четыре обещания:
 *   1. чужая запись в занятое письмо ОТКАЗЫВАЕТСЯ, а файл остаётся прежним;
 *   2. брошенная лиза протухает — иначе закрытая вкладка запирает письмо
 *      навсегда, и это хуже, чем изредка перехваченное письмо;
 *   3. читать занятое письмо можно всегда;
 *   4. отказ называет, кто занял и когда был жив, — «409» человеку не поможет.
 *
 * И отдельно — про агента: у человека локально два актёра, он сам и его Клод.
 * Замок обязан различать их, иначе агент молча перепишет открытое письмо.
 *
 * Zero-AI, диск во временной папке + живая проверка по HTTP. Exit 0 = pass.
 */
import {
  LEASE_TTL_MS,
  WRITE_LEASE_TTL_MS,
  takeLease,
  refreshLease,
  releaseLease,
  readLease,
  listLeases,
  publicLease,
  leaseMessage,
  describeAge,
  createLeaseGuard,
} from "../src/mail-locks.js";
import {
  setMailWriteGuard,
  writeMailFile,
  readMailFile,
  createMail,
  trashMail,
  mailExists,
} from "../src/mail-store.js";
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync, writeFileSync, renameSync } from "node:fs";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import url from "node:url";

const repoRoot = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.MAIL_LOCKS_TEST_PORT || 3995);
let pass = 0, fail = 0;
const check = (name, cond, extra = "") => {
  if (cond) { pass++; console.log("  \x1b[32m✓\x1b[0m", name); }
  else { fail++; console.error(`  \x1b[31m✗ ${name}\x1b[0m ${extra}`); }
};
const caught = async (fn) => {
  try { await fn(); return null; } catch (error) { return error; }
};

const KOLYA = { token: "a".repeat(32), name: "Коля", kind: "human" };
const SASHA = { token: "b".repeat(32), name: "Саша", kind: "human" };
const AGENT = { token: "c".repeat(32), name: "Коля", kind: "agent" };

/* ─── 1. Возраст словами ─────────────────────────────────────────────────── */
{
  check("только что", describeAge(1_000) === "прямо сейчас");
  check("секунды", describeAge(30_000) === "30 секунд назад", describeAge(30_000));
  check("минуты", describeAge(5 * 60_000) === "5 мин назад", describeAge(5 * 60_000));
  check("часы", describeAge(2 * 3600_000) === "2 ч назад", describeAge(2 * 3600_000));
}

/* ─── 2. Лиза ────────────────────────────────────────────────────────────── */
{
  const root = mkdtempSync(path.join(os.tmpdir(), "retkit-locks-"));
  try {
    const t0 = 1_000_000;
    takeLease(root, { brand: "X_Test", mail: "welcome", actor: KOLYA, now: t0 });
    const live = readLease(root, { brand: "X_Test", mail: "welcome", now: t0 + 1000 });
    check("лиза записана", live?.token === KOLYA.token);
    check("в лизе есть имя для баннера", live.displayName === "Коля");

    const stolen = await caught(async () =>
      takeLease(root, { brand: "X_Test", mail: "welcome", actor: SASHA, now: t0 + 1000 }));
    check("чужую живую лизу не отдаём", stolen?.code === "MAIL_LOCKED", String(stolen?.message));
    check("отказ называет имя", /Коля/.test(String(stolen?.message)), String(stolen?.message));
    check("отказ говорит, когда был жив", /назад|прямо сейчас/.test(String(stolen?.message)));
    check("отказ подсказывает выход", /копию/.test(String(stolen?.message)));
    check("в отказе есть данные держателя", stolen?.holder?.name === "Коля");

    const again = takeLease(root, { brand: "X_Test", mail: "welcome", actor: KOLYA, now: t0 + 2000 });
    check("своя лиза продлевается", again.heartbeatAt === t0 + 2000);
    check("время начала не сбрасывается", again.takenAt === t0);

    // Брошенная вкладка не должна запирать письмо навсегда.
    check("после TTL лиза протухла",
      readLease(root, { brand: "X_Test", mail: "welcome", now: t0 + 2000 + LEASE_TTL_MS + 1 }) === null);
    const afterExpiry = takeLease(root, {
      brand: "X_Test", mail: "welcome", actor: SASHA, now: t0 + 2000 + LEASE_TTL_MS + 1,
    });
    check("освободившееся письмо занимает другой", afterExpiry.token === SASHA.token);

    // Перехват возможен, но только явным действием: «ушёл в отпуск с открытой
    // вкладкой» бывает чаще, чем хотелось бы.
    const forced = takeLease(root, {
      brand: "X_Test", mail: "welcome", actor: KOLYA, now: t0 + 2000 + LEASE_TTL_MS + 2, force: true,
    });
    check("перехват по явной просьбе работает", forced.token === KOLYA.token);

    // Часы здесь синтетические (t0), поэтому и отпускаем в том же времени:
    // с реальным Date.now() лиза выглядела бы протухшей, и проверка «чужую
    // отпустить нельзя» прошла бы по неверной причине.
    const releaseMoment = t0 + 2000 + LEASE_TTL_MS + 3;
    const notMine = releaseLease(root, { brand: "X_Test", mail: "welcome", actor: SASHA, now: releaseMoment });
    check("чужую лизу отпустить нельзя", notMine.released === false && notMine.reason === "лиза чужая",
      JSON.stringify(notMine));
    const mine = releaseLease(root, { brand: "X_Test", mail: "welcome", actor: KOLYA, now: releaseMoment });
    check("свою — можно", mine.released === true, JSON.stringify(mine));
    check("после отпускания письмо свободно",
      readLease(root, { brand: "X_Test", mail: "welcome", now: releaseMoment + 1 }) === null);

    takeLease(root, { brand: "X_Test", mail: "a", actor: KOLYA });
    takeLease(root, { brand: "X_Test", mail: "b", actor: SASHA });
    const all = listLeases(root);
    check("видно, кто где сидит", all.length === 2, JSON.stringify(all));
    check("наружу токен не уходит", !JSON.stringify(all).includes(KOLYA.token));

    const noActor = await caught(async () => takeLease(root, { brand: "X_Test", mail: "c", actor: null }));
    check("безымянный лизу не берёт", noActor?.code === "BAD_NAME");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/* ─── 3. Главное: чужая работа не исчезает ───────────────────────────────── */
{
  const root = mkdtempSync(path.join(os.tmpdir(), "retkit-locks-guard-"));
  setMailWriteGuard(createLeaseGuard());
  try {
    const relative = "app/templates/blocks/header.pug";
    await createMail(root, { brand: "X_Test", mail: "welcome", actor: KOLYA });
    await writeMailFile(root, { brand: "X_Test", mail: "welcome", relative, content: "h1 Колина работа", actor: KOLYA });

    // Ради этой строчки всё и затевалось.
    const clash = await caught(() => writeMailFile(root, {
      brand: "X_Test", mail: "welcome", relative, content: "h1 Сашина работа", actor: SASHA,
    }));
    check("чужая запись в занятое письмо отбита", clash?.code === "MAIL_LOCKED", String(clash?.message));
    check("работа первого на месте",
      (await readMailFile(root, { brand: "X_Test", mail: "welcome", relative })) === "h1 Колина работа");

    // Запись сама занимает свободное письмо, даже если про лизы никто не знал.
    const held = readLease(root, { brand: "X_Test", mail: "welcome" });
    check("запись молча заняла письмо", held?.token === KOLYA.token);
    check("молчаливая лиза короче явной", held.ttlMs === WRITE_LEASE_TTL_MS, String(held.ttlMs));

    // Агент — отдельный актёр, даже когда это Клод того же человека.
    const byAgent = await caught(() => writeMailFile(root, {
      brand: "X_Test", mail: "welcome", relative, content: "h1 агент", actor: AGENT,
    }));
    check("агент не переписывает то, что правит человек", byAgent?.code === "MAIL_LOCKED");
    check("в отказе агенту тоже видно имя", /Коля/.test(String(byAgent?.message)));

    // Читать занятое можно всегда: иначе второй не поймёт, что там делает первый.
    check("чтение занятого письма свободно",
      (await readMailFile(root, { brand: "X_Test", mail: "welcome", relative })).includes("Колина"));

    // Удаление — тоже изменение, и его замок обязан останавливать.
    const del = await caught(() => trashMail(root, { brand: "X_Test", mail: "welcome", actor: SASHA }));
    check("чужое занятое письмо не удаляется", del?.code === "MAIL_LOCKED");
    check("письмо на месте", mailExists(root, "X_Test", "welcome"));

    // Освободилось — снова можно всем.
    releaseLease(root, { brand: "X_Test", mail: "welcome", actor: KOLYA });
    await writeMailFile(root, { brand: "X_Test", mail: "welcome", relative, content: "h1 Сашина работа", actor: SASHA });
    check("после освобождения второй пишет спокойно",
      (await readMailFile(root, { brand: "X_Test", mail: "welcome", relative })) === "h1 Сашина работа");

    // Внутренние сборки и скрипты приходят без метки — их запирать вреднее,
    // чем пропустить: иначе рутинная пересборка упрётся в чужую вкладку.
    await writeMailFile(root, { brand: "X_Test", mail: "welcome", relative, content: "h1 сборка" });
    check("безымянная запись не блокируется", true);
  } finally {
    setMailWriteGuard(null);
    rmSync(root, { recursive: true, force: true });
  }
}

/* ─── 4. Живая проверка по HTTP ──────────────────────────────────────────── */
{
  const brand = "X_assembled";
  const base = path.join(repoRoot, "email-base", brand);
  // Имя уникально для прогона: замок живёт в файле, и остаток от прошлого
  // прогона (или от параллельного) превратил бы проверку в лотерею.
  const mailFolder = `mail-lease-test-${process.pid}-${Date.now().toString(36)}`;
  const leftovers = [];
  const safeRemove = (target) => {
    if (!existsSync(target)) return;
    try { rmSync(target, { recursive: true, force: true }); }
    catch {
      try {
        const aside = path.join(repoRoot, "email-base", "_trash", `__lease-leftover-${Date.now()}`);
        mkdirSync(path.dirname(aside), { recursive: true });
        renameSync(target, aside);
        leftovers.push(aside);
      } catch { leftovers.push(target); }
    }
  };
  safeRemove(path.join(base, mailFolder));
  mkdirSync(path.join(base, mailFolder, "app", "templates", "blocks"), { recursive: true });
  writeFileSync(path.join(base, mailFolder, "app", "templates", "blocks", "header.pug"), "h1 замок");

  const studio = spawn(process.execPath, ["server.js"], {
    cwd: repoRoot,
    env: { ...process.env, PORT: String(PORT), APP_AUTH_ENABLED: "0", STUDIO_AI_ENABLED: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stop = () => { try { studio.kill("SIGTERM"); } catch { /* уже умер */ } };
  process.on("exit", stop);

  const call = async (url, { body, token, method = "POST" } = {}) => {
    const response = await fetch(`http://127.0.0.1:${PORT}${url}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { "x-retkit-token": token } : {}),
      },
      ...(method === "POST" ? { body: JSON.stringify(body || {}) } : {}),
    });
    return { status: response.status, data: await response.json().catch(() => ({})) };
  };

  const started = Date.now();
  let up = false;
  while (Date.now() - started < 40_000) {
    try { if ((await fetch(`http://127.0.0.1:${PORT}/healthz`)).ok) { up = true; break; } }
    catch { /* поднимается */ }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }

  if (!up) {
    check("студия поднялась", false, "не дождались");
  } else {
    const first = "d".repeat(32);
    const second = "e".repeat(32);

    const take = await call("/api/mail-lease/take", { body: { brand, mail: mailFolder }, token: first });
    check("письмо занимается по HTTP", take.status === 200 && take.data.ok, JSON.stringify(take).slice(0, 160));

    const rival = await call("/api/mail-lease/take", { body: { brand, mail: mailFolder }, token: second });
    check("второму отказано с 409", rival.status === 409 && rival.data.code === "MAIL_LOCKED",
      JSON.stringify(rival).slice(0, 200));
    check("второй видит, кто занял", Boolean(rival.data.holder?.name), JSON.stringify(rival.data.holder));

    const status = await call(`/api/mail-lease?brand=${brand}&mail=${mailFolder}`, { method: "GET", token: first });
    check("владелец видит, что лиза его", status.data.mine === true, JSON.stringify(status.data));
    const foreign = await call(`/api/mail-lease?brand=${brand}&mail=${mailFolder}`, { method: "GET", token: second });
    check("чужой видит, что письмо занято", foreign.data.lease && foreign.data.mine === false);

    // Живая проверка того же, ради чего замок: второй не может удалить занятое.
    const del = await call("/api/wb/email-delete", { body: { brand, mail: mailFolder }, token: second });
    check("удаление занятого письма отбито", del.status === 409 && del.data.code === "MAIL_LOCKED",
      JSON.stringify(del).slice(0, 200));
    check("письмо на месте", existsSync(path.join(base, mailFolder)));

    const beat = await call("/api/mail-lease/beat", { body: { brand, mail: mailFolder }, token: first });
    check("heartbeat продлевает лизу", beat.status === 200 && beat.data.ok);

    const release = await call("/api/mail-lease/release", { body: { brand, mail: mailFolder }, token: first });
    check("владелец отпускает письмо", release.data.released === true, JSON.stringify(release.data));

    const afterRelease = await call("/api/wb/email-delete", { body: { brand, mail: mailFolder }, token: second });
    check("освободившееся письмо удаляется", afterRelease.status === 200, JSON.stringify(afterRelease).slice(0, 160));
  }

  stop();
  safeRemove(path.join(base, mailFolder));
  const trash = path.join(repoRoot, "email-base", "_trash", brand);
  if (existsSync(trash)) {
    for (const entry of (await import("node:fs")).readdirSync(trash)) {
      if (entry.startsWith(mailFolder)) safeRemove(path.join(trash, entry));
    }
  }
  safeRemove(path.join(repoRoot, ".retkit", "locks", brand, `${mailFolder}.json`));
  if (leftovers.length) console.log(`  (не удалось стереть ${leftovers.length} тестовых папок — отложены в _trash)`);
}

/* ─── 5. Подключение ─────────────────────────────────────────────────────── */
{
  const server = readFileSync(path.join(repoRoot, "server.js"), "utf8");
  check("замки включены один раз при старте", /setMailWriteGuard\(createLeaseGuard\(\)\)/.test(server));
  // Домен переехал в src/routes/workspace-routes.js — там и проверяем.
  const routes = readFileSync(path.join(repoRoot, "src", "routes", "workspace-routes.js"), "utf8");
  check("есть ручка занять/продлить", /router\.prefix\("POST", "\/api\/mail-lease\/"/.test(routes));
  check("есть ручка посмотреть замок", /router\.prefix\("GET", "\/api\/mail-lease"/.test(routes));
  check("отказ отдаёт держателя", /holder: error\.holder/.test(routes));
  check("ни одна ручка письма не знает про лизы сама",
    !/takeLease\(__dirname[\s\S]{0,200}email-(clone|rename|delete)/.test(server));
  // Конструктор сохраняет письма мимо ручек клон/переименование, поэтому
  // разрешение он обязан спрашивать сам — до подмены папки, а не после.
  check("сохранение из конструктора спрашивает разрешение",
    /compose-save[\s\S]{0,1800}await assertMailWritable\(__dirname/.test(server));
  check("занятое письмо в конструкторе даёт 409, а не 500",
    /err instanceof MailStoreError[\s\S]{0,120}mailStoreStatus\(err\)/.test(server));

  const wb = readFileSync(path.join(repoRoot, "public", "workbench.js"), "utf8");
  check("воркбенч занимает письмо при открытии",
    /openSourceContext[\s\S]{0,400}RetkitLease\?\.hold\(brand, mail\)/.test(wb));
  check("есть куда уйти при занятом письме", /onCopy:/.test(wb));

  const lease = readFileSync(path.join(repoRoot, "public", "mail-lease.js"), "utf8");
  check("вкладка подтверждает, что жива", /setInterval\([\s\S]{0,120}"beat"/.test(lease));
  check("при закрытии вкладки письмо отпускается", /pagehide/.test(lease));
  check("отпускание переживает закрытие вкладки", /sendBeacon/.test(lease));
  check("перехват требует подтверждения", /window\.confirm/.test(lease));
  check("имя держателя экранируется", /esc\(who\)/.test(lease));

  for (const page of ["constructor.html", "workbench.html"]) {
    const html = readFileSync(path.join(repoRoot, "public", page), "utf8");
    check(`замок подключён в ${page}`, html.includes('src="/mail-lease.js"'));
    check(`стили замка подключены в ${page}`, html.includes('href="/mail-lease.css"'));
  }
}

console.log(`\nmail-locks: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
