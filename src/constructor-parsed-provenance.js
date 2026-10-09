import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { isStudioModelFresh } from "./code-workspace.js";
import { classifyConstructorTopLevelLine } from "./constructor-legacy-parse.js";
import { compareStudioModelSourceSignatures } from "./studio-model-signatures.js";

function stableJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
}

function parsedDefinitionShape(candidate, fallbackId = "") {
  const block = candidate && typeof candidate === "object" ? candidate : {};
  const id = String(block.id || fallbackId || "");
  return {
    id,
    label: String(block.label || id),
    placement: String(block.placement || "section"),
    category: String(block.category || "imported"),
    pug: String(block.pug || ""),
    styl: String(block.styl || ""),
    slots: Array.isArray(block.slots) ? block.slots : [],
    childSlots: Array.isArray(block.childSlots) ? block.childSlots : [],
    appearance: block.appearance && typeof block.appearance === "object" && !Array.isArray(block.appearance)
      ? block.appearance
      : {},
  };
}

export function parsedDefinitionSourceHash(candidate, fallbackId = "") {
  return createHash("sha256")
    .update(stableJson(parsedDefinitionShape(candidate, fallbackId)))
    .digest("hex");
}

export class ParsedBlockProvenanceError extends Error {
  constructor(message) {
    super(message);
    this.name = "ParsedBlockProvenanceError";
    this.statusCode = 422;
    this.code = "PARSED_BLOCK_PROVENANCE_MISMATCH";
  }
}

function fail(message) {
  throw new ParsedBlockProvenanceError(message);
}

function addTrustedDefinition(target, candidate, fallbackId = "") {
  const shape = parsedDefinitionShape(candidate, fallbackId);
  if (!shape.id || !shape.pug.trim()) return;
  const hash = parsedDefinitionSourceHash(shape);
  const previous = target.get(shape.id);
  if (previous && previous.hash !== hash) {
    fail(`source mail contains conflicting parsed definitions for "${shape.id}"`);
  }
  target.set(shape.id, { definition: shape, hash });
}

function trustedDefinitionsFromFreshModel(mailRoot, model) {
  const definitions = new Map();
  const defsById = new Map();
  const addModelDef = (candidate, fallbackId = "") => {
    if (!candidate || typeof candidate !== "object") return;
    const id = String(candidate.id || fallbackId || "");
    if (id) defsById.set(id, candidate.id ? candidate : { id, ...candidate });
  };
  if (Array.isArray(model.defs)) model.defs.forEach((candidate) => addModelDef(candidate));
  else if (model.defs && typeof model.defs === "object") {
    Object.entries(model.defs).forEach(([id, candidate]) => addModelDef(candidate, id));
  }

  const visit = (entries) => {
    for (const entry of Array.isArray(entries) ? entries : []) {
      if (!entry || typeof entry !== "object") continue;
      const id = String(entry.blockId || entry.id || "");
      const source = String(entry.source || entry.blockSource || "");
      if (source === "parsed") {
        const inline = entry.def || entry.definition || entry.block
          || (typeof entry.pug === "string" ? entry : null)
          || defsById.get(id);
        addTrustedDefinition(definitions, inline, id);
      }
      if (Array.isArray(entry.children)) visit(entry.children);
    }
  };
  visit(model.entries);
  return definitions;
}

function trustedDefinitionsFromLegacyHeader(mailRoot, sourceMail) {
  const base = path.join(mailRoot, "app", "templates", "blocks");
  let header = path.join(base, "header.pug");
  if (!existsSync(header)) header = path.join(base, "header.jade");
  if (!existsSync(header)) fail("source mail has no header.pug/header.jade to verify parsed blocks");

  const lines = readFileSync(header, "utf8").replace(/\r/g, "").split("\n");
  const raw = [];
  let current = null;
  const flush = () => {
    if (current && current.lines.some((line) => line.trim())) {
      current.pug = current.lines.join("\n").replace(/\s+$/, "");
      delete current.lines;
      raw.push(current);
    }
    current = null;
  };
  for (const line of lines) {
    if (!line.trim()) {
      if (current) current.lines.push(line);
      continue;
    }
    const indent = line.match(/^\s*/)?.[0]?.length || 0;
    if (indent === 0) {
      flush();
      current = {
        ...classifyConstructorTopLevelLine(line.trim()),
        lines: [line],
      };
    } else if (current) {
      current.lines.push(line);
    }
  }
  flush();

  const definitions = new Map();
  raw.forEach((block, index) => {
    const id = `parsed-${sourceMail}-${index}`;
    addTrustedDefinition(definitions, {
      id,
      label: block.label,
      placement: block.placement,
      category: block.category || "imported",
      pug: block.pug,
      styl: "",
      slots: [],
    });
  });
  return definitions;
}

function loadTrustedParsedDefinitions(mailRoot, sourceMail) {
  if (!mailRoot || !existsSync(mailRoot) || !statSync(mailRoot).isDirectory()) {
    fail("source mail does not exist");
  }
  const modelPath = path.join(mailRoot, "studio-model.json");
  if (!existsSync(modelPath)) return trustedDefinitionsFromLegacyHeader(mailRoot, sourceMail);

  let model;
  try {
    model = JSON.parse(readFileSync(modelPath, "utf8"));
  } catch {
    fail("source studio-model.json is unreadable");
  }
  const signatures = compareStudioModelSourceSignatures(mailRoot, model?.sourceSignatures);
  if (!Array.isArray(model?.entries) || !isStudioModelFresh(model) || signatures?.matches !== true) {
    fail("source constructor model is stale relative to its Pug/Stylus files");
  }
  return trustedDefinitionsFromFreshModel(mailRoot, model);
}

/**
 * A client cannot make an arbitrary ad-hoc definition trusted by merely naming
 * an existing source mail. Every submitted `source:"parsed"` definition must
 * match the current server-side parse/model bytes for that exact source.
 */
export function assertTrustedParsedBlockProvenance({
  blocks,
  sourceMailRoot,
  sourceMail,
} = {}) {
  const parsed = (Array.isArray(blocks) ? blocks : [])
    .filter((entry) => entry && String(entry.source || "") === "parsed");
  if (!parsed.length) return { hasParsed: false, verified: false, count: 0 };
  if (!sourceMailRoot || !sourceMail) {
    fail("parsed blocks require an existing source mail");
  }

  const trusted = loadTrustedParsedDefinitions(sourceMailRoot, sourceMail);
  for (const entry of parsed) {
    const id = String(entry.blockId || entry.id || "");
    if (!id || !entry.def || typeof entry.def.pug !== "string") {
      fail(`parsed block "${id || "unknown"}" has no verifiable inline definition`);
    }
    const expected = trusted.get(id);
    if (!expected) fail(`parsed block "${id}" does not exist in the current source mail`);
    const receivedHash = parsedDefinitionSourceHash(entry.def, id);
    if (receivedHash !== expected.hash) {
      fail(`parsed block "${id}" differs from the current source mail definition`);
    }
  }
  return { hasParsed: true, verified: true, count: parsed.length };
}
