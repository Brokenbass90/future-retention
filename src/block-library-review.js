import pug from "pug";
import stylus from "stylus";
import lexPug from "pug-lexer";
import parsePug from "pug-parser";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { normalizeBlockLibrarySavePayload } from "./block-library-schema.js";
import { withKeyedOperationLock } from "./keyed-operation-lock.js";

export const BLOCK_REVIEW_STATUSES = Object.freeze(["draft", "candidate", "approved"]);
export const BLOCK_REVIEW_VALIDATOR_VERSION = 2;
const EXECUTABLE_HTML_TAGS = new Set(["script", "iframe", "object", "embed", "base"]);

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

function tokenDefaults(block) {
  const values = Object.create(null);
  for (const slot of Array.isArray(block?.slots) ? block.slots : []) {
    const kind = String(slot?.kind || "text").toLowerCase();
    values[slot.id] = kind === "number"
      ? "1"
      : kind === "color"
        ? "#000000"
        : ["url", "localizedurl"].includes(kind)
          ? "#"
          : kind === "image"
            ? "https://example.invalid/preview.png"
            : kind === "select" && Array.isArray(slot.options) && slot.options.length
              ? String(slot.options[0])
              : "preview";
  }
  return values;
}

function substituteValidationTokens(source, values) {
  return String(source || "").replace(/\{\{\s*([a-z][a-z0-9_]*)\s*\}\}/gi, (all, id) => (
    hasOwn(values, id) ? String(values[id] ?? "") : all
  ));
}

function stableJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
}

/**
 * Content identity for deterministic validation and optional AI advice.
 * Metadata such as timestamps/review state is deliberately excluded: editing
 * any source/contract field invalidates an old advisory, while re-approving an
 * unchanged candidate does not.
 */
export function userBlockSourceHash(block) {
  const source = {
    id: String(block?.id || ""),
    placement: String(block?.placement || ""),
    category: String(block?.category || ""),
    pug: String(block?.pug || ""),
    styl: String(block?.styl || ""),
    slots: Array.isArray(block?.slots) ? block.slots : [],
    childSlots: Array.isArray(block?.childSlots) ? block.childSlots : [],
    appearance: block?.appearance && typeof block.appearance === "object" ? block.appearance : {},
    combo: block?.combo === true,
    children: Array.isArray(block?.children) ? block.children : [],
  };
  return createHash("sha256").update(stableJson(source)).digest("hex");
}

function sourceLine(source, index) {
  return String(source || "").slice(0, index).split("\n").length;
}

function addSourceError(errors, kind, source, match, message) {
  const index = typeof match?.index === "number" ? match.index : 0;
  errors.push(`${kind} line ${sourceLine(source, index)}: ${message}`);
}

/**
 * Static portability/security gate shared by save, review and compose preview.
 *
 * Pug and Stylus are programming languages. Syntax compilation alone is not a
 * safe validator because Pug includes can read files and Stylus imports can do
 * the same. User/ad-hoc/imported fragments are therefore restricted to
 * declarative email markup/CSS. Trusted canonical definitions are allowed to
 * use the studio scaffold and vendor mixins outside this gate.
 */
export function inspectPortableBlockSource(block) {
  const errors = [];
  const pugSource = String(block?.pug || "");
  const stylSource = String(block?.styl || "");

  const pugRules = [
    [/^\s*(?:include|extends|mixin|block|append|prepend)\b/gim, "includes, inheritance and mixin definitions are not allowed"],
    [/^\s*\+[a-z][\w-]*(?:\s*\(|\b)/gim, "mixin calls are not allowed"],
    [/^\s*(?:-|!?=)(?:\s|$)/gm, "executable Pug code lines are not allowed"],
    [/^\s*(?:if|unless|else|each|for|while|case|when|default)\b/gim, "Pug control-flow is not allowed"],
    [/[#!]\{/g, "Pug interpolation (#{...}/!{...}) is not allowed"],
    [/&attributes\s*\(/gi, "dynamic Pug attribute spreading is not allowed"],
    [/^\s*:[a-z][\w-]*\b/gim, "Pug filters are not allowed"],
    [/(?:^|\s)[a-z][\w:-]*\s*=\s*(?!["'])/gim, "dynamic/unquoted Pug attribute expressions are not allowed"],
    [/^\s*(?:[a-z][\w-]*)?(?:[.#][\w-]+)+(?:\([^\n]*\))?\s*!?=\s*/gim, "dynamic Pug tag expressions are not allowed"],
    [/(?:^|\n)\s*script(?:[.#(\s]|$)|<\s*script\b/gi, "script elements are not allowed"],
    [/\bon[a-z]+\s*=/gi, "event-handler attributes are not allowed"],
    [/\b(?:javascript|vbscript)\s*:/gi, "executable URL schemes are not allowed"],
    [/\bexpression\s*\(/gi, "CSS/HTML expressions are not allowed"],
  ];
  for (const [pattern, message] of pugRules) {
    pattern.lastIndex = 0;
    const match = pattern.exec(pugSource);
    if (match) addSourceError(errors, "Pug", pugSource, match, message);
  }

  // Parse a source-shaped sample after replacing only declared {{ slot }}
  // tokens. This catches executable AST nodes and attribute expressions even
  // when whitespace/formatting evades a lexical rule. No includes can run:
  // they were rejected above and pug-parser itself performs no file loading.
  const astSource = substituteValidationTokens(pugSource, tokenDefaults(block));
  try {
    const ast = parsePug(lexPug(astSource, { filename: `${block?.id || "portable-block"}.pug` }), {
      filename: `${block?.id || "portable-block"}.pug`,
      src: astSource,
    });
    const allowedTypes = new Set(["Block", "Tag", "Text", "Comment", "BlockComment", "Doctype"]);
    const seenAstErrors = new Set();
    const report = (node, message) => {
      const rendered = `Pug line ${Number(node?.line) || 1}: ${message}`;
      if (!seenAstErrors.has(rendered)) {
        seenAstErrors.add(rendered);
        errors.push(rendered);
      }
    };
    const staticLiteral = /^(?:true|false|null|undefined|-?(?:\d+(?:\.\d+)?|\.\d+)|'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")$/s;
    const visit = (node) => {
      if (!node || typeof node !== "object") return;
      if (node.type && !allowedTypes.has(node.type)) {
        report(node, `AST node ${node.type} is executable/non-declarative and is not allowed`);
      }
      if (node.type === "Tag") {
        if (!/^[a-z][a-z0-9:-]*$/i.test(String(node.name || ""))
            || EXECUTABLE_HTML_TAGS.has(String(node.name || "").toLowerCase())) {
          report(node, `tag "${String(node.name || "")}" is not allowed`);
        }
        if (Array.isArray(node.attributeBlocks) && node.attributeBlocks.length) {
          report(node, "dynamic attribute blocks are not allowed");
        }
        for (const attr of Array.isArray(node.attrs) ? node.attrs : []) {
          if (!staticLiteral.test(String(attr.val || ""))) {
            report(attr, `attribute "${String(attr.name || "")}" must be a static literal`);
          }
          if (/^on[a-z]+$/i.test(String(attr.name || ""))) {
            report(attr, `event-handler attribute "${String(attr.name || "")}" is not allowed`);
          }
        }
      }
      for (const [key, value] of Object.entries(node)) {
        if (["attrs", "attributeBlocks", "filename"].includes(key)) continue;
        if (Array.isArray(value)) value.forEach(visit);
        else if (value && typeof value === "object") visit(value);
      }
    };
    visit(ast);
  } catch (error) {
    errors.push(`Pug parse: ${String(error?.message || error).split("\n")[0]}`);
  }

  const stylRules = [
    [/^\s*@?(?:import|require|use)\b/gim, "import/require/use is not allowed"],
    [/^\s*@js\b/gim, "Stylus @js execution is not allowed"],
    [/\b(?:require|use|json|embedurl|image-size)\s*\(/gi, "file-reading/plugin functions are not allowed"],
    [/\b(?:javascript|vbscript)\s*:/gi, "executable URL schemes are not allowed"],
    [/\bexpression\s*\(/gi, "CSS expressions are not allowed"],
  ];
  for (const [pattern, message] of stylRules) {
    pattern.lastIndex = 0;
    const match = pattern.exec(stylSource);
    if (match) addSourceError(errors, "Stylus", stylSource, match, message);
  }

  return { passed: errors.length === 0, errors };
}

function inspectPortableSlotDefaults(block) {
  const errors = [];
  const pugSource = String(block?.pug || "");
  const stylSource = String(block?.styl || "");
  for (const slot of Array.isArray(block?.slots) ? block.slots : []) {
    if (!hasOwn(slot, "default") || slot.default == null) continue;
    if (!["string", "number", "boolean"].includes(typeof slot.default)) {
      errors.push(`slot "${slot.id}" default must be a scalar value`);
      continue;
    }
    const value = String(slot.default);
    const label = `slot "${slot.id}" default`;
    if (/\r|\n|\u0000|\u2028|\u2029/.test(value)) errors.push(`${label} cannot contain line breaks`);
    if (/[#!]\{/.test(value)) errors.push(`${label} cannot contain Pug interpolation`);
    if (/^\s*(?:!?=|-\s|\+[a-z]|&attributes\b|:\s*[a-z]|(?:if|unless|else|each|for|while|case|when|include|extends|mixin)\b)/i.test(value)) {
      errors.push(`${label} cannot begin with Pug syntax`);
    }
    if (/\{\{\s*[A-Z][A-Z0-9_]*\s*\}\}/.test(value)) errors.push(`${label} cannot create a child-slot marker`);
    if (/\b(?:process|global|globalThis|require|module|exports|Function|eval)\s*(?:\.|\[|\()/i.test(value)) {
      errors.push(`${label} cannot contain JavaScript expressions`);
    }
    if (/<\s*script\b|\bon[a-z]+\s*=|\b(?:javascript|vbscript)\s*:/i.test(value)) {
      errors.push(`${label} contains executable HTML/URL content`);
    }
    const escapedId = String(slot.id || "").replace(/[^a-z0-9_]/gi, "");
    const token = new RegExp(`\\{\\{\\s*${escapedId}\\s*\\}\\}`, "i");
    const inStyl = token.test(stylSource);
    const inPugStyle = pugSource.split("\n").some((line) => (
      (line.match(/\bstyle\s*=\s*(["'])(.*?)\1/gi) || []).some((attr) => token.test(attr))
    ));
    if ((inStyl || inPugStyle) && /[;{}\r\n]/.test(value)) {
      errors.push(`${label} cannot terminate or add a CSS declaration`);
    }
    if (inStyl && /["']/.test(value)) errors.push(`${label} cannot contain quotes when used in Stylus`);
    if ((inStyl || inPugStyle)
        && (/^\s*@?(?:import|require|use)\b/i.test(value)
          || /\b(?:require|use|json|embedurl|image-size)\s*\(/i.test(value))) {
      errors.push(`${label} cannot inject Stylus imports or file-reading functions`);
    }
  }
  return errors;
}

export function assertPortableBlockSource(block, { label = "user/ad-hoc block" } = {}) {
  const result = inspectPortableBlockSource(block);
  if (!result.passed) {
    const error = new Error(`${label} rejected by portable source gate: ${result.errors.join("; ")}`);
    error.code = "UNSAFE_BLOCK_SOURCE";
    error.statusCode = 422;
    error.validationErrors = result.errors;
    throw error;
  }
  return result;
}

function compileStylus(source) {
  return new Promise((resolve, reject) => {
    stylus(String(source || "")).render((error, css) => {
      if (error) reject(error);
      else resolve(css);
    });
  });
}

/**
 * Deterministic, offline gate for hand-authored blocks.
 *
 * It deliberately does not claim that a block is visually perfect in every
 * email client. It proves the portable things we can know without AI:
 * schema/token consistency, no executable/imported Pug, valid Pug syntax and
 * valid Stylus after slot-default substitution. AI review may add advice, but
 * it never replaces this gate.
 */
export async function validateUserBlockDeterministically(block, { checkedAt = new Date().toISOString() } = {}) {
  const errors = [];
  const warnings = [];
  const pugSource = String(block?.pug || "");
  const stylSource = String(block?.styl || "");
  const declared = new Set((block?.slots || []).map((slot) => String(slot.id || "")));
  const used = new Set();
  const tokenRe = /\{\{\s*([a-z][a-z0-9_]*)\s*\}\}/gi;
  let match;
  while ((match = tokenRe.exec(`${pugSource}\n${stylSource}`))) used.add(match[1]);

  for (const token of used) {
    if (!declared.has(token)) errors.push(`token "${token}" has no slot definition`);
  }
  for (const slotId of declared) {
    if (slotId && !used.has(slotId)) warnings.push(`slot "${slotId}" is declared but not used in Pug/Stylus`);
  }

  const portable = inspectPortableBlockSource(block);
  errors.push(...portable.errors);
  errors.push(...inspectPortableSlotDefaults(block));
  if (/\$\{\{\s*[a-z0-9_.-]+\s*\}\}\$/i.test(`${pugSource}\n${stylSource}`)
      && String(block?.category || "").toLowerCase() !== "footer") {
    warnings.push("campaign placeholders make this reusable block depend on one namespace");
  }

  const values = tokenDefaults(block);
  const resolvedPug = substituteValidationTokens(pugSource, values);
  const resolvedStyl = substituteValidationTokens(stylSource, values);
  let pugPassed = false;
  let stylusPassed = false;

  if (!errors.length) {
    try {
      pug.compile(resolvedPug, { filename: `${block?.id || "user-block"}.pug`, compileDebug: false });
      pugPassed = true;
    } catch (error) {
      errors.push(`Pug: ${String(error?.message || error).split("\n")[0]}`);
    }
  }

  if (!errors.length) {
    try {
      await compileStylus(resolvedStyl);
      stylusPassed = true;
    } catch (error) {
      errors.push(`Stylus: ${String(error?.message || error).split("\n")[0]}`);
    }
  }

  return {
    passed: errors.length === 0 && pugPassed && stylusPassed,
    validatorVersion: BLOCK_REVIEW_VALIDATOR_VERSION,
    sourceHash: userBlockSourceHash(block),
    checkedAt,
    checks: {
      tokenContract: !errors.some((item) => item.startsWith("token ")),
      portablePug: portable.passed,
      pugCompile: pugPassed,
      stylusCompile: stylusPassed,
    },
    errors,
    warnings,
  };
}

export function buildUserBlockReview({ validation, requestedStatus = "candidate", previousReview = null } = {}) {
  const requested = BLOCK_REVIEW_STATUSES.includes(requestedStatus) ? requestedStatus : "candidate";
  const status = validation?.passed
    ? (requested === "approved" ? "approved" : requested === "draft" ? "draft" : "candidate")
    : "draft";
  const sourceHash = String(validation?.sourceHash || "");
  const sameSource = Boolean(sourceHash && previousReview?.sourceHash === sourceHash);
  const previousAi = sameSource && previousReview?.ai && typeof previousReview.ai === "object"
    ? previousReview.ai
    : null;
  return {
    status,
    sourceHash,
    deterministic: validation || {
      passed: false,
      validatorVersion: BLOCK_REVIEW_VALIDATOR_VERSION,
      errors: ["validation was not run"],
      warnings: [],
    },
    ai: previousAi || {
      status: "not-requested",
      note: sameSource
        ? "Optional advisory review; deterministic validation remains the release gate."
        : "Source changed; stale optional AI advisory was cleared. Deterministic validation remains the release gate.",
    },
  };
}

export function blockReviewStatus(block) {
  if (block?.source === "canonical") return "approved";
  const status = block?.review?.status;
  return BLOCK_REVIEW_STATUSES.includes(status) ? status : "draft";
}

export class UserBlockLifecycleError extends Error {
  constructor(message, { statusCode = 400, code = "USER_BLOCK_LIFECYCLE", validation = null } = {}) {
    super(message);
    this.name = "UserBlockLifecycleError";
    this.statusCode = statusCode;
    this.code = code;
    if (validation) this.validation = validation;
  }
}

async function writeJsonAtomically(target, value) {
  const dir = path.dirname(target);
  const temporary = path.join(dir, `.${path.basename(target)}.${process.pid}.${randomUUID()}.tmp`);
  await mkdir(dir, { recursive: true });
  try {
    await writeFile(temporary, JSON.stringify(value, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true }).catch(() => {});
  }
}

/** One deterministic, locked and atomic save path for HTTP and AI callers. */
export async function saveUserBlockWithLifecycle({
  payload,
  target,
  force = false,
  checkedAt,
  createdAt,
} = {}) {
  if (!target) throw new TypeError("target is required");
  return withKeyedOperationLock(`user-block:${path.resolve(target)}`, async () => {
    if (existsSync(target) && !force) {
      throw new UserBlockLifecycleError("user block already exists", {
        statusCode: 409,
        code: "USER_BLOCK_EXISTS",
      });
    }
    let previous = null;
    if (existsSync(target)) {
      try { previous = JSON.parse(readFileSync(target, "utf8")); } catch {}
    }
    const normalized = normalizeBlockLibrarySavePayload(payload, {
      createdAt: createdAt || previous?.createdAt || new Date().toISOString(),
    });
    const validation = await validateUserBlockDeterministically(normalized, checkedAt ? { checkedAt } : {});
    normalized.review = buildUserBlockReview({
      validation,
      requestedStatus: "candidate",
      previousReview: previous?.review || null,
    });
    await writeJsonAtomically(target, normalized);
    return { block: normalized, validation, review: normalized.review };
  });
}

/** Locked review transition; approval always validates the current on-disk bytes. */
export async function transitionUserBlockReviewWithLifecycle({ target, requestedStatus = "approved", checkedAt } = {}) {
  if (!target) throw new TypeError("target is required");
  if (!BLOCK_REVIEW_STATUSES.includes(requestedStatus)) {
    throw new UserBlockLifecycleError("status must be draft, candidate or approved", { statusCode: 400 });
  }
  return withKeyedOperationLock(`user-block:${path.resolve(target)}`, async () => {
    if (!existsSync(target)) {
      throw new UserBlockLifecycleError("user block not found", { statusCode: 404, code: "USER_BLOCK_NOT_FOUND" });
    }
    const previous = JSON.parse(readFileSync(target, "utf8"));
    const normalized = normalizeBlockLibrarySavePayload(previous, {
      createdAt: previous.createdAt || new Date().toISOString(),
    });
    const validation = await validateUserBlockDeterministically(normalized, checkedAt ? { checkedAt } : {});
    if (requestedStatus === "approved" && !validation.passed) {
      throw new UserBlockLifecycleError("deterministic block validation failed", {
        statusCode: 422,
        code: "USER_BLOCK_VALIDATION_FAILED",
        validation,
      });
    }
    normalized.review = buildUserBlockReview({
      validation,
      requestedStatus,
      previousReview: previous.review,
    });
    await writeJsonAtomically(target, normalized);
    return { block: normalized, validation, review: normalized.review };
  });
}
