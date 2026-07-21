import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../public/workbench.js", import.meta.url), "utf8");
const html = await readFile(new URL("../public/workbench.html", import.meta.url), "utf8");
const css = await readFile(new URL("../public/workbench.css", import.meta.url), "utf8");
const serverSource = await readFile(new URL("../server.js", import.meta.url), "utf8");

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

assert.match(
  serverSource,
  /request\.url\.split\("\?"\)\[0\] === "\/constructor"/,
  "Constructor route must accept the brand/mail query used by the Workbench return button",
);
assert.match(
  source,
  /window\.location\.href = '\/constructor\?brand='[\s\S]*?'&mail='/,
  "Workbench return button must preserve the open source brand and mail",
);
const constructorReturnReason = functionSource("workbenchConstructorReturnBlockReason");
const constructorReturnRequest = functionSource("requestConstructorReturn");
const constructorReturnNavigation = functionSource("navigateBackToConstructor");
assert.match(constructorReturnRequest, /\/api\/constructor\/parse-email\?brand=/,
  "Workbench must preflight the live parse endpoint before leaving the code editor");
assert.match(constructorReturnRequest, /workbenchConstructorReturnBlockReason\(data\)/,
  "Workbench must interpret the server studioModelStale guard");
assert.ok(
  constructorReturnNavigation.indexOf("await requestConstructorReturn") < constructorReturnNavigation.indexOf("window.location.href"),
  "Workbench must finish the stale-model preflight before navigating",
);
assert.match(constructorReturnNavigation, /if \(!availability\.canOpen\)[\s\S]*?toast\(availability\.blockedReason/,
  "a stale model must keep the user in Workbench with an actionable message");
assert.match(constructorReturnNavigation, /catch \(error\)[\s\S]*?Код остаётся открыт в Workbench/,
  "a failed preflight must preserve the code editor instead of navigating blindly");

const constructorReturnSandbox = { result: null, calls: [], encodeURIComponent };
await vm.runInNewContext(`(async () => {
${constructorReturnReason}
const payloads = [
  { ok: true, studioModelStale: true },
  { ok: true, studioModelStale: false },
];
const fetch = async (url) => {
  calls.push(url);
  const payload = payloads.shift();
  return { ok: true, status: 200, json: async () => payload };
};
async ${constructorReturnRequest}
const stale = await requestConstructorReturn('X Brand', 'mail-one');
const fresh = await requestConstructorReturn('X Brand', 'mail-one');
result = { stale, fresh, calls };
})()`, constructorReturnSandbox);
assert.deepEqual(JSON.parse(JSON.stringify(constructorReturnSandbox.result)), {
  stale: {
    canOpen: false,
    blockedReason: "Переход отменён: модель конструктора устарела после правок Pug/Stylus. Код остаётся открыт в Workbench. Чтобы вернуться к drag-and-drop без потери правок, создайте копию письма и откройте её в конструкторе.",
  },
  fresh: { canOpen: true, blockedReason: "" },
  calls: [
    "/api/constructor/parse-email?brand=X%20Brand&mail=mail-one",
    "/api/constructor/parse-email?brand=X%20Brand&mail=mail-one",
  ],
});

const openSource = functionSource("openSourceContext");
assert.match(openSource, /options\.initialView === 'pug'/, "constructor handoff must request Pug");
assert.match(openSource, /await loadSourceFile\(headerPug\.path\)/, "header.pug must load before background HTML");
assert.match(openSource, /switchNamespaceScope\(brand, mail\)/,
  "opening another email must replace, not inherit, locale namespaces");
assert.ok(
  openSource.indexOf("await loadSourceFile(headerPug.path)") < openSource.lastIndexOf("loadCompiledOrBuild();"),
  "Pug must become editable before compile-on-open starts",
);
assert.match(openSource, /repairOpenedSourceNamespaces\(ctx/,
  "opening an older email must repair invalid namespace tokens before its first build");

const repairOpenedSource = functionSource("repairOpenedSourceNamespaces");
assert.match(repairOpenedSource, /repairInvalidNamespaceTokens/,
  "open-time migration must repair invalid placeholders in Pug/Jade source");
assert.match(repairOpenedSource, /persistNamespaceScope/,
  "open-time migration must persist normalized namespace metadata");

const loadSource = functionSource("loadSourceFile");
assert.match(loadSource, /await waitForPrimaryCodeEditor\(\)/,
  "deep-link hydration must wait for CodeMirror before loading source");
assert.match(loadSource, /hydrateSourceEditor\(ctx, filePath, data\.content, loadSequence\)/,
  "the fetched Pug must be applied to the live CodeMirror instance");
assert.match(loadSource, /verifyInitialSourceHydration\(ctx, filePath, data\.content, loadSequence\)/,
  "a late empty startup repaint must be repaired without another user click");
assert.match(source, /window\.WB\.waitForEditableSource/,
  "browser regression checks need an explicit editable-Pug readiness hook");

const restore = functionSource("restoreUiFromState");
assert.match(restore, /options\.skipWorkspace/, "direct handoff must skip saved workspace state");
assert.match(source, /if \(directMailHandoff\) state\.namespaces = \[\]/,
  "direct handoff must clear the previous global namespace state before hydration");
assert.match(source, /restoreUiFromState\(\{ skipWorkspace: Boolean\(directMailHandoff\) \}\)/);
assert.match(source, /loadEmailFromBase\(handoff\.brand, handoff\.mail, null, \{ initialView: 'pug' \}\)/);
assert.doesNotMatch(source, /setTimeout\(\(\) => \{ loadEmailFromBase\(brand, mail, null, \{ initialView: 'pug' \}\)/,
  "constructor handoff must not wait behind a restored HTML tab");

const saveSource = functionSource("saveCurrentSourceFile");
assert.match(saveSource, /const buildPromise = rebuildSourceEmail/);
assert.match(saveSource, /if \(request\.awaitBuild\)/, "only an explicit HTML switch should await compilation");
assert.match(saveSource, /captureEditorRevision\(ctx, 'sourceRevision'/,
  "source save must capture the exact editor revision sent to the server");
assert.match(saveSource, /isEditorRevisionCurrent\(ctx, 'sourceRevision'/,
  "an older source response must not clear a newer dirty buffer");
assert.match(saveSource, /ctx\.sourceSaveRequest = \{/,
  "a newer source buffer must be queued after an in-flight save");
assert.ok(
  saveSource.indexOf("r.saveSourceBtn.disabled = false") < saveSource.indexOf("const buildPromise = rebuildSourceEmail"),
  "save controls must be released before background compilation starts",
);
assert.match(saveSource, /repairInvalidNamespaceTokens/,
  "every Pug save must repair legacy namespace tokens before the server validates them");
assert.match(saveSource, /ensureValidNamespaceNames/,
  "every source save must normalize namespace records used by the following build");

const sourceModifiedHook = functionSource("hookSourceModified");
assert.match(sourceModifiedHook, /markSourceModified\(ctx\)/,
  "the first keystroke must enter the regular autosave pipeline");
assert.doesNotMatch(sourceModifiedHook, /_showBackupModal/,
  "the first keystroke must not interrupt editing with a create-version modal");
const sourceWithoutBackupModalDefinition = source.replace(functionSource("_showBackupModal"), "");
assert.doesNotMatch(sourceWithoutBackupModalDefinition, /_showBackupModal\s*\(/,
  "version-copy UI may remain available explicitly, but no editor path may summon it automatically");

const manualRebuild = functionSource("rebuildCurrentSourceFromUi");
assert.match(manualRebuild, /ctx\.modified/,
  "manual rebuild must detect an unsaved source buffer");
assert.match(manualRebuild, /saveCurrentSourceFile\(null, \{ awaitBuild: true \}\)/,
  "manual rebuild must persist and await the dirty source before reading it on the server");
assert.match(manualRebuild, /rebuildSourceEmail/,
  "manual rebuild must still build immediately when the source is already persisted");
assert.equal(
  (source.match(/addEventListener\('click', \(\) => (?:\{[^{}]*?)?rebuildCurrentSourceFromUi\(\)/g) || []).length,
  2,
  "both the tab-bar and file-menu rebuild actions must use the dirty-source-aware helper",
);

const performBuild = functionSource("performSourceEmailBuild");
assert.match(performBuild, /namespaces: buildNamespacesForContext\(ctx\)/,
  "build must receive only namespaces scoped to the current email");
assert.match(performBuild, /wasViewingHtml && !ctx\.htmlEditMode/,
  "background build must not replace an HTML override draft in the editor");
assert.match(performBuild, /ctx\.htmlEditMode \|\| ctx\.htmlOperation/,
  "background build must not race an override save or reset request");
assert.match(functionSource("rebuildSourceEmail"), /while \(_sourceBuildRequested\)/,
  "edits received during a build must queue another serialized build");
assert.match(functionSource("showCompiledHtml"), /canShowLastSuccessful/,
  "the last successful HTML must remain available during a background build");

const auxiliarySave = functionSource("saveAuxiliarySourceFile");
assert.match(auxiliarySave, /while \(queue\.pending\)/,
  "split/fullscreen source panes must serialize writes per mail/file");
assert.match(auxiliarySave, /if \(!queue\.pending && request\.rebuild/,
  "auxiliary panes must compile only their latest persisted revision");
assert.doesNotMatch(functionSource("saveFullscreenLeftFileIfNeeded"), /fetch\('\/api\/wb\/email-file'/,
  "fullscreen save-on-switch must use the shared auxiliary queue");
assert.doesNotMatch(functionSource("saveFullscreenSplitFileIfNeeded"), /fetch\('\/api\/wb\/email-file'/,
  "fullscreen split save-on-switch must use the shared auxiliary queue");
assert.doesNotMatch(functionSource("initCmSplit"), /fetch\('\/api\/wb\/email-file'/,
  "normal split edits must use the shared auxiliary queue");

const cardBuild = functionSource("buildEmail");
assert.match(cardBuild, /readNamespaceScope\(brand, mail\)/,
  "rebuilding a catalog card must load that mail's namespace scope");
assert.doesNotMatch(cardBuild, /namespaces:\s*state\.namespaces/,
  "rebuilding another mail must not send namespaces from the open editor");

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
assert.match(source, /Отвязать и начать редактирование HTML/,
  "linked compiled HTML must require explicit detach confirmation");
assert.match(source, /fetch\('\/api\/wb\/code-html', \{/);
const saveDetached = functionSource("saveDetachedHtmlRevisions");
assert.match(saveDetached, /captureEditorRevision\(ctx, 'htmlRevision'/,
  "detached HTML save must capture the exact editor revision sent to the server");
assert.match(saveDetached, /isEditorRevisionCurrent\(ctx, 'htmlRevision'/,
  "an older HTML response must not replace newer editor input");
assert.match(saveDetached, /ctx\.htmlSaveRequested = true/,
  "a newer detached HTML buffer must be queued for another save");
assert.match(source, /fetch\('\/api\/wb\/code-html\/reset', \{/);
assert.match(html, /id="compiledViewEditHtmlBtn"/);
assert.match(html, /id="compiledViewSaveHtmlBtn"/);
assert.match(html, /id="compiledViewResetHtmlBtn"/);
assert.match(html, /Удалить override · вернуть Pug/);
assert.match(html, /id="aiPlaceholdersBtn"/,
  "placeholderize must be a visible editor action, not only a hidden chat command");
assert.match(source, /fetch\(sourceMode \? '\/api\/wb\/placeholderize-source'/,
  "Pug placeholder action must use the source-aware endpoint");
assert.match(source, /markSourceModified\(ctx\)/,
  "placeholderized Pug must enter the normal save/build pipeline");
assert.match(css, /\.compiled-view-edit-html\s*\{[\s\S]*background:/,
  "HTML edit action must look enabled and clickable");

assert.match(source, /unresolvedCount/);
assert.match(html, /id="compiledLocalizationStatus"/);

// Executable regression: revision/value must both match before an async save
// response is allowed to clear dirty or replace the editor buffer.
const revisionSandbox = { result: null };
vm.runInNewContext(`
${functionSource("bumpEditorRevision")}
${functionSource("captureEditorRevision")}
${functionSource("isEditorRevisionCurrent")}
const ctx = { sourceRevision: 4 };
const sent = captureEditorRevision(ctx, 'sourceRevision', 'p old');
bumpEditorRevision(ctx, 'sourceRevision');
const staleAfterTyping = isEditorRevisionCurrent(ctx, 'sourceRevision', 'p new', sent);
const latest = captureEditorRevision(ctx, 'sourceRevision', 'p new');
const current = isEditorRevisionCurrent(ctx, 'sourceRevision', 'p new', latest);
const sameRevisionWrongValue = isEditorRevisionCurrent(ctx, 'sourceRevision', 'p newer', latest);
result = { staleAfterTyping, current, sameRevisionWrongValue };
`, revisionSandbox);
assert.deepEqual(
  JSON.parse(JSON.stringify(revisionSandbox.result)),
  { staleAfterTyping: false, current: true, sameRevisionWrongValue: false },
);

// Executable regression for the exact 422 shown by the studio: legacy names
// such as `!TESTEBTVOUMAT` are normalized consistently in metadata and Pug.
const namespaceRepairSandbox = { result: null };
vm.runInNewContext(`
const state = { namespaces: [] };
const WORKBENCH_NAMESPACE_RE = /^[A-Za-z0-9_-]{1,160}$/;
${functionSource("normalizeWorkbenchNamespaceName")}
${functionSource("ensureValidNamespaceNames")}
${functionSource("repairInvalidNamespaceTokens")}
const namespaces = [
  { name: '!TESTEBTVOUMAT' },
  { name: 'bad namespace' },
  { name: 'bad namespace' },
];
const renamed = ensureValidNamespaceNames(namespaces);
result = {
  normalized: normalizeWorkbenchNamespaceName('!TESTEBTVOUMAT'),
  names: namespaces.map(item => item.name),
  renamed: renamed.map(item => item.to),
  repaired: repairInvalidNamespaceTokens(
    '\${{ !TESTEBTVOUMAT.block_01 }}$ / \${{ bad namespace.block_02 }}$ / \${{ valid-name.block_03 }}$'
  ),
};
`, namespaceRepairSandbox);
assert.deepEqual(JSON.parse(JSON.stringify(namespaceRepairSandbox.result)), {
  normalized: "TESTEBTVOUMAT",
  names: ["TESTEBTVOUMAT", "bad-namespace", "bad-namespace-2"],
  renamed: ["TESTEBTVOUMAT", "bad-namespace", "bad-namespace-2"],
  repaired: "${{ TESTEBTVOUMAT.block_01 }}$ / ${{ bad-namespace.block_02 }}$ / ${{ valid-name.block_03 }}$",
});

// Executable regression: clicking rebuild while the editor is dirty must not
// compile yesterday's file from disk. The save owns that compilation; a clean
// buffer may call the compiler directly.
const manualRebuildSandbox = { result: null };
await vm.runInNewContext(`(async () => {
const state = { srcCtx: { activeFile: 'header.pug', modified: true, viewingCompiledHtml: false } };
const calls = [];
const saveCurrentSourceFile = async (...args) => { calls.push(['save', ...args]); return true; };
const rebuildSourceEmail = async () => { calls.push(['build']); return true; };
async ${manualRebuild}
await rebuildCurrentSourceFromUi();
state.srcCtx.modified = false;
await rebuildCurrentSourceFromUi();
result = calls;
})()`, manualRebuildSandbox);
assert.deepEqual(JSON.parse(JSON.stringify(manualRebuildSandbox.result)), [
  ["save", null, { awaitBuild: true }],
  ["build"],
]);

// Executable regression: two mails in the same browser receive independent
// localStorage namespace sets; built-ins remain UI fallback and are never sent.
class MemoryStorage {
  constructor() { this.values = new Map(); }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
}
const memoryStorage = new MemoryStorage();
const namespaceState = { srcCtx: null, namespaces: [] };
const namespaceSandbox = {
  state: namespaceState,
  localStorage: memoryStorage,
  encodeURIComponent,
  JSON,
  result: null,
};
vm.runInNewContext(`
const LS_NAMESPACES = 'wb-namespaces';
const LS_NAMESPACES_SCOPE_PREFIX = 'wb-namespaces:';
const WORKBENCH_NAMESPACE_RE = /^[A-Za-z0-9_-]{1,160}$/;
${functionSource("normalizeWorkbenchNamespaceName")}
${functionSource("ensureValidNamespaceNames")}
${functionSource("namespaceScopeStorageKey")}
${functionSource("userNamespaces")}
${functionSource("readNamespaceScope")}
${functionSource("persistNamespaceScope")}
${functionSource("replaceNamespacesForScope")}
${functionSource("buildNamespacesForContext")}
const builtin = { id: 'system', name: 'footer_upload', builtin: true, locales: {} };
const alpha = { id: 'alpha', name: 'alpha', locales: { en: ['A'] } };
const beta = { id: 'beta', name: 'beta', locales: { en: ['B'] } };
persistNamespaceScope('Brand', 'mail-a', [alpha, builtin], localStorage);
persistNamespaceScope('Brand', 'mail-b', [beta, builtin], localStorage);
persistNamespaceScope('', '', [{ id: 'global', name: 'global', locales: {} }], localStorage);
state.namespaces = [builtin];
replaceNamespacesForScope('Brand', 'mail-a');
const ctxA = { brand: 'Brand', mail: 'mail-a' };
const ctxB = { brand: 'Brand', mail: 'mail-b' };
state.srcCtx = ctxA;
result = {
  keyA: namespaceScopeStorageKey('Brand', 'mail-a'),
  activeA: state.namespaces.map(item => item.name),
  buildA: buildNamespacesForContext(ctxA).map(item => item.name),
  staleContextB: buildNamespacesForContext(ctxB).map(item => item.name),
  global: readNamespaceScope('', '', localStorage).map(item => item.name),
};
`, namespaceSandbox);
assert.deepEqual(JSON.parse(JSON.stringify(namespaceSandbox.result)), {
  keyA: "wb-namespaces:Brand/mail-a",
  activeA: ["alpha", "footer_upload"],
  buildA: ["alpha"],
  staleContextB: ["beta"],
  global: ["global"],
});

// Executable regression: a slower first split-pane POST is always followed by
// the newest queued value, and compilation runs once for the final bytes.
const auxiliarySandbox = {
  result: null,
  JSON,
  Map,
  Promise,
};
await vm.runInNewContext(`(async () => {
const _auxSourceSaveQueues = new Map();
const state = { srcCtx: null };
const stripPreviewArtifacts = value => value;
const repairInvalidNamespaceTokens = value => value;
const ensureValidNamespaceNames = value => value;
const readNamespaceScope = () => [];
const persistNamespaceScope = () => true;
let releaseOld;
const oldGate = new Promise(resolve => { releaseOld = resolve; });
const writes = [];
let builds = 0;
const fetch = async (_url, options) => {
  const body = JSON.parse(options.body);
  if (body.content === 'old') await oldGate;
  writes.push(body.content);
  return { ok: true, json: async () => ({ ok: true }) };
};
const rebuildSourceEmail = async () => { builds += 1; return true; };
${functionSource("auxiliarySourceSaveKey")}
async ${auxiliarySave}
const ctx = { brand: 'Brand', mail: 'mail-a' };
state.srcCtx = ctx;
const first = saveAuxiliarySourceFile(ctx, 'app.pug', 'old');
await Promise.resolve();
const second = saveAuxiliarySourceFile(ctx, 'app.pug', 'new');
releaseOld();
await Promise.all([first, second]);
result = { writes, builds };
})()`, auxiliarySandbox);
assert.deepEqual(JSON.parse(JSON.stringify(auxiliarySandbox.result)), {
  writes: ["old", "new"],
  builds: 1,
});

console.log("✓ workbench code flow: Pug-first, namespace repair, dirty rebuild, queues, HTML detach/reset");
