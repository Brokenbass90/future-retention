#!/usr/bin/env node
/**
 * Бренд × набор: в IQ Broker × System каталог и письмо не должны показывать
 * IQ Option. Универсальные (системные) блоки перекрашиваются темой бренда,
 * логотип берут из ресурсов бренда, превью снимаются под каждый бренд.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import url from "node:url";
import { loadBrands } from "../src/brands.js";
import { resolveBlockSlotValues } from "../src/compose-email.js";
import { previewKeysToPrune } from "../src/block-preview-renderer-policy.js";

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const read = (...p) => readFileSync(path.join(root, ...p), "utf8");
let pass = 0;
const ok = (name, fn) => { fn(); pass += 1; console.log("✓", name); };

const brands = loadBrands();
const iq = brands.find((b) => b.id === "X_IQ");
const br = brands.find((b) => b.id === "X_IQBroker");

ok("у брендов есть логотипы", () => {
  assert.match(iq.assets.logo, /^https:\/\//);
  assert.match(br.assets.logo, /logo-broker/);
  assert.notEqual(iq.assets.logo, br.assets.logo);
});

const sysLogo = JSON.parse(read("data", "block-library", "canonical", "sys-logo.json"));
ok("системный логотип берёт картинку из бренда", () => {
  const image = sysLogo.slots.find((s) => s.id === "image");
  assert.equal(image.brandAsset, "logo");
  assert.ok(image.options.some((o) => /logo-broker/.test(o.value)), "логотип IQ Broker есть в выборе");
});

ok("сборка подставляет логотип бренда, но не поверх явного значения", () => {
  const forBroker = resolveBlockSlotValues(sysLogo, {}, { brandAssets: br.assets });
  assert.equal(forBroker.image, br.assets.logo);
  assert.equal(forBroker.alt, "IQ Broker");
  const explicit = resolveBlockSlotValues(sysLogo, { image: iq.assets.logo }, { brandAssets: br.assets });
  assert.equal(explicit.image, iq.assets.logo);
  const noBrand = resolveBlockSlotValues(sysLogo, {});
  assert.equal(noBrand.image, sysLogo.slots.find((s) => s.id === "image").default);
});

ok("цвета системных кнопок и линии — по теме бренда", () => {
  const two = JSON.parse(read("data", "block-library", "canonical", "sys-two-buttons.json"));
  for (const id of ["primary_background", "secondary_background", "secondary_border", "secondary_text_color"]) {
    assert.equal(two.slots.find((s) => s.id === id).default, "", id);
  }
  assert.match(two.styl, /\.sys-two-buttons--alt-link\{color:\$brand_text\}/);
  const divider = JSON.parse(read("data", "block-library", "canonical", "sys-divider.json"));
  assert.equal(divider.slots.find((s) => s.id === "color").default, "");
});

ok("превью под бренд не считается сиротой", () => {
  const index = { blocks: {
    "canonical:sys-logo": {}, "canonical:sys-logo@iqbroker": {}, "canonical:gone@iqbroker": {},
  } };
  const library = [{ source: "canonical", id: "sys-logo" }];
  assert.deepEqual(previewKeysToPrune(index, library), ["canonical:gone@iqbroker"]);
});

ok("конструктор показывает превью под активный бренд", () => {
  const js = read("public", "constructor.js");
  assert.match(js, /function brandedPreview\(b\)/);
  assert.match(js, /function catalogThumbMarkup\(b\) \{\n  const p = brandedPreview\(b\);/);
  assert.match(js, /slot\?\.brandAsset \? brandAssets\[slot\.brandAsset\]/);
});

ok("ассет-чипс убран из каталога", () => {
  const chip = JSON.parse(read("data", "block-library", "canonical", "iq-asset-chip.json"));
  assert.equal(chip.retired, true);
});

ok("системный набор пока только у IQ Option — у IQ Broker × System пусто", () => {
  const dir = path.join(root, "data", "block-library", "canonical");
  const sys = readdirSync(dir).filter((f) => /^sys-.*\.json$/.test(f)).map((f) => JSON.parse(readFileSync(path.join(dir, f), "utf8")));
  assert.ok(sys.length > 0);
  for (const block of sys) assert.ok((block.tags || []).includes("iq"), `${block.id} помечен брендом iq`);
});

ok("старые хедеры и футер-соцсети убраны, вместо них новые блоки", () => {
  const get = (id) => JSON.parse(read("data", "block-library", "canonical", `${id}.json`));
  for (const id of ["iq-combo-hero-bgr", "iq-combo-hero-space", "iq-footer-socials"]) assert.equal(get(id).retired, true, id);
  for (const id of ["iq-combo-hero-scene", "iq-combo-card-panel-list", "iq-combo-promo-card"]) {
    const combo = get(id);
    assert.equal(combo.combo, true, id);
    assert.ok(combo.children.every((child) => !get(child.id).retired), `${id}: в рецепте нет убранных блоков`);
  }
  assert.ok(get("iq-combo-store-footer").children.some((c) => c.id === "iq-socials-row"));
});

ok("соцсети IQ Option берут ссылки из локали (socials-3)", () => {
  const row = JSON.parse(read("data", "block-library", "canonical", "iq-socials-row.json"));
  const link = (k) => row.slots.find((s) => s.id === `link_${k}`).default;
  assert.equal(link("telegram"), "${{ socials-3.block_05 }}$");
  const ar = JSON.parse(read("email-base", "vendor", "data", "ar", "socials-3.json"));
  const en = JSON.parse(read("email-base", "vendor", "data", "en", "socials-3.json"));
  assert.match(ar.block_05, /arabchat/);
  assert.match(en.block_05, /globalchat/);
});

console.log(`\nbrand-system-kit: ${pass} ok, 0 fail`);
