/**
 * tools/theme-patcher.js
 *
 * Patches brand theme values (colors, logo, border-radius) into a cloned
 * email-base template's Stylus and Jade source files.
 *
 * Designed for X_AffSystem-style templates where styles live in:
 *   app/styles/helpers/variables.styl  — color variables
 *   app/styles/blocks/main.styl        — button/text/border rules
 *   app/templates/blocks/header.jade   — logo img src
 *
 * Usage:
 *   import { patchTheme, readTheme, saveTheme } from "./tools/theme-patcher.js";
 *   await patchTheme(mailRoot, theme);
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

// ─── Theme schema ─────────────────────────────────────────────────────────────
//
// {
//   brandId:          "affstore"          (kebab-case identifier)
//   primaryColor:     "#BDFF00"           button background
//   primaryTextColor: "#1A1A1A"           button label color
//   buttonRadius:     "12px"             button border-radius
//   contentRadius:    "8px"              card / container corner radius
//   textColor:        "#2E3851"          body paragraph color
//   headingColor:     "#20242F"          h1/subtitle color
//   linkColor:        "#01C689"          inline link color (defaults to primaryColor)
//   bgColor:          "#F1F2F5"          outer email background
//   borderColor:      "#E9EBEA"          card border color
//   logoUrl:          "https://..."      logo img src
// }

// ─── Patch entry points ───────────────────────────────────────────────────────

/**
 * Apply a brand theme to all style/template files inside mailRoot.
 * Returns { patched: string[], skipped: string[] }
 */
export async function patchTheme(mailRoot, theme) {
  const patched = [];
  const skipped = [];

  const mainStylPath   = path.join(mailRoot, "app", "styles", "blocks", "main.styl");
  const varsStylPath   = path.join(mailRoot, "app", "styles", "helpers", "variables.styl");
  const headerJadePath = path.join(mailRoot, "app", "templates", "blocks", "header.jade");

  // 1. Patch main.styl — buttons, text, borders
  if (existsSync(mainStylPath)) {
    const original = await readFile(mainStylPath, "utf8");
    const patched_ = patchMainStyl(original, theme);
    if (patched_ !== original) {
      await writeFile(mainStylPath, patched_, "utf8");
      patched.push("app/styles/blocks/main.styl");
    } else {
      skipped.push("app/styles/blocks/main.styl (no changes)");
    }
  }

  // 2. Patch variables.styl — color variables
  if (existsSync(varsStylPath)) {
    const original = await readFile(varsStylPath, "utf8");
    const patched_ = patchVariablesStyl(original, theme);
    if (patched_ !== original) {
      await writeFile(varsStylPath, patched_, "utf8");
      patched.push("app/styles/helpers/variables.styl");
    } else {
      skipped.push("app/styles/helpers/variables.styl (no changes)");
    }
  }

  // 3. Patch header.jade — logo URL
  if (theme.logoUrl && existsSync(headerJadePath)) {
    const original = await readFile(headerJadePath, "utf8");
    const patched_ = patchLogoUrl(original, theme.logoUrl);
    if (patched_ !== original) {
      await writeFile(headerJadePath, patched_, "utf8");
      patched.push("app/templates/blocks/header.jade");
    } else {
      skipped.push("app/templates/blocks/header.jade (no logo found to replace)");
    }
  }

  return { patched, skipped };
}

// ─── Stylus patchers ──────────────────────────────────────────────────────────

function patchMainStyl(styl, theme) {
  let out = styl;

  // Button background — table.medium-button td + table.medium-button-bot td
  if (theme.primaryColor) {
    // Matches:  table.medium-button td\n  background: #XXXXXX
    out = out.replace(
      /(table\.medium-button(?:-bot)?\s+td[^\n]*\n\s*background:\s*)([^\n]+)/g,
      (_, prefix, _old) => `${prefix}${theme.primaryColor}`
    );
    // Also patch ".text a { color #01c689 }" — inline link color
    const linkColor = theme.linkColor || theme.primaryColor;
    out = out.replace(
      /(\.text\s+a[^{]*\{[^}]*\n\s*color\s+)([^\n!]+)/,
      (_, prefix, _old) => `${prefix}${linkColor} !important`
    );
  }

  // Button text color
  if (theme.primaryTextColor) {
    // .butt { ... color #FFFFFF ... }
    out = out.replace(
      /(\.butt[^{]*\{[^}]*\n(?:\s+[^\n]*\n)*?\s*color\s+)([^\n]+)/,
      (_, prefix, _old) => `${prefix}${theme.primaryTextColor}`
    );
  }

  // Button border-radius — inside medium-button rules only
  if (theme.buttonRadius) {
    // Matches border-radius lines that are inside a medium-button context
    // Strategy: replace all border-radius inside table.medium-button blocks
    out = out.replace(
      /(table\.medium-button(?:-bot|-two)?\s+td[^\n]*(?:\n[^\n]*)*?border-radius:\s*)([^\n!]+)(!important)?/g,
      (_, prefix, _old, imp) => `${prefix}${theme.buttonRadius} ${imp || "!important"}`
    );
    // .butt border-radius
    out = out.replace(
      /(\.butt[^{]*\{[^}]*\n(?:\s+[^\n]*\n)*?\s*border-radius:\s*)([^\n!]+)(!important)?/,
      (_, prefix, _old, imp) => `${prefix}${theme.buttonRadius} ${imp || "!important"}`
    );
  }

  // Card / container border-radius (.br-full, .br-top, .br-bot, .br-top-lr, .brad-top, .brad-bot)
  if (theme.contentRadius) {
    out = out.replace(
      /(\.(?:br-full|br-top-lr|br-top|br-bot|brad-top|brad-bot|br3)\s*\n\s*border-radius\s+)([^\n]+)/g,
      (_, prefix, _old) => `${prefix}${theme.contentRadius}`
    );
    // also .brad-top / .brad-bot defined as separate properties
    out = out.replace(
      /(\.brad-top[^{]*\n\s*border-top-[a-z-]+:\s*)([^\n]+)/g,
      (_, prefix, _old) => `${prefix}${theme.contentRadius}`
    );
    out = out.replace(
      /(\.brad-bot[^{]*\n\s*border-bottom-[a-z-]+:\s*)([^\n]+)/g,
      (_, prefix, _old) => `${prefix}${theme.contentRadius}`
    );
  }

  // Body text color (.text rule)
  if (theme.textColor) {
    // .text\n  ...color: #2E3851
    out = out.replace(
      /(\.text\s*\n(?:\s+(?!a)[^\n]*\n)*?\s*color:\s*)([^\n]+)/,
      (_, prefix, _old) => `${prefix}${theme.textColor}`
    );
  }

  // Heading / subtitle color (.subtitle rule)
  if (theme.headingColor) {
    out = out.replace(
      /(\.subtitle[^{]*\n(?:\s+[^\n]*\n)*?\s*color:\s*)([^\n]+)/,
      (_, prefix, _old) => `${prefix}${theme.headingColor}`
    );
  }

  // Outer email background (table.body)
  if (theme.bgColor) {
    out = out.replace(
      /(table\.body\s*\n\s*background:\s*)([^\n]+)/,
      (_, prefix, _old) => `${prefix}${theme.bgColor}`
    );
    // html background
    out = out.replace(
      /(html\s*\n\s*background:\s*)([^\n]+)/,
      (_, prefix, _old) => `${prefix}${theme.bgColor}`
    );
  }

  // Card border color (.bg-bord variants)
  if (theme.borderColor) {
    out = out.replace(
      /(\.bg-bord[^\n]*\n\s*border[^:]*:\s*\d+px solid\s+)([^\n]+)/g,
      (_, prefix, _old) => `${prefix}${theme.borderColor}`
    );
  }

  return out;
}

function patchVariablesStyl(vars, theme) {
  let out = vars;

  // Replace $orange (primary accent) with primaryColor
  if (theme.primaryColor) {
    out = out.replace(/(\$orange\s*=\s*)([^\n]+)/, (_, prefix) => `${prefix}${theme.primaryColor}`);
  }

  // Replace $black (main text) with textColor
  if (theme.textColor) {
    out = out.replace(/(\$black\s*=\s*)([^\n]+)/, (_, prefix) => `${prefix}${theme.textColor}`);
  }

  // Replace $whitebg / $semiwhite with bgColor
  if (theme.bgColor) {
    out = out.replace(/(\$whitebg\s*=\s*)([^\n]+)/, (_, prefix) => `${prefix}${theme.bgColor}`);
  }

  return out;
}

// ─── Logo URL patcher ─────────────────────────────────────────────────────────

function patchLogoUrl(jade, logoUrl) {
  // Matches: img.logo...(src="https://...") — both Pug attr style and Jade style
  return jade.replace(
    /(img\.logo[^\n]*src=["'])([^"']+)(["'])/,
    (_, before, _old, after) => `${before}${logoUrl}${after}`
  );
}

// ─── Theme storage ────────────────────────────────────────────────────────────

const brandsDir = new URL("../data/brands/", import.meta.url).pathname;

export async function saveTheme(theme) {
  if (!theme?.brandId) throw new Error("theme.brandId is required");
  const dir = path.join(brandsDir, theme.brandId);
  await mkdir(dir, { recursive: true });
  const filePath = path.join(dir, "theme.json");
  await writeFile(filePath, JSON.stringify(theme, null, 2), "utf8");
  return filePath;
}

export async function readTheme(brandId) {
  const filePath = path.join(brandsDir, brandId, "theme.json");
  if (!existsSync(filePath)) return null;
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw);
}

export async function listThemes() {
  if (!existsSync(brandsDir)) return [];
  const { readdir } = await import("node:fs/promises");
  const dirs = await readdir(brandsDir, { withFileTypes: true });
  const themes = [];
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const t = await readTheme(d.name);
    if (t) themes.push(t);
  }
  return themes;
}

// ─── Theme validator ──────────────────────────────────────────────────────────

export function normalizeTheme(raw) {
  if (!raw || typeof raw !== "object") return null;
  const t = {
    brandId:          sanitize(raw.brandId) || "unknown",
    primaryColor:     color(raw.primaryColor),
    primaryTextColor: color(raw.primaryTextColor) || "#FFFFFF",
    buttonRadius:     radius(raw.buttonRadius) || "3px",
    contentRadius:    radius(raw.contentRadius),
    textColor:        color(raw.textColor),
    headingColor:     color(raw.headingColor),
    linkColor:        color(raw.linkColor),
    bgColor:          color(raw.bgColor),
    borderColor:      color(raw.borderColor),
    logoUrl:          url(raw.logoUrl)
  };
  // Remove null/undefined fields
  return Object.fromEntries(Object.entries(t).filter(([, v]) => v != null));
}

function color(v) {
  if (!v) return null;
  const s = String(v).trim();
  return /^#[0-9a-fA-F]{3,8}$|^rgb/.test(s) ? s : null;
}

function radius(v) {
  if (!v) return null;
  const s = String(v).trim();
  return /^\d+(\.\d+)?px$/.test(s) ? s : null;
}

function url(v) {
  if (!v) return null;
  const s = String(v).trim();
  return s.startsWith("http") ? s : null;
}

function sanitize(v) {
  if (!v) return null;
  return String(v).toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}
