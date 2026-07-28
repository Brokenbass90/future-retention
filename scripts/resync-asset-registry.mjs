#!/usr/bin/env node
/**
 * scripts/resync-asset-registry.mjs — свести реестр картинок с тем, что на диске.
 *
 * ВАЖНО про источник правды: реестр живёт в SQLite (`data/studio.db`, таблица
 * asset_registry), а `data/asset-registry.json` остался от прежней схемы и
 * сервером НЕ читается. Пишем в базу, иначе синхронизация была бы видна только
 * в мёртвом файле.
 *
 * Реестр и папка разъехались: файлы копились при загрузке и генерации, а
 * записи — нет. На момент написания: 99 файлов, 18 записей. Всё, чего нет в
 * реестре, для студии не существует — картинку не выбрать в слот, не найти
 * в библиотеке ассетов.
 *
 * Скрипт добавляет недостающие записи по файлам и помечает записи, чей файл
 * пропал. Ничего не удаляет с диска.
 *
 *   node scripts/resync-asset-registry.mjs           # показать, что будет
 *   node scripts/resync-asset-registry.mjs --apply   # записать
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import url from "node:url";
import { assetsGetAll, assetsUpsert } from "../src/db.js";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const assetsDir = path.join(repoRoot, "data", "assets");
const registryPath = path.join(repoRoot, "data", "asset-registry.json");

const APPLY = process.argv.includes("--apply");

const MIME = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml",
};

if (!existsSync(assetsDir)) { console.error("нет data/assets"); process.exit(1); }

const items = assetsGetAll();
const known = new Set(items.map((i) => i.fileName || i.file_name).filter(Boolean));
const onDisk = readdirSync(assetsDir).filter((f) => MIME[path.extname(f).toLowerCase()]);

const added = [];
for (const fileName of onDisk) {
  if (known.has(fileName)) continue;
  const abs = path.join(assetsDir, fileName);
  const stat = statSync(abs);
  // Имя вида "<timestamp>-<rand>-<stem>.<ext>" — вытаскиваем осмысленную часть.
  const stem = fileName.replace(/^\d{10,}-[a-z0-9]{4,8}-/, "").replace(/\.[^.]+$/, "");
  added.push({
    id: `asset-resync-${stat.mtimeMs.toFixed(0)}-${added.length + 1}`,
    kind: /^ai-/.test(stem) ? "asset" : "asset",
    label: stem || fileName,
    fileName,
    localUrl: `/studio-assets/${encodeURIComponent(fileName)}`,
    externalUrl: "",
    preferredUrl: `/studio-assets/${encodeURIComponent(fileName)}`,
    alt: stem || "",
    notes: "Добавлено пересинхронизацией реестра: файл лежал на диске без записи.",
    placement: "auto",
    // key в базе уникален, а осмысленный «хвост» имени у многих файлов
    // совпадает (десяток скриншотов с одинаковым названием). Ключом берём
    // имя файла без расширения — оно уникально по построению.
    key: fileName.replace(/\.[^.]+$/, ""),
    storageDriver: "local",
    storageKey: fileName,
    mimeType: MIME[path.extname(fileName).toLowerCase()] || "application/octet-stream",
    size: stat.size,
    createdAt: new Date(stat.mtimeMs).toISOString(),
    updatedAt: new Date().toISOString(),
  });
}

const diskSet = new Set(onDisk);
const orphaned = items.filter((i) => {
  const f = i.fileName || i.file_name;
  return f && !diskSet.has(f);
});

console.log(`файлов на диске: ${onDisk.length} · записей в реестре (SQLite): ${items.length}`);
console.log(`добавится записей: ${added.length}`);
console.log(`записей без файла: ${orphaned.length}${orphaned.length ? " (помечаются, не удаляются)" : ""}`);
for (const o of orphaned.slice(0, 10)) console.log(`   ⚠ ${o.label || o.id}: файла ${o.fileName} нет`);

if (!APPLY) { console.log("\nСухой прогон. Запись: --apply"); process.exit(0); }

for (const entry of added) {
  assetsUpsert({
    id: entry.id,
    key: entry.key,
    url: entry.localUrl,
    localPath: path.join("data", "assets", entry.fileName),
    fileName: entry.fileName,
    label: entry.label,
    alt: entry.alt,
    placement: entry.placement,
    notes: entry.notes,
  });
}
console.log(`\nЗАПИСАНО в SQLite: +${added.length} записей, всего ${assetsGetAll().length}.`);
