/* global state, cm, getActiveCm, getNs, syncLocaleRawFromBlocks, flushLocaleEditorToState, loadLocaleIntoLocaleCM, refreshLocaleUiAfterStructureChange, updatePreview, doFindAll, openFindBar, toast -- defined by workbench.js (loaded first) */
/* Workbench: ⌘F → "Во всех локалях" strip under the find bar.
 * Same behaviour as RetKit for MoEngage: one "Заменить…" field, per-locale
 * counts, click a chip to see where, & == &amp;, image-by-file-name mode,
 * built-in (🔒) namespaces never change, one-click undo of the last bulk replace.
 * Loaded after workbench.js; uses its globals (state, cm, getActiveCm, …). */
(function () {
  'use strict';
  const RA = window.RetKitReplaceAcross;
  if (!RA) return;

  const $ = (id) => document.getElementById(id);
  const KIND = { image: 'картинка', link: 'ссылка', background: 'фон', attribute: 'атрибут', text: 'текст' };
  let lastUndo = null;
  let lastPlan = null;
  let detailsKey = '';
  // Own replacement per place for the current query: { code|'nsId|locale': value }.
  let overrides = {};
  let overridesQuery = '';
  const hasOwn = (key) => Object.prototype.hasOwnProperty.call(overrides, key);
  let scanTimer = null;
  // Набор в поиске ищет только в открытом редакторе. По всем локалям —
  // только по кнопке «Искать во всех локалях» (как в RetKit for MoEngage).
  let scannedKey = '';

  function findEditor() {
    try { return (typeof getActiveCm === 'function' && getActiveCm()) || (typeof cm !== 'undefined' ? cm : null); } catch { return null; }
  }

  function codeTarget() {
    const editor = findEditor();
    if (!editor) return { editor: null, reason: 'редактор не открыт' };
    if (state.srcCtx?.viewingCompiledHtml) return { editor: null, reason: 'открыт собранный HTML — код меняется в исходнике' };
    if (editor.getOption?.('readOnly')) return { editor: null, reason: 'редактор только для чтения' };
    return { editor, reason: '' };
  }

  function mode() { return $('rkRaMode')?.checked ? 'filename' : 'text'; }

  function injectStyle() {
    if ($('rkRaStyle')) return;
    const style = document.createElement('style');
    style.id = 'rkRaStyle';
    style.textContent = `
      #rkRaStrip { display:grid; gap:6px; padding:6px 10px 8px; background:var(--surface-2); border-bottom:1px solid var(--border); font-size:12px; }
      #rkRaStrip.hidden { display:none; }
      #rkRaStrip .ra-head { display:flex; gap:10px; align-items:center; color:var(--text-2); }
      #rkRaStrip .ra-head strong { color:var(--text-1, inherit); }
      #rkRaStrip .ra-chips { display:flex; flex-wrap:wrap; gap:5px; }
      #rkRaStrip .ra-chip { display:inline-flex; gap:5px; align-items:center; padding:3px 8px; border:1px solid var(--border); border-radius:7px; background:var(--surface-3, var(--surface-2)); }
      #rkRaStrip .ra-chip[data-locked="1"] { opacity:.55; }
      #rkRaStrip .ra-chip[data-active="1"] { border-color:var(--accent, #4f7cff); }
      #rkRaStrip .ra-chip span { cursor:pointer; }
      #rkRaStrip .ra-details { display:grid; gap:3px; }
      #rkRaStrip .ra-hit { display:grid; grid-template-columns:auto 1fr; gap:8px; align-items:center; font-size:11.5px; color:var(--text-2); }
      #rkRaStrip .ra-hit .find-input { min-width:0; width:100%; }
      #rkRaStrip .ra-hit code { white-space:pre-wrap; word-break:break-all; font:11px var(--mono, ui-monospace, monospace); }
      #rkRaStrip .ra-hit mark { background:#5a4a12; color:#ffe9a6; border-radius:2px; }
      #rkRaStrip .ra-actions { display:flex; gap:6px; align-items:center; flex-wrap:wrap; }
      #rkRaStrip .ra-note { color:var(--text-3, var(--text-2)); }
    `;
    document.head.appendChild(style);
  }

  function ensureStrip() {
    let strip = $('rkRaStrip');
    if (strip) return strip;
    const bar = $('findBar');
    if (!bar) return null;
    injectStyle();
    strip = document.createElement('div');
    strip.id = 'rkRaStrip';
    strip.className = 'hidden';
    strip.innerHTML = `
      <div class="ra-head"><strong>Во всех локалях</strong>
        <label id="rkRaModeLabel" title="В каждой локали картинка может лежать по своему адресу. Ищет все URL с тем же именем файла и меняет URL целиком." style="display:none;cursor:pointer"><input type="checkbox" id="rkRaMode"> та же картинка по имени файла</label>
        <span class="ra-note" title="Ссылка с & находится и в виде &amp;amp;; замена пишется в той же кодировке">&amp; = &amp;amp;</span></div>
      <div class="ra-chips" id="rkRaChips"></div>
      <div class="ra-actions" id="rkRaSearchRow"><span class="ra-note">Сейчас ищем только в открытом редакторе.</span>
        <button class="find-btn" id="rkRaSearch">Искать во всех локалях</button></div>
      <div class="ra-details" id="rkRaDetails"></div>
      <div class="ra-actions"><span class="ra-note">Замена — из поля «Заменить…» выше.</span>
        <button class="find-btn" id="rkRaApply" disabled>Заменить везде</button>
        <button class="find-btn" id="rkRaUndo" style="display:none">Отменить последнюю замену</button></div>`;
    bar.insertAdjacentElement('afterend', strip);
    $('rkRaMode').addEventListener('change', () => { scannedKey = ''; scheduleScan(); });
    $('rkRaSearch').addEventListener('click', searchAll);
    $('rkRaApply').addEventListener('click', applySelected);
    $('rkRaUndo').addEventListener('click', undoLast);
    return strip;
  }

  function scheduleScan() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(render, 140);
  }

  const queryKey = () => `${mode()}|${String($('findInput')?.value || '')}`;

  function searchAll() {
    scannedKey = queryKey();
    render();
  }

  function chip(key, label, count, { locked = false, disabled = false, title = '' } = {}) {
    const off = locked || disabled;
    const wrap = document.createElement('label');
    wrap.className = 'ra-chip';
    wrap.dataset.key = key;
    if (off) wrap.dataset.locked = '1';
    if (key === detailsKey) wrap.dataset.active = '1';
    wrap.title = title;
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.dataset.raKey = key;
    box.checked = !off;
    box.disabled = off;
    box.addEventListener('change', updateApply);
    const text = document.createElement('span');
    text.textContent = `${locked ? '🔒 ' : ''}${label} · ${count}${hasOwn(key) ? ' ✎' : ''}`;
    text.addEventListener('click', (event) => { event.preventDefault(); detailsKey = key; renderDetails(); markActive(); });
    wrap.append(box, text);
    return wrap;
  }

  function markActive() {
    for (const el of document.querySelectorAll('#rkRaChips .ra-chip')) el.dataset.active = el.dataset.key === detailsKey ? '1' : '';
  }

  function renderDetails() {
    const host = $('rkRaDetails');
    host.replaceChildren();
    if (!lastPlan) return;
    const entry = detailsKey === 'code'
      ? { label: 'Код', hits: lastPlan.code?.hits || [], count: lastPlan.code?.count || 0 }
      : (() => {
        const item = lastPlan.locales.find((l) => `${l.nsId}|${l.locale}` === detailsKey);
        return item ? { label: `${item.nsName}·${String(item.locale).toUpperCase()}`, hits: item.hits, count: item.count } : null;
      })();
    if (!entry) return;
    const lockedEntry = detailsKey !== 'code' && lastPlan.locales.find((l) => `${l.nsId}|${l.locale}` === detailsKey)?.locked;
    if (!lockedEntry) {
      const own = document.createElement('div');
      own.className = 'ra-hit';
      const label = document.createElement('span');
      label.textContent = `${entry.label}: заменить на`;
      const input = document.createElement('input');
      input.className = 'find-input';
      input.placeholder = 'пусто = как в «Заменить…» выше';
      input.value = hasOwn(detailsKey) ? overrides[detailsKey] : '';
      input.addEventListener('input', () => {
        if (input.value === '') delete overrides[detailsKey];
        else overrides[detailsKey] = input.value;
        const chipText = document.querySelector(`#rkRaChips .ra-chip[data-key="${CSS.escape(detailsKey)}"] span`);
        if (chipText) chipText.textContent = chipText.textContent.replace(/ ✎$/, '') + (input.value !== '' ? ' ✎' : '');
      });
      own.append(label, input);
      host.appendChild(own);
    }
    for (const hit of entry.hits.slice(0, 6)) {
      const line = document.createElement('div');
      line.className = 'ra-hit';
      const kind = document.createElement('span');
      kind.textContent = `${entry.label} · ${KIND[hit.kind] || 'текст'}${Number.isInteger(hit.block) ? ` · блок ${String(hit.block).padStart(2, '0')}` : ''}`;
      const code = document.createElement('code');
      const mark = document.createElement('mark');
      mark.textContent = hit.match;
      code.append(document.createTextNode(`…${String(hit.before || '').slice(-40)}`), mark, document.createTextNode(`${String(hit.after || '').slice(0, 40)}…`));
      line.append(kind, code);
      host.appendChild(line);
    }
    if (entry.count > entry.hits.length) {
      const more = document.createElement('div');
      more.className = 'ra-note';
      more.textContent = `ещё ${entry.count - entry.hits.length}`;
      host.appendChild(more);
    }
  }

  function render() {
    const strip = ensureStrip();
    if (!strip) return;
    const barOpen = !$('findBar')?.classList.contains('hidden');
    const find = String($('findInput')?.value || '');
    $('rkRaModeLabel').style.display = RA.looksLikeImage(find) ? '' : 'none';
    if (!RA.looksLikeImage(find)) $('rkRaMode').checked = false;
    $('rkRaUndo').style.display = lastUndo ? '' : 'none';
    if (!barOpen || !find) { strip.classList.add('hidden'); lastPlan = null; return; }
    strip.classList.remove('hidden');
    const scanned = scannedKey === queryKey();
    $('rkRaSearchRow').style.display = scanned ? 'none' : '';
    if (!scanned) {
      lastPlan = null;
      $('rkRaChips').replaceChildren();
      $('rkRaDetails').replaceChildren();
      updateApply();
      return;
    }
    try { if (typeof flushLocaleEditorToState === 'function') flushLocaleEditorToState(); } catch {}
    const target = codeTarget();
    lastPlan = RA.plan({ code: target.editor ? target.editor.getValue() : '', namespaces: state.namespaces || [], find, mode: mode() });
    if (overridesQuery !== find) { overrides = {}; overridesQuery = find; }
    const chips = $('rkRaChips');
    chips.replaceChildren();
    if (lastPlan.code?.count) {
      chips.appendChild(chip('code', state.srcCtx ? 'Код (исходник — для всех локалей)' : 'Код', lastPlan.code.count, { disabled: !target.editor, title: target.reason || 'Код письма один на все локали' }));
    }
    for (const item of lastPlan.locales) {
      chips.appendChild(chip(`${item.nsId}|${item.locale}`, `${item.nsName}·${String(item.locale).toUpperCase()}`, item.count,
        { locked: item.locked, title: item.locked ? 'Встроенный неймспейс — не меняется' : `блоки ${item.blockIndexes.map((i) => String(i).padStart(2, '0')).join(', ')}` }));
    }
    const any = Boolean(lastPlan.total);
    // Always visible while searching, so the feature is never "missing".
    strip.classList.remove('hidden');
    if (!any) {
      const empty = document.createElement('span');
      empty.className = 'ra-note';
      empty.textContent = RA.looksLikeImage(find) && mode() === 'text'
        ? 'Точных совпадений нет — включите «та же картинка по имени файла».'
        : 'Ни в коде, ни в локалях совпадений нет.';
      chips.appendChild(empty);
      $('rkRaDetails').replaceChildren();
      updateApply();
      return;
    }
    const keys = [...chips.querySelectorAll('.ra-chip')].map((el) => el.dataset.key);
    if (!keys.includes(detailsKey)) detailsKey = keys[0] || '';
    markActive();
    renderDetails();
    updateApply();
  }

  function selection() {
    const keys = [...document.querySelectorAll('#rkRaChips input[data-ra-key]:checked')].map((b) => b.dataset.raKey);
    return { code: keys.includes('code'), locales: new Set(keys.filter((k) => k !== 'code')) };
  }

  function updateApply() {
    const button = $('rkRaApply');
    if (!button || !lastPlan) { if (button) button.disabled = true; return; }
    const sel = selection();
    let matches = sel.code ? (lastPlan.code?.count || 0) : 0;
    for (const item of lastPlan.locales) if (sel.locales.has(`${item.nsId}|${item.locale}`)) matches += item.count;
    const places = (sel.code ? 1 : 0) + sel.locales.size;
    button.disabled = !matches;
    button.textContent = matches ? `Заменить везде: ${matches} в ${places}` : 'Заменить везде';
  }

  function replaceWholeDoc(editor, text) {
    const last = editor.lastLine();
    editor.replaceRange(text, { line: editor.firstLine(), ch: 0 }, { line: last, ch: (editor.getLine(last) || '').length }, '+retkit-replace-across');
  }

  function refreshAfter(changed) {
    try {
      if (state._editNsId && state._editLocale && changed.some((p) => p.nsId === state._editNsId && p.locale === state._editLocale)) {
        loadLocaleIntoLocaleCM(state._editNsId, state._editLocale);
      }
    } catch {}
    try { refreshLocaleUiAfterStructureChange(); } catch { try { updatePreview(); } catch {} }
    try { if (typeof doFindAll === 'function') doFindAll($('findInput').value); } catch {}
  }

  function applyPatches(patches) {
    for (const patch of patches) {
      const ns = getNs(patch.nsId);
      if (!ns || ns.builtin) continue;
      ns.locales[patch.locale] = patch.blocks;
      syncLocaleRawFromBlocks(ns, patch.locale);
    }
  }

  // Exposed for models (MCP) and tests: same rules as the UI.
  function replaceEverywhere({ find, replacement = '', mode: m = 'text', includeCode = true, locales = null, perLocale = null } = {}) {
    try { if (typeof flushLocaleEditorToState === 'function') flushLocaleEditorToState(); } catch {}
    const target = codeTarget();
    const plan = RA.plan({ code: target.editor ? target.editor.getValue() : '', namespaces: state.namespaces || [], find, mode: m });
    const keys = plan.locales.filter((l) => !l.locked).map((l) => `${l.nsId}|${l.locale}`);
    const sel = { code: includeCode && Boolean(target.editor), locales: new Set(locales ? keys.filter((k) => locales.includes(k) || locales.includes(k.split('|')[1])) : keys) };
    const own = {};
    if (perLocale && typeof perLocale === 'object') {
      for (const key of [...sel.locales]) {
        const loc = key.split('|')[1];
        if (Object.prototype.hasOwnProperty.call(perLocale, key)) own[key] = perLocale[key];
        else if (Object.prototype.hasOwnProperty.call(perLocale, loc)) own[key] = perLocale[loc];
      }
    }
    const result = RA.apply({ code: target.editor ? target.editor.getValue() : '', namespaces: state.namespaces || [], find, replacement, mode: m, selection: sel, replacements: own });
    if (!result.total) return { ok: true, total: 0, plan };
    if (sel.code && result.codeCount) replaceWholeDoc(target.editor, result.code);
    applyPatches(result.patches);
    lastUndo = { editor: sel.code && result.codeCount ? target.editor : null, code: result.undo.code, locales: result.undo.locales };
    refreshAfter(result.patches);
    if (String($('findInput')?.value || '') === String(find)) scannedKey = queryKey();
    render();
    return { ok: true, total: result.total, codeCount: result.codeCount, locales: result.patches.map((p) => ({ nsId: p.nsId, locale: p.locale, count: p.count })) };
  }

  function applySelected() {
    if (scannedKey !== queryKey()) { toast('Сначала «Искать во всех локалях»', 'warning'); return; }
    const find = String($('findInput').value || '');
    const replacement = String($('replaceInput').value || '');
    const sel = selection();
    const target = codeTarget();
    if (!target.editor) sel.code = false;
    const result = RA.apply({ code: target.editor ? target.editor.getValue() : '', namespaces: state.namespaces || [], find, replacement, mode: mode(), selection: sel, replacements: overrides });
    if (!result.total) { toast('Нечего заменять', 'warning'); return; }
    if (sel.code && result.codeCount) replaceWholeDoc(target.editor, result.code);
    applyPatches(result.patches);
    lastUndo = { editor: sel.code && result.codeCount ? target.editor : null, code: result.undo.code, locales: result.undo.locales };
    refreshAfter(result.patches);
    toast(`Заменено: ${result.total} (${result.patches.length} локалей${result.codeCount ? ' + код' : ''})`, 'success', 4000);
    render();
  }

  function undoLast() {
    if (!lastUndo) return;
    if (lastUndo.editor) replaceWholeDoc(lastUndo.editor, lastUndo.code);
    applyPatches(lastUndo.locales);
    const changed = lastUndo.locales;
    lastUndo = null;
    refreshAfter(changed);
    toast('Замена отменена', 'success');
    render();
  }

  function wire() {
    const bar = $('findBar');
    if (!bar || bar.dataset.raWired) return;
    bar.dataset.raWired = '1';
    ensureStrip();
    $('findInput')?.addEventListener('input', () => { scannedKey = ''; scheduleScan(); });
    new MutationObserver(scheduleScan).observe(bar, { attributes: true, attributeFilter: ['class'] });
    // Toolbar shortcut: opens the same ⌘F bar.
    const anchor = $('downloadHtmlBtn');
    if (anchor && !$('replaceAcrossBtn')) {
      const button = document.createElement('button');
      button.className = 'editor-action-btn';
      button.id = 'replaceAcrossBtn';
      button.style.whiteSpace = 'nowrap';
      button.title = 'Найти и заменить в коде и во всех локалях (⌘F)';
      button.textContent = '⇄ Локали';
      button.addEventListener('click', () => { try { openFindBar(findEditor()); } catch {} scannedKey = queryKey(); scheduleScan(); });
      anchor.parentNode.insertBefore(button, anchor);
    }
  }

  wire();
  window.RetKitReplaceAcrossUi = { refresh: render, replaceEverywhere, plan: (find, m = 'text') => {
    const target = codeTarget();
    return RA.plan({ code: target.editor ? target.editor.getValue() : '', namespaces: state.namespaces || [], find, mode: m });
  } };
})();
