# Drag-and-Drop Constructor — vision, audit, MVP

## What the user actually wants

After the first round of questions, the real product is bigger than a "drop blocks → render" toy. It's three connected things:

1. **Pencil mode — in-place visual editor.** Toggle a 🖊 button in the workbench. While active, clicking anything in the preview opens an inline editor for THAT element: text content, image src, border-radius, colors, padding, font size. Editor mutates source code in real time (the existing two-way bridge between preview and editor already exists — pencil mode reuses it).
2. **Smart drag — block library with inner / outer awareness.** Blocks come in two flavors:
   - **Outer (section-level)** — hero, feature-list row, footer, full-width CTA. Drop into the email's vertical flow.
   - **Inner (element-level)** — single CTA button, image, paragraph, icon row. Drop INTO a section, not between sections.
   When user drags, the system shows highlights: "this block fits here" / "this block doesn't fit here".
3. **User-saved blocks — personal library.** Right-click any selection in the preview → "Save as block" → name + auto-thumbnail → appears in the catalog alongside the canonical ones. Persisted under `data/user-blocks/`. Reused across emails.

The **15 blocks already in `data/block-snippets.json` are not good enough.** 4 are corrupted (71 KB each — whole email got captured), the other 11 are unrendered Pug fragments without the surrounding layout context they need to actually work. So step 0 is rebuilding the library with **working, self-contained blocks**, each tested by compiling Stylus + Pug → HTML → preview.

## Toolchain confirmation

- **Pug** for template structure (`.pug` files, `vendor/helpers/mixins.pug` for shared mixins).
- **Stylus** for styles (`.styl`, compiles to scoped CSS via `inline-css`).
- **build-mail.js** for the compile pipeline (already exists, drives both the live preview and dist output).

Constructor's contract: every block — canonical or user-saved — is a `{ pug, styl }` pair (plus metadata: id, kind, slots). The constructor assembles a full email by concatenating `pug` parts and merging `styl` parts, then runs them through the existing build pipeline. No new compiler needed.

## Block taxonomy (the source of "inner vs outer")

Every block has a `placement` field: `section` | `inline` | `helper`.

| placement | what it is | drop target | examples |
|---|---|---|---|
| `section` | full-width row in the email vertical flow | between other `section` blocks at the root of `index.pug` | hero, feature-list-row, cta-row, footer |
| `inline` | element that lives inside a section | inside a section's `block content` slot | single CTA button, image, paragraph, icon-text pair |
| `helper` | wrapper / boilerplate (rare) | head/foot of file | preheader, gmail-fix, head-style |

UI behavior:
- Dragging a `section` block: drop zones shown between existing sections.
- Dragging an `inline` block: drop zones shown INSIDE sections (each section that accepts inline children highlights its content area).
- Dragging an unsupported combination (e.g. a `section` block onto an inline slot): drop is rejected with a tooltip "section block can't fit here".

## Block schema (the canonical format)

```jsonc
{
  "id": "single-cta-button",                  // stable id
  "label": "Single CTA button",
  "description": "Один CTA в карточке. 280px, оранжевый фон, белый текст.",
  "placement": "inline",                       // 'section' | 'inline' | 'helper'
  "category": "cta",                           // hero / cta / text / image / feature-list / footer / utility
  "version": 1,                                // bump when block format changes
  "source": "canonical",                       // 'canonical' | 'user' | 'imported'
  "pug": "table.w280 ...",                    // Pug source
  "styl": ".w280 { width: 280px; ... }",      // Stylus source (block-local)
  "slots": [                                   // editable fields the user sees in the right pane
    { "id": "label", "kind": "text", "default": "Open Program", "max": 40 },
    { "id": "href",  "kind": "url",  "default": "https://..." },
    { "id": "bg",    "kind": "color","default": "#f70" }
  ],
  "preview": "data:image/png;base64,...",      // auto-generated thumbnail
  "outlookSafe": true,
  "createdAt": "2026-05-30T...",
  "usageCount": 0
}
```

Slot kinds the constructor knows: `text` (one-line), `richText` (multi-line + bold), `url`, `color`, `image` (URL or upload), `number`, `select` (predefined options).

## Storage layout

```
data/
  block-library/
    canonical/                # shipped with the studio
      single-cta-button.json
      hero-image-bg.json
      footer-social.json
      ...
    user/                     # what the user saves
      <id>.json               # full block JSON (pug + styl + slots + preview)
    thumbs/
      <id>.png                # auto-generated thumbnail
    library-index.json        # quick listing for the UI
```

Each canonical block ships as a single JSON. The 11 + 4 entries currently in `data/block-snippets.json` are deprecated by this format (the 11 get re-extracted and validated; the 4 broken ones get rebuilt from clean source templates).

## Pencil mode — in-place visual editor

The current workbench already has a preview-click → editor-highlight bridge:
- Click an element in preview → corresponding line in code editor is selected.

Pencil mode extends this:
- Toggle 🖊 button on the workbench top bar.
- While ON, clicking an element in preview doesn't just highlight — it opens a **floating inspector** anchored to the element with the right controls based on element type:
  - Text element → `contenteditable` text field + "format: bold / italic / link" buttons.
  - Image → "swap image" file picker / URL input.
  - Block container (`<td class="butt">`, `<table class="w280">`) → color picker (background), number input (border-radius, padding).
- Every change writes back into the Pug source (and Stylus where relevant) and re-renders.

This is the **highest-leverage feature** in the constructor stack because:
- Users can edit existing emails visually TODAY without dragging anything.
- It reuses the click-highlight infrastructure that's already working.
- It's the editing surface the constructor needs anyway (when user drags a block, the inspector is what opens to set slot values).

So pencil mode comes BEFORE drag-and-drop in the build order.

## Inside-vs-outside detection on drag

When the user drags a block onto the preview:

1. `dragover` event fires continuously over preview elements.
2. We trace ancestors of the hovered element:
   - If hovered element is inside a `[data-block-id]` (a placed section), and the dragged block has `placement: "inline"` → highlight the section's `block content` slot.
   - If hovered element is between two `[data-block-id]` sections at root level, and the dragged block has `placement: "section"` → highlight that root-level gap.
   - Otherwise → no drop zone highlighted, cursor shows "not allowed".

Source-side: each block, when assembled into the canvas, gets a wrapping marker `//- block-start: <id>` / `//- block-end: <id>` in the Pug, and the rendered HTML has `data-block-id="<id>"`. That's how we know which DOM range corresponds to which canvas block.

## Re-ordered build phases (now richer scope)

Each phase is shippable on its own and unlocks the next.

### Phase 0 — Validate + rebuild the block library (1 day)

Goal: ship 15 **working** blocks before any UI.

- Audit each of the 11 clean snippets:
  - For each, build a tiny standalone test email (`tests/blocks/<id>.pug`) that imports the block and renders it through the real `build-mail.js` pipeline.
  - Pass = the block compiles, renders to HTML, and looks right visually.
  - Fail = mark the block as "broken", flag for rebuild.
- Rebuild the 4 bad 71 KB snippets from their source mails by hand (extract only the relevant table/row, not the whole file).
- Convert all blocks to the new schema (`{ id, label, placement, pug, styl, slots, ... }`) and write them as `data/block-library/canonical/*.json`.
- Generate thumbnails: render block alone in a 600px frame via puppeteer, save 200×150 PNG to `data/block-library/thumbs/`.

**Definition of done**: `node scripts/test-blocks.mjs` walks every block, compiles it, renders it, asserts the result is non-empty + has expected structure. All 15 pass.

### Phase 1 — Pencil mode in workbench (1.5 days)

Wire the floating inspector into the existing preview-click handler.

- Add 🖊 toggle in workbench top bar (state: `state.pencilMode`).
- When ON, override the existing click handler:
  - Trace the clicked element → find its kind (text / image / button / container).
  - Open `<div class="pencil-inspector">` floating near the element.
  - Inspector content depends on kind:
    - text: `<textarea>` + bold / italic / link buttons → on change → patch Pug source at the matched location.
    - image: file input + URL input → swap `src=`.
    - button container (`<td class="butt">` or similar): bg color, text color, border-radius, padding inputs.
  - Live re-render on every change.
- ESC closes inspector; click elsewhere closes inspector.

**Definition of done**: user can open a real email, toggle pencil, click a heading, type new text → preview updates → code editor shows the changed Pug line. Same for image swap and CTA color change.

### Phase 2 — Canvas + section-block drag (1 day)

Static drag-and-drop, section-level only.

- New page `public/constructor.html` (separate from workbench, but same chrome).
- Left: canonical section blocks (filter by category).
- Center: vertical canvas. Drag a section block from sidebar → it appears as a stack item. Reorder by drag, remove with ✕.
- Right: when a canvas item is selected, the pencil-mode inspector opens for it (same component as Phase 1).
- Bottom: Preview button → assembles `canvas[].pug` → renders → iframe.

No inner blocks yet, no save-block yet, no AI yet. Just: pick sections, see the email.

**Definition of done**: drop 4–5 sections into canvas (hero + text + cta + footer), preview shows a valid email shaped roughly right.

### Phase 3 — Inner-block drag with smart drop zones (1 day)

Extend the canvas to accept inner blocks.

- Inline blocks (`placement: "inline"`) get their own catalog tab.
- During `dragover`, trace hovered element's `data-block-id` ancestors → if compatible, show a drop-zone outline INSIDE that section.
- Drop → patch the section's Pug to include the inline block at the chosen position.

**Definition of done**: drop a "Single CTA button" into a "Plain copy text card" → the section's body gets a button at the end → preview shows it correctly.

### Phase 4 — User-saved blocks (1 day)

Right-click any selection in preview → "Save as block".

- Modal: name, category, placement (auto-detected: section if user selected an outer container, inline if inner).
- Auto-detect slots: scan selected Pug for `${{ … }}$` tokens and obvious editable points (link `href`, image `src`, button text node) → propose as slot list, user edits.
- Auto-generate thumbnail via puppeteer.
- Save to `data/block-library/user/<id>.json` + `thumbs/<id>.png`.
- Now appears in catalog under "My blocks" tab.

**Definition of done**: user creates 2 custom blocks from an existing email, the next email they assemble uses them.

### Phase 5 — Build & export (0.5 day)

The "Save email" button on the canvas:

- Combines pug parts → writes to `email-base/<brand>/mail-<name>/app/templates/index.pug` and `blocks/header.pug`.
- Combines styl parts → `app/styles/blocks/main.styl`.
- Builds the locale TXT skeleton from all slot values → `vendor/data/en/<mail>.json`.
- POST `/api/wb/email-create` (existing endpoint) to commit.
- Open the new mail in the workbench.

**Definition of done**: from an empty canvas → 5 minutes of dragging → "Save email" → real mail appears in `email-base/`, opens in workbench, renders perfectly in AR/UR locale.

### Phase 6 — AI tool `compose_email_from_blocks` (0.5 day)

Register a new tool in `src/ai-tools.js`:

```ts
compose_email_from_blocks({
  brand: string,
  mailName: string,
  blocks: [{ id: string, slots: Record<string, any> }]
})
```

Agent describes desired email in natural language; we translate to block IDs + slot values via a separate AI call (small, cheap), then this tool assembles + saves the mail. Because every block in the library is pre-tested, the output is guaranteed renderable.

**Definition of done**: in Agent mode, "сделай welcome email для трейдеров с hero, 3 преимуществами и одной CTA" → AI calls the tool with the right block sequence → preview shows a real email.

## Order of operations (revised)

```
Phase 0  →  block library is REAL                    (1 day)
Phase 1  →  pencil mode (huge user win on its own)   (1.5 days)
Phase 2  →  canvas + section drag                    (1 day)
Phase 3  →  inner-block drag + smart zones           (1 day)
Phase 4  →  user-saved blocks                        (1 day)
Phase 5  →  export to email-base                     (0.5 day)
Phase 6  →  AI compose-from-blocks tool              (0.5 day)
─────────────────────────────────────────────────────────────
Total                                                  ~6.5 days
```

## What I'm starting next

**Phase 0 first**, because every later phase is sand on top of broken blocks. Concretely:
- Write `scripts/test-blocks.mjs` that compiles every entry in `block-snippets.json`, runs it through the real build pipeline, captures pass/fail + any compile errors.
- Categorize: which 11 are salvageable, which 4 need a full rebuild.
- Convert the salvageable ones to the new `{ id, placement, pug, styl, slots, preview }` schema and drop them in `data/block-library/canonical/`.

After Phase 0 reports back, we have a real foundation. Then I go to Phase 1 (pencil mode) — that's the demo-able win.

## Parallel track: keep validating the AI agent

Independent of constructor work:
- Restart server + hard-reload workbench so the latest agent endpoint is live.
- Try Agent mode (🤖 toggle) on a real KYC email. Each run writes to `data/studio-journal.jsonl`.
- After 5–10 runs, run `node scripts/journal-stats.mjs` — gives real data on AI accuracy on YOUR templates, which we then use to calibrate thresholds. This costs us nothing extra and feeds into Phase 6 prompt design.
