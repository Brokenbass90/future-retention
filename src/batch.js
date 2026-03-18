/**
 * src/batch.js — Batch generation job queue
 *
 * In-memory queue for processing multiple email generation tasks.
 * Each job has: id, status, payload, result, error, timestamps.
 *
 * Status flow: pending → running → done | failed
 *
 * API surface used by router:
 *   enqueueJob(payload)              → job
 *   getJob(id)                       → job | null
 *   listJobs({ limit, status })      → job[]
 *   cancelJob(id)                    → job | null
 *   clearJobs({ olderThanMs })       → { cleared }
 *   startWorker(processorFn)         → stop()
 *
 * processorFn(job) should return result or throw.
 */

// ─── Job store ────────────────────────────────────────────────────────────────

/** @type {Map<string, object>} */
const jobs = new Map();

let jobCounter = 0;

function makeJobId() {
  return `job-${Date.now()}-${(++jobCounter).toString(36)}`;
}

/**
 * Creates and enqueues a new job.
 * @param {object} payload  Anything the processor needs
 * @returns {object} job
 */
export function enqueueJob(payload) {
  const id = makeJobId();
  const job = {
    id,
    status: "pending",       // pending | running | done | failed | cancelled
    payload,
    result: null,
    error: null,
    progress: null,
    createdAt: new Date().toISOString(),
    startedAt: null,
    finishedAt: null
  };
  jobs.set(id, job);
  return { ...job };
}

/**
 * Returns a job by ID, or null.
 * @param {string} id
 * @returns {object|null}
 */
export function getJob(id) {
  const job = jobs.get(id);
  return job ? { ...job } : null;
}

/**
 * Lists jobs with optional filtering.
 * @param {object} opts
 * @param {number} [opts.limit=50]
 * @param {string} [opts.status]  Filter by status
 * @returns {object[]}
 */
export function listJobs({ limit = 50, status } = {}) {
  const all = [...jobs.values()]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const filtered = status ? all.filter((j) => j.status === status) : all;
  return filtered.slice(0, limit).map((j) => ({ ...j }));
}

/**
 * Cancels a pending job (running jobs cannot be cancelled).
 * @param {string} id
 * @returns {object|null}
 */
export function cancelJob(id) {
  const job = jobs.get(id);
  if (!job || job.status !== "pending") return null;
  job.status = "cancelled";
  job.finishedAt = new Date().toISOString();
  return { ...job };
}

/**
 * Clears completed/failed/cancelled jobs older than a threshold.
 * @param {object} opts
 * @param {number} [opts.olderThanMs=3600000]  Default 1 hour
 * @returns {{ cleared: number }}
 */
export function clearJobs({ olderThanMs = 3_600_000 } = {}) {
  const threshold = Date.now() - olderThanMs;
  const terminal = new Set(["done", "failed", "cancelled"]);
  let cleared = 0;

  for (const [id, job] of jobs) {
    if (terminal.has(job.status) && new Date(job.createdAt).getTime() < threshold) {
      jobs.delete(id);
      cleared++;
    }
  }

  return { cleared };
}

/**
 * Returns queue stats summary.
 */
export function getQueueStats() {
  const counts = { pending: 0, running: 0, done: 0, failed: 0, cancelled: 0, total: 0 };
  for (const job of jobs.values()) {
    counts[job.status] = (counts[job.status] || 0) + 1;
    counts.total++;
  }
  return counts;
}

// ─── Worker ───────────────────────────────────────────────────────────────────

let workerRunning = false;

/**
 * Starts the background worker loop.
 * Processes one job at a time from the pending queue.
 *
 * @param {Function} processorFn  async (job) → result
 * @param {object}   opts
 * @param {number}   [opts.pollMs=500]   How often to check for pending jobs
 * @param {number}   [opts.concurrency=1]  Max parallel jobs (currently only 1 supported)
 * @returns {{ stop: Function }}
 */
export function startWorker(processorFn, { pollMs = 500 } = {}) {
  if (workerRunning) {
    console.warn("[batch] Worker already running — skipping duplicate start");
    return { stop: () => {} };
  }

  workerRunning = true;
  let active = true;

  async function loop() {
    while (active) {
      // Find next pending job
      const next = [...jobs.values()].find((j) => j.status === "pending");

      if (next) {
        next.status = "running";
        next.startedAt = new Date().toISOString();

        try {
          next.result = await processorFn(next);
          next.status = "done";
        } catch (err) {
          next.status = "failed";
          next.error = err?.message || String(err);
          console.error(`[batch] Job ${next.id} failed: ${next.error}`);
        } finally {
          next.finishedAt = new Date().toISOString();
        }
      } else {
        // No pending jobs — wait before polling again
        await new Promise((r) => setTimeout(r, pollMs));
      }
    }
    workerRunning = false;
  }

  loop().catch((err) => {
    console.error("[batch] Worker loop crashed:", err);
    workerRunning = false;
  });

  return {
    stop() {
      active = false;
    }
  };
}
