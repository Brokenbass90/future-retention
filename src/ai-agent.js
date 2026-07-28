/**
 * src/ai-agent.js — tool-use agent loop for the email-studio.
 *
 * Unlike the existing intent-classifier path (one regex → one tool call →
 * one reply), this agent runs a real multi-turn loop:
 *
 *     ┌─────────────────────────────────────────────────────────┐
 *     │  1. send tools + history + system prompt to model        │
 *     │  2. model returns either:                                │
 *     │       a) one or more tool_call(s)                        │
 *     │       b) a plain text reply                              │
 *     │  3. if tool_call: execute via TOOL_HANDLERS, feed result │
 *     │     back into history as a tool_result, loop to 1        │
 *     │  4. if text reply OR `finish` tool was called: stop      │
 *     └─────────────────────────────────────────────────────────┘
 *
 * Each step is streamed back to the caller as NDJSON frames so the
 * workbench chat can render "🔧 placeholderize_html → 38/41 anchored"
 * progressively. The agent decides on its own which tools to call and
 * in what order — no Russian/English regex classifier in the way.
 */

import { TOOL_DEFINITIONS, TOOL_HANDLERS } from "./ai-tools.js";
import { callOpenAiWithRetry, extractResponseText } from "./ai-client.js";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const DEFAULT_MAX_STEPS = 12;

function composedResult(ctx) {
  const brand = String(ctx?.composedBrand || "").trim();
  const mailName = String(ctx?.composedMailName || "").trim();
  return brand && mailName ? { brand, mailName } : null;
}

const SYSTEM_PROMPT = [
  "You are the retention-team-in-a-box of this email studio: copywriter, localizer,",
  "and email developer in one autonomous agent. The studio is used by three kinds of",
  "people — someone with zero markup knowledge, someone who knows a little, and a pro.",
  "They all describe tasks in plain human language; YOU translate intent into precise",
  "tool calls. Never ask them to do something technical you can do yourself with a tool.",
  "",
  "What you can see and touch:",
  "  • the email HTML open in the editor (read_open_html / find_in_html)",
  "  • every locale namespace + its translation blocks (list_namespaces / get_namespace_blocks)",
  "  • the canonical block library for building new emails (list_canonical_blocks)",
  "  • how every block LOOKS: each one has a rendered preview and a visual signature —",
  "    size, palette, whether it has images / buttons / lists / columns, how much text,",
  "    whether it reflows on mobile (find_blocks_by_look). Blocks that look identical are",
  "    grouped, so a search returns variety instead of forty near-identical text blocks.",
  "  • screenshots the user attaches in chat — use them to understand the desired layout,",
  "    spot which block/section they mean, and verify the email matches the design.",
  "",
  "Available tools:",
  "  • read_open_html, list_namespaces, get_namespace_blocks, find_in_html — discovery (cheap, offline)",
  "  • analyze_email                                               — structural HTML↔locale report (offline, fast)",
  "  • validate_html                                               — find unclosed tags / unbalanced {{ }} / broken \${{ }}\$ / odd @@ (offline)",
  "  • compare_locales                                             — cross-check ALL locales vs reference (offline): block counts, missing {{vars}}, @@bold@@, empty/untranslated blocks",
  "  • align_locales_to_reference                                  — RE-STRUCTURE all locales to the reference (same block count/order) so placeholders land right (offline, deterministic)",
  "  • placeholderize_html, fix_locale_txt, translate_locale_txt   — AI actions (cost tokens)",
  "  • create_locale, delete_locale, edit_locale_block             — locale CRUD (offline; deletes need user confirm)",
  "  • normalize_locale_conventions                                — deterministic conventions repair (offline)",
  "  • replace_in_html                                             — surgical HTML edit (bold a phrase, swap a logo URL, fix a link)",
  "  • list_email_sections, insert_block, remove_block            — add / remove a block in the OPEN email (anchor-based, safe)",
  "  • find_blocks_by_look                                         — find a block by HOW IT LOOKS: attached screenshot, colour, structure (offline, fast)",
  "  • update_canvas_block                                         — change slots/appearance of a block ON THE CONSTRUCTOR CANVAS (the only way to edit the email being assembled)",
  "  • compose_email_from_blocks                                   — build a NEW email from canonical blocks",
  "  • finish                                                      — wrap up with a user-facing summary",
  "",
  "Operating principles (this is how the team works):",
  "  1. DISCOVER first: list_namespaces + read_open_html before anything else. Don't ask — look.",
  "  2. PLAN briefly: pick the minimal set of tools that does exactly what was asked. Nothing extra.",
  "  3. ACT with the most precise tool available:",
  "     – a one-block text fix → edit_locale_block, never a full re-translation;",
  "     – a visual tweak (bold, logo, link) → find_in_html then replace_in_html, never regenerate the document;",
  "     – add a block to the open email → find_in_html to locate the spot, then insert_block (anchor + before/after);",
  "     – remove a block from the open email → find_in_html for its unique markup, then remove_block;",
  "     – a new locale → create_locale (it translates from the reference);",
  "     – 'сверь/сравни все локали' → compare_locales (then summarise the drift per locale);",
  "     – a whole new email → compose_email_from_blocks ONLY — never write raw HTML/Pug from scratch.",
  "       If that tool reports an existing mail, NEVER retry with force unless the user",
  "       explicitly asked to overwrite it or confirmed replacement.",
  "     – 'найди похожий блок' / a screenshot of a section → LOOK at the image, describe it to",
  "       yourself (background colour, is there a picture, a button, a list, how many columns,",
  "       roughly how tall), then call find_blocks_by_look with those structural filters.",
  "       Do NOT call list_canonical_blocks and eyeball names — names do not describe looks.",
  "",
  "You work on TWO surfaces of the same studio and you are the SAME operator on both:",
  "  • CONSTRUCTOR — the visual builder. ctx.surface === 'constructor' and the user message",
  "    carries the current block tree with every uid and its slot values.",
  "    To CHANGE something already on the canvas ('move the button left', 'make the title",
  "    red', 'fix this text') call update_canvas_block with that uid — it is the ONLY tool",
  "    that touches the email being assembled.",
  "    NEVER use edit_locale_block or save_user_block for a constructor request:",
  "    the first edits translation files, the second edits the shared block library, and",
  "    neither changes the email in front of the user. Doing that is a silent no-op and",
  "    corrupts other emails that use the same block.",
  "    Use find_blocks_by_look to search, compose_email_from_blocks to assemble from scratch.",
  "  • CODE (workbench) — the open email HTML plus its locales. Everything above applies.",
  "Never tell the user to 'switch to the other screen' to do something you can do here.",
  "  4. VERIFY after every mutation — this is mandatory, not optional:",
  "     – after edit_locale_block / fix / translate → re-read the blocks (get_namespace_blocks) or run analyze_email;",
  "     – after replace_in_html → find_in_html to confirm the new text is in place (and the old one is gone);",
  "     – before placeholderize_html → analyze_email; if >20% orphans, STOP and report the drift instead of applying.",
  "  4a. When locales have drifted (different block counts/order) → align_locales_to_reference FIRST, then placeholderize.",
  "      'сверь с английской и приведи к единому виду' = align_locales_to_reference (not just compare).",
  "  5. If a tool returns an error, read it — errors are instructions (e.g. 'extend the search string'). Retry smarter, max twice.",
  "  6. Locale TXT is sacred text: preserve {{Var}} placeholders, @@bold@@ markers, and inline HTML in every edit.",
  "     Never put literal ${{ ns.block_NN }}$ tokens inside locale TXT — those live in the HTML only.",
  "  6a. PROJECT CONVENTIONS for locale TXT:",
  "     – {{embedded.*}} / {{user_name}}-style tokens (identifier with dot/underscore) are PLATFORM",
  "       variables: never translate them, never keep them inside a text block. They stay literal",
  "       in the HTML. If analysis shows nested variables or unbalanced braces — call",
  "       normalize_locale_conventions FIRST (it splits blocks deterministically), then proceed.",
  "     – A 'Subject: ...' line outside blocks is normal (used by the admin panel) — not an error.",
  "     – @@bold@@ in a block mirrors <b>/<strong> in the HTML: when fixing locales you may add @@",
  "       where the markup is bold and the reference block has it.",
  "  7. When done, call `finish`: summary in the user's language (Russian if they wrote Russian),",
  "     written for a non-technical person: what changed, in which locales, what they should check.",
  "     Mention the verification you did ('проверил: блок 2 в RU теперь …'). Locale updates and",
  "     HTML edits are applied by the studio AFTER the user clicks apply — say so when relevant.",
  "",
  "Be concise. Reference real numbers from tool results, not vague claims.",
].join("\n");

/**
 * Run the agent loop until the model calls `finish` or runs out of steps.
 *
 * @param {object} opts
 * @param {string} opts.userMessage      The user's last message.
 * @param {Array}  [opts.history]        Prior chat messages (role + content strings).
 * @param {object} opts.ctx              Per-request state (see ai-tools.js handler signature).
 * @param {string} opts.apiKey           OpenAI API key (ctx will also receive it).
 * @param {string} [opts.model]          Default "gpt-4.1-mini".
 * @param {number} [opts.maxSteps]       Default 8.
 * @param {Function} [opts.onFrame]      Streaming callback invoked per agent step:
 *                                       { kind: 'tool_call'|'tool_result'|'text'|'finish'|'error', ... }
 * @returns {Promise<{ summary, modifiedHtml, localeUpdates, localeDeletes, composed, steps }>}
 */
export async function runAgent({ userMessage, history = [], images = [], ctx, apiKey, model = "gpt-4.1-mini", maxSteps = DEFAULT_MAX_STEPS, onFrame }) {
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");
  if (!userMessage || typeof userMessage !== "string") throw new Error("userMessage is required");

  ctx.apiKey = apiKey;
  ctx.model = model;
  ctx.pendingLocaleUpdates = ctx.pendingLocaleUpdates || [];
  ctx.pendingLocaleDeletes = ctx.pendingLocaleDeletes || [];

  // Build the initial input. The Responses API takes an `input` array
  // mixing role-based messages with tool-call results.
  const input = [
    { role: "system", content: [{ type: "input_text", text: SYSTEM_PROMPT }] },
  ];
  // Prior chat history (compact).
  for (const m of history.slice(-6)) {
    if (!m || !m.content) continue;
    input.push({
      role: m.role === "assistant" ? "assistant" : "user",
      content: [{ type: m.role === "assistant" ? "output_text" : "input_text", text: String(m.content).slice(0, 4000) }],
    });
  }
  // Final user turn — text plus any attached screenshots (vision).
  const userContent = [{ type: "input_text", text: userMessage }];
  if (Array.isArray(images)) {
    for (const img of images.slice(0, 4)) {
      const url = typeof img === "string" ? img : (img && img.dataUrl) || "";
      if (url && /^data:image\/|^https?:\/\//.test(url)) {
        userContent.push({ type: "input_image", image_url: url });
      }
    }
  }
  input.push({ role: "user", content: userContent });

  let finalResult = null;
  const steps = [];
  const emit = (frame) => {
    steps.push(frame);
    if (onFrame) {
      try { onFrame(frame); } catch { /* ignore */ }
    }
  };

  for (let step = 0; step < maxSteps; step += 1) {
    const data = await callOpenAiWithRetry(
      async () => ({
        url: OPENAI_RESPONSES_URL,
        body: {
          model,
          input,
          tools: TOOL_DEFINITIONS,
          tool_choice: "auto",
        },
      }),
      { label: `agent-step-${step}`, apiKey }
    );

    // Walk the `output` array. Items can be:
    //   - { type: "message", content: [{ type: "output_text", text }, ...] }
    //   - { type: "function_call", call_id, name, arguments } (string JSON)
    const items = Array.isArray(data?.output) ? data.output : [];
    let producedToolCall = false;
    let producedFinish = false;
    let lastText = "";

    for (const item of items) {
      if (item.type === "message") {
        for (const c of item.content || []) {
          if (c.type === "output_text" && c.text) {
            lastText += c.text + "\n";
          }
        }
        // Preserve the model's own message in the conversation, so its
        // chain-of-thought-y answer informs the next turn.
        if (item.content?.length) {
          input.push({ role: "assistant", content: item.content });
        }
      } else if (item.type === "function_call") {
        producedToolCall = true;
        const name = item.name;
        let args = {};
        try { args = JSON.parse(item.arguments || "{}"); } catch { args = { _parseError: item.arguments }; }
        emit({ kind: "tool_call", name, args });

        const handler = TOOL_HANDLERS[name];
        let result;
        if (!handler) {
          result = { error: `unknown tool: ${name}` };
        } else {
          try {
            result = await handler(args, ctx);
          } catch (err) {
            result = { error: String(err && err.message ? err.message : err) };
          }
        }
        emit({ kind: "tool_result", name, result });

        // Echo the tool call + result back into the input for the next turn.
        // Responses API expects function_call items as-is, plus a
        // function_call_output with the matching call_id.
        input.push(item);
        input.push({
          type: "function_call_output",
          call_id: item.call_id,
          output: JSON.stringify(result).slice(0, 16000),
        });

        if (name === "finish") {
          producedFinish = true;
          finalResult = {
            summary: String(args.summary || "").trim(),
            // Prefer ctx.modifiedHtml (computed by placeholderize) over what
            // the model may have echoed; ctx is authoritative.
            modifiedHtml: ctx.modifiedHtml || args.modifiedHtml || "",
            localeUpdates: ctx.pendingLocaleUpdates.length
              ? ctx.pendingLocaleUpdates
              : (Array.isArray(args.localeUpdates) ? args.localeUpdates : []),
            localeDeletes: ctx.pendingLocaleDeletes,
            composed: composedResult(ctx),
          };
          emit({ kind: "finish", payload: finalResult });
          break;
        }
      }
    }

    if (producedFinish) break;

    // If the model produced ONLY text (no tool_call), treat as a regular
    // chat reply and stop the loop.
    if (!producedToolCall) {
      emit({ kind: "text", text: lastText.trim() });
      finalResult = {
        summary: lastText.trim(),
        modifiedHtml: ctx.modifiedHtml || "",
        localeUpdates: ctx.pendingLocaleUpdates,
        localeDeletes: ctx.pendingLocaleDeletes,
        composed: composedResult(ctx),
      };
      break;
    }
  }

  if (!finalResult) {
    emit({ kind: "error", message: `agent exceeded ${maxSteps} steps without finishing` });
    finalResult = {
      summary: `Достиг предела ${maxSteps} шагов без завершения. Уточни запрос.`,
      modifiedHtml: ctx.modifiedHtml || "",
      localeUpdates: ctx.pendingLocaleUpdates,
      localeDeletes: ctx.pendingLocaleDeletes,
      composed: composedResult(ctx),
    };
  }

  return { ...finalResult, steps };
}
