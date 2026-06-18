/**
 * src/placeholder-inference.js — deterministic pass that proposes
 * placeholders for a piece of HTML/text content.
 *
 * Two-stage architecture (P0.2 in ROADMAP):
 *   Stage 1 (this module): regex + rule-based detector. Cheap, offline,
 *     reproducible. Emits candidates with category + confidence.
 *   Stage 2 (future, server-side AI): pipes LOW-confidence candidates to a
 *     small model with explicit "is this personalization or static content?"
 *     reasoning prompt.
 *
 * Categories (mirror data/builtin-namespaces.json convention):
 *   amount, account_id, user_name, date, tracking_link, brand_name,
 *   phone, email_address.
 *
 * Public API:
 *   inferPlaceholders(html, { mailNamespace? }) →
 *     { proposals, existing, summary }
 *   applyPlaceholderProposals(html, accepted) →
 *     { html, applied, skipped }
 */

const PLACEHOLDER_RE = /\$\{\{\s*([\w-]+)\.([\w-]+)\s*\}\}\$/g;

const BRAND_NAMES = [
  "Quotex", "ExpertOption", "Expert Option", "IQ Option", "IQOption",
  "Pocket Option", "Olymp Trade", "OlympTrade", "Binomo", "Exnova",
  "Casa Trade", "Affstore",
];

// Generic salutation words that follow a greeting but are NOT personal names,
// so they must NOT be tokenized as user_name ("Dear Customer", "Hello Team").
const GENERIC_GREETING_WORDS = new Set([
  "client", "customer", "user", "team", "trader", "member", "friend",
  "sir", "madam", "all", "everyone", "there", "guest", "partner", "subscriber",
  "клиент", "клиента", "пользователь", "друг", "друзья", "команда", "трейдер",
  "уважаемый", "уважаемая", "господин", "госпожа", "все",
]);

// Currency: ISO codes (\b-anchored) OR symbol class. Wrapped in a single
// non-capture group so embedding into a larger pattern is safe.
const CURRENCY_PATTERN =
  "(?:(?:USD|EUR|GBP|RUB|UAH|BRL|INR|AED|SAR|EGP|TRY|MXN|JPY|CNY|KRW|PHP|IDR|VND|NGN|ZAR|HKD|CHF|CAD|AUD|NZD|SEK|NOK|DKK|PLN|CZK|HUF|RON|BGN|TWD|THB|SGD|MYR)\\b|[$€£¥₽₴₹₸฿])";
const NUMBER_PATTERN =
  "-?\\d{1,3}(?:[ ,. ]\\d{3})*(?:[.,]\\d{1,4})?(?:[kKmM]|млн|тыс)?";

// Money REQUIRES both currency AND number. Either order.
const MONEY_RE = new RegExp(
  "(?:" + CURRENCY_PATTERN + "\\s*" + NUMBER_PATTERN +
  "|" + NUMBER_PATTERN + "\\s*" + CURRENCY_PATTERN + ")",
  "gi"
);

// Labeled IDs: "Account ID: 12345", "Trader #ABC", "Order # 9988".
const LABELED_ID_RE =
  /\b(?:account(?:\s*id)?|trader(?:\s*id)?|order(?:\s*#|\s*number)?|ref(?:erence)?|client(?:\s*id)?|user(?:\s*id)?)\s*[:#]?\s*([A-Z0-9][A-Z0-9-]{5,})\b/gi;

// UUID v4-ish.
const UUID_RE =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

// Greetings followed by a capitalized name.
const GREETING_RE =
  /\b(?:Hi|Hello|Hey|Dear|Greetings|Привет|Здравствуйте|Уважаем(?:ый|ая)|Добрый\s+день|Olá|Hola|Bonjour|Ciao|Guten\s+Tag)[,!\s]+([A-ZА-ЯЁ][\p{L}'’-]{1,30}(?:\s+[A-ZА-ЯЁ]\.?\s*[A-ZА-ЯЁ][\p{L}'’-]{1,30})?)/gu;

// Dates.
const DATE_PATTERNS = [
  /\b\d{4}-\d{2}-\d{2}\b/g,
  /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4}\b/gi,
  /\b\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+\d{4}\b/gi,
  /\b\d{1,2}[./]\d{1,2}[./]\d{4}\b/g,
];

const TRACKING_PARAM_RE =
  /[?&](?:utm_[a-z_]+|aff_id|click_id|sub_id\d?|gclid|fbclid|msclkid|sessid)=[^&"'\s>]+/i;

// Phone: REQUIRE a leading "+" or surrounding parentheses to dodge dates
// and bare ID tails. Length 10+ digits total.
const PHONE_RE =
  /(?<![\w.])(?:\+\d{1,3}[\s.-]?\(?\d{2,4}\)?[\s.-]?\d{2,4}[\s.-]?\d{2,4}(?:[\s.-]?\d{1,4})?|\(\d{2,4}\)[\s.-]?\d{3,4}[\s.-]?\d{3,4}(?:[\s.-]?\d{1,4})?)(?![\w.])/g;

const EMAIL_RE = /\b[\w.+-]+@(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,}\b/g;

function stripHtml(html) {
  return String(html || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function extractUrls(html) {
  const out = [];
  const hrefRe = /href\s*=\s*(["'])([^"']+)\1/gi;
  let m;
  while ((m = hrefRe.exec(html)) !== null) out.push({ url: m[2], source: "href" });
  const bareRe = /\bhttps?:\/\/[^\s<>"')]+/g;
  while ((m = bareRe.exec(html)) !== null) out.push({ url: m[0], source: "text" });
  return out;
}

function detectExisting(html) {
  const seen = new Map();
  let m;
  PLACEHOLDER_RE.lastIndex = 0;
  while ((m = PLACEHOLDER_RE.exec(html)) !== null) {
    const key = `${m[1]}.${m[2]}`;
    seen.set(key, (seen.get(key) || 0) + 1);
  }
  return Array.from(seen.entries()).map(([k, count]) => {
    const [namespace, blockId] = k.split(".");
    return { namespace, blockId, count };
  });
}

function pushProposal(list, dedup, item) {
  const key = `${item.category}::${item.original}::${item.range[0]}`;
  if (dedup.has(key)) return;
  dedup.add(key);
  list.push(item);
}

function rangesOverlap(a, b) {
  return a[0] < b[1] && b[0] < a[1];
}

function suggestPlaceholderName(category, _value, mailNamespace) {
  const ns = mailNamespace || category;
  return `\${{ ${ns}.${category} }}$`;
}

export function inferPlaceholders(html, options = {}) {
  const mailNamespace = options.mailNamespace || null;
  const text = stripHtml(html);
  const raw = [];
  const dedup = new Set();

  // amount
  for (const m of text.matchAll(MONEY_RE)) {
    pushProposal(raw, dedup, {
      category: "amount", original: m[0],
      suggested: suggestPlaceholderName("amount", m[0], mailNamespace),
      range: [m.index, m.index + m[0].length],
      confidence: 0.92, reason: "money pattern (currency + number)",
    });
  }

  // account_id (labeled)
  for (const m of text.matchAll(LABELED_ID_RE)) {
    const idx = m.index + m[0].indexOf(m[1]);
    pushProposal(raw, dedup, {
      category: "account_id", original: m[1],
      suggested: suggestPlaceholderName("account_id", m[1], mailNamespace),
      range: [idx, idx + m[1].length],
      confidence: 0.88, reason: "labeled identifier (account/trader/order/ref)",
    });
  }
  // account_id (UUID)
  for (const m of text.matchAll(UUID_RE)) {
    pushProposal(raw, dedup, {
      category: "account_id", original: m[0],
      suggested: suggestPlaceholderName("account_id", m[0], mailNamespace),
      range: [m.index, m.index + m[0].length],
      confidence: 0.95, reason: "UUID",
    });
  }

  // user_name
  for (const m of text.matchAll(GREETING_RE)) {
    const name = m[1];
    // Skip generic salutations ("Dear Customer", "Hello Team") — not personal.
    const firstWord = name.split(/\s+/)[0].toLowerCase().replace(/[.,!]/g, "");
    if (GENERIC_GREETING_WORDS.has(firstWord)) continue;
    const idx = m.index + m[0].indexOf(name);
    pushProposal(raw, dedup, {
      category: "user_name", original: name,
      suggested: suggestPlaceholderName("user_name", name, mailNamespace),
      range: [idx, idx + name.length],
      confidence: 0.85, reason: "greeting followed by capitalized name",
    });
  }

  // dates
  for (const re of DATE_PATTERNS) {
    for (const m of text.matchAll(re)) {
      pushProposal(raw, dedup, {
        category: "date", original: m[0],
        suggested: suggestPlaceholderName("date", m[0], mailNamespace),
        range: [m.index, m.index + m[0].length],
        confidence: 0.78, reason: "date pattern",
      });
    }
  }

  // tracking_link (from href / bare URLs)
  for (const { url } of extractUrls(html)) {
    if (TRACKING_PARAM_RE.test(url)) {
      const idx = text.indexOf(url);
      pushProposal(raw, dedup, {
        category: "tracking_link", original: url,
        suggested: suggestPlaceholderName("tracking_link", url, mailNamespace),
        range: [idx, idx >= 0 ? idx + url.length : -1],
        confidence: 0.9, reason: "URL with tracking params",
      });
    }
  }

  // brand_name
  for (const brand of BRAND_NAMES) {
    const re = new RegExp(`\\b${brand.replace(/\s+/g, "\\s+")}\\b`, "gi");
    for (const m of text.matchAll(re)) {
      pushProposal(raw, dedup, {
        category: "brand_name", original: m[0],
        suggested: suggestPlaceholderName("brand_name", m[0], mailNamespace),
        range: [m.index, m.index + m[0].length],
        confidence: 0.7,
        reason: `known brand "${brand}" should likely be tokenized per locale`,
      });
    }
  }

  // phone
  for (const m of text.matchAll(PHONE_RE)) {
    const digits = m[0].replace(/\D/g, "");
    if (digits.length < 10) continue;
    pushProposal(raw, dedup, {
      category: "phone", original: m[0],
      suggested: suggestPlaceholderName("phone", m[0], mailNamespace),
      range: [m.index, m.index + m[0].length],
      confidence: 0.7,
      reason: "phone pattern (+/() shape, 10+ digits)",
    });
  }

  // email_address
  for (const m of text.matchAll(EMAIL_RE)) {
    pushProposal(raw, dedup, {
      category: "email_address", original: m[0],
      suggested: suggestPlaceholderName("email_address", m[0], mailNamespace),
      range: [m.index, m.index + m[0].length],
      confidence: 0.75, reason: "literal email address in body copy",
    });
  }

  // Overlap resolution: prefer LONGER original, then HIGHER confidence.
  raw.sort((a, b) => {
    const lenDiff = b.original.length - a.original.length;
    if (lenDiff !== 0) return lenDiff;
    return b.confidence - a.confidence;
  });
  const winners = [];
  const taken = [];
  for (const p of raw) {
    if (p.range[0] < 0) {
      // Range not resolved (e.g. URL only inside href attr). Keep it but
      // mark as out-of-band — caller decides how to apply.
      winners.push(p);
      continue;
    }
    if (taken.some((t) => rangesOverlap(t, p.range))) continue;
    taken.push(p.range);
    winners.push(p);
  }

  winners.sort((a, b) =>
    b.confidence - a.confidence || (a.range[0] - b.range[0])
  );

  // Assign UNIQUE placeholder names so two distinct values of the same category
  // don't collapse onto one token. Same literal value (e.g. a brand repeated)
  // keeps one shared name; distinct values get _2, _3 … suffixes. Numbering is
  // by document order (range start) so it's stable and human-readable.
  const nameByCatValue = new Map();   // "category::value" -> final name
  const countByCat = new Map();       // category -> how many distinct values so far
  const ns = mailNamespace || null;
  [...winners]
    .sort((a, b) => (a.range[0] - b.range[0]))
    .forEach((p) => {
      const valueKey = `${p.category}::${p.original}`;
      if (nameByCatValue.has(valueKey)) {
        p.suggested = nameByCatValue.get(valueKey);
        return;
      }
      const n = (countByCat.get(p.category) || 0) + 1;
      countByCat.set(p.category, n);
      const base = ns ? `${ns}.${p.category}` : p.category;
      const token = n === 1 ? base : `${base}_${n}`;
      const name = `\${{ ${token} }}$`;
      nameByCatValue.set(valueKey, name);
      p.suggested = name;
    });

  const byCategory = {};
  for (const p of winners) {
    byCategory[p.category] = (byCategory[p.category] || 0) + 1;
  }

  return {
    proposals: winners,
    existing: detectExisting(html),
    summary: {
      total: winners.length,
      byCategory,
      strippedTextLength: text.length,
    },
  };
}

/**
 * Apply accepted proposals to HTML. Replacements happen right-to-left
 * (sorted by description-order in the stripped text doesn't translate
 * 1-to-1 onto the original HTML, so we re-search literal originals from
 * the END of the doc to preserve offsets).
 *
 * Returns { html, applied, skipped }.
 */
export function applyPlaceholderProposals(html, accepted) {
  let out = String(html || "");
  const applied = [];
  const skipped = [];
  // Group accepted by original to avoid double-replacing identical strings.
  const seenOriginals = new Set();
  // Sort longest-first so we don't accidentally replace inside a bigger one
  // (e.g. tokenize "IQ Option" before a bare "Option").
  const sorted = [...(accepted || [])].sort(
    (a, b) => b.original.length - a.original.length
  );
  for (const p of sorted) {
    if (!p.original || seenOriginals.has(p.original)) continue;
    if (!out.includes(p.original)) {
      skipped.push({ ...p, reason: "original not found in HTML" });
      continue;
    }
    seenOriginals.add(p.original);
    // Replace EVERY occurrence of this literal so a brand/name repeated across
    // the email is tokenized consistently, not just once.
    const parts = out.split(p.original);
    const occurrences = parts.length - 1;
    out = parts.join(p.suggested);
    applied.push({ ...p, occurrences });
  }
  return { html: out, applied, skipped };
}
