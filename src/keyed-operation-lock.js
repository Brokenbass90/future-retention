const operationTails = new Map();

function normalizeKey(value) {
  const key = String(value || "").trim();
  if (!key) throw new TypeError("operation lock key must be non-empty");
  return key;
}

/**
 * Acquire a fair, in-process lock for one logical resource. Different keys can
 * proceed concurrently; callers sharing a key are resumed in arrival order.
 * The returned release function is idempotent and must be called in `finally`.
 */
export async function acquireKeyedOperationLock(value) {
  const key = normalizeKey(value);
  const previous = operationTails.get(key) || Promise.resolve();
  let resolveTail;
  const tail = new Promise((resolve) => { resolveTail = resolve; });
  operationTails.set(key, tail);
  await previous;

  let released = false;
  return function releaseKeyedOperationLock() {
    if (released) return;
    released = true;
    resolveTail();
    if (operationTails.get(key) === tail) operationTails.delete(key);
  };
}

export async function withKeyedOperationLock(key, operation) {
  if (typeof operation !== "function") throw new TypeError("operation must be a function");
  const release = await acquireKeyedOperationLock(key);
  try {
    return await operation();
  } finally {
    release();
  }
}
