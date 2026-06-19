/**
 * AI helpers for the studio's locale workflow.
 *
 * The studio represents a locale as a plain TXT file with sequential blocks:
 *
 *   {{Subject: Your Deletion of Data Request was received}}
 *
 *   {{Your Deletion of Data Request was received}}
 *
 *   {{Dear Client,}}
 *
 *   {{We hereby confirm receipt of your request to @@DELETE@@ ...}}
 *
 * Block index is 0-based, padded to 2 digits → `block_00`, `block_01`, …
 * Placeholder in HTML: `${{ <namespace>.block_NN }}$`
 * Inside a block: `@@text@@` becomes `<b>text</b>` at render time.
 *
 * AI tools:
 *   - placeholderizeHtml() — given HTML + reference EN locale TXT, replace
 *     visible text in the HTML with ordered `${{ ns.block_NN }}$` placeholders
 *     so that EVERY block in the reference TXT lands on exactly one anchor.
 *   - fixLocaleTxt()      — given a possibly-broken TXT (and optional ref),
 *     return a cleaned-up TXT (paired `{{}}`, balanced `@@`, same block count).
 *   - translateLocaleTxt() — given source TXT and target language, return a
 *     TXT in same shape (block count preserved, `@@…@@` preserved).
 *
 * All AI calls use a strict JSON schema. If the model returns nonsense,
 * the caller can detect it by a count/shape mismatch and refuse to apply.
 */

import { callOpenAiWithRetry, extractResponseText } from "./ai-client.js";
import { buildAnchorUnits, localePrefix, serializeAligned } from "./locale-conventions.js";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";

// ─── TXT parsing helpers (mirrors parseTxtDetailed in workbench.js) ───────

const BLOCK_RE = /\{\{([\s\S]*?)\}\}/g;

export function parseTxtBlocks(text) {
  const norm = String(text || "").replace(/\r\n?/g, "\n");
  const blocks = [];
  let m;
  BLOCK_RE.lastIndex = 0;
  while ((m = BLOCK_RE.exec(norm)) !== null) {
    const inner = m[1].trim();
    blocks.push(inner);
  }
  return blocks;
}

export function serializeTxtBlocks(blocks) {
  return blocks.map((b) => `{{${b}}}`).join("\n\n");
}

function pad2(n) { return String(n).padStart(2, "0"); }

function placeholderToken(namespace, index) {
  return `\${{ ${namespace}.block_${pad2(index)} }}$`;
}


// ─── DOM-tool: extract visible text elements from HTML ───────────────────
// Walks the HTML string and finds every text-bearing element (p/h*/li/td/a/span)
// that contains visible text. Returns a list of { id, tag, text, innerStart,
// innerEnd, outerStart, outerEnd } so we can later substitute the placeholder
// into the INNER range of any element by id.
//
// This gives the AI a structured, numbered view of the email's visible text
// — provider-agnostic, deterministic, and immune to whitespace/&nbsp; quirks.

const TEXT_ELEMENT_TAGS = ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'td', 'a', 'span'];

function visibleTextOf(html) {
  return String(html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Walk the HTML with a stack-based tokenizer and return an ordered list of
 * LEAF visible-text elements. "Leaf" means: a text-bearing element (p, h*,
 * li, td, a, span) whose inner content does NOT contain another captured
 * text element. So `<td><p>foo</p></td>` returns only the inner `<p>`, not
 * the outer `<td>`.
 *
 * Each element gets:
 *   - id          — stable, document-order index
 *   - tag         — the element's tag name
 *   - text        — visible text inside (HTML stripped, entities decoded,
 *                   whitespace collapsed, capped at 500 chars)
 *   - parentChain — array of up to 3 closest ancestor descriptors
 *                   ("tag.firstClassToken"), innermost first. Used by the
 *                   AI to disambiguate identical text in different sections
 *                   (e.g. heading repeated in hero card and in footer card).
 *   - innerStart / innerEnd — byte range of the inner content in `html`
 *                             (for placeholder substitution)
 *   - outerStart / outerEnd — byte range of the whole element (diagnostics)
 *
 * The previous regex-based implementation had a hidden bug: an outer
 * text-element wrapping another text-element (e.g. `<td><p>foo</p></td>`)
 * caused the outer to be skipped AND the inner was also skipped because
 * the regex had already consumed the range. Result: text invisible to AI.
 * This rewrite fixes that.
 *
 * @param {string} html
 * @returns {Array<{ id: number, tag: string, text: string, parentChain: string[], innerStart: number, innerEnd: number, outerStart: number, outerEnd: number }>}
 */
export function extractVisibleElements(html) {
  if (!html || typeof html !== 'string') return [];

  const TEXT_TAG_SET = new Set(TEXT_ELEMENT_TAGS);
  const VOID_TAGS = new Set([
    'br', 'img', 'hr', 'meta', 'link', 'input', 'source', 'area',
    'base', 'col', 'embed', 'param', 'track', 'wbr',
  ]);

  // Pass 1: walk tokens, collect every text-element open/close range
  // and its parent stack at the time of opening.
  const candidates = [];
  const stack = []; // [{ tag, classes, openStart, openEnd }]
  const tagRe = /<(\/?)([a-z][\w:-]*)\b([^>]*?)>/gi;
  let m;
  while ((m = tagRe.exec(html)) !== null) {
    const closing = m[1] === '/';
    const tag = m[2].toLowerCase();
    const attrs = m[3] || '';

    // Skip <style> / <script> blocks — their contents are not real DOM text.
    if ((tag === 'script' || tag === 'style') && !closing) {
      const closeRe = new RegExp(`</${tag}\\s*>`, 'i');
      const slice = html.slice(tagRe.lastIndex);
      const closeMatch = closeRe.exec(slice);
      if (closeMatch) tagRe.lastIndex += closeMatch.index + closeMatch[0].length;
      continue;
    }

    const isSelfClosing = /\/\s*$/.test(attrs) || VOID_TAGS.has(tag);
    if (isSelfClosing) continue;

    if (!closing) {
      const clsMatch = attrs.match(/\bclass\s*=\s*["']([^"']*)["']/i);
      stack.push({
        tag,
        classes: clsMatch ? clsMatch[1].trim() : '',
        openStart: m.index,
        openEnd: tagRe.lastIndex,
      });
    } else {
      // Pop down to matching opener (tolerate malformed nesting).
      let i = stack.length - 1;
      while (i >= 0 && stack[i].tag !== tag) i -= 1;
      if (i < 0) continue;
      const frame = stack[i];
      stack.length = i;

      if (TEXT_TAG_SET.has(tag)) {
        // Snapshot parent chain (closest first), up to 3 levels.
        const parentChain = [];
        for (let j = stack.length - 1; j >= 0 && parentChain.length < 3; j -= 1) {
          const p = stack[j];
          const firstCls = p.classes.split(/\s+/).filter(Boolean)[0] || '';
          parentChain.push(firstCls ? `${p.tag}.${firstCls}` : p.tag);
        }
        candidates.push({
          tag,
          parentChain,
          openStart: frame.openStart,
          openEnd: frame.openEnd,
          closeStart: m.index,
          closeEnd: tagRe.lastIndex,
        });
      }
    }
  }

  // Pass 2: keep only LEAF text elements — those that don't fully contain
  // another candidate. O(n²) but n is small for emails (<200 typical).
  const isContainedBy = (inner, outer) =>
    inner.openStart >= outer.openEnd && inner.closeEnd <= outer.closeStart;
  const leaves = candidates.filter((c, idx) => {
    for (let j = 0; j < candidates.length; j += 1) {
      if (j === idx) continue;
      if (isContainedBy(candidates[j], c)) return false;
    }
    return true;
  });

  // Pass 3: build final output, skip leaves without visible text, sort by
  // document order, assign stable ids.
  return leaves
    .map((c) => {
      const inner = html.slice(c.openEnd, c.closeStart);
      const visText = visibleTextOf(inner);
      if (!visText) return null;
      return {
        id: 0, // assigned after sorting
        tag: c.tag,
        text: visText.slice(0, 500),
        parentChain: c.parentChain,
        innerStart: c.openEnd,
        innerEnd: c.closeStart,
        outerStart: c.openStart,
        outerEnd: c.closeEnd,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.outerStart - b.outerStart)
    .map((el, i) => ({ ...el, id: i }));
}

// JSON schema for the DOM-aware placeholderize: AI returns elementId not substring.
const PLACEHOLDERIZE_DOM_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    notes: { type: 'string' },
    mappings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          blockIndex: { type: 'integer', minimum: 0 },
          elementId: { type: 'integer', minimum: 0 },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
        },
        required: ['blockIndex', 'elementId', 'confidence'],
      },
    },
  },
  required: ['notes', 'mappings'],
};

// ─── JSON schemas ──────────────────────────────────────────────────────────

// For placeholderizeHtml: AI returns a list of {original, blockIndex}.
const PLACEHOLDERIZE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    notes: { type: "string" },
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          blockIndex: { type: "integer", minimum: 0 },
          original:   { type: "string" },
        },
        required: ["blockIndex", "original"],
      },
    },
  },
  required: ["notes", "items"],
};

// For fixLocaleTxt and translateLocaleTxt: AI returns array of strings, one per block.
const BLOCKS_ARRAY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    notes:  { type: "string" },
    blocks: { type: "array", items: { type: "string" } },
  },
  required: ["notes", "blocks"],
};


// ─── Validation: token-overlap between refBlock and element.text ─────────
// AI sometimes maps the wrong elementId to a blockIndex. We compute a cheap
// Jaccard-like similarity on lowercased word tokens. Threshold ~0.3 means
// at least 30% of the smaller side's tokens must overlap.
function tokeniseForSimilarity(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 2);
}
function similarity(a, b) {
  const aT = new Set(tokeniseForSimilarity(a));
  const bT = new Set(tokeniseForSimilarity(b));
  if (!aT.size || !bT.size) return 0;
  let inter = 0;
  for (const t of aT) if (bT.has(t)) inter += 1;
  const minSize = Math.min(aT.size, bT.size);
  return minSize ? inter / minSize : 0;
}

// ─── Public: AI placeholderize ─────────────────────────────────────────────

/**
 * Rank unused candidate elements by token similarity to a given refBlock.
 * Used by the second-pass validator: when a refBlock didn't get an anchor
 * in the primary call, we hand the AI a focused short-list rather than the
 * whole element set again.
 *
 * @param {string} refText        — text of the unmapped refBlock
 * @param {Array}  elements       — full element list from extractVisibleElements
 * @param {Set<number>} usedIds   — element ids already consumed by primary mappings
 * @param {number} topN           — how many to return
 */
function topCandidatesForRef(refText, elements, usedIds, topN = 5) {
  return elements
    .filter((e) => !usedIds.has(e.id))
    .map((e) => ({ el: e, sim: similarity(refText, e.text) }))
    .filter((x) => x.sim > 0)
    .sort((a, b) => b.sim - a.sim)
    .slice(0, topN)
    .map((x) => ({ ...x.el, _similarity: x.sim }));
}

/**
 * @param {object} args
 * @param {string} args.html
 * @param {string} args.refLocaleTxt    Reference TXT (EN) whose {{...}} blocks
 *                                      define the order and content anchor.
 * @param {string} args.namespace       Used in placeholder string.
 * @param {string} args.apiKey
 * @param {string} [args.model="gpt-4.1-mini"]
 * @returns {Promise<{
 *   html: string,            // rewritten HTML (only if every block was anchored)
 *   anchors: number,         // how many blocks were placed
 *   missed: number[],        // block indices that were not found in HTML
 *   ambiguous: number[],     // block indices that AI could not unambiguously match
 *   raw: object,             // raw AI response (for debugging)
 *   report: {                // structured report for studio UI / journal
 *     mailHint: string,
 *     refBlockCount: number,
 *     elementCount: number,
 *     anchored: number,
 *     missed: number,
 *     ambiguous: number,
 *     usedSecondPass: boolean,
 *     decisions: Array<{ blockIndex, refText, elementId, elementText, parentChain, similarity, confidence, source }>,
 *     stats: { similarityMin, similarityAvg, confidenceMin, confidenceAvg }
 *   }
 * }>}
 */
export async function placeholderizeHtml({
  html, refLocaleTxt, namespace,
  apiKey, model = "gpt-4.1-mini",
  logger, mailHint = "",
}) {
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");
  if (!html || typeof html !== "string") throw new Error("html is required");
  if (!refLocaleTxt) throw new Error("refLocaleTxt is required");
  if (!namespace) throw new Error("namespace is required");

  const refBlocks = parseTxtBlocks(refLocaleTxt);
  if (!refBlocks.length) throw new Error("refLocaleTxt has no {{...}} blocks");

  const ns = String(namespace).replace(/[^a-z0-9_-]/gi, "_");

  // ── Anchor units (locale conventions, см. src/locale-conventions.js) ──
  // Блоки одного абзаца, разбитые вокруг {{embedded.*}}-переменных
  // ({{text}} {{var}}{{tail}}), анкерятся как ОДИН юнит: visibleText содержит
  // переменную литералом (так она и видна в HTML), replacement подставляет
  // ${{ ns.block_NN }}$ для текстовых частей и сохраняет литерал переменной.
  const allUnits = buildAnchorUnits(refLocaleTxt, ns);
  const anchorable = allUnits.filter((u) => u.hasText);

  // ── DOM-aware path: extract visible-text elements from the HTML and let AI
  // map reference blocks → element ids. Provider-agnostic, no fragile substring
  // matching needed.
  const elements = extractVisibleElements(html);

  const systemPrompt =
    "You map reference text blocks onto visible elements of an HTML email. " +
    "Rules:\n" +
    "1. You receive `refBlocks` (the source-of-truth text, one entry per locale block, " +
    "in author-intended order) and `elements` (a numbered list of visible-text elements " +
    "extracted from the HTML, in document order). Each element has `tag`, `text`, and " +
    "`context` — an array of ancestor descriptors (innermost first) used to disambiguate " +
    "elements with identical text in different sections.\n" +
    "2. For each refBlock, find the SINGLE element whose visible text matches that block, " +
    "and return `{ blockIndex, elementId, confidence }` (confidence 0..1).\n" +
    "3. Match by MEANING, not exact characters. Whitespace, &nbsp;, and inline-tag " +
    "differences are normal. Placeholders like `{{Level_Name}}` or `${{ ns.block_NN }}$` " +
    "should be treated as wildcards — they don't have to match anything specific.\n" +
    "4. When two elements have similar text, USE `context` to pick the right one. " +
    "A heading repeated in a hero card vs. a footer card lives under different parents. " +
    "Prefer the element whose context aligns with the refBlock's likely section.\n" +
    "5. If a refBlock has no matching element (empty block, or text genuinely not in the " +
    "HTML), omit it from the mappings array.\n" +
    "6. Each elementId can be used at most ONCE. Each blockIndex at most ONCE.\n" +
    "7. Be honest about confidence: < 0.6 = skip rather than guess.";

  const userPayload = JSON.stringify({
    namespace: ns,
    refBlocks: anchorable.map((u, i) => ({ blockIndex: i, text: u.visibleText.replace(/@@/g, "") })),
    elements: elements.map(({ id, tag, text, parentChain }) => ({
      id, tag, text, context: parentChain || [],
    })),
  });

  const data = await callOpenAiWithRetry(
    async () => ({
      url: OPENAI_RESPONSES_URL,
      body: {
        model,
        input: [
          { role: "system", content: [{ type: "input_text", text: systemPrompt }] },
          { role: "user",   content: [{ type: "input_text", text: userPayload }] },
        ],
        text: { format: { type: "json_schema", name: "placeholderize_dom", strict: true, schema: PLACEHOLDERIZE_DOM_SCHEMA } },
      },
    }),
    { label: `placeholderize-dom-${ns}`, apiKey, logger }
  );

  const txt = extractResponseText(data);
  if (!txt) throw new Error("AI returned empty response for placeholderize");
  const parsed = JSON.parse(txt);
  const mappings = Array.isArray(parsed.mappings) ? parsed.mappings : [];

  // ── Primary pass: filter AI mappings ─────────────────────────────────
  // For each accepted mapping, build an `item` with the element's inner
  // range. Track decisions so we can return a structured report.
  const items = [];
  const seenElementIds = new Set();
  const seenBlocksPrimary = new Set();
  const decisions = [];
  const rejectedLowSimilarity = [];

  for (const map of mappings) {
    if (typeof map.blockIndex !== "number" || typeof map.elementId !== "number") continue;
    if (seenBlocksPrimary.has(map.blockIndex)) continue;
    const conf = typeof map.confidence === "number" ? map.confidence : 1;
    if (conf < 0.5) {
      decisions.push({
        blockIndex: map.blockIndex,
        refText: String(anchorable[map.blockIndex]?.visibleText || '').replace(/@@/g, '').slice(0, 80),
        elementId: map.elementId, elementText: '', parentChain: [],
        similarity: 0, confidence: conf,
        source: 'primary-skipped-low-confidence',
      });
      continue;
    }
    if (seenElementIds.has(map.elementId)) continue;
    const el = elements.find((e) => e.id === map.elementId);
    if (!el) continue;
    const refTxt = String(anchorable[map.blockIndex]?.visibleText || '').replace(/@@/g, '');
    const sim = similarity(refTxt, el.text);
    if (sim < 0.3) {
      rejectedLowSimilarity.push({ blockIndex: map.blockIndex, elementId: map.elementId, sim });
      decisions.push({
        blockIndex: map.blockIndex,
        refText: refTxt.slice(0, 80),
        elementId: map.elementId, elementText: el.text.slice(0, 80),
        parentChain: el.parentChain || [],
        similarity: sim, confidence: conf,
        source: 'primary-rejected-low-similarity',
      });
      continue;
    }
    seenElementIds.add(map.elementId);
    seenBlocksPrimary.add(map.blockIndex);
    items.push({
      blockIndex: map.blockIndex,
      original: html.slice(el.innerStart, el.innerEnd),
      _elementId: el.id,
      _similarity: sim,
    });
    decisions.push({
      blockIndex: map.blockIndex,
      refText: refTxt.slice(0, 80),
      elementId: el.id, elementText: el.text.slice(0, 80),
      parentChain: el.parentChain || [],
      similarity: sim, confidence: conf,
      source: 'primary',
    });
  }
  if (rejectedLowSimilarity.length) {
    console.warn('[placeholderize] rejected', rejectedLowSimilarity.length, 'low-similarity mappings:', rejectedLowSimilarity);
  }

  // ── Second pass: focused retry for unmapped refBlocks ──────────────
  // If any refBlock didn't get an anchor (skipped, rejected, or model just
  // didn't return one), give the AI a small short-list of the highest-similarity
  // unused candidates and ask again — with the surrounding mapped context so it
  // knows which blocks are already locked in.
  const unmappedBlockIndices = [];
  for (let i = 0; i < anchorable.length; i += 1) {
    if (!seenBlocksPrimary.has(i) && String(anchorable[i].visibleText || '').replace(/@@/g, '').trim()) {
      unmappedBlockIndices.push(i);
    }
  }

  let usedSecondPass = false;
  if (unmappedBlockIndices.length && elements.length > seenElementIds.size) {
    usedSecondPass = true;
    const focusedRefs = unmappedBlockIndices.map((i) => {
      const refText = String(anchorable[i].visibleText || '').replace(/@@/g, '');
      return {
        blockIndex: i,
        text: refText,
        candidates: topCandidatesForRef(refText, elements, seenElementIds, 5).map((el) => ({
          id: el.id, tag: el.tag, text: el.text, context: el.parentChain || [],
          _similarity: el._similarity,
        })),
      };
    }).filter((r) => r.candidates.length > 0);

    if (focusedRefs.length) {
      const focusedSystem =
        "You're re-checking unmatched reference blocks. For each block you receive " +
        "the text and 5 best remaining candidate elements (highest text-token overlap, " +
        "unused so far). Pick the SINGLE best match or none. Use `context` (ancestor " +
        "chain) to disambiguate when text alone isn't enough. Be honest — if no " +
        "candidate matches the meaning, return confidence < 0.5 and the studio will " +
        "skip it. Each elementId can be used at most ONCE across the response.";

      const focusedPayload = JSON.stringify({
        namespace: ns,
        alreadyMapped: Array.from(seenBlocksPrimary).sort((a, b) => a - b),
        unmappedBlocks: focusedRefs,
      });

      try {
        const data2 = await callOpenAiWithRetry(
          async () => ({
            url: OPENAI_RESPONSES_URL,
            body: {
              model,
              input: [
                { role: "system", content: [{ type: "input_text", text: focusedSystem }] },
                { role: "user",   content: [{ type: "input_text", text: focusedPayload }] },
              ],
              text: { format: { type: "json_schema", name: "placeholderize_dom", strict: true, schema: PLACEHOLDERIZE_DOM_SCHEMA } },
            },
          }),
          { label: `placeholderize-pass2-${ns}`, apiKey, logger }
        );
        const txt2 = extractResponseText(data2);
        if (txt2) {
          const parsed2 = JSON.parse(txt2);
          const mappings2 = Array.isArray(parsed2.mappings) ? parsed2.mappings : [];
          for (const map of mappings2) {
            if (typeof map.blockIndex !== "number" || typeof map.elementId !== "number") continue;
            if (seenBlocksPrimary.has(map.blockIndex)) continue;
            const conf = typeof map.confidence === "number" ? map.confidence : 1;
            if (conf < 0.5) continue;
            if (seenElementIds.has(map.elementId)) continue;
            const el = elements.find((e) => e.id === map.elementId);
            if (!el) continue;
            const refTxt = String(anchorable[map.blockIndex]?.visibleText || '').replace(/@@/g, '');
            const sim = similarity(refTxt, el.text);
            if (sim < 0.3) continue;
            seenElementIds.add(map.elementId);
            seenBlocksPrimary.add(map.blockIndex);
            items.push({
              blockIndex: map.blockIndex,
              original: html.slice(el.innerStart, el.innerEnd),
              _elementId: el.id,
              _similarity: sim,
            });
            decisions.push({
              blockIndex: map.blockIndex,
              refText: refTxt.slice(0, 80),
              elementId: el.id, elementText: el.text.slice(0, 80),
              parentChain: el.parentChain || [],
              similarity: sim, confidence: conf,
              source: 'second-pass',
            });
          }
        }
      } catch (err) {
        // Second pass is best-effort. Log and continue.
        console.warn('[placeholderize] second-pass failed:', err.message || err);
      }
    }
  }

  // Apply substitutions in REVERSE source-order so character indices stay valid.
  const matches = [];
  const missed = [];
  const ambiguous = [];
  const seenBlocks = new Set();

  // Robust matching: AI's `original` rarely matches verbatim in real HTML
  // because of whitespace, &nbsp;, and inline tags. We try in 3 escalating tiers:
  //   1) verbatim indexOf
  //   2) normalised match (collapse whitespace + decode common entities)
  //   3) fuzzy match: first N visible-text chars of block must appear in
  //      sequence within a paragraph or table-cell.
  // For each successful match we resolve it back to the ORIGINAL byte range
  // in `html` and substitute the placeholder.

  const decodeEntities = (str) => String(str || "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

  const normWs = (str) => decodeEntities(str).replace(/\s+/g, " ").trim();

  // Build a parallel "normalised" HTML with an index map back to the original.
  // Each normalised char points to a source character index in the raw html.
  const buildNormalisedMap = (raw) => {
    const decoded = decodeEntities(raw);
    // We don't track the entity-decoded mapping per-char exactly; instead
    // we work on `decoded` and on the indexOf result we look up the
    // nearest matching slice in `raw`. For positional safety we collapse
    // whitespace while remembering the FIRST source index of each run.
    let normChars = "";
    const sourceIdx = []; // sourceIdx[i] = index in `raw` of the run start
    let i = 0;
    while (i < decoded.length) {
      const c = decoded[i];
      if (/\s/.test(c)) {
        normChars += " ";
        sourceIdx.push(i);
        while (i < decoded.length && /\s/.test(decoded[i])) i += 1;
      } else {
        normChars += c;
        sourceIdx.push(i);
        i += 1;
      }
    }
    return { normChars, sourceIdx, decoded };
  };

  // Strip HTML tags from a string to get a "visible-text-only" approximation
  // for the fuzzy tier.
  const stripTags = (str) => String(str || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

  // Note: decodeEntities differences between `raw` and `decoded` are typically
  // 1-char-per-entity so byte indices on the normalised side may slightly
  // diverge from `raw`. We accept ~5% slack; for placeholder substitution we
  // search a small window around the resolved index.

  const normMap = buildNormalisedMap(html);

  const findMatchInHtml = (needle) => {
    // Tier 1: verbatim
    let idx = html.indexOf(needle);
    if (idx !== -1) {
      // dedupe: bail if multi-match
      if (html.indexOf(needle, idx + 1) !== -1) return { kind: "ambiguous" };
      return { kind: "ok", start: idx, end: idx + needle.length };
    }
    // Tier 2: normalised match
    const needleNorm = normWs(needle);
    if (needleNorm.length >= 4) {
      const ni = normMap.normChars.indexOf(needleNorm);
      if (ni !== -1) {
        // dedupe on normalised
        if (normMap.normChars.indexOf(needleNorm, ni + 1) !== -1) return { kind: "ambiguous" };
        // map back to a range in `html` — bounded by where normChars[ni] points
        // and where normChars[ni + needleNorm.length - 1] points.
        const startRaw = normMap.sourceIdx[ni] ?? 0;
        const endNormIdx = Math.min(ni + needleNorm.length, normMap.sourceIdx.length - 1);
        const endRaw = (normMap.sourceIdx[endNormIdx] ?? startRaw) + 1;
        // Walk forward in `raw` skipping whitespace to find the actual visible-end.
        let s2 = startRaw, e2 = endRaw;
        while (e2 < html.length && /\s/.test(html[e2])) e2 += 1;
        return { kind: "ok", start: s2, end: e2, tier: "norm" };
      }
    }
    // Tier 3: fuzzy first-60-chars-of-visible-text. Look for an element whose
    // visible text starts with that prefix.
    const visible = stripTags(needle).slice(0, 60).trim();
    if (visible.length >= 8) {
      // Search for a paragraph or cell that contains the visible prefix.
      const re = new RegExp(
        "<(p|h[1-6]|li|td|a)\\b[^>]*>([\\s\\S]*?)<\\/\\1>",
        "gi"
      );
      let m;
      while ((m = re.exec(html))) {
        const innerVisible = stripTags(m[2]).slice(0, 80);
        if (innerVisible.includes(visible.slice(0, 30))) {
          // Place the placeholder over the INNER range of that element.
          const innerStart = m.index + m[0].indexOf(">") + 1;
          const innerEnd = re.lastIndex - `</${m[1]}>`.length;
          // Check uniqueness: if another element has same prefix, skip.
          const re2 = new RegExp(
            "<(p|h[1-6]|li|td|a)\\b[^>]*>([\\s\\S]*?)<\\/\\1>",
            "gi"
          );
          re2.lastIndex = re.lastIndex;
          let m2, dup = false;
          while ((m2 = re2.exec(html))) {
            if (stripTags(m2[2]).slice(0, 80).includes(visible.slice(0, 30))) {
              dup = true; break;
            }
          }
          if (dup) return { kind: "ambiguous" };
          return { kind: "ok", start: innerStart, end: innerEnd, tier: "fuzzy" };
        }
      }
    }
    return { kind: "miss" };
  };

  for (const it of items) {
    if (typeof it.blockIndex !== "number" || typeof it.original !== "string") continue;
    if (it.blockIndex < 0 || it.blockIndex >= anchorable.length) continue;
    if (seenBlocks.has(it.blockIndex)) continue;
    seenBlocks.add(it.blockIndex);

    const r = findMatchInHtml(it.original);
    if (r.kind === "ok") {
      matches.push({ start: r.start, end: r.end, blockIndex: it.blockIndex, tier: r.tier || "exact" });
    } else if (r.kind === "ambiguous") {
      ambiguous.push(it.blockIndex);
    } else {
      missed.push(it.blockIndex);
    }
  }

  // Any anchorable unit not present in matches → missed.
  for (let i = 0; i < anchorable.length; i += 1) {
    if (!seenBlocks.has(i)) missed.push(i);
  }

  // SAFETY: drop matches whose `original` is suspiciously long — those are
  // AI mistakes that try to swallow whole sections (we'd lose the email).
  // Лимит относителен ЭТАЛОННОМУ тексту юнита: заменяемый диапазон не может
  // быть сильно длиннее самого текста блока (раньше был жёсткий «25% документа»
  // — он резал легитимные длинные абзацы в коротких письмах).
  const docLen = html.length;
  const maxOriginalFor = (m) => {
    const refLen = String(anchorable[m.blockIndex]?.visibleText || "").length;
    return Math.min(2000, Math.max(300, Math.floor(refLen * 1.6) + 80));
  };
  const filteredMatches = matches.filter((m) => (m.end - m.start) <= maxOriginalFor(m));
  const droppedTooLong = matches.length - filteredMatches.length;
  if (droppedTooLong) {
    for (const m of matches) {
      if ((m.end - m.start) > maxOriginalFor(m)) ambiguous.push(m.blockIndex);
    }
  }

  // Sort by start desc and apply.
  filteredMatches.sort((a, b) => b.start - a.start);
  let out = html;
  for (const m of filteredMatches) {
    const unit = anchorable[m.blockIndex];
    const substitution = unit ? unit.replacement : placeholderToken(ns, m.blockIndex);
    out = out.slice(0, m.start) + substitution + out.slice(m.end);
  }

  // Build the structured decision report — same shape regardless of whether
  // we aborted or succeeded, so the studio UI can always render the same
  // "AI placed N/M blocks" widget.
  const finalAnchored = (out.length < docLen * 0.5) ? 0 : matches.length;
  const dedupedMissed = dedupeNumeric(missed);
  const dedupedAmbiguous = dedupeNumeric(ambiguous);

  const sims = decisions.filter((d) => d.source === 'primary' || d.source === 'second-pass').map((d) => d.similarity);
  const confs = decisions.filter((d) => d.source === 'primary' || d.source === 'second-pass').map((d) => d.confidence);
  const min = (a) => a.length ? Math.min(...a) : 0;
  const avg = (a) => a.length ? (a.reduce((s, x) => s + x, 0) / a.length) : 0;

  const report = {
    mailHint: String(mailHint || namespace || ''),
    refBlockCount: refBlocks.length,
    unitCount: anchorable.length,
    varOnlyUnits: allUnits.length - anchorable.length,
    elementCount: elements.length,
    anchored: finalAnchored,
    missed: dedupedMissed.length,
    ambiguous: dedupedAmbiguous.length,
    usedSecondPass,
    decisions,
    stats: {
      similarityMin: min(sims),
      similarityAvg: avg(sims),
      confidenceMin: min(confs),
      confidenceAvg: avg(confs),
    },
  };

  // SAFETY 2: never return a document that's <50% of the original size.
  if (out.length < docLen * 0.5) {
    return {
      html, // unchanged
      anchors: 0,
      missed: anchorable.map((_, i) => i),
      ambiguous: dedupedAmbiguous,
      raw: parsed,
      report,
      aborted: 'output-too-small',
    };
  }

  return {
    html: out,
    anchors: matches.length,
    missed: dedupedMissed,
    ambiguous: dedupedAmbiguous,
    raw: parsed,
    report,
  };
}

function countOccurrences(haystack, needle) {
  if (!needle) return 0;
  let count = 0;
  let i = 0;
  while ((i = haystack.indexOf(needle, i)) !== -1) { count += 1; i += needle.length; }
  return count;
}

function dedupeNumeric(arr) {
  return [...new Set(arr)].sort((a, b) => a - b);
}

// ─── Public: AI fix locale TXT ─────────────────────────────────────────────

/**
 * @param {object} args
 * @param {string} args.txt          The (possibly broken) locale TXT to fix.
 * @param {string} [args.refTxt]     Reference TXT (e.g. EN) — used to align block count.
 * @param {string} [args.language]   Human-friendly language name (e.g. "Urdu").
 * @param {boolean} [args.fillMissingFromReference] Translate source text only for genuinely missing target blocks.
 * @returns {Promise<{ fixedTxt: string, blocks: string[], notes?: string }>}
 */
export async function fixLocaleTxt({
  txt, refTxt, language,
  fillMissingFromReference = false,
  instruction = "",
  allowRestructure = false,
  systemVariableIndexes = [],
  apiKey, model = "gpt-4.1-mini",
  logger,
}) {
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");
  if (!txt) throw new Error("txt is required");

  const currentBlocks = parseTxtBlocks(txt);
  const refBlocks = refTxt ? parseTxtBlocks(refTxt) : null;

  const systemPrompt =
    "You repair a locale TXT for an email-marketing studio. " +
    "Format: every translatable block is wrapped in {{...}}. Inside a block, " +
    "@@text@@ marks bold (must be paired). Blocks are separated by a blank line. " +
    "An empty {{}} block is intentional and must be returned as an empty string in the same position. " +
    "Return EXACTLY one entry per output block in the `blocks` array. Return block CONTENT only: never include the outer {{ and }} delimiters in an array entry. \n" +
    (refBlocks ? `Reference (source) has ${refBlocks.length} blocks; output must have the same count, in the same order. ` : "") +
    (allowRestructure
      ? "The user explicitly requested a structural split. Follow their example exactly, even when that increases the number of blocks. Do not force the old block count. "
      : "") +
    (language ? `The text is in ${language}; preserve it. ` : "") +
    (systemVariableIndexes.length
      ? `Zero-based output positions ${systemVariableIndexes.join(", ")} are system variables: preserve their identifier exactly. Every other position is translatable, even when its source text looks identical to a variable name. `
      : "") +
    "Common fixes you should make: " +
    "1. balance unpaired @@ markers; " +
    "2. recover blocks where the user forgot a closing }}; " +
    "3. trim text that was accidentally placed outside any {{}}; " +
    "4. preserve empty blocks, %%placeholders%%, ${{ ns.key }}$ tokens, <b>/<a>/<br> tags, and HTML entities exactly; " +
    (fillMissingFromReference
      ? "5. align semantically against the reference, not only by index. Preserve every existing target translation. If a reference text block has no target counterpart, translate only that missing source block into the target language; never use an empty filler for a non-empty source block. Do not rephrase existing target blocks. \n"
      : "5. do NOT translate, do NOT rephrase, do NOT add or remove blocks unless the reference forces alignment. \n") +
    "PROJECT CONVENTIONS (mandatory): system variables like {{embedded.company_email}} or " +
    "{{user_name}} (identifier with dot/underscore, no spaces) must NEVER sit inside a text " +
    "block — if you meet one nested in text, split the block around it: " +
    "{{text before}} {{embedded.var}}{{tail}}. A standalone {{embedded.var}} block stays as-is, " +
    "untranslated. A leading 'Subject: ...' line outside blocks is normal and is preserved by the caller. " +
    "When the instruction distinguishes a system variable such as {{days}} from translated words like {{days}} or {{1 day}}, keep each requested item as its own positional block. " +
    "The translated plural word is one word/phrase only; do not copy slash separators such as days/1 day/ into that block.";

  const userPayload = JSON.stringify({
    inputTxt: txt,
    parsedBlocks: currentBlocks,
    refBlocks: refBlocks || undefined,
    fillMissingFromReference,
    userInstruction: instruction || undefined,
    systemVariableIndexes,
  });

  const data = await callOpenAiWithRetry(
    async () => ({
      url: OPENAI_RESPONSES_URL,
      body: {
        model,
        input: [
          { role: "system", content: [{ type: "input_text", text: systemPrompt }] },
          { role: "user",   content: [{ type: "input_text", text: userPayload }] },
        ],
        text: { format: { type: "json_schema", name: "fix_locale_txt", strict: true, schema: BLOCKS_ARRAY_SCHEMA } },
      },
    }),
    { label: "fix-locale-txt", apiKey, logger }
  );

  const responseText = extractResponseText(data);
  if (!responseText) throw new Error("AI returned empty response for fixLocaleTxt");
  const parsed = JSON.parse(responseText);
  let fixedBlocks = (parsed.blocks || []).map((b) => {
    const value = String(b ?? "").trim();
    // Models sometimes return `{{days}}` for a standalone variable even
    // though the schema asks for block content. Strip exactly one wrapper so
    // serialization produces {{days}}, never {{{{days}}}}.
    const wrapped = /^\{\{\s*([^{}]*?)\s*\}\}$/.exec(value);
    return wrapped ? wrapped[1].trim() : value;
  });
  const expectedCount = refBlocks?.length || (allowRestructure ? 0 : currentBlocks.length);
  if (expectedCount > 0) {
    if (fixedBlocks.length < expectedCount) {
      for (let i = fixedBlocks.length; i < expectedCount; i += 1) {
        fixedBlocks.push(currentBlocks[i] ?? "");
      }
    } else if (fixedBlocks.length > expectedCount) {
      fixedBlocks = fixedBlocks.slice(0, expectedCount);
    }
  }
  if (fixedBlocks.some((block) => /\{\{|\}\}/.test(block))) {
    throw new Error("AI returned nested {{ }} delimiters inside a locale block");
  }

  return {
    fixedTxt: serializeAligned(localePrefix(txt), fixedBlocks) + "\n",
    blocks: fixedBlocks,
    notes: parsed.notes,
  };
}

// ─── Public: AI translate locale TXT ───────────────────────────────────────

/**
 * @param {object} args
 * @param {string} args.srcTxt
 * @param {string} args.fromLang
 * @param {string} args.toLang
 * @returns {Promise<{ translatedTxt: string, blocks: string[], skipped: number[] }>}
 */
export async function translateLocaleTxt({
  srcTxt, fromLang, toLang,
  apiKey, model = "gpt-4.1-mini",
  logger,
}) {
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");
  if (!srcTxt) throw new Error("srcTxt is required");
  if (!toLang) throw new Error("toLang is required");

  const srcBlocks = parseTxtBlocks(srcTxt);
  if (!srcBlocks.length) {
    return { translatedTxt: "", blocks: [], skipped: [] };
  }

  const systemPrompt =
    `You are a professional email-marketing translator. Translate from ${fromLang || "auto-detected source"} ` +
    `to ${toLang}. Preserve every: \n` +
    "  • %%placeholder%% (case-sensitive),\n" +
    "  • ${{ ns.key }}$ token,\n" +
    "  • @@bold@@ markers (must remain paired around the same logical phrase),\n" +
    "  • empty strings from empty {{}} blocks,\n" +
    "  • inline HTML tags (<a>, <b>, <br>, <span>) and HTML entities; prefer <b> over <strong>,\n" +
    "  • URLs (do NOT translate them).\n" +
    "Return one translated string per input block, in the same order. Block count MUST match input.\n" +
    "PROJECT CONVENTION: a block that is just a system variable name (embedded.company_email, " +
    "user_name — identifier with dot/underscore) is NOT text: return it VERBATIM untranslated. " +
    "Punctuation-only blocks ('.', '!') — return verbatim or with the locale-appropriate equivalent.";

  const userPayload = JSON.stringify({
    fromLang: fromLang || null,
    toLang,
    blocks: srcBlocks,
  });

  const data = await callOpenAiWithRetry(
    async () => ({
      url: OPENAI_RESPONSES_URL,
      body: {
        model,
        input: [
          { role: "system", content: [{ type: "input_text", text: systemPrompt }] },
          { role: "user",   content: [{ type: "input_text", text: userPayload }] },
        ],
        text: { format: { type: "json_schema", name: "translate_locale_txt", strict: true, schema: BLOCKS_ARRAY_SCHEMA } },
      },
    }),
    { label: `translate-${fromLang || "src"}-to-${toLang}`, apiKey, logger }
  );

  const responseText = extractResponseText(data);
  if (!responseText) throw new Error("AI returned empty response for translateLocaleTxt");
  const parsed = JSON.parse(responseText);
  let translated = (parsed.blocks || []).map((b) => String(b ?? ""));

  const skipped = [];
  // If AI returned wrong count, pad/truncate and mark gaps.
  if (translated.length < srcBlocks.length) {
    for (let i = translated.length; i < srcBlocks.length; i += 1) {
      translated.push(srcBlocks[i]);
      skipped.push(i);
    }
  } else if (translated.length > srcBlocks.length) {
    translated = translated.slice(0, srcBlocks.length);
  }
  // Empty results → fall back to source.
  for (let i = 0; i < translated.length; i += 1) {
    if (!translated[i].trim()) {
      translated[i] = srcBlocks[i];
      skipped.push(i);
    }
  }

  return {
    translatedTxt: serializeTxtBlocks(translated) + "\n",
    blocks: translated,
    skipped: dedupeNumeric(skipped),
  };
}
