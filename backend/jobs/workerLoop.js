// Worker loop. Claims durable jobs from PostgreSQL with FOR UPDATE SKIP LOCKED,
// runs an injected executor, and persists results/retries to the same store.
//
// The executor is injected so this loop can be tested with a stub provider and
// later wired to the real agent runtime without changing claim/lease/cancel logic.
//
//   execute({ job, sink, signal, onHeartbeat }) => Promise<{
//     status: 'completed' | 'failed',
//     result?: object,
//     errorCode?: string,
//     errorMessage?: string,
//     retryAfterMs?: number
//   }>

const repo = require('./repository');
const { createEventSink } = require('./eventSink');
const { isTerminal } = require('./types');

function createWorker(opts) {
  const {
    workerId,
    concurrency = parseInt(process.env.WORKER_CONCURRENCY || '4', 10),
    leaseMs = parseInt(process.env.WORKER_LEASE_MS || '120000', 10),
    heartbeatMs = parseInt(process.env.WORKER_HEARTBEAT_MS || '15000', 10),
    perUserActive = parseInt(process.env.WORKER_PER_USER_ACTIVE || '1', 10),
    pollIntervalMs = parseInt(process.env.WORKER_POLL_MS || '250', 10),
    leaseSlackMs = repo.LEASE_SLACK_MS,
    execute,
    onError = () => {}
  } = opts || {};

  let running = new Map(); // jobId -> { controller, heartbeatTimer }
  let draining = false;
  let pollTimer = null;
  let closed = false;

  async function runOne(job) {
    const controller = new AbortController();
    const sink = createEventSink({ jobId: job.id });
    let heartbeatTimer = null;

    const stopHeartbeat = () => {
      if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
    };

    const onHeartbeat = () => repo.heartbeat({ jobId: job.id, workerId }).catch(() => {});

    running.set(job.id, { controller, stopHeartbeat });
    heartbeatTimer = setInterval(onHeartbeat, heartbeatMs);

    // Watch for cooperative cancellation. The executor is expected to honor
    // `signal.aborted`; we abort it as soon as a cancel is requested.
    const cancelWatcher = setInterval(async () => {
      try {
        const fresh = await repo.getJob({ jobId: job.id });
        if (fresh && fresh.cancel_requested_at) {
          controller.abort(new Error('cancelled'));
        }
      } catch { /* ignore */ }
    }, parseInt(process.env.WORKER_CANCEL_POLL_MS || '250', 10));

    try {
      // Cooperative cancellation: if the job was cancelled while queued/running,
      // abandon before doing provider work.
      const fresh = await repo.getJob({ jobId: job.id });
      if (fresh && fresh.cancel_requested_at) {
        await repo.cancelJob({ jobId: job.id });
        return;
      }

      const outcome = await execute({
        job,
        sink,
        signal: controller.signal,
        onHeartbeat
      });

      if (outcome.status === 'completed') {
        await repo.completeJob({ jobId: job.id, result: outcome.result || {} });
      } else {
        await repo.failJob({
          jobId: job.id,
          errorCode: outcome.errorCode || 'INTERNAL',
          errorMessage: outcome.errorMessage || 'Job failed',
          retryAfterMs: outcome.retryAfterMs || 0
        });
      }
    } catch (err) {
      onError(err, job);
      // If the job was cancelled while running, treat the abort as a cancellation
      // rather than a failure that would be retried.
      const fresh = await repo.getJob({ jobId: job.id }).catch(() => null);
      if (fresh && fresh.cancel_requested_at) {
        await repo.cancelJob({ jobId: job.id }).catch(() => {});
        return;
      }
      const code = err && err.code === '23505' ? 'INTERNAL' : (err && err.code) || 'INTERNAL';
      await repo.failJob({
        jobId: job.id,
        errorCode: code,
        errorMessage: String(err && err.message || 'worker error').slice(0, 500)
      }).catch(() => {});
    } finally {
      stopHeartbeat();
      if (cancelWatcher) clearInterval(cancelWatcher);
      running.delete(job.id);
    }
  }

  async function tick() {
    if (draining || closed) return;
    // Top up to `concurrency` parallel claims.
    while (running.size < concurrency && !draining) {
      let job = null;
      try {
        job = await repo.claimNext({ workerId, leaseMs, perUserActive });
      } catch (err) {
        onError(err, null);
        break;
      }
      if (!job) break;
      // Fire-and-forget; the loop will top up on the next tick once it settles.
      runOne(job).catch((err) => onError(err, job));
    }
  }

  function start() {
    closed = false;
    const loop = async () => {
      if (closed) return;
      try { await tick(); } catch (err) { onError(err, null); }
      if (!closed) pollTimer = setTimeout(loop, pollIntervalMs);
    };
    loop();
    return worker;
  }

  function stop() {
    draining = true;
    if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
    return drain();
  }

  // Stop claiming new work and wait for in-flight jobs to finish (or be aborted).
  async function drain() {
    draining = true;
    if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
    for (const { controller } of running.values()) {
      try { controller.abort(new Error('worker_draining')); } catch { /* ignore */ }
    }
    const deadline = Date.now() + parseInt(process.env.WORKER_DRAIN_MS || '30000', 10);
    while (running.size > 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100));
    }
    closed = true;
    return running.size;
  }

  const worker = {
    start,
    stop,
    drain,
    recover: () => repo.recoverExpiredLeases({}),
    get activeCount() { return running.size; },
    isDraining: () => draining,
    // Test helper: run a single already-claimed job synchronously-ish.
    _runOne: runOne
  };
  return worker;
}

module.exports = { createWorker, isTerminal };
