# Test Checklist — verify everything built this session

Run these in order. Each item: **what to do → expected result → if not, what to send me**.

---

## 0. Prerequisites — restart procedure

Without this, NOTHING from the last 30 commits is live.

1. **Kill old server.** In terminal: `pkill -f "node.*server.js"` (or close the terminal running `npm run dev`).
2. **Start fresh.** `cd /Users/nikolay.bulgakov/Documents/retantion-future && npm run dev`. Wait for `[server] listening on :3000`.
3. **Hard-reload browser.** Open workbench → DevTools (Cmd+Opt+I) → Network tab → check "Disable cache" → Cmd+Shift+R.

Verify Console has:
```
RetKit Workbench v2.1 ready ✦
[builtin-namespaces] loaded 1 namespace(s): footer_upload
```

If you don't see this — the page is still cached. Try a private window.

---

## 1. RTL pipeline — emails should NOT fold

### 1.1 Studio preview of mail-lp-joined-lvl2 in AR/UR

1. Load `mail-lp-joined-lvl2` HTML into workbench (paste or import).
2. Load matching reference TXT into namespace.
3. Click `AR` locale tab → preview should:
   - **Welcome to the Loyalty Program** heading right-aligned.
   - "Open Program" button on the right side of its column.
   - Gift boxes + Cashback cards in **source order** (Cashback left, Gift boxes right) — NOT reversed.
   - Whole email centered in viewport, not "leaning right".

4. Inspect HTML in code panel. Search for `dir="rtl"`:
   - Should appear on `<p>`, `<h1-6>`, `<li>` and `<td class="butt…">`.
   - Should **NOT** appear on outer `<td class="center bg-col">`, `<td class="wrapper">`, `<td class="text-pad-small">`, spacer `<div class="h-20">`.

**If outer td has `dir="rtl"`** → take a screenshot of the inspected element + send to me. Most likely cause: stale build on disk; need to re-run `tools/build-mail.js` for that specific mail.

### 1.2 Rebuild a known mail in AR

```bash
cd /Users/nikolay.bulgakov/Documents/retantion-future/email-base
node tools/build-mail.js --category X_IQBroker --mail welcome --pretty --locales ar
```

Expected: `[build] OK: X_IQBroker/mail-welcome`. Then open `dist/X_IQBroker/mail-welcome/ar/index.pretty.html` and verify same RTL rules as 1.1.

### 1.3 padding-left swap

In a wrapper td with `padding-left: 50px`, after RTL rebuild it should be `padding-right: 50px; padding-left: 0`. Open the AR dist HTML, grep for `wrapper offset-by-one`.

---

## 2. AI smart placeholderize — accuracy on real KYC email

### 2.1 Via demo CLI (no studio needed)

You'll need an HTML file + ref TXT for a real KYC email. If you have them saved in `data/uploads/`, run:

```bash
node scripts/demo-placeholderize.mjs --auto
```

Or with explicit paths:

```bash
node scripts/demo-placeholderize.mjs \
  --html path/to/kyc.html \
  --ref  path/to/kyc-en.txt \
  --ns   KYC_update_data_1220
```

Expected output:
- First — Smart Analysis (no AI call): anchor / candidate / orphan counts.
- Then — AI placeholderize call.
- Final table — per-block decisions with source = primary / second-pass / rejected.

**Pass criteria:** ≥ 90% anchored. If < 80%, the journal will have details — share `data/studio-journal.jsonl` line with me.

### 2.2 Smart-Analysis-only (zero tokens)

```bash
node scripts/demo-placeholderize.mjs --analyze --html ... --ref ...
```

Expected: same colored report but no AI call. Useful to check coverage before spending tokens.

### 2.3 In workbench chat

1. Open KYC email + namespace.
2. Make sure `KYC_update_data_1220` is the active namespace (click its tab in namespace bar).
3. In chat type: **«расставь плэйсхолдеры»** (через `э`, специально).
4. Should run `placeholderizeHtml` on the KYC namespace (NOT on footer_upload).
5. Chat reply should look like: *"Поставил 14/14 плейсхолдеров KYC_update_data_1220.block_NN в Original HTML."*

**If reply says "Сначала загрузи namespace"** → server didn't restart. Re-do step 0.

---

## 3. Fix-locale batch mode

1. Same setup (KYC namespace loaded).
2. In chat: **«приведи переводы к единому виду»**.
3. Should iterate over all locales in namespace except `en`, fix each against reference. Reply: *"Привёл N локалей к виду reference=en: ar: 14 → 14, hi: 13 → 14, …"*.

**If it tries to translate instead of fix** → intent classifier mis-routed. Send chat history + I'll add the verb to fix-locale triggers.

---

## 4. AI Agent (tool-use loop)

### 4.1 Enable Agent mode

1. In chat panel, find the **🤖 Agent** checkbox (next to the preset chips).
2. Check it. It should turn blue/highlighted.

### 4.2 Run end-to-end on KYC

In chat type: **«Проанализируй письмо и расставь плейсхолдеры под английскую локаль»**.

Expected timeline appears in chat:
```
🤖 Agent (HTML: ~12000 chars, 2 namespace, активная: KYC_update_data_1220)
🔧 list_namespaces
↳ 2 namespace(ов)
🔧 read_open_html
↳ ~12000 байт
🔧 analyze_email {"namespace":"KYC_update_data_1220"}
↳ anchor 12 / candidate 2 / orphan 0 (всего 14)
🔧 placeholderize_html {"namespace":"KYC_update_data_1220"}
↳ 14 анкоров; missed 0, ambiguous 0
Готово! 14/14 плейсхолдеров расставлено.
[↩ Применить HTML (~12500 симв.)]
```

Click apply → editor updates with placeholderized HTML.

### 4.3 Quick analysis without applying anything

1. Click the **🔍 Анализ** preset chip in chat.
2. Should auto-enable Agent + run `list_namespaces → read_open_html → analyze_email → finish`. Reports issues but doesn't change anything.

**If 🤖 Agent toggle isn't visible** → frontend didn't reload. Force-refresh.
**If endpoint 404** → server restart didn't pick up new endpoint. Restart again.

---

## 5. Demo CLI scripts

### 5.1 Help screens

```bash
node scripts/demo-placeholderize.mjs --help
node scripts/journal-stats.mjs --help
```

Both should print usage info.

### 5.2 Auto-discover

```bash
node scripts/demo-placeholderize.mjs --auto
```

Should scan `data/uploads/`, `data/imports/`, `dist/` and pick the latest HTML + a non-utility TXT.

### 5.3 Journal stats

After running steps 2-4 above:

```bash
node scripts/journal-stats.mjs
```

Should show:
- Activity by area (`ai-placeholderize`, `ai-agent`, …).
- Placeholderize anchor%.
- Agent tool-call distribution.
- Last 10 entries.

### 5.4 Agent loop smoke test (hermetic)

```bash
node scripts/test-agent-loop.mjs
```

Should print `✓ All assertions passed.` and exit 0. **Runs without network or API key.** If this fails after a code change, the agent loop is broken.

---

## 6. Workbench UI changes

### 6.1 Enter-to-send

1. Click in chat input.
2. Type a short message.
3. Press **Enter** → should send.
4. Press **Shift+Enter** → should insert newline.
5. Press **Cmd+Enter** → should also send (alternate shortcut kept).
6. Type Russian/Chinese where IME may be open → composing keys should NOT trigger send.

### 6.2 Top-right toolbar cleanup

In the namespace bar, the AI quick-action icons (🌐 ✱ 🔍) should be GONE. Only `⇄` (compare) and `➕` (add locale) should remain visible.

The four chat-panel preset buttons (✱ Расставить плейсхолдеры / 🌐 Перевести во все локали / 🈯 Перевести в активную / 🩹 Починить активную) should be intact, plus the new **🔍 Анализ** and **🤖 Agent** controls.

### 6.3 Apply / Revert buttons in agent timeline

After agent finishes a run with `modifiedHtml`:
- Should see "↩ Применить HTML (N симв.)" button.
- Click → editor updates.
- (For Phase 8 — undo button will come later.)

---

## 7. Things that are documented but NOT yet built

Don't test these — they're in the roadmap:

- ❌ Pencil mode (visual editor toggle). Phase 1.
- ❌ Drag-and-drop block constructor. Phases 2-4.
- ❌ User-saved blocks. Phase 4.
- ❌ Figma → blocks pipeline. Phase 7.
- ❌ Unified patch API + undo. Phase 8.
- ❌ Top-bar AI status indicator. UX phase.
- ❌ AI welcome screen. UX phase.
- ❌ Review-changes diff panel. UX phase.
- ❌ Translator workspace mode. UX phase.

---

## How to report a bug

If something doesn't work as expected:

1. **What you did** — exact step from this checklist.
2. **What you expected** — copy from this doc.
3. **What you got** — screenshot of preview + screenshot of DevTools Console + Network tab (the failing request body & response).
4. **Last 5 journal entries** if AI-related: `tail -5 data/studio-journal.jsonl`.

I'll triage by area:
- RTL → `email-base/tools/rtl.js` or `public/workbench.js:applyRtl`.
- placeholderize → `src/locale-ai.js`.
- intent classifier → `server.js` line ~15500.
- agent → `src/ai-agent.js` + `src/ai-tools.js`.
- UI → `public/workbench.js` + `public/workbench.html` + `public/workbench.css`.
