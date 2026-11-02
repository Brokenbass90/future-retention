import pug from "pug";
import stylus from "stylus";
import lexPug from "pug-lexer";
import parsePug from "pug-parser";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { normalizeBlockLibrarySavePayload } from "./block-library-schema.js";
import { scopeBlockStyles, classifyBlockClasses } from "./scope-block-styles.js";
import { withKeyedOperationLock } from "./keyed-operation-lock.js";
import { validateHtml } from "./html-validate.js";
import { applyLocaleDirectionToHtml } from "./rtl.js";

export const BLOCK_REVIEW_STATUSES = Object.freeze(["draft", "candidate", "approved"]);
export const BLOCK_REVIEW_VALIDATOR_VERSION = 3;
export const BLOCK_REVIEW_REQUIRED_CHECKS = Object.freeze([
  "schema",
  "tokenContract",
  "security",
  "pugCompile",
  "stylusCompile",
  "emailSafe",
  "desktop",
  "mobile",
  "rtl",
  "dependencies",
]);
const EXECUTABLE_HTML_TAGS = new Set(["script", "iframe", "object", "embed", "base"]);
const EMAIL_UNSAFE_TAG_RE = /<(?:form|input|button|video|audio|canvas|svg|math|frameset|frame)\b/i;
const EMAIL_UNSAFE_CSS_RE = /\b(?:display\s*:\s*(?:flex|inline-flex|grid|inline-grid)|position\s*:\s*(?:fixed|sticky)|behavior\s*:|-moz-binding\s*:|expression\s*\()/i;
const LOCAL_ASSET_RE = /(?:^|[("'=\s])(?:\/studio-assets(?:\/|$)|https?:\/\/(?:localhost|127(?:\.\d{1,3}){3}|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}|\[?::1\]?)(?::\d+)?(?:\/|$))/i;

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

function checkResult(errors = [], warnings = []) {
  return { passed: errors.length === 0, errors, warnings };
}

function numericAttributeValues(html, attribute) {
  const out = [];
  const pattern = new RegExp(`\\b${attribute}\\s*=\\s*(["']?)(\\d+(?:\\.\\d+)?)\\s*(?:px)?\\1`, "gi");
  let match;
  while ((match = pattern.exec(String(html || "")))) out.push(Number(match[2]));
  return out;
}

function cssPixelValues(source, property) {
  const out = [];
  const pattern = new RegExp(`(?:^|[;{\\s])${property}\\s*:\\s*(\\d+(?:\\.\\d+)?)px\\b`, "gi");
  let match;
  while ((match = pattern.exec(String(source || "")))) out.push(Number(match[1]));
  return out;
}

function imageSources(html) {
  return [...String(html || "").matchAll(/<img\b[^>]*\bsrc\s*=\s*(["'])(.*?)\1/gi)]
    .map((match) => match[2]);
}

function styleBodies(html) {
  return [...String(html || "").matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)]
    .map((match) => match[1]);
}

function inspectEmailSafeOutput(block, { html, css }) {
  const errors = [];
  const warnings = [];
  const structural = validateHtml(html);
  if (!structural.ok) {
    errors.push(...structural.issues.slice(0, 5).map((issue) => `HTML: ${issue.message}`));
  }
  if (EMAIL_UNSAFE_TAG_RE.test(html)) {
    errors.push("HTML contains a form, interactive or vector element that is not portable across email clients");
  }
  if (EMAIL_UNSAFE_CSS_RE.test(`${css}\n${html}`)) {
    errors.push("CSS uses flex/grid, fixed/sticky positioning or another non-portable email feature");
  }
  if (/\b(?:href|src)\s*=\s*(["'])\s*data:/i.test(html)) {
    errors.push("embedded data: assets are not portable email asset URLs");
  }
  if (LOCAL_ASSET_RE.test(`${html}\n${css}`)
      || /https?:\/\/[^\s"'<>)]*\/studio-assets(?:\/|$)/i.test(`${html}\n${css}`)) {
    errors.push("local/private Studio assets cannot be released in an email block");
  }
  if (/<table\b/i.test(html)
      && /<table\b(?![^>]*\brole\s*=\s*(["'])presentation\1)[^>]*>/i.test(html)) {
    warnings.push("presentation tables should declare role=\"presentation\"");
  }
  if (/<img\b(?![^>]*\balt\s*=)[^>]*>/i.test(html)) {
    warnings.push("images should include alt text (empty alt is valid for decoration)");
  }
  if (block?.placement === "outer" && !/<table\b/i.test(html)) {
    errors.push("outer blocks must use a table-based email shell");
  }
  return checkResult(errors, warnings);
}

function inspectDesktopProfile({ html, css }) {
  const errors = [];
  const warnings = [];
  if (!String(html || "").trim()) errors.push("desktop render is empty");
  const tooWideAttributes = numericAttributeValues(html, "width").filter((value) => value > 600);
  const tooWideCss = cssPixelValues(`${css}\n${html}`, "width").filter((value) => value > 600);
  const tooWideMin = cssPixelValues(`${css}\n${html}`, "min-width").filter((value) => value > 600);
  if (tooWideAttributes.length || tooWideCss.length || tooWideMin.length) {
    errors.push("desktop layout contains a fixed width above the 600px email canvas");
  }
  if (/\boverflow-x\s*:\s*(?:scroll|auto)\b/i.test(`${css}\n${html}`)) {
    warnings.push("horizontal scrolling is unreliable in desktop email clients");
  }
  return checkResult(errors, warnings);
}

function inspectMobileProfile({ html, css }) {
  const errors = [];
  const warnings = [];
  const combined = `${css}\n${html}`;
  const mobileMinWidths = cssPixelValues(combined, "min-width").filter((value) => value > 375);
  if (mobileMinWidths.length) {
    errors.push("mobile layout has min-width above the 375px validation viewport");
  }
  if (/\bwhite-space\s*:\s*nowrap\b/i.test(combined) && /<(?:p|h[1-6]|td)\b/i.test(html)) {
    errors.push("nowrap text can force horizontal overflow on mobile");
  }
  for (const image of String(html || "").matchAll(/<img\b([^>]*)>/gi)) {
    const attrs = image[1] || "";
    const width = /\bwidth\s*=\s*(["']?)(\d+(?:\.\d+)?)\1/i.exec(attrs);
    if (!width || Number(width[2]) <= 375) continue;
    const responsive = /\b(?:max-)?width\s*:\s*100%/i.test(attrs)
      || /\b(?:max-)?width\s*:\s*100%/i.test(css);
    if (!responsive) {
      errors.push("an image wider than 375px has no width/max-width:100% mobile fallback");
      break;
    }
  }
  const hasMultiCellRow = /<tr\b[^>]*>(?:(?!<\/tr>)[\s\S])*?<td\b(?:(?!<\/tr>)[\s\S])*?<td\b(?:(?!<\/tr>)[\s\S])*?<\/tr>/i.test(html);
  if (hasMultiCellRow && !/@media[^{]*max-width\s*:\s*(?:[1-5]\d{2}|600)px/i.test(css)) {
    warnings.push("multi-column row has no explicit max-width mobile media rule; verify its stacked/compact layout visually");
  }
  return checkResult(errors, warnings);
}

function inspectRtlProfile({ html, css }) {
  const errors = [];
  const warnings = [];
  const source = `<!doctype html><html lang="en"><head><style>${css}</style></head><body>${html}</body></html>`;
  if (/\bdir\s*=\s*(["']?)ltr\1/i.test(html) || /\bdirection\s*:\s*ltr\b/i.test(`${css}\n${html}`)) {
    errors.push("hard-coded LTR direction prevents the shared RTL transformer from owning direction");
    return checkResult(errors, warnings);
  }
  try {
    const beforeImages = imageSources(source);
    const beforeStyles = styleBodies(source);
    const rtl = applyLocaleDirectionToHtml(source, "ar", undefined, { mode: "text" });
    const twice = applyLocaleDirectionToHtml(rtl, "ar", undefined, { mode: "text" });
    if (!/<!--\s*retkit-rtl:v2:text\s*-->/i.test(rtl)) {
      errors.push("RTL transform did not mark the rendered document");
    }
    if (twice !== rtl) errors.push("RTL transform is not idempotent for this block");
    if (JSON.stringify(imageSources(rtl)) !== JSON.stringify(beforeImages)) {
      errors.push("RTL transform changes image sources or their order");
    }
    if (JSON.stringify(styleBodies(rtl)) !== JSON.stringify(beforeStyles)) {
      errors.push("RTL text mode changes authored head CSS");
    }
  } catch (error) {
    errors.push(`RTL: ${String(error?.message || error).split("\n")[0]}`);
  }
  return checkResult(errors, warnings);
}

function childDependencyIds(children, out = []) {
  for (const child of Array.isArray(children) ? children : []) {
    const id = String(child?.id || "").trim();
    if (id) out.push(id);
    childDependencyIds(child?.children, out);
  }
  return out;
}

function inspectReleaseDependencies(block, resolveDependency) {
  const errors = [];
  const warnings = [];
  const ids = [...new Set(childDependencyIds(block?.children))];
  if (!ids.length) return checkResult(errors, warnings);
  if (typeof resolveDependency !== "function") {
    errors.push("combo dependencies were not resolved by the release validator");
    return checkResult(errors, warnings);
  }
  for (const id of ids) {
    let record;
    try { record = resolveDependency(id); }
    catch (error) {
      errors.push(`dependency "${id}" cannot be loaded: ${String(error?.message || error)}`);
      continue;
    }
    const origin = String(record?.origin || record?.source || record?.block?.source || "");
    const dependency = record?.block && typeof record.block === "object" ? record.block : record;
    if (origin === "canonical") continue;
    if (origin === "imported") {
      errors.push(`dependency "${id}" is quarantined legacy/imported content`);
      continue;
    }
    if (origin !== "user" || blockReviewStatus(dependency) !== "approved") {
      errors.push(`dependency "${id}" is not an approved user/canonical block`);
    }
  }
  return checkResult(errors, warnings);
}

function releaseValidationShape({
  checkedAt,
  sourceHash,
  checks,
  errors,
  warnings,
}) {
  return {
    passed: BLOCK_REVIEW_REQUIRED_CHECKS.every((key) => checks[key] === true),
    validatorVersion: BLOCK_REVIEW_VALIDATOR_VERSION,
    sourceHash,
    checkedAt,
    checks,
    errors,
    warnings,
  };
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
export async function validateUserBlockDeterministically(block, {
  checkedAt = new Date().toISOString(),
  resolveDependency,
} = {}) {
  const errors = [];
  const warnings = [];
  let normalized = block;
  let schemaPassed = false;
  try {
    normalized = normalizeBlockLibrarySavePayload(block, {
      createdAt: block?.createdAt || checkedAt,
    });
    schemaPassed = true;
  } catch (error) {
    errors.push(`Schema: ${String(error?.message || error)}`);
  }

  const pugSource = String(normalized?.pug || "");
  const stylSource = String(normalized?.styl || "");
  const declared = new Set((normalized?.slots || []).map((slot) => String(slot.id || "")));
  const used = new Set();
  const tokenRe = /\{\{\s*([a-z][a-z0-9_]*)\s*\}\}/gi;
  let match;
  while ((match = tokenRe.exec(`${pugSource}\n${stylSource}`))) used.add(match[1]);

  const tokenErrors = [];
  for (const token of used) {
    if (!declared.has(token)) tokenErrors.push(`token "${token}" has no slot definition`);
  }
  for (const slotId of declared) {
    if (slotId && !used.has(slotId)) warnings.push(`slot "${slotId}" is declared but not used in Pug/Stylus`);
  }
  errors.push(...tokenErrors);

  // Класс в разметке, за которым нет CSS ни у блока, ни во фреймворке, ни в
  // семье — почти всегда опечатка (в базе так жил `.centet` вместо `.center`
  // в полусотне блоков). Молча пропускать нельзя: вёрстка выглядит рабочей,
  // а стиля нет.
  try {
    const buckets = classifyBlockClasses(normalized);
    if (buckets.missing.length) {
      warnings.push(
        `классы без CSS: ${buckets.missing.slice(0, 8).join(", ")}`
        + `${buckets.missing.length > 8 ? ` и ещё ${buckets.missing.length - 8}` : ""}`
        + " — опиши их в styl блока или убери из разметки",
      );
    }
  } catch { /* реестра может не быть — это не повод валить сохранение */ }

  const portable = inspectPortableBlockSource(normalized);
  errors.push(...portable.errors);
  const defaultErrors = inspectPortableSlotDefaults(normalized);
  errors.push(...defaultErrors);
  if (/\$\{\{\s*[a-z0-9_.-]+\s*\}\}\$/i.test(`${pugSource}\n${stylSource}`)
      && String(normalized?.category || "").toLowerCase() !== "footer") {
    warnings.push("campaign placeholders make this reusable block depend on one namespace");
  }

  const values = tokenDefaults(normalized);
  const resolvedPug = substituteValidationTokens(pugSource, values);
  const resolvedStyl = substituteValidationTokens(stylSource, values);
  let pugPassed = false;
  let stylusPassed = false;
  let renderedHtml = "";
  let renderedCss = "";

  if (!errors.length) {
    try {
      renderedHtml = pug.render(resolvedPug, {
        filename: `${normalized?.id || "user-block"}.pug`,
        compileDebug: false,
      });
      pugPassed = true;
    } catch (error) {
      errors.push(`Pug: ${String(error?.message || error).split("\n")[0]}`);
    }
  }

  if (!errors.length) {
    try {
      renderedCss = await compileStylus(resolvedStyl);
      stylusPassed = true;
    } catch (error) {
      errors.push(`Stylus: ${String(error?.message || error).split("\n")[0]}`);
    }
  }

  const emailSafe = pugPassed && stylusPassed
    ? inspectEmailSafeOutput(normalized, { html: renderedHtml, css: renderedCss })
    : checkResult(["email-safe render was not available"]);
  const desktop = pugPassed && stylusPassed
    ? inspectDesktopProfile({ html: renderedHtml, css: renderedCss })
    : checkResult(["desktop render was not available"]);
  const mobile = pugPassed && stylusPassed
    ? inspectMobileProfile({ html: renderedHtml, css: renderedCss })
    : checkResult(["mobile render was not available"]);
  const rtl = pugPassed && stylusPassed
    ? inspectRtlProfile({ html: renderedHtml, css: renderedCss })
    : checkResult(["RTL render was not available"]);
  const dependencies = schemaPassed
    ? inspectReleaseDependencies(normalized, resolveDependency)
    : checkResult(["dependencies cannot be checked before schema validation"]);
  for (const result of [emailSafe, desktop, mobile, rtl, dependencies]) {
    errors.push(...result.errors);
    warnings.push(...result.warnings);
  }

  const securityPassed = portable.passed && defaultErrors.length === 0;
  const checks = {
    schema: schemaPassed,
    tokenContract: tokenErrors.length === 0,
    security: securityPassed,
    // Backward-compatible diagnostic name retained for existing clients.
    portablePug: securityPassed,
    pugCompile: pugPassed,
    stylusCompile: stylusPassed,
    emailSafe: emailSafe.passed,
    desktop: desktop.passed,
    mobile: mobile.passed,
    rtl: rtl.passed,
    dependencies: dependencies.passed,
  };
  return releaseValidationShape({
    checkedAt,
    sourceHash: userBlockSourceHash(normalized),
    checks,
    errors,
    warnings,
  });
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

export function userBlockReviewIsCurrent(block) {
  const review = block?.review;
  const deterministic = review?.deterministic;
  if (!review || !deterministic || review.sourceHash !== userBlockSourceHash(block)) return false;
  if (deterministic.sourceHash !== review.sourceHash) return false;
  if (deterministic.validatorVersion !== BLOCK_REVIEW_VALIDATOR_VERSION || deterministic.passed !== true) return false;
  return BLOCK_REVIEW_REQUIRED_CHECKS.every((key) => deterministic.checks?.[key] === true);
}

export function blockReviewStatus(block) {
  if (block?.source === "canonical") return "approved";
  const status = block?.review?.status;
  if (!BLOCK_REVIEW_STATUSES.includes(status) || status === "draft") return "draft";
  return userBlockReviewIsCurrent(block) ? status : "draft";
}

export function isBlockReleaseApproved(block, origin = block?.source) {
  if (origin === "canonical") return true;
  return origin === "user" && blockReviewStatus({ ...block, source: "user" }) === "approved";
}

export function assertBlockReleaseApproved(block, origin = block?.source) {
  if (isBlockReleaseApproved(block, origin)) return true;
  const error = new UserBlockLifecycleError(
    origin === "imported"
      ? `imported block "${block?.id || "unknown"}" is quarantined and cannot be released`
      : `${origin || "ad-hoc"} block "${block?.id || "unknown"}" is not release-approved`,
    {
      statusCode: 422,
      code: origin === "imported" ? "IMPORTED_BLOCK_QUARANTINED" : "BLOCK_NOT_APPROVED",
      validation: block?.review?.deterministic || null,
    },
  );
  throw error;
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

function dependencyResolverForUserTarget(target) {
  const userDir = path.dirname(path.resolve(target));
  const libraryRoot = path.basename(userDir) === "user" ? path.dirname(userDir) : userDir;
  return (id) => {
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(String(id || ""))) {
      throw new Error("invalid dependency id");
    }
    for (const origin of ["canonical", "user", "imported"]) {
      const base = path.join(libraryRoot, origin);
      const candidate = path.resolve(base, `${id}.json`);
      if (!candidate.startsWith(`${path.resolve(base)}${path.sep}`) || !existsSync(candidate)) continue;
      const dependency = JSON.parse(readFileSync(candidate, "utf8"));
      return { block: { ...dependency, source: origin }, origin };
    }
    throw new Error("not found");
  };
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
    let normalized = normalizeBlockLibrarySavePayload(payload, {
      createdAt: createdAt || previous?.createdAt || new Date().toISOString(),
    });

    // Скоупим классы созданного руками блока так же, как canonical-библиотеку:
    // иначе новый блок с классом `.title` перебьёт чужой `.title` в том же
    // письме. Операция идемпотентна — повторное сохранение не даёт `--x--x`.
    // Если реестра стилей нет, сохраняем как есть: лучше блок без скоупа,
    // чем отказ сохранить работу человека.
    try {
      const scoped = scopeBlockStyles({ ...normalized, source: "user" });
      if (scoped?.block) {
        const { source: _ignored, ...clean } = scoped.block;
        normalized = normalizeBlockLibrarySavePayload(clean, {
          createdAt: normalized.createdAt,
        });
      }
    } catch { /* без скоупа, но сохраняем */ }

    const validation = await validateUserBlockDeterministically(normalized, {
      ...(checkedAt ? { checkedAt } : {}),
      resolveDependency: dependencyResolverForUserTarget(target),
    });
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
    const validation = await validateUserBlockDeterministically(normalized, {
      ...(checkedAt ? { checkedAt } : {}),
      resolveDependency: dependencyResolverForUserTarget(target),
    });
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
