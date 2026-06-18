/**
 * src/placeholders-index.js — walks email-base, finds every
 * ${{ namespace.blockId }}$ token used in any mail's Pug/HTML, and
 * cross-references with vendor/data/<locale>/<namespace>.json to attach
 * a human-readable value (in a preferred locale, default "en").
 *
 * Output shape:
 *   {
 *     locale: "en",
 *     generatedAt: ISO,
 *     items: [
 *       {
 *         namespace: "footer",
 *         blockId:   "unsubscribe",
 *         value:     "Unsubscribe",          // value in chosen locale, if any
 *         seenInMails: ["X_IQBroker/mail-welcome", "X_AffSystem/mail-QCM-Offer", …]
 *       }, …
 *     ]
 *   }
 *
 * Used by the Monaco completion provider to suggest placeholders that
 * already exist anywhere in the base. Hover provider uses the same data
 * to show the EN/active-locale value when the cursor sits on a placeholder.
 *
 * Cached in-memory with a TTL; cheap to refresh on demand.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const PLACEHOLDER_RE = /\$\{\{\s*([\w-]+)\.([\w-]+)\s*\}\}\$/g;

let _cache = null;
let _cacheAt = 0;
const TTL_MS = 30_000;

async function walkDir(dir, results) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkDir(full, results);
    } else if (entry.isFile() && /\.(jade|pug|html)$/i.test(entry.name)) {
      results.push(full);
    }
  }
}

/**
 * Try to find an English value for `namespace.blockId` from vendor/data/<locale>/<namespace>.json.
 * Looks in the preferred locale first, then falls back to "en", "en_US".
 */
async function loadNamespaceJson(emailBaseRoot, namespace, locale) {
  const tryLocales = [locale, "en", "en_US"].filter(Boolean);
  for (const loc of tryLocales) {
    const p = path.join(emailBaseRoot, "vendor", "data", loc, `${namespace}.json`);
    try {
      const raw = await readFile(p, "utf8");
      return JSON.parse(raw);
    } catch {
      // not found, try next
    }
  }
  return null;
}

function resolveValue(json, namespace, blockId) {
  if (!json) return null;
  // Common shape: { footer: { unsubscribe: "Unsubscribe" } } — keyed by ns.
  if (json[namespace] && typeof json[namespace][blockId] === "string") {
    return json[namespace][blockId];
  }
  // Alt shape: { unsubscribe: "Unsubscribe" } — flat, no ns wrap.
  if (typeof json[blockId] === "string") return json[blockId];
  return null;
}

export async function buildPlaceholdersIndex({
  emailBaseRoot,
  locale = "en",
  force = false,
} = {}) {
  if (!force && _cache && Date.now() - _cacheAt < TTL_MS && _cache.locale === locale) {
    return _cache;
  }
  const root = emailBaseRoot || path.join(process.cwd(), "email-base");
  // Scan the X_* category directories — skip vendor/dist/etc.
  let categories = [];
  try {
    categories = (await readdir(root, { withFileTypes: true }))
      .filter((e) => e.isDirectory() && e.name.startsWith("X_") && !e.name.startsWith("X_legacy") && !e.name.startsWith("X_trash"))
      .map((e) => path.join(root, e.name));
  } catch {
    return { locale, generatedAt: new Date().toISOString(), items: [] };
  }

  // Collect templates per mail.
  const filesByMail = new Map(); // mailKey -> [files]
  for (const cat of categories) {
    let mails = [];
    try {
      mails = (await readdir(cat, { withFileTypes: true }))
        .filter((e) => e.isDirectory() && e.name.startsWith("mail-"))
        .map((e) => ({ key: `${path.basename(cat)}/${e.name}`, abs: path.join(cat, e.name) }));
    } catch { /* skip */ }
    for (const m of mails) {
      const templates = [];
      await walkDir(path.join(m.abs, "app", "templates"), templates);
      if (templates.length) filesByMail.set(m.key, templates);
    }
  }

  // Index: key=`${ns}.${blockId}` -> { namespace, blockId, seenInMails:Set }
  const index = new Map();
  const namespaces = new Set();
  for (const [mailKey, files] of filesByMail.entries()) {
    for (const file of files) {
      let text;
      try { text = await readFile(file, "utf8"); } catch { continue; }
      PLACEHOLDER_RE.lastIndex = 0;
      let m;
      while ((m = PLACEHOLDER_RE.exec(text)) !== null) {
        const ns = m[1];
        const id = m[2];
        namespaces.add(ns);
        const key = `${ns}.${id}`;
        if (!index.has(key)) {
          index.set(key, { namespace: ns, blockId: id, seenInMails: new Set() });
        }
        index.get(key).seenInMails.add(mailKey);
      }
    }
  }

  // Load namespace JSONs from vendor/data/<locale>/.
  const nsJsonCache = new Map();
  for (const ns of namespaces) {
    nsJsonCache.set(ns, await loadNamespaceJson(root, ns, locale));
  }

  // Materialize.
  const items = [];
  for (const [, entry] of index.entries()) {
    const value = resolveValue(nsJsonCache.get(entry.namespace), entry.namespace, entry.blockId);
    items.push({
      namespace: entry.namespace,
      blockId: entry.blockId,
      value: value || null,
      seenInMails: Array.from(entry.seenInMails).sort(),
    });
  }
  items.sort((a, b) =>
    a.namespace.localeCompare(b.namespace) || a.blockId.localeCompare(b.blockId)
  );

  _cache = {
    locale,
    generatedAt: new Date().toISOString(),
    items,
    mailsScanned: filesByMail.size,
    namespacesScanned: namespaces.size,
  };
  _cacheAt = Date.now();
  return _cache;
}

export function invalidatePlaceholdersIndexCache() {
  _cache = null;
  _cacheAt = 0;
}
