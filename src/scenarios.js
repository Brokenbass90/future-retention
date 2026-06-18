import path from "node:path";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeStringList(values, limit = 32) {
  if (Array.isArray(values)) {
    return Array.from(new Set(values.map((value) => cleanText(value)).filter(Boolean))).slice(0, limit);
  }
  if (typeof values === "string") {
    return Array.from(new Set(values.split(",").map((value) => cleanText(value)).filter(Boolean))).slice(0, limit);
  }
  return [];
}

function slugify(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function normalizeScenarioExpected(expected = {}) {
  const templateSelection = expected?.templateSelection && typeof expected.templateSelection === "object"
    ? expected.templateSelection
    : {};
  const localeHtmlIncludes = expected?.localeHtmlIncludes && typeof expected.localeHtmlIncludes === "object"
    ? Object.fromEntries(
        Object.entries(expected.localeHtmlIncludes).map(([locale, values]) => [cleanText(locale), normalizeStringList(values, 24)])
      )
    : {};
  const localeHtmlExcludes = expected?.localeHtmlExcludes && typeof expected.localeHtmlExcludes === "object"
    ? Object.fromEntries(
        Object.entries(expected.localeHtmlExcludes).map(([locale, values]) => [cleanText(locale), normalizeStringList(values, 24)])
      )
    : {};
  const orderChecks = Array.isArray(expected?.orderChecks)
    ? expected.orderChecks.map((check) => ({
        locale: cleanText(check?.locale),
        before: cleanText(check?.before),
        after: cleanText(check?.after)
      })).filter((check) => check.before && check.after)
    : [];

  return {
    previewSource: cleanText(expected?.previewSource),
    locales: normalizeStringList(expected?.locales, 16),
    htmlIncludes: normalizeStringList(expected?.htmlIncludes, 48),
    htmlExcludes: normalizeStringList(expected?.htmlExcludes, 48),
    localeHtmlIncludes,
    localeHtmlExcludes,
    orderChecks,
    templateSelection: {
      category: cleanText(templateSelection?.category),
      mailId: cleanText(templateSelection?.mailId),
      profile: cleanText(templateSelection?.profile)
    }
  };
}

export function normalizeScenarioFixture(entry = {}, index = 0) {
  const request = entry?.request && typeof entry.request === "object" ? entry.request : {};
  return {
    id: cleanText(entry?.id) || `scenario-${index + 1}`,
    title: cleanText(entry?.title) || `Scenario ${index + 1}`,
    description: cleanText(entry?.description),
    type: cleanText(entry?.type) || "chat",
    tags: normalizeStringList(entry?.tags),
    request,
    expected: normalizeScenarioExpected(entry?.expected)
  };
}

export function listScenarioFixtures(dirPath) {
  if (!dirPath || !existsSync(dirPath)) {
    return [];
  }

  return readdirSync(dirPath)
    .filter((fileName) => fileName.endsWith(".json"))
    .sort()
    .map((fileName, index) => {
      try {
        const raw = JSON.parse(readFileSync(path.join(dirPath, fileName), "utf8"));
        const fixture = normalizeScenarioFixture(raw, index);
        return {
          ...fixture,
          fileName,
          filePath: path.join(dirPath, fileName)
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

export function readScenarioFixture(filePath) {
  if (!filePath || !existsSync(filePath)) {
    return null;
  }

  try {
    const raw = JSON.parse(readFileSync(filePath, "utf8"));
    return normalizeScenarioFixture(raw, 0);
  } catch {
    return null;
  }
}

export async function saveScenarioFixture(dirPath, entry, options = {}) {
  const normalized = normalizeScenarioFixture(entry, 0);
  const scenarioId = slugify(normalized.id || normalized.title) || `scenario-${Date.now()}`;
  const fileName = `${scenarioId}.json`;
  const filePath = path.join(dirPath, fileName);

  mkdirSync(dirPath, { recursive: true });
  if (existsSync(filePath) && !options.overwrite) {
    throw new Error(`Scenario already exists: ${fileName}`);
  }

  await writeFile(filePath, `${JSON.stringify({ ...normalized, id: scenarioId }, null, 2)}\n`, "utf8");
  return {
    id: scenarioId,
    fileName,
    filePath,
    scenario: {
      ...normalized,
      id: scenarioId
    }
  };
}
