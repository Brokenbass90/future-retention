/**
 * src/design-compose.js — the "last mile" of the design→email pipeline.
 *
 * Upstream we already turn a Figma import (or screenshot analysis) into a
 * normalized `schema` (src/design-schema.js): ordered sections with roles,
 * text nodes, image slots, and exact style `tokens` (colors, radii, font).
 * What was missing: turning that schema into a CONCRETE block-assembly plan —
 * `[{ id, slots }]` that composeEmailFromBlocks() can build directly.
 *
 * This module does exactly that, deterministically and with zero AI:
 *   - maps each section's role → a canonical SECTION block of the right category
 *   - fills that block's CONTENT slots (text / richText / url / image) from the
 *     section's own text nodes and image slots (matched by sectionId)
 *   - collects the exact style tokens so the caller can apply them
 *
 * IMPORTANT — style transfer gap:
 *   The canonical blocks currently expose only CONTENT slots; they have no
 *   color/radius/font slots, so exact Figma styles (bgColor, primaryColor,
 *   buttonRadius, fontFamily) have nowhere to land yet. We surface them in
 *   `styleTokens` and set `styleSlotGap: true` so the studio/UI can flag that
 *   pixel-exact styling needs blocks with style slots (or a theme layer).
 *   This keeps the function honest instead of silently dropping the styles.
 */

import { listCanonicalBlocks } from "./compose-email.js";

// Section role → canonical block category. Roles come from design-schema's
// SECTION_ROLES set.
const ROLE_TO_CATEGORY = {
  header: "header",
  hero: "hero",
  text: "text",
  cta: "cta",
  "feature-list": "feature-list",
  image: "image",
  footer: "footer",
};

// When several section blocks share a category, prefer these ids.
const PREFERRED_BLOCK_BY_CATEGORY = {
  hero: "iq-combo-hero-233",
  cta: "iq-combo-promo-steps",
  footer: "iq-footer",
};

function clean(v) { return typeof v === "string" ? v.trim() : ""; }

function pickSectionBlock(sectionBlocks, category) {
  const inCat = sectionBlocks.filter((b) => clean(b.category) === category);
  if (!inCat.length) return null;
  const preferred = PREFERRED_BLOCK_BY_CATEGORY[category];
  return inCat.find((b) => b.id === preferred) || inCat[0];
}

function pxToNumber(v) {
  const n = parseInt(String(v || "").replace(/[^\d.-]/g, ""), 10);
  return Number.isFinite(n) ? n : null;
}

// Map an exact design style token onto a block STYLE slot (color / number),
// by the slot's id. Returns a value or null when nothing applies.
function styleValueForSlot(slotId, kind, sectionStyle, tokens) {
  const id = slotId.toLowerCase();
  const t = tokens || {};
  const s = sectionStyle || {};
  if (kind === "color") {
    if (/button/.test(id) && /(text|color)/.test(id)) return t.primaryTextColor || t.textColor || null;
    if (/button/.test(id) && /(bg|background)/.test(id)) return t.primaryColor || t.bgColor || null;
    if (/(bg|background)/.test(id)) return s.bgColor || t.bgColor || t.primaryColor || null;
    if (/(title|heading)/.test(id)) return t.headingColor || t.textColor || null;
    if (/(subtitle|sub)/.test(id)) return t.textColor || null;
    if (/(link)/.test(id)) return t.linkColor || null;
    if (/(text|color|fg)/.test(id)) return t.textColor || null;
    if (/(border)/.test(id)) return s.borderColor || t.borderColor || null;
    return null;
  }
  if (kind === "number") {
    if (/button/.test(id) && /radius/.test(id)) return pxToNumber(t.buttonRadius);
    if (/radius/.test(id)) return pxToNumber(s.radius || t.contentRadius || t.buttonRadius);
    return null;
  }
  return null;
}

// Decide which text node feeds which slot, by slot id + text roleHint.
// Also fills STYLE slots (color/number) from the design's section style + tokens.
function fillSlots(block, texts, images, sectionStyle, tokens) {
  const slots = {};
  let styleSlotsFilled = 0;
  const usedTextIds = new Set();
  const headings = texts.filter((t) => t.roleHint === "heading");
  const bodies = texts.filter((t) => t.roleHint === "body");
  const ctas = texts.filter((t) => t.roleHint === "cta");
  const others = texts.filter((t) => !["heading", "body", "cta"].includes(t.roleHint));

  const takeFrom = (pools) => {
    for (const pool of pools) {
      const n = pool.find((t) => !usedTextIds.has(t.id) && clean(t.text));
      if (n) { usedTextIds.add(n.id); return n; }
    }
    return null;
  };

  const imageUrl = (img) => img && (img.assetSource?.url || img.assetSource?.dataUrl || img.url);
  const imageLooksLike = (img, role) => {
    const hint = [img?.roleHint, img?.name, img?.alt, img?.id].map(clean).join(" ").toLowerCase();
    return hint.includes(role);
  };
  const imageForSlot = (id) => {
    let img = null;
    if (/logo/.test(id)) img = images.find((candidate) => imageUrl(candidate) && imageLooksLike(candidate, "logo"));
    else if (/(?:hero|head|banner|image|asset)/.test(id)) {
      img = images.find((candidate) => imageUrl(candidate) && !imageLooksLike(candidate, "logo"));
    }
    if (!img && !/logo/.test(id)) img = images.find((candidate) => imageUrl(candidate));
    return img;
  };
  const firstImageUrl = (id) => {
    const img = imageForSlot(id);
    return img ? (img.assetSource?.url || img.assetSource?.dataUrl || img.url) : null;
  };
  const firstImageAlt = (id) => {
    const img = imageForSlot(id) || images.find((i) => clean(i.alt));
    return img ? clean(img.alt) : null;
  };

  for (const slot of block.slots || []) {
    const id = clean(slot.id).toLowerCase();
    const kind = clean(slot.kind) || "text";
    if (kind === "image") {
      const url = firstImageUrl(id);
      if (url) slots[slot.id] = url;
      continue;
    }
    if (kind === "url") {
      // Brand/logo links keep their default; CTA links get a placeholder href.
      if (/cta|button|action/.test(id)) slots[slot.id] = ctas[0]?.href || "{{ cta_url }}";
      continue;
    }
    if (kind === "color" || kind === "number") {
      const sv = styleValueForSlot(id, kind, sectionStyle, tokens);
      if (sv != null && clean(String(sv)) !== "") { slots[slot.id] = sv; styleSlotsFilled += 1; }
      continue;
    }
    if (kind === "select") continue;
    // text / richText
    let node = null;
    if (/alt/.test(id)) { const a = firstImageAlt(id); if (a) slots[slot.id] = a; continue; }
    if (/(?:^|_)(?:cta|button|action)(?:_label|_text)?$/.test(id) || /(?:cta|button|action)_label/.test(id)) {
      node = takeFrom([ctas]);
    } else if (/(?:^|_)(?:title|heading|headline)(?:_|$)/.test(id)) {
      node = takeFrom([headings, others]);
    } else if (/(?:^|_)(?:body|copy|text|paragraph|description|desc)(?:_|$)/.test(id)) {
      node = takeFrom([bodies, others]);
    } else if (/(?:^|_)(?:date|eyebrow|kicker)(?:_|$)/.test(id)) {
      node = takeFrom([others]);
    } else {
      // Product-specific labels/codes/step numbers keep their canonical
      // defaults. Do not consume a heading or CTA merely because the slot id
      // contains the generic word "label".
      node = takeFrom([others]);
    }
    if (node) slots[slot.id] = clean(node.text);
  }
  return { slots, styleSlotsFilled };
}

/**
 * Build a concrete compose plan from a normalized design schema.
 *
 * @param {object} args
 * @param {object} args.schema   Result of buildInternalDesignSchema().
 * @param {Array}  [args.library] Canonical/user blocks (defaults to canonical).
 * @returns {{
 *   plan: Array<{id:string, slots:object}>,
 *   sections: Array<object>,
 *   styleTokens: object,
 *   styleSlotGap: boolean,
 *   warnings: string[]
 * }}
 */
export function buildComposePlanFromDesign({ schema, library = null } = {}) {
  if (!schema || typeof schema !== "object") {
    return { plan: [], sections: [], styleTokens: {}, styleSlotGap: false, warnings: ["no schema"] };
  }
  const blocks = (Array.isArray(library) ? library : listCanonicalBlocks())
    // Imported slices are historical campaign fragments. They can depend on
    // foreign CSS, assets and parent tables, so deterministic design compose
    // must never pick one merely because its category happens to match.
    .filter((block) => block?.source === "canonical");
  const sectionBlocks = blocks.filter((b) => clean(b.placement) === "section");
  const allTexts = Array.isArray(schema.textNodes) ? schema.textNodes : [];
  const allImages = Array.isArray(schema.imageSlots) ? schema.imageSlots : [];
  const sections = Array.isArray(schema.sections) ? schema.sections : [];

  const plan = [];
  const perSection = [];
  const warnings = [];
  let unmatched = 0;
  let totalStyleSlotsFilled = 0;
  // Pools for text/images that aren't bound to a section id — consumed in order.
  const looseTexts = allTexts.filter((t) => !clean(t.sectionId));
  let looseCursor = 0;

  for (const section of sections) {
    const role = clean(section.role) || "unknown";
    const category = ROLE_TO_CATEGORY[role];
    const block = category ? pickSectionBlock(sectionBlocks, category) : null;

    // Gather this section's content (by sectionId, then fall back to loose pool).
    let texts = allTexts.filter((t) => clean(t.sectionId) === clean(section.id));
    if (!texts.length && looseTexts.length) {
      texts = looseTexts.slice(looseCursor, looseCursor + 2);
      looseCursor += texts.length;
    }
    const images = allImages.filter((i) => clean(i.sectionId) === clean(section.id));

    if (!block) {
      unmatched += 1;
      perSection.push({ sectionId: section.id, role, blockId: null, status: "no-canonical-block" });
      warnings.push(`section "${section.id}" (role ${role}) has no canonical section block — needs a block candidate`);
      continue;
    }
    const { slots, styleSlotsFilled } = fillSlots(block, texts, images, section.style || {}, schema.tokens);
    totalStyleSlotsFilled += styleSlotsFilled;
    plan.push({ id: block.id, slots });
    perSection.push({ sectionId: section.id, role, blockId: block.id, status: "mapped", filledSlots: Object.keys(slots).length, styleSlotsFilled });
  }

  const styleTokens = schema.tokens && typeof schema.tokens === "object" ? schema.tokens : {};
  const hasStyleTokens = Object.values(styleTokens).some((v) => clean(String(v)));

  if (!plan.length) warnings.push("no sections mapped to blocks — plan is empty");
  if (unmatched) warnings.push(`${unmatched} section(s) unmapped`);
  if (hasStyleTokens && totalStyleSlotsFilled === 0) {
    warnings.push("design has exact style tokens but matched blocks expose no style slots — add style slots (bg/text/radius/font) to absorb them");
  }

  return {
    plan,
    sections: perSection,
    styleTokens,
    styleSlotsFilled: totalStyleSlotsFilled,
    // True only when the design carries exact styles AND no block could absorb
    // them. Once blocks expose style slots and we fill them, the gap is closed.
    styleSlotGap: hasStyleTokens && totalStyleSlotsFilled === 0,
    warnings,
  };
}
