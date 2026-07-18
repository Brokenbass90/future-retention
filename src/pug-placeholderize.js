import { buildAnchorUnits } from "./locale-conventions.js";

const EXISTING_TOKEN_RE = /\$\{\{[\s\S]*?\}\}\$/;
const PUG_CONTROL_RE = /^(?:doctype|include|extends|append|prepend|block|mixin|each|for|while|case|when|default|if|unless|else|yield)(?:\s|$)/i;

function normalizeVisibleCopy(value) {
  let text = String(value || "");
  // Pug inline tags: `Hello #[b world]` -> `Hello world`. Re-run so simple
  // nested inline tags are flattened as well.
  for (let pass = 0; pass < 4; pass += 1) {
    const next = text.replace(/#\[[^\s\]]+(?:\([^\]]*?\))?\s+([^\]]*)\]/g, "$1");
    if (next === text) break;
    text = next;
  }
  return text
    .replace(/@@/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/[«»“”"']/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s+([.,!?;:])/g, "$1")
    .trim()
    .toLowerCase();
}

function findPugHeadEnd(trimmed) {
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = 0; index < trimmed.length; index += 1) {
    const char = trimmed[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === "(") depth += 1;
    else if (char === ")" && depth > 0) depth -= 1;
    else if (/\s/.test(char) && depth === 0) return index;
  }
  return -1;
}

/**
 * Extract literal, visible Pug tails without looking inside attributes.
 *
 * Supported canonical forms:
 *   p.title Visible copy
 *   a(href="...") Visible copy
 *   | visible continuation
 *
 * Expressions (`p= value`), comments, control statements and already
 * placeholderized lines are deliberately skipped. This makes the operation
 * conservative: a missed block stays visible for manual review instead of
 * replacing a URL, attribute or Pug expression by accident.
 */
export function extractPugTextCandidates(pugSource) {
  const source = String(pugSource || "");
  const candidates = [];
  let offset = 0;

  for (const line of source.split(/(?<=\n)/)) {
    const body = line.endsWith("\n") ? line.slice(0, -1) : line;
    const indentLength = /^\s*/.exec(body)?.[0].length || 0;
    const trimmed = body.slice(indentLength);
    if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("-") || PUG_CONTROL_RE.test(trimmed)) {
      offset += line.length;
      continue;
    }

    let tailAt = -1;
    if (trimmed.startsWith("|")) {
      tailAt = 1;
      while (/\s/.test(trimmed[tailAt] || "")) tailAt += 1;
    } else {
      const headEnd = findPugHeadEnd(trimmed);
      if (headEnd < 0) {
        offset += line.length;
        continue;
      }
      tailAt = headEnd;
      while (/\s/.test(trimmed[tailAt] || "")) tailAt += 1;
      if (/^(?:=|!=|-)(?:\s|$)/.test(trimmed.slice(tailAt))) {
        offset += line.length;
        continue;
      }
    }

    const raw = trimmed.slice(tailAt).replace(/\s+$/, "");
    const normalized = normalizeVisibleCopy(raw);
    if (!normalized || EXISTING_TOKEN_RE.test(raw)) {
      offset += line.length;
      continue;
    }
    const start = offset + indentLength + tailAt;
    candidates.push({
      id: candidates.length,
      line: candidates.length,
      start,
      end: start + raw.length,
      raw,
      normalized,
    });
    offset += line.length;
  }

  return candidates;
}

function matchScore(reference, candidate) {
  if (!reference || !candidate) return 0;
  if (reference === candidate) return 1;
  if (reference.length < 24 || candidate.length < 24) return 0;
  if (!reference.includes(candidate) && !candidate.includes(reference)) return 0;
  const ratio = reference.length / candidate.length;
  return ratio >= 0.72 && ratio <= 1.39 ? Math.min(ratio, 1 / ratio) : 0;
}

/**
 * Insert locale tokens directly into editable Pug/Jade source.
 *
 * This is intentionally deterministic and zero-AI. The locale file remains
 * the source of truth, while AI can still be used to prepare/approve that
 * locale. Ambiguous duplicate matches are resolved by document order, which
 * mirrors block_NN order in retention templates.
 */
export function placeholderizePugSource({ pug, refLocaleTxt, namespace }) {
  const source = String(pug || "");
  if (!source.trim()) throw new Error("pug is required");
  if (!String(refLocaleTxt || "").trim()) throw new Error("refLocaleTxt is required");
  const safeNamespace = String(namespace || "").trim().replace(/[^A-Za-z0-9_-]/g, "_");
  if (!safeNamespace) throw new Error("namespace is required");

  const units = buildAnchorUnits(refLocaleTxt, safeNamespace).filter((unit) => unit.hasText);
  const candidates = extractPugTextCandidates(source);
  const usedCandidates = new Set();
  const replacements = [];
  const matchedUnits = [];
  let cursor = 0;

  for (const unit of units) {
    const reference = normalizeVisibleCopy(unit.visibleText);
    let best = null;
    for (const candidate of candidates) {
      if (usedCandidates.has(candidate.id) || candidate.start < cursor) continue;
      const score = matchScore(reference, candidate.normalized);
      if (!score) continue;
      if (!best || score > best.score || (score === best.score && candidate.start < best.candidate.start)) {
        best = { candidate, score };
      }
      if (score === 1) break;
    }
    if (!best) continue;
    usedCandidates.add(best.candidate.id);
    cursor = best.candidate.end;
    replacements.push({
      start: best.candidate.start,
      end: best.candidate.end,
      value: unit.replacement,
    });
    matchedUnits.push(unit);
  }

  let output = source;
  for (const replacement of replacements.sort((left, right) => right.start - left.start)) {
    output = output.slice(0, replacement.start) + replacement.value + output.slice(replacement.end);
  }

  const matchedBlockIndexes = new Set(
    matchedUnits.flatMap((unit) => unit.parts
      .map((part, partIndex) => ({ part, index: unit.blockIndexes[partIndex] }))
      .filter(({ part }) => part.kind === "text")
      .map(({ index }) => index)),
  );
  const textBlockIndexes = units.flatMap((unit) => unit.parts
    .map((part, partIndex) => ({ part, index: unit.blockIndexes[partIndex] }))
    .filter(({ part }) => part.kind === "text")
    .map(({ index }) => index));

  return {
    pug: output,
    anchors: matchedBlockIndexes.size,
    matchedUnits: matchedUnits.length,
    total: textBlockIndexes.length,
    missed: textBlockIndexes.filter((index) => !matchedBlockIndexes.has(index)),
    candidates: candidates.length,
  };
}
