#!/usr/bin/env node
/**
 * block-audit.js
 * Сканирует все .pug/.jade блоки в email-base, анализирует:
 *   - Типы блоков и их структуру
 *   - Хардкодные img URL (кандидаты на параметризацию)
 *   - Дубликаты между брендами
 *   - Токены перевода
 * Генерирует: data/block-audit-report.json
 * Запуск: node tools/block-audit.js
 */

import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { join, relative, extname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROOT = join(__dirname, "..");
const EMAIL_BASE = join(ROOT, "email-base");
const OUTPUT = join(ROOT, "data", "block-audit-report.json");

// ─── helpers ──────────────────────────────────────────────────────────────────

function walk(dir, ext = [".pug", ".jade"]) {
  const results = [];
  if (!existsSync(dir)) return results;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      // skip node_modules / _legacy / dist / vendor
      if (["node_modules", "_legacy", "dist", "vendor", "_canonical"].includes(entry.name)) continue;
      results.push(...walk(full, ext));
    } else if (ext.includes(extname(entry.name).toLowerCase())) {
      results.push(full);
    }
  }
  return results;
}

function extractImgUrls(content) {
  const urls = [];
  // Pug: img(src="https://...")  or  img.logo(src="...")
  const pugSrcRe = /src=["']([^"']+)["']/g;
  let m;
  while ((m = pugSrcRe.exec(content)) !== null) {
    const url = m[1];
    if (url.startsWith("http")) urls.push(url);
  }
  return [...new Set(urls)];
}

function extractTokens(content) {
  const tokens = [];
  const re = /\$\{\{\s*([^}]+?)\s*\}\}\$/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    tokens.push(m[1].trim());
  }
  return [...new Set(tokens)];
}

function detectBlockType(filePath, content) {
  const name = basename(filePath, extname(filePath)).toLowerCase();
  const low = content.toLowerCase();

  if (name === "header" || name.includes("header")) return "header";
  if (name === "footer" || low.includes("unsubscribe") || low.includes("terms-and")) return "footer";
  if (name === "preheader") return "preheader";
  if (name.includes("hero") || low.includes("vml-bg") || low.includes("bgcolor") && low.includes("h-406")) return "hero";
  if (name.includes("cta") || name.includes("button")) return "cta";
  if (name.includes("feature") || name.includes("benefit") || low.includes("p.number") || low.includes("list-item")) return "feature-list";
  if (low.includes("social") || low.includes("soc-icon") || low.includes("facebook") || low.includes("instagram")) return "social";
  if (low.includes("app-store") || low.includes("a-app") || low.includes("google-play") || low.includes("a-google")) return "store-badges";
  if (name.includes("image") || name.includes("banner") || (low.includes("img") && !low.includes("a-app"))) return "image";
  if (name.includes("text") || name.includes("copy") || name.includes("body")) return "text";
  if (name.includes("step") || low.includes("p.number")) return "steps";
  if (name.includes("promo") || name.includes("bonus") || low.includes("promo-code") || low.includes("risk-free")) return "promo";
  return "unknown";
}

function fingerprintBlock(content) {
  // Canonical structural fingerprint — ignore URLs and token values
  return content
    .replace(/src=["'][^"']*["']/g, 'src="__URL__"')
    .replace(/href=["'][^"']*["']/g, 'href="__URL__"')
    .replace(/\$\{\{[^}]+\}\}\$/g, "${{ __TOKEN__ }}$")
    .replace(/\s+/g, " ")
    .trim()
    .substring(0, 500); // first 500 chars of normalized content
}

function categorizeUrl(url) {
  if (/logo/i.test(url)) return "logo";
  if (/hero|top|banner|main/i.test(url)) return "hero";
  if (/bg|background/i.test(url)) return "background";
  if (/icon|social|ig\.|fb\.|tw\.|yt\./i.test(url)) return "social-icon";
  if (/app\.png|play\.png|app-store|google-play/i.test(url)) return "store-badge";
  if (/award/i.test(url)) return "award";
  return "other";
}

// ─── main ──────────────────────────────────────────────────────────────────────

console.log("🔍 Scanning email-base blocks...\n");

const allFiles = walk(EMAIL_BASE);
const blocks = [];
const urlFrequency = {}; // url → count
const fingerprintMap = {}; // fingerprint → [block entries]

for (const filePath of allFiles) {
  const rel = relative(ROOT, filePath);
  const parts = rel.split(/[\\/]/);
  // email-base / {brand} / {mailId} / app / templates / (blocks|helpers) / {file}
  if (parts.length < 7) continue;
  const brand = parts[1];
  const mailId = parts[2];
  const folder = parts[5]; // blocks or helpers

  let content;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch { continue; }

  const imgUrls = extractImgUrls(content);
  const tokens = extractTokens(content);
  const blockType = detectBlockType(filePath, content);
  const fingerprint = fingerprintBlock(content);

  const entry = {
    file: rel,
    brand,
    mailId,
    folder,
    blockType,
    imgUrls,
    imgUrlCategories: imgUrls.map(u => ({ url: u, category: categorizeUrl(u) })),
    tokenCount: tokens.length,
    tokenNamespaces: [...new Set(tokens.map(t => t.split(".")[0]))],
    lineCount: content.split("\n").length,
    hasVmlBg: content.includes("+vml-bg") || content.includes("vml-bg-fixed"),
    hasCtaButton: /table\.medium-button|table\.butt|class.*butt/.test(content),
    hasImage: imgUrls.length > 0,
    fingerprint,
  };

  blocks.push(entry);

  // Track URL frequency
  for (const url of imgUrls) {
    urlFrequency[url] = (urlFrequency[url] || 0) + 1;
  }

  // Track fingerprint duplicates
  if (!fingerprintMap[fingerprint]) fingerprintMap[fingerprint] = [];
  fingerprintMap[fingerprint].push({ brand, mailId, file: rel, blockType });
}

// ─── Duplicate analysis ────────────────────────────────────────────────────────

const duplicateGroups = Object.entries(fingerprintMap)
  .filter(([, files]) => files.length > 1)
  .sort((a, b) => b[1].length - a[1].length)
  .map(([fingerprint, files]) => ({
    count: files.length,
    blockType: files[0].blockType,
    brands: [...new Set(files.map(f => f.brand))],
    files: files.map(f => f.file),
  }));

// ─── URL analysis ──────────────────────────────────────────────────────────────

const topUrls = Object.entries(urlFrequency)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 40)
  .map(([url, count]) => ({ url, count, category: categorizeUrl(url) }));

const uniqueUrls = Object.keys(urlFrequency).length;
const parameterizableCandidates = Object.entries(urlFrequency)
  .filter(([url, count]) => count >= 3)
  .map(([url, count]) => ({ url, count, category: categorizeUrl(url) }))
  .sort((a, b) => b.count - a.count);

// ─── Block type summary ────────────────────────────────────────────────────────

const byType = {};
const byBrand = {};
for (const b of blocks) {
  byType[b.blockType] = (byType[b.blockType] || 0) + 1;
  if (!byBrand[b.brand]) byBrand[b.brand] = { total: 0, types: {} };
  byBrand[b.brand].total++;
  byBrand[b.brand].types[b.blockType] = (byBrand[b.brand].types[b.blockType] || 0) + 1;
}

// ─── Missing block types (what exists vs what would be ideal) ──────────────────

const desiredBlockTypes = [
  "header", "hero", "text", "feature-list", "cta", "promo",
  "steps", "image", "social", "store-badges", "footer",
  "countdown", "market-scan", "two-col-features", "quote"
];

const presentTypes = new Set(Object.keys(byType));
const missingBlockTypes = desiredBlockTypes.filter(t => !presentTypes.has(t));
const missingTypes = missingBlockTypes;

// ─── Brands missing key blocks ──────────────────────────────────────────────────

const criticalBlocks = ["header", "footer", "cta"];
const brandsMissingCritical = {};
for (const [brand, data] of Object.entries(byBrand)) {
  const missing = criticalBlocks.filter(t => !data.types[t]);
  if (missing.length > 0) brandsMissingCritical[brand] = missing;
}

// ─── Report ────────────────────────────────────────────────────────────────────

const report = {
  generatedAt: new Date().toISOString(),
  summary: {
    totalFiles: blocks.length,
    totalBrands: Object.keys(byBrand).length,
    totalUniqueUrls: uniqueUrls,
    duplicateGroups: duplicateGroups.length,
    blocksByType: byType,
    blocksByBrand: Object.fromEntries(
      Object.entries(byBrand).map(([k, v]) => [k, v.total])
    ),
  },
  missingBlockTypes,
  brandsMissingCritical,
  duplicateGroups: duplicateGroups.slice(0, 30), // top 30
  parameterizableCandidates, // URLs appearing 3+ times → replace with variable
  topImageUrls: topUrls,
  blocks: blocks.map(b => ({
    file: b.file,
    brand: b.brand,
    mailId: b.mailId,
    blockType: b.blockType,
    hasImage: b.hasImage,
    hasVmlBg: b.hasVmlBg,
    hasCtaButton: b.hasCtaButton,
    tokenCount: b.tokenCount,
    imgUrlCount: b.imgUrls.length,
    imgUrlCategories: b.imgUrlCategories.map(u => u.category),
    lineCount: b.lineCount,
  })),
};

writeFileSync(OUTPUT, JSON.stringify(report, null, 2), "utf-8");

// ─── Console summary ───────────────────────────────────────────────────────────

console.log("═══════════════════════════════════════════");
console.log("         BLOCK AUDIT REPORT SUMMARY");
console.log("═══════════════════════════════════════════\n");

console.log(`📁 Total block files scanned:  ${blocks.length}`);
console.log(`🏢 Brands:                     ${Object.keys(byBrand).length}`);
console.log(`🖼  Unique image URLs:          ${uniqueUrls}`);
console.log(`♻️  Duplicate block groups:     ${duplicateGroups.length}\n`);

console.log("── Block types ──────────────────────────────");
for (const [type, count] of Object.entries(byType).sort((a, b) => b[1] - a[1])) {
  const bar = "█".repeat(Math.min(Math.round(count / 2), 30));
  console.log(`  ${type.padEnd(18)} ${String(count).padStart(3)}  ${bar}`);
}

console.log("\n── Blocks per brand ─────────────────────────");
for (const [brand, data] of Object.entries(byBrand)) {
  console.log(`  ${brand.padEnd(28)} ${data.total} blocks`);
}

console.log("\n── Missing block types (not found in any brand) ──");
if (missingTypes.length === 0) {
  console.log("  ✅ All desired block types are present");
} else {
  for (const t of missingTypes) console.log(`  ❌ ${t}`);
}

console.log("\n── Brands missing critical blocks ────────────");
if (Object.keys(brandsMissingCritical).length === 0) {
  console.log("  ✅ All brands have header + footer + cta");
} else {
  for (const [brand, missing] of Object.entries(brandsMissingCritical)) {
    console.log(`  ⚠️  ${brand}: missing ${missing.join(", ")}`);
  }
}

console.log(`\n── Top parameterizable URLs (appear 3+ times) ──`);
console.log(`  ${parameterizableCandidates.length} URLs are candidates for variable replacement:`);
for (const { url, count, category } of parameterizableCandidates.slice(0, 15)) {
  const short = url.length > 60 ? url.substring(0, 57) + "..." : url;
  console.log(`  [${category.padEnd(12)}] ×${count}  ${short}`);
}

if (duplicateGroups.length > 0) {
  console.log(`\n── Top duplicate block groups ────────────────`);
  for (const g of duplicateGroups.slice(0, 8)) {
    console.log(`  [${g.blockType.padEnd(14)}] ×${g.count} copies — brands: ${g.brands.join(", ")}`);
  }
}

console.log(`\n✅ Full report saved to: data/block-audit-report.json`);
console.log(`   (${blocks.length} blocks × ${Object.keys(byBrand).length} brands documented)\n`);
