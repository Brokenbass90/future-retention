import {
  codeHtmlContentHash,
  listCodeWorkspace,
  readCodeHtml,
} from "./code-workspace.js";

export const EMAIL_CLIP_LIMIT_KIB = 102;
export const EMAIL_CLIP_LIMIT_BYTES = EMAIL_CLIP_LIMIT_KIB * 1024;
export const EMAIL_WEIGHT_LIMIT_EXCEEDED = "EMAIL_WEIGHT_LIMIT_EXCEEDED";

function normalizedLocale(entry, index) {
  return String(entry?.locale || entry?.code || entry?.label || `locale-${index + 1}`);
}

export function summarizeReleaseEmailWeights(entries = [], options = {}) {
  const thresholdBytes = Number(options.thresholdBytes || EMAIL_CLIP_LIMIT_BYTES);
  if (!Number.isFinite(thresholdBytes) || thresholdBytes <= 0) {
    throw new TypeError("thresholdBytes must be a positive number");
  }

  const samples = (Array.isArray(entries) ? entries : []).map((entry, index) => {
    const providedHtml = Object.prototype.hasOwnProperty.call(entry || {}, "html")
      ? String(entry?.html ?? "")
      : null;
    const providedBytes = Number(entry?.htmlBytes);
    const htmlBytes = Number.isFinite(providedBytes) && providedBytes >= 0
      ? providedBytes
      : Buffer.byteLength(providedHtml ?? "", "utf8");
    const htmlHash = /^[a-f0-9]{64}$/i.test(String(entry?.htmlHash || ""))
      ? String(entry.htmlHash).toLowerCase()
      : (providedHtml === null ? "" : codeHtmlContentHash(providedHtml));
    return {
      locale: normalizedLocale(entry, index),
      htmlBytes,
      htmlHash,
      htmlKib: Number((htmlBytes / 1024).toFixed(1)),
      detached: Boolean(entry?.detached),
      source: String(entry?.source || (entry?.detached ? "override" : "pug")),
      overLimit: htmlBytes >= thresholdBytes,
    };
  });
  const overweight = samples.filter((sample) => sample.overLimit);
  const largest = samples.reduce(
    (current, sample) => (!current || sample.htmlBytes > current.htmlBytes ? sample : current),
    null,
  );

  return {
    ok: overweight.length === 0,
    thresholdBytes,
    thresholdKib: Number((thresholdBytes / 1024).toFixed(1)),
    checked: samples.length,
    samples,
    overweight,
    largest,
  };
}

export function assertReleaseEmailWeights(entries = [], options = {}) {
  const report = summarizeReleaseEmailWeights(entries, options);
  if (report.ok) return report;

  const localeSummary = report.overweight
    .map((sample) => `${sample.locale}: ${sample.htmlKib.toFixed(1)} KiB`)
    .join(", ");
  const error = new Error(
    `Финальный HTML достиг лимита ${report.thresholdKib.toFixed(1)} KiB: ${localeSummary}. ` +
    "Уменьшите разметку/стили или изображения, встроенные как data URL.",
  );
  error.code = EMAIL_WEIGHT_LIMIT_EXCEEDED;
  error.statusCode = 422;
  error.releasePreflight = report;
  throw error;
}

export async function auditWorkbenchReleaseHtml({ emailBaseRoot, brand, mail }) {
  const workspace = await listCodeWorkspace({ emailBaseRoot, brand, mail });
  const locales = workspace.locales || [];
  const entries = new Array(locales.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < locales.length) {
      const index = cursor;
      cursor += 1;
      const locale = locales[index];
      const effective = await readCodeHtml({
        emailBaseRoot,
        brand,
        mail,
        locale: locale.code,
      });
      entries[index] = {
        locale: locale.code,
        htmlBytes: effective.htmlBytes,
        htmlHash: effective.htmlHash,
        detached: effective.detached,
        source: effective.source,
      };
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(4, Math.max(1, locales.length)) }, () => worker()),
  );
  return assertReleaseEmailWeights(entries);
}
