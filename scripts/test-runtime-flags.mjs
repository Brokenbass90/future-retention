import assert from "node:assert/strict";
import { parseBooleanEnv, resolveStudioRuntimeFlags } from "../src/runtime-flags.js";

assert.equal(parseBooleanEnv("YES"), true);
assert.equal(parseBooleanEnv("off", true), false);
assert.equal(parseBooleanEnv("unexpected", true), true);

assert.deepEqual(resolveStudioRuntimeFlags({
  APP_AUTH_USER: "demo",
  APP_AUTH_PASSWORD: "secret",
  STUDIO_AI_ENABLED: "1",
}), {
  publicDemo: false,
  aiEnabled: true,
  authEnabled: true,
  authAllowed: true,
  hasAuthCredentials: true,
});

assert.deepEqual(resolveStudioRuntimeFlags({
  APP_AUTH_USER: "demo",
  APP_AUTH_PASSWORD: "secret",
  APP_AUTH_ENABLED: "0",
}), {
  publicDemo: false,
  aiEnabled: true,
  authEnabled: false,
  authAllowed: false,
  hasAuthCredentials: true,
});

assert.deepEqual(resolveStudioRuntimeFlags({
  APP_AUTH_USER: "demo",
  APP_AUTH_PASSWORD: "secret",
  STUDIO_PUBLIC_DEMO: "true",
  STUDIO_AI_ENABLED: "true",
  APP_AUTH_ENABLED: "true",
}), {
  publicDemo: true,
  aiEnabled: false,
  authEnabled: false,
  authAllowed: false,
  hasAuthCredentials: true,
});

console.log("runtime flags: explicit auth override + public demo AI/auth safety ok");
