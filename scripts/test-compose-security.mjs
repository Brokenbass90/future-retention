#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { composeEmailFromBlocks } from "../src/compose-email.js";
import { assertTrustedParsedBlockProvenance } from "../src/constructor-parsed-provenance.js";
import { classifyConstructorTopLevelLine } from "../src/constructor-legacy-parse.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temp = mkdtempSync(path.join(os.tmpdir(), "retkit-compose-security-"));
const defaultSkeleton = path.join(root, "email-base", "X_IQBroker", "mail-welcome");

function adHocEntry({ id = "safe-section", pug = "table.row.safe\n  tr\n    td {{ text }}", styl = "", slots = {} } = {}) {
  return {
    id,
    def: {
      id,
      label: id,
      placement: "section",
      pug,
      styl,
      slots: [
        { id: "text", kind: "text", default: "Safe" },
        { id: "href", kind: "url", default: "#" },
        { id: "color", kind: "color", default: "#000000" },
      ],
    },
    slots,
  };
}

function adHocImageEntry({ id, imageUrl, pug = "table.row.safe\n  tr\n    td\n      img(src='{{ image }}')", styl = "" }) {
  return {
    id,
    def: {
      id,
      label: id,
      placement: "section",
      pug,
      styl,
      slots: [{ id: "image", kind: "image", default: "https://cdn.example.com/safe.png" }],
    },
    slots: { image: imageUrl },
  };
}

function expectComposeFailure(label, args, pattern) {
  assert.throws(() => composeEmailFromBlocks(args), pattern, label);
}

try {
  const baseArgs = {
    brand: "X_safe",
    mailName: "security",
    destRoot: temp,
    blocks: [adHocEntry()],
  };

  expectComposeFailure(
    "release compose rejects an unsaved ad-hoc definition",
    { ...baseArgs, validateOnly: true, requireApprovedBlocks: true },
    /not release-approved/i,
  );
  expectComposeFailure(
    "release compose quarantines imported library slices",
    {
      ...baseArgs,
      validateOnly: true,
      requireApprovedBlocks: true,
      blocks: [{ id: "iq-feature-list-57", slots: {} }],
    },
    /quarantined/i,
  );
  assert.doesNotThrow(
    () => composeEmailFromBlocks({
      ...baseArgs,
      validateOnly: true,
      requireApprovedBlocks: true,
      allowTrustedParsedBlocks: true,
      blocks: [{ ...adHocEntry(), source: "parsed" }],
    }),
    "server-authorized parsed source remains available for an existing-mail round-trip",
  );
  expectComposeFailure(
    "parsed source cannot self-authorize without server-proven skeleton provenance",
    {
      ...baseArgs,
      validateOnly: true,
      requireApprovedBlocks: true,
      blocks: [{ ...adHocEntry(), source: "parsed" }],
    },
    /not release-approved/i,
  );
  assert.doesNotThrow(
    () => composeEmailFromBlocks({
      ...baseArgs,
      validateOnly: true,
      requireApprovedBlocks: true,
      blocks: [{ id: "iq-section", slots: {} }],
    }),
    "canonical definitions remain release-approved",
  );

  const parsedSourceMail = "mail-existing-source";
  const parsedSourceRoot = path.join(temp, "parsed-source", parsedSourceMail);
  const parsedHeader = [
    'table.row.source-section(role="presentation")',
    "  tr",
    "    td SOURCE-BYTES",
  ].join("\n");
  const parsedHeaderPath = path.join(parsedSourceRoot, "app", "templates", "blocks", "header.pug");
  mkdirSync(path.dirname(parsedHeaderPath), { recursive: true });
  writeFileSync(parsedHeaderPath, `${parsedHeader}\n`, "utf8");
  const classified = classifyConstructorTopLevelLine(parsedHeader.split("\n")[0]);
  const trustedParsedEntry = {
    id: `parsed-${parsedSourceMail}-0`,
    source: "parsed",
    def: {
      id: `parsed-${parsedSourceMail}-0`,
      label: classified.label,
      placement: classified.placement,
      category: classified.category || "imported",
      pug: parsedHeader,
      styl: "",
      slots: [],
    },
    slots: {},
  };
  const verifiedParsed = assertTrustedParsedBlockProvenance({
    blocks: [trustedParsedEntry],
    sourceMailRoot: parsedSourceRoot,
    sourceMail: parsedSourceMail,
  });
  assert.deepEqual(
    verifiedParsed,
    { hasParsed: true, verified: true, count: 1 },
    "parsed release bypass is granted only after exact server-side source comparison",
  );
  assert.throws(
    () => assertTrustedParsedBlockProvenance({
      blocks: [{
        ...trustedParsedEntry,
        def: { ...trustedParsedEntry.def, pug: `${trustedParsedEntry.def.pug}\n// injected` },
      }],
      sourceMailRoot: parsedSourceRoot,
      sourceMail: parsedSourceMail,
    }),
    /differs from the current source mail definition/i,
    "naming a real source mail does not authorize client-modified parsed Pug",
  );
  assert.throws(
    () => assertTrustedParsedBlockProvenance({
      blocks: [{ ...trustedParsedEntry, id: "parsed-arbitrary", def: { ...trustedParsedEntry.def, id: "parsed-arbitrary" } }],
      sourceMailRoot: parsedSourceRoot,
      sourceMail: parsedSourceMail,
    }),
    /does not exist in the current source mail/i,
    "naming a real source mail does not authorize an unrelated parsed block id",
  );

  for (const [field, value] of [
    ["brand", "../escape"],
    ["brand", "/absolute"],
    ["mailName", "../escape"],
    ["mailName", "mail/name"],
    ["mailName", ".."],
  ]) {
    expectComposeFailure(
      `${field} path traversal is rejected before filesystem mutation`,
      { ...baseArgs, [field]: value },
      new RegExp(`invalid ${field}`, "i"),
    );
  }
  assert.equal(existsSync(path.join(temp, "escape")), false, "path traversal tests created no escaped destination");

  const outsideSkeletonRoot = mkdtempSync(path.join(os.tmpdir(), "retkit-untrusted-skeleton-"));
  const outsideSkeleton = path.join(outsideSkeletonRoot, "mail");
  mkdirSync(outsideSkeleton, { recursive: true });
  try {
    expectComposeFailure(
      "an arbitrary skeleton outside email-base is rejected",
      { ...baseArgs, mailName: "outside-skeleton", skeleton: outsideSkeleton },
      /skeleton is outside email-base/i,
    );
    const trusted = composeEmailFromBlocks({
      ...baseArgs,
      mailName: "trusted-skeleton",
      skeleton: outsideSkeleton,
      trustedSkeletonRoots: [outsideSkeletonRoot],
    });
    assert.ok(existsSync(trusted.headerPugPath), "internal explicit trusted skeleton override remains available for staged/test snapshots");
  } finally {
    rmSync(outsideSkeletonRoot, { recursive: true, force: true });
  }

  const unsafeSources = [
    ["Pug process.env", { pug: "p= process.env.OPENAI_API_KEY" }, /portable source gate.*(?:Code|executable)/i],
    ["Pug interpolation", { pug: "p #{process.env.OPENAI_API_KEY}" }, /portable source gate.*interpolation/i],
    ["Pug newline code", { pug: "p Safe\n- process.exit(1)" }, /portable source gate.*executable/i],
    ["Pug include", { pug: "include /etc/passwd" }, /portable source gate.*includes/i],
    ["Stylus import", { styl: "@import '/etc/passwd'" }, /portable source gate.*import\/require/i],
  ];
  for (const [label, source, pattern] of unsafeSources) {
    const mailName = `unsafe-${label.toLowerCase().replace(/[^a-z]+/g, "-").replace(/-+$/g, "")}`;
    expectComposeFailure(
      `${label} is rejected by the same gate used for preview composition`,
      { ...baseArgs, mailName, blocks: [adHocEntry({ ...source, id: mailName })] },
      pattern,
    );
    assert.equal(existsSync(path.join(temp, "X_safe", `mail-${mailName}`)), false, `${label} failed before scaffolding`);
  }

  const unsafeSlots = [
    ["newline Pug code", { text: "Hello\n- process.exit(1)" }, /line breaks/i],
    ["Pug interpolation", { text: "#{process.env.OPENAI_API_KEY}" }, /interpolation/i],
    ["JavaScript expression", { text: "process.env.OPENAI_API_KEY" }, /JavaScript expressions/i],
    ["generic Pug expression", { text: "= Math.random()" }, /begin with Pug syntax/i],
    ["constructor marker", { text: "{{ INNER_BLOCKS }}" }, /child-slot marker/i],
    ["quote/event attribute", { href: "https://example.test/' onclick='alert(1)" }, /executable HTML/i],
  ];
  for (const [label, slots, pattern] of unsafeSlots) {
    expectComposeFailure(
      `${label} cannot turn slot data into Pug source`,
      {
        ...baseArgs,
        mailName: `slot-${label.toLowerCase().replace(/[^a-z]+/g, "-").replace(/-+$/g, "")}`,
        blocks: [adHocEntry({
          pug: "a.safe(href='{{ href }}') {{ text }}",
          slots,
        })],
      },
      pattern,
    );
  }
  expectComposeFailure(
    "slot data cannot inject a Stylus import",
    {
      ...baseArgs,
      mailName: "slot-stylus-import",
      blocks: [adHocEntry({ styl: ".safe\n  color {{ color }}", slots: { color: "@import '/etc/passwd'" } })],
    },
    /Stylus|quotes|import/i,
  );

  // Core/API/AI guard: composeEmailFromBlocks is the shared write path. An
  // unsafe request must fail before it removes or rewrites an existing mail.
  const sentinelMailName = "asset-sentinel";
  const sentinelPath = path.join(temp, "X_safe", `mail-${sentinelMailName}`, "app", "templates", "blocks", "header.pug");
  mkdirSync(path.dirname(sentinelPath), { recursive: true });
  writeFileSync(sentinelPath, "p EXISTING-ASSET-SENTINEL\n", "utf8");
  for (const [label, assetUrl] of [
    ["relative Studio asset", "/studio-assets/private.png"],
    ["absolute Studio asset", "https://studio.example/studio-assets/private.png"],
    ["localhost asset", "http://localhost/private.png"],
    ["IPv4 loopback asset", "http://127.0.0.1/private.png"],
    ["RFC1918 10/8 asset", "http://10.2.3.4/private.png"],
    ["RFC1918 172.16/12 asset", "http://172.20.3.4/private.png"],
    ["RFC1918 192.168/16 asset", "http://192.168.1.4/private.png"],
    ["IPv6 loopback asset", "http://[::1]/private.png"],
  ]) {
    expectComposeFailure(
      `${label} is rejected by direct/API-equivalent compose`,
      {
        ...baseArgs,
        mailName: sentinelMailName,
        blocks: [adHocImageEntry({
          id: `unsafe-asset-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
          imageUrl: assetUrl,
        })],
      },
      /non-public asset URL|local \/studio-assets|local\/private host/i,
    );
    assert.equal(
      readFileSync(sentinelPath, "utf8"),
      "p EXISTING-ASSET-SENTINEL\n",
      `${label} failed before destructive compose write`,
    );
  }

  expectComposeFailure(
    "hard-coded local asset in resultant Pug is rejected before write",
    {
      ...baseArgs,
      mailName: sentinelMailName,
      blocks: [adHocEntry({
        id: "hardcoded-local-asset",
        pug: "table.row.safe\n  tr\n    td\n      img(src='/studio-assets/hardcoded.png')",
      })],
    },
    /composed Pug.*non-public asset URL/i,
  );
  assert.equal(readFileSync(sentinelPath, "utf8"), "p EXISTING-ASSET-SENTINEL\n");

  const preservedSource = readFileSync(path.join(defaultSkeleton, "app", "templates", "helpers", "preheader.pug"), "utf8");
  const preserved = composeEmailFromBlocks({
    ...baseArgs,
    mailName: "preheader-preserved",
    skeleton: defaultSkeleton,
    preserveSkeletonPreheader: true,
  });
  assert.equal(
    readFileSync(path.join(preserved.destDir, "app", "templates", "helpers", "preheader.pug"), "utf8"),
    preservedSource,
    "source round-trip preserves preheader when no explicit outer slot edit exists",
  );

  const replaced = composeEmailFromBlocks({
    brand: "X_safe",
    mailName: "preheader-replaced",
    destRoot: temp,
    skeleton: defaultSkeleton,
    preserveSkeletonPreheader: true,
    blocks: [
      { uid: "outer", id: "iq-outer-wrapper", parentUid: null, slots: { preheader: "Explicit round-trip preheader" } },
      { uid: "section", id: "iq-section", parentUid: "outer", slotId: "sections", slots: {} },
    ],
  });
  const replacedPreheader = readFileSync(path.join(replaced.destDir, "app", "templates", "helpers", "preheader.pug"), "utf8");
  assert.match(replacedPreheader, /Explicit round-trip preheader/, "an explicit outer preheader slot edit replaces source even in round-trip mode");
  assert.doesNotMatch(replacedPreheader, /welcome-broker/i, "explicit preheader replacement cannot retain the old campaign namespace");

  console.log("compose security: ok");
} finally {
  rmSync(temp, { recursive: true, force: true });
}
