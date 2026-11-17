// Locales in the constructor: load a folder, bind slot texts to locale lines,
// preview / ZIP every locale — without the Code tab.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const store = new Map();
const sandbox = {
  console,
  localStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
for (const f of ['locale-lint-data.js', 'locale-lint.js', 'constructor-locales.js']) {
  vm.runInContext(fs.readFileSync(new URL(`../public/${f}`, import.meta.url), 'utf8'), sandbox);
}
const C = sandbox.RetKitConstructorLocales;
const plain = (v) => JSON.parse(JSON.stringify(v));

// File names and formats — the same as the Code tab.
assert.equal(C._localeCodeOf('10651_TR_TR_APPROVED.txt'), 'tr');
assert.equal(C._localeCodeOf('en_US.txt'), 'en');
assert.equal(C._localeCodeOf('fr.txt'), 'fr');
assert.deepEqual(plain(C._parseLocale('Subject: Hi\n{{ Hello! }}\n\n{{Your code is @@ready@@}}', 'en.txt')), ['Hello!', 'Your code is @@ready@@']);
assert.deepEqual(plain(C._parseLocale('{"block_00":"Hello!","block_01":"Bye"}', 'en.json')), ['Hello!', 'Bye']);

// Import a folder (File-like objects).
const file = (path, text) => ({ name: path.split('/').pop(), webkitRelativePath: path, text: async () => text });
const toasts = [];
C.mount({ toast: (t) => toasts.push(t), onChange: () => {} });
await C.importFiles([
  file('promo/en.txt', '{{Hello!}}\n{{Your code is @@ready@@}}\n{{Unsubscribe}}'),
  file('promo/fr.txt', '{{Bonjour !}}\n{{Votre code est @@prêt@@}}\n{{Se désabonner}}'),
  file('promo/ar.txt', '{{مرحبا!}}\n{{رمزك @@جاهز@@}}\n{{إلغاء الاشتراك}}'),
]);
assert.equal(C.data.name, 'promo');
assert.equal(C.data.ref, 'en');
assert.deepEqual(plain(C.data.order), ['en', 'ar', 'fr']);
assert.ok(store.has('retkit-constructor-locales-v1'), 'kept in this browser');

// Auto-bind: a slot text equal to an EN line becomes its placeholder.
assert.equal(C.autoBindValue('Your code is ready'), '${{ promo.block_01 }}$');
assert.equal(C.autoBindValue('Something else'), null);
assert.equal(C.autoBindValue('${{ promo.block_00 }}$'), null, 'already bound');

// Preview / ZIP: placeholders resolve per locale; richText keeps bold.
const blocks = [{ uid: 'a', slots: { title: '${{ promo.block_00 }}$', body: '${{ promo.block_01 }}$', color: '#fff' } }];
const kindOf = (uid, id) => (id === 'body' ? 'richText' : 'text');
assert.deepEqual(plain(C.localizeBlocks(blocks, 'fr', kindOf))[0].slots, { title: 'Bonjour !', body: 'Votre code est <b>prêt</b>', color: '#fff' });
assert.equal(plain(C.localizeBlocks(blocks, 'original', kindOf))[0].slots.title, 'Hello!', 'Original shows the reference text');
assert.equal(C.resolveText('${{ other.block_00 }}$', 'fr'), '${{ other.block_00 }}$', 'foreign namespaces untouched');

// Binding stats and the inspector picker.
const stats = C.bindingStats([
  { value: '${{ promo.block_00 }}$', kind: 'text', group: 'content' },
  { value: 'Plain text', kind: 'richtext', group: 'content' },
  { value: '16px', kind: 'text', group: 'appearance' },
]);
assert.deepEqual(plain(stats), { bound: 1, plain: 1 });
const picker = C.slotPickerHtml('title', '${{ promo.block_01 }}$', 'text');
assert.ok(picker.includes('data-locale-bind-for="title"') && picker.includes('<option value="1" selected>'), picker);
assert.equal(C.slotPickerHtml('img', 'x', 'image'), '', 'images have no locale picker');
assert.equal(C.valueForPick('2'), '${{ promo.block_02 }}$');
assert.equal(C.valueForPick('', '${{ promo.block_00 }}$'), 'Hello!', 'unbinding keeps the reference text');

// The shared locale check runs on load.
assert.ok(C.lint?.ok && /fr ✓/.test(C.lint.summary) && /ar ✓/.test(C.lint.summary), C.lint?.summary);

// Constructor wiring.
const js = fs.readFileSync(new URL('../public/constructor.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../public/constructor.html', import.meta.url), 'utf8');
for (const src of ['/locale-lint-data.js', '/locale-lint.js', '/rtl-core.js', '/constructor-locales.js']) {
  assert.ok(html.indexOf(src) > 0 && html.indexOf(src) < html.indexOf('/constructor.js"'), `${src} before constructor.js`);
}
assert.ok(js.includes('localizeCanvasBlocks(canvasToBlocks({ allowLocalAssets: true }), previewLocale)'), 'preview builds the chosen locale');
assert.ok(js.includes('RetKitConstructorLocales.applyRtl(data.html, previewLocale)'), 'ar/ur preview is RTL');
assert.ok(js.includes('locales: constructorLocalesForAgent()'), 'the agent sees the locales in read_canvas');
assert.ok(/\nmountConstructorLocales\(\);\n/.test(js), 'locales mounted');
assert.ok(js.trimEnd().endsWith('mountInspectorToggle();'), 'inspector panel toggles');
assert.ok(js.includes('locale: constructorBuildLocale(previewLocale)'), 'preview builds the locale (footer from vendor/data)');
assert.ok(js.includes('export: true'), 'ZIP asks for readable HTML');
assert.ok(typeof C.toggleStrings === 'function', 'strings panel copies placeholders');

// Server: preview/ZIP build the asked locale; ZIP is pretty and without canvas markers.
const server = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
assert.ok(server.includes('const previewLocale = resolveVendorLocale(body?.locale);'));
assert.ok(server.includes('markBlocks: !exportMode'));
assert.ok(server.includes('exportMode && existsSync(prettyHtml) ? prettyHtml : distHtml'));
const { constructorBuildMailArgs } = await import('../src/constructor-build-policy.js');
assert.deepEqual(constructorBuildMailArgs({ brand: 'X_preview', mailName: 'm', preview: true, locale: 'fr', pretty: true }).slice(-3), ['--locales', 'fr', '--pretty']);
assert.deepEqual(constructorBuildMailArgs({ brand: 'X_preview', mailName: 'm', preview: true, locale: '../x' }).slice(-2), ['--locales', 'en']);
const { createPreviewBuildKey } = await import('../src/preview-build-coordinator.js');
assert.notEqual(createPreviewBuildKey({ blocks: [1], locale: 'fr' }), createPreviewBuildKey({ blocks: [1] }), 'locale is part of the cache key');
assert.equal(createPreviewBuildKey({ blocks: [1], locale: 'en' }), createPreviewBuildKey({ blocks: [1] }), 'en keeps old cache keys');
console.log('✓ constructor locales: folder import, auto-bind, per-locale preview/ZIP texts, picker, lint, wiring');
