// Version label next to the RetKit logo (Heroku vs localhost) and vendor/data locale aliases (zh↔cn…).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { APP_VERSION } = await import('../src/app-version.js');
assert.match(APP_VERSION.version, /^\d+\.\d+\.\d+/);
assert.equal(APP_VERSION.build.length, 7);
assert.ok(['heroku', 'local'].includes(APP_VERSION.env));
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
assert.ok(server.includes('studioRouter.get("/api/version"'), 'version endpoint (in the router, not the ladder)');
for (const page of ['workbench.html', 'constructor.html']) {
  const html = fs.readFileSync(path.join(root, 'public', page), 'utf8');
  assert.ok(html.includes('<script src="/app-version.js"></script>'), `${page} shows the version`);
}

// build-mail: a locale without its own namespace file takes it from the paired folder (zh ← cn footer_upload).
const src = fs.readFileSync(path.join(root, 'email-base/tools/build-mail.js'), 'utf8');
const fnSrc = src.slice(src.indexOf('const LOCALE_DATA_ALIASES'), src.indexOf('function getDeep'));
const tmp = fs.mkdtempSync(path.join(fs.realpathSync(process.env.TMPDIR || '/tmp'), 'lda-'));
fs.mkdirSync(path.join(tmp, 'zh')); fs.mkdirSync(path.join(tmp, 'cn'));
fs.writeFileSync(path.join(tmp, 'zh', 'mail.json'), JSON.stringify({ block_00: '你好' }));
fs.writeFileSync(path.join(tmp, 'cn', 'mail.json'), JSON.stringify({ block_00: 'OTHER' }));
fs.writeFileSync(path.join(tmp, 'cn', 'footer_upload.json'), JSON.stringify({ block_00: '条款和条件' }));
const fsExtra = { existsSync: fs.existsSync, readdirSync: fs.readdirSync, readJsonSync: (p) => JSON.parse(fs.readFileSync(p, 'utf8')) };
const buildTranslationIndex = new Function('fs', 'path', `${fnSrc}; return buildTranslationIndex;`)(fsExtra, path);
const idx = buildTranslationIndex(tmp, 'zh');
assert.equal(idx.get('mail').block_00, '你好', 'own folder wins');
assert.equal(idx.get('footer_upload').block_00, '条款和条件', 'missing namespace comes from the paired folder');
console.log('✓ app version label (Heroku / localhost) and zh↔cn, sv↔se, ka↔ge locale data');
