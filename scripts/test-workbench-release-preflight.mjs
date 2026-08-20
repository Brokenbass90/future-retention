import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import {
  auditWorkbenchReleaseHtml,
  assertReleaseEmailWeights,
  EMAIL_CLIP_LIMIT_BYTES,
  EMAIL_WEIGHT_LIMIT_EXCEEDED,
  summarizeReleaseEmailWeights,
} from "../src/workbench-release-preflight.js";
import {
  codeHtmlContentHash,
  readCodeHtml,
  resetCodeHtmlOverride,
  saveCodeHtmlOverride,
} from "../src/code-workspace.js";
import { withWorkbenchMailOperationLock } from "../src/workbench-mail-operation-lock.js";

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

const belowLimit = summarizeReleaseEmailWeights([
  { locale: "base", html: "x".repeat(EMAIL_CLIP_LIMIT_BYTES - 1) },
]);
assert.equal(belowLimit.ok, true);
assert.equal(belowLimit.largest.htmlBytes, EMAIL_CLIP_LIMIT_BYTES - 1);

const utf8Report = summarizeReleaseEmailWeights([
  { locale: "base", html: "é".repeat(EMAIL_CLIP_LIMIT_BYTES / 2) },
]);
assert.equal(utf8Report.largest.htmlBytes, EMAIL_CLIP_LIMIT_BYTES);
assert.equal(utf8Report.ok, false, "weight must use UTF-8 bytes, not JavaScript string length");

let exactLimitError = null;
try {
  assertReleaseEmailWeights([
    { locale: "base", html: "small" },
    { locale: "ar", html: "x".repeat(EMAIL_CLIP_LIMIT_BYTES) },
  ]);
} catch (error) {
  exactLimitError = error;
}
assert.ok(exactLimitError, "the inclusive 102 KiB boundary must block release");
assert.equal(exactLimitError.code, EMAIL_WEIGHT_LIMIT_EXCEEDED);
assert.equal(exactLimitError.statusCode, 422);
assert.equal(exactLimitError.releasePreflight.checked, 2);
assert.deepEqual(
  exactLimitError.releasePreflight.overweight.map((sample) => sample.locale),
  ["ar"],
  "an overweight non-first locale must fail the all-locale gate",
);

const tempRoot = await mkdtemp(path.join(os.tmpdir(), "retkit-release-preflight-"));
try {
  const mailRoot = path.join(tempRoot, "X_Test", "mail-release");
  const distRoot = path.join(tempRoot, "dist", "X_Test", "mail-release");
  const overrideRoot = path.join(mailRoot, ".retkit-workbench", "html-overrides");
  await mkdir(path.join(distRoot, "en"), { recursive: true });
  await mkdir(path.join(mailRoot, "app"), { recursive: true });
  await mkdir(overrideRoot, { recursive: true });
  await writeFile(path.join(distRoot, "index.html"), "<html>Original</html>", "utf8");
  await writeFile(path.join(distRoot, "en", "index.html"), "<html>Compiled EN</html>", "utf8");
  await writeFile(
    path.join(overrideRoot, "en.html"),
    "x".repeat(EMAIL_CLIP_LIMIT_BYTES),
    "utf8",
  );

  let overrideError = null;
  try {
    await auditWorkbenchReleaseHtml({
      emailBaseRoot: tempRoot,
      brand: "X_Test",
      mail: "mail-release",
    });
  } catch (error) {
    overrideError = error;
  }
  assert.ok(overrideError, "a detached HTML override must participate in release preflight");
  const enSample = overrideError.releasePreflight.overweight.find((sample) => sample.locale === "en");
  assert.equal(enSample?.detached, true);
  assert.equal(enSample?.source, "override");
  assert.equal(enSample?.htmlBytes, EMAIL_CLIP_LIMIT_BYTES);

  // Race regression: the strict audit captures the exact effective bytes. If
  // an override changes after the audit lock is released but before the client
  // fetches export bytes, its GET hash must differ and the UI must mark the
  // release snapshot stale instead of exporting under the old weight result.
  const auditedOverride = "<html><body>Audited override</body></html>";
  await writeFile(path.join(overrideRoot, "en.html"), auditedOverride, "utf8");
  const audited = await auditWorkbenchReleaseHtml({
    emailBaseRoot: tempRoot,
    brand: "X_Test",
    mail: "mail-release",
  });
  const auditedEn = audited.samples.find(sample => sample.locale === "en");
  assert.equal(auditedEn?.htmlHash, codeHtmlContentHash(auditedOverride));

  const changedAfterAudit = "<html><body>Override changed after strict audit</body></html>";
  await writeFile(path.join(overrideRoot, "en.html"), changedAfterAudit, "utf8");
  const fetchedAfterAudit = await readCodeHtml({
    emailBaseRoot: tempRoot,
    brand: "X_Test",
    mail: "mail-release",
    locale: "en",
  });
  assert.notEqual(
    fetchedAfterAudit.htmlHash,
    auditedEn.htmlHash,
    "an override changed after strict audit must not match the release snapshot",
  );
  assert.equal(fetchedAfterAudit.htmlHash, codeHtmlContentHash(fetchedAfterAudit.html));

  // The production routes use this exact per-mail key. A queued override save
  // cannot enter while strict build/audit owns it; after it commits, the next
  // audit observes and rejects the overweight revision.
  await writeFile(path.join(overrideRoot, "en.html"), auditedOverride, "utf8");
  const auditEntered = deferred();
  const allowAudit = deferred();
  const lockEvents = [];
  const lockOptions = {
    emailBaseRoot: tempRoot,
    brand: "X_Test",
    mail: "mail-release",
  };
  const strictWhileLocked = withWorkbenchMailOperationLock(lockOptions, async () => {
    lockEvents.push("audit-enter");
    auditEntered.resolve();
    await allowAudit.promise;
    const report = await auditWorkbenchReleaseHtml({
      emailBaseRoot: tempRoot,
      brand: "X_Test",
      mail: "mail-release",
    });
    lockEvents.push("audit-exit");
    return report;
  });
  await auditEntered.promise;
  const queuedOverrideSave = withWorkbenchMailOperationLock(lockOptions, async () => {
    lockEvents.push("save-enter");
    return saveCodeHtmlOverride({
      emailBaseRoot: tempRoot,
      brand: "X_Test",
      mail: "mail-release",
      locale: "en",
      html: "x".repeat(EMAIL_CLIP_LIMIT_BYTES),
    });
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(lockEvents, ["audit-enter"], "override save must wait for strict audit");
  allowAudit.resolve();
  const [lockedReport] = await Promise.all([strictWhileLocked, queuedOverrideSave]);
  assert.equal(lockedReport.ok, true);
  assert.deepEqual(lockEvents, ["audit-enter", "audit-exit", "save-enter"]);
  await assert.rejects(
    auditWorkbenchReleaseHtml({
      emailBaseRoot: tempRoot,
      brand: "X_Test",
      mail: "mail-release",
    }),
    error => error?.code === EMAIL_WEIGHT_LIMIT_EXCEEDED,
    "the next strict audit must see the queued overweight override",
  );

  const resetBlockEntered = deferred();
  const allowReset = deferred();
  const resetEvents = [];
  const heldBeforeReset = withWorkbenchMailOperationLock(lockOptions, async () => {
    resetEvents.push("audit-enter");
    resetBlockEntered.resolve();
    await allowReset.promise;
    resetEvents.push("audit-exit");
  });
  await resetBlockEntered.promise;
  const queuedReset = withWorkbenchMailOperationLock(lockOptions, async () => {
    resetEvents.push("reset-enter");
    return resetCodeHtmlOverride({
      emailBaseRoot: tempRoot,
      brand: "X_Test",
      mail: "mail-release",
      locale: "en",
    });
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(resetEvents, ["audit-enter"], "override reset must wait for strict audit");
  allowReset.resolve();
  await Promise.all([heldBeforeReset, queuedReset]);
  assert.deepEqual(resetEvents, ["audit-enter", "audit-exit", "reset-enter"]);
  const afterReset = await readCodeHtml({
    emailBaseRoot: tempRoot,
    brand: "X_Test",
    mail: "mail-release",
    locale: "en",
  });
  assert.equal(afterReset.source, "pug");
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const [serverSource, workbenchSource] = await Promise.all([
  readFile(path.join(root, "server.js"), "utf8"),
  readFile(path.join(root, "public", "workbench.js"), "utf8"),
]);

function functionSource(name) {
  const start = workbenchSource.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} must exist`);
  const brace = workbenchSource.indexOf("{", start);
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let i = brace; i < workbenchSource.length; i += 1) {
    const char = workbenchSource[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return workbenchSource.slice(start, i + 1);
    }
  }
  throw new Error(`Cannot extract ${name}`);
}

function sourceBetween(startMarker, endMarker) {
  const start = workbenchSource.indexOf(startMarker);
  const end = workbenchSource.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `${startMarker} must exist`);
  assert.notEqual(end, -1, `${endMarker} must exist after ${startMarker}`);
  return workbenchSource.slice(start, end);
}

// Real production-helper regression: the display cache may refresh or be
// mutated after preflight, but export selection is a closed operation over the
// immutable audited snapshot and therefore still returns the audited bytes.
const snapshotSandbox = { result: null };
vm.runInNewContext(`
  const HTML_BASE_LOCALE = 'base';
  ${functionSource("normalizeReleaseSnapshotLocale")}
  ${functionSource("createImmutableReleaseSnapshot")}
  ${functionSource("createReleasePreflightResult")}
  ${functionSource("getReleaseSnapshotHtml")}

  const auditedHtml = '<html><body>audited bytes</body></html>';
  const releaseReady = createReleasePreflightResult(
    { state: 'ready', total: 1 },
    [{ locale: 'EN', html: auditedHtml, htmlHash: '${"a".repeat(64)}' }],
  );
  const ctx = {
    activeHtmlLocale: 'en',
    compiledHtmlByLocale: { en: { html: '<html>display before</html>' } },
  };
  ctx.compiledHtmlByLocale.en.html = '<html>display changed after preflight</html>';
  releaseReady.snapshotByLocale.en.html = '<html>attempted snapshot mutation</html>';
  releaseReady.snapshotByLocale.en = {
    locale: 'en',
    html: '<html>attempted entry replacement</html>',
    htmlHash: '${"b".repeat(64)}',
  };
  result = {
    exportHtml: getReleaseSnapshotHtml(releaseReady, ctx.activeHtmlLocale),
    displayHtml: ctx.compiledHtmlByLocale.en.html,
    snapshotFrozen: Object.isFrozen(releaseReady.snapshotByLocale),
    entryFrozen: Object.isFrozen(releaseReady.snapshotByLocale.en),
  };
`, snapshotSandbox);
assert.equal(snapshotSandbox.result.exportHtml, "<html><body>audited bytes</body></html>");
assert.equal(snapshotSandbox.result.displayHtml, "<html>display changed after preflight</html>");
assert.equal(snapshotSandbox.result.snapshotFrozen, true);
assert.equal(snapshotSandbox.result.entryFrozen, true);

const buildRoute = serverSource.match(
  /if \(request\.method === "POST" && request\.url === "\/api\/wb\/build-email"\) \{([\s\S]*?)\n    \}\n\n    \/\/ ── Workbench: Clone email/,
)?.[1] || "";
assert.match(buildRoute, /releasePreflightRequested = body\?\.releasePreflight === true/);
assert.match(buildRoute, /acquireWorkbenchMailOperationLock\(/,
  "strict build and HTML override mutations must use the same normalized mail lock helper");
assert.match(buildRoute, /if \(releasePreflightRequested\) buildArgs\.push\("--failOnWeight"\)/);
assert.match(buildRoute, /auditWorkbenchReleaseHtml\(/,
  "strict build must also audit effective detached/manual locale HTML");
const htmlSaveRoute = serverSource.match(
  /if \(request\.method === "POST" && request\.url === "\/api\/wb\/code-html"\) \{([\s\S]*?)\n    \}\n\n    if \(request\.method === "POST" && request\.url === "\/api\/wb\/code-html\/reset"\)/,
)?.[1] || "";
const htmlResetRoute = serverSource.match(
  /if \(request\.method === "POST" && request\.url === "\/api\/wb\/code-html\/reset"\) \{([\s\S]*?)\n    \}\n\n    \/\/ ── Workbench: list editable source files/,
)?.[1] || "";
for (const [label, route] of [["save", htmlSaveRoute], ["reset", htmlResetRoute]]) {
  assert.match(route, /acquireWorkbenchMailOperationLock\(\{ emailBaseRoot, brand, mail \}\)/,
    `${label} override route must share the strict build mail lock`);
  assert.match(route, /const \{ resolved \} = locked/,
    `${label} override route must use the mail resolved by the shared lock`);
  assert.match(route, /finally \{[\s\S]*?releaseHtmlLock\?\.\(\)/,
    `${label} override route must always release the shared mail lock`);
}

const backgroundBuild = workbenchSource.match(
  /async function performSourceEmailBuild\(ctx\) \{([\s\S]*?)\n\}\n\nasync function rebuildSourceEmail/,
)?.[1] || "";
assert.match(backgroundBuild, /releasePreflight: false/,
  "ordinary editor rebuilds must remain warning-only");
const releaseRequest = workbenchSource.match(
  /async function requestReleasePreflightBuild\(ctx\) \{([\s\S]*?)\n\}\n\nasync function runAllLocalePreflight/,
)?.[1] || "";
assert.match(releaseRequest, /releasePreflight: true/,
  "the explicit final check must opt in to strict server enforcement");
const allLocalePreflight = workbenchSource.match(
  /async function runAllLocalePreflight\(ctx = state\.srcCtx\) \{([\s\S]*?)\n\}\n\nfunction htmlUtf8Bytes/,
)?.[1] || "";
assert.match(allLocalePreflight, /releaseSamplesByLocale/);
assert.match(allLocalePreflight, /expectedHash !== responseHash/);
assert.match(allLocalePreflight, /expectedHash !== fetchedBytesHash/,
  "client must hash the fetched HTML bytes instead of trusting response metadata alone");
assert.match(allLocalePreflight, /HTML изменился после строгой проверки веса/,
  "client must reject export bytes that do not match the strict audit snapshot");
assert.match(allLocalePreflight, /snapshotEntries\.push\(/,
  "preflight must retain the exact verified HTML bytes separately from the display cache");
assert.match(allLocalePreflight, /createReleasePreflightResult\(report, snapshotEntries\)/,
  "preflight must return an immutable locale release snapshot");
const ensureReleaseReady = functionSource("ensureHtmlReleaseReady");
assert.match(ensureReleaseReady, /releaseReady\?\.report/);
assert.match(ensureReleaseReady, /snapshotByLocale/,
  "the export gate must return and validate the immutable release snapshot");
assert.match(workbenchSource, /downloadHtmlBtn\.addEventListener\('click', async \(\) => \{[\s\S]*?await ensureHtmlReleaseReady\(ctx\)/,
  "the primary HTML download must await release preflight");
assert.match(workbenchSource, /copyHtmlBtn\.addEventListener\('click', async \(\) => \{[\s\S]*?await ensureHtmlReleaseReady\(ctx\)/,
  "copying final HTML must await the same release preflight");
assert.match(workbenchSource, /\$\('fsDownloadBtn'\)\?\.addEventListener\('click', async \(\) => \{[\s\S]*?ensureHtmlReleaseReady/,
  "fullscreen HTML download must not bypass release preflight");
assert.match(workbenchSource, /\$\('fsCopyBtn'\)\?\.addEventListener\('click', async \(\) => \{[\s\S]*?ensureHtmlReleaseReady/,
  "fullscreen HTML copy must not bypass release preflight");

const exportHandlers = [
  ["fullscreen copy", sourceBetween("$('fsCopyBtn')?.addEventListener", "$('fsDownloadBtn')?.addEventListener")],
  ["fullscreen download", sourceBetween("$('fsDownloadBtn')?.addEventListener", "// Source panes outside the primary editor")],
  ["primary copy", sourceBetween("r.copyHtmlBtn.addEventListener", "r.downloadHtmlBtn.addEventListener")],
  ["primary download", sourceBetween("r.downloadHtmlBtn.addEventListener", "// ═══════════════════════════════════════════════════════════════\n// VALIDATION")],
];
for (const [label, handler] of exportHandlers) {
  assert.match(handler, /getReleaseSnapshotHtml\(releaseReady,/,
    `${label} must export the audited immutable locale snapshot`);
  assert.doesNotMatch(handler, /compiledHtmlByLocale/,
    `${label} must not export mutable display-cache bytes`);
}

console.log("✓ Workbench release preflight: UTF-8 >=102 KiB gate, all locales, overrides, export guard");
