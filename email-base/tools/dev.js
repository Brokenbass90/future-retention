#!/usr/bin/env node
'use strict';

const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const minimist = require('minimist');
const chokidar = require('chokidar');
const { spawn } = require('child_process');

const argv = minimist(process.argv.slice(2), {
  string: ['category', 'mail', 'host'],
  number: ['port'],
  boolean: ['noOpen', 'noLivereload', 'noMinifyCss'],
  default: {
    host: '127.0.0.1',
    port: 3001,
    noOpen: false,
    noLivereload: false,
    noMinifyCss: false, // dev: minify head by default
  },
});

function die(msg) {
  console.error(msg);
  process.exit(1);
}

const category = argv.category;
const mail = argv.mail;
if (!category || !mail) {
  die('Usage: npm run dev -- --category=X_IQ --mail=rfm-311');
}

const projectRoot = process.cwd();
const mailRoot = path.join(projectRoot, category, `mail-${mail}`);
const vendorRoot = path.join(projectRoot, 'vendor');
const distRoot = path.join(projectRoot, 'dist');

async function listLocalesFromVendor() {
  const dataRoot = path.join(vendorRoot, 'data');
  try {
    const entries = await fsp.readdir(dataRoot, { withFileTypes: true });
    const dirs = entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .filter((name) => /^[A-Za-z]{2}([_-][A-Za-z]{2})?$/.test(name));
    dirs.sort();
    return dirs;
  } catch {
    return [];
  }
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: 'inherit', ...opts });
    p.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited with code ${code}`));
    });
  });
}

async function triggerReload() {
  if (argv.noLivereload) return;
  const url = `http://${argv.host}:${argv.port}/__livereload/trigger`;
  try {
    await fetch(url, { method: 'POST' });
  } catch {}
}

async function build() {
  const args = [
    path.join('tools', 'build-mail.js'),
    '--category', category,
    '--mail', mail,
  ];

  // IMPORTANT: locales are NOT specified => build-mail compiles ALL available locales automatically
  if (argv.noMinifyCss) {
    args.push('--no-minifyCss');
  }

  await run(process.execPath, args, { cwd: projectRoot });
  await triggerReload();
}

async function openBrowser(url) {
  if (argv.noOpen) return;
  const platform = process.platform;
  const cmd = platform === 'darwin' ? 'open' : platform === 'win32' ? 'start' : 'xdg-open';
  try {
    await run(cmd, [url], { shell: true });
  } catch {}
}

async function main() {
  const serveArgs = [
    path.join('tools', 'serve-dist.js'),
    '--dist', distRoot,
    '--host', argv.host,
    '--port', String(argv.port),
    '--preferPretty',
  ];
  if (argv.noLivereload) serveArgs.push('--no-livereload');
  const server = spawn(process.execPath, serveArgs, { stdio: 'inherit', cwd: projectRoot });

  const locales = await listLocalesFromVendor();
  const firstLocale = locales[0] || 'en';

  const urlToOpen = `http://${argv.host}:${argv.port}/${category}/mail-${mail}/${firstLocale}/`;
  console.log(`[dev] Opening: ${urlToOpen}`);

  await build();
  await openBrowser(urlToOpen);

  const watchPaths = [
    path.join(mailRoot, 'app'),
    path.join(vendorRoot, 'helpers'),
    path.join(vendorRoot, 'styles'),
    path.join(vendorRoot, 'data'),
  ];

  const watcher = chokidar.watch(watchPaths, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 120, pollInterval: 50 },
    ignored: (p) => {
      const base = path.basename(p);
      // Noise files that commonly change on macOS/IDEs and can cause rebuild loops.
      if (base.startsWith('.')) return true; // .DS_Store, .idea, etc
      if (base.endsWith('~')) return true;
      if (/\.sw.$/i.test(base) || /\.swo$/i.test(base) || /\.swp$/i.test(base)) return true;
      if (/\.tmp$/i.test(base)) return true;
      return false;
    },
  });

  let busy = false;
  let pending = false;

  async function rebuild() {
    if (busy) {
      pending = true;
      return;
    }
    busy = true;
    try {
      console.log('[dev] Rebuilding...');
      await build();
      console.log('[dev] Done.');
    } catch (e) {
      console.error('[dev] Build failed:', e.message || e);
    } finally {
      busy = false;
      if (pending) {
        pending = false;
        setTimeout(rebuild, 50);
      }
    }
  }

  watcher.on('all', () => rebuild());

  process.on('SIGINT', () => {
    watcher.close();
    server.kill('SIGINT');
    process.exit(0);
  });
}

main().catch((e) => die(e.stack || String(e)));
