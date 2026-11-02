import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { readFile, rename, rm, writeFile } from "node:fs/promises";

import { markStudioModelStale } from "./code-workspace.js";
import {
  resolveWorkbenchSourcePath,
  validateWorkbenchSourceContent,
} from "./mail-source-security.js";

const MAX_SOURCE_FILES = 32;
const MAX_TOTAL_SOURCE_BYTES = 40 * 1024 * 1024;
const SHA256_RE = /^[a-f0-9]{64}$/i;

export function workbenchSourceContentHash(content) {
  const input = Buffer.isBuffer(content)
    ? content
    : Buffer.from(String(content ?? ""), "utf8");
  return createHash("sha256").update(input).digest("hex");
}

function transactionError(message, { code = "INVALID_BULK_SOURCE_SAVE", statusCode = 400 } = {}) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function privateSiblingPath(destination, purpose, token) {
  return path.join(path.dirname(destination), `.${path.basename(destination)}.${purpose}-${token}`);
}

function normalizeSourceFileBatch(files) {
  if (!Array.isArray(files) || files.length === 0) {
    throw transactionError("At least one Workbench source file is required");
  }
  if (files.length > MAX_SOURCE_FILES) {
    throw transactionError(`Workbench can save at most ${MAX_SOURCE_FILES} source files at once`, {
      code: "BULK_SOURCE_SAVE_TOO_LARGE",
      statusCode: 413,
    });
  }

  let totalBytes = 0;
  return files.map((entry, index) => {
    if (!entry || typeof entry !== "object") {
      throw transactionError(`Invalid Workbench source file at index ${index}`);
    }
    const file = String(entry.file || "");
    const content = String(entry.content ?? "");
    const expectedHash = String(entry.expectedHash || "").trim().toLowerCase();
    if (!SHA256_RE.test(expectedHash)) {
      throw transactionError(`Expected SHA-256 baseline is required for Workbench source file at index ${index}`, {
        code: "SOURCE_BASELINE_REQUIRED",
        statusCode: 400,
      });
    }
    totalBytes += Buffer.byteLength(content, "utf8");
    if (totalBytes > MAX_TOTAL_SOURCE_BYTES) {
      throw transactionError("Workbench source file batch is too large", {
        code: "BULK_SOURCE_SAVE_TOO_LARGE",
        statusCode: 413,
      });
    }
    return { file, content, expectedHash };
  });
}

async function rollbackEntries(entries, operations, originalError) {
  const rollbackErrors = [];
  for (const entry of [...entries].reverse()) {
    if (entry.backupPresent) {
      try {
        await operations.rm(entry.target, { force: true });
        await operations.rename(entry.backup, entry.target);
        entry.backupPresent = false;
      } catch (error) {
        rollbackErrors.push(error);
      }
    }
    try {
      await operations.rm(entry.temp, { force: true });
    } catch (error) {
      rollbackErrors.push(error);
    }
  }
  if (rollbackErrors.length) {
    throw new AggregateError(
      [originalError, ...rollbackErrors],
      "Workbench source batch failed and could not be fully rolled back",
      { cause: originalError },
    );
  }
  throw originalError;
}

/**
 * Validate and replace every requested Pug/Jade/Stylus/CSS source as one
 * server-side transaction. All new bytes are staged before any current source
 * moves. If any replacement or stale-model update fails, every original file
 * is restored before the error is returned.
 */
export async function saveWorkbenchSourceFilesAtomically({
  emailBaseRoot,
  brand,
  mail,
  files,
  operations = {},
  markStale = markStudioModelStale,
} = {}) {
  const requested = normalizeSourceFileBatch(files);
  const ops = {
    readFile: operations.readFile || readFile,
    writeFile: operations.writeFile || writeFile,
    rename: operations.rename || rename,
    rm: operations.rm || rm,
  };
  const token = `${process.pid}-${Date.now().toString(36)}-${randomUUID()}`;
  const seenTargets = new Set();
  const entries = requested.map(({ file, content, expectedHash }) => {
    const resolved = resolveWorkbenchSourcePath({ emailBaseRoot, brand, mail, file });
    if (seenTargets.has(resolved.target)) {
      throw transactionError(`Duplicate Workbench source file: ${resolved.file}`);
    }
    seenTargets.add(resolved.target);
    validateWorkbenchSourceContent({
      content,
      target: resolved.target,
      file: resolved.file,
      mailRoot: resolved.mailRoot,
      emailBaseRoot: resolved.emailBaseRoot,
    });
    return {
      ...resolved,
      content,
      expectedHash,
      temp: privateSiblingPath(resolved.target, "retkit-bulk-new", token),
      backup: privateSiblingPath(resolved.target, "retkit-bulk-backup", token),
      backupPresent: false,
    };
  });

  try {
    // Optimistic concurrency is checked only after the HTTP route acquired the
    // shared mail lock. A proposal reviewed against older bytes must never
    // overwrite a manual/autosave revision that won the lock first.
    for (const entry of entries) {
      const current = await ops.readFile(entry.target);
      const currentHash = workbenchSourceContentHash(current);
      if (currentHash !== entry.expectedHash) {
        throw transactionError(
          `Workbench source changed after AI review: ${entry.file}`,
          { code: "SOURCE_VERSION_CONFLICT", statusCode: 409 },
        );
      }
    }

    // Stage the complete batch first. A disk/permission failure here cannot
    // change any current source file.
    for (const entry of entries) {
      await ops.writeFile(entry.temp, entry.content, { encoding: "utf8", flag: "wx" });
    }
    // Preserve every original before installing the first replacement.
    for (const entry of entries) {
      await ops.rename(entry.target, entry.backup);
      entry.backupPresent = true;
    }
    for (const entry of entries) {
      await ops.rename(entry.temp, entry.target);
    }

    const changedFiles = entries.map((entry) => entry.file);
    const staleResult = await markStale({
      emailBaseRoot,
      brand: entries[0].brand,
      mail: entries[0].mail,
      sourceFile: changedFiles.length === 1
        ? changedFiles[0]
        : `${changedFiles.length} source files (atomic Workbench accept)`,
    });

    // At this point the transaction is committed. Backup cleanup failures must
    // not report a false rollback: retain the sidecar and surface a warning.
    const backupCleanupWarnings = [];
    for (const entry of entries) {
      try {
        await ops.rm(entry.backup, { recursive: true, force: true });
        entry.backupPresent = false;
      } catch (error) {
        backupCleanupWarnings.push(String(error?.message || error));
      }
    }
    return {
      ok: true,
      brand: entries[0].brand,
      mail: entries[0].mail,
      files: changedFiles,
      studioModelStale: Boolean(staleResult?.updated),
      backupCleanupWarnings,
    };
  } catch (error) {
    return rollbackEntries(entries, ops, error);
  } finally {
    await Promise.all(entries.map((entry) => ops.rm(entry.temp, { force: true }).catch(() => {})));
  }
}
