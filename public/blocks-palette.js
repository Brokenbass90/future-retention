/**
 * blocks-palette.js — UI panel for "tear code from another mail" workflow.
 *
 * What it does:
 *   1. Lists mails (left column) — fetched from /api/blocks/by-mail.
 *   2. When a mail is selected, lists its blocks in the middle column.
 *   3. When a block is selected, fetches its source via /api/blocks/source
 *      and shows the jade text in the right column.
 *   4. "Insert" button injects the block's source at the cursor in the
 *      currently active editor (Monaco if on, else CM5).
 *
 * Wired with workbench.js via:
 *   - global window.cm (CodeMirror), if mounted
 *   - global window.MonacoPilot (Monaco wrapper), if mounted
 *
 * P1.2 in ROADMAP: cross-base block import. The MVP inserts source
 * literally; conflict resolution for placeholder namespaces is future work.
 */

(function () {
  'use strict';

  let cache = null;       // /api/blocks/by-mail result
  let selectedMail = null;
  let selectedBlock = null;
  let sourceCache = new Map(); // key: cat|mailId|blockFile -> text

  function $(id) { return document.getElementById(id); }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function ensureMarkup() {
    if ($('blocksPaletteOverlay')) return;
    const div = document.createElement('div');
    div.id = 'blocksPaletteOverlay';
    div.className = 'bp-overlay hidden';
    div.innerHTML = `
      <div class="bp-modal" role="dialog">
        <div class="bp-header">
          <h3>Палитра блоков — тяни код из других писем</h3>
          <input type="text" class="bp-search" id="bpSearch" placeholder="Фильтр писем (например: header, IQ, RFM…)" />
          <button class="bp-close" id="bpClose" aria-label="Close">×</button>
        </div>
        <div class="bp-body">
          <div class="bp-col bp-col-mails">
            <div class="bp-col-title">Письма <span id="bpMailsCount" class="bp-count"></span></div>
            <div class="bp-list" id="bpMailsList">
              <div class="bp-empty">Загрузка…</div>
            </div>
          </div>
          <div class="bp-col bp-col-blocks">
            <div class="bp-col-title">Блоки <span id="bpBlocksCount" class="bp-count"></span></div>
            <div class="bp-list" id="bpBlocksList">
              <div class="bp-empty">Выберите письмо слева</div>
            </div>
          </div>
          <div class="bp-col bp-col-preview">
            <div class="bp-col-title">Источник <span id="bpBlockMeta" class="bp-meta"></span></div>
            <pre class="bp-source" id="bpSource"><code>Выберите блок</code></pre>
          </div>
        </div>
        <div class="bp-footer">
          <span class="bp-hint" id="bpHint"></span>
          <button class="bp-btn" id="bpRefresh">Обновить индекс</button>
          <button class="bp-btn primary" id="bpInsert" disabled>Вставить в редактор</button>
        </div>
      </div>
    `;
    document.body.appendChild(div);

    $('bpClose').addEventListener('click', close);
    div.addEventListener('click', (e) => { if (e.target === div) close(); });
    $('bpRefresh').addEventListener('click', () => loadIndex(true));
    $('bpInsert').addEventListener('click', insertSelected);
    $('bpSearch').addEventListener('input', () => renderMailList($('bpSearch').value.trim().toLowerCase()));
    document.addEventListener('keydown', onKey);
  }

  function onKey(e) {
    if (e.key === 'Escape' && !$('blocksPaletteOverlay').classList.contains('hidden')) {
      close();
    }
  }

  async function loadIndex(force) {
    $('bpMailsList').innerHTML = '<div class="bp-empty">Загрузка…</div>';
    try {
      const res = await fetch(`/api/blocks/by-mail${force ? '?force=1' : ''}`);
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || `HTTP ${res.status}`);
      cache = json;
      $('bpHint').textContent = `${json.mailsScanned} писем · ${json.totalBlocks} блоков`;
      renderMailList('');
    } catch (err) {
      $('bpMailsList').innerHTML = `<div class="bp-empty">Ошибка: ${escapeHtml(String(err.message || err))}</div>`;
    }
  }

  function renderMailList(filter) {
    if (!cache) return;
    const f = (filter || '').toLowerCase();
    const groups = cache.byMail.filter((g) => {
      if (!f) return true;
      const hay = `${g.category} ${g.mailId} ${g.blocks.map(b => b.name).join(' ')}`.toLowerCase();
      return hay.includes(f);
    });
    $('bpMailsCount').textContent = `(${groups.length})`;
    if (!groups.length) {
      $('bpMailsList').innerHTML = '<div class="bp-empty">Ничего не нашлось</div>';
      return;
    }
    const html = groups.map((g, idx) =>
      `<div class="bp-row" data-mail-idx="${idx}">
        <div class="bp-row-title">${escapeHtml(g.mailId)}</div>
        <div class="bp-row-sub">${escapeHtml(g.category)} · ${g.blocks.length} блок(ов)</div>
      </div>`
    ).join('');
    $('bpMailsList').innerHTML = html;
    $('bpMailsList').querySelectorAll('.bp-row').forEach((row) => {
      row.addEventListener('click', () => {
        $('bpMailsList').querySelectorAll('.bp-row.active').forEach((r) => r.classList.remove('active'));
        row.classList.add('active');
        const idx = Number(row.getAttribute('data-mail-idx'));
        selectedMail = groups[idx];
        renderBlocks();
      });
    });
  }

  function renderBlocks() {
    if (!selectedMail) return;
    $('bpBlocksCount').textContent = `(${selectedMail.blocks.length})`;
    const html = selectedMail.blocks.map((b, idx) =>
      `<div class="bp-row" data-block-idx="${idx}">
        <div class="bp-row-title">${escapeHtml(b.name)}</div>
        <div class="bp-row-sub">${b.lines} строк · ${b.placeholders.length} плейсхолдеров · ${b.assetCount} ассетов</div>
      </div>`
    ).join('');
    $('bpBlocksList').innerHTML = html;
    $('bpBlocksList').querySelectorAll('.bp-row').forEach((row) => {
      row.addEventListener('click', async () => {
        $('bpBlocksList').querySelectorAll('.bp-row.active').forEach((r) => r.classList.remove('active'));
        row.classList.add('active');
        const idx = Number(row.getAttribute('data-block-idx'));
        selectedBlock = selectedMail.blocks[idx];
        await loadSource();
      });
    });
    $('bpSource').innerHTML = '<code>Выберите блок</code>';
    $('bpBlockMeta').textContent = '';
    $('bpInsert').disabled = true;
  }

  async function loadSource() {
    if (!selectedBlock) return;
    const key = `${selectedBlock.category}|${selectedBlock.mailId}|${selectedBlock.blockFile}`;
    let text = sourceCache.get(key);
    $('bpBlockMeta').textContent = `${selectedBlock.blockFile} — загрузка…`;
    if (!text) {
      try {
        const url = `/api/blocks/source?category=${encodeURIComponent(selectedBlock.category)}&mailId=${encodeURIComponent(selectedBlock.mailId)}&blockFile=${encodeURIComponent(selectedBlock.blockFile)}`;
        const res = await fetch(url);
        const json = await res.json();
        if (!res.ok || !json.ok) throw new Error(json.error || `HTTP ${res.status}`);
        text = json.text;
        sourceCache.set(key, text);
      } catch (err) {
        $('bpSource').innerHTML = `<code>Ошибка: ${escapeHtml(String(err.message || err))}</code>`;
        $('bpBlockMeta').textContent = selectedBlock.blockFile;
        $('bpInsert').disabled = true;
        return;
      }
    }
    $('bpSource').innerHTML = `<code>${escapeHtml(text)}</code>`;
    $('bpBlockMeta').textContent = `${selectedBlock.blockFile} (${selectedBlock.lines} строк)`;
    $('bpInsert').disabled = false;
  }

  // Find every \${{ namespace.blockId }}$ in a string; return unique namespaces.
  function extractNamespaces(text) {
    const re = /\$\{\{\s*([\w-]+)\.[\w-]+\s*\}\}\$/g;
    const set = new Set();
    let m;
    while ((m = re.exec(text)) !== null) set.add(m[1]);
    return Array.from(set);
  }

  // Replace one namespace with another inside placeholders only — does not
  // touch text that happens to contain the same word elsewhere.
  function rewriteNamespace(text, from, to) {
    if (!from || !to || from === to) return text;
    const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(\\$\\{\\{\\s*)${escaped}(\\.[\\w-]+\\s*\\}\\}\\$)`, 'g');
    return text.replace(re, `$1${to}$2`);
  }

  // Try to read the current draft's "own" namespace, used as default rename target.
  function currentDraftNamespace() {
    const state = window.state;
    if (state && Array.isArray(state.namespaces)) {
      const ns = state.namespaces.find((n) => n.id === state.activeNamespaceId)
              || state.namespaces.find((n) => !n.builtin)
              || state.namespaces[0];
      if (ns) return ns.name;
    }
    return null;
  }

  // Show a resolver mini-modal listing the namespaces in the block. Returns a
  // Promise that resolves to a Map {fromNs -> toNs} (or null on cancel).
  function resolveNamespaceConflicts(namespaces) {
    return new Promise((resolve) => {
      if (!namespaces.length) { resolve(new Map()); return; }
      const current = currentDraftNamespace();
      const wrap = document.createElement('div');
      wrap.className = 'bp-resolver-overlay';
      wrap.innerHTML = `
        <div class="bp-resolver-modal">
          <h4>Namespace в этом блоке</h4>
          <p class="bp-resolver-hint">У блока ${namespaces.length} namespace(ов). Можно переименовать их в namespace текущего письма или оставить как есть.</p>
          <div class="bp-resolver-rows" id="bpResolverRows"></div>
          <div class="bp-resolver-actions">
            <button class="bp-btn" id="bpResolverCancel">Отмена</button>
            <button class="bp-btn primary" id="bpResolverApply">Применить и вставить</button>
          </div>
        </div>
      `;
      document.body.appendChild(wrap);
      const rowsEl = wrap.querySelector('#bpResolverRows');
      const state = {};
      for (const ns of namespaces) {
        const row = document.createElement('div');
        row.className = 'bp-resolver-row';
        const safeTarget = current && current !== ns ? current : ns;
        state[ns] = safeTarget;
        row.innerHTML = `
          <code>${escapeHtml(ns)}</code>
          <span>→</span>
          <input type="text" value="${escapeHtml(safeTarget)}" data-ns="${escapeHtml(ns)}" />
          <label><input type="checkbox" data-ns-keep="${escapeHtml(ns)}" ${safeTarget === ns ? 'checked' : ''}/> оставить как есть</label>
        `;
        rowsEl.appendChild(row);
      }
      rowsEl.addEventListener('input', (e) => {
        const ns = e.target.getAttribute('data-ns');
        if (ns) state[ns] = e.target.value.trim();
      });
      rowsEl.addEventListener('change', (e) => {
        const ns = e.target.getAttribute('data-ns-keep');
        if (ns) {
          const inp = rowsEl.querySelector(`input[data-ns="${ns}"]`);
          if (e.target.checked) {
            state[ns] = ns;
            if (inp) { inp.value = ns; inp.disabled = true; }
          } else {
            if (inp) { inp.disabled = false; }
          }
        }
      });
      const cleanup = () => { try { wrap.remove(); } catch {} };
      wrap.querySelector('#bpResolverCancel').addEventListener('click', () => { cleanup(); resolve(null); });
      wrap.querySelector('#bpResolverApply').addEventListener('click', () => {
        const map = new Map();
        for (const [from, to] of Object.entries(state)) {
          if (to && to !== from) map.set(from, to);
        }
        cleanup(); resolve(map);
      });
    });
  }

  async function insertSelected() {
    if (!selectedBlock) return;
    const key = `${selectedBlock.category}|${selectedBlock.mailId}|${selectedBlock.blockFile}`;
    const text = sourceCache.get(key);
    if (!text) return;

    const namespaces = extractNamespaces(text);
    let finalText = text;
    if (namespaces.length) {
      const map = await resolveNamespaceConflicts(namespaces);
      if (map === null) return; // user cancelled
      for (const [from, to] of map.entries()) {
        finalText = rewriteNamespace(finalText, from, to);
      }
    }

    const banner =
      `\n// imported from ${selectedBlock.category}/${selectedBlock.mailId}/${selectedBlock.blockFile}\n`;
    const snippet = banner + finalText + '\n';

    if (window.MonacoPilot && window.MonacoPilot.isEnabled && window.MonacoPilot.isEnabled()) {
      const val = window.MonacoPilot.getValue();
      window.MonacoPilot.setValue(val + snippet);
      if (typeof window.toast === 'function') window.toast('✓ Блок вставлен (в конец)', 'success', 2500);
      close();
      return;
    }
    if (window.cm && typeof window.cm.replaceSelection === 'function') {
      window.cm.replaceSelection(snippet, 'around');
      if (typeof window.updatePreview === 'function') {
        try { window.updatePreview(); } catch {}
      }
      if (typeof window.toast === 'function') window.toast('✓ Блок вставлен в редактор', 'success', 2500);
      close();
      return;
    }
    if (typeof window.toast === 'function') window.toast('Редактор не доступен', 'error');
  }

  function open() {
    ensureMarkup();
    $('blocksPaletteOverlay').classList.remove('hidden');
    if (!cache) loadIndex(false);
  }
  function close() {
    if ($('blocksPaletteOverlay')) $('blocksPaletteOverlay').classList.add('hidden');
  }

  window.BlocksPalette = { open, close, refresh: () => loadIndex(true), _extractNamespaces: extractNamespaces, _rewriteNamespace: rewriteNamespace };
})();


// Wire the header button + Ctrl+Alt+B shortcut.
(function wireBlocksPalette() {
  function init() {
    const btn = document.getElementById('blocksPaletteBtn');
    if (btn) btn.addEventListener('click', () => window.BlocksPalette.open());
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.altKey && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        window.BlocksPalette.open();
      }
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
