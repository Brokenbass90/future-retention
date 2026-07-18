import { createHash } from "node:crypto";

const DEFAULT_MAX_CONCURRENT = 2;
const DEFAULT_MAX_CACHE_ENTRIES = 80;
const DEFAULT_CACHE_TTL_MS = 30_000;

function positiveInteger(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}
/**
 * Preview names are presentation-only and deliberately excluded from the
 * fingerprint. The generated HTML does not depend on the constructor's
 * monotonically increasing live-preview token.
 */
export function createPreviewBuildKey({ blocks, sourceBrand = "", sourceMail = "", version = 1 } = {}) {
  const serialized = JSON.stringify({
    version,
    blocks: Array.isArray(blocks) ? blocks : [],
    sourceBrand: String(sourceBrand || ""),
    sourceMail: String(sourceMail || ""),
  });
  return createHash("sha256").update(serialized).digest("hex");
}

export function previewBuildPriority(mailName) {
  const name = String(mailName || "").toLowerCase();
  if (name.startsWith("thumb-")) return 0;
  if (name.includes("block-author-preview")) return 10;
  // Live canvas and explicit Preview actions should always jump ahead of
  // thumbnail work that has not started yet.
  return 20;
}

function createPriorityScheduler(maxConcurrent) {
  const limit = positiveInteger(maxConcurrent, DEFAULT_MAX_CONCURRENT, { max: 8 });
  const queue = [];
  let running = 0;
  let sequence = 0;

  const pump = () => {
    while (running < limit && queue.length) {
      queue.sort((left, right) => right.priority - left.priority || left.sequence - right.sequence);
      const item = queue.shift();
      running += 1;
      const startedAt = Date.now();
      Promise.resolve()
        .then(item.task)
        .then(
          (value) => item.resolve({ value, queueMs: startedAt - item.queuedAt, runMs: Date.now() - startedAt }),
          item.reject,
        )
        .finally(() => {
          running -= 1;
          pump();
        });
    }
  };

  return {
    schedule(task, priority = 0) {
      if (typeof task !== "function") throw new TypeError("preview task must be a function");
      return new Promise((resolve, reject) => {
        queue.push({ task, priority: Number(priority) || 0, sequence: sequence += 1, queuedAt: Date.now(), resolve, reject });
        pump();
      });
    },
    stats() {
      return { running, queued: queue.length, maxConcurrent: limit };
    },
  };
}

/**
 * Bounded, priority-aware preview builder with short-lived LRU results and
 * in-flight de-duplication. It prevents a grid of lazy thumbnails from
 * spawning an unbounded number of Node/Pug/inline-css processes while still
 * letting the active canvas preview jump to the front of the queue.
 */
export function createPreviewBuildCoordinator(options = {}) {
  const scheduler = createPriorityScheduler(options.maxConcurrent);
  const maxCacheEntries = positiveInteger(options.maxCacheEntries, DEFAULT_MAX_CACHE_ENTRIES, { max: 500 });
  const ttlMs = positiveInteger(options.ttlMs, DEFAULT_CACHE_TTL_MS, { min: 1, max: 10 * 60_000 });
  const now = typeof options.now === "function" ? options.now : Date.now;
  const cache = new Map();
  const inFlight = new Map();

  const readCache = (key) => {
    const entry = cache.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= now()) {
      cache.delete(key);
      return null;
    }
    // Map insertion order is the LRU order.
    cache.delete(key);
    cache.set(key, entry);
    return entry.value;
  };

  const writeCache = (key, value) => {
    cache.delete(key);
    cache.set(key, { value, expiresAt: now() + ttlMs });
    while (cache.size > maxCacheEntries) cache.delete(cache.keys().next().value);
  };

  return {
    async run({ key, priority = 0, task }) {
      const normalizedKey = String(key || "").trim();
      if (!normalizedKey) throw new TypeError("preview build key must be non-empty");
      const cached = readCache(normalizedKey);
      if (cached !== null) {
        return { value: cached, cacheStatus: "hit", queueMs: 0, runMs: 0 };
      }

      const existing = inFlight.get(normalizedKey);
      if (existing) {
        const result = await existing;
        return { ...result, cacheStatus: "shared" };
      }

      const scheduled = scheduler.schedule(task, priority).then((result) => {
        writeCache(normalizedKey, result.value);
        return { ...result, cacheStatus: "miss" };
      });
      inFlight.set(normalizedKey, scheduled);
      try {
        return await scheduled;
      } finally {
        if (inFlight.get(normalizedKey) === scheduled) inFlight.delete(normalizedKey);
      }
    },
    clear() {
      cache.clear();
    },
    stats() {
      return { ...scheduler.stats(), cacheEntries: cache.size, inFlight: inFlight.size };
    },
  };
}
