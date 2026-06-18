import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listScenarioFixtures } from "../src/scenarios.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.dirname(__dirname);
const studioUrl = process.env.STUDIO_URL || "http://127.0.0.1:3002";
const scenarioDir = process.env.STUDIO_SCENARIO_DIR || path.join(repoRoot, "data", "scenarios");

async function fetchJson(route, options = {}) {
  const method = options.method || "GET";
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };
  const args = ["-sS", "-X", method];
  for (const [key, value] of Object.entries(headers)) {
    args.push("-H", `${key}: ${value}`);
  }
  if (options.body) {
    args.push("--data", options.body);
  }
  args.push(`${studioUrl}${route}`);

  const text = execFileSync("curl", args, { encoding: "utf8" });
  return text ? JSON.parse(text) : {};
}

function printCheck(ok, label, detail = "") {
  const prefix = ok ? "PASS" : "FAIL";
  console.log(`${prefix} ${label}${detail ? ` :: ${detail}` : ""}`);
}

function getLocaleHtml(draft, locale = "") {
  const normalizedLocale = String(locale || "").trim();
  if (normalizedLocale && draft?.previewLocales && typeof draft.previewLocales === "object" && draft.previewLocales[normalizedLocale]) {
    return String(draft.previewLocales[normalizedLocale] || "");
  }
  return String(draft?.html || "");
}

function runChecksForScenario(fixture, result) {
  const failures = [];
  const checks = [];
  const expected = fixture.expected || {};
  const draft = result?.draft || {};
  const templateSelection = draft?.templateSelection || {};
  const locales = Object.keys(draft?.previewLocales || {});
  const defaultHtml = getLocaleHtml(draft);

  if (expected.previewSource) {
    checks.push({
      label: `${fixture.id} preview source`,
      ok: result?.previewSource === expected.previewSource,
      detail: result?.previewSource || "missing"
    });
  }

  for (const key of ["category", "mailId", "profile"]) {
    if (expected.templateSelection?.[key]) {
      checks.push({
        label: `${fixture.id} template ${key}`,
        ok: String(templateSelection?.[key] || "") === expected.templateSelection[key],
        detail: String(templateSelection?.[key] || "missing")
      });
    }
  }

  if (expected.locales.length > 0) {
    checks.push({
      label: `${fixture.id} locales`,
      ok: expected.locales.every((locale) => locales.includes(locale)),
      detail: locales.join(", ")
    });
  }

  for (const token of expected.htmlIncludes || []) {
    checks.push({
      label: `${fixture.id} html includes`,
      ok: defaultHtml.includes(token),
      detail: token
    });
  }

  for (const token of expected.htmlExcludes || []) {
    checks.push({
      label: `${fixture.id} html excludes`,
      ok: !defaultHtml.includes(token),
      detail: token
    });
  }

  for (const [locale, tokens] of Object.entries(expected.localeHtmlIncludes || {})) {
    const localeHtml = getLocaleHtml(draft, locale);
    for (const token of tokens) {
      checks.push({
        label: `${fixture.id} ${locale} includes`,
        ok: localeHtml.includes(token),
        detail: token
      });
    }
  }

  for (const [locale, tokens] of Object.entries(expected.localeHtmlExcludes || {})) {
    const localeHtml = getLocaleHtml(draft, locale);
    for (const token of tokens) {
      checks.push({
        label: `${fixture.id} ${locale} excludes`,
        ok: !localeHtml.includes(token),
        detail: token
      });
    }
  }

  for (const orderCheck of expected.orderChecks || []) {
    const html = getLocaleHtml(draft, orderCheck.locale);
    const beforeIndex = html.indexOf(orderCheck.before);
    const afterIndex = html.indexOf(orderCheck.after);
    checks.push({
      label: `${fixture.id} order`,
      ok: beforeIndex >= 0 && afterIndex >= 0 && beforeIndex < afterIndex,
      detail: `${orderCheck.before} -> ${orderCheck.after}${orderCheck.locale ? ` [${orderCheck.locale}]` : ""}`
    });
  }

  for (const check of checks) {
    printCheck(check.ok, check.label, check.detail);
    if (!check.ok) {
      failures.push(`${check.label}: ${check.detail}`);
    }
  }

  return failures;
}

async function main() {
  const fixtures = listScenarioFixtures(scenarioDir);
  if (fixtures.length === 0) {
    throw new Error(`No scenario fixtures found in ${scenarioDir}`);
  }

  console.log(`Running studio benchmark against ${studioUrl}`);
  console.log(`Scenario fixtures: ${fixtures.length}`);

  const failures = [];
  for (const fixture of fixtures) {
    console.log(`\n--- ${fixture.id} :: ${fixture.title}`);
    const result = await fetchJson("/api/chat", {
      method: "POST",
      body: JSON.stringify(fixture.request)
    });

    failures.push(...runChecksForScenario(fixture, result));
  }

  if (failures.length > 0) {
    console.error(`\nStudio benchmark failed with ${failures.length} issue(s):`);
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(`\nAll benchmark scenarios passed.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
