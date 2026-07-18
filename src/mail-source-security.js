import {
  existsSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
} from "node:fs";
import path from "node:path";
import lexPug from "pug-lexer";
import parsePug from "pug-parser";

const BRAND_RE = /^[a-z0-9][a-z0-9_-]{0,127}$/i;
// Read-only access to legacy IQ mail folders with spaces remains possible;
// separators, dot-segments and control characters never are.
const MAIL_RE = /^[a-z0-9][a-z0-9_ -]{0,159}$/i;
const EDITABLE_EXTENSIONS = new Set([".pug", ".jade", ".styl", ".css"]);
const STATIC_LITERAL_RE = /^(?:true|false|null|undefined|-?(?:\d+(?:\.\d+)?|\.\d+)|'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")$/s;
const EXECUTABLE_HTML_TAGS = new Set(["script", "iframe", "object", "embed", "base"]);

export class MailSourceSecurityError extends Error {
  constructor(message, { code = "UNSAFE_MAIL_SOURCE", statusCode = 422, file = "", line = 0 } = {}) {
    super(message);
    this.name = "MailSourceSecurityError";
    this.code = code;
    this.statusCode = statusCode;
    if (file) this.file = file;
    if (line) this.line = line;
  }
}

function pathWithin(root, candidate, { allowRoot = false } = {}) {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  return (allowRoot && resolvedCandidate === resolvedRoot)
    || resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`);
}

function fail(message, context = {}) {
  throw new MailSourceSecurityError(message, context);
}

function normalizeBrand(value) {
  const brand = String(value || "");
  if (!BRAND_RE.test(brand)) fail("invalid Workbench brand path segment", { statusCode: 400, code: "INVALID_SOURCE_PATH" });
  return brand;
}

function normalizeMail(value) {
  const mail = String(value || "");
  if (!MAIL_RE.test(mail) || mail === "." || mail === "..") {
    fail("invalid Workbench mail path segment", { statusCode: 400, code: "INVALID_SOURCE_PATH" });
  }
  return mail;
}

function normalizeRelativeFile(value) {
  const file = String(value || "");
  if (!file || path.isAbsolute(file) || file.includes("\\") || /[\u0000-\u001f\u007f]/.test(file)) {
    fail("invalid Workbench source file path", { statusCode: 400, code: "INVALID_SOURCE_PATH" });
  }
  const segments = file.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === ".." || !/^[a-z0-9._ -]+$/i.test(segment))) {
    fail("Workbench source path contains an invalid segment", { statusCode: 400, code: "INVALID_SOURCE_PATH" });
  }
  const extension = path.extname(file).toLowerCase();
  if (!EDITABLE_EXTENSIONS.has(extension)) {
    fail("Workbench can access only Pug/Jade/Stylus/CSS source files", { statusCode: 400, code: "INVALID_SOURCE_PATH" });
  }
  return segments.join(path.sep);
}

export function resolveWorkbenchMailRoot({ emailBaseRoot, brand, mail } = {}) {
  const root = path.resolve(String(emailBaseRoot || ""));
  if (!existsSync(root) || !statSync(root).isDirectory()) fail("email-base root is unavailable", { statusCode: 500 });
  const safeBrand = normalizeBrand(brand);
  const safeMail = normalizeMail(mail);
  const mailRoot = path.resolve(root, safeBrand, safeMail);
  const appRoot = path.resolve(mailRoot, "app");
  if (!pathWithin(root, mailRoot) || !pathWithin(mailRoot, appRoot)) {
    fail("Workbench mail path escapes email-base", { statusCode: 400, code: "INVALID_SOURCE_PATH" });
  }
  if (!existsSync(mailRoot) || !statSync(mailRoot).isDirectory()) fail("Workbench mail not found", { statusCode: 404, code: "SOURCE_NOT_FOUND" });
  if (!existsSync(appRoot) || !statSync(appRoot).isDirectory()) fail("Workbench mail app folder not found", { statusCode: 404, code: "SOURCE_NOT_FOUND" });
  const realRoot = realpathSync(root);
  const realMailRoot = realpathSync(mailRoot);
  const realAppRoot = realpathSync(appRoot);
  if (!pathWithin(realRoot, realMailRoot) || !pathWithin(realMailRoot, realAppRoot)) {
    fail("Workbench mail/app symlink escapes email-base", { statusCode: 400, code: "INVALID_SOURCE_PATH" });
  }
  return { emailBaseRoot: root, brand: safeBrand, mail: safeMail, mailRoot, appRoot };
}

export function resolveWorkbenchSourcePath({ emailBaseRoot, brand, mail, file, requireExisting = true } = {}) {
  const resolvedMail = resolveWorkbenchMailRoot({ emailBaseRoot, brand, mail });
  const { root, safeBrand, safeMail, mailRoot, appRoot } = {
    root: resolvedMail.emailBaseRoot,
    safeBrand: resolvedMail.brand,
    safeMail: resolvedMail.mail,
    mailRoot: resolvedMail.mailRoot,
    appRoot: resolvedMail.appRoot,
  };
  const safeFile = normalizeRelativeFile(file);
  const target = path.resolve(appRoot, safeFile);
  if (!pathWithin(appRoot, target)) {
    fail("Workbench source path escapes its mail/app root", { statusCode: 400, code: "INVALID_SOURCE_PATH" });
  }
  if (requireExisting) {
    if (!existsSync(target) || !statSync(target).isFile()) fail("Workbench source file not found", { statusCode: 404, code: "SOURCE_NOT_FOUND" });
    const realAppRoot = realpathSync(appRoot);
    const realTarget = realpathSync(target);
    if (!pathWithin(realAppRoot, realTarget)) {
      fail("Workbench source symlink escapes its mail/app root", { statusCode: 400, code: "INVALID_SOURCE_PATH" });
    }
  }
  return { emailBaseRoot: root, brand: safeBrand, mail: safeMail, mailRoot, appRoot, file: safeFile.split(path.sep).join("/"), target };
}

function trustedIconMixin(relativeFile, source) {
  if (!/^templates\/helpers\/mixins\/icon\.(?:pug|jade)$/i.test(relativeFile)) return false;
  const compact = String(source || "").replace(/\s+/g, " ").trim();
  return /^mixin icon\(iconName\) svg&attributes\(attributes\) use\(xlink:href=(?:'|\")\.\.\/assets\/images\/icon\.svg#icon_#\{iconName\}(?:'|\")\)$/.test(compact);
}

function sourceContextLabel(relativeFile, line) {
  return `${relativeFile}${line ? `:${line}` : ""}`;
}

function isExtensionlessPugInclude(rawPath, sourcePath) {
  const reference = String(rawPath || "").trim().replace(/^['"]|['"]$/g, "");
  if (!reference || path.extname(reference)) return false;
  const candidate = path.resolve(path.dirname(sourcePath), reference);
  // If the exact extensionless file exists Pug treats it as raw text. Only a
  // resolver-selected .pug/.jade sibling is declarative source we audit.
  if (existsSync(candidate)) return false;
  return [".pug", ".jade"].some((extension) => existsSync(`${candidate}${extension}`));
}

function assertAllowedFileReference(rawPath, {
  sourcePath,
  relativeFile,
  mailRoot,
  emailBaseRoot,
  line,
  kind,
  extensions = [],
  allowGlob = false,
}) {
  const reference = String(rawPath || "").trim().replace(/^['"]|['"]$/g, "");
  if (!reference
      || path.isAbsolute(reference)
      || reference.includes("\\")
      || /[#!]\{|\u0000|^[a-z][a-z0-9+.-]*:/i.test(reference)
      || (!allowGlob && /[?*[{]/.test(reference))) {
    fail(`${sourceContextLabel(relativeFile, line)}: ${kind} must use a static relative path`, { file: relativeFile, line });
  }
  const globAt = reference.search(/[?*[{]/);
  const pathPart = globAt >= 0 ? reference.slice(0, globAt) : reference;
  const candidate = path.resolve(path.dirname(sourcePath), pathPart || ".");
  const editableRoot = path.resolve(mailRoot, "app");
  const vendorRoot = path.resolve(emailBaseRoot, "vendor");
  if (!pathWithin(editableRoot, candidate, { allowRoot: true })
      && !pathWithin(vendorRoot, candidate, { allowRoot: true })) {
    fail(`${sourceContextLabel(relativeFile, line)}: ${kind} escapes the current mail app/vendor roots`, { file: relativeFile, line });
  }

  // Pug/Stylus resolve extensionless references. Check both the lexical
  // candidate and every existing resolver suffix so a `helper.pug` symlink
  // cannot hide behind a safe-looking `include helper` path.
  const resolutionCandidates = [candidate];
  if (globAt < 0 && !path.extname(candidate)) {
    for (const extension of extensions) resolutionCandidates.push(`${candidate}${extension}`);
  }
  const realEditable = realpathSync(editableRoot);
  const realVendor = existsSync(vendorRoot) ? realpathSync(vendorRoot) : vendorRoot;
  for (const resolutionCandidate of resolutionCandidates) {
    let existing = resolutionCandidate;
    while (!existsSync(existing) && existing !== path.dirname(existing)) existing = path.dirname(existing);
    if (!existsSync(existing)) continue;
    const real = realpathSync(existing);
    if (!pathWithin(realEditable, real, { allowRoot: true }) && !pathWithin(realVendor, real, { allowRoot: true })) {
      fail(`${sourceContextLabel(relativeFile, line)}: ${kind} resolves through a symlink outside trusted roots`, { file: relativeFile, line });
    }
  }
}

function auditPugSource({ source, sourcePath, relativeFile, mailRoot, emailBaseRoot }) {
  const legacyIcon = trustedIconMixin(relativeFile, source);
  if (/\b(?:javascript|vbscript)\s*:|<\s*script\b|\bon[a-z]+\s*=/i.test(source)) {
    fail(`${relativeFile}: executable HTML/URL content is not allowed`, { file: relativeFile });
  }
  const directiveRe = /^\s*(include|extends)\s+([^\r\n]+)$/gim;
  let directive;
  while ((directive = directiveRe.exec(source))) {
    assertAllowedFileReference(directive[2], {
      sourcePath,
      relativeFile,
      mailRoot,
      emailBaseRoot,
      line: source.slice(0, directive.index).split("\n").length,
      kind: directive[1].toLowerCase(),
    });
  }

  let ast;
  try {
    ast = parsePug(lexPug(source, { filename: sourcePath }), { filename: sourcePath, src: source });
  } catch (error) {
    fail(`${relativeFile}: Pug parse failed: ${String(error?.message || error).split("\n")[0]}`, { file: relativeFile });
  }
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    const line = Number(node.line) || 1;
    if (["Conditional", "Each", "While", "Case", "When", "Filter", "IncludeFilter", "InterpolatedTag", "NamedBlock", "YieldBlock"].includes(node.type)) {
      fail(`${sourceContextLabel(relativeFile, line)}: executable Pug AST node ${node.type} is not allowed`, { file: relativeFile, line });
    }
    if (node.type === "Code"
        && (node.buffer !== true || node.mustEscape === false || !STATIC_LITERAL_RE.test(String(node.val || "")))) {
      fail(`${sourceContextLabel(relativeFile, line)}: Pug code must be an escaped, buffered static literal; expressions are not allowed`, { file: relativeFile, line });
    }
    if (["Include", "Extends"].includes(node.type)) {
      assertAllowedFileReference(node.file?.path, {
        sourcePath,
        relativeFile,
        mailRoot,
        emailBaseRoot,
        line,
        kind: node.type.toLowerCase(),
        extensions: [".pug", ".jade"],
      });
    }
    if (node.type === "RawInclude") {
      if ((Array.isArray(node.filters) && node.filters.length)
          || !isExtensionlessPugInclude(node.file?.path, sourcePath)) {
        fail(`${sourceContextLabel(relativeFile, line)}: raw/filtered Pug includes are not allowed`, { file: relativeFile, line });
      }
      assertAllowedFileReference(node.file?.path, {
        sourcePath,
        relativeFile,
        mailRoot,
        emailBaseRoot,
        line,
        kind: "include",
        extensions: [".pug", ".jade"],
      });
    }
    if (node.type === "Mixin" && (!legacyIcon || node.call !== false || node.name !== "icon" || node.args !== "iconName")) {
      fail(`${sourceContextLabel(relativeFile, line)}: custom Pug mixins/calls are not allowed in editable mail source`, { file: relativeFile, line });
    }
    if (node.type === "AttributeBlock" && (!legacyIcon || node.val !== "attributes")) {
      fail(`${sourceContextLabel(relativeFile, line)}: dynamic Pug attribute blocks are not allowed`, { file: relativeFile, line });
    }
    if (node.type === "Tag") {
      if (EXECUTABLE_HTML_TAGS.has(String(node.name || "").toLowerCase())) {
        fail(`${sourceContextLabel(relativeFile, line)}: executable HTML tag "${node.name}" is not allowed`, { file: relativeFile, line });
      }
      for (const attr of Array.isArray(node.attrs) ? node.attrs : []) {
        const value = String(attr.val || "");
        const legacyIconInterpolation = legacyIcon
          && attr.name === "xlink:href"
          && value === "'../assets/images/icon.svg#icon_#{iconName}'";
        if (!STATIC_LITERAL_RE.test(value) || (/[#!]\{/.test(value) && !legacyIconInterpolation)) {
          fail(`${sourceContextLabel(relativeFile, Number(attr.line) || line)}: attribute "${attr.name}" must be a static literal`, { file: relativeFile, line: Number(attr.line) || line });
        }
        if (/^on[a-z]+$/i.test(String(attr.name || ""))) {
          fail(`${sourceContextLabel(relativeFile, Number(attr.line) || line)}: event-handler attributes are not allowed`, { file: relativeFile, line: Number(attr.line) || line });
        }
      }
    }
    for (const [key, value] of Object.entries(node)) {
      if (["attrs", "attributeBlocks", "filename", "file"].includes(key)) continue;
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === "object") visit(value);
    }
  };
  visit(ast);
}

function auditStylusSource({ source, sourcePath, relativeFile, mailRoot, emailBaseRoot }) {
  if (/^\s*@js\b/gim.test(source)) {
    fail(`${relativeFile}: Stylus @js execution is not allowed`, { file: relativeFile });
  }
  if (/\b(?:require|use|json|embedurl|image-size)\s*\(/i.test(source)) {
    fail(`${relativeFile}: Stylus file-reading/plugin functions are not allowed`, { file: relativeFile });
  }
  if (/\b(?:javascript|vbscript)\s*:|\bexpression\s*\(/i.test(source)) {
    fail(`${relativeFile}: executable CSS/URL content is not allowed`, { file: relativeFile });
  }
  const importRe = /^\s*@?(import|require)\s+([^\r\n]+)$/gim;
  let match;
  while ((match = importRe.exec(source))) {
    const raw = String(match[2] || "").trim();
    if (/^url\(\s*['"]?https?:\/\//i.test(raw)) continue; // emitted CSS import, not a local compiler read
    const quoted = raw.match(/^(['"])([^'"\\\r\n]+)\1$/);
    if (!quoted || /[,;]/.test(raw)) {
      fail(`${sourceContextLabel(relativeFile, source.slice(0, match.index).split("\n").length)}: Stylus import must contain one static quoted path`, { file: relativeFile });
    }
    assertAllowedFileReference(quoted[2], {
      sourcePath,
      relativeFile,
      mailRoot,
      emailBaseRoot,
      line: source.slice(0, match.index).split("\n").length,
      kind: `Stylus ${match[1].toLowerCase()}`,
      extensions: [".styl", ".css"],
      allowGlob: true,
    });
  }
}

export function validateWorkbenchSourceContent({ content, target, file, mailRoot, emailBaseRoot } = {}) {
  const relativeFile = String(file || "").split(path.sep).join("/");
  const source = String(content ?? "");
  const extension = path.extname(relativeFile).toLowerCase();
  if ([".pug", ".jade"].includes(extension)) {
    auditPugSource({ source, sourcePath: target, relativeFile, mailRoot, emailBaseRoot });
  } else if (extension === ".styl") {
    auditStylusSource({ source, sourcePath: target, relativeFile, mailRoot, emailBaseRoot });
  } else if (extension === ".css") {
    if (/@import\s+(?:url\()?\s*['"]?(?:file:|\/|\.\.\/)/i.test(source)) {
      fail(`${relativeFile}: CSS import cannot read an absolute/parent filesystem path`, { file: relativeFile });
    }
    if (/\b(?:javascript|vbscript)\s*:|\bexpression\s*\(/i.test(source)) {
      fail(`${relativeFile}: executable CSS/URL content is not allowed`, { file: relativeFile });
    }
  }
  return { ok: true, file: relativeFile };
}

function listSourceFiles(root) {
  const files = [];
  if (!existsSync(root)) return files;
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const candidate = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(candidate);
      else if (entry.isFile() && EDITABLE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        // Build tools prefer Pug when both variants exist; stale Jade should not
        // block the selected source, but is audited when it is the only variant.
        if (entry.name.endsWith(".jade") && existsSync(candidate.replace(/\.jade$/i, ".pug"))) continue;
        files.push(candidate);
      }
    }
  };
  walk(root);
  return files;
}

export function auditMailSourceBeforeBuild({ emailBaseRoot, brand, mail } = {}) {
  const safeBrand = normalizeBrand(brand);
  const rawMail = normalizeMail(mail);
  const mailFolder = rawMail.startsWith("mail-") ? rawMail : `mail-${rawMail}`;
  const root = path.resolve(String(emailBaseRoot || ""));
  const resolved = resolveWorkbenchMailRoot({ emailBaseRoot: root, brand: safeBrand, mail: mailFolder });
  const files = listSourceFiles(resolved.appRoot);
  for (const target of files) {
    const relative = path.relative(resolved.appRoot, target).split(path.sep).join("/");
    validateWorkbenchSourceContent({
      content: readFileSync(target, "utf8"),
      target,
      file: relative,
      mailRoot: resolved.mailRoot,
      emailBaseRoot: root,
    });
  }
  return { ok: true, brand: safeBrand, mail: mailFolder, filesAudited: files.length };
}
