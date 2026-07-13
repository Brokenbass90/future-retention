import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

export const STUDIO_MODEL_SIGNATURES_VERSION = 1;
export const STUDIO_MODEL_SIGNATURES_ALGORITHM = "sha256";

const SOURCE_GROUPS = Object.freeze([
  Object.freeze({
    key: "header",
    candidates: Object.freeze([
      "app/templates/blocks/header.pug",
      "app/templates/blocks/header.jade",
    ]),
  }),
  Object.freeze({
    key: "mainStyl",
    candidates: Object.freeze([
      "app/styles/blocks/main.styl",
    ]),
  }),
  Object.freeze({
    key: "footer",
    candidates: Object.freeze([
      "app/templates/helpers/footer.pug",
      "app/templates/helpers/footer.jade",
    ]),
  }),
]);

function assertMailRoot(mailRoot) {
  if (typeof mailRoot !== "string" || !mailRoot.trim()) {
    throw new TypeError("mailRoot must be a non-empty path");
  }
  return path.resolve(mailRoot);
}

function isRegularFile(filePath) {
  if (!existsSync(filePath)) return false;
  try {
    return statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function selectPreferredSource(mailRoot, candidates) {
  for (const relativePath of candidates) {
    if (isRegularFile(path.join(mailRoot, relativePath))) return relativePath;
  }
  return null;
}

function signatureForSource(mailRoot, relativePath) {
  if (!relativePath) {
    return {
      path: null,
      exists: false,
      bytes: 0,
      sha256: null,
    };
  }
  const contents = readFileSync(path.join(mailRoot, relativePath));
  return {
    path: relativePath,
    exists: true,
    bytes: contents.byteLength,
    sha256: createHash(STUDIO_MODEL_SIGNATURES_ALGORITHM).update(contents).digest("hex"),
  };
}

/**
 * Build a deterministic fingerprint of the source files overwritten or relied
 * on by constructor composition. Pug is intentionally preferred over Jade,
 * matching the active build pipeline when both variants exist.
 *
 * This API is synchronous because composeEmailFromBlocks is synchronous.
 */
export function buildStudioModelSourceSignatures(mailRoot) {
  const root = assertMailRoot(mailRoot);
  const sources = {};
  for (const group of SOURCE_GROUPS) {
    const selected = selectPreferredSource(root, group.candidates);
    sources[group.key] = signatureForSource(root, selected);
  }
  return {
    version: STUDIO_MODEL_SIGNATURES_VERSION,
    algorithm: STUDIO_MODEL_SIGNATURES_ALGORITHM,
    sources,
  };
}

function isSignatureRecord(value) {
  return Boolean(
    value
      && typeof value === "object"
      && typeof value.exists === "boolean"
      && (value.path === null || typeof value.path === "string")
      && (value.sha256 === null || typeof value.sha256 === "string"),
  );
}

function validateExpectedSignatures(expected) {
  if (!expected || typeof expected !== "object") return "missing-signatures";
  if (expected.version !== STUDIO_MODEL_SIGNATURES_VERSION) return "unsupported-version";
  if (expected.algorithm !== STUDIO_MODEL_SIGNATURES_ALGORITHM) return "unsupported-algorithm";
  if (!expected.sources || typeof expected.sources !== "object") return "invalid-signatures";
  for (const group of SOURCE_GROUPS) {
    if (!isSignatureRecord(expected.sources[group.key])) return `invalid-${group.key}`;
  }
  return null;
}

function mismatchReason(expected, current) {
  if (expected.exists !== current.exists) return expected.exists ? "source-removed" : "source-added";
  if (expected.path !== current.path) return "preferred-source-changed";
  if (expected.sha256 !== current.sha256) return "content-changed";
  return null;
}

/**
 * Compare persisted signatures with the currently active source files.
 * Invalid/legacy signature payloads are deliberately not treated as a match:
 * callers can decide whether to fall back read-only or migrate the model.
 */
export function compareStudioModelSourceSignatures(mailRoot, expected) {
  const validationError = validateExpectedSignatures(expected);
  const current = buildStudioModelSourceSignatures(mailRoot);
  if (validationError) {
    return {
      matches: false,
      verifiable: false,
      reason: validationError,
      mismatches: [],
      current,
    };
  }

  const mismatches = [];
  for (const group of SOURCE_GROUPS) {
    const expectedSource = expected.sources[group.key];
    const currentSource = current.sources[group.key];
    const reason = mismatchReason(expectedSource, currentSource);
    if (reason) {
      mismatches.push({
        key: group.key,
        reason,
        expected: expectedSource,
        current: currentSource,
      });
    }
  }
  return {
    matches: mismatches.length === 0,
    verifiable: true,
    reason: mismatches.length ? "source-signatures-mismatch" : null,
    mismatches,
    current,
  };
}
