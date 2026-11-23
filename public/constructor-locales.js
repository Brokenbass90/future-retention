/**
 * constructor-locales.js — локали прямо в конструкторе, без вкладки «Код».
 *
 * Как во вкладке «Код» и в RetKit для MoEngage:
 *   📁 папка с локалями (en.txt, fr.txt… или JSON из email-base/vendor/data) →
 *   тексты блоков привязываются к строкам локали плейсхолдером ${{ ns.block_NN }}$
 *   (вручную в свойствах блока, кнопкой «Расставить» или агентом через
 *   retkit_update_canvas_block) → превью на любой локали (ar/ur — сразу RTL) →
 *   «⬇ ZIP» — готовый HTML каждой локали.
 *
 * Плейсхолдер — тот же, что пишет «✱ Плейсхолдеры» во вкладке «Код», поэтому
 * письмо, сохранённое из конструктора, в «Коде» подставляет локали само.
 * Проверка локалей — общая public/locale-lint.js: красная точка = есть 🔴.
 *
 * Хранение: localStorage этого браузера (как всё в студии — у каждого своё).
 * Конструктор подключает модуль через mount({...}) — сам модуль canvas не трогает.
 */
(function (root) {
  'use strict';

  const STORE_KEY = 'retkit-constructor-locales-v1';
  const RTL = new Set(['ar', 'ur', 'fa', 'he']);
  const LANG_CODES = [
    'ar', 'az', 'bg', 'bn', 'cs', 'da', 'de', 'el', 'en', 'es', 'et', 'fa', 'fi', 'fr', 'he', 'hi', 'hl', 'hr', 'hu',
    'id', 'it', 'ja', 'ka', 'kk', 'ko', 'lt', 'lv', 'mk', 'ms', 'nl', 'no', 'pl', 'pt', 'ro', 'ru', 'sk', 'sl', 'sq',
    'sr', 'sv', 'th', 'tl', 'tr', 'uk', 'ur', 'uz', 'vi', 'zh', 'cn', 'ge', 'se',
  ];
  const TOKEN_RE = /\$\{\{\s*([A-Za-z0-9_-]+)\.block_(\d+)\s*\}\}\$/g;

  let data = load();       // { name, ref, locales: {code: string[]}, order: [code] } | null
  let active = 'original'; // 'original' = эталон без пометки локали
  let host = null;         // колбэки конструктора из mount()
  let lint = null;         // результат RetKitLocaleLint.lint

  function load() {
    try {
      const raw = JSON.parse(root.localStorage?.getItem(STORE_KEY) || 'null');
      if (raw && raw.name && raw.locales && typeof raw.locales === 'object') return raw;
    } catch {}
    return null;
  }
  function save() {
    try {
      if (data) root.localStorage?.setItem(STORE_KEY, JSON.stringify(data));
      else root.localStorage?.removeItem(STORE_KEY);
    } catch {}
  }

  const pad = (n) => String(n).padStart(2, '0');
  const token = (name, i) => '${{ ' + name + '.block_' + pad(i) + ' }}$';
  const norm = (s) => String(s || '').replace(/@@/g, '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const short = (s, n = 42) => { const t = String(s || '').replace(/@@/g, '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n)}…` : t; };

  // ─── Чтение папки ──────────────────────────────────────────────────────────

  function safeName(value) {
    const cleaned = String(value || '').normalize('NFKD').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
    return cleaned || 'mail-locales';
  }

  /** 10651_TR_TR_APPROVED.txt → tr, en_US.txt → en, email_DE.txt → de (как во вкладке «Код»). */
  function localeCodeOf(filename) {
    const base = String(filename || '').replace(/\.(txt|json)$/i, '').toLowerCase();
    let m = base.match(/^\d+_([a-z]{2})_[a-z]{2,3}(?:_|$)/);
    if (m && LANG_CODES.includes(m[1])) return m[1];
    m = base.match(/^([a-z]{2})[-_][a-z]{2,3}(?:[-_]|$)/);
    if (m && LANG_CODES.includes(m[1])) return m[1];
    for (const code of LANG_CODES) if (new RegExp(`(?:^|[_\\-])${code}(?:[_\\-]|$)`, 'i').test(base)) return code;
    m = base.match(/^([a-z]+)/);
    return m ? m[1] : base;
  }

  /** TXT: {{ блок }} {{ блок }}…; JSON (email-base): значения по порядку ключей. */
  function parseLocale(text, filename) {
    if (/\.json$/i.test(filename)) {
      const out = [];
      const walk = (v) => {
        if (typeof v === 'string') out.push(v);
        else if (Array.isArray(v)) v.forEach(walk);
        else if (v && typeof v === 'object') Object.keys(v).sort().forEach((k) => walk(v[k]));
      };
      walk(JSON.parse(text));
      return out;
    }
    const blocks = [];
    const re = /\{\{([\s\S]*?)\}\}/g;
    let m;
    const normalized = String(text || '').replace(/\r\n?/g, '\n')
      .split('\n').filter((line) => !/^\s*subject\s*:/i.test(line)).join('\n');
    while ((m = re.exec(normalized)) !== null) blocks.push(m[1].trim());
    return blocks;
  }

  async function importFiles(fileList) {
    const files = [...(fileList || [])].filter((f) => /\.(txt|json)$/i.test(f.name));
    if (!files.length) { host?.toast?.('В папке нет .txt / .json локалей'); return; }
    const first = files[0].webkitRelativePath || '';
    const name = safeName(first.includes('/') ? first.split('/')[0] : 'mail-locales');
    const locales = {};
    const rejected = [];
    for (const file of files) {
      const text = await file.text();
      if (/\.txt$/i.test(file.name) && root.LocaleValidator) {
        const v = root.LocaleValidator.validate(text, file.name);
        if (!v.ok) { rejected.push(`${file.name}: ${v.reason}`); continue; }
      }
      try {
        const blocks = parseLocale(text, file.name);
        if (blocks.length) locales[localeCodeOf(file.name)] = blocks;
        else rejected.push(`${file.name}: нет блоков {{ }}`);
      } catch (error) { rejected.push(`${file.name}: ${error.message}`); }
    }
    const codes = Object.keys(locales);
    if (!codes.length) { host?.toast?.(`Локали не загружены. ${rejected.join('; ')}`); return; }
    const ref = codes.includes('en') ? 'en' : codes.find((c) => /^en/.test(c)) || codes[0];
    const order = [ref, ...codes.filter((c) => c !== ref).sort()];
    data = { name, ref, locales, order };
    active = 'original';
    save();
    relint();
    render();
    host?.toast?.(`Локали «${name}»: ${codes.length}${rejected.length ? `, отвергнуто ${rejected.length}` : ''}. Клик по имени набора — block_00 в буфер; наведите на текст в письме и ⌘V.`);
    host?.onChange?.();
  }

  // ─── Проверка и подстановка ───────────────────────────────────────────────

  // «Не ошибка» — по набору локалей; тот же ключ читает вкладка «Код» (один origin).
  const ignoreKey = (name) => `retkit-lint-ignore:ns:${name}`;
  function ignoredKeys() {
    if (!data) return [];
    try { const list = JSON.parse(root.localStorage?.getItem(ignoreKey(data.name)) || '[]'); return Array.isArray(list) ? list : []; } catch { return []; }
  }
  function setIgnored(list) {
    if (!data) return;
    try { root.localStorage?.setItem(ignoreKey(data.name), JSON.stringify([...new Set(list.filter(Boolean))])); } catch {}
    relint(); render(); host?.onChange?.();
  }

  function relint() {
    lint = null;
    if (!data || !root.RetKitLocaleLint || Object.keys(data.locales).length < 2) return;
    try { lint = root.RetKitLocaleLint.lint({ locales: data.locales, refCode: data.ref, ignore: ignoredKeys() }); } catch (e) { console.warn('[constructor-locales]', e); }
  }

  /** Текст слота на локали: плейсхолдеры этого набора → строки локали. */
  function resolveText(value, code, { rich = false } = {}) {
    // Original — само письмо: плейсхолдеры видны как есть, чтобы было видно, где какой.
    if (!data || code === 'original' || typeof value !== 'string' || !value.includes('${{')) return value;
    const locale = data.locales[code] || data.locales[data.ref] || [];
    return value.replace(TOKEN_RE, (m, ns, n) => {
      if (ns !== data.name) return m;
      const text = locale[Number(n)];
      if (text === undefined) return m; // строки нет — пусть будет видно
      return rich ? String(text).replace(/@@([\s\S]*?)@@/g, '<b>$1</b>') : String(text).replace(/@@/g, '');
    });
  }

  /** Блоки для сборки на локали code. kindOf(uid, slotId) → kind слота. */
  function localizeBlocks(blocks, code, kindOf) {
    if (!data) return blocks;
    return blocks.map((b) => {
      const slots = {};
      let changed = false;
      for (const [id, value] of Object.entries(b.slots || {})) {
        const kind = String(kindOf?.(b.uid, id) || 'text').toLowerCase();
        const next = resolveText(value, code, { rich: kind === 'richtext' });
        if (next !== value) changed = true;
        slots[id] = next;
      }
      return changed ? { ...b, slots } : b;
    });
  }

  /** Original: плейсхолдеры в превью — синие плашки с номером строки и её текстом в подсказке. */
  function markTokens(doc) {
    if (!data || !doc?.body || active !== 'original') return 0;
    const ref = data.locales[data.ref] || [];
    const walker = doc.createTreeWalker(doc.body, 4 /* NodeFilter.SHOW_TEXT */);
    const nodes = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) if (node.nodeValue.includes('${{')) nodes.push(node);
    let count = 0;
    for (const node of nodes) {
      const parts = node.nodeValue.split(/(\$\{\{\s*[A-Za-z0-9_.-]+\s*\}\}\$)/);
      if (parts.length < 2) continue;
      const frag = doc.createDocumentFragment();
      for (const part of parts) {
        const m = part.match(/^\$\{\{\s*([A-Za-z0-9_-]+)\.block_(\d+)\s*\}\}\$$/);
        if (!m) { if (part) frag.appendChild(doc.createTextNode(part)); continue; }
        const chip = doc.createElement('span');
        chip.textContent = part;
        const own = m[1] === data.name;
        chip.title = own ? `block_${m[2]} · ${data.ref.toUpperCase()}: ${ref[Number(m[2])] ?? '— нет строки —'}` : 'плейсхолдер другого набора';
        chip.setAttribute('style', `background:${own ? '#e8efff' : '#fff1e0'};color:${own ? '#1d4ed8' : '#9a4b00'};border:1px solid ${own ? '#9db7ff' : '#f2c08a'};border-radius:4px;padding:0 3px;font:600 0.85em ui-monospace,Menlo,monospace;white-space:nowrap`);
        frag.appendChild(chip);
        count += 1;
      }
      node.parentNode.replaceChild(frag, node);
    }
    return count;
  }

  function applyRtl(html, code) {
    const lang = String(code || '').toLowerCase().split(/[_-]/)[0];
    if (!RTL.has(lang) || !root.RetKitRtlCore?.applyRtl) return html;
    try { return root.RetKitRtlCore.applyRtl(html, { mode: 'document', lang }); } catch { return html; }
  }

  /** Сколько текстов письма привязано к локали / сколько ещё нет. */
  function bindingStats(entries) {
    const HAS_TOKEN = /\$\{\{\s*[A-Za-z0-9_-]+\.block_\d+\s*\}\}\$/;
    let bound = 0; let plain = 0;
    for (const { value, kind, group } of entries) {
      if (group !== 'content' || !['text', 'richtext'].includes(kind)) continue;
      const v = String(value ?? '');
      if (HAS_TOKEN.test(v)) bound += 1;
      else if (/\p{L}/u.test(v)) plain += 1;
    }
    return { bound, plain };
  }

  /** Автопривязка: текст слота совпадает с блоком эталона → плейсхолдер. */
  function autoBindValue(value) {
    if (!data) return null;
    const v = norm(value);
    if (!v || String(value).includes('${{')) return null;
    const ref = data.locales[data.ref] || [];
    const i = ref.findIndex((t) => norm(t) === v);
    return i >= 0 ? token(data.name, i) : null;
  }

  // ─── Интерфейс: строка над превью ─────────────────────────────────────────

  function ensureBar() {
    if (typeof document === 'undefined') return null;
    const header = document.querySelector('.preview-pane-header');
    if (!header) return null;
    let bar = document.getElementById('cLocalesBar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'cLocalesBar';
      bar.className = 'c-locales-bar';
      header.insertAdjacentElement('afterend', bar);
      const input = document.createElement('input');
      input.type = 'file';
      input.id = 'cLocalesFolder';
      input.hidden = true;
      input.setAttribute('webkitdirectory', '');
      input.multiple = true;
      input.addEventListener('change', (e) => { importFiles(e.target.files).finally(() => { e.target.value = ''; }); });
      document.body.appendChild(input);
    }
    return bar;
  }

  function render() {
    const bar = ensureBar();
    if (!bar) return;
    if (!data) {
      bar.innerHTML = `<button type="button" class="c-loc-btn" data-act="folder" title="Загрузить папку с локалями (en.txt, fr.txt… или JSON из базы)">📁 Локали</button>
        <button type="button" class="c-loc-btn" data-act="new-set" title="Начать локали с нуля: вписать тексты EN руками">＋ Новый набор</button>
        <button type="button" class="c-loc-btn" data-act="zip-single" title="Скачать ZIP с готовым читаемым HTML этого письма (одна локаль; язык определю по тексту, футер — на нём)">⬇ ZIP</button>
        <span class="c-loc-hint">Загрузите папку или начните с нуля — письмо можно будет смотреть и выгружать на всех языках</span>`;
    } else {
      const tabs = ['original', ...data.order].map((code) => {
        const s = code === 'original' ? null : lint?.locales?.[code];
        const dot = s && s.status !== 'ok' ? `<i class="c-loc-dot ${s.status}"></i>` : '';
        const title = code === 'original' ? 'Письмо с плейсхолдерами: видно, где какой block_NN' : tabTitle(code, s);
        const pencil = code === 'original' ? '' : `<span class="c-loc-edit" data-edit="${esc(code)}" title="Редактировать тексты ${esc(code.toUpperCase())}">✎</span>`;
        return `<button type="button" class="c-loc-tab${code === active ? ' active' : ''}" data-loc="${esc(code)}" title="${esc(title)}">${code === 'original' ? 'Original' : esc(code.toUpperCase())}${dot}${pencil}</button>`;
      }).join('');
      const stats = host?.stats?.() || { bound: 0, plain: 0 };
      bar.innerHTML = `<button type="button" class="c-loc-btn" data-act="folder" title="Загрузить другую папку">📁</button>
        <button type="button" class="c-loc-name" data-act="copy-first" title="Клик — ${esc(token(data.name, 0))} в буфер; после вставки следующий ляжет сам">${esc(data.name)}</button>
        <div class="c-loc-tabs">${tabs}</div>
        <span class="c-loc-stat${stats.plain ? ' warn' : ''}" title="Тексты письма, привязанные к локалям">🔗 ${stats.bound}${stats.plain ? ` · без локали ${stats.plain}` : ''}</span>
        <button type="button" class="c-loc-btn" data-act="add-locale" title="Добавить локаль вручную: копия ${esc(data.ref.toUpperCase())}, дальше переводите в редакторе">＋ Локаль</button>
        <button type="button" class="c-loc-btn" data-act="zip" title="Скачать ZIP: готовый HTML каждой локали">⬇ ZIP</button>
        <button type="button" class="c-loc-btn ghost" data-act="close" title="Убрать локали из конструктора">✕</button>`;
    }
    bar.querySelectorAll('[data-loc]').forEach((el) => el.addEventListener('click', (event) => {
      const edit = event.target.closest('[data-edit]');
      if (edit) { event.stopPropagation(); openEditor(edit.dataset.edit); return; }
      setActive(el.dataset.loc);
    }));
    bar.querySelector('[data-act="folder"]')?.addEventListener('click', () => document.getElementById('cLocalesFolder')?.click());
    bar.querySelector('[data-act="bind"]')?.addEventListener('click', () => {
      const n = host?.autoBind?.() || 0;
      host?.toast?.(n ? `Привязано текстов: ${n}` : `Нечего привязывать: тексты письма не совпадают с ${data.ref.toUpperCase()} — привяжите в свойствах блока (🌐) или попросите агента`);
      render();
    });
    bar.querySelector('[data-act="zip"]')?.addEventListener('click', () => exportZip());
    bar.querySelector('[data-act="zip-single"]')?.addEventListener('click', () => exportSingleZip());
    bar.querySelector('[data-act="add-locale"]')?.addEventListener('click', () => addLocale());
    bar.querySelector('[data-act="new-set"]')?.addEventListener('click', () => newSet());
    bar.querySelector('[data-act="strings"]')?.addEventListener('click', (event) => { event.stopPropagation(); toggleStrings(); });
    bar.querySelector('[data-act="copy-first"]')?.addEventListener('click', (event) => { event.stopPropagation(); copyPlaceholder(0); });
    bar.querySelector('[data-act="close"]')?.addEventListener('click', () => {
      if (!confirm('Убрать локали из конструктора? Плейсхолдеры в тексте блоков останутся.')) return;
      data = null; active = 'original'; lint = null; save(); render(); host?.onChange?.();
    });
  }

  // ─── Строки локали → буфер обмена ─────────────────────────────────────────

  /** Список строк эталона (и активной локали): клик копирует ${{ ns.block_NN }}$. */
  function toggleStrings(forceOpen) {
    const holder = document.querySelector('#cLocalesBar .c-loc-strings');
    if (!holder || !data) return;
    const open = holder.querySelector('.c-loc-panel');
    if (open && !forceOpen) { open.remove(); return; }
    open?.remove();
    const ref = data.locales[data.ref] || [];
    const shown = active !== 'original' && active !== data.ref ? active : '';
    const local = shown ? data.locales[shown] || [] : [];
    const bad = new Set((lint?.issues || []).filter((x) => x.locale === (shown || data.ref) && typeof x.block === 'number').map((x) => x.block));
    const panel = document.createElement('div');
    panel.className = 'c-loc-panel';
    panel.innerHTML = `<button type="button" class="c-loc-row add" data-add-string="1"><code>＋</code><span>Новая строка во все локали — плейсхолдер сразу в буфер</span></button>` + ref.map((text, i) => `<button type="button" class="c-loc-row${bad.has(i) ? ' bad' : ''}" data-copy="${i}" title="Скопировать ${esc(token(data.name, i))}">
        <code>block_${pad(i)}</code><span>${esc(short(text, 120))}${shown ? `<small>${esc(shown.toUpperCase())}: ${esc(short(local[i] ?? '— нет строки —', 120))}</small>` : ''}</span></button>`).join('')
      || '<div class="c-loc-hint">В эталоне нет строк</div>';
    panel.addEventListener('click', async (event) => {
      if (event.target.closest('[data-add-string]')) { panel.remove(); await addString(); return; }
      const row = event.target.closest('[data-copy]');
      if (!row) return;
      await copyPlaceholder(Number(row.dataset.copy));
    });
    holder.appendChild(panel);
    const closeOnOutside = (event) => {
      if (!holder.contains(event.target)) { panel.remove(); document.removeEventListener('mousedown', closeOnOutside); }
    };
    setTimeout(() => document.addEventListener('mousedown', closeOnOutside), 0);
  }

  // ─── Плейсхолдер в буфер + «следующий сам» (как во вкладке «Код») ─────────

  let armed = null; // { index } — после вставки в буфер ляжет следующий

  async function copyPlaceholder(index) {
    if (!data) return false;
    const value = token(data.name, index);
    try {
      await navigator.clipboard.writeText(value);
      armed = { index };
      host?.toast?.(`В буфере ${value}. Наведите на текст в письме и нажмите ⌘V / Ctrl+V — следующий block_${pad(index + 1)} ляжет в буфер сам`);
      return true;
    } catch {
      host?.toast?.(`Буфер недоступен. Плейсхолдер: ${value}`);
      return false;
    }
  }

  /** Вставили armed-плейсхолдер — кладём в буфер следующий. */
  async function afterPaste(text) {
    if (!data || !armed) return;
    if (String(text || '').trim() !== token(data.name, armed.index)) { armed = null; return; }
    const total = (data.locales[data.ref] || []).length;
    const next = armed.index + 1;
    if (next >= total) { armed = null; return; }
    try {
      await navigator.clipboard.writeText(token(data.name, next));
      armed = { index: next };
      host?.toast?.(`В буфере block_${pad(next)}: «${short((data.locales[data.ref] || [])[next], 50)}»`);
    } catch { armed = null; }
  }

  // ─── Редактор локали: ✎ на вкладке (как во вкладке «Код») ───────────────

  /**
   * Подсветка разметки локали (как в «Коде»): парные {{ }} и @@ @@ — синие,
   * незакрытые, лишние или вложенные — красные; жирный текст между @@ — голубой.
   */
  function highlightTxt(text, issues) {
    const src = String(text || '');
    const n = src.length;
    const cls = new Array(n).fill('');
    let open = -1;
    let blockIdx = 0; // как в parseLocale: блоки по порядку закрытых {{ }}
    for (let k = 0; k < n - 1; k += 1) {
      const two = src[k] + src[k + 1];
      if (two === '{{') {
        if (open >= 0) { cls[open] = cls[open + 1] = 'hl-bad'; }
        open = k; k += 1;
      } else if (two === '}}') {
        if (open < 0) { cls[k] = cls[k + 1] = 'hl-bad'; k += 1; continue; }
        cls[open] = cls[open + 1] = cls[k] = cls[k + 1] = 'hl-ok';
        const ats = [];
        for (let j = open + 2; j < k - 1; j += 1) if (src[j] === '@' && src[j + 1] === '@') { ats.push(j); j += 1; }
        for (let a = 0; a < ats.length; a += 1) {
          const j = ats[a];
          if (a === ats.length - 1 && ats.length % 2) { cls[j] = cls[j + 1] = 'hl-bad'; continue; }
          cls[j] = cls[j + 1] = 'hl-at';
          if (a % 2 === 0 && a + 1 < ats.length) for (let t = j + 2; t < ats[a + 1]; t += 1) cls[t] = 'hl-bold';
        }
        const sev = issues?.get?.(blockIdx);
        if (sev) for (let t = open + 2; t < k; t += 1) if (!cls[t] || cls[t] === 'hl-bold') cls[t] = `${cls[t] ? `${cls[t]} ` : ''}hl-issue-${sev}`;
        blockIdx += 1;
        open = -1; k += 1;
      }
    }
    if (open >= 0) cls[open] = cls[open + 1] = 'hl-bad';
    let html = '';
    let run = '';
    let current = '';
    const flush = () => { if (run) html += current ? `<span class="${current}">${esc(run)}</span>` : esc(run); run = ''; };
    for (let k = 0; k < n; k += 1) {
      if (cls[k] !== current) { flush(); current = cls[k]; }
      run += src[k];
    }
    flush();
    return html + (src.endsWith('\n') || !src ? ' ' : '');
  }

  const serializeTxt = (blocks) => (blocks || []).map((b) => `{{${b}}}`).join('\n\n');

  function openEditor(code) {
    if (!data || !data.locales[code] || typeof document === 'undefined') return;
    document.getElementById('cLocEditor')?.remove();
    const refCount = (data.locales[data.ref] || []).length;
    const overlay = document.createElement('div');
    overlay.id = 'cLocEditor';
    overlay.className = 'c-loc-editor-backdrop';
    overlay.innerHTML = `<div class="c-loc-editor" role="dialog">
        <div class="c-loc-editor-head"><strong>${esc(code.toUpperCase())} — тексты «${esc(data.name)}»</strong>
          <span class="c-loc-hint">Каждый блок — в {{ }}; @@жирный@@. Клик по block_NN — плейсхолдер в буфер.</span>
          <button type="button" class="c-loc-btn ghost" data-ed="close" title="Закрыть без сохранения">✕</button></div>
        <div class="c-loc-editor-body">
          <div class="c-loc-keys">${Array.from({ length: Math.max(refCount, data.locales[code].length) }, (_, i) => `<button type="button" class="c-loc-key" data-key="${i}" title="${esc(short((data.locales[data.ref] || [])[i] ?? '', 80))}">block_${pad(i)}</button>`).join('')}</div>
          <div class="c-loc-hl-wrap"><pre class="c-loc-hl" aria-hidden="true"></pre><textarea class="c-loc-text" spellcheck="false">${esc(serializeTxt(data.locales[code]))}</textarea></div>
        </div>
        <div class="c-loc-issues"></div>
        <div class="c-loc-editor-foot"><span class="c-loc-check"></span>
          <button type="button" class="c-loc-btn" data-ed="download" title="Скачать ${esc(code)}.txt">⬇ TXT</button>
          <button type="button" class="c-loc-btn primary" data-ed="save">Сохранить</button></div>
      </div>`;
    document.body.appendChild(overlay);
    const area = overlay.querySelector('textarea');
    const check = overlay.querySelector('.c-loc-check');
    const hl = overlay.querySelector('.c-loc-hl');
    let issueMap = new Map();
    let shownIssues = [];
    const paint = () => { hl.innerHTML = highlightTxt(area.value, issueMap); hl.scrollTop = area.scrollTop; hl.scrollLeft = area.scrollLeft; };
    area.addEventListener('input', paint);
    area.addEventListener('scroll', () => { hl.scrollTop = area.scrollTop; hl.scrollLeft = area.scrollLeft; });
    paint();
    const parsedNow = () => parseLocale(area.value, `${code}.txt`);
    const issuesBox = overlay.querySelector('.c-loc-issues');
    // Валидаторы как в «Коде»: число строк против эталона + та же проверка локалей
    // (язык и алфавит, непереведённое, мусор, переменные) — на лету, до сохранения.
    const refresh = () => {
      const blocks = parsedNow();
      const refBlocks = code === data.ref ? blocks : (data.locales[data.ref] || []);
      const trialLocales = { ...data.locales, [code]: blocks };
      let mine = [];
      if (root.RetKitLocaleLint) {
        try { mine = root.RetKitLocaleLint.lint({ locales: trialLocales, refCode: data.ref, ignore: ignoredKeys() }).issues.filter((x) => x.locale === code); } catch {}
      }
      issueMap = new Map();
      for (const x of mine) if (typeof x.block === 'number') issueMap.set(x.block, x.severity === 'error' || issueMap.get(x.block) === 'error' ? 'error' : 'warn');
      const errors = mine.filter((x) => x.severity === 'error');
      const warns = mine.length - errors.length;
      const langBad = mine.find((x) => x.block === null && /wrong_(lang|script)/.test(x.code));
      const info = root.RetKitLocaleLint?.langOf?.(code);
      const countOk = blocks.length === refBlocks.length;
      check.className = `c-loc-check ${errors.length || !countOk ? 'bad' : warns ? 'warn' : 'ok'}`;
      check.textContent = [
        code === data.ref ? `${blocks.length} строк (эталон)` : `${countOk ? '✓' : '✗'} строк ${blocks.length} из ${refBlocks.length}`,
        info?.lang || info?.script ? (langBad ? `✗ язык: ${langBad.message}` : '✓ язык') : 'язык не проверяется',
        errors.length ? `🔴 ${errors.length}` : '',
        warns ? `🟡 ${warns}` : '',
      ].filter(Boolean).join(' · ');
      // Клик по строке — к этому блоку в тексте; «игнор» — скрыть случай во всех локалях набора.
      shownIssues = mine;
      const hidden = ignoredKeys().length;
      issuesBox.innerHTML = mine.slice(0, 30).map((x, n) => `<div class="${x.severity} c-loc-issue" data-issue="${n}">${x.severity === 'error' ? '●' : '○'} ${typeof x.block === 'number' ? `block_${pad(x.block)}` : 'локаль'} — ${esc(x.code)}: ${esc(x.message)}${x.sample ? ` «${esc(x.sample)}»` : ''}<button type="button" class="c-loc-ign" data-ignore="${n}" title="Это не ошибка — скрыть этот случай во всех локалях набора">☐ игнор</button></div>`).join('')
        + (mine.length > 30 ? `<div>… ещё ${mine.length - 30}</div>` : '')
        + (hidden ? `<div class="c-loc-hidden">Скрыто как «не ошибка»: ${hidden} <button type="button" class="c-loc-ign" data-unhide="1">Показать скрытые</button></div>` : '');
      paint();
    };
    let timer = null;
    area.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(refresh, 250); });
    refresh();
    const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = (event) => { if (event.key === 'Escape') close(); if ((event.metaKey || event.ctrlKey) && event.key === 's') { event.preventDefault(); saveNow(); } };
    document.addEventListener('keydown', onKey);
    const saveNow = () => {
      const blocks = parsedNow();
      if (!blocks.length) { host?.toast?.('Нет ни одного блока {{ }} — не сохранено'); return; }
      data.locales[code] = blocks;
      save(); relint(); render(); host?.onChange?.();
      host?.toast?.(`${code.toUpperCase()}: сохранено ${blocks.length} блоков`);
      close();
    };
    overlay.addEventListener('click', async (event) => {
      if (event.target === overlay) { close(); return; }
      const ign = event.target.closest('[data-ignore]');
      if (ign) { const x = shownIssues[Number(ign.dataset.ignore)]; if (x) { setIgnored([...ignoredKeys(), x.key]); refresh(); } return; }
      if (event.target.closest('[data-unhide]')) { setIgnored([]); refresh(); return; }
      const row = event.target.closest('[data-issue]');
      if (row) {
        const x = shownIssues[Number(row.dataset.issue)];
        if (x && typeof x.block === 'number') selectBlock(area, x.block);
        return;
      }
      const key = event.target.closest('[data-key]');
      if (key) { await copyPlaceholder(Number(key.dataset.key)); return; }
      const act = event.target.closest('[data-ed]')?.dataset.ed;
      if (act === 'close') close();
      if (act === 'save') saveNow();
      if (act === 'download') {
        const url = URL.createObjectURL(new Blob([area.value], { type: 'text/plain;charset=utf-8' }));
        Object.assign(document.createElement('a'), { href: url, download: `${code}.txt` }).click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    });
    setTimeout(() => area.focus(), 30);
  }

  /** Номер строки, если значение слота — ровно один плейсхолдер этого набора. */
  function tokenIndex(value) {
    if (!data) return -1;
    const m = String(value || '').trim().match(/^\$\{\{\s*([A-Za-z0-9_-]+)\.block_(\d+)\s*\}\}\$$/);
    return m && m[1] === data.name ? Number(m[2]) : -1;
  }

  /** Правка одной строки одной локали (из письма, не открывая редактор). */
  function setLocaleString(code, index, text) {
    if (!data || !data.locales[code] || index < 0) return false;
    const blocks = data.locales[code].slice();
    while (blocks.length <= index) blocks.push('');
    blocks[index] = String(text ?? '');
    data.locales[code] = blocks;
    save(); relint(); render(); host?.onChange?.();
    return true;
  }

  function refStrings() {
    return data ? (data.locales[data.ref] || []).map((t, i) => ({ index: i, label: `block_${pad(i)} · ${short(t)}` })) : [];
  }

  // ─── Добавить вручную: набор, локаль, строку ──────────────────────────────

  function newSet() {
    const name = safeName(prompt('Имя набора локалей (из него плейсхолдеры: ${{ имя.block_00 }}$):', safeName(host?.mailName?.() || 'mail-locales')) || '');
    if (!name) return;
    data = { name, ref: 'en', locales: { en: [] }, order: ['en'] };
    active = 'original';
    save(); relint(); render(); host?.onChange?.();
    openEditor('en');
  }

  function addLocale() {
    if (!data) return;
    const raw = prompt(`Код новой локали (fr, de, es, ar, pt_BR…). Начнётся как копия ${data.ref.toUpperCase()} — переводите строки в редакторе.`, '');
    const code = String(raw || '').trim().replace('-', '_').replace(/^([a-z]{2})_([a-z]{2})$/i, (m, a, b) => `${a.toLowerCase()}_${b.toUpperCase()}`).replace(/^([A-Z]{2})$/, (m) => m.toLowerCase());
    if (!code) return;
    if (!/^[a-z]{2}(?:_[A-Z]{2})?$/.test(code)) { host?.toast?.(`«${raw}» — не код локали: две латинские буквы, например fr или pt_BR`); return; }
    if (!data.locales[code]) {
      data.locales[code] = (data.locales[data.ref] || []).slice();
      data.order = [...data.order.filter((c) => c !== code), code];
      save(); relint(); render(); host?.onChange?.();
      const known = root.RetKitLocaleLint?.langOf?.(code);
      host?.toast?.(`${code.toUpperCase()} добавлена копией ${data.ref.toUpperCase()}${known?.lang || known?.script ? '' : ' (язык этой локали проверка не знает — проверит только строки и мусор)'}`);
    }
    openEditor(code);
  }

  /** Новая строка во все локали (в эталоне — текст, в остальных пусто → подсветится). */
  async function addString() {
    if (!data) return;
    const text = prompt(`Текст новой строки (${data.ref.toUpperCase()}):`, '');
    if (!text) return;
    for (const code of Object.keys(data.locales)) data.locales[code] = [...data.locales[code], code === data.ref ? text : ''];
    save(); relint(); render(); host?.onChange?.();
    await copyPlaceholder(data.locales[data.ref].length - 1);
  }

  /** Выделить в редакторе n-й блок {{ … }} и прокрутить к нему. */
  function selectBlock(area, n) {
    const re = /\{\{([\s\S]*?)\}\}/g;
    let m; let i = 0;
    while ((m = re.exec(area.value)) !== null) {
      if (i === n) {
        area.focus();
        area.setSelectionRange(m.index + 2, m.index + m[0].length - 2);
        const before = area.value.slice(0, m.index).split('\n').length - 1;
        const lineHeight = parseFloat(getComputedStyle(area).lineHeight) || 20;
        area.scrollTop = Math.max(0, before * lineHeight - area.clientHeight / 3);
        area.dispatchEvent(new Event('scroll'));
        return true;
      }
      i += 1;
    }
    return false;
  }

  function tabTitle(code, s) {
    if (!s) return code.toUpperCase();
    const issues = (lint?.issues || []).filter((x) => x.locale === code).slice(0, 10)
      .map((x) => `${x.severity === 'error' ? '●' : '○'} ${typeof x.block === 'number' ? `block_${pad(x.block)}` : 'локаль'} — ${x.code}: ${x.message}${x.sample ? ` «${x.sample}»` : ''}`);
    return [`${code.toUpperCase()}${s.reference ? ' (эталон)' : ''}: ошибок ${s.errors}, предупреждений ${s.warnings}`, ...issues].join('\n');
  }

  function setActive(code) {
    if (!data) return;
    active = code === 'original' || data.locales[code] ? code : 'original';
    render();
    host?.onChange?.();
  }

  // ─── Привязка в свойствах блока ───────────────────────────────────────────

  /** Выпадашка «🌐 из локали» под текстовым полем слота (только текст/richText контента). */
  function slotPickerHtml(slotId, value, kind) {
    if (!data || !['text', 'richtext'].includes(String(kind || 'text').toLowerCase())) return '';
    const ref = data.locales[data.ref] || [];
    const m = String(value || '').match(/\$\{\{\s*([A-Za-z0-9_-]+)\.block_(\d+)\s*\}\}\$/);
    const current = m && m[1] === data.name ? Number(m[2]) : -1;
    const options = ref.map((t, i) => `<option value="${i}"${i === current ? ' selected' : ''}>block_${pad(i)} · ${esc(short(t))}</option>`).join('');
    return `<div class="c-loc-pick"><span title="Текст из локали «${esc(data.name)}»">🌐</span>
      <select data-locale-bind-for="${esc(slotId)}"><option value="">— свой текст —</option>${options}</select></div>`;
  }

  function valueForPick(index, previous) {
    if (index === '' || index === null || index === undefined) {
      // Отвязать: оставить текст эталона, чтобы поле не стало пустым.
      return resolveText(String(previous || ''), data.ref);
    }
    return token(data.name, Number(index));
  }

  // ─── ZIP ──────────────────────────────────────────────────────────────────

  async function loadJsZip() {
    if (root.JSZip) return root.JSZip;
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
      s.onload = resolve; s.onerror = () => reject(new Error('JSZip не загрузился'));
      document.head.appendChild(s);
    });
    return root.JSZip;
  }

  async function exportZip() {
    if (!data || !host?.buildHtml) return;
    const errors = (lint?.issues || []).filter((x) => x.severity === 'error').length;
    if (errors && !confirm(`В локалях ${errors} 🔴 ошибок (наведите на вкладки). Всё равно скачать?`)) return;
    const { plain } = host?.stats?.() || {};
    if (plain && !confirm(`${plain} текстов письма не привязаны к локалям — во всех языках они останутся как есть. Скачать?`)) return;
    const bar = document.getElementById('cLocalesBar');
    const button = bar?.querySelector('[data-act="zip"]');
    try {
      const JSZip = await loadJsZip();
      const zip = new JSZip();
      const mail = safeName(host.mailName?.() || data.name);
      for (let i = 0; i < data.order.length; i += 1) {
        const code = data.order[i];
        if (button) button.textContent = `⬇ ${i + 1}/${data.order.length}`;
        const html = await host.buildHtml(code);
        zip.file(`${mail}/${code}/index.html`, host.applyRtl ? host.applyRtl(html, code) : applyRtl(html, code));
      }
      const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
      const url = URL.createObjectURL(blob);
      Object.assign(document.createElement('a'), { href: url, download: `${mail}-locales.zip` }).click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      host?.toast?.(`ZIP: ${data.order.length} локалей`);
    } catch (error) {
      host?.toast?.(`ZIP не собран: ${error.message}`);
    } finally {
      if (button) button.textContent = '⬇ ZIP';
    }
  }

  /** Язык письма по его текстам: двухбуквенный код локали или ''. */
  function guessLocale(text) {
    const L = root.RetKitLocaleLint;
    if (!L?.detect || String(text || '').trim().length < 20) return '';
    const ranked = L.detect(text);
    const iso3 = ranked?.[0]?.[0];
    if (!iso3) return '';
    for (const code of ['en', 'ru', 'de', 'es', 'fr', 'it', 'pt', 'tr', 'ar', 'th', 'vi', 'id', 'ms', 'ko', 'ja', 'zh', 'pl', 'uk', 'nl', 'se', 'no', 'hi', 'ka']) {
      if (L.langOf(code)?.lang === iso3) return code;
    }
    return '';
  }

  /**
   * Письмо без локалей: один язык. ZIP с <mail>/<locale>/index.html —
   * тот же читаемый (не минифицированный) HTML, что и при работе с локалями.
   */
  async function exportSingleZip() {
    if (!host?.buildHtml) return;
    const guessed = guessLocale(host.canvasText?.() || '') || 'en';
    const answer = prompt('Язык письма (код локали: en, ru, fr, ar…) — по нему футер и RTL:', guessed);
    if (answer === null) return;
    const code = String(answer).trim().toLowerCase() || guessed;
    if (!/^[a-z]{2,3}(?:[_-][a-z0-9]{2,4})?$/.test(code)) { host?.toast?.(`Непонятный код локали: ${code}`); return; }
    const button = document.getElementById('cLocalesBar')?.querySelector('[data-act="zip-single"]');
    try {
      if (button) button.textContent = '⬇ …';
      const JSZip = await loadJsZip();
      const zip = new JSZip();
      const mail = safeName(host.mailName?.() || 'mail');
      const html = await host.buildHtml(code);
      zip.file(`${mail}/${code}/index.html`, host.applyRtl ? host.applyRtl(html, code) : applyRtl(html, code));
      const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
      const url = URL.createObjectURL(blob);
      Object.assign(document.createElement('a'), { href: url, download: `${mail}-${code}.zip` }).click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      host?.toast?.(`ZIP: ${code.toUpperCase()}`);
    } catch (error) {
      host?.toast?.(`ZIP не собран: ${error.message}`);
    } finally {
      if (button) button.textContent = '⬇ ZIP';
    }
  }

  // ─── Подключение ─────────────────────────────────────────────────────────

  function mount(callbacks) {
    host = callbacks || {};
    relint();
    render();
  }

  root.RetKitConstructorLocales = {
    mount, render, importFiles, localizeBlocks, resolveText, applyRtl, autoBindValue, bindingStats,
    slotPickerHtml, valueForPick, setActive, exportZip, exportSingleZip, guessLocale, toggleStrings, openEditor, copyPlaceholder, afterPaste, highlightTxt,
    markTokens, tokenIndex, setLocaleString, ignoredKeys, setIgnored, refStrings, addLocale, newSet, addString, token: (i) => (data ? token(data.name, i) : ''),
    get active() { return data ? active : 'original'; },
    get data() { return data ? JSON.parse(JSON.stringify(data)) : null; },
    get lint() { return lint; },
    _parseLocale: parseLocale, _localeCodeOf: localeCodeOf,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
