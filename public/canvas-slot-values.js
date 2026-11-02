(function installRetkitCanvasSlotValues(root) {
  "use strict";

  const RICH_TEXT_KIND = "richtext";
  const LINE_BREAK_RE = /[\r\n]/;
  const CONTROL_SEPARATOR_RE = /[\u0000\u2028\u2029]/;

  function slotKind(slot) {
    return String(slot?.kind || "text").trim().toLowerCase() || "text";
  }

  function failure(slot, kind, code, reason) {
    const id = String(slot?.id || "unknown");
    return {
      ok: false,
      code,
      id,
      kind,
      reason,
      error: `slot "${id}" (${kind}) ${reason}`,
    };
  }

  /**
   * Normalise one constructor slot without guessing at content semantics.
   *
   * Pug slot values cannot contain physical newlines. Rich text is the one
   * intentional multiline surface, so its line endings become email-safe
   * <br> elements. All other kinds fail closed and ask the operator to use a
   * single line. NUL/U+2028/U+2029 are never valid slot data.
   */
  function normalizeSlotValue(slot, raw, options = {}) {
    const kind = slotKind(slot);
    if (raw == null) return { ok: true, value: "", kind, normalized: false };
    if (!["string", "number", "boolean"].includes(typeof raw)) {
      return failure(slot, kind, "SLOT_VALUE_TYPE", "must be a string, number or boolean");
    }

    let value = String(raw);
    if (CONTROL_SEPARATOR_RE.test(value)) {
      return failure(slot, kind, "SLOT_CONTROL_SEPARATOR", "contains a forbidden control separator");
    }
    if (!LINE_BREAK_RE.test(value)) {
      return { ok: true, value, kind, normalized: false };
    }

    if (kind === RICH_TEXT_KIND && options.allowRichTextMultiline !== false) {
      value = value.replace(/\r\n?|\n/g, "<br>");
      return {
        ok: true,
        value,
        kind,
        normalized: true,
        note: "richText line breaks were converted to <br>",
      };
    }

    return failure(
      slot,
      kind,
      "SLOT_LINE_BREAK",
      kind === RICH_TEXT_KIND
        ? "cannot contain line breaks in this source context"
        : "cannot contain line breaks; use a single line or a richText slot for paragraphs",
    );
  }

  /** Validate and normalise an update_canvas_block slots patch atomically. */
  function normalizeSlotPatch(slotDefinitions, rawPatch, options = {}) {
    if (!rawPatch || typeof rawPatch !== "object" || Array.isArray(rawPatch)) {
      return {
        ok: false,
        values: null,
        errors: [{ code: "SLOT_PATCH_TYPE", error: "slots must be an object" }],
        normalizedSlots: [],
      };
    }

    const hasSchema = Array.isArray(slotDefinitions);
    const definitions = new Map(
      (hasSchema ? slotDefinitions : [])
        .filter((slot) => slot && slot.id != null)
        .map((slot) => [String(slot.id), slot]),
    );
    const rejectUnknown = options.rejectUnknown !== false && hasSchema;
    const values = {};
    const errors = [];
    const normalizedSlots = [];

    for (const [id, raw] of Object.entries(rawPatch)) {
      const slot = definitions.get(id);
      if (!slot && rejectUnknown) {
        errors.push({
          code: "SLOT_UNKNOWN",
          id,
          error: `slot "${id}" is not declared by this block`,
        });
        continue;
      }
      const result = normalizeSlotValue(slot || { id, kind: "text" }, raw, options);
      if (!result.ok) {
        errors.push(result);
        continue;
      }
      values[id] = result.value;
      if (result.normalized) normalizedSlots.push(id);
    }

    return {
      ok: errors.length === 0,
      values: errors.length ? null : values,
      errors,
      normalizedSlots,
    };
  }

  root.RetkitCanvasSlots = Object.freeze({
    normalizeSlotValue,
    normalizeSlotPatch,
    slotKind,
  });
})(typeof globalThis !== "undefined" ? globalThis : window);
