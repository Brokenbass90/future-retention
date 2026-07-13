import path from "node:path";
import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";

const LOCALE_DIR_RE = /^[A-Za-z]{2}(?:[_-][A-Za-z]{2})?$/;

function uniqueLocales(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => String(value || "").trim())
    .filter((value) => LOCALE_DIR_RE.test(value)))]
    .sort((left, right) => left.localeCompare(right));
}

export async function listExistingCompiledLocales(distRoot) {
  if (typeof distRoot !== "string" || !distRoot.trim() || !existsSync(distRoot)) return [];
  const entries = await readdir(distRoot, { withFileTypes: true });
  return uniqueLocales(entries
    .filter((entry) => entry.isDirectory()
      && LOCALE_DIR_RE.test(entry.name)
      && existsSync(path.join(distRoot, entry.name, "index.html")))
    .map((entry) => entry.name));
}

/**
 * Choose locale CLI policy for a Workbench build.
 *
 * A non-empty editable snapshot is authoritative. If it contains no editable
 * locale (for example, state has builtins only), preserve this mail's already
 * compiled locale set rather than pruning it and showing raw Original HTML.
 */
export function chooseWorkbenchBuildLocalePolicy({
  namespacesProvided,
  syncedLocales = [],
  existingLocales = [],
} = {}) {
  if (!namespacesProvided) return { mode: "discover", locales: [], source: "vendor" };
  const snapshot = uniqueLocales(syncedLocales);
  if (snapshot.length) return { mode: "selected", locales: snapshot, source: "snapshot" };
  const existing = uniqueLocales(existingLocales);
  if (existing.length) return { mode: "selected", locales: existing, source: "existing-dist" };
  return { mode: "skip", locales: [], source: "empty-workspace" };
}

export async function resolveWorkbenchBuildLocalePolicy({
  namespacesProvided,
  syncedLocales,
  distRoot,
} = {}) {
  const existingLocales = namespacesProvided && !(Array.isArray(syncedLocales) && syncedLocales.length)
    ? await listExistingCompiledLocales(distRoot)
    : [];
  return chooseWorkbenchBuildLocalePolicy({ namespacesProvided, syncedLocales, existingLocales });
}
