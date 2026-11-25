/**
 * src/mail-locks.js — «письмо сейчас правит Коля».
 *
 * Проблема, ради которой это написано, выглядит безобидно и стоит дорого:
 * двое (а чаще человек и чей-то агент) открывают одно письмо, оба сохраняют,
 * и работа того, кто сохранил первым, исчезает. Никакой ошибки при этом не
 * происходит — просто в файле оказывается чужой текст.
 *
 * Решение намеренно простое: лиза на письмо. Кто открыл — тот и держит, пока
 * шлёт признаки жизни. Не шлёт полторы минуты (закрыл вкладку, уснул ноутбук,
 * упал агент) — лиза протухает сама, и письмо снова свободно. Это важнее
 * строгости: заблокированное навсегда письмо хуже, чем изредка перехваченное.
 *
 * Два вида лиз:
 *   • явная — интерфейс берёт её, когда человек открывает письмо на правку,
 *     и подтверждает heartbeat'ом;
 *   • молчаливая — берётся на время самой записи, чтобы защитить даже тех,
 *     кто пишет из ручек, ничего не знающих про лизы (например, агента).
 *
 * Чего здесь сознательно НЕТ: очередей, блокировок на чтение и запрета
 * перехвата. Смотреть чужое письмо можно всегда, а перехватить занятое — можно
 * явным действием человека, потому что «Коля ушёл в отпуск с открытой
 * вкладкой» бывает чаще, чем хотелось бы.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import path from "node:path";
import { MailStoreError, mailPaths, safeSegment, mailFolderName } from "./mail-store.js";

/** Явная лиза: полторы минуты без признаков жизни — и письмо свободно. */
export const LEASE_TTL_MS = 90_000;
/**
 * Молчаливая лиза на время записи. Восемь секунд — нарочно мало: она обязана
 * развести две ОДНОВРЕМЕННЫЕ записи, а не занять письмо на будущее. Иначе
 * агент, записавший что-то и ушедший, запирал бы письмо от человека на
 * минуту, и тот читал бы «письмо правит Без имени» на пустом месте.
 * Рабочую сессию человека держит явная лиза с heartbeat'ом, а не эта.
 */
export const WRITE_LEASE_TTL_MS = 8_000;

export function lockDir(repoRoot) {
  return path.join(repoRoot, ".retkit", "locks");
}

function lockFile(repoRoot, brand, mail) {
  const safeBrand = safeSegment(brand);
  const folder = mailFolderName(mail);
  if (!safeBrand || !folder) throw new MailStoreError("BAD_NAME", "Нужны бренд и имя письма");
  return path.join(lockDir(repoRoot), safeBrand, `${folder}.json`);
}

/** Сколько прошло с последнего признака жизни — человеческими словами. */
export function describeAge(ms) {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 5) return "прямо сейчас";
  if (seconds < 60) return `${seconds} секунд назад`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} мин назад`;
  return `${Math.round(minutes / 60)} ч назад`;
}

function readRaw(file) {
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    // Битый файл лизы — это не повод запереть письмо навсегда.
    return null;
  }
}

/** Живая лиза на письмо или null. Протухшие не возвращаем и не чиним. */
export function readLease(repoRoot, { brand, mail, now = Date.now() } = {}) {
  const raw = readRaw(lockFile(repoRoot, brand, mail));
  if (!raw) return null;
  const ttl = Number(raw.ttlMs) || LEASE_TTL_MS;
  const beat = Number(raw.heartbeatAt) || 0;
  if (now - beat > ttl) return null;
  return { ...raw, ageMs: now - beat };
}

/**
 * Занять письмо.
 *
 * Своя лиза продлевается. Чужая живая — отказ с именем того, кто держит
 * (force перехватывает, но это осознанное действие человека, а не умолчание).
 */
export function takeLease(repoRoot, {
  brand, mail, actor, now = Date.now(), ttlMs = LEASE_TTL_MS, force = false, kind = "edit",
} = {}) {
  const paths = mailPaths(repoRoot, brand, mail);
  const token = String(actor?.token || "");
  if (!token) throw new MailStoreError("BAD_NAME", "Неизвестно, кто берёт письмо");

  const current = readLease(repoRoot, { brand, mail, now });
  if (current && current.token !== token && !force) {
    throw new MailStoreError("MAIL_LOCKED", leaseMessage(current), { holder: publicLease(current) });
  }

  const lease = {
    token,
    name: actor?.name || "",
    displayName: actor?.name || (actor?.kind === "agent" ? "Агент" : "Без имени"),
    actorKind: actor?.kind || "human",
    brand: paths.brand,
    mail: paths.mail,
    kind,
    takenAt: current && current.token === token ? current.takenAt : now,
    heartbeatAt: now,
    ttlMs,
  };
  const file = lockFile(repoRoot, paths.brand, paths.mail);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(lease, null, 2)}\n`, "utf8");
  return lease;
}

/** Признак жизни. Лизы нет (протухла) — берём заново, иначе работа встанет. */
export function refreshLease(repoRoot, options = {}) {
  return takeLease(repoRoot, options);
}

/**
 * Отпустить письмо. Чужую лизу не трогаем: отпускать может только владелец.
 *
 * Удалить файл получается не всегда: на смонтированных файловых системах
 * unlink бывает запрещён (по этой же причине письма удаляются переносом в
 * корзину, а не rm). Если снести файл нельзя — гасим лизу на месте, помечая
 * её протухшей. Иначе человек, закрывший письмо, не смог бы вернуться к нему
 * полторы минуты, а на такой системе — вообще никогда.
 */
export function releaseLease(repoRoot, { brand, mail, actor, now = Date.now() } = {}) {
  const current = readLease(repoRoot, { brand, mail, now });
  if (!current) return { released: false, reason: "лизы не было" };
  if (current.token !== String(actor?.token || "")) {
    return { released: false, reason: "лиза чужая" };
  }
  const file = lockFile(repoRoot, brand, mail);
  try {
    rmSync(file, { force: true });
    return { released: true };
  } catch {
    const spent = { ...current, heartbeatAt: 0, releasedAt: now, released: true };
    delete spent.ageMs;
    writeFileSync(file, `${JSON.stringify(spent, null, 2)}\n`, "utf8");
    return { released: true, tombstone: true };
  }
}

/** Текст отказа. Человеку важно не «409», а кто занял и когда был жив. */
export function leaseMessage(lease) {
  const who = lease.actorKind === "agent" ? `${lease.displayName} (агент)` : lease.displayName;
  return `Письмо сейчас правит ${who} — последняя активность ${describeAge(lease.ageMs || 0)}. ` +
    `Откройте копию или подождите, пока освободится.`;
}

/** Что можно показать другим: токен владельца — не их дело. */
export function publicLease(lease) {
  if (!lease) return null;
  return {
    name: lease.displayName || lease.name || "",
    actorKind: lease.actorKind || "human",
    brand: lease.brand,
    mail: lease.mail,
    kind: lease.kind || "edit",
    takenAt: lease.takenAt,
    ageMs: lease.ageMs || 0,
    age: describeAge(lease.ageMs || 0),
  };
}

/** Все живые лизы — для бейджа «кто где сидит». */
export function listLeases(repoRoot, { now = Date.now() } = {}) {
  const root = lockDir(repoRoot);
  if (!existsSync(root)) return [];
  const out = [];
  for (const brand of readdirSync(root)) {
    const brandDir = path.join(root, brand);
    let entries = [];
    try { entries = readdirSync(brandDir); } catch { continue; }
    for (const entry of entries) {
      if (!entry.endsWith(".json")) continue;
      const lease = readLease(repoRoot, { brand, mail: entry.slice(0, -5), now });
      if (lease) out.push(publicLease(lease));
    }
  }
  return out;
}

/**
 * Проверка прав для двери (src/mail-store.js).
 *
 * Ставится через setMailWriteGuard и делает ровно две вещи: не даёт писать в
 * чужое занятое письмо и молча занимает свободное на время записи — чтобы
 * защищён был даже тот, кто про лизы ничего не знает.
 */
export function createLeaseGuard({ now = () => Date.now() } = {}) {
  return async ({ repoRoot, paths, actor }) => {
    const token = String(actor?.token || "");
    // Актёр неизвестен (внутренние сборки, скрипты) — не мешаем работать:
    // запирать то, чего не можем назвать по имени, вреднее, чем пропустить.
    if (!token) return;
    const moment = now();
    const current = readLease(repoRoot, { brand: paths.brand, mail: paths.mail, now: moment });
    if (current && current.token !== token) {
      throw new MailStoreError("MAIL_LOCKED", leaseMessage(current), { holder: publicLease(current) });
    }
    takeLease(repoRoot, {
      brand: paths.brand,
      mail: paths.mail,
      actor,
      now: moment,
      ttlMs: current?.kind === "edit" ? current.ttlMs : WRITE_LEASE_TTL_MS,
      kind: current?.kind === "edit" ? "edit" : "write",
    });
  };
}
