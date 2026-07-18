import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const surfaces = [
  { name: "constructor", html: "public/constructor.html" },
  { name: "workbench", html: "public/workbench.html" },
];

function attr(source, name) {
  const match = source.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i"));
  return match ? match[1].trim() : "";
}

function labelOf(tag, inner) {
  const aria = attr(tag, "aria-label");
  if (aria) return aria;
  return String(inner || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&[a-z0-9#]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function occurrences(haystack, needle) {
  if (!needle) return 0;
  let count = 0;
  let offset = 0;
  while ((offset = haystack.indexOf(needle, offset)) >= 0) {
    count += 1;
    offset += needle.length;
  }
  return count;
}

const result = [];

for (const surface of surfaces) {
  const html = await readFile(path.join(root, surface.html), "utf8");
  const localScripts = [...html.matchAll(/<script\b[^>]*\bsrc=["']\/([^"']+\.js)["'][^>]*>/gi)]
    .map((match) => `public/${match[1]}`);
  const js = (await Promise.all(localScripts.map(async (file) => {
    try { return await readFile(path.join(root, file), "utf8"); }
    catch { return ""; }
  }))).join("\n");
  const controls = [];
  const re = /<button\b([^>]*)>([\s\S]*?)<\/button>/gi;
  let match;
  while ((match = re.exec(html))) {
    const tag = `<button${match[1]}>`;
    const id = attr(tag, "id");
    const label = labelOf(tag, match[2]);
    const title = attr(tag, "title");
    controls.push({
      id,
      label,
      title,
      delegated: /\bdata-[a-z0-9_-]+\s*=/i.test(tag),
      jsReferences: id ? occurrences(js, id) : null,
    });
  }

  const idCounts = new Map();
  for (const control of controls) {
    if (!control.id) continue;
    idCounts.set(control.id, (idCounts.get(control.id) || 0) + 1);
  }

  const dead = controls.filter((control) => control.id && !control.delegated && control.jsReferences === 0);
  const duplicateIds = [...idCounts.entries()].filter(([, count]) => count > 1);
  const ambiguous = controls.filter((control) => {
    if (control.title || control.label.length > 2) return false;
    return Boolean(control.id || control.label);
  });

  result.push({
    surface: surface.name,
    controls: controls.length,
    controlsWithId: controls.filter((control) => control.id).length,
    dead,
    duplicateIds,
    ambiguous,
  });
}

console.log(JSON.stringify(result, null, 2));

const issueCount = result.reduce((sum, surface) => (
  sum + surface.dead.length + surface.duplicateIds.length + surface.ambiguous.length
), 0);
if (issueCount > 0) process.exitCode = 1;
