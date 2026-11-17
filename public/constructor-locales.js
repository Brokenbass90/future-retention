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
    host?.toast?.(`Локали «${name}»: ${codes.length}${rejected.length ? `, отвергнуто ${rejected.length}` : ''}. Нажмите «Расставить» — тексты, совпадающие с ${ref.toUpperCase()}, привяжутся сами; «📋 Строки» — плейсхолдеры в буфер.`);
    host?.onChange?.();
  }

  // ─── Проверка и подстановка ───────────────────────────────────────────────

  function relint() {
    lint = null;
    if (!data || !root.RetKitLocaleLint || Object.keys(data.locales).length < 2) return;
    try { lint = root.RetKitLocaleLint.lint({ locales: data.locales, refCode: data.ref }); } catch (e) { console.warn('[constructor-locales]', e); }
  }

  /** Текст слота на локали: плейсхолдеры этого набора → строки локали. */
  function resolveText(value, code, { rich = false } = {}) {
    if (!data || typeof value !== 'string' || !value.includes('${{')) return value;
    const locale = data.locales[code === 'original' ? data.ref : code] || data.locales[data.ref] || [];
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
        <span class="c-loc-hint">Загрузите папку — письмо можно будет смотреть и выгружать на всех языках</span>`;
    } else {
      const tabs = ['original', ...data.order].map((code) => {
        const s = code === 'original' ? null : lint?.locales?.[code];
        const dot = s && s.status !== 'ok' ? `<i class="c-loc-dot ${s.status}"></i>` : '';
        const title = code === 'original' ? `Как в ${data.ref.toUpperCase()} (эталон)` : tabTitle(code, s);
        const pencil = code === 'original' ? '' : `<span class="c-loc-edit" data-edit="${esc(code)}" title="Редактировать тексты ${esc(code.toUpperCase())}">✎</span>`;
        return `<button type="button" class="c-loc-tab${code === active ? ' active' : ''}" data-loc="${esc(code)}" title="${esc(title)}">${code === 'original' ? 'Original' : esc(code.toUpperCase())}${dot}${pencil}</button>`;
      }).join('');
      const stats = host?.stats?.() || { bound: 0, plain: 0 };
      bar.innerHTML = `<button type="button" class="c-loc-btn" data-act="folder" title="Загрузить другую папку">📁</button>
        <button type="button" class="c-loc-name" data-act="copy-first" title="Клик — ${esc(token(data.name, 0))} в буфер; после вставки следующий ляжет сам">${esc(data.name)}</button>
        <div class="c-loc-tabs">${tabs}</div>
        <span class="c-loc-stat${stats.plain ? ' warn' : ''}" title="Тексты письма, привязанные к локалям">🔗 ${stats.bound}${stats.plain ? ` · без локали ${stats.plain}` : ''}</span>
        <span class="c-loc-strings"><button type="button" class="c-loc-btn" data-act="strings" title="Строки локали: клик — плейсхолдер в буфер обмена, вставьте его в текст блока">📋 Строки</button></span>
        <button type="button" class="c-loc-btn" data-act="bind" title="Привязать тексты, которые совпадают с ${esc(data.ref.toUpperCase())}">⚡ Расставить</button>
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
    panel.innerHTML = ref.map((text, i) => `<button type="button" class="c-loc-row${bad.has(i) ? ' bad' : ''}" data-copy="${i}" title="Скопировать ${esc(token(data.name, i))}">
        <code>block_${pad(i)}</code><span>${esc(short(text, 120))}${shown ? `<small>${esc(shown.toUpperCase())}: ${esc(short(local[i] ?? '— нет строки —', 120))}</small>` : ''}</span></button>`).join('')
      || '<div class="c-loc-hint">В эталоне нет строк</div>';
    panel.addEventListener('click', async (event) => {
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
  function highlightTxt(text) {
    const src = String(text || '');
    const n = src.length;
    const cls = new Array(n).fill('');
    let open = -1;
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
    if (!data || !data.locales[code]) return;
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
        <div class="c-loc-editor-foot"><span class="c-loc-check"></span>
          <button type="button" class="c-loc-btn" data-ed="download" title="Скачать ${esc(code)}.txt">⬇ TXT</button>
          <button type="button" class="c-loc-btn primary" data-ed="save">Сохранить</button></div>
      </div>`;
    document.body.appendChild(overlay);
    const area = overlay.querySelector('textarea');
    const check = overlay.querySelector('.c-loc-check');
    const hl = overlay.querySelector('.c-loc-hl');
    const paint = () => { hl.innerHTML = highlightTxt(area.value); hl.scrollTop = area.scrollTop; hl.scrollLeft = area.scrollLeft; };
    area.addEventListener('input', paint);
    area.addEventListener('scroll', () => { hl.scrollTop = area.scrollTop; hl.scrollLeft = area.scrollLeft; });
    paint();
    const parsedNow = () => parseLocale(area.value, `${code}.txt`);
    const refresh = () => {
      const blocks = parsedNow();
      const trial = root.RetKitLocaleLint && data.ref !== code
        ? root.RetKitLocaleLint.lint({ locales: { [data.ref]: data.locales[data.ref], [code]: blocks }, refCode: data.ref }) : null;
      const errors = trial ? trial.issues.filter((x) => x.locale === code && x.severity === 'error') : [];
      check.className = `c-loc-check ${errors.length || blocks.length !== refCount ? 'bad' : 'ok'}`;
      check.textContent = `${blocks.length} из ${refCount} блоков${errors.length ? ` · 🔴 ${errors.length}: ${errors.slice(0, 2).map((x) => `${typeof x.block === 'number' ? `block_${pad(x.block)}` : 'локаль'} ${x.code}`).join(', ')}` : ' · ✓'}`;
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
      return resolveText(String(previous || ''), 'original');
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
        zip.file(`${mail}/${code}/index.html`, applyRtl(html, code));
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

  // ─── Подключение ─────────────────────────────────────────────────────────

  function mount(callbacks) {
    host = callbacks || {};
    relint();
    render();
  }

  root.RetKitConstructorLocales = {
    mount, render, importFiles, localizeBlocks, resolveText, applyRtl, autoBindValue, bindingStats,
    slotPickerHtml, valueForPick, setActive, exportZip, toggleStrings, openEditor, copyPlaceholder, afterPaste, highlightTxt,
    get active() { return data ? active : 'original'; },
    get data() { return data ? JSON.parse(JSON.stringify(data)) : null; },
    get lint() { return lint; },
    _parseLocale: parseLocale, _localeCodeOf: localeCodeOf,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
