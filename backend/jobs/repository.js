// Durable job repository. All durable background-agent state lives here so the
// web process (admission) and worker process (execution) coordinate solely
// through PostgreSQL. The chosen primitives:
//   - FOR UPDATE SKIP LOCKED for safe multi-replica claiming
//   - per-user running-count guard so one user cannot starve the queue
//   - monotonic event seq so clients can reconnect from (after=<seq>)
//   - explicit lease_owner / lease_expires_at for crash recovery

const crypto = require('crypto');
const db = require('../db');
const { JobStatus, EventType, isTerminal } = require('./types');

// query runner: prefer an injected client (so callers can wrap in a tx), else
// the shared pool. Every method is async and returns plain rows.
function getQuery(runner) {
  if (runner && typeof runner.query === 'function') return runner.query.bind(runner);
  return db.query;
}

function generateId() {
  return `job_${crypto.randomUUID()}`;
}

function nowIso() {
  return new Date().toISOString();
}

async function createJob({
  userId,
  conversationId = null,
  resourceClass = 'text',
  priority = 1,
  payload = {},
  idempotencyKey = null,
  maxAttempts = 3,
  runAfterMs = 0,
  run = null
}) {
  const query = getQuery(run);
  const id = generateId();
  // Every job needs an idempotency key so the UNIQUE index and ON CONFLICT path
  // always apply. Callers that want real deduplication pass their own key; others
  // get a random one and are simply never deduplicated.
  const effectiveKey = idempotencyKey || `auto_${crypto.randomUUID()}`;
  const availableAt = new Date(Date.now() + Math.max(0, Number(runAfterMs) || 0)).toISOString();
  try {
    const row = (
      await query(
        `INSERT INTO agent_jobs
          (id, user_id, conversation_id, status, resource_class, priority, payload, attempt, max_attempts, available_at, idempotency_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 0, $8, $9, $10)
         RETURNING *`,
        [
          id,
          userId,
          conversationId,
          JobStatus.QUEUED,
          resourceClass,
          priority,
          JSON.stringify(payload),
          maxAttempts,
          availableAt,
          effectiveKey
        ]
      )
    ).rows[0];
    await appendEventInternal(query, id, EventType.CREATED, { status: JobStatus.QUEUED }, run);
    return { job: row, created: true, id };
  } catch (err) {
    // Unique violation on (user_id, idempotency_key): a prior submit already
    // created this job. Return the existing row so the caller gets the same id.
    if (err && err.code === '23505') {
      const existing = (
        await query(
          `SELECT * FROM agent_jobs WHERE user_id = $1 AND idempotency_key = $2`,
          [userId, effectiveKey]
        )
      ).rows[0];
      return { job: existing, created: false, id: existing?.id };
    }
    throw err;
  }
}

// Claim the next eligible job honoring the per-user active cap. Uses SKIP LOCKED
// so concurrent workers never grab the same row; users at/above perUserActive cap
// are excluded so a burst from one user cannot starve everyone else.
async function claimNext({ workerId, leaseMs, perUserActive = 1, run = null }) {
  const query = getQuery(run);
  const leaseExpiresAt = new Date(Date.now() + Number(leaseMs)).toISOString();
  const row = (
    await query(
      `UPDATE agent_jobs j SET
         status = $1,
         lease_owner = $2,
         lease_expires_at = $3,
         heartbeat_at = now(),
         started_at = COALESCE(j.started_at, now()),
         attempt = j.attempt + 1,
         updated_at = now()
       FROM (
         SELECT a.id FROM agent_jobs a
         WHERE a.status IN ($4, $5)
           AND a.available_at <= now()
           AND (
             SELECT COUNT(*) FROM agent_jobs r
             WHERE r.user_id = a.user_id AND r.status IN ($1, $6) AND r.lease_owner IS NOT NULL
           ) < $7
         ORDER BY a.priority ASC, a.available_at ASC, a.created_at ASC
         LIMIT 1
         FOR UPDATE OF a SKIP LOCKED
       ) sub
       WHERE j.id = sub.id
       RETURNING j.*`,
      [
        JobStatus.RUNNING,
        workerId,
        leaseExpiresAt,
        JobStatus.QUEUED,
        JobStatus.RETRYING,
        JobStatus.RUNNING,
        perUserActive
      ]
    )
  ).rows[0];

  if (!row) return null;
  await appendEventInternal(query, row.id, EventType.CLAIMED, { workerId, attempt: row.attempt }, run);
  return row;
}

// Reset jobs whose lease expired back to a claimable state. Returns the ids that
// were recovered (used to log recovery and decide retry vs terminal failure).
async function recoverExpiredLeases({ now = nowIso(), run = null } = {}) {
  const query = getQuery(run);
  const recovered = (
    await query(
      `UPDATE agent_jobs SET
         status = CASE WHEN attempt >= max_attempts THEN $1 ELSE $2 END,
         lease_owner = NULL,
         lease_expires_at = NULL,
         available_at = CASE WHEN attempt >= max_attempts THEN available_at ELSE now() END,
         finished_at = CASE WHEN attempt >= max_attempts THEN now() ELSE finished_at END,
         error_code = CASE WHEN attempt >= max_attempts THEN 'INTERNAL' ELSE error_code END,
         error_message = CASE WHEN attempt >= max_attempts THEN 'Lease expired and retries exhausted' ELSE error_message END,
         updated_at = now()
       WHERE status = $3
         AND lease_expires_at IS NOT NULL
         AND lease_expires_at < $4
       RETURNING id, status, attempt, max_attempts`,
      [JobStatus.FAILED, JobStatus.RETRYING, JobStatus.RUNNING, now]
    )
  ).rows;
  return recovered;
}

async function heartbeat({ jobId, workerId, run = null }) {
  const query = getQuery(run);
  await query(
    `UPDATE agent_jobs
     SET heartbeat_at = now(), lease_expires_at = $2, updated_at = now()
     WHERE id = $1 AND lease_owner = $3 AND status = $4`,
    [jobId, new Date(Date.now() + Number(LEASE_SLACK_MS)).toISOString(), workerId, JobStatus.RUNNING]
  );
}

// 60s of slack so a heartbeat that races with a claim handoff is not mistaken
// for an expired lease mid-flight.
const LEASE_SLACK_MS = 60000;

async function appendEvent({ jobId, type, payload = {}, run = null }) {
  return appendEventInternal(getQuery(run), jobId, type, payload, run);
}

async function appendEventInternal(query, jobId, type, payload, run) {
  const row = (
    await query(
      `INSERT INTO agent_job_events (job_id, seq, type, payload)
       SELECT $1, COALESCE(MAX(seq), 0) + 1, $2, $3
       FROM agent_job_events WHERE job_id = $1
       RETURNING *`,
      [jobId, type, JSON.stringify(payload)]
    )
  ).rows[0];
  if (row) row.seq = Number(row.seq);
  return row;
}

async function getEventsAfter({ jobId, afterSeq = 0, limit = 500, run = null }) {
  const query = getQuery(run);
  const rows = (
    await query(
      `SELECT * FROM agent_job_events
       WHERE job_id = $1 AND seq > $2
       ORDER BY seq ASC
       LIMIT $3`,
      [jobId, afterSeq, limit]
    )
  ).rows;
  return rows.map((r) => ({ ...r, seq: Number(r.seq) }));
}

async function completeJob({ jobId, result, run = null }) {
  const query = getQuery(run);
  const row = (
    await query(
      `UPDATE agent_jobs
       SET status = $1, result = $2, finished_at = now(), lease_owner = NULL,
           lease_expires_at = NULL, updated_at = now()
       WHERE id = $3
       RETURNING *`,
      [JobStatus.COMPLETED, JSON.stringify(result || {}), jobId]
    )
  ).rows[0];
  if (row) await appendEventInternal(query, jobId, EventType.COMPLETED, { status: JobStatus.COMPLETED }, run);
  return row;
}

// Record a failure. If attempts remain, schedule a retry; otherwise mark failed.
async function failJob({ jobId, errorCode, errorMessage, retryAfterMs = 0, run = null }) {
  const query = getQuery(run);
  const current = (await query(`SELECT attempt, max_attempts FROM agent_jobs WHERE id = $1`, [jobId])).rows[0];
  if (!current) return null;
  const willRetry = current.attempt < current.max_attempts;
  const nextStatus = willRetry ? JobStatus.RETRYING : JobStatus.FAILED;
  const availableAt = willRetry ? new Date(Date.now() + Math.max(0, Number(retryAfterMs) || 0)).toISOString() : null;
  const row = (
    await query(
      `UPDATE agent_jobs
       SET status = $1,
           error_code = $2,
           error_message = $3,
           available_at = COALESCE($4, available_at),
           lease_owner = NULL,
           lease_expires_at = NULL,
           finished_at = CASE WHEN $1 = $5 THEN now() ELSE finished_at END,
           updated_at = now()
       WHERE id = $6
       RETURNING *`,
      [nextStatus, errorCode, String(errorMessage || '').slice(0, 500), availableAt, JobStatus.FAILED, jobId]
    )
  ).rows[0];
  if (row) {
    await appendEventInternal(
      query,
      jobId,
      willRetry ? EventType.RETRYING : EventType.FAILED,
      { status: nextStatus, attempt: current.attempt, errorCode, errorMessage: String(errorMessage || '').slice(0, 300) },
      run
    );
  }
  return row;
}

async function cancelJob({ jobId, userId = null, run = null }) {
  const query = getQuery(run);
  const where = userId != null ? `id = $1 AND user_id = $2` : `id = $1`;
  const params = userId != null ? [jobId, userId] : [jobId];
  const row = (
    await query(
      `UPDATE agent_jobs
       SET cancel_requested_at = now(),
           status = CASE WHEN status IN ($3, $4) THEN $5 ELSE status END,
           finished_at = CASE WHEN status IN ($3, $4) THEN now() ELSE finished_at END,
           lease_owner = CASE WHEN status IN ($3, $4) THEN NULL ELSE lease_owner END,
           lease_expires_at = CASE WHEN status IN ($3, $4) THEN NULL ELSE lease_expires_at END,
           updated_at = now()
       WHERE ${where}
       RETURNING *`,
      [...params, JobStatus.QUEUED, JobStatus.RETRYING, JobStatus.CANCELLED]
    )
  ).rows[0];
  if (row) await appendEventInternal(query, jobId, EventType.CANCELLED, { status: JobStatus.CANCELLED }, run);
  return row || null;
}

async function getJob({ jobId, userId = null, run = null }) {
  const query = getQuery(run);
  const where = userId != null ? `id = $1 AND user_id = $2` : `id = $1`;
  const params = userId != null ? [jobId, userId] : [jobId];
  const row = (await query(`SELECT * FROM agent_jobs WHERE ${where}`, params)).rows[0];
  return row || null;
}

async function listJobsForUser({ userId, limit = 50, run = null }) {
  const query = getQuery(run);
  const rows = (
    await query(
      `SELECT * FROM agent_jobs
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [userId, limit]
    )
  ).rows;
  return rows;
}

async function queueDepth(run = null) {
  const query = getQuery(run);
  const row = (
    await query(
      `SELECT
         COUNT(*) FILTER (WHERE status IN ('queued','retrying')) AS pending,
         COUNT(*) FILTER (WHERE status = 'running') AS running,
         COUNT(*) FILTER (WHERE status = 'running') AS active,
         MAX(EXTRACT(EPOCH FROM (now() - created_at))) FILTER (WHERE status IN ('queued','retrying')) AS oldest_age_seconds
       FROM agent_jobs`,
      []
    )
  ).rows[0];
  return row;
}

async function countActiveForUser({ userId, run = null }) {
  const query = getQuery(run);
  const row = (
    await query(
      `SELECT COUNT(*) AS active
       FROM agent_jobs
       WHERE user_id = $1 AND status IN ('queued','retrying','running')`,
      [userId]
    )
  ).rows[0];
  return Number(row?.active || 0);
}

module.exports = {
  generateId,
  createJob,
  claimNext,
  recoverExpiredLeases,
  heartbeat,
  appendEvent,
  getEventsAfter,
  completeJob,
  failJob,
  cancelJob,
  getJob,
  listJobsForUser,
  queueDepth,
  countActiveForUser,
  LEASE_SLACK_MS
};
