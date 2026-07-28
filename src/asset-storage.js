/**
 * src/asset-storage.js — куда кладём картинки и какой URL у них получается.
 *
 * Проблема, которую это решает: загрузка и генерация картинок в студии уже
 * были, но файл ложился в `data/assets/` и НЕ имел публичного адреса. Для
 * превью хватало, а в настоящем письме такая картинка не показалась бы никому:
 * почтовый клиент открывается вне приложения и ходит за картинкой по абсолютной
 * ссылке. Плюс на хостинге с эфемерным диском файлы пропадают при деплое.
 *
 * Два драйвера, выбор по переменным окружения:
 *
 *   local (по умолчанию)  — файл в data/assets, URL /studio-assets/<имя>.
 *                           Годится для разработки и превью, НЕ годится для
 *                           реальной рассылки: адрес виден только изнутри сети.
 *   s3                    — S3-совместимое хранилище (Cloudflare R2, AWS S3,
 *                           DigitalOcean Spaces). Постоянный публичный URL.
 *
 * S3 подписывается вручную (AWS SigV4 на встроенном crypto) — чтобы не тащить
 * в проект aws-sdk ради одной операции PUT.
 *
 * Переменные окружения для s3:
 *   ASSET_STORAGE=s3
 *   ASSET_S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com
 *   ASSET_S3_BUCKET=retkit-assets
 *   ASSET_S3_REGION=auto            (для R2 — auto, для AWS — например eu-central-1)
 *   ASSET_S3_ACCESS_KEY_ID=...
 *   ASSET_S3_SECRET_ACCESS_KEY=...
 *   ASSET_S3_PUBLIC_BASE=https://cdn.example.com   (публичный домен бакета)
 *   ASSET_S3_PREFIX=assets                          (необязательно)
 */
import { createHash, createHmac } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import url from "node:url";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const LOCAL_DIR = path.join(repoRoot, "data", "assets");

/**
 * Префикс локальной раздачи. Такой маршрут в сервере УЖЕ есть
 * (`GET /studio-assets/…` отдаёт файлы из data/assets) — заводить второй
 * незачем, иначе у одного файла окажется два адреса.
 */
export const LOCAL_URL_PREFIX = "/studio-assets/";

export function assetStorageConfig(env = process.env) {
  const driver = String(env.ASSET_STORAGE || "local").toLowerCase();
  if (driver !== "s3") return { driver: "local", localDir: LOCAL_DIR };
  const cfg = {
    driver: "s3",
    endpoint: String(env.ASSET_S3_ENDPOINT || "").replace(/\/+$/, ""),
    bucket: String(env.ASSET_S3_BUCKET || ""),
    region: String(env.ASSET_S3_REGION || "auto"),
    accessKeyId: String(env.ASSET_S3_ACCESS_KEY_ID || ""),
    secretAccessKey: String(env.ASSET_S3_SECRET_ACCESS_KEY || ""),
    publicBase: String(env.ASSET_S3_PUBLIC_BASE || "").replace(/\/+$/, ""),
    prefix: String(env.ASSET_S3_PREFIX || "assets").replace(/^\/+|\/+$/g, ""),
  };
  const missing = ["endpoint", "bucket", "accessKeyId", "secretAccessKey", "publicBase"]
    .filter((k) => !cfg[k]);
  cfg.missing = missing;
  cfg.ready = missing.length === 0;
  return cfg;
}

/** Понятный статус для UI и для ответа сервера. */
export function assetStorageStatus(env = process.env) {
  const cfg = assetStorageConfig(env);
  if (cfg.driver === "local") {
    return {
      driver: "local",
      ready: true,
      publicUrls: false,
      note: "Файлы лежат на диске приложения и доступны по /studio-assets/… . Этого хватает "
        + "для превью и вёрстки, но в реальной рассылке картинку не увидят: адрес "
        + "локальный. Для отправки настрой ASSET_STORAGE=s3.",
    };
  }
  return {
    driver: "s3",
    ready: cfg.ready,
    publicUrls: cfg.ready,
    bucket: cfg.bucket,
    publicBase: cfg.publicBase,
    ...(cfg.ready ? {} : { note: `Не хватает переменных: ${cfg.missing.join(", ")}` }),
  };
}

/* ─── SigV4 ──────────────────────────────────────────────────────────────── */

const sha256hex = (data) => createHash("sha256").update(data).digest("hex");
const hmac = (key, data) => createHmac("sha256", key).update(data).digest();

function signingKey(secret, date, region, service) {
  return hmac(hmac(hmac(hmac(`AWS4${secret}`, date), region), service), "aws4_request");
}

/**
 * PUT объекта в S3-совместимое хранилище.
 * Подпись собирается вручную: одна операция не стоит зависимости на aws-sdk.
 */
async function s3Put(cfg, key, body, contentType) {
  const host = new URL(cfg.endpoint).host;
  const canonicalUri = `/${cfg.bucket}/${key.split("/").map(encodeURIComponent).join("/")}`;
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256hex(body);

  const headers = {
    host,
    "content-type": contentType || "application/octet-stream",
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };
  const signedHeaders = Object.keys(headers).sort().join(";");
  const canonicalHeaders = Object.keys(headers).sort()
    .map((h) => `${h}:${String(headers[h]).trim()}\n`).join("");

  const canonicalRequest = [
    "PUT", canonicalUri, "", canonicalHeaders, signedHeaders, payloadHash,
  ].join("\n");
  const scope = `${dateStamp}/${cfg.region}/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256", amzDate, scope, sha256hex(canonicalRequest),
  ].join("\n");
  const signature = createHmac("sha256", signingKey(cfg.secretAccessKey, dateStamp, cfg.region, "s3"))
    .update(stringToSign).digest("hex");

  const authorization = `AWS4-HMAC-SHA256 Credential=${cfg.accessKeyId}/${scope}, `
    + `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const response = await fetch(`${cfg.endpoint}${canonicalUri}`, {
    method: "PUT",
    headers: { ...headers, authorization },
    body,
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`S3 PUT ${response.status}: ${text.slice(0, 300)}`);
  }
}

/* ─── Публичный API ──────────────────────────────────────────────────────── */

/**
 * Сохранить файл и получить его адрес.
 *
 * @param {Buffer} buffer
 * @param {object} meta
 * @param {string} meta.fileName — уже уникальное имя (см. getSafeUploadStem в server.js)
 * @param {string} [meta.contentType]
 * @returns {Promise<{url:string, key:string, driver:string, publicUrl:boolean}>}
 */
export async function putAsset(buffer, meta = {}, env = process.env) {
  const fileName = String(meta.fileName || `asset-${Date.now()}`).replace(/[^\w.\-]/g, "-");
  const cfg = assetStorageConfig(env);

  if (cfg.driver === "s3") {
    if (!cfg.ready) throw new Error(`Хранилище S3 настроено не полностью: не хватает ${cfg.missing.join(", ")}`);
    const key = cfg.prefix ? `${cfg.prefix}/${fileName}` : fileName;
    await s3Put(cfg, key, buffer, meta.contentType);
    return { url: `${cfg.publicBase}/${key}`, key, driver: "s3", publicUrl: true };
  }

  await mkdir(cfg.localDir, { recursive: true });
  await writeFile(path.join(cfg.localDir, fileName), buffer);
  return {
    url: `${LOCAL_URL_PREFIX}${encodeURIComponent(fileName)}`,
    key: fileName,
    driver: "local",
    // Локальный адрес относительный: он работает внутри студии, но в письме,
    // которое откроют в почте, картинка по нему не загрузится.
    publicUrl: false,
  };
}

/**
 * Абсолютный адрес для вставки в письмо. Локальный драйвер честно возвращает
 * null: относительная ссылка в почте бесполезна, и лучше сказать об этом
 * явно, чем подсунуть заведомо битый URL.
 */
export function absoluteAssetUrl(entry, env = process.env) {
  const raw = String(entry?.url || entry?.externalUrl || "");
  if (/^https?:\/\//i.test(raw)) return raw;
  const cfg = assetStorageConfig(env);
  if (cfg.driver === "s3" && cfg.ready && entry?.key) return `${cfg.publicBase}/${entry.key}`;
  return null;
}
