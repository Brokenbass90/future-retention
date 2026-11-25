import { acquireKeyedOperationLock } from "./keyed-operation-lock.js";
import { resolveWorkbenchMailRoot } from "./mail-source-security.js";

export function workbenchMailOperationKey({ brand, mail } = {}) {
  const safeBrand = String(brand || "").trim();
  const safeMail = String(mail || "").trim();
  if (!safeBrand || !safeMail) {
    throw new TypeError("Workbench mail lock requires brand and mail");
  }
  return `mail:${safeBrand}/${safeMail}`;
}

export async function acquireWorkbenchMailOperationLock({
  emailBaseRoot,
  brand,
  mail,
} = {}) {
  const resolved = resolveWorkbenchMailRoot({ emailBaseRoot, brand, mail });
  const key = workbenchMailOperationKey(resolved);
  const release = await acquireKeyedOperationLock(key);
  return { key, resolved, release };
}

export async function withWorkbenchMailOperationLock(options, operation) {
  if (typeof operation !== "function") throw new TypeError("operation must be a function");
  const locked = await acquireWorkbenchMailOperationLock(options);
  try {
    return await operation(locked.resolved);
  } finally {
    locked.release();
  }
}
