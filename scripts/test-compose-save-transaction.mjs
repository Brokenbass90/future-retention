import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import {
  beginComposeSaveTransaction,
  withComposeSaveTransaction,
} from "../src/compose-save-transaction.js";

async function writeTree(root, files) {
  for (const [relativePath, contents] of Object.entries(files)) {
    const filename = path.join(root, relativePath);
    await mkdir(path.dirname(filename), { recursive: true });
    await writeFile(filename, contents, "utf8");
  }
}

async function text(filename) {
  return readFile(filename, "utf8");
}

async function exists(filename) {
  try {
    await readFile(filename);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function assertNoBackups(...parents) {
  for (const parent of parents) {
    const names = await readdir(parent);
    assert.deepEqual(
      names.filter((name) => name.includes(".retkit-compose-backup-")),
      [],
      `backup leaked in ${parent}`,
    );
  }
}

const tempRoot = await mkdtemp(path.join(os.tmpdir(), "retkit-compose-save-transaction-test-"));

try {
  const mailParent = path.join(tempRoot, "email-base", "iq");
  const distParent = path.join(tempRoot, "email-base", "dist", "iq");
  const destination = path.join(mailParent, "mail-safe");
  const distDestination = path.join(distParent, "mail-safe");

  await writeTree(destination, {
    "src/index.pug": "p OLD MAIL",
    "src/nested/asset.txt": "old nested asset",
  });
  await writeTree(distDestination, {
    "EN/index.html": "OLD DIST",
  });

  const composeFailure = new Error("synthetic compose failure");
  await assert.rejects(
    withComposeSaveTransaction(
      { destination, distDestination, force: true },
      async () => {
        await writeTree(destination, { "src/index.pug": "p PARTIAL NEW MAIL" });
        throw composeFailure;
      },
    ),
    (error) => error === composeFailure,
  );

  assert.equal(await text(path.join(destination, "src/index.pug")), "p OLD MAIL");
  assert.equal(await text(path.join(destination, "src/nested/asset.txt")), "old nested asset");
  assert.equal(await text(path.join(distDestination, "EN/index.html")), "OLD DIST");
  await assertNoBackups(mailParent, distParent);

  const buildFailure = Object.assign(new Error("synthetic build failure"), { code: 23 });
  await assert.rejects(
    withComposeSaveTransaction(
      { destination, distDestination, force: true },
      async () => {
        await writeTree(destination, { "src/index.pug": "p NEW MAIL BEFORE BUILD" });
        await writeTree(distDestination, { "EN/index.html": "PARTIAL NEW DIST" });
        throw buildFailure;
      },
    ),
    (error) => error === buildFailure,
  );

  assert.equal(await text(path.join(destination, "src/index.pug")), "p OLD MAIL");
  assert.equal(await text(path.join(distDestination, "EN/index.html")), "OLD DIST");
  await assertNoBackups(mailParent, distParent);

  const returned = await withComposeSaveTransaction(
    { destination, distDestination, force: true },
    async () => {
      await writeTree(destination, {
        "src/index.pug": "p FINAL MAIL",
        "src/new.txt": "new file",
      });
      await writeTree(distDestination, { "EN/index.html": "FINAL DIST" });
      return { buildCode: 0 };
    },
  );

  assert.deepEqual(returned, { buildCode: 0 });
  assert.equal(await text(path.join(destination, "src/index.pug")), "p FINAL MAIL");
  assert.equal(await text(path.join(destination, "src/new.txt")), "new file");
  assert.equal(await text(path.join(distDestination, "EN/index.html")), "FINAL DIST");
  assert.equal(await exists(path.join(destination, "src/nested/asset.txt")), false);
  await assertNoBackups(mailParent, distParent);

  await assert.rejects(
    beginComposeSaveTransaction({ destination, distDestination, force: false }),
    (error) => {
      assert.equal(error.code, "COMPOSE_SAVE_TARGET_EXISTS");
      assert.deepEqual(new Set(error.targets), new Set([destination, distDestination]));
      return true;
    },
  );
  assert.equal(await text(path.join(destination, "src/index.pug")), "p FINAL MAIL");
  assert.equal(await text(path.join(distDestination, "EN/index.html")), "FINAL DIST");
  await assertNoBackups(mailParent, distParent);

  const mailOnlyDestination = path.join(mailParent, "mail-mail-only");
  const absentDistDestination = path.join(distParent, "mail-mail-only");
  await writeTree(mailOnlyDestination, { "src/index.pug": "p MAIL ONLY OLD" });

  const transaction = await beginComposeSaveTransaction({
    destination: mailOnlyDestination,
    distDestination: absentDistDestination,
    force: true,
  });
  await writeTree(mailOnlyDestination, { "src/index.pug": "p MAIL ONLY NEW" });
  await writeTree(absentDistDestination, { "EN/index.html": "NEW DIST THAT MUST DISAPPEAR" });
  await transaction.rollback();
  await transaction.rollback();

  assert.equal(await text(path.join(mailOnlyDestination, "src/index.pug")), "p MAIL ONLY OLD");
  assert.equal(await exists(path.join(absentDistDestination, "EN/index.html")), false);
  assert.equal(transaction.state, "rolled-back");
  await assertNoBackups(mailParent, distParent);

  console.log("compose-save transaction tests passed");
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
