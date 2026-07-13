import path from "node:path";
import { randomUUID } from "node:crypto";
import { lstat, rename, rm } from "node:fs/promises";

const BACKUP_MARKER = ".retkit-compose-backup-";

async function pathExists(target) {
  try {
    await lstat(target);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function normalizeTarget(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`${label} must be a non-empty path`);
  }
  const target = path.resolve(value);
  if (target === path.parse(target).root) {
    throw new TypeError(`${label} cannot be a filesystem root`);
  }
  return target;
}

function containsPath(parent, child) {
  const relative = path.relative(parent, child);
  return Boolean(relative) && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
}

function assertIndependentTargets(destination, distDestination) {
  if (
    destination === distDestination ||
    containsPath(destination, distDestination) ||
    containsPath(distDestination, destination)
  ) {
    throw new TypeError("destination and distDestination must be separate, non-nested paths");
  }
}

function backupPathFor(target, token) {
  return path.join(
    path.dirname(target),
    `.${path.basename(target)}${BACKUP_MARKER}${token}`,
  );
}

async function createEntries(destination, distDestination) {
  // Keep every backup next to its target. `rename` is then an atomic operation
  // on the same filesystem and cannot fail with EXDEV because of an OS temp dir.
  for (;;) {
    const token = `${process.pid}-${Date.now().toString(36)}-${randomUUID()}`;
    const entries = [
      {
        label: "destination",
        target: destination,
        backup: backupPathFor(destination, token),
      },
      {
        label: "distDestination",
        target: distDestination,
        backup: backupPathFor(distDestination, token),
      },
    ];
    const collisions = await Promise.all(entries.map((entry) => pathExists(entry.backup)));
    if (!collisions.some(Boolean)) return entries;
  }
}

function lifecycleError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

/**
 * Move the current compose output and its compiled dist output aside so a
 * destructive compose/build can be treated as one transaction.
 *
 * Call `commit()` only after both compose and build succeed. Call `rollback()`
 * for every compose/build exception or non-zero build result.
 */
export async function beginComposeSaveTransaction({
  destination,
  distDestination,
  force = false,
} = {}) {
  const normalizedDestination = normalizeTarget(destination, "destination");
  const normalizedDistDestination = normalizeTarget(distDestination, "distDestination");
  assertIndependentTargets(normalizedDestination, normalizedDistDestination);

  const entries = await createEntries(normalizedDestination, normalizedDistDestination);
  const existing = await Promise.all(entries.map((entry) => pathExists(entry.target)));

  if (!force && existing.some(Boolean)) {
    const error = lifecycleError(
      "Refusing to replace an existing compose or dist destination without force",
      "COMPOSE_SAVE_TARGET_EXISTS",
    );
    error.targets = entries
      .filter((_, index) => existing[index])
      .map((entry) => entry.target);
    throw error;
  }

  entries.forEach((entry, index) => {
    entry.existed = existing[index];
    entry.backupPresent = false;
    entry.rollbackComplete = false;
  });

  const moved = [];
  try {
    for (const entry of entries) {
      if (!entry.existed) continue;
      await rename(entry.target, entry.backup);
      entry.backupPresent = true;
      moved.push(entry);
    }
  } catch (setupError) {
    const restoreErrors = [];
    for (const entry of moved.reverse()) {
      try {
        await rename(entry.backup, entry.target);
        entry.backupPresent = false;
      } catch (restoreError) {
        restoreErrors.push(restoreError);
      }
    }
    if (restoreErrors.length) {
      throw new AggregateError(
        [setupError, ...restoreErrors],
        "Could not prepare compose-save transaction and restore its backups",
        { cause: setupError },
      );
    }
    throw setupError;
  }

  let state = "active";

  const transaction = {
    destination: normalizedDestination,
    distDestination: normalizedDistDestination,
    backupPaths: Object.freeze(
      Object.fromEntries(entries.map((entry) => [entry.label, entry.backup])),
    ),
    get state() {
      return state;
    },

    async commit() {
      if (state === "committed") return;
      if (state === "rolled-back" || state === "rollback-failed") {
        throw lifecycleError(
          "Cannot commit a compose-save transaction after rollback",
          "COMPOSE_SAVE_TRANSACTION_CLOSED",
        );
      }

      const cleanupErrors = [];
      for (const entry of entries) {
        if (!entry.backupPresent) continue;
        try {
          await rm(entry.backup, { recursive: true, force: true });
          entry.backupPresent = false;
        } catch (error) {
          cleanupErrors.push(error);
        }
      }

      if (cleanupErrors.length) {
        // A partially cleaned commit must never be rolled back: one old copy
        // may already be gone. Retrying commit is safe and removes the rest.
        state = "commit-failed";
        throw new AggregateError(cleanupErrors, "Compose-save succeeded, but backup cleanup failed");
      }
      state = "committed";
    },

    async rollback() {
      if (state === "rolled-back") return;
      if (state === "committed" || state === "commit-failed") {
        throw lifecycleError(
          "Cannot roll back a committed compose-save transaction",
          "COMPOSE_SAVE_TRANSACTION_CLOSED",
        );
      }

      const rollbackErrors = [];
      for (const entry of entries) {
        if (entry.rollbackComplete) continue;
        try {
          // Remove a partially composed/built replacement before restoring the
          // exact folder that was present at transaction start.
          await rm(entry.target, { recursive: true, force: true });
          if (entry.backupPresent) {
            await rename(entry.backup, entry.target);
            entry.backupPresent = false;
          }
          entry.rollbackComplete = true;
        } catch (error) {
          rollbackErrors.push(error);
        }
      }

      if (rollbackErrors.length) {
        state = "rollback-failed";
        throw new AggregateError(rollbackErrors, "Could not fully roll back compose-save transaction");
      }
      state = "rolled-back";
    },
  };

  return Object.freeze(transaction);
}

/**
 * Convenience wrapper that commits when `operation` resolves and rolls back
 * when it throws. A non-zero child-process exit must therefore be converted to
 * an exception by the caller.
 */
export async function withComposeSaveTransaction(options, operation) {
  if (typeof operation !== "function") {
    throw new TypeError("operation must be a function");
  }

  const transaction = await beginComposeSaveTransaction(options);
  let result;
  try {
    result = await operation(transaction);
  } catch (operationError) {
    try {
      await transaction.rollback();
    } catch (rollbackError) {
      throw new AggregateError(
        [operationError, rollbackError],
        "Compose-save failed and its rollback also failed",
        { cause: operationError },
      );
    }
    throw operationError;
  }

  // Keep this outside the operation catch. If cleanup is only partly
  // successful, rolling back could delete good new output after an old backup
  // was already removed.
  await transaction.commit();
  return result;
}
