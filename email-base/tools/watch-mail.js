#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * watch-mail.js — file watcher that rebuilds a single mail on source change.
 *
 * Wraps build-mail.js: takes the same --category / --mail / --locales args,
 * does an initial build, then watches the mail's app/{templates,styles}
 * directories + shared vendor styles. On change → debounced rebuild.
 *
 * Usage:
 *   node email-base/tools/watch-mail.js --category X_new --mail QCM-Offer
 *   node email-base/tools/watch-mail.js -c X_new -m QCM-Offer --locales=ar,ur,en --pretty
 *
 * Or via npm script (root):
 *   npm run watch:mail -- --category X_new --mail QCM-Offer
 */

'use strict';

const path = require('path');
const { spawn } = require('child_process');
const chokidar = require('chokidar');
const minimist = require('minimist');

const argv = minimist(process.argv.slice(2), {
  alias: { c: 'category', m: 'mail', l: 'locales' },
  default: { debounce: 250 },
});

if (!argv.category || !argv.mail) {
  console.error('[watch] required: --category <CAT> --mail <NAME>');
  console.error('[watch] example: --category X_new --mail QCM-Offer --locales=ar,ur,en');
  process.exit(1);
}

const projectRoot = process.cwd();
const buildScript = path.join(__dirname, 'build-mail.js');
const mailRoot = path.join(projectRoot, 'email-base', argv.category, `mail-${argv.mail}`);
const watchPaths = [
  path.join(mailRoot, 'app'),
  path.join(projectRoot, 'email-base', 'vendor', 'styles'),
  path.join(projectRoot, 'email-base', 'vendor', 'helpers'),
];

function forwardedBuildArgs() {
  // Pass through all flags except watch-only knobs.
  const out = [];
  for (const [k, v] of Object.entries(argv)) {
    if (k === '_' || k === 'debounce') continue;
    if (k === 'category' || k === 'c') { out.push('--category', String(v)); continue; }
    if (k === 'mail' || k === 'm') { out.push('--mail', String(v)); continue; }
    if (k === 'locales' || k === 'l') { out.push('--locales', String(v)); continue; }
    if (typeof v === 'boolean') {
      if (v) out.push(`--${k}`); else out.push(`--no-${k}`);
    } else {
      out.push(`--${k}`, String(v));
    }
  }
  return out;
}

let busy = false;
let queued = false;
let queueReason = '';

function runBuild(reason) {
  if (busy) {
    queued = true;
    queueReason = reason;
    return;
  }
  busy = true;
  const args = forwardedBuildArgs();
  const startedAt = Date.now();
  console.log(`\n[watch] build start (${reason})`);
  const child = spawn(process.execPath, [buildScript, ...args], {
    stdio: 'inherit',
    cwd: projectRoot,
  });
  child.on('exit', (code) => {
    const ms = Date.now() - startedAt;
    if (code === 0) {
      console.log(`[watch] build ok in ${ms}ms`);
    } else {
      console.error(`[watch] build FAILED (exit ${code}) in ${ms}ms`);
    }
    busy = false;
    if (queued) {
      queued = false;
      const r = queueReason || 'queued';
      queueReason = '';
      runBuild(r);
    }
  });
}

let debounceTimer = null;
function scheduleBuild(reason) {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    runBuild(reason);
  }, Number(argv.debounce) || 250);
}

console.log('[watch] watching:');
for (const p of watchPaths) console.log('  -', path.relative(projectRoot, p));
console.log(`[watch] mail: ${argv.category}/mail-${argv.mail}`);
console.log(`[watch] debounce: ${argv.debounce}ms`);
console.log('[watch] Ctrl+C to stop.\n');

const watcher = chokidar.watch(watchPaths, {
  ignored: /(^|[/\\])\.|node_modules/,
  ignoreInitial: true,
  awaitWriteFinish: { stabilityThreshold: 80, pollInterval: 30 },
});

watcher.on('all', (event, filePath) => {
  const rel = path.relative(projectRoot, filePath);
  scheduleBuild(`${event} ${rel}`);
});

// Initial build so the first changed file isn't the trigger.
runBuild('initial');

process.on('SIGINT', () => {
  console.log('\n[watch] stopping…');
  watcher.close().finally(() => process.exit(0));
});
