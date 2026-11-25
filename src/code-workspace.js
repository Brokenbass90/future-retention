import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { resolveRemainingHtmlLocalization } from "./workbench-localization.js";

export const BASE_HTML_LOCALE = "base";

const LOCALE_RE = /^[A-Za-z]{2}(?:[_-][A-Za-z]{2})?$/;
const OVERRIDE_DIR = ".retkit-workbench/html-overrides";
const MAX_HTML_BYTES = 20 * 1024 * 1024;
const MAX_DIAGNOSTICS_CACHE_ENTRIES = 512;
const overrideWriteTails = new Map();
// Workspace listing is a hot path (open mail, switch locale, finish build).
// Keep diagnostics discovered while reading the *active* HTML document, but do
// not read and localize every locale merely to render the selector.
const htmlDiagnosticsCache = new Map();

export function codeHtmlContentHash(html) {
  return createHash("sha256")
    .update(String(html ?? ""), "utf8")
    .digest("hex");
}

function htmlPayload(html) {
  const content = String(html ?? "");
  return {
    html: content,
    htmlBytes: Buffer.byteLength(content, "utf8"),
    htmlHash: codeHtmlContentHash(content),
  };
}

function privateSiblingPath(destination, purpose) {
  return path.join(
    path.dirname(destination),
    `.${path.basename(destination)}.${purpose}-${process.pid}-${randomUUID()}`,
  );
}

export async function writeFileAtomically(destination, content) {
  const tempPath = privateSiblingPath(destination, "tmp");
  try {
    await writeFile(tempPath, content, "utf8");
    await rename(tempPath, destination);
  } finally {
    await rm(tempPath, { force: true }).catch(() => {});
  }
}

async function withOverrideWriteLock(destination, operation) {
  const previous = overrideWriteTails.get(destination) || Promise.resolve();
  let release;
  const tail = new Promise((resolve) => { release = resolve; });
  overrideWriteTails.set(destination, tail);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (overrideWriteTails.get(destination) === tail) overrideWriteTails.delete(destination);
  }
}

function safeSegment(value, label) {
  const normalized = String(value || "").trim();
  if (!normalized || !/^[A-Za-z0-9_-]+$/.test(normalized)) {
    throw new Error(`Invalid ${label}`);
  }
  return normalized;
}

export function normalizeCodeLocale(value) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized === "original" || normalized === BASE_HTML_LOCALE) {
    return BASE_HTML_LOCALE;
  }
  if (!LOCALE_RE.test(normalized)) throw new Error("Invalid locale");
  return normalized;
}

function resolveMailPaths(emailBaseRoot, brand, mail) {
  const safeBrand = safeSegment(brand, "brand");
  const safeMail = safeSegment(mail, "mail");
  const mailRoot = path.join(emailBaseRoot, safeBrand, safeMail);
  if (!existsSync(mailRoot)) throw new Error("Mail not found");
  return {
    mailRoot,
    distRoot: path.join(emailBaseRoot, "dist", safeBrand, safeMail),
    overrideRoot: path.join(mailRoot, OVERRIDE_DIR),
  };
}

function compiledHtmlPath(distRoot, locale) {
  return locale === BASE_HTML_LOCALE
    ? path.join(distRoot, "index.html")
    : path.join(distRoot, locale, "index.html");
}

function overrideHtmlPath(overrideRoot, locale) {
  return path.join(overrideRoot, `${locale}.html`);
}

async function fileMetadata(filePath) {
  const info = await stat(filePath);
  return {
    mtimeMs: info.mtimeMs,
    size: info.size,
    version: `${info.dev}:${info.ino}:${info.size}:${info.mtimeMs}:${info.ctimeMs}`,
  };
}

async function listCompiledLocales(distRoot) {
  const locales = new Map();
  const basePath = path.join(distRoot, "index.html");
  if (existsSync(basePath)) locales.set(BASE_HTML_LOCALE, await fileMetadata(basePath));
  if (!existsSync(distRoot)) return locales;
  const entries = await readdir(distRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || !LOCALE_RE.test(entry.name)) continue;
    const filePath = path.join(distRoot, entry.name, "index.html");
    if (existsSync(filePath)) locales.set(entry.name, await fileMetadata(filePath));
  }
  return locales;
}

async function listOverrideLocales(overrideRoot) {
  const locales = new Map();
  if (!existsSync(overrideRoot)) return locales;
  const entries = await readdir(overrideRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".html")) continue;
    const locale = entry.name.slice(0, -5);
    try {
      const normalized = normalizeCodeLocale(locale);
      const metadata = await fileMetadata(path.join(overrideRoot, entry.name));
      locales.set(normalized, {
        ...metadata,
        detachedAt: new Date(metadata.mtimeMs).toISOString(),
      });
    } catch {
      // Ignore unrelated files in the private workbench directory.
    }
  }
  return locales;
}

function localeLabel(locale) {
  return locale === BASE_HTML_LOCALE ? "Original" : locale;
}

function summarizeLocalization(diagnostics) {
  if (!diagnostics) return null;
  return {
    status: diagnostics.status,
    expectedRaw: diagnostics.expectedRaw === true,
    tokenCount: Number(diagnostics.tokenCount || 0),
    unresolvedCount: Number(diagnostics.unresolvedCount || 0),
    replacedCount: Number(diagnostics.replacedCount || 0),
    unresolvedTokens: (diagnostics.unresolvedTokens || []).slice(0, 20),
  };
}

function rememberHtmlDiagnostics(filePath, metadata, diagnostics) {
  htmlDiagnosticsCache.delete(filePath);
  htmlDiagnosticsCache.set(filePath, {
    version: metadata.version,
    localization: summarizeLocalization(diagnostics),
  });
  while (htmlDiagnosticsCache.size > MAX_DIAGNOSTICS_CACHE_ENTRIES) {
    htmlDiagnosticsCache.delete(htmlDiagnosticsCache.keys().next().value);
  }
}

function cachedHtmlDiagnostics(filePath, metadata) {
  const cached = htmlDiagnosticsCache.get(filePath);
  return cached?.version === metadata?.version ? cached.localization : null;
}

export async function listCodeWorkspace({ emailBaseRoot, brand, mail }) {
  const { distRoot, overrideRoot } = resolveMailPaths(emailBaseRoot, brand, mail);
  const [compiled, overrides] = await Promise.all([
    listCompiledLocales(distRoot),
    listOverrideLocales(overrideRoot),
  ]);
  const all = new Set([...compiled.keys(), ...overrides.keys()]);
  const ordered = [...all].sort((left, right) => {
    if (left === BASE_HTML_LOCALE) return -1;
    if (right === BASE_HTML_LOCALE) return 1;
    if (left === "en") return -1;
    if (right === "en") return 1;
    return left.localeCompare(right);
  });
  const locales = ordered.map((code) => {
    const override = overrides.get(code) || null;
    const compiledMetadata = compiled.get(code) || null;
    const effectiveMetadata = override || compiledMetadata;
    const effectivePath = override
      ? overrideHtmlPath(overrideRoot, code)
      : compiledHtmlPath(distRoot, code);
    const localization = cachedHtmlDiagnostics(effectivePath, effectiveMetadata);
    // `null` means "not inspected yet", not "broken". The active HTML read
    // fills the cache and supplies complete diagnostics to the editor banner.
    const ready = code === BASE_HTML_LOCALE
      ? true
      : (localization ? localization.status !== "missing" && localization.unresolvedCount === 0 : null);
    return {
      code,
      label: localeLabel(code),
      detached: Boolean(override),
      detachedAt: override?.detachedAt || null,
      hasCompiled: compiled.has(code),
      ready,
      localization,
      diagnosticsCached: Boolean(localization),
    };
  });
  return {
    locales,
    defaultLocale: compiled.has(BASE_HTML_LOCALE)
      ? BASE_HTML_LOCALE
      : (compiled.has("en") ? "en" : ordered[0] || BASE_HTML_LOCALE),
  };
}

export async function readCodeHtml({ emailBaseRoot, brand, mail, locale }) {
  const normalizedLocale = normalizeCodeLocale(locale);
  const { distRoot, overrideRoot } = resolveMailPaths(emailBaseRoot, brand, mail);
  const overridePath = overrideHtmlPath(overrideRoot, normalizedLocale);
  if (existsSync(overridePath)) {
    const metadata = await fileMetadata(overridePath);
    const resolved = await resolveRemainingHtmlLocalization({
      emailBaseRoot,
      html: await readFile(overridePath, "utf8"),
      locale: normalizedLocale,
    });
    rememberHtmlDiagnostics(overridePath, metadata, resolved.localization);
    return {
      locale: normalizedLocale,
      ...htmlPayload(resolved.html),
      detached: true,
      source: "override",
      localization: resolved.localization,
    };
  }
  const builtPath = compiledHtmlPath(distRoot, normalizedLocale);
  if (!existsSync(builtPath)) throw new Error("Compiled locale not found");
  const metadata = await fileMetadata(builtPath);
  const resolved = await resolveRemainingHtmlLocalization({
    emailBaseRoot,
    html: await readFile(builtPath, "utf8"),
    locale: normalizedLocale,
  });
  rememberHtmlDiagnostics(builtPath, metadata, resolved.localization);
  return {
    locale: normalizedLocale,
    ...htmlPayload(resolved.html),
    detached: false,
    source: "pug",
    localization: resolved.localization,
  };
}

export async function saveCodeHtmlOverride({ emailBaseRoot, brand, mail, locale, html }) {
  const normalizedLocale = normalizeCodeLocale(locale);
  const content = String(html || "");
  if (!content.trim()) throw new Error("HTML is empty");
  if (Buffer.byteLength(content, "utf8") > MAX_HTML_BYTES) throw new Error("HTML is too large");
  const { overrideRoot } = resolveMailPaths(emailBaseRoot, brand, mail);
  const destination = overrideHtmlPath(overrideRoot, normalizedLocale);
  return withOverrideWriteLock(destination, async () => {
    await mkdir(overrideRoot, { recursive: true });
    await writeFileAtomically(destination, content);
    return readCodeHtml({ emailBaseRoot, brand, mail, locale: normalizedLocale });
  });
}

export async function resetCodeHtmlOverride({ emailBaseRoot, brand, mail, locale }) {
  const normalizedLocale = normalizeCodeLocale(locale);
  const { distRoot, overrideRoot } = resolveMailPaths(emailBaseRoot, brand, mail);
  const destination = overrideHtmlPath(overrideRoot, normalizedLocale);
  return withOverrideWriteLock(destination, async () => {
    // Never delete the only copy. "Return from Pug" is available only when a
    // successful compiled fallback exists for this exact locale.
    if (!existsSync(compiledHtmlPath(distRoot, normalizedLocale))) {
      throw new Error("Compiled locale not found; manual version was kept");
    }
    if (!existsSync(destination)) {
      return readCodeHtml({ emailBaseRoot, brand, mail, locale: normalizedLocale });
    }

    // Move the manual version aside first. If the compiled fallback cannot be
    // read/localized, restore the exact override instead of losing user work.
    const backupPath = privateSiblingPath(destination, "reset-backup");
    await rename(destination, backupPath);
    try {
      const restored = await readCodeHtml({ emailBaseRoot, brand, mail, locale: normalizedLocale });
      await rm(backupPath, { force: true });
      return restored;
    } catch (error) {
      try {
        if (!existsSync(destination)) await rename(backupPath, destination);
        else await rm(backupPath, { force: true });
      } catch (restoreError) {
        throw new AggregateError(
          [error, restoreError],
          "Compiled locale could not be restored and the manual backup could not be put back",
          { cause: error },
        );
      }
      throw error;
    }
  });
}

export function isStudioModelFresh(model) {
  return Boolean(model && typeof model === "object" && model.stale !== true && model.status !== "stale");
}

export async function markStudioModelStale({ emailBaseRoot, brand, mail, sourceFile = "" }) {
  const { mailRoot } = resolveMailPaths(emailBaseRoot, brand, mail);
  const modelPath = path.join(mailRoot, "studio-model.json");
  if (!existsSync(modelPath)) return { updated: false, reason: "missing" };
  let model;
  try {
    model = JSON.parse(await readFile(modelPath, "utf8"));
  } catch {
    return { updated: false, reason: "invalid" };
  }
  if (!model || typeof model !== "object") return { updated: false, reason: "invalid" };
  model.stale = true;
  model.status = "stale";
  model.staleAt = new Date().toISOString();
  model.staleReason = sourceFile
    ? `Source file edited in workbench: ${sourceFile}`
    : "Source files edited in workbench";
  await writeFileAtomically(modelPath, JSON.stringify(model, null, 2) + "\n");
  return { updated: true, model };
}
