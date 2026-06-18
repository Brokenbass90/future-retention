# Outline Mode — spec

**Goal:** in-place block insertion at arbitrary positions in an existing email's source pug, driven by a visual outline rather than CodeMirror cursor.

## What this replaces

The floating "Конструктор блоков" carousel (`#blocksCarousel` + `#blocksCarouselFab` in workbench.html lines 333–353). That UI required the user to position the CodeMirror cursor first, then click a tile. For multi-hundred-line existing emails this is unworkable.

## What stays

- `insertEmailBlock(block, { line, before })` in workbench.js:4163 — already accepts a line-number placement. Outline mode just calls it with the right line.
- Pencil mode + Inspector popup — keep as-is; complementary, not competing.
- Bottom-bar (HTML-аудит / Export / Бренды / База / PDF) — untouched.
- `/constructor` standalone page — kept for greenfield (new-mail-from-scratch) assembly.

## Parser

`parseSourcePugBlocks(pugText) → Array<{ id?, label, startLine, endLine, kind }>`

Two strategies, tried in order:

1. **Marker mode** (composed mails written by `composeEmailFromBlocks`):
   Pug contains `//- block-start: <id>` and `//- block-end: <id>` comments. Walk pairs.
2. **Heuristic mode** (legacy hand-written mails like `mail-lp-joined-lvl2`):
   Top-level (indent === 0) lines matching `/^table\.row/` open a block.
   The block extends until the next top-level `table.row` line or EOF.
   Label = the row's class chain truncated, e.g. `table.row.brad-full.bg-img-bottom` → `row · brad-full · bg-img-bottom`.

If neither strategy yields ≥ 1 block, outline shows: "Этот файл не структурирован по блокам. Открой источник в редакторе или используй `/constructor` для письма с нуля."

## Outline UI

Lives as a left-side rail in workbench (`<aside class="outline-rail">`), shown only when the active file is `.pug` / `.jade`. Toggle button in the editor toolbar (next to pencil): 📑 outline.

```
┌─ Структура письма  (N блоков) ─┐
│  ┌─────────────────────────┐   │
│  │ ▸ #1  header-logo       │   │
│  └─────────────────────────┘   │
│         [+ вставить]           │
│  ┌─────────────────────────┐   │
│  │ ▸ #2  row · brad-full   │   │
│  └─────────────────────────┘   │
│         [+ вставить]           │
│  …                             │
└────────────────────────────────┘
```

Interactions:

- **Click on an outline row** → CodeMirror scrolls to `startLine` + selects the block's line range; iframe scrolls to corresponding rendered block (best-effort: scrollIntoView by index match).
- **Click on `[+ вставить]`** → popover with two tabs (`canonical` / `user`) listing blocks from `/api/blocks-library` (the same source used by `/constructor`). Click a block → `insertEmailBlock(block, { line: previousBlock.endLine + 1, before: true })`. Popover closes.
- **Right-click on an outline row** → context menu: "Удалить блок" → `cm.replaceRange('', {line:s,ch:0}, {line:e+1,ch:0})`.
- **Drag handle on an outline row** → reorder (Phase 2 — not in MVP).

## Re-parse trigger

Every time the source file is saved or its contents change by > 1 line, re-run `parseSourcePugBlocks`. Cheap (regex pass over text). Show animation on rows whose label changed.

## What's intentionally NOT in MVP

- Drop-targets overlaid on iframe (we'd need to map rendered nodes back to source lines — non-trivial). Outline + click is enough for v1.
- Block reordering via drag.
- Cross-file block-move (header.pug → footer.pug).
- Inspector expansion (background-image, padding sliders) — separate task #38 followup.

## Open questions

1. **What counts as a "block" in heuristic mode for nested structures?** Currently only top-level `table.row`. But `mail-lp-joined-lvl2` has its content under one `table.row`, then nested `table.ten.columns` etc. Probably need to also surface `td.text-pad-*` direct children of those tables as sub-blocks. Defer to v2 if v1 looks too coarse on a real mail.
2. **Where to put the rail?** Inside the editor pane (replaces minimap area), or as a third column? Inside editor is cleaner; lose minimap. Acceptable trade.
3. **Iframe-to-source highlight on outline click — best-effort or precise?** Best-effort by N-th `<table class="row">` match. If misaligned, user falls back to source view.
