#!/usr/bin/env node
/**
 * test-asset-storage.mjs — адаптер хранилища картинок.
 *
 * Главное, что проверяем: адаптер НЕ выдаёт локальный путь за публичный адрес.
 * Картинка, вставленная в письмо по ссылке `/studio-assets/…`, не загрузится
 * ни у одного получателя — и лучше сказать это честно, чем отдать битый URL.
 *
 * S3-драйвер проверяется без сети: смотрим конфиг, обязательные переменные и
 * форму публичной ссылки. Реальный PUT — на боевых ключах.
 *
 * Zero-AI, без сети. Exit 0 = pass.
 */
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  putAsset, absoluteAssetUrl, assetStorageConfig, assetStorageStatus, LOCAL_URL_PREFIX,
} from "../src/asset-storage.js";

let pass = 0, fail = 0;
const check = (name, cond, extra = "") => {
  if (cond) { pass++; console.log("  \x1b[32m✓\x1b[0m", name); }
  else { fail++; console.error(`  \x1b[31m✗ ${name}\x1b[0m ${extra}`); }
};

/* ─── Локальный драйвер ──────────────────────────────────────────────────── */
{
  const cfg = assetStorageConfig({});
  check("по умолчанию драйвер локальный", cfg.driver === "local", cfg.driver);

  const status = assetStorageStatus({});
  check("локальный драйвер готов к работе", status.ready === true);
  check("но честно говорит, что публичных ссылок нет", status.publicUrls === false);
  check("и объясняет, почему это важно", /рассылк/i.test(status.note || ""), status.note);
}

{
  const buffer = Buffer.from("89504e470d0a1a0a", "hex");
  const stored = await putAsset(buffer, { fileName: "test-storage-probe.png", contentType: "image/png" }, {});
  check("файл сохранён локально", stored.driver === "local");
  check("URL начинается с префикса раздачи", stored.url.startsWith(LOCAL_URL_PREFIX), stored.url);
  check("локальный URL НЕ помечен публичным", stored.publicUrl === false);

  const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
  const written = path.join(repoRoot, "data", "assets", "test-storage-probe.png");
  check("файл действительно лёг на диск", existsSync(written));
  check("содержимое не испорчено", existsSync(written) && readFileSync(written).equals(buffer));
  if (existsSync(written)) rmSync(written, { force: true });
}

{
  check("относительный путь не выдаётся за абсолютный",
    absoluteAssetUrl({ url: "/studio-assets/a.png" }, {}) === null);
  check("префикс совпадает с реальным маршрутом сервера",
    LOCAL_URL_PREFIX === "/studio-assets/", LOCAL_URL_PREFIX);
  check("внешняя ссылка возвращается как есть",
    absoluteAssetUrl({ url: "https://cdn.example.com/a.png" }, {}) === "https://cdn.example.com/a.png");
  check("externalUrl тоже принимается",
    absoluteAssetUrl({ externalUrl: "https://cdn.example.com/b.png" }, {}) === "https://cdn.example.com/b.png");
}

/* ─── S3-драйвер: конфигурация ───────────────────────────────────────────── */
const S3_ENV = {
  ASSET_STORAGE: "s3",
  ASSET_S3_ENDPOINT: "https://acc.r2.cloudflarestorage.com/",
  ASSET_S3_BUCKET: "retkit",
  ASSET_S3_ACCESS_KEY_ID: "key",
  ASSET_S3_SECRET_ACCESS_KEY: "secret",
  ASSET_S3_PUBLIC_BASE: "https://cdn.example.com/",
};

{
  const cfg = assetStorageConfig(S3_ENV);
  check("s3-конфиг собирается", cfg.driver === "s3" && cfg.ready === true, JSON.stringify(cfg.missing));
  check("хвостовые слэши срезаются",
    cfg.endpoint === "https://acc.r2.cloudflarestorage.com" && cfg.publicBase === "https://cdn.example.com",
    `${cfg.endpoint} | ${cfg.publicBase}`);
  check("регион по умолчанию auto (как у R2)", cfg.region === "auto", cfg.region);
  check("префикс по умолчанию assets", cfg.prefix === "assets", cfg.prefix);

  const status = assetStorageStatus(S3_ENV);
  check("s3 обещает публичные ссылки", status.publicUrls === true);
}

{
  const broken = assetStorageConfig({ ASSET_STORAGE: "s3", ASSET_S3_BUCKET: "b" });
  check("неполная настройка не считается готовой", broken.ready === false);
  check("перечислено, чего именно не хватает",
    broken.missing.includes("endpoint") && broken.missing.includes("accessKeyId")
      && broken.missing.includes("publicBase"),
    broken.missing.join(","));
  const status = assetStorageStatus({ ASSET_STORAGE: "s3", ASSET_S3_BUCKET: "b" });
  check("статус объясняет, что настроить", /Не хватает/.test(status.note || ""), status.note);
}

{
  // Загрузка при неполной настройке должна падать понятной ошибкой, а не
  // молча уходить в локальный диск: иначе на проде картинки тихо перестанут
  // быть публичными и это всплывёт уже в рассылке.
  let message = "";
  try { await putAsset(Buffer.from("x"), { fileName: "a.png" }, { ASSET_STORAGE: "s3", ASSET_S3_BUCKET: "b" }); }
  catch (e) { message = String(e.message || e); }
  check("неполный s3 не подменяется локальным диском", /не полностью|не хватает/i.test(message), message);
}

{
  const cfg = assetStorageConfig({ ...S3_ENV, ASSET_S3_PREFIX: "/img/" });
  check("префикс нормализуется", cfg.prefix === "img", cfg.prefix);
  check("публичная ссылка складывается из базы, префикса и имени",
    absoluteAssetUrl({ key: "img/a.png" }, { ...S3_ENV, ASSET_S3_PREFIX: "/img/" })
      === "https://cdn.example.com/img/a.png");
}

/* ─── Constructor: local preview URL never becomes email content ────────── */
{
  const constructorSource = readFileSync(
    path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "public", "constructor.js"),
    "utf8",
  );
  const extractFn = (name) => {
    const start = constructorSource.indexOf(`function ${name}(`);
    if (start < 0) throw new Error(`constructor function not found: ${name}`);
    let depth = 0, bodyStarted = false;
    for (let i = start; i < constructorSource.length; i += 1) {
      if (constructorSource[i] === "{") { depth += 1; bodyStarted = true; }
      else if (constructorSource[i] === "}" && bodyStarted && --depth === 0) {
        return constructorSource.slice(start, i + 1);
      }
    }
    throw new Error(`constructor function is not closed: ${name}`);
  };
  const browserAssetGuards = new Function(
    [
      extractFn("isLocalStudioAssetUrl"),
      extractFn("isPrivateEmailAssetHostname"),
      extractFn("isPublicEmailAssetUrl"),
      extractFn("preferredAssetUrl"),
      "return { isLocalStudioAssetUrl, isPublicEmailAssetUrl, preferredAssetUrl };",
    ].join("\n"),
  )();

  check("constructor detects relative Studio asset",
    browserAssetGuards.isLocalStudioAssetUrl("/studio-assets/a.png") === true);
  check("constructor also detects absolute Studio asset",
    browserAssetGuards.isLocalStudioAssetUrl("https://studio.example/studio-assets/a.png") === true);
  check("real CDN URL remains public",
    browserAssetGuards.isPublicEmailAssetUrl("https://cdn.example.com/a.png") === true);
  check("Studio asset is never considered public",
    browserAssetGuards.isPublicEmailAssetUrl("/studio-assets/a.png") === false);
  for (const privateUrl of [
    "http://localhost/a.png",
    "https://assets.local/a.png",
    "http://127.0.0.1/a.png",
    "http://10.2.3.4/a.png",
    "http://172.16.4.3/a.png",
    "http://192.168.1.5/a.png",
    "http://[::1]/a.png",
    "http://[fd00::1]/a.png",
  ]) {
    check(`constructor rejects private asset host ${privateUrl}`,
      browserAssetGuards.isPublicEmailAssetUrl(privateUrl) === false);
  }
  check("preferred URL refuses local fallback",
    browserAssetGuards.preferredAssetUrl({
      preferredUrl: "/studio-assets/a.png",
      localUrl: "/studio-assets/a.png",
    }) === "");
  check("explicit external URL wins over local preview",
    browserAssetGuards.preferredAssetUrl({
      externalUrl: "https://cdn.example.com/a.png",
      preferredUrl: "/studio-assets/a.png",
      localUrl: "/studio-assets/a.png",
    }) === "https://cdn.example.com/a.png");

  const canvasAssetGuards = new Function(
    "state",
    [
      extractFn("isLocalStudioAssetUrl"),
      extractFn("localCanvasAssetReferences"),
      extractFn("assertCanvasAssetsPublic"),
      "return { localCanvasAssetReferences, assertCanvasAssetsPublic };",
    ].join("\n"),
  )({
    canvas: [{
      uid: "hero",
      blockId: "iq-hero",
      slots: { image: "/studio-assets/private.png", title: "Safe copy" },
    }],
  });
  check("canvas guard finds the exact unsafe block and slot",
    canvasAssetGuards.localCanvasAssetReferences()[0]?.slotId === "image");
  let canvasGuardError = "";
  try { canvasAssetGuards.assertCanvasAssetsPublic(); }
  catch (error) { canvasGuardError = String(error.message || error); }
  check("canvas guard refuses an outgoing local asset with a clear fix",
    /iq-hero\.image[\s\S]*публичный HTTPS/i.test(canvasGuardError), canvasGuardError);

  check("constructor asks the authoritative storage status endpoint",
    /fetch\(["']\/api\/assets\/status["']\)/.test(extractFn("loadAssetStorageStatus")));
  check("outgoing canvas conversion has a mandatory public-asset gate",
    /function canvasToBlocks\(options\)[\s\S]*allowLocalAssets[\s\S]*assertCanvasAssetsPublic\(\)/.test(constructorSource));
  check("preview opts into local assets explicitly without weakening send/save",
    (constructorSource.match(/canvasToBlocks\(\{\s*allowLocalAssets:\s*true\s*\}\)/g) || []).length >= 2);
}

console.log(`\nasset-storage: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
