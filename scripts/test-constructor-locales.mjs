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
assert.equal(plain(C.localizeBlocks(blocks, 'original', kindOf))[0].slots.title, '${{ promo.block_00 }}$', 'Original shows the placeholders themselves');
assert.equal(plain(C.localizeBlocks(blocks, 'en', kindOf))[0].slots.title, 'Hello!', 'EN tab shows the reference text');
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
assert.ok(js.includes('applyConstructorRtl(data.html, previewLocale)'), 'ar/ur preview is RTL');
assert.ok(js.includes('locales: constructorLocalesForAgent()'), 'the agent sees the locales in read_canvas');
assert.ok(/\nmountConstructorLocales\(\);\n/.test(js), 'locales mounted');
assert.ok(/\nmountInspectorToggle\(\);\n/.test(js), 'inspector panel toggles');
// Like the Code tab: ✎ editor per locale, block_NN chips copy the placeholder and arm the next one,
// hover a text in the email + ⌘V/Ctrl+V pastes the clipboard into that slot.
for (const fn of ['openEditor', 'copyPlaceholder', 'afterPaste']) assert.equal(typeof C[fn], 'function', fn);
assert.ok(js.includes('doc.addEventListener("paste", onHoverPaste, true);') && js.includes('document.addEventListener("paste", onHoverPaste, true);'), 'hover paste in the preview and in the studio');
assert.ok(js.includes('api?.afterPaste(text);'), 'next placeholder after a paste');
// Click on a text selects the TEXT (own bar), not only the block; in a locale tab it edits that locale's string.
assert.ok(js.includes('if (hit) openTextBar(hit, el);'), 'text-level selection');
assert.ok(js.includes('return api.setLocaleString(target.locale, target.index, text);'), 'locale tab edits the locale string');
assert.equal(C.tokenIndex('${{ promo.block_02 }}$'), 2);
assert.equal(C.tokenIndex('Hi ${{ promo.block_02 }}$'), -1, 'mixed text is not a single binding');
assert.equal(C.setLocaleString('fr', 1, 'Votre code est @@prêt@@ !'), true);
assert.equal(C.resolveText('${{ promo.block_01 }}$', 'fr'), 'Votre code est prêt !');
{
  const writes = [];
  sandbox.navigator = { clipboard: { writeText: async (t) => { writes.push(t); } } };
  assert.equal(await C.copyPlaceholder(0), true);
  await C.afterPaste('${{ promo.block_00 }}$');
  assert.deepEqual(writes, ['${{ promo.block_00 }}$', '${{ promo.block_01 }}$'], 'block_01 goes to the clipboard after block_00 was pasted');
  await C.afterPaste('some other text');
  await C.afterPaste('${{ promo.block_01 }}$');
  assert.equal(writes.length, 2, 'a different paste disarms');
}
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
// Editor highlight: pairs blue, broken red (like the Code tab).
{
  const h = C.highlightTxt('{{Hello @@world@@}}\n\n{{broken @@bold}}\n\n{{not closed');
  assert.ok(h.includes('<span class="hl-ok">{{</span>Hello <span class="hl-at">@@</span><span class="hl-bold">world</span><span class="hl-at">@@</span><span class="hl-ok">}}</span>'), h);
  assert.ok(h.includes('broken <span class="hl-bad">@@</span>bold'), 'odd @@ is red');
  assert.ok(h.includes('<span class="hl-bad">{{</span>not closed'), 'unclosed {{ is red');
  assert.ok(C.highlightTxt('a }} b').includes('<span class="hl-bad">}}</span>'), 'stray }} is red');
  assert.ok(C.highlightTxt('<b>').includes('&lt;b&gt;'), 'text is escaped');
}
// Add by hand: a locale starts as a copy of the reference; a new line goes to every locale.
{
  sandbox.prompt = () => 'de';
  C.addLocale();
  assert.deepEqual(plain(C.data.locales.de), plain(C.data.locales.en), 'DE starts as a copy of EN');
  assert.ok(C.lint.issues.some((x) => x.locale === 'de' && x.code === 'untranslated'), 'copy shows up as untranslated until translated');
  sandbox.prompt = () => 'Brand new line';
  await C.addString();
  assert.equal(C.data.locales.en.at(-1), 'Brand new line');
  assert.equal(C.data.locales.fr.at(-1), '', 'other locales get an empty line — flagged');
  assert.ok(C.lint.issues.some((x) => x.locale === 'fr' && x.code === 'empty'));
  sandbox.prompt = () => 'x1';
  C.addLocale();
  assert.ok(!C.data.locales.x1, 'not a locale code — refused');
  // Issues are marked on their block in the editor.
  const marked = C.highlightTxt('{{ok}}\n\n{{bad}}', new Map([[1, 'error']]));
  assert.ok(marked.includes('<span class="hl-issue-error">bad</span>'), marked);
}
// «→ В код» carries the locales into the Code tab's storage for that very mail.
assert.ok(js.includes('handOffLocalesToCode(brand, mid);\n      window.location.href = "/workbench?brand="'), 'handoff before navigation');
{
  const wb = fs.readFileSync(new URL('../public/workbench.js', import.meta.url), 'utf8');
  assert.ok(wb.includes("const LS_NAMESPACES_SCOPE_PREFIX = 'wb-namespaces:';"), 'Code tab still reads wb-namespaces:<brand>/<mail>');
  assert.ok(wb.includes('`${LS_NAMESPACES_SCOPE_PREFIX}${encodeURIComponent(safeBrand)}/${encodeURIComponent(safeMail)}`'), 'same key format');
  const fnSrc = js.slice(js.indexOf('function handOffLocalesToCode'), js.indexOf('/* ─── Арабизация'));
  const store2 = new Map();
  const ctx = { console, JSON, Math, Date, Object, Array, localStorage: { getItem: (k) => store2.get(k) ?? null, setItem: (k, v) => store2.set(k, v) }, window: { RetKitConstructorLocales: C } };
  vm.createContext(ctx);
  vm.runInContext(fnSrc + '\nthis.ok = handOffLocalesToCode("X_preview", "mail-test-abc");', ctx);
  assert.equal(ctx.ok, true);
  const saved = JSON.parse(store2.get('wb-namespaces:X_preview/mail-test-abc'));
  assert.equal(saved[0].name, 'promo');
  assert.equal(saved[0].referenceLocale, 'en');
  assert.deepEqual(Object.keys(saved[0].locales).sort(), Object.keys(C.data.locales).sort());
  assert.ok(saved[0].localeRaw.fr.startsWith('{{Bonjour'), 'TXT for the Code editor');
}
// Arabization in the constructor: ar/ur tabs always RTL, ⇄ RTL forces it for the rest; ZIP follows the same rule.
{
  assert.ok(js.includes('const localeHtml = applyConstructorRtl(data.html, previewLocale);'), 'preview goes through the RTL rule');
  assert.ok(js.includes('applyRtl: applyConstructorRtl,'), 'ZIP uses the same rule');
  assert.ok(/\nmountRtlToggle\(\);\n/.test(js), '⇄ RTL button mounted');
  const fnSrc = js.slice(js.indexOf('const RTL_FORCE_KEY'), js.indexOf('function paintRtlToggle'));
  const calls = [];
  const ctx = { localStorage: { getItem: () => 'off', setItem() {} }, window: { RetKitRtlCore: { applyRtl: (h, o) => { calls.push(o); return `<!-- retkit-rtl:v2:x -->${h}`; } } }, String };
  vm.createContext(ctx);
  vm.runInContext(fnSrc + '\nthis.api = { applyConstructorRtl, constructorRtlLang, force: (v) => { _forceRtl = v; } };', ctx);
  assert.equal(ctx.api.constructorRtlLang('ar_KW'), 'ar');
  assert.equal(ctx.api.constructorRtlLang('fr'), '');
  assert.equal(ctx.api.applyConstructorRtl('<p>x</p>', 'fr'), '<p>x</p>', 'fr stays LTR');
  ctx.api.force(true);
  assert.equal(ctx.api.constructorRtlLang('original'), 'ar', 'forced RTL for Original');
  const once = ctx.api.applyConstructorRtl('<p>x</p>', 'ur');
  assert.equal(calls.at(-1).lang, 'ur');
  assert.equal(ctx.api.applyConstructorRtl(once, 'ur'), once, 'already arabized — not again');
}
// «игнор»: hide one case in every locale of the set (same list as the Code tab).
{
  const before = C.lint.issues.length;
  const key = JSON.parse(JSON.stringify(C.lint.issues))[0].key;
  C.setIgnored([key]);
  assert.ok(C.lint.issues.length < before && C.lint.ignored >= 1, 'ignored case disappears');
  assert.ok(store.get('retkit-lint-ignore:ns:promo').includes(key), 'stored per set');
  C.setIgnored([]);
  assert.equal(C.lint.issues.length, before, 'Показать скрытые brings it back');
}
// Письмо без локалей: ZIP одной локали, язык угадывается по тексту.
{
  assert.equal(C.guessLocale('Здравствуйте! Ваш код подтверждения ниже, никому его не сообщайте.'), 'ru');
  assert.equal(C.guessLocale('Hello! Your confirmation code is below, please do not share it with anyone.'), 'en');
  assert.equal(C.guessLocale('ок'), '', 'too short — no guess');
  const src = fs.readFileSync(new URL('../public/constructor-locales.js', import.meta.url), 'utf8');
  assert.ok(src.includes('data-act="zip-single"'), 'single-locale ZIP button without a set');
  const cjs = fs.readFileSync(new URL('../public/constructor.js', import.meta.url), 'utf8');
  assert.ok(cjs.includes('canvasText: () =>'), 'host gives canvas text for the guess');
  assert.ok(/if \(!data\) return !locale \|\| locale === "original" \? "en" : locale;/.test(cjs), 'build uses chosen locale without a set');
}
// Мост в UCC: тема из txt, кнопка «→ UCC», RetKitStudioExport в конструкторе.
{
  assert.equal(C.subjectFromTxt('Assunto: Seu contrato foi rescindido\nPreheader: {{x}}\n{{a}}'), 'Seu contrato foi rescindido');
  assert.equal(C.subjectFromTxt('{{a}}'), '');
  const src = fs.readFileSync(new URL('../public/constructor-locales.js', import.meta.url), 'utf8');
  assert.equal((src.match(/data-act="to-ucc" id="toUccBtn"/g) || []).length, 2, 'кнопка «→ UCC» и с набором, и без');
  assert.ok(src.includes('data = { name, ref, locales, order, subjects,'), 'темы локалей сохраняются при загрузке папки');
  const cjs = fs.readFileSync(new URL('../public/constructor.js', import.meta.url), 'utf8');
  assert.ok(cjs.includes('window.RetKitStudioExport = {') && cjs.includes('exposeConstructorToUcc();'), 'конструктор отдаёт локали мосту');
  assert.ok(cjs.includes('applyConstructorRtl(await buildLocaleHtml(code), code)'), 'HTML как в ZIP: читаемый + RTL');
}
// Прехедер: строка «Preheader: {{…}}» в txt → номер блока; поле в шапке; автопривязка.
{
  assert.equal(C.preheaderIndexFromTxt('Assunto: X\nPreheader: {{Retire}}\n\n{{Rescisão}}'), 0);
  assert.equal(C.preheaderIndexFromTxt('{{A}}\n{{B}}\nPreheader: {{C}}'), 2);
  assert.equal(C.preheaderIndexFromTxt('Subject: X\n{{A}}'), -1);
  const html = fs.readFileSync(new URL('../public/constructor.html', import.meta.url), 'utf8');
  assert.ok(html.includes('id="preheaderInput"'), 'поле «прехедер» в шапке');
  const cjs = fs.readFileSync(new URL('../public/constructor.js', import.meta.url), 'utf8');
  assert.ok(cjs.includes('onImported: (data) =>') && cjs.includes('setPreheader(api.token(data.preheaderBlock))'), 'автопривязка прехедера при загрузке папки');
  assert.ok(cjs.includes('markEntrySlotExplicit(entry, "preheader")'), 'прехедер — явный слот обёртки');
}
console.log('✓ constructor locales: folder import, auto-bind, per-locale preview/ZIP texts, picker, lint, wiring');
