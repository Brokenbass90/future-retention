/**
 * public/outline-mode.js — Outline panel that lists the source-pug blocks of
 * the currently-open mail and lets the user insert canonical blocks at any
 * position (not just at the cursor).
 *
 * Replaces the floating "Конструктор блоков" carousel, which only inserted
 * at the CodeMirror cursor and was unusable for editing multi-hundred-line
 * existing emails.
 *
 * Depends on:
 *   - window.OutlineParse (from outline-parse.js) — pure parser
 *   - window.WB.insertEmailBlock(block, { line, before })
 *   - window.WB.getActiveCm() — current CodeMirror instance
 *   - window.WB.getSrcCtx() — { brand, mail, activeFile, modified, ... }
 *   - window.WB.onFileChange(cb) — re-fires when a new source file is loaded
 *
 * Server endpoints:
 *   - GET /api/blocks-library → list of canonical + user blocks
 */

(function () {
  'use strict';

  // ─── State ──────────────────────────────────────────────────────────
  let enabled = false;                    // toggle state
  let parsed = [];                        // array of { id?, label, startLine, endLine, kind }
  let libraryCache = null;                // [{ id, label, placement, ... }]
  let pickerInsertAfterIndex = null;      // -1 = top, N = after block N
  let pickerActiveTab = 'canonical';

  // ─── DOM refs ───────────────────────────────────────────────────────
  const $ = (id) => document.getElementById(id);
  const refs = () => ({
    toggleBtn: $('outlineToggleBtn'),
    rail:      $('outlineRail'),
    list:      $('outlineList'),
    count:     $('outlineCount'),
    addTopBtn: $('outlineAddTopBtn'),
    picker:       $('outlinePicker'),
    pickerList:   $('outlinePickerList'),
    pickerClose:  $('outlinePickerClose'),
    pickerTabs:   document.querySelectorAll('.outline-picker-tab'),
  });

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ─── Parsing ────────────────────────────────────────────────────────
  function reparse() {
    const cm = window.WB?.getActiveCm?.();
    if (!cm || !enabled) { parsed = []; renderList(); return; }
    const text = cm.getValue();
    parsed = window.OutlineParse.parseSourcePugBlocks(text);
    renderList();
  }

  // ─── Render outline list ─────────────────────────────────────────────
  function renderList() {
    const { list, count } = refs();
    if (!list) return;
    if (!parsed.length) {
      list.innerHTML = '<div class="outline-rail-empty">Нет блоков. Открой .pug файл письма или нажми «В начало».</div>';
      if (count) count.textContent = '0 блоков';
      return;
    }
    let html = '';
    parsed.forEach((b, i) => {
      const labelEsc = escapeHtml(b.label);
      const kindBadge = b.kind === 'marker' ? '<span class="outline-block-kind">id</span>' : '';
      html += `
        <div class="outline-block" data-idx="${i}" data-startline="${b.startLine}" data-endline="${b.endLine}">
          <span class="outline-block-num">#${i + 1}</span>
          <span class="outline-block-label" title="L${b.startLine + 1}-${b.endLine + 1}">${labelEsc}</span>
          ${kindBadge}
          <button class="outline-block-del" data-del-idx="${i}" title="Удалить блок">✕</button>
        </div>
        <div class="outline-insert-zone">
          <button class="outline-insert-btn" data-insert-after="${i}" title="Вставить блок после #${i + 1}">＋ вставить блок</button>
        </div>
      `;
    });
    list.innerHTML = html;
    if (count) count.textContent = parsed.length + ' блок' + plural(parsed.length, ['', 'а', 'ов']);

    // Wire events
    list.querySelectorAll('.outline-block').forEach((el) => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('.outline-block-del')) return;
        const idx = Number(el.getAttribute('data-idx'));
        scrollToBlock(idx);
      });
    });
    list.querySelectorAll('.outline-block-del').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = Number(btn.getAttribute('data-del-idx'));
        deleteBlock(idx);
      });
    });
    list.querySelectorAll('.outline-insert-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const idx = Number(btn.getAttribute('data-insert-after'));
        openPicker(idx, btn);
      });
    });
  }

  function plural(n, forms) {
    const mod10 = n % 10, mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return forms[0];
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return forms[1];
    return forms[2];
  }

  // ─── Scroll-to-block ─────────────────────────────────────────────────
  function scrollToBlock(idx) {
    const b = parsed[idx];
    if (!b) return;
    const cm = window.WB?.getActiveCm?.();
    if (!cm) return;
    // Highlight outline row
    document.querySelectorAll('.outline-block').forEach((el) => el.classList.remove('active'));
    const row = document.querySelector(`.outline-block[data-idx="${idx}"]`);
    if (row) row.classList.add('active');
    // Scroll CodeMirror + select range
    cm.scrollIntoView({ line: b.startLine, ch: 0 }, 80);
    cm.setSelection({ line: b.startLine, ch: 0 }, { line: b.endLine, ch: cm.getLine(b.endLine)?.length ?? 0 });
    cm.focus();
    // Best-effort: scroll the iframe preview to the Nth top-level table.row.
    try {
      const iframe = document.getElementById('previewFrame');
      const win = iframe?.contentWindow;
      if (win) {
        const doc = win.document;
        const rows = doc.querySelectorAll('table.row, table[class*="row"]');
        const target = rows[idx];
        if (target && target.scrollIntoView) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    } catch { /* cross-origin or not loaded */ }
  }

  // ─── Delete block ────────────────────────────────────────────────────
  function deleteBlock(idx) {
    const b = parsed[idx];
    if (!b) return;
    if (!confirm(`Удалить блок #${idx + 1} (${b.label})?\nСтроки ${b.startLine + 1}–${b.endLine + 1} будут удалены из источника.`)) return;
    const cm = window.WB?.getActiveCm?.();
    if (!cm) return;
    const from = { line: b.startLine, ch: 0 };
    const lastLine = cm.lastLine();
    const to = b.endLine >= lastLine
      ? { line: lastLine, ch: cm.getLine(lastLine)?.length ?? 0 }
      : { line: b.endLine + 1, ch: 0 };
    cm.replaceRange('', from, to);
    setTimeout(reparse, 0);
  }

  // ─── Picker ──────────────────────────────────────────────────────────
  async function openPicker(insertAfterIdx, anchorEl) {
    pickerInsertAfterIndex = insertAfterIdx;
    const { picker, pickerList } = refs();
    if (!picker) return;
    // Position near anchor — try right of editor pane
    const rect = anchorEl.getBoundingClientRect();
    picker.style.left = Math.min(rect.right + 8, window.innerWidth - 340) + 'px';
    picker.style.top  = Math.min(rect.top, window.innerHeight - 460) + 'px';
    picker.classList.remove('hidden');
    pickerList.innerHTML = '<div class="outline-rail-empty">Загрузка…</div>';
    if (!libraryCache) {
      try {
        const res = await fetch('/api/blocks-library');
        const data = await res.json();
        libraryCache = Array.isArray(data?.blocks) ? data.blocks : (Array.isArray(data) ? data : []);
      } catch (e) {
        pickerList.innerHTML = '<div class="outline-rail-empty">Не удалось загрузить /api/blocks-library: ' + escapeHtml(e.message) + '</div>';
        return;
      }
    }
    renderPickerList();
  }

  function renderPickerList() {
    const { pickerList } = refs();
    const items = (libraryCache || []).filter((b) =>
      pickerActiveTab === 'user' ? b.source === 'user' : (b.source !== 'user')
    );
    if (!items.length) {
      pickerList.innerHTML = `<div class="outline-rail-empty">Нет блоков в категории «${pickerActiveTab === 'user' ? 'User' : 'Canonical'}».</div>`;
      return;
    }
    pickerList.innerHTML = items.map((b) => `
      <div class="outline-picker-card" data-block-id="${escapeHtml(b.id)}">
        <div class="outline-picker-card-title">${escapeHtml(b.label || b.id)}</div>
        <div class="outline-picker-card-desc">${escapeHtml(b.description || '')}</div>
        <div class="outline-picker-card-meta">
          <span class="pill">${escapeHtml(b.placement || '?')}</span>
          <span class="pill">${escapeHtml(b.category || '?')}</span>
          <span class="pill">${(b.slots || []).length} slot${(b.slots || []).length === 1 ? '' : 's'}</span>
        </div>
      </div>
    `).join('');
    pickerList.querySelectorAll('.outline-picker-card').forEach((card) => {
      card.addEventListener('click', () => insertBlockFromPicker(card.dataset.blockId));
    });
  }

  function closePicker() {
    const { picker } = refs();
    if (picker) picker.classList.add('hidden');
    pickerInsertAfterIndex = null;
  }

  function insertBlockFromPicker(blockId) {
    const block = (libraryCache || []).find((b) => b.id === blockId);
    if (!block) return;
    const placement = window.OutlineParse.placementForInsertAfter(parsed, pickerInsertAfterIndex);
    closePicker();
    // window.WB.insertEmailBlock expects { id, pug, html, label } object — already
    // the shape of canonical blocks (they have .id, .pug, .label). For inline
    // blocks the `pug` field is what gets inserted at the line.
    const blk = {
      id: block.id,
      label: block.label || block.id,
      pug: block.pug || '',
      html: block.html || '',
    };
    if (!blk.pug && !blk.html) {
      alert('У блока нет pug-содержимого.');
      return;
    }
    window.WB?.insertEmailBlock?.(blk, placement);
    setTimeout(reparse, 200);
  }

  // ─── Toggle ──────────────────────────────────────────────────────────
  function setEnabled(on) {
    enabled = !!on;
    const { toggleBtn, rail } = refs();
    if (toggleBtn) toggleBtn.setAttribute('aria-pressed', String(enabled));
    if (rail) rail.classList.toggle('hidden', !enabled);
    if (enabled) reparse();
  }

  function shouldShowToggleButton() {
    const ctx = window.WB?.getSrcCtx?.();
    if (!ctx?.activeFile) return false;
    const ext = ctx.activeFile.split('.').pop()?.toLowerCase();
    return ext === 'pug' || ext === 'jade';
  }

  function refreshToggleVisibility() {
    const { toggleBtn } = refs();
    if (!toggleBtn) return;
    if (shouldShowToggleButton()) {
      toggleBtn.classList.remove('hidden');
      if (enabled) reparse(); // file changed while outline open → re-render
    } else {
      toggleBtn.classList.add('hidden');
      setEnabled(false);
    }
  }

  // ─── Wire-up on DOM ready ────────────────────────────────────────────
  function init() {
    const { toggleBtn, addTopBtn, pickerClose, pickerTabs } = refs();
    if (!toggleBtn) {
      console.warn('[outline-mode] #outlineToggleBtn missing — outline disabled');
      return;
    }
    toggleBtn.addEventListener('click', () => setEnabled(!enabled));
    addTopBtn?.addEventListener('click', (e) => openPicker(-1, e.currentTarget));
    pickerClose?.addEventListener('click', closePicker);
    pickerTabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        pickerActiveTab = tab.dataset.tab;
        pickerTabs.forEach((t) => t.classList.toggle('active', t === tab));
        renderPickerList();
      });
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closePicker();
    });
    // Close picker on outside click
    document.addEventListener('mousedown', (e) => {
      const { picker } = refs();
      if (!picker || picker.classList.contains('hidden')) return;
      if (!picker.contains(e.target) && !e.target.closest('.outline-insert-btn, #outlineAddTopBtn')) {
        closePicker();
      }
    });

    // Subscribe to source-file changes from workbench.js
    window.WB?.onFileChange?.(refreshToggleVisibility);
    // First check after DOMContentLoaded
    refreshToggleVisibility();

    // Debounced re-parse on CodeMirror changes
    let cmDebounce = null;
    const hookCm = () => {
      const cm = window.WB?.getActiveCm?.();
      if (!cm || cm._outlineHooked) return;
      cm._outlineHooked = true;
      cm.on('change', () => {
        if (!enabled) return;
        clearTimeout(cmDebounce);
        cmDebounce = setTimeout(reparse, 350);
      });
    };
    // Try hooking now and on each file change.
    hookCm();
    window.WB?.onFileChange?.(hookCm);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
