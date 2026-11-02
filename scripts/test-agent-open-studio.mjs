// Агент открывает студию сам (через окно связи) и честно слышит, что «Код» не открыт.
import assert from "node:assert/strict";
import fs from "node:fs";
import { codeTabMissingError } from "../src/routes/agent-routes.js";
const routes = fs.readFileSync(new URL("../src/routes/agent-routes.js", import.meta.url), "utf8");
const relayPage = fs.readFileSync(new URL("../public/relay.js", import.meta.url), "utf8");
const mcp = fs.readFileSync(new URL("../mcp/retkit-mcp-server.mjs", import.meta.url), "utf8");

assert.match(codeTabMissingError("https://studio.example"), /retkit_open_studio/);
assert.match(codeTabMissingError("https://studio.example"), /https:\/\/studio\.example/);
assert.match(codeTabMissingError(), /localhost — другая студия/);
assert.match(routes, /NEEDS_OPEN_MAIL\.has\(name\) && !live/, "no silent empty answers without the Code tab");
assert.match(routes, /router\.post\("\/api\/agent\/open-page"/);
assert.match(routes, /callRelay\(token, "open_page"/, "the relay window shows the button");
assert.match(relayPage, /command\.tool === "open_page"[\s\S]*showOpenPage/, "relay window handles open_page itself");
assert.match(relayPage, /window\.open\(url, "retkit-studio"\)/);
assert.match(mcp, /"retkit_open_studio"/);
assert.match(mcp, /publicUrl: PUBLIC_URL/);
console.log("✓ agent can open the studio; clear error without the Code tab");
