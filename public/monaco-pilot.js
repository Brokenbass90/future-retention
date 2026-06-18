/**
 * monaco-pilot.js — opt-in Monaco editor that replaces CM5 on the HTML
 * tab when the user toggles it on. Built as a P1.1 pilot — proves
 * autocomplete / hover infrastructure before committing to a full
 * editor migration.
 *
 * Public API (window.MonacoPilot):
 *   .toggle()          — switch between CM and Monaco (HTML mode only)
 *   .isEnabled()       — true if Monaco is currently mounted
 *   .getValue() / .setValue(v)
 *   .focus()
 *
 * Integration contract with workbench.js:
 *   1. We DO NOT touch CM5. The pilot mounts a separate Monaco instance
 *      inside the same #codeEditor parent element, behind a wrapping div.
 *   2. Toggle ON: read CM value, hide CM textarea/CM wrapper, mount
 *      Monaco with that value. Bind onDidChangeContent to mirror back
 *      into CM (so the rest of the app — preview, placeholders panel,
 *      save-to-base — keeps working without changes).
 *   3. Toggle OFF: read Monaco value, push into CM, dispose Monaco.
 *
 * Providers registered for the `html` language:
 *   - Completion items from /api/mail/placeholders-index (cached client-
 *     side, refreshed on Monaco mount and on demand).
 *   - Snippets: bulletproof button, hero block, footer, RTL-safe row.
 *   - Hover provider for ${{ ns.block_XX }}$ tokens.
 */

(function () {
  'use strict';

  const MONACO_CDN = 'https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/vs';
  const LOADER_URL = `${MONACO_CDN}/loader.js`;

  let loadingPromise = null;
  let monacoEditor = null;     // Monaco editor instance
  let hostEl = null;           // DOM element wrapping Monaco
  let placeholdersCache = null; // [{namespace, blockId, value, seenInMails}, ...]

  /** Lazy-load Monaco. Returns a promise that resolves with the global
   * `monaco` once loaded. */
  function loadMonaco() {
    if (window.monaco) return Promise.resolve(window.monaco);
    if (loadingPromise) return loadingPromise;
    loadingPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = LOADER_URL;
      s.onload = () => {
        // The AMD loader exposes window.require.
        window.require.config({ paths: { vs: MONACO_CDN } });
        window.require(['vs/editor/editor.main'], () => {
          resolve(window.monaco);
        });
      };
      s.onerror = () => reject(new Error('Failed to load Monaco from CDN'));
      document.head.appendChild(s);
    });
    return loadingPromise;
  }

  async function fetchPlaceholdersIndex(force) {
    try {
      const q = force ? '?force=1' : '';
      const res = await fetch(`/api/mail/placeholders-index${q}`);
      if (!res.ok) return null;
      const j = await res.json();
      if (!j.ok) return null;
      return j.items || [];
    } catch {
      return null;
    }
  }

  function snippetItems(monaco) {
    const Kind = monaco.languages.CompletionItemKind;
    const Rule = monaco.languages.CompletionItemInsertTextRule;
    return [
      {
        label: 'rtl-button',
        kind: Kind.Snippet,
        insertText:
          '<table align="left" class="w280" style="border-collapse: collapse; max-width: 280px;">\n' +
          '  <tr>\n' +
          '    <td class="butt" style="background-color: #f70; border-radius: 16px; padding: 0;">\n' +
          '      <a href="${1:https://example.com}" target="_blank" class="butt-link" style="color: #fff; display: block; font-size: 18px; font-weight: 700; padding: 16px 24px; text-align: center; text-decoration: none;">${2:Button text}</a>\n' +
          '    </td>\n' +
          '  </tr>\n' +
          '</table>$0',
        insertTextRules: Rule.InsertAsSnippet,
        detail: 'Bulletproof button (RTL-safe)',
      },
      {
        label: 'hero-block',
        kind: Kind.Snippet,
        insertText:
          '<table role="presentation" width="100%" style="border-collapse: collapse;">\n' +
          '  <tr>\n' +
          '    <td style="padding: 28px 24px;">\n' +
          '      <p class="eyebrow" style="font-size: 12px; letter-spacing: 1.5px; text-transform: uppercase;">${1:Eyebrow}</p>\n' +
          '      <h1 style="font-size: 30px; line-height: 36px; margin: 0 0 12px;">${2:Headline}</h1>\n' +
          '      <p style="font-size: 16px; line-height: 24px;">${3:Body copy}</p>\n' +
          '    </td>\n' +
          '  </tr>\n' +
          '</table>$0',
        insertTextRules: Rule.InsertAsSnippet,
        detail: 'Hero block (eyebrow + h1 + body)',
      },
      {
        label: 'footer-block',
        kind: Kind.Snippet,
        insertText:
          '<table role="presentation" width="100%" style="border-collapse: collapse; background: #f3efe5;">\n' +
          '  <tr>\n' +
          '    <td style="padding: 28px 24px; color: #516253; font-size: 12px; line-height: 18px;">\n' +
          '      <p>{{embedded.company_address}}</p>\n' +
          '      <p>{{embedded.risk_warning}}</p>\n' +
          '      <p>\n' +
          '        <a href="{{embedded.company_terms_link}}" target="_blank" style="color: #516253;">${{ footer.conditions }}$</a> |\n' +
          '        <a href="{{embedded.unsubscribe_link}}" target="_blank" style="color: #516253;">${{ footer.unsubscribe }}$</a>\n' +
          '      </p>\n' +
          '    </td>\n' +
          '  </tr>\n' +
          '</table>$0',
        insertTextRules: Rule.InsertAsSnippet,
        detail: 'Standard footer (address + risk + unsubscribe)',
      },
    ];
  }

  function registerProviders(monaco) {
    // Completion provider — placeholders + snippets.
    monaco.languages.registerCompletionItemProvider('html', {
      triggerCharacters: ['$', '{', '.', ' '],
      provideCompletionItems: async (model, position) => {
        const word = model.getWordUntilPosition(position);
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn,
        };
        // Lazy-fetch placeholders on first request.
        if (!placeholdersCache) {
          placeholdersCache = (await fetchPlaceholdersIndex(false)) || [];
        }
        const Kind = monaco.languages.CompletionItemKind;
        const suggestions = [];
        for (const ph of placeholdersCache) {
          suggestions.push({
            label: `\${{ ${ph.namespace}.${ph.blockId} }}$`,
            kind: Kind.Variable,
            insertText: `\${{ ${ph.namespace}.${ph.blockId} }}$`,
            detail: ph.value ? ph.value.slice(0, 60) : `${ph.seenInMails.length} mail(s)`,
            documentation: ph.value
              ? { value: `**${ph.namespace}.${ph.blockId}**\n\n> ${ph.value.slice(0, 200)}\n\nused in ${ph.seenInMails.length} mail(s)` }
              : `used in ${ph.seenInMails.length} mail(s)`,
            range,
          });
        }
        for (const sn of snippetItems(monaco)) {
          suggestions.push({ ...sn, range });
        }
        return { suggestions };
      },
    });

    // Hover provider — show locale values for ${{ ns.block_XX }}$ under cursor.
    monaco.languages.registerHoverProvider('html', {
      provideHover: (model, position) => {
        const line = model.getLineContent(position.lineNumber);
        const re = /\$\{\{\s*([\w-]+)\.([\w-]+)\s*\}\}\$/g;
        let m;
        while ((m = re.exec(line)) !== null) {
          const startCol = m.index + 1;
          const endCol = startCol + m[0].length;
          if (position.column >= startCol && position.column <= endCol) {
            const ns = m[1], id = m[2];
            const entry = (placeholdersCache || []).find(
              (p) => p.namespace === ns && p.blockId === id
            );
            const value = entry?.value || '(no value loaded — try other locale or run /api/mail/placeholders-index)';
            const usedIn = entry?.seenInMails?.length || 0;
            return {
              range: new monaco.Range(position.lineNumber, startCol, position.lineNumber, endCol),
              contents: [
                { value: `**${ns}.${id}**` },
                { value: value },
                { value: `_used in ${usedIn} mail(s)_` },
              ],
            };
          }
        }
        return null;
      },
    });
  }

  function findCmTextarea() {
    return document.getElementById('codeEditor');
  }

  function mountHost() {
    if (hostEl) return hostEl;
    const ta = findCmTextarea();
    if (!ta) return null;
    const wrap = document.createElement('div');
    wrap.id = 'monacoHost';
    wrap.style.cssText = 'position:absolute; inset:0; z-index:5;';
    const parent = ta.parentElement;
    if (parent) {
      // Make parent positioned if it isn't (so absolute child fills it).
      const pos = getComputedStyle(parent).position;
      if (pos === 'static') parent.style.position = 'relative';
      parent.appendChild(wrap);
    }
    hostEl = wrap;
    return wrap;
  }

  function readCmValue() {
    if (window.cm && typeof window.cm.getValue === 'function') return window.cm.getValue();
    const ta = findCmTextarea();
    return ta ? ta.value : '';
  }
  function writeCmValue(v) {
    if (window.cm && typeof window.cm.setValue === 'function') window.cm.setValue(v);
    else {
      const ta = findCmTextarea();
      if (ta) ta.value = v;
    }
    // Tell the app to refresh preview if it has that hook.
    if (typeof window.updatePreview === 'function') {
      try { window.updatePreview(); } catch {}
    }
  }

  async function enable() {
    const monaco = await loadMonaco();
    const host = mountHost();
    if (!host) return false;
    registerProviders(monaco);
    const initialValue = readCmValue();
    monacoEditor = monaco.editor.create(host, {
      value: initialValue,
      language: 'html',
      theme: document.body.classList.contains('theme-light') ? 'vs' : 'vs-dark',
      automaticLayout: true,
      minimap: { enabled: true },
      wordWrap: 'on',
      tabSize: 2,
      fontSize: 13,
      scrollBeyondLastLine: false,
    });
    // Mirror changes back into CM so the rest of the app stays in sync.
    let syncTimer = null;
    monacoEditor.onDidChangeModelContent(() => {
      if (syncTimer) clearTimeout(syncTimer);
      syncTimer = setTimeout(() => {
        const v = monacoEditor.getValue();
        writeCmValue(v);
      }, 200);
    });
    // Hint the user.
    if (typeof window.toast === 'function') {
      window.toast('✓ Monaco включён. Ctrl+Space — autocomplete', 'success', 3500);
    }
    return true;
  }

  function disable() {
    if (!monacoEditor) return;
    const v = monacoEditor.getValue();
    writeCmValue(v);
    try { monacoEditor.dispose(); } catch {}
    monacoEditor = null;
    if (hostEl) {
      hostEl.remove();
      hostEl = null;
    }
    if (typeof window.toast === 'function') {
      window.toast('Monaco выключен — вернулся CM', 'info', 2000);
    }
  }

  window.MonacoPilot = {
    toggle() {
      if (monacoEditor) {
        disable();
        localStorage.setItem('monaco-pilot-enabled', '0');
      } else {
        enable().then((ok) => {
          if (ok) localStorage.setItem('monaco-pilot-enabled', '1');
        });
      }
    },
    isEnabled() { return Boolean(monacoEditor); },
    getValue() { return monacoEditor ? monacoEditor.getValue() : readCmValue(); },
    setValue(v) {
      if (monacoEditor) monacoEditor.setValue(v);
      writeCmValue(v);
    },
    focus() { if (monacoEditor) monacoEditor.focus(); },
    refreshPlaceholders: async () => {
      placeholdersCache = (await fetchPlaceholdersIndex(true)) || [];
      if (typeof window.toast === 'function') {
        window.toast(`✓ Обновлено: ${placeholdersCache.length} плейсхолдеров`, 'success', 2500);
      }
    },
  };

  // Auto-enable if user had it on last session (after CM is mounted).
  document.addEventListener('DOMContentLoaded', () => {
    if (localStorage.getItem('monaco-pilot-enabled') === '1') {
      // Wait a beat so CM has time to fully initialize.
      setTimeout(() => window.MonacoPilot.toggle(), 800);
    }
  });
})();


// Wire the header toggle button and Ctrl+Alt+M shortcut.
(function wireMonacoToggle() {
  function init() {
    const btn = document.getElementById('monacoToggleBtn');
    if (!btn) return;
    function updateLook() {
      const on = window.MonacoPilot.isEnabled();
      btn.style.background = on ? 'rgba(99,102,241,.20)' : '';
      btn.style.borderColor = on ? 'rgba(99,102,241,.5)' : '';
      btn.style.color = on ? '#a5b4fc' : '';
      btn.title = on ? 'Monaco включён — клик: выключить (Ctrl+Alt+M)'
                     : 'CodeMirror — клик: включить Monaco (Ctrl+Alt+M)';
    }
    btn.addEventListener('click', () => {
      window.MonacoPilot.toggle();
      // Refresh look after toggle settles.
      setTimeout(updateLook, 200);
    });
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.altKey && e.key.toLowerCase() === 'm') {
        e.preventDefault();
        window.MonacoPilot.toggle();
        setTimeout(updateLook, 200);
      }
    });
    updateLook();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
