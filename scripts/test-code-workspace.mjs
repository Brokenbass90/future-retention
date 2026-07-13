import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";

import {
  isStudioModelFresh,
  listCodeWorkspace,
  markStudioModelStale,
  readCodeHtml,
  resetCodeHtmlOverride,
  saveCodeHtmlOverride,
} from "../src/code-workspace.js";
import {
  planWorkbenchLocaleSync,
  resolveRemainingHtmlLocalization,
  syncWorkbenchLocaleNamespaces,
} from "../src/workbench-localization.js";

const root = await mkdtemp(path.join(os.tmpdir(), "retkit-code-workspace-"));
const brand = "X_Test";
const mail = "mail-demo";

async function put(relativePath, content) {
  const filePath = path.join(root, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
}

try {
  await put(`dist/${brand}/${mail}/index.html`, "<html>${{ promo.block_00 }}$</html>");
  await put(`dist/${brand}/${mail}/en/index.html`, "<html>${{ promo.block_00 }}$ / ${{ missing.block_00 }}$</html>");
  await put(`dist/${brand}/${mail}/ru/index.html`, "<html>ru-v1</html>");
  await mkdir(path.join(root, brand, mail), { recursive: true });

  await put("vendor/data/en/promo.json", JSON.stringify({
    meta: { owner: "legacy" },
    block_99: "stale Workbench block",
  }, null, 2) + "\n");
  await put("vendor/data/en/unrelated.json", "{\"keep\":true}\n");
  const sync = await syncWorkbenchLocaleNamespaces({
    emailBaseRoot: root,
    namespaces: [
      {
        name: "promo",
        locales: {
          en: ["Hello @@friend@@", "Open"],
          ru: ["Привет", "Открыть"],
          ar: ["مرحبا", "افتح"],
        },
      },
      {
        name: "footer_upload",
        builtin: true,
        locales: { en: ["Terms"] },
      },
    ],
  });
  assert.deepEqual(sync.locales, ["ar", "en", "ru"]);
  assert.deepEqual(sync.skippedBuiltins, ["footer_upload"]);
  assert.equal(sync.written, 3);
  assert.equal(existsSync(path.join(root, "vendor/data/en/footer_upload.json")), false);
  const syncedEn = JSON.parse(await readFile(path.join(root, "vendor/data/en/promo.json"), "utf8"));
  assert.deepEqual(syncedEn.meta, { owner: "legacy" });
  assert.equal(syncedEn.block_99, undefined);
  assert.equal(syncedEn.block_00, "Hello <b>friend</b>");
  assert.equal(syncedEn.block_01, "Open");
  assert.equal(await readFile(path.join(root, "vendor/data/en/unrelated.json"), "utf8"), "{\"keep\":true}\n");

  const unchangedSync = await syncWorkbenchLocaleNamespaces({
    emailBaseRoot: root,
    namespaces: [{ name: "promo", locales: { en: ["Hello @@friend@@", "Open"] } }],
  });
  assert.equal(unchangedSync.written, 0);
  assert.equal(unchangedSync.unchanged, 1);
  assert.deepEqual(
    (await readdir(path.join(root, "vendor/data/en"))).filter((name) => name.includes(".tmp-")),
    [],
    "locale sync must not leak temporary files",
  );
  assert.throws(
    () => planWorkbenchLocaleSync([{ name: "../escape", locales: { en: ["x"] } }]),
    /Invalid locale namespace/,
  );
  assert.throws(
    () => planWorkbenchLocaleSync([{ name: "safe", locales: { "../../en": ["x"] } }]),
    /Invalid locale/,
  );

  const initial = await listCodeWorkspace({ emailBaseRoot: root, brand, mail });
  assert.deepEqual(initial.locales.map((entry) => entry.code), ["base", "en", "ru"]);
  assert.equal(initial.defaultLocale, "base");
  assert.equal(initial.locales.find((entry) => entry.code === "ru")?.detached, false);

  const original = await readCodeHtml({ emailBaseRoot: root, brand, mail, locale: "original" });
  assert.equal(original.html, "<html>${{ promo.block_00 }}$</html>");
  assert.equal(original.localization.status, "source");
  assert.equal(original.localization.expectedRaw, true);
  assert.equal(original.localization.unresolvedCount, 0);
  const localizedEn = await readCodeHtml({ emailBaseRoot: root, brand, mail, locale: "en" });
  assert.equal(localizedEn.html, "<html>Hello <b>friend</b> / ${{ missing.block_00 }}$</html>");
  assert.equal(localizedEn.localization.status, "unresolved");
  assert.equal(localizedEn.localization.replacedCount, 1);
  assert.deepEqual(localizedEn.localization.unresolvedTokens, ["${{ missing.block_00 }}$"]);
  const inheritedLookup = await resolveRemainingHtmlLocalization({
    emailBaseRoot: root,
    locale: "en",
    html: "<html>${{ promo.constructor.name }}$</html>",
  });
  assert.equal(inheritedLookup.html, "<html>${{ promo.constructor.name }}$</html>");
  assert.equal(inheritedLookup.localization.unresolvedCount, 1);
  assert.equal((await readCodeHtml({ emailBaseRoot: root, brand, mail, locale: "ru" })).source, "pug");

  const rtlOnce = await resolveRemainingHtmlLocalization({
    emailBaseRoot: root,
    locale: "ar",
    html: '<html dir="rtl">${{ promo.block_00 }}$</html>',
  });
  assert.equal(rtlOnce.html, '<html dir="rtl"><bdi>مرحبا</bdi></html>');
  const rtlTwice = await resolveRemainingHtmlLocalization({
    emailBaseRoot: root,
    locale: "ar",
    html: rtlOnce.html,
  });
  assert.equal(rtlTwice.html, rtlOnce.html);
  assert.equal(rtlTwice.localization.replacedCount, 0);

  const detached = await saveCodeHtmlOverride({
    emailBaseRoot: root,
    brand,
    mail,
    locale: "ru",
    html: "<html>ru-manual</html>",
  });
  assert.equal(detached.detached, true);
  assert.equal(detached.source, "override");

  // Simulate a Pug rebuild replacing dist. The manual locale must survive.
  await put(`dist/${brand}/${mail}/ru/index.html`, "<html>ru-v2-from-pug</html>");
  assert.equal((await readCodeHtml({ emailBaseRoot: root, brand, mail, locale: "ru" })).html, "<html>ru-manual</html>");
  assert.equal((await listCodeWorkspace({ emailBaseRoot: root, brand, mail })).locales.find((entry) => entry.code === "ru")?.detached, true);

  const restored = await resetCodeHtmlOverride({ emailBaseRoot: root, brand, mail, locale: "ru" });
  assert.equal(restored.detached, false);
  assert.equal(restored.source, "pug");
  assert.equal(restored.html, "<html>ru-v2-from-pug</html>");

  await saveCodeHtmlOverride({
    emailBaseRoot: root,
    brand,
    mail,
    locale: "de",
    html: "<html>de-manual-only</html>",
  });
  await assert.rejects(
    () => resetCodeHtmlOverride({ emailBaseRoot: root, brand, mail, locale: "de" }),
    /manual version was kept/,
  );
  assert.equal(
    (await readCodeHtml({ emailBaseRoot: root, brand, mail, locale: "de" })).html,
    "<html>de-manual-only</html>",
  );

  // If the compiled fallback exists but cannot be read, reset must put the
  // exact manual override back instead of deleting the user's only copy.
  await saveCodeHtmlOverride({
    emailBaseRoot: root,
    brand,
    mail,
    locale: "it",
    html: "<html>it-manual</html>",
  });
  await mkdir(path.join(root, `dist/${brand}/${mail}/it/index.html`), { recursive: true });
  await assert.rejects(
    () => resetCodeHtmlOverride({ emailBaseRoot: root, brand, mail, locale: "it" }),
  );
  assert.equal(
    (await readCodeHtml({ emailBaseRoot: root, brand, mail, locale: "it" })).html,
    "<html>it-manual</html>",
  );
  assert.deepEqual(
    (await readdir(path.join(root, brand, mail, ".retkit-workbench/html-overrides")))
      .filter((name) => name.includes("reset-backup")),
    [],
    "failed reset must restore, then remove, its private backup",
  );

  await assert.rejects(
    () => readCodeHtml({ emailBaseRoot: root, brand: "../escape", mail, locale: "ru" }),
    /Invalid brand/,
  );
  await assert.rejects(
    () => readCodeHtml({ emailBaseRoot: root, brand, mail, locale: "../../ru" }),
    /Invalid locale/,
  );
  await assert.rejects(
    () => saveCodeHtmlOverride({ emailBaseRoot: root, brand: "X_Missing", mail, locale: "en", html: "<html>x</html>" }),
    /Mail not found/,
  );
  await assert.rejects(
    () => saveCodeHtmlOverride({ emailBaseRoot: root, brand, mail, locale: "en", html: "x".repeat(20 * 1024 * 1024 + 1) }),
    /too large/,
  );

  const freshModel = { schemaVersion: 1, entries: [{ uid: "one" }] };
  assert.equal(isStudioModelFresh(freshModel), true);
  await put(`${brand}/${mail}/studio-model.json`, JSON.stringify(freshModel));
  const marked = await markStudioModelStale({
    emailBaseRoot: root,
    brand,
    mail,
    sourceFile: "templates/blocks/header.pug",
  });
  assert.equal(marked.updated, true);
  const persistedModel = JSON.parse(await readFile(path.join(root, brand, mail, "studio-model.json"), "utf8"));
  assert.equal(isStudioModelFresh(persistedModel), false);
  assert.equal(persistedModel.status, "stale");
  assert.match(persistedModel.staleReason, /header\.pug/);

  console.log("✓ code workspace: locale overrides, rebuild safety, reset, validation, stale model");
} finally {
  await rm(root, { recursive: true, force: true });
}
