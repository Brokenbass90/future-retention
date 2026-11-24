// Мост «Код» → UCC: студия отдаёт userscript'у RetKit UCC Export готовый HTML каждой локали.
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const js = readFileSync(new URL("../public/workbench.js", import.meta.url), "utf8");
const block = js.slice(js.indexOf("(function exposeStudioExport()"));
assert.ok(block.length > 100, "блок моста есть");
assert.match(block, /window\.RetKitStudioExport = \{ info, allLocales \}/, "наружу отдаются info и allLocales");
assert.match(block, /\/api\/wb\/code-html\?brand=/, "письмо из базы — готовый HTML с сервера");
assert.match(block, /applyNamespaceLocale\(html, ns\.name, blocks, false\)/, "HTML с плейсхолдерами — подстановка без служебной обёртки");
assert.match(block, /zh: 'cn', sv: 'se'/, "коды локалей как в UCC");
assert.ok(!/method:\s*'POST'|method:\s*"POST"/.test(block), "студия ничего не пишет");
console.log("✓ studio → UCC: info/allLocales, оба режима «Кода», коды UCC, только чтение");
