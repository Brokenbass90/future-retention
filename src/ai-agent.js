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

import { TOOL_DEFINITIONS, TOOL_HANDLERS, mergeCanvasOps } from "./ai-tools.js";
import { checkCanvasReady, describeLeftovers } from "./canvas-completeness.js";
import { listCanonicalBlocks } from "./compose-email.js";
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
  "  • update_canvas_block                                         — change slots/appearance of a block ON THE CONSTRUCTOR CANVAS",
  "  • add_canvas_block, remove_canvas_block, move_canvas_block    — put a block on the canvas, take one off, reorder",
  "  • clear_canvas                                                — wipe the canvas when the person says 'удали всё, соберём заново'",
  "  • compose_email_from_blocks                                   — build a NEW email from canonical blocks",
  "  • see_email, see_block                                        — LOOK at the email / a block as a picture",
  "  • open_draft, draft_changes, publish_draft, discard_draft     — a PERSONAL COPY of an email; the shared base waits",
  "  • list_drafts, mail_history                                   — what you hold, and what the email looked like before",
  "  • list_mail_files, read_mail_file, write_mail_file            — the SOURCE of the open email: stylus styles, pug templates",
  "  • check_canvas_ready                                          — is the email actually finished, or is sample text still in it",
  "  • finish                                                      — wrap up with a user-facing summary",
  "",
  "Operating principles (this is how the team works):",
  "  1. DISCOVER first: list_namespaces + read_open_html before anything else. Don't ask — look.",
  "  2. PLAN briefly: pick the minimal set of tools that does exactly what was asked. Nothing extra.",
  "  3. ACT with the most precise tool available:",
  "     – a one-block text fix → edit_locale_block, never a full re-translation;",
  "     – a visual tweak (bold, logo, link) → find_in_html then replace_in_html, never regenerate the document;",
  "     – the same URL/image/link/text in the code AND locales (\"во всех локалях\", \"везде\") → find_across_locales, then replace_across_locales (mode='filename' for an image uploaded per locale);",
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
  "    You have FULL control of that canvas and never ask the person to do a step by hand:",
  "      – change what is there ('make the title red', 'fix this text') → update_canvas_block;",
  "      – take a block off → remove_canvas_block (it also removes everything nested inside);",
  "      – empty the email ('удали всё', 'соберём заново') → clear_canvas with confirm: true;",
  "      – put a block in → add_canvas_block; it returns a uid you can fill with",
  "        update_canvas_block in the SAME run, so a block never stays with sample text;",
  "      – reorder → move_canvas_block (one step at a time, among its neighbours).",
  "    NEVER use remove_block / insert_block on the constructor: those are anchor edits of the",
  "    HTML open in the code workbench, they cannot touch the canvas, and asking the person for",
  "    'a unique fragment of the block HTML' is you failing at your own job.",
  "    'Удали всё и собери заново' is one continuous job: clear_canvas, then add_canvas_block",
  "    for each block of the new email, then fill every one of them. Do not stop halfway to",
  "    report progress — the studio applies the whole package at once and one Ctrl+Z undoes it.",
  "    NEVER use edit_locale_block or save_user_block for a constructor request:",
  "    the first edits translation files, the second edits the shared block library, and",
  "    neither changes the email in front of the user. Doing that is a silent no-op and",
  "    corrupts other emails that use the same block.",
  "    Use find_blocks_by_look to search, compose_email_from_blocks to assemble from scratch.",
  "  • CODE (workbench) — the open email HTML plus its locales. Everything above applies.",
  "Never tell the user to 'switch to the other screen' to do something you can do here.",
  "Never ask the user which surface they are on or whether they use the constructor or code — the context line at the end of the message tells you. Asking that is failing at your job.",
  "For pasted HTML (no brand/mail) the open HTML is the email: change styles directly with find_in_html → replace_in_html (replaceAll for a repeated style). Do the edit, then finish — do not explain how it could be done.",
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
  "  6a2. LOOK before you judge. see_email renders the email as a picture, see_block shows a",
  "     library block. Never say how something looks, never call an assembly finished, and never",
  "     discuss design without having looked. Mobile is a separate render — it breaks more often.",
  "  6a2b. Before changing an email that ALREADY EXISTS in the base — open_draft first. Someone",
  "     else may be working on it, and a change written straight into the base cannot be undone by",
  "     them. Work in the copy, show draft_changes to the person, and publish ONLY when they say so.",
  "     If publish is refused because the base moved, show the difference and ask. Never force.",
  "  6a3. To change HOW the email renders — spacing, colours, fonts, the way a block is laid out —",
  "     change its SOURCE: list_mail_files, read_mail_file, write_mail_file. The HTML you read is",
  "     built from those files; editing the built HTML is a change that dies at the next rebuild.",
  "  6b. On the CONSTRUCTOR blocks arrive carrying SAMPLE text ('Заголовок письма', 'Перейти',",
  "     'Короткая подсветка…'). Filling only the body and leaving those is a half-built email:",
  "     the customer sees the sample text in the sent campaign. When a person hands you copy,",
  "     its parts map to the blocks — headline, subtitle, body, the highlighted line, the button",
  "     label. Put them where they belong instead of appending everything as paragraphs.",
  "     Call check_canvas_ready before finish; the studio checks this anyway and will send you back.",
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
const FALLBACK_AGENT_MODEL = "gpt-4.1-mini";

export async function runAgent({ userMessage, history = [], images = [], ctx, apiKey, model = FALLBACK_AGENT_MODEL, maxSteps = DEFAULT_MAX_STEPS, onFrame }) {
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");
  let checkedCanvas = false;
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
    let data;
    try {
      data = await callOpenAiWithRetry(
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
    } catch (error) {
      // A configured model the key cannot use must not kill the operator:
      // fall back once to the always-available default and keep working.
      const message = String(error?.message || error);
      if (step === 0 && model !== FALLBACK_AGENT_MODEL && /model|does not exist|not found|access/i.test(message)) {
        emit({ kind: "text", text: `(модель ${model} недоступна для этого ключа — работаю на ${FALLBACK_AGENT_MODEL})` });
        model = FALLBACK_AGENT_MODEL;
        step -= 1;
        continue;
      }
      throw error;
    }

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
      } else if (item.type === "reasoning") {
        // Reasoning models (gpt-5.x, o-series) require their reasoning item
        // to accompany the function_call it produced in the next request.
        input.push(item);
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
          // Заслон перед «готово» на канвасе.
          //
          // Живой случай: агент разложил присланный английский текст по
          // блокам и отчитался «собрал письмо». В письме остались зелёная
          // подсветка с русским образцовым текстом и кнопка «Перейти» — а
          // последние строки задания как раз и были подсветкой и надписью на
          // кнопке. Просить модель «быть внимательнее» бесполезно: проверка
          // детерминированная, и пока образцовый текст в письме, работа не
          // закончена. Один раз — чтобы не загнать агента в круг.
          if (!checkedCanvas && String(ctx?.surface || "") === "constructor") {
            checkedCanvas = true;
            const canvas = mergeCanvasOps(ctx);
            const verdict = canvas.length
              ? checkCanvasReady({ canvas, blocks: listCanonicalBlocks() })
              : { ready: true, leftovers: [] };
            if (!verdict.ready) {
              input.push({
                type: "function_call_output",
                call_id: item.call_id,
                output: JSON.stringify({
                  ok: false,
                  error: "Ещё не готово.",
                  message: describeLeftovers(verdict),
                  leftovers: verdict.leftovers,
                }).slice(0, 16000),
              });
              emit({ kind: "tool_result", name: "check_canvas_ready", result: { ok: false, leftovers: verdict.leftovers } });
              continue;
            }
          }
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

    // Снимки, сделанные инструментами на этом шаге, показываем модели.
    //
    // Результат инструмента — текст: изображение туда положить нельзя. Поэтому
    // картинка идёт отдельным сообщением от человека, сразу после ответа
    // инструмента. Без этого see_email возвращал бы «снято» и ничего не
    // показывал — то есть врал.
    if (Array.isArray(ctx?.pendingImages) && ctx.pendingImages.length) {
      const shots = ctx.pendingImages.splice(0, ctx.pendingImages.length);
      input.push({
        role: "user",
        content: [
          { type: "input_text", text: `Вот ${shots.length === 1 ? "снимок" : "снимки"}: ${shots.map((shot) => shot.note).join("; ")}. Смотрите на них, а не на описание.` },
          ...shots.map((shot) => ({ type: "input_image", image_url: shot.dataUrl })),
        ],
      });
      emit({ kind: "tool_result", name: "shot", result: { images: shots.map((shot) => shot.note) } });
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
