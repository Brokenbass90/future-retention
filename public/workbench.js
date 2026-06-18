/* ═══════════════════════════════════════════════════════════════
   RetKit Workbench v2.1
   ═══════════════════════════════════════════════════════════════ */
'use strict';

// ─── State ──────────────────────────────────────────────────────
const state = {
  theme: 'dark',
  files: [],           // Array<{ id, name, html }>
  activeFileId: null,
  namespaces: [],      // Array<{ id, name, locales: { [code]: string[] } }>
  activeLocale: 'original',
  viewport: 'desktop',
  wrapMode: false,
  aiStreaming: false,
  aiAbortController: null,
  activePanel: null,
  chatHistory: [],
  // brands
  brands: [],          // Array<{ id, name, logoUrl, logoWidth, logoPos, tokens:{} }>
  activeBrandId: null,
  // editor type
  editorType: 'html',  // 'html' | 'pug' | 'stylus'
  // email source context — active when editing email-base source files
  srcCtx: null,        // { brand, mail, files: [], activeFile: null, modified: false }
  // locale edit modal
  _editNsId: null,
  _editLocale: null,
  // brand modal
  _editBrandId: null,
};

// ─── DOM refs ────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const r = {
  fileTabs:            $('fileTabs'),
  openFileBtn:         $('openFileBtn'),
  openFileBtn2:        $('openFileBtn2'),
  fileInput:           $('fileInput'),
  themeToggleBtn:      $('themeToggleBtn'),
  themeIconDark:       $('themeIconDark'),
  themeIconLight:      $('themeIconLight'),
  aiDot:               $('aiDot'),
  aiSettingsBtn:       $('aiSettingsBtn'),
  localeBar:           $('localeBar'),
  localeTabs:          $('localeTabs'),
  loadLocalesBtn:      $('loadLocalesBtn'),
  loadMenu:            $('loadMenu'),
  loadFolderBtn:       $('loadFolderBtn'),
  loadFilesBtn:        $('loadFilesBtn'),
  folderInput:         $('folderInput'),
  filesInput:          $('filesInput'),
  addLocaleManualBtn:  $('addLocaleManualBtn'),
  namespaceBar:        $('namespaceBar'),
  statLines:           $('statLines'),
  statBlocks:          $('statBlocks'),
  copyHtmlBtn:         $('copyHtmlBtn'),
  downloadHtmlBtn:     $('downloadHtmlBtn'),
  wrapToggleBtn:       $('wrapToggleBtn'),
  fullscreenBtn:       $('fullscreenBtn'),
  cmWrap:              $('cmWrap'),
  validationBar:       $('validationBar'),
  validationInner:     $('validationInner'),
  validationClose:     $('validationClose'),
  aiDrawer:            $('aiDrawer'),
  aiDrawerHandle:      $('aiDrawerHandle'),
  aiHandleLabel:       $('aiHandleLabel'),
  aiTokenCounter:      $('aiTokenCounter'),
  aiDrawerToggle:      $('aiDrawerToggle'),
  aiMessages:          $('aiMessages'),
  aiInput:             $('aiInput'),
  aiSendBtn:           $('aiSendBtn'),
  aiCancelRow:         $('aiCancelRow'),
  aiCancelBtn:         $('aiCancelBtn'),
  previewFrame:        $('previewFrame'),
  previewEmpty:        $('previewEmpty'),
  previewLocaleLabel:  $('previewLocaleLabel'),
  previewRtlBadge:     $('previewRtlBadge'),
  pencilToggle:        $('pencilToggle'),
  previewFrameWrap:    $('previewFrameWrap'),
  previewNsLabel:      $('previewNsLabel'),
  resizeHandle:        $('resizeHandle'),
  editorPane:          $('editorPane'),
  previewPane:         $('previewPane'),
  workspace:           $('workspace'),
  bottomBar:           $('bottomBar'),
  bottomResizeHandle:  $('bottomResizeHandle'),
  validateBadge:       $('validateBadge'),
  validateResults:     $('validateResults'),
  exportLocaleList:    $('exportLocaleList'),
  exportPdfBtn:        $('exportPdfBtn'),
  brandsGrid:          $('brandsGrid'),
  toastContainer:      $('toastContainer'),
  // locale edit modal
  localeEditBackdrop:  $('localeEditBackdrop'),
  localeEditModal:     $('localeEditModal'),
  localeEditTitle:     $('localeEditTitle'),
  localeEditHintBlocks:$('localeEditHintBlocks'),
  nsSwitcher:          $('nsSwitcher'),
  localeBlockBadge:    $('localeBlockBadge'),
  closeLocaleEditBtn:  $('closeLocaleEditBtn'),
  localeCmWrap:        $('localeCmWrap'),
  localeEditTextarea:  $('localeEditTextarea'),
  localeEditValidation:$('localeEditValidation'),
  localeKeyList:       $('localeKeyList'),
  deleteLocaleBtn:     $('deleteLocaleBtn'),
  autoFixLocaleBtn:    $('autoFixLocaleBtn'),
  aiAuditLocaleBtn:    $('aiAuditLocaleBtn'),
  splitLocaleSelectionBtn: $('splitLocaleSelectionBtn'),
  cancelLocaleEditBtn: $('cancelLocaleEditBtn'),
  saveLocaleEditBtn:   $('saveLocaleEditBtn'),
  // add locale modal
  addLocaleBackdrop:   $('addLocaleBackdrop'),
  addLocaleModal:      $('addLocaleModal'),
  closeAddLocaleBtn:   $('closeAddLocaleBtn'),
  newLocaleCode:       $('newLocaleCode'),
  newLocaleNs:         $('newLocaleNs'),
  newNsRow:            $('newNsRow'),
  newNsName:           $('newNsName'),
  newLocaleAiTranslate: $('newLocaleAiTranslate'),
  newLocaleAiFrom:     $('newLocaleAiFrom'),
  cancelAddLocaleBtn:  $('cancelAddLocaleBtn'),
  confirmAddLocaleBtn: $('confirmAddLocaleBtn'),
  // AI settings modal
  aiSettingsBackdrop:  $('aiSettingsBackdrop'),
  aiSettingsModal:     $('aiSettingsModal'),
  closeAiSettingsBtn:  $('closeAiSettingsBtn'),
  aiKeyStatus:         $('aiKeyStatus'),
  aiModelStatus:       $('aiModelStatus'),
  aiTokenStatus:       $('aiTokenStatus'),
  // ph picker
  phPicker:            $('phPicker'),
  phPickerTitle:       $('phPickerTitle'),
  phPickerClose:       $('phPickerClose'),
  phPickerList:        $('phPickerList'),
  // fullscreen
  fullscreenOverlay:   $('fullscreenOverlay'),
  fullscreenFilename:  $('fullscreenFilename'),
  fullscreenClose:     $('fullscreenClose'),
  fullscreenCmWrap:    $('fullscreenCmWrap'),
  fullscreenCmWrapSplit: $('fullscreenCmWrapSplit'),
  fsSplitDivider:      $('fsSplitDivider'),
  fsEditorBody:        $('fsEditorBody'),
  fsLeftPaneToolbar:   $('fsLeftPaneToolbar'),
  fsRightPaneToolbar:  $('fsRightPaneToolbar'),
  fsLeftFileBtn:       $('fsLeftFileBtn'),
  fsRightFileBtn:      $('fsRightFileBtn'),
  fsLeftFileLabel:     $('fsLeftFileLabel'),
  fsLeftFileMenu:      $('fsLeftFileMenu'),
  fsRightFileMenu:     $('fsRightFileMenu'),
  fsLeftCloseBtn:      $('fsLeftCloseBtn'),
  fsRightCloseBtn:     $('fsRightCloseBtn'),
  // mismatch modal
  mismatchBackdrop:    $('mismatchBackdrop'),
  mismatchModal:       $('mismatchModal'),
  mismatchBody:        $('mismatchBody'),
  closeMismatchBtn:    $('closeMismatchBtn'),
  closeMismatchOkBtn:  $('closeMismatchOkBtn'),
  autoFixMismatchBtn:  $('autoFixMismatchBtn'),
  aiAuditMismatchBtn:  $('aiAuditMismatchBtn'),
  // brand panel
  brandsGrid:          $('brandsGrid'),
  createBrandBtn:      $('createBrandBtn'),
  brandsActiveInfo:    $('brandsActiveInfo'),
  brandsActiveName:    $('brandsActiveName'),
  brandsResetBtn:      $('brandsResetBtn'),
  previewBrandBadge:   $('previewBrandBadge'),
  // brand modal
  brandModalBackdrop:  $('brandModalBackdrop'),
  brandModal:          $('brandModal'),
  brandModalTitle:     $('brandModalTitle'),
  closeBrandModalBtn:  $('closeBrandModalBtn'),
  brandName:           $('brandName'),
  brandLogoUrl:        $('brandLogoUrl'),
  brandLogoWidth:      $('brandLogoWidth'),
  brandLogoPos:        $('brandLogoPos'),
  brandLogoPreview:    $('brandLogoPreview'),
  deleteBrandBtn:      $('deleteBrandBtn'),
  cancelBrandBtn:      $('cancelBrandBtn'),
  saveBrandBtn:        $('saveBrandBtn'),
  // editor type
  convertBtn:          $('convertBtn'),
  convertError:        $('convertError'),
  saveSourceBtn:       $('saveSourceBtn'),
  saveToBaseBtn:       $('saveToBaseBtn'),
  minifyBtn:           $('minifyBtn'),
  fsModeChip:          $('fsModeChip'),
  // source file navigation
  srcFileTabs:         $('srcFileTabs'),
  etypeFilesBtn:       $('etypeFilesBtn'),
  etypeFilesDropdown:  $('etypeFilesDropdown'),
  etypeSplitBtn:       $('etypeSplitBtn'),
  cmWrapSplit:         $('cmWrapSplit'),
  cmSplitDivider:      $('cmSplitDivider'),
  cmSplitLabel:        $('cmSplitLabel'),
  editorBody:          $('editorBody'),
  compiledViewBanner:      $('compiledViewBanner'),
  compiledViewBackBtn:     $('compiledViewBackBtn'),
  compiledViewEditHtmlBtn: $('compiledViewEditHtmlBtn'),
  compiledViewApplyAiBtn:  $('compiledViewApplyAiBtn'),
  aiResizeHandle:      $('aiResizeHandle'),
  blocksShelf:         $('blocksShelf'),
  blocksShelfInner:    $('blocksShelfInner'),
  blocksCarousel:           $('blocksCarousel'),
  blocksCarouselTrack:      $('blocksCarouselTrack'),
  blocksCarouselClose:      $('blocksCarouselClose'),
  blocksCarouselToggleBtn:  $('blocksCarouselToggleBtn'),
  splitLeftToolbar:    $('splitLeftToolbar'),
  splitRightToolbar:   $('splitRightToolbar'),
  splitLeftFileBtn:    $('splitLeftFileBtn'),
  splitRightFileBtn:   $('splitRightFileBtn'),
  splitLeftFileLabel:  $('splitLeftFileLabel'),
  splitLeftFileMenu:   $('splitLeftFileMenu'),
  splitRightFileMenu:  $('splitRightFileMenu'),
  splitLeftCloseBtn:   $('splitLeftCloseBtn'),
  splitRightCloseBtn:  $('splitRightCloseBtn'),
  fsFileTabs:               $('fsFileTabs'),
  fsFilePickerWrap:         $('fsFilePickerWrap'),
  fsFilePickerBtn:          $('fsFilePickerBtn'),
  fsFilePickerLabel:        $('fsFilePickerLabel'),
  fsFilePickerDropdown:     $('fsFilePickerDropdown'),
  // backup modal
  backupModalBackdrop:      $('backupModalBackdrop'),
  backupModal:              $('backupModal'),
  backupMailName:           $('backupMailName'),
  backupCopyName:           $('backupCopyName'),
  backupEditOriginalBtn:    $('backupEditOriginalBtn'),
  backupCreateCopyBtn:      $('backupCreateCopyBtn'),
};

// ─── CodeMirror instances ────────────────────────────────────────
let cm = null;
let cmFullscreen = null;
let cmFullscreenSplit = null;  // second pane in fullscreen split view
let cmSplit = null;       // second pane in split view
let _suppressSplitChange = false;
let splitState = { active: false, leftFile: null, rightFile: null };
let fsSplitActive = false;
let _fsSplitActiveFile = null; // file loaded in right pane of fs split
let _undoSnapshots = [];
let cmLocale = null;

// ─── RTL ─────────────────────────────────────────────────────────
const RTL_LOCALES = new Set(['ar','ur','he','fa','arc','dv','ha','khw','ks','ku','ps','sd','ug','yi']);
const isRtlLocale = code => RTL_LOCALES.has((code||'').split(/[-_]/)[0].toLowerCase());
const hasRtlGlyphs = text => /[\u0590-\u05ff\u0600-\u06ff\u0750-\u077f]/.test(String(text || ''));
const cleanMailFolderName = name => {
  let value = String(name || '').trim().replace(/^mail-/i, '');
  value = value.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').replace(/-{2,}/g, '-');
  return value ? `mail-${value}` : '';
};
const suggestMailVersionName = (mail, brand = null) => {
  const base = cleanMailFolderName(mail) || 'mail-new';
  let currentBrand = brand || state.srcCtx?.brand || null;
  let knownBrands = [];
  try {
    currentBrand = currentBrand || ebState.activeBrand;
    knownBrands = ebState.brands || [];
  } catch {}
  const known = new Set(
    knownBrands
      .find(b => b.brand === currentBrand)?.mails
      ?.map(m => typeof m === 'string' ? m : m.name) || []
  );
  let candidate = `${base}-copy`;
  let n = 2;
  while (known.has(candidate)) {
    candidate = `${base}-copy-${n++}`;
  }
  return candidate;
};

// ─── Utilities ───────────────────────────────────────────────────
function escapeHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t=setTimeout(()=>fn(...a),ms); }; }
function uid() { return `${Date.now()}-${Math.random().toString(36).slice(2,6)}`; }

function pushUndoSnapshot(label = 'Изменение') {
  try {
    _undoSnapshots.push({
      label,
      editorValue: cm?.getValue?.() || '',
      activeFileId: state.activeFileId,
      editorType: state.editorType,
      activeLocale: state.activeLocale,
      files: JSON.parse(JSON.stringify(state.files || [])),
      namespaces: JSON.parse(JSON.stringify(state.namespaces || [])),
      srcCtx: state.srcCtx ? JSON.parse(JSON.stringify(state.srcCtx)) : null,
    });
    if (_undoSnapshots.length > 20) _undoSnapshots.shift();
  } catch {}
}

function restoreUndoSnapshot(snap = _undoSnapshots.pop()) {
  if (!snap) { toast('Нет изменений для отката', 'info'); return false; }
  state.files = snap.files || [];
  state.namespaces = snap.namespaces || [];
  state.activeFileId = snap.activeFileId || null;
  state.editorType = snap.editorType || 'html';
  state.activeLocale = snap.activeLocale || 'original';
  state.srcCtx = snap.srcCtx || null;

  if (cm) {
    _suppressSrcModified = true;
    cm.setValue(snap.editorValue || '');
    cm.setOption('readOnly', !!state.srcCtx?.viewingCompiledHtml);
    setTimeout(() => { _suppressSrcModified = false; }, 0);
  }
  renderLocalesBar();
  renderNamespaceBar();
  validateLocales();
  updatePreview();
  updateEditorStats();
  renderSrcFileTabs();
  renderEtypeFilesDropdown();
  saveToLocalStorage();
  toast(`Откат: ${snap.label}`, 'success');
  return true;
}

function addUndoButton(anchor, label = 'Откатить последнее изменение') {
  const btn = document.createElement('button');
  btn.className = 'btn-secondary';
  btn.style.cssText = 'margin-top:8px;margin-left:8px;font-size:12px;padding:5px 12px;display:inline-block';
  btn.textContent = 'Откатить';
  btn.title = label;
  btn.onclick = () => {
    btn.disabled = true;
    restoreUndoSnapshot();
  };
  anchor.after(btn);
  return btn;
}

// ─── HTML pretty-printer ─────────────────────────────────────────
function prettyHtml(html) {
  if (!html) return '';
  try {
    // Prefer js-beautify if CDN loaded it
    if (typeof html_beautify === 'function') {
      return html_beautify(html, {
        indent_size: 2, wrap_line_length: 0,
        preserve_newlines: false, indent_inner_html: false,
        end_with_newline: false, extra_liners: [],
        unformatted: [], content_unformatted: ['script','style'],
      });
    }
    return prettyHtmlFallback(html);
  } catch(e) { return prettyHtmlFallback(html); }
}

function prettyHtmlFallback(html) {
  // Robust email-HTML formatter — handles VML, conditional comments, tables
  const VOID  = new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
  const BLOCK = new Set(['html','head','body','div','table','tbody','thead','tfoot','colgroup','tr','td','th',
    'p','ul','ol','li','dl','dt','dd','section','header','footer','nav','aside','main','article',
    'h1','h2','h3','h4','h5','h6','blockquote','pre','form','fieldset','figure','center',
    'script','style']);
  const INDENT = '  ';
  const lines  = [];
  let depth    = 0;

  // Split into tokens: tags and text
  const re = /(<(?:!--[\s\S]*?--|!\[CDATA\[[\s\S]*?\]\]>|![^>]+>|[^>]+>))/g;
  const parts = html.split(re).filter(s => s != null);

  for (const part of parts) {
    if (!part.trim()) continue;
    const isTag = part[0] === '<';
    if (!isTag) {
      const t = part.trim().replace(/\s+/g, ' ');
      if (t) lines.push(INDENT.repeat(Math.max(0, depth)) + t);
      continue;
    }

    // Detect tag properties
    const isComment    = part.startsWith('<!--');
    const isCondStart  = /^<!--\[if/i.test(part);
    const isCondEnd    = /\[endif\]-->/i.test(part);
    const isDoctype    = /^<!doctype/i.test(part);
    const isClose      = !isComment && /^<\//.test(part);
    const isSelfClose  = part.endsWith('/>');
    const tagName      = (!isComment && (part.match(/^<\/?([a-z][a-z0-9]*)/i)||[])[1]?.toLowerCase()) || '';
    const isVoid       = VOID.has(tagName);
    const isBlock      = !tagName || BLOCK.has(tagName);

    if (isCondEnd)   depth = Math.max(0, depth - 1);
    if (isClose && isBlock && !isVoid) depth = Math.max(0, depth - 1);

    lines.push(INDENT.repeat(Math.max(0, depth)) + part);

    if (isCondStart)  depth++;
    else if (!isClose && !isSelfClose && !isVoid && !isComment && !isDoctype && isBlock) depth++;
  }

  return lines.join('\n');
}

// ─── HTML minifier ───────────────────────────────────────────────
function minifyHtml(html) {
  if (!html) return '';
  return html
    .replace(/<!--(?![\s\S]*?\[if)[\s\S]*?-->/g, '') // remove non-IE comments
    .replace(/\s*\n\s*/g, ' ')
    .replace(/>\s+</g, '><')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// ─── Persistence keys ────────────────────────────────────────────
const LS_THEME      = 'wb-theme';
const LS_FILES      = 'wb-files';
const LS_ACTIVE_FILE = 'wb-active-file';
const LS_NAMESPACES = 'wb-namespaces';
const LS_BRANDS     = 'wb-brands';
const LS_SRC_CTX    = 'wb-src-ctx';
const LS_WORKSPACE_SPLIT = 'wb-workspace-split';
const LS_FULLSCREEN_SPLIT = 'wb-fullscreen-split';
const LS_CODE_SPLIT = 'wb-code-split';
const LS_CODE_SPLIT_ACTIVE = 'wb-code-split-active';
const LS_FS_SPLIT_ACTIVE = 'wb-fullscreen-split-active';
const LS_BOTTOM_PANEL_HEIGHT = 'wb-bottom-panel-height';

// ─── Placeholder regex ──────────────────────────────────────────
// Format: ${{ namespace.block_NN }}$  — 0-indexed, always 2-digit (block_00, block_01 …)
const PH_RE  = /\$\{\{\s*([a-zA-Z0-9_\-]+)\.block_(\d+)\s*\}\}\$/g;
const PH_NUM = n => String(n).padStart(2, '0');
const PH_STR = (ns, n) => '${{ ' + ns + '.block_' + PH_NUM(n) + ' }}$';

// ═══════════════════════════════════════════════════════════════
// THEME
// ═══════════════════════════════════════════════════════════════

function setTheme(theme) {
  state.theme = theme;
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(LS_THEME, theme);
  const t = theme === 'dark' ? 'material-darker' : 'default';
  if (cm) cm.setOption('theme', t);
  if (cmFullscreen) cmFullscreen.setOption('theme', t);
  if (cmLocale) cmLocale.setOption('theme', t);
  r.themeIconDark.style.display  = theme === 'dark'  ? '' : 'none';
  r.themeIconLight.style.display = theme === 'light' ? '' : 'none';
}

r.themeToggleBtn.addEventListener('click', () => setTheme(state.theme === 'dark' ? 'light' : 'dark'));

// ═══════════════════════════════════════════════════════════════
// CODEMIRROR — main HTML editor
// ═══════════════════════════════════════════════════════════════

function buildHtmlPhOverlay() {
  return {
    token(stream) {
      // ${{ ns.block_N }}$
      if (stream.peek() === '$') {
        if (stream.match(/\$\{\{[^}]*?\}\}\$/)) return 'ph-translate';
      }
      if (stream.peek() === '{') {
        if (stream.match(/\{%[^%]*?%\}/)) return 'ph-style';
        if (stream.match(/\{\{[a-zA-Z0-9_]+\.[^}]+?\}\}/)) return 'ph-embedded';
        stream.next(); return null;
      }
      stream.next(); return null;
    }
  };
}

function initCodeMirror() {
  CodeMirror.defineMode('ph-overlay',              () => buildHtmlPhOverlay());
  CodeMirror.defineMode('html-with-placeholders',  cfg =>
    CodeMirror.overlayMode(CodeMirror.getMode(cfg,'htmlmixed'), CodeMirror.getMode(cfg,'ph-overlay'), true)
  );
  CodeMirror.defineMode('pug-with-placeholders',   cfg =>
    CodeMirror.overlayMode(CodeMirror.getMode(cfg,'pug'), CodeMirror.getMode(cfg,'ph-overlay'), true)
  );
  CodeMirror.defineMode('css-with-placeholders',   cfg =>
    CodeMirror.overlayMode(CodeMirror.getMode(cfg,'css'), CodeMirror.getMode(cfg,'ph-overlay'), true)
  );

  cm = CodeMirror.fromTextArea(document.getElementById('codeEditor'), {
    mode: 'html-with-placeholders',
    theme: state.theme === 'dark' ? 'material-darker' : 'default',
    lineNumbers: true,
    lineWrapping: false,
    tabSize: 2, indentUnit: 2, indentWithTabs: false,
    autofocus: false,
    scrollbarStyle: 'native',
    gutters: ['CodeMirror-linenumbers', 'cm-left-pad'],
    extraKeys: {
      'Tab': ed => ed.replaceSelection('  '),
      'Cmd-F': ed => openFindBar(ed),
      'Ctrl-F': ed => openFindBar(ed),
      'Cmd-H': ed => openFindBar(ed, { focusReplace: true }),
      'Ctrl-H': ed => openFindBar(ed, { focusReplace: true }),
    },
  });

  cm.on('change', debounce(() => {
    updateEditorStats();
    updatePreview();
    maybeCloseTabOnEmptyEditor();
    saveToLocalStorage();
  }, 350));

  // ── VS Code paste-cleaner ─────────────────────────────────────
  // VS Code copies code with syntax-highlighting markup (<span style="color: #...">
  // wrappers + <meta charset='utf-8'> header). Pasting that into a Pug file
  // makes the Pug parser explode. We intercept the paste at the DOM level
  // (capture phase, BEFORE CM processes the clipboard data) and replace the
  // clipboard payload with plain text extracted from the HTML markup.
  //
  // Detection: clipboard text starts with <meta charset='utf-8'> AND contains
  // <span style="color:" syntax-highlighting markers.
  if (r.cmWrap) {
    r.cmWrap.addEventListener('paste', (ev) => {
      const cd = ev.clipboardData;
      if (!cd) return;
      // Look at both 'text/html' and 'text/plain' payloads.
      const htmlPayload = cd.getData('text/html') || '';
      const plainPayload = cd.getData('text/plain') || '';
      if (!htmlPayload) return;
      const looksLikeVSCode =
        /^<meta\s+charset=['"]utf-8['"]/i.test(htmlPayload.trim()) &&
        /<span\s+style=["']color:\s*#/i.test(htmlPayload);
      if (!looksLikeVSCode) return;
      // Strip ALL HTML tags and decode entities → plain text Pug.
      let text = htmlPayload
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(div|p|li)>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\u00a0/g, ' ');
      // Cap blank-line runs to max 2 newlines.
      text = text.replace(/\n{3,}/g, '\n\n').trim();
      if (!text) return;
      // Prevent CM's default paste — we'll insert our cleaned text.
      ev.preventDefault();
      ev.stopPropagation();
      cm.replaceSelection(text, 'around');
      toast('VS Code syntax-highlighting убран при вставке', 'info', 2200);
    }, true /* capture phase */);
  }

  // ── Auto-prettify on paste ────────────────────────────────────
  // When user pastes a full HTML document, auto-format it to be readable
  cm.on('paste', (_editor, _event) => {
    setTimeout(() => {
      // Don't prettify in srcCtx (Pug/Styl source files have their own auto-save)
      if (state.srcCtx) return;
      const val = cm.getValue();
      // Only auto-prettify if it looks like a full HTML document (>200 chars, has tags)
      if (val.length < 200 || !/<[a-z]/i.test(val)) return;
      // Only if it's very long single line (unformatted dump) — check avg line length
      const lines = val.split('\n');
      const avgLen = val.length / lines.length;
      if (avgLen < 120) return; // already reasonably formatted
      const pretty = prettyHtml(val);
      if (pretty && pretty !== val) {
        const cursor = cm.getCursor();
        _suppressSrcModified = true;
        cm.setValue(pretty);
        setTimeout(() => { _suppressSrcModified = false; }, 0);
        cm.setCursor({ line: cursor.line, ch: 0 });
        toast('HTML отформатирован', 'info', 1800);
      }
    }, 80);
  });

  // ── Left padding: uses a native CM gutter 'cm-left-pad' (12px spacer)
  // This is the only CM5 approach that survives refresh() / layout passes.

  // ── Minimap ───────────────────────────────────────────────────
  createMinimap(cm, r.cmWrap);

  updateEditorStats();
}

// ─── Minimap (VS Code-style overview ruler) ──────────────────────
function createMinimap(instance, container, opts = {}) {
  const MINIMAP_W = opts.width || 28;

  const canvas = document.createElement('canvas');
  canvas.className = 'cm-minimap';
  canvas.width = MINIMAP_W;
  container.style.position = 'relative';
  container.appendChild(canvas);

  const ctx = canvas.getContext('2d');
  let dragging = false;

  function getTheme() {
    return document.documentElement.dataset.theme === 'dark';
  }

  function render() {
    const H = canvas.height = container.offsetHeight - 4;
    canvas.width = MINIMAP_W;

    const lines = instance.lineCount();
    const isDark = getTheme();
    ctx.clearRect(0, 0, MINIMAP_W, H);

    // Background
    ctx.fillStyle = isDark ? '#141420' : '#f5f5f5';
    ctx.fillRect(0, 0, MINIMAP_W, H);

    // Gather CM lint marks (errors) if available
    const errorLines = new Set();
    try {
      instance.eachLine(lineHandle => {
        if (lineHandle.gutterMarkers) errorLines.add(instance.getLineNumber(lineHandle));
      });
      // also check widgets / marks
      const marks = instance.getAllMarks?.() || [];
      marks.forEach(m => {
        const pos = m.find?.();
        if (pos && m.className && /error/i.test(m.className)) errorLines.add(pos.from?.line);
      });
    } catch {}

    // Draw each line as a colored bar
    const lineH = Math.min(3, Math.max(1, H / Math.max(lines, 1)));
    for (let i = 0; i < lines; i++) {
      const line = instance.getLine(i) || '';
      const trimmed = line.trim();
      if (!trimmed) continue;

      const y = Math.floor(i * H / lines);
      // In narrow mode, just draw a full-width stripe — no indent math needed
      const barW = MINIMAP_W - 2;

      // Color by token type (error overrides everything)
      let color;
      if (errorLines.has(i))                             color = 'rgba(239,68,68,0.9)';   // error → red
      else if (/\$\{\{/.test(line))                      color = 'rgba(245,158,11,0.85)'; // placeholder → amber
      else if (/<!--/.test(line) || /\/\//.test(trimmed))color = 'rgba(107,174,107,0.7)'; // comment → green
      else if (/<\/?\w/.test(trimmed))                   color = 'rgba(86,156,214,0.75)'; // tag → blue
      else if (/style\s*=|class\s*=/.test(line))         color = 'rgba(156,220,254,0.55)';
      else if (/^\s*[.#]/.test(line))                    color = 'rgba(220,180,100,0.65)'; // Pug class/id
      else                                               color = isDark ? 'rgba(200,200,200,0.3)' : 'rgba(80,80,80,0.3)';

      ctx.fillStyle = color;
      ctx.fillRect(1, y, Math.max(barW, 2), Math.max(lineH, 1));
    }

    // Viewport indicator
    const scroll = instance.getScrollInfo();
    if (scroll.height > scroll.clientHeight) {
      const vTop = (scroll.top / scroll.height) * H;
      const vH   = Math.max(16, (scroll.clientHeight / scroll.height) * H);
      ctx.fillStyle   = 'rgba(255,255,255,0.07)';
      ctx.fillRect(0, vTop, MINIMAP_W, vH);
      ctx.strokeStyle = 'rgba(255,255,255,0.22)';
      ctx.lineWidth   = 1;
      ctx.strokeRect(0.5, vTop + 0.5, MINIMAP_W - 1, vH - 1);
    }
  }

  function scrollToRatio(ratio) {
    const scroll = instance.getScrollInfo();
    instance.scrollTo(null, ratio * scroll.height);
  }

  canvas.addEventListener('mousedown', e => {
    dragging = true;
    scrollToRatio(e.offsetY / canvas.height);
  });
  canvas.addEventListener('mousemove', e => {
    if (dragging) scrollToRatio(e.offsetY / canvas.height);
  });
  document.addEventListener('mouseup', () => { dragging = false; });

  instance.on('change', debounce(render, 120));
  instance.on('scroll', render);
  instance.on('refresh', debounce(render, 80));

  // Initial + on resize
  setTimeout(render, 250);
  new ResizeObserver(debounce(render, 100)).observe(container);

  return canvas;
}

// ─── Wrap renderLine — hanging indent so continuations align with their line ──
function wrapRenderLineHandler(instance, lineHandle, el) {
  const txt = lineHandle.text || '';
  const leadLen = (txt.match(/^[ \t]*/)[0] || '').length;
  if (leadLen === 0) return;
  // NOTE: never call charCoords/measureChar here — triggers CM re-render → infinite loop
  const charW = instance.defaultCharWidth();
  const off   = Math.min(leadLen * charW, 320);
  el.style.paddingLeft = off + 'px';
  el.style.textIndent  = '-' + off + 'px';
}

function applyWrapRenderLine(instance) {
  if (!instance) return;
  // Remove first to avoid double-registration
  try { instance.off('renderLine', wrapRenderLineHandler); } catch {}
  if (state.wrapMode) {
    instance.on('renderLine', wrapRenderLineHandler);
    instance.refresh();
  } else {
    // Reset any leftover styles
    instance.refresh();
  }
}

// ─── Wrap toggle ────────────────────────────────────────────────
r.wrapToggleBtn.addEventListener('click', () => {
  state.wrapMode = !state.wrapMode;
  if (cm) { cm.setOption('lineWrapping', state.wrapMode); applyWrapRenderLine(cm); }
  if (cmFullscreen) { cmFullscreen.setOption('lineWrapping', state.wrapMode); applyWrapRenderLine(cmFullscreen); }
  r.wrapToggleBtn.classList.toggle('wrap-active', state.wrapMode);
});

// ═══════════════════════════════════════════════════════════════
// EDITOR TYPE TABS  (HTML / Pug / Stylus)  — main + fullscreen
// ═══════════════════════════════════════════════════════════════

// HTML tab button: when in source ctx → show compiled HTML in editor
document.querySelectorAll('.etype-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const etype = tab.dataset.etype;
    const ctx   = state.srcCtx;

    if (etype === 'html' && ctx) {
      showCompiledHtml();
      return;
    }
    switchEditorType(etype);
  });
});

let _compiledViewMinified = false;

function showCompiledHtml(minified = false) {
  const ctx = state.srcCtx;
  if (!ctx) return;

  if (!ctx.compiledHtml) {
    toast('Собираю HTML…', 'info', 1500);
    // Build first, then show — rebuildSourceEmail stores compiledHtml and calls updatePreview
    rebuildSourceEmail().then(() => {
      if (state.srcCtx?.compiledHtml) showCompiledHtml(minified);
    }).catch(() => {});
    return;
  }

  _compiledViewMinified = minified;
  const html = minified ? minifyHtml(ctx.compiledHtml) : prettyHtml(ctx.compiledHtml);
  state.activeFileId = null;

  // Suppress change listener so this setValue() doesn't trigger auto-compile
  _suppressSrcModified = true;
  ctx.viewingCompiledHtml = true;
  cm?.setValue(html);
  cm?.setOption('mode', 'htmlmixed');
  cm?.setOption('readOnly', true);
  // Use setTimeout to allow CM change events to fire before re-enabling
  setTimeout(() => { _suppressSrcModified = false; }, 0);

  state.editorType = 'html';
  document.querySelectorAll('.etype-tab').forEach(t =>
    t.classList.toggle('active', t.dataset.etype === 'html')
  );
  r.saveSourceBtn?.classList.add('hidden');
  r.convertBtn?.classList.add('hidden');
  r.minifyBtn?.classList.remove('hidden');
  r.minifyBtn.textContent = minified ? 'Развернуть' : 'Минифицировать';
  r.minifyBtn.title = 'Минифицировать скомпилированный HTML';
  // Show read-only banner. Direct compiled-HTML editing is intentionally hidden:
  // source files stay the editable truth, with the "create copy" guard on first edit.
  r.compiledViewBanner?.classList.remove('hidden');
  r.compiledViewEditHtmlBtn?.classList.add('hidden');
  r.compiledViewApplyAiBtn?.classList.add('hidden');
  // Re-render tabs to highlight HTML badge
  renderSrcFileTabs();
}

// Format / Minify toggle
r.minifyBtn?.addEventListener('click', () => {
  if (state.srcCtx) {
    // Compiled HTML mode — toggle minify on the compiled html
    showCompiledHtml(!_compiledViewMinified);
  } else {
    // Plain HTML file — cycle: Format → Minify → Format
    const current = cm?.getValue() || '';
    const label = r.minifyBtn?.textContent?.trim();
    if (label === 'Форматировать' || label === 'Развернуть') {
      // → Prettify
      _compiledViewMinified = false;
      if (r.minifyBtn) r.minifyBtn.textContent = 'Минифицировать';
      const pretty = prettyHtml(current);
      _suppressSrcModified = true;
      cm?.setValue(pretty);
      setTimeout(() => { _suppressSrcModified = false; }, 0);
    } else {
      // → Minify
      _compiledViewMinified = true;
      if (r.minifyBtn) r.minifyBtn.textContent = 'Развернуть';
      const minified = minifyHtml(current);
      _suppressSrcModified = true;
      cm?.setValue(minified);
      setTimeout(() => { _suppressSrcModified = false; }, 0);
    }
  }
});

// "Back to source" button in compiled view banner
r.compiledViewBackBtn?.addEventListener('click', () => {
  const ctx = state.srcCtx;
  if (!ctx) return;
  const srcFile = ctx.activeFile ||
    ctx.files?.find(f => f.ext === 'pug' || f.ext === 'jade')?.path ||
    ctx.files?.[0]?.path;
  if (srcFile) loadSourceFile(srcFile);
});

// "Edit HTML" — unlock compiled HTML for direct editing; show "Apply to Pug" button
r.compiledViewEditHtmlBtn?.addEventListener('click', () => {
  const ctx = state.srcCtx;
  if (!ctx) return;
  // Unlock editor
  cm?.setOption('readOnly', false);
  ctx.viewingCompiledHtml = true; // still viewing compiled, but now editable
  _compiledHtmlSnapshot = cm?.getValue() || ''; // snapshot original for diff
  r.compiledViewEditHtmlBtn?.classList.add('hidden');
  r.compiledViewApplyAiBtn?.classList.remove('hidden');
  if (r.compiledViewBanner) {
    const lbl = r.compiledViewBanner.querySelector('.compiled-view-label');
    if (lbl) lbl.textContent = 'Редактирование HTML — изменения можно применить к Pug через AI';
  }
  toast('HTML разблокирован для редактирования', 'info', 2000);
});

// "Apply to Pug" — send original + modified HTML to AI, get updated Pug back
let _compiledHtmlSnapshot = ''; // original compiled HTML before user edits

r.compiledViewApplyAiBtn?.addEventListener('click', async () => {
  const ctx = state.srcCtx;
  if (!ctx) return;
  const modifiedHtml = cm?.getValue() || '';
  const originalHtml = _compiledHtmlSnapshot || ctx.compiledHtml || '';
  if (!modifiedHtml || !originalHtml) { toast('Нет данных для отправки', 'error'); return; }
  if (modifiedHtml === originalHtml) { toast('Изменений не обнаружено', 'warning'); return; }

  // Find pug file
  const pugFile = ctx.files?.find(f => f.ext === 'pug' || f.ext === 'jade');
  if (!pugFile) { toast('Pug-файл не найден', 'error'); return; }

  r.compiledViewApplyAiBtn.disabled = true;
  r.compiledViewApplyAiBtn.textContent = '⏳ AI работает...';

  try {
    // Fetch current pug source
    const pugRes = await fetch(`/api/wb/email-file?path=${encodeURIComponent(pugFile.path)}`);
    const pugData = await pugRes.json();
    if (!pugData.ok) throw new Error('Не удалось загрузить Pug');
    const currentPug = pugData.content;

    // Send to AI reverse-compilation endpoint
    const aiRes = await fetch('/api/wb/html-to-pug', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        originalHtml,
        modifiedHtml,
        currentPug,
        pugPath: pugFile.path,
      }),
    });
    const aiData = await aiRes.json();
    if (!aiData.ok || !aiData.pug) throw new Error(aiData.error || 'AI не вернул результат');

    // Save updated pug to server
    await fetch('/api/wb/email-file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: pugFile.path, content: aiData.pug }),
    });

    toast('✅ Pug обновлён! Пересборка...', 'success', 2500);
    // Reload pug in editor and rebuild
    await loadSourceFile(pugFile.path);
    await rebuildSourceEmail();
  } catch (e) {
    toast('Ошибка: ' + e.message, 'error');
  } finally {
    r.compiledViewApplyAiBtn.disabled = false;
    r.compiledViewApplyAiBtn.textContent = '🤖 Применить к Pug';
  }
});

function switchEditorType(type) {
  state.editorType = type;
  document.querySelectorAll('.etype-tab').forEach(t =>
    t.classList.toggle('active', t.dataset.etype === type)
  );
  // Convert button: show only for Pug/Stylus source files
  const isPugOrStylus = type === 'pug' || type === 'stylus';
  r.convertBtn.classList.toggle('hidden', !isPugOrStylus);
  // "Save to base" button: show only when editing plain HTML (no source context)
  const canSaveToBase = type === 'html' && !state.srcCtx && (cm?.getValue() || '').trim().length > 0;
  r.saveToBaseBtn?.classList.toggle('hidden', !canSaveToBase);
  r.convertError.classList.add('hidden');
  r.convertError.textContent = '';

  // Update fullscreen mode chip
  const modeNames = { html: 'HTML', pug: 'Pug', stylus: 'Stylus', css: 'CSS' };
  if (r.fsModeChip) r.fsModeChip.textContent = modeNames[type] || type.toUpperCase();

  // Switch CM mode — both main and fullscreen editors
  function applyMode(instance) {
    if (!instance) return;
    if (type === 'html') {
      const isFs = instance === cmFullscreen;
      instance.setOption('mode', isFs ? 'html-with-ph-fs' : 'html-with-placeholders');
    } else if (type === 'pug') {
      instance.setOption('mode', 'pug');
    } else if (type === 'stylus') {
      instance.setOption('mode', { name: 'css' });
    }
    instance.refresh();
  }
  applyMode(cm);
  applyMode(cmFullscreen);
}

r.convertBtn.addEventListener('click', async () => {
  if (!cm) return;
  const code = cm.getValue();
  const from = state.editorType; // 'pug' or 'stylus'
  if (from === 'html') return;

  r.convertBtn.disabled = true;
  r.convertBtn.textContent = 'Конвертирую...';
  r.convertError.classList.add('hidden');

  try {
    const res = await fetch('/api/wb/convert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, from }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || `Ошибка ${res.status}`);

    // Switch to HTML tab and apply result
    switchEditorType('html');
    cm.setValue(data.result);
    updatePreview();
    saveToLocalStorage();
    toast(`${from === 'pug' ? 'Pug' : 'Stylus'} → HTML конвертировано`, 'success');
  } catch(err) {
    r.convertError.textContent = '⚠ ' + err.message;
    r.convertError.classList.remove('hidden');
  } finally {
    r.convertBtn.disabled = false;
    r.convertBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M1 7h10M8 4l3 3-3 3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg> → HTML`;
  }
});

// HTML → Pug decompile (available via dropdown "Convert to Pug")
async function decompileHtmlToPug() {
  if (!cm) return;
  const code = cm.getValue();
  if (!code.trim()) { toast('Редактор пустой', 'warning'); return; }
  r.convertError?.classList.add('hidden');
  try {
    const res = await fetch('/api/wb/convert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, from: 'html2pug' }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || `Ошибка ${res.status}`);
    switchEditorType('pug');
    cm.setValue(data.result);
    toast('HTML → Pug декомпилирован', 'success');
  } catch(err) {
    toast('⚠ ' + err.message, 'error');
  }
}

// ═══════════════════════════════════════════════════════════════
// CODEMIRROR — locale edit modal
// ═══════════════════════════════════════════════════════════════

/**
 * Locale blocks CM mode.
 * Only highlights the bracket/marker characters themselves, not the text inside.
 *
 * State:
 *   depth   — nesting depth of {{ blocks (0 = outside)
 *   boldOn  — whether we're inside @@ ... @@
 *
 * Token classes:
 *   ph-bracket  — {{ and }} (cyan)
 *   ph-at       — @@ (cyan/teal #22d3ee)
 *   ph-invalid  — unmatched } or extra @@ (red)
 */
function buildLocaleBlocksMode() {
  return {
    startState: () => ({ depth: 0, boldOn: false }),
    copyState: s => ({ depth: s.depth, boldOn: s.boldOn }),
    token(stream, st) {
      // Opening {{
      if (stream.match('{{')) {
        st.depth++;
        return 'ph-bracket';
      }
      // Closing }}
      if (stream.match('}}')) {
        if (st.depth > 0) { st.depth--; return 'ph-bracket'; }
        return 'ph-invalid'; // unmatched closing
      }
      // @@ toggle
      if (stream.match('@@')) {
        st.boldOn = !st.boldOn;
        return 'ph-at';
      }
      // Skip one char — no highlight for content between markers
      stream.next();
      return null;
    }
  };
}

function initLocaleCM() {
  if (cmLocale) return;
  CodeMirror.defineMode('locale-blocks', () => buildLocaleBlocksMode());

  cmLocale = CodeMirror.fromTextArea(document.getElementById('localeEditTextarea'), {
    mode: 'locale-blocks',
    theme: state.theme === 'dark' ? 'material-darker' : 'default',
    lineNumbers: true,
    lineWrapping: true,
    indentWithTabs: false,
    tabSize: 2,
    autofocus: false,
    scrollbarStyle: 'native',
    extraKeys: {
      'Escape': closeLocaleEditModal,
      'Cmd-F': ed => openFindBar(ed),
      'Ctrl-F': ed => openFindBar(ed),
      'Cmd-H': ed => openFindBar(ed, { focusReplace: true }),
      'Ctrl-H': ed => openFindBar(ed, { focusReplace: true }),
    },
  });

  cmLocale.on('change', debounce(() => {
    const val = cmLocale.getValue();
    const blocks = parseTextareaBlocks(val);
    updateLocaleEditBadge(state._editNsId, state._editLocale, blocks.length);
    renderLocaleKeyList(state._editNsId, state._editLocale, blocks.length);
    validateTextareaBlocks(val);
  }, 200));
}

// ═══════════════════════════════════════════════════════════════
// FULLSCREEN
// ═══════════════════════════════════════════════════════════════

r.fullscreenBtn.addEventListener('click', openFullscreen);
r.fullscreenClose.addEventListener('click', closeFullscreen);

// Fullscreen toolbar buttons
$('fsWrapBtn')?.addEventListener('click', () => {
  state.wrapMode = !state.wrapMode;
  if (cm) { cm.setOption('lineWrapping', state.wrapMode); applyWrapRenderLine(cm); }
  if (cmFullscreen) { cmFullscreen.setOption('lineWrapping', state.wrapMode); applyWrapRenderLine(cmFullscreen); }
  r.wrapToggleBtn.classList.toggle('wrap-active', state.wrapMode);
  $('fsWrapBtn')?.classList.toggle('wrap-active', state.wrapMode);
});
$('fsCopyBtn')?.addEventListener('click', async () => {
  if (!cmFullscreen) return;
  try { await navigator.clipboard.writeText(cmFullscreen.getValue()); toast('Скопировано!', 'success'); }
  catch { toast('Ошибка', 'error'); }
});
$('fsDownloadBtn')?.addEventListener('click', () => {
  if (!cmFullscreen) return;
  const blob = new Blob([cmFullscreen.getValue()], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  Object.assign(document.createElement('a'), {
    href: url,
    download: state.files.find(f => f.id === state.activeFileId)?.name || 'email.html',
  }).click();
  URL.revokeObjectURL(url);
});

// ── Fullscreen Split ───────────────────────────────────────────────
$('fsSplitBtn')?.addEventListener('click', toggleFsSplit);

async function toggleFsSplit() {
  fsSplitActive = !fsSplitActive;
  localStorage.setItem(LS_FS_SPLIT_ACTIVE, fsSplitActive ? '1' : '0');
  const btn = $('fsSplitBtn');
  btn?.classList.toggle('fsSplitBtn-active', fsSplitActive);

  const divider = r.fsSplitDivider;
  const splitWrap = r.fullscreenCmWrapSplit;

  if (!fsSplitActive) {
    // Close split
    divider?.classList.add('hidden');
    splitWrap?.classList.add('hidden');
    if (r.fullscreenCmWrap) r.fullscreenCmWrap.style.flex = '';
    if (splitWrap) splitWrap.style.flex = '';
    hideFsPaneMenus();
    renderFsPaneFileMenus();
    setTimeout(() => { cmFullscreen?.refresh(); }, 0);
    return;
  }

  // Open split — init cmFullscreenSplit if needed
  if (!cmFullscreenSplit) {
    cmFullscreenSplit = CodeMirror.fromTextArea($('fullscreenEditorSplit'), {
      theme: state.theme === 'dark' ? 'material-darker' : 'default',
      lineNumbers: true,
      lineWrapping: state.wrapMode,
      tabSize: 2, indentUnit: 2, indentWithTabs: false,
      scrollbarStyle: 'native',
      gutters: ['CodeMirror-linenumbers'],
      extraKeys: {
        'Tab': ed => ed.replaceSelection('  '),
        'Cmd-F': ed => openFindBar(ed),
        'Ctrl-F': ed => openFindBar(ed),
        'Cmd-H': ed => openFindBar(ed, { focusReplace: true }),
        'Ctrl-H': ed => openFindBar(ed, { focusReplace: true }),
      },
    });
    cmFullscreenSplit.on('change', debounce(async () => {
      if (!_fsSplitActiveFile || !state.srcCtx) return;
      // Save to main split CM if same file as main split
      try {
        await fetch('/api/wb/save-source', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filePath: _fsSplitActiveFile, content: cmFullscreenSplit.getValue() })
        });
      } catch {}
    }, 1200));
  }

  // Choose which file to show in second pane
  const ctx = state.srcCtx;
  let splitFile = null;

  // If main pane has a pug file, show styl in split and vice versa
  if (ctx) {
    const mainExt = (_fsActiveFile || ctx.activeFile)?.split('.').pop();
    if (mainExt === 'pug' || mainExt === 'jade') {
      splitFile = ctx.files?.find(f => f.ext === 'styl' || f.ext === 'css')?.path;
    } else {
      splitFile = ctx.files?.find(f => f.ext === 'pug' || f.ext === 'jade')?.path;
    }
    splitFile = splitFile || ctx.openedFiles?.find(p => p !== (_fsActiveFile || ctx.activeFile));
  }

  divider?.classList.remove('hidden');
  splitWrap?.classList.remove('hidden');
  restoreFullscreenSplitRatio();

  if (splitFile && ctx) {
    _fsSplitActiveFile = splitFile;
    const fname = splitFile.split('/').pop();
    $('fsSplitLabel').textContent = fname;
    try {
      const res = await fetch(`/api/wb/source-file?path=${encodeURIComponent(splitFile)}`);
      const data = await res.json();
      if (data.ok) {
        const ext = splitFile.split('.').pop();
        const modeMap = { pug: 'pug-with-placeholders', jade: 'pug-with-placeholders', styl: 'css-with-placeholders', css: 'css-with-placeholders', html: 'html-with-placeholders', htm: 'html-with-placeholders' };
        cmFullscreenSplit.setOption('mode', modeMap[ext] || 'htmlmixed');
        cmFullscreenSplit.setValue(data.content || '');
        cmFullscreenSplit.setOption('readOnly', false);
      }
    } catch {}
  } else if (!ctx && cmSplit && cmFullscreenSplit) {
    cmFullscreenSplit.setOption('mode', cmSplit.getOption('mode') || 'htmlmixed');
    cmFullscreenSplit.setValue(cmSplit.getValue());
    cmFullscreenSplit.setOption('readOnly', false);
    $('fsSplitLabel').textContent = r.cmSplitLabel?.textContent || 'Копия';
  }

  cmFullscreenSplit.setOption('lineWrapping', state.wrapMode);
  cmFullscreenSplit.setOption('theme', state.theme === 'dark' ? 'material-darker' : 'default');
  setTimeout(() => {
    restoreFullscreenSplitRatio();
    cmFullscreen?.refresh();
    cmFullscreenSplit.refresh();
  }, 50);
  renderFsPaneFileMenus();
}

function updateFullscreenStats() {
  const el = $('fullscreenStats');
  if (!el || !cmFullscreen) return;
  const val = cmFullscreen.getValue();
  const lines = val.split('\n').length;
  const blocks = (val.match(/\$\{\{[^}]*?\}\}\$/g) || []).length;
  el.textContent = `${lines} строк · ${blocks} блоков`;
}

function refreshFullscreenSplitEditors() {
  cmFullscreen?.refresh();
  cmFullscreenSplit?.refresh();
}

function setFullscreenSplitRatio(ratio, persist = false) {
  const body = $('fsEditorBody');
  const leftWrap = r.fullscreenCmWrap;
  const rightWrap = r.fullscreenCmWrapSplit;
  const divider = r.fsSplitDivider;
  if (!body || !leftWrap || !rightWrap || !divider || !fsSplitActive) return;
  if (rightWrap.classList.contains('hidden')) return;

  const total = body.clientWidth - divider.offsetWidth;
  if (total <= 0) return;

  const minPane = Math.min(total / 2 - 1, Math.min(360, Math.max(140, total * 0.16)));
  const safeRatio = Number.isFinite(ratio) ? ratio : 0.5;
  const leftWidth = Math.max(minPane, Math.min(total - minPane, total * safeRatio));
  const rightWidth = total - leftWidth;

  leftWrap.style.flex = `0 0 ${leftWidth}px`;
  rightWrap.style.flex = `0 0 ${rightWidth}px`;

  requestAnimationFrame(refreshFullscreenSplitEditors);
  if (persist) localStorage.setItem(LS_FULLSCREEN_SPLIT, String(leftWidth / total));
}

function restoreFullscreenSplitRatio() {
  const saved = Number(localStorage.getItem(LS_FULLSCREEN_SPLIT));
  const ratio = Number.isFinite(saved) && saved > 0.12 && saved < 0.88 ? saved : 0.5;
  setFullscreenSplitRatio(ratio);
}

(function initFullscreenSplitResize() {
  const divider = r.fsSplitDivider;
  if (!divider) return;

  let dragging = false;
  let startX = 0;
  let startLeftWidth = 0;

  const finishDrag = () => {
    if (!dragging) return;
    dragging = false;
    divider.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    const body = $('fsEditorBody');
    const total = body ? body.clientWidth - divider.offsetWidth : 0;
    if (total > 0 && r.fullscreenCmWrap) {
      localStorage.setItem(LS_FULLSCREEN_SPLIT, String(r.fullscreenCmWrap.offsetWidth / total));
    }
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', finishDrag);
    window.removeEventListener('blur', finishDrag);
    refreshFullscreenSplitEditors();
  };

  function onMove(ev) {
    if (!dragging) return;
    const body = $('fsEditorBody');
    if (!body) return;
    const total = body.clientWidth - divider.offsetWidth;
    if (total <= 0) return;
    setFullscreenSplitRatio((startLeftWidth + ev.clientX - startX) / total);
  }

  divider.addEventListener('mousedown', e => {
    if (!fsSplitActive || r.fullscreenCmWrapSplit?.classList.contains('hidden')) return;
    dragging = true;
    startX = e.clientX;
    startLeftWidth = r.fullscreenCmWrap?.getBoundingClientRect().width || 0;
    divider.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', finishDrag);
    window.addEventListener('blur', finishDrag);
    e.preventDefault();
  });

  divider.addEventListener('dblclick', () => {
    if (!fsSplitActive || r.fullscreenCmWrapSplit?.classList.contains('hidden')) return;
    setFullscreenSplitRatio(0.5, true);
    toast('Ширина fullscreen split сброшена 50/50', 'info', 1400);
  });

  window.addEventListener('resize', debounce(() => {
    if (fsSplitActive && !r.fullscreenOverlay?.classList.contains('hidden')) {
      restoreFullscreenSplitRatio();
    }
  }, 120));
})();

// ── Fullscreen file tabs ───────────────────────────────────────────
let _fsActiveFile = null;  // Track which file is active in fullscreen

function fsFileName(filePath, fallback = 'Файл') {
  return filePath ? filePath.split('/').pop() : fallback;
}

function fsFileDotColor(filePathOrExt) {
  const ext = (filePathOrExt || '').includes('.')
    ? filePathOrExt.split('.').pop().toLowerCase()
    : String(filePathOrExt || '').toLowerCase();
  if (ext === 'pug' || ext === 'jade') return '#f97316';
  if (ext === 'styl' || ext === 'css') return '#22c55e';
  return '#3b82f6';
}

function hideFsPaneMenus() {
  r.fsLeftFileMenu?.classList.add('hidden');
  r.fsRightFileMenu?.classList.add('hidden');
}

async function saveFullscreenLeftFileIfNeeded(nextFilePath = null) {
  const ctx = state.srcCtx;
  if (!ctx || !cmFullscreen || !_fsActiveFile || _fsActiveFile === nextFilePath) return;
  try {
    await fetch('/api/wb/email-file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brand: ctx.brand, mail: ctx.mail, file: _fsActiveFile, content: cmFullscreen.getValue() }),
    });
  } catch {}
}

async function saveFullscreenSplitFileIfNeeded(nextFilePath = null) {
  if (!cmFullscreenSplit || !_fsSplitActiveFile || _fsSplitActiveFile === nextFilePath) return;
  try {
    await fetch('/api/wb/save-source', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath: _fsSplitActiveFile, content: cmFullscreenSplit.getValue() }),
    });
  } catch {}
}

function renderFsPaneFileMenus() {
  const ctx = state.srcCtx;
  const plainFiles = state.files || [];
  const hasFiles = !!ctx || plainFiles.length > 0;
  const showLeft = hasFiles;
  const showRight = hasFiles && fsSplitActive && !r.fullscreenCmWrapSplit?.classList.contains('hidden');

  if (r.fsLeftPaneToolbar) r.fsLeftPaneToolbar.style.display = showLeft ? '' : 'none';
  if (r.fsRightPaneToolbar) r.fsRightPaneToolbar.style.display = showRight ? '' : 'none';
  if (!hasFiles) {
    hideFsPaneMenus();
    return;
  }

  if (r.fsLeftFileLabel) {
    const plain = plainFiles.find(f => f.id === state.activeFileId);
    const label = ctx
      ? ((!_fsActiveFile && ctx.viewingCompiledHtml) ? 'Compiled HTML' : fsFileName(_fsActiveFile || ctx.activeFile))
      : (plain?.name || 'Файл');
    r.fsLeftFileLabel.textContent = label;
  }
  if ($('fsSplitLabel')) {
    const plainRight = splitState.rightFile?.kind === 'plain'
      ? state.files.find(f => f.id === splitState.rightFile.id)
      : null;
    $('fsSplitLabel').textContent = _fsSplitActiveFile
      ? fsFileName(_fsSplitActiveFile)
      : (plainRight?.name || 'Выбрать файл');
  }

  const buildMenu = (menu, pane) => {
    if (!menu) return;
    menu.innerHTML = '';
    const activePath = pane === 'left' ? (_fsActiveFile || ctx?.activeFile || state.activeFileId) : (_fsSplitActiveFile || splitState.rightFile?.id);
    const options = ctx
      ? (ctx.files || []).map(f => ({ ...f, kind: 'source', label: fsFileName(f.path), key: f.path }))
      : plainFiles.map(f => ({ kind: 'plain', id: f.id, label: f.name || 'email.html', ext: 'html', key: f.id }));
    options.forEach(f => {
      const row = document.createElement('button');
      const fname = f.label;
      row.className = 'fs-pane-menu-item' + (f.key === activePath ? ' active' : '');
      row.title = f.path || f.label;
      row.innerHTML = `<span class="fs-tab-dot" style="background:${fsFileDotColor(f.ext || f.path)}"></span><span>${escapeHtml(fname)}</span>`;
      row.addEventListener('click', () => {
        hideFsPaneMenus();
        if (f.kind === 'source') {
          if (pane === 'left') loadFileIntoFullscreen(f.path);
          else loadFileIntoFsSplit(f.path);
        } else {
          const file = state.files.find(x => x.id === f.id);
          if (!file) return;
          if (pane === 'left') {
            activateFile(file.id);
            cmFullscreen?.setOption('mode', 'htmlmixed');
            cmFullscreen?.setOption('readOnly', false);
            cmFullscreen?.setValue(file.html || '');
            if (r.fullscreenFilename) r.fullscreenFilename.textContent = file.name || 'email.html';
          } else if (cmFullscreenSplit) {
            cmFullscreenSplit.setOption('mode', 'htmlmixed');
            cmFullscreenSplit.setOption('readOnly', false);
            cmFullscreenSplit.setValue(file.html || '');
            splitState.rightFile = { kind: 'plain', id: file.id };
            if ($('fsSplitLabel')) $('fsSplitLabel').textContent = file.name || 'email.html';
          }
          renderFsPaneFileMenus();
        }
      });
      menu.appendChild(row);
    });

    if (pane === 'left' && ctx?.compiledHtml) {
      const htmlRow = document.createElement('button');
      htmlRow.className = 'fs-pane-menu-item fs-pane-menu-html' + (!_fsActiveFile && ctx.viewingCompiledHtml ? ' active' : '');
      htmlRow.innerHTML = `<span class="fs-tab-dot" style="background:var(--accent, #2563eb)"></span><span>Compiled HTML</span>`;
      htmlRow.addEventListener('click', async () => {
        await saveFullscreenLeftFileIfNeeded(null);
        hideFsPaneMenus();
        _fsActiveFile = null;
        cmFullscreen?.setValue(ctx.compiledHtml);
        cmFullscreen?.setOption('readOnly', true);
        cmFullscreen?.setOption('mode', 'htmlmixed');
        if (r.fullscreenFilename) r.fullscreenFilename.textContent = `${ctx.mail.replace(/^mail-/,'')} / Compiled HTML`;
        if (r.fsModeChip) r.fsModeChip.textContent = 'HTML';
        renderFsFileTabs();
      });
      menu.appendChild(htmlRow);
    }
  };

  buildMenu(r.fsLeftFileMenu, 'left');
  buildMenu(r.fsRightFileMenu, 'right');
}

function toggleFsPaneMenu(pane, e) {
  e?.stopPropagation();
  const menu = pane === 'left' ? r.fsLeftFileMenu : r.fsRightFileMenu;
  if (!menu || (!state.srcCtx && !state.files.length)) return;
  const wasHidden = menu.classList.contains('hidden');
  hideFsPaneMenus();
  if (wasHidden) menu.classList.remove('hidden');
}

r.fsLeftFileBtn?.addEventListener('click', e => toggleFsPaneMenu('left', e));
r.fsRightFileBtn?.addEventListener('click', e => toggleFsPaneMenu('right', e));
r.fsLeftCloseBtn?.addEventListener('click', () => { if (fsSplitActive) toggleFsSplit(); else closeFullscreen(); });
r.fsRightCloseBtn?.addEventListener('click', () => { if (fsSplitActive) toggleFsSplit(); });
document.addEventListener('click', e => {
  if (!e.target.closest?.('.fs-pane-toolbar')) hideFsPaneMenus();
});

function renderFsFileTabs() {
  const ft = r.fsFileTabs;
  if (!ft) return;
  ft.innerHTML = '';
  const ctx = state.srcCtx;

  // Show/hide file picker based on context
  if (r.fsFilePickerWrap) {
    r.fsFilePickerWrap.style.display = ctx ? '' : 'none';
  }
  renderFsPaneFileMenus();

  if (!ctx) return;

  // Populate dropdown with ALL source files
  if (r.fsFilePickerDropdown && ctx.files) {
    r.fsFilePickerDropdown.innerHTML = '';
    const curFile = _fsActiveFile || ctx.activeFile;

    const makePickerRow = (label, dotColor, onMain, onSplit, isActive) => {
      const row = document.createElement('div');
      row.className = 'fs-picker-row' + (isActive ? ' active' : '');
      // Main click area (filename)
      const mainBtn = document.createElement('button');
      mainBtn.className = 'fs-picker-item-label';
      mainBtn.innerHTML = dotColor
        ? `<span class="fs-tab-dot" style="background:${dotColor}"></span>${escapeHtml(label)}`
        : escapeHtml(label);
      mainBtn.addEventListener('click', () => {
        r.fsFilePickerDropdown.classList.add('hidden');
        onMain();
      });
      row.appendChild(mainBtn);
      // Split button
      const splitBtn = document.createElement('button');
      splitBtn.className = 'fs-picker-split-btn';
      splitBtn.title = 'Открыть во втором редакторе (Split)';
      splitBtn.innerHTML = `<svg width="11" height="11" viewBox="0 0 14 14" fill="none"><rect x="1" y="1" width="5" height="12" rx="1" stroke="currentColor" stroke-width="1.3"/><rect x="8" y="1" width="5" height="12" rx="1" stroke="currentColor" stroke-width="1.3"/></svg>`;
      splitBtn.addEventListener('click', e => {
        e.stopPropagation();
        r.fsFilePickerDropdown.classList.add('hidden');
        onSplit();
      });
      row.appendChild(splitBtn);
      return row;
    };

    ctx.files.forEach(f => {
      const fname = f.path.split('/').pop();
      const ext = f.ext || fname.split('.').pop();
      const dotColor = (ext === 'pug' || ext === 'jade') ? '#f97316' : ext === 'styl' ? '#22c55e' : '#3b82f6';
      const row = makePickerRow(
        fname, dotColor,
        () => loadFileIntoFullscreen(f.path),
        () => loadFileIntoFsSplit(f.path),
        f.path === curFile
      );
      r.fsFilePickerDropdown.appendChild(row);
    });

    // HTML option
    if (ctx.compiledHtml) {
      const row = makePickerRow(
        'Compiled HTML', null,
        () => {
          _fsActiveFile = null;
          cmFullscreen?.setValue(ctx.compiledHtml);
          cmFullscreen?.setOption('readOnly', true);
          cmFullscreen?.setOption('mode', 'htmlmixed');
          renderFsFileTabs();
        },
        () => { /* compiled HTML in split — read-only preview */ },
        !_fsActiveFile && ctx.viewingCompiledHtml
      );
      row.querySelector('.fs-picker-item-label').style.color = 'var(--accent, #2563eb)';
      r.fsFilePickerDropdown.appendChild(row);
    }
  }


  (ctx.openedFiles || []).forEach(filePath => {
    const f = ctx.files.find(ff => ff.path === filePath);
    if (!f) return;
    const fname = filePath.split('/').pop();
    const isActive = (_fsActiveFile || ctx.activeFile) === filePath;
    const ext = f.ext || fname.split('.').pop();
    const dotColor = (ext === 'pug' || ext === 'jade') ? '#f97316' : ext === 'styl' ? '#22c55e' : '#3b82f6';
    const tabWrap = document.createElement('div');
    tabWrap.className = 'fs-tab-wrap';
    const tab = document.createElement('button');
    tab.className = 'fs-tab' + (isActive ? ' active' : '');
    tab.innerHTML = `<span class="fs-tab-dot" style="background:${dotColor}"></span>${escapeHtml(fname)}`;
    tab.title = filePath + ' (клик = открыть в главном редакторе)';
    tab.addEventListener('click', () => loadFileIntoFullscreen(filePath));
    tabWrap.appendChild(tab);
    // Split button on each tab
    const splitTabBtn = document.createElement('button');
    splitTabBtn.className = 'fs-tab-split-btn' + (_fsSplitActiveFile === filePath ? ' active' : '');
    splitTabBtn.title = 'Открыть в правом редакторе (Split)';
    splitTabBtn.innerHTML = `<svg width="10" height="10" viewBox="0 0 14 14" fill="none"><rect x="1" y="1" width="5" height="12" rx="1" stroke="currentColor" stroke-width="1.3"/><rect x="8" y="1" width="5" height="12" rx="1" stroke="currentColor" stroke-width="1.3"/></svg>`;
    splitTabBtn.addEventListener('click', e => { e.stopPropagation(); loadFileIntoFsSplit(filePath); });
    tabWrap.appendChild(splitTabBtn);
    ft.appendChild(tabWrap);
  });

  // HTML badge
  if (ctx.compiledHtml) {
    const htmlBadge = document.createElement('button');
    const isHtmlActive = state.srcCtx?.viewingCompiledHtml;
    htmlBadge.className = 'fs-tab fs-tab-html' + (isHtmlActive ? ' active' : '');
    htmlBadge.innerHTML = `<svg width="8" height="8" viewBox="0 0 12 12" fill="none"><path d="M1 1l4 5-4 5h2l4-5-4-5z" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M7 1l4 5-4 5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg> HTML`;
    htmlBadge.addEventListener('click', () => {
      if (ctx.compiledHtml) {
        _fsActiveFile = null;
        cmFullscreen?.setValue(ctx.compiledHtml);
        cmFullscreen?.setOption('readOnly', true);
        renderFsFileTabs();
      }
    });
    ft.appendChild(htmlBadge);
  }
}

async function loadFileIntoFullscreen(filePath) {
  const ctx = state.srcCtx;
  if (!ctx || !cmFullscreen) return;
  try {
    await saveFullscreenLeftFileIfNeeded(filePath);
    const res = await fetch(`/api/wb/email-file?brand=${encodeURIComponent(ctx.brand)}&mail=${encodeURIComponent(ctx.mail)}&file=${encodeURIComponent(filePath)}`);
    const data = await res.json();
    if (!data.ok) return;
    _fsActiveFile = filePath;
    const ext = filePath.split('.').pop().toLowerCase();
    const modeMap = { pug: 'pug-with-placeholders', jade: 'pug-with-placeholders', styl: 'css-with-placeholders', css: 'css-with-placeholders', html: 'html-with-placeholders', htm: 'html-with-placeholders' };
    cmFullscreen.setOption('mode', modeMap[ext] || 'htmlmixed');
    cmFullscreen.setOption('readOnly', false);
    cmFullscreen.setValue(data.content || '');
    if (r.fullscreenFilename) r.fullscreenFilename.textContent = `${ctx.mail.replace(/^mail-/, '')} / ${filePath.split('/').pop()}`;
    const chipMap = { pug: 'Pug', jade: 'Pug', styl: 'Stylus', css: 'CSS', html: 'HTML' };
    if (r.fsModeChip) r.fsModeChip.textContent = chipMap[ext] || 'HTML';
    renderFsFileTabs();
    updateFullscreenStats();
    cmFullscreen.focus();
  } catch {}
}

async function loadFileIntoFsSplit(filePath) {
  await saveFullscreenSplitFileIfNeeded(filePath);
  // Open the split pane if not already open
  if (!fsSplitActive) {
    fsSplitActive = true;
    $('fsSplitBtn')?.classList.add('fsSplitBtn-active');
    r.fsSplitDivider?.classList.remove('hidden');
    r.fullscreenCmWrapSplit?.classList.remove('hidden');
    restoreFullscreenSplitRatio();
  }
  const ctx = state.srcCtx;

  // Init cmFullscreenSplit if needed
  if (!cmFullscreenSplit) {
    cmFullscreenSplit = CodeMirror.fromTextArea($('fullscreenEditorSplit'), {
      theme: state.theme === 'dark' ? 'material-darker' : 'default',
      lineNumbers: true,
      lineWrapping: state.wrapMode,
      tabSize: 2, indentUnit: 2, indentWithTabs: false,
      scrollbarStyle: 'native',
      gutters: ['CodeMirror-linenumbers'],
      extraKeys: {
        'Tab': ed => ed.replaceSelection('  '),
        'Cmd-F': ed => openFindBar(ed),
        'Ctrl-F': ed => openFindBar(ed),
        'Cmd-H': ed => openFindBar(ed, { focusReplace: true }),
        'Ctrl-H': ed => openFindBar(ed, { focusReplace: true }),
      },
    });
    cmFullscreenSplit.on('change', debounce(async () => {
      if (!_fsSplitActiveFile || !state.srcCtx) return;
      try {
        await fetch('/api/wb/save-source', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filePath: _fsSplitActiveFile, content: cmFullscreenSplit.getValue() })
        });
      } catch {}
    }, 1200));
  }

  // Load file into split
  try {
    const source = ctx
      ? await fetch(`/api/wb/email-file?brand=${encodeURIComponent(ctx.brand)}&mail=${encodeURIComponent(ctx.mail)}&file=${encodeURIComponent(filePath)}`).then(r => r.json())
      : await fetch(`/api/wb/source-file?path=${encodeURIComponent(filePath)}`).then(r => r.json());
    if (!source.ok) return;
    _fsSplitActiveFile = filePath;
    const ext = filePath.split('.').pop().toLowerCase();
    const modeMap = { pug: 'pug-with-placeholders', jade: 'pug-with-placeholders', styl: 'css-with-placeholders', css: 'css-with-placeholders', html: 'html-with-placeholders', htm: 'html-with-placeholders' };
    cmFullscreenSplit.setOption('mode', modeMap[ext] || 'htmlmixed');
    cmFullscreenSplit.setOption('readOnly', false);
    cmFullscreenSplit.setValue(source.content || '');
    $('fsSplitLabel').textContent = filePath.split('/').pop();
    renderFsFileTabs();
    setTimeout(() => {
      restoreFullscreenSplitRatio();
      cmFullscreen?.refresh();
      cmFullscreenSplit.refresh();
      cmFullscreenSplit.focus();
    }, 30);
  } catch(e) { toast('Ошибка открытия файла в Split', 'error'); }
}

function openFullscreen() {
  if (!cmFullscreen) {
    CodeMirror.defineMode('ph-overlay-fs', () => buildHtmlPhOverlay());
    CodeMirror.defineMode('html-with-ph-fs', cfg =>
      CodeMirror.overlayMode(CodeMirror.getMode(cfg,'htmlmixed'), CodeMirror.getMode(cfg,'ph-overlay-fs'), true)
    );
    cmFullscreen = CodeMirror.fromTextArea(document.getElementById('fullscreenEditor'), {
      mode: 'html-with-ph-fs',
      theme: state.theme === 'dark' ? 'material-darker' : 'default',
      lineNumbers: true,
      lineWrapping: state.wrapMode,
      tabSize: 2, indentUnit: 2, indentWithTabs: false,
      autofocus: true,
      scrollbarStyle: 'native',
      gutters: ['CodeMirror-linenumbers', 'cm-left-pad'],
      extraKeys: {
        'Tab': ed => ed.replaceSelection('  '),
        'Escape': closeFullscreen,
        'Cmd-F': ed => openFindBar(ed),
        'Ctrl-F': ed => openFindBar(ed),
        'Cmd-H': ed => openFindBar(ed, { focusReplace: true }),
        'Ctrl-H': ed => openFindBar(ed, { focusReplace: true }),
      },
    });
    cmFullscreen.on('change', debounce(() => {
      if (cmFullscreen?.getOption('readOnly')) return;
      if (_fsActiveFile && state.srcCtx && _fsActiveFile !== state.srcCtx.activeFile) {
        fetch('/api/wb/email-file', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ brand: state.srcCtx.brand, mail: state.srcCtx.mail, file: _fsActiveFile, content: cmFullscreen.getValue() }),
        }).catch(() => {});
        updateFullscreenStats();
        return;
      }
      if (cm) {
        _suppressSrcModified = true;
        cm.setValue(cmFullscreen.getValue());
        setTimeout(() => { _suppressSrcModified = false; }, 0);
      }
      if (state.srcCtx?.activeFile && !state.srcCtx.viewingCompiledHtml) {
        if (!_backupOffered && !state.srcCtx.modified) {
          _backupOffered = true;
          _showBackupModal(state.srcCtx.brand, state.srcCtx.mail);
        } else {
          markSourceModified(state.srcCtx);
        }
      }
      updateEditorStats();
      updateFullscreenStats();
      updatePreview();
      saveToLocalStorage();
    }, 350));
    // Minimap for fullscreen — wider since there's more screen real estate
    const fsCmWrap = $('fullscreenCmWrap');
    if (fsCmWrap) createMinimap(cmFullscreen, fsCmWrap, { width: 72 });
  }
  const file = state.files.find(f => f.id === state.activeFileId);
  const srcCtx = state.activeFileId ? null : state.srcCtx;
  const fsName = srcCtx?.activeFile
    ? `${srcCtx.mail.replace(/^mail-/,'')} / ${srcCtx.activeFile.split('/').pop()}`
    : (file ? file.name : 'editor');
  r.fullscreenFilename.textContent = fsName;
  // Set mode chip
  const modeChipMap = { pug: 'Pug', jade: 'Pug', styl: 'Stylus', css: 'CSS', html: 'HTML' };
  const activeExt = srcCtx?.activeFile?.split('.').pop() || 'html';
  if (r.fsModeChip) {
    r.fsModeChip.textContent = modeChipMap[activeExt] || state.editorType?.toUpperCase() || 'HTML';
    // Color chip based on type
    const chipColors = { Pug: '#f97316', Stylus: '#22c55e', CSS: '#22c55e', HTML: 'var(--accent)' };
    r.fsModeChip.style.color = chipColors[r.fsModeChip.textContent] || 'var(--text-3)';
  }
  r.fullscreenOverlay.classList.remove('hidden');
  // sync wrap state
  $('fsWrapBtn')?.classList.toggle('wrap-active', state.wrapMode);
  setTimeout(() => {
    if (cm) {
      cmFullscreen.setValue(cm.getValue());
      // Match mode from main editor (Pug, CSS, HTML etc.)
      const mainMode = cm.getOption('mode');
      // Map pug mode to correct fullscreen mode definition
      if (typeof mainMode === 'string' && mainMode !== 'html-with-ph-fs' && mainMode !== 'html-with-placeholders') {
        cmFullscreen.setOption('mode', mainMode);
      } else if (typeof mainMode === 'object' && mainMode?.name) {
        cmFullscreen.setOption('mode', mainMode);
      }
    }
    cmFullscreen.setOption('lineWrapping', state.wrapMode);
    cmFullscreen.setOption('readOnly', state.srcCtx?.viewingCompiledHtml ? true : false);
    cmFullscreen.refresh();
    cmFullscreen.focus();
    updateFullscreenStats();
    _fsActiveFile = state.srcCtx?.activeFile || null;
    renderFsFileTabs();
    const shouldKeepSplit = splitState.active || localStorage.getItem(LS_FS_SPLIT_ACTIVE) === '1';
    if (shouldKeepSplit && !fsSplitActive) toggleFsSplit();
    else renderFsPaneFileMenus();
  }, 30);
}

function closeFullscreen() {
  const keepNormalSplit = fsSplitActive && !splitState.active;
  const restoreRightFile = keepNormalSplit ? _fsSplitActiveFile : null;
  if (fsSplitActive && _fsSplitActiveFile) saveFullscreenSplitFileIfNeeded(null);
  if (fsSplitActive && cmFullscreenSplit && cmSplit && splitState.active && splitState.rightFile?.kind === 'plain') {
    _suppressSplitChange = true;
    cmSplit.setValue(cmFullscreenSplit.getValue());
    setTimeout(() => { _suppressSplitChange = false; }, 0);
  }
  if (fsSplitActive && cmFullscreenSplit && cmSplit && splitState.active && _fsSplitActiveFile && state.srcCtx) {
    const ext = _fsSplitActiveFile.split('.').pop().toLowerCase();
    _suppressSplitChange = true;
    cmSplit.setOption('mode', EXT_MODE[ext] || 'htmlmixed');
    cmSplit.setValue(cmFullscreenSplit.getValue());
    splitState.rightFile = { kind: 'source', path: _fsSplitActiveFile };
    if (r.cmSplitLabel) r.cmSplitLabel.textContent = _fsSplitActiveFile.split('/').pop();
    setTimeout(() => { _suppressSplitChange = false; cmSplit?.refresh(); }, 0);
  }
  if (cmFullscreen && cm && !state.srcCtx?.viewingCompiledHtml) {
    // If a different file was loaded into fullscreen, save it first
    if (_fsActiveFile && state.srcCtx && _fsActiveFile !== state.srcCtx.activeFile) {
      // Save the fullscreen content back to the fs-active file via API, then reload main editor
      const fsContent = cmFullscreen.getValue();
      const ctx = state.srcCtx;
      const ext = _fsActiveFile.split('.').pop().toLowerCase();
      const mode = EXT_MODE[ext] || 'htmlmixed';
      ctx.activeFile = _fsActiveFile;
      ctx.modified = false;
      ctx.viewingCompiledHtml = false;
      state.activeFileId = null;
      state.editorType = ext === 'styl' ? 'stylus' : (ext === 'pug' || ext === 'jade' ? 'pug' : 'html');
      _suppressSrcModified = true;
      cm.setOption('readOnly', false);
      cm.setValue(fsContent);
      cm.setOption('mode', mode);
      setTimeout(() => { _suppressSrcModified = false; }, 0);
      document.querySelectorAll('.etype-tab').forEach(t =>
        t.classList.toggle('active', t.dataset.etype === state.editorType)
      );
      r.saveSourceBtn?.classList.remove('hidden');
      r.compiledViewBanner?.classList.add('hidden');
      renderSrcFileTabs();
      renderEtypeFilesDropdown();
      renderSplitPaneControls();
      saveToLocalStorage();
      fetch('/api/wb/email-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brand: ctx.brand, mail: ctx.mail, file: _fsActiveFile, content: fsContent }),
      }).then(() => rebuildSourceEmail()).catch(() => {});
    } else {
      // Same file — sync back normally
      _suppressSrcModified = true;
      cm.setValue(cmFullscreen.getValue());
      setTimeout(() => { _suppressSrcModified = false; }, 0);
      updatePreview();
      saveToLocalStorage();
    }
  }
  _fsActiveFile = null;
  r.fullscreenOverlay.classList.add('hidden');
  $('findBar')?.classList.remove('find-floating');
  if (keepNormalSplit) setTimeout(() => {
    toggleSplitView();
    if (restoreRightFile && state.srcCtx) {
      const opt = getSplitFileOptions().find(o => o.kind === 'source' && o.path === restoreRightFile);
      if (opt) setTimeout(() => loadSplitFileIntoPane('right', opt), 80);
    }
  }, 0);
}

// ═══════════════════════════════════════════════════════════════
// FILE LOADING (HTML)
// ═══════════════════════════════════════════════════════════════

function openFiles(fileList) {
  [...fileList].forEach(file => {
    const reader = new FileReader();
    reader.onload = e => {
      const id = `f-${uid()}`;
      const fo = { id, name: file.name, html: e.target.result };
      state.files.push(fo);
      renderFileTab(fo);
      activateFile(id);
      saveToLocalStorage();
    };
    reader.readAsText(file);
  });
}

function renderFileTab(fo) {
  r.fileTabs.querySelector('[data-file-id="__empty__"]')?.remove();
  const tab = document.createElement('div');
  tab.className = 'file-tab';
  tab.dataset.fileId = fo.id;
  tab.innerHTML = `
    <span class="file-tab-name">${escapeHtml(fo.name)}</span>
    <button class="file-tab-close" title="Закрыть">
      <svg width="10" height="10" viewBox="0 0 10 10">
        <path d="M2 2l6 6M8 2L2 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      </svg>
    </button>`;
  tab.addEventListener('click', e => {
    if (e.target.closest('.file-tab-close')) closeFile(fo.id);
    else activateFile(fo.id);
  });
  r.fileTabs.appendChild(tab);
}

function activateFile(id) {
  state.activeFileId = id;
  const file = state.files.find(f => f.id === id);
  if (!file) return;
  if (state.srcCtx) state.srcCtx.viewingCompiledHtml = true;
  r.fileTabs.querySelectorAll('.file-tab').forEach(t =>
    t.classList.toggle('active', t.dataset.fileId === id)
  );
  if (cm) {
    cm.setOption('readOnly', false);
    cm.setValue(file.html);
    cm.setOption('mode', 'htmlmixed');
    cm.refresh();
  }
  r.previewEmpty.classList.add('hidden');
  // Show minify button for plain HTML files
  if (!state.srcCtx) {
    r.minifyBtn?.classList.remove('hidden');
    if (r.minifyBtn) {
      r.minifyBtn.textContent = 'Форматировать';
      r.minifyBtn.title = 'Форматировать / минифицировать HTML';
    }
    _compiledViewMinified = false;
    r.compiledViewBanner?.classList.add('hidden');
    r.saveSourceBtn?.classList.add('hidden');
    r.convertBtn?.classList.add('hidden');
  }
  updateEditorStats();
  updatePreview();
  renderSplitPaneControls();
}

// Двусторонняя синхронизация код↔вкладка: если редактор очищен полностью
// (для обычного HTML-файла, не для исходников email-base), закрываем его
// вкладку и показываем «Без файла» — зеркально к закрытию вкладки крестиком,
// которое очищает редактор.
function maybeCloseTabOnEmptyEditor() {
  if (!cm) return;
  if (state.srcCtx) return;                 // режим исходников email-base — не трогаем
  if (state.activeLocale && state.activeLocale !== 'original') return; // показан перевод, не источник
  if (!state.activeFileId) return;          // вкладки нет — нечего закрывать
  const val = cm.getValue();
  if (val.trim() !== '') return;            // ещё есть содержимое — вкладку не трогаем
  const id = state.activeFileId;
  closeFile(id);
}

function closeFile(id) {
  state.files = state.files.filter(f => f.id !== id);
  r.fileTabs.querySelector(`[data-file-id="${id}"]`)?.remove();
  if (state.activeFileId === id) {
    // Закрываем активный файл — сбрасываем локаль на Original и бэкап источника,
    // чтобы стэйл-бэкап другого/закрытого файла не «возвращался» в редактор.
    state.activeLocale = 'original';
    _originalEditorBackup = null;
    if (state.files.length) {
      activateFile(state.files[state.files.length - 1].id);
      renderLocalesBar();
    } else {
      state.activeFileId = null;
      if (state.srcCtx) {
        // Email base context still active — restore its view (compiled HTML or active source file)
        if (state.srcCtx.viewingCompiledHtml && state.srcCtx.compiledHtml) {
          showCompiledHtml();
        } else if (state.srcCtx.activeFile) {
          loadSourceFile(state.srcCtx.activeFile);
        } else if (state.srcCtx.compiledHtml) {
          showCompiledHtml();
        }
      } else {
        // Локаль/бэкап уже сброшены выше — теперь чистим редактор без «возврата».
        if (cm) { cm.setOption('readOnly', false); cm.setValue(''); }
        r.compiledViewBanner?.classList.add('hidden');
        r.previewEmpty.classList.remove('hidden');
        renderLocalesBar();
        // Clear preview iframe
        try {
          const doc = r.previewFrame.contentDocument || r.previewFrame.contentWindow?.document;
          if (doc) { doc.open(); doc.write(''); doc.close(); }
        } catch {}
      }
      renderSrcFileTabs?.();
      updateEditorStats();
      const tab = document.createElement('div');
      tab.className = 'file-tab active';
      tab.dataset.fileId = '__empty__';
      tab.innerHTML = '<span class="file-tab-name">Без файла</span>';
      r.fileTabs.appendChild(tab);
    }
  }
  saveToLocalStorage();
}

r.openFileBtn.addEventListener('click', () => r.fileInput.click());
r.openFileBtn2?.addEventListener('click', () => r.fileInput.click());
r.fileInput.addEventListener('change', e => {
  if (e.target.files.length) { openFiles(e.target.files); e.target.value = ''; }
});

// ═══════════════════════════════════════════════════════════════
// LOCALE CODE EXTRACTION
// ═══════════════════════════════════════════════════════════════

// Known language codes (2-letter ISO + some 3-letter)
const LANG_CODES = [
  'ar','az','bg','bn','cs','da','de','el','en','es','et','fa','fi','fr',
  'he','hi','hl','hr','hu','id','it','ja','ka','kk','ko','lt','lv','mk','ms',
  'nl','no','pl','pt','ro','ru','sk','sl','sq','sr','sv','th','tl','tr',
  'uk','ur','uz','vi','zh',
];

/**
 * Extract a short locale code from a filename like:
 *   10651_TR_TR_APPROVED.txt → tr
 *   10651_ZH_CN_APPROVED.txt → zh_cn
 *   en_US.txt → en
 *   email_DE.txt → de
 */
function extractLocaleCode(filename) {
  const base = filename.replace(/\.txt$/i, '').toLowerCase();

  // Pattern: {number}_{LANG}_{COUNTRY}_{STATUS} e.g. 10587_ar_KW_approved
  // Take ONLY the language part (first 2-letter group after the number)
  const m1 = base.match(/^\d+_([a-z]{2})_[a-z]{2,3}(?:_|$)/);
  if (m1 && LANG_CODES.includes(m1[1])) return m1[1];

  // Pattern: starts with lang-country or lang_country
  const m2 = base.match(/^([a-z]{2})[-_][a-z]{2,3}(?:[-_]|$)/);
  if (m2 && LANG_CODES.includes(m2[1])) return m2[1];

  // Look for a known 2-letter code surrounded by separators
  for (const code of LANG_CODES) {
    const re = new RegExp(`(?:^|[_\\-])${code}(?:[_\\-]|$)`, 'i');
    if (re.test(base)) return code;
  }

  // Fallback: everything before first underscore/dash or full base
  const m3 = base.match(/^([a-z]+)/);
  return m3 ? m3[1] : base;
}

// ═══════════════════════════════════════════════════════════════
// TXT PARSING
// ═══════════════════════════════════════════════════════════════

function textLineCol(text, index) {
  const head = String(text || '').slice(0, Math.max(0, index));
  const lines = head.split('\n');
  return { line: lines.length, col: (lines[lines.length - 1] || '').length + 1 };
}

function findTxtDelimiterIssues(text) {
  const source = String(text || '');
  const issues = [];
  const stack = [];
  const re = /\{\{|\}\}/g;
  let m;
  while ((m = re.exec(source))) {
    if (m[0] === '{{') {
      stack.push(m.index);
    } else if (stack.length) {
      stack.pop();
    } else {
      const pos = textLineCol(source, m.index);
      issues.push({ type: 'extra_close', severity: 'error', line: pos.line, col: pos.col, message: 'Лишний закрывающий }} без открывающего {{' });
    }
  }
  stack.forEach(index => {
    const pos = textLineCol(source, index);
    issues.push({ type: 'unclosed_open', severity: 'error', line: pos.line, col: pos.col, message: 'Незакрытый блок {{ без }}' });
  });
  return issues;
}

function parseTxtDetailed(text) {
  const normalized = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const issues = findTxtDelimiterIssues(normalized);
  const blocks = [];
  const re = /\{\{([\s\S]*?)\}\}/g;
  let m;
  let blockIndex = 0;
  while ((m = re.exec(normalized)) !== null) {
    const rawInner = m[1];
    const b = rawInner.trim();
    const pos = textLineCol(normalized, m.index);
    blocks.push(b);
    if (b) {
      // Конвенция: системные переменные ({{embedded.x}}, {{user_name}}) не живут
      // ВНУТРИ текстовых блоков. После ленивого парса вложенная переменная
      // выглядит как незакрытая "{{name" внутри текста блока.
      if (/\{\{/.test(b)) {
        issues.push({
          type: 'nested_variable',
          severity: 'error',
          block: blockIndex,
          line: pos.line,
          col: pos.col,
          message: `Переменная {{...}} внутри block_${PH_NUM(blockIndex)} — нажми «Авточинить»: блок разобьётся по конвенции ({{текст}} {{переменная}}{{хвост}})`,
        });
      }
      const boldMarkers = (b.match(/@@/g) || []).length;
      if (boldMarkers % 2 !== 0) {
        issues.push({
          type: 'unbalanced_bold',
          severity: 'warn',
          block: blockIndex,
          line: pos.line,
          col: pos.col,
          message: `Нечётное количество @@ в block_${PH_NUM(blockIndex)}`,
        });
      }
    }
    // Empty blocks are intentional spacers (used to align block counts across
    // locales). We do NOT push a warning — only the block index advances.
    blockIndex += 1;
  }

  // Конвенция: строка "Subject: ..." — служебная (для админки), живёт вне блоков.
  const outsideRaw = normalized.replace(/\{\{[\s\S]*?\}\}/g, '');
  const outside = outsideRaw
    .split('\n')
    .filter(line => !/^\s*subject\s*:/i.test(line))
    .join('\n')
    .trim();
  if (outside) {
    const firstOutside = normalized.indexOf(outside.slice(0, Math.min(outside.length, 24)));
    const pos = textLineCol(normalized, firstOutside >= 0 ? firstOutside : 0);
    issues.push({
      type: 'text_outside_blocks',
      severity: blocks.length ? 'warn' : 'info',
      line: pos.line,
      col: pos.col,
      message: blocks.length ? 'Есть текст вне {{}} блоков' : 'Не найдено закрытых {{}} блоков, текст сохранён как внеблочный',
    });
  }

  if (!blocks.length) {
    return { raw: normalized, blocks: [], issues, fallback: true };
  }

  return { raw: normalized, blocks, issues, fallback: false };
}

function parseTxt(text) {
  return parseTxtDetailed(text).blocks;
}

function serializeTxt(blocks) {
  return blocks.map(b => `{{${b}}}`).join('\n\n');
}

function parseTextareaBlocks(text) { return parseTxt(text); }

function ensureLocaleMeta(ns) {
  if (!ns) return;
  if (!ns.localeRaw || typeof ns.localeRaw !== 'object') ns.localeRaw = {};
  if (!ns.localeIssues || typeof ns.localeIssues !== 'object') ns.localeIssues = {};
}

function setLocaleRawContent(ns, localeCode, rawText) {
  ensureLocaleMeta(ns);
  const parsed = parseTxtDetailed(rawText);
  ns.locales[localeCode] = parsed.blocks;
  ns.localeRaw[localeCode] = parsed.raw;
  ns.localeIssues[localeCode] = parsed.issues;
  return parsed;
}

function syncLocaleRawFromBlocks(ns, localeCode) {
  ensureLocaleMeta(ns);
  const raw = serializeTxt(ns.locales[localeCode] || []);
  ns.localeRaw[localeCode] = raw;
  ns.localeIssues[localeCode] = parseTxtDetailed(raw).issues;
}

// ═══════════════════════════════════════════════════════════════
// NAMESPACE MANAGEMENT
// ═══════════════════════════════════════════════════════════════

function getNs(id) { return state.namespaces.find(n => n.id === id); }

function importFilesIntoNamespace(fileList, nsName) {
  let ns = state.namespaces.find(n => n.name === nsName);
  if (!ns) {
    ns = { id: `ns-${uid()}`, name: nsName, locales: {} };
    state.namespaces.push(ns);
  }

  let loaded = 0;
  const total = [...fileList].filter(f => /\.txt$/i.test(f.name)).length;
  if (!total) return;

  let rejected = 0;
  [...fileList].filter(f => /\.txt$/i.test(f.name)).forEach(file => {
    const localeCode = extractLocaleCode(file.name);
    const reader = new FileReader();
    reader.onload = e => {
      const content = e.target.result;
      // STRICT VALIDATION — reject garbage uploads with a clear reason.
      // Falls back to permissive behavior if validator script isn't loaded.
      if (typeof window.LocaleValidator !== 'undefined') {
        const v = window.LocaleValidator.validate(content, file.name);
        if (!v.ok) {
          rejected++;
          toast(`✗ ${file.name}: ${v.reason}`, 'error', 4500);
          loaded++;
          if (loaded === total) finishImport();
          return;
        }
        if (v.note) toast(`⚠ ${file.name}: ${v.note}`, 'warning', 4500);
      }
      setLocaleRawContent(ns, localeCode, content);
      loaded++;
      if (loaded === total) finishImport();
    };

    function finishImport() {
      renderLocalesBar();
      renderNamespaceBar();
      const mismatches = checkBlockMismatches(ns);
      if (mismatches.length) showMismatchModal(mismatches, ns.name);
      else validateLocales();
      saveToLocalStorage();
      const ok = total - rejected;
      if (ok > 0 && rejected === 0) {
        toast(`"${nsName}" — ${ok} файлов загружено`, 'success');
      } else if (ok > 0 && rejected > 0) {
        toast(`"${nsName}" — ${ok} загружено, ${rejected} отвергнуто`, 'warning', 4000);
      } else {
        toast(`"${nsName}" — все ${rejected} файлов отвергнуты валидатором`, 'error', 4500);
      }
    }
    reader.readAsText(file, 'utf-8');
  });
}

// ─── Load menu ──────────────────────────────────────────────────
let loadMenuOpen = false;

r.loadLocalesBtn.addEventListener('click', e => {
  e.stopPropagation();
  loadMenuOpen = !loadMenuOpen;
  r.loadMenu.classList.toggle('hidden', !loadMenuOpen);
});
document.addEventListener('click', () => {
  if (loadMenuOpen) { loadMenuOpen = false; r.loadMenu.classList.add('hidden'); }
});
r.loadFolderBtn.addEventListener('click', () => {
  r.loadMenu.classList.add('hidden'); loadMenuOpen = false; r.folderInput.click();
});
r.loadFilesBtn.addEventListener('click', () => {
  r.loadMenu.classList.add('hidden'); loadMenuOpen = false; r.filesInput.click();
});

r.folderInput.addEventListener('change', e => {
  const files = [...e.target.files].filter(f => /\.txt$/i.test(f.name));
  if (!files.length) return;
  const firstPath = files[0].webkitRelativePath || files[0].name;
  const nsName = firstPath.includes('/') ? firstPath.split('/')[0] : firstPath.replace(/\.txt$/i,'');
  importFilesIntoNamespace(files, nsName);
  e.target.value = '';
});

r.filesInput.addEventListener('change', e => {
  const files = [...e.target.files].filter(f => /\.txt$/i.test(f.name));
  if (!files.length) return;
  const nsName = files.length === 1 ? files[0].name.replace(/\.txt$/i,'') : 'locales';
  importFilesIntoNamespace(files, nsName);
  e.target.value = '';
});

function deleteNamespace(nsId) {
  const ns = state.namespaces.find(n => n.id === nsId);
  if (ns && ns.builtin) {
    toast('Встроенный namespace нельзя удалить', 'warning', 2500);
    return;
  }
  if (!confirm('Удалить namespace и все его локали?')) return;
  state.namespaces = state.namespaces.filter(n => n.id !== nsId);
  renderLocalesBar();
  renderNamespaceBar();
  validateLocales();
  saveToLocalStorage();
  toast('Namespace удалён', 'success');
}

// ═══════════════════════════════════════════════════════════════
// BLOCK MISMATCH CHECK & MODAL
// ═══════════════════════════════════════════════════════════════

function checkBlockMismatches(ns) {
  const codes = Object.keys(ns.locales);
  if (codes.length < 2) return [];
  const refCode = codes.find(c => c.startsWith('en')) || codes[0];
  const refN = ns.locales[refCode].length;
  const issues = [];
  codes.forEach(code => {
    if (code === refCode) return;
    const n = ns.locales[code].length;
    if (n !== refN) {
      issues.push({ code, n, refCode, refN, diff: n - refN });
    }
  });
  return issues;
}

function localeTextStats(block) {
  const text = String(block || '');
  return {
    boldMarkers: (text.match(/@@/g) || []).length,
    urls: (text.match(/https?:\/\/[^\s<>"')]+/g) || []).length,
    htmlTags: (text.match(/<\/?[a-z][^>]*>/gi) || []).length,
    placeholders: (text.match(/\$\{\{[^}]+?\}\}\$/g) || []).length,
  };
}

function collectLocaleAuditDiagnostics(ns) {
  if (!ns) return [];
  ensureLocaleMeta(ns);
  const refCode = getReferenceLocaleCode(ns);
  const refBlocks = refCode ? (ns.locales[refCode] || []) : [];
  const issues = [];

  Object.keys(ns.locales || {}).forEach(code => {
    const raw = ns.localeRaw?.[code] ?? serializeTxt(ns.locales[code] || []);
    const parsed = parseTxtDetailed(raw);
    ns.localeIssues[code] = parsed.issues;
    parsed.issues.forEach(issue => {
      issues.push({
        namespace: ns.name,
        locale: code,
        block: issue.block,
        severity: issue.severity || 'warn',
        line: issue.line,
        message: issue.message,
      });
    });

    const blocks = ns.locales[code] || [];
    if (refCode && code !== refCode && blocks.length !== refBlocks.length) {
      issues.push({
        namespace: ns.name,
        locale: code,
        severity: 'error',
        message: `Количество блоков ${blocks.length}, в ${refCode.toUpperCase()} ${refBlocks.length}`,
      });
    }

    if (!refCode || code === refCode) return;
    const max = Math.max(blocks.length, refBlocks.length);
    for (let i = 0; i < max; i += 1) {
      if (blocks[i] == null || refBlocks[i] == null) continue;
      const cur = localeTextStats(blocks[i]);
      const ref = localeTextStats(refBlocks[i]);
      ['boldMarkers', 'urls', 'htmlTags', 'placeholders'].forEach(key => {
        if (cur[key] !== ref[key]) {
          issues.push({
            namespace: ns.name,
            locale: code,
            block: i,
            severity: key === 'urls' || key === 'htmlTags' ? 'error' : 'warn',
            message: `block_${PH_NUM(i)}: ${key} = ${cur[key]}, в ${refCode.toUpperCase()} ${ref[key]}`,
          });
        }
      });
    }
  });

  return issues;
}

function getReferenceLocaleCode(ns) {
  const codes = Object.keys(ns?.locales || {});
  return codes.find(c => c === 'en') || codes.find(c => c.startsWith('en')) || codes[0] || null;
}

function makeMissingLocaleBlock(refBlock, refCode, index) {
  const ref = String(refBlock || '').trim();
  const label = `TODO ${String(refCode || 'ref').toUpperCase()} block_${PH_NUM(index)}`;
  return ref ? `@@${label}@@\n${ref}` : `@@${label}@@`;
}

function normalizeLocaleStructure(ns) {
  if (!ns) return 0;
  const refCode = getReferenceLocaleCode(ns);
  const refBlocks = refCode ? (ns.locales[refCode] || []) : [];
  if (!refCode || !refBlocks.length) return 0;

  let changed = 0;
  Object.keys(ns.locales).forEach(code => {
    if (code === refCode) return;
    const blocks = Array.isArray(ns.locales[code]) ? [...ns.locales[code]] : [];
    if (blocks.length === refBlocks.length) return;

    if (blocks.length < refBlocks.length) {
      for (let i = blocks.length; i < refBlocks.length; i += 1) {
        blocks.push(makeMissingLocaleBlock(refBlocks[i], refCode, i));
      }
    } else if (refBlocks.length > 0) {
      const head = blocks.slice(0, refBlocks.length - 1);
      const tail = blocks.slice(refBlocks.length - 1).join('\n\n').trim();
      blocks.splice(0, blocks.length, ...head, tail || makeMissingLocaleBlock(refBlocks[refBlocks.length - 1], refCode, refBlocks.length - 1));
    }

    ns.locales[code] = blocks;
    syncLocaleRawFromBlocks(ns, code);
    changed += 1;
  });
  return changed;
}

function refreshLocaleUiAfterStructureChange() {
  validateLocales();
  renderLocalesBar();
  renderNamespaceBar();
  updatePreview();
  saveToLocalStorage();
}

function flushLocaleEditorToState() {
  if (!state._editNsId || !state._editLocale) return null;
  const ns = getNs(state._editNsId);
  if (!ns) return null;
  const text = cmLocale ? cmLocale.getValue() : r.localeEditTextarea.value;
  setLocaleRawContent(ns, state._editLocale, text);
  return ns;
}

function autoFixLocaleStructures(targetNsId = null) {
  const targets = targetNsId
    ? state.namespaces.filter(ns => ns.id === targetNsId)
    : state.namespaces;
  let changed = 0;
  targets.forEach(ns => { changed += normalizeLocaleStructure(ns); });
  if (changed) refreshLocaleUiAfterStructureChange();
  return changed;
}

function splitAtNearestWord(text, startRatio, endRatio) {
  const source = String(text || '');
  if (!source.trim()) return ['', '', ''];
  const len = source.length;
  const clamp = n => Math.max(1, Math.min(len - 1, n));
  const snap = (idx, direction) => {
    const radius = 18;
    for (let d = 0; d <= radius; d += 1) {
      const probe = idx + d * direction;
      if (probe > 0 && probe < len && /\s/.test(source[probe])) return probe;
    }
    for (let d = 0; d <= radius; d += 1) {
      const probe = idx - d * direction;
      if (probe > 0 && probe < len && /\s/.test(source[probe])) return probe;
    }
    return idx;
  };
  let start = snap(clamp(Math.round(len * startRatio)), -1);
  let end = snap(clamp(Math.round(len * endRatio)), 1);
  if (end <= start) end = clamp(start + Math.max(1, Math.round(len * 0.18)));
  return [
    source.slice(0, start).trim(),
    source.slice(start, end).trim(),
    source.slice(end).trim(),
  ];
}

function shiftPlaceholdersInActiveEditor(nsName, afterIndex, delta) {
  if (!cm || cm.getOption('readOnly')) return false;
  const esc = nsName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`\\$\\{\\{\\s*${esc}\\.block_(\\d+)\\s*\\}\\}\\$`, 'g');
  const current = cm.getValue();
  const next = current.replace(re, (match, nStr) => {
    const idx = parseInt(nStr, 10);
    return idx > afterIndex ? PH_STR(nsName, idx + delta) : match;
  });
  if (next === current) return false;
  _suppressSrcModified = true;
  cm.setValue(next);
  setTimeout(() => { _suppressSrcModified = false; }, 0);
  updateEditorStats();
  if (state.srcCtx?.activeFile && !state.activeFileId) {
    state.srcCtx.modified = true;
    r.saveSourceBtn?.classList.remove('hidden');
    renderSrcFileTabs();
  }
  saveToLocalStorage();
  return true;
}

function splitSelectedLocaleBlockAcrossLocales() {
  const ns = flushLocaleEditorToState();
  if (!ns || !state._editLocale || !cmLocale) return;

  const selected = cmLocale.getSelection();
  if (!selected || !selected.trim()) {
    toast('Выделите фразу внутри одного {{блока}}, которую нужно вынести под ссылку', 'warning');
    return;
  }

  const text = cmLocale.getValue();
  const selStart = cmLocale.indexFromPos(cmLocale.getCursor('from'));
  const selEnd = cmLocale.indexFromPos(cmLocale.getCursor('to'));
  const blockRe = /\{\{([\s\S]*?)\}\}/g;
  let match;
  let blockIndex = -1;
  let activeBlock = null;
  while ((match = blockRe.exec(text)) !== null) {
    const innerStart = match.index + 2;
    const innerEnd = blockRe.lastIndex - 2;
    blockIndex += 1;
    if (selStart >= innerStart && selEnd <= innerEnd) {
      activeBlock = { index: blockIndex, raw: match[1], innerStart };
      break;
    }
  }

  if (!activeBlock) {
    toast('Выделение должно быть внутри одного {{блока}}', 'warning');
    return;
  }

  const startOffset = selStart - activeBlock.innerStart;
  const endOffset = selEnd - activeBlock.innerStart;
  const before = activeBlock.raw.slice(0, startOffset).trim();
  const middle = activeBlock.raw.slice(startOffset, endOffset).trim();
  const after = activeBlock.raw.slice(endOffset).trim();
  if (!before || !middle || !after) {
    toast('Для ссылки нужен текст до выделения, само выделение и текст после него', 'warning');
    return;
  }

  const startRatio = startOffset / Math.max(activeBlock.raw.length, 1);
  const endRatio = endOffset / Math.max(activeBlock.raw.length, 1);
  const pending = [];

  Object.keys(ns.locales).forEach(code => {
    const blocks = ns.locales[code] || [];
    const sourceBlock = String(blocks[activeBlock.index] || '');
    if (!sourceBlock.trim()) return;
    const parts = code === state._editLocale
      ? [before, middle, after]
      : splitAtNearestWord(sourceBlock, startRatio, endRatio);
    if (parts.some(part => !part)) return;
    pending.push({ code, parts });
  });

  const expectedLocales = Object.keys(ns.locales).filter(code => (ns.locales[code] || []).length > activeBlock.index);
  if (!pending.length || pending.length !== expectedLocales.length) {
    toast('Не удалось разрезать блоки: слишком короткие тексты в локалях', 'error');
    return;
  }

  pending.forEach(({ code, parts }) => {
    ns.locales[code].splice(activeBlock.index, 1, parts[0], parts[1], parts[2]);
    syncLocaleRawFromBlocks(ns, code);
  });

  const shifted = shiftPlaceholdersInActiveEditor(ns.name, activeBlock.index, 2);
  loadLocaleIntoLocaleCM(ns.id, state._editLocale);
  refreshLocaleUiAfterStructureChange();
  toast(`Блок_${PH_NUM(activeBlock.index)} разбит во всех локалях${shifted ? ', следующие плейсхолдеры сдвинуты' : ''}`, 'success');
}

function showMismatchModal(issues, nsName) {
  r.mismatchBody.innerHTML = `
    <div style="font-size:13px;color:var(--text-2);margin-bottom:8px">
      Namespace <strong>${escapeHtml(nsName)}</strong> — найдены расхождения в количестве блоков:
    </div>` +
    issues.map(i => {
      const icon = i.diff < 0 ? '❌' : '⚠️';
      const msg  = i.diff < 0
        ? `не хватает ${Math.abs(i.diff)} блоков (${i.n} вместо ${i.refN})`
        : `лишних ${i.diff} блоков (${i.n} вместо ${i.refN})`;
      return `<div class="validate-item ${i.diff < 0 ? 'error' : 'warn'}" style="font-size:12.5px">
        <span class="validate-icon">${icon}</span>
        <div class="validate-text">
          <strong>${escapeHtml(i.code.toUpperCase())}</strong>
          <span style="color:var(--text-2)"> vs ${i.refCode.toUpperCase()} — ${msg}</span>
        </div>
      </div>`;
    }).join('');
  r.mismatchBackdrop.classList.remove('hidden');
  r.mismatchModal.classList.remove('hidden');
  validateLocales();
}

function closeMismatchModal() {
  r.mismatchBackdrop.classList.add('hidden');
  r.mismatchModal.classList.add('hidden');
}

r.closeMismatchBtn.addEventListener('click', closeMismatchModal);
r.closeMismatchOkBtn.addEventListener('click', closeMismatchModal);
r.mismatchBackdrop.addEventListener('click', closeMismatchModal);
r.autoFixMismatchBtn?.addEventListener('click', () => {
  const changed = autoFixLocaleStructures();
  if (changed) {
    closeMismatchModal();
    toast(`Автоисправлено локалей: ${changed}`, 'success');
  } else {
    toast('Структура локалей уже совпадает', 'info');
  }
});
r.aiAuditMismatchBtn?.addEventListener('click', () => requestLocaleAiAudit());

// ═══════════════════════════════════════════════════════════════
// LOCALE TABS
// ═══════════════════════════════════════════════════════════════

function getAllLocaleCodes() {
  const codes = new Set();
  // Skip built-in namespaces — their locales (e.g. footer_upload with 23
  // languages) shouldn't pollute the locale tab bar. They resolve silently
  // when an active locale matches.
  state.namespaces.forEach(ns => {
    if (ns.builtin) return;
    // Defensive: ns.locales can be undefined / null after a broken save.
    // Try ns.locales → ns.localeRaw → empty, in that order.
    if (!ns.locales || typeof ns.locales !== 'object') {
      if (ns.localeRaw && typeof ns.localeRaw === 'object') {
        ns.locales = {};
        for (const c of Object.keys(ns.localeRaw)) {
          try { ns.locales[c] = parseTxt(ns.localeRaw[c]); } catch { ns.locales[c] = []; }
        }
        console.warn(`[locales] rebuilt ns.locales for "${ns.name}" from localeRaw — ${Object.keys(ns.locales).length} codes`);
      } else {
        ns.locales = {};
        console.warn(`[locales] namespace "${ns.name}" has neither locales nor localeRaw — treating as empty`);
      }
    }
    Object.keys(ns.locales).forEach(c => codes.add(c));
  });
  const all = [...codes];
  // Order: en first, ru second, then alphabetical
  const PRIORITY = { en: 0, ru: 1 };
  return all.sort((a, b) => {
    const pa = PRIORITY[a] ?? 2;
    const pb = PRIORITY[b] ?? 2;
    if (pa !== pb) return pa - pb;
    return a.localeCompare(b);
  });
}

function deleteLocaleEverywhere(code, opts = {}) {
  const affected = state.namespaces.filter(ns => !ns.builtin && ns.locales && ns.locales[code] !== undefined);
  if (!affected.length) { toast(`Локаль ${code} не найдена`, 'warning'); return false; }
  if (!opts.skipConfirm) {
    const names = affected.map(n => n.name).join(', ');
    if (!confirm(`Удалить локаль ${code.toUpperCase()} из: ${names}? Действие необратимо.`)) return false;
  }
  affected.forEach(ns => {
    delete ns.locales[code];
    if (ns.localeRaw) delete ns.localeRaw[code];
    if (ns.localeIssues) delete ns.localeIssues[code];
  });
  if (state.activeLocale === code) activateLocale('original');
  renderLocalesBar();
  renderNamespaceBar();
  saveToLocalStorage();
  toast(`Локаль ${code.toUpperCase()} удалена`, 'success');
  return true;
}

function deleteLocaleInNamespace(nsName, code, opts = {}) {
  const ns = state.namespaces.find(n => n.name === nsName);
  if (!ns || !ns.locales || ns.locales[code] === undefined) {
    toast(`Локаль ${nsName}/${code} не найдена`, 'warning'); return false;
  }
  if (!opts.skipConfirm && !confirm(`Удалить локаль ${code.toUpperCase()} из namespace «${ns.name}»?`)) return false;
  delete ns.locales[code];
  if (ns.localeRaw) delete ns.localeRaw[code];
  if (ns.localeIssues) delete ns.localeIssues[code];
  if (state.activeLocale === code && !getAllLocaleCodes().includes(code)) activateLocale('original');
  renderLocalesBar();
  renderNamespaceBar();
  saveToLocalStorage();
  toast(`Локаль ${ns.name}/${code} удалена`, 'success');
  return true;
}

function renderLocalesBar() {
  r.localeTabs.innerHTML = '';
  const origBtn = document.createElement('button');
  origBtn.className = 'locale-tab' + (state.activeLocale === 'original' ? ' active' : '');
  origBtn.dataset.locale = 'original';
  origBtn.textContent = 'Original';
  origBtn.addEventListener('click', () => activateLocale('original'));
  r.localeTabs.appendChild(origBtn);

  getAllLocaleCodes().forEach(code => {
    const btn = document.createElement('button');
    btn.className = 'locale-tab' + (state.activeLocale === code ? ' active' : '');
    btn.dataset.locale = code;

    const label = document.createElement('span');
    label.textContent = code.toUpperCase();

    const editBtn = document.createElement('span');
    editBtn.className = 'tab-edit';
    editBtn.title = 'Редактировать блоки';
    editBtn.textContent = '✎';
    editBtn.addEventListener('click', e => { e.stopPropagation(); openLocaleEdit(code); });

    const delBtn = document.createElement('span');
    delBtn.className = 'tab-edit tab-delete';
    delBtn.title = 'Удалить локаль';
    delBtn.textContent = '✕';
    delBtn.addEventListener('click', e => { e.stopPropagation(); deleteLocaleEverywhere(code); });

    btn.appendChild(label);
    btn.appendChild(editBtn);
    btn.appendChild(delBtn);
    btn.addEventListener('click', () => activateLocale(code));
    r.localeTabs.appendChild(btn);
  });

  applyLocaleValidationStyles();
}

function activateLocale(code) {
  const prev = state.activeLocale;
  state.activeLocale = code;
  r.localeTabs.querySelectorAll('.locale-tab').forEach(t =>
    t.classList.toggle('active', t.dataset.locale === code)
  );
  r.previewLocaleLabel.textContent = code === 'original' ? 'Original' : code.toUpperCase();
  r.previewRtlBadge.classList.toggle('hidden', !isRtlLocale(code));
  updatePreview();
  // ── Sync the HTML editor with the active locale ─────────────────────────
  // Original: edit the source (with ${{ ns.block_NN }}$ placeholders).
  // Any other locale: editor shows the localized HTML in read-only mode.
  syncEditorToLocale(code, prev);
}

let _originalEditorBackup = null;
function syncEditorToLocale(code, prev) {
  if (!cm) return;
  // Skip when source-context is editing real .pug/.styl files — they don't have placeholders inline.
  if (state.srcCtx && state.srcCtx.activeFile) return;
  if (code === 'original') {
    if (_originalEditorBackup !== null) {
      cm.operation(() => {
        const last = cm.lastLine();
        const lastCh = cm.getLine(last)?.length ?? 0;
        cm.replaceRange(_originalEditorBackup, { line: 0, ch: 0 }, { line: last, ch: lastCh });
      });
      cm.setOption('readOnly', false);
      _originalEditorBackup = null;
      try { cm.refresh(); } catch {}
    }
    return;
  }
  // Switching FROM original → save the current source so we can restore it later.
  if (_originalEditorBackup === null) {
    _originalEditorBackup = cm.getValue();
  } else {
    // Already had a backup — we're switching locale-to-locale (e.g. UR → TL).
    // Editor currently holds the PREVIOUS locale's substituted HTML, not source.
    // Temporarily restore the source so getRenderedHtml(true) sees placeholders.
    cm.operation(() => {
      const last = cm.lastLine();
      const lastCh = cm.getLine(last)?.length ?? 0;
      cm.replaceRange(_originalEditorBackup, { line: 0, ch: 0 }, { line: last, ch: lastCh });
    });
  }
  // Build localized HTML and put it in the editor read-only.
  const localized = getRenderedHtml(true);
  if (localized && localized.trim()) {
    cm.operation(() => {
      const last = cm.lastLine();
      const lastCh = cm.getLine(last)?.length ?? 0;
      cm.replaceRange(localized, { line: 0, ch: 0 }, { line: last, ch: lastCh });
    });
    cm.setOption('readOnly', true);
    try { cm.refresh(); } catch {}
  }
}

// ═══════════════════════════════════════════════════════════════
// NAMESPACE BAR
// ═══════════════════════════════════════════════════════════════

function renderNamespaceBar() {
  if (!state.namespaces.length) { r.namespaceBar.classList.add('hidden'); return; }
  r.namespaceBar.classList.remove('hidden');
  r.namespaceBar.innerHTML = '';

  const label = document.createElement('span');
  label.className = 'ns-label';
  label.textContent = 'Namespaces:';
  r.namespaceBar.appendChild(label);

  // Встроенные namespace (footer_upload 🔒) — служебные, всегда в КОНЦЕ строки.
  // Обычные namespace идут первыми в своём порядке.
  const orderedNs = [
    ...state.namespaces.filter(ns => !ns.builtin),
    ...state.namespaces.filter(ns => ns.builtin),
  ];
  orderedNs.forEach(ns => {
    const blockCount = maxBlockCount(ns);
    const btn = document.createElement('button');
    btn.className = 'ns-btn';
    btn.title = ns.builtin
      ? `Встроенный namespace — нельзя удалить — ${ns.name}\n${ns.description || ''}`
      : `Скопировать плейсхолдеры — ${ns.name}`;
    if (ns.builtin) btn.classList.add('ns-btn-builtin');
    btn.innerHTML = ns.builtin
      ? `<span class="ns-builtin-icon" title="Встроенный, нельзя удалить">🔒</span>
         <span>${escapeHtml(ns.name)}</span>
         <span class="ns-count">${blockCount} блоков</span>`
      : `<span>${escapeHtml(ns.name)}</span>
         <span class="ns-count">${blockCount} блоков</span>
         <span class="ns-btn-delete" title="Удалить namespace">✕</span>`;
    const delBtn = btn.querySelector('.ns-btn-delete');
    if (delBtn) delBtn.addEventListener('click', e => {
      e.stopPropagation(); deleteNamespace(ns.id);
    });
    btn.addEventListener('click', e => {
      if (e.target.closest('.ns-btn-delete')) return;
      openPhPicker(ns, btn);
    });
    r.namespaceBar.appendChild(btn);
  });
}

function maxBlockCount(ns) {
  return Object.values(ns.locales).reduce((m, b) => Math.max(m, b.length), 0);
}

// ═══════════════════════════════════════════════════════════════
// PLACEHOLDER PICKER
// ═══════════════════════════════════════════════════════════════

r.phPickerClose.addEventListener('click', () => r.phPicker.classList.add('hidden'));
document.addEventListener('click', e => {
  if (!r.phPicker.classList.contains('hidden') &&
      !r.phPicker.contains(e.target) && !e.target.closest('.ns-btn')) {
    r.phPicker.classList.add('hidden');
  }
});

function openPhPicker(ns, anchorEl) {
  const count = maxBlockCount(ns);
  r.phPickerTitle.textContent = ns.name;
  r.phPickerList.innerHTML = '';

  const previewBlocks = ns.locales['en'] || ns.locales[Object.keys(ns.locales)[0]] || [];

  for (let i = 0; i < count; i++) {
    // Format: ${{ ns.block_00 }}$ — 0-indexed, 2-digit
    const ph = PH_STR(ns.name, i);
    const preview = previewBlocks[i]
      ? previewBlocks[i].replace(/@@(.*?)@@/g,'$1').slice(0,40) + (previewBlocks[i].length > 40 ? '…' : '')
      : '';

    const item = document.createElement('div');
    item.className = 'ph-item';
    // Short label — namespace is already shown in the dropdown header.
    // Tooltip carries the full key for the curious.
    item.title = ph;
    item.innerHTML = `
      <span class="ph-item-code">block_${PH_NUM(i)}</span>
      <span class="ph-item-preview">${escapeHtml(preview)}</span>
      <span class="ph-item-copy">копировать</span>`;
    item.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(ph);
        toast(`✓ Скопировано block_${PH_NUM(i)}. Cmd+V вставит → следующий уйдёт в буфер`, 'success', 2200);
        // Auto-advance: after paste into editor, copy next placeholder.
        // FIX: previously used out-of-scope variables (nsName/blocks).
        armNextPlaceholder(ns.name, i, count);
        // Auto-close the picker after copy.
        try { r.phPicker.classList.add('hidden'); } catch {}
      } catch { toast('Буфер недоступен', 'error'); }
    });
    r.phPickerList.appendChild(item);
  }

  const rect = anchorEl.getBoundingClientRect();
  r.phPicker.style.top  = (rect.bottom + 4) + 'px';
  r.phPicker.style.left = rect.left + 'px';
  r.phPicker.classList.remove('hidden');
}


// ─── Placeholder clipboard cycling ────────────────────────────────────────
// After user copies a placeholder for a block, remember it. When they paste it
// into the editor (Cmd/Ctrl+V), automatically copy the NEXT placeholder of the
// same namespace into the clipboard, so they can keep pasting one after another.
let _lastCopiedPh = null; // { nsName, index, total }

function armNextPlaceholder(nsName, currentIndex, total) {
  _lastCopiedPh = { nsName, index: currentIndex, total };
}

document.addEventListener('paste', async (e) => {
  if (!_lastCopiedPh) return;
  // Defer the check: paste fires synchronously, focus may settle after.
  setTimeout(async () => {
    if (!_lastCopiedPh || !cm) return;
    // Also accept if the paste target was inside the editor's DOM, not just
    // strictly hasFocus().
    const target = e.target;
    const inEditor = (cm.getWrapperElement && cm.getWrapperElement().contains(target)) || (cm.hasFocus && cm.hasFocus());
    if (!inEditor) return;
    const { nsName, index, total } = _lastCopiedPh;
    const next = index + 1;
    if (next >= total) { _lastCopiedPh = null; return; }
    const nextPh = '${{ ' + nsName + '.block_' + String(next).padStart(2,'0') + ' }}$';
    try {
      await navigator.clipboard.writeText(nextPh);
      _lastCopiedPh = { nsName, index: next, total };
      toast(`В буфере: block_${String(next).padStart(2,'0')} (Cmd+V)`, 'info', 2000);
    } catch {}
  }, 50);
}, true);

// ═══════════════════════════════════════════════════════════════
// LOCALE EDIT MODAL
// ═══════════════════════════════════════════════════════════════

function openLocaleEdit(localeCode) {
  state._editLocale = localeCode;
  const nsWithLocale = state.namespaces.filter(ns => ns.locales[localeCode] !== undefined);
  if (!nsWithLocale.length) { toast('Локаль не найдена ни в одном namespace', 'error'); return; }
  state._editNsId = nsWithLocale[0].id;

  r.localeEditTitle.textContent = `${localeCode.toUpperCase()} — редактирование`;
  renderNsSwitcher(nsWithLocale);
  loadLocaleIntoLocaleCM(state._editNsId, localeCode);

  r.localeEditBackdrop.classList.remove('hidden');
  r.localeEditModal.classList.remove('hidden');

  initLocaleCM();
  // refresh after modal becomes visible
  setTimeout(() => {
    cmLocale?.refresh();
    cmLocale?.focus();
  }, 50);
}

function renderNsSwitcher(nsWithLocale) {
  r.nsSwitcher.innerHTML = '';
  if (nsWithLocale.length <= 1) return;
  nsWithLocale.forEach(ns => {
    const btn = document.createElement('button');
    btn.className = 'ns-switch-btn' + (ns.id === state._editNsId ? ' active' : '');
    btn.textContent = ns.name;
    btn.dataset.nsId = ns.id;
    btn.addEventListener('click', () => {
      state._editNsId = ns.id;
      r.nsSwitcher.querySelectorAll('.ns-switch-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.nsId === ns.id)
      );
      loadLocaleIntoLocaleCM(ns.id, state._editLocale);
    });
    r.nsSwitcher.appendChild(btn);
  });
}

function loadLocaleIntoLocaleCM(nsId, localeCode) {
  const ns = getNs(nsId);
  if (!ns) return;
  const blocks = ns.locales[localeCode] || [];
  ensureLocaleMeta(ns);
  const text = ns.localeRaw?.[localeCode] ?? serializeTxt(blocks);

  if (cmLocale) {
    cmLocale.setValue(text);
    setTimeout(() => cmLocale.refresh(), 30);
  } else {
    // cmLocale not initialized yet — textarea fallback (initLocaleCM will read it)
    r.localeEditTextarea.value = text;
  }

  updateLocaleEditBadge(nsId, localeCode, blocks.length);
  updateLocaleEditHint(nsId, localeCode, blocks.length);
  renderLocaleKeyList(nsId, localeCode, blocks.length);
  validateTextareaBlocks(text);
}

function updateLocaleEditBadge(nsId, localeCode, count) {
  const ns = getNs(nsId);
  const codes = ns ? Object.keys(ns.locales) : [];
  const refCode = codes.find(c => c.startsWith('en')) || codes[0];
  const refCount = (refCode && ns?.locales[refCode]) ? ns.locales[refCode].length : null;

  if (refCount === null) {
    r.localeBlockBadge.textContent = `${count} блоков`;
    r.localeBlockBadge.className = 'block-count-badge';
  } else if (count === refCount) {
    r.localeBlockBadge.textContent = `✓ ${count} блоков`;
    r.localeBlockBadge.className = 'block-count-badge ok';
  } else if (count < refCount) {
    r.localeBlockBadge.textContent = `${count}/${refCount} — не хватает ${refCount - count}`;
    r.localeBlockBadge.className = 'block-count-badge error';
  } else {
    r.localeBlockBadge.textContent = `${count}/${refCount} — лишних ${count - refCount}`;
    r.localeBlockBadge.className = 'block-count-badge warning';
  }
}

function updateLocaleEditHint(nsId, localeCode, count) {
  if (!r.localeEditHintBlocks) return;
  const ns = getNs(nsId);
  const codes = ns ? Object.keys(ns.locales) : [];
  const refCode = codes.find(c => c.startsWith('en')) || codes[0];
  const refCount = refCode ? ns?.locales[refCode]?.length : null;
  r.localeEditHintBlocks.textContent = refCount != null
    ? `Всего блоков: ${count} / ${refCount} (ref: ${refCode?.toUpperCase()})`
    : `${count} блоков`;
}

function renderLocaleKeyList(nsId, localeCode, count) {
  if (!r.localeKeyList) return;
  const ns = getNs(nsId);
  if (!ns || !localeCode || !count) {
    r.localeKeyList.innerHTML = '';
    return;
  }
  r.localeKeyList.innerHTML = '';
  for (let i = 0; i < count; i += 1) {
    const ph = PH_STR(ns.name, i);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'locale-key-chip';
    btn.title = `Скопировать ключ ${ph}`;
    btn.innerHTML = `<span>block_${PH_NUM(i)}</span>`;
    btn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(ph);
        toast(`✓ block_${PH_NUM(i)} в буфере. Cmd+V → следующий уйдёт автоматически`, 'success', 2000);
        // FIX: previously used out-of-scope `blocks`. count is the right total.
        armNextPlaceholder(ns.name, i, count);
      } catch {
        toast('Буфер недоступен', 'error');
      }
    });
    r.localeKeyList.appendChild(btn);
  }
}

function validateTextareaBlocks(text) {
  const parsed = parseTxtDetailed(text);
  const hard = parsed.issues.filter(i => i.severity === 'error');
  const warns = parsed.issues.filter(i => i.severity !== 'error');
  if (!hard.length && !warns.length) {
    r.localeEditValidation.textContent = parsed.blocks.length ? `${parsed.blocks.length} блоков — всё ОК` : '';
    r.localeEditValidation.className = 'locale-edit-validation ok';
    return;
  }
  const first = [...hard, ...warns][0];
  const suffix = first?.line ? ` · строка ${first.line}` : '';
  r.localeEditValidation.textContent = `⚠ ${hard.length ? 'ошибки' : 'предупреждения'}: ${first?.message || 'проверьте TXT'}${suffix}`;
  r.localeEditValidation.className = `locale-edit-validation ${hard.length ? 'error' : 'warning'}`;
}

function closeLocaleEditModal() {
  r.localeEditBackdrop.classList.add('hidden');
  r.localeEditModal.classList.add('hidden');
  state._editNsId = null;
  state._editLocale = null;
}

r.closeLocaleEditBtn.addEventListener('click', closeLocaleEditModal);
r.cancelLocaleEditBtn.addEventListener('click', closeLocaleEditModal);
r.localeEditBackdrop.addEventListener('click', closeLocaleEditModal);

r.saveLocaleEditBtn.addEventListener('click', () => {
  const text = cmLocale ? cmLocale.getValue() : r.localeEditTextarea.value;
  const ns = getNs(state._editNsId);
  if (!ns) return;
  const parsed = setLocaleRawContent(ns, state._editLocale, text);
  validateLocales();
  renderLocalesBar();
  updatePreview();
  saveToLocalStorage();
  toast(`${state._editLocale.toUpperCase()} сохранено — ${parsed.blocks.length} блоков`, parsed.issues.some(i => i.severity === 'error') ? 'warning' : 'success');
  closeLocaleEditModal();
});

r.deleteLocaleBtn.addEventListener('click', () => {
  if (!confirm(`Удалить локаль ${state._editLocale?.toUpperCase()}?`)) return;
  const ns = getNs(state._editNsId);
  if (ns) {
    delete ns.locales[state._editLocale];
    if (ns.localeRaw) delete ns.localeRaw[state._editLocale];
    if (ns.localeIssues) delete ns.localeIssues[state._editLocale];
  }
  renderLocalesBar();
  renderNamespaceBar();
  validateLocales();
  if (state.activeLocale === state._editLocale) activateLocale('original');
  saveToLocalStorage();
  toast(`Локаль ${state._editLocale?.toUpperCase()} удалена`, 'success');
  closeLocaleEditModal();
});

r.autoFixLocaleBtn?.addEventListener('click', async () => {
  // Шаг 1: детерминированные конвенции (переменные вне блоков, скобки) — на сервере.
  let conventionsFixed = 0;
  try {
    const txt = cmLocale ? cmLocale.getValue() : r.localeEditTextarea.value;
    const res = await fetch('/api/wb/locale-normalize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ txt }),
    });
    if (res.ok) {
      const json = await res.json();
      if (json.ok && json.changed) {
        if (cmLocale) cmLocale.setValue(json.txt); else r.localeEditTextarea.value = json.txt;
        conventionsFixed = (json.changes || []).length;
      }
    }
  } catch { /* сервер старый/недоступен — едем дальше без конвенций */ }
  // Шаг 2: прежняя логика выравнивания структуры по reference.
  const ns = flushLocaleEditorToState();
  if (!ns) return;
  const changed = autoFixLocaleStructures(ns.id);
  loadLocaleIntoLocaleCM(ns.id, state._editLocale);
  if (conventionsFixed || changed) {
    toast(`Авточинка: конвенции ×${conventionsFixed}, структура ×${changed}`, 'success');
  } else {
    toast('Всё уже по конвенциям, структура совпадает', 'info');
  }
});

r.aiAuditLocaleBtn?.addEventListener('click', () => {
  const ns = flushLocaleEditorToState();
  if (!ns) return;
  requestLocaleAiAudit(ns, state._editLocale);
});

r.splitLocaleSelectionBtn?.addEventListener('click', splitSelectedLocaleBlockAcrossLocales);

// ═══════════════════════════════════════════════════════════════
// ADD LOCALE MANUALLY
// ═══════════════════════════════════════════════════════════════

r.addLocaleManualBtn.addEventListener('click', openAddLocaleModal);

function openAddLocaleModal() {
  r.newLocaleCode.value = '';
  r.newNsName.value = '';
  populateNsSelect();
  r.addLocaleBackdrop.classList.remove('hidden');
  r.addLocaleModal.classList.remove('hidden');
  r.newLocaleCode.focus();
}

function populateNsSelect() {
  r.newLocaleNs.innerHTML = '';
  const opt0 = document.createElement('option');
  opt0.value = '__new__'; opt0.textContent = '+ Новый namespace…';
  r.newLocaleNs.appendChild(opt0);
  state.namespaces.forEach(ns => {
    const opt = document.createElement('option');
    opt.value = ns.id; opt.textContent = ns.name;
    r.newLocaleNs.appendChild(opt);
  });
  if (state.namespaces.length) r.newLocaleNs.value = state.namespaces[0].id;
  updateNewNsRow();
}

r.newLocaleNs.addEventListener('change', updateNewNsRow);
function updateNewNsRow() {
  r.newNsRow.classList.toggle('hidden', r.newLocaleNs.value !== '__new__');
  populateAiFromSelect();
}

function populateAiFromSelect() {
  if (!r.newLocaleAiFrom) return;
  r.newLocaleAiFrom.innerHTML = '';
  const ns = r.newLocaleNs.value !== '__new__' ? getNs(r.newLocaleNs.value) : null;
  const codes = ns ? Object.keys(ns.locales || {}).filter(c => (ns.locales[c] || []).length) : [];
  codes.sort((a, b) => (a === 'en' ? -1 : b === 'en' ? 1 : a.localeCompare(b)));
  codes.forEach(c => {
    const o = document.createElement('option');
    o.value = c; o.textContent = c.toUpperCase();
    r.newLocaleAiFrom.appendChild(o);
  });
  const has = codes.length > 0;
  if (r.newLocaleAiTranslate) {
    r.newLocaleAiTranslate.disabled = !has;
    if (!has) r.newLocaleAiTranslate.checked = false;
  }
  const row = document.getElementById('newLocaleAiRow');
  if (row) row.classList.toggle('hidden', !has);
}

function closeAddLocaleModal() {
  r.addLocaleBackdrop.classList.add('hidden');
  r.addLocaleModal.classList.add('hidden');
}

r.closeAddLocaleBtn.addEventListener('click', closeAddLocaleModal);
r.cancelAddLocaleBtn.addEventListener('click', closeAddLocaleModal);
r.addLocaleBackdrop.addEventListener('click', closeAddLocaleModal);

r.confirmAddLocaleBtn.addEventListener('click', async () => {
  const code = r.newLocaleCode.value.trim().toLowerCase();
  if (!code) { r.newLocaleCode.focus(); toast('Введите код локали', 'warning'); return; }
  let ns;
  if (r.newLocaleNs.value === '__new__') {
    const nsName = r.newNsName.value.trim() || code;
    ns = { id: `ns-${uid()}`, name: nsName, locales: {} };
    state.namespaces.push(ns);
  } else {
    ns = getNs(r.newLocaleNs.value);
  }
  if (!ns) return;
  const wantAi = !!(r.newLocaleAiTranslate && r.newLocaleAiTranslate.checked && !r.newLocaleAiTranslate.disabled);
  const fromCode = r.newLocaleAiFrom ? r.newLocaleAiFrom.value : '';
  if (!ns.locales[code]) {
    ns.locales[code] = [];
    syncLocaleRawFromBlocks(ns, code);
  }
  renderLocalesBar();
  renderNamespaceBar();
  saveToLocalStorage();
  closeAddLocaleModal();
  // Optional: immediately fill the new locale via AI translation from a source locale.
  if (wantAi && fromCode && fromCode !== code && Array.isArray(ns.locales[fromCode]) && ns.locales[fromCode].length) {
    const srcTxt = (ns.localeRaw && ns.localeRaw[fromCode]) || serializeTxt(ns.locales[fromCode] || []);
    toast(`🌐 Перевожу ${fromCode}→${code} через AI…`, 'info', 20000);
    try {
      const res = await fetch('/api/wb/ai/translate-locale-txt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ srcTxt, fromLang: fromCode, toLang: code }),
      });
      const json = await res.json();
      if (res.status === 404) throw new Error('Сервер не подхватил AI-endpoints. Перезапусти `npm start`.');
      if (!res.ok || !json.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setLocaleRawContent(ns, code, json.translatedTxt);
      renderLocalesBar();
      saveToLocalStorage();
      activateLocale(code);
      toast(`✓ Локаль ${code.toUpperCase()} создана и переведена: ${json.blocks.length} блоков`, 'success', 4000);
      return;
    } catch (err) {
      toast(`AI перевод не удался: ${err.message}. Локаль создана пустой.`, 'warning', 6000);
    }
  }
  openLocaleEdit(code);
  toast(`Локаль ${code.toUpperCase()} создана`, 'success');
});

// ═══════════════════════════════════════════════════════════════
// EDITOR STATS
// ═══════════════════════════════════════════════════════════════

function updateEditorStats() {
  if (!cm) return;
  const val = cm.getValue();
  const lines = val ? val.split('\n').length : 0;
  // Count ${{...}}$ placeholders
  const blocks = (val.match(/\$\{\{[^}]*?\}\}\$/g) || []).length;
  r.statLines.textContent = `${lines} строк`;
  r.statBlocks.textContent = `${blocks} блоков`;
}

// ═══════════════════════════════════════════════════════════════
// PREVIEW
// ═══════════════════════════════════════════════════════════════

/**
 * Build the final rendered HTML for the current editor content + active locale + brand.
 * forExport=true  → clean HTML, no click scripts, no retkit spans (ready to copy/download)
 * forExport=false → preview HTML with clickable spans + interaction script
 */
function getRenderedHtml(forExport = false) {
  if (!cm) return '';
  let rawHtml;
  if (state.srcCtx?.viewingCompiledHtml) {
    rawHtml = cm.getValue().trim();
  } else if (state.srcCtx?.compiledHtml) {
    rawHtml = state.srcCtx.compiledHtml.trim();
  } else {
    rawHtml = cm.getValue().trim();
  }
  if (!rawHtml) return '';

  let html = rawHtml;
  const isLocale = state.activeLocale !== 'original';

  if (isLocale) {
    // Substitute placeholders — no click-wrap in export mode
    state.namespaces.forEach(ns => {
      const blocks = ns.locales[state.activeLocale];
      if (blocks) html = applyNamespaceLocale(html, ns.name, blocks, !forExport);
    });
  } else if (!forExport) {
    // Original mode: wrap raw ${{ }}$ placeholders in clickable spans (preview only)
    html = html.replace(/\$\{\{\s*([a-zA-Z0-9_\-]+)\.block_(\d+)\s*\}\}\$/g, (match, ns, n) => {
      return `<span data-retkit-ph="${escapeHtml(ns)}.block_${n}" style="cursor:pointer;border-bottom:1px dashed rgba(96,165,250,.5);background:rgba(96,165,250,.06)">${escapeHtml(match)}</span>`;
    });
  }

  // Apply active brand tokens
  if (state.activeBrandId) {
    const brand = state.brands.find(b => b.id === state.activeBrandId);
    if (brand) html = applyBrandTokens(html, brand);
  }

  if (!forExport) {
    // Inject click → editor highlight listener
    const clickScript = `<script>
document.addEventListener('click',function(e){
  var link=e.target.closest('a[href]');
  if(link){ e.preventDefault(); e.stopPropagation(); }
  var el=e.target.closest('[data-retkit-ph]');
  if(el){window.parent.postMessage({type:'retkit-ph-click',ph:el.dataset.retkitPh},'*');return;}
  var block=e.target.closest('p,h1,h2,h3,h4,h5,h6,li,a')||e.target.closest('span,td,th,div');
  var blockHtml=block?(block.innerHTML||'').trim():'';
  var text='';
  var sel=window.getSelection&&window.getSelection();
  if(sel&&sel.toString().trim()) text=sel.toString().trim();
  if(!text){
    if(block){ text=(block.innerText||block.textContent||'').trim().replace(/\\s+/g,' '); }
    if(link){ text=(link.innerText||link.textContent||'').trim().replace(/\\s+/g,' '); }
    if(!text){
      var node=e.target;
      while(node&&node!==document.body){
        var t=(node.innerText||'').trim().replace(/\\s+/g,' ');
        if(t&&t.length>=2&&t.length<=300){text=t;break;}
        node=node.parentElement;
      }
    }
  }
  if(text) window.parent.postMessage({type:'retkit-text-click',text:text.slice(0,500),html:blockHtml.slice(0,4000)},'*');

},true);<\/script>`;
    // ── Pencil-mode overlay: opens parent-side inspector on click.
    // Triggers when EITHER the parent has flipped pencil mode ON (sent via
    // postMessage), OR the user holds Cmd/Ctrl (legacy alt-trigger).
    const editorOverlayScript = `<script>(function(){
      var pencilOn = false;
      window.addEventListener('message', function(ev){
        if(!ev||!ev.data||ev.data.type!=='retkit-set-pencil')return;
        pencilOn = !!ev.data.on;
        document.documentElement.classList.toggle('__retkit-pencil-on', pencilOn);
      }, false);
      document.addEventListener('click',function(e){
        var altKey = e.metaKey||e.ctrlKey;
        if(!pencilOn && !altKey) return;
        // Don't intercept links/buttons unless we're sure we want to edit.
        var t=e.target.closest('p,h1,h2,h3,h4,h5,h6,li,a,img,td,div');
        if(!t||t===document.body||t===document.documentElement)return;
        e.preventDefault();e.stopPropagation();
        var cs=window.getComputedStyle(t);
        window.parent.postMessage({type:'retkit-inspect-click',
          tag:t.tagName.toLowerCase(),
          text:t.tagName==='IMG'?'':(t.innerText||t.textContent||'').trim().slice(0,500),
          outerHtml:t.outerHTML.slice(0,12000),
          computed:{color:cs.color,backgroundColor:cs.backgroundColor,fontSize:cs.fontSize,fontWeight:cs.fontWeight,textAlign:cs.textAlign,padding:cs.padding,borderRadius:cs.borderRadius},
          src:t.tagName==='IMG'?t.getAttribute('src'):null,
          alt:t.tagName==='IMG'?t.getAttribute('alt'):null,
          wasAltKey: altKey
        },'*');
      },true);
    })();<\/script>`;
    // CSS injected so when pencil mode is on, hovering elements shows an outline.
    const pencilStyleScript = `<style>
      html.__retkit-pencil-on body { cursor: crosshair !important; }
      html.__retkit-pencil-on p:hover, html.__retkit-pencil-on h1:hover, html.__retkit-pencil-on h2:hover,
      html.__retkit-pencil-on h3:hover, html.__retkit-pencil-on h4:hover, html.__retkit-pencil-on h5:hover,
      html.__retkit-pencil-on h6:hover, html.__retkit-pencil-on li:hover, html.__retkit-pencil-on a:hover,
      html.__retkit-pencil-on img:hover, html.__retkit-pencil-on td:hover, html.__retkit-pencil-on div:hover {
        outline: 2px dashed #ff7700 !important; outline-offset: 1px !important;
      }
    </style>`;
    const __unusedOldOverlay = `<style>
      .__retkit-edit-badge{position:absolute;z-index:9999;width:22px;height:22px;border-radius:50%;background:#2563eb;color:#fff;display:flex;align-items:center;justify-content:center;font:600 13px/1 -apple-system,sans-serif;cursor:pointer;box-shadow:0 2px 8px rgba(37,99,235,.45);user-select:none;pointer-events:auto;}
      .__retkit-edit-hover-outline{outline:2px dashed rgba(37,99,235,.55);outline-offset:1px;}
    </style><script>(function(){
      var badge=null,hoverEl=null,abs=function(el){var b=el.getBoundingClientRect();return{top:b.top+window.scrollY,left:b.left+window.scrollX,width:b.width};};
      var EDITABLE='p,h1,h2,h3,h4,h5,h6,li,a,img,td,div';var hideTimer=null;
      function cancelHide(){if(hideTimer){clearTimeout(hideTimer);hideTimer=null;}}
      function scheduleHide(){cancelHide();hideTimer=setTimeout(function(){if(badge){badge.remove();badge=null;}if(hoverEl){hoverEl.classList.remove('__retkit-edit-hover-outline');hoverEl=null;}},250);}
      function showBadge(el){if(badge)badge.remove();if(hoverEl)hoverEl.classList.remove('__retkit-edit-hover-outline');hoverEl=el;el.classList.add('__retkit-edit-hover-outline');var pos=abs(el);badge=document.createElement('div');badge.className='__retkit-edit-badge';badge.textContent='✎';badge.style.top=(pos.top-9)+'px';badge.style.left=(pos.left+pos.width-11)+'px';badge.title='Редактировать';badge.addEventListener('mouseenter',cancelHide);badge.addEventListener('mouseleave',scheduleHide);badge.addEventListener('click',function(ev){ev.preventDefault();ev.stopPropagation();cancelHide();var cs=window.getComputedStyle(el);window.parent.postMessage({type:'retkit-inspect-click',tag:el.tagName.toLowerCase(),text:el.tagName==='IMG'?'':(el.innerText||el.textContent||'').trim().slice(0,500),outerHtml:el.outerHTML.slice(0,12000),computed:{color:cs.color,backgroundColor:cs.backgroundColor,fontSize:cs.fontSize,fontWeight:cs.fontWeight,textAlign:cs.textAlign,padding:cs.padding,borderRadius:cs.borderRadius},src:el.tagName==='IMG'?el.getAttribute('src'):null,alt:el.tagName==='IMG'?el.getAttribute('alt'):null},'*');});document.body.appendChild(badge);}
      document.addEventListener('mouseover',function(e){var t=e.target.closest(EDITABLE);if(t){cancelHide();showBadge(t);return;}if(!e.target.closest('.__retkit-edit-badge'))scheduleHide();},true);
      document.addEventListener('mouseout',function(e){if(e.relatedTarget&&(e.relatedTarget.closest&&e.relatedTarget.closest('.__retkit-edit-badge')))return;scheduleHide();},true);
    })();<\/script>`;
    if (/<\/body>/i.test(html)) {
      html = html.replace(/<\/body>/i, clickScript + editorOverlayScript + pencilStyleScript + '</body>');
    } else {
      html += clickScript + editorOverlayScript + pencilStyleScript;
    }
  }

  if (isRtlLocale(state.activeLocale)) html = applyRtl(html);

  return html;
}

function updatePreview() {
  if (!cm) return;
  const html = getRenderedHtml(false);
  if (!html) {
    // Editor cleared — bounce locale back to Original so user isn't stuck on a
    // stale localized read-only view of nothing.
    if (state.activeLocale && state.activeLocale !== 'original') {
      try { activateLocale('original'); } catch {}
    }
    r.previewEmpty.classList.remove('hidden');
    r.previewEmpty.style.display = '';
    hideBlocksCarousel();
    r.blocksCarouselToggleBtn?.classList.remove('active');
    r.blocksCarouselToggleBtn?.classList.add('hidden');
    return;
  }
  r.previewEmpty.classList.add('hidden');
  r.blocksCarouselToggleBtn?.classList.remove('hidden');
  const doc = r.previewFrame.contentDocument || r.previewFrame.contentWindow.document;
  doc.open(); doc.write(html); doc.close();
  wirePreviewFrameDragDrop();
}

/**
 * Replace ${{nsName.block_N}}$ with actual block text.
 * wrapForClick=true: wrap in a span for click→highlight.
 * @@text@@ → <b>text</b>
 */
function applyNamespaceLocale(html, nsName, blocks, wrapForClick) {
  const esc = nsName.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const re = new RegExp(`\\$\\{\\{\\s*${esc}\\.block_(\\d+)\\s*\\}\\}\\$`, 'g');
  return html.replace(re, (match, nStr) => {
    // 0-indexed: block_00 → blocks[0], block_01 → blocks[1] …
    const idx = parseInt(nStr, 10);
    if (idx >= 0 && idx < blocks.length) {
      const raw = blocks[idx];
      // Empty block → &nbsp; so the surrounding container keeps its dimensions.
      const text = (raw == null || raw === '') ? '&nbsp;' : boldify(raw);
      return wrapForClick
        ? `<span data-retkit-ph="${escapeHtml(nsName)}.block_${PH_NUM(idx)}">${text}</span>`
        : text;
    }
    return match;
  });
}

function boldify(text) {
  return text.replace(/@@([\s\S]*?)@@/g, '<b>$1</b>');
}

// ─── RTL transform (mirrors email-base/tools/rtl.js) ──────────────────────
// Client-side port of the server-side rtl.js (kept here so the workbench
// preview can RTL-transform on locale switch without a server round-trip).
// Whenever you touch one file, mirror the change in the other.
//
// Pipeline (must match server-side):
//   0) strip stale dir="rtl" (idempotent on already-RTL'd HTML)
//   1) flip text-align in <style> blocks + inline styles (skip !important)
//   2) physical mirror in CSS: padding-left↔right, margin-left↔right,
//      float: left↔right, background-position left↔right, background
//      shorthand left↔right (outside url(...))
//   3) flip align="left|start|end" → align="right" (no dir added)
//   4) button shells (table with innermost <td class="butt…">) get
//      align="right" (no dir added)
//   5) <p>/<h1-6>/<li> get dir="rtl" + text-align: right (if missing)
//   6) leaf <div> with text (no block children, not spacer) gets dir + align
//   7) <td class="butt"> gets dir="rtl"
//   8) smart-RTL: direction: rtl on <a>/<button> with icon+text mix
//
//   NO dir="rtl" on layout <td>, <table>, <center>, wrappers, or spacers.
function applyRtl(html) {
  if (!html || typeof html !== 'string') return html;

  const VISIBLE_TEXT_RE = /[A-Za-zА-Яа-яЁё֐-׿؀-ۿݐ-ݿ]/;
  const hasVisibleText = s => {
    if (!s) return false;
    const text = String(s)
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<[^>]+>/g, ' ');
    return VISIBLE_TEXT_RE.test(text) || /&[a-zA-Z]+;|&#\d+;/.test(String(s));
  };

  const readAttr = (attrs, name) => {
    const src = String(attrs || '');
    const quoted = new RegExp('\\b' + name + '\\s*=\\s*(["\'])([\\s\\S]*?)\\1', 'i').exec(src);
    if (quoted) return quoted[2];
    const bare = new RegExp('\\b' + name + '\\s*=\\s*([^\\s"\'>]+)', 'i').exec(src);
    return bare ? bare[1] : '';
  };
  const hasClassToken = (attrs, re) => readAttr(attrs, 'class')
    .split(/\s+/).filter(Boolean).some(t => re.test(t));

  const withDirRtl = attrs => /\bdir\s*=/i.test(attrs) ? attrs : ' dir="rtl"' + attrs;

  // ── 0) Strip any stale dir="rtl" (idempotent) ─────────────────────
  html = html.replace(/\s+dir\s*=\s*(["']?)rtl\1/gi, '');

  // ── 1) text-align flip in CSS and inline styles ──────────────────
  const flipTextAlignInCss = css => !css ? css : css.replace(
    /\btext-align\s*:\s*(left|start|end)\b([^;}\n]*)/gi,
    (match, value, rest) => /\!\s*important/i.test(rest) ? match : 'text-align: right' + rest
  );
  const flipTextAlignInStyleAttr = attrs => {
    if (!/\bstyle\s*=/i.test(attrs)) return attrs;
    return attrs.replace(/\bstyle\s*=\s*(["'])([\s\S]*?)\1/i,
      (_m, q, body) => 'style=' + q + flipTextAlignInCss(body) + q);
  };
  html = html.replace(/(<style[^>]*>)([\s\S]*?)(<\/style>)/gi,
    (_m, open, body, close) => open + flipTextAlignInCss(body) + close);
  html = html.replace(/<([a-z][\w:-]*)([^>]*)>/gi, (m, tag, attrs) => {
    if (/^(?:style|script)$/i.test(tag)) return m;
    if (!/\bstyle\s*=/i.test(attrs)) return m;
    return '<' + tag + flipTextAlignInStyleAttr(attrs) + '>';
  });

  // ── 2) Physical-side swap (padding/margin/float + background-position)
  const swapPhysicalSidesInCss = css => {
    if (!css) return css;
    let out = css.replace(/\bfloat\s*:\s*(left|right)\b([^;}\n]*)/gi, (match, value, rest) => {
      if (/\!\s*important/i.test(rest)) return match;
      return 'float: ' + (value === 'left' ? 'right' : 'left') + rest;
    });
    const TOKEN_L = '\x00LFT\x00', TOKEN_R = '\x00RGT\x00';
    out = out.replace(/\bpadding-left\s*:\s*([^;}\n]+?)(?=\s*(?:;|}|$|\n))/gi,
      (match, value) => /\!\s*important/i.test(value) ? match : 'padding-' + TOKEN_L + ': ' + value.trim());
    out = out.replace(/\bpadding-right\s*:\s*([^;}\n]+?)(?=\s*(?:;|}|$|\n))/gi,
      (match, value) => /\!\s*important/i.test(value) ? match : 'padding-' + TOKEN_R + ': ' + value.trim());
    out = out.replace(/\bmargin-left\s*:\s*([^;}\n]+?)(?=\s*(?:;|}|$|\n))/gi,
      (match, value) => /\!\s*important/i.test(value) ? match : 'margin-' + TOKEN_L + ': ' + value.trim());
    out = out.replace(/\bmargin-right\s*:\s*([^;}\n]+?)(?=\s*(?:;|}|$|\n))/gi,
      (match, value) => /\!\s*important/i.test(value) ? match : 'margin-' + TOKEN_R + ': ' + value.trim());
    out = out.replace(new RegExp(TOKEN_L, 'g'), 'right').replace(new RegExp(TOKEN_R, 'g'), 'left');

    const POS_L = '\x00POSL\x00', POS_R = '\x00POSR\x00';
    out = out.replace(/\bbackground-position\s*:\s*([^;}\n]+)/gi, (match, value) => {
      if (/\!\s*important/i.test(value)) return match;
      return 'background-position: ' + value.replace(/\bleft\b/g, POS_L).replace(/\bright\b/g, POS_R);
    });
    out = out.replace(/\bbackground\s*:\s*([^;}\n]+)/gi, (match, value) => {
      if (/\!\s*important/i.test(value)) return match;
      const swapped = value.replace(/(url\([^)]*\))|(\bleft\b)|(\bright\b)/g, (m, u, l, r) => u || (l ? POS_L : (r ? POS_R : m)));
      return 'background: ' + swapped;
    });
    out = out.replace(new RegExp(POS_L, 'g'), 'right').replace(new RegExp(POS_R, 'g'), 'left');
    return out;
  };
  const swapPhysicalSidesInStyleAttr = attrs => {
    if (!/\bstyle\s*=/i.test(attrs)) return attrs;
    return attrs.replace(/\bstyle\s*=\s*(["'])([\s\S]*?)\1/i,
      (_m, q, body) => 'style=' + q + swapPhysicalSidesInCss(body) + q);
  };
  html = html.replace(/(<style[^>]*>)([\s\S]*?)(<\/style>)/gi,
    (_m, open, body, close) => open + swapPhysicalSidesInCss(body) + close);
  html = html.replace(/<([a-z][\w:-]*)([^>]*)>/gi, (m, tag, attrs) => {
    if (/^(?:style|script)$/i.test(tag)) return m;
    if (!/\bstyle\s*=/i.test(attrs)) return m;
    return '<' + tag + swapPhysicalSidesInStyleAttr(attrs) + '>';
  });

  // ── 3) Flip align="left|start|end" on every tag (no dir added) ───
  const flipAlign = attrs => attrs.replace(/\balign\s*=\s*(["']?)(left|start|end)\1/gi, 'align="right"');
  html = html.replace(/<([a-z][\w:-]*)([^>]*)>/gi, (m, tag, attrs) => {
    if (/^(?:style|script)$/i.test(tag) || !/\balign\s*=/i.test(attrs)) return m;
    return '<' + tag + flipAlign(attrs) + '>';
  });

  // ── 4) Button shells — innermost <table> enclosing a <td class="butt…">
  const buttonShellStarts = (() => {
    const marked = new Set();
    const stack = [];
    const tagRe = /<(\/?)(table|td|th)\b([^>]*)>/gi;
    let m;
    while ((m = tagRe.exec(html)) !== null) {
      const closing = m[1] === '/'; const tag = m[2].toLowerCase();
      if (!closing) {
        if (tag === 'table') stack.push({ start: m.index });
        else {
          const cls = readAttr(m[3] || '', 'class');
          const isButt = cls.split(/\s+/).some(t => /^butt(?:[-_].*)?$/i.test(t));
          if (isButt && stack.length) marked.add(stack[stack.length - 1].start);
        }
      } else if (tag === 'table') stack.pop();
    }
    return marked;
  })();
  const isButtonClassToken = attrs =>
    hasClassToken(attrs, /^(?:button|tiny-button|small-button|medium-button(?:-[\w-]+)?|large-button)$/i)
      || hasClassToken(attrs, /(?:^|-)button(?:-|$)/i);
  const forceAlignRightAttr = attrs => {
    if (!/\balign\s*=/i.test(attrs)) return attrs + ' align="right"';
    return attrs.replace(/\balign\s*=\s*(["'])([\s\S]*?)\1/i, 'align="right"')
                .replace(/\balign\s*=\s*([^\s"\'>]+)/i, 'align="right"');
  };
  html = html.replace(/<table\b([^>]*)>/gi, (m, attrs, offset) => {
    if (!isButtonClassToken(attrs) && !buttonShellStarts.has(offset)) return m;
    return '<table' + forceAlignRightAttr(attrs) + '>';
  });

  // ── 5) p / h* / li get dir + text-align: right (if no text-align set) ──
  const ensureTextAlignRightIfMissing = attrs => {
    if (!/\bstyle\s*=/i.test(attrs)) return attrs + ' style="text-align: right;"';
    if (/\btext-align\s*:/i.test(attrs)) return attrs;
    return attrs.replace(/\bstyle\s*=\s*(["'])([\s\S]*?)\1/i,
      (_m, q, body) => 'style=' + q + body.replace(/\s*;?\s*$/, ';') + ' text-align: right;' + q);
  };
  html = html.replace(/<(p|h[1-6]|li)\b([^>]*)>/gi,
    (m, tag, attrs) => '<' + tag + ensureTextAlignRightIfMissing(withDirRtl(attrs)) + '>');

  // ── 6) leaf <div> with real text (not spacer) gets dir + align ───
  const isSpacerDivContent = inner => {
    const stripped = String(inner || '')
      .replace(/<br\s*\/?>/gi, '')
      .replace(/&nbsp;|&#160;|&#xa0;/gi, '')
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, '');
    return stripped.length === 0;
  };
  html = html.replace(/<div\b([^>]*)>([\s\S]*?)<\/div>/gi, (m, attrs, inner) => {
    if (/<(?:p|h[1-6]|li|div|table)\b/i.test(inner)) return m;
    if (!hasVisibleText(inner)) return m;
    if (isSpacerDivContent(inner)) return m;
    return '<div' + ensureTextAlignRightIfMissing(withDirRtl(attrs)) + '>' + inner + '</div>';
  });

  // ── 7) <td class="butt…"> gets dir="rtl" (link text reads RTL) ──
  html = html.replace(/<(td|th)\b([^>]*)>/gi, (m, tag, attrs) => {
    if (!hasClassToken(attrs, /^butt(?:[-_].*)?$/i)) return m;
    return '<' + tag + withDirRtl(attrs) + '>';
  });

  // ── 8) smart icon-text mirror for <a>/<button> ──────────────────
  html = html.replace(/<(a|button)\b([^>]*)>([\s\S]*?)<\/\1>/gi, (m, tag, attrs, inner) => {
    if (!/<(?:img|svg|i\b|span\s+class=["\'][^"\']*\bicon)/i.test(inner)) return m;
    if (!hasVisibleText(inner)) return m;
    if (/\bdirection\s*:/i.test(attrs)) return m;
    let nextAttrs;
    if (/\bstyle\s*=/i.test(attrs)) {
      nextAttrs = attrs.replace(/\bstyle\s*=\s*(["'])([\s\S]*?)\1/i,
        (_full, q, body) => 'style=' + q + body.replace(/\s*;?\s*$/, ';') + ' direction: rtl;' + q);
    } else {
      nextAttrs = attrs + ' style="direction: rtl;"';
    }
    return '<' + tag + nextAttrs + '>' + inner + '</' + tag + '>';
  });

  return html;
}

// ─── Preview click → editor highlight ──────────────────────────
function cmHighlight(pos, posEnd, targetCm) {
  // Use the active editor (fullscreen or main)
  const activeCm = targetCm || getActiveCm() || cm;
  if (!activeCm) return;
  activeCm.setSelection(pos, posEnd);
  activeCm.scrollIntoView({ from: pos, to: posEnd }, 80);
  // Flash the editor pane border
  const paneEl = isFullscreenOpen() ? r.fullscreenCmWrap : r.editorPane;
  if (paneEl) {
    paneEl.style.boxShadow = '0 0 0 2px var(--accent)';
    setTimeout(() => { if (paneEl) paneEl.style.boxShadow = ''; }, 900);
  }
  activeCm.focus();
}

window.addEventListener('message', e => {
  if (!e.data || !cm) return;

  // ── Placeholder click ─────────────────────────────────────────
  if (e.data.type === 'retkit-ph-click') {
    const ph = e.data.ph; // e.g. "nsName.block_3"
    if (!ph) return;
    const esc = ph.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const phRe = new RegExp('\\$\\{\\{\\s*' + esc + '\\s*\\}\\}\\$');
    const activeCm = getActiveCm() || cm;
    const code = activeCm.getValue();
    const match = phRe.exec(code);
    if (!match) return;
    const pos    = activeCm.posFromIndex(match.index);
    const posEnd = activeCm.posFromIndex(match.index + match[0].length);
    cmHighlight(pos, posEnd, activeCm);
    return;
  }

  // ── General text click ────────────────────────────────────────
  if (e.data.type === 'retkit-text-click') {
    const text = (e.data.text || '').trim();
    const activeCm = getActiveCm() || cm;
    const code = activeCm.getValue();
    const html = (e.data.html || '').trim();

    if (html && html.length >= 3) {
      const htmlCandidates = [
        html,
        html.replace(/&nbsp;/g, '\u00a0'),
        html.replace(/\s+/g, ' '),
      ].filter(Boolean);
      for (const candidate of htmlCandidates) {
        const htmlIdx = code.indexOf(candidate);
        if (htmlIdx !== -1) {
          const pos = activeCm.posFromIndex(htmlIdx);
          const posEnd = activeCm.posFromIndex(htmlIdx + candidate.length);
          cmHighlight(pos, posEnd, activeCm);
          return;
        }
      }
    }

    if (!text || text.length < 3) return;

    // Try exact match first
    let idx = code.indexOf(text);
    if (idx === -1) {
      // Try first 40 chars of the text (element may have child nodes)
      const short = text.slice(0, 40).trim();
      idx = code.indexOf(short);
    }
    if (idx === -1) {
      // Try a 5-word snippet from the middle of the text
      const words = text.split(/\s+/).filter(Boolean);
      const snippet = words.slice(0, Math.min(5, words.length)).join(' ');
      idx = code.indexOf(snippet);
    }
    if (idx === -1) {
      // Last resort: search in main cm if fullscreen active
      if (activeCm !== cm) {
        const mainCode = cm.getValue();
        let mainIdx = mainCode.indexOf(text);
        if (mainIdx === -1) mainIdx = mainCode.indexOf(text.slice(0, 40).trim());
        if (mainIdx !== -1) {
          const mLen = Math.min(text.length, mainCode.length - mainIdx);
          cmHighlight(cm.posFromIndex(mainIdx), cm.posFromIndex(mainIdx + mLen), cm);
          return;
        }
      }
      return; // not found anywhere
    }

    const matchLen = Math.min(text.length, code.length - idx);
    const pos    = activeCm.posFromIndex(idx);
    const posEnd = activeCm.posFromIndex(idx + matchLen);
    cmHighlight(pos, posEnd, activeCm);
  }
});

// Viewport buttons
document.querySelectorAll('.vp-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const vp = btn.dataset.vp;
    state.viewport = vp;
    document.querySelectorAll('.vp-btn').forEach(b => b.classList.toggle('active', b.dataset.vp === vp));
    r.previewFrame.className = vp === 'mobile' ? 'viewport-mobile' : 'viewport-desktop';
    Object.assign(r.previewFrameWrap.style, vp === 'mobile'
      ? { display:'flex', justifyContent:'center', alignItems:'flex-start', background:'var(--bg)' }
      : { display:'', justifyContent:'', alignItems:'', background:'' }
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// COPY / DOWNLOAD HTML
// ═══════════════════════════════════════════════════════════════

r.copyHtmlBtn.addEventListener('click', async () => {
  if (!cm) return;
  // If a locale is active — copy the rendered (substituted) HTML, not raw placeholders
  const isLocale = state.activeLocale !== 'original';
  const text = isLocale ? getRenderedHtml(true) : cm.getValue();
  const label = isLocale ? `HTML (${state.activeLocale}) скопирован!` : 'HTML скопирован!';
  try { await navigator.clipboard.writeText(text); toast(label, 'success'); }
  catch { toast('Ошибка копирования', 'error'); }
});

r.downloadHtmlBtn.addEventListener('click', () => {
  if (!cm) return;
  const isLocale = state.activeLocale !== 'original';
  const text = isLocale ? getRenderedHtml(true) : cm.getValue();
  const baseName = state.files.find(f => f.id === state.activeFileId)?.name || 'email.html';
  const fileName = isLocale
    ? baseName.replace(/\.html$/i, '') + `_${state.activeLocale}.html`
    : baseName;
  const blob = new Blob([text], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  Object.assign(document.createElement('a'), { href: url, download: fileName }).click();
  URL.revokeObjectURL(url);
  toast('HTML скачан', 'success');
});

// ═══════════════════════════════════════════════════════════════
// VALIDATION
// ═══════════════════════════════════════════════════════════════

function validateLocales() {
  const codes = getAllLocaleCodes();
  if (!codes.length) { r.validateBadge.classList.add('hidden'); applyLocaleValidationStyles(); return; }

  let totalErrors = 0;
  const localeStatus = {};

  state.namespaces.forEach(ns => {
    if (ns.builtin) return; // footer_upload и пр. служебные — не валидируем, не красим
    ensureLocaleMeta(ns);
    const nsCodes = Object.keys(ns.locales);
    const refCode = nsCodes.find(c => c.startsWith('en')) || nsCodes[0];
    const refN = ns.locales[refCode]?.length || 0;
    nsCodes.forEach(code => {
      const n = ns.locales[code].length;
      let status = n < refN ? 'error' : n > refN ? 'warning' : 'ok';
      const raw = ns.localeRaw?.[code];
      const parsedIssues = raw != null ? parseTxtDetailed(raw).issues : (ns.localeIssues?.[code] || []);
      if (parsedIssues.some(i => i.severity === 'error')) status = 'error';
      else if (parsedIssues.length && status === 'ok') status = 'warning';
      if (status === 'error') totalErrors++;
      const prev = localeStatus[code] || 'ok';
      if (status === 'error' || (status === 'warning' && prev === 'ok')) localeStatus[code] = status;
      else if (!localeStatus[code]) localeStatus[code] = status;
    });
  });

  r.validateBadge.textContent = totalErrors;
  r.validateBadge.classList.toggle('hidden', totalErrors === 0);
  applyLocaleValidationStyles(localeStatus);
}

function applyLocaleValidationStyles(localeStatus = {}) {
  r.localeTabs.querySelectorAll('.locale-tab[data-locale]').forEach(tab => {
    const code = tab.dataset.locale;
    if (code === 'original') return;
    const s = localeStatus[code];
    if (s === 'error')   tab.dataset.valid = 'error';
    else if (s === 'warning') tab.dataset.valid = 'warning';
    else delete tab.dataset.valid;
  });
}

function runHtmlAudit() {
  const html = cm?.getValue() || '';
  if (!html.trim()) {
    r.validateResults.innerHTML = '<div class="panel-empty">Откройте HTML файл для аудита</div>';
    r.validateBadge.classList.add('hidden');
    return;
  }

  const issues = [];
  const ok = [];

  // Parse into a DOM for structural checks
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  // 1. Images without alt
  const imgs = doc.querySelectorAll('img');
  imgs.forEach((img, i) => {
    const src = img.getAttribute('src') || '';
    const alt = img.getAttribute('alt');
    if (alt === null) {
      issues.push({ level:'error', msg: `&lt;img&gt; без alt: <code>${escapeHtml(src.slice(0,60) || '(нет src)')}</code>` });
    } else if (alt === '') {
      ok.push(`img[alt=""] (декоративная) — src: <code>${escapeHtml(src.slice(0,50))}</code>`);
    }
  });
  if (imgs.length && !issues.find(i => i.msg.includes('img'))) {
    ok.push(`Все ${imgs.length} изображений имеют alt`);
  }

  // 2. Links without href or href="#"
  const links = doc.querySelectorAll('a');
  links.forEach(a => {
    const href = a.getAttribute('href');
    if (!href || href === '#') {
      const text = (a.textContent||'').trim().slice(0,40);
      issues.push({ level:'warn', msg: `Ссылка без href: <code>${escapeHtml(text||'(пустая)')}</code>` });
    }
  });
  if (links.length && !issues.find(i => i.msg.includes('ссылка') || i.msg.includes('Ссылка'))) {
    ok.push(`Все ${links.length} ссылок имеют href`);
  }

  // 3. Inline styles with px units on td/table (potential Outlook issues)
  const tds = doc.querySelectorAll('td[style], table[style]');
  let outlookStyleWarnings = 0;
  tds.forEach(el => {
    const s = el.getAttribute('style')||'';
    if (/border-radius/i.test(s)) {
      outlookStyleWarnings++;
    }
  });
  if (outlookStyleWarnings > 0) {
    issues.push({ level:'warn', msg: `border-radius на td/table (${outlookStyleWarnings} шт) — не работает в Outlook` });
  }

  // 4. Missing width on table/td (layout can break in email clients)
  const tables = doc.querySelectorAll('table');
  let tablesNoWidth = 0;
  tables.forEach(t => {
    if (!t.getAttribute('width') && !/(width\s*:)/i.test(t.getAttribute('style')||'')) {
      tablesNoWidth++;
    }
  });
  if (tablesNoWidth > 3) {
    issues.push({ level:'warn', msg: `${tablesNoWidth} таблиц без атрибута width — могут ехать в почтовых клиентах` });
  } else if (tables.length) {
    ok.push(`Таблицы: ${tables.length - tablesNoWidth}/${tables.length} имеют width`);
  }

  // 5. Empty src on img
  doc.querySelectorAll('img[src=""], img:not([src])').forEach(img => {
    issues.push({ level:'error', msg: `&lt;img&gt; с пустым src` });
  });

  // 6. Check for unclosed tags via rawHTML mismatch heuristic
  const openTags  = (html.match(/<(table|tr|td|div|span|p|a|b|strong|em|h[1-6])\b/gi)||[]).length;
  const closeTags = (html.match(/<\/(table|tr|td|div|span|p|a|b|strong|em|h[1-6])>/gi)||[]).length;
  if (Math.abs(openTags - closeTags) > 2) {
    issues.push({ level:'warn', msg: `Возможно незакрытые теги: ${openTags} открывающих vs ${closeTags} закрывающих` });
  } else {
    ok.push(`Баланс тегов ок (${openTags} open, ${closeTags} close)`);
  }

  // 7. Inline CSS (email-safe — good!)
  const inlineStyleCount = (html.match(/style\s*=/gi)||[]).length;
  ok.push(`Inline style атрибутов: ${inlineStyleCount}`);

  // 8. Check for <style> blocks (may not render in all clients)
  const styleBlocks = doc.querySelectorAll('head style, body style').length;
  if (styleBlocks > 0) {
    issues.push({ level:'info', msg: `&lt;style&gt; блоков: ${styleBlocks} — Gmail может их срезать` });
  }

  // 9. doctype
  if (!/<!doctype html/i.test(html)) {
    issues.push({ level:'warn', msg: 'Нет DOCTYPE' });
  } else {
    ok.push('DOCTYPE присутствует');
  }

  // 10. charset meta
  if (!doc.querySelector('meta[charset]') && !/<meta[^>]+charset/i.test(html)) {
    issues.push({ level:'warn', msg: 'Нет &lt;meta charset&gt;' });
  } else {
    ok.push('Charset задан');
  }

  // Build output
  const errorCount = issues.filter(i => i.level==='error').length;
  const warnCount  = issues.filter(i => i.level==='warn').length;
  const infoCount  = issues.filter(i => i.level==='info').length;
  const totalIssues = errorCount + warnCount + infoCount;

  // Update badge
  if (totalIssues > 0) {
    r.validateBadge.textContent = totalIssues;
    r.validateBadge.classList.remove('hidden');
    r.validateBadge.style.background = errorCount > 0 ? 'var(--danger)' : 'var(--warning,#f59e0b)';
  } else {
    r.validateBadge.classList.add('hidden');
  }

  const levelIcon = { error:'❌', warn:'⚠️', info:'ℹ️' };
  const levelClass = { error:'error', warn:'warn', info:'ok' };

  let out = `<div style="margin-bottom:10px;font-size:11.5px;color:var(--text-2)">
    Аудит HTML: <strong style="color:var(--danger)">${errorCount} ошибок</strong> ·
    <strong style="color:#f59e0b">${warnCount} предупреждений</strong> ·
    <strong style="color:var(--accent)">${infoCount} инфо</strong>
  </div>`;

  if (issues.length === 0) {
    out += `<div class="validate-item ok"><span class="validate-icon">✅</span>
      <div class="validate-text">Явных проблем не обнаружено</div></div>`;
  } else {
    issues.forEach(issue => {
      out += `<div class="validate-item ${levelClass[issue.level]}">
        <span class="validate-icon">${levelIcon[issue.level]}</span>
        <div class="validate-text">${issue.msg}</div>
      </div>`;
    });
  }

  if (ok.length) {
    out += `<div style="margin-top:10px;border-top:1px solid var(--border);padding-top:8px">
      <div style="font-size:11px;color:var(--text-3);margin-bottom:6px">✓ Проверки пройдены</div>`;
    ok.forEach(note => {
      out += `<div class="validate-item ok" style="opacity:.7">
        <span class="validate-icon" style="font-size:10px">✓</span>
        <div class="validate-text" style="font-size:11px">${escapeHtml(note)}</div>
      </div>`;
    });
    out += '</div>';
  }

  r.validateResults.innerHTML = out;
}

// Wire audit button
$('runAuditBtn')?.addEventListener('click', runHtmlAudit);

// ═══════════════════════════════════════════════════════════════
// EMAIL SOURCE FILE NAVIGATOR
// ═══════════════════════════════════════════════════════════════

const EXT_MODE = { pug: 'pug-with-placeholders', jade: 'pug-with-placeholders', styl: 'css-with-placeholders', css: 'css-with-placeholders', html: 'html-with-placeholders', htm: 'html-with-placeholders' };
const EXT_ICON = { pug: '🟠', jade: '🟠', styl: '🟢', css: '🟢', html: '🔵' };

// ─── Email block library (Pug templates) ────────────────────────
const EMAIL_BLOCKS = [
  {
    id: 'text',
    label: 'Текст',
    icon: '¶',
    color: '#3b82f6',
    pug: `\ntable.row.white-bg\n    tr\n        td.wrapper.last.offset-by-one\n            table.ten.columns\n                tr\n                    td.text-pad-small.pt20.pb20\n                        p.text Текст параграфа\n`,
    html: `\n<table class="row white-bg" width="100%" cellpadding="0" cellspacing="0"><tr><td class="wrapper last offset-by-one"><table class="ten columns" cellpadding="0" cellspacing="0"><tr><td class="text-pad-small pt20 pb20"><p class="text" style="margin:0;padding:0;">Текст параграфа</p></td></tr></table></td></tr></table>\n`,
  },
  {
    id: 'heading',
    label: 'Заголовок',
    icon: 'H1',
    color: '#f59e0b',
    pug: `\ntable.row.white-bg\n    tr\n        td.wrapper.last.offset-by-one\n            table.ten.columns\n                tr\n                    td.text-pad-small.pt20.pb10\n                        p.middle-title.center Заголовок блока\n`,
    html: `\n<table class="row white-bg" width="100%" cellpadding="0" cellspacing="0"><tr><td class="wrapper last offset-by-one"><table class="ten columns" cellpadding="0" cellspacing="0"><tr><td class="text-pad-small pt20 pb10" style="text-align:center;"><p class="middle-title" style="margin:0;padding:0;font-size:22px;font-weight:700;">Заголовок блока</p></td></tr></table></td></tr></table>\n`,
  },
  {
    id: 'cta-button',
    label: 'Кнопка CTA',
    icon: '▶',
    color: '#22c55e',
    pug: `\ntable.row.white-bg\n    tr\n        td.wrapper.last.offset-by-three.pt0\n            table.six.columns\n                tr\n                    td.pb40.text-pad-small.pt0\n                        .button-wrapper\n                            table.medium-button.radius\n                                tr\n                                    td.iq\n                                        a.butt(href="#" target="_blank") Кнопка\n`,
    html: `\n<table class="row white-bg" width="100%" cellpadding="0" cellspacing="0"><tr><td class="wrapper last" style="text-align:center;padding:20px 0 40px;"><table cellpadding="0" cellspacing="0" style="margin:0 auto;"><tr><td style="background:#2563eb;border-radius:4px;padding:12px 32px;"><a href="#" target="_blank" style="color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;">Кнопка</a></td></tr></table></td></tr></table>\n`,
  },
  {
    id: 'image',
    label: 'Изображение',
    icon: '🖼',
    color: '#8b5cf6',
    pug: `\ntable.row.white-bg\n    tr\n        td.wrapper.last.pt0.offset-by-one\n            table.ten.columns\n                tr\n                    td.pb0.text-pad-small.pt20\n                        img.center(src="https://via.placeholder.com/580x200" width="580" alt="")\n`,
    html: `\n<table class="row white-bg" width="100%" cellpadding="0" cellspacing="0"><tr><td class="wrapper last offset-by-one" style="padding:20px 0 0;text-align:center;"><img src="https://via.placeholder.com/580x200" width="580" style="display:block;margin:0 auto;max-width:100%;" alt=""></td></tr></table>\n`,
  },
  {
    id: 'text-button',
    label: 'Текст + кнопка',
    icon: '¶▶',
    color: '#06b6d4',
    pug: `\ntable.row.white-bg\n    tr\n        td.wrapper.last.offset-by-one\n            table.ten.columns\n                tr\n                    td.text-pad-small.pt20.pb15\n                        p.text.center.pb15 Опишите действие, которое хотите предложить пользователю\ntable.row.white-bg\n    tr\n        td.wrapper.last.offset-by-three.pt0\n            table.six.columns\n                tr\n                    td.pb40.text-pad-small.pt0\n                        .button-wrapper\n                            table.medium-button.radius\n                                tr\n                                    td.iq\n                                        a.butt(href="#" target="_blank") Перейти\n`,
    html: `\n<table class="row white-bg" width="100%" cellpadding="0" cellspacing="0"><tr><td class="wrapper last offset-by-one" style="text-align:center;padding:20px 0 15px;"><p class="text" style="margin:0;padding:0 0 15px;">Опишите действие, которое хотите предложить пользователю</p><table cellpadding="0" cellspacing="0" style="margin:0 auto;"><tr><td style="background:#2563eb;border-radius:4px;padding:12px 32px;"><a href="#" target="_blank" style="color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;">Перейти</a></td></tr></table></td></tr></table>\n`,
  },
  {
    id: 'two-cols',
    label: '2 колонки',
    icon: '⊞',
    color: '#ec4899',
    pug: `\ntable.row.white-bg\n    tr\n        td.wrapper.last.offset-by-one\n            table.ten.columns\n                tr\n                    td.five.sub-columns.text-pad-small.pt20.pb20\n                        p.text Левая колонка\n                    td.five.sub-columns.text-pad-small.pt20.pb20\n                        p.text Правая колонка\n`,
    html: `\n<table class="row white-bg" width="100%" cellpadding="0" cellspacing="0"><tr><td class="wrapper last offset-by-one"><table class="ten columns" cellpadding="0" cellspacing="0"><tr><td class="five sub-columns text-pad-small pt20 pb20" style="width:50%;vertical-align:top;"><p class="text" style="margin:0;padding:0;">Левая колонка</p></td><td class="five sub-columns text-pad-small pt20 pb20" style="width:50%;vertical-align:top;"><p class="text" style="margin:0;padding:0;">Правая колонка</p></td></tr></table></td></tr></table>\n`,
  },
  {
    id: 'divider',
    label: 'Разделитель',
    icon: '—',
    color: '#6e7681',
    pug: `\ntable.row.white-bg\n    tr\n        td.wrapper.last.offset-by-one\n            table.ten.columns\n                tr\n                    td.pt10.pb10\n                        table(width="100%" cellpadding="0" cellspacing="0")\n                            tr\n                                td(style="border-top: 1px solid #e0e0e0; font-size: 0; line-height: 0;") &nbsp;\n`,
    html: `\n<table class="row white-bg" width="100%" cellpadding="0" cellspacing="0"><tr><td class="wrapper last offset-by-one" style="padding:10px 0;"><table width="100%" cellpadding="0" cellspacing="0"><tr><td style="border-top:1px solid #e0e0e0;font-size:0;line-height:0;">&nbsp;</td></tr></table></td></tr></table>\n`,
  },
  {
    id: 'shell-white',
    label: 'Пустой контейнер',
    icon: '□',
    color: '#94a3b8',
    pug: `\ntable.row.brad-full.white-bg\n    tr\n        td.wrapper.last.offset-by-one\n            table.ten.columns\n                tr\n                    td.text-pad-small.pb44.pt44\n`,
    html: `\n<table class="row brad-full white-bg" width="100%" cellpadding="0" cellspacing="0"><tr><td class="wrapper last offset-by-one"><table class="ten columns" cellpadding="0" cellspacing="0"><tr><td class="text-pad-small pb44 pt44">&nbsp;</td></tr></table></td></tr></table>\n`,
  },
  {
    id: 'h12-spacer',
    label: 'h-12',
    icon: '12',
    color: '#64748b',
    pug: `\n.h-12 &nbsp;\n`,
    html: `\n<div class="h-12" style="height:12px;line-height:12px;font-size:12px;">&nbsp;</div>\n`,
  },
  {
    id: 'middle-title',
    label: 'Middle title',
    icon: 'T',
    color: '#f59e0b',
    pug: `\ntable.row.white-bg\n    tr\n        td.wrapper.last.offset-by-one\n            table.ten.columns\n                tr\n                    td.text-pad-small.pb16.pt24\n                        p.middle-title \${{ MAIL_ID.block_00 }}$\n`,
    html: `\n<table class="row white-bg" width="100%" cellpadding="0" cellspacing="0"><tr><td class="wrapper last offset-by-one"><table class="ten columns" cellpadding="0" cellspacing="0"><tr><td class="text-pad-small pb16 pt24"><p class="middle-title" style="margin:0;padding:0;">\${{ MAIL_ID.block_00 }}$</p></td></tr></table></td></tr></table>\n`,
  },
  {
    id: 'iq-button',
    label: 'IQ кнопка',
    icon: 'BTN',
    color: '#22c55e',
    pug: `\ntable.row.white-bg\n    tr\n        td.wrapper.last.pt20.pb40\n            table.w280(align="center")\n                tr\n                    td.butt.pb0\n                        a.butt-link(href="https://api.iqoption.com/v1/multi-links/asset-selector?category=binary-option&aff=7&afftrack=mail_MAIL_ID&retrack=mail_MAIL_ID" universal="true" target="_blank") open\n`,
    html: `\n<table class="row white-bg" width="100%" cellpadding="0" cellspacing="0"><tr><td class="wrapper last" style="padding:20px 0 40px;text-align:center;"><table class="w280" align="center" cellpadding="0" cellspacing="0"><tr><td class="butt pb0"><a class="butt-link" href="https://api.iqoption.com/v1/multi-links/asset-selector?category=binary-option&aff=7&afftrack=mail_MAIL_ID&retrack=mail_MAIL_ID" universal="true" target="_blank">open</a></td></tr></table></td></tr></table>\n`,
  },
  {
    id: 'asset-gray',
    label: 'Asset block',
    icon: '▣',
    color: '#8b5cf6',
    pug: `\ntable.row.white-bg\n    tr\n        td.wrapper.last.offset-by-one\n            table.ten.columns\n                tr\n                    td.text-pad-small.pb16.pt16\n                        a(href="https://api.iqoption.com/v1/multi-links/open-asset?aff=7&afftrack=mail_MAIL_ID&retrack=mail_MAIL_ID&type=digital-option&asset=1912" universal="true" target="_blank")\n                            .gray-block\n                                p.text-asset-block\n                                    img.asset-logo-2(src="https://fsms.quadcode.com/storage/public/d6/pb/kcjursrq72d918jg/gold.png")\n                                    | \${{ MAIL_ID.block_00 }}$\n`,
    html: `\n<table class="row white-bg" width="100%" cellpadding="0" cellspacing="0"><tr><td class="wrapper last offset-by-one"><table class="ten columns" cellpadding="0" cellspacing="0"><tr><td class="text-pad-small pb16 pt16"><a href="https://api.iqoption.com/v1/multi-links/open-asset?aff=7&afftrack=mail_MAIL_ID&retrack=mail_MAIL_ID&type=digital-option&asset=1912" universal="true" target="_blank"><div class="gray-block"><p class="text-asset-block" style="margin:0;padding:0;"><img class="asset-logo-2" src="https://fsms.quadcode.com/storage/public/d6/pb/kcjursrq72d918jg/gold.png" alt="">\${{ MAIL_ID.block_00 }}$</p></div></a></td></tr></table></td></tr></table>\n`,
  },
  {
    id: 'socials-3',
    label: 'Соцсети IQ',
    icon: 'SOC',
    color: '#f97316',
    pug: `\ntable.row\n    tr\n        td.wrapper.last.pt30\n            table.twelve.columns\n                tr\n                    td(align="center").pb0.center\n                        .socials.center\n                            a.first-link(href="\${{ socials-3.block_04 }}$" universal="true" target="_blank")\n                                img.soc-icon.fb(src="https://fsms.quadcode.com/storage/public/d5/ka/q8fvhhge5gv5vatg/tiktok-logo.png")\n                            a(href="\${{ socials-3.block_01 }}$" universal="true" target="_blank")\n                                img.soc-icon.twitter(src="https://fsms.iqoption.com/storage/public/cn/td/fri03qqv4qln7ve0/ig.png")\n                            a(href="\${{ socials-3.block_03 }}$" universal="true" target="_blank")\n                                img.soc-icon.you(src="https://fsms.iqoption.com/storage/public/cn/td/gb285cee2vclvjq0/yt.png")\n                            a.last-link(href="\${{ socials-3.block_05 }}$" universal="true" target="_blank")\n                                img.soc-icon.ig(src="https://fsms.quadcode.com/storage/public/d5/ka/rf7vhhge5gv5vau0/tg.png")\n`,
    html: `\n<table class="row" width="100%" cellpadding="0" cellspacing="0"><tr><td class="wrapper last pt30"><table class="twelve columns" cellpadding="0" cellspacing="0"><tr><td align="center" class="pb0 center"><div class="socials center"><a class="first-link" href="\${{ socials-3.block_04 }}$" universal="true" target="_blank"><img class="soc-icon fb" src="https://fsms.quadcode.com/storage/public/d5/ka/q8fvhhge5gv5vatg/tiktok-logo.png" alt=""></a><a href="\${{ socials-3.block_01 }}$" universal="true" target="_blank"><img class="soc-icon twitter" src="https://fsms.iqoption.com/storage/public/cn/td/fri03qqv4qln7ve0/ig.png" alt=""></a><a href="\${{ socials-3.block_03 }}$" universal="true" target="_blank"><img class="soc-icon you" src="https://fsms.iqoption.com/storage/public/cn/td/gb285cee2vclvjq0/yt.png" alt=""></a><a class="last-link" href="\${{ socials-3.block_05 }}$" universal="true" target="_blank"><img class="soc-icon ig" src="https://fsms.quadcode.com/storage/public/d5/ka/rf7vhhge5gv5vau0/tg.png" alt=""></a></div></td></tr></table></td></tr></table>\n`,
  },
  {
    id: 'spacer',
    label: 'Отступ',
    icon: '↕',
    color: '#6e7681',
    pug: `\ntable.row.white-bg\n    tr\n        td.wrapper.last.pt40.pb40\n            table.ten.columns\n                tr\n                    td &nbsp;\n`,
    html: `\n<table class="row white-bg" width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:40px 0;">&nbsp;</td></tr></table>\n`,
  },
  {
    id: 'social',
    label: 'Соцсети',
    icon: '🔗',
    color: '#f97316',
    pug: `\ntable.row.white-bg\n    tr\n        td.wrapper.last.offset-by-one.pt20.pb20\n            table.ten.columns\n                tr\n                    td.text-pad-small\n                        .social-links.pb20\n                            a.soc-link(href="#" target="_blank" style="display:inline-block;margin:0 6px")\n                                img(src="https://i.imgur.com/9lEUnQH.png" width="30" alt="Facebook")\n                            a.soc-link(href="#" target="_blank" style="display:inline-block;margin:0 6px")\n                                img(src="https://i.imgur.com/p0SnKCk.png" width="30" alt="Instagram")\n`,
    html: `\n<table class="row white-bg" width="100%" cellpadding="0" cellspacing="0"><tr><td class="wrapper last offset-by-one" style="text-align:center;padding:20px 0;"><a href="#" target="_blank" style="display:inline-block;margin:0 6px;"><img src="https://i.imgur.com/9lEUnQH.png" width="30" alt="Facebook"></a><a href="#" target="_blank" style="display:inline-block;margin:0 6px;"><img src="https://i.imgur.com/p0SnKCk.png" width="30" alt="Instagram"></a></td></tr></table>\n`,
  },
  {
    id: 'logo',
    label: 'Лого',
    icon: '⬡',
    color: '#f97316',
    pug: `\ntable.row.bg-col\n    tr\n        td.wrapper.last.pt0.offset-by-one\n            table.ten.columns\n                tr\n                    td.pb0.text-pad-small\n                        a(href="#" target="_blank")\n                            img.logo.center(src="https://via.placeholder.com/140x40" width="140" alt="Logo")\n`,
    html: `\n<table class="row bg-col" width="100%" cellpadding="0" cellspacing="0"><tr><td class="wrapper last offset-by-one" style="text-align:center;padding:20px 0;"><a href="#" target="_blank"><img src="https://via.placeholder.com/140x40" width="140" alt="Logo" style="display:block;margin:0 auto;"></a></td></tr></table>\n`,
  },
];


// ─── Lazy-loaded base catalog blocks ─────────────────────────────────────
// EMAIL_BLOCKS above are the curated default set.
// "From base" cards come from /api/wb/block-catalog (data/block-catalog.json
// merged with data/block-snippets.json) — see scripts/extract-block-snippets.mjs.
let _catalogBlocksCache = null;
let _catalogBlocksLoading = null;

const CATALOG_KIND_META = {
  cta:           { icon: '▶',  color: '#22c55e' },
  hero:          { icon: '🖼', color: '#8b5cf6' },
  footer:        { icon: '⚓',  color: '#6e7681' },
  'feature-list':{ icon: '☰',  color: '#06b6d4' },
  image:         { icon: '🖼', color: '#a855f7' },
  text:          { icon: '¶',  color: '#3b82f6' },
};

async function loadCatalogBlocks() {
  if (_catalogBlocksCache) return _catalogBlocksCache;
  if (_catalogBlocksLoading) return _catalogBlocksLoading;
  _catalogBlocksLoading = (async () => {
    try {
      const res = await fetch('/api/wb/block-catalog');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const items = (json.items || []).filter(it => it.pug);
      _catalogBlocksCache = items.map(it => {
        const meta = CATALOG_KIND_META[it.sectionKind] || { icon: '◧', color: '#94a3b8' };
        return {
          id: `base:${it.id}`,
          label: it.label || it.id,
          icon: meta.icon,
          color: meta.color,
          source: 'base',
          sourceFile: it.sourceFile,
          pug: it.pug,
          html: '', // generated on the fly via _pugToHtmlFallback when needed
          description: it.description || '',
          usageCount: it.usageCount || 0,
        };
      });
      return _catalogBlocksCache;
    } catch (err) {
      console.warn('[blocks] catalog load failed:', err.message);
      _catalogBlocksCache = [];
      return _catalogBlocksCache;
    } finally {
      _catalogBlocksLoading = null;
    }
  })();
  return _catalogBlocksLoading;
}

function findBlockById(blockId) {
  if (!blockId) return null;
  let hit = EMAIL_BLOCKS.find(b => b.id === blockId);
  if (hit) return hit;
  if (_catalogBlocksCache) {
    hit = _catalogBlocksCache.find(b => b.id === blockId);
    if (hit) return hit;
  }
  return null;
}


function _makeBlockCard(block, klass) {
  const card = document.createElement('div');
  card.className = klass;
  card.draggable = true;
  card.dataset.blockId = block.id;
  card.title = block.description ? `${block.label} — ${block.description}` : `Вставить: ${block.label}`;
  const iconCls = klass === 'carousel-card' ? 'carousel-card-icon' : 'block-card-icon';
  const labelCls = klass === 'carousel-card' ? 'carousel-card-label' : 'block-card-label';
  card.innerHTML = `
      <span class="${iconCls}" style="color:${block.color}">${block.icon}</span>
      <span class="${labelCls}">${block.label}</span>
    ` + (block.source === 'base' ? '<span class="block-card-source-tag">base</span>' : '');
  card.addEventListener('click', () => insertEmailBlock(block));
  card.addEventListener('dragstart', e => {
    _activeDragBlockId = block.id;
    e.dataTransfer.setData('text/plain', block.id);
    e.dataTransfer.effectAllowed = 'copy';
    card.classList.add('dragging');
    requestAnimationFrame(() => _showBlockDropOverlay());
  });
  card.addEventListener('dragend', () => {
    _activeDragBlockId = null;
    card.classList.remove('dragging');
    _hideBlockDropOverlay();
  });
  return card;
}

let _blocksShelfOpen = false;
let _activeDragBlockId = null;  // Set during block card dragstart, cleared on dragend
let _dragDropLine = null;       // CodeMirror line being highlighted during drag
let _previewDropLineEl = null;  // Visual insertion line over the right preview
let _previewDropTargetEl = null; // Ghost outline of the block we're inserting near
let _previewFrameDropAbort = null;

function renderBlocksShelf() {
  const shelf = $('blocksShelf');
  const inner = $('blocksShelfInner');
  if (!shelf || !inner) return;
  inner.innerHTML = '';
  // Default curated cards
  EMAIL_BLOCKS.forEach(block => {
    const card = document.createElement('div');
    card.className = 'block-card';
    card.draggable = true;
    card.dataset.blockId = block.id;
    card.title = `Вставить: ${block.label}`;
    card.innerHTML = `
      <span class="block-card-icon" style="color:${block.color}">${block.icon}</span>
      <span class="block-card-label">${block.label}</span>
    `;
    // Click → insert at cursor
    card.addEventListener('click', () => insertEmailBlock(block));
    // Drag start
    card.addEventListener('dragstart', e => {
      _activeDragBlockId = block.id;
      // Use only a custom mime so CodeMirror's default drop handler can't
      // paste anything by itself. We drive insertion manually.
      e.dataTransfer.setData('application/x-retkit-block', block.id);
      try { e.dataTransfer.setData('text/plain', ''); } catch {}
      e.dataTransfer.effectAllowed = 'copy';
      card.classList.add('dragging');
      requestAnimationFrame(() => _showBlockDropOverlay());
    });
    card.addEventListener('dragend', () => {
      _activeDragBlockId = null;
      card.classList.remove('dragging');
      _hideBlockDropOverlay();
    });
    inner.appendChild(card);
  });

  // Async-render "From base" section.
  loadCatalogBlocks().then(items => {
    if (!items.length) return;
    const sep = document.createElement('div');
    sep.className = 'block-shelf-section-label';
    sep.textContent = 'Из базы';
    inner.appendChild(sep);
    items.forEach(block => inner.appendChild(_makeBlockCard(block, 'block-card')));
  });
}

// ── Right-panel carousel ───────────────────────────────────────────
let _carouselRendered = false;

function renderBlocksCarousel() {
  const track = r.blocksCarouselTrack;
  if (!track || _carouselRendered) return;
  _carouselRendered = true;
  track.innerHTML = '';
  EMAIL_BLOCKS.forEach(block => {
    const card = document.createElement('div');
    card.className = 'carousel-card';
    card.draggable = true;
    card.dataset.blockId = block.id;
    card.title = `Вставить: ${block.label}`;
    card.innerHTML = `
      <span class="carousel-card-icon" style="color:${block.color}">${block.icon}</span>
      <span class="carousel-card-label">${block.label}</span>
    `;
    card.addEventListener('click', () => insertEmailBlock(block));
    card.addEventListener('dragstart', e => {
      _activeDragBlockId = block.id;
      // Use only a custom mime so CodeMirror's default drop handler can't
      // paste anything by itself. We drive insertion manually.
      e.dataTransfer.setData('application/x-retkit-block', block.id);
      try { e.dataTransfer.setData('text/plain', ''); } catch {}
      e.dataTransfer.effectAllowed = 'copy';
      card.classList.add('dragging');
      requestAnimationFrame(() => _showBlockDropOverlay());
    });
    card.addEventListener('dragend', () => {
      _activeDragBlockId = null;
      card.classList.remove('dragging');
      _hideBlockDropOverlay();
    });
    track.appendChild(card);
  });

  // Async-render "From base" section.
  loadCatalogBlocks().then(items => {
    if (!items.length) return;
    const sep = document.createElement('div');
    sep.className = 'carousel-section-label';
    sep.textContent = 'Из базы';
    track.appendChild(sep);
    items.forEach(block => track.appendChild(_makeBlockCard(block, 'carousel-card')));
  });
}

function showBlocksCarousel() {
  renderBlocksCarousel();
  r.blocksCarousel?.classList.remove('hidden');
}

function hideBlocksCarousel() {
  r.blocksCarousel?.classList.add('hidden');
}

// ──────────────────────────────────────────────────────────────────

function insertEmailBlock(block, placement = {}) {
  const activeCm = getActiveCm();
  if (!activeCm) return;

  const ctx = state.srcCtx;

  // If currently viewing compiled HTML (read-only), switch to source first
  if (ctx?.viewingCompiledHtml) {
    const srcFile = findPrimaryMarkupSourceFile(ctx);
    if (srcFile) {
      loadSourceFile(srcFile).then(() => insertEmailBlock(block));
    } else {
      toast('Переключитесь на файл исходника для вставки блока', 'warning');
    }
    return;
  }

  const ext = ctx?.activeFile?.split('.').pop()?.toLowerCase();

  // Stylus/CSS files — don't insert HTML/Pug blocks there
  if (ext === 'styl' || ext === 'css') {
    toast('Переключитесь на .pug файл чтобы вставить блок', 'warning');
    return;
  }

  // Determine mode: Pug source or plain HTML
  const isPugMode = (ext === 'pug' || ext === 'jade');
  const isHtmlMode = !ctx || ext === 'html' || ext === 'htm' || (!isPugMode && !ext);

  // Get code to insert
  let code;
  if (isPugMode) {
    const mailId = ctx.mail.replace(/^mail-/, '');
    code = block.pug.replace(/MAIL_ID/g, mailId);
  } else if (isHtmlMode) {
    code = block.html || _pugToHtmlFallback(block);
    if (ctx?.mail) code = code.replace(/MAIL_ID/g, ctx.mail.replace(/^mail-/, ''));
  } else {
    toast('Неподдерживаемый формат файла для вставки блока', 'warning');
    return;
  }

  if (!code) { toast('Нет кода блока для этого режима', 'warning'); return; }

  const lastLine = activeCm.lastLine();
  const placementLine = Number.isInteger(placement.line)
    ? Math.max(0, Math.min(lastLine, placement.line))
    : null;

  // SAFETY: never overwrite the entire document. We always insert at a single
  // anchor point. If the editor is empty, prepend; otherwise insert at end-of-line.
  const totalLines = lastLine + 1;
  const docCharLen = activeCm.getValue().length;
  const safeInsertAt = (line, ch) => {
    activeCm.getDoc().replaceRange('\n' + code + '\n', { line, ch });
  };
  if (placement.before && placementLine !== null) {
    safeInsertAt(Math.max(0, placementLine), 0);
    activeCm.setCursor({ line: Math.max(0, placementLine + 1), ch: 0 });
  } else {
    const cursor = placementLine !== null ? { line: placementLine, ch: 0 } : activeCm.getCursor();
    const targetLine = (docCharLen === 0) ? 0
                     : (cursor.line === 0 && cursor.ch === 0) ? lastLine : cursor.line;
    const lineLen = activeCm.getLine(targetLine)?.length ?? 0;
    safeInsertAt(targetLine, lineLen);
    activeCm.setCursor({ line: targetLine + 1, ch: 0 });
  }
  activeCm.focus();

  toast(`✓ Вставлен блок: ${block.label}`, 'success', 1500);

  // In source mode, save/apply after the first-edit modal is resolved.
  if (ctx && (isPugMode || ext === 'html' || ext === 'htm')) {
    clearTimeout(_insertBlockRebuildTimer);
    _insertBlockRebuildTimer = setTimeout(async () => {
      if (_isBackupModalOpen()) return;
      if (!state.srcCtx?.modified) return;
      try {
        await saveCurrentSourceFile(activeCm.getValue());
      } catch {}
    }, 800);
  }
}
let _insertBlockRebuildTimer = null;

function findPrimaryMarkupSourceFile(ctx) {
  if (!ctx) return null;
  const opened = Array.isArray(ctx.openedFiles) ? ctx.openedFiles : [];
  const active = ctx.activeFile && /\.(pug|jade|html?)$/i.test(ctx.activeFile) ? ctx.activeFile : null;
  if (active) return active;
  const openedMarkup = opened.find(path => /\.(pug|jade|html?)$/i.test(path));
  if (openedMarkup) return openedMarkup;
  return ctx.files?.find(f => f.ext === 'pug' || f.ext === 'jade')?.path
    || ctx.files?.find(f => f.ext === 'html' || f.ext === 'htm')?.path
    || null;
}

// Minimal fallback: wrap pug block code in a comment so user knows it's Pug-only
function _pugToHtmlFallback(block) {
  return block.html || `<!-- Block "${block.label}" is Pug-only. Switch to a Pug file to use it. -->`;
}

// ── Drag & drop helpers ───────────────────────────────────────────
function _clearDragDropLine() {
  if (_dragDropLine !== null) {
    const activeCm = getActiveCm();
    if (activeCm) { try { activeCm.removeLineClass(_dragDropLine, 'wrap', 'block-insert-line'); } catch {} }
    _dragDropLine = null;
  }
}

function _setDragDropLine(lineNo) {
  const activeCm = getActiveCm();
  if (!activeCm) return;
  _clearDragDropLine();
  try {
    activeCm.addLineClass(lineNo, 'wrap', 'block-insert-line');
    _dragDropLine = lineNo;
  } catch {}
}

// ── Document-level drag approach (bypasses CM's own drag handling) ─────────────
// CM intercepts dragover/drop on its own elements. We attach to document level so
// we fire BEFORE CM (capture phase for drop), and allow drop everywhere during block drags.

function isFullscreenOpen() {
  return !r.fullscreenOverlay?.classList.contains('hidden');
}
function getActiveCm() {
  return isFullscreenOpen() ? cmFullscreen : cm;
}
function getFocusedCodeMirror() {
  const editors = [cmFullscreenSplit, cmFullscreen, cmSplit, cmLocale, cm].filter(Boolean);
  return editors.find(ed => {
    try { return ed.hasFocus && ed.hasFocus(); }
    catch { return false; }
  }) || getActiveCm() || cm;
}
function getActiveCmWrap() {
  return isFullscreenOpen() ? r.fullscreenCmWrap : r.cmWrap;
}

function _isOverCmWrap(clientX, clientY) {
  const wrap = getActiveCmWrap();
  const rect = wrap?.getBoundingClientRect();
  if (!rect) return false;
  return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
}

function _isOverPreviewPane(clientX, clientY) {
  const rect = r.previewFrameWrap?.getBoundingClientRect();
  if (!rect) return false;
  return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
}

function _clearPreviewDropLine() {
  _previewDropLineEl?.remove();
  _previewDropLineEl = null;
  _previewDropTargetEl?.remove();
  _previewDropTargetEl = null;
}

function _showPreviewDropLine(clientY, opts = {}) {
  const wrap = r.previewFrameWrap;
  const rect = wrap?.getBoundingClientRect();
  if (!wrap || !rect) return;
  if (!_previewDropLineEl) {
    _previewDropLineEl = document.createElement('div');
    _previewDropLineEl.className = 'preview-insert-line';
    _previewDropLineEl.innerHTML = '<span class="preview-insert-line-label">Вставить здесь</span>';
    wrap.appendChild(_previewDropLineEl);
  }

  // If the caller passed a target rectangle (in viewport coords), snap the line
  // to its top (edge="before") or bottom (edge="after"). Otherwise free-float at clientY.
  let y;
  if (opts.targetRect && opts.edge) {
    const frameRect = r.previewFrame?.getBoundingClientRect();
    const tr = opts.targetRect;
    if (opts.edge === 'before') {
      y = (tr.top - rect.top) - 2;
    } else {
      y = (tr.top + tr.height - rect.top) - 2;
    }
    // Clamp to wrap area.
    y = Math.max(4, Math.min(rect.height - 4, y));
    // Highlight target block via a transient class on a ghost overlay.
    if (!_previewDropTargetEl) {
      _previewDropTargetEl = document.createElement('div');
      _previewDropTargetEl.className = 'preview-insert-target';
      wrap.appendChild(_previewDropTargetEl);
    }
    _previewDropTargetEl.style.top = `${tr.top - rect.top}px`;
    _previewDropTargetEl.style.height = `${tr.height}px`;
  } else {
    y = Math.max(8, Math.min(rect.height - 8, clientY - rect.top));
    _previewDropTargetEl?.remove();
    _previewDropTargetEl = null;
  }
  _previewDropLineEl.style.top = `${y}px`;
}

function _findCodeInsertionRows(activeCm) {
  if (!activeCm) return [];
  const rows = [];
  const last = activeCm.lastLine();
  // Pug: top-level "table.row" / "table" with consistent indent.
  // HTML: <table class="row"...> or <table ...> as a top-level block.
  let baseIndent = null;
  for (let line = 0; line <= last; line += 1) {
    const text = activeCm.getLine(line) || '';
    if (!text.trim()) continue;
    const m = text.match(/^(\s*)(table\b|<table\b)/i);
    if (!m) continue;
    const indent = m[1].length;
    if (baseIndent === null) baseIndent = indent;
    // Pug: only same indent counts. HTML: ignore if it's nested in a wrapper (rough heuristic — keep min indent).
    if (indent === baseIndent) rows.push(line);
    else if (indent < baseIndent) {
      // we found something less indented — adopt the new minimum; reset rows
      baseIndent = indent;
      rows.length = 0;
      rows.push(line);
    }
  }
  return rows;
}

function _getPreviewInsertion(clientX, clientY) {
  const activeCm = getActiveCm();
  if (!activeCm) return null;

  const rowsInCode = _findCodeInsertionRows(activeCm);
  const lastLine = activeCm.lastLine();
  const fallback = () => ({
    line: Math.max(0, Math.min(lastLine, Math.round(lastLine * _previewDropRatio(clientY)))),
    before: false,
    targetRect: null,
    edge: 'after',
  });

  const frame = r.previewFrame;
  const frameRect = frame?.getBoundingClientRect();
  const doc = frame?.contentDocument || frame?.contentWindow?.document;
  if (!frameRect || !doc || !rowsInCode.length) return fallback();

  // Block candidates: prefer table.row, fall back to direct children of <body>/<center>.
  let blocks = [...doc.querySelectorAll('table.row, table[class~="row"]')];
  if (!blocks.length) {
    const containers = [doc.body, ...doc.querySelectorAll('center')];
    const seen = new Set();
    for (const c of containers) {
      if (!c) continue;
      for (const child of c.children) {
        if (child.tagName === 'TABLE' && !seen.has(child)) {
          seen.add(child);
          blocks.push(child);
        }
      }
    }
  }
  if (!blocks.length) return fallback();

  const y = clientY - frameRect.top;
  let insertIndex = blocks.length;
  let targetEl = blocks[blocks.length - 1];
  let edge = 'after';
  for (let i = 0; i < blocks.length; i += 1) {
    const rect = blocks[i].getBoundingClientRect();
    const elTop = rect.top - frameRect.top;
    const elMid = elTop + rect.height / 2;
    if (y < elMid) {
      insertIndex = i;
      targetEl = blocks[i];
      edge = 'before';
      break;
    }
  }

  const targetRect = targetEl ? targetEl.getBoundingClientRect() : null;

  // Map block index → CM source line (pad to rowsInCode length).
  const safeIdx = Math.min(insertIndex, rowsInCode.length);
  if (edge === 'before') {
    return {
      line: rowsInCode[Math.min(safeIdx, rowsInCode.length - 1)],
      before: true,
      targetRect,
      edge,
    };
  }
  return {
    line: rowsInCode[rowsInCode.length - 1],
    before: false,
    targetRect,
    edge,
  };
}

function _previewDropRatio(clientY) {
  const rect = r.previewFrameWrap?.getBoundingClientRect();
  if (!rect || rect.height <= 0) return 1;
  return Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
}

function _onDocBlockDragover(e) {
  if (!_activeDragBlockId) return;
  e.preventDefault(); // Allow drop anywhere while block drag is active
  const activeCmWrap = getActiveCmWrap();
  if (_isOverCmWrap(e.clientX, e.clientY)) {
    e.dataTransfer.dropEffect = 'copy';
    activeCmWrap?.classList.add('block-drop-target');
    const activeCm = getActiveCm();
    if (activeCm) {
      try {
        const pos = activeCm.coordsChar({ left: e.clientX, top: e.clientY }, 'window');
        _setDragDropLine(pos.line);
      } catch {}
    }
  } else if (_isOverPreviewPane(e.clientX, e.clientY)) {
    e.dataTransfer.dropEffect = 'copy';
    r.previewFrameWrap?.classList.add('block-drop-target');
    const insertion = _getPreviewInsertion(e.clientX, e.clientY);
    _showPreviewDropLine(e.clientY, insertion ? { targetRect: insertion.targetRect, edge: insertion.edge } : {});
    if (insertion) _setDragDropLine(insertion.line);
  } else {
    e.dataTransfer.dropEffect = 'move';
    _clearDragDropLine();
    _clearPreviewDropLine();
    activeCmWrap?.classList.remove('block-drop-target');
    r.previewFrameWrap?.classList.remove('block-drop-target');
  }
}

function _onDocBlockDrop(e) {
  if (!_activeDragBlockId) return;
  const block = findBlockById(_activeDragBlockId);
  if (!block) return;

  if (_isOverCmWrap(e.clientX, e.clientY)) {
    e.preventDefault();
    e.stopPropagation(); // Prevent CM from handling this drop as text insert
    _clearDragDropLine();
    getActiveCmWrap()?.classList.remove('block-drop-target');
    const activeCm = getActiveCm();
    if (activeCm) {
      try {
        const pos = activeCm.coordsChar({ left: e.clientX, top: e.clientY }, 'window');
        activeCm.setCursor(pos);
      } catch {}
    }
    insertEmailBlock(block);
  } else if (_isOverPreviewPane(e.clientX, e.clientY)) {
    // Drop on preview → insert near the corresponding email row in source.
    e.preventDefault();
    const insertion = _getPreviewInsertion(e.clientX, e.clientY);
    _clearDragDropLine();
    _clearPreviewDropLine();
    r.previewFrameWrap?.classList.remove('block-drop-target');
    insertEmailBlock(block, insertion || {});
  }
}

function _previewEventToWindowPoint(e) {
  const rect = r.previewFrame?.getBoundingClientRect();
  if (!rect) return { clientX: e.clientX, clientY: e.clientY };
  return { clientX: rect.left + e.clientX, clientY: rect.top + e.clientY };
}

function wirePreviewFrameDragDrop() {
  const doc = r.previewFrame?.contentDocument || r.previewFrame?.contentWindow?.document;
  if (!doc) return;
  _previewFrameDropAbort?.abort();
  _previewFrameDropAbort = new AbortController();
  const opts = { capture: true, signal: _previewFrameDropAbort.signal };

  doc.addEventListener('dragover', e => {
    if (!_activeDragBlockId) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    const pt = _previewEventToWindowPoint(e);
    r.previewFrameWrap?.classList.add('block-drop-target');
    const insertion = _getPreviewInsertion(pt.clientX, pt.clientY);
    _showPreviewDropLine(pt.clientY, insertion ? { targetRect: insertion.targetRect, edge: insertion.edge } : {});
    if (insertion) _setDragDropLine(insertion.line);
  }, opts);

  doc.addEventListener('dragleave', e => {
    if (!_activeDragBlockId) return;
    if (e.relatedTarget) return;
    _clearPreviewDropLine();
    r.previewFrameWrap?.classList.remove('block-drop-target');
  }, opts);

  doc.addEventListener('drop', e => {
    if (!_activeDragBlockId) return;
    const block = findBlockById(_activeDragBlockId);
    if (!block) return;
    e.preventDefault();
    e.stopPropagation();
    const pt = _previewEventToWindowPoint(e);
    const insertion = _getPreviewInsertion(pt.clientX, pt.clientY);
    _clearDragDropLine();
    _clearPreviewDropLine();
    r.previewFrameWrap?.classList.remove('block-drop-target');
    insertEmailBlock(block, insertion || {});
  }, opts);
}

function _showBlockDropOverlay() {
  // Both in CAPTURE phase — fire before CM can call stopPropagation()
  document.addEventListener('dragover', _onDocBlockDragover, true);
  document.addEventListener('drop', _onDocBlockDrop, true);
}

function _hideBlockDropOverlay() {
  document.removeEventListener('dragover', _onDocBlockDragover, true);
  document.removeEventListener('drop', _onDocBlockDrop, true);
  _clearDragDropLine();
  _clearPreviewDropLine();
  r.cmWrap?.classList.remove('block-drop-target');
  r.previewFrameWrap?.classList.remove('block-drop-target');
}

function setupBlocksDragDrop() {
  // No-op: document-level listeners are added/removed per drag
}

async function openSourceContext(brand, mail) {
  state.activeFileId = null;
  r.fileTabs?.querySelectorAll('.file-tab').forEach(t => t.classList.remove('active'));
  r.fileTabs?.querySelector('[data-file-id="__empty__"]')?.remove();

  // Fetch file list
  const res  = await fetch(`/api/wb/email-files?brand=${encodeURIComponent(brand)}&mail=${encodeURIComponent(mail)}`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Cannot list files');

  // Identify key files — header.pug (content) and main.styl / common.styl (styles)
  const files = data.files;
  const headerPug  = files.find(f => f.path.includes('header.pug') || f.path.includes('header.jade'))
                  || files.find(f => (f.ext === 'pug' || f.ext === 'jade') && !f.path.includes('index'));
  const mainStyl   = files.find(f => f.path.includes('main.styl'))
                  || files.find(f => f.path.includes('common.styl'))
                  || files.find(f => f.ext === 'styl' || f.ext === 'css');

  // Pre-populate openedFiles with the two key files so they appear as tabs immediately
  const openedFiles = [];
  if (headerPug)  openedFiles.push(headerPug.path);
  if (mainStyl && mainStyl !== headerPug) openedFiles.push(mainStyl.path);

  state.srcCtx = { brand, mail, files, openedFiles, activeFile: null, modified: false, compiledHtml: null };
  renderSrcFileTabs();
  // Carousel shown on demand via toggle button — don't auto-show

  // Load compiled HTML and show it by default. If not built yet — run build first.
  async function loadCompiledOrBuild() {
    try {
      let r = await fetch(`/api/wb/email?brand=${encodeURIComponent(brand)}&mail=${encodeURIComponent(mail)}`);
      let d = await r.json();
      // If compiled HTML missing (e.g. clone hasn't been built yet) → trigger build.
      if (!d.ok || !d.html) {
        toast('Компилирую Pug+Stylus → HTML…', 'info', 1500);
        const b = await fetch('/api/wb/build-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ brand, mail }),
        });
        const bd = await b.json();
        if (!bd.ok) throw new Error(bd.error || 'build failed');
        r = await fetch(`/api/wb/email?brand=${encodeURIComponent(brand)}&mail=${encodeURIComponent(mail)}`);
        d = await r.json();
      }
      if (d.ok && state.srcCtx?.brand === brand) {
        state.srcCtx.compiledHtml = d.html;
        showCompiledHtml();
      } else if (headerPug && state.srcCtx?.brand === brand) {
        // Last resort fallback: open the Pug source.
        loadSourceFile(headerPug.path);
      }
    } catch (err) {
      console.warn('[compile-on-open] failed:', err && err.message);
      if (headerPug && state.srcCtx?.brand === brand) loadSourceFile(headerPug.path);
    }
  }
  loadCompiledOrBuild();
}

function renderSrcFileTabs() {
  if (!r.srcFileTabs) return;
  const ctx = state.srcCtx;
  if (!ctx) {
    r.srcFileTabs.classList.add('hidden');
    r.blocksCarouselToggleBtn?.classList.add('hidden');
    return;
  }

  r.srcFileTabs.classList.remove('hidden');
  r.blocksCarouselToggleBtn?.classList.remove('hidden');
  r.srcFileTabs.innerHTML = '';

  // Show all opened files as tabs (not just the active one)
  const openedPaths = ctx.openedFiles || [];
  openedPaths.forEach(filePath => {
    const f = ctx.files.find(ff => ff.path === filePath);
    if (!f) return;
    const isActive = ctx.activeFile === filePath && !ctx.viewingCompiledHtml;
    const tab = document.createElement('button');
    tab.className = 'src-tab' + (isActive ? ' active' : '') + (isActive && ctx.modified ? ' modified' : '');
    const fname = f.path.split('/').pop();
    const dotColor = f.ext === 'pug' || f.ext === 'jade' ? '#f97316' : f.ext === 'styl' ? '#22c55e' : '#3b82f6';
    tab.innerHTML = `<span class="src-tab-dot" style="background:${dotColor}"></span>${escapeHtml(fname)}`;
    tab.title = f.path;
    tab.addEventListener('click', () => loadSourceFile(f.path));
    r.srcFileTabs.appendChild(tab);
  });

  // Show compiled HTML badge if built (highlighted when currently viewing it)
  if (ctx.compiledHtml) {
    const builtBadge = document.createElement('span');
    builtBadge.className = 'src-compiled-badge' + (ctx.viewingCompiledHtml ? ' active' : '');
    builtBadge.title = 'Показать скомпилированный HTML';
    builtBadge.innerHTML = `<svg width="9" height="9" viewBox="0 0 12 12" fill="none"><path d="M1 1l4 5-4 5h2l4-5-4-5z" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M7 1l4 5-4 5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg> HTML`;
    builtBadge.addEventListener('click', () => showCompiledHtml());
    r.srcFileTabs.appendChild(builtBadge);
  }

  // Blocks button removed from left panel — carousel is in right panel (FAB toggle)

  // Spacer pushes rebuild + close to right
  const spacer = document.createElement('div');
  spacer.style.cssText = 'flex:1;min-width:8px';
  r.srcFileTabs.appendChild(spacer);

  // Rebuild button
  const rebuildBtn = document.createElement('button');
  rebuildBtn.className = 'src-rebuild-btn';
  rebuildBtn.id = 'srcRebuildBtn';
  rebuildBtn.title = 'Собрать письмо вручную (обычно происходит автоматически)';
  rebuildBtn.innerHTML = `<svg width="11" height="11" viewBox="0 0 14 14" fill="none"><path d="M2 7a5 5 0 1 0 5-5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M7 1v3l2-1.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  rebuildBtn.addEventListener('click', () => rebuildSourceEmail());
  r.srcFileTabs.appendChild(rebuildBtn);

  // Close context button
  const closeBtn = document.createElement('button');
  closeBtn.className = 'src-close-btn';
  closeBtn.title = 'Закрыть письмо';
  closeBtn.innerHTML = `<svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M1 1l8 8M9 1L1 9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;
  closeBtn.addEventListener('click', () => {
    state.srcCtx = null;
    splitState.active = false;
    localStorage.setItem(LS_CODE_SPLIT_ACTIVE, '0');
    r.etypeSplitBtn?.classList.remove('split-active');
    r.cmWrapSplit?.classList.add('hidden');
    r.cmSplitDivider?.classList.add('hidden');
    r.editorBody?.classList.remove('split-mode');
    r.saveSourceBtn?.classList.add('hidden');
    r.compiledViewBanner?.classList.add('hidden');
    r.blocksShelf?.classList.add('hidden');
    _blocksShelfOpen = false;
    hideBlocksCarousel();
    r.blocksCarouselToggleBtn?.classList.remove('active', 'hidden');
    r.blocksCarouselToggleBtn?.classList.add('hidden');
    cm?.setOption('readOnly', false);
    // Clear editor content
    if (cm) { _suppressSrcModified = true; cm.setValue(''); setTimeout(() => { _suppressSrcModified = false; }, 0); }
    // Reset any drag-resize inline flex styles
    if (r.cmWrap)      r.cmWrap.style.flex = '';
    if (r.cmWrapSplit) r.cmWrapSplit.style.flex = '';
    renderSrcFileTabs();
    renderEtypeFilesDropdown();
    // Reset editor type to HTML
    switchEditorType('html');
    // Clear topbar src tab
    updateTopbarSrcTab(null);
    if (state.files.length) activateFile(state.activeFileId || state.files[state.files.length - 1].id);
    else saveToLocalStorage();
  });
  r.srcFileTabs.appendChild(closeBtn);

  // Update file-tree dropdown in HTML tab
  renderEtypeFilesDropdown();
  // Update topbar to show email name
  updateTopbarSrcTab(ctx);
}

function updateTopbarSrcTab(ctx) {
  const ft = r.fileTabs;
  if (!ft) return;
  // Remove any existing src tab in topbar
  ft.querySelector('.file-tab[data-src-ctx]')?.remove();
  if (!ctx) return;

  const mailName = ctx.mail.replace(/^mail-/, '');
  const tab = document.createElement('div');
  tab.className = 'file-tab active src-ctx-tab';
  tab.dataset.srcCtx = '1';
  tab.title = `${ctx.brand} / ${ctx.mail} — двойной клик для переименования`;
  tab.innerHTML = `<span class="file-tab-badge">${escapeHtml(ctx.brand)}</span><span class="file-tab-name src-ctx-name" id="srcCtxTabName">${escapeHtml(mailName)}</span><button class="file-tab-close src-ctx-close" title="Закрыть письмо" tabindex="-1"><svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 2l6 6M8 2L2 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></button>`;

  // Click on tab (not close btn) → activate srcCtx view
  tab.addEventListener('click', e => {
    if (e.target.closest('.src-ctx-close')) return; // handled below
    // Re-activate srcCtx: mark this tab active, deactivate others
    state.activeFileId = null;
    ft.querySelectorAll('.file-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    // If currently viewing compiled html, stay; otherwise load last file
    if (!ctx.viewingCompiledHtml && ctx.activeFile) {
      loadSourceFile(ctx.activeFile);
    } else if (ctx.compiledHtml) {
      showCompiledHtml();
    }
  });

  // Close button → close srcCtx (same as close btn in srcFileTabs)
  tab.querySelector('.src-ctx-close')?.addEventListener('click', e => {
    e.stopPropagation();
    // Trigger the srcFileTabs close button if it exists
    r.srcFileTabs?.querySelector('.src-close-btn')?.click();
  });

  // Mark other tabs inactive
  ft.querySelectorAll('.file-tab').forEach(t => t.classList.remove('active'));
  tab.classList.add('active');
  ft.appendChild(tab);

  // Double-click to rename inline
  const nameSpan = tab.querySelector('.src-ctx-name');
  nameSpan?.addEventListener('dblclick', (e) => {
    e.stopPropagation();
    const inp = document.createElement('input');
    inp.className = 'src-ctx-rename-input';
    inp.value = mailName;
    inp.spellcheck = false;
    nameSpan.replaceWith(inp);
    inp.select();
    const finish = async (save) => {
      const newName = cleanMailFolderName(inp.value);
      inp.replaceWith(nameSpan);
      if (!save || !newName || newName === ctx.mail) return;
      nameSpan.textContent = newName.replace(/^mail-/, '');
      // Call rename API
      try {
        const res = await fetch('/api/wb/email-rename', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ brand: ctx.brand, mail: ctx.mail, newName })
        });
        const data = await res.json();
        if (data.ok) {
          ctx.mail = newName;
          toast(`Переименовано: ${newName}`, 'success');
        } else {
          toast(data.error || 'Ошибка переименования', 'error');
          nameSpan.textContent = mailName;
        }
      } catch(e) { toast('Ошибка сети', 'error'); nameSpan.textContent = mailName; }
    };
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') finish(true);
      if (e.key === 'Escape') finish(false);
    });
    inp.addEventListener('blur', () => finish(true));
  });
}

// ─── File-tree dropdown on the HTML tab ─────────────────────────────────────
function renderEtypeFilesDropdown() {
  const btn = r.etypeFilesBtn;
  const dd  = r.etypeFilesDropdown;
  const ctx = state.srcCtx;
  if (!btn || !dd) return;

  dd.innerHTML = '';

  if (!ctx) {
    // No source context: tools for plain HTML
    const h = document.createElement('div');
    h.className = 'eft-header';
    h.textContent = 'Инструменты';
    dd.appendChild(h);

    const saveItem = document.createElement('button');
    saveItem.className = 'eft-item';
    saveItem.innerHTML = `<span class="eft-icon" style="color:#f59e0b">📥</span>Сохранить в базу`;
    saveItem.addEventListener('click', () => { dd.classList.add('hidden'); openSaveToBaseModal(); });
    dd.appendChild(saveItem);

    const pugItem = document.createElement('button');
    pugItem.className = 'eft-item';
    pugItem.innerHTML = `<span class="eft-icon" style="color:#f97316">◈</span>Конвертировать в Pug`;
    pugItem.addEventListener('click', () => { dd.classList.add('hidden'); decompileHtmlToPug(); });
    dd.appendChild(pugItem);
    return;
  }

  // Source context: show context header + compiled HTML switch + file tree + rebuild
  const head = document.createElement('div');
  head.className = 'eft-header';
  head.innerHTML = `<strong>${escapeHtml(ctx.brand)}</strong> / ${escapeHtml(ctx.mail.replace(/^mail-/, ''))}`;
  dd.appendChild(head);

  // Switch to compiled HTML view
  const htmlItem = document.createElement('button');
  htmlItem.className = 'eft-item';
  htmlItem.innerHTML = `<span class="eft-icon" style="color:var(--accent)">‹›</span>Скомпилированный HTML`;
  htmlItem.addEventListener('click', () => { dd.classList.add('hidden'); showCompiledHtml(); });
  dd.appendChild(htmlItem);

  const sep = document.createElement('div');
  sep.style.cssText = 'height:1px;background:var(--border);margin:4px 0';
  dd.appendChild(sep);

  // Group by folder
  const folders = {};
  ctx.files.forEach(f => {
    const parts = f.path.split('/');
    const folder = parts.length > 1 ? parts[0] : '';
    if (!folders[folder]) folders[folder] = [];
    folders[folder].push(f);
  });

  Object.entries(folders).sort(([a], [b]) => a.localeCompare(b)).forEach(([folder, files]) => {
    if (folder) {
      const folderEl = document.createElement('div');
      folderEl.className = 'eft-folder';
      folderEl.innerHTML = `<svg width="10" height="10" viewBox="0 0 14 14" fill="none" style="flex-shrink:0;opacity:.6"><path d="M1 3h4l2 2h6v7H1z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>${escapeHtml(folder)}`;
      dd.appendChild(folderEl);
    }
    files.sort((a, b) => {
      // Sort order: 1) header.pug/jade, 2) main.styl/common.styl, 3) rest alphabetically
      const rank = f => {
        const p = f.path.toLowerCase();
        if (p.includes('header.pug') || p.includes('header.jade')) return 0;
        if (p.includes('main.styl') || p.includes('common.styl')) return 1;
        if (f.ext === 'pug' || f.ext === 'jade') return 2;
        if (f.ext === 'styl' || f.ext === 'css') return 3;
        return 4;
      };
      const ra = rank(a), rb = rank(b);
      if (ra !== rb) return ra - rb;
      return a.path.localeCompare(b.path);
    }).forEach(f => {
      const item = document.createElement('button');
      item.className = 'eft-item' + (ctx.activeFile === f.path ? ' active' : '');
      const fname = f.path.split('/').pop();
      item.innerHTML = `<span class="eft-icon">${EXT_ICON[f.ext] || '📄'}</span>${escapeHtml(fname)}`;
      item.title = f.path;
      item.addEventListener('click', () => { dd.classList.add('hidden'); loadSourceFile(f.path); });
      item.addEventListener('contextmenu', e => {
        e.preventDefault();
        e.stopPropagation();
        dd.classList.add('hidden');
        showSrcFileContextMenu(e, ctx, f);
      });
      dd.appendChild(item);
    });
  });

  const rbtn = document.createElement('button');
  rbtn.className = 'eft-rebuild-btn';
  rbtn.innerHTML = `<svg width="10" height="10" viewBox="0 0 14 14" fill="none"><path d="M2 7a5 5 0 1 0 5-5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M7 1v3l2-1.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg> Собрать письмо`;
  rbtn.addEventListener('click', () => { dd.classList.add('hidden'); rebuildSourceEmail(); });
  dd.appendChild(rbtn);
}

// Toggle dropdown on chevron click — always rebuild before showing
r.etypeFilesBtn?.addEventListener('click', (e) => {
  e.stopPropagation();
  const dd = r.etypeFilesDropdown;
  if (!dd) return;
  if (dd.classList.contains('hidden')) {
    renderEtypeFilesDropdown();
    dd.classList.remove('hidden');
  } else {
    dd.classList.add('hidden');
  }
});
// Close on outside click
document.addEventListener('click', () => {
  r.etypeFilesDropdown?.classList.add('hidden');
  $('srcFileContextMenu')?.classList.add('hidden');
});

// ─── Source file right-click context menu ────────────────────────────────────
let _srcCtxFile = null;

function showSrcFileContextMenu(e, ctx, f) {
  const menu = $('srcFileContextMenu');
  if (!menu) return;
  _srcCtxFile = { ctx, f };
  menu.style.left = e.clientX + 'px';
  menu.style.top  = e.clientY + 'px';
  menu.classList.remove('hidden');
}

$('srcCtxLoadLeft')?.addEventListener('click', () => {
  const { f } = _srcCtxFile || {};
  if (!f) return;
  $('srcFileContextMenu')?.classList.add('hidden');
  loadSourceFile(f.path);
});

$('srcCtxOpenSplit')?.addEventListener('click', () => {
  const { ctx, f } = _srcCtxFile || {};
  if (!ctx || !f) return;
  $('srcFileContextMenu')?.classList.add('hidden');
  // Make sure split is active
  if (!splitState.active) {
    splitState.active = true;
    localStorage.setItem(LS_CODE_SPLIT_ACTIVE, '1');
    r.etypeSplitBtn?.classList.add('split-active');
    r.cmWrapSplit?.classList.remove('hidden');
    r.cmSplitDivider?.classList.remove('hidden');
    r.editorBody?.classList.add('split-mode');
    initCmSplit();
    setTimeout(() => { restoreCodeSplitRatio(); cm?.refresh(); cmSplit?.refresh(); }, 50);
  }
  // Load chosen file in right pane
  if (cmSplit) {
    fetch(`/api/wb/email-file?brand=${encodeURIComponent(ctx.brand)}&mail=${encodeURIComponent(ctx.mail)}&file=${encodeURIComponent(f.path)}`)
      .then(resp => resp.json()).then(data => {
        if (!data.ok) return;
        cmSplit.setValue(data.content);
        const ext2 = f.path.split('.').pop();
        cmSplit.setOption('mode', EXT_MODE[ext2] || 'css');
        splitState.rightFile = { kind: 'source', path: f.path };
        if (r.cmSplitLabel) r.cmSplitLabel.textContent = f.path.split('/').pop();
        cmSplit.refresh();
        renderSplitPaneControls();
        toast(`⊞ ${f.path.split('/').pop()} → правая панель`, 'info', 1500);
      });
  }
});

// ─── Split view ──────────────────────────────────────────────────────────────
function saveCodeSplitRatio() {
  if (!splitState.active || !r.editorBody || !r.cmWrap || !r.cmWrapSplit) return;
  const total = r.editorBody.getBoundingClientRect().width - (r.cmSplitDivider?.offsetWidth || 0);
  const left = r.cmWrap.getBoundingClientRect().width;
  if (total > 0 && left > 0) localStorage.setItem(LS_CODE_SPLIT, String(left / total));
}

function restoreCodeSplitRatio() {
  if (!splitState.active || !r.editorBody || !r.cmWrap || !r.cmWrapSplit) return;
  const saved = Number(localStorage.getItem(LS_CODE_SPLIT));
  const total = r.editorBody.getBoundingClientRect().width - (r.cmSplitDivider?.offsetWidth || 0);
  if (!Number.isFinite(saved) || saved <= 0.12 || saved >= 0.88 || total <= 0) return;
  const left = Math.max(120, Math.min(total - 120, total * saved));
  r.cmWrap.style.flex = `0 0 ${left}px`;
  r.cmWrapSplit.style.flex = `0 0 ${total - left}px`;
}

r.etypeSplitBtn?.addEventListener('click', toggleSplitView);

function initCmSplit() {
  if (cmSplit) return;
  const ta = document.getElementById('codeEditorSplit');
  if (!ta) return;
  cmSplit = CodeMirror.fromTextArea(ta, {
    lineNumbers: true,
    theme: cm?.getOption('theme') || 'material-darker',
    mode: { name: 'htmlmixed' },
    lineWrapping: state.wrapMode,
    tabSize: 2,
    indentWithTabs: false,
    gutters: ['CodeMirror-linenumbers', 'cm-left-pad'],
    extraKeys: {
      'Tab': ed => ed.replaceSelection('  '),
      'Cmd-F': ed => openFindBar(ed),
      'Ctrl-F': ed => openFindBar(ed),
      'Cmd-H': ed => openFindBar(ed, { focusReplace: true }),
      'Ctrl-H': ed => openFindBar(ed, { focusReplace: true }),
    },
  });
  cmSplit.on('change', debounce(() => {
    if (_suppressSplitChange) return;
    const target = splitState.rightFile;
    if (!target) return;
    if (target.kind === 'plain') {
      const file = state.files.find(f => f.id === target.id);
      if (file) {
        file.html = cmSplit.getValue();
        saveToLocalStorage();
      }
    } else if (target.kind === 'source' && state.srcCtx) {
      fetch('/api/wb/email-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brand: state.srcCtx.brand, mail: state.srcCtx.mail, file: target.path, content: cmSplit.getValue() }),
      }).catch(() => {});
    }
  }, 700));
}

function hideSplitPaneMenus() {
  r.splitLeftFileMenu?.classList.add('hidden');
  r.splitRightFileMenu?.classList.add('hidden');
}

function getSplitFileOptions() {
  const ctx = state.srcCtx;
  if (ctx) {
    return (ctx.files || []).map(f => ({
      kind: 'source',
      path: f.path,
      label: f.path.split('/').pop(),
      ext: f.ext || f.path.split('.').pop(),
    }));
  }
  return (state.files || []).map(f => ({
    kind: 'plain',
    id: f.id,
    label: f.name || 'email.html',
    ext: 'html',
  }));
}

function splitOptionKey(opt) {
  return opt.kind === 'source' ? `source:${opt.path}` : `plain:${opt.id}`;
}

function currentSplitLeftKey() {
  if (state.srcCtx) return state.srcCtx.activeFile ? `source:${state.srcCtx.activeFile}` : '';
  return state.activeFileId ? `plain:${state.activeFileId}` : '';
}

function currentSplitRightKey() {
  const rf = splitState.rightFile;
  if (!rf) return '';
  return rf.kind === 'source' ? `source:${rf.path}` : `plain:${rf.id}`;
}

function renderSplitPaneControls() {
  const show = !!splitState.active;
  r.splitLeftToolbar?.classList.toggle('hidden', !show);
  r.splitRightToolbar?.classList.toggle('hidden', !show);
  if (!show) {
    hideSplitPaneMenus();
    return;
  }

  if (r.splitLeftFileLabel) {
    r.splitLeftFileLabel.textContent = state.srcCtx?.activeFile?.split('/').pop()
      || state.files.find(f => f.id === state.activeFileId)?.name
      || 'Текущий файл';
  }
  if (r.cmSplitLabel && !splitState.rightFile) r.cmSplitLabel.textContent = 'Выбрать файл';

  const options = getSplitFileOptions();
  const buildMenu = (menu, pane) => {
    if (!menu) return;
    const activeKey = pane === 'left' ? currentSplitLeftKey() : currentSplitRightKey();
    menu.innerHTML = '';
    options.forEach(opt => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'split-pane-menu-item' + (splitOptionKey(opt) === activeKey ? ' active' : '');
      btn.title = opt.path || opt.label;
      btn.innerHTML = `<span class="fs-tab-dot" style="background:${fsFileDotColor(opt.ext)}"></span><span>${escapeHtml(opt.label)}</span>`;
      btn.addEventListener('click', () => {
        hideSplitPaneMenus();
        loadSplitFileIntoPane(pane, opt);
      });
      menu.appendChild(btn);
    });
  };
  buildMenu(r.splitLeftFileMenu, 'left');
  buildMenu(r.splitRightFileMenu, 'right');
}

async function loadSplitFileIntoPane(pane, opt) {
  if (!opt) return;
  if (pane === 'left') {
    if (opt.kind === 'source') await loadSourceFile(opt.path);
    else activateFile(opt.id);
    renderSplitPaneControls();
    return;
  }

  initCmSplit();
  if (!splitState.active) toggleSplitView();
  try {
    let content = '';
    let mode = 'htmlmixed';
    if (opt.kind === 'source' && state.srcCtx) {
      const res = await fetch(`/api/wb/email-file?brand=${encodeURIComponent(state.srcCtx.brand)}&mail=${encodeURIComponent(state.srcCtx.mail)}&file=${encodeURIComponent(opt.path)}`);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Не удалось открыть файл');
      content = data.content || '';
      mode = EXT_MODE[opt.ext] || 'htmlmixed';
      splitState.rightFile = { kind: 'source', path: opt.path };
    } else {
      const file = state.files.find(f => f.id === opt.id);
      if (!file) return;
      content = file.html || '';
      splitState.rightFile = { kind: 'plain', id: opt.id };
    }
    _suppressSplitChange = true;
    cmSplit?.setOption('mode', mode);
    cmSplit?.setValue(content);
    if (r.cmSplitLabel) r.cmSplitLabel.textContent = opt.label;
    setTimeout(() => { _suppressSplitChange = false; cmSplit?.refresh(); }, 0);
    renderSplitPaneControls();
  } catch (err) {
    toast(err.message || 'Не удалось открыть файл', 'error');
  }
}

r.splitLeftFileBtn?.addEventListener('click', e => {
  e.stopPropagation();
  const open = r.splitLeftFileMenu?.classList.contains('hidden');
  hideSplitPaneMenus();
  if (open) r.splitLeftFileMenu?.classList.remove('hidden');
});
r.splitRightFileBtn?.addEventListener('click', e => {
  e.stopPropagation();
  const open = r.splitRightFileMenu?.classList.contains('hidden');
  hideSplitPaneMenus();
  if (open) r.splitRightFileMenu?.classList.remove('hidden');
});
r.splitLeftCloseBtn?.addEventListener('click', () => { if (splitState.active) toggleSplitView(); });
r.splitRightCloseBtn?.addEventListener('click', () => { if (splitState.active) toggleSplitView(); });
document.addEventListener('click', e => {
  if (!e.target.closest?.('.split-pane-toolbar')) hideSplitPaneMenus();
});

function toggleSplitView() {
  splitState.active = !splitState.active;
  localStorage.setItem(LS_CODE_SPLIT_ACTIVE, splitState.active ? '1' : '0');
  r.etypeSplitBtn?.classList.toggle('split-active', splitState.active);
  r.cmWrapSplit?.classList.toggle('hidden', !splitState.active);
  r.cmSplitDivider?.classList.toggle('hidden', !splitState.active);
  r.editorBody?.classList.toggle('split-mode', splitState.active);
  if (!splitState.active) splitState.rightFile = null;
  // Reset any custom flex widths set by drag
  if (r.cmWrap)      r.cmWrap.style.flex = '';
  if (r.cmWrapSplit) r.cmWrapSplit.style.flex = '';

  if (splitState.active) {
    initCmSplit();
    const ctx = state.srcCtx;
    if (ctx) {
      // Email source context: Pug left, Stylus right
      const pugFile  = ctx.files.find(f => f.ext === 'pug' || f.ext === 'jade');
      const stylFile = ctx.files.find(f => f.ext === 'styl' && f.path.includes('common'));
      if (pugFile)  loadSourceFile(pugFile.path);
      if (stylFile && cmSplit) {
        fetch(`/api/wb/email-file?brand=${encodeURIComponent(ctx.brand)}&mail=${encodeURIComponent(ctx.mail)}&file=${encodeURIComponent(stylFile.path)}`)
          .then(resp => resp.json()).then(data => {
            if (data.ok) {
              cmSplit.setValue(data.content);
              cmSplit.setOption('mode', 'css');
              splitState.rightFile = { kind: 'source', path: stylFile.path };
              if (r.cmSplitLabel) r.cmSplitLabel.textContent = stylFile.path.split('/').pop();
              cmSplit.refresh();
              renderSplitPaneControls();
            }
          });
      }
      toast('Разделённый вид: Pug | Stylus', 'info', 2000);
    } else {
      // Plain HTML: mirror current content into right pane
      if (cmSplit && cm) {
        cmSplit.setValue(cm.getValue());
        cmSplit.setOption('mode', cm.getOption('mode'));
        splitState.rightFile = state.activeFileId ? { kind: 'plain', id: state.activeFileId } : null;
        if (r.cmSplitLabel) r.cmSplitLabel.textContent = 'Копия';
        cmSplit.refresh();
      }
      toast('Разделённый вид', 'info', 1200);
    }
    // Refresh both panes after layout
    renderSplitPaneControls();
    setTimeout(() => { restoreCodeSplitRatio(); cm?.refresh(); cmSplit?.refresh(); }, 50);
  } else {
    r.editorBody?.classList.remove('is-resizing');
    renderSplitPaneControls();
    toast('Одно окно', 'info', 1200);
  }
}

// ─── Split view divider drag-to-resize ───────────────────────────
if (r.cmSplitDivider) {
  r.cmSplitDivider.addEventListener('mousedown', e => {
    if (!splitState.active) return;
    e.preventDefault();
    r.cmSplitDivider.classList.add('dragging');
    r.editorBody?.classList.add('is-resizing');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const body   = r.editorBody;
    const leftWrap  = r.cmWrap;
    const rightWrap = r.cmWrapSplit;

    // Record starting flex-basis in px
    const bodyRect = body.getBoundingClientRect();
    const startX   = e.clientX;
    const startLeftW = leftWrap.getBoundingClientRect().width;

    function onMove(ev) {
      const delta   = ev.clientX - startX;
      const totalW  = bodyRect.width - r.cmSplitDivider.offsetWidth;
      const newLeftW = Math.max(80, Math.min(totalW - 80, startLeftW + delta));
      const newRightW = totalW - newLeftW;
      leftWrap.style.flex  = `0 0 ${newLeftW}px`;
      rightWrap.style.flex = `0 0 ${newRightW}px`;
    }
    function onUp() {
      r.cmSplitDivider.classList.remove('dragging');
      r.editorBody?.classList.remove('is-resizing');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      saveCodeSplitRatio();
      cm?.refresh();
      cmSplit?.refresh();
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

async function loadSourceFile(filePath) {
  const ctx = state.srcCtx;
  if (!ctx) return;

  // Auto-save current file if modified (no blocking confirm)
  if (ctx.modified && ctx.activeFile) {
    saveCurrentSourceFile().catch(() => {});
  }

  try {
    const res  = await fetch(`/api/wb/email-file?brand=${encodeURIComponent(ctx.brand)}&mail=${encodeURIComponent(ctx.mail)}&file=${encodeURIComponent(filePath)}`);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);

    ctx.activeFile = filePath;
    ctx.modified   = false;
    ctx.viewingCompiledHtml = false;  // back to source mode
    state.activeFileId = null;

    const ext = filePath.split('.').pop();
    const mode = EXT_MODE[ext] || 'htmlmixed';

    // Load into editor — suppress change listener while setting value
    if (cm) {
      _suppressSrcModified = true;
      cm.setOption('readOnly', false);
      // Set mode FIRST, then value — guarantees the right tokenizer runs from line 0.
      cm.setOption('mode', mode);
      cm.setValue(data.content);
      try { cm.refresh(); } catch {}
      setTimeout(() => { _suppressSrcModified = false; try { cm.refresh(); } catch {} }, 0);
      state.editorType = ext === 'styl' ? 'stylus' : (ext === 'pug' || ext === 'jade' ? 'pug' : 'html');
      document.querySelectorAll('.etype-tab').forEach(t =>
        t.classList.toggle('active', t.dataset.etype === state.editorType)
      );
    }

    // Show save button, hide convert/saveToBase/minify
    r.saveSourceBtn?.classList.remove('hidden');
    r.convertBtn?.classList.add('hidden');
    r.saveToBaseBtn?.classList.add('hidden');
    r.minifyBtn?.classList.add('hidden');
    // Hide compiled view banner
    r.compiledViewBanner?.classList.add('hidden');

    // Track opened files for tab display
    if (!ctx.openedFiles) ctx.openedFiles = [];
    if (!ctx.openedFiles.includes(filePath)) ctx.openedFiles.push(filePath);

    // Update fullscreen mode chip
    const modeChipNames = { pug: 'Pug', jade: 'Pug', styl: 'Stylus', css: 'CSS', html: 'HTML' };
    if (r.fsModeChip) r.fsModeChip.textContent = modeChipNames[ext] || ext.toUpperCase();

    renderSrcFileTabs();
    renderSplitPaneControls();
    applyEditorPaddingNow();
    toast(`📂 ${filePath.split('/').pop()}`, 'info', 1500);
    if (window.WB?.fireFileChange) window.WB.fireFileChange();
  } catch(e) {
    toast('Ошибка загрузки: ' + e.message, 'error');
  }
}

function applyEditorPaddingNow() {
  // padding is handled natively by cm-left-pad gutter — no-op
}

// Wire Ctrl+S to save source file
document.addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.key === 's') {
    e.preventDefault();
    if (state.srcCtx?.activeFile && !state.activeFileId) saveCurrentSourceFile();
  }
});

r.saveSourceBtn?.addEventListener('click', saveCurrentSourceFile);

async function saveCurrentSourceFile(contentOverride = null) {
  const ctx = state.srcCtx;
  if (!ctx?.activeFile || !cm) return;

  r.saveSourceBtn.disabled = true;
  r.saveSourceBtn.textContent = 'Сохраняю…';

  try {
    const res = await fetch('/api/wb/email-file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brand: ctx.brand, mail: ctx.mail, file: ctx.activeFile, content: contentOverride ?? cm.getValue() }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);

    ctx.modified = false;
    renderSrcFileTabs();
    toast('✓ Сохранено — собираю…', 'success', 1500);
    // Auto-rebuild after save
    rebuildSourceEmail();
  } catch(e) {
    toast('Ошибка сохранения: ' + e.message, 'error');
  } finally {
    r.saveSourceBtn.disabled = false;
    r.saveSourceBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M2 1h8l3 3v9H2V1z" stroke="currentColor" stroke-width="1.4"/><rect x="4" y="8" width="6" height="5" rx=".5" stroke="currentColor" stroke-width="1.3"/><path d="M5 1v3h4" stroke="currentColor" stroke-width="1.3"/></svg> Сохранить`;
  }
}

let _isBuilding = false;

async function rebuildSourceEmail() {
  const ctx = state.srcCtx;
  if (!ctx) return;
  if (_isBuilding) return; // prevent concurrent builds
  _isBuilding = true;

  const btn = $('srcRebuildBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Собираю…'; }

  try {
    const res  = await fetch('/api/wb/build-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brand: ctx.brand, mail: ctx.mail }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);

    // Fetch compiled HTML and store in ctx — don't change the left editor
    const mailRes  = await fetch(`/api/wb/email?brand=${encodeURIComponent(ctx.brand)}&mail=${encodeURIComponent(ctx.mail)}`);
    const mailData = await mailRes.json();
    if (mailData.ok) {
      ctx.compiledHtml = mailData.html;
      // Update right preview with compiled result
      updatePreview();
      const lines = mailData.html.split('\n').length;
      toast(`✓ Собрано за ${data.duration}мс · ${lines} строк`, 'success');
      // Update rebuild indicator in tab bar
      renderSrcFileTabs();
    } else {
      toast(`✓ Собрано за ${data.duration}мс`, 'success');
    }
  } catch(e) {
    toast('Ошибка сборки: ' + e.message, 'error');
  } finally {
    _isBuilding = false;
    if (btn) { btn.disabled = false; btn.innerHTML = `<svg width="11" height="11" viewBox="0 0 14 14" fill="none"><path d="M2 7a5 5 0 1 0 5-5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M7 1v3l2-1.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg> Собрать`; }
    // Remove pending state from compiled badge
    r.srcFileTabs?.querySelector('.src-compiled-badge')?.classList.remove('pending');
  }
}

// ─── Save to base modal ──────────────────────────────────────────────────────
r.saveToBaseBtn?.addEventListener('click', openSaveToBaseModal);

async function openSaveToBaseModal() {
  const modal    = $('saveToBaseModal');
  const backdrop = $('saveToBaseBackdrop');
  if (!modal) return;

  // Populate brand dropdown from API
  const brandSel = $('saveToBaseBrand');
  if (brandSel) {
    try {
      const res  = await fetch('/api/wb/emails');
      const data = await res.json();
      brandSel.innerHTML = '';
      (data.emails || []).forEach(b => {
        const opt = document.createElement('option');
        opt.value = b.brand; opt.textContent = b.brand;
        brandSel.appendChild(opt);
      });
    } catch(e) { /* ignore */ }
  }

  modal.classList.remove('hidden');
  backdrop.classList.remove('hidden');
  $('saveToBaseName')?.focus();
}

function closeSaveToBaseModal() {
  $('saveToBaseModal')?.classList.add('hidden');
  $('saveToBaseBackdrop')?.classList.add('hidden');
  const newBrandRow = $('saveToBaseNewBrandRow');
  if (newBrandRow) newBrandRow.classList.add('hidden');
}

$('closeSaveToBaseBtn')?.addEventListener('click', closeSaveToBaseModal);
$('cancelSaveToBaseBtn')?.addEventListener('click', closeSaveToBaseModal);
$('saveToBaseBackdrop')?.addEventListener('click', closeSaveToBaseModal);

// Update folder preview as user types
$('saveToBaseName')?.addEventListener('input', e => {
  const preview = $('saveToBasePreview');
  if (preview) preview.textContent = `mail-${e.target.value || '…'}`;
});

// Toggle new brand row
$('saveToBaseNewBrandBtn')?.addEventListener('click', () => {
  const row = $('saveToBaseNewBrandRow');
  row?.classList.toggle('hidden');
  if (!row?.classList.contains('hidden')) $('saveToBaseNewBrandInput')?.focus();
});

$('confirmSaveToBaseBtn')?.addEventListener('click', async () => {
  const nameEl    = $('saveToBaseName');
  const brandSel  = $('saveToBaseBrand');
  const newBrandI = $('saveToBaseNewBrandInput');
  const newBrandRow = $('saveToBaseNewBrandRow');

  const name = (nameEl?.value || '').trim();
  if (!name) { toast('Введите название письма', 'warning'); nameEl?.focus(); return; }

  const isNewBrand = !newBrandRow?.classList.contains('hidden');
  let brand = isNewBrand ? (newBrandI?.value || '').trim() : brandSel?.value;
  if (!brand) { toast('Выберите или введите тему (бренд)', 'warning'); return; }

  const html = cm?.getValue() || '';

  const confirmBtn = $('confirmSaveToBaseBtn');
  if (confirmBtn) { confirmBtn.disabled = true; confirmBtn.textContent = 'Сохраняю...'; }

  try {
    // Create brand if new
    if (isNewBrand) {
      const bRes  = await fetch('/api/wb/create-brand', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: brand }),
      });
      const bData = await bRes.json();
      if (!bRes.ok && !bData.ok && bRes.status !== 409) throw new Error(bData.error);
    }

    // Read the "save as raw HTML" toggle (added in P1.2 UI fix)
    const rawHtmlChk = document.getElementById('saveToBaseRawHtml');
    const format = (rawHtmlChk && rawHtmlChk.checked) ? 'html' : 'pug';
    const res  = await fetch('/api/wb/email-import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brand, name, html, createBrand: isNewBrand, format }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);

    closeSaveToBaseModal();
    toast(`✓ Письмо «${name}» сохранено в ${brand}`, 'success');
    // Refresh email base if open
    if ($('ebTree')?.closest('.panel')?.classList.contains('active')) renderEmailBase();
  } catch(e) {
    toast('Ошибка: ' + e.message, 'error');
  } finally {
    if (confirmBtn) { confirmBtn.disabled = false; confirmBtn.textContent = 'Сохранить'; }
  }
});

// Track source file modifications + auto-compile
let _srcChangeListener   = null;
let _srcAutoCompileTimer = null;
let _suppressSrcModified = false; // set true when setValue() called programmatically
let _backupOffered = false; // true once backup modal was shown for current srcCtx

function markSourceModified(ctx = state.srcCtx) {
  if (!ctx?.activeFile || ctx.viewingCompiledHtml) return;
  ctx.modified = true;

  // Reflect modified dot in active tab
  const active = r.srcFileTabs?.querySelector('.src-tab.active');
  if (active && !active.classList.contains('modified')) {
    active.classList.add('modified');
  }

  // Show "pending auto-compile" indicator on the badge
  const badge = r.srcFileTabs?.querySelector('.src-compiled-badge');
  if (badge) badge.classList.add('pending');

  // Debounce: 2 seconds after last keystroke → save + rebuild
  clearTimeout(_srcAutoCompileTimer);
  _srcAutoCompileTimer = setTimeout(async () => {
    if (!state.srcCtx?.activeFile || state.srcCtx.viewingCompiledHtml) return;
    const ext = state.srcCtx.activeFile.split('.').pop().toLowerCase();
    if (['pug', 'jade', 'styl', 'css'].includes(ext)) {
      try {
        await saveCurrentSourceFile();
        await rebuildSourceEmail();
      } catch { /* silent */ }
    }
  }, 2000);
}

function hookSourceModified() {
  if (!cm) return;

  // Remove previous listener to avoid stacking on multiple email opens
  if (_srcChangeListener) {
    cm.off('change', _srcChangeListener);
    _srcChangeListener = null;
  }
  if (!state.srcCtx) return;
  _backupOffered = false; // reset for new email

  _srcChangeListener = () => {
    // Skip if we set the value ourselves (showCompiledHtml / loadSourceFile)
    if (_suppressSrcModified) return;

    const ctx = state.srcCtx;
    if (state.activeFileId) return;
    if (!ctx?.activeFile) return;

    // Only track modification for actual source files (not compiled HTML view)
    if (ctx.viewingCompiledHtml) return;

    // Offer backup on first real edit
    if (!_backupOffered && !ctx.modified) {
      _backupOffered = true;
      _showBackupModal(ctx.brand, ctx.mail);
      return; // delay edit — modal will let user proceed or switch to copy
    }

    markSourceModified(ctx);
  };

  cm.on('change', _srcChangeListener);
}

// ─── Backup modal ────────────────────────────────────────────────
function _showBackupModal(brand, mail) {
  if (!r.backupModal) return;
  if (r.backupMailName) r.backupMailName.textContent = `${brand} / ${mail}`;
  if (r.backupCopyName) {
    r.backupCopyName.value = suggestMailVersionName(mail, brand);
    setTimeout(() => {
      r.backupCopyName?.focus();
      r.backupCopyName?.select();
    }, 0);
  }
  r.backupModalBackdrop?.classList.remove('hidden');
  r.backupModal.classList.remove('hidden');
}

function _hideBackupModal() {
  r.backupModalBackdrop?.classList.add('hidden');
  r.backupModal?.classList.add('hidden');
}

function _isBackupModalOpen() {
  return !!r.backupModal && !r.backupModal.classList.contains('hidden');
}

// Dismiss on backdrop click → treat as "edit original"
r.backupModalBackdrop?.addEventListener('click', () => {
  _hideBackupModal();
  markSourceModified();
});

r.backupEditOriginalBtn?.addEventListener('click', () => {
  _hideBackupModal();
  // User chose to edit original — keep the already typed change and compile it.
  markSourceModified();
  toast('Редактируете оригинал', 'info');
});

r.backupCreateCopyBtn?.addEventListener('click', async () => {
  const ctx = state.srcCtx;
  if (!ctx) { _hideBackupModal(); return; }
  const copyName = cleanMailFolderName(r.backupCopyName?.value || '') || suggestMailVersionName(ctx.mail, ctx.brand);
  if (copyName === ctx.mail) {
    toast('Имя новой версии должно отличаться от оригинала', 'warning');
    r.backupCopyName?.focus();
    return;
  }
  r.backupCreateCopyBtn.disabled = true;
  r.backupCreateCopyBtn.textContent = '⏳ Создаю...';
  try {
    const res = await fetch('/api/wb/email-clone', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brand: ctx.brand, mail: ctx.mail, newName: copyName })
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Ошибка копирования');
    _hideBackupModal();
    toast(`Создана копия: ${copyName} — открываю...`, 'success');
    // Revert the current edit (undo the keystroke that triggered the modal)
    cm.undo();
    // Open the copy instead
    await openSourceContext(ctx.brand, copyName);
    toast(`Теперь редактируете копию: ${copyName}`, 'success');
  } catch(e) {
    toast('Ошибка создания копии: ' + e.message, 'error');
    _hideBackupModal();
  } finally {
    if (r.backupCreateCopyBtn) {
      r.backupCreateCopyBtn.disabled = false;
      r.backupCreateCopyBtn.textContent = '📋 Создать версию';
    }
  }
});

// ═══════════════════════════════════════════════════════════════
// EMAIL BASE FILE MANAGER
// ═══════════════════════════════════════════════════════════════

const ebState = { brands: [], activeBrand: null, contextTarget: null };
let _ebSearchQuery = '';

async function renderEmailBase() {
  const treeEl = $('ebTree');
  if (!treeEl) return;
  treeEl.innerHTML = '<div class="panel-empty" style="padding:8px 12px">Загрузка…</div>';
  try {
    const res  = await fetch('/api/wb/emails');
    if (!res.ok) throw new Error('Сервер недоступен — перезапустите студию');
    const data = await res.json();
    if (!data.ok || !data.emails?.length) {
      treeEl.innerHTML = '<div class="panel-empty">Папок не найдено</div>';
      return;
    }
    ebState.brands = data.emails;
    renderEbTree();
    // Auto-select first brand
    if (data.emails.length && !ebState.activeBrand) {
      selectEbBrand(data.emails[0].brand);
    }
  } catch(e) {
    treeEl.innerHTML = `<div class="panel-empty" style="color:#f87171">${escapeHtml(e.message)}</div>`;
  }
}

function renderEbTree() {
  const treeEl = $('ebTree');
  if (!treeEl) return;
  treeEl.innerHTML = '';
  ebState.brands.forEach(({ brand, mails }) => {
    const row = document.createElement('div');
    row.className = 'eb-tree-brand' + (ebState.activeBrand === brand ? ' active' : '');
    row.dataset.brand = brand;
    row.innerHTML = `
      <svg width="13" height="13" viewBox="0 0 14 14" fill="none" style="flex-shrink:0;opacity:.7">
        <path d="M1 3h4l2 2h6v7H1z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>
      </svg>
      <span class="eb-tree-brand-name">${escapeHtml(brand)}</span>
      <span class="eb-tree-badge">${mails.length}</span>`;
    row.addEventListener('click', () => selectEbBrand(brand));
    row.addEventListener('contextmenu', e => {
      e.preventDefault();
      selectEbBrand(brand);
      showEbContextMenu(e, brand, null, row);
    });
    treeEl.appendChild(row);
  });
}

function selectEbBrand(brand) {
  ebState.activeBrand = brand;
  // Update tree active state
  document.querySelectorAll('.eb-tree-brand').forEach(r =>
    r.classList.toggle('active', r.dataset.brand === brand)
  );
  renderEbMailList(brand);
}

function renderEbMailList(brand) {
  const listEl = $('ebMailList');
  if (!listEl) return;
  const entry = ebState.brands.find(b => b.brand === brand);
  if (!entry) { listEl.innerHTML = '<div class="panel-empty">—</div>'; return; }

  listEl.innerHTML = '';
  listEl.oncontextmenu = e => {
    if (e.target.closest('.eb-card, .eb-build-mini-btn, .eb-context-menu')) return;
    e.preventDefault();
    showEbContextMenu(e, brand, null, listEl);
  };

  // Header
  const header = document.createElement('div');
  header.className = 'eb-mail-list-header';
  header.innerHTML = `
    <span>${escapeHtml(brand)}</span>
    <span class="eb-mail-count">${entry.mails.length} писем</span>
    <button class="eb-icon-btn" id="ebNewMailBtn" title="Создать новое письмо" style="color:#22c55e;margin-left:auto">
      <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M7 1v12M1 7h12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
    </button>`;
  listEl.appendChild(header);
  header.querySelector('#ebNewMailBtn')?.addEventListener('click', e => {
    e.stopPropagation();
    createEmailInBrand(brand);
  });

  // Card grid
  const grid = document.createElement('div');
  grid.className = 'eb-card-grid';
  listEl.appendChild(grid);

  // IntersectionObserver for lazy iframe loading
  const previewObserver = new IntersectionObserver((entries) => {
    entries.forEach(en => {
      if (en.isIntersecting) {
        loadEbCardPreview(en.target);
        previewObserver.unobserve(en.target);
      }
    });
  }, { root: listEl, rootMargin: '120px' });

  // Filter by search query
  const filteredMails = _ebSearchQuery
    ? entry.mails.filter(m => {
        const name = (typeof m === 'string' ? m : m.name).toLowerCase();
        return name.includes(_ebSearchQuery);
      })
    : entry.mails;

  if (!filteredMails.length) {
    grid.innerHTML = `<div class="panel-empty" style="grid-column:1/-1">Ничего не найдено</div>`;
  }

  filteredMails.forEach(mailObj => {
    const mail      = typeof mailObj === 'string' ? mailObj : mailObj.name;
    const isBuilt   = typeof mailObj === 'string' ? true    : mailObj.built;
    const shortName = mail.replace(/^mail-/, '');

    const card = document.createElement('div');
    card.className = 'eb-card' + (isBuilt ? '' : ' eb-mail-unbuilt');
    card.dataset.brand = brand;
    card.dataset.mail  = mail;
    card.dataset.built = isBuilt ? '1' : '0';

    card.innerHTML = `
      <div class="eb-card-preview">
        ${isBuilt
          ? '<div class="eb-card-loading"><span>↻</span></div>'
          : '<div class="eb-card-placeholder"><span>Не собрано</span></div>'}
      </div>
      <div class="eb-card-footer">
        <span class="eb-card-name" title="${escapeHtml(mail)}">${escapeHtml(shortName)}</span>
        ${!isBuilt ? '<span class="eb-unbuilt-badge" title="Не собрано — нажмите ↺">●</span>' : ''}
        <button class="eb-build-mini-btn" title="Пересобрать">↺</button>
      </div>`;

    card.addEventListener('click', (e) => {
      if (e.target.classList.contains('eb-build-mini-btn')) return;
      document.querySelectorAll('.eb-card').forEach(c => c.classList.remove('active'));
      card.classList.add('active');
      if (isBuilt) {
        loadEmailFromBase(brand, mail, card);
      } else {
        buildEmail(brand, mail, card).then(() => renderEmailBase());
      }
    });
    card.querySelector('.eb-build-mini-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      buildEmail(brand, mail, e.currentTarget).then(() => renderEmailBase());
    });
    card.addEventListener('contextmenu', e => {
      e.preventDefault();
      e.stopPropagation();
      showEbContextMenu(e, brand, mail, card);
    });

    grid.appendChild(card);
    if (isBuilt) previewObserver.observe(card);
  });
}

async function loadEbCardPreview(card) {
  const brand     = card.dataset.brand;
  const mail      = card.dataset.mail;
  const previewEl = card.querySelector('.eb-card-preview');
  if (!previewEl || card.dataset.built !== '1') return;

  try {
    const res  = await fetch(`/api/wb/email?brand=${encodeURIComponent(brand)}&mail=${encodeURIComponent(mail)}`);
    const data = await res.json();
    if (!data.ok || !data.html) throw new Error('no html');

    const iframe = document.createElement('iframe');
    // allow-same-origin needed for rendering; allow-scripts for email JS animations
    iframe.setAttribute('sandbox', 'allow-same-origin allow-scripts');
    previewEl.innerHTML = '';
    previewEl.appendChild(iframe);
    // srcdoc is safer and works without a server round-trip for rendering
    iframe.srcdoc = data.html;
  } catch {
    previewEl.innerHTML = '<div class="eb-card-placeholder"><span>Нет превью</span></div>';
  }
}

async function loadEmailFromBase(brand, mail, btnEl) {
  try {
    btnEl?.classList.add('loading');

    // Try source context first (preferred — gives Pug/Stylus tabs)
    let srcLoaded = false;
    try {
      await openSourceContext(brand, mail);
      srcLoaded = true;
    } catch { /* source context optional */ }

    if (srcLoaded) {
      // Source context loaded — no need for a separate HTML file tab
      // Remove any old HTML file tab with same name to avoid duplicates
      const name = `${brand}__${mail}.html`;
      const oldFile = state.files.find(f => f.name === name);
      if (oldFile) {
        state.files = state.files.filter(f => f.id !== oldFile.id);
        r.fileTabs.querySelector(`[data-file-id="${oldFile.id}"]`)?.remove();
        if (!state.files.length) {
          const emptyTab = document.createElement('div');
          emptyTab.className = 'file-tab';
          emptyTab.dataset.fileId = '__empty__';
          emptyTab.innerHTML = '<span class="file-tab-name">Без файла</span>';
          r.fileTabs.appendChild(emptyTab);
        }
      }
    } else {
      // No source context — fall back to loading compiled HTML as a plain file
      const res  = await fetch(`/api/wb/email?brand=${encodeURIComponent(brand)}&mail=${encodeURIComponent(mail)}`);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Ошибка загрузки');

      const name = `${brand}__${mail}.html`;
      const existing = state.files.find(f => f.name === name);
      if (existing) {
        activateFile(existing.id);
      } else {
        const id = uid();
        state.files.push({ id, name, html: data.html });
        r.fileTabs.querySelector('[data-file-id="__empty__"]')?.remove();
        renderFileTab({ id, name, html: data.html });
        activateFile(id);
        saveToLocalStorage();
      }
    }

    r.saveSourceBtn?.classList.add('hidden');
    hookSourceModified();
    closePanel();
    toast(`Открыт: ${brand} / ${mail.replace(/^mail-/, '')}`, 'success');
  } catch(e) {
    toast('Ошибка загрузки: ' + e.message, 'error');
  } finally {
    btnEl?.classList.remove('loading');
  }
}

async function buildEmail(brand, mail, btnEl) {
  const statusEl = $('emailBuildStatus');
  btnEl?.classList.add('loading');
  if (statusEl) {
    statusEl.textContent = `Собираю ${brand} / ${mail}…`;
    statusEl.classList.remove('hidden');
  }
  try {
    const res  = await fetch('/api/wb/build-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brand, mail }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Ошибка сборки');

    if (statusEl) statusEl.textContent = `✓ Собрано за ${data.duration}мс`;
    toast(`Сборка готова: ${mail}`, 'success');

    // Auto-load the newly built HTML
    await loadEmailFromBase(brand, mail, null);
  } catch(e) {
    if (statusEl) statusEl.textContent = '✗ ' + e.message;
    toast('Ошибка сборки: ' + e.message, 'error');
  } finally {
    btnEl?.classList.remove('loading');
    if (statusEl) setTimeout(() => statusEl.classList.add('hidden'), 6000);
  }
}

$('refreshEmailBaseBtn')?.addEventListener('click', renderEmailBase);

// ─── Create new brand ────────────────────────────────────────────
$('ebNewBrandBtn')?.addEventListener('click', async () => {
  const name = prompt('Название новой темы (бренда):');
  if (!name) return;
  try {
    const res  = await fetch('/api/wb/create-brand', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim() }),
    });
    const data = await res.json();
    if (!data.ok && res.status !== 409) throw new Error(data.error);
    if (res.status === 409) { toast('Тема уже существует', 'warning'); return; }
    toast(`✓ Создана тема: ${name}`, 'success');
    renderEmailBase();
  } catch(e) { toast('Ошибка: ' + e.message, 'error'); }
});

// ─── Context menu ───────────────────────────────────────────────
function showEbContextMenu(e, brand, mail, rowEl) {
  const menu = $('ebContextMenu');
  if (!menu) return;
  const isBrand = !mail;
  ebState.contextTarget = { brand, mail, rowEl, type: isBrand ? 'brand' : 'mail' };
  $('ebCtxCreate')?.classList.toggle('hidden', !brand);
  $('ebCtxOpen')?.classList.toggle('hidden', isBrand);
  $('ebCtxClone')?.classList.toggle('hidden', isBrand);
  $('ebCtxRename')?.classList.toggle('hidden', isBrand);
  $('ebCtxDelete')?.classList.toggle('hidden', isBrand);
  menu.querySelector('.eb-ctx-sep')?.classList.toggle('hidden', isBrand);
  menu.style.left = e.clientX + 'px';
  menu.style.top  = e.clientY + 'px';
  menu.classList.remove('hidden');
}

function hideEbContextMenu() {
  $('ebContextMenu')?.classList.add('hidden');
  ebState.contextTarget = null;
}

document.addEventListener('click', hideEbContextMenu);
document.addEventListener('keydown', e => { if (e.key === 'Escape') hideEbContextMenu(); });

$('ebCtxCreate')?.addEventListener('click', async () => {
  const { brand } = ebState.contextTarget || {};
  if (brand) await createEmailInBrand(brand);
});

$('ebCtxOpen')?.addEventListener('click', () => {
  const { brand, mail, rowEl } = ebState.contextTarget || {};
  if (brand && mail) loadEmailFromBase(brand, mail, rowEl);
});

async function createEmailInBrand(brand) {
  if (!brand) return;
  const rawName = prompt(`Создать новое письмо в "${brand}":`, 'mail-new-email');
  const name = cleanMailFolderName(rawName);
  if (!name) return;
  try {
    const res = await fetch('/api/wb/email-import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brand, name, html: '', createBrand: false }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);
    toast(`Создано: ${data.mail || name}`, 'success');
    await renderEmailBase();
    await openSourceContext(brand, data.mail || name);
    hookSourceModified();
  } catch(e) {
    toast('Ошибка создания: ' + e.message, 'error');
  }
}

async function cloneEmailBaseMail(brand, mail) {
  if (!brand || !mail) return;
  const newName = cleanMailFolderName(prompt(`Клонировать "${mail}" как:`, suggestMailVersionName(mail, brand)));
  if (!newName || newName === mail) return;
  try {
    const res  = await fetch('/api/wb/email-clone', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brand, mail, newName }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);
    toast(`Клонировано: ${newName}`, 'success');
    renderEmailBase();
    openSourceContext(brand, newName);
  } catch(e) {
    toast('Ошибка: ' + e.message, 'error');
  }
}

async function renameEmailBaseMail(brand, mail) {
  if (!brand || !mail) return;
  const newName = cleanMailFolderName(prompt(`Переименовать "${mail}" в:`, mail));
  if (!newName || newName === mail) return;
  try {
    const res  = await fetch('/api/wb/email-rename', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brand, mail, newName }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);
    toast(`Переименовано в: ${newName}`, 'success');
    if (state.srcCtx?.brand === brand && state.srcCtx?.mail === mail) {
      state.srcCtx.mail = newName;
      updateTopbarSrcTab(state.srcCtx);
      saveToLocalStorage();
    }
    renderEmailBase();
  } catch(e) {
    toast('Ошибка: ' + e.message, 'error');
  }
}

async function deleteEmailBaseMail(brand, mail) {
  if (!brand || !mail) return;
  if (!confirm(`Удалить "${mail}" из базы? Папка будет перемещена в _trash.`)) return;
  try {
    const res  = await fetch('/api/wb/email-delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brand, mail }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);
    if (state.srcCtx?.brand === brand && state.srcCtx?.mail === mail) {
      r.srcFileTabs?.querySelector('.src-close-btn')?.click();
    }
    toast(`Удалено в _trash: ${mail}`, 'success');
    renderEmailBase();
  } catch(e) {
    toast('Ошибка: ' + e.message, 'error');
  }
}

$('ebCtxClone')?.addEventListener('click', async () => {
  const { brand, mail } = ebState.contextTarget || {};
  await cloneEmailBaseMail(brand, mail);
});

$('ebCtxRename')?.addEventListener('click', async () => {
  const { brand, mail } = ebState.contextTarget || {};
  await renameEmailBaseMail(brand, mail);
});

$('ebCtxDelete')?.addEventListener('click', async () => {
  const { brand, mail } = ebState.contextTarget || {};
  await deleteEmailBaseMail(brand, mail);
});

// ═══════════════════════════════════════════════════════════════
// EXPORT TXT
// ═══════════════════════════════════════════════════════════════

function renderExportList() {
  if (!state.namespaces.length) {
    r.exportLocaleList.innerHTML = '<div class="panel-empty">Нет загруженных локалей</div>';
    return;
  }
  let html = '';
  state.namespaces.forEach(ns => {
    Object.keys(ns.locales).forEach(code => {
      html += `<button class="export-locale-btn" data-ns="${ns.id}" data-code="${code}">
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
          <path d="M6.5 1v8M4 7l2.5 3 2.5-3M1 12h11" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
        </svg>
        ${escapeHtml(ns.name)} / ${escapeHtml(code.toUpperCase())}
      </button>`;
    });
  });
  r.exportLocaleList.innerHTML = html || '<div class="panel-empty">Нет локалей</div>';
  r.exportLocaleList.querySelectorAll('[data-ns]').forEach(b =>
    b.addEventListener('click', () => exportTxt(b.dataset.ns, b.dataset.code))
  );
}

function exportTxt(nsId, code) {
  const ns = getNs(nsId);
  if (!ns) return;
  const content = ns.localeRaw?.[code] ?? serializeTxt(ns.locales[code] || []);
  const blob = new Blob([content], { type:'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  Object.assign(document.createElement('a'), { href:url, download:`${code}.txt` }).click();
  URL.revokeObjectURL(url);
  toast(`Экспорт ${code.toUpperCase()} готов`, 'success');
}

// Export ALL namespaces / locales as one ZIP
$('exportAllZipBtn')?.addEventListener('click', async () => {
  if (!state.namespaces.length) { toast('Нет загруженных локалей', 'warning'); return; }
  if (typeof JSZip === 'undefined') { toast('JSZip не загружен', 'error'); return; }

  const btn = $('exportAllZipBtn');
  btn.disabled = true;
  btn.textContent = 'Упаковываю…';

  try {
    const zip = new JSZip();
    state.namespaces.forEach(ns => {
      const folder = zip.folder(ns.name);
      Object.keys(ns.locales).forEach(code => {
        const content = ns.localeRaw?.[code] ?? serializeTxt(ns.locales[code] || []);
        folder.file(`${code}.txt`, content);
      });
    });

    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
    const url  = URL.createObjectURL(blob);
    const name = (state.files.find(f => f.id === state.activeFileId)?.name || 'locales')
                  .replace(/\.html?$/i, '') + '-locales.zip';
    Object.assign(document.createElement('a'), { href: url, download: name }).click();
    URL.revokeObjectURL(url);
    toast('ZIP скачан', 'success');
  } catch(e) {
    toast('Ошибка ZIP: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M7 1v8M4 7l3 3 3-3M1 12h12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg> Скачать всё (ZIP)`;
  }
});

// ═══════════════════════════════════════════════════════════════
// RESIZE HANDLE
// ═══════════════════════════════════════════════════════════════

(function initResize() {
  let drag=false, startX=0, startW=0;

  const refreshEditorsAfterResize = () => {
    cm?.refresh();
    cmSplit?.refresh();
    cmFullscreen?.refresh();
    cmFullscreenSplit?.refresh();
  };

  const clampEditorWidth = width => {
    const total = r.workspace.offsetWidth;
    const minEditor = Math.min(360, Math.max(280, total * 0.22));
    const minPreview = Math.min(420, Math.max(260, total * 0.24));
    return Math.max(minEditor, Math.min(width, total - minPreview));
  };

  const setEditorWidth = (width, refresh = false) => {
    const newW = clampEditorWidth(width);
    r.editorPane.style.width = newW + 'px';
    r.editorPane.style.flex = 'none';
    if (refresh) requestAnimationFrame(refreshEditorsAfterResize);
  };

  const saveSplitRatio = () => {
    const total = r.workspace.offsetWidth;
    if (total > 0) localStorage.setItem(LS_WORKSPACE_SPLIT, String(r.editorPane.offsetWidth / total));
  };

  const restoreSplitRatio = () => {
    const total = r.workspace.offsetWidth;
    const saved = Number(localStorage.getItem(LS_WORKSPACE_SPLIT));
    if (total > 0 && Number.isFinite(saved) && saved > 0.18 && saved < 0.82) {
      setEditorWidth(total * saved, true);
    }
  };

  restoreSplitRatio();
  window.addEventListener('resize', debounce(restoreSplitRatio, 120));

  r.resizeHandle.addEventListener('mousedown', e => {
    drag=true; startX=e.clientX; startW=r.editorPane.offsetWidth;
    r.resizeHandle.classList.add('dragging');
    r.workspace?.classList.add('is-resizing');
    document.body.style.cursor='col-resize';
    document.body.style.userSelect='none';
    e.preventDefault();
  });
  document.addEventListener('mousemove', e => {
    if (!drag) return;
    setEditorWidth(startW + e.clientX - startX);
  });
  document.addEventListener('mouseup', () => {
    if (!drag) return;
    drag=false;
    r.resizeHandle.classList.remove('dragging');
    r.workspace?.classList.remove('is-resizing');
    document.body.style.cursor=''; document.body.style.userSelect='';
    saveSplitRatio();
    refreshEditorsAfterResize();
  });
  r.resizeHandle.addEventListener('dblclick', () => {
    const total = r.workspace.offsetWidth;
    setEditorWidth(total * 0.5, true);
    saveSplitRatio();
    toast('Ширина панелей сброшена 50/50', 'info', 1400);
  });
})();

// ═══════════════════════════════════════════════════════════════
// BOTTOM BAR PANELS
// ═══════════════════════════════════════════════════════════════

document.querySelectorAll('.bottom-tool-btn').forEach(btn =>
  btn.addEventListener('click', () => togglePanel(btn.dataset.panel, btn))
);
$('bottomBarToggle').addEventListener('click', closePanel);

function togglePanel(id, btn) { if (state.activePanel===id) closePanel(); else { closePanel(); openPanel(id,btn); } }
function clampBottomPanelHeight(height) {
  const max = Math.max(180, Math.min(window.innerHeight * 0.78, window.innerHeight - 120));
  return Math.round(Math.max(160, Math.min(max, height)));
}
function restoreBottomPanelHeight() {
  const saved = Number(localStorage.getItem(LS_BOTTOM_PANEL_HEIGHT));
  if (Number.isFinite(saved) && saved > 0) {
    r.bottomBar.style.height = `${clampBottomPanelHeight(saved)}px`;
  } else {
    r.bottomBar.style.height = '';
  }
}
function openPanel(id, btn) {
  state.activePanel = id;
  r.bottomBar.dataset.state = 'expanded';
  restoreBottomPanelHeight();
  document.querySelectorAll('.bottom-tool-btn').forEach(b => b.classList.remove('active'));
  btn?.classList.add('active');
  // Use classList (not hidden attr) because panels have class="hidden" in HTML
  document.querySelectorAll('.bottom-panel').forEach(p => p.classList.add('hidden'));
  const panel = $(`panel-${id}`);
  if (panel) panel.classList.remove('hidden');
  if (id==='export')    renderExportList();
  if (id==='brands')    renderBrands();
  if (id==='emailbase') renderEmailBase();
}
function closePanel() {
  state.activePanel = null;
  r.bottomBar.dataset.state = 'collapsed';
  r.bottomBar.style.height = '';
  document.querySelectorAll('.bottom-tool-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.bottom-panel').forEach(p => p.classList.add('hidden'));
}

(function setupBottomPanelResize() {
  if (!r.bottomResizeHandle || !r.bottomBar) return;
  let startY = 0;
  let startHeight = 0;
  const onMove = e => {
    const next = clampBottomPanelHeight(startHeight + (startY - e.clientY));
    r.bottomBar.style.height = `${next}px`;
  };
  const onUp = () => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    r.bottomBar.classList.remove('resizing');
    const h = r.bottomBar.getBoundingClientRect().height;
    if (h > 0) localStorage.setItem(LS_BOTTOM_PANEL_HEIGHT, String(clampBottomPanelHeight(h)));
  };
  r.bottomResizeHandle.addEventListener('mousedown', e => {
    if (r.bottomBar.dataset.state !== 'expanded') return;
    e.preventDefault();
    startY = e.clientY;
    startHeight = r.bottomBar.getBoundingClientRect().height || 220;
    r.bottomBar.classList.add('resizing');
    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
})();

// ═══════════════════════════════════════════════════════════════
// BRANDS
// ═══════════════════════════════════════════════════════════════

const BRAND_TOKENS = [
  'color','color2','onColor','accent','refColor',
  'bg','surface','surfaceVariant','onSurface',
  'btnRadius','radiusSm','radiusLg','leftBorder','borderRamka',
  'paddingL','paddingM','paddingS','paddingXS',
];

function applyBrandTokens(html, brand) {
  // Replace {{brand.token}} with brand value
  // Also logo/logoWidth/logoPos
  const allTokens = { logo: brand.logoUrl || '', logoWidth: brand.logoWidth || '', logoPos: brand.logoPos || 'left', ...brand.tokens };
  Object.entries(allTokens).forEach(([key, val]) => {
    if (!val) return;
    const re = new RegExp('\\{\\{\\s*brand\\.' + key.replace(/[.*+?^${}()|[\]\\]/g,'\\$&') + '\\s*\\}\\}', 'g');
    html = html.replace(re, escapeHtml(val));
  });
  return html;
}

function renderBrands() {
  if (!state.brands.length) {
    r.brandsGrid.innerHTML = '<div class="panel-empty">Нет брендов. Нажми «Создать бренд» чтобы добавить первый.</div>';
    return;
  }
  r.brandsGrid.innerHTML = '';
  state.brands.forEach(brand => {
    const isApplied = brand.id === state.activeBrandId;
    const card = document.createElement('div');
    card.className = 'brand-card' + (isApplied ? ' applied' : '');
    card.dataset.brandId = brand.id;

    // Logo area
    const logoEl = document.createElement('div');
    logoEl.className = 'brand-card-logo';
    if (brand.logoUrl) {
      logoEl.innerHTML = `<img src="${escapeHtml(brand.logoUrl)}" alt="${escapeHtml(brand.name)}" onerror="this.parentElement.innerHTML='<div class=brand-card-logo-placeholder>🎨</div>'" />`;
    } else {
      const bg = brand.tokens?.color || '#888';
      logoEl.innerHTML = `<div class="brand-card-logo-placeholder" style="background:${escapeHtml(bg)};border:none;color:#fff;font-weight:700;font-size:14px">${escapeHtml(brand.name.slice(0,1))}</div>`;
    }

    // Body
    const swatches = [brand.tokens?.color, brand.tokens?.color2, brand.tokens?.accent, brand.tokens?.bg]
      .filter(Boolean)
      .map(c => `<span class="brand-swatch" style="background:${escapeHtml(c)}" title="${escapeHtml(c)}"></span>`)
      .join('');
    const body = document.createElement('div');
    body.className = 'brand-card-body';
    body.innerHTML = `<div class="brand-card-name">${escapeHtml(brand.name)}</div>
      <div class="brand-card-color-row">${swatches}</div>`;

    // Actions
    const actions = document.createElement('div');
    actions.className = 'brand-card-actions';
    const editBtn = document.createElement('button');
    editBtn.className = 'brand-card-btn';
    editBtn.textContent = '✎ Изменить';
    editBtn.addEventListener('click', e => { e.stopPropagation(); openBrandModal(brand.id); });
    const applyBtn = document.createElement('button');
    applyBtn.className = 'brand-card-btn apply' + (isApplied ? ' applied' : '');
    applyBtn.textContent = isApplied ? '✓ Применён' : 'Применить';
    applyBtn.addEventListener('click', e => { e.stopPropagation(); toggleBrand(brand.id); });

    actions.appendChild(editBtn);
    actions.appendChild(applyBtn);

    if (isApplied) {
      const badge = document.createElement('div');
      badge.className = 'brand-card-applied-badge';
      badge.textContent = 'ON';
      card.appendChild(badge);
    }

    card.appendChild(logoEl);
    card.appendChild(body);
    card.appendChild(actions);
    r.brandsGrid.appendChild(card);
  });

  // Update active info bar
  const activeBrand = state.brands.find(b => b.id === state.activeBrandId);
  r.brandsActiveInfo.classList.toggle('hidden', !activeBrand);
  if (activeBrand) r.brandsActiveName.textContent = activeBrand.name;

  // Update preview badge
  if (r.previewBrandBadge) {
    r.previewBrandBadge.classList.toggle('hidden', !activeBrand);
    if (activeBrand) r.previewBrandBadge.textContent = activeBrand.name;
  }
}

function toggleBrand(brandId) {
  state.activeBrandId = (state.activeBrandId === brandId) ? null : brandId;
  renderBrands();
  updatePreview();
  const b = state.brands.find(x => x.id === brandId);
  if (state.activeBrandId) toast(`Бренд "${b?.name}" применён`, 'success', 1800);
  else toast('Бренд сброшен', 'info', 1500);
  saveToLocalStorage();
}

// ─── Brand modal ─────────────────────────────────────────────────

function openBrandModal(brandId = null) {
  state._editBrandId = brandId;
  const brand = brandId ? state.brands.find(b => b.id === brandId) : null;

  r.brandModalTitle.textContent = brand ? 'Редактировать бренд' : 'Создать бренд';
  r.deleteBrandBtn.classList.toggle('hidden', !brand);

  // Fill fields
  r.brandName.value     = brand?.name     || '';
  r.brandLogoUrl.value  = brand?.logoUrl  || '';
  r.brandLogoWidth.value= brand?.logoWidth|| '';
  r.brandLogoPos.value  = brand?.logoPos  || '';
  updateBrandLogoPreview();

  // Fill token inputs
  r.brandModal.querySelectorAll('.brand-token-input').forEach(inp => {
    inp.value = brand?.tokens?.[inp.dataset.token] || '';
  });

  r.brandModalBackdrop.classList.remove('hidden');
  r.brandModal.classList.remove('hidden');
  setTimeout(() => r.brandName.focus(), 50);
}

function closeBrandModal() {
  r.brandModalBackdrop.classList.add('hidden');
  r.brandModal.classList.add('hidden');
  state._editBrandId = null;
}

function updateBrandLogoPreview() {
  const url = r.brandLogoUrl.value.trim();
  if (url) {
    r.brandLogoPreview.innerHTML = `<img src="${escapeHtml(url)}" style="max-height:84px;max-width:100%;object-fit:contain" onerror="this.parentElement.innerHTML='<span style=color:var(--text-3);font-size:11px>Ошибка загрузки</span>'" />`;
  } else {
    r.brandLogoPreview.innerHTML = '<span style="color:var(--text-3);font-size:11px">Логотип</span>';
  }
}

function saveBrand() {
  const name = r.brandName.value.trim();
  if (!name) { r.brandName.focus(); toast('Введите название бренда', 'warning'); return; }

  const tokens = {};
  r.brandModal.querySelectorAll('.brand-token-input').forEach(inp => {
    if (inp.value.trim()) tokens[inp.dataset.token] = inp.value.trim();
  });

  if (state._editBrandId) {
    const brand = state.brands.find(b => b.id === state._editBrandId);
    if (brand) {
      brand.name      = name;
      brand.logoUrl   = r.brandLogoUrl.value.trim();
      brand.logoWidth = r.brandLogoWidth.value.trim();
      brand.logoPos   = r.brandLogoPos.value.trim();
      brand.tokens    = tokens;
    }
    toast(`Бренд "${name}" обновлён`, 'success');
  } else {
    state.brands.push({
      id: `brand-${uid()}`,
      name,
      logoUrl:   r.brandLogoUrl.value.trim(),
      logoWidth: r.brandLogoWidth.value.trim(),
      logoPos:   r.brandLogoPos.value.trim(),
      tokens,
    });
    toast(`Бренд "${name}" создан`, 'success');
  }

  renderBrands();
  if (state.activeBrandId) updatePreview();
  saveToLocalStorage();
  closeBrandModal();
}

function deleteBrand() {
  const brand = state.brands.find(b => b.id === state._editBrandId);
  if (!brand || !confirm(`Удалить бренд "${brand.name}"?`)) return;
  state.brands = state.brands.filter(b => b.id !== state._editBrandId);
  if (state.activeBrandId === state._editBrandId) {
    state.activeBrandId = null;
    updatePreview();
  }
  renderBrands();
  saveToLocalStorage();
  toast(`Бренд удалён`, 'success');
  closeBrandModal();
}

// Brand event listeners
r.createBrandBtn.addEventListener('click', () => openBrandModal());
r.closeBrandModalBtn.addEventListener('click', closeBrandModal);
r.cancelBrandBtn.addEventListener('click', closeBrandModal);
r.brandModalBackdrop.addEventListener('click', closeBrandModal);
r.saveBrandBtn.addEventListener('click', saveBrand);
r.deleteBrandBtn.addEventListener('click', deleteBrand);
r.brandsResetBtn.addEventListener('click', () => { state.activeBrandId = null; renderBrands(); updatePreview(); saveToLocalStorage(); });
r.previewBrandBadge?.addEventListener('click', () => openPanel('brands', document.querySelector('[data-panel="brands"]')));

// Live logo preview
r.brandLogoUrl.addEventListener('input', debounce(updateBrandLogoPreview, 400));

// ═══════════════════════════════════════════════════════════════
// PDF EXPORT
// ═══════════════════════════════════════════════════════════════

r.exportPdfBtn.addEventListener('click', async () => {
  const doc = r.previewFrame.contentDocument;
  if (!doc?.body?.innerHTML.trim()) { toast('Нет контента для PDF','warning'); return; }
  if (typeof html2pdf === 'undefined') { toast('html2pdf не загружен','error'); return; }

  const statusEl = $('pdfStatus');
  r.exportPdfBtn.disabled = true;
  if (statusEl) statusEl.textContent = 'Генерация…';

  try {
    // Clone the full document HTML so images/styles are preserved
    const doctype  = '<!DOCTYPE html>';
    const fullHtml = doctype + doc.documentElement.outerHTML;
    const container = document.createElement('div');
    // Strip scripts to avoid re-execution
    container.innerHTML = fullHtml.replace(/<script[\s\S]*?<\/script>/gi, '');

    const activeFile = state.files.find(f => f.id === state.activeFileId);
    const filename   = (activeFile?.name || 'email').replace(/\.html?$/i, '') + '.pdf';

    await html2pdf()
      .set({
        margin:      [5, 5, 5, 5],
        filename,
        image:       { type: 'jpeg', quality: 0.97 },
        html2canvas: { scale: 2, useCORS: true, logging: false },
        jsPDF:       { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak:   { mode: ['avoid-all', 'css'] },
      })
      .from(container)
      .save();

    if (statusEl) statusEl.textContent = '';
    toast('PDF сохранён', 'success');
  } catch(e) {
    console.error('PDF error:', e);
    toast('Ошибка PDF: ' + e.message, 'error');
    if (statusEl) statusEl.textContent = '';
  } finally {
    r.exportPdfBtn.disabled = false;
  }
});

// ═══════════════════════════════════════════════════════════════
// AI DRAWER
// ═══════════════════════════════════════════════════════════════

function toggleAiDrawer() {
  const open = r.aiDrawer.dataset.state === 'expanded';
  r.aiDrawer.dataset.state = open ? 'collapsed' : 'expanded';
  // When opening, clear explicit height set by drag-resize so CSS transition can run
  if (open) { r.aiDrawer.style.height = ''; }
  if (!open) setTimeout(() => r.aiInput.focus(), 290);
}

r.aiDrawerHandle.addEventListener('click', e => {
  if (e.target.closest('.ai-drawer-toggle') || e.target.closest('.ai-send-btn')) return;
  toggleAiDrawer();
});

// ─── AI drawer drag-to-resize ────────────────────────────────────
if (r.aiResizeHandle) {
  r.aiResizeHandle.addEventListener('mousedown', e => {
    e.preventDefault();
    e.stopPropagation();
    const editorPane = r.editorPane;
    if (!editorPane) return;

    // Make sure drawer is expanded before resize
    if (r.aiDrawer.dataset.state !== 'expanded') {
      r.aiDrawer.dataset.state = 'expanded';
    }

    const startY = e.clientY;
    const startH = r.aiDrawer.getBoundingClientRect().height;
    const paneH  = editorPane.getBoundingClientRect().height;

    r.aiDrawer.style.transition = 'none'; // disable CSS transition during drag

    function onMove(ev) {
      const delta = startY - ev.clientY;  // dragging UP → bigger drawer
      const newH  = Math.max(38, Math.min(paneH - 60, startH + delta));
      r.aiDrawer.style.height = newH + 'px';
    }
    function onUp() {
      r.aiDrawer.style.transition = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}
r.aiDrawerToggle.addEventListener('click', e => { e.stopPropagation(); toggleAiDrawer(); });

r.aiSendBtn.addEventListener('click', sendAiMessage);
r.aiInput.addEventListener('keydown', e => {
  // Plain Enter sends. Shift+Enter inserts a newline (default browser behavior).
  // Cmd+Enter / Ctrl+Enter kept as an alternate shortcut for muscle memory.
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    sendAiMessage();
    return;
  }
  if (e.key === 'Escape') clearAiImages();
  requestAnimationFrame(() => {
    r.aiInput.style.height = 'auto';
    r.aiInput.style.height = Math.min(r.aiInput.scrollHeight,120) + 'px';
  });
});


// ─── Agent mode: stream tool calls + results into the chat ─────────────
async function runAgentChat(text) {
  state.chatHistory.push({ role: 'user', content: text });
  // Insert a dedicated agent timeline bubble.
  const timeline = document.createElement('div');
  timeline.className = 'ai-message assistant ai-agent-timeline';
  timeline.innerHTML = '<div class="ai-agent-step ai-agent-status">🤖 Agent думает…</div>';
  r.aiMessages.appendChild(timeline);
  r.aiMessages.scrollTop = r.aiMessages.scrollHeight;

  state.aiStreaming = true;
  r.aiSendBtn.disabled = true;
  r.aiCancelRow.classList.remove('hidden');
  state.aiAbortController = new AbortController();
  const cancel = () => {
    try { state.aiAbortController.abort(); } catch {}
    timeline.appendChild(stepEl('error', '✕ Отменено пользователем'));
  };
  r.aiCancelBtn.onclick = cancel;

  function stepEl(kind, content) {
    const div = document.createElement('div');
    div.className = 'ai-agent-step ai-agent-' + kind;
    if (typeof content === 'string') div.textContent = content;
    else div.appendChild(content);
    return div;
  }
  function setStatus(msg) {
    const s = timeline.querySelector('.ai-agent-status');
    if (s) s.textContent = msg;
  }

  try {
    const currentHtml = cm?.getValue() || '';
    const res = await fetch('/api/wb/ai/agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: state.aiAbortController.signal,
      body: JSON.stringify({
        message: text,
        messages: state.chatHistory.slice(-6),
        baseEmailHtml: currentHtml,
        namespaces: state.namespaces.map(ns => ({
          id: ns.id,
          name: ns.name,
          namespace: ns.name,
          referenceLocale: getReferenceLocaleCode(ns),
          locales: ns.locales || {},
          localeRaw: ns.localeRaw || {},
        })),
        activeNamespaceName: (() => {
          const id = state.activeNamespaceId;
          const ns = id ? state.namespaces.find(n => n.id === id) : null;
          return ns ? ns.name : null;
        })(),
        activeLocale: state.activeLocale || null,
      }),
    });
    if (!res.ok || !res.body) throw new Error('agent endpoint returned ' + res.status);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let finalPayload = null;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        let frame;
        try { frame = JSON.parse(line); } catch { continue; }
        if (frame.kind === 'start') {
          setStatus(`🤖 Agent (HTML: ${frame.ctxSummary.htmlLength} chars, ${frame.ctxSummary.namespaces} namespace, активная: ${frame.ctxSummary.activeNamespace || '—'})`);
        } else if (frame.kind === 'tool_call') {
          const argsPreview = JSON.stringify(frame.args || {}).slice(0, 80);
          timeline.appendChild(stepEl('toolcall', `🔧 ${frame.name}${argsPreview && argsPreview !== '{}' ? ' ' + argsPreview : ''}`));
        } else if (frame.kind === 'tool_result') {
          let summary = '✓';
          const r = frame.result || {};
          if (r.error) summary = '✗ ' + r.error;
          else if (frame.name === 'analyze_email' && r.summary) summary = `anchor ${r.summary.anchored} / candidate ${r.summary.candidate} / orphan ${r.summary.orphan} (всего ${r.summary.refBlockCount})`;
          else if (frame.name === 'placeholderize_html' && typeof r.anchors === 'number') summary = `${r.anchors} анкоров; missed ${r.missed?.length || 0}, ambiguous ${r.ambiguous?.length || 0}`;
          else if (frame.name === 'fix_locale_txt' && r.locale) summary = `${r.locale}: ${r.before} → ${r.after} блоков`;
          else if (frame.name === 'translate_locale_txt') summary = `${r.from || '?'} → ${r.to || '?'}: ${r.blocks} блоков`;
          else if (frame.name === 'list_namespaces') summary = `${r.count} namespace(ов)`;
          else if (frame.name === 'read_open_html') summary = `${r.length} байт`;
          else if (frame.name === 'get_namespace_blocks' && Array.isArray(r.blocks)) summary = `${r.blocks.length} блоков`;
          timeline.appendChild(stepEl('toolresult', '↳ ' + summary));
        } else if (frame.kind === 'text') {
          if (frame.text) timeline.appendChild(stepEl('text', frame.text));
        } else if (frame.kind === 'finish') {
          finalPayload = frame.payload;
        } else if (frame.kind === 'final') {
          finalPayload = frame.payload;
        } else if (frame.kind === 'error') {
          timeline.appendChild(stepEl('error', '⚠ ' + frame.message));
        }
        r.aiMessages.scrollTop = r.aiMessages.scrollHeight;
      }
    }
    setStatus('🤖 Agent готов');
    if (finalPayload) {
      const sum = stepEl('text', finalPayload.summary || '');
      sum.classList.add('ai-agent-summary');
      timeline.appendChild(sum);
      state.chatHistory.push({ role: 'assistant', content: finalPayload.summary || '' });

      // Apply modified HTML if any.
      if (finalPayload.modifiedHtml && cm) {
        const apply = document.createElement('button');
        apply.className = 'ai-preset';
        apply.textContent = `↩ Применить HTML (${finalPayload.modifiedHtml.length} симв.)`;
        apply.onclick = () => { cm.setValue(finalPayload.modifiedHtml); updatePreview(); apply.disabled = true; apply.textContent = '✓ Применено'; };
        timeline.appendChild(apply);
      }
      // Apply locale updates if any.
      if (Array.isArray(finalPayload.localeUpdates) && finalPayload.localeUpdates.length) {
        for (const upd of finalPayload.localeUpdates) {
          const apply = document.createElement('button');
          apply.className = 'ai-preset';
          apply.textContent = `↩ Применить локаль ${upd.namespace}/${upd.locale}`;
          apply.onclick = () => {
            try {
              let ns = state.namespaces.find(n => n.name === upd.namespace);
              if (!ns) {
                ns = { id: `ns-${uid()}`, name: upd.namespace, locales: {} };
                state.namespaces.push(ns);
              }
              setLocaleRawContent(ns, upd.locale, upd.txt);
              renderLocalesBar();
              renderNamespaceBar();
              saveToLocalStorage();
              try { activateLocale(upd.locale); } catch {}
              apply.disabled = true; apply.textContent = `✓ ${upd.namespace}/${upd.locale}`;
            } catch (err) { apply.textContent = '✗ ' + (err.message || 'error'); }
          };
          timeline.appendChild(apply);
        }
      }
      // Locale deletes queued by the agent — applied only after user click+confirm.
      if (Array.isArray(finalPayload.localeDeletes) && finalPayload.localeDeletes.length) {
        for (const del of finalPayload.localeDeletes) {
          if (!del || !del.locale) continue;
          const btnDel = document.createElement('button');
          btnDel.className = 'ai-preset';
          btnDel.textContent = `🗑 Удалить локаль ${del.namespace}/${del.locale}`;
          btnDel.onclick = () => {
            if (deleteLocaleInNamespace(del.namespace, del.locale)) {
              btnDel.disabled = true;
              btnDel.textContent = `✓ Удалена ${del.namespace}/${del.locale}`;
            }
          };
          timeline.appendChild(btnDel);
        }
      }
    }
  } catch (err) {
    if (err.name !== 'AbortError') timeline.appendChild(stepEl('error', '⚠ ' + (err.message || err)));
  } finally {
    state.aiStreaming = false;
    r.aiSendBtn.disabled = false;
    r.aiCancelRow.classList.add('hidden');
    r.aiHandleLabel.textContent = 'AI';
  }
}

function addMessage(role, text='', images=[]) {
  r.aiMessages.querySelector('.ai-welcome')?.remove();
  const wrap = document.createElement('div');
  wrap.className = `ai-message ${role}`;
  // Show attached images before text (user only)
  if (role === 'user' && images.length) {
    const imgRow = document.createElement('div');
    imgRow.className = 'ai-msg-images';
    images.forEach(src => {
      const img = document.createElement('img');
      img.src = src;
      img.className = 'ai-msg-img';
      img.title = 'Прикреплённый скриншот';
      imgRow.appendChild(img);
    });
    wrap.appendChild(imgRow);
  }
  const bubble = document.createElement('div');
  bubble.className = 'ai-bubble';
  if (role==='user') bubble.innerHTML = escapeHtml(text).replace(/\n/g,'<br>');
  wrap.appendChild(bubble);
  r.aiMessages.appendChild(wrap);
  r.aiMessages.scrollTop = r.aiMessages.scrollHeight;
  return bubble;
}

// ─── AI image attachments ────────────────────────────────────────
let _aiPendingImages = []; // Array of data URLs

$('aiImageBtn')?.addEventListener('click', () => $('aiImageInput')?.click());

$('aiImageInput')?.addEventListener('change', e => {
  const files = [...(e.target.files || [])];
  e.target.value = ''; // reset input
  files.forEach(file => {
    if (!file.type.startsWith('image/')) return;
    if (_aiPendingImages.length >= 4) { toast('Максимум 4 изображения', 'warning'); return; }
    const reader = new FileReader();
    reader.onload = ev => {
      _aiPendingImages.push(ev.target.result);
      renderAiImageStrip();
    };
    reader.readAsDataURL(file);
  });
});

// Support paste images into AI input
r.aiInput?.addEventListener('paste', e => {
  const items = [...(e.clipboardData?.items || [])];
  const imgItem = items.find(i => i.type.startsWith('image/'));
  if (!imgItem) return;
  e.preventDefault();
  const file = imgItem.getAsFile();
  if (!file) return;
  if (_aiPendingImages.length >= 4) { toast('Максимум 4 изображения', 'warning'); return; }
  const reader = new FileReader();
  reader.onload = ev => {
    _aiPendingImages.push(ev.target.result);
    renderAiImageStrip();
    toast('📷 Скриншот прикреплён', 'info', 1500);
  };
  reader.readAsDataURL(file);
});

function renderAiImageStrip() {
  const strip = $('aiImageStrip');
  if (!strip) return;
  if (!_aiPendingImages.length) { strip.classList.add('hidden'); return; }
  strip.classList.remove('hidden');
  strip.innerHTML = '';
  _aiPendingImages.forEach((dataUrl, idx) => {
    const wrap = document.createElement('div');
    wrap.className = 'ai-img-thumb';
    const img = document.createElement('img');
    img.src = dataUrl;
    const del = document.createElement('button');
    del.className = 'ai-img-del';
    del.textContent = '✕';
    del.onclick = () => { _aiPendingImages.splice(idx, 1); renderAiImageStrip(); };
    wrap.appendChild(img);
    wrap.appendChild(del);
    strip.appendChild(wrap);
  });
}

function clearAiImages() {
  _aiPendingImages = [];
  renderAiImageStrip();
}

function truncateForAi(text, max = 2400) {
  const source = String(text || '');
  return source.length > max ? source.slice(0, max) + `\n…[truncated ${source.length - max} chars]` : source;
}

function buildLocaleAiAuditContext() {
  if (!state.namespaces.length) return '';
  const payload = state.namespaces.map(ns => {
    ensureLocaleMeta(ns);
    const diagnostics = collectLocaleAuditDiagnostics(ns);
    const locales = {};
    Object.keys(ns.locales || {}).forEach(code => {
      const raw = ns.localeRaw?.[code] ?? serializeTxt(ns.locales[code] || []);
      const parsed = parseTxtDetailed(raw);
      locales[code] = {
        blockCount: (ns.locales[code] || []).length,
        rawText: truncateForAi(raw, 2200),
        blocks: (ns.locales[code] || []).slice(0, 28),
        parserIssues: parsed.issues.slice(0, 20),
      };
    });
    return {
      namespace: ns.name,
      referenceLocale: getReferenceLocaleCode(ns),
      diagnostics: diagnostics.slice(0, 80),
      locales,
    };
  });
  return [
    'LOCALE AUDIT CONTEXT FROM STUDIO',
    'TXT block format: each copy block is wrapped as {{...}}. Bold/emphasis is @@...@@ inside a block.',
    'Empty {{}} blocks are real blocks: preserve them as empty strings at the same index. Do not drop, renumber, or shift later blocks.',
    'When source emphasis must become HTML, use <b>...</b>, not <strong>...</strong> and not Markdown **...**.',
    'Audit/fix rules: preserve block order, preserve URLs, HTML tags, numbers, placeholders, and @@ markers unless explicitly correcting broken syntax.',
    'If EN has a bold/link split and other locales do not, propose a safe block split or matching <b>/<a> wrapping across locales before applying.',
    'When reporting problems, cite namespace, locale, and block_NN or raw line if available.',
    'If the user asks to fix/apply changes, return full corrected locale TXT documents in fenced blocks with first line exactly: # locale: namespace/code',
    JSON.stringify(payload, null, 2),
  ].join('\n');
}

function requestLocaleAiAudit(ns = null, localeCode = null) {
  if (cmLocale && state._editNsId && state._editLocale) flushLocaleEditorToState();
  const scope = ns
    ? `namespace "${ns.name}"${localeCode ? `, locale ${localeCode.toUpperCase()}` : ''}`
    : 'все загруженные namespaces/locales';
  r.aiDrawer.dataset.state = 'expanded';
  r.aiInput.value = [
    `Проведи аудит переводов: ${scope}.`,
    'Найди конкретные проблемы: незакрытые {{ }}, текст вне блоков, лишние/недостающие блоки относительно EN, съехавшие ссылки/HTML/@@, подозрительно плохие или не те переводы.',
    'Ответь списком: где проблема, почему это проблема, как исправить. Не применяй правки без моего подтверждения.',
  ].join(' ');
  r.aiInput.dispatchEvent(new Event('input'));
  closeMismatchModal();
  sendAiMessage();
}

function normalizeCopyForMatch(text) {
  return String(text || '')
    .replace(/@@/g, '')
    .replace(/\u00a0/g, ' ')
    .replace(/[«»“”"']/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function pickPlaceholderNamespace() {
  if (!state.namespaces.length) return null;
  const withReference = state.namespaces
    .map(ns => ({ ns, code: getReferenceLocaleCode(ns) }))
    .filter(x => x.code && nsHasBlocks(x.ns, x.code));
  return (withReference.sort((a, b) => (b.ns.locales[b.code]?.length || 0) - (a.ns.locales[a.code]?.length || 0))[0] || null);
}

function nsHasBlocks(ns, code) {
  return Array.isArray(ns?.locales?.[code]) && ns.locales[code].length > 0;
}

function replaceVisibleTextWithPlaceholders(html, nsName, blocks) {
  const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
  if (!doc.body) return { html, count: 0, matched: [] };

  const SYS_VAR_RE = /^[A-Za-z][A-Za-z0-9-]*(?:[._][A-Za-z0-9._-]*)+$/;
  const entries = blocks
    .map((block, index) => ({ index, raw: block, norm: normalizeCopyForMatch(block) }))
    .filter(entry => entry.norm.length >= 2)
    // Конвенция: {{embedded.x}} / {{user_name}} — сквозные переменные, в HTML
    // остаются литералом; их нельзя анкерить как текст.
    .filter(entry => !SYS_VAR_RE.test(String(entry.raw || '').trim()))
    .sort((a, b) => b.norm.length - a.norm.length);
  const used = new Set();
  const matched = [];
  const contentSelector = 'p,h1,h2,h3,h4,h5,h6,a,span,li,td,th';
  // ВАЖНО: проверяем контейнеры на ЛЮБОЙ глубине (querySelector), не только
  // прямых детей. Раньше td.center > center > table... проходил как «лист»
  // (center не был в списке) и el.innerHTML = плейсхолдер сносил ВСЁ письмо.
  const containerSelector = 'p,h1,h2,h3,h4,h5,h6,li,td,th,table,tr,div,center';
  const candidates = [...doc.body.querySelectorAll(contentSelector)].filter(el => {
    if (/script|style|noscript/i.test(el.tagName)) return false;
    if (/\$\{\{/.test(el.textContent || '')) return false;
    return !el.querySelector(containerSelector);
  });

  candidates.forEach(el => {
    const norm = normalizeCopyForMatch(el.textContent || '');
    if (!norm) return;
    // Size guard: элемент с гигантским текстом не может быть «одним блоком локали».
    if (norm.length > 1200) return;
    const hit = entries.find(entry => {
      if (used.has(entry.index)) return false;
      if (norm === entry.norm) return true;
      if (entry.norm.length >= 28 && (norm.includes(entry.norm) || entry.norm.includes(norm))) {
        // Containment-матч разрешён только при сопоставимых размерах: элемент,
        // который лишь СОДЕРЖИТ текст блока (например, обёртка всего письма),
        // не должен быть проглочен плейсхолдером.
        const ratio = norm.length / entry.norm.length;
        return ratio > 0.6 && ratio < 1.67;
      }
      return false;
    });
    if (!hit) return;
    used.add(hit.index);
    // Сохранить ссылку, если она оборачивает весь текст блока (legacy-фолбэк).
    const linksL = [...el.querySelectorAll('a')];
    const wrapL = linksL.length === 1
      ? (normalizeCopyForMatch(linksL[0].textContent || '') === hit.norm ? linksL[0] : null)
      : null;
    if (wrapL) {
      const oh = wrapL.outerHTML;
      el.innerHTML = oh.slice(0, oh.indexOf('>') + 1) + PH_STR(nsName, hit.index) + '</a>';
    } else {
      el.innerHTML = PH_STR(nsName, hit.index);
    }
    matched.push({ block: hit.index, text: hit.raw });
  });

  const doctype = String(html || '').match(/^\s*<!doctype[^>]*>/i)?.[0] || '<!DOCTYPE html>';
  return {
    html: `${doctype}\n${doc.documentElement.outerHTML}`,
    count: matched.length,
    matched,
  };
}

// Открывающий/закрывающий теги <a>, обёрнутого вокруг данного текста внутри el.
// Нужно, чтобы при расстановке плейсхолдеров не потерять ссылку: <a href> остаётся,
// а плейсхолдер встаёт ВНУТРЬ неё.
function findLinkWrap(links, text) {
  const want = normalizeCopyForMatch(text);
  if (!want) return null;
  for (const a of links) {
    if (normalizeCopyForMatch(a.textContent || '') === want) {
      const oh = a.outerHTML;
      const open = oh.slice(0, oh.indexOf('>') + 1);
      return { open, close: '</a>' };
    }
  }
  return null;
}

// Умное замещение юнита в элементе:
//  • нет вложенных <a> → плоско ставим unit.replacement (быстрый путь; <b> для
//    жирности схлопывается в плейсхолдер — это норма, @@ восстановит жирность);
//  • есть <a> → реконструируем по частям (unit.parts), сохраняя ссылки: если
//    ссылка оборачивала переменную или кусок текста — оборачиваем плейсхолдер/литерал
//    в тот же <a href>. Так письмо со ссылками в тексте получает плейсхолдеры
//    логично: текст → плейсхолдеры, ссылка остаётся живой.
function applyUnitToElement(el, unit) {
  const links = [...el.querySelectorAll('a')];
  if (!links.length || !Array.isArray(unit.parts) || !unit.parts.length) {
    el.innerHTML = unit.replacement;
    return;
  }
  let html = '';
  for (const part of unit.parts) {
    const wrap = findLinkWrap(links, part.source);
    html += (part.sep || '') + (wrap ? wrap.open + part.token + wrap.close : part.token);
  }
  el.innerHTML = html;
}

// Pure-матчер: анкер-юниты (с сервера /api/wb/locale-normalize) → листовые DOM
// элементы. Юнит «текст + {{переменная}} + хвост» заменяет ВЕСЬ элемент на
// «${{ ns.block_NN }}$ {{переменная}}${{ ns.block_MM }}$» — переменная остаётся
// литералом для платформы рассылки.
function replaceUnitsWithPlaceholders(html, units) {
  const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
  if (!doc.body) return { html, count: 0, matched: [], missed: [] };
  const entries = (units || [])
    .filter(u => u && u.hasText && u.visibleText && u.visibleText.trim().length >= 2)
    .map(u => ({ unit: u, norm: normalizeCopyForMatch(u.visibleText) }))
    .sort((a, b) => b.norm.length - a.norm.length);
  if (!entries.length) return { html, count: 0, matched: [], missed: [] };
  const used = new Set();
  const matched = [];
  const contentSelector = 'p,h1,h2,h3,h4,h5,h6,a,span,li,td,th';
  const containerSelector = 'p,h1,h2,h3,h4,h5,h6,li,td,th,table,tr,div,center';
  const candidates = [...doc.body.querySelectorAll(contentSelector)].filter(el => {
    if (/script|style|noscript/i.test(el.tagName)) return false;
    if (/\$\{\{/.test(el.textContent || '')) return false;
    return !el.querySelector(containerSelector);
  });
  candidates.forEach(el => {
    const norm = normalizeCopyForMatch(el.textContent || '');
    if (!norm || norm.length > 1200) return;
    const hit = entries.find(e => {
      if (used.has(e.unit.unitIndex)) return false;
      if (norm === e.norm) return true;
      if (e.norm.length >= 28 && (norm.includes(e.norm) || e.norm.includes(norm))) {
        const ratio = norm.length / e.norm.length;
        return ratio > 0.6 && ratio < 1.67;
      }
      return false;
    });
    if (!hit) return;
    used.add(hit.unit.unitIndex);
    applyUnitToElement(el, hit.unit);
    matched.push({ unit: hit.unit.unitIndex });
  });
  const doctype = String(html || '').match(/^\s*<!doctype[^>]*>/i)?.[0] || '<!DOCTYPE html>';
  return {
    html: `${doctype}\n${doc.documentElement.outerHTML}`,
    count: matched.length,
    matched,
    missed: entries.filter(e => !used.has(e.unit.unitIndex)).map(e => e.unit.unitIndex),
  };
}

// Zero-AI конвейер «приведи локали в порядок и расставь плейсхолдеры»:
//   1) все локали namespace → нормализация конвенций на сервере (переменные
//      вынесены из блоков, скобки закрыты) — выравнивает нумерацию block_NN;
//   2) reference-локаль → анкер-юниты;
//   3) расстановка юнитов по DOM. Без AI, детерминированно.
async function maybeApplyPlaceholdersFromLocales(userText, bubble) {
  const text = String(userText || '');
  const asksForPlaceholders = /плейс|плэйс|placeholder|токен|namespace/i.test(text)
    && /расстав|подстав|замен|встав|сдел|примен|загруз/i.test(text);
  if (!asksForPlaceholders || !cm || state.srcCtx) return false;
  const picked = pickPlaceholderNamespace();
  if (!picked) return false;

  const currentHtml = cm.getValue();
  if (!currentHtml || !/<body\b/i.test(currentHtml)) return false;

  const ns = picked.ns;
  let units = null;
  let prepReport = {};
  let alignedCount = 0;
  let paddedTotal = 0;
  try {
    ensureLocaleMeta(ns);
    // Один вызов: нормализация конвенций + выравнивание ВСЕХ локалей по
    // reference (одинаковое число блоков, пустые спейсеры) + анкер-юниты.
    const localesPayload = {};
    for (const code of Object.keys(ns.locales || {})) {
      localesPayload[code] = (ns.localeRaw && ns.localeRaw[code]) || serializeTxt(ns.locales[code] || []);
    }
    const res = await fetch('/api/wb/locale-prepare', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ namespace: ns.name, refCode: picked.code, locales: localesPayload }),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const json = await res.json();
    if (json.ok) {
      // Применить выровненные TXT во все локали.
      for (const [code, txt] of Object.entries(json.locales || {})) {
        setLocaleRawContent(ns, code, txt);
      }
      units = Array.isArray(json.units) ? json.units : null;
      prepReport = json.report || {};
      for (const r of Object.values(prepReport)) {
        if (r && r.aligned) { alignedCount += 1; paddedTotal += (r.padded || 0); }
      }
    }
  } catch (err) {
    console.warn('[placeholders] locale-prepare failed, fallback to legacy matcher:', err);
  }

  let result;
  if (units && units.length) {
    result = replaceUnitsWithPlaceholders(currentHtml, units);
  } else {
    const blocks = ns.locales[picked.code] || [];
    result = replaceVisibleTextWithPlaceholders(currentHtml, ns.name, blocks);
  }
  if (!result.count) {
    if (alignedCount) { renderLocalesBar(); validateLocales(); saveToLocalStorage(); }
    return false;
  }

  pushUndoSnapshot('Плейсхолдеры по ' + picked.code.toUpperCase());
  cm.setValue(prettyHtml(result.html));
  updatePreview();
  updateEditorStats();
  renderLocalesBar();
  validateLocales();
  saveToLocalStorage();
  bubble.classList.remove('streaming');
  const missedNote = result.missed && result.missed.length
    ? ` Для ${result.missed.length} блок(ов) не нашёл место в HTML — проверь вручную.` : '';
  const padNote = paddedTotal ? ` Добавил ${paddedTotal} пустых блок(ов)-спейсеров там, где в переводе нет текста.` : '';
  bubble.textContent =
    (alignedCount ? `Выровнял ${alignedCount} локал${alignedCount === 1 ? 'ь' : 'ей'} под ${picked.code.toUpperCase()} (одинаковое число блоков, переменные на местах).${padNote} ` : '')
    + `Расставил ${result.count} плейсхолдеров. Переключи вкладки локалей и проверь превью — жёлтые обводки должны уйти.`
    + missedNote;
  addUndoButton(bubble);
  toast(`Плейсхолдеры: ${result.count}${alignedCount ? ` · выровнено локалей: ${alignedCount}` : ''}`, 'success');
  return true;
}

async function sendAiMessage() {
  const text = r.aiInput.value.trim();
  if (!text || state.aiStreaming) return;
  if (r.aiDrawer.dataset.state==='collapsed') r.aiDrawer.dataset.state='expanded';

  r.aiInput.value = ''; r.aiInput.style.height = '';
  const pendingImgs = [..._aiPendingImages];
  clearAiImages();
  addMessage('user', text, pendingImgs);

  // ─── Agent mode short-circuit ──────────────────────────────────
  // When the user enables the 🤖 Agent toggle, route THIS message
  // through the tool-use agent loop instead of the regular chat.
  // Each tool call is shown live as a separate frame in the chat.
  if (document.getElementById('aiAgentToggle')?.checked) {
    await runAgentChat(text);
    return;
  }

  const bubble = addMessage('assistant');
  if (await maybeApplyPlaceholdersFromLocales(text, bubble)) {
    state.chatHistory.push({ role: 'user', content: text });
    state.chatHistory.push({ role: 'assistant', content: bubble.textContent });
    return;
  }
  bubble.classList.add('streaming');
  state.aiStreaming = true;
  r.aiSendBtn.disabled = true;
  r.aiCancelRow.classList.remove('hidden');
  r.aiHandleLabel.textContent = 'AI думает...';
  state.aiAbortController = new AbortController();

  r.aiCancelBtn.onclick = () => {
    state.aiAbortController.abort();
    bubble.classList.remove('streaming');
    if (!bubble.textContent) bubble.textContent = '(отменено)';
  };

  // Build context with namespace + locale info
  const currentHtml = cm?.getValue() || '';
  const nsInfo = state.namespaces.map(ns => {
    const count = maxBlockCount(ns);
    const codes = Object.keys(ns.locales).join(', ');
    return `${ns.name}(${count} блоков, локали: ${codes})`;
  }).join(' | ');

  const localeContext = state.activeLocale !== 'original'
    ? (() => {
        const blocks = {};
        state.namespaces.forEach(ns => {
          if (ns.locales[state.activeLocale]) blocks[ns.name] = ns.locales[state.activeLocale];
        });
        return JSON.stringify(blocks).slice(0, 3000);
      })()
    : null;
  const localeOpsRequested = /локал|перевод|translate|translation|placeholder|плейс|плэйс|ссыл|link|жирн|bold|<b>|текст|англ|english|en\b|разб|split|блок|namespace/i.test(text);
  const localeAuditRequested = localeOpsRequested && /аудит|audit|провер|валид|ошиб|исправ|почин|чин|правк|редакт|скоб|brace|незакрыт|качество|плох|лев|расхожд|missing|mismatch|fix|подстав|расстав|оберн|wrap|сравн|анализ/i.test(text);
  const localeBundleContext = localeOpsRequested && state.namespaces.length
    ? (localeAuditRequested
      ? buildLocaleAiAuditContext().slice(0, 18000)
      : JSON.stringify(state.namespaces.map(ns => ({
          namespace: ns.name,
          referenceLocale: getReferenceLocaleCode(ns),
          blockCount: maxBlockCount(ns),
          diagnostics: collectLocaleAuditDiagnostics(ns).slice(0, 30),
          locales: ns.locales,
        }))).slice(0, 9000))
    : null;

  state.chatHistory.push({ role:'user', content: text });
  const recentHistory = state.chatHistory.slice(-8);

  // Source context: provide much richer info so AI can actually help
  const srcCtx = state.activeFileId ? null : state.srcCtx;
  const activeFileName = state.files.find(f => f.id===state.activeFileId)?.name;
  const contextNote = [
    srcCtx
      ? `Email: ${srcCtx.brand} / ${srcCtx.mail} | Редактируется: ${srcCtx.activeFile || 'нет'}`
      : (activeFileName ? `File: ${activeFileName}` : 'No HTML file'),
    nsInfo ? `Namespaces: ${nsInfo}` : null,
    state.activeLocale !== 'original' ? `Active locale: ${state.activeLocale}` : null,
    'Placeholder format: ${{namespace.block_N}}$',
    srcCtx ? 'Режим: исходные файлы (Pug+Stylus → скомпилированный HTML)' : null,
  ].filter(Boolean).join(' | ');

  // ── Source editing mode: send Pug/Stylus files to AI as a developer ──
  let pugSourceMode = false;
  let pugSourceFiles = null;

  if (srcCtx && !localeAuditRequested) {
    pugSourceMode = true;
    // Build map of source files to send: active file (from editor) + other key files
    pugSourceFiles = {};

    // Active file = whatever is in the editor right now
    if (srcCtx.activeFile && !srcCtx.viewingCompiledHtml) {
      pugSourceFiles[srcCtx.activeFile] = currentHtml;
    }

    // Also try to include other already-opened files from the server
    // (up to 2 additional files to stay within token limits)
    const otherFiles = (srcCtx.openedFiles || [])
      .filter(p => p !== srcCtx.activeFile)
      .slice(0, 2);

    if (otherFiles.length > 0) {
      try {
        const extraContents = await Promise.all(otherFiles.map(async fp => {
          const r = await fetch(`/api/wb/email-file?brand=${encodeURIComponent(srcCtx.brand)}&mail=${encodeURIComponent(srcCtx.mail)}&file=${encodeURIComponent(fp)}`);
          const d = await r.json();
          return [fp, d.content || ''];
        }));
        extraContents.forEach(([fp, content]) => {
          if (content) pugSourceFiles[fp] = content;
        });
      } catch {}
    }

    // If viewing compiled HTML or no active file, include compiled HTML as reference only
    if (srcCtx.viewingCompiledHtml && srcCtx.compiledHtml) {
      pugSourceFiles['[compiled preview - read only reference]'] = srcCtx.compiledHtml.slice(0, 4000);
    }
  }

  // Always send currentHtml when it exists — the server uses it both for
  // clone-edit (when no srcCtx) and as `baseEmailHtml` for the AI tools
  // dispatcher (placeholderize / fix-locale / translate). Previously we
  // hid it in locale-audit mode and follow-up requests like "now place
  // the placeholders" failed because the server couldn't find any source.
  const htmlForAi = currentHtml && !srcCtx ? currentHtml : null;

  try {
    const res = await fetch('/api/chat/stream', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      signal: state.aiAbortController.signal,
      body: JSON.stringify({
        messages: recentHistory,
        message: text,
        intent: localeAuditRequested ? 'discuss' : undefined,
        brief: {
          contentNotes: [contextNote, localeBundleContext ? `Locale bundle loaded in Studio:\n${localeBundleContext}` : null].filter(Boolean).join('\n\n'),
          goal: localeAuditRequested
            ? 'locale audit and translation QA'
            : (srcCtx
              ? 'edit the currently open email source files in Workbench; if the user mentions locales/placeholders/translations, use loaded TXT namespaces as context and preserve locale independence'
              : 'edit the currently open HTML email in Workbench; use loaded locale TXT blocks when placeholders/translations are requested'),
          localeBlocks: localeContext,
          sourceContext: srcCtx
            ? { brand: srcCtx.brand, mail: srcCtx.mail, activeFile: srcCtx.activeFile }
            : null,
        },
        pugSourceMode,
        localeAuditMode: localeAuditRequested,
        pugSourceFiles: pugSourceMode ? pugSourceFiles : undefined,
        baseEmailHtml: htmlForAi ? htmlForAi.slice(0, 18000) : null,
        // Always include a compact namespaces snapshot so the AI dispatcher
        // (server-side) can act on placeholderize/translate/fix-locale even
        // when the user's wording doesn't trigger localeOpsRequested.
        namespaces: state.namespaces.map(ns => ({
          id: ns.id,
          name: ns.name,
          referenceLocale: getReferenceLocaleCode(ns),
          locales: ns.locales || {},
          localeRaw: ns.localeRaw || {},
        })),
        // Hint to the server-side dispatcher which namespace the user is
        // currently focused on (active tab). When set, pickRelevantNamespace
        // uses it directly instead of guessing by block count / utility filter.
        activeNamespaceId: state.activeNamespaceId || null,
        activeNamespaceName: (() => {
          const id = state.activeNamespaceId;
          if (!id) return null;
          const ns = state.namespaces.find(n => n.id === id);
          return ns ? ns.name : null;
        })(),
        activeLocale: state.activeLocale || 'original',
        // Vision: first attached image (server reads screenshotUrl / dataUrl)
        ...(pendingImgs.length ? { screenshotUrl: pendingImgs[0], dataUrl: pendingImgs[0] } : {}),
      }),
    });

    if (!res.ok) throw new Error(`Server error ${res.status}`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf='', fullText='';

    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      buf += decoder.decode(value, {stream:true});
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const frame = JSON.parse(trimmed);
          if (frame.type==='assistant_delta' && frame.delta) {
            fullText += frame.delta;
            bubble.textContent = fullText;
            r.aiMessages.scrollTop = r.aiMessages.scrollHeight;
          } else if (frame.type==='final' && frame.payload) {
            const reply = frame.payload.assistantReply || '';
            if (reply.length > fullText.length) { fullText=reply; bubble.textContent=fullText; }
            if (frame.payload.tokenUsage) updateTokenDisplay(frame.payload.tokenUsage);
            // ── New: AI-tool dispatcher result (placeholderize / translate / fix-locale)
            // Server returns { mode: 'ai-tool', aiToolResult: { editorHtml?, localeUpdates? } }
            // Apply editorHtml directly to the editor and localeUpdates to the namespace store.
            const tool = frame.payload.aiToolResult;
            if (tool && typeof tool === 'object') {
              try { applyAiToolResult(tool, bubble); } catch (err) { console.warn('[AI] applyAiToolResult failed', err); }
            }
            // Auto-apply modified HTML from clone-edit mode
            const modHtml = frame.payload.draft?.html
                         || frame.payload.draft?.modifiedHtml
                         || frame.payload.modifiedHtml;
            console.log('[AI] final payload keys:', Object.keys(frame.payload), 'draft keys:', frame.payload.draft ? Object.keys(frame.payload.draft) : 'no draft', 'modHtml len:', modHtml?.length ?? 0);
            if (modHtml && modHtml.trim().length > 50 && modHtml.includes('<')) {
              _pendingAiModifiedHtml = modHtml;
            }
          }
        } catch {}
      }
    }

    bubble.classList.remove('streaming');
    if (fullText) state.chatHistory.push({role:'assistant', content:fullText});

    // Offer to apply: first try code blocks in text, then server-returned modifiedHtml
    if (!offerHtmlApply(bubble, fullText) && _pendingAiModifiedHtml) {
      offerModifiedHtmlApply(bubble, _pendingAiModifiedHtml);
    }
    _pendingAiModifiedHtml = null;

  } catch(err) {
    bubble.classList.remove('streaming');
    if (err.name!=='AbortError')
      bubble.innerHTML = `<span style="color:var(--danger)">⚠ ${escapeHtml(err.message)}</span>`;
  } finally {
    state.aiStreaming = false;
    state.aiAbortController = null;
    r.aiSendBtn.disabled = false;
    r.aiCancelRow.classList.add('hidden');
    r.aiHandleLabel.textContent = 'Спросить AI...';
    refreshAiStatus();
  }
}


// Apply chat-side AI-tool dispatcher result. Updates editor HTML and locale TXTs in place.
function applyAiToolResult(tool, bubble) {
  let didSomething = false;
  if (typeof tool.editorHtml === 'string' && tool.editorHtml.trim().length > 50) {
    if (state.srcCtx && !state.srcCtx.viewingCompiledHtml) {
      state.srcCtx.compiledHtml = tool.editorHtml;
      try { updatePreview(); } catch {}
      didSomething = true;
    } else if (cm) {
      // Use replaceRange instead of setValue to preserve mode + overlays
      // (placeholder ph-overlay highlight) and keep undo history clean.
      const lastLine = cm.lastLine();
      const lastCh = cm.getLine(lastLine)?.length ?? 0;
      cm.operation(() => {
        cm.replaceRange(tool.editorHtml, { line: 0, ch: 0 }, { line: lastLine, ch: lastCh });
      });
      // Force CM to re-render highlights/overlay after a large change.
      try { cm.refresh(); } catch {}
      try { updatePreview(); } catch {}
      didSomething = true;
    }
  }
  if (Array.isArray(tool.localeUpdates) && tool.localeUpdates.length) {
    let touched = 0;
    let lastCode = null;
    let rejected = 0;
    for (const u of tool.localeUpdates) {
      if (!u || !u.code || !u.txt) continue;
      // GUARD: refuse to write a locale that contains literal ${{...}}$ tokens
      // INSIDE block bodies. That's a hallucination — placeholders belong in
      // the HTML, not in the locale TXT. Reject without applying.
      if (/\{\{\s*\$\{\{|\$\{\{[\s\S]*?\}\}\$/.test(u.txt)) {
        rejected += 1;
        console.warn('[AI] locale update rejected — contains literal ${{ }} tokens:', u.code);
        continue;
      }
      const ns = (state.namespaces || []).find(n => n.name === u.namespace) || state.namespaces?.[0];
      if (!ns) continue;
      try {
        setLocaleRawContent(ns, u.code, u.txt);
        touched += 1;
        lastCode = u.code;
      } catch (err) {
        console.warn('[AI] setLocaleRawContent failed', u.code, err);
      }
    }
    if (rejected) {
      toast(`AI вернул мусор в ${rejected} локалях (${'${{'} '}-токены внутри переводов) — не применил.`, 'warning', 4500);
    }
    if (touched) {
      try { renderLocalesBar(); } catch {}
      if (lastCode) { try { activateLocale(lastCode); } catch {} }
      didSomething = true;
    }
  }
  if (Array.isArray(tool.localeDeletes) && tool.localeDeletes.length) {
    for (const del of tool.localeDeletes) {
      if (del && del.namespace && del.locale && deleteLocaleInNamespace(del.namespace, del.locale)) {
        didSomething = true;
      }
    }
  }
  if (didSomething && bubble) {
    const mark = document.createElement('div');
    mark.style.cssText = 'margin-top:6px;font-size:11px;color:#16a34a;font-weight:600;';
    mark.textContent = '✓ AI применил изменения автоматически';
    bubble.appendChild(mark);
  }
}

let _pendingAiModifiedHtml = null;

function currentHtmlForAiGuard() {
  if (state.srcCtx?.compiledHtml) return state.srcCtx.compiledHtml;
  return cm?.getValue?.() || '';
}

function htmlBodyStats(html) {
  const source = String(html || '');
  let bodyHtml = '';
  let bodyText = '';
  let elementCount = 0;
  try {
    const doc = new DOMParser().parseFromString(source, 'text/html');
    bodyHtml = doc.body?.innerHTML?.trim() || '';
    bodyText = (doc.body?.textContent || '').replace(/\s+/g, ' ').trim();
    elementCount = doc.body?.querySelectorAll('*')?.length || 0;
  } catch {
    const m = source.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
    bodyHtml = (m?.[1] || '').trim();
    bodyText = bodyHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    elementCount = (bodyHtml.match(/<[^/!][^>]*>/g) || []).length;
  }
  return { bodyHtml, bodyText, elementCount, length: source.length };
}

function inspectAiHtmlCandidate(candidate, baseline = currentHtmlForAiGuard()) {
  const html = String(candidate || '').trim();
  const base = String(baseline || '').trim();
  if (!/<body\b/i.test(html)) {
    return { ok: false, reason: 'AI вернул HTML без <body>; применение остановлено.' };
  }
  if (/<body\b[^>]*>\s*<\/body>/i.test(html)) {
    return { ok: false, reason: 'AI вернул пустой <body>; применение остановлено.' };
  }

  const next = htmlBodyStats(html);
  const prev = htmlBodyStats(base);
  if (!next.bodyHtml || (next.bodyText.length < 10 && next.elementCount < 3)) {
    return { ok: false, reason: 'В новом HTML почти нет содержимого письма.' };
  }
  if (prev.bodyText.length > 250 && next.bodyText.length < prev.bodyText.length * 0.35) {
    return { ok: false, reason: 'AI удалил большую часть текста письма; применение остановлено.' };
  }
  if (base.length > 1200 && html.length < base.length * 0.35) {
    return { ok: false, reason: 'AI вернул слишком короткий HTML относительно исходника.' };
  }
  return { ok: true };
}

function appendAiGuardWarning(bubble, reason) {
  if (bubble?.parentElement?.querySelector('.ai-apply-warning')) return;
  const note = document.createElement('div');
  note.className = 'ai-apply-warning';
  note.style.cssText = 'margin-top:8px;padding:7px 9px;border:1px solid rgba(245,158,11,.35);border-radius:6px;background:rgba(245,158,11,.1);color:var(--warning);font-size:12px;line-height:1.35';
  note.textContent = `${reason} Я не показываю кнопку применения, чтобы не сломать письмо. Попроси AI вернуть полный HTML или точечный diff.`;
  bubble.after(note);
}

// Apply the server-returned full modified HTML (from clone-edit mode)
function offerModifiedHtmlApply(bubble, modifiedHtml) {
  const guard = inspectAiHtmlCandidate(modifiedHtml);
  if (!guard.ok) {
    appendAiGuardWarning(bubble, guard.reason);
    return false;
  }
  const ctx = state.srcCtx;
  const btn = document.createElement('button');
  btn.className = 'btn-primary';
  btn.style.cssText = 'margin-top:8px;font-size:12px;padding:5px 14px;display:block;background:var(--success)';

  if (ctx) {
    // In source context: update compiled HTML preview
    btn.textContent = '✓ Применить к предпросмотру письма';
    btn.onclick = () => {
      btn.disabled = true;
      pushUndoSnapshot('AI HTML');
      ctx.compiledHtml = modifiedHtml;
      updatePreview();
      // If currently viewing compiled HTML, refresh it
      if (ctx.viewingCompiledHtml) {
        _suppressSrcModified = true;
        cm?.setValue(prettyHtml(modifiedHtml));
        setTimeout(() => { _suppressSrcModified = false; }, 0);
      }
      btn.textContent = '✓ Предпросмотр обновлён';
      addUndoButton(btn);
      toast('AI обновил предпросмотр письма', 'success');
    };
  } else {
    // Plain HTML mode: apply directly to editor
    btn.textContent = '✓ Применить HTML в редактор';
    btn.onclick = () => {
      if (!cm) return;
      pushUndoSnapshot('AI HTML');
      cm.setValue(prettyHtml(modifiedHtml));
      updatePreview(); saveToLocalStorage();
      btn.textContent = '✓ Применено'; btn.disabled = true;
      addUndoButton(btn);
      toast('HTML обновлён из ответа AI', 'success');
    };
  }
  bubble.after(btn);
  return true;
}

function sourceFenceMatchesPath(lang, filePath) {
  const ext = (filePath.split('.').pop() || '').toLowerCase();
  const normalized = String(lang || '').toLowerCase();
  if (!normalized) return true;
  if (['pug', 'jade'].includes(normalized)) return ['pug', 'jade'].includes(ext);
  if (['styl', 'stylus', 'css'].includes(normalized)) return ['styl', 'css'].includes(ext);
  return false;
}

function parseAiSourceFileEdits(text) {
  const ctx = state.activeFileId ? null : state.srcCtx;
  if (!ctx || !text) return [];

  const knownPaths = new Set((ctx.files || []).map(f => f.path));
  const editsByPath = new Map();
  const fenceRe = /```([a-zA-Z0-9_-]*)\s*\n([\s\S]*?)```/g;
  let match;

  while ((match = fenceRe.exec(text))) {
    const lang = (match[1] || '').toLowerCase();
    let content = match[2].replace(/\s+$/g, '');
    if (content.length < 20) continue;

    const lines = content.split('\n');
    let filePath = '';
    const first = lines[0] || '';
    const marker = first.match(/^\s*(?:(?:\/\/-?|#)\s*)?(?:file|path)\s*:\s*["'`]?([^"'`]+?)["'`]?\s*$/i)
      || first.match(/^\s*={3,}\s*([^=]+?\.(?:pug|jade|styl|css))\s*={3,}\s*$/i);
    if (marker) {
      filePath = marker[1].trim().replace(/^app\//, '');
      content = lines.slice(1).join('\n').replace(/\s+$/g, '');
    } else if (ctx.activeFile && sourceFenceMatchesPath(lang, ctx.activeFile)) {
      filePath = ctx.activeFile;
    }

    if (filePath && !knownPaths.has(filePath)) {
      const suffixMatches = [...knownPaths].filter(p => p.endsWith('/' + filePath) || p.endsWith(filePath));
      if (suffixMatches.length === 1) filePath = suffixMatches[0];
    }
    if (!filePath || !knownPaths.has(filePath) || !sourceFenceMatchesPath(lang, filePath)) continue;
    editsByPath.set(filePath, { path: filePath, content });
  }

  return [...editsByPath.values()];
}

function offerSourceFileEditsApply(bubble, edits) {
  const ctx = state.srcCtx;
  if (!ctx || !edits.length) return false;

  const btn = document.createElement('button');
  btn.className = 'btn-primary';
  btn.style.cssText = 'margin-top:8px;font-size:12px;padding:5px 14px;display:block;background:var(--success)';
  btn.textContent = edits.length === 1
    ? `✓ Применить ${edits[0].path}`
    : `✓ Применить ${edits.length} файла и пересобрать`;

  btn.onclick = async () => {
    btn.disabled = true;
    btn.textContent = 'Сохраняю файлы…';
    pushUndoSnapshot('AI source files');
    try {
      for (const edit of edits) {
        const res = await fetch('/api/wb/email-file', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ brand: ctx.brand, mail: ctx.mail, file: edit.path, content: edit.content }),
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error || `Не удалось сохранить ${edit.path}`);
        if (!ctx.openedFiles) ctx.openedFiles = [];
        if (!ctx.openedFiles.includes(edit.path)) ctx.openedFiles.push(edit.path);
      }

      const visibleEdit = edits.find(edit => edit.path === ctx.activeFile) || edits[0];
      ctx.activeFile = visibleEdit.path;
      ctx.modified = false;
      ctx.viewingCompiledHtml = false;
      state.activeFileId = null;
      if (cm) {
        const ext = visibleEdit.path.split('.').pop().toLowerCase();
        _suppressSrcModified = true;
        cm.setOption('readOnly', false);
        cm.setValue(visibleEdit.content);
        cm.setOption('mode', EXT_MODE[ext] || 'htmlmixed');
        setTimeout(() => { _suppressSrcModified = false; }, 0);
      }
      renderSrcFileTabs();
      saveToLocalStorage();

      btn.textContent = 'Собираю письмо…';
      await rebuildSourceEmail();
      btn.textContent = '✓ Применено и пересобрано';
      addUndoButton(btn, 'Откатить состояние редактора');
      toast(`AI применил ${edits.length} файл(а)`, 'success');
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'Повторить применение';
      toast('Ошибка применения AI-правок: ' + err.message, 'error');
    }
  };

  bubble.after(btn);
  return true;
}

function parseAiLocaleEdits(text) {
  if (!text || !state.namespaces.length) return [];
  const nsByName = new Map(state.namespaces.map(ns => [ns.name, ns]));
  const edits = [];
  const fenceRe = /```(?:txt|text|locale|locales)?\s*\n([\s\S]*?)```/gi;
  let match;
  while ((match = fenceRe.exec(text))) {
    const rawFence = match[1].replace(/\s+$/g, '');
    const lines = rawFence.split('\n');
    const first = lines[0] || '';
    const marker = first.match(/^\s*(?:#|\/\/)?\s*locale\s*:\s*([^/\s]+)\s*\/\s*([a-z]{2}(?:[-_][a-z]{2,3})?)\s*$/i);
    if (!marker) continue;
    const nsName = marker[1].trim();
    const code = marker[2].toLowerCase();
    const ns = nsByName.get(nsName);
    if (!ns) continue;
    const rawText = lines.slice(1).join('\n').trim();
    if (!rawText || rawText.length < 4) continue;
    edits.push({ nsId: ns.id, namespace: ns.name, code, rawText, parsed: parseTxtDetailed(rawText) });
  }
  return edits;
}

function offerLocaleEditsApply(bubble, edits) {
  if (!edits.length) return false;
  const btn = document.createElement('button');
  btn.className = 'btn-primary';
  btn.style.cssText = 'margin-top:8px;font-size:12px;padding:5px 14px;display:block;background:var(--success)';
  btn.textContent = edits.length === 1
    ? `✓ Применить локаль ${edits[0].namespace}/${edits[0].code.toUpperCase()}`
    : `✓ Применить ${edits.length} локалей`;

  btn.onclick = () => {
    btn.disabled = true;
    pushUndoSnapshot('AI локали');
    edits.forEach(edit => {
      const ns = getNs(edit.nsId);
      if (!ns) return;
      setLocaleRawContent(ns, edit.code, edit.rawText);
    });
    refreshLocaleUiAfterStructureChange();
    if (state._editNsId && state._editLocale) loadLocaleIntoLocaleCM(state._editNsId, state._editLocale);
    btn.textContent = '✓ Локали применены';
    addUndoButton(btn);
    toast(`AI применил ${edits.length} локаль(и)`, 'success');
  };

  bubble.after(btn);
  return true;
}

function offerHtmlApply(bubble, text) {
  const localeEdits = parseAiLocaleEdits(text);
  if (localeEdits.length && offerLocaleEditsApply(bubble, localeEdits)) return true;

  const sourceEdits = parseAiSourceFileEdits(text);
  if (sourceEdits.length && offerSourceFileEditsApply(bubble, sourceEdits)) return true;

  // Try to find code blocks (html, pug, css, or generic)
  const htmlMatch = text.match(/```(?:html)?\n([\s\S]*?)```/i);
  const pugMatch  = text.match(/```(?:pug|jade)\n([\s\S]*?)```/i);
  const stylMatch = text.match(/```(?:styl|stylus|css)\n([\s\S]*?)```/i);

  const match = pugMatch || stylMatch || htmlMatch;
  if (!match) return false;
  const candidate = match[1].trim();
  if (candidate.length < 20) return false;

  const isPug  = Boolean(pugMatch);
  const isStyl = Boolean(stylMatch);
  const isHtml = !isPug && !isStyl && candidate.includes('<');

  const ctx = state.srcCtx;

  const btn = document.createElement('button');
  btn.className = 'btn-primary';
  btn.style.cssText = 'margin-top:8px;font-size:12px;padding:5px 14px;display:block';

  if (isPug && ctx?.activeFile?.match(/\.(pug|jade)$/)) {
    btn.textContent = '✓ Применить в Pug файл';
    btn.onclick = async () => {
      btn.disabled = true; btn.textContent = 'Сохраняю…';
      _suppressSrcModified = true;
      cm?.setValue(candidate);
      setTimeout(() => { _suppressSrcModified = false; }, 0);
      try { await saveCurrentSourceFile(); await rebuildSourceEmail(); } catch {}
      btn.textContent = '✓ Применено и пересобрано';
      toast('Pug обновлён из ответа AI', 'success');
    };
  } else if (isStyl && ctx?.activeFile?.match(/\.(styl|css)$/)) {
    btn.textContent = '✓ Применить в Stylus файл';
    btn.onclick = async () => {
      btn.disabled = true; btn.textContent = 'Сохраняю…';
      _suppressSrcModified = true;
      cm?.setValue(candidate);
      setTimeout(() => { _suppressSrcModified = false; }, 0);
      try { await saveCurrentSourceFile(); await rebuildSourceEmail(); } catch {}
      btn.textContent = '✓ Применено и пересобрано';
      toast('Stylus обновлён из ответа AI', 'success');
    };
  } else if (isHtml) {
    const guard = inspectAiHtmlCandidate(candidate);
    if (!guard.ok) {
      appendAiGuardWarning(bubble, guard.reason);
      return false;
    }
    btn.textContent = '✓ Применить HTML в редактор';
    btn.onclick = () => {
      if (!cm) return;
      pushUndoSnapshot('AI HTML');
      cm.setValue(candidate);
      updatePreview(); saveToLocalStorage();
      btn.textContent = '✓ Применено'; btn.disabled = true;
      addUndoButton(btn);
      toast('HTML обновлён из ответа AI', 'success');
    };
  } else {
    return false; // unknown type, don't show button
  }

  bubble.after(btn);
  return true;
}

// ═══════════════════════════════════════════════════════════════
// AI STATUS & SETTINGS
// ═══════════════════════════════════════════════════════════════

async function refreshAiStatus() {
  try {
    const res = await fetch('/api/status', {signal: AbortSignal.timeout(5000)});
    if (!res.ok) throw new Error('bad');
    const data = await res.json();
    const ok = !!(data.openAiConfigured || data.openAiApiKey || data.hasOpenAiKey || data.status==='ok');
    r.aiDot.dataset.state = ok ? 'connected' : 'error';
    if (r.aiKeyStatus)   r.aiKeyStatus.textContent   = ok ? '✅ Подключён' : '❌ Нет ключа';
    if (r.aiModelStatus) r.aiModelStatus.textContent = data.cloneEditModel || data.model || '—';
    if (data.tokenUsage) updateTokenDisplay(data.tokenUsage);
  } catch {
    r.aiDot.dataset.state = 'error';
    if (r.aiKeyStatus) r.aiKeyStatus.textContent = '❌ Сервер недоступен';
  }
}

function updateTokenDisplay(usage) {
  if (!usage) return;
  const total = usage.totalTokens||0, calls = usage.calls||0;
  if (calls > 0) {
    r.aiTokenCounter.textContent = `🪙 ${total>=1000?(total/1000).toFixed(1)+'k':total} · ${calls} req`;
    r.aiTokenCounter.hidden = false;
  }
  if (r.aiTokenStatus) r.aiTokenStatus.textContent = `${total.toLocaleString()} (${calls} запросов)`;
}

r.aiSettingsBtn.addEventListener('click', () => {
  r.aiSettingsModal.classList.remove('hidden');
  r.aiSettingsBackdrop.classList.remove('hidden');
  refreshAiStatus();
});
r.closeAiSettingsBtn.addEventListener('click', () => {
  r.aiSettingsModal.classList.add('hidden'); r.aiSettingsBackdrop.classList.add('hidden');
});
r.aiSettingsBackdrop.addEventListener('click', () => {
  r.aiSettingsModal.classList.add('hidden'); r.aiSettingsBackdrop.classList.add('hidden');
});

r.validationClose.addEventListener('click', () => r.validationBar.classList.add('hidden'));

// ═══════════════════════════════════════════════════════════════
// TOAST
// ═══════════════════════════════════════════════════════════════

function toast(msg, type='info', ms=3000) {
  const icons = {success:'✅',error:'❌',warning:'⚠️',info:'ℹ️'};
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span>${icons[type]||'ℹ️'}</span><span>${escapeHtml(msg)}</span>`;
  r.toastContainer.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity 300ms'; el.style.opacity = '0';
    setTimeout(() => el.remove(), 310);
  }, ms);
}

// ═══════════════════════════════════════════════════════════════
// DRAG & DROP + PASTE
// ═══════════════════════════════════════════════════════════════

document.addEventListener('dragover', e => e.preventDefault());
document.addEventListener('drop', e => {
  e.preventDefault();

  // ── Images dropped on AI drawer → attach to chat ──────────────
  if (e.target.closest('#aiDrawer, #aiMessages, #aiInput, #aiImageStrip')) {
    const imgFiles = [...e.dataTransfer.files].filter(f => f.type.startsWith('image/'));
    if (imgFiles.length) {
      imgFiles.forEach(file => {
        if (_aiPendingImages.length >= 4) { toast('Максимум 4 изображения', 'warning'); return; }
        const reader = new FileReader();
        reader.onload = ev => {
          _aiPendingImages.push(ev.target.result);
          renderAiImageStrip();
          // Expand drawer if collapsed
          if (r.aiDrawer.dataset.state !== 'expanded') r.aiDrawer.dataset.state = 'expanded';
        };
        reader.readAsDataURL(file);
      });
      toast(`📷 ${imgFiles.length > 1 ? imgFiles.length + ' изображений' : 'Изображение'} прикреплено`, 'info', 1500);
      return;
    }
  }

  const htmlFiles = [...e.dataTransfer.files].filter(f => /\.html?$/i.test(f.name));
  const txtFiles  = [...e.dataTransfer.files].filter(f => /\.txt$/i.test(f.name));
  if (htmlFiles.length) openFiles(htmlFiles);
  if (txtFiles.length)  importFilesIntoNamespace(txtFiles, 'dropped');
});

// ─── AI drawer drag-over highlight ───────────────────────────────
r.aiDrawer?.addEventListener('dragover', e => {
  const hasImages = [...(e.dataTransfer.types || [])].some(t => t === 'Files');
  if (hasImages) {
    e.preventDefault();
    r.aiDrawer.classList.add('ai-drop-active');
  }
});
r.aiDrawer?.addEventListener('dragleave', e => {
  if (!r.aiDrawer.contains(e.relatedTarget)) {
    r.aiDrawer.classList.remove('ai-drop-active');
  }
});
r.aiDrawer?.addEventListener('drop', () => {
  r.aiDrawer.classList.remove('ai-drop-active');
});

document.addEventListener('paste', e => {
  if (e.target.closest('#aiInput, .ai-drawer, #localeCmWrap')) return;
  if (state.activeFileId) return;
  const html = e.clipboardData.getData('text/html') || e.clipboardData.getData('text/plain');
  if (html && html.includes('<') && html.length > 100) {
    e.preventDefault();
    const id = `paste-${uid()}`;
    const fo = { id, name:'pasted.html', html };
    state.files.push(fo);
    renderFileTab(fo); activateFile(id); saveToLocalStorage();
  }
});

// ═══════════════════════════════════════════════════════════════
// LOCALSTORAGE PERSISTENCE
// ═══════════════════════════════════════════════════════════════

function saveToLocalStorage() {
  try {
    if (state.activeFileId && cm) {
      const f = state.files.find(f => f.id === state.activeFileId);
      if (f) f.html = cm.getValue();
    }
    localStorage.setItem(LS_FILES,      JSON.stringify(state.files));
    localStorage.setItem(LS_ACTIVE_FILE, state.activeFileId || '');
    localStorage.setItem(LS_NAMESPACES, JSON.stringify((state.namespaces || []).filter(n => !n.builtin)));
    localStorage.setItem(LS_BRANDS,     JSON.stringify({ brands: state.brands, activeBrandId: state.activeBrandId }));
    // Save current email source context (brand/mail/opened files)
    if (state.srcCtx) {
      localStorage.setItem(LS_SRC_CTX, JSON.stringify({
        brand: state.srcCtx.brand, mail: state.srcCtx.mail,
        openedFiles: state.srcCtx.openedFiles, activeFile: state.srcCtx.activeFile,
      }));
    } else {
      localStorage.removeItem(LS_SRC_CTX);
    }
  } catch(e) { console.warn('localStorage save failed:', e); }
}

function loadFromLocalStorage() {
  try {
    const sf = localStorage.getItem(LS_FILES);
    if (sf) state.files = JSON.parse(sf) || [];
    const activeFileId = localStorage.getItem(LS_ACTIVE_FILE);
    if (activeFileId && state.files.some(f => f.id === activeFileId)) {
      state.activeFileId = activeFileId;
    }
    const sn = localStorage.getItem(LS_NAMESPACES);
    if (sn) {
      state.namespaces = JSON.parse(sn) || [];
      // Diagnostics — flag broken saves at boot. Helps catch the
      // "namespace persists but locale tabs empty" bug.
      for (const ns of state.namespaces) {
        if (!ns.locales || typeof ns.locales !== 'object' || !Object.keys(ns.locales).length) {
          const rawKeys = ns.localeRaw ? Object.keys(ns.localeRaw).length : 0;
          console.warn(`[load] namespace "${ns.name}" loaded with empty/missing locales (localeRaw keys: ${rawKeys}) — will try to rebuild on render`);
        }
      }
    }
    const sb = localStorage.getItem(LS_BRANDS);
    if (sb) {
      const parsed = JSON.parse(sb);
      state.brands       = parsed.brands       || [];
      state.activeBrandId= parsed.activeBrandId|| null;
    }
  } catch(e) { console.warn('localStorage load failed:', e); }
}

function restoreUiFromState() {
  if (state.files.length) {
    r.fileTabs.querySelector('[data-file-id="__empty__"]')?.remove();
    state.files.forEach(fo => renderFileTab(fo));
    const activeId = state.activeFileId && state.files.some(f => f.id === state.activeFileId)
      ? state.activeFileId
      : state.files[state.files.length - 1].id;
    activateFile(activeId);
  }
  if (state.namespaces.length) {
    renderLocalesBar();
    renderNamespaceBar();
    validateLocales();
  }
  activateLocale('original');
  // Restore brand badge
  if (state.activeBrandId && r.previewBrandBadge) {
    const b = state.brands.find(x => x.id === state.activeBrandId);
    if (b) {
      r.previewBrandBadge.textContent = b.name;
      r.previewBrandBadge.classList.remove('hidden');
    }
  }
  const restoreSplit = localStorage.getItem(LS_CODE_SPLIT_ACTIVE) === '1';
  splitState.active = restoreSplit;
  r.etypeSplitBtn?.classList.toggle('split-active', restoreSplit);
  r.cmWrapSplit?.classList.toggle('hidden', !restoreSplit);
  r.cmSplitDivider?.classList.toggle('hidden', !restoreSplit);
  r.editorBody?.classList.toggle('split-mode', restoreSplit);
  if (restoreSplit) {
    initCmSplit();
    if (!state.srcCtx && cmSplit && cm) {
      cmSplit.setValue(cm.getValue());
      cmSplit.setOption('mode', cm.getOption('mode'));
      splitState.rightFile = state.activeFileId ? { kind: 'plain', id: state.activeFileId } : null;
      if (r.cmSplitLabel) r.cmSplitLabel.textContent = 'Копия';
    }
    renderSplitPaneControls();
    setTimeout(() => { restoreCodeSplitRatio(); cm?.refresh(); cmSplit?.refresh(); }, 50);
  } else {
    if (r.cmWrap)      r.cmWrap.style.flex = '';
    if (r.cmWrapSplit) r.cmWrapSplit.style.flex = '';
    renderSplitPaneControls();
  }

  // Restore email source context (re-open letter from base)
  try {
    const savedCtx = localStorage.getItem(LS_SRC_CTX);
    if (savedCtx) {
      const { brand, mail, openedFiles, activeFile } = JSON.parse(savedCtx);
      if (brand && mail) {
        // Re-open the email context in background
        setTimeout(() => {
          openSourceContext(brand, mail).then(() => {
            // Restore active file if it was a source file
            if (activeFile && state.srcCtx) {
              loadSourceFile(activeFile);
            }
          }).catch(() => {});
        }, 200);
      }
    }
  } catch {}
}

// ═══════════════════════════════════════════════════════════════
// FIND & REPLACE
// ═══════════════════════════════════════════════════════════════

let _findMarks   = [];
let _findMatches = [];
let _findIdx     = -1;
let _findCm      = null;

function getFindCm() {
  if (_findCm) return _findCm;
  _findCm = getFocusedCodeMirror() || getActiveCm() || cm;
  return _findCm;
}

function openFindBar(targetCm, opts = {}) {
  const bar = $('findBar');
  if (!bar) return;
  _findCm = targetCm || getFocusedCodeMirror() || getActiveCm() || cm;
  bar.classList.remove('hidden');
  bar.classList.toggle('find-floating', isFullscreenOpen());
  const inp = $('findInput');
  const repl = $('replaceInput');
  // Pre-fill with selection if any
  if (_findCm) {
    const sel = _findCm.getSelection();
    if (sel && sel.length < 200) { inp.value = sel; doFindAll(sel); }
    else if (inp?.value) doFindAll(inp.value);
  }
  const focusEl = opts.focusReplace ? repl : inp;
  focusEl?.focus();
  focusEl?.select();
}

function closeFindBar() {
  const bar = $('findBar');
  bar?.classList.add('hidden');
  bar?.classList.remove('find-floating');
  clearFindHighlights();
  _findMatches = []; _findIdx = -1;
  _findCm = null;
  updateFindCount();
}

function clearFindHighlights() {
  _findMarks.forEach(m => { try { m.clear(); } catch {} });
  _findMarks = [];
}

function doFindAll(query) {
  clearFindHighlights();
  _findMatches = []; _findIdx = -1;
  const editor = getFindCm();
  if (!editor || !query) { updateFindCount(); return; }
  try {
    // Use cm.operation() to batch all DOM updates in one pass (prevents freeze)
    editor.operation(() => {
      const cur = editor.getSearchCursor(query, CodeMirror.Pos(0, 0), { caseFold: true });
      const tmpMarks = [];
      while (cur.findNext()) {
        tmpMarks.push({ from: cur.from(), to: cur.to() });
        if (tmpMarks.length > 2000) break; // safety limit
      }
      tmpMarks.forEach(m => {
        const mark = editor.markText(m.from, m.to, { className: 'find-highlight' });
        _findMarks.push(mark);
        _findMatches.push({ from: m.from, to: m.to, mark });
      });
    });
  } catch {}
  if (_findMatches.length) { _findIdx = 0; scrollToMatch(0, true); }
  updateFindCount();
}

const _debouncedDoFindAll = debounce(doFindAll, 200);

function scrollToMatch(idx, center = false) {
  if (!_findMatches[idx]) return;
  const editor = getFindCm();
  if (!editor) return;
  const m = _findMatches[idx];
  // Remove old "active" mark, re-add with active class
  _findMarks.forEach(mk => { try { mk.clear(); } catch {} });
  _findMarks = [];
  _findMatches.forEach((match, i) => {
    const mk = editor.markText(match.from, match.to, {
      className: i === idx ? 'find-highlight find-active' : 'find-highlight',
    });
    _findMarks.push(mk);
    match.mark = mk;
  });
  editor.scrollIntoView({ from: m.from, to: m.to }, center ? 100 : 40);
  editor.setCursor(m.to);
}

function updateFindCount() {
  const el = $('findCount');
  if (!el) return;
  if (_findMatches.length === 0) {
    el.textContent = $('findInput')?.value ? '0 совпадений' : '';
    el.style.color = $('findInput')?.value ? '#f87171' : 'var(--text-3)';
  } else {
    el.textContent = `${_findIdx + 1} / ${_findMatches.length}`;
    el.style.color = 'var(--text-3)';
  }
}

$('findInput')?.addEventListener('input', e => _debouncedDoFindAll(e.target.value));
$('findInput')?.addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); e.shiftKey ? findPrev() : findNext(); }
  if (e.key === 'Escape') closeFindBar();
});
$('replaceInput')?.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeFindBar();
});

function findNext() {
  if (!_findMatches.length) return;
  _findIdx = (_findIdx + 1) % _findMatches.length;
  scrollToMatch(_findIdx);
  updateFindCount();
}
function findPrev() {
  if (!_findMatches.length) return;
  _findIdx = (_findIdx - 1 + _findMatches.length) % _findMatches.length;
  scrollToMatch(_findIdx);
  updateFindCount();
}

$('findPrevBtn')?.addEventListener('click', findPrev);
$('findNextBtn')?.addEventListener('click', findNext);

$('replaceOneBtn')?.addEventListener('click', () => {
  const editor = getFindCm();
  if (!editor || _findIdx < 0 || !_findMatches[_findIdx]) return;
  const m = _findMatches[_findIdx];
  const repl = $('replaceInput')?.value || '';
  editor.replaceRange(repl, m.from, m.to);
  doFindAll($('findInput')?.value);
});

$('replaceAllBtn')?.addEventListener('click', () => {
  const editor = getFindCm();
  if (!editor || !_findMatches.length) return;
  const query = $('findInput')?.value;
  const repl  = $('replaceInput')?.value || '';
  editor.operation(() => {
    // Replace in reverse order to preserve positions
    for (let i = _findMatches.length - 1; i >= 0; i--) {
      const m = _findMatches[i];
      editor.replaceRange(repl, m.from, m.to);
    }
  });
  toast(`Заменено: ${_findMatches.length}`, 'success', 1500);
  doFindAll(query);
});

$('findCloseBtn')?.addEventListener('click', closeFindBar);

// Ctrl+F / Cmd+F
document.addEventListener('keydown', e => {
  const key = e.key?.toLowerCase?.();
  if ((e.metaKey || e.ctrlKey) && (key === 'f' || key === 'h')) {
    const tag = document.activeElement?.tagName;
    // If email base panel open → toggle its search instead
    if (key === 'f' && !$('panel-emailbase')?.classList.contains('hidden')) {
      e.preventDefault();
      $('ebSearchToggleBtn')?.click();
      return;
    }
    // Don't intercept native browser find if focus is in a plain input
    if (tag === 'INPUT' || tag === 'SELECT') return;
    e.preventDefault();
    openFindBar(getFocusedCodeMirror(), { focusReplace: key === 'h' });
  }
  if (e.key === 'Escape') {
    if (!$('findBar')?.classList.contains('hidden')) { closeFindBar(); return; }
    if (!$('ebSearchWrap')?.classList.contains('hidden')) {
      $('ebSearchToggleBtn')?.click();
    }
  }
});

// ═══════════════════════════════════════════════════════════════
// EMAIL BASE SEARCH
// ═══════════════════════════════════════════════════════════════

// Toggle search bar in email base
$('ebSearchToggleBtn')?.addEventListener('click', () => {
  const wrap = $('ebSearchWrap');
  if (!wrap) return;
  const visible = !wrap.classList.contains('hidden');
  wrap.classList.toggle('hidden', visible);
  if (!visible) {
    $('ebSearchInput')?.focus();
  } else {
    // Clear search when closing
    if ($('ebSearchInput')) $('ebSearchInput').value = '';
    _ebSearchQuery = '';
    renderEbMailList(ebState.activeBrand);
  }
  $('ebSearchToggleBtn')?.classList.toggle('active', !visible);
});

$('ebSearchInput')?.addEventListener('input', e => {
  _ebSearchQuery = e.target.value.toLowerCase().trim();
  renderEbMailList(ebState.activeBrand);
});

$('ebSearchInput')?.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    $('ebSearchWrap')?.classList.add('hidden');
    $('ebSearchToggleBtn')?.classList.remove('active');
    e.target.value = ''; _ebSearchQuery = '';
    renderEbMailList(ebState.activeBrand);
  }
});

// ═══════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════

function init() {
  setTheme(localStorage.getItem(LS_THEME) || 'dark');
  loadFromLocalStorage();
  initCodeMirror();
  // Apply wrap mode renderLine handler if restored from localStorage
  if (state.wrapMode) applyWrapRenderLine(cm);
  // Show decompile btn by default (HTML tab is active on start)
  switchEditorType('html');
  r.bottomBar.dataset.state = 'collapsed';
  r.aiDrawer.dataset.state  = 'collapsed';
  restoreUiFromState();
  refreshAiStatus();
  setInterval(refreshAiStatus, 30_000);
  setupBlocksDragDrop();

  // Hard reset button
  $('hardResetBtn')?.addEventListener('click', () => {
    if (!confirm('Сбросить всё? Закроется письмо, очистятся файлы, локали и встроенные namespace. Продолжить?')) return;
    // FULL clear: every wb-* key (covers LS_THEME/LS_BRANDS/LS_WORKSPACE_SPLIT
    // etc. that the old version forgot). Also kill builtins for this session.
    const keysToKeep = new Set(['wb-theme']); // keep theme so dark/light persists
    for (let i = localStorage.length - 1; i >= 0; i -= 1) {
      const k = localStorage.key(i);
      if (k && k.startsWith('wb-') && !keysToKeep.has(k)) {
        localStorage.removeItem(k);
      }
    }
    // Prevent _doLoadBuiltinNamespaces from re-adding builtins during this
    // session (it reads window._wbSuppressBuiltins).
    window._wbSuppressBuiltins = true;
    // Clear state
    state.srcCtx = null;
    state.files = [];
    state.activeFileId = null;
    state.namespaces = [];
    state.activeLocale = 'original';
    state.chatHistory = [];
    // Clear UI
    hideBlocksCarousel();
    r.blocksCarouselToggleBtn?.classList.add('hidden');
    r.compiledViewBanner?.classList.add('hidden');
    r.blocksShelf?.classList.add('hidden');
    r.srcFileTabs?.classList.add('hidden');
    if (cm) { _suppressSrcModified = true; cm.setValue(''); setTimeout(() => { _suppressSrcModified = false; }, 0); cm.setOption('readOnly', false); }
    // Clear file tabs
    if (r.fileTabs) r.fileTabs.querySelectorAll('.file-tab:not([data-file-id="__empty__"])').forEach(t => t.remove());
    // Clear locale bar
    renderLocalesBar();
    // Clear AI messages
    if (r.aiMessages) r.aiMessages.innerHTML = '';
    // Clear preview
    updatePreview();
    renderSrcFileTabs();
    updateTopbarSrcTab(null);
    toast('Рабочее пространство сброшено', 'success');
  });

  r.blocksCarouselClose?.addEventListener('click', () => {
    hideBlocksCarousel();
    r.blocksCarouselToggleBtn?.classList.remove('active');
  });

  // Fullscreen file picker toggle
  r.fsFilePickerBtn?.addEventListener('click', e => {
    e.stopPropagation();
    r.fsFilePickerDropdown?.classList.toggle('hidden');
  });
  document.addEventListener('click', e => {
    if (r.fsFilePickerWrap && !r.fsFilePickerWrap.contains(e.target)) {
      r.fsFilePickerDropdown?.classList.add('hidden');
    }
  });
  r.blocksCarouselToggleBtn?.addEventListener('click', () => {
    const isOpen = !r.blocksCarousel?.classList.contains('hidden');
    if (isOpen) {
      hideBlocksCarousel();
      r.blocksCarouselToggleBtn.classList.remove('active');
    } else {
      showBlocksCarousel();
      r.blocksCarouselToggleBtn.classList.add('active');
    }
  });
  console.log('%cRetKit Workbench v2.1 ready ✦', 'color:#2563eb;font-weight:700;font-size:14px');
}

document.addEventListener('DOMContentLoaded', init);


// ─── AI: placeholderize HTML + translate/fix locale TXT ────────────────
// Three operations wired into the locale-bar buttons:
//   ✱ aiPlaceholdersBtn  → /api/wb/ai/placeholderize        (HTML → ${{ ns.block_NN }}$)
//   🌐 aiTranslateBtn     → /api/wb/ai/translate-locale-txt  (en TXT → target TXT)
//   🩹 aiFixLocaleBtn     → /api/wb/ai/fix-locale-txt        (broken TXT → fixed TXT)
(function setupAiLocaleButtons() {
  const tBtn = document.getElementById('aiTranslateBtn');
  const pBtn = document.getElementById('aiPlaceholdersBtn');
  let fBtn = document.getElementById('aiFixLocaleBtn');
  if (!tBtn || !pBtn) return;

  // Inject the third "fix locale" button if missing — keeps HTML changes minimal.
  if (!fBtn) {
    fBtn = document.createElement('button');
    fBtn.id = 'aiFixLocaleBtn';
    fBtn.className = 'locale-add-manual-btn';
    fBtn.title = 'AI: починить текущую локаль (пары {{}}, @@, выровнять с reference)';
    fBtn.style.marginRight = '4px';
    fBtn.textContent = '🩹';
    pBtn.parentElement?.insertBefore(fBtn, pBtn.nextSibling);
  }

  const setBusy = (btn, original) => {
    btn._origText = original;
    btn.disabled = true;
    btn.textContent = '…';
  };
  const clearBusy = (btn) => {
    btn.disabled = false;
    btn.textContent = btn._origText;
  };

  function getActiveNs() {
    if (!Array.isArray(state.namespaces) || !state.namespaces.length) return null;
    // Prefer active id if state tracks it; fall back to first.
    const id = state.activeNamespaceId || state.activeNs;
    return state.namespaces.find(n => n.id === id) || state.namespaces[0];
  }

  function rawTxtFor(ns, code) {
    if (!ns) return '';
    if (ns.localeRaw && typeof ns.localeRaw[code] === 'string' && ns.localeRaw[code].trim()) {
      return ns.localeRaw[code];
    }
    const blocks = ns.locales?.[code];
    if (Array.isArray(blocks) && blocks.length) return serializeTxt(blocks);
    return '';
  }

  // ── Placeholderize current HTML editor content ──────────────────────────
  pBtn.addEventListener('click', async () => {
    if (!cm) { toast('Редактор не готов', 'warning'); return; }
    const html = cm.getValue();
    if (!html.trim()) { toast('Нет HTML в редакторе', 'warning'); return; }
    const ns = getActiveNs();
    if (!ns) { toast('Сначала загрузите namespace с локалями', 'warning'); return; }
    const refLocale = (rawTxtFor(ns, 'en') ? 'en' : Object.keys(ns.locales || {})[0]);
    const refTxt = rawTxtFor(ns, refLocale);
    if (!refTxt) { toast('Нет reference TXT в этом namespace', 'warning'); return; }
    setBusy(pBtn, '✱');
    try {
      const res = await fetch('/api/wb/ai/placeholderize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ html, refLocaleTxt: refTxt, namespace: ns.name }),
      });
      const json = await res.json();
      if (res.status === 404) throw new Error('Сервер не подхватил новые AI-endpoints. Перезапусти `npm start` и попробуй снова.');
      if (!res.ok || !json.ok) throw new Error(json.error || `HTTP ${res.status}`);
      const total = parseTxt(refTxt).length;
      const summary =
        `AI поставил ${json.anchors}/${total} плейсхолдеров. ` +
        (json.missed?.length ? `Не нашёл: ${json.missed.join(', ')}. ` : '') +
        (json.ambiguous?.length ? `Неоднозначно: ${json.ambiguous.join(', ')}. ` : '') +
        '\n\nПрименить к редактору?';
      if (!confirm(summary)) { toast('AI плейсхолдеры не применены', 'info'); return; }
      cm.setValue(json.html);
      updatePreview();
      toast(`✓ Поставлено ${json.anchors} плейсхолдеров`, 'success', 3000);
    } catch (err) {
      toast(`AI placeholderize failed: ${err.message}`, 'error');
    } finally {
      clearBusy(pBtn);
    }
  });

  // ── Translate active locale's TXT from EN (or chosen src) ───────────────
  tBtn.addEventListener('click', async () => {
    const target = (state.activeLocale || '').trim();
    if (!target || target === 'original') {
      toast('Сначала переключитесь на конкретную локаль (ar, ur, ru, ...)', 'warning'); return;
    }
    const ns = getActiveNs();
    if (!ns) { toast('Сначала загрузите namespace с локалями', 'warning'); return; }
    const from = prompt(`Перевести из какой локали → ${target}? (по умолчанию en)`, 'en');
    if (!from) return;
    const srcTxt = rawTxtFor(ns, from);
    if (!srcTxt) { toast(`В этом namespace нет локали ${from}`, 'warning'); return; }
    setBusy(tBtn, '🌐');
    try {
      const res = await fetch('/api/wb/ai/translate-locale-txt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ srcTxt, fromLang: from, toLang: target }),
      });
      const json = await res.json();
      if (res.status === 404) throw new Error('Сервер не подхватил новые AI-endpoints. Перезапусти `npm start` и попробуй снова.');
      if (!res.ok || !json.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setLocaleRawContent(ns, target, json.translatedTxt);
      renderLocalesBar();
      activateLocale(target);
      const skipped = json.skipped?.length ? ` (пропущено ${json.skipped.length})` : '';
      toast(`✓ Перевод ${from}→${target}: ${json.blocks.length} блоков${skipped}`, 'success', 3000);
    } catch (err) {
      toast(`AI translate failed: ${err.message}`, 'error');
    } finally {
      clearBusy(tBtn);
    }
  });

  // ── Fix the active locale TXT — with dry-run preview + rollback ─────────
  fBtn.addEventListener('click', async () => {
    const code = (state.activeLocale || '').trim();
    if (!code || code === 'original') {
      toast('Сначала переключитесь на конкретную локаль', 'warning'); return;
    }
    const ns = getActiveNs();
    if (!ns) { toast('Нет namespace', 'warning'); return; }
    const txt = rawTxtFor(ns, code);
    if (!txt) { toast(`Нет содержимого для локали ${code}`, 'warning'); return; }
    const refCode = code === 'en' ? null : (rawTxtFor(ns, 'en') ? 'en' : null);
    const refTxt = refCode ? rawTxtFor(ns, refCode) : '';
    setBusy(fBtn, '🩹');
    try {
      const res = await fetch('/api/wb/ai/fix-locale-txt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ txt, refTxt, language: code }),
      });
      const json = await res.json();
      if (res.status === 404) throw new Error('Сервер не подхватил новые AI-endpoints. Перезапусти `npm start` и попробуй снова.');
      if (!res.ok || !json.ok) throw new Error(json.error || `HTTP ${res.status}`);
      const beforeBlocks = parseTxt(txt) || [];
      const afterBlocks = json.blocks || [];
      // Show structured diff preview + Apply/Cancel.
      const apply = await showLocaleFixDiffPreview({
        code,
        nsName: ns.name,
        before: beforeBlocks,
        after: afterBlocks,
      });
      if (!apply) { toast('Исправление не применено', 'info'); return; }
      // Save snapshot before mutating so user can rollback.
      _lastLocaleFixSnapshot = { nsId: ns.id, code, prevRawTxt: txt, ts: Date.now() };
      setLocaleRawContent(ns, code, json.fixedTxt);
      renderLocalesBar();
      activateLocale(code);
      // Show toast with Rollback button.
      toastWithAction(
        `✓ Локаль ${code} исправлена: было ${beforeBlocks.length} → стало ${afterBlocks.length} блоков`,
        'Откатить',
        () => rollbackLastLocaleFix(),
        'success',
        8000
      );
    } catch (err) {
      toast(`AI fix-locale failed: ${err.message}`, 'error');
    } finally {
      clearBusy(fBtn);
    }
  });
})();


// ─── AI preset chips → autosubmit ────────────────────────────────
(function setupAiPresets() {
  const PRESETS = {
    'placeholderize':    'Расставь плейсхолдеры в HTML по EN-локали (по порядку blockов).',
    'translate-all':     'Переведи письмо во все загруженные локали.',
    'translate-active':  'Переведи в текущую активную локаль.',
    'fix-locale':        'Почини активную локаль: парные {{}}, балансировка @@, выровнять блоки с EN.',
    // Analyze preset auto-enables Agent mode so the AI runs the full
    // discovery → analyze_email tool chain and reports findings.
    'analyze':           'Сделай умный анализ: прочитай открытый HTML, посмотри загруженные namespace и локали, найди orphan-блоки, hardcoded-текст и drift между локалями. Покажи отчёт; ничего не меняй.',
  };
  const root = document.getElementById('aiPresets');
  if (!root || !r.aiInput || !r.aiSendBtn) return;
  root.addEventListener('click', (e) => {
    const btn = e.target.closest('.ai-preset');
    if (!btn) return;
    const key = btn.dataset.preset;
    const text = PRESETS[key];
    if (!text) return;
    // 'analyze' is meaningful only via the agent loop (it calls analyze_email
    // as a tool). Force-enable Agent toggle for this preset.
    if (key === 'analyze') {
      const toggle = document.getElementById('aiAgentToggle');
      if (toggle && !toggle.checked) toggle.checked = true;
    }
    r.aiInput.value = text;
    r.aiInput.dispatchEvent(new Event('input', { bubbles: true }));
    r.aiSendBtn.click();
  });
})();


// ─── Inline inspector (preview-side editor) ────────────────────────────────
let _inspectorPanel = null;
let _inspectorTarget = null; // { outerHtml, ... } — last clicked element snapshot

function ensureInspectorPanel() {
  if (_inspectorPanel) return _inspectorPanel;
  const panel = document.createElement('div');
  panel.id = 'inlineInspector';
  panel.className = 'inline-inspector hidden';
  panel.innerHTML = `
    <div class="inspector-header">
      <span class="inspector-title">Инспектор</span>
      <button class="inspector-close" type="button" title="Закрыть">✕</button>
    </div>
    <div class="inspector-body" id="inspectorBody"></div>
    <div class="inspector-footer">
      <button class="inspector-apply" type="button">Применить</button>
      <button class="inspector-cancel" type="button">Отмена</button>
    </div>
  `;
  document.body.appendChild(panel);
  panel.querySelector('.inspector-close').addEventListener('click', closeInspector);
  panel.querySelector('.inspector-cancel').addEventListener('click', closeInspector);
  panel.querySelector('.inspector-apply').addEventListener('click', applyInspectorChanges);
  _inspectorPanel = panel;
  return panel;
}

function closeInspector() {
  _inspectorTarget = null;
  if (_inspectorPanel) _inspectorPanel.classList.add('hidden');
}

function openInspector(payload) {
  const panel = ensureInspectorPanel();
  _inspectorTarget = payload;
  const body = panel.querySelector('#inspectorBody');
  const c = payload.computed || {};
  const isImg = payload.tag === 'img';
  body.innerHTML = `
    ${isImg ? '' : `
    <label class="ins-row"><span>Текст</span>
      <textarea data-field="text" rows="2">${escapeHtml(payload.text || '')}</textarea>
    </label>`}
    ${isImg ? `
    <label class="ins-row"><span>Image src</span>
      <input data-field="src" type="text" value="${escapeHtml(payload.src || '')}" />
    </label>
    <label class="ins-row"><span>Alt text</span>
      <input data-field="alt" type="text" value="${escapeHtml(payload.alt || '')}" />
    </label>` : ''}
    <label class="ins-row"><span>Цвет текста</span>
      <input data-field="color" type="color" value="${rgbToHex(c.color)}" />
    </label>
    <label class="ins-row"><span>Фон</span>
      <input data-field="backgroundColor" type="color" value="${rgbToHex(c.backgroundColor)}" />
    </label>
    <label class="ins-row"><span>Размер шрифта (px)</span>
      <input data-field="fontSize" type="number" min="8" max="80" value="${parseInt(c.fontSize) || 14}" />
    </label>
    <label class="ins-row"><span>Жирность</span>
      <select data-field="fontWeight">
        <option value="">—</option>
        <option value="400" ${c.fontWeight==='400'?'selected':''}>Regular</option>
        <option value="500" ${c.fontWeight==='500'?'selected':''}>Medium</option>
        <option value="700" ${c.fontWeight==='700'?'selected':''}>Bold</option>
      </select>
    </label>
    <label class="ins-row"><span>Выравнивание</span>
      <select data-field="textAlign">
        <option value="">—</option>
        <option value="left"   ${c.textAlign==='left'?'selected':''}>Left</option>
        <option value="center" ${c.textAlign==='center'?'selected':''}>Center</option>
        <option value="right"  ${c.textAlign==='right'?'selected':''}>Right</option>
      </select>
    </label>
    <label class="ins-row"><span>Паддинг</span>
      <input data-field="padding" type="text" value="${escapeHtml(c.padding || '')}" placeholder="10px 20px" />
    </label>
    <label class="ins-row"><span>Border-radius</span>
      <input data-field="borderRadius" type="text" value="${escapeHtml(c.borderRadius || '')}" placeholder="4px" />
    </label>
  `;
  panel.classList.remove('hidden');
  // Position: top-right of preview pane.
  const rect = (r.previewFrameWrap || document.body).getBoundingClientRect();
  panel.style.top = `${Math.max(20, rect.top + 12)}px`;
  panel.style.left = `${Math.max(20, rect.right - panel.offsetWidth - 12)}px`;
}

function rgbToHex(rgb) {
  if (!rgb) return '#000000';
  const m = String(rgb).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (!m) return '#000000';
  const toHex = (n) => Number(n).toString(16).padStart(2, '0');
  return '#' + toHex(m[1]) + toHex(m[2]) + toHex(m[3]);
}

function buildPatchedOuterHtml(target, edits) {
  // Start from outerHtml; mutate the opening tag's style/attrs and (for non-img) the inner text.
  let out = String(target.outerHtml || '');

  // Replace inner text for non-img containers — only touch a single inner text run if possible.
  if (target.tag !== 'img' && typeof edits.text === 'string') {
    // naive: replace all text nodes inside the element with the new text
    out = out.replace(/^(<[a-z][^>]*>)([\s\S]*)(<\/[a-z]+>)$/i, (_m, open, _inner, close) =>
      `${open}${edits.text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}${close}`);
  }
  // For images: replace src/alt
  if (target.tag === 'img') {
    if (typeof edits.src === 'string') out = out.replace(/\bsrc\s*=\s*("|')[^"']*\1/i, `src="${edits.src.replace(/"/g, '&quot;')}"`);
    if (typeof edits.alt === 'string') {
      if (/\balt\s*=/i.test(out)) out = out.replace(/\balt\s*=\s*("|')[^"']*\1/i, `alt="${edits.alt.replace(/"/g, '&quot;')}"`);
      else out = out.replace(/^<img\b/i, `<img alt="${edits.alt.replace(/"/g, '&quot;')}"`);
    }
  }
  // Build a style declarations block from edits (only those that were set).
  const styleParts = [];
  const fields = ['color','backgroundColor','fontSize','fontWeight','textAlign','padding','borderRadius'];
  const cssNames = { backgroundColor:'background-color', fontSize:'font-size', fontWeight:'font-weight', textAlign:'text-align', borderRadius:'border-radius' };
  for (const f of fields) {
    let v = edits[f];
    if (v === undefined || v === '' || v == null) continue;
    if (f === 'fontSize' && typeof v !== 'string') v = `${parseInt(v)}px`;
    styleParts.push(`${cssNames[f] || f}: ${v}`);
  }
  if (styleParts.length) {
    out = out.replace(/^<([a-z][\w:-]*)\b([^>]*)>/i, (_m, tag, attrs) => {
      if (/\bstyle\s*=/i.test(attrs)) {
        return `<${tag}${attrs.replace(/\bstyle\s*=\s*(["'])([\s\S]*?)\1/i,
          (_full, q, body) => `style=${q}${body.replace(/\s*;\s*$/, '')}; ${styleParts.join('; ')};${q}`)}>`;
      }
      return `<${tag}${attrs} style="${styleParts.join('; ')};">`;
    });
  }
  return out;
}

function applyInspectorChanges() {
  if (!_inspectorTarget || !cm) return closeInspector();
  const panel = _inspectorPanel;
  if (!panel) return;
  const edits = {};
  panel.querySelectorAll('[data-field]').forEach(el => {
    const f = el.dataset.field;
    edits[f] = el.value;
  });
  const newOuter = buildPatchedOuterHtml(_inspectorTarget, edits);
  const oldOuter = _inspectorTarget.outerHtml;
  if (!oldOuter || oldOuter === newOuter) return closeInspector();

  const code = cm.getValue();
  // First try exact outerHTML match. If iframe ran CSS-inline, outerHTML in iframe
  // can differ from cm — fall back to a more flexible match by tag + visible text.
  let idx = code.indexOf(oldOuter);
  let matchLen = oldOuter.length;
  if (idx === -1 && _inspectorTarget) {
    const tag = _inspectorTarget.tag;
    const txt = (_inspectorTarget.text || '').trim();
    if (tag && txt && txt.length >= 4) {
      // Find any opening <tag ...> ... txt ... </tag>
      const tagRe = new RegExp('<' + tag + '\\b[^>]*>[\\s\\S]*?</' + tag + '>', 'i');
      const re = new RegExp(
        '<' + tag + '\\b[^>]*>[\\s\\S]*?' +
          txt.slice(0, 60).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') +
          '[\\s\\S]*?</' + tag + '>',
        'i'
      );
      const m = re.exec(code);
      if (m) {
        idx = m.index;
        matchLen = m[0].length;
        // We will replace the matched range with newOuter. newOuter was built from
        // the iframe's (CSS-inlined) outerHTML, which can differ from cm's source.
        // To stay safe: only patch the OPENING tag's style + the visible text inside.
      }
    }
  }
  if (idx === -1) {
    toast('Не удалось найти фрагмент в коде. Возможно текст изменён вручную.', 'warning', 4000);
    return;
  }
  if (code.indexOf(oldOuter, idx + 1) !== -1) {
    toast('Фрагмент встречается несколько раз. Применил к первому совпадению.', 'info', 3000);
  }
  cm.operation(() => {
    const start = cm.posFromIndex(idx);
    const end = cm.posFromIndex(idx + matchLen);
    cm.replaceRange(newOuter, start, end);
  });
  try { cm.refresh(); } catch {}
  try { updatePreview(); } catch {}
  toast('✓ Применено', 'success', 1500);
  closeInspector();
}

window.addEventListener('message', (e) => {
  if (!e.data || e.data.type !== 'retkit-inspect-click') return;
  // Only show inspector if Cmd/Alt-click — to avoid getting in the way of normal preview clicks.
  // Actually: show on every click; user can dismiss with ESC/✕.
  openInspector(e.data);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && _inspectorPanel && !_inspectorPanel.classList.contains('hidden')) closeInspector();
});

// ─── Pencil-mode toggle (🖊 button in preview toolbar) ─────────────────────
// Flips a flag that the iframe's overlay script reads — when ON, regular
// clicks (no Cmd/Ctrl needed) open the inline inspector. The preview gets a
// dashed orange outline so users see they're in edit mode.
state.pencilMode = false;
function setPencilMode(on) {
  state.pencilMode = !!on;
  if (r.pencilToggle) {
    r.pencilToggle.setAttribute('aria-pressed', String(state.pencilMode));
    r.pencilToggle.classList.toggle('active', state.pencilMode);
  }
  if (r.previewFrameWrap) {
    r.previewFrameWrap.classList.toggle('pencil-on', state.pencilMode);
  }
  // Push the flag into the iframe so the overlay script reacts.
  try {
    const win = r.previewFrame && r.previewFrame.contentWindow;
    if (win) win.postMessage({ type: 'retkit-set-pencil', on: state.pencilMode }, '*');
  } catch { /* ignore */ }
}
if (r.pencilToggle) {
  r.pencilToggle.addEventListener('click', () => setPencilMode(!state.pencilMode));
}
// Re-send the flag every time a new HTML is loaded into the iframe (the iframe
// has just discarded its previous state). The existing updatePreview() runs
// doc.write() — we hook after-load via the iframe's load event.
if (r.previewFrame) {
  r.previewFrame.addEventListener('load', () => {
    if (state.pencilMode) {
      try { r.previewFrame.contentWindow.postMessage({ type: 'retkit-set-pencil', on: true }, '*'); } catch {}
    }
  });
}


// ─── Drag .txt locale files directly onto the chat panel ───────────────────
(function setupChatTxtDrop() {
  // The whole AI drawer accepts drops; visually highlights the messages area.
  const drawerBody = document.getElementById('aiDrawerBody');
  const messages = document.getElementById('aiMessages');
  if (!drawerBody) return;
  const setHL = (on) => {
    drawerBody.classList.toggle('chat-drop-target', on);
  };

  drawerBody.addEventListener('dragenter', (e) => {
    if (!e.dataTransfer || ![...e.dataTransfer.types].includes('Files')) return;
    e.preventDefault();
    setHL(true);
  });
  drawerBody.addEventListener('dragover', (e) => {
    if (!e.dataTransfer || ![...e.dataTransfer.types].includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });
  drawerBody.addEventListener('dragleave', (e) => {
    if (e.relatedTarget && drawerBody.contains(e.relatedTarget)) return;
    setHL(false);
  });
  drawerBody.addEventListener('drop', async (e) => {
    if (!e.dataTransfer) return;
    e.preventDefault();
    setHL(false);

    // Collect .txt files (recursively from folder drops via webkitGetAsEntry).
    const txtFiles = [];
    const items = e.dataTransfer.items ? [...e.dataTransfer.items] : [];
    if (items.length && items[0].webkitGetAsEntry) {
      const collect = async (entry) => {
        if (entry.isFile) {
          if (/\.txt$/i.test(entry.name)) {
            const f = await new Promise(r => entry.file(r));
            txtFiles.push(f);
          }
        } else if (entry.isDirectory) {
          const reader = entry.createReader();
          const entries = await new Promise(r => reader.readEntries(r));
          await Promise.all(entries.map(collect));
        }
      };
      const entries = items.map(it => it.webkitGetAsEntry()).filter(Boolean);
      await Promise.all(entries.map(collect));
    } else {
      [...e.dataTransfer.files].forEach(f => { if (/\.txt$/i.test(f.name)) txtFiles.push(f); });
    }

    if (!txtFiles.length) {
      toast('В drop нет .txt файлов с локалями', 'warning');
      return;
    }

    // Pick a namespace name: ask only if there are 0 namespaces yet.
    let nsName;
    if (state.namespaces.length) {
      nsName = state.namespaces[0].name;
    } else {
      nsName = prompt('Имя namespace для этих файлов:', 'mail-namespace-REG') || 'mail-namespace-REG';
    }

    importFilesIntoNamespace(txtFiles, nsName);
    toast(`Загрузил ${txtFiles.length} файлов локалей в "${nsName}"`, 'success', 3500);

    // Add a chat hint message so the user knows AI can use these now.
    if (messages) {
      const hint = document.createElement('div');
      hint.className = 'ai-msg ai-msg-info';
      hint.textContent = `✓ Загружены TXT: ${txtFiles.map(f => f.name).join(', ').slice(0, 200)}. Можешь сразу попросить «расставь плейсхолдеры» или «переведи во все локали».`;
      messages.appendChild(hint);
      messages.scrollTop = messages.scrollHeight;
    }
  });
})();


// ─── Built-in namespaces auto-load (footer_upload etc) ───────────────────
// On studio init, fetch /api/wb/builtin-namespaces and merge them into
// state.namespaces so users can use ${{ footer_upload.block_00 }}$ etc out
// of the box, without uploading anything. We DON'T overwrite a user-provided
// namespace with the same name — built-in is a fallback.
// Defer until DOM ready + init() has populated `state` and renderers.
function _doLoadBuiltinNamespaces() {
  if (typeof state === 'undefined' || !state) {
    setTimeout(_doLoadBuiltinNamespaces, 100);
    return;
  }
  if (window._wbSuppressBuiltins) {
    console.log('[builtin-namespaces] suppressed by hard-reset session flag');
    return;
  }
  fetch('/api/wb/builtin-namespaces')
    .then(res => res.ok ? res.json() : null)
    .then(json => {
      if (!json || !Array.isArray(json.namespaces)) return;
      const builtins = json.namespaces;
      if (!builtins.length) return;
      if (!Array.isArray(state.namespaces)) state.namespaces = [];
      let added = 0;
      for (const ns of builtins) {
        if (!ns || !ns.name) continue;
        if (state.namespaces.some(n => n.name === ns.name)) continue;
        const normalised = {
          id: ns.id || ('ns-builtin-' + ns.name),
          name: ns.name,
          builtin: true,
          description: ns.description || '',
          locales: ns.locales || {},
          localeRaw: {},
          localeIssues: {},
        };
        for (const code of Object.keys(normalised.locales)) {
          normalised.localeRaw[code] = (normalised.locales[code] || [])
            .map(b => `{{${b}}}`).join('\n\n');
        }
        state.namespaces.push(normalised);
        added += 1;
      }
      if (added) {
        // Wait for renderers to exist — retry a few times if needed.
        const tryRender = (attempts = 0) => {
          if (typeof renderLocalesBar === 'function' && typeof renderNamespaceBar === 'function' && r && r.localeTabs) {
            try { renderLocalesBar(); } catch {}
            try { renderNamespaceBar(); } catch {}
            try { updatePreview && updatePreview(); } catch {}
            console.log('[builtin-namespaces] loaded', added, 'namespace(s):', builtins.map(n => n.name).join(', '));
          } else if (attempts < 20) {
            setTimeout(() => tryRender(attempts + 1), 150);
          }
        };
        tryRender();
      }
    })
    .catch(err => console.warn('[builtin-namespaces] load failed:', err && err.message));
}

// Fire once DOM is parsed; init() will already be queued via DOMContentLoaded.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => setTimeout(_doLoadBuiltinNamespaces, 300));
} else {
  setTimeout(_doLoadBuiltinNamespaces, 300);
}

// ─── Locale-fix diff preview modal + rollback ─────────────────────────────
let _lastLocaleFixSnapshot = null;

function rollbackLastLocaleFix() {
  if (!_lastLocaleFixSnapshot) { toast('Нечего откатывать', 'warning'); return; }
  const { nsId, code, prevRawTxt } = _lastLocaleFixSnapshot;
  const ns = (state.namespaces || []).find(n => n.id === nsId);
  if (!ns) { toast('Namespace не найден', 'error'); return; }
  setLocaleRawContent(ns, code, prevRawTxt);
  renderLocalesBar();
  activateLocale(code);
  _lastLocaleFixSnapshot = null;
  toast(`✓ Локаль ${code} откачена к предыдущему состоянию`, 'success');
}

function showLocaleFixDiffPreview({ code, nsName, before, after }) {
  return new Promise(resolve => {
    let host = document.getElementById('localeFixDiffModal');
    if (host) host.remove();
    host = document.createElement('div');
    host.id = 'localeFixDiffModal';
    host.className = 'modal-backdrop locale-fix-diff-backdrop';
    const maxLen = Math.max(before.length, after.length);
    const rows = [];
    for (let i = 0; i < maxLen; i += 1) {
      const b = (before[i] ?? '').toString();
      const a = (after[i] ?? '').toString();
      const changed = b.trim() !== a.trim();
      const status = !b && a ? 'added' : !a && b ? 'removed' : changed ? 'changed' : 'same';
      rows.push(`<div class="diff-row diff-${status}">
        <div class="diff-idx">block_${String(i).padStart(2,'0')}</div>
        <div class="diff-before">${b ? escapeHtml(b.slice(0, 300)) : '<i>—</i>'}</div>
        <div class="diff-arrow">→</div>
        <div class="diff-after">${a ? escapeHtml(a.slice(0, 300)) : '<i>—</i>'}</div>
      </div>`);
    }
    const addedCount = rows.filter(r => r.includes('diff-added')).length;
    const removedCount = rows.filter(r => r.includes('diff-removed')).length;
    const changedCount = rows.filter(r => r.includes('diff-changed')).length;
    host.innerHTML = `
      <div class="locale-fix-diff-modal">
        <div class="diff-header">
          <span class="diff-title">AI fix preview — ${escapeHtml(nsName)} / ${code.toUpperCase()}</span>
          <button class="diff-close" type="button">✕</button>
        </div>
        <div class="diff-summary">
          было <b>${before.length}</b> блоков · станет <b>${after.length}</b>
          ${addedCount ? `· <span class="diff-stat diff-stat-added">+${addedCount} добавлено</span>` : ''}
          ${removedCount ? `· <span class="diff-stat diff-stat-removed">-${removedCount} удалено</span>` : ''}
          ${changedCount ? `· <span class="diff-stat diff-stat-changed">~${changedCount} изменено</span>` : ''}
        </div>
        <div class="diff-rows-wrap">${rows.join('')}</div>
        <div class="diff-footer">
          <button class="diff-cancel" type="button">Отмена</button>
          <button class="diff-apply" type="button">Применить</button>
        </div>
      </div>
    `;
    document.body.appendChild(host);
    const done = (v) => { host.remove(); resolve(v); };
    host.querySelector('.diff-close').addEventListener('click', () => done(false));
    host.querySelector('.diff-cancel').addEventListener('click', () => done(false));
    host.querySelector('.diff-apply').addEventListener('click', () => done(true));
    host.addEventListener('click', (e) => { if (e.target === host) done(false); });
  });
}

function toastWithAction(message, actionLabel, onAction, type = 'success', timeout = 6000) {
  if (typeof toast !== 'function') return;
  const el = document.createElement('div');
  el.className = `toast toast-${type} toast-with-action`;
  el.innerHTML = `<span class="toast-msg">${escapeHtml(message)}</span>
                  <button class="toast-action" type="button">${escapeHtml(actionLabel)}</button>`;
  document.body.appendChild(el);
  let killed = false;
  const kill = () => { if (killed) return; killed = true; el.classList.add('toast-leaving'); setTimeout(() => el.remove(), 200); };
  el.querySelector('.toast-action').addEventListener('click', () => { try { onAction(); } catch {} kill(); });
  setTimeout(kill, timeout);
}


// ─── Placeholder scanner (deterministic /api/mail/infer-placeholders) ──
// Companion to the AI "✱" button. The scanner is offline regex-based and
// proposes candidates in 8 categories (amount, account_id, user_name,
// date, tracking_link, brand_name, phone, email_address). User picks
// which proposals to keep, then we POST /api/mail/apply-placeholders.
(function setupPlaceholderScanner() {
  const btn = document.getElementById('scanPlaceholdersBtn');
  const overlay = document.getElementById('phScannerOverlay');
  const closeBtn = document.getElementById('phScannerClose');
  const body = document.getElementById('phScannerBody');
  const summaryEl = document.getElementById('phScannerSummary');
  const existingEl = document.getElementById('phScannerExisting');
  const selAllBtn = document.getElementById('phScannerSelectAll');
  const selHiBtn = document.getElementById('phScannerSelectHi');
  const selNoneBtn = document.getElementById('phScannerSelectNone');
  const applyBtn = document.getElementById('phScannerApply');
  const rescanBtn = document.getElementById('phScannerRescan');
  const nsInput = document.getElementById('phScannerNamespace');
  if (!btn || !overlay) return;

  let lastResult = null;     // { proposals, existing, summary }
  let lastHtml = '';

  const CAT_LABELS = {
    amount: 'Сумма',
    account_id: 'ID',
    user_name: 'Имя',
    date: 'Дата',
    tracking_link: 'Tracking-ссылка',
    brand_name: 'Бренд',
    phone: 'Телефон',
    email_address: 'Email',
  };

  function getDraftHtml() {
    if (typeof cm !== 'undefined' && cm && typeof cm.getValue === 'function') {
      return cm.getValue();
    }
    return '';
  }

  function activeNamespaceName() {
    if (nsInput && nsInput.value.trim()) return nsInput.value.trim();
    if (typeof state !== 'undefined' && Array.isArray(state.namespaces)) {
      const ns = state.namespaces.find(n => n.id === state.activeNamespaceId) || state.namespaces[0];
      if (ns && ns.name) return ns.name;
    }
    return '';
  }

  function open() {
    overlay.classList.remove('hidden');
    overlay.setAttribute('aria-hidden', 'false');
    document.addEventListener('keydown', onKey);
    if (!lastResult) runScan();
  }
  function close() {
    overlay.classList.add('hidden');
    overlay.setAttribute('aria-hidden', 'true');
    document.removeEventListener('keydown', onKey);
  }
  function onKey(e) { if (e.key === 'Escape') close(); }

  async function runScan() {
    const html = getDraftHtml();
    if (!html.trim()) {
      body.innerHTML = '<div class="ph-scanner-empty">Редактор пуст — открой письмо.</div>';
      summaryEl.textContent = '';
      existingEl.textContent = '';
      return;
    }
    lastHtml = html;
    body.innerHTML = '<div class="ph-scanner-empty">Сканирую…</div>';
    summaryEl.textContent = '';
    try {
      const ns = activeNamespaceName();
      if (ns && nsInput && !nsInput.value.trim()) nsInput.value = ns;
      const res = await fetch('/api/mail/infer-placeholders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ html, mailNamespace: ns || undefined }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || `HTTP ${res.status}`);
      lastResult = json;
      render(json);
    } catch (err) {
      body.innerHTML = `<div class="ph-scanner-empty">Ошибка: ${escapeHtml(String(err.message || err))}</div>`;
    }
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function render(result) {
    const { proposals = [], existing = [], summary = {} } = result;
    summaryEl.textContent = proposals.length
      ? `${proposals.length} предложений по ${Object.keys(summary.byCategory || {}).length} категориям`
      : 'Чисто — ничего подозрительного не нашёл.';
    existingEl.textContent = existing.length
      ? `В письме уже есть ${existing.length} плейсхолдер(ов): ${existing.slice(0, 4).map(e => `${e.namespace}.${e.blockId}`).join(', ')}${existing.length > 4 ? '…' : ''}`
      : 'В письме пока нет плейсхолдеров.';
    if (!proposals.length) {
      body.innerHTML = '<div class="ph-scanner-empty">Подозрительных значений не найдено.</div>';
      return;
    }
    const byCat = new Map();
    for (const p of proposals) {
      if (!byCat.has(p.category)) byCat.set(p.category, []);
      byCat.get(p.category).push(p);
    }
    const parts = [];
    let idx = 0;
    for (const [cat, items] of byCat.entries()) {
      parts.push(`<div class="ph-cat-group"><h4>${escapeHtml(CAT_LABELS[cat] || cat)} <span class="ph-cat-count">${items.length}</span></h4>`);
      for (const p of items) {
        const dataIdx = idx++;
        const checked = p.confidence >= 0.85 ? 'checked' : '';
        parts.push(
          `<label class="ph-proposal" data-cat="${escapeHtml(cat)}" data-idx="${dataIdx}">` +
            `<input type="checkbox" ${checked} />` +
            `<span class="ph-cat">${escapeHtml(cat.replace('_', ' '))}</span>` +
            `<span><span class="ph-original">${escapeHtml(p.original)}</span> <span class="ph-reason">— ${escapeHtml(p.reason)}</span></span>` +
            `<span class="ph-conf">${p.confidence.toFixed(2)}</span>` +
          `</label>`
        );
      }
      parts.push('</div>');
    }
    body.innerHTML = parts.join('');
  }

  function selectedProposals() {
    if (!lastResult) return [];
    const checks = body.querySelectorAll('.ph-proposal input[type=checkbox]:checked');
    const out = [];
    checks.forEach(cb => {
      const parent = cb.closest('.ph-proposal');
      const idx = Number(parent.getAttribute('data-idx'));
      if (Number.isFinite(idx) && lastResult.proposals[idx]) {
        out.push(lastResult.proposals[idx]);
      }
    });
    return out;
  }

  function setAll(value) {
    body.querySelectorAll('.ph-proposal input[type=checkbox]').forEach(cb => { cb.checked = value; });
  }
  function setHighConf() {
    if (!lastResult) return;
    body.querySelectorAll('.ph-proposal').forEach((row) => {
      const idx = Number(row.getAttribute('data-idx'));
      const p = lastResult.proposals[idx];
      const cb = row.querySelector('input[type=checkbox]');
      if (cb && p) cb.checked = p.confidence >= 0.85;
    });
  }

  async function applySelected() {
    const accepted = selectedProposals();
    if (!accepted.length) {
      if (typeof toast === 'function') toast('Ничего не выбрано', 'warning');
      return;
    }
    if (!confirm(`Применить ${accepted.length} плейсхолдер(ов) к редактору?`)) return;
    applyBtn.disabled = true;
    const origText = applyBtn.textContent;
    applyBtn.textContent = 'Применяю…';
    try {
      const res = await fetch('/api/mail/apply-placeholders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ html: lastHtml, accepted }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || `HTTP ${res.status}`);
      if (typeof cm !== 'undefined' && cm) {
        cm.setValue(json.html);
        if (typeof updatePreview === 'function') updatePreview();
      }
      const msg = `✓ Применено ${json.applied.length}${json.skipped.length ? `, пропущено ${json.skipped.length}` : ''}`;
      if (typeof toast === 'function') toast(msg, 'success', 3000);
      close();
    } catch (err) {
      if (typeof toast === 'function') toast(`Apply failed: ${err.message}`, 'error');
    } finally {
      applyBtn.disabled = false;
      applyBtn.textContent = origText;
    }
  }

  btn.addEventListener('click', open);
  closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  selAllBtn.addEventListener('click', () => setAll(true));
  selNoneBtn.addEventListener('click', () => setAll(false));
  selHiBtn.addEventListener('click', setHighConf);
  rescanBtn.addEventListener('click', runScan);
  applyBtn.addEventListener('click', applySelected);
})();


// ─── Bridge for outline-mode.js ──────────────────────────────────────────
// outline-mode.js is loaded as a separate script and needs access to a few
// workbench internals. Keep this surface MINIMAL — anything new should be
// added explicitly, not by exposing the whole state object.
if (typeof window !== 'undefined') {
  window.WB = window.WB || {};
  window.WB.insertEmailBlock = insertEmailBlock;
  window.WB.getActiveCm = getActiveCm;
  window.WB.getSrcCtx = () => state.srcCtx;
  window.WB.getState = () => state;
  // Helpers we'll let outline-mode subscribe to.
  window.WB.onFileChange = (cb) => {
    window.WB._fileChangeListeners = window.WB._fileChangeListeners || [];
    window.WB._fileChangeListeners.push(cb);
  };
  window.WB.fireFileChange = () => {
    (window.WB._fileChangeListeners || []).forEach((cb) => { try { cb(); } catch (e) { console.error(e); } });
  };
}
