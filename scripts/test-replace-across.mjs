// Replace across the whole email (code + all locales), pure logic.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const sandbox = {};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(new URL('../public/replace-across.js', import.meta.url), 'utf8'), sandbox);
const RA = sandbox.RetKitReplaceAcross;
const plain = (v) => JSON.parse(JSON.stringify(v));

// Entity-aware: & and &amp; are the same link; replacement keeps the encoding.
assert.equal(RA.countIn('<a href="https://x.com/?a=1&amp;b=2">', 'https://x.com/?a=1&b=2'), 1);
assert.equal(RA.replaceIn('<a href="https://x.com/?a=1&amp;b=2">', 'https://x.com/?a=1&b=2', 'https://y.com/?c=3&d=4').value,
  '<a href="https://y.com/?c=3&amp;d=4">');
assert.equal(RA.replaceIn('go to a&b now', 'a&amp;b', 'c&d').value, 'go to c&d now');

// Single pass: a replacement containing the needle is not re-matched.
assert.deepEqual(plain(RA.replaceIn('img.png img.png', 'img.png', 'new-img.png')), { value: 'new-img.png new-img.png', count: 2 });

const namespaces = [
  { id: 'n1', name: 'promo', locales: { en: ['Hello', 'Visit https://x.com/a'], ar: ['مرحبا', 'https://x.com/a'], de: ['Hallo', 'nothing'] } },
  { id: 'n2', name: 'footer_upload', builtin: true, locales: { en: ['https://x.com/a terms'] } },
];
const code = '<img src="https://x.com/a"><a href="https://x.com/a">x</a>';
const p = RA.plan({ code, namespaces, find: 'https://x.com/a' });
assert.equal(p.code.count, 2);
assert.deepEqual(plain(p.locales.map((l) => [l.nsName, l.locale, l.count, l.locked])), [
  ['footer_upload', 'en', 1, true], ['promo', 'ar', 1, false], ['promo', 'en', 1, false],
]);
assert.equal(p.total, 5);
assert.equal(p.editableTotal, 4, 'locked namespace is reported but not editable');

const r = RA.apply({ code, namespaces, find: 'https://x.com/a', replacement: 'https://z.com/b', selection: { code: true, locales: ['n1|en', 'n2|en'] } });
assert.equal(r.code, '<img src="https://z.com/b"><a href="https://z.com/b">x</a>');
assert.deepEqual(plain(r.patches), [{ nsId: 'n1', locale: 'en', blocks: ['Hello', 'Visit https://z.com/b'], count: 1 }], 'only selected, never builtin');
assert.deepEqual(plain(r.undo.locales), [{ nsId: 'n1', locale: 'en', blocks: ['Hello', 'Visit https://x.com/a'] }]);
assert.equal(namespaces[0].locales.en[1], 'Visit https://x.com/a', 'apply is pure: input is not mutated');
assert.equal(r.total, 3);

// UI wiring: the workbench loads both files after workbench.js.
// Filename mode: same image uploaded per locale under different paths.
assert.equal(RA.countIn('<img src="https://a.cdn/x1/icon1.png"><img src="https://a.cdn/zz/icon1.png?v=2">', 'icon1.png', { mode: 'filename' }), 2);
assert.equal(RA.scan('<a href="https://x.com/a">', 'https://x.com/a').hits[0].kind, 'link');

// The ⌘F strip exposes the same rules to models.
const ui = fs.readFileSync(new URL('../public/replace-across-ui.js', import.meta.url), 'utf8');
assert.match(ui, /replaceEverywhere/, 'UI exposes replaceEverywhere for models');
assert.match(ui, /insertAdjacentElement\('afterend', strip\)|bar\.insertAdjacentElement\('afterend'/, 'strip lives under the ⌘F find bar');
// Typing searches only the open editor; all locales only from the button.
assert.match(ui, /id="rkRaSearch">Искать во всех локалях/, 'explicit all-locales search button');
assert.match(ui, /\$\('findInput'\)\?\.addEventListener\('input', \(\) => \{ scannedKey = ''; scheduleScan\(\); \}\)/, 'typing drops the all-locales result');
assert.match(ui, /const scanned = scannedKey === queryKey\(\);[\s\S]*?if \(!scanned\) \{[\s\S]*?return;/, 'render does not plan locales until the button');

const html = fs.readFileSync(new URL('../public/workbench.html', import.meta.url), 'utf8');
assert.ok(html.indexOf('/workbench.js') < html.indexOf('/replace-across.js') && html.indexOf('/replace-across.js') < html.indexOf('/replace-across-ui.js'));
console.log('✓ replace across code + locales: entity-aware, locked-safe, undoable');
