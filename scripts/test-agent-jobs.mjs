// Heroku рвёт запросы длиннее 30 с: долгая ручка агента отвечает pending+job,
// итог забирается через /api/agent/job.
import assert from "node:assert/strict";
import { registerAgentRoutes } from "../src/routes/agent-routes.js";

const routes = {};
const router = { get: (p, h) => { routes[`GET ${p}`] = h; }, post: (p, h) => { routes[`POST ${p}`] = h; }, prefix() {} };
const sent = [];
const sendJson = (res, status, body) => { sent.push({ res, status, body }); };
let release;
const slowBody = new Promise((r) => { release = r; });
registerAgentRoutes(router, { repoRoot: process.cwd(), sendJson, readRequestBody: () => slowBody, isReadOnly: () => false, apiKey: () => "", responseBudgetMs: 50 });

const res = {};
const running = routes["POST /api/agent/open-mail"]({ url: "/api/agent/open-mail", headers: {} }, res, {});
await new Promise((r) => setTimeout(r, 120));
assert.equal(sent.length, 1);
assert.equal(sent[0].body.result.pending, true);
const job = sent[0].body.result.job;
assert.ok(job);

routes["GET /api/agent/job"]({ url: `/api/agent/job?id=${job}` }, {}, {});
assert.equal(sent[1].body.result.pending, true, "still running");

release({});            // brand/mail missing → handler answers with an error into the job
await running;
routes["GET /api/agent/job"]({ url: `/api/agent/job?id=${job}` }, {}, {});
assert.equal(sent[2].body.ok, false);
assert.match(sent[2].body.error, /brand и mail/);
assert.equal(sent.filter((e) => e.res === res).length, 1, "the original response is written once");
console.log("✓ long agent calls return pending + job under the Heroku limit");
