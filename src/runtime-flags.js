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
  // Витрина ничего не пишет на диск: на Heroku записанное всё равно исчезает
  // при рестарте дино, и молчаливая потеря правок хуже честного «только чтение».
  const readOnly = parseBooleanEnv(env.STUDIO_READONLY, publicDemo);

  return Object.freeze({
    publicDemo,
    readOnly,
    aiEnabled,
    authEnabled: authAllowed && hasAuthCredentials,
    authAllowed,
    hasAuthCredentials,
  });
}
