// Preview click -> exact source element, exercised in a real Chromium.
// Uses the same preview script and parent helpers as public/workbench.js.
// Requires a Playwright Chromium (npx playwright-core install --only-shell chromium);
// without it the test reports SKIP instead of failing.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright-core';

const wb = fs.readFileSync(new URL('../public/workbench.js', import.meta.url), 'utf8');
const matcher = fs.readFileSync(new URL('../public/click-to-source.js', import.meta.url), 'utf8');
const helpers = wb.slice(
  wb.indexOf('// Visual feedback is drawn in the parent page'),
  wb.indexOf('// ─── end preview pick ───'),
);
assert.ok(helpers.includes('__retkitPreviewPick'), 'workbench.js must define window.__retkitPreviewPick');
const cs = wb.indexOf('const clickScript = `');
const clickScript = eval('`' + wb.slice(cs + 'const clickScript = `'.length, wb.indexOf('`;', cs)) + '`');
assert.ok(clickScript.includes('__retkitPreviewPick'), 'preview script must call the precise matcher first');

const html = `<!DOCTYPE html><html><body>
<table><tr><td><img alt="Hero" src="https://img.example/hero.png" width="300" height="80"></td></tr>
<tr><td><a href="https://example.com/go"><img id="b1" src="https://img.example/btn.png" width="100" height="40"></a></td>
<td><a href="https://example.com/go"><img id="b2" src="https://img.example/btn.png" width="100" height="40"></a></td></tr></table>
<p id="r1">Repeat me</p><p id="r2">Repeat me</p>
<table><tr><td style="background-image:url('https://img.example/bg.png');width:200px;height:60px" id="bg">&nbsp;</td></tr></table>
</body></html>`;
const nth = (needle, n) => { let i = -1; for (let k = 0; k <= n; k += 1) i = html.indexOf(needle, i + 1); return i; };

let browser;
try {
  browser = await chromium.launch({ headless: true });
} catch (error) {
  console.log(`SKIP test-preview-click-to-source: no Playwright Chromium (${String(error.message).split('\n')[0]})`);
  process.exit(0);
}
try {
  const page = await browser.newPage();
  await page.route('**/*', (route) => (route.request().url().startsWith('http') ? route.fulfill({ status: 204, body: '' }) : route.continue()));
  await page.setContent('<html><body><iframe id="previewFrame" style="width:700px;height:700px"></iframe></body></html>');
  await page.addScriptTag({ content: matcher });
  await page.evaluate(({ helpers, code }) => {
    window.state = { srcCtx: null };
    window.r = { previewFrame: document.getElementById('previewFrame') };
    window.cm = { getValue: () => code, posFromIndex: (i) => i };
    window.getActiveCm = () => window.cm;
    window.cmHighlight = (from, to) => { window.__sel = [from, to]; };
    (0, eval)(helpers);
  }, { helpers, code: html });
  await page.evaluate((doc) => {
    const d = document.getElementById('previewFrame').contentDocument;
    d.open(); d.write(doc); d.close();
  }, html.replace('</body>', `${clickScript}</body>`));
  const frame = page.frames()[1];
  const pick = async (selector) => {
    await page.evaluate(() => { window.__sel = null; });
    await frame.click(selector);
    return page.evaluate(() => window.__sel);
  };

  assert.deepEqual(await pick('img[alt="Hero"]'), [nth('https://img.example/hero.png', 0), nth('https://img.example/hero.png', 0) + 28], 'image click selects its src');
  assert.equal((await pick('#b2'))[0], nth('https://img.example/btn.png', 1), 'second identical image selects the second src');
  assert.equal((await pick('#b1'))[0], nth('https://img.example/btn.png', 0), 'first identical image selects the first src');
  assert.equal((await pick('#r2'))[0], nth('Repeat me', 1), 'second identical paragraph selects the second copy');
  assert.equal((await pick('#bg'))[0], nth('https://img.example/bg.png', 0), 'background cell selects its url');

  // Pug source mode: literal src / copy occurrences.
  const pug = "table\n  tr\n    td\n      img(src='https://img.example/hero.png' alt='Hero')\np#r1 Repeat me\np#r2 Repeat me\n";
  await page.evaluate((code) => { window.state.srcCtx = { viewingCompiledHtml: false }; window.cm.getValue = () => code; }, pug);
  assert.equal((await pick('img[alt="Hero"]'))[0], pug.indexOf('https://img.example/hero.png'), 'pug: image -> src literal');
  assert.equal((await pick('#r2'))[0], pug.lastIndexOf('Repeat me'), 'pug: second paragraph -> second copy');

  const untouched = await frame.evaluate(() => !document.documentElement.outerHTML.includes('outline'));
  assert.ok(untouched, 'preview DOM must not be modified (PDF export / pencil read it)');
  console.log('✓ preview click -> exact source element (html + pug)');
} finally {
  await browser.close();
}
