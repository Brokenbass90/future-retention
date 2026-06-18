# UX / UI Improvements — workbench + constructor

Each item: **what's wrong today → what I propose → why it matters**. Ordered by impact (top = highest leverage).

## 1. Workspace mode switcher in top bar

**Today:** workbench has one mode — code editor + preview + chat. The block constructor is a separate page (planned). Locale comparison is a hidden modal (`Ctrl+Alt+L`). All of these are conceptually different working modes, but they're scattered across pages and modals.

**Proposed:** top-level mode switcher in the header, three tabs:

```
┌──────────────────────────────────────────────────────────────┐
│  R RetKit   │ 📝 Editor │ 🎨 Constructor │ 📊 Translator │  🌙 ⚙  │
├──────────────────────────────────────────────────────────────┤
│  [namespaces …]                                              │
│  [locale tabs …]                                             │
│  [editor + preview + chat OR constructor canvas]             │
└──────────────────────────────────────────────────────────────┘
```

- **Editor** — current workbench (code + preview + AI chat).
- **Constructor** — block-based assembly (the new page). Same brand/mail context preserved.
- **Translator** — side-by-side locale view (reference + active, scrollable in sync), with the AI chat focused on locale operations. Eats `locale-compare.js` and turns it from a modal into a first-class workspace.

**Why:** users have different jobs (edit existing / build new / translate). Forcing all into one view confuses both humans and AI. The mode tells the AI what the user is doing and biases its suggestions.

## 2. Active-namespace becomes prominent

**Today:** namespace bar shows tiny chips: `footer_upload (2)` `KYC_update_data_1220 (14)`. No visual signal which is "the one we're working with". `pickRelevantNamespace` does the right thing server-side, but the user can't see it.

**Proposed:**

```
┌──────────────────────────────────────────────────────────────┐
│ ACTIVE  KYC_update_data_1220  •  14 blocks  •  en/ar/hi/tl/ur│  ← big, blue-bordered card
├──────────────────────────────────────────────────────────────┤
│ also loaded:  footer_upload (2)  [+ Open]                    │  ← small chips for the rest
└──────────────────────────────────────────────────────────────┘
```

Click on a small chip → it becomes the active one. The big card always reflects what AI will work on.

**Why:** ⅓ of the recent "AI worked on the wrong namespace" frustrations come from "I didn't realize footer_upload was first".

## 3. Pencil mode — prominent toggle in preview toolbar

**Today (after planned Phase 1):** pencil mode is a state flag. Activation flow not designed yet.

**Proposed:**

```
┌─────────── Preview ────────────────────────────────┐
│ 🖥 Desktop  📱 Mobile     EN ▾    🖊 Edit  ⛶ Full   │  ← toolbar
├────────────────────────────────────────────────────┤
│ [preview iframe]                                   │
│                                                    │
│ When 🖊 is ON: orange dashed border around iframe; │
│   crosshair cursor; click any element → inspector  │
└────────────────────────────────────────────────────┘
```

Hovering elements in pencil-mode highlights them with subtle outlines. Click → floating inspector card anchored next to the element. ESC closes.

**Why:** without an obvious toggle, users won't know it exists. The orange border tells them at a glance "you're editing visually now".

## 4. AI chat — welcome screen with capability cards

**Today:** chat opens empty with `Напиши задачу...` placeholder. New users have no idea what to type. Most existing users only use the four preset chips.

**Proposed welcome state** (shown when chat is empty):

```
┌─────────────────────────────────────────────────┐
│  ✨ Что я могу:                                  │
│                                                 │
│  [🤖 Agent — проанализирую и сделаю сам ]      │  ← clickable
│  [✱ Расставь плейсхолдеры в открытом письме]   │
│  [🌐 Переведи во все локали]                    │
│  [🩹 Почини локали по reference]               │
│  [💬 Спроси что угодно — например «как…»]      │
│                                                 │
│  ▾ Журнал прошлых AI-действий (12 за неделю)   │
└─────────────────────────────────────────────────┘
```

Clicking any card pre-fills the input with the matching command and (optionally) auto-sends. Journal section expands to show last 5 entries with quick links.

**Why:** discoverability. The AI is powerful but invisible to new users.

## 5. Review-changes panel instead of auto-apply

**Today:** when AI returns a `modifiedHtml`, user sees a button "↩ Применить HTML (19200 симв.)". Clicking it overwrites the editor. No preview of what's about to change.

**Proposed:**

```
┌─────────── AI proposed 3 changes ───────────┐
│  ☑ Расставить 14/14 плейсхолдеров (HTML)    │
│      [view diff ▾]                          │
│  ☑ Починить ar locale (14 → 14 blocks)     │
│      [view diff ▾]                          │
│  ☐ Перевести в ur (новая локаль)            │
│      [view diff ▾]                          │
│                                             │
│  [ Применить выбранное ]  [ Отменить всё ]  │
└─────────────────────────────────────────────┘
```

Each item expandable to side-by-side diff. Per-item checkbox. "Apply selected" applies only checked items.

**Why:** safety + transparency. Especially important when AI does multi-step work (agent mode) — user controls what actually lands.

## 6. Translator workspace — locale comparison front-and-center

**Today:** `public/locale-compare.js` is a hidden modal triggered by Ctrl+Alt+L. Most users never find it. Cross-locale validation happens only via AI's fix-locale tool.

**Proposed Translator mode layout:**

```
┌──────────────────┬──────────────────┬────────────────┐
│ Reference (en)   │ Active (ar)      │ Validation     │
│ ─────────────    │ ─────────────    │ ──────────     │
│ block_00         │ block_00         │ ✓ all blocks   │
│ "Welcome to…"    │ "ستنتهي صلاحية…" │   align        │
│                  │                  │                │
│ block_01         │ block_01         │ ⚠ block_03:    │
│ "Your action…"   │ "إجراء…"         │   {{days}}     │
│                  │                  │   missing in ar│
│                  │                  │                │
│ ↕ scroll sync    │                  │                │
└──────────────────┴──────────────────┴────────────────┘

[AI chat below: focused on locale operations]
```

- Two columns scroll in sync (block-by-block).
- Right pane: live validation against reference (placeholder parity, @@ marker parity, missing blocks, length anomalies).
- Click a validation issue → both columns jump to that block + highlight it.

**Why:** translators want to SEE the comparison, not pop a modal. This is THE workflow for locale work.

## 7. Undo stack — Cmd+Z for AI edits

**Today:** AI edit applied → user sees result. If wrong, only option is to undo via the editor's local undo (CodeMirror), which works for small edits but not multi-file ones (HTML + locale TXT both changed).

**Proposed:**
- After any AI mutation (placeholderize, fix-locale, translate, agent finish), store `previousContent` per affected file in `data/edit-history.jsonl`.
- Top-bar button "↶ Revert last AI edit" enabled when there's something to revert.
- Cmd+Z when focus is OUTSIDE the editor triggers the same revert.

**Why:** people will paste AI changes, realize one block is wrong, and want to undo without manual re-load. Especially critical for multi-locale operations.

## 8. Agent timeline as collapsible cards

**Today (after Phase A2-3):** every agent run dumps all tool calls + results inline in chat. After 3 runs the chat is a 50-line scroll.

**Proposed:**
- Each agent run is a single collapsible card with a header:
  ```
  ▸ 🤖 Agent · "Расставь плейсхолдеры"     ✓ 14/14 anchored · 2.3s · 4 tools
  ```
- Click header → expand to show the full tool-call timeline + final summary + apply buttons.
- Collapsed cards keep only the header (one line).

**Why:** chat stays scannable. You see "5 agent runs today, all green" at a glance; expand only the one you care about.

## 9. Top-bar AI status indicator

**Today:** AI thinking state is shown in the chat handle ("AI думает..."). When the chat is collapsed, no visual signal.

**Proposed:**
- Small status dot in top bar next to "RetKit": `🟢 ready` / `🟡 thinking` / `🔴 error / no API key`.
- Hover → tooltip with last AI action time + result.

**Why:** users glance at the top bar way more than the chat drawer.

## 10. Per-block highlighting in preview

**Today:** click-to-highlight goes element by element (single `<p>`, `<td>`).

**Proposed:**
- In Constructor mode AND in Editor's pencil-mode, hovering shows the **section boundaries** (the `<table class="row …">` of an outer block) with a subtle outline.
- Hover on an outline → tooltip with block id (if it's a known canonical block).
- Click outline → selects the whole section, opens block-level inspector (move, duplicate, remove, swap with another block).

**Why:** thinking in blocks rather than tags is the constructor's mental model. Visual reinforcement matters.

## 11. AI auto-suggest on idle

**Today:** AI only does things when explicitly asked.

**Proposed (Phase 9):**
- When the user has loaded an email + namespace AND hasn't sent a chat in N seconds, the AI agent runs `analyze_email` in the background (cheap, no tokens — uses zero-AI Smart Analysis).
- Shows a small "💡 1 suggestion" badge near the chat input.
- Click → expands: "Locale ar has 3 placeholders missing the {{days}} variable; want me to fix them?"

**Why:** turns AI from a "tool I summon" into an "assistant who notices things". Same vibe as Gmail Smart Compose suggesting.

## 12. Quick-action chips — populate-not-send

**Today:** clicking a preset chip auto-sends. No room to edit.

**Proposed:** clicking chip fills the input but doesn't send. User can adjust, then Enter.

**Why:** users often want to scope the action ("переведи во все локали кроме th") but the chip doesn't let them.

## Visual polish (low-priority but nice)

- Replace the four locale-bar emoji buttons (`🌐 ✱ ⇄ 🔍`) — currently hidden — with a single "AI actions" dropdown menu in the editor toolbar.
- Add a small "block density" indicator in namespace card: dots showing locale fill % (`●●●○○ 3/5 locales`).
- Dark mode contrast: agent timeline `.toolresult` text is currently `#c9d1d9` on `rgba(255,255,255,.03)` — works in dark, washes out in light theme. Tighten.
- Chat input — keep scroll-position pinned to bottom when new messages arrive (currently sometimes scrolls past).

## What goes into the next sprint

| # | item | effort | unlock |
|---|---|---|---|
| 4 | AI welcome screen | 2 h | Discoverability of agent |
| 5 | Review-changes panel | 4 h | Safety on multi-step edits |
| 7 | Undo for AI edits | 3 h | Trust to use AI more |
| 9 | Top-bar AI status | 1 h | Always-visible signal |
| 2 | Active-namespace card | 2 h | Stops "wrong ns" errors |

These five take ~1.5 days and remove the biggest friction points. Worth doing before Phase 0 (block library validation) if the user can spare an afternoon — they're independent.
