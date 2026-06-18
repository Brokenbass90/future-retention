/**
 * RetKit Figma plugin — serialize the selected frame into the studio's
 * structured-import contract (see src/figma-contract.js) so a CLOSED company
 * Figma can feed the studio WITHOUT the REST API: the plugin runs inside Figma
 * with the user's own access, reads the selection, and emits JSON the user
 * pastes into the studio (or sends directly).
 *
 * Output shape (consumed by src/design-schema.js → buildInternalDesignSchema):
 *   {
 *     source: "figma-plugin",
 *     fileKey, nodeId, selectionName, pageName,
 *     frameSize: { width, height },
 *     styles:  { bgColor, textColor, headingColor, linkColor, primaryColor,
 *                primaryTextColor, buttonRadius, contentRadius, borderColor, fontFamily },
 *     sections: [{ id, role, name, x, y, width, height, style:{ bgColor, radius } }],
 *     texts:    [{ id, roleHint, text, x, y, width, height, fontFamily, fontSize,
 *                  fontWeight, color, sectionId }],
 *     images:   [{ id, roleHint, name, x, y, width, height, sectionId, alt }],
 *     componentNames: [...],
 *     previewImage: { mimeType, dataUrl }
 *   }
 */

const SECTION_ROLE_PATTERNS = [
  { role: "header", re: /(header|logo|brand|top\s*bar|topbar|nav)/i },
  { role: "footer", re: /(footer|legal|unsubscribe|terms|social|badge|store)/i },
  { role: "hero", re: /(hero|banner|masthead|cover|promo)/i },
  { role: "cta", re: /(cta|button|call\s*to\s*action|sign\s*up)/i },
  { role: "feature-list", re: /(feature|grid|benefit|items|columns?|list)/i },
  { role: "image", re: /(image|illustration|visual|screenshot|device|phone|picture)/i },
  { role: "text", re: /(text|copy|content|body|card|message|paragraph)/i },
];

function roleFromName(name, fallback) {
  for (const { role, re } of SECTION_ROLE_PATTERNS) if (re.test(name || "")) return role;
  return fallback || "unknown";
}

function toHex(c) {
  if (!c) return "";
  const h = (v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, "0");
  return ("#" + h(c.r) + h(c.g) + h(c.b)).toUpperCase();
}

function solidFill(node) {
  const fills = node && node.fills;
  if (!Array.isArray(fills)) return null;
  const s = fills.find((f) => f.type === "SOLID" && f.visible !== false);
  return s ? toHex(s.color) : null;
}

function hasImageFill(node) {
  const fills = node && node.fills;
  return Array.isArray(fills) && fills.some((f) => f.type === "IMAGE" && f.visible !== false);
}

function bbox(node) {
  const b = node.absoluteBoundingBox || {};
  return { x: Math.round(b.x || 0), y: Math.round(b.y || 0), width: Math.round(b.width || 0), height: Math.round(b.height || 0) };
}

function contains(outer, inner) {
  return inner.x >= outer.x - 1 && inner.y >= outer.y - 1 &&
         (inner.x + inner.width) <= (outer.x + outer.width) + 1 &&
         (inner.y + inner.height) <= (outer.y + outer.height) + 1;
}

function looksLikeButton(node) {
  if (/(button|cta|btn)/i.test(node.name || "")) return true;
  // A small container with a solid fill, rounded corners and a single text child.
  const r = (typeof node.cornerRadius === "number") ? node.cornerRadius : 0;
  return r >= 6 && solidFill(node) && node.height && node.height < 80;
}

async function buildPayload() {
  const sel = figma.currentPage.selection[0];
  if (!sel) return { error: "Выдели один фрейм письма и запусти плагин снова." };

  const root = sel;
  const rootBox = bbox(root);

  // ── Sections: direct container children of the root frame. ──────────────
  const containerTypes = new Set(["FRAME", "GROUP", "COMPONENT", "INSTANCE", "SECTION"]);
  let sectionNodes = (root.children || []).filter((n) => containerTypes.has(n.type));
  if (sectionNodes.length === 0) sectionNodes = [root]; // single-section fallback

  const sections = sectionNodes.map((n, i) => {
    const b = bbox(n);
    return {
      node: n, box: b,
      out: {
        id: "sec_" + String(i + 1).padStart(2, "0"),
        role: roleFromName(n.name, i === 0 ? "header" : "text"),
        name: n.name || "",
        x: b.x, y: b.y, width: b.width, height: b.height,
        style: { bgColor: solidFill(n) || "", radius: (typeof n.cornerRadius === "number" ? n.cornerRadius : 0) },
      },
    };
  });

  const sectionOf = (b) => {
    const hit = sections.find((s) => contains(s.box, b));
    return hit ? hit.out.id : (sections[0] ? sections[0].out.id : "");
  };

  // ── Texts ───────────────────────────────────────────────────────────────
  const textNodes = (root.findAllWithCriteria
    ? root.findAllWithCriteria({ types: ["TEXT"] })
    : root.findAll((n) => n.type === "TEXT"));
  let maxFont = 0;
  const texts = textNodes.map((t, i) => {
    const b = bbox(t);
    const fs = typeof t.fontSize === "number" ? t.fontSize : 0;
    if (fs > maxFont) maxFont = fs;
    const parentIsButton = t.parent && looksLikeButton(t.parent);
    const family = (t.fontName && t.fontName.family) || "";
    return {
      _fs: fs, _btn: parentIsButton,
      out: {
        id: "txt_" + String(i + 1).padStart(2, "0"),
        roleHint: parentIsButton ? "cta" : "body", // refined below for headings
        text: t.characters || "",
        x: b.x, y: b.y, width: b.width, height: b.height,
        fontFamily: family,
        fontSize: Math.round(fs),
        fontWeight: typeof t.fontWeight === "number" ? t.fontWeight : 400,
        color: solidFill(t) || "",
        sectionId: sectionOf(b),
      },
    };
  });
  // Largest text(s) → heading.
  for (const t of texts) {
    if (!t._btn && t._fs >= Math.max(20, maxFont * 0.8)) t.out.roleHint = "heading";
  }

  // ── Images ────────────────────────────────────────────────────────────────
  const imageNodes = root.findAll((n) =>
    hasImageFill(n) || /(logo|image|icon|badge|illustration|photo|picture)/i.test(n.name || ""));
  const images = imageNodes.slice(0, 40).map((n, i) => {
    const b = bbox(n);
    return {
      id: "img_" + String(i + 1).padStart(2, "0"),
      roleHint: roleFromName(n.name, "section"),
      name: n.name || "",
      x: b.x, y: b.y, width: b.width, height: b.height,
      sectionId: sectionOf(b),
      alt: n.name || "",
    };
  });

  // ── Style tokens (exact, from the design) ───────────────────────────────
  const headings = texts.filter((t) => t.out.roleHint === "heading");
  const bodies = texts.filter((t) => t.out.roleHint === "body");
  const ctas = texts.filter((t) => t.out.roleHint === "cta");
  const buttonNode = root.findAll((n) => looksLikeButton(n))[0] || null;
  // Dominant font family among text nodes.
  const famCount = {};
  for (const t of texts) if (t.out.fontFamily) famCount[t.out.fontFamily] = (famCount[t.out.fontFamily] || 0) + 1;
  const fontFamily = Object.keys(famCount).sort((a, b) => famCount[b] - famCount[a])[0] || "";

  const styles = {
    bgColor: solidFill(root) || "",
    textColor: (bodies[0] && bodies[0].out.color) || "",
    headingColor: (headings[0] && headings[0].out.color) || "",
    linkColor: "",
    primaryColor: (buttonNode && solidFill(buttonNode)) || "",
    primaryTextColor: (ctas[0] && ctas[0].out.color) || "#FFFFFF",
    buttonRadius: buttonNode && typeof buttonNode.cornerRadius === "number" ? (buttonNode.cornerRadius + "px") : "",
    contentRadius: sections[0] && sections[0].out.style.radius ? (sections[0].out.style.radius + "px") : "",
    borderColor: "",
    fontFamily,
  };

  // ── Preview PNG (best effort) ───────────────────────────────────────────
  let previewImage = null;
  try {
    const bytes = await root.exportAsync({ format: "PNG", constraint: { type: "SCALE", value: 1 } });
    previewImage = { mimeType: "image/png", dataUrl: "data:image/png;base64," + figma.base64Encode(bytes) };
  } catch (e) { /* export may be blocked; non-fatal */ }

  return {
    source: "figma-plugin",
    fileKey: figma.fileKey || "",
    nodeId: root.id,
    selectionName: root.name || "",
    pageName: figma.currentPage.name || "",
    frameSize: { width: rootBox.width, height: rootBox.height },
    styles,
    sections: sections.map((s) => s.out),
    texts: texts.map((t) => t.out),
    images,
    componentNames: Array.from(new Set(sectionNodes.map((n) => n.name).filter(Boolean))),
    directionHint: "ltr",
    previewImage,
  };
}

figma.showUI(__html__, { width: 420, height: 520 });

async function run() {
  const payload = await buildPayload();
  figma.ui.postMessage(payload);
}
run();

figma.ui.onmessage = (msg) => {
  if (msg && msg.type === "rebuild") run();
  if (msg && msg.type === "close") figma.closePlugin();
  if (msg && msg.type === "notify") figma.notify(msg.text || "");
};
