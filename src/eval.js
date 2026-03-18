import { existsSync, readFileSync } from "node:fs";

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeStringList(values) {
  if (Array.isArray(values)) {
    return Array.from(new Set(values.map(cleanText).filter(Boolean)));
  }
  if (typeof values === "string") {
    return Array.from(new Set(values.split(",").map(cleanText).filter(Boolean)));
  }
  return [];
}

function normalizeBenchmarkCase(entry, index = 0) {
  const expected = entry?.expected && typeof entry.expected === "object" ? entry.expected : {};
  return {
    id: cleanText(entry?.id) || `case-${index + 1}`,
    title: cleanText(entry?.title) || `Benchmark case ${index + 1}`,
    tags: normalizeStringList(entry?.tags),
    designSource: cleanText(entry?.designSource || entry?.source),
    expected: {
      category: cleanText(expected.category),
      mailId: cleanText(expected.mailId),
      profile: cleanText(expected.profile),
      locales: normalizeStringList(expected.locales),
      sectionKinds: normalizeStringList(expected.sectionKinds)
    }
  };
}

export function readEvalBenchmarkSnapshot(filePath) {
  if (!filePath || !existsSync(filePath)) {
    return { version: 1, cases: [] };
  }

  try {
    const raw = JSON.parse(readFileSync(filePath, "utf8"));
    const items = Array.isArray(raw?.cases) ? raw.cases : [];
    return {
      version: Number(raw?.version) || 1,
      cases: items.map((entry, index) => normalizeBenchmarkCase(entry, index))
    };
  } catch {
    return { version: 1, cases: [] };
  }
}

export function summarizeEvalBenchmark(snapshot) {
  const cases = Array.isArray(snapshot?.cases) ? snapshot.cases : [];
  const tags = new Set();

  for (const item of cases) {
    for (const tag of normalizeStringList(item?.tags)) {
      tags.add(tag);
    }
  }

  return {
    version: Number(snapshot?.version) || 1,
    caseCount: cases.length,
    tags: Array.from(tags).sort()
  };
}

export function findEvalBenchmarkCase(snapshot, caseId) {
  const normalizedCaseId = cleanText(caseId);
  const cases = Array.isArray(snapshot?.cases) ? snapshot.cases : [];
  return cases.find((entry) => cleanText(entry.id) === normalizedCaseId) || null;
}

function collectActualLocales(result = {}) {
  const draft = result?.draft && typeof result.draft === "object" ? result.draft : {};
  const locales = new Set();

  for (const locale of Object.keys(draft.previewLocales || {})) locales.add(cleanText(locale));
  for (const locale of Object.keys(draft.localePayloads || {})) locales.add(cleanText(locale));

  const mailLocale = cleanText(draft.mail?.locale);
  if (mailLocale) {
    locales.add(mailLocale);
  }

  return Array.from(locales).filter(Boolean);
}

function collectActualSectionKinds(result = {}) {
  const sections = Array.isArray(result?.draft?.mail?.sections) ? result.draft.mail.sections : [];
  return sections.map((section) => cleanText(section?.kind)).filter(Boolean);
}

function scoreSingleCheck({ label, expected, actual, weight, compare }) {
  const passed = compare(expected, actual);
  return {
    label,
    expected,
    actual,
    weight,
    earned: passed ? weight : 0,
    passed
  };
}

export function scoreEvalCase(benchmarkCase, result = {}) {
  const normalizedCase = benchmarkCase ? normalizeBenchmarkCase(benchmarkCase, 0) : null;
  if (!normalizedCase) {
    return {
      caseId: "",
      score: 0,
      maxScore: 0,
      normalizedScore: 0,
      checks: []
    };
  }

  const templateSelection = result?.templateSelection && typeof result.templateSelection === "object"
    ? result.templateSelection
    : result?.draft?.templateSelection && typeof result.draft.templateSelection === "object"
      ? result.draft.templateSelection
      : {};
  const actualLocales = collectActualLocales(result);
  const actualSectionKinds = collectActualSectionKinds(result);

  const checks = [
    scoreSingleCheck({
      label: "template category",
      expected: normalizedCase.expected.category,
      actual: cleanText(templateSelection?.category),
      weight: 30,
      compare: (expected, actual) => !expected || expected === actual
    }),
    scoreSingleCheck({
      label: "reference mail",
      expected: normalizedCase.expected.mailId,
      actual: cleanText(templateSelection?.mailId),
      weight: 35,
      compare: (expected, actual) => !expected || expected === actual
    }),
    scoreSingleCheck({
      label: "template profile",
      expected: normalizedCase.expected.profile,
      actual: cleanText(templateSelection?.profile),
      weight: 10,
      compare: (expected, actual) => !expected || expected === actual
    }),
    scoreSingleCheck({
      label: "locales coverage",
      expected: normalizedCase.expected.locales,
      actual: actualLocales,
      weight: 10,
      compare: (expected, actual) => expected.length === 0 || expected.every((locale) => actual.includes(locale))
    }),
    scoreSingleCheck({
      label: "section kinds",
      expected: normalizedCase.expected.sectionKinds,
      actual: actualSectionKinds,
      weight: 15,
      compare: (expected, actual) => expected.length === 0 || expected.every((kind) => actual.includes(kind))
    })
  ];

  const score = checks.reduce((sum, check) => sum + check.earned, 0);
  const maxScore = checks.reduce((sum, check) => sum + check.weight, 0);

  return {
    caseId: normalizedCase.id,
    title: normalizedCase.title,
    score,
    maxScore,
    normalizedScore: maxScore > 0 ? Number((score / maxScore).toFixed(4)) : 0,
    checks
  };
}
