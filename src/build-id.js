/**
 * src/build-id.js — версия кода студии, которую видит браузер.
 *
 * Зачем: после деплоя у человека остаются вкладки, загруженные ДО него, и в них
 * работает старый JS. Живой случай 02.11: исправление перехода в конструктор
 * задеплоено, а открытая вкладка «Код» продолжала вести себя по-старому, и
 * агент гадал почему. Сервер отдаёт версию в каждом ответе опроса связи;
 * вкладка запоминает первую увиденную и, если она сменилась, показывает
 * человеку «обновите страницу», а агенту статус говорит то же самое.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "public");

function computeBuildId() {
  const hash = createHash("sha1");
  for (const file of ["workbench.js", "constructor.js", "relay.js"]) {
    try { hash.update(readFileSync(path.join(publicDir, file))); } catch { hash.update(file); }
  }
  return hash.digest("hex").slice(0, 10);
}

export const BUILD_ID = computeBuildId();
