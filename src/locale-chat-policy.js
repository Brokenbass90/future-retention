const LOCALE_CONTEXT_RE = /локал|перевод|блок|namespace|local|translation|англ|english|\ben\b/i;
const READ_ONLY_RE = /аудит|анализ|сравн|проверь|провер|посмотр|найди|какая|какой|почему|что\s+не\s+так|неправ|некор|расхожд|отлич|количеств.{0,16}блок|сколько.{0,12}блок|предлож|как\s+(?:исправ|почин)/i;
const NO_APPLY_RE = /не\s+(?:примен|меня|исправ|трог)|без\s+(?:прав|измен)|только\s+(?:анализ|проверк)|ничего\s+не\s+(?:меня|примен)/i;
const EXPLICIT_APPLY_RE = /^\s*(?:(?:да|теперь|тогда|хорошо)[,!]?\s*)*(?:исправь|почини|выровняй|примени|внеси\s+правк|расставь\s+блок|сделай\s+исправ)/i;

export function classifyLocaleChatPolicy(text, { hasNamespaces = false } = {}) {
  const source = String(text || "").toLowerCase();
  const explicitlyApplies = EXPLICIT_APPLY_RE.test(source);
  const refersToPreviousTarget = /(?:^|[\s,])(?:е[её]|их)(?:$|[\s.!?])/i.test(source);
  const hasLocaleContext = Boolean(hasNamespaces && (LOCALE_CONTEXT_RE.test(source) || (explicitlyApplies && refersToPreviousTarget)));
  const explicitlyReadOnly = NO_APPLY_RE.test(source);
  const asksForAudit = READ_ONLY_RE.test(source);

  return {
    hasLocaleContext,
    readOnlyAudit: hasLocaleContext && (explicitlyReadOnly || asksForAudit) && !explicitlyApplies,
    explicitFix: hasLocaleContext && explicitlyApplies && !explicitlyReadOnly,
  };
}
