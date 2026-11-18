import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { classifyLocaleChatPolicy } from "../src/locale-chat-policy.js";

const auditCases = [
  "Сравни локали, какая собрана некорректно?",
  "ID локаль посмотреть надо",
  "Проведи аудит ID и EN, как исправить, но не применяй",
  "Почему в индонезийской локали неправильное количество блоков?",
];

for (const text of auditCases) {
  const policy = classifyLocaleChatPolicy(text, { hasNamespaces: true });
  assert.equal(policy.readOnlyAudit, true, `expected read-only audit: ${text}`);
  assert.equal(policy.explicitFix, false, `audit must not become a fix: ${text}`);
}

for (const text of ["Исправь локаль ID", "Примени правки к локали ID", "Выровняй блоки локали ID с EN", "Да, исправь её"]) {
  const policy = classifyLocaleChatPolicy(text, { hasNamespaces: true });
  assert.equal(policy.readOnlyAudit, false, `explicit fix must not be classified as audit: ${text}`);
  assert.equal(policy.explicitFix, true, `expected explicit fix: ${text}`);
}

const structureFix = "Сможешь отделить полноценными блоками? Потому что это плэйсхолдер. Давай так везде?";
const structurePolicy = classifyLocaleChatPolicy(structureFix, { hasNamespaces: true });
assert.equal(structurePolicy.readOnlyAudit, false, "explicit structure request must not remain an audit");
assert.equal(structurePolicy.explicitFix, true, "explicit structure request must route to locale fix");

const affirmativeFix = classifyLocaleChatPolicy("Да давай", {
  hasNamespaces: true,
  priorAssistantText: "В ID лишних 2 блока относительно EN. Хотите, я помогу поправить индонезийский локал?",
});
assert.equal(affirmativeFix.explicitFix, true, "affirmative answer must continue the offered locale fix");
assert.equal(affirmativeFix.confirmsPriorFix, true, "affirmative answer must retain prior locale context");
assert.equal(
  classifyLocaleChatPolicy("Да давай", { hasNamespaces: true, priorAssistantText: "Собрать новый HTML?" }).explicitFix,
  false,
  "generic confirmation must not become a locale fix without a prior fix offer",
);

assert.equal(
  classifyLocaleChatPolicy("Сравни локали", { hasNamespaces: false }).readOnlyAudit,
  false,
  "locale audit requires a loaded locale workspace",
);

const html = await readFile(new URL("../public/workbench.html", import.meta.url), "utf8");
for (const removedLabel of [
  "Перевести во все локали",
  "Перевести в активную локаль",
  "Починить активную локаль",
  ">Анализ<",
  ">Авточинить<",
  ">AI-аудит<",
]) {
  assert.equal(html.includes(removedLabel), false, `removed control leaked into UI: ${removedLabel}`);
}
assert.match(html, /data-preset="placeholderize"/, "verified placeholder action must remain visible");

const client = await readFile(new URL("../public/workbench.js", import.meta.url), "utf8");
assert.equal(client.includes("✓ AI применил изменения автоматически"), false, "AI results must not claim automatic application");
assert.match(client, /if \(!localeAuditRequested && tool/, "audit responses must ignore tool mutations");
assert.match(client, /showLocaleFixDiffPreview/, "locale proposals must have a diff preview");
assert.match(client, /const localeOnlyMode = localePolicy\.hasLocaleContext && !explicitHtmlEdit/, "locale-only safety boundary must be enabled");
assert.match(
  client,
  /localeOnlyMode \? \{ \.\.\.tool, editorHtml: undefined, editorSource: undefined \}/,
  "locale-only tool results must discard both editor HTML and source edits",
);
assert.match(client, /if \(!localeOnlyMode && modHtml/, "locale-only responses must discard draft HTML");

const server = await readFile(new URL("../server.js", import.meta.url), "utf8");
const auditGuard = server.indexOf("if (payload.localeAuditMode || localePolicy.readOnlyAudit)");
const toolDispatch = server.indexOf("const dispatched = await tryAiToolsDispatch(payload)", auditGuard);
assert.ok(auditGuard >= 0 && toolDispatch > auditGuard, "read-only audit guard must run before mutating tool dispatch");
assert.match(server, /if \(payload\.localeOnlyMode \|\| localePolicy\.hasLocaleContext\)/, "locale requests must never fall through to HTML draft generation");
assert.match(server, /const explicitStructureAction =/, "structure requests must bypass the generic question guard");
assert.match(server, /везде\|во всех/, "all-locale structure requests must include every locale");

const localeAi = await readFile(new URL("../src/locale-ai.js", import.meta.url), "utf8");
assert.match(localeAi, /required:\s*\["notes",\s*"blocks"\]/, "strict locale schema must require every declared property");
assert.match(localeAi, /required:\s*\['notes',\s*'mappings'\]/, "strict placeholder schema must require notes and mappings");

console.log("locale chat safety: ok");
