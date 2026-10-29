/**
 * scripts/iqbroker-cut/compose-strategies.mjs — собрать mail-strategies заново из нарезанных
 * блоков и сверить с оригиналом.
 *
 * Тексты берём теми же плейсхолдерами локали, что в оригинале: данных для
 * namespace `strategies-iqbroker` в репозитории нет, сборка оставляет токены
 * как есть — и в оригинале, и в нашей сборке одинаково. Значит сравнение
 * честное: разница может прийти только от вёрстки.
 */
import { composeEmailFromBlocks } from "../../src/compose-email.js";

const T = (n) => `\${{ strategies-iqbroker.block_${String(n).padStart(2, "0")} }}$`;
const LINK = "https://api.trade.iqbroker.com/v1/multi-links/open-asset?aff=7&afftrack=mail_strategies&retrack=mail_strategies";
const IMG = (name) => `https://fsms.quadcode.com/storage/public/d5/th/${name}`;

let n = 0;
const uid = (p) => `${p}${++n}`;

const blocks = [];
const add = (blockId, parentUid, slotId, slots = {}) => {
  const id = uid("u");
  blocks.push({ uid: id, blockId, parentUid, slotId, slots });
  return id;
};

/* Обёртка */
const outer = add("iqbr-outer-wrapper", null, null, { background_color: "#01080D", preheader: "" });

/* Шапка: контейнер и логотип — отдельные блоки */
{
  const header = add("iqbr-section-header", outer, "sections", {});
  add("iqbr-logo", header, "content", {
    logo: "https://fsms.quadcode.com/storage/public/d5/ss/e6gggnfnh4cs771g/logo-broker.png",
    href: `${LINK}&type=forex&asset=1`,
    alt: "",
  });
}

/* Голова: тёмная панель собирается из блоков — каждый правится отдельно */
{
  const hero = add("iqbr-section-dark", outer, "sections", { background_color: "#101314" });
  add("iqbr-image", hero, "media", {
    image: "https://fsms.quadcode.com/storage/public/d5/th/ok8ggnfnh4cs77ag/strategies-head.png",
    href: "#", alt: "", padding_bottom: "0",
  });
  add("iqbr-title-white", hero, "content", { text: T(1), color: "#F9F9F9", padding_bottom: "16px" });
  add("iqbr-text-white", hero, "content", { text: T(2), color: "#FFFFFF", padding_bottom: "0" });
  add("iqbr-text-white", hero, "content", { text: T(3), color: "#FFFFFF", padding_bottom: "0" });
  add("iqbr-spacer", hero, "content", { height: "24px" });
  add("iqbr-button", hero, "content", {
    label: T(4), href: LINK, background_color: "#FF5500", text_color: "#F9F9F9", radius: "12px", align: "left",
  });
}

const spacer = (parent) => add("iqbr-spacer", parent, "sections", { height: "12px" });
spacer(outer);

/* Карточка 1: две колонки со списками */
{
  const card = add("iqbr-section-bordered", outer, "sections", { border: "4px solid #1A1D1E", background_color: "" });
  add("iqbr-title-middle", card, "content", { text: T(5), color: "#ECECED", padding_bottom: "12px" });
  add("iqbr-text-gray", card, "content", { text: T(6), color: "#A6A6AB", padding_bottom: "32px" });
  add("iqbr-image", card, "content", { image: IMG("oj8ggnfnh4cs77a0/strategies-1.png"), href: "#", alt: "", padding_bottom: "20px" });

  const cols = add("iqbr-two-columns", card, "content", {});
  add("iqbr-block-title", cols, "left", { text: T(7), color: "#ECECED", padding_bottom: "16px" });
  add("iqbr-image", cols, "left", { image: IMG("oj0ggnfnh4cs7790/strategies-2.png"), href: "#", alt: "", padding_bottom: "16px" });
  add("iqbr-list-3", cols, "left", { item_1: T(8), item_2: T(9), item_3: T(10) });
  add("iqbr-block-title", cols, "right", { text: T(11), color: "#ECECED", padding_bottom: "16px" });
  add("iqbr-image", cols, "right", { image: IMG("oj7vhhgea139uk10/strategies-3.png"), href: "#", alt: "", padding_bottom: "16px" });
  add("iqbr-list-3", cols, "right", { item_1: T(12), item_2: T(13), item_3: T(14) });

  add("iqbr-spacer", card, "content", { height: "40px" });
  add("iqbr-button", card, "content", { label: T(15), href: LINK, background_color: "#FF5500", text_color: "#F9F9F9", radius: "12px", align: "center" });
}
spacer(outer);

/* Карточка 2: список из двух пунктов */
{
  const card = add("iqbr-section-bordered", outer, "sections", { border: "4px solid #1A1D1E", background_color: "" });
  add("iqbr-title-middle", card, "content", { text: T(16), color: "#ECECED", padding_bottom: "12px" });
  add("iqbr-text-gray", card, "content", { text: T(17), color: "#A6A6AB", padding_bottom: "32px" });
  add("iqbr-block-title", card, "content", { text: T(18), color: "#ECECED", padding_bottom: "12px" });
  add("iqbr-image", card, "content", { image: IMG("ojvvhhgea139uk1g/strategies-4.png"), href: "#", alt: "", padding_bottom: "32px" });
  add("iqbr-list-2", card, "content", { item_1: T(19), item_2: T(20) });
  add("iqbr-spacer", card, "content", { height: "40px" });
  add("iqbr-button", card, "content", { label: T(21), href: LINK, background_color: "#FF5500", text_color: "#F9F9F9", radius: "12px", align: "center" });
}
spacer(outer);

/* Карточка 3: сравнение двух сценариев */
{
  const card = add("iqbr-section-bordered", outer, "sections", { border: "4px solid #1A1D1E", background_color: "" });
  add("iqbr-title-middle", card, "content", { text: T(22), color: "#ECECED", padding_bottom: "12px" });
  add("iqbr-text-gray", card, "content", { text: T(23), color: "#A6A6AB", padding_bottom: "32px" });

  const cols = add("iqbr-two-columns", card, "content", {});
  add("iqbr-block-title", cols, "left", { text: T(24), color: "#ECECED", padding_bottom: "16px" });
  add("iqbr-image", cols, "left", { image: IMG("oj8ggnfnh4cs779g/strategies-5.png"), href: "#", alt: "", padding_bottom: "16px" });
  add("iqbr-block-note", cols, "left", { text: T(25), subtitle: T(26), note: T(27), accent: T(28), accent_color: "#3BA581" });
  add("iqbr-block-title", cols, "right", { text: T(29), color: "#ECECED", padding_bottom: "16px" });
  add("iqbr-image", cols, "right", { image: IMG("oj7vhhgea139uk0g/strategies-6.png"), href: "#", alt: "", padding_bottom: "16px" });
  add("iqbr-block-note", cols, "right", { text: T(30), subtitle: T(31), note: T(32), accent: T(33), accent_color: "#E72828" });

  add("iqbr-spacer", card, "content", { height: "40px" });
  add("iqbr-button", card, "content", { label: T(34), href: LINK, background_color: "#FF5500", text_color: "#F9F9F9", radius: "12px", align: "center" });
}

/* Сторы и соцсети */
add("iqbr-stores", outer, "sections", {});
add("iqbr-socials", outer, "sections", {});
add("iqbr-footer", outer, "sections", {
  company_address: "{{embedded.company_address}}",
  risk_warning: "{{embedded.risk_warning}}",
  terms_href: "{{embedded.company_terms_link}}",
  conditions: "${{ footer.footer.conditions }}$",
  unsubscribe_href: "{{embedded.unsubscribe_link}}",
  unsubscribe: "${{ footer.footer.unsubscribe }}$",
  background_color: "#01080D",
});

const result = composeEmailFromBlocks({
  brand: process.env.CUT_BRAND || "X_preview",
  mailName: process.env.CUT_MAIL || "iqbr-strategies-cut",
  blocks,
});
console.log("собрано:", result.destDir);
console.log("блоков:", result.totalBlocks, "предупреждений:", (result.warnings || []).length);
for (const w of result.warnings || []) console.log("  ⚠", w);
