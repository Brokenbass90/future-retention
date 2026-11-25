// retkit_list_mails читает тот же ответ, что отдаёт /api/wb/emails.
import assert from "node:assert/strict";
import fs from "node:fs";
const mcp = fs.readFileSync(new URL("../mcp/retkit-mcp-server.mjs", import.meta.url), "utf8");
const server = fs.readFileSync(new URL("../server.js", import.meta.url), "utf8");
const route = server.slice(server.indexOf('request.url === "/api/wb/emails"'), server.indexOf('request.url.startsWith("/api/wb/email?")'));
assert.match(route, /emails: visibleEmailBaseGroups\(/, "studio answers with an `emails` array");
const tool = mcp.slice(mcp.indexOf('"retkit_list_mails"'), mcp.indexOf("Код самой студии"));
assert.match(tool, /data\?\.emails/, "the MCP tool reads `emails`, not a missing field");
console.log("✓ retkit_list_mails matches /api/wb/emails");
