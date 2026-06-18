# Legacy Toolkit Merge Plan

This project should absorb `retention-tool-kit` as a capability source and UI/workbench reference, not as a second standalone app bolted on top.

## What we keep from the current studio
- Chat-first intake and orchestration
- AI routing, screenshot/Figma intake, layout model, scenario runner
- `email-base` build pipeline and template browser
- Structured debug and regression infrastructure

## What is worth reusing from the old toolkit
- Code-left / preview-right operator workflow
- Brand preset model from `server/brands.json`
- Template library model from `server/templates.json`
- Folder-based locale intake (`folder -> locale -> json/txt`)
- Practical HTML utilities for placeholder replacement and localized editing
- Optional PDF export flow as a side utility, not as the core app shell

## What we should not migrate as-is
- The old React app shell
- Direct JSON-file CRUD APIs as the primary storage model
- Build artifacts committed in the repo
- Duplicated JS/TS components
- Server design that writes operational state directly into mutable JSON files

## Recommended merge strategy

### Phase 1: Data compatibility
- Import old brand presets into a normalized manifest
- Import old templates into a normalized manifest
- Preserve legacy placeholder metadata so current studio can reason about it
- Keep the imported snapshot read-only at first

### Phase 2: Feature extraction
- Recreate the legacy workbench shell ergonomics in the new studio
- Reintroduce brand preset selection inside the new studio
- Reintroduce legacy template snippets as optional starter blocks
- Reuse locale folder intake for bulk locale loading
- Expose PDF export as a utility action, not as the app foundation

### Phase 3: Studio-native integration
- Dock AI chat inside the workbench instead of keeping it as a detached primary UI
- Map legacy templates into `LayoutModel`
- Treat imported legacy templates as another assembly source alongside `email-base`
- Let the current studio choose:
  - `email-base`
  - `legacy-template`
  - `freeform draft`
- Add placeholder-aware editing so AI can preserve and scaffold template tokens correctly

### Phase 4: Cleanup and retirement
- Replace direct dependencies on the old repo with imported manifests and extracted modules
- Keep the old repo only as an audit/reference source

## Immediate implementation plan
1. Clone old repo locally and inspect real capabilities
2. Import legacy brands/templates into a normalized snapshot
3. Add a compatibility layer so current studio can see those assets
4. Decide which old utilities become:
   - native studio modules
   - optional tools
   - discarded legacy code

## Decision
We should merge the projects by **rebuilding the old operator workbench ergonomics inside the new studio** while extracting and normalizing the old toolkit data/utilities. The result should be one app, one shell, one pipeline.
