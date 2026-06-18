import fs from "node:fs/promises";
import path from "node:path";
import { buildLegacyToolkitSnapshot } from "../src/legacy-toolkit-adapter.js";

const cwd = process.cwd();
const legacyRoot = process.argv[2] || process.env.LEGACY_TOOLKIT_ROOT;

if (!legacyRoot) {
  console.error("Usage: node scripts/import-legacy-toolkit.mjs /path/to/retention-tool-kit");
  process.exit(1);
}

const outputPath =
  process.argv[3] ||
  path.join(cwd, "data", "imports", "legacy-retention-tool-kit.snapshot.json");

const snapshot = await buildLegacyToolkitSnapshot(legacyRoot);

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");

console.log(`Imported legacy toolkit snapshot -> ${outputPath}`);
console.log(
  JSON.stringify(
    {
      brands: snapshot.summary.brands,
      templates: snapshot.summary.templates,
      templateTypes: snapshot.summary.templateTypes
    },
    null,
    2
  )
);
