const DEFAULT_TIMEOUT_MS = 180_000;

function cleanBaseUrl(value) {
  const normalized = String(value || "http://127.0.0.1:11434").trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(normalized)) {
    throw new Error("OLLAMA_BASE_URL must use http:// or https://");
  }
  return normalized;
}

function dataUrlImage(value) {
  const match = String(value || "").match(/^data:image\/[a-z0-9.+-]+;base64,([a-z0-9+/=\s]+)$/i);
  return match ? match[1].replace(/\s+/g, "") : "";
}

/** Convert OpenAI Responses-style input into Ollama native chat messages. */
export function toOllamaMessages(input = []) {
  return (Array.isArray(input) ? input : []).map((item) => {
    const parts = Array.isArray(item?.content) ? item.content : [item?.content];
    const text = [];
    const images = [];

    for (const part of parts) {
      if (typeof part === "string") {
        if (part.trim()) text.push(part);
        continue;
      }
      if (part?.type === "input_text" || part?.type === "text") {
        if (String(part.text || "").trim()) text.push(String(part.text));
        continue;
      }
      if (part?.type === "input_image" || part?.type === "image_url") {
        const image = dataUrlImage(part.image_url || part?.image_url?.url || part.url);
        if (image) images.push(image);
        else text.push("[Изображение доступно только по внешней ссылке и не передано локальной модели]");
      }
    }

    const role = item?.role === "developer" ? "system" : String(item?.role || "user");
    return {
      role: ["system", "user", "assistant", "tool"].includes(role) ? role : "user",
      content: text.join("\n").trim(),
      ...(images.length ? { images } : {}),
    };
  }).filter((message) => message.content || message.images?.length);
}

/**
 * Call Ollama's native /api/chat endpoint. Supplying a JSON schema in `format`
 * enables structured output on models that support it; otherwise it is a
 * regular local chat request.
 */
export async function callOllamaChat({
  baseUrl,
  model,
  input,
  format,
  label = "ollama-chat",
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetchImpl = globalThis.fetch,
}) {
  if (!String(model || "").trim()) throw new Error("OLLAMA_MODEL is not configured");
  if (typeof fetchImpl !== "function") throw new Error("fetch is unavailable");

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetchImpl(`${cleanBaseUrl(baseUrl)}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: String(model).trim(),
        messages: toOllamaMessages(input),
        stream: false,
        ...(format ? { format } : {}),
        options: { temperature: 0 },
      }),
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") throw new Error(`${label} timed out after ${timeoutMs}ms`);
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Ollama ${label} failed (${response.status}): ${String(data?.error || response.statusText || "request failed").slice(0, 240)}`);
  }
  const text = String(data?.message?.content || "").trim();
  if (!text) throw new Error(`Ollama ${label} returned no text`);

  return {
    text,
    usage: {
      input_tokens: Number(data?.prompt_eval_count || 0),
      output_tokens: Number(data?.eval_count || 0),
      total_tokens: Number(data?.prompt_eval_count || 0) + Number(data?.eval_count || 0),
    },
    raw: data,
  };
}
