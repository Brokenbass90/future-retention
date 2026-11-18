/**
 * Parse the deliberately small set of boolean spellings accepted in env.
 * Unknown values fall back instead of silently changing the security mode.
 */
export function parseBooleanEnv(value, fallback = false) {
  if (value == null || String(value).trim() === "") return Boolean(fallback);
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return Boolean(fallback);
}

/**
 * One public-demo switch turns off both paid/local AI calls and Basic Auth.
 * The explicit per-feature switches remain useful outside demo mode.
 */
export function resolveStudioRuntimeFlags(env = process.env) {
  const publicDemo = parseBooleanEnv(env.STUDIO_PUBLIC_DEMO, false);
  const aiEnabled = !publicDemo && parseBooleanEnv(env.STUDIO_AI_ENABLED, true);
  const authAllowed = !publicDemo && parseBooleanEnv(env.APP_AUTH_ENABLED, true);
  const hasAuthCredentials = Boolean(env.APP_AUTH_USER && env.APP_AUTH_PASSWORD);
  // «Только чтение» — только по явному STUDIO_READONLY=1. Прод на Heroku
  // работает с STUDIO_PUBLIC_DEMO=1 (без ИИ и без пароля), и с 5 октября это
  // молча выключило там «→ В код» и «Save mail». Каждый работает в своём
  // браузере, черновики разведены по браузерам — запись нужна.
  const readOnly = parseBooleanEnv(env.STUDIO_READONLY, false);

  return Object.freeze({
    publicDemo,
    readOnly,
    aiEnabled,
    authEnabled: authAllowed && hasAuthCredentials,
    authAllowed,
    hasAuthCredentials,
  });
}
