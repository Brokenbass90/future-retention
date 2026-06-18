/**
 * src/chat-intents.js — deterministic classifier that maps free-form
 * Russian/English chat messages onto known studio operations.
 *
 * Why deterministic first: most studio "tools" map to short verb+target
 * phrases ("переведи на ar", "расставь плейсхолдеры", "сравни en и ru").
 * Catching them with regex is cheap, predictable, and offline. When the
 * classifier returns null, the original chat flow falls through to the
 * regular LLM response — the user loses nothing, the LLM still answers.
 *
 * Supported intents:
 *   - translate_locale     { target: <code>, source?: <code> }
 *   - fix_locale           { locale: <code> }
 *   - infer_placeholders   { }
 *   - compare_locales      { a: <code>, b: <code> }
 *   - copy_placeholder     { ns?: <name>, blockIndex?: <int> }
 *
 * Each intent comes with confidence in [0, 1]. The caller decides
 * thresholds (we suggest ≥ 0.6 → execute; < 0.6 → fall through).
 *
 * Used by:
 *   - server.js POST /api/chat/intent   (dispatcher)
 *   - tests in /tmp/test-chat-intents.mjs
 */

const LOCALE_CODES = [
  'en', 'en_us', 'en_gb', 'ru', 'ru_ru', 'ua', 'uk', 'uk_ua',
  'ar', 'ar_kw', 'ar_sa', 'ur', 'fa', 'he',
  'de', 'es', 'fr', 'it', 'pt', 'pt_br', 'nl', 'tr', 'pl', 'cs',
  'th', 'vi', 'id', 'ms', 'tl', 'ja', 'ko', 'cn', 'zh', 'hi', 'bn',
  'ge', 'ka', 'az', 'hl', 'no', 'sv', 'se', 'da', 'fi', 'el',
];
const LOCALE_RE = new RegExp(`\\b(${LOCALE_CODES.join('|')})\\b`, 'gi');

function findLocales(text) {
  const found = new Set();
  let m;
  LOCALE_RE.lastIndex = 0;
  while ((m = LOCALE_RE.exec(text)) !== null) {
    found.add(m[1].toLowerCase());
  }
  return Array.from(found);
}

function normalize(text) {
  return String(text || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

// ─── Intent: translate_locale ─────────────────────────────────────────
const TRANSLATE_VERBS = /(перевед[иь]|переведт[еь]?|переведи|translate|локализ[уеи])/;
function detectTranslate(text) {
  const norm = normalize(text);
  if (!TRANSLATE_VERBS.test(norm)) return null;
  const locales = findLocales(text);
  if (!locales.length) {
    return { intent: 'translate_locale', params: {}, confidence: 0.4, hint: 'Не нашёл код целевой локали. Уточни — например «переведи на ar».' };
  }
  // Pattern "из X на/в Y" or "from X to Y".
  const fromTo = norm.match(/(?:из|from)\s+([a-z_]+)\s+(?:на|в|to)\s+([a-z_]+)/);
  if (fromTo) {
    return { intent: 'translate_locale', params: { source: fromTo[1], target: fromTo[2] }, confidence: 0.92 };
  }
  // "на X" / "to X" — target only.
  const toOnly = norm.match(/(?:на|to)\s+([a-z_]+)/);
  if (toOnly && LOCALE_CODES.includes(toOnly[1])) {
    return { intent: 'translate_locale', params: { target: toOnly[1] }, confidence: 0.85 };
  }
  // Fallback: pick the first locale mentioned.
  return { intent: 'translate_locale', params: { target: locales[0] }, confidence: 0.65 };
}

// ─── Intent: fix_locale ───────────────────────────────────────────────
const FIX_VERBS = /(почини|исправ[иь]|починить|fix|repair|приведи в порядок)/;
function detectFix(text) {
  const norm = normalize(text);
  if (!FIX_VERBS.test(norm)) return null;
  // Must explicitly mention "локаль" or a known code
  const mentionsLocale = /локал[ьие]/.test(norm) || /\blocale\b/.test(norm);
  const locales = findLocales(text);
  if (!mentionsLocale && !locales.length) return null;
  if (locales.length) {
    return { intent: 'fix_locale', params: { locale: locales[0] }, confidence: 0.88 };
  }
  return { intent: 'fix_locale', params: {}, confidence: 0.55, hint: 'Какую локаль чинить? Например «почини локаль ru».' };
}

// ─── Intent: infer_placeholders ───────────────────────────────────────
function detectInferPlaceholders(text) {
  const norm = normalize(text);
  const mentions = /плейсх|placeholder/.test(norm);
  if (!mentions) return null;
  // Questions are NOT execution intents.
  if (/[?？]/.test(text) || /что такое|what is|расскажи|объясни|объясните/.test(norm)) {
    return null;
  }
  // High confidence if explicit action verb.
  if (/(?:расстав[ьи]|разметь|distribute|scan|найди где)/.test(norm)) {
    return { intent: 'infer_placeholders', params: {}, confidence: 0.9 };
  }
  if (/подстав[ьи].*(?:плейсх|placeholder)/.test(norm)) {
    return { intent: 'infer_placeholders', params: {}, confidence: 0.85 };
  }
  // Plain mention — low confidence; caller's threshold decides.
  return { intent: 'infer_placeholders', params: {}, confidence: 0.4 };
}

// ─── Intent: compare_locales ─────────────────────────────────────────
function detectCompare(text) {
  const norm = normalize(text);
  if (!/(сравн|compare|diff)/.test(norm)) return null;
  const locales = findLocales(text);
  if (locales.length >= 2) {
    return { intent: 'compare_locales', params: { a: locales[0], b: locales[1] }, confidence: 0.9 };
  }
  if (locales.length === 1) {
    return { intent: 'compare_locales', params: { a: locales[0] }, confidence: 0.5, hint: 'Нужна вторая локаль для сравнения.' };
  }
  return null;
}

// ─── Intent: copy_placeholder ────────────────────────────────────────
function detectCopyPlaceholder(text) {
  const norm = normalize(text);
  // "скопируй block_05" / "copy block 7"
  const m = norm.match(/(?:скопир|copy)[\s\S]{0,20}?block[_\s-]*(\d{1,3})/);
  if (m) {
    return { intent: 'copy_placeholder', params: { blockIndex: parseInt(m[1], 10) }, confidence: 0.9 };
  }
  return null;
}

const DETECTORS = [
  detectCompare,           // most specific first
  detectFix,
  detectTranslate,
  detectInferPlaceholders,
  detectCopyPlaceholder,
];

/**
 * Try to classify a chat message. Returns the highest-confidence match,
 * or null if nothing fires.
 *
 * @param {string} text
 * @returns {null | { intent, params, confidence, hint? }}
 */
export function classifyChatIntent(text) {
  if (!text || typeof text !== 'string') return null;
  const matches = [];
  for (const det of DETECTORS) {
    const m = det(text);
    if (m) matches.push(m);
  }
  if (!matches.length) return null;
  matches.sort((a, b) => b.confidence - a.confidence);
  return matches[0];
}

// Default export for convenience.
export default classifyChatIntent;
