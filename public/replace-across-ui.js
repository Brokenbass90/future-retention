/* Workbench UI for RetKitReplaceAcross: "⇄ Во всех локалях".
 * Loaded after workbench.js; uses its globals (state, cm, getActiveCm, …). */
(function () {
  'use strict';
  const RA = window.RetKitReplaceAcross;
  if (!RA) return;

  let lastUndo = null;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => (typeof escapeHtml === 'function' ? escapeHtml(s) : String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]));

  function activeEditor() {
    try { return (typeof getActiveCm === 'function' && getActiveCm()) || (typeof cm !== 'undefined' ? cm : null); } catch { return null; }
  }

  function codeTarget() {
    const editor = activeEditor();
    if (!editor) return { editor: null, reason: 'Редактор не открыт' };
    if (state.srcCtx?.viewingCompiledHtml) return { editor: null, reason: 'Открыт собранный HTML — переключитесь на исходник, чтобы менять код' };
    if (editor.getOption?.('readOnly')) return { editor: null, reason: 'Редактор сейчас только для чтения' };
    return { editor, reason: '' };
  }

  function ensureUi() {
    if ($('rkRaBackdrop')) return;
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop hidden';
    backdrop.id = 'rkRaBackdrop';
    const modal = document.createElement('div');
    modal.className = 'modal hidden';
    modal.id = 'rkRaModal';
    modal.style.maxWidth = '640px';
    modal.innerHTML = `
      <div class="modal-header"><h2>⇄ Заменить во всём письме</h2><button class="modal-close" id="rkRaClose" title="Закрыть">✕</button></div>
      <div class="modal-body" style="gap:10px">
        <label style="display:grid;gap:4px;font-size:12px;color:var(--text-2)">Найти
          <input id="rkRaFind" type="text" spellcheck="false" style="font:13px var(--mono, monospace);padding:8px;border-radius:6px;border:1px solid var(--border, #334);background:var(--bg-2, #111);color:inherit"></label>
        <label style="display:grid;gap:4px;font-size:12px;color:var(--text-2)">Заменить на
          <input id="rkRaReplace" type="text" spellcheck="false" style="font:13px var(--mono, monospace);padding:8px;border-radius:6px;border:1px solid var(--border, #334);background:var(--bg-2, #111);color:inherit"></label>
        <div style="font-size:11.5px;color:var(--text-2);line-height:1.45">Ищет в коде письма и в каждой локали всех неймспейсов. <b>&amp;</b> и <b>&amp;amp;</b> считаются одним и тем же. Встроенные (🔒) неймспейсы не меняются.</div>
        <div id="rkRaResults" style="max-height:44vh;overflow:auto;display:grid;gap:4px"></div>
      </div>
      <div class="modal-footer" style="justify-content:space-between;gap:8px">
        <button class="btn-secondary" id="rkRaUndo" disabled>Отменить последнюю замену</button>
        <button class="btn-primary" id="rkRaApply" disabled>Заменить</button>
      </div>`;
    document.body.append(backdrop, modal);
    const close = () => { backdrop.classList.add('hidden'); modal.classList.add('hidden'); };
    backdrop.addEventListener('click', close);
    $('rkRaClose').addEventListener('click', close);
    let timer = null;
    const rescan = () => { clearTimeout(timer); timer = setTimeout(render, 140); };
    $('rkRaFind').addEventListener('input', rescan);
    $('rkRaReplace').addEventListener('input', rescan);
    $('rkRaFind').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('rkRaReplace').focus(); } });
    $('rkRaApply').addEventListener('click', applySelected);
    $('rkRaUndo').addEventListener('click', undoLast);
  }

  function currentPlan() {
    try { if (typeof flushLocaleEditorToState === 'function') flushLocaleEditorToState(); } catch {}
    const find = $('rkRaFind').value;
    const target = codeTarget();
    const plan = RA.plan({ code: target.editor ? target.editor.getValue() : '', namespaces: state.namespaces || [], find });
    return { plan, target };
  }

  function row(key, title, count, sampleText, { locked = false, disabled = false, note = '' } = {}) {
    const off = locked || disabled;
    return `<label class="validate-item ${off ? 'warn' : ''}" style="display:grid;grid-template-columns:auto 1fr auto;gap:8px;align-items:start;font-size:12.5px;${off ? 'opacity:.6' : ''}">
      <input type="checkbox" data-ra-key="${esc(key)}" ${off ? 'disabled' : 'checked'}>
      <span><strong>${esc(title)}</strong>${note ? ` <span style="color:var(--text-2)">— ${esc(note)}</span>` : ''}
        ${sampleText ? `<br><code style="font-size:11px;color:var(--text-2);white-space:pre-wrap;word-break:break-all">${esc(sampleText)}</code>` : ''}</span>
      <span style="color:var(--text-2)">${count}</span></label>`;
  }

  function render() {
    const host = $('rkRaResults');
    const { plan, target } = currentPlan();
    if (!plan.find) {
      host.innerHTML = '<div style="font-size:12px;color:var(--text-2)">Введите, что найти: URL картинки, ссылку, кусок текста или HTML.</div>';
      $('rkRaApply').disabled = true;
      return;
    }
    const parts = [];
    if (plan.code?.count) {
      parts.push(row('code', state.srcCtx ? 'Код письма (исходник — меняет все локали сразу)' : 'Код письма', plan.code.count, plan.code.sample,
        { disabled: !target.editor, note: target.reason }));
    } else if (!target.editor && target.reason) {
      parts.push(`<div style="font-size:12px;color:var(--text-2)">${esc(target.reason)}</div>`);
    }
    for (const item of plan.locales) {
      parts.push(row(`${item.nsId}|${item.locale}`, `${item.nsName} · ${String(item.locale).toUpperCase()}`, item.count, item.sample,
        { locked: item.locked, note: item.locked ? '🔒 встроенный, не меняется' : `блоки ${item.blockIndexes.map((i) => String(i).padStart(2, '0')).join(', ')}` }));
    }
    host.innerHTML = parts.length ? parts.join('') : '<div style="font-size:12px;color:var(--text-2)">Совпадений нет.</div>';
    for (const box of host.querySelectorAll('input[data-ra-key]')) box.addEventListener('change', updateApply);
    updateApply();
  }

  function selection() {
    const keys = [...$('rkRaResults').querySelectorAll('input[data-ra-key]:checked')].map((b) => b.dataset.raKey);
    return { code: keys.includes('code'), locales: new Set(keys.filter((k) => k !== 'code')) };
  }

  function updateApply() {
    const sel = selection();
    const n = (sel.code ? 1 : 0) + sel.locales.size;
    $('rkRaApply').disabled = n === 0;
    $('rkRaApply').textContent = n ? `Заменить в ${n} ${n === 1 ? 'месте' : 'местах'}` : 'Заменить';
  }

  function replaceWholeDoc(editor, text) {
    const last = editor.lastLine();
    editor.replaceRange(text, { line: editor.firstLine(), ch: 0 }, { line: last, ch: (editor.getLine(last) || '').length }, '+retkit-replace-across');
  }

  function refreshAfter(changedLocales) {
    try {
      if (state._editNsId && state._editLocale && changedLocales.some((p) => p.nsId === state._editNsId && p.locale === state._editLocale)) {
        loadLocaleIntoLocaleCM(state._editNsId, state._editLocale);
      }
    } catch {}
    try { refreshLocaleUiAfterStructureChange(); } catch { try { updatePreview(); } catch {} }
  }

  function applySelected() {
    const find = $('rkRaFind').value;
    const replacement = $('rkRaReplace').value;
    const target = codeTarget();
    const sel = selection();
    if (!target.editor) sel.code = false;
    const result = RA.apply({ code: target.editor ? target.editor.getValue() : '', namespaces: state.namespaces || [], find, replacement, selection: sel });
    if (!result.total) { toast('Нечего заменять', 'warning'); return; }
    if (sel.code && result.codeCount) replaceWholeDoc(target.editor, result.code);
    for (const patch of result.patches) {
      const ns = getNs(patch.nsId);
      if (!ns || ns.builtin) continue;
      ns.locales[patch.locale] = patch.blocks;
      syncLocaleRawFromBlocks(ns, patch.locale);
    }
    lastUndo = { editor: sel.code && result.codeCount ? target.editor : null, code: result.undo.code, locales: result.undo.locales, at: Date.now() };
    refreshAfter(result.patches);
    $('rkRaUndo').disabled = false;
    toast(`Заменено: ${result.total} (${result.patches.length} локалей${result.codeCount ? ' + код' : ''})`, 'success', 4000);
    render();
  }

  function undoLast() {
    if (!lastUndo) return;
    if (lastUndo.editor) replaceWholeDoc(lastUndo.editor, lastUndo.code);
    for (const item of lastUndo.locales) {
      const ns = getNs(item.nsId);
      if (!ns) continue;
      ns.locales[item.locale] = item.blocks;
      syncLocaleRawFromBlocks(ns, item.locale);
    }
    refreshAfter(lastUndo.locales);
    lastUndo = null;
    $('rkRaUndo').disabled = true;
    toast('Замена отменена', 'success');
    render();
  }

  function open() {
    ensureUi();
    const editor = activeEditor();
    const picked = editor?.getSelection?.() || '';
    if (picked && picked.length <= 400 && !picked.includes('\n')) $('rkRaFind').value = picked;
    $('rkRaBackdrop').classList.remove('hidden');
    $('rkRaModal').classList.remove('hidden');
    render();
    $('rkRaFind').focus();
    $('rkRaFind').select();
  }

  function mountButton() {
    if ($('replaceAcrossBtn')) return;
    const anchor = $('downloadHtmlBtn');
    if (!anchor) return;
    const button = document.createElement('button');
    button.className = 'editor-action-btn';
    button.id = 'replaceAcrossBtn';
    button.title = 'Найти и заменить во всём письме: код + все локали (⌘⇧H). Выдели URL картинки в коде — он подставится сам.';
    button.textContent = '⇄ Во всех локалях';
    button.addEventListener('click', open);
    anchor.parentNode.insertBefore(button, anchor);
  }

  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && String(e.key).toLowerCase() === 'h') { e.preventDefault(); open(); }
  });
  mountButton();
  window.RetKitReplaceAcrossUi = { open };
})();
