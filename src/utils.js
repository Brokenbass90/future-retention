/**
 * src/utils.js — Pure utility functions (no side effects, no I/O)
 *
 * These are small helpers used across the entire codebase.
 * All functions are pure (same input → same output) and have no dependencies.
 */

import path from "node:path";

// ─── String utilities ─────────────────────────────────────────────────────────

/**
 * Trims a string, returns "" for non-string values.
 * This is the single most-used utility in the project.
 *
 * @param {*} value
 * @returns {string}
 */
export function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Deduplicates and sorts an array of strings.
 * Empty strings and non-strings are removed.
 *
 * @param {*[]} values
 * @returns {string[]}
 */
export function dedupeStrings(values) {
  return Array.from(
    new Set((values || []).map((value) => cleanText(value)).filter(Boolean))
  ).sort();
}

// ─── Path utilities ───────────────────────────────────────────────────────────

/**
 * Converts an absolute file path to a path relative to the project root,
 * using forward slashes (safe for display + JSON storage).
 *
 * @param {string} filePath  Absolute path
 * @param {string} rootDir   Project root directory
 * @returns {string}
 */
export function toRelativePath(filePath, rootDir) {
  return path.relative(rootDir, filePath).split(path.sep).join("/");
}

// ─── Catalog source helpers ───────────────────────────────────────────────────

/**
 * Deduplicates an array of catalog source objects.
 * Sources are keyed by category|mailId|file|evidence.
 *
 * @param {object[]} sources
 * @returns {object[]}
 */
export function dedupeCatalogSources(sources) {
  const map = new Map();

  for (const source of Array.isArray(sources) ? sources : []) {
    const normalized = {
      category: cleanText(source?.category),
      mailId: cleanText(source?.mailId),
      file: cleanText(source?.file),
      evidence: cleanText(source?.evidence),
      order: Number(source?.order) || 0
    };
    const key = [normalized.category, normalized.mailId, normalized.file, normalized.evidence].join("|");
    map.set(key, normalized);
  }

  return [...map.values()].sort(
    (l, r) => l.order - r.order || l.file.localeCompare(r.file)
  );
}

/**
 * Merges two trait objects, taking the "max" value for each field.
 *
 * @param {object} left
 * @param {object} right
 * @returns {object}
 */
export function mergeCatalogTraits(left = {}, right = {}) {
  return {
    hasImage: Boolean(left.hasImage || right.hasImage),
    hasCta: Boolean(left.hasCta || right.hasCta),
    ctaCount: Math.max(Number(left.ctaCount) || 0, Number(right.ctaCount) || 0),
    itemMode: cleanText(right.itemMode) || cleanText(left.itemMode) || "none",
    minItems: Math.max(Number(left.minItems) || 0, Number(right.minItems) || 0),
    outlookSafe: Boolean(left.outlookSafe || right.outlookSafe),
    vml: Boolean(left.vml || right.vml)
  };
}
