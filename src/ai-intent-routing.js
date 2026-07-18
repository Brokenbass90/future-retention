const LOCALE_WORKSPACE_RE = /(?:локал|перевод|перевед|перевест|язык|текстов(?:ый|ые)?\s+блок|txt|пл[еэ]йсхолд|placeholder|namespace|translat|locali[sz]|arab|араб|rtl|\b(?:ar|ur|en|ru|es|fr|pt|id|tl|vi|th)\b)/i;
const MUTATION_RE = /(?:сдел|измени|помен|почин|исправ|поправ|подправ|выровн|унифиц|привед|перенес|расстав|встав|замен|добав|удал|обнов|синхрон|адаптир|перевед|translate|repair|fix|align|insert|replace|update|sync|convert)/i;
const READ_ONLY_RE = /(?:\?|почему|зачем|как\s+(?:работ|устро|провер)|посмотр|покаж|расскаж|объясн|проанализ|аудит|what|why|how|explain|analy[sz]|audit)/i;

/**
 * The AI intent classifier is a second model round-trip before the real chat
 * response. Use it only for ambiguous *action* requests in a loaded locale
 * workspace. Ordinary discussion must go straight to the discussion model.
 */
export function shouldClassifyAiToolIntent({ text, hasNamespaceWorkspace = false } = {}) {
  const value = String(text || "").trim();
  if (!hasNamespaceWorkspace || value.length <= 6 || value.length >= 400) return false;
  if (READ_ONLY_RE.test(value)) return false;
  return LOCALE_WORKSPACE_RE.test(value) && MUTATION_RE.test(value);
}
