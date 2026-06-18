# Studio Workbench Plan

## Product direction

We are not building "just another chat UI".

We are building a **workbench for email operators**:
- left: code / template / locale workspace
- right: live email preview
- side panels: locales, placeholders, assets, blocks, templates
- docked AI chat: ask the studio to edit, translate, restructure, and scaffold

The old `retention-tool-kit` is valuable primarily because its operator workflow is good:
- code-first editing
- immediate preview
- locale loading/editing
- placeholder-oriented workflow
- practical template/brand utilities

That workflow should become the shell of the new studio.

## Target UX

### Core layout
- Left pane: editable source workspace
  - HTML/Pug code tabs
  - locale text tabs
  - placeholder inspector
- Right pane: preview workspace
  - desktop/mobile
  - live rerender
  - block/section inspection
- Bottom or side AI drawer
  - chat with the studio
  - ask for changes
  - apply AI diffs into code / locales / placeholders

### Studio-native capabilities inside that shell
- AI edits existing email safely
- AI generates drafts using `email-base`
- AI works with placeholders deliberately
- AI proposes locale changes per block
- AI uses screenshot/Figma/HTML as input sources
- AI can scaffold blocks, but inside the workbench, not in a detached flow

## Placeholder-first intelligence

One of the key upgrades is:

The studio should not only edit text, but understand placeholder structure:
- detect existing `${{ namespace.block_xx }}$` patterns
- preserve placeholders when editing compiled HTML
- propose placeholder extraction from repeated hardcoded text
- help convert static finished emails into template-ready placeholderized versions

## Recommended architecture

### Keep
- Current server, AI routing, screenshot/Figma intake, `email-base`, layout model
- Legacy operator shell ideas and selected UX patterns

### Add
- Workbench shell based on the old toolkit ergonomics
- AI chat as a docked panel in that shell
- Unified document model:
  - source html/pug
  - locale bundles
  - placeholder map
  - preview state
  - template metadata

### Avoid
- Running two separate apps side by side
- Keeping a "chat app" and a "code app" disconnected
- Treating placeholders as plain string replacement only

## Build order

1. Recreate the legacy workbench shell inside the new studio
2. Connect current preview/build pipeline into that shell
3. Add locale/placeholder/template side panels
4. Dock AI chat into the workbench
5. Teach AI to operate on:
   - code
   - locales
   - placeholders
   - layout model
6. Add placeholder extraction / normalization workflows for existing emails

## Success criteria

The user should be able to:
- open a ready email
- see code on the left and preview on the right
- upload locales
- inspect and edit placeholders
- ask AI to modify the email
- have AI preserve or create placeholders correctly
- keep using `email-base` and template logic underneath

That is the merged product direction.
