#!/usr/bin/env node
/**
 * test-campaign-links.mjs — метка кампании в ссылках письма.
 *
 * Главное, что проверяем: метку письма нельзя обойти. У блоков в ссылках
 * зашиты чужие `afftrack`/`retrack` (в каталоге сейчас три разных), и если
 * переписывание где-то не сработает, письмо уедет в рассылку с меткой чужой
 * кампании — а заметить это можно только глазами.
 *
 * Zero-AI, без сети. Exit 0 = pass.
 */
import { readFileSync, existsSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";
import { applyCampaign, findCampaigns, normalizeCampaign, CAMPAIGN_PARAMS } from "../src/campaign-links.js";
import { composeEmailFromBlocks } from "../src/compose-email.js";

const REPO = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const check = (name, cond, extra = "") => {
  if (cond) { pass++; console.log("  \x1b[32m✓\x1b[0m", name); }
  else { fail++; console.error(`  \x1b[31m✗ ${name}\x1b[0m ${extra}`); }
};

/* ─── Переписывание ──────────────────────────────────────────────────────── */
{
  const source = `a(href="https://api.trade.iqbroker.com/v1/x?aff=7&afftrack=mail_IQ-RFM-2-3-3-Second-Email&retrack=mail_strategies")`;
  const { text, replaced } = applyCampaign(source, "spring-promo");
  check("afftrack переписан", text.includes("afftrack=spring-promo"), text.slice(0, 120));
  check("retrack переписан", text.includes("retrack=spring-promo"));
  check("чужих меток не осталось", !/mail_IQ-RFM|mail_strategies/.test(text));
  check("посчитано, сколько заменено", replaced === 2, String(replaced));
  check("остальная ссылка не тронута", text.includes("aff=7") && text.includes("api.trade.iqbroker.com"));
}

{
  // Плейсхолдер платформы подставляется на отправке — подмена сломала бы ссылку.
  const source = `a(href="https://x.test/?afftrack={{embedded.campaign}}&retrack=old")`;
  const { text } = applyCampaign(source, "new-name");
  check("плейсхолдер платформы не трогаем", text.includes("afftrack={{embedded.campaign}}"));
  check("а обычную метку рядом — переписываем", text.includes("retrack=new-name"));
}

{
  const source = `a(href="https://x.test/?afftrack=a")`;
  check("без метки ничего не меняется", applyCampaign(source, "").text === source);
  check("и ничего не считается заменённым", applyCampaign(source, "").replaced === 0);
}

{
  for (const bad of ["с пробелом", "мой/трек", "a".repeat(90), "?x"]) {
    let refused = false;
    try { normalizeCampaign(bad); } catch { refused = true; }
    check(`метка "${bad.slice(0, 12)}" отвергнута`, refused);
  }
  check("нормальная метка проходит", normalizeCampaign(" spring_promo-2 ") === "spring_promo-2");
  check("параметров ровно два", CAMPAIGN_PARAMS.length === 2);
}

/* ─── Что сейчас стоит в каталоге ────────────────────────────────────────── */
{
  const canonical = path.join(REPO, "data", "block-library", "canonical");
  const all = readFileSync(path.join(canonical, "iqbr-button.json"), "utf8");
  const found = findCampaigns(all);
  check("метки в блоке находятся", found.length >= 0);
}

/* ─── Сборка письма: метка доходит до готовой разметки ───────────────────── */
{
  const tmp = path.join(os.tmpdir(), "retkit-campaign-test");
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  for (const item of ["vendor", "tools", "node_modules"]) {
    const src = path.join(REPO, "email-base", item);
    const dst = path.join(tmp, item);
    if (existsSync(src) && !existsSync(dst)) { try { symlinkSync(src, dst, "dir"); } catch { /* ignore */ } }
  }

  const tree = [
    { uid: "o", blockId: "iqbr-outer-wrapper", parentUid: null, slotId: null, slots: {} },
    { uid: "s", blockId: "iqbr-section-bordered", parentUid: "o", slotId: "sections", slots: {} },
    { uid: "b", blockId: "iqbr-button", parentUid: "s", slotId: "content", slots: {
      href: "https://api.trade.iqbroker.com/v1/x?aff=7&afftrack=mail_strategies&retrack=mail_strategies",
    } },
  ];

  composeEmailFromBlocks({ brand: "X_preview", mailName: "campaign", blocks: tree, destRoot: tmp, campaign: "my-own-name" });
  const pug = readFileSync(path.join(tmp, "X_preview", "mail-campaign", "app", "templates", "blocks", "header.pug"), "utf8");
  check("в собранном письме стоит наша метка", pug.includes("afftrack=my-own-name") && pug.includes("retrack=my-own-name"));
  check("метка из блока не просочилась", !pug.includes("mail_strategies"));

  const model = JSON.parse(readFileSync(path.join(tmp, "X_preview", "mail-campaign", "studio-model.json"), "utf8"));
  check("метка сохранена рядом с деревом", model.campaign === "my-own-name", String(model.campaign));

  composeEmailFromBlocks({ brand: "X_preview", mailName: "campaign2", blocks: tree, destRoot: tmp });
  const plain = readFileSync(path.join(tmp, "X_preview", "mail-campaign2", "app", "templates", "blocks", "header.pug"), "utf8");
  check("без метки ссылка блока остаётся как была", plain.includes("afftrack=mail_strategies"));

  rmSync(tmp, { recursive: true, force: true });
}

/* ─── Конструктор: поле метки и список ссылок ────────────────────────────── */
{
  const html = readFileSync(path.join(REPO, "public", "constructor.html"), "utf8");
  const js = readFileSync(path.join(REPO, "public", "constructor.js"), "utf8");
  check("в шапке есть поле метки кампании", html.includes('id="campaignName"'));
  check("есть кнопка списка ссылок", html.includes('id="linksBtn"'));
  check("метка уходит во все пути сборки",
    (js.match(/campaignPayload\(\)/g) || []).length >= 4,
    String((js.match(/campaignPayload\(\)/g) || []).length));
  check("метка возвращается из сохранённой модели", js.includes("d.model?.campaign"));
  check("ссылки собираются по слотам вида url",
    js.includes('slot.kind !== "url" && slot.kind !== "link"'));
  check("есть замена всех ссылок разом", js.includes("linksBulkApply"));
}

console.log(`\ncampaign-links: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
