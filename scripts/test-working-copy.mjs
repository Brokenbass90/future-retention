// Рабочая копия «В код» переживает деплой: снимок → стёрли → вернули.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { snapshotWorkingCopy, restoreWorkingCopy, namespacesIn } from "../src/working-copy.js";

const repo = fs.mkdtempSync(path.join(os.tmpdir(), "wc-"));
const root = path.join(repo, "email-base");
const mailDir = path.join(root, "X_preview", "mail-test-1");
fs.mkdirSync(path.join(mailDir, "app", "templates", "blocks"), { recursive: true });
fs.writeFileSync(path.join(mailDir, "app", "templates", "blocks", "header.pug"), "p ${{ ns-a.block_00 }}$\n");
fs.writeFileSync(path.join(mailDir, "studio-model.json"), "{}");
fs.mkdirSync(path.join(root, "vendor", "data", "en"), { recursive: true });
fs.writeFileSync(path.join(root, "vendor", "data", "en", "ns-a.json"), JSON.stringify({ a: 1 }));

assert.deepEqual(namespacesIn("x ${{ ns-a.block_00 }}$ ${{ footer.block_01 }}$"), ["ns-a", "footer"]);
const snap = snapshotWorkingCopy({ repoRoot: repo, mail: "mail-test-1" });
assert.equal(snap.ok, true);
assert.ok(snap.files["app/templates/blocks/header.pug"]);
assert.ok(snap.locales["ns-a"].en);

fs.rmSync(path.join(root, "X_preview"), { recursive: true });
fs.rmSync(path.join(root, "vendor", "data", "en", "ns-a.json"));
const restored = restoreWorkingCopy({ repoRoot: repo, mail: "mail-test-1", snapshot: snap });
assert.equal(restored.files, 2);
assert.equal(restored.locales, 1);
assert.ok(fs.existsSync(path.join(mailDir, "app", "templates", "blocks", "header.pug")));

// Существующее не перезаписывается; чужие пути отклоняются.
assert.equal(restoreWorkingCopy({ repoRoot: repo, mail: "mail-test-1", snapshot: snap }).files, 0);
assert.throws(() => restoreWorkingCopy({ repoRoot: repo, mail: "mail-test-1", snapshot: { mail: "mail-test-1", files: { "../../x.pug": "p" } } }));
assert.throws(() => restoreWorkingCopy({ repoRoot: repo, mail: "mail-test-1", snapshot: { mail: "mail-test-1", files: { "app/run.sh": "x" } } }));
assert.throws(() => snapshotWorkingCopy({ repoRoot: repo, mail: "../X_IQ/mail-a" }));

const wb = fs.readFileSync(new URL("../public/workbench.js", import.meta.url), "utf8");
assert.match(wb, /setupWorkingCopyKeeper/);
console.log("✓ working copy survives a deploy");
