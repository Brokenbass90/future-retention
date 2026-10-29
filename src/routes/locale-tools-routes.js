/**
 * src/routes/locale-tools-routes.js — инструменты локалей без ИИ.
 *
 *   POST /api/wb/placeholderize-order — плейсхолдеры по порядку: N-й текст
 *        письма ← N-й блок reference TXT. Счёт не сошёлся — 422 с объяснением,
 *        письмо не меняется (src/placeholder-order.js).
 *   GET  /rtl-core.js — RTL-движок для браузера: тот же email-base/tools/rtl.js,
 *        что у сборки и у расширения RetKit.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { placeholderizeByOrder, PlaceholderOrderError } from "../placeholder-order.js";

export function registerLocaleToolsRoutes(router, { repoRoot, sendJson, sendText, readRequestBody }) {
  router.post("/api/wb/placeholderize-order", async (request, response) => {
    try {
      const { source = "", kind = "pug", refLocaleTxt = "", namespace = "" } = await readRequestBody(request);
      const result = placeholderizeByOrder({ source, kind: kind === "html" ? "html" : "pug", refLocaleTxt, namespace });
      sendJson(response, 200, { ok: true, ...result });
    } catch (error) {
      if (error instanceof PlaceholderOrderError) {
        sendJson(response, 422, { ok: false, refused: true, error: error.message, code: error.code, ...error.details });
      } else {
        sendJson(response, 500, { ok: false, error: String(error?.message || error) });
      }
    }
  });

  router.get("/rtl-core.js", async (request, response) => {
    try {
      const body = (await readFile(path.join(repoRoot, "email-base", "tools", "rtl.js"), "utf8"))
        .replace(/^\s*'use strict';\s*$/m, "");
      const out = "// served from email-base/tools/rtl.js\n(function (root) {\n  'use strict';\n  const module = { exports: {} };\n"
        + body + "\n  root.RetKitRtlCore = module.exports;\n})(typeof globalThis !== 'undefined' ? globalThis : this);\n";
      response.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store" });
      response.end(out);
    } catch {
      sendText(response, 404, "Not found");
    }
  });
}
