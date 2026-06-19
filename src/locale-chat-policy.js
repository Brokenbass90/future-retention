const LOCALE_CONTEXT_RE = /локал|перевод|блок|namespace|local|translation|англ|english|\ben\b|пл[еэ]йсхолдер|placeholder|переменн/i;
const READ_ONLY_RE = /аудит|анализ|сравн|проверь|провер|посмотр|найди|какая|какой|почему|что\s+не\s+так|неправ|некор|расхожд|отлич|количеств.{0,16}блок|сколько.{0,12}блок|предлож|как\s+(?:исправ|почин)/i;
const NO_APPLY_RE = /не\s+(?:примен|меня|исправ|трог)|без\s+(?:прав|измен)|только\s+(?:анализ|проверк)|ничего\s+не\s+(?:меня|примен)/i;
const EXPLICIT_APPLY_RE = /^\s*(?:(?:да|теперь|тогда|хорошо)[,!]?\s*)*(?:исправь|почини|выровняй|примени|внеси\s+правк|расставь\s+блок|сделай\s+исправ|раздели|отдели|вынеси)/i;
const STRUCTURE_FIX_RE = /(?:раздел|отдел|вынес|полноценн.{0,24}блок|сделай\s+так|давай\s+так).{0,100}(?:везде|во\s+всех|для\s+всех|локал|блок|пл[еэ]йсхолдер|переменн)|(?:везде|во\s+всех|для\s+всех).{0,100}(?:раздел|отдел|вынес|блок)/i;
const AFFIRMATIVE_RE = /^\s*(?:да(?:,?\s+давай)?|давай|ок(?:ей)?|хорошо|согласен|продолжай|сделай)(?:[\s.!]|$)/i;
const FIX_OFFER_RE = /хотите.{0,100}(?:исправ|поправ|почин|предлож)|помог.{0,60}(?:исправ|поправ|почин)|подготов.{0,60}(?:исправ|правк)|привести.{0,60}соответ/i;

export function classifyLocaleChatPolicy(text, { hasNamespaces = false, priorAssistantText = "" } = {}) {
  const source = String(text || "").toLowerCase();
  const confirmsPriorFix = AFFIRMATIVE_RE.test(source) && FIX_OFFER_RE.test(String(priorAssistantText || ""));
  const explicitlyApplies = EXPLICIT_APPLY_RE.test(source) || STRUCTURE_FIX_RE.test(source) || confirmsPriorFix;
  const refersToPreviousTarget = /(?:^|[\s,])(?:е[её]|их)(?:$|[\s.!?])/i.test(source);
  const hasLocaleContext = Boolean(hasNamespaces && (LOCALE_CONTEXT_RE.test(source) || confirmsPriorFix || (explicitlyApplies && refersToPreviousTarget)));
  const explicitlyReadOnly = NO_APPLY_RE.test(source);
  const asksForAudit = READ_ONLY_RE.test(source);

  return {
    hasLocaleContext,
    readOnlyAudit: hasLocaleContext && (explicitlyReadOnly || asksForAudit) && !explicitlyApplies,
    explicitFix: hasLocaleContext && explicitlyApplies && !explicitlyReadOnly,
    confirmsPriorFix,
  };
}
