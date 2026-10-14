// Студия по ссылке: личный ключ, подпись, и живой MCP через Streamable HTTP —
// так, как к ней приходит Claude («свой коннектор») или Codex («Add server»).
import { spawn } from "node:child_process";
import path from "node:path";
import url from "node:url";
import { makeMcpKey, verifyMcpKey, mcpKeyFromUrl, publicOrigin, mcpLinkSecret } from "../src/mcp-link.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const root = path.join(path.dirname(url.fileURLToPath(import.meta.url)), "..");
let failed = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : ` ${detail}`}`); if (!ok) failed += 1; };

const token = "0123456789abcdef0123456789abcdef";
const key = makeMcpKey(token, "s1");
check("ключ — метка + подпись", /^[0-9a-f]{48}$/.test(key) && key.startsWith(token));
check("ключ проверяется", verifyMcpKey(key, "s1") === token);
check("чужой секрет не подходит", verifyMcpKey(key, "s2") === null);
check("подделка не подходит", verifyMcpKey(token + "0".repeat(16), "s1") === null);
check("путь /mcp/<ключ>", mcpKeyFromUrl(`/mcp/${key}`) === key && mcpKeyFromUrl(`/mcp/${key}/`) === key);
check("чужой путь не ключ", mcpKeyFromUrl(`/mcp/${key}/x`) === null && mcpKeyFromUrl("/mcp/abc") === null);
check("секрет переживает перезапуск", mcpLinkSecret({ APP_AUTH_USER: "u", APP_AUTH_PASSWORD: "p" }) === mcpLinkSecret({ APP_AUTH_USER: "u", APP_AUTH_PASSWORD: "p" }));
check("за прокси Heroku — https", publicOrigin({ headers: { host: "x.herokuapp.com", "x-forwarded-proto": "https" } }) === "https://x.herokuapp.com");

const port = 3900 + Math.floor(Math.random() * 90);
const env = { ...process.env, PORT: String(port), APP_AUTH_USER: "u", APP_AUTH_PASSWORD: "p" };
const child = spawn(process.execPath, ["server.js"], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
const base = `http://127.0.0.1:${port}`;
const AUTH = { authorization: "Basic " + Buffer.from("u:p").toString("base64") };
try {
  let up = false;
  for (let i = 0; i < 60 && !up; i += 1) {
    await new Promise((r) => setTimeout(r, 500));
    up = await fetch(`${base}/healthz`).then((r) => r.ok).catch(() => false);
  }
  check("студия поднялась", up);
  const r = await fetch(`${base}/api/mcp/link`, { headers: AUTH });
  const link = await r.json();
  check("студия выдаёт ссылку", link.ok && link.url.startsWith(`${base}/mcp/`), JSON.stringify(link));
  const forged = await fetch(link.url.slice(0, -1) + (link.url.endsWith("0") ? "1" : "0"), { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  check("поддельная ссылка не пускает", forged.status === 404);
  check("OAuth не требуется", (await fetch(`${base}/.well-known/oauth-protected-resource`)).status === 404);
  const client = new Client({ name: "test-mcp-link", version: "1" });
  await client.connect(new StreamableHTTPClientTransport(new URL(link.url)));
  const { tools } = await client.listTools();
  check("по ссылке весь набор студии", tools.length >= 19 && tools.some((t) => t.name === "retkit_list_blocks"), String(tools.length));
  const res = await client.callTool({ name: "retkit_list_blocks", arguments: { kit: "system", limit: 2 } });
  check("инструмент работает за паролем студии", /"blocks"/.test(res.content?.[0]?.text || ""), res.content?.[0]?.text);
  const cookie = (r.headers.get("set-cookie") || "").split(";")[0];
  // Связь с RetKit в MoEngage: окно связи (здесь — имитация) опрашивает студию
  // с cookie человека, агент зовёт moengage_* по той же ссылке.
  const offline = await client.callTool({ name: "moengage_status", arguments: {} });
  check("без окна связи агент получает понятный отказ", offline.isError && /не на связи/.test(offline.content?.[0]?.text || ""), JSON.stringify(offline));
  let polls = 0;
  const fakeRelay = (async () => {
    for (let i = 0; i < 6; i += 1) {
      const p = await (await fetch(`${base}/api/relay/poll`, { method: "POST", headers: { ...AUTH, cookie, "content-type": "application/json" },
        body: JSON.stringify({ status: { workspaceOpen: true, locale: "EN" } }) })).json();
      polls += 1;
      if (p.command) {
        await fetch(`${base}/api/relay/result`, { method: "POST", headers: { ...AUTH, cookie, "content-type": "application/json" },
          body: JSON.stringify({ id: p.command.id, ok: true, result: { echo: p.command.tool, locale: "EN" } }) });
        return p.command.tool;
      }
    }
    return null;
  })();
  await new Promise((r) => setTimeout(r, 300));
  const online = await client.callTool({ name: "moengage_status", arguments: {} });
  check("команда агента дошла до RetKit и вернулась", /"echo": "status"/.test(online.content?.[0]?.text || ""), JSON.stringify(online));
  check("окно связи получило именно эту команду", (await fakeRelay) === "status");
  // Холст конструктора: вкладка (имитация) опрашивает канал constructor.
  const canvas = [
    { uid: "o1", blockId: "sys-outer", parentUid: null, slotId: "root", slots: {} },
    { uid: "s1", blockId: "sys-section", parentUid: "o1", slotId: "sections", slots: {} },
    { uid: "b1", blockId: "sys-button", parentUid: "s1", slotId: "content", slots: { label: "Перейти" } },
  ];
  const seen = [];
  let stopTab = false;
  const fakeTab = (async () => {
    while (!stopTab) { try {
      const p = await (await fetch(`${base}/api/relay/poll`, { method: "POST", headers: { ...AUTH, cookie, "content-type": "application/json" },
        body: JSON.stringify({ channel: "constructor", status: {} }) })).json();
      if (!p.command) continue;
      seen.push(p.command.tool);
      if (p.command.tool === "to_code") {
        // Вкладка, ещё висевшая на связи, тоже может получить переход.
        setTimeout(() => fetch(`${base}/api/relay/poll`, { method: "POST", headers: { ...AUTH, cookie, "content-type": "application/json" },
          body: JSON.stringify({ channel: "workbench", status: { mail: "mail-x" } }) }).catch(() => {}), 1500);
      }
      const result = p.command.tool === "canvas_read" ? { canvas, mailName: "test" } : { applied: true, problems: [], ops: p.command.args.ops };
      await fetch(`${base}/api/relay/result`, { method: "POST", headers: { ...AUTH, cookie, "content-type": "application/json" },
        body: JSON.stringify({ channel: "constructor", id: p.command.id, ok: true, result }) });
    } catch { return; } }
  })();
  await new Promise((r) => setTimeout(r, 300));
  const toolsNow = (await client.listTools()).tools.map((t) => t.name);
  check("инструменты холста есть у агента", toolsNow.includes("retkit_read_canvas") && toolsNow.includes("retkit_remove_canvas_block"), toolsNow.join(","));
  const readCanvas = await client.callTool({ name: "retkit_read_canvas", arguments: {} });
  check("агент видит холст", /sys-button/.test(readCanvas.content?.[0]?.text || ""), JSON.stringify(readCanvas).slice(0, 300));
  const removed = await client.callTool({ name: "retkit_remove_canvas_block", arguments: { uid: "b1" } });
  check("удаление кнопки дошло до вкладки", !removed.isError && seen.includes("canvas_apply") && /remove/.test(removed.content?.[0]?.text || ""), JSON.stringify(removed).slice(0, 400));
  stopTab = true;
  fakeTab.catch(() => {});
  // Вкладка «Код»: агент переводит сам и пишет локаль целиком.
  const wbSeen = [];
  let stopWb = false;
  const fakeWb = (async () => {
    while (!stopWb) { try {
      const p = await (await fetch(`${base}/api/relay/poll`, { method: "POST", headers: { ...AUTH, cookie, "content-type": "application/json" },
        body: JSON.stringify({ channel: "workbench", status: {} }) })).json();
      if (!p.command) continue;
      wbSeen.push(p.command);
      const result = p.command.tool === "wb_context"
        ? { html: "<html><body>${{ ns.block_00 }}$</body></html>", brand: "X_IQ", mail: "mail-test", activeNamespaceName: "ns", activeLocale: "en",
            namespaces: [{ id: "n1", name: "ns", namespace: "ns", referenceLocale: "en", locales: { en: ["Hello", "Bye"] }, localeRaw: {} }] }
        : { offered: 1 };
      await fetch(`${base}/api/relay/result`, { method: "POST", headers: { ...AUTH, cookie, "content-type": "application/json" },
        body: JSON.stringify({ channel: "workbench", id: p.command.id, ok: true, result }) });
    } catch { return; } }
  })();
  await new Promise((r) => setTimeout(r, 300));
  const blocksRead = await client.callTool({ name: "retkit_get_namespace_blocks", arguments: { namespace: "ns", locale: "en" } });
  check("агент видит локали открытого письма", /Hello/.test(blocksRead.content?.[0]?.text || ""), JSON.stringify(blocksRead).slice(0, 300));
  const wrote = await client.callTool({ name: "retkit_set_locale_blocks", arguments: { namespace: "ns", locale: "es", blocks: ["Hola", "Adiós"] } });
  const applyCmd = wbSeen.find((c) => c.tool === "wb_apply");
  check("перевод агента пришёл во вкладку «Код» на применение", Boolean(applyCmd) && /Hola/.test(JSON.stringify(applyCmd.args.localeUpdates)) && /Применено во вкладке/.test(wrote.content?.[0]?.text || ""), JSON.stringify(wrote).slice(0, 400));
  stopWb = true;
  fakeWb.catch(() => {});
  // Переход «→ В код» по просьбе агента: конструктор получает to_code,
  // затем новая вкладка «Код» выходит на связь.
  let navStop = false;
  const fakeCons = (async () => {
    while (!navStop) { try {
      const p = await (await fetch(`${base}/api/relay/poll`, { method: "POST", headers: { ...AUTH, cookie, "content-type": "application/json" },
        body: JSON.stringify({ channel: "constructor", status: {} }) })).json();
      if (!p.command) continue;
      await fetch(`${base}/api/relay/result`, { method: "POST", headers: { ...AUTH, cookie, "content-type": "application/json" },
        body: JSON.stringify({ channel: "constructor", id: p.command.id, ok: p.command.tool === "to_code", result: { started: true } }) });
      if (p.command.tool === "to_code") {
        setTimeout(() => fetch(`${base}/api/relay/poll`, { method: "POST", headers: { ...AUTH, cookie, "content-type": "application/json" },
          body: JSON.stringify({ channel: "workbench", status: { mail: "mail-x" } }) }).catch(() => {}), 1500);
        return;
      }
    } catch { return; } }
  })();
  await new Promise((r) => setTimeout(r, 300));
  const nav = await client.callTool({ name: "retkit_open_in_code", arguments: {} });
  check("агент сам переводит письмо в «Код»", !nav.isError && /Код/.test(nav.content?.[0]?.text || ""), JSON.stringify(nav).slice(0, 300));
  navStop = true;
  const viaCall = await client.callTool({ name: "retkit_call", arguments: { tool: "list" } });
  check("retkit_call видит свежий список инструментов", /set_locale_blocks/.test(viaCall.content?.[0]?.text || ""));
  await client.close();
  const again = await (await fetch(`${base}/api/mcp/link`, { headers: { ...AUTH, cookie } })).json();
  check("студия видит, что агент заходил", Boolean(again.lastSeenAt) && again.lastClient.startsWith("test-mcp-link"), JSON.stringify(again));
} catch (error) {
  check("без исключений", false, error.stack);
} finally {
  child.kill();
}
if (failed) { console.log(`${failed} failed`); process.exit(1); }
console.log("mcp-link: all passed");
