#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { composeEmailFromBlocks } from "../src/compose-email.js";

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
