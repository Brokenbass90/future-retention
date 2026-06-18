/**
 * locale-compare.js — side-by-side comparison of two locales within the
 * currently active namespace.
 *
 * Why not in-editor split: the workbench locale editor (CodeMirror) is
 * tightly bound to single-locale state. Adding a true split would touch
 * a lot of plumbing. Instead this is a focused modal with two read-only
 * columns aligned per block index — exactly the use case "see RU and AR
 * blocks next to each other to spot length/format issues".
 *
 * Trigger: header button or Ctrl+Alt+L. Pickers default to the current
 * active locale (left) and the next available locale (right).
 *
 * Uses window.state.namespaces + state.activeNamespaceId / activeLocale.
 */

(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function ensureMarkup() {
    if ($('localeCompareOverlay')) return;
    const div = document.createElement('div');
    div.id = 'localeCompareOverlay';
    div.className = 'lc-overlay hidden';
    div.innerHTML = `
      <div class="lc-modal" role="dialog">
        <div class="lc-header">
          <h3>Сравнение локалей</h3>
          <div class="lc-pickers">
            <label>Слева: <select id="lcLeft"></select></label>
            <label>Справа: <select id="lcRight"></select></label>
          </div>
          <button class="lc-close" id="lcClose" aria-label="Close">×</button>
        </div>
        <div class="lc-meta" id="lcMeta"></div>
        <div class="lc-body" id="lcBody">
          <div class="lc-empty">Выбери две локали выше</div>
        </div>
      </div>
    `;
    document.body.appendChild(div);
    $('lcClose').addEventListener('click', close);
    div.addEventListener('click', (e) => { if (e.target === div) close(); });
    $('lcLeft').addEventListener('change', render);
    $('lcRight').addEventListener('change', render);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !$('localeCompareOverlay').classList.contains('hidden')) close();
    });
  }

  function activeNamespace() {
    const state = window.state;
    if (!state || !Array.isArray(state.namespaces) || !state.namespaces.length) return null;
    return state.namespaces.find((n) => n.id === state.activeNamespaceId) || state.namespaces[0];
  }

  function localeOptions(ns) {
    if (!ns) return [];
    const out = new Set();
    if (ns.locales) Object.keys(ns.locales).forEach((k) => out.add(k));
    if (ns.localeRaw) Object.keys(ns.localeRaw).forEach((k) => out.add(k));
    return Array.from(out).sort();
  }

  function blockArray(ns, code) {
    if (!ns || !ns.locales) return [];
    const v = ns.locales[code];
    if (Array.isArray(v)) {
      return v.map((b) => typeof b === 'string' ? b : (b?.text || b?.value || ''));
    }
    if (v && typeof v === 'object') {
      // Object form (e.g. footer): preserve insertion order.
      return Object.entries(v).map(([k, val]) => `${k}: ${typeof val === 'string' ? val : ''}`);
    }
    return [];
  }

  function fillPickers() {
    const ns = activeNamespace();
    const opts = localeOptions(ns);
    const left = $('lcLeft'), right = $('lcRight');
    left.innerHTML = ''; right.innerHTML = '';
    if (!opts.length) {
      $('lcMeta').textContent = 'Нет загруженных локалей. Открой namespace с локалями в studio.';
      return;
    }
    for (const code of opts) {
      const o1 = document.createElement('option'); o1.value = code; o1.textContent = code;
      const o2 = o1.cloneNode(true);
      left.appendChild(o1); right.appendChild(o2);
    }
    // Defaults: active locale on the left, first different on the right.
    const active = window.state?.activeLocale;
    if (active && opts.includes(active)) left.value = active;
    else left.value = opts[0];
    const second = opts.find((c) => c !== left.value);
    if (second) right.value = second;
    $('lcMeta').textContent = `Namespace: ${ns ? ns.name : '—'} · доступно ${opts.length} локалей`;
  }

  function render() {
    const ns = activeNamespace();
    const left = $('lcLeft').value, right = $('lcRight').value;
    if (!ns || !left || !right) { $('lcBody').innerHTML = '<div class="lc-empty">Выбери две локали выше</div>'; return; }
    const a = blockArray(ns, left);
    const b = blockArray(ns, right);
    const n = Math.max(a.length, b.length);
    if (!n) { $('lcBody').innerHTML = '<div class="lc-empty">В этом namespace нет блоков для выбранных локалей</div>'; return; }
    const rows = [];
    for (let i = 0; i < n; i += 1) {
      const av = a[i] || '';
      const bv = b[i] || '';
      const diff = av.length !== bv.length;
      rows.push(`<div class="lc-row${diff ? ' diff' : ''}">
        <span class="lc-num">${String(i+1).padStart(2,'0')}</span>
        <div class="lc-cell">${esc(av) || '<i class="lc-empty-cell">—</i>'}</div>
        <div class="lc-cell">${esc(bv) || '<i class="lc-empty-cell">—</i>'}</div>
      </div>`);
    }
    $('lcBody').innerHTML = `
      <div class="lc-row lc-head">
        <span class="lc-num">#</span>
        <div class="lc-cell">${esc(left)}</div>
        <div class="lc-cell">${esc(right)}</div>
      </div>
      ${rows.join('')}
    `;
  }

  function open() {
    ensureMarkup();
    fillPickers();
    render();
    $('localeCompareOverlay').classList.remove('hidden');
  }
  function close() {
    if ($('localeCompareOverlay')) $('localeCompareOverlay').classList.add('hidden');
  }

  window.LocaleCompare = { open, close, _blockArray: blockArray, _localeOptions: localeOptions };

  // Hotkey + button wiring.
  function wire() {
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.altKey && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        open();
      }
    });
    const btn = $('localeCompareBtn');
    if (btn) btn.addEventListener('click', open);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
  else wire();
})();
