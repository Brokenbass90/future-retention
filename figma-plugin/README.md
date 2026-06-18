# RetKit — Figma plugin (Send frame to Studio)

Lets a **closed/company Figma** feed the studio without the REST API: the plugin
runs inside Figma with your own access, reads the selected frame, and emits the
studio's structured-import JSON. You either send it straight to the studio or
copy-paste it into the studio's **Figma payload** box.

## Install (dev / unpublished)

1. In Figma desktop: **Plugins → Development → Import plugin from manifest…**
2. Pick `figma-plugin/manifest.json` from this repo.
3. Run the studio locally: `npm start` (default `http://localhost:3000`).

## Use

1. Select **one frame** of the email in Figma.
2. **Plugins → Development → RetKit — Send frame to Studio.**
3. Either:
   - **Отправить в студию** — POSTs to `http://localhost:3000/api/figma/import`
     (set the URL / secret fields if different), or
   - **Скопировать JSON** — paste it into the studio's *Figma payload* textarea.
4. The studio decomposes it (sections / texts / images / style tokens) and
   returns a `composePlan` — a ready block-assembly that builds a real email.

## What it extracts

- **Sections** — top-level frame children, role-guessed by name (header / hero /
  cta / footer / feature-list / image / text).
- **Texts** — every text node with its content, font, size, color, and the
  section it belongs to. Largest text → `heading`, text inside a button → `cta`.
- **Images** — nodes with image fills or logo/icon-ish names.
- **Style tokens** — `bgColor`, `headingColor`, `textColor`, `primaryColor`
  (button fill), `primaryTextColor`, `buttonRadius`, `fontFamily`. These flow
  into the blocks' style slots, so the email matches the design by style, not
  just content.
- **Preview PNG** — for reference only (not inserted as content).

## Contract

The payload matches `src/figma-contract.js`. The studio path is:
`/api/figma/import` → `buildInternalDesignSchema` → `buildComposePlanFromDesign`
→ `composeEmailFromBlocks` → `build-mail`. Verified by
`scripts/test-figma-plugin-intake.mjs`.
