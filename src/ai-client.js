/**
 * src/ai-client.js — OpenAI API client with retry logic
 *
 * Provides:
 *   - callOpenAiWithRetry()  — universal fetch wrapper (3 attempts, exponential backoff)
 *   - extractResponseText()  — extracts text from OpenAI Responses API output
 *   - makeOpenAiClient()     — factory that returns createDraft/createDiscussion/etc.
 *                              bound to specific apiKey + model + logger
 *
 * Design: all config (apiKey, model, logger) is passed explicitly —
 * no module-level globals, so the module is fully testable and reusable.
 */

import {
  responseSchema,
  translationResponseSchema,
  designAnalysisSchema
} from "./ai-schemas.js";

export { responseSchema, translationResponseSchema, designAnalysisSchema };

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const AI_RETRY_MAX = 3;
const AI_TIMEOUT_MS = 45_000;
const AI_NO_RETRY_CODES = new Set(["invalid_api_key", "billing_hard_limit_reached", "model_not_found"]);

// ─── Core retry wrapper ───────────────────────────────────────────────────────

/**
 * Calls OpenAI with automatic retry on transient errors.
 *
 * @param {Function} buildRequestFn  Async fn → { url, body, headers? }
 * @param {object}   opts
 * @param {string}   opts.label      For logging ("create-draft", "discussion", …)
 * @param {string}   opts.apiKey     OpenAI API key
 * @param {Function} [opts.logger]   Optional fn(entry) for journal logging
 * @returns {Promise<object>} Raw OpenAI API response
 */
export async function callOpenAiWithRetry(buildRequestFn, { label = "ai-call", apiKey, logger } = {}) {
  let lastError;

  for (let attempt = 1; attempt <= AI_RETRY_MAX; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);

    try {
      const { url = OPENAI_RESPONSES_URL, body, headers: extraHeaders = {} } = await buildRequestFn();

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          ...extraHeaders
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      const data = await response.json();

      if (!response.ok) {
        const errMsg = data?.error?.message || `HTTP ${response.status}`;
        const errCode = data?.error?.code || data?.error?.type || "";

        if (logger) {
          try { logger({ level: "error", area: "ai-client", title: `AI error (${label})`, message: errMsg }); } catch { /* non-blocking */ }
        }

        // Fatal errors — no retry
        if (AI_NO_RETRY_CODES.has(errCode) || response.status === 400) {
          throw new Error(errMsg);
        }

        lastError = new Error(errMsg);
        if (attempt < AI_RETRY_MAX) {
          const backoffMs = 1000 * Math.pow(2, attempt - 1);
          console.warn(`[ai] ${label} attempt ${attempt} failed: ${errMsg}. Retry in ${backoffMs}ms`);
          await new Promise((r) => setTimeout(r, backoffMs));
        }
        continue;
      }

      return data;
    } catch (err) {
      clearTimeout(timeoutId);
      const isTimeout = err.name === "AbortError";
      const msg = isTimeout ? `AI timeout after ${AI_TIMEOUT_MS}ms` : err.message;

      if (logger) {
        try { logger({ level: "error", area: "ai-client", title: `AI ${isTimeout ? "timeout" : "error"} (${label}) [${attempt}/${AI_RETRY_MAX}]`, message: msg }); } catch { /* non-blocking */ }
      }

      lastError = new Error(msg);
      if (attempt < AI_RETRY_MAX) {
        const backoffMs = 1000 * Math.pow(2, attempt - 1);
        console.warn(`[ai] ${label} attempt ${attempt}: ${msg}. Retry in ${backoffMs}ms`);
        await new Promise((r) => setTimeout(r, backoffMs));
      }
    }
  }

  throw lastError || new Error(`AI request failed after ${AI_RETRY_MAX} attempts`);
}

// ─── Response text extractor ──────────────────────────────────────────────────

/**
 * Extracts plain text from an OpenAI Responses API response.
 * Handles both flat `output_text` and nested `output[].content[]` shapes.
 *
 * @param {object} apiResponse
 * @returns {string}
 */
export function extractResponseText(apiResponse) {
  if (typeof apiResponse.output_text === "string" && apiResponse.output_text.trim()) {
    return apiResponse.output_text;
  }

  const segments = [];
  for (const item of apiResponse.output || []) {
    if (item.type !== "message") continue;
    for (const content of item.content || []) {
      if (content.type === "output_text" && content.text) {
        segments.push(content.text);
      }
    }
  }
  return segments.join("\n");
}

// ─── Client factory ───────────────────────────────────────────────────────────

/**
 * Creates a bound AI client with pre-configured apiKey, model, and logger.
 * All createXxx() methods accept the same payload + builder function from server.js.
 *
 * @param {{ apiKey: string, model: string, logger?: Function }} config
 */
export function makeOpenAiClient({ apiKey, model, logger }) {
  const opts = { apiKey, logger };

  /**
   * Calls OpenAI and returns parsed JSON from the response.
   * @param {Function} buildRequestFn  Async fn → { body, headers? }
   * @param {string}   label
   * @param {string}   schemaName
   * @param {object}   schema
   */
  async function callStructured(buildRequestFn, label, schemaName, schema) {
    const data = await callOpenAiWithRetry(
      async () => {
        const { body, headers } = await buildRequestFn();
        return {
          body: {
            model,
            ...body,
            text: { format: { type: "json_schema", name: schemaName, strict: true, schema } }
          },
          headers
        };
      },
      { label, ...opts }
    );
    const rawText = extractResponseText(data);
    if (!rawText) throw new Error(`OpenAI ${label} response did not contain output text`);
    return JSON.parse(rawText);
  }

  async function callFreeform(buildRequestFn, label) {
    const data = await callOpenAiWithRetry(
      async () => {
        const { body, headers } = await buildRequestFn();
        return { body: { model, ...body }, headers };
      },
      { label, ...opts }
    );
    return extractResponseText(data);
  }

  return {
    /**
     * Create an email draft (structured output).
     * @param {Function} buildInputFn  Async fn → { input: [...messages] }
     * @returns {Promise<object>}  Parsed JSON matching responseSchema
     */
    async createDraft(buildInputFn) {
      return callStructured(buildInputFn, "create-draft", "email_studio_draft", responseSchema);
    },

    /**
     * Create a discussion reply (freeform text).
     * @param {Function} buildInputFn  Async fn → { input: [...messages] }
     * @returns {Promise<string>}
     */
    async createDiscussion(buildInputFn) {
      return callFreeform(buildInputFn, "discussion");
    },

    /**
     * Analyze a design image (structured output).
     * @param {Function} buildInputFn  Async fn → { input: [...messages] }
     * @returns {Promise<object>}  Parsed JSON matching designAnalysisSchema
     */
    async createDesignAnalysis(buildInputFn) {
      return callStructured(buildInputFn, "design-analysis", "email_studio_design_analysis", designAnalysisSchema);
    },

    /**
     * Generate translations (structured output).
     * @param {Function} buildInputFn  Async fn → { input: [...messages] }
     * @returns {Promise<object>}  Parsed JSON matching translationResponseSchema
     */
    async createTranslations(buildInputFn) {
      return callStructured(buildInputFn, "translations", "email_studio_translations", translationResponseSchema);
    }
  };
}
