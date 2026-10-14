import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  acquireKeyedOperationLock,
  withKeyedOperationLock,
} from "../src/keyed-operation-lock.js";
import {
  saveWorkbenchSourceFilesAtomically,
  workbenchSourceContentHash,
} from "../src/workbench-source-transaction.js";

const root = await mkdtemp(path.join(os.tmpdir(), "retkit-workbench-source-transaction-"));
const emailBaseRoot = path.join(root, "email-base");
const brand = "X_Test";
const mail = "mail-atomic";
const mailRoot = path.join(emailBaseRoot, brand, mail);
const appRoot = path.join(mailRoot, "app");
const pugPath = path.join(appRoot, "templates", "blocks", "header.pug");
const stylPath = path.join(appRoot, "styles", "common.styl");
const modelPath = path.join(mailRoot, "studio-model.json");

const originalPug = "table(role='presentation')\n  tr\n    td Original\n";
const originalStyl = ".original\n  color #111\n";
const changedPug = "table(role='presentation')\n  tr\n    td Changed together\n";
const changedStyl = ".changed\n  color #222\n";
const originalPugHash = workbenchSourceContentHash(originalPug);
const originalStylHash = workbenchSourceContentHash(originalStyl);

async function resetSources() {
  await writeFile(pugPath, originalPug, "utf8");
  await writeFile(stylPath, originalStyl, "utf8");
  await writeFile(modelPath, `${JSON.stringify({ status: "ready", stale: false }, null, 2)}\n`, "utf8");
}

async function assertSources(pug, styl, label) {
  assert.equal(await readFile(pugPath, "utf8"), pug, `${label}: Pug`);
  assert.equal(await readFile(stylPath, "utf8"), styl, `${label}: Stylus`);
}

async function assertNoTransactionSidecars() {
  const names = [];
  const walk = async directory => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(target);
      else if (/retkit-bulk-(?:new|backup)-/.test(entry.name)) names.push(target);
    }
  };
  await walk(appRoot);
  assert.deepEqual(names, [], "transaction sidecars must be cleaned");
}

try {
  await mkdir(path.dirname(pugPath), { recursive: true });
  await mkdir(path.dirname(stylPath), { recursive: true });
  await resetSources();

  const success = await saveWorkbenchSourceFilesAtomically({
    emailBaseRoot,
    brand,
    mail,
    files: [
      { file: "templates/blocks/header.pug", content: changedPug, expectedHash: originalPugHash },
      { file: "styles/common.styl", content: changedStyl, expectedHash: originalStylHash },
    ],
  });
  assert.equal(success.ok, true);
  assert.deepEqual(success.files, [
    "templates/blocks/header.pug",
    "styles/common.styl",
  ]);
  assert.equal(success.studioModelStale, true);
  await assertSources(changedPug, changedStyl, "successful batch must replace both files");
  assert.equal(JSON.parse(await readFile(modelPath, "utf8")).stale, true);
  await assertNoTransactionSidecars();

  await resetSources();
  await assert.rejects(
    saveWorkbenchSourceFilesAtomically({
      emailBaseRoot,
      brand,
      mail,
      files: [
        { file: "templates/blocks/header.pug", content: changedPug, expectedHash: originalPugHash },
        { file: "styles/common.styl", content: "@js { process.exit(1) }\n", expectedHash: originalStylHash },
      ],
    }),
    /not allowed/i,
    "all files must validate before the first write",
  );
  await assertSources(originalPug, originalStyl, "invalid second file must leave the whole batch unchanged");
  assert.equal(JSON.parse(await readFile(modelPath, "utf8")).stale, false);
  await assertNoTransactionSidecars();

  await resetSources();
  let replacementNumber = 0;
  await assert.rejects(
    saveWorkbenchSourceFilesAtomically({
      emailBaseRoot,
      brand,
      mail,
      files: [
        { file: "templates/blocks/header.pug", content: changedPug, expectedHash: originalPugHash },
        { file: "styles/common.styl", content: changedStyl, expectedHash: originalStylHash },
      ],
      operations: {
        rename: async (source, destination) => {
          if (/retkit-bulk-new-/.test(path.basename(source))) {
            replacementNumber += 1;
            if (replacementNumber === 2) throw new Error("simulated second replacement failure");
          }
          return rename(source, destination);
        },
      },
    }),
    /simulated second replacement failure/,
    "a second-file write failure must reject the complete proposal",
  );
  await assertSources(originalPug, originalStyl, "second-file failure must roll back the first replacement");
  assert.equal(JSON.parse(await readFile(modelPath, "utf8")).stale, false);
  await assertNoTransactionSidecars();

  await resetSources();
  const concurrentPug = "table(role='presentation')\n  tr\n    td Manual edit won first\n";
  const mailLockKey = `mail:${brand}/${mail}`;
  const releaseManualSave = await acquireKeyedOperationLock(mailLockKey);
  const queuedAiSave = withKeyedOperationLock(mailLockKey, () => (
    saveWorkbenchSourceFilesAtomically({
      emailBaseRoot,
      brand,
      mail,
      files: [
        { file: "templates/blocks/header.pug", content: changedPug, expectedHash: originalPugHash },
        { file: "styles/common.styl", content: changedStyl, expectedHash: originalStylHash },
      ],
    })
  ));
  // The manual save already owns the same lock used by the HTTP routes. Its
  // bytes land before the queued AI transaction gets to run its CAS check.
  await writeFile(pugPath, concurrentPug, "utf8");
  releaseManualSave();
  let conflict = null;
  try {
    await queuedAiSave;
  } catch (error) {
    conflict = error;
  }
  assert.ok(conflict, "a source changed after AI review must reject the complete proposal");
  assert.equal(conflict.code, "SOURCE_VERSION_CONFLICT");
  assert.equal(conflict.statusCode, 409);
  await assertSources(
    concurrentPug,
    originalStyl,
    "optimistic conflict must preserve both the winning manual edit and untouched siblings",
  );
  assert.equal(JSON.parse(await readFile(modelPath, "utf8")).stale, false);
  await assertNoTransactionSidecars();

  await resetSources();
  await assert.rejects(
    saveWorkbenchSourceFilesAtomically({
      emailBaseRoot,
      brand,
      mail,
      files: [
        { file: "templates/blocks/header.pug", content: changedPug },
      ],
    }),
    error => error?.code === "SOURCE_BASELINE_REQUIRED" && error?.statusCode === 400,
    "bulk source replacement must fail closed when its reviewed SHA-256 baseline is missing",
  );
  await assertSources(originalPug, originalStyl, "missing baseline must not mutate any source");

  await assert.rejects(
    saveWorkbenchSourceFilesAtomically({
      emailBaseRoot,
      brand,
      mail,
      files: [
        { file: "templates/blocks/header.pug", content: changedPug, expectedHash: originalPugHash },
        { file: "templates/blocks/header.pug", content: changedPug, expectedHash: originalPugHash },
      ],
    }),
    /Duplicate Workbench source file/,
  );
  await assertSources(originalPug, originalStyl, "duplicate target rejection must not mutate source");

  const [workbenchSource, serverSource, codeWorkspaceSource] = await Promise.all([
    readFile(new URL("../public/workbench.js", import.meta.url), "utf8"),
    readFile(new URL("../server.js", import.meta.url), "utf8"),
    readFile(new URL("../src/code-workspace.js", import.meta.url), "utf8"),
  ]);
  const offerStart = workbenchSource.indexOf("function offerSourceFileEditsApply(");
  const offerEnd = workbenchSource.indexOf("function parseAiLocaleEdits(", offerStart);
  const offerSource = workbenchSource.slice(offerStart, offerEnd);
  assert.match(offerSource, /await saveAiSourceFilesAtomically\(ctx, persistableEdits, reviewedFiles\)/);
  assert.doesNotMatch(
    offerSource,
    /saveAuxiliarySourceFile\(/,
    "AI accept must not persist a multi-file proposal as independent requests",
  );
  const bulkClientStart = workbenchSource.indexOf("async function saveAiSourceFilesAtomically(");
  const bulkClientEnd = workbenchSource.indexOf("function offerSourceFileEditsApply(", bulkClientStart);
  const bulkClientSource = workbenchSource.slice(bulkClientStart, bulkClientEnd);
  assert.equal(
    (bulkClientSource.match(/fetch\('\/api\/wb\/email-files'/g) || []).length,
    1,
    "AI multi-file accept must use one bulk request",
  );
  assert.match(bulkClientSource, /expectedHash/,
    "AI bulk accept must send the reviewed persisted SHA-256 baseline");
  const bulkRouteStart = serverSource.indexOf('request.url === "/api/wb/email-files"');
  const bulkRouteEnd = serverSource.indexOf("// ── Workbench: read a source file", bulkRouteStart);
  const bulkRouteSource = serverSource.slice(bulkRouteStart, bulkRouteEnd);
  assert.match(bulkRouteSource, /acquireKeyedOperationLock/);
  assert.match(bulkRouteSource, /saveWorkbenchSourceFilesAtomically/);
  assert.match(
    codeWorkspaceSource,
    /export async function saveCodeHtmlOverride[\s\S]*?writeFileAtomically\(destination, content\)/,
    "AI HTML proposal accept must keep using atomic override replacement",
  );

  console.log("workbench source transaction tests: ok");
} finally {
  await rm(root, { recursive: true, force: true });
}
