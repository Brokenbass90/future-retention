// Model tools: find_across_locales / replace_across_locales (studio agent + MCP).
import assert from 'node:assert/strict';
import { TOOL_DEFINITIONS, TOOL_HANDLERS } from '../src/ai-tools.js';

const names = TOOL_DEFINITIONS.map((t) => t.name);
assert.ok(names.includes('find_across_locales') && names.includes('replace_across_locales'));

const makeCtx = () => ({
  html: '<img src="https://a.cdn/main/icon1.png"><a href="https://x.com/?a=1&amp;b=2">x</a>',
  namespaces: [
    { name: 'promo', namespace: 'promo', locales: { en: ['Hi', '<img src="https://a.cdn/en/icon1.png">'], ar: ['<img src="https://a.cdn/ar/icon1.png?v=2">'] } },
    { name: 'footer_upload', namespace: 'footer_upload', builtin: true, locales: { en: ['https://a.cdn/f/icon1.png'] } },
  ],
  pendingLocaleUpdates: [],
});

let ctx = makeCtx();
const found = await TOOL_HANDLERS.find_across_locales({ query: 'https://a.cdn/main/icon1.png' }, ctx);
assert.equal(found.total, 1);
assert.equal(found.imageModeAvailable, true);
assert.match(found.hint || '', /filename/);
const byName = await TOOL_HANDLERS.find_across_locales({ query: 'icon1.png', mode: 'filename' }, ctx);
assert.equal(byName.total, 4);
assert.equal(byName.editableTotal, 3);
assert.deepEqual(byName.locales.map((l) => [l.namespace, l.locale, l.locked]), [['footer_upload', 'en', true], ['promo', 'ar', false], ['promo', 'en', false]]);

const done = await TOOL_HANDLERS.replace_across_locales({ search: 'icon1.png', replace: 'https://new.cdn/icon1-v2.png', mode: 'filename' }, ctx);
assert.equal(done.replaced, 3);
assert.deepEqual(done.skippedLocked, ['footer_upload|en']);
assert.match(ctx.modifiedHtml, /new\.cdn\/icon1-v2\.png/);
assert.deepEqual(ctx.pendingLocaleUpdates.map((u) => [u.namespace, u.locale]), [['promo', 'en'], ['promo', 'ar']]);
assert.match(ctx.pendingLocaleUpdates[1].txt, /new\.cdn\/icon1-v2\.png/);

// & == &amp; and locale filter
ctx = makeCtx();
const link = await TOOL_HANDLERS.replace_across_locales({ search: 'https://x.com/?a=1&b=2', replace: 'https://y.com/?c=1&d=2', locales: ['ar'] }, ctx);
assert.equal(link.replaced, 1);
assert.match(ctx.modifiedHtml, /https:\/\/y\.com\/\?c=1&amp;d=2/);
assert.equal((await TOOL_HANDLERS.replace_across_locales({ search: 'nope', replace: 'x' }, makeCtx())).error ? 'err' : 'ok', 'err');
// Own value per locale (localized banner)
ctx = makeCtx();
const per = await TOOL_HANDLERS.replace_across_locales({ search: 'icon1.png', replace: 'https://new.cdn/all.png', mode: 'filename', perLocale: { ar: 'https://new.cdn/ar.png' } }, ctx);
assert.equal(per.replaced, 3);
assert.match(ctx.pendingLocaleUpdates.find((u) => u.locale === 'ar').txt, /new\.cdn\/ar\.png/);
assert.match(ctx.pendingLocaleUpdates.find((u) => u.locale === 'en').txt, /new\.cdn\/all\.png/);
console.log('✓ model tools find/replace across locales: filename mode, &amp;, locked-safe, staged');
