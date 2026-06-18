/**
 * placeholders-sidebar.js — slim sidebar listing every placeholder
 * present in the current draft.
 *
 * What it shows for each occurrence (in document order):
 *   [NN]  namespace.blockId    ┊ preview of locale value (if loaded)
 *                              click → copy ${{ ns.block }}$ to clipboard
 *
 * Why it lives on the side (not at the bottom): the user explicitly asked
 * for a non-obtrusive lateral position so they can reach for a token
 * without breaking flow. The panel is collapsible by default; state is
 * persisted in localStorage.
 *
 * Auto-refresh: re-scans the editor content on `cm` change (debounced),
 * plus a manual "refresh" trigger when MonacoPilot is active (Monaco
 * mirrors back into cm, so cm change events still fire).
 *
 * Wired with workbench.js via:
 *   - global window.cm (CodeMirror)
 *   - global window.state.namespaces (locale data for preview values)
 *   - global window.state.activeLocale (current locale)
 */

(function () {
  'use strict';

  const LS_KEY = 'placeholders-sidebar-collapsed';
  const PLACEHOLDER_RE = /\$\{\{\s*([\w-]+)\.([\w-]+)\s*\}\}\$/g;
  let panel, listEl, badgeEl, toggleBtn, hostMounted = false;
  let debounceTimer = null;

  function $(id) { return document.getElementById(id); }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /** Find placeholders in the editor's current value, return ordered list. */
  function scanPlaceholders() {
    const text = (window.cm && typeof window.cm.getValue === 'function')
      ? window.cm.getValue() : '';
    const out = [];
    PLACEHOLDER_RE.lastIndex = 0;
    let m;
    while ((m = PLACEHOLDER_RE.exec(text)) !== null) {
      out.push({
        n: out.length + 1,
        namespace: m[1],
        blockId: m[2],
        raw: m[0],
        index: m.index,
      });
    }
    return out;
  }

  /** Look up the value of a placeholder in the active locale. */
  function lookupValue(namespace, blockId) {
    const state = window.state;
    if (!state || !Array.isArray(state.namespaces)) return null;
    const ns = state.namespaces.find((n) => n.name === namespace);
    if (!ns) return null;
    const loc = state.activeLocale || 'en';
    const blocks = ns.locales?.[loc] || ns.locales?.en;
    if (!blocks) return null;
    // Array form: ["Hello", ...] keyed by "block_NN" index.
    if (Array.isArray(blocks)) {
      const match = blockId.match(/_(\d+)/);
      if (match) {
        const i = parseInt(match[1], 10);
        if (i >= 0 && i < blocks.length) {
          const b = blocks[i];
          return typeof b === 'string' ? b : (b?.text || b?.value || null);
        }
      }
      return null;
    }
    // Object form: { unsubscribe: "...", conditions: "..." } keyed by blockId.
    if (typeof blocks === 'object') {
      const v = blocks[blockId];
      if (typeof v === 'string') return v;
      if (v && typeof v === 'object') return v.text || v.value || null;
    }
    return null;
  }

  function ensureMarkup() {
    if (panel) return;
    panel = document.createElement('aside');
    panel.id = 'phSidebar';
    panel.className = 'ph-sidebar';
    panel.innerHTML = `
      <div class="ph-sidebar-head">
        <button class="ph-sidebar-toggle" id="phSbToggle" aria-label="Свернуть">⟩</button>
        <div class="ph-sidebar-title">Плейсхолдеры <span class="ph-sidebar-badge" id="phSbBadge">0</span></div>
      </div>
      <div class="ph-sidebar-list" id="phSbList"></div>
    `;
    document.body.appendChild(panel);
    listEl = $('phSbList');
    badgeEl = $('phSbBadge');
    toggleBtn = $('phSbToggle');
    toggleBtn.addEventListener('click', toggleCollapsed);
    // Restore collapsed state.
    if (localStorage.getItem(LS_KEY) === '1') panel.classList.add('collapsed');
    hostMounted = true;
  }

  function toggleCollapsed() {
    panel.classList.toggle('collapsed');
    localStorage.setItem(LS_KEY, panel.classList.contains('collapsed') ? '1' : '0');
  }

  /** Copy a placeholder token to clipboard. Returns boolean success. */
  async function copyToClipboard(token) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(token);
        return true;
      }
    } catch { /* fall through */ }
    // Legacy fallback.
    try {
      const ta = document.createElement('textarea');
      ta.value = token;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      return true;
    } catch { return false; }
  }

  /** Scroll the CodeMirror editor to a specific offset (best-effort). */
  function jumpToOffset(offset) {
    if (!window.cm || typeof window.cm.posFromIndex !== 'function') return;
    try {
      const pos = window.cm.posFromIndex(offset);
      window.cm.scrollIntoView(pos, 120);
      window.cm.setCursor(pos);
      // Briefly highlight the line.
      const lineHandle = window.cm.getLineHandle(pos.line);
      if (lineHandle) {
        window.cm.addLineClass(lineHandle, 'background', 'ph-flash');
        setTimeout(() => window.cm.removeLineClass(lineHandle, 'background', 'ph-flash'), 1100);
      }
    } catch { /* swallow */ }
  }

  function render() {
    if (!hostMounted) return;
    const items = scanPlaceholders();
    badgeEl.textContent = String(items.length);
    if (!items.length) {
      listEl.innerHTML = '<div class="ph-sidebar-empty">В draft нет плейсхолдеров</div>';
      return;
    }
    const html = items.map((it) => {
      const val = lookupValue(it.namespace, it.blockId);
      const valPreview = val ? `<span class="ph-sb-value">${escapeHtml(val.slice(0, 80))}</span>` : '';
      return `<div class="ph-sb-row" data-idx="${it.index}" data-token="${escapeHtml(it.raw)}" title="Кликни — скопировать. Двойной клик — прыжок к этому месту">
        <span class="ph-sb-num">${String(it.n).padStart(2, '0')}</span>
        <span class="ph-sb-id">${escapeHtml(it.namespace)}.${escapeHtml(it.blockId)}</span>
        ${valPreview}
      </div>`;
    }).join('');
    listEl.innerHTML = html;
    // Wire rows.
    listEl.querySelectorAll('.ph-sb-row').forEach((row) => {
      row.addEventListener('click', async (e) => {
        const token = row.getAttribute('data-token');
        const ok = await copyToClipboard(token);
        flashRow(row, ok ? 'copied' : 'fail');
        if (typeof window.toast === 'function' && ok) {
          window.toast(`✓ Скопировано: ${token}`, 'success', 1800);
        }
      });
      row.addEventListener('dblclick', () => {
        const offset = Number(row.getAttribute('data-idx'));
        if (Number.isFinite(offset)) jumpToOffset(offset);
      });
    });
  }

  function flashRow(el, klass) {
    el.classList.add(`ph-sb-flash-${klass}`);
    setTimeout(() => el.classList.remove(`ph-sb-flash-${klass}`), 700);
  }

  function scheduleRender() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(render, 200);
  }

  function bindEditorEvents() {
    if (window.cm && typeof window.cm.on === 'function' && !window.cm._phSbBound) {
      window.cm.on('change', scheduleRender);
      window.cm._phSbBound = true;
    }
  }

  // Public API for external triggers (e.g. when Monaco mirrors content back).
  window.PlaceholdersSidebar = {
    refresh: render,
    show() { if (panel) panel.classList.remove('hidden'); },
    hide() { if (panel) panel.classList.add('hidden'); },
    toggle: toggleCollapsed,
    // Test hook.
    _scan: scanPlaceholders,
    _lookup: lookupValue,
  };

  function init() {
    ensureMarkup();
    bindEditorEvents();
    // First-render attempt + a fallback poll in case cm isn't ready yet.
    let tries = 0;
    const tryRender = () => {
      if (window.cm) { bindEditorEvents(); render(); return; }
      if (tries++ < 20) setTimeout(tryRender, 250);
    };
    tryRender();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
