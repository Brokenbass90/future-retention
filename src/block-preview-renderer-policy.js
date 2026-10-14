/**
 * Pure policies shared by the block-preview renderer and its unit tests.
 * Keep these functions browser/Node agnostic: contentSamplingRect is
 * serialized into the page by scripts/render-block-previews.mjs.
 */

/**
 * Return the horizontal content bounds relative to the screenshot clip.
 * The result is always a non-empty rectangle inside the email column.
 */
export function contentSamplingRect(left, right, column) {
  const width = Math.max(1, Math.floor(Number(column?.width) || 0));
  const origin = Number(column?.x) || 0;
  const start = Math.max(0, Math.min(width - 1, Math.floor(Number(left) - origin)));
  const end = Math.max(start + 1, Math.min(width, Math.ceil(Number(right) - origin)));
  return { dx: start, width: end - start };
}

/**
 * Find stale preview entries that may be pruned by the current render scope.
 * A source-specific run owns only that source; --only owns no complete source
 * and therefore must never remove entries.
 */
export function previewKeysToPrune(index, library, { source = "all", only = null } = {}) {
  if (only) return [];
  const alive = new Set((library || []).map((block) => `${block.source}:${block.id}`));
  return Object.keys(index?.blocks || {}).filter((key) => {
    const entrySource = String(key).split(":", 1)[0];
    const inScope = source === "all" || entrySource === source;
    return inScope && !alive.has(key);
  });
}
