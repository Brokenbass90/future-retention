/**
 * Classify one top-level Pug/Jade line for the constructor fallback parser.
 * A top-level `.h-N` is between sections by definition: treating it as `both`
 * made the frontend attach it to the preceding section during flat migration.
 */
export function classifyConstructorTopLevelLine(line) {
  const text = String(line || "").trim();
  const spacer = text.match(/^\.h-(\d+)\b/);
  if (spacer) {
    return {
      placement: "section",
      label: `Внешний разделитель ${spacer[1]}px`,
      category: "utility",
      dividerLevel: "outer",
    };
  }
  if (/^table\.row\.footer\b/.test(text)) {
    return { placement: "section", label: "Футер", category: "footer" };
  }
  if (/^table\.row\b/.test(text)) {
    const kind = (text.match(/\.(bgr-image|white-bg|footer)\b/) || [null, "row"])[1];
    return { placement: "section", label: `Секция (${kind})`, category: "imported" };
  }
  return { placement: "section", label: text.slice(0, 44), category: "imported" };
}
