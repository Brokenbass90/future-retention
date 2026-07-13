import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../public/workbench.js", import.meta.url), "utf8");
const html = await readFile(new URL("../public/workbench.html", import.meta.url), "utf8");
const css = await readFile(new URL("../public/workbench.css", import.meta.url), "utf8");

function functionSource(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} must exist`);
  const signatureEnd = source.indexOf("\n", start);
  const brace = source.lastIndexOf("{", signatureEnd);
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let i = brace; i < source.length; i += 1) {
    const char = source[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`Cannot extract ${name}`);
}

const openSource = functionSource("openSourceContext");
assert.match(openSource, /options\.initialView === 'pug'/, "constructor handoff must request Pug");
assert.match(openSource, /await loadSourceFile\(headerPug\.path\)/, "header.pug must load before background HTML");

const restore = functionSource("restoreUiFromState");
assert.match(restore, /options\.skipWorkspace/, "direct handoff must skip saved workspace state");
assert.match(source, /restoreUiFromState\(\{ skipWorkspace: Boolean\(getDirectMailHandoff\(\)\) \}\)/);
assert.match(source, /loadEmailFromBase\(handoff\.brand, handoff\.mail, null, \{ initialView: 'pug' \}\)/);
assert.doesNotMatch(source, /setTimeout\(\(\) => \{ loadEmailFromBase\(brand, mail, null, \{ initialView: 'pug' \}\)/,
  "constructor handoff must not wait behind a restored HTML tab");

const saveSource = functionSource("saveCurrentSourceFile");
assert.match(saveSource, /const buildPromise = rebuildSourceEmail/);
assert.match(saveSource, /if \(options\.awaitBuild\)/, "only an explicit HTML switch should await compilation");
assert.ok(
  saveSource.indexOf("r.saveSourceBtn.disabled = false") < saveSource.indexOf("const buildPromise = rebuildSourceEmail"),
  "save controls must be released before background compilation starts",
);

const performBuild = functionSource("performSourceEmailBuild");
assert.match(performBuild, /namespaces: state\.namespaces/, "build must receive the current locale namespaces");
assert.match(performBuild, /wasViewingHtml && !ctx\.htmlEditMode/,
  "background build must not replace an HTML override draft in the editor");
assert.match(performBuild, /ctx\.htmlEditMode \|\| ctx\.htmlOperation/,
  "background build must not race an override save or reset request");
assert.match(functionSource("rebuildSourceEmail"), /while \(_sourceBuildRequested\)/,
  "edits received during a build must queue another serialized build");
assert.match(functionSource("showCompiledHtml"), /canShowLastSuccessful/,
  "the last successful HTML must remain available during a background build");

const activateLocale = functionSource("activateLocale");
const sourceLocaleBridge = functionSource("syncSourcePreviewToLocale");
assert.match(activateLocale, /syncSourcePreviewToLocale\(code, prev\)/,
  "top locale tabs must drive source-context compiled preview locales");
assert.match(sourceLocaleBridge, /code === 'original' \? HTML_BASE_LOCALE/,
  "Original top tab must map to the base compiled HTML");
assert.match(sourceLocaleBridge, /saveCurrentSourceFile\(null, \{ awaitBuild: true \}\)/,
  "a dirty Pug/Stylus revision must be saved and built before locale HTML is read");
assert.match(sourceLocaleBridge, /ctx\.compiledHtmlByLocale\?\.\[htmlLocale\]/,
  "locale switching must use a per-locale last-successful cache");
assert.match(sourceLocaleBridge, /\/api\/wb\/code-html\?brand=/,
  "top locale tabs must read the selected built HTML locale");
assert.match(sourceLocaleBridge, /ctx\.viewingCompiledHtml/,
  "the bridge must distinguish preview-only Pug mode from the HTML editor");
assert.match(functionSource("applyCompiledHtmlToEditor"), /setActiveLocaleUi/,
  "HTML selector and top locale tabs must stay synchronized");

assert.match(source, /compiledViewEditHtmlBtn\?\.addEventListener\('click'/);
assert.match(source, /cm\?\.setOption\('readOnly', false\)/, "HTML edit mode must unlock CodeMirror");
assert.match(source, /fetch\('\/api\/wb\/code-html', \{/);
assert.match(source, /fetch\('\/api\/wb\/code-html\/reset', \{/);
assert.match(html, /id="compiledViewEditHtmlBtn"/);
assert.match(html, /id="compiledViewSaveHtmlBtn"/);
assert.match(html, /id="compiledViewResetHtmlBtn"/);
assert.match(css, /\.compiled-view-edit-html\s*\{[\s\S]*background:/,
  "HTML edit action must look enabled and clickable");

assert.match(source, /unresolvedCount/);
assert.match(html, /id="compiledLocalizationStatus"/);

console.log("✓ workbench code flow: Pug handoff, background build queue, HTML detach/reset UX");
