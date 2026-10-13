/**
 * src/canvas-summary.js — дерево холста конструктора в том виде, в каком его
 * видят инструменты оператора (ai-tools.js). Один источник и для оператора
 * студии, и для своего агента по ссылке: разойтись они не должны.
 */
export function canvasSummaryFrom(canvas) {
  return (Array.isArray(canvas) ? canvas : []).slice(0, 400).map((entry, index) => ({
    index,
    uid: entry?.uid ?? null,
    blockId: entry?.blockId || entry?.id || null,
    source: entry?.blockSource || entry?.source || null,
    parentUid: entry?.parentUid ?? null,
    slotId: entry?.slotId ?? null,
    slots: entry?.slots && typeof entry.slots === "object"
      ? Object.fromEntries(Object.entries(entry.slots).slice(0, 12)
        .map(([k, v]) => [k, String(v ?? "").slice(0, 120)]))
      : {},
    slotSchema: Array.isArray(entry?.slotSchema)
      ? entry.slotSchema.slice(0, 40).map((slot) => ({
        id: String(slot?.id || "").slice(0, 128),
        kind: String(slot?.kind || "text").slice(0, 32),
        label: String(slot?.label || slot?.id || "").slice(0, 160),
        ...(Array.isArray(slot?.options)
          ? { options: slot.options.slice(0, 50).map((value) => String(value).slice(0, 160)) }
          : {}),
      })).filter((slot) => slot.id)
      : undefined,
  }));
}
