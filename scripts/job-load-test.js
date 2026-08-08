// ==========================================
// 100-virtual-user durable job load test (no live model calls)
// ==========================================
// Exercises the durable background-agent pipeline end to end:
//   1. 100 virtual users each submit one job concurrently
//   2. a worker runs them with a stub executor (simulated latency + failures)
//   3. we verify: 0 duplicates, 0 lost jobs, all terminal, retries recover
//   4. a lease-expiry crash/recovery simulation re-claims orphaned work
//
// Usage: DATABASE_URL=... node scripts/job-load-test.js
//        VUSERS=100 CONCURRENCY=4 FAIL_RATE=0.1 node scripts/job-load-test.js

const path = require('path');
try {
  require('dotenv').config({ path: path.resolve(__dirname, '..', 'backend', '.env') });
  require('dotenv').config({ path: path.resolve(__dirname, '..', 'backend', '..', '.env') });
} catch { /* ignore */ }

const db = require('../backend/db');
const repo = require('../backend/jobs/repository');
const { createWorker } = require('../backend/jobs/workerLoop');
const { JobStatus } = require('../backend/jobs/types');

const VUSERS = parseInt(process.env.VUSERS || '100', 10);
const WORKER_CONCURRENCY = parseInt(process.env.CONCURRENCY || '4', 10);
const FAIL_RATE = parseFloat(process.env.FAIL_RATE || '0.1');
const STUB_LATENCY_MS = parseInt(process.env.STUB_LATENCY_MS || '300', 10);
const MAX_ATTEMPTS = parseInt(process.env.MAX_ATTEMPTS || '3', 10);

function nowMs() { return Date.now(); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function pct(arr, p) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

async function main() {
  await db.initDb();
  console.log(`🧪 Load test: ${VUSERS} virtual users, worker concurrency ${WORKER_CONCURRENCY}`);

  // Seed virtual users.
  const users = [];
  for (let i = 0; i < VUSERS; i += 1) {
    const email = `vu-${Date.now()}-${i}@load.test`;
    const res = await db.query(
      `INSERT INTO users (email, password, name, role) VALUES ($1, $2, 'vu', 'user') RETURNING id`,
      [email, 'x']
    );
    users.push(res.rows[0].id);
  }

  // --- 1. Concurrent admission ---
  const submitStart = nowMs();
  const submitted = await Promise.all(users.map(async (uid, i) => {
    const t0 = nowMs();
    const { id } = await repo.createJob({
      userId: uid,
      priority: i % 3, // mix priorities
      idempotencyKey: `vu-${i}`,
      maxAttempts: MAX_ATTEMPTS,
      payload: { prompt: `salam ${i}` }
    });
    return { uid, id, latency: nowMs() - t0 };
  }));
  const submitLatencies = submitted.map((s) => s.latency);
  console.log(`   admission: ${submitted.length} jobs, p50=${pct(submitLatencies, 50)}ms p95=${pct(submitLatencies, 95)}ms`);

  // Duplicate-submission idempotency check.
  const dupResults = await Promise.all(users.map((uid, i) =>
    repo.createJob({ userId: uid, idempotencyKey: `vu-${i}`, payload: { prompt: 'dup' } })
  ));
  const dupCollisions = dupResults.filter((r) => r.created === false).length;
  const lostOnSubmit = submitted.length - dupCollisions; // every original should be found by dup key

  // --- 2. Worker with stub executor ---
  const worker = createWorker({
    workerId: 'load-worker',
    concurrency: WORKER_CONCURRENCY,
    perUserActive: 1,
    execute: async ({ job, signal }) => {
      await sleep(STUB_LATENCY_MS + Math.floor(Math.random() * STUB_LATENCY_MS));
      if (signal && signal.aborted) return { status: 'failed', errorCode: 'CANCELLED', errorMessage: 'aborted' };
      if (Math.random() < FAIL_RATE) {
        throw new Error('stub provider failure');
      }
      return { status: 'completed', result: { ok: true, job: job.id } };
    }
  });
  worker.start();

  // --- 3. Wait for all terminal ---
  const terminalStart = nowMs();
  let terminalCount = 0;
  while (terminalCount < submitted.length) {
    const rows = await db.query(
      `SELECT COUNT(*) AS c FROM agent_jobs WHERE user_id = ANY($1) AND status = ANY($2)`,
      [users, [JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.CANCELLED]]
    );
    terminalCount = Number(rows.rows[0].c);
    if (nowMs() - terminalStart > 60000) break;
    await sleep(100);
  }
  const e2eMs = nowMs() - terminalStart;

  const finalRows = (await db.query(
    `SELECT status, COUNT(*) AS c FROM agent_jobs WHERE user_id = ANY($1) GROUP BY status`,
    [users]
  )).rows;
  const statusCounts = {};
  for (const r of finalRows) statusCounts[r.status] = Number(r.c);

  const completed = statusCounts[JobStatus.COMPLETED] || 0;
  const failed = statusCounts[JobStatus.FAILED] || 0;
  const cancelled = statusCounts[JobStatus.CANCELLED] || 0;
  const lost = submitted.length - (completed + failed + cancelled);

  // --- 4. Crash/recovery simulation: force an expired lease on a fresh job ---
  const recUser = users[0];
  const recJob = await repo.createJob({ userId: recUser, idempotencyKey: 'recover-test', maxAttempts: 3, payload: { prompt: 'recover' } });
  await repo.claimNext({ workerId: 'ghost', leaseMs: 1, perUserActive: 1 });
  await db.query(`UPDATE agent_jobs SET lease_expires_at = now() - interval '10 seconds' WHERE id = $1`, [recJob.id]);
  const recovered = await repo.recoverExpiredLeases({});
  const recAfter = await repo.getJob({ jobId: recJob.id });

  // Cleanup
  worker.stop();
  await db.query('DELETE FROM agent_job_events WHERE job_id IN (SELECT id FROM agent_jobs WHERE user_id = ANY($1))', [users]).catch(() => {});
  await db.query('DELETE FROM agent_jobs WHERE user_id = ANY($1)', [users]).catch(() => {});
  await db.query('DELETE FROM users WHERE id = ANY($1)', [users]).catch(() => {});
  await db.shutdown();

  const report = {
    vusers: VUSERS,
    workerConcurrency: WORKER_CONCURRENCY,
    totalJobs: submitted.length,
    submitLatencyMs: { p50: pct(submitLatencies, 50), p95: pct(submitLatencies, 95), max: Math.max(...submitLatencies) },
    duplicateKeysResolved: dupCollisions,
    lostOnSubmitMismatch: lostOnSubmit,
    terminalStatusCounts: { completed, failed, cancelled, lost },
    successRate: Number(((completed / submitted.length) * 100).toFixed(2)),
    e2eWaitMs: e2eMs,
    recovery: {
      forcedExpiredJob: recJob.id,
      recoveredCount: recovered.length,
      recoveredStatus: recAfter.status
    }
  };

  console.log('\n=== LOAD TEST REPORT ===');
  console.log(JSON.stringify(report, null, 2));

  const pass = lost === 0 && dupCollisions === VUSERS && recovered.length >= 1 && recAfter.status !== JobStatus.RUNNING;
  console.log(pass ? '\n✅ PASS: no lost jobs, idempotency held, recovery worked' : '\n❌ FAIL: see report above');
  process.exit(pass ? 0 : 1);
}

main().catch((err) => {
  console.error('Load test failed:', err);
  process.exit(1);
});
