#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * Modern email build pipeline (email-only):
 * 1) Compile Stylus -> CSS
 * 2) Split CSS into:
 *    - inlineCss  (regular rules)
 *    - headCss    (@media/@supports/@font-face/@keyframes ...)
 * 3) Render Pug template -> HTML (injecting headCss into vendor/helpers/head.pug)
 * 4) Inline inlineCss into HTML (without touching headCss)
 * 5) Localize placeholders (${{ ... }}$) using JSON from vendor/data/<locale>
 */

const path = require('path');
const fs = require('fs-extra');
const pug = require('pug');
const stylus = require('stylus');
const minimist = require('minimist');
const inlineCss = require('inline-css');
const { isRtlLocale: isRtlLocaleCode, applyRtl: applyRtlToHtml } = require('./rtl');
const postcss = require('postcss');
const safeParser = require('postcss-safe-parser');
const csso = require('csso');
const { html: beautify } = require('js-beautify');

const DEFAULT_LANG_DIR = path.join('vendor', 'data');
const LOCALE_DIR_RE = /^[A-Za-z]{2}([_-][A-Za-z]{2})?$/;

function die(msg, code = 1) {
  console.error(`\n[build] ${msg}\n`);
  process.exit(code);
}

const generatedPugAliases = [];

function cleanupGeneratedPugAliasesSync() {
  for (let i = generatedPugAliases.length - 1; i >= 0; i -= 1) {
    try {
      if (fs.existsSync(generatedPugAliases[i])) fs.unlinkSync(generatedPugAliases[i]);
    } catch {
      // best-effort cleanup
    }
  }
  generatedPugAliases.length = 0;
}

process.once('exit', cleanupGeneratedPugAliasesSync);


function beautifyHtml(html) {
  // Readable output for development / review.
  try {
    return beautify(html, {
      indent_size: 2,
      preserve_newlines: true,
      max_preserve_newlines: 2,
      wrap_line_length: 120,
      end_with_newline: true,
    });
  } catch {
    return html;
  }
}



function ensurePugAliases(dirAbs) {
  // Pug v3 tends to resolve extensionless includes to .pug first.
  // Legacy templates are still .jade, so create temporary one-to-one aliases
  // for this build and remove only the files we created on process exit.
  if (!fs.existsSync(dirAbs)) return;

  const stack = [dirAbs];
  while (stack.length) {
    const cur = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      const p = path.join(cur, ent.name);
      if (ent.isDirectory()) stack.push(p);
      else if (ent.isFile() && ent.name.endsWith('.jade')) {
        const pugPath = p.slice(0, -'.jade'.length) + '.pug';
        if (!fs.existsSync(pugPath)) {
          try {
            fs.copyFileSync(p, pugPath);
            generatedPugAliases.push(pugPath);
          } catch {
            // ignore copy errors
          }
        }
      }
    }
  }
}

function getMailRoot(category, mail) {
  // Folder convention in this base: <category>/mail-<mail>
  return path.join(category, `mail-${mail}`);
}

function parseLocalesArg(localesArg) {
  if (!localesArg) return null;
  if (Array.isArray(localesArg)) return localesArg.flatMap(String);
  return String(localesArg)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

async function listLocales(langDirAbs) {
  if (!(await fs.pathExists(langDirAbs))) return [];
  const entries = await fs.readdir(langDirAbs, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory() && LOCALE_DIR_RE.test(e.name))
    .map((e) => e.name)
    .sort();
}

function compileStylus(stylPathAbs, includePathsAbs = [], autoImportsAbs = []) {
  const src = fs.readFileSync(stylPathAbs, 'utf8');
  return new Promise((resolve, reject) => {
    const s = stylus(src)
      .set('filename', stylPathAbs)
      .set('include css', true);
    for (const p of includePathsAbs) s.include(p);
    for (const p of autoImportsAbs) {
      if (p && fs.existsSync(p)) {
        try {
          s.import(p);
        } catch {
          // ignore import errors to keep compilation resilient
        }
      }
    }
    s.render((err, css) => {
      if (err) reject(err);
      else resolve(css);
    });
  });
}

function splitCss(cssText, { minifyHead = false } = {}) {
  // PostCSS split: keep media/supports/font-face/keyframes in <head>, rest for inlining
  const root = postcss.parse(cssText, { parser: safeParser });
  const headRoot = postcss.root();
  const inlineRoot = postcss.root();

  const HEAD_ATRULES = new Set([
    'media',
    'supports',
    'font-face',
    'keyframes',
    '-webkit-keyframes',
    '-moz-keyframes',
    'charset'
  ]);

  root.each((node) => {
    if (node.type === 'atrule' && HEAD_ATRULES.has(node.name)) headRoot.append(node.clone());
    else inlineRoot.append(node.clone());
  });

  let headCss = headRoot.toString();
  let inlineCssText = inlineRoot.toString();

  if (minifyHead) {
    // csso is safe enough for email-style CSS; if it breaks something, disable via --no-minifyCss
    try {
      headCss = csso.minify(headCss).css;
    } catch (e) {
      // keep original if minify fails
    }
  }

  return { headCss, inlineCss: inlineCssText };
}

function collectUsedSelectors(html) {
  // Very lightweight extraction: good enough to safely drop obviously-unused class/id-only rules.
  const classes = new Set();
  const ids = new Set();

  // class="a b c"
  const classRe = /\bclass\s*=\s*"([^"]*)"/gi;
  let m;
  while ((m = classRe.exec(html))) {
    const parts = m[1].split(/\s+/g).map((x) => x.trim()).filter(Boolean);
    for (const c of parts) classes.add(c);
  }

  // id="foo"
  const idRe = /\bid\s*=\s*"([^"]+)"/gi;
  while ((m = idRe.exec(html))) {
    const id = (m[1] || '').trim();
    if (id) ids.add(id);
  }

  return { classes, ids };
}

function trimInlineCss(cssText, used, { aggressive = false } = {}) {
  // Drop rules where ALL selectors reference classes/ids that are not present in HTML.
  // Non-aggressive mode keeps attribute selectors/pseudos/etc. for safety.
  const root = postcss.parse(cssText, { parser: safeParser });

  const attrTokenRe = /\[(class|id)\s*(=|~=|\^=|\$=|\*=)\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]+))\s*\]/gi;

  const getAttrTokens = (sel) => {
    const classTokens = [];
    const idTokens = [];
    let forceKeep = false;
    let mm;
    while ((mm = attrTokenRe.exec(sel))) {
      const attr = mm[1];
      const op = mm[2];
      const raw = (mm[3] || mm[4] || mm[5] || '').trim();
      if (op !== '=' && op !== '~=') {
        // Partial-match operators are too risky to trim.
        forceKeep = true;
        break;
      }
      if (!raw) continue;
      const parts = raw.split(/\s+/g).map((x) => x.trim()).filter(Boolean);
      if (attr === 'class') classTokens.push(...parts);
      if (attr === 'id') idTokens.push(...parts);
    }
    return { classTokens, idTokens, forceKeep };
  };

  const keepSelector = (sel) => {
    const classTokens = [];
    const idTokens = [];
    let mm;
    const clsRe = /\.([_a-zA-Z0-9-]+)/g;
    while ((mm = clsRe.exec(sel))) classTokens.push(mm[1]);
    const idRe = /#([_a-zA-Z0-9-]+)/g;
    while ((mm = idRe.exec(sel))) idTokens.push(mm[1]);

    const attrTokens = getAttrTokens(sel);
    if (attrTokens.forceKeep && !aggressive) return true;
    classTokens.push(...attrTokens.classTokens);
    idTokens.push(...attrTokens.idTokens);

    if (!aggressive) {
      // Keep anything we aren't sure about (attribute selectors, pseudos, combinators, etc.).
      if (sel.includes('[') || sel.includes('*') || sel.includes(':') || sel.includes('>') || sel.includes('+') || sel.includes('~')) {
        return true;
      }
    }

    // No class/id tokens => likely tag-based selector, keep.
    if (classTokens.length === 0 && idTokens.length === 0) return true;

    // Keep only if ALL referenced tokens exist in the HTML.
    for (const c of classTokens) if (!used.classes.has(c)) return false;
    for (const id of idTokens) if (!used.ids.has(id)) return false;
    return true;
  };

  root.walkRules((rule) => {
    // Split group selectors and keep only matching ones
    const sels = rule.selector.split(',').map((s) => s.trim()).filter(Boolean);
    const kept = sels.filter(keepSelector);
    if (kept.length === 0) rule.remove();
    else rule.selector = kept.join(', ');
  });

  return root.toString();
}

function stripEmptyAtRules(cssText) {
  if (!cssText) return cssText;
  const root = postcss.parse(cssText, { parser: safeParser });
  root.walkAtRules((rule) => {
    const nodes = rule.nodes || [];
    const hasContent = nodes.some((n) => n.type !== 'comment');
    if (!hasContent) rule.remove();
  });
  return root.toString();
}

function buildTranslationIndex(langDirAbs, locale) {
  const base = path.join(langDirAbs, locale);
  const out = new Map();
  if (!fs.existsSync(base)) return out;
  const files = fs.readdirSync(base).filter((f) => f.endsWith('.json'));
  for (const f of files) {
    try {
      const json = fs.readJsonSync(path.join(base, f));
      out.set(path.basename(f, '.json'), json);
    } catch (e) {
      // ignore broken JSON files
    }
  }
  return out;
}

function getDeep(obj, pathParts) {
  let cur = obj;
  for (const p of pathParts) {
    if (cur == null || !Object.prototype.hasOwnProperty.call(Object(cur), p)) return undefined;
    cur = cur[p];
  }
  return cur;
}

function createLocalizationTextPositionChecker(source) {
  const text = String(source || '');
  const lower = text.toLowerCase();
  return (offset) => {
    const at = Math.max(0, Number(offset) || 0);
    // A translation token inside an opening tag is an attribute value (src,
    // href, alt, background, style, ...). Injecting <bdi> there corrupts the
    // attribute and is especially destructive for image URLs.
    if (text.lastIndexOf('<', at) > text.lastIndexOf('>', at)) return false;
    if (text.lastIndexOf('<!--', at) > text.lastIndexOf('-->', at)) return false;
    for (const tag of ['style', 'script']) {
      if (lower.lastIndexOf(`<${tag}`, at) > lower.lastIndexOf(`</${tag}`, at)) return false;
    }
    return true;
  };
}

function localizeHtmlPlaceholders(html, translationIndex, opts = {}) {
  const { failOnMissing = false, wrapWithBdi = false } = opts;
  const isTextPosition = createLocalizationTextPositionChecker(html);
  // Matches: ${{ file.path.to.key }}$
  const re = /\$\{\{\s*([a-zA-Z0-9_-]+)(?:\.([a-zA-Z0-9_.-]+))\s*\}\}\$/g;
  return html.replace(re, (m, fileKey, keyPath, offset) => {
    const json = translationIndex.get(fileKey);
    if (!json) {
      if (failOnMissing) throw new Error(`Missing translation file: ${fileKey}.json`);
      return m;
    }
    const parts = (keyPath || '').split('.').filter(Boolean);
    // Both locale JSON conventions exist in the historical base:
    //   namespace.json → { block_00: "..." }                       (flat)
    //   namespace.json → { namespace: { block_00: "..." } }        (wrapped)
    // Prefer the direct path so legacy tokens such as footer.footer.warn keep
    // their exact meaning; use the redundant namespace wrapper as a fallback.
    let val = parts.length ? getDeep(json, parts) : undefined;
    if (val == null && json && typeof json === 'object' && json[fileKey]) {
      val = getDeep(json[fileKey], parts);
    }
    if (val == null) {
      if (failOnMissing) throw new Error(`Missing translation key: ${fileKey}.${keyPath}`);
      return m;
    }
    const str = String(val);
    // RTL locales: isolate each substituted block as its own bidi run via
    // <bdi>. Prevents the "punctuation jumps" artifact when a block contains
    // LTR placeholders (like `{{Level_Name}}`) inside Arabic/Urdu prose, or
    // when the surrounding HTML mixes directions.
    // Skip wrapping inside attributes/style/script, if the value already
    // contains a <bdi> (idempotent), or if it's empty / whitespace-only.
    if (wrapWithBdi && isTextPosition(offset) && str.trim() && !/<bdi\b/i.test(str)) {
      return `<bdi>${str}</bdi>`;
    }
    return str;
  });
}

function findUnresolvedLocalizationTokens(html) {
  if (!html) return [];
  const matches = html.match(/\$\{\{\s*[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_.-]+)?\s*\}\}\$/g) || [];
  return [...new Set(matches)];
}

function formatTokenPreview(tokens, limit = 5) {
  if (!tokens.length) return '';
  if (tokens.length <= limit) return tokens.join(', ');
  return `${tokens.slice(0, limit).join(', ')}, ...`;
}

async function pruneStaleLocaleDirs(distRoot, locales) {
  if (!(await fs.pathExists(distRoot))) return;
  const keep = new Set(locales);
  const entries = await fs.readdir(distRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!LOCALE_DIR_RE.test(entry.name)) continue;
    if (keep.has(entry.name)) continue;
    try { await fs.remove(path.join(distRoot, entry.name)); } catch { /* ignore permission errors */ }
  }
}

async function inlineHtml(html, inlineCssText) {
  // Do NOT touch <head> style tag with media queries.
  const out = await inlineCss(html, {
    url: 'file:///',
    extraCss: inlineCssText,
    applyStyleTags: false,
    applyLinkTags: false,
    removeStyleTags: false,
    removeLinkTags: false,
    preserveMediaQueries: true,
  });
  // The inliner's HTML parser mangles the source XHTML doctype
  // (`doctype PUBLIC "…"`) into a broken `<!DOCTYPE public>`. Restore a proper
  // XHTML 1.0 Strict doctype so clients don't fall into quirks mode.
  return out.replace(/<!DOCTYPE[^>]*>/i,
    '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd">');
}

async function main() {
  const argv = minimist(process.argv.slice(2), {
    boolean: ['minifyCss', 'base', 'failOnMissing', 'pretty', 'trimCss', 'minifyHtml', 'minifyAll', 'skip-locales'],
    string: ['rtl-mode'],
    default: {
      minifyCss: true,
      base: true,
      failOnMissing: false,
      dist: 'dist',
      langDir: DEFAULT_LANG_DIR,
      pretty: false,
      trimCss: true,
      minifyHtml: false,
      minifyAll: false,
      'skip-locales': false,
      'rtl-mode': 'text',
    },
    alias: {
      c: 'category',
      m: 'mail',
      l: 'locales',
    },
  });

  // Pretty-print final HTML for debugging (NOT for production sending).
  // Usage: node tools/build-mail.js ... --pretty [--no-minifyCss]


async function writeHtmlPair(dirAbs, htmlCompact, htmlPretty, { emitPretty = false } = {}) {
  await fs.ensureDir(dirAbs);
  // 1) compact (as-for-production)
  await fs.writeFile(path.join(dirAbs, 'index.html'), htmlCompact, 'utf8');
  // 2) pretty (as-for-development/review)
  if (emitPretty) {
    await fs.writeFile(path.join(dirAbs, 'index.pretty.html'), beautifyHtml(htmlPretty), 'utf8');
  } else {
    try { await fs.remove(path.join(dirAbs, 'index.pretty.html')); } catch { /* ignore if file can't be removed */ }
  }
}



  const category = argv.category;
  const mail = argv.mail;
  if (!category || !mail) {
    die('Required flags: --category <CAT> --mail <NAME>. Example: --category X_IQ --mail roll-300126');
  }

  const projectRoot = process.cwd();
  const mailRoot = path.join(projectRoot, getMailRoot(category, mail));
  const templatesRoot = path.join(mailRoot, 'app', 'templates');
  const stylesRoot = path.join(mailRoot, 'app', 'styles');
  const vendorStylesRoot = path.join(projectRoot, 'vendor', 'styles');
  const includePaths = [stylesRoot, vendorStylesRoot];
  const autoImports = [path.join(vendorStylesRoot, 'tokens.styl')];

  // Template resolution rules:
  // - Allow index.html (RAW MODE — skip Pug+Stylus, use HTML verbatim),
  //   else index.pug, else index.jade.
  // - If both index.pug and index.jade exist, prefer .pug.
  const indexHtmlPath = path.join(templatesRoot, 'index.html');
  const indexPugPath = path.join(templatesRoot, 'index.pug');
  const indexJadePath = path.join(templatesRoot, 'index.jade');
  const hasHtml = await fs.pathExists(indexHtmlPath);
  const hasPug = await fs.pathExists(indexPugPath);
  const hasJade = await fs.pathExists(indexJadePath);

  if (hasPug && hasJade) {
    if (argv.verbose) {
      console.warn(`[build] Both index.pug and index.jade found — using index.pug (ignoring .jade).`);
    }
  }

  // RAW HTML MODE — for templates imported from outside (e.g. paste from
  // VS Code) where the user just wants the HTML to flow through
  // localization + RTL untouched, no Pug/Stylus compile.
  const rawHtmlMode = hasHtml && !hasPug && !hasJade;
  const templateFile = rawHtmlMode
    ? indexHtmlPath
    : (hasPug ? indexPugPath : indexJadePath);
  if (!(await fs.pathExists(templateFile))) {
    die(`Template not found: looked for index.html / index.pug / index.jade in ${path.relative(projectRoot, templatesRoot)}`);
  }

  if (argv.verbose || rawHtmlMode) {
    console.log(`[build] Template: ${path.relative(projectRoot, templateFile)}${rawHtmlMode ? ' (RAW HTML MODE — Pug+Stylus skipped)' : ''}`);
  }

  // Pick main Stylus entry: inline.styl (if exists) else common.styl.
  // In RAW MODE, Stylus is OPTIONAL: if no entry exists we just skip compile.
  const stylEntry = (await fs.pathExists(path.join(stylesRoot, 'inline.styl')))
    ? path.join(stylesRoot, 'inline.styl')
    : path.join(stylesRoot, 'common.styl');
  const hasStylEntry = await fs.pathExists(stylEntry);

  if (!hasStylEntry && !rawHtmlMode) {
    die(`Stylus entry not found (expected inline.styl or common.styl): ${path.relative(projectRoot, stylEntry)}`);
  }

  const langDirAbs = path.join(projectRoot, argv.langDir);
  const locales = argv['skip-locales']
    ? []
    : (parseLocalesArg(argv.locales) || (await listLocales(langDirAbs)));
  const rtlMode = /^(?:mirror|full)$/i.test(String(argv['rtl-mode'] || '').trim()) ? 'mirror' : 'text';

  // 1) CSS (compile once, then assemble per-output). In RAW HTML MODE
  // with no stylus entry, we use an empty CSS — HTML is taken verbatim.
  let cssText = '';
  if (hasStylEntry) {
    try {
      cssText = await compileStylus(stylEntry, includePaths, autoImports);
    } catch (e) {
      if (rawHtmlMode) {
        console.warn('[build] Stylus compile failed in raw mode; continuing with empty CSS:', e.message || e);
        cssText = '';
      } else {
        die(`Stylus compile failed: ${e.message || e}`);
      }
    }
  }
  const { headCss: headCssRaw, inlineCss: inlineCssRaw } = splitCss(cssText, { minifyHead: false });

  // Optional: head-only CSS (global + per-mail)
  // - Stays in <head>
  // - NOT filtered: can include non-@media rules
  // - Does NOT participate in inlining
  let headOnlyRaw = '';
  const globalHeadOnly = path.join(projectRoot, 'vendor', 'styles', 'head-only.styl');
  const mailHeadOnly = path.join(stylesRoot, 'head-only.styl');
  for (const entry of [globalHeadOnly, mailHeadOnly]) {
    if (!(await fs.pathExists(entry))) continue;
    try {
      let chunk = await compileStylus(entry, includePaths, autoImports);
      if (chunk && chunk.trim()) headOnlyRaw += (headOnlyRaw ? '\n' : '') + chunk;
    } catch (e) {
      die(`Head-only Stylus compile failed (${path.relative(projectRoot, entry)}): ${e.message || e}`);
    }
  }

  // Optional: head-extra CSS (global + per-mail)
  // - Stays in <head>
  // - NOT filtered: can include non-@media rules
  // - ALSO participates in inlining
  let headExtraRaw = '';
  const globalHeadExtra = path.join(projectRoot, 'vendor', 'styles', 'head-extra.styl');
  const mailHeadExtra = path.join(stylesRoot, 'head-extra.styl');
  for (const entry of [globalHeadExtra, mailHeadExtra]) {
    if (!(await fs.pathExists(entry))) continue;
    try {
      let chunk = await compileStylus(entry, includePaths, autoImports);
      if (chunk && chunk.trim()) headExtraRaw += (headExtraRaw ? '\n' : '') + chunk;
    } catch (e) {
      die(`Head-extra Stylus compile failed (${path.relative(projectRoot, entry)}): ${e.message || e}`);
    }
  }

  // Pug include compatibility for legacy .jade templates (skip in raw mode).
  if (!rawHtmlMode) {
    ensurePugAliases(path.join(projectRoot, 'vendor', 'helpers'));
    ensurePugAliases(templatesRoot);
  }
  console.log(`[build] Template: ${path.relative(projectRoot, templateFile)}`);
  console.log(`[build] Locales: ${locales.join(', ')}`);

  function renderHtml(headCssFinal, prettyHtml) {
    if (rawHtmlMode) {
      // Raw HTML mode: read the file verbatim. If the user wants headCss
      // injected, they should add a <!-- HEAD_CSS --> marker; otherwise we
      // splice the styles into the <head> automatically if it exists.
      let raw;
      try {
        raw = fs.readFileSync(templateFile, 'utf8');
      } catch (e) {
        die(`Failed to read ${path.relative(projectRoot, templateFile)}: ${e.message || e}`);
      }
      if (headCssFinal && /<\/head>/i.test(raw)) {
        raw = raw.replace(/<\/head>/i, `<style>${headCssFinal}</style></head>`);
      }
      return raw;
    }
    try {
      return pug.renderFile(templateFile, {
        // Pug locals
        headCss: headCssFinal,
        headComment: `${category}/mail-${mail}`,
        // Make includes resolve like in legacy gulp-jade
        basedir: projectRoot,
        // Debug-friendly (human readable) Pug output.
        pretty: Boolean(prettyHtml ?? argv.pretty),
      });
    } catch (e) {
      die(`Pug render failed: ${e.message || e}`);
    }
  }

  function minifyHtmlText(htmlText) {
    if (!htmlText) return htmlText;
    // Conservative HTML minify: collapse whitespace between tags.
    return htmlText.replace(/>\s+</g, '><').trim();
  }

  async function buildHtmlVariant({ minifyHead, prettyHtml, minifyInline, minifyHtml }) {
    const minifySafe = (css) => {
      if (!minifyHead || !css) return css;
      try {
        return csso.minify(css).css;
      } catch {
        return css;
      }
    };

    const headOnlyCss = minifySafe(headOnlyRaw);
    const headCss = minifySafe(headCssRaw);
    const headExtraCss = minifySafe(headExtraRaw);

    // Order is deliberate for readability/debugging.
    // 1) head-only (unfiltered)
    // 2) extracted head CSS (typically @media / non-inlinable at-rules)
    // 3) head-extra (unfiltered)
    let headCssFinal = [headOnlyCss, headCss, headExtraCss].filter(Boolean).join('\n\n');
    let inlineCssFinal = [inlineCssRaw, headExtraCss].filter(Boolean).join('\n');
    if (minifyInline && inlineCssFinal) {
      try {
        inlineCssFinal = csso.minify(inlineCssFinal).css;
      } catch {}
    }

    // 2) Render base HTML (with headCss injected)
    let html = renderHtml(headCssFinal, prettyHtml);

    // 2.5) Optional: drop obviously-unused class/id-only rules BEFORE inlining
    if (argv.trimCss) {
      const used = collectUsedSelectors(html);

      // 2.5a) Trim inline CSS (safe class/id-only rules)
      {
        const before = Buffer.byteLength(inlineCssFinal || '', 'utf8');
        inlineCssFinal = trimInlineCss(inlineCssFinal, used);
        const after = Buffer.byteLength(inlineCssFinal || '', 'utf8');
        const delta = before - after;
        if (delta > 0) {
          console.log(`[build] CSS trim (inline): -${(delta / 1024).toFixed(1)} KB (${Math.round((delta / Math.max(1, before)) * 100)}%)`);
        }
      }

      // 2.5b) Trim head CSS (but keep head-only unfiltered)
      const headTrimTarget = [headCss, headExtraCss].filter(Boolean).join('\n\n');
      if (headTrimTarget) {
        const before = Buffer.byteLength(headTrimTarget, 'utf8');
        const headTrimmed = trimInlineCss(headTrimTarget, used, { aggressive: true });
        const after = Buffer.byteLength(headTrimmed || '', 'utf8');
        const delta = before - after;
        if (delta > 0) {
          console.log(`[build] CSS trim (head): -${(delta / 1024).toFixed(1)} KB (${Math.round((delta / Math.max(1, before)) * 100)}%)`);
        }
        headCssFinal = [headOnlyCss, headTrimmed].filter(Boolean).join('\n\n');
        headCssFinal = stripEmptyAtRules(headCssFinal);
        // Re-render HTML with trimmed head styles.
        html = renderHtml(headCssFinal, prettyHtml);
      }
    }

    headCssFinal = stripEmptyAtRules(headCssFinal);
    html = renderHtml(headCssFinal, prettyHtml);

    // 3) Inline
    try {
      html = await inlineHtml(html, inlineCssFinal);
    } catch (e) {
      die(`Inline CSS failed: ${e.message || e}`);
    }

    if (minifyHtml) {
      html = minifyHtmlText(html);
    }

    return { html, headCssFinal, inlineCssFinal };
  }

  const distRoot = path.join(projectRoot, argv.dist, category, `mail-${mail}`);
  await fs.ensureDir(distRoot);
  await pruneStaleLocaleDirs(distRoot, locales);

  // 4) Write base (non-localized)
  let baseCompact = null;
  let basePretty = null;
  if (argv.base) {
    const minifyAll = Boolean(argv.minifyAll);
    const compactVariant = await buildHtmlVariant({
      minifyHead: argv.minifyCss || minifyAll,
      minifyInline: minifyAll,
      minifyHtml: argv.minifyHtml || minifyAll,
      prettyHtml: false,
    });
    baseCompact = compactVariant.html;
    if (argv.pretty) {
      const prettyVariant = await buildHtmlVariant({
        minifyHead: false,
        minifyInline: false,
        minifyHtml: false,
        prettyHtml: true,
      });
      basePretty = prettyVariant.html;
    }
    await writeHtmlPair(distRoot, baseCompact, basePretty, { emitPretty: argv.pretty });

    // Stats (from compact variant)
    const headBytes = Buffer.byteLength(compactVariant.headCssFinal || '', 'utf8');
    const inlineBytes = Buffer.byteLength(compactVariant.inlineCssFinal || '', 'utf8');
    console.log(`[build] CSS split: head=${(headBytes / 1024).toFixed(1)} KB, inline=${(inlineBytes / 1024).toFixed(1)} KB`);
  }

  // 5) Locales
  for (const locale of locales) {
    const idx = buildTranslationIndex(langDirAbs, locale);
    if (!baseCompact) {
      const minifyAll = Boolean(argv.minifyAll);
      const compactVariant = await buildHtmlVariant({
        minifyHead: argv.minifyCss || minifyAll,
        minifyInline: minifyAll,
        minifyHtml: argv.minifyHtml || minifyAll,
        prettyHtml: false,
      });
      baseCompact = compactVariant.html;
    }
    if (argv.pretty && !basePretty) {
      const prettyVariant = await buildHtmlVariant({
        minifyHead: false,
        minifyInline: false,
        minifyHtml: false,
        prettyHtml: true,
      });
      basePretty = prettyVariant.html;
    }

    let localized = baseCompact;
    if (!idx.size) {
      // No translations for this locale: keep placeholders/keys as-is, but still emit the locale output.
      console.warn(`[build] locale '${locale}': no JSON found; emitting HTML with keys/placeholders`);
    }
    try {
      localized = localizeHtmlPlaceholders(localized, idx, { failOnMissing: argv.failOnMissing, wrapWithBdi: isRtlLocaleCode(locale) });
    } catch (e) {
      die(`Localization failed for locale '${locale}': ${e.message || e}`);
    }
    if (!argv.failOnMissing) {
      const unresolved = findUnresolvedLocalizationTokens(localized);
      if (unresolved.length) {
        console.warn(
          `[build] WARN locale '${locale}': ${unresolved.length} unresolved localization placeholder(s): ${formatTokenPreview(unresolved)}. ` +
          `This locale is missing namespace/key data; RTL changes direction only and cannot translate it.`
        );
      }
    }
    const localeDir = path.join(distRoot, locale);
    await fs.ensureDir(localeDir);
    let localizedPretty = basePretty;
    if (argv.pretty && localizedPretty) {
      try {
        localizedPretty = localizeHtmlPlaceholders(localizedPretty, idx, { failOnMissing: argv.failOnMissing, wrapWithBdi: isRtlLocaleCode(locale) });
      } catch (e) {
        die(`Localization failed for locale '${locale}': ${e.message || e}`);
      }
    }

    if (isRtlLocaleCode(locale)) {
      try { localized = applyRtlToHtml(localized, { mode: rtlMode }); } catch (e) { console.warn(`[build] RTL apply failed for '${locale}': ${e.message || e}`); }
      if (localizedPretty) {
        try { localizedPretty = applyRtlToHtml(localizedPretty, { mode: rtlMode }); } catch {}
      }
    }
    await writeHtmlPair(localeDir, localized, localizedPretty, { emitPretty: argv.pretty });
  }

  console.log(`[build] OK: ${category}/mail-${mail}`);
  console.log(`[build] Dist: ${path.relative(projectRoot, distRoot)}`);
}

main().catch((e) => die(e.stack || String(e)));
