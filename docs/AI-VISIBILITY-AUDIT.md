# AI visibility & influence audit

Snapshot of what the studio's AI layer actually sees, what it produces, and what it is allowed to write to disk. Sources are the on-disk code; every claim is anchored with a file path and line number so it can be re-verified after future refactors.

## 1. Pipeline shape (single trip from request to model)

All AI traffic goes through one client wrapper.

- `src/ai-client.js:32` — `callOpenAiWithRetry()` is the only HTTP entry point. 3 attempts, exponential backoff, 120 s timeout. `AI_NO_RETRY_CODES` (line 23) prevents retrying on `invalid_api_key`, `billing_hard_limit_reached`, `model_not_found`.
- `src/ai-client.js:127` — `makeOpenAiClient()` exposes four bound methods: `createDraft`, `createDiscussion`, `createDesignAnalysis`, `createTranslations`. Each forces a JSON-schema reply (line 145) except `createDiscussion` which is freeform.
- `src/ai-schemas.js` — four strict output schemas (`additionalProperties: false`): `responseSchema` (draft), `cloneEditResponseSchema` (HTML edit), `translationResponseSchema`, `designAnalysisSchema`. The model is forced to fill every required field — empty strings and empty arrays are used as "absent".

`server.js` then builds the prompt itself (the model's *input*). Everything below is about input construction.

## 2. What AI sees about the email layout

### 2.1 Generic draft mode

Built in `server.js:10037` (`buildUserContext`) → schema `responseSchema`. The model receives a single concatenated user message containing, in order:

| Block | Source |
|---|---|
| Campaign brief (name, locale, requested locales, audience, goal, tone, CTAs, content notes, brand-style overrides) | `payload.brief.*` |
| Design input type + design URL | `summarizeDesignInputForContext(payload)` |
| Figma structured input + intake enrichment | `summarizeFigmaImportForContext` (line 9615), `summarizeFigmaEnrichmentForContext` |
| Design analysis | `summarizeDesignAnalysisForContext(payload.designAnalysis)` |
| Structured design schema | `summarizeDesignSchema(payload.designSchema)` — from `src/design-schema.js` |
| Design decomposition | `summarizeDesignDecomposition(payload.designDecomposition)` — from `src/design-decomposition.js` |
| Design mapping hints + block recommendations | `summarizeDesignMappingHints`, `summarizeDesignBlockRecommendations` — from `src/design-mapping.js` |
| Structured assets + asset library | `describeAssetPlan`, `summarizeAssetLibraryForContext` |
| Template family profiles | `summarizeTemplateFamilyProfilesForContext(readTemplateFamilyProfilesSnapshot())` — from disk (`data/mail-structure-profiles.json`) |
| Saved project rules | `summarizeProjectRulesForContext` |
| **Email-base deep context** | `buildEmailBaseDeepContext()` — see below |
| Vendor mixins reference + markup patterns reference | `buildVendorMixinsReference`, `buildMarkupPatternsReference` |
| **AI lessons learned** | `getLessonsContextSnapshot()` — persisted journal of past mistakes |
| Category-specific instructions | `buildCategorySpecificInstructions(payload)` |
| Template selection context | `summarizeTemplateSelectionForContext(templateSelection)` |
| Translations source TXT | `summarizeTranslationText(payload.translationText)` |
| Provider id, email-base availability, current base mail folder | hard-coded lines |
| Current draft | `summarizeCurrentDraft(payload.currentDraft)` — **`JSON.stringify(currentDraft, null, 2).slice(0, 6000)`** (`server.js:9203`). Hard 6000-character cap. |
| Conversation transcript | full `payload.messages` concatenated |

`buildEmailBaseDeepContext()` (`server.js:1342`) is the central knob:

- Walks `emailBaseRoot` (line 1349) and lists brands (first 8 only, line 1354).
- For each brand: lists every mail's id, then opens **the first mail in that brand** and reads up to 3 of its template files (`index.pug` + first 2 block files, lines 1364–1370) on disk. From those it extracts up to 6 unique `${{ ns.key }}$` tokens and up to 5 `include` paths.
- Reads `data/block-catalog.json` (line 1402) — emits every catalog entry as `• [id] label (sectionKind) — traits — used in N templates`. **Full catalog, no truncation.**

System prompt for draft mode is composed at `server.js:280`. It is a long fixed string covering Pug mixin contract, studio typography constants, brand-theme extraction rules. It does *not* contain dynamic data.

### 2.2 Clone-edit mode

Triggered when the payload has a `baseEmailHtml`. `server.js:10084` builds a much lighter user message; `server.js:10303` appends the **entire base HTML** between markers:

```
=== FULL BASE EMAIL HTML (edit this, return complete result in mail.modified_html) ===
<full html, NO truncation>
=== END BASE EMAIL HTML ===
```

There is no length guard here. A 200 KB email goes to the model as-is and the response (`modified_html` + `localized_html`) is the entire HTML again. The block catalog and vendor mixin reference are *deliberately skipped* in this mode (comment at `server.js:10084`).

### 2.3 Scaffold mode

Triggered by `payload.scaffoldContext`. `server.js:10046` builds a TINY user message: new mail id, namespace, category, template cloned from, the list of token keys to fill. **No catalog, no current HTML.** The model only returns `mail.locale_entries` (key/value pairs) — it does not see the template file content at this stage.

### 2.4 Design-analysis mode

`buildDesignAnalysisMessages` at `server.js:10369` → schema `designAnalysisSchema`. Same data spine as draft mode minus the lessons block, *plus* up to 6 images appended via `appendVisionInput` (Figma URL, design `dataUrl`, up to 4 reference asset URLs). Images are sent inline with `detail: "high"` for the design and `"auto"`/`"low"` for assets. The structured fields produced (visual_hints, sections_structured, suggested_blocks, asset_slots, content_requirements, warnings) feed back into draft mode via `payload.designAnalysis`.

### 2.5 Discussion (freeform chat)

`buildDiscussionMessages` at `server.js:10328`. Smaller system prompt, similar data spine to draft mode but without the deep email-base catalog. Output is plain text. This is what powers the chat side of the studio when the user is "talking through" an idea.

## 3. What AI sees about locales and translations

### 3.1 Locale TXT format the studio uses

`src/locale-ai.js:3` — locales live as plain TXT with sequential blocks wrapped in `{{...}}`. Inside a block, `@@text@@` becomes `<b>text</b>` at render. Block index is 0-based, padded to 2, exposed in HTML as `${{ <namespace>.block_NN }}$`. AI is taught this format in its prompts.

### 3.2 Three locale-AI primitives

All in `src/locale-ai.js`, all use `gpt-4.1-mini` by default and strict JSON schema output:

| Function | Input the model sees | Output |
|---|---|---|
| `placeholderizeHtml({ html, refLocaleTxt, namespace })` (line 228) | `refBlocks` (parsed text-only blocks from TXT) + `elements` (output of `extractVisibleElements(html)` — numbered list of visible-text elements: tag, text only). **The model never sees CSS, attributes, image URLs, or the HTML structure itself.** | Array of `{ blockIndex, elementId, confidence }` mappings. Server post-validates similarity (line 295) and rejects pairs below 0.3 overlap. |
| `fixLocaleTxt({ txt, refTxt?, language? })` (line 525) | The raw TXT (broken or not) + the already-parsed block array + optionally the reference block array. | New block array. Server force-aligns count to reference (line 580). |
| `translateLocaleTxt({ srcTxt, fromLang, toLang })` (line 604) | The source block array + target language. | Translated block array, count must match input. |

### 3.3 What AI never sees on the locale side

- **Cross-locale diffs**. `public/locale-compare.js` is a client-side side-by-side viewer; its content never reaches the model.
- **Validator findings**. `public/locale-validator.js` rejects garbage uploads before they enter the editor; AI is never told why a file was rejected.
- **The RTL transform output**. `applyLocaleDirectionToHtml` (`src/rtl.js:159`, calls into `email-base/tools/rtl.js`) runs *after* the AI roundtrip, only on previews and on build output — the model always sees LTR text.
- **Sibling locales when generating one**. `translateLocaleTxt` only gets the source locale and a target-language name. There is no "look at the existing AR locale before producing UR" path.

### 3.4 Localization-aware draft mode

When the broader `responseSchema` is used (not the locale primitives), the model produces a `translations` array with `body_blocks`, `cta_labels`, `subject`, `preheader`, `notes`, `source_name` per locale. Server side (`server.js:6143`, `server.js:16941`) takes that array and writes `vendor/data/<locale>/<file>.json` — see §4 for the write path.

## 4. What AI can write (tool-use surface)

The model itself cannot call tools — the schemas are *output* shape, not OpenAI tool-use. All writes go through HTTP endpoints in `server.js` that the studio UI calls after the user accepts an AI result. Two-step pattern: model returns JSON, UI decides whether to commit, commit hits a write endpoint.

### 4.1 Endpoints that mutate `email-base/` or `data/`

| Endpoint | Effect | Path-sanitisation |
|---|---|---|
| POST `/api/wb/email-file` (`server.js:17847`) | Overwrites any file under `email-base/<brand>/<mail>/app/<file>` with arbitrary `content`. | Only strips `..` from each segment — *no allowlist of file extensions*. |
| POST `/api/wb/email-clone` (`server.js:17896`) | `cp -r` source mail folder to a new folder under the same brand. | Sanitises `..` and restricts to `[a-zA-Z0-9_-]`. |
| POST `/api/wb/email-rename` (`server.js:17913`) | `rename()` mail folder. | Same. |
| POST `/api/wb/email-delete` (`server.js:17930`) | Moves mail folder to `email-base/_trash/<brand>/<mail>__<ts>`. Soft-delete; never `rm -rf`. | Same. |
| POST `/api/wb/email-import` (`server.js:17977`) | Creates a new mail folder with imported HTML/Pug as `index.html`/`index.pug` + scaffold of `helpers/`, `blocks/`, `styles/`. | Same. |
| POST `/api/wb/create-brand` (`server.js:18024`) | Creates `email-base/<brand>/` with skeleton. | Same. |
| POST `/api/wb/build-email` (`server.js:17864`) | Spawns `node tools/build-mail.js --category <b> --mail <m>`. Reads sources, writes to `email-base/dist/`. | Same. |
| POST `/api/email-base/create` (`server.js:16812`) | Full draft → email-base mail. Writes `index.pug`, `blocks/header.pug`, `helpers/...`, `app/styles/...`, `vendor/data/<locale>/<file>.json` for every translation, and `studio.mail.json` (the per-mail metadata). Source: `createEmailBaseMailFromDraft`. | Brand name passes through `ensureSafeCategoryName`. |
| POST `/api/email-base/add-locale` (`server.js:16837`) | Reads `studio.mail.json`, picks source locale JSON, runs `createOpenAiTranslations` or `createDeepLTranslations`, writes `vendor/data/<locale>/<file>.json` (line 16941), then `runCommand(node, ['mail','build-pretty', cat, mail, '--locales', locale])`. Returns RTL-applied preview HTML. | Yes. |
| POST `/api/email-base/patch-theme` (`server.js:17352`) | Patches Stylus theme variables for a mail. Writes `app/styles/helpers/variables.styl`. | Yes. |
| POST `/api/email-base/rebuild` (`server.js:17423`) | Re-runs `build-mail.js` for an existing mail across requested locales. | Yes. |
| POST `/api/email-base/scaffold` (`server.js:17281`) | Scaffolds a new system-email mail from a template (one of `system-verification`, `aff-password-reset`, `system-notice-card`, `simple-system-card`, `pug-blocks`). Writes templates + variables.styl + main.styl. | Yes. |
| POST `/api/email-base/html-to-pug` (`server.js:17466`) | Converts an HTML body into Pug. May be a pure transform (no write) or write into a mail if `targetMail` is supplied. Worth verifying in a future audit pass. | Partial. |
| POST `/api/email-base/assemble` (`server.js:17130`) | Takes `pug_blocks` + `brand_theme` and assembles into a new or existing mail folder. | Yes. |
| POST `/api/email-base/build` (`server.js:16779`) | Build only (writes to `dist/`). | Yes. |

### 4.2 Endpoints that are *read-only* (AI never writes from these)

`/api/wb/ai/placeholderize`, `/api/wb/ai/fix-locale-txt`, `/api/wb/ai/translate-locale-txt` (`server.js:17691`–`17742`) all return AI results as JSON; the studio applies them by issuing a *separate* `POST /api/wb/email-file` (or equivalent) call. There is no auto-commit. Same shape for `/api/design/decompose`, `/api/design/analyze`, `/api/translations/generate`, `/api/chat`, `/api/chat/stream` — they return JSON results only.

### 4.3 What AI can write to outside `email-base/`

- `data/assets/` — `POST /api/assets/register` and `POST /api/assets/update` (`server.js:16457`, `16472`). Writes uploaded design/asset images and the registry (`data/asset-registry.json`).
- `data/mail-structure-profiles.json` — `POST /api/mail-structure-profiles/refresh` rebuilds the profiles cache.
- `data/block-catalog.json` — `POST /api/block-catalog/refresh` rebuilds the catalog by scanning `email-base/`.
- `data/scenarios/*.json` — `POST /api/scenarios/save` (`server.js:16727`).
- `data/project-rules.json` — `POST /api/project-rules` (`server.js:16516`).
- `data/lessons.json` — `POST /api/ai/lesson` (`server.js:16986`).
- `data/studio-journal.jsonl` — `appendStudioJournalEntry` is called from many endpoints after a successful mutation; provides an audit trail.

## 5. Gaps and risks

1. **No write guard / dry-run flag.** Once the studio decides to commit, the write endpoints always commit. There is no `?dryRun=true` shape or "preview the file change" mode. A user accepting a bad AI suggestion in the workbench overwrites real templates immediately.
2. **`/api/wb/email-file` accepts any path under `app/`.** It strips `..` but does not check the extension or that the file already exists. The model never directly calls this — only the studio UI does — but a UI bug or a misuse of the studio could write arbitrary content.
3. **Clone-edit HTML is not truncated.** `payload.baseEmailHtml` is appended verbatim (`server.js:10303`). For very large emails this can exceed context window. A guard like "if length > N, summarise structure first" would be cheap.
4. **Current-draft summary capped at 6000 chars.** `server.js:9203` truncates with a hard slice; on big drafts this loses the tail. If the model needs to see late sections, they are silently absent.
5. **AI never sees its own RTL output.** Because `applyLocaleDirectionToHtml` runs *after* the AI call, the model has no feedback loop on whether the buttons/text aligned correctly. RTL bugs (like the squeeze we just fixed) are invisible to the model unless the user pastes a screenshot.
6. **Cross-locale awareness is one-shot.** When generating a new translation, the model sees only the source TXT and a target language. It cannot consult sibling locales, the validator, or previously-approved translations stored in `vendor/data/*`. This is fine for fan-out from one source, less fine for incremental locale work.
7. **Block catalog is sent in full every call.** No pagination, no relevance filter. For very large block libraries this is wasted tokens. `block-ranking.js` exists and could feed a top-N selection per request.
8. **The "first 8 brands" cap in `buildEmailBaseDeepContext` is silent.** Adding a 9th brand quietly hides it from the model.

## 6. Suggested next experiments

- Probe the model's awareness of the layout: feed it a real LTR HTML email plus its RTL'd build, ask it to explain the diff. If it can explain *why* the RTL pass moved a button right, the studio could safely use the model to author future RTL adjustments.
- Probe its locale awareness: present three locales (en, ar, ur) side-by-side and ask it to flag inconsistencies (length, missing placeholders, bold-marker mismatches). Today no endpoint feeds this to it, but `placeholderizeHtml`'s element extractor + a small wrapper would.
- Tighten the writes: add a `dryRun: true` flag to `/api/wb/email-file` and the email-base writers that returns the diff without committing. Low cost, high safety win.
- Replace the "first 8 brands" + 3-files cap with a per-request relevance selection driven by `block-ranking.js` and the active campaign brief.
