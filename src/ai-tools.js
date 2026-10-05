/**
 * src/ai-tools.js — OpenAI Responses API tool definitions for the
 * email-studio agent.
 *
 * Each tool has:
 *   - `definition`: the JSON spec passed to the model (name, description,
 *     parameters schema). The model picks tools by name and supplies
 *     parameters matching the schema.
 *   - `handler(args, ctx)`: a Node-side async function that executes the
 *     tool and returns a JSON-serializable result. `ctx` carries the
 *     per-request state: { html, namespaces, activeLocale, apiKey, ... }.
 *
 * The agent loop in server.js sends tool definitions to the model,
 * dispatches the model's tool_call requests to these handlers, and
 * feeds the result back into the next turn. Each tool call is journaled.
 *
 * Tool catalogue:
 *   • read_open_html          — return the HTML currently open in the editor
 *   • list_namespaces         — list loaded locale namespaces + sizes
 *   • get_namespace_blocks    — fetch blocks of one namespace+locale
 *   • analyze_email           — run the zero-AI structural analysis
 *   • placeholderize_html     — run the AI placeholderize (parent-chain + 2-pass)
 *   • fix_locale_txt          — repair one locale's TXT against the reference
 *   • translate_locale_txt    — translate source TXT into a target language
 *   • finish                  — signal that the agent is done; carries
 *                               a human-readable summary for the user
 */

import { placeholderizeHtml, fixLocaleTxt, translateLocaleTxt } from "./locale-ai.js";
import { normalizeLocaleConventions, parseNormalizedBlocks, alignLocaleToReference, serializeAligned, localePrefix } from "./locale-conventions.js";
import { analyzeLocaleAgainstHtml } from "./locale-analyze.js";
import { compareLocales } from "./locale-cross-check.js";
import { listHtmlSections, insertHtml, removeHtml } from "./html-blocks.js";
import { validateHtml } from "./html-validate.js";
import path from "node:path";
// Shared smart find/replace (same file the Workbench ⌘F strip and RetKit for
// MoEngage use): & == &amp;, image-by-file-name mode, built-ins never change.
import "../public/replace-across.js";
const ReplaceAcross = globalThis.RetKitReplaceAcross;
import {
  composeEmailFromBlocks,
  listCanonicalBlocks,
  loadCanonicalBlock,
  resolveComposeEmailTarget,
  userBlockPath,
} from "./compose-email.js";
import { withComposeSaveTransaction } from "./compose-save-transaction.js";
import { previewForBlock } from "./block-previews.js";
import { saveUserBlockWithLifecycle } from "./block-library-review.js";
import { rmSync as _rmSyncBlocks, existsSync as _existsSyncBlocks } from "node:fs";
import "../public/canvas-slot-values.js";
import { checkCanvasReady, describeLeftovers } from "./canvas-completeness.js";
import { seeEmail, seeBlock } from "./agent-vision.js";
import { attachPreviews } from "./block-previews.js";
import {
  openDraft, listDrafts, draftChanges, publishDraft, discardDraft, listSnapshots,
} from "./mail-drafts.js";
import { listMailFiles, readMailFile, writeMailFile } from "./agent-mail-files.js";
import { writeFileSync as fsWriteFileSync } from "node:fs";

/**
 * Дерево канваса с уже применёнными правками этого разговора.
 *
 * Без этого проверка ругалась бы на текст, который агент только что заменил:
 * ctx.canvasSummary — снимок на момент запроса, а правки лежат в ctx.canvasOps
 * и применяются в браузере. Считать по устаревшему снимку значит гонять агента
 * по кругу за уже сделанную работу.
 *
 * Повтор безопасен: инструменты уже поправили ctx.canvasSummary, поэтому
 * каждая операция здесь идемпотентна — добавление не задваивается, удаление
 * отсутствующего блока молчит. Порядок (move) на готовность письма не влияет,
 * поэтому он здесь и не пересчитывается: дважды применённая перестановка
 * вернула бы блок на место.
 */
export function mergeCanvasOps(ctx) {
  let base = (Array.isArray(ctx?.canvasSummary) ? ctx.canvasSummary : [])
    .map((entry) => ({ ...entry, slots: { ...(entry.slots || {}) } }));
  for (const op of Array.isArray(ctx?.canvasOps) ? ctx.canvasOps : []) {
    const kind = String(op?.kind || "update");
    if (kind === "clear") { base = []; continue; }
    if (kind === "remove") {
      const doomed = canvasSubtreeUids(base, op?.uid);
      base = base.filter((entry) => !doomed.has(String(entry.uid)));
      continue;
    }
    if (kind === "add") {
      for (const entry of Array.isArray(op?.entries) ? op.entries : []) {
        if (base.some((candidate) => String(candidate.uid) === String(entry.uid))) continue;
        base.push({ ...entry, slots: { ...(entry.slots || {}) } });
      }
      continue;
    }
    if (kind === "move") continue;
    const target = base.find((entry) => String(entry.uid) === String(op?.uid));
    if (target && op?.slots) Object.assign(target.slots, op.slots);
  }
  return base;
}

const mergedCanvas = mergeCanvasOps;

/** Блок и всё, что в нём лежит: удаление блока уносит поддерево. */
function canvasSubtreeUids(tree, uid) {
  const doomed = new Set([String(uid)]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const entry of tree) {
      if (doomed.has(String(entry.uid))) continue;
      if (entry?.parentUid != null && doomed.has(String(entry.parentUid))) {
        doomed.add(String(entry.uid));
        grew = true;
      }
    }
  }
  return doomed;
}

function canvasTree(ctx) {
  if (!Array.isArray(ctx.canvasSummary)) ctx.canvasSummary = [];
  return ctx.canvasSummary;
}

function pushCanvasOp(ctx, op) {
  ctx.canvasOps = ctx.canvasOps || [];
  ctx.canvasOps.push(op);
}

function shortReason(value) {
  return String(value || "").slice(0, 200);
}

function canvasMiss(tree, uid) {
  return {
    error: `no block with uid ${uid} on the canvas`,
    availableUids: tree.map((entry) => ({ uid: entry.uid, blockId: entry.blockId })).slice(0, 40),
  };
}

/**
 * Временный uid для блока, которого на канвасе ещё нет.
 *
 * Настоящий uid выдаёт браузер, когда применяет пакет, — но агенту номер
 * нужен раньше: поставить блок и тут же заменить в нём образцовый текст он
 * должен в одном заходе. Браузер связывает временный номер с настоящим.
 */
function nextCanvasTempUid(ctx) {
  ctx.canvasTempUid = (Number(ctx.canvasTempUid) || 0) + 1;
  return `new-${ctx.canvasTempUid}`;
}

function canvasEntryFor(block, uid, userSlots) {
  const slots = {};
  for (const slot of block?.slots || []) {
    if (!slot?.id) continue;
    if (Object.prototype.hasOwnProperty.call(userSlots || {}, slot.id)) slots[slot.id] = userSlots[slot.id];
    else if ("default" in slot) slots[slot.id] = slot.default;
  }
  return {
    uid,
    blockId: block.id,
    ...(block.source ? { blockSource: block.source } : {}),
    parentUid: null,
    slotId: null,
    slots,
    slotSchema: (block?.slots || []).map((slot) => ({
      id: slot.id,
      kind: slot.kind || "text",
      label: slot.label || slot.id,
      ...(Array.isArray(slot.options) ? { options: slot.options } : {}),
    })),
  };
}

const CANVAS_SLOT_VALUES = globalThis.RetkitCanvasSlots;

function serializeBlocks(blocks) {
  return Array.isArray(blocks) && blocks.length
    ? blocks.map((b) => `{{${b}}}`).join("\n\n") + "\n"
    : "";
}

function pickNamespace(ctx, name) {
  if (!Array.isArray(ctx.namespaces)) return null;
  if (!name) return ctx.activeNamespace || ctx.namespaces[0] || null;
  return ctx.namespaces.find((n) => (n.namespace || n.name) === name) || null;
}

export const TOOL_DEFINITIONS = [
  {
    type: "function",
    name: "read_open_html",
    description:
      "Return the HTML currently open in the studio editor and its byte length. " +
      "Always call this BEFORE placeholderize_html or analyze_email — they need the live HTML.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {},
      required: [],
    },
  },
  {
    type: "function",
    name: "list_namespaces",
    description:
      "List all locale namespaces currently loaded in the workbench. " +
      "Each namespace has a name, available locale codes (with block counts), and a reference locale.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {},
      required: [],
    },
  },
  {
    type: "function",
    name: "get_namespace_blocks",
    description:
      "Fetch the parsed blocks of one namespace+locale as an array of strings. " +
      "Use this when you need to read the actual block text (e.g. before fix_locale or translate).",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        namespace: { type: "string", description: "Namespace name." },
        locale: { type: "string", description: "Locale code, e.g. 'en' or 'ar'." },
      },
      required: ["namespace", "locale"],
    },
  },
  {
    type: "function",
    name: "analyze_email",
    description:
      "Run a STRUCTURAL analysis of the email against a reference locale — no further AI call. " +
      "Returns coverage stats (anchor / candidate / orphan blocks), hardcoded HTML text, and " +
      "cross-locale drift report. Always call this BEFORE placeholderize so you know if " +
      "the HTML and the locale are aligned. Cheap, fast, offline.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        namespace: { type: "string", description: "Namespace to analyze." },
        refLocale: { type: "string", description: "Reference locale code (default 'en')." },
      },
      required: ["namespace"],
    },
  },
  {
    type: "function",
    name: "align_locales_to_reference",
    description:
      "Bring EVERY locale of a namespace to the SAME block structure as the reference " +
      "(usually en): same number of blocks, same order, platform {{variables}} in the same " +
      "positions. Deterministic, zero-AI, offline. Missing blocks are padded with empty " +
      "spacers; conventions ({{embedded.*}} variables, brace balance) are normalized first. " +
      "This is the step that makes placeholderize land correctly — run it BEFORE placeholderize " +
      "whenever locales drifted. Use for 'сверь все локали с английской и приведи к единому виду', " +
      "'выровняй блоки по en', 'чтобы блоки шли по порядку как в английской'. It does NOT translate " +
      "text — it only re-structures. Returns a per-locale report (before/after block counts, padded). " +
      "Staged like other locale edits — applied after the user confirms.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        namespace: { type: "string", description: "Namespace name (default: active namespace)." },
        refLocale: { type: "string", description: "Reference locale to align to (default: en* or first)." },
      },
      required: [],
    },
  },
  {
    type: "function",
    name: "compare_locales",
    description:
      "Cross-check ALL locales of a namespace against a reference locale (zero-AI, " +
      "offline, cheap). Flags structural drift that breaks emails or signals bad " +
      "translations: differing block counts, missing/extra {{variables}}, @@bold@@ " +
      "mismatches, unbalanced bold markers, empty (untranslated) blocks, and blocks " +
      "that are byte-identical to the reference (forgotten translation). Use when the " +
      "user says 'сверь локали', 'сравни все локали', 'все ли локали совпадают', or " +
      "before/after translating to verify consistency. Returns per-locale issue lists.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        namespace: { type: "string", description: "Namespace name (default: active namespace)." },
        refLocale: { type: "string", description: "Reference locale code (default: en* or first)." },
      },
      required: [],
    },
  },
  {
    type: "function",
    name: "placeholderize_html",
    description:
      "Insert ${{ ns.block_NN }}$ placeholders into the HTML so each reference block " +
      "is anchored to the right element. Uses parent-chain context to disambiguate " +
      "identical text in different sections, and a second-pass validator for unmapped blocks. " +
      "Returns the rewritten HTML and a structured decision report.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        namespace: { type: "string", description: "Namespace whose blocks define the anchors." },
        refLocale: { type: "string", description: "Reference locale code (default 'en')." },
      },
      required: ["namespace"],
    },
  },
  {
    type: "function",
    name: "fix_locale_txt",
    description:
      "Repair one locale's TXT against the reference locale: balance {{}} brackets, @@ markers, " +
      "block count. Returns the fixed TXT as a new array of blocks. Does NOT translate — " +
      "use translate_locale_txt for that.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        namespace: { type: "string", description: "Namespace name." },
        locale: { type: "string", description: "Target locale code to fix." },
        refLocale: { type: "string", description: "Reference locale code (default 'en')." },
      },
      required: ["namespace", "locale"],
    },
  },
  {
    type: "function",
    name: "translate_locale_txt",
    description:
      "Translate the source locale TXT into a target language, block by block, preserving " +
      "@@bold@@ markers, {{Var}} placeholders, and inline HTML tags. If the target locale " +
      "does not exist yet it will be created (same as create_locale with translate=true).",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        namespace: { type: "string", description: "Namespace name." },
        fromLocale: { type: "string", description: "Source locale code (default 'en')." },
        toLocale: { type: "string", description: "Target locale code." },
      },
      required: ["namespace", "toLocale"],
    },
  },
  {
    type: "function",
    name: "find_across_locales",
    description:
      "Find a URL, image src, link or text in the WHOLE email at once: the email code AND every " +
      "locale of every namespace. Returns per-place counts with kind (image/link/background/text) " +
      "and context. & and &amp; are treated as the same. For images uploaded per locale under " +
      "different paths use mode='filename' (matches every URL ending with the same file name). " +
      "Built-in (locked) namespaces are reported with locked=true and are never changed. " +
      "Use this BEFORE replace_across_locales.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        query: { type: "string", description: "What to find: URL, file name, link or text (verbatim)." },
        mode: { type: "string", enum: ["text", "filename"], description: "text (default) or filename for images." },
      },
      required: ["query"],
    },
  },
  {
    type: "function",
    name: "replace_across_locales",
    description:
      "Replace a URL, image, link or text everywhere in one step: the email code and all locales " +
      "(or only the listed ones). Same rules as find_across_locales; the replacement keeps the " +
      "&amp; encoding of what it replaces; locked namespaces are skipped. Changes are staged like " +
      "replace_in_html and reach the studio after the user confirms. Call find_across_locales first.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        search: { type: "string", description: "What to replace (as found by find_across_locales)." },
        replace: { type: "string", description: "Replacement (new URL / text)." },
        mode: { type: "string", enum: ["text", "filename"], description: "text (default) or filename for images." },
        includeHtml: { type: "boolean", description: "Also change the email code (default true)." },
        locales: { type: "array", items: { type: "string" }, description: "Only these: locale codes (en, ar) or 'namespace|locale'. Default: all editable." },
      },
      required: ["search", "replace"],
    },
  },
  {
    type: "function",
    name: "find_in_html",
    description:
      "Search the CURRENT email HTML (including your own pending edits) for a string. " +
      "Returns every match with surrounding context so you can build an exact, unambiguous " +
      "`search` string for replace_in_html. Use this BEFORE replace_in_html.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        query: { type: "string", description: "Text or HTML fragment to find (verbatim)." },
        maxMatches: { type: "integer", description: "Max matches to return (default 5)." },
      },
      required: ["query"],
    },
  },
  {
    type: "function",
    name: "replace_in_html",
    description:
      "Make a PRECISE edit to the current email HTML: replace an exact string with a new one. " +
      "Use for targeted fixes the user asks for: make a phrase bold (wrap in <strong>), swap a " +
      "logo/image URL, fix a link, change a word. The search string must be unique — if it " +
      "matches several places, the tool refuses and tells you the count; extend the search " +
      "string with surrounding context (use find_in_html) and retry. NEVER rebuild the whole " +
      "document — emails are sacred Pug+Stylus builds; this tool is for surgical touches only.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        search: { type: "string", description: "Exact string to find (must be unique unless replaceAll)." },
        replace: { type: "string", description: "Replacement string." },
        replaceAll: { type: "boolean", description: "Replace every occurrence (default false — exactly one required)." },
      },
      required: ["search", "replace"],
    },
  },
  {
    type: "function",
    name: "create_locale",
    description:
      "Create a NEW locale in a namespace. If translate=true (default) and a source locale exists, " +
      "the content is translated from the source via AI. If translate=false, the source blocks are " +
      "copied as-is (a stub the user edits manually). Use when the user asks to add/create a locale " +
      "(e.g. 'добавь немецкую локаль', 'создай ar').",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        namespace: { type: "string", description: "Namespace name (default: active namespace)." },
        locale: { type: "string", description: "New locale code, e.g. 'de', 'ar', 'pt_BR'." },
        fromLocale: { type: "string", description: "Source locale code (default: reference, usually 'en')." },
        translate: { type: "boolean", description: "Translate via AI (default true). false = copy source as stub." },
      },
      required: ["locale"],
    },
  },
  {
    type: "function",
    name: "normalize_locale_conventions",
    description:
      "Deterministic (zero-AI) repair of locale TXT against the project conventions: " +
      "system variables like {{embedded.company_email}} or {{user_name}} must NOT live inside " +
      "text blocks — the block is split around them ({{text}} {{var}}{{tail}}); unclosed " +
      "{{var braces are closed; the Subject: line stays outside blocks (that's normal). " +
      "ALWAYS run this BEFORE placeholderize_html and BEFORE fix_locale_txt when the analysis " +
      "shows nested variables or unbalanced braces. Pass locale='all' to fix every locale.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        namespace: { type: "string", description: "Namespace name (default: active namespace)." },
        locale: { type: "string", description: "Locale code, or 'all' for every locale in the namespace." },
      },
      required: ["locale"],
    },
  },
  {
    type: "function",
    name: "delete_locale",
    description:
      "Delete a locale from a namespace. Use when the user asks to remove a locale " +
      "(e.g. 'удали арабскую локаль'). The studio asks the user to confirm before applying. " +
      "Refuses to delete the reference locale unless force=true.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        namespace: { type: "string", description: "Namespace name (default: active namespace)." },
        locale: { type: "string", description: "Locale code to delete." },
        force: { type: "boolean", description: "Allow deleting the reference locale. Default false." },
      },
      required: ["locale"],
    },
  },
  {
    type: "function",
    name: "edit_locale_block",
    description:
      "Edit ONE block of ONE locale: set block #index (0-based) to the given text. " +
      "Zero-AI, precise, cheap. Use for targeted text fixes the user dictates " +
      "(e.g. 'в ru во втором блоке замени X на Y' — read blocks first via get_namespace_blocks, " +
      "compute the new text yourself, then call this).",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        namespace: { type: "string", description: "Namespace name (default: active namespace)." },
        locale: { type: "string", description: "Locale code." },
        index: { type: "integer", description: "Block index, 0-based (same order as get_namespace_blocks)." },
        text: { type: "string", description: "Full new text of the block." },
      },
      required: ["locale", "index", "text"],
    },
  },
  {
    type: "function",
    name: "validate_html",
    description:
      "Structural check of the OPEN email: unclosed/mismatched HTML tags, unbalanced " +
      "{{ }} variables, broken ${{ … }}$ placeholder tokens, odd @@bold@@ markers. " +
      "Heuristic and instant (offline). Call it AFTER an HTML edit to confirm nothing " +
      "broke, or when the user reports rendering glitches / 'съехало'.",
    parameters: { type: "object", additionalProperties: false, properties: {}, required: [] },
  },
  {
    type: "function",
    name: "list_email_sections",
    description:
      "List the blocks/sections of the OPEN email when it carries rk:block markers " +
      "(emails built by the constructor/compose pipeline). Returns index, id and a text " +
      "preview per section. If the email has NO markers (most compiled emails), it says so — " +
      "in that case locate the block to edit with find_in_html and use insert_block/remove_block " +
      "with a unique anchor instead.",
    parameters: { type: "object", additionalProperties: false, properties: {}, required: [] },
  },
  {
    type: "function",
    name: "insert_block",
    description:
      "Insert an HTML block/snippet into the OPEN email — this is how you ADD a block. " +
      "Either anchor it to a UNIQUE existing substring (position before/after) or drop it at " +
      "body_start / body_end. The anchor must match exactly ONE place — find it with find_in_html " +
      "first. Provide the block markup in `html`. To add a block similar to an existing one, copy " +
      "that block's markup (read_open_html / find_in_html), tweak it, and insert it. Staged like " +
      "other HTML edits — applied after the user confirms.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        anchor: { type: "string", description: "Unique existing substring to anchor to. Omit when using body_start/body_end." },
        position: { type: "string", enum: ["before", "after", "body_start", "body_end"], description: "Where to place the snippet relative to the anchor (or body)." },
        html: { type: "string", description: "The HTML markup to insert (one block at a time)." },
      },
      required: ["position", "html"],
    },
  },
  {
    type: "function",
    name: "remove_block",
    description:
      "Remove a block/section from the OPEN email — this is how you DELETE a block. Pass either a " +
      "single UNIQUE `block` substring (the whole block markup), or a `from`+`to` anchor pair to " +
      "remove an inclusive region. Both must resolve to exactly one place (use find_in_html). " +
      "Refuses to delete more than half the document. Staged like other HTML edits.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        block: { type: "string", description: "The full unique markup of the block to remove." },
        from: { type: "string", description: "Unique start anchor (use with `to`)." },
        to: { type: "string", description: "End anchor after `from` (region removed inclusively)." },
      },
      required: [],
    },
  },
  {
    type: "function",
    name: "list_canonical_blocks",
    description:
      "List only release-safe canonical blocks (never imported/legacy campaign slices). " +
      "Each entry has id, label, placement (outer / section / inner), combo, childSlots and slots[]. " +
      "Use this BEFORE compose_email_from_blocks so you know which ids exist and what slots they expect.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {},
      required: [],
    },
  },
  {
    type: "function",
    name: "find_blocks_by_look",
    description:
      "Search the block library by HOW A BLOCK LOOKS, not by its name. Every block has a " +
      "pre-rendered preview and a visual signature (size, palette, whether it has images / " +
      "buttons / list items / columns, how much text, responsive or fixed). " +
      "USE THIS when the user attaches a screenshot or describes a block visually " +
      "('find a hero with a big background image and a button', 'a two-column card row', " +
      "'the orange promo panel'). Look at the attached image yourself, then translate what " +
      "you see into the structural filters below. " +
      "Blocks that look identical are grouped: by default only one representative per group " +
      "is returned, so you get variety instead of 40 near-identical text blocks.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        query: { type: "string", description: "Free text matched against label, id, description, tags and category." },
        placement: { type: "string", enum: ["outer", "section", "inner", "inline", "both", "any"], description: "Where the block goes. Default any." },
        category: { type: "string", description: "hero / cta / text / image / feature-list / footer / utility / header / section" },
        hasImage: { type: "boolean", description: "Block contains at least one image." },
        hasButton: { type: "boolean", description: "Block contains a button-like element." },
        hasList: { type: "boolean", description: "Block contains list items." },
        minColumns: { type: "number", description: "At least this many columns in a row (2 = two-column layout)." },
        minHeight: { type: "number", description: "Rendered height at 600px width, in px." },
        maxHeight: { type: "number" },
        backgroundLike: { type: "string", description: "Hex colour the block background should be close to, e.g. #FF7700." },
        responsive: { type: "boolean", description: "Only blocks that reflow on mobile." },
        includeDuplicates: { type: "boolean", description: "Return every look-alike instead of one per group. Default false." },
        includeLegacy: { type: "boolean", description: "Include imported legacy slices. Default true — say false for release-safe blocks only." },
        limit: { type: "number", description: "Max results, default 12, hard cap 40." },
      },
      required: [],
    },
  },
  {
    type: "function",
    name: "get_block_source",
    description:
      "Read the FULL source of one block from the library (canonical, imported or user): " +
      "pug, styl (incl. @media mobile rules), slots with defaults, placement, category, tags, usage stats. " +
      "Use when you need to understand exactly how a block is built, check its mobile adaptation, " +
      "or prepare an edited copy for save_user_block.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        id: { type: "string", description: "Block id from list_canonical_blocks." },
      },
      required: ["id"],
    },
  },
  {
    type: "function",
    name: "save_user_block",
    description:
      "Create or update a USER block in data/block-library/user/. Blocks are {pug, styl} pairs " +
      "with {{ slot }} tokens; styl may contain @media rules for mobile. " +
      "Set force=true to overwrite an existing user block. Canonical/imported blocks cannot be " +
      "overwritten — copy them via get_block_source, modify, and save under a NEW id.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        id: { type: "string", description: "1-64 chars: letters/digits/_/-" },
        label: { type: "string" },
        description: { type: "string" },
        placement: { type: "string", enum: ["section", "inline", "helper"] },
        category: { type: "string", description: "hero / cta / text / image / feature-list / footer / utility / misc" },
        pug: { type: "string", description: "Pug source with {{ slot }} tokens." },
        styl: { type: "string", description: "Stylus/CSS source, may include @media blocks." },
        slots: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: true,
            properties: {
              id: { type: "string" },
              kind: { type: "string" },
              label: { type: "string" },
              default: {},
            },
            required: ["id"],
          },
        },
        tags: { type: "array", items: { type: "string" } },
        force: { type: "boolean", description: "Overwrite existing user block with same id." },
      },
      required: ["id", "pug"],
    },
  },
  {
    type: "function",
    name: "delete_user_block",
    description: "Delete a USER block by id (only blocks in data/block-library/user/; canonical and imported are protected).",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        id: { type: "string" },
      },
      required: ["id"],
    },
  },
  {
    type: "function",
    name: "update_canvas_block",
    description:
      "Change a block that is ALREADY placed on the constructor canvas: slot values " +
      "(text, colours, alignment, image URLs) and/or surface appearance " +
      "(background_color, border, radius, padding). " +
      "THIS IS THE ONLY WAY to fulfil requests like 'move the button to the left', " +
      "'make the title red', 'change the promo text' when the user is in the constructor. " +
      "Do NOT use edit_locale_block or save_user_block for this — those touch translation " +
      "files and the block library, not the email being assembled. " +
      "Text, URL, image, colour, number and select slots are single-line; " +
      "put intentional paragraphs only in a richText slot. " +
      "The current tree with every uid and its slot values is in the user message. " +
      "Call get_block_source first if you are unsure which slot id controls what.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        uid: { type: ["string", "number"], description: "uid of the block on the canvas (from the tree in the user message)." },
        slots: {
          type: "object",
          additionalProperties: true,
          description: 'Slot values to set, e.g. { "align": "left", "title": "Новый заголовок" }. Only the listed slots change.',
        },
        appearance: {
          type: "object",
          additionalProperties: false,
          properties: {
            background_color: { type: "string" },
            border: { type: "string" },
            radius: { type: "string" },
            padding: { type: "string" },
          },
          description: "Surface overrides for this instance.",
        },
        reason: { type: "string", description: "One short sentence for the user: what changed and why." },
      },
      required: ["uid"],
    },
  },
  {
    type: "function",
    name: "remove_canvas_block",
    description:
      "Remove a block from the constructor canvas, together with everything nested inside it. " +
      "THIS IS THE TOOL for 'удали этот блок', 'убери кнопку', 'убери нижнюю секцию' when the " +
      "person is in the constructor. Do NOT use remove_block — that one edits the HTML of an " +
      "email already open in the code workbench and cannot touch the canvas. " +
      "Take the uid from the canvas tree in the user message.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        uid: { type: ["string", "number"], description: "uid of the block on the canvas." },
        reason: { type: "string", description: "One short sentence for the user: what you removed and why." },
      },
      required: ["uid"],
    },
  },
  {
    type: "function",
    name: "clear_canvas",
    description:
      "Wipe the constructor canvas: every block goes, the email becomes empty. " +
      "This is the tool for 'удали всё', 'очисти письмо', 'соберём заново'. " +
      "Destructive: call it ONLY when the person asked for it in this conversation, and pass " +
      "confirm: true to say you read that intent. One Ctrl+Z in the studio brings everything back. " +
      "After clearing, build the new email with add_canvas_block + update_canvas_block.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        confirm: { type: "boolean", description: "Must be true. The person asked to clear the canvas." },
        reason: { type: "string", description: "One short sentence for the user." },
      },
      required: ["confirm"],
    },
  },
  {
    type: "function",
    name: "add_canvas_block",
    description:
      "Put a block from the library onto the constructor canvas — the tool for 'добавь кнопку', " +
      "'нужен заголовок сверху', and for rebuilding an email after clear_canvas. " +
      "Without parentUid the studio places the block the same way a human drag-and-drop does: " +
      "a section goes to the end of the email, an inner block into the last suitable section, " +
      "and the wrapper is created for you — you never add one by hand. " +
      "The result carries a uid you can pass straight to update_canvas_block in the same run to " +
      "fill the block with real copy. Sample text arrives with the block: always replace it. " +
      "Use list_canonical_blocks / find_blocks_by_look to choose the block, see_block to look at it.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        blockId: { type: "string", description: "Block id from the library, e.g. 'sys-button'." },
        blockSource: { type: "string", description: "canonical / imported / user — only when two blocks share an id." },
        parentUid: { type: ["string", "number"], description: "uid of the container block; omit to let the studio choose." },
        slotId: { type: "string", description: "Child slot of the parent; omit to let the studio choose." },
        afterUid: { type: ["string", "number"], description: "Place right after this block instead of at the end." },
        slots: {
          type: "object",
          additionalProperties: true,
          description: 'Slot values for the new block, e.g. { "title": "Ваш бонус начислен" }. Anything you omit keeps the sample value.',
        },
        reason: { type: "string", description: "One short sentence for the user." },
      },
      required: ["blockId"],
    },
  },
  {
    type: "function",
    name: "move_canvas_block",
    description:
      "Move a block on the constructor canvas one position up or down among its neighbours — " +
      "'подними кнопку выше', 'футер должен быть последним'. " +
      "Call it several times to move further. Order inside one container only: to put a block " +
      "into a different container, remove it and add it again where it belongs.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        uid: { type: ["string", "number"], description: "uid of the block on the canvas." },
        direction: { type: "string", enum: ["up", "down"], description: "up = earlier in the email." },
        reason: { type: "string", description: "One short sentence for the user." },
      },
      required: ["uid", "direction"],
    },
  },
  {
    type: "function",
    name: "compose_email_from_blocks",
    description:
      "Scaffold a new email source from release-safe canonical blocks. Each block is a " +
      "pre-tested Pug+Stylus pair. The simplest input is an ordered list of top-level " +
      "section/combo `{ id, slots }` entries. For a custom three-level tree, every entry " +
      "must include a unique `uid` and `parentUid` (null for the root); use `slotId` to " +
      "target the parent's child slot. Missing slot values use schema defaults. The " +
      "server writes email-base/<brand>/mail-<mailName>/; build/open it in Workbench next. " +
      "Use this when the user asks to create a NEW email from scratch (welcome, " +
      "transactional, simple promo) rather than editing an existing one.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        brand: { type: "string", description: "Brand folder, e.g. 'X_assembled' (default)." },
        mailName: { type: "string", description: "Mail name without 'mail-' prefix. Letters/digits/_/- only." },
        force: {
          type: "boolean",
          description:
            "Overwrite an existing source/dist mail. Set true ONLY after the user explicitly asks to overwrite or confirms replacement. Default false.",
        },
        blocks: {
          type: "array",
          minItems: 1,
          description: "Ordered list of blocks. Top of email first.",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              id: { type: "string", description: "Canonical block id (use list_canonical_blocks to discover)." },
              uid: { type: ["string", "number"], description: "Stable node id. Required on every entry when explicit tree mode is used." },
              parentUid: { type: ["string", "number", "null"], description: "Parent node uid, or null for a root. If present on one entry, provide it on all entries." },
              slotId: { type: "string", description: "Named child slot on the parent, e.g. sections or content." },
              slots: {
                type: "object",
                additionalProperties: true,
                description: "Slot values — keys match the block's slots[].id. Missing slots use defaults.",
              },
            },
            required: ["id"],
          },
        },
      },
      required: ["mailName", "blocks"],
    },
  },
  {
    type: "function",
    name: "open_draft",
    description:
      "Take a PERSONAL COPY of an email before changing it. The shared base stays untouched " +
      "until the person says publish.\n\n" +
      "Use this before any change to an email that already exists in the base: someone else may " +
      "be working on it, and a change made straight into the base cannot be undone by them. " +
      "After this, work on the draft name the tool returns.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        brand: { type: "string", description: "Brand folder, e.g. X_IQ." },
        mail: { type: "string", description: "Mail folder, e.g. mail-welcome." },
      },
      required: ["brand", "mail"],
    },
  },
  {
    type: "function",
    name: "list_drafts",
    description: "Which emails you currently hold a personal copy of, and how old each copy is.",
    parameters: { type: "object", additionalProperties: false, properties: {} },
  },
  {
    type: "function",
    name: "draft_changes",
    description:
      "What differs between your draft and the shared base right now — file by file. " +
      "Show this to the person BEFORE asking them to publish: 'I changed these three files' is " +
      "an answer, 'I made some edits' is not.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: { brand: { type: "string" }, mail: { type: "string" } },
      required: ["brand", "mail"],
    },
  },
  {
    type: "function",
    name: "publish_draft",
    description:
      "Move your draft into the shared base. NEVER call this on your own initiative — only when " +
      "the person explicitly says to publish. If the base changed since you took the copy, the " +
      "call is refused with the difference: show it to the person and ask, do not force.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        brand: { type: "string" },
        mail: { type: "string" },
        force: { type: "boolean", description: "Publish over a base that changed meanwhile. Only with explicit confirmation." },
      },
      required: ["brand", "mail"],
    },
  },
  {
    type: "function",
    name: "discard_draft",
    description: "Throw your personal copy away. The shared base is not touched. Ask first.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: { brand: { type: "string" }, mail: { type: "string" } },
      required: ["brand", "mail"],
    },
  },
  {
    type: "function",
    name: "mail_history",
    description:
      "Previous versions of an email: every publish and every rollback leaves a snapshot. " +
      "Use it to answer 'what did it look like before' and to offer a rollback instead of " +
      "rebuilding something that already existed.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: { brand: { type: "string" }, mail: { type: "string" } },
      required: ["brand", "mail"],
    },
  },
  {
    type: "function",
    name: "see_email",
    description:
      "LOOK at the email as a picture. Renders what the person sees right now — the open HTML " +
      "in the code editor, or the live canvas in the constructor — and shows it to you as an image.\n\n" +
      "Call this BEFORE saying anything about how the email looks, and before finishing an " +
      "assembly. Byte counts and block trees do not tell you that a heading collided with an " +
      "image or that the mobile layout is cut off. Render mobile separately (view: 'mobile') — " +
      "it breaks more often than desktop.\n\n" +
      "The picture arrives as the NEXT message, not inside this tool result.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: { view: { type: "string", enum: ["desktop", "mobile"], description: "Which view to render." } },
    },
  },
  {
    type: "function",
    name: "see_block",
    description:
      "LOOK at a library block as a picture — the same preview the person sees in the catalogue. " +
      "Use it when the question is about appearance: does this block fit, how does it sit next to " +
      "its neighbour, what is wrong with it. Slot names do not describe looks.\n\n" +
      "The picture arrives as the NEXT message.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        id: { type: "string", description: "Block id from list_canonical_blocks." },
        view: { type: "string", enum: ["desktop", "mobile"] },
      },
      required: ["id"],
    },
  },
  {
    type: "function",
    name: "list_mail_files",
    description:
      "List the SOURCE files of the open email: stylus styles, pug templates, locale txt. " +
      "The HTML you read is built FROM these. Editing the built HTML is a change that dies at " +
      "the next rebuild — to change how the email renders, change the source.",
    parameters: { type: "object", additionalProperties: false, properties: {} },
  },
  {
    type: "function",
    name: "read_mail_file",
    description:
      "Read one source file of the open email with line numbers. Big files are read in windows.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        file: { type: "string", description: "Path inside the mail, e.g. app/styles/blocks/main.styl" },
        from: { type: "number", description: "First line (default 1)." },
        lines: { type: "number", description: "How many lines (default 400)." },
      },
      required: ["file"],
    },
  },
  {
    type: "function",
    name: "write_mail_file",
    description:
      "Write a source file of the open email — THIS is how render styles are changed. " +
      "Send the whole file, not a patch: stylus is indentation-sensitive and a near-miss patch " +
      "breaks the build of the entire email.\n\n" +
      "The email must be rebuilt afterwards for the change to reach the HTML. " +
      "Locks apply to you as well: if a person is editing this email you will be refused by name.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        file: { type: "string", description: "Path inside the mail." },
        content: { type: "string", description: "Full new content of the file." },
        reason: { type: "string", description: "One sentence for the person: what changed and why." },
      },
      required: ["file", "content"],
    },
  },
  {
    type: "function",
    name: "check_canvas_ready",
    description:
      "Check the email on the constructor canvas for leftover SAMPLE text — the demo values " +
      "blocks arrive with ('Заголовок письма', 'Перейти', 'Короткая подсветка…'). " +
      "Call this BEFORE finish on the constructor surface. Leftover sample text is not a " +
      "style issue: the customer sees it in the sent campaign. " +
      "Also flags Russian service text left inside an English email.",
    parameters: { type: "object", additionalProperties: false, properties: {} },
  },
  {
    type: "function",
    name: "finish",
    description:
      "Signal that the work is done. Provide a short human-readable summary for the user. " +
      "Always finish with a clear next step or confirmation, in the user's language.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        summary: { type: "string", description: "User-facing summary of what was done." },
        modifiedHtml: {
          type: "string",
          description:
            "If placeholderize_html was called, the final rewritten HTML to apply to the editor. " +
            "Leave empty if no HTML changes were made.",
        },
        localeUpdates: {
          type: "array",
          description: "Array of per-locale text updates the studio should apply.",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              namespace: { type: "string" },
              locale: { type: "string" },
              txt: { type: "string" },
            },
            required: ["namespace", "locale", "txt"],
          },
        },
      },
      required: ["summary"],
    },
  },
];

/**
 * Tool handlers. Each handler receives:
 *   - args:    parameters from the model (matching the tool's schema)
 *   - ctx:     per-request state — see top of this file
 *
 * Each returns a JSON-serializable object the model sees on its next turn.
 * On failure, return { error: string } — the model can recover or call
 * another tool.
 */
/** Евклидово расстояние между двумя hex-цветами; null, если цвет не разобрать. */
function colourDistance(a, b) {
  const parse = (v) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(v || "").trim());
    if (!m) return null;
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const x = parse(a), y = parse(b);
  if (!x || !y) return null;
  return Math.sqrt((x[0] - y[0]) ** 2 + (x[1] - y[1]) ** 2 + (x[2] - y[2]) ** 2);
}

/** Компактная визуальная сигнатура блока из пререндеренного превью. */
function describeAppearance(block) {
  const preview = previewForBlock(block);
  if (!preview || preview.status !== "ok" || !preview.signature) return null;
  const s = preview.signature;
  return {
    width: s.width, height: s.height, mobileHeight: s.mobileHeight,
    background: s.background, palette: s.palette,
    images: s.images, buttons: s.buttons, links: s.links,
    listItems: s.listItems, columns: s.columns, textChars: s.textChars,
    responsive: s.responsive, tags: s.tags,
  };
}

export const TOOL_HANDLERS = {
  async read_open_html(_args, ctx) {
    const html = String(ctx.modifiedHtml || ctx.html || "");
    if (!html) return { error: "no HTML open in the editor; ask the user to open one" };
    return {
      length: html.length,
      html: html.slice(0, 16000),
      truncated: html.length > 16000,
      hasPendingEdits: !!ctx.modifiedHtml,
    };
  },

  async list_namespaces(_args, ctx) {
    const arr = Array.isArray(ctx.namespaces) ? ctx.namespaces : [];
    return {
      count: arr.length,
      activeNamespace: ctx.activeNamespace?.namespace || ctx.activeNamespace?.name || null,
      activeLocale: ctx.activeLocale || null,
      namespaces: arr.map((n) => {
        const name = n.namespace || n.name || "";
        const locales = n.locales || {};
        return {
          name,
          referenceLocale: n.referenceLocale || (locales.en ? "en" : Object.keys(locales)[0] || null),
          locales: Object.fromEntries(
            Object.entries(locales).map(([code, blocks]) => [code, Array.isArray(blocks) ? blocks.length : 0])
          ),
        };
      }),
    };
  },

  async get_namespace_blocks(args, ctx) {
    const ns = pickNamespace(ctx, args.namespace);
    if (!ns) return { error: `namespace not found: ${args.namespace}` };
    const blocks = (ns.locales || {})[args.locale];
    if (!Array.isArray(blocks)) return { error: `locale not found: ${args.namespace}.${args.locale}` };
    return { namespace: args.namespace, locale: args.locale, blocks };
  },

  async analyze_email(args, ctx) {
    if (!ctx.html) return { error: "no HTML open in the editor" };
    const ns = pickNamespace(ctx, args.namespace);
    if (!ns) return { error: `namespace not found: ${args.namespace}` };
    const refCode = args.refLocale || (ns.locales?.en ? "en" : ns.referenceLocale || Object.keys(ns.locales || {})[0]);
    const refTxt = serializeBlocks(ns.locales?.[refCode]);
    if (!refTxt) return { error: `no reference blocks in ${args.namespace}.${refCode}` };
    return analyzeLocaleAgainstHtml({
      html: ctx.html,
      refTxt,
      refCode,
      locales: Object.fromEntries(
        Object.entries(ns.locales || {}).map(([c, b]) => [c, serializeBlocks(b)])
      ),
    });
  },

  async align_locales_to_reference(args, ctx) {
    const ns = pickNamespace(ctx, args.namespace);
    if (!ns) return { error: `namespace not found: ${args.namespace}` };
    const locales = ns.locales || {};
    const raw = ns.localeRaw || {};
    const codes = Object.keys(locales);
    if (!codes.length) return { error: `no locales in namespace ${ns.namespace || ns.name}` };
    const refCode = args.refLocale || ns.referenceLocale || (locales.en ? "en" : codes.find((c) => /^en/i.test(c)) || codes[0]);
    const refTxtRaw = raw[refCode] || serializeBlocks(locales[refCode]);
    const refTxt = normalizeLocaleConventions(refTxtRaw).txt;
    const refBlocks = parseNormalizedBlocks(refTxt);
    if (!refBlocks.length) return { error: `reference locale ${refCode} has no blocks` };

    ctx.pendingLocaleUpdates = ctx.pendingLocaleUpdates || [];
    const report = {};
    const updated = [];
    const nsName = ns.namespace || ns.name;

    // Normalize the reference itself too, so ALL locales (incl. the reference)
    // end up with the same structure. Conventions may split nested {{vars}}.
    ns.locales[refCode] = refBlocks.slice();
    if (refTxt.trim() !== refTxtRaw.trim()) {
      ctx.pendingLocaleUpdates = ctx.pendingLocaleUpdates.filter((u) => !(u.namespace === nsName && u.locale === refCode));
      ctx.pendingLocaleUpdates.push({ namespace: nsName, locale: refCode, txt: refTxt });
      updated.push(refCode);
    }

    for (const code of codes) {
      if (code === refCode) { report[code] = { reference: true, blocks: refBlocks.length }; continue; }
      const locTxtRaw = raw[code] || serializeBlocks(locales[code]);
      const normTxt = normalizeLocaleConventions(locTxtRaw).txt;
      const locBlocks = parseNormalizedBlocks(normTxt);
      const al = alignLocaleToReference(refBlocks, locBlocks);
      const newTxt = serializeAligned(localePrefix(normTxt), al.blocks);
      report[code] = { before: locBlocks.length, after: al.blocks.length, padded: al.padded, dropped: al.dropped };
      // Update ctx so later reads / placeholderize see the aligned structure.
      ns.locales[code] = parseNormalizedBlocks(newTxt);
      if (newTxt.trim() !== locTxtRaw.trim()) {
        ctx.pendingLocaleUpdates = ctx.pendingLocaleUpdates.filter((u) => !(u.namespace === nsName && u.locale === code));
        ctx.pendingLocaleUpdates.push({ namespace: nsName, locale: code, txt: newTxt });
        updated.push(code);
      }
    }
    return { namespace: nsName, refCode, refBlockCount: refBlocks.length, locales: codes, updated, report };
  },

  async compare_locales(args, ctx) {
    const ns = pickNamespace(ctx, args.namespace);
    if (!ns) return { error: `namespace not found: ${args.namespace}` };
    const locales = ns.locales || {};
    if (!Object.keys(locales).length) return { error: `no locales in namespace ${ns.namespace || ns.name}` };
    const refCode = args.refLocale || ns.referenceLocale || (locales.en ? "en" : undefined);
    const res = compareLocales({ locales, refCode });
    if (res.error) return res;
    // Cap the issue list so the tool result stays compact for the model.
    return {
      namespace: ns.namespace || ns.name,
      refCode: res.refCode,
      refBlockCount: res.refBlockCount,
      locales: res.locales,
      summary: res.summary,
      issues: res.issues.slice(0, 60),
      issuesTruncated: res.issues.length > 60 ? res.issues.length - 60 : 0,
    };
  },

  async placeholderize_html(args, ctx) {
    if (!ctx.html) return { error: "no HTML open in the editor" };
    if (!ctx.apiKey) return { error: "OPENAI_API_KEY is not configured" };
    const ns = pickNamespace(ctx, args.namespace);
    if (!ns) return { error: `namespace not found: ${args.namespace}` };
    const refCode = args.refLocale || (ns.locales?.en ? "en" : ns.referenceLocale || Object.keys(ns.locales || {})[0]);
    const refTxt = serializeBlocks(ns.locales?.[refCode]);
    if (!refTxt) return { error: `no reference blocks in ${args.namespace}.${refCode}` };
    const result = await placeholderizeHtml({
      html: ctx.html,
      refLocaleTxt: refTxt,
      namespace: ns.namespace || ns.name,
      apiKey: ctx.apiKey,
      model: ctx.model || "gpt-4.1-mini",
      mailHint: ns.namespace || ns.name,
    });
    // Stash the rewritten HTML in ctx so subsequent tool calls (and finish)
    // can include it without re-computing.
    if (result.html && result.html !== ctx.html && result.anchors > 0) {
      ctx.modifiedHtml = result.html;
    }
    return {
      anchors: result.anchors,
      missed: result.missed,
      ambiguous: result.ambiguous,
      report: result.report,
    };
  },

  async fix_locale_txt(args, ctx) {
    if (!ctx.apiKey) return { error: "OPENAI_API_KEY is not configured" };
    const ns = pickNamespace(ctx, args.namespace);
    if (!ns) return { error: `namespace not found: ${args.namespace}` };
    const txtBlocks = ns.locales?.[args.locale];
    if (!Array.isArray(txtBlocks)) return { error: `locale not found: ${args.namespace}.${args.locale}` };
    const refCode = args.refLocale || (ns.locales?.en ? "en" : null);
    const refTxt = refCode && refCode !== args.locale ? serializeBlocks(ns.locales[refCode]) : "";
    const r = await fixLocaleTxt({
      txt: serializeBlocks(txtBlocks),
      refTxt: refTxt || undefined,
      language: args.locale,
      apiKey: ctx.apiKey,
      model: ctx.model || "gpt-4.1-mini",
    });
    // Guard: AI must not bake literal ${{ ... }}$ tokens INTO the TXT.
    const tainted = (r.blocks || []).some((b) => /\$\{\{[\s\S]*?\}\}\$/.test(b));
    if (tainted) return { error: "AI returned literal ${{...}}$ tokens inside blocks; refused to apply" };
    ctx.pendingLocaleUpdates = ctx.pendingLocaleUpdates || [];
    ctx.pendingLocaleUpdates.push({
      namespace: ns.namespace || ns.name,
      locale: args.locale,
      txt: r.fixedTxt,
    });
    return {
      namespace: ns.namespace || ns.name,
      locale: args.locale,
      before: txtBlocks.length,
      after: r.blocks.length,
    };
  },

  async translate_locale_txt(args, ctx) {
    if (!ctx.apiKey) return { error: "OPENAI_API_KEY is not configured" };
    const ns = pickNamespace(ctx, args.namespace);
    if (!ns) return { error: `namespace not found: ${args.namespace}` };
    const fromLocale = args.fromLocale || (ns.locales?.en ? "en" : ns.referenceLocale || Object.keys(ns.locales || {})[0]);
    const srcBlocks = ns.locales?.[fromLocale];
    if (!Array.isArray(srcBlocks)) return { error: `source locale not found: ${args.namespace}.${fromLocale}` };
    const r = await translateLocaleTxt({
      srcTxt: serializeBlocks(srcBlocks),
      fromLang: fromLocale,
      toLang: args.toLocale,
      apiKey: ctx.apiKey,
      model: ctx.model || "gpt-4.1-mini",
    });
    ctx.pendingLocaleUpdates = ctx.pendingLocaleUpdates || [];
    ctx.pendingLocaleUpdates.push({
      namespace: ns.namespace || ns.name,
      locale: args.toLocale,
      txt: r.translatedTxt,
    });
    return {
      namespace: ns.namespace || ns.name,
      from: fromLocale,
      to: args.toLocale,
      blocks: r.blocks.length,
    };
  },

  async find_across_locales(args, ctx) {
    if (!ReplaceAcross) return { error: "replace-across core is not loaded" };
    const query = String(args.query ?? "");
    if (!query) return { error: "query is empty" };
    const mode = args.mode === "filename" ? "filename" : "text";
    const html = String(ctx.modifiedHtml || ctx.html || "");
    const namespaces = (Array.isArray(ctx.namespaces) ? ctx.namespaces : []).map((ns) => ({
      id: ns.namespace || ns.name, name: ns.namespace || ns.name, builtin: Boolean(ns.builtin), locales: ns.locales || {},
    }));
    const plan = ReplaceAcross.plan({ code: html, namespaces, find: query, mode });
    const brief = (hits) => (hits || []).slice(0, 3).map((h) => ({ kind: h.kind, block: h.block, context: `${String(h.before).slice(-30)}[[${h.match}]]${String(h.after).slice(0, 30)}` }));
    return {
      query: query.slice(0, 300),
      mode,
      total: plan.total,
      editableTotal: plan.editableTotal,
      html: { count: plan.code?.count || 0, hits: brief(plan.code?.hits) },
      locales: plan.locales.map((l) => ({ namespace: l.nsName, locale: l.locale, count: l.count, locked: l.locked, blocks: l.blockIndexes, hits: brief(l.hits) })),
      imageModeAvailable: ReplaceAcross.looksLikeImage(query),
      hint: (() => {
        if (mode !== "text" || !ReplaceAcross.looksLikeImage(query)) return undefined;
        const byName = ReplaceAcross.plan({ code: html, namespaces, find: query, mode: "filename" }).total;
        return byName > plan.total ? `mode='filename' finds ${byName} (same image uploaded per locale under other paths)` : undefined;
      })(),
    };
  },

  async replace_across_locales(args, ctx) {
    if (!ReplaceAcross) return { error: "replace-across core is not loaded" };
    const search = String(args.search ?? "");
    const replace = String(args.replace ?? "");
    if (!search) return { error: "search is empty" };
    if (replace.length > 4000) return { error: "replace too long (>4000 chars) — surgical edits only" };
    const mode = args.mode === "filename" ? "filename" : "text";
    const html = String(ctx.modifiedHtml || ctx.html || "");
    const source = Array.isArray(ctx.namespaces) ? ctx.namespaces : [];
    const namespaces = source.map((ns) => ({
      id: ns.namespace || ns.name, name: ns.namespace || ns.name, builtin: Boolean(ns.builtin), locales: ns.locales || {},
    }));
    const plan = ReplaceAcross.plan({ code: html, namespaces, find: search, mode });
    const only = Array.isArray(args.locales) && args.locales.length ? args.locales.map(String) : null;
    const keys = plan.locales
      .filter((l) => !l.locked)
      .filter((l) => !only || only.includes(l.locale) || only.includes(`${l.nsName}|${l.locale}`))
      .map((l) => `${l.nsId}|${l.locale}`);
    const includeHtml = args.includeHtml !== false && Boolean(html);
    const result = ReplaceAcross.apply({ code: html, namespaces, find: search, replacement: replace, mode, selection: { code: includeHtml, locales: keys } });
    if (!result.total) return { error: "nothing to replace — call find_across_locales (mind mode='filename' for images)" };
    if (result.codeCount) {
      if (result.code.length < html.length * 0.6) return { error: "edit would shrink the document by >40% — refused" };
      ctx.modifiedHtml = result.code;
    }
    ctx.pendingLocaleUpdates = ctx.pendingLocaleUpdates || [];
    for (const patch of result.patches) {
      const ns = source.find((n) => (n.namespace || n.name) === patch.nsId);
      if (ns) ns.locales = { ...(ns.locales || {}), [patch.locale]: patch.blocks };
      ctx.pendingLocaleUpdates.push({ namespace: patch.nsId, locale: patch.locale, txt: serializeBlocks(patch.blocks) });
    }
    return {
      replaced: result.total,
      html: result.codeCount,
      locales: result.patches.map((p) => ({ namespace: p.nsId, locale: p.locale, count: p.count })),
      skippedLocked: plan.locales.filter((l) => l.locked).map((l) => `${l.nsName}|${l.locale}`),
      note: "Staged. HTML and locale changes reach the studio after the user confirms (like replace_in_html).",
    };
  },

  async find_in_html(args, ctx) {
    const html = String(ctx.modifiedHtml || ctx.html || "");
    if (!html) return { error: "no HTML open in the editor" };
    const q = String(args.query ?? "");
    if (!q) return { error: "query is empty" };
    const max = Number.isInteger(args.maxMatches) && args.maxMatches > 0 ? Math.min(args.maxMatches, 20) : 5;
    const matches = [];
    let i = 0;
    while (matches.length < max) {
      const at = html.indexOf(q, i);
      if (at === -1) break;
      matches.push({
        index: at,
        before: html.slice(Math.max(0, at - 80), at),
        match: q.length > 200 ? q.slice(0, 200) + "…" : q,
        after: html.slice(at + q.length, at + q.length + 80),
      });
      i = at + q.length;
    }
    // Count remaining occurrences beyond the cap.
    let total = matches.length;
    while (true) {
      const at = html.indexOf(q, i);
      if (at === -1) break;
      total += 1;
      i = at + q.length;
    }
    return { query: q.slice(0, 200), total, matches, htmlLength: html.length, hasPendingEdits: !!ctx.modifiedHtml };
  },

  async replace_in_html(args, ctx) {
    const html = String(ctx.modifiedHtml || ctx.html || "");
    if (!html) return { error: "no HTML open in the editor" };
    const search = String(args.search ?? "");
    const replace = String(args.replace ?? "");
    if (!search) return { error: "search is empty" };
    if (search.length > 2000) return { error: "search too long (>2000 chars) — use a shorter unique anchor" };
    if (replace.length > 4000) return { error: "replace too long (>4000 chars) — surgical edits only" };
    // Guard: a replace that removes a big chunk of the document is a rewrite, not an edit.
    if (search.length > 400 && replace.length < search.length * 0.2) {
      return { error: "this would delete a large chunk — refusing; make smaller targeted edits" };
    }
    let count = 0;
    let i = 0;
    while (true) {
      const at = html.indexOf(search, i);
      if (at === -1) break;
      count += 1;
      i = at + search.length;
      if (count > 500) return { error: "search matches >500 times — too generic" };
    }
    if (count === 0) {
      return { error: "search string not found — use find_in_html to locate the exact text (mind whitespace/entities)" };
    }
    if (count > 1 && !args.replaceAll) {
      return { error: `search matches ${count} places — extend it with surrounding context (find_in_html) or pass replaceAll=true` };
    }
    const out = args.replaceAll ? html.split(search).join(replace) : html.replace(search, replace);
    // Final sanity: document must not shrink below 60% of its size in one step.
    if (out.length < html.length * 0.6) {
      return { error: "edit would shrink the document by >40% — refused" };
    }
    ctx.modifiedHtml = out;
    return {
      replaced: args.replaceAll ? count : 1,
      htmlLength: out.length,
      delta: out.length - html.length,
      note: "Edit staged. It reaches the editor when you call finish (modifiedHtml is applied by the studio after user confirmation).",
    };
  },

  async create_locale(args, ctx) {
    const ns = pickNamespace(ctx, args.namespace);
    if (!ns) return { error: `namespace not found: ${args.namespace}` };
    const code = String(args.locale || "").trim();
    if (!/^[a-z]{2}(_[A-Za-z]{2,4})?$/i.test(code)) return { error: `invalid locale code: "${code}"` };
    if (Array.isArray(ns.locales?.[code]) && ns.locales[code].length) {
      return { error: `locale already exists: ${code} — use translate_locale_txt or edit_locale_block to change it` };
    }
    const fromLocale = args.fromLocale || (ns.locales?.en ? "en" : ns.referenceLocale || Object.keys(ns.locales || {})[0]);
    const srcBlocks = ns.locales?.[fromLocale];
    if (!Array.isArray(srcBlocks) || !srcBlocks.length) {
      return { error: `source locale not found or empty: ${fromLocale}` };
    }
    const doTranslate = args.translate !== false;
    ctx.pendingLocaleUpdates = ctx.pendingLocaleUpdates || [];
    if (!doTranslate) {
      ctx.pendingLocaleUpdates.push({
        namespace: ns.namespace || ns.name,
        locale: code,
        txt: serializeBlocks(srcBlocks),
      });
      return { namespace: ns.namespace || ns.name, locale: code, blocks: srcBlocks.length, mode: "stub-copy", from: fromLocale };
    }
    if (!ctx.apiKey) return { error: "OPENAI_API_KEY is not configured — call create_locale with translate=false for a stub copy" };
    const r = await translateLocaleTxt({
      srcTxt: serializeBlocks(srcBlocks),
      fromLang: fromLocale,
      toLang: code,
      apiKey: ctx.apiKey,
      model: ctx.model || "gpt-4.1-mini",
    });
    ctx.pendingLocaleUpdates.push({
      namespace: ns.namespace || ns.name,
      locale: code,
      txt: r.translatedTxt,
    });
    return { namespace: ns.namespace || ns.name, locale: code, blocks: r.blocks.length, mode: "translated", from: fromLocale };
  },

  async normalize_locale_conventions(args, ctx) {
    const ns = pickNamespace(ctx, args.namespace);
    if (!ns) return { error: `namespace not found: ${args.namespace}` };
    const codes = args.locale === "all"
      ? Object.keys(ns.locales || {})
      : [String(args.locale || "").trim()];
    if (!codes.length || (codes.length === 1 && !codes[0])) return { error: "locale required ('all' or a code)" };

    ctx.pendingLocaleUpdates = ctx.pendingLocaleUpdates || [];
    const results = [];
    for (const code of codes) {
      const blocks = ns.locales?.[code];
      // Сырой TXT надёжнее разобранных блоков: ленивый парсер клиента мог
      // потерять хвосты вокруг вложенных переменных.
      const raw = ns.localeRaw?.[code]
        || (Array.isArray(blocks) ? serializeBlocks(blocks) : null);
      if (!raw) { results.push({ locale: code, error: "locale not found" }); continue; }
      const r = normalizeLocaleConventions(raw);
      if (!r.changed) { results.push({ locale: code, changed: false }); continue; }
      // Заменить существующий pending-update этой локали, если был.
      ctx.pendingLocaleUpdates = ctx.pendingLocaleUpdates.filter(
        (u) => !(u.namespace === (ns.namespace || ns.name) && u.locale === code)
      );
      ctx.pendingLocaleUpdates.push({ namespace: ns.namespace || ns.name, locale: code, txt: r.txt });
      // Обновить ctx-копию, чтобы последующие инструменты видели починенное.
      if (ns.localeRaw) ns.localeRaw[code] = r.txt;
      ns.locales[code] = (r.txt.match(/\{\{([\s\S]*?)\}\}/g) || []).map((b) => b.slice(2, -2).trim());
      results.push({
        locale: code,
        changed: true,
        changes: r.changes.map((c) => ({ type: c.type, preview: (c.before || c.preview || "").slice(0, 60) })),
      });
    }
    const changedCount = results.filter((r) => r.changed).length;
    return { namespace: ns.namespace || ns.name, locales: results, changedCount };
  },

  async delete_locale(args, ctx) {
    const ns = pickNamespace(ctx, args.namespace);
    if (!ns) return { error: `namespace not found: ${args.namespace}` };
    const code = String(args.locale || "").trim();
    if (!Array.isArray(ns.locales?.[code])) return { error: `locale not found: ${code}` };
    const refCode = ns.referenceLocale || (ns.locales?.en ? "en" : null);
    if (code === refCode && !args.force) {
      return { error: `"${code}" is the reference locale — refusing to delete without force=true. Ask the user to confirm.` };
    }
    ctx.pendingLocaleDeletes = ctx.pendingLocaleDeletes || [];
    ctx.pendingLocaleDeletes.push({ namespace: ns.namespace || ns.name, locale: code });
    return { namespace: ns.namespace || ns.name, locale: code, queued: true, note: "The studio will ask the user to confirm before deleting." };
  },

  async edit_locale_block(args, ctx) {
    const ns = pickNamespace(ctx, args.namespace);
    if (!ns) return { error: `namespace not found: ${args.namespace}` };
    const code = String(args.locale || "").trim();
    const blocks = ns.locales?.[code];
    if (!Array.isArray(blocks)) return { error: `locale not found: ${code}` };
    const i = Number(args.index);
    if (!Number.isInteger(i) || i < 0 || i >= blocks.length) {
      return { error: `index out of range: ${args.index} (locale has ${blocks.length} blocks, 0-based)` };
    }
    const text = String(args.text ?? "");
    if (/\$\{\{[\s\S]*?\}\}\$/.test(text)) {
      return { error: "text contains literal ${{...}}$ tokens — placeholders belong in the HTML, not in locale TXT" };
    }
    const next = blocks.slice();
    const before = next[i];
    next[i] = text;
    // Mutate ctx copy so subsequent reads in this run see the edit.
    ns.locales[code] = next;
    ctx.pendingLocaleUpdates = ctx.pendingLocaleUpdates || [];
    // Collapse multiple edits of the same locale into one final update.
    ctx.pendingLocaleUpdates = ctx.pendingLocaleUpdates.filter(
      (u) => !(u.namespace === (ns.namespace || ns.name) && u.locale === code)
    );
    ctx.pendingLocaleUpdates.push({
      namespace: ns.namespace || ns.name,
      locale: code,
      txt: serializeBlocks(next),
    });
    return { namespace: ns.namespace || ns.name, locale: code, index: i, before, after: text };
  },

  async list_canonical_blocks(_args, _ctx) {
    // Imported blocks are validated as historical source fragments, not as a
    // mutually compatible design system. Feeding all 955 legacy slices to the
    // model wastes context and lets campaign assets/styles leak into new mail.
    const blocks = listCanonicalBlocks().filter((block) => block.source === "canonical" && block.retired !== true);
    return {
      count: blocks.length,
      blocks: blocks.map((b) => ({
        id: b.id,
        label: b.label,
        description: b.description,
        placement: b.placement,
        category: b.category,
        source: b.source,
        tags: b.tags || [],
        usageCount: b.usageCount || 0,
        combo: b.combo === true,
        hasMobileStyles: /@media/i.test(b.styl || ""),
        stylBytes: (b.styl || "").length,
        // Как блок ВЫГЛЯДИТ: размер, палитра, есть ли картинка/кнопка/список/
        // колонки. До этого модель выбирала блок вслепую — по категории и
        // описанию, из-за чего hero-подобные секции путались между собой.
        appearance: describeAppearance(b),
        childSlots: (b.childSlots || []).map((slot) => ({
          id: slot.id,
          accepts: Array.isArray(slot.accepts) ? slot.accepts : [],
        })),
        slots: (b.slots || []).map((s) => ({
          id: s.id, kind: s.kind, label: s.label,
          default: s.default, max: s.max, min: s.min, options: s.options,
        })),
      })),
    };
  },

  /**
   * Поиск блока по ВНЕШНЕМУ ВИДУ. До появления пререндера и сигнатур модель
   * выбирала блок вслепую — по категории и авто-описанию «Импортирован из
   * X_IQ (1 писем)», из-за чего hero-подобные секции путались между собой.
   * Здесь она фильтрует по тому, что реально видно на превью.
   */
  async find_blocks_by_look(args, _ctx) {
    const limit = Math.min(Math.max(1, Number(args?.limit) || 12), 40);
    const wantPlacement = String(args?.placement || "any").toLowerCase();
    const includeLegacy = args?.includeLegacy !== false;
    const includeDuplicates = args?.includeDuplicates === true;
    const query = String(args?.query || "").trim().toLowerCase();

    let blocks = listCanonicalBlocks().filter((b) => b.retired !== true);
    if (!includeLegacy) blocks = blocks.filter((b) => b.source !== "imported");

    const scored = [];
    for (const block of blocks) {
      const preview = previewForBlock(block);
      const sig = preview?.status === "ok" ? preview.signature : null;

      if (wantPlacement !== "any") {
        const p = block.placement === "inline" ? "inner" : block.placement;
        const want = wantPlacement === "inline" ? "inner" : wantPlacement;
        if (p !== want && !(want === "inner" && p === "both")) continue;
      }
      if (args?.category && String(block.category || "") !== String(args.category)) continue;

      // Структурные фильтры работают только там, где есть сигнатура: без неё
      // мы не знаем, как блок выглядит, и молча выдавать его за подходящий нельзя.
      const needsSignature = ["hasImage", "hasButton", "hasList", "minColumns", "minHeight", "maxHeight", "backgroundLike", "responsive"]
        .some((k) => args?.[k] !== undefined && args[k] !== null);
      if (needsSignature && !sig) continue;

      if (args?.hasImage === true && !(sig.images > 0)) continue;
      if (args?.hasImage === false && sig.images > 0) continue;
      if (args?.hasButton === true && !(sig.buttons > 0)) continue;
      if (args?.hasButton === false && sig.buttons > 0) continue;
      if (args?.hasList === true && !(sig.listItems > 0)) continue;
      if (args?.hasList === false && sig.listItems > 0) continue;
      if (args?.minColumns != null && !(sig.columns >= Number(args.minColumns))) continue;
      if (args?.minHeight != null && !(sig.height >= Number(args.minHeight))) continue;
      if (args?.maxHeight != null && !(sig.height <= Number(args.maxHeight))) continue;
      if (args?.responsive === true && !sig.responsive) continue;
      if (args?.responsive === false && sig.responsive) continue;

      let colourScore = 0;
      if (args?.backgroundLike) {
        // Сравниваем со ВСЕЙ палитрой, а не только с доминирующим цветом.
        // У блока-кнопки доминирует белое поле вокруг неё, и поиск «оранжевая
        // кнопка» по одному лишь фону не находил ни одной оранжевой кнопки.
        const palette = [sig?.background, ...(sig?.palette || [])].filter(Boolean);
        const distances = palette.map((c) => colourDistance(args.backgroundLike, c))
          .filter((d) => d != null);
        const distance = distances.length ? Math.min(...distances) : null;
        // Больше 120 по расстоянию — это уже другой цвет, а не оттенок.
        if (distance == null || distance > 120) continue;
        colourScore = 1 - distance / 120;
      }

      let textScore = 0;
      if (query) {
        const haystack = [block.label, block.id, block.description, block.category, ...(block.tags || [])]
          .filter(Boolean).join(" ").toLowerCase();
        if (!haystack.includes(query)) {
          // Мягкое совпадение по отдельным словам — запрос обычно фраза.
          const words = query.split(/\s+/).filter((w) => w.length > 2);
          const hits = words.filter((w) => haystack.includes(w)).length;
          if (!hits) continue;
          textScore = hits / Math.max(1, words.length);
        } else {
          textScore = 1;
        }
      }

      scored.push({
        block, sig, preview,
        score: textScore * 2 + colourScore + (block.source === "canonical" ? 0.5 : 0)
          + Math.min(0.5, (block.usageCount || 0) / 20),
      });
    }

    scored.sort((a, b) => b.score - a.score);

    // Схлопывание одинаковых на вид: иначе выдача из 12 позиций может целиком
    // состоять из одного и того же текстового блока в 12 обёртках.
    const seenGroups = new Set();
    const out = [];
    for (const item of scored) {
      const groupId = item.preview?.group?.id;
      if (!includeDuplicates && groupId) {
        if (seenGroups.has(groupId)) continue;
        seenGroups.add(groupId);
      }
      out.push({
        id: item.block.id,
        source: item.block.source,
        label: item.block.label,
        placement: item.block.placement,
        category: item.block.category,
        description: String(item.block.description || "").slice(0, 200),
        slots: (item.block.slots || []).map((s) => s.id),
        appearance: item.sig ? {
          width: item.sig.width, height: item.sig.height,
          background: item.sig.background, palette: item.sig.palette,
          images: item.sig.images, buttons: item.sig.buttons,
          listItems: item.sig.listItems, columns: item.sig.columns,
          textChars: item.sig.textChars, responsive: item.sig.responsive,
          tags: item.sig.tags,
        } : null,
        previewUrl: item.preview?.desktop?.url || null,
        looksTheSameAs: item.preview?.group?.size > 1 ? item.preview.group.size - 1 : 0,
      });
      if (out.length >= limit) break;
    }

    // Пустая выдача визуального поиска НЕ означает, что блока нет в студии.
    // На этом уже обожглись: оператор трижды получил ноль, сказал человеку
    // «в библиотеке нет блока с кнопкой» и предложил рисовать её руками — при
    // том что sys-button лежит в каталоге. Поэтому вместе с нулём отдаём
    // готовый список кандидатов и прямой запрет на такой вывод.
    const fallback = out.length ? [] : blocks
      .filter((block) => {
        if (wantPlacement === "any") return true;
        const placement = block.placement === "inline" ? "inner" : block.placement;
        const want = wantPlacement === "inline" ? "inner" : wantPlacement;
        return placement === want || (want === "inner" && placement === "both");
      })
      .filter((block) => block.source === "canonical")
      .slice(0, 20)
      .map((block) => ({
        id: block.id,
        label: block.label,
        placement: block.placement,
        category: block.category,
        slots: (block.slots || []).map((slot) => slot.id),
      }));

    return {
      count: out.length,
      scanned: scored.length,
      blocks: out,
      ...(fallback.length ? { candidates: fallback } : {}),
      hint: out.length
        ? "previewUrl is a rendered PNG of the block. Pass ids to compose_email_from_blocks or insert_block."
        : "Visual search found nothing — this does NOT mean the block is missing from the studio. "
          + "NEVER tell the user a block does not exist based on this result. "
          + "Pick from `candidates` above, or call list_canonical_blocks and choose by id/label "
          + "(buttons are sys-button / iq-cta-*, text is sys-text, images are sys-image).",
    };
  },

  async get_block_source(args, _ctx) {
    const id = String(args?.id || "").trim();
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(id)) throw new Error("invalid block id");
    const b = loadCanonicalBlock(id);
    return {
      id: b.id, label: b.label, description: b.description,
      placement: b.placement, category: b.category, source: b.source,
      tags: b.tags || [], usageCount: b.usageCount || 0,
      sourceMails: b.sourceMails || [],
      pug: b.pug, styl: b.styl,
      hasMobileStyles: /@media/i.test(b.styl || ""),
      slots: b.slots || [],
    };
  },

  async save_user_block(args, _ctx) {
    const id = String(args?.id || "").trim();
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(id)) throw new Error("id must be 1-64 chars, letters/digits/_/-");
    const pug = String(args?.pug || "");
    if (!pug.trim()) throw new Error("pug content required");
    const target = userBlockPath(id);
    // never allow shadowing canonical/imported ids
    let existing = null;
    try { existing = loadCanonicalBlock(id); } catch {}
    if (existing && existing.source && existing.source !== "user") {
      throw new Error(`id '${id}' belongs to a ${existing.source} block — save under a new id`);
    }
    const slots = Array.isArray(args?.slots) ? args.slots.map((sl) => ({
      id: String(sl?.id || "").trim(),
      kind: String(sl?.kind || "text"),
      label: String(sl?.label || sl?.id || ""),
      default: sl?.default,
      min: sl?.min, max: sl?.max, options: sl?.options,
    })).filter((sl) => sl.id) : [];
    const blockJson = {
      id,
      label: String(args?.label || id).trim().slice(0, 120),
      description: String(args?.description || "").trim().slice(0, 400),
      placement: ["section", "inline", "helper"].includes(args?.placement) ? args.placement : "inline",
      category: String(args?.category || "misc").trim().slice(0, 40),
      version: 1,
      source: "user",
      pug,
      styl: String(args?.styl || ""),
      slots,
      tags: Array.isArray(args?.tags) ? args.tags.slice(0, 12).map(String) : [],
      createdAt: new Date().toISOString(),
    };
    const saved = await saveUserBlockWithLifecycle({
      payload: blockJson,
      target,
      force: Boolean(args?.force),
    });
    return {
      ok: true,
      id,
      slots: slots.length,
      review: saved.review,
      validation: saved.validation,
    };
  },

  async delete_user_block(args, _ctx) {
    const id = String(args?.id || "").trim();
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(id)) throw new Error("invalid block id");
    const target = userBlockPath(id);
    if (!_existsSyncBlocks(target)) throw new Error("user block not found: " + id);
    _rmSyncBlocks(target, { force: true });
    return { ok: true, id };
  },

  async validate_html(_args, ctx) {
    const html = String(ctx.modifiedHtml || ctx.html || "");
    if (!html) return { error: "no HTML open in the editor" };
    const r = validateHtml(html);
    return { ok: r.ok, count: r.count, issues: r.issues.slice(0, 40), issuesTruncated: r.count > 40 ? r.count - 40 : 0 };
  },

  async list_email_sections(_args, ctx) {
    const html = String(ctx.modifiedHtml || ctx.html || "");
    if (!html) return { error: "no HTML open in the editor" };
    const r = listHtmlSections(html);
    if (!r.marked) {
      return { marked: false, count: 0, note: "This email has no rk:block markers. Use find_in_html to locate the block, then insert_block / remove_block with a unique anchor." };
    }
    return { marked: true, count: r.count, sections: r.sections.map((s) => ({ index: s.index, id: s.id, preview: s.preview })) };
  },

  async insert_block(args, ctx) {
    const html = String(ctx.modifiedHtml || ctx.html || "");
    if (!html) return { error: "no HTML open in the editor" };
    const r = insertHtml(html, { anchor: args.anchor, position: args.position, snippet: args.html });
    if (r.error) return { error: r.error };
    ctx.modifiedHtml = r.html;
    return {
      inserted: (args.html || "").length,
      htmlLength: r.html.length,
      delta: r.html.length - html.length,
      note: "Block insert staged. It reaches the editor when you call finish (applied after user confirmation).",
    };
  },

  async remove_block(args, ctx) {
    const html = String(ctx.modifiedHtml || ctx.html || "");
    if (!html) return { error: "no HTML open in the editor" };
    const r = removeHtml(html, { from: args.from, to: args.to, block: args.block });
    if (r.error) return { error: r.error };
    ctx.modifiedHtml = r.html;
    return {
      removed: r.removed,
      htmlLength: r.html.length,
      delta: r.html.length - html.length,
      note: "Block removal staged. It reaches the editor when you call finish (applied after user confirmation).",
    };
  },

  async compose_email_from_blocks(args, ctx) {
    try {
      const requested = Array.isArray(args.blocks) ? args.blocks : [];
      const unsafeIds = requested.map((entry) => String(entry?.id || "").trim()).filter((id) => {
        if (!id) return true;
        try { return loadCanonicalBlock(id).source !== "canonical"; }
        catch { return true; }
      });
      if (unsafeIds.length) {
        return {
          error: `compose_email_from_blocks accepts canonical ids only; unavailable/legacy: ${[...new Set(unsafeIds)].join(", ")}`,
          hint: "Call list_canonical_blocks and choose from that result.",
        };
      }
      const target = resolveComposeEmailTarget({
        brand: args.brand || "X_assembled",
        mailName: args.mailName,
      });
      const distDestination = path.join(
        target.destRoot,
        "dist",
        target.brand,
        `mail-${target.mailName}`,
      );
      // Validate the exact shared compose model before the save transaction
      // moves an existing mail/dist tree aside. AI cannot bypass the same
      // public-asset gate used by the constructor/API.
      composeEmailFromBlocks({
        brand: target.brand,
        mailName: target.mailName,
        blocks: requested,
        destRoot: target.destRoot,
        validateOnly: true,
      });
      const result = await withComposeSaveTransaction({
        destination: target.destDir,
        distDestination,
        force: args.force === true,
      }, async () => composeEmailFromBlocks({
        brand: target.brand,
        mailName: target.mailName,
        blocks: requested,
        destRoot: target.destRoot,
      }));
      // Stash where the mail landed so `finish` can mention it.
      ctx.composedMailPath = result.destDir;
      ctx.composedBrand = result.brand;
      ctx.composedMailName = result.mailName;
      return {
        destDir: result.destDir,
        brand: result.brand,
        mailName: result.mailName,
        blocksUsed: result.blocksUsed,
        totalBlocks: result.totalBlocks,
        warnings: result.warnings,
        nextStep: `Run build-mail.js --category ${result.brand} --mail ${result.mailName} to produce the dist HTML.`,
      };
    } catch (err) {
      if (err?.code === "COMPOSE_SAVE_TARGET_EXISTS") {
        return {
          error: "mail already exists; refusing to overwrite source or dist without explicit force",
          code: err.code,
          hint: "Choose a different mailName, or ask the user to confirm replacement and retry with force: true.",
        };
      }
      return { error: String(err && err.message ? err.message : err) };
    }
  },

  /**
   * Правка блока, уже стоящего на канвасе конструктора.
   *
   * Канвас живёт в браузере и на сервере не хранится, поэтому инструмент не
   * меняет ничего сам, а записывает намерение в ctx. Сервер отдаёт накопленные
   * операции клиенту в финальном кадре, клиент их применяет и перерисовывает
   * превью. Без этого агент на просьбу «сдвинь кнопку влево» брался за
   * edit_locale_block и save_user_block — то есть за файлы переводов и за
   * библиотеку блоков, а само письмо оставалось нетронутым.
   */
  async open_draft(args, ctx) {
    try {
      const opened = await openDraft(ctx?.repoRoot, {
        brand: args?.brand, mail: args?.mail, actor: ctx?.actor, readOnly: ctx?.readOnly,
      });
      // Дальше агент должен работать с черновиком, а не с базой. Говорим это
      // прямым текстом: иначе следующий же вызов уйдёт мимо копии.
      ctx.brand = opened.draft.brand;
      ctx.mail = opened.draft.mail;
      return {
        ok: true,
        created: opened.created,
        draft: opened.draft.mail,
        brand: opened.draft.brand,
        note: `Работайте дальше с «${opened.draft.mail}» — это ваша копия. Общая база не изменится, пока человек не скажет опубликовать.`,
      };
    } catch (error) { return { error: error.message, code: error.code, holder: error.holder }; }
  },

  async list_drafts(args, ctx) {
    try { return { ok: true, drafts: listDrafts(ctx?.repoRoot, ctx?.actor) }; }
    catch (error) { return { error: error.message, code: error.code }; }
  },

  async draft_changes(args, ctx) {
    try {
      return {
        ok: true,
        changes: draftChanges(ctx?.repoRoot, { brand: args?.brand, mail: args?.mail, actor: ctx?.actor }),
      };
    } catch (error) { return { error: error.message, code: error.code }; }
  },

  async publish_draft(args, ctx) {
    try {
      return {
        ok: true,
        ...await publishDraft(ctx?.repoRoot, {
          brand: args?.brand, mail: args?.mail, actor: ctx?.actor,
          readOnly: ctx?.readOnly, force: Boolean(args?.force),
        }),
      };
    } catch (error) {
      return {
        error: error.message,
        code: error.code,
        ...(error.changes ? { changes: error.changes } : {}),
        hint: error.code === "BASE_CHANGED"
          ? "База изменилась с тех пор, как вы взяли копию. Покажите разницу человеку и спросите — не публикуйте поверх сами."
          : undefined,
      };
    }
  },

  async discard_draft(args, ctx) {
    try {
      return { ok: true, ...await discardDraft(ctx?.repoRoot, { brand: args?.brand, mail: args?.mail, actor: ctx?.actor }) };
    } catch (error) { return { error: error.message, code: error.code }; }
  },

  async mail_history(args, ctx) {
    try { return { ok: true, history: listSnapshots(ctx?.repoRoot, { brand: args?.brand, mail: args?.mail }) }; }
    catch (error) { return { error: error.message, code: error.code }; }
  },

  async see_email(args, ctx) {
    return seeEmail(args, ctx);
  },

  async see_block(args, ctx) {
    return seeBlock(args, ctx, {
      previewRoot: path.join(ctx?.repoRoot || process.cwd(), "data", "block-previews"),
      // Превью к блокам прикручиваются отдельно: без этого у каждого блока
      // «нет картинки», и глаза бесполезны.
      blocks: attachPreviews(listCanonicalBlocks()),
    });
  },

  async list_mail_files(args, ctx) {
    try { return listMailFiles(args, ctx); }
    catch (error) { return { error: error.message, code: error.code }; }
  },

  async read_mail_file(args, ctx) {
    try { return readMailFile(args, ctx); }
    catch (error) { return { error: error.message, code: error.code }; }
  },

  async write_mail_file(args, ctx) {
    try { return await writeMailFile(args, ctx, { writeFileSync: fsWriteFileSync }); }
    catch (error) { return { error: error.message, code: error.code }; }
  },

  async check_canvas_ready(args, ctx) {
    const canvas = Array.isArray(ctx?.canvasSummary) ? ctx.canvasSummary : [];
    if (!canvas.length) return { ok: true, note: "На канвасе пусто — проверять нечего." };
    // Образцовые значения берём из живой библиотеки, а не из списка в коде:
    // добавили блок с новым демо-текстом — проверка узнает о нём сама.
    const result = checkCanvasReady({ canvas: mergedCanvas(ctx), blocks: listCanonicalBlocks() });
    return {
      ok: result.ready,
      language: result.language,
      leftovers: result.leftovers,
      message: describeLeftovers(result),
    };
  },

  async update_canvas_block(args, ctx) {
    const uid = args?.uid;
    if (uid === undefined || uid === null || uid === "") {
      return { error: "uid is required — take it from the canvas tree in the user message" };
    }
    const tree = canvasTree(ctx);
    const target = tree.find((entry) => String(entry.uid) === String(uid));
    if (tree.length && !target) return canvasMiss(tree, uid);

    const slots = args?.slots && typeof args.slots === "object" && !Array.isArray(args.slots)
      ? args.slots : null;
    const appearance = args?.appearance && typeof args.appearance === "object" && !Array.isArray(args.appearance)
      ? args.appearance : null;
    if (!slots && !appearance) {
      return { error: "nothing to change — pass slots and/or appearance" };
    }

    const checkedSlots = slots
      ? CANVAS_SLOT_VALUES.normalizeSlotPatch(target?.slotSchema, slots)
      : null;
    if (checkedSlots && !checkedSlots.ok) {
      return {
        error: `canvas slot update rejected: ${checkedSlots.errors.map((item) => item.error).join("; ")}`,
        code: "INVALID_CANVAS_SLOT_VALUE",
        uid,
        invalidSlots: checkedSlots.errors.map((item) => ({
          id: item.id || null,
          code: item.code,
          message: item.error,
        })),
        hint: "Use one line for text, URL, image, colour, number and select slots. Use a richText slot for intentional paragraphs.",
      };
    }
    const safeSlots = checkedSlots?.values || null;

    pushCanvasOp(ctx, {
      kind: "update",
      uid,
      ...(safeSlots ? { slots: JSON.parse(JSON.stringify(safeSlots)) } : {}),
      ...(appearance ? { appearance: JSON.parse(JSON.stringify(appearance)) } : {}),
      reason: shortReason(args?.reason),
    });

    // Локально обновляем сводку дерева, чтобы следующий шаг агента видел
    // уже изменённое состояние, а не спорил сам с собой.
    if (target && safeSlots) target.slots = { ...(target.slots || {}), ...safeSlots };

    return {
      ok: true,
      uid,
      blockId: target?.blockId || null,
      changedSlots: safeSlots ? Object.keys(safeSlots) : [],
      normalizedRichTextSlots: checkedSlots?.normalizedSlots || [],
      changedAppearance: appearance ? Object.keys(appearance) : [],
      note: "Изменение применится к канвасу конструктора, когда ты завершишь работу (finish).",
    };
  },

  async remove_canvas_block(args, ctx) {
    const tree = canvasTree(ctx);
    const uid = args?.uid;
    const target = tree.find((entry) => String(entry.uid) === String(uid));
    if (!target) return canvasMiss(tree, uid);
    const doomed = canvasSubtreeUids(tree, uid);
    ctx.canvasSummary = tree.filter((entry) => !doomed.has(String(entry.uid)));
    pushCanvasOp(ctx, { kind: "remove", uid, reason: shortReason(args?.reason) });
    return {
      ok: true,
      removed: [...doomed],
      blockId: target.blockId || null,
      remaining: ctx.canvasSummary.length,
      note: "Блок уйдёт с канваса, когда ты завершишь работу (finish). Один Ctrl+Z вернёт его человеку.",
    };
  },

  async clear_canvas(args, ctx) {
    if (args?.confirm !== true) {
      return {
        error: "clear_canvas wipes the whole email — pass confirm: true, and only if the person asked for it",
        code: "CONFIRM_REQUIRED",
      };
    }
    const had = canvasTree(ctx).length;
    ctx.canvasSummary = [];
    pushCanvasOp(ctx, { kind: "clear", reason: shortReason(args?.reason) });
    return {
      ok: true,
      removed: had,
      note: had
        ? "Канвас очистится, когда ты завершишь работу (finish). Дальше собирай письмо через add_canvas_block."
        : "На канвасе и так было пусто.",
    };
  },

  async add_canvas_block(args, ctx) {
    const tree = canvasTree(ctx);
    const blockId = String(args?.blockId || "").trim();
    if (!blockId) return { error: "blockId is required — take it from list_canonical_blocks or find_blocks_by_look" };
    const library = listCanonicalBlocks();
    const wantedSource = String(args?.blockSource || "").trim();
    const block = library.find((candidate) => candidate.id === blockId
      && (!wantedSource || candidate.source === wantedSource))
      || library.find((candidate) => candidate.id === blockId);
    if (!block) {
      const near = library
        .filter((candidate) => String(candidate.id).includes(blockId) || blockId.includes(String(candidate.id)))
        .map((candidate) => candidate.id).slice(0, 8);
      return {
        error: `no block "${blockId}" in the library`,
        code: "UNKNOWN_BLOCK",
        ...(near.length ? { didYouMean: near } : {}),
        hint: "Call list_canonical_blocks or find_blocks_by_look first — block ids are not guessable.",
      };
    }

    const wanted = args?.slots && typeof args.slots === "object" && !Array.isArray(args.slots) ? args.slots : null;
    const checked = wanted ? CANVAS_SLOT_VALUES.normalizeSlotPatch(block.slots, wanted) : null;
    if (checked && !checked.ok) {
      return {
        error: `canvas slot values rejected: ${checked.errors.map((item) => item.error).join("; ")}`,
        code: "INVALID_CANVAS_SLOT_VALUE",
        invalidSlots: checked.errors.map((item) => ({ id: item.id || null, code: item.code, message: item.error })),
        hint: "Use one line for text, URL, image, colour, number and select slots. Use a richText slot for intentional paragraphs.",
      };
    }

    const parentUid = args?.parentUid ?? null;
    if (parentUid != null && tree.length && !tree.some((entry) => String(entry.uid) === String(parentUid))) {
      return canvasMiss(tree, parentUid);
    }

    // Комбо — это рецепт из нескольких блоков. Каждому ребёнку выдаём свой
    // временный uid здесь же: иначе агент соберёт каркас и в том же заходе
    // не сможет заменить в нём образцовый текст, а ради этого всё и делается.
    const children = Array.isArray(block.children) && block.children.length ? block.children : null;
    const added = [];
    const childTempUids = [];
    if (children) {
      for (const child of children) {
        const def = library.find((candidate) => candidate.id === child.id
          && (!child.source || candidate.source === child.source))
          || library.find((candidate) => candidate.id === child.id);
        const temp = nextCanvasTempUid(ctx);
        childTempUids.push(def ? temp : null);
        if (!def) continue;
        added.push(canvasEntryFor(def, temp, { ...(child.slots || {}) }));
      }
      if (!added.length) return { error: `combo "${blockId}" has no blocks this studio knows`, code: "EMPTY_COMBO" };
    } else {
      added.push(canvasEntryFor(block, nextCanvasTempUid(ctx), checked?.values || {}));
    }

    for (const entry of added) tree.push(entry);
    pushCanvasOp(ctx, {
      kind: "add",
      blockId: block.id,
      ...(block.source ? { blockSource: block.source } : {}),
      ...(parentUid != null ? { parentUid } : {}),
      ...(args?.slotId ? { slotId: String(args.slotId) } : {}),
      ...(args?.afterUid != null ? { afterUid: args.afterUid } : {}),
      ...(checked?.values && !children ? { slots: JSON.parse(JSON.stringify(checked.values)) } : {}),
      tempUid: children ? null : added[0].uid,
      ...(children ? { childTempUids } : {}),
      // Снимок добавленного нужен только серверу: пересборка дерева после
      // clear в этом же заходе должна дать то же, что видит агент.
      entries: JSON.parse(JSON.stringify(added)),
      reason: shortReason(args?.reason),
    });

    return {
      ok: true,
      uid: added[0].uid,
      blockId: block.id,
      ...(children ? { combo: true, blocks: added.map((entry) => ({ uid: entry.uid, blockId: entry.blockId })) } : {}),
      slots: added[0].slots,
      slotSchema: added[0].slotSchema,
      note: "Блок появится на канвасе, когда ты завершишь работу (finish). uid уже настоящий для тебя: "
        + "вызывай update_canvas_block с ним прямо сейчас, чтобы заменить образцовый текст.",
    };
  },

  async move_canvas_block(args, ctx) {
    const tree = canvasTree(ctx);
    const uid = args?.uid;
    const index = tree.findIndex((entry) => String(entry.uid) === String(uid));
    if (index < 0) return canvasMiss(tree, uid);
    const entry = tree[index];
    const direction = args?.direction === "up" ? "up" : "down";
    const siblings = tree.filter((candidate) => String(candidate.parentUid ?? "") === String(entry.parentUid ?? "")
      && String(candidate.slotId ?? "") === String(entry.slotId ?? ""));
    const at = siblings.findIndex((candidate) => String(candidate.uid) === String(uid));
    const to = at + (direction === "up" ? -1 : 1);
    if (at < 0 || to < 0 || to >= siblings.length) {
      return {
        error: `block ${uid} is already ${direction === "up" ? "first" : "last"} among its neighbours`,
        code: "CANVAS_EDGE",
        hint: "To put it into a different container, remove_canvas_block and add_canvas_block with that parentUid.",
      };
    }
    // Сводку двигаем сразу: следующий шаг агента должен видеть новый порядок.
    const neighbour = siblings[to];
    const neighbourIndex = tree.findIndex((candidate) => String(candidate.uid) === String(neighbour.uid));
    tree[index] = neighbour;
    tree[neighbourIndex] = entry;
    pushCanvasOp(ctx, { kind: "move", uid, direction, reason: shortReason(args?.reason) });
    return {
      ok: true,
      uid,
      direction,
      swappedWith: neighbour.uid,
      note: "Порядок изменится на канвасе, когда ты завершишь работу (finish).",
    };
  },

  async finish(args, _ctx) {
    return {
      summary: String(args.summary || ""),
      modifiedHtml: args.modifiedHtml || "",
      localeUpdates: Array.isArray(args.localeUpdates) ? args.localeUpdates : [],
    };
  },
};
