#!/usr/bin/env node
/**
 * tools/scaffold-system-mail.js
 *
 * Creates a new system email by cloning an existing mail template.
 * Renames all ${{ old-mail-id.block_XX }}$ tokens to ${{ new-mail-id.block_XX }}$.
 * Preserves all shared tokens (affbot, footer) and template variables ({{link}}).
 *
 * Usage:
 *   node tools/scaffold-system-mail.js \
 *     --category X_AffSystem \
 *     --template mail-password-retrieving-affiliate \
 *     --new-mail  new-welcome-email
 *
 * Returns JSON: { mailRoot, tokenKeys, blockCount }
 * Exit 0 = success, 1 = error
 */

import path from "node:path";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, cpSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const emailBaseDir = path.resolve(__dirname, "../email-base");

// ─── CLI args ─────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const val = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
      out[key] = val;
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function die(msg) {
  console.error(`[scaffold] ERROR: ${msg}`);
  process.exit(1);
}

function walkDir(dir, cb) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkDir(full, cb);
    else cb(full);
  }
}

/**
 * Extract all ${{ namespace.key }}$ token namespaces from a string.
 */
function extractNamespaces(content) {
  const re = /\$\{\{\s*([a-zA-Z0-9_-]+)\.[a-zA-Z0-9_.-]+\s*\}\}\$/g;
  const ns = new Set();
  let m;
  while ((m = re.exec(content)) !== null) ns.add(m[1]);
  return ns;
}

/**
 * Extract all ${{ namespace.key }}$ tokens from content, grouped by namespace.
 */
function extractTokens(content) {
  const re = /\$\{\{\s*([a-zA-Z0-9_-]+)\.([a-zA-Z0-9_.-]+)\s*\}\}\$/g;
  const map = {};
  let m;
  while ((m = re.exec(content)) !== null) {
    const [, ns, key] = m;
    if (!map[ns]) map[ns] = new Set();
    map[ns].add(key);
  }
  return map;
}

/**
 * Replace ${{ oldNs.key }}$ with ${{ newNs.key }}$ in content.
 * Shared namespaces (affbot, footer, etc.) are preserved.
 */
function renameTokenNamespace(content, oldNs, newNs) {
  const re = new RegExp(
    `\\$\\{\\{\\s*(${escapeRegex(oldNs)})\\.(([a-zA-Z0-9_.-]+))\\s*\\}\\}\\$`,
    "g"
  );
  return content.replace(re, `\${{ ${newNs}.$3 }}\$`);
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export async function scaffoldMail({
  category,
  templateMail,
  newMailId,
  dryRun = false,
  verbose = false,
}) {
  // Resolve paths
  const srcRoot = path.join(emailBaseDir, category, templateMail);
  const destRoot = path.join(emailBaseDir, category, `mail-${newMailId}`);

  if (!existsSync(srcRoot)) {
    throw new Error(`Template not found: ${srcRoot}`);
  }

  if (existsSync(destRoot)) {
    throw new Error(`Destination already exists: ${destRoot}`);
  }

  // Derive the old namespace from template mail folder name.
  // Convention: mail-password-retrieving-affiliate → password-retrieving-affiliate
  const oldNs = templateMail.startsWith("mail-")
    ? templateMail.slice("mail-".length)
    : templateMail;
  const newNs = newMailId;

  if (verbose) {
    console.error(`[scaffold] src  : ${srcRoot}`);
    console.error(`[scaffold] dest : ${destRoot}`);
    console.error(`[scaffold] ns   : ${oldNs} → ${newNs}`);
  }

  // Collect all template files and build rename plan
  const textExtensions = new Set([".jade", ".pug", ".styl", ".css", ".js", ".json", ".html"]);
  const renames = []; // { srcFile, destFile, content }
  const tokenMap = {}; // ns → Set of keys (from new namespace only)

  walkDir(srcRoot, (srcFile) => {
    const rel = path.relative(srcRoot, srcFile);
    const destFile = path.join(destRoot, rel);
    const ext = path.extname(srcFile).toLowerCase();

    if (!textExtensions.has(ext)) {
      // Binary file (images, etc.) — just copy
      renames.push({ srcFile, destFile, content: null, binary: true });
      return;
    }

    let content = readFileSync(srcFile, "utf8");

    // Rename token namespace in text files
    content = renameTokenNamespace(content, oldNs, newNs);

    // Collect token keys for the new namespace
    const tokens = extractTokens(content);
    if (tokens[newNs]) {
      if (!tokenMap[newNs]) tokenMap[newNs] = new Set();
      for (const k of tokens[newNs]) tokenMap[newNs].add(k);
    }

    renames.push({ srcFile, destFile, content, binary: false });
  });

  if (dryRun) {
    const result = buildResult(destRoot, newNs, tokenMap, renames);
    if (verbose) console.error("[scaffold] DRY RUN — no files written");
    return result;
  }

  // Write files
  for (const { srcFile, destFile, content, binary } of renames) {
    const dir = path.dirname(destFile);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    if (binary) {
      const buf = readFileSync(srcFile);
      writeFileSync(destFile, buf);
    } else {
      writeFileSync(destFile, content, "utf8");
    }

    if (verbose) console.error(`[scaffold] wrote ${path.relative(emailBaseDir, destFile)}`);
  }

  return buildResult(destRoot, newNs, tokenMap, renames);
}

function buildResult(destRoot, newNs, tokenMap, renames) {
  const mailNsTokens = tokenMap[newNs] ? [...tokenMap[newNs]].sort() : [];

  // Build a template locale JSON (keys present, values empty — to be filled by AI)
  const localeTemplate = {};
  for (const key of mailNsTokens) {
    localeTemplate[key] = "";
  }

  return {
    mailRoot: destRoot,
    namespace: newNs,
    tokenKeys: mailNsTokens,
    blockCount: mailNsTokens.length,
    localeTemplate,
    filesWritten: renames.length,
  };
}

// ─── CLI entrypoint ───────────────────────────────────────────────────────────

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const { category, template, "new-mail": newMail, "dry-run": dryRun, verbose } = args;

  if (!category || !template || !newMail) {
    die("Required: --category <CAT> --template <TEMPLATE_MAIL> --new-mail <NEW_ID>\n" +
      "Example: node tools/scaffold-system-mail.js --category X_AffSystem --template mail-password-retrieving-affiliate --new-mail new-welcome");
  }

  scaffoldMail({
    category,
    templateMail: template,
    newMailId: newMail,
    dryRun: Boolean(dryRun),
    verbose: Boolean(verbose),
  })
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
      process.exit(0);
    })
    .catch((err) => {
      die(err.message);
    });
}
