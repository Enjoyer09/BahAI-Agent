// ==========================================
// Centralized runtime configuration
// ==========================================
// Single place that reads the breaker / quota / worker settings from
// the environment so the web process, worker process, executor, and ops endpoint
// all agree. Railway exposes these as project environment variables; sensible
// defaults keep local/dev runs working without them.

function bool(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  return String(value).toLowerCase() === 'true';
}

function num(value, fallback) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

const env = process.env;

const config = {
  version: require('./package.json').version,

  // Circuit breaker protecting upstream providers.
  breaker: {
    failureThreshold: num(env.BREAKER_FAILURE_THRESHOLD, 5),
    cooldownMs: num(env.BREAKER_COOLDOWN_MS, 30000),
    halfOpenMax: num(env.BREAKER_HALF_OPEN_MAX, 1)
  },

  // Per-user admission guard: reject a new job if the user already has this many
  // active (queued+running) jobs. Defense-in-depth on top of the claim-time
  // perUserActive cap.
  quota: {
    maxActivePerUser: num(env.JOB_MAX_ACTIVE_PER_USER, 5)
  },

  worker: {
    concurrency: num(env.WORKER_CONCURRENCY, 12),
    leaseMs: num(env.WORKER_LEASE_MS, 120000),
    heartbeatMs: num(env.WORKER_HEARTBEAT_MS, 15000),
    perUserActive: num(env.WORKER_PER_USER_ACTIVE, 1),
    pollMs: num(env.WORKER_POLL_MS, 250)
  },

  // Admin ops endpoint guard. If set, /api/admin/ops requires this token as
  // `x-admin-token`. If unset in production it is effectively disabled (the
  // endpoint returns 403); in non-production it is open for local debugging.
  adminOpsToken: env.ADMIN_OPS_TOKEN || ''
};

module.exports = { config, bool, num };
