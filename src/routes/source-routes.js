/**
 * src/routes/source-routes.js — код студии наружу, только на чтение.
 *
 * Нужно агенту, подключённому из Claude Desktop: файлов студии он не видит
 * и на вопрос «почему превью пустое» ответить ничем, кроме догадки, не может.
 * Claude Code, открытый в папке студии, читает код сам — ему эти ручки не
 * нужны, и это нормально: они не мешают.
 *
 * Правки кода сюда не едут. Менять исходники студии по сети, без git, без
 * отката и мимо глаз человека — это не помощь, а способ однажды потерять
 * день работы. Для правок есть Claude Code в папке студии.
 */
import { readSource, searchSource, listSource, SourceAccessError } from "../source-reader.js";

/**
 * @param {object} deps
 * @param {string} deps.repoRoot
 * @param {Function} deps.sendJson
 */
export function registerSourceRoutes(router, deps) {
  const { repoRoot, sendJson } = deps;

  const answer = (response, work) => {
    try {
      sendJson(response, 200, { ok: true, ...work() });
    } catch (error) {
      const refused = error instanceof SourceAccessError;
      sendJson(response, refused ? 400 : 500, { ok: false, error: error.message });
    }
  };

  router.prefix("GET", "/api/source/read", (request, response, { query }) => answer(response, () => readSource(repoRoot, {
    file: query.get("file") || "",
    from: Number(query.get("from")) || 1,
    lines: Number(query.get("lines")) || 400,
  })));

  router.prefix("GET", "/api/source/search", (request, response, { query }) => answer(response, () => searchSource(repoRoot, {
    query: query.get("q") || "",
    glob: query.get("in") || "",
    limit: Number(query.get("limit")) || 60,
  })));

  router.prefix("GET", "/api/source/list", (request, response, { query }) => answer(response, () => listSource(repoRoot, {
    dir: query.get("dir") || "src",
  })));

  return router;
}
