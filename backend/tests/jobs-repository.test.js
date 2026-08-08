import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';

// These tests need a real Postgres because they exercise FOR UPDATE SKIP LOCKED,
// per-user fairness, event seq monotonicity and lease recovery. Point
// DATABASE_URL at any Postgres (the CI/local harness uses a throwaway container).
const TEST_DATABASE_URL =
  process.env.JOBS_TEST_DATABASE_URL ||
  process.env.DATABASE_URL ||
  'postgres://postgres:testpass@localhost:5433/bahai';

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
}

const db = require('../db');
const repo = require('../jobs/repository');
const { JobStatus, EventType } = require('../jobs/types');

let testUserId = null;

beforeAll(async () => {
  await db.initDb();
  const res = await db.query(
    `INSERT INTO users (email, password, name, role)
     VALUES ($1, $2, 'test', 'user') RETURNING id`,
    [`jobs-test-${Date.now()}@bahai.az`, 'x']
  );
  testUserId = res.rows[0].id;
}, 30000);

// Each test creates jobs; clear them so claimNext does not pick up leftovers
// from an earlier test in this file.
afterEach(async () => {
  if (testUserId) {
    await db.query('DELETE FROM agent_job_events WHERE job_id IN (SELECT id FROM agent_jobs WHERE user_id = $1)', [testUserId]).catch(() => {});
    await db.query('DELETE FROM agent_jobs WHERE user_id = $1', [testUserId]).catch(() => {});
  }
});

afterAll(async () => {
  if (testUserId) {
    await db.query('DELETE FROM agent_jobs WHERE user_id = $1', [testUserId]).catch(() => {});
    await db.query('DELETE FROM users WHERE id = $1', [testUserId]).catch(() => {});
  }
  await db.shutdown();
});

describe('jobs repository', () => {
  it('creates a job and rejects duplicate idempotency keys', async () => {
    const key = `idem-${cryptoRandom()}`;
    const created = await repo.createJob({ userId: testUserId, idempotencyKey: key, payload: { a: 1 } });
    expect(created.created).toBe(true);
    expect(created.job.status).toBe(JobStatus.QUEUED);

    const dup = await repo.createJob({ userId: testUserId, idempotencyKey: key, payload: { a: 2 } });
    expect(dup.created).toBe(false);
    expect(dup.id).toBe(created.id);
  });

  it('claims jobs in priority order and enforces per-user active cap', async () => {
    const low = await repo.createJob({ userId: testUserId, priority: 2, payload: { n: 'low' } });
    const high = await repo.createJob({ userId: testUserId, priority: 0, payload: { n: 'high' } });

    const first = await repo.claimNext({ workerId: 'w1', leaseMs: 60000, perUserActive: 1 });
    expect(first).not.toBeNull();
    // The higher-priority (lower number) job must be claimed first.
    expect(first.id).toBe(high.id);

    // Per-user active cap is 1, so the second claim must skip this user's job.
    const second = await repo.claimNext({ workerId: 'w2', leaseMs: 60000, perUserActive: 1 });
    expect(second).toBeNull();

    // Finish the high-priority job so its slot is freed; the low job is next.
    await repo.completeJob({ jobId: first.id, result: { ok: true } });
    const third = await repo.claimNext({ workerId: 'w3', leaseMs: 60000, perUserActive: 1 });
    expect(third.id).toBe(low.id);
  });

  it('appends events with a monotonic seq and resumes after <seq>', async () => {
    const job = await repo.createJob({ userId: testUserId, payload: { n: 'evt' } });
    await repo.appendEvent({ jobId: job.id, type: EventType.PROGRESS, payload: { step: 1 } });
    await repo.appendEvent({ jobId: job.id, type: EventType.PROGRESS, payload: { step: 2 } });
    await repo.appendEvent({ jobId: job.id, type: EventType.PROGRESS, payload: { step: 3 } });

    const all = await repo.getEventsAfter({ jobId: job.id, afterSeq: 0 });
    // createJob appends a `created` event first; the three progress events follow.
    const progressEvents = all.filter((e) => e.type === EventType.PROGRESS);
    expect(progressEvents.map((e) => e.seq)).toEqual([2, 3, 4]);
    expect(progressEvents.map((e) => e.payload.step)).toEqual([1, 2, 3]);

    const after2 = await repo.getEventsAfter({ jobId: job.id, afterSeq: 2 });
    expect(after2.map((e) => e.seq)).toEqual([3, 4]);
  });

  it('fails with bounded retries then terminal failure', async () => {
    const job = await repo.createJob({ userId: testUserId, maxAttempts: 2, payload: {} });
    await repo.claimNext({ workerId: 'wx', leaseMs: 60000, perUserActive: 5 });
    await repo.failJob({ jobId: job.id, errorCode: 'PROVIDER_5XX', errorMessage: 'boom', retryAfterMs: 0 });
    let current = await repo.getJob({ jobId: job.id });
    expect(current.status).toBe(JobStatus.RETRYING);

    await repo.claimNext({ workerId: 'wx', leaseMs: 60000, perUserActive: 5 });
    await repo.failJob({ jobId: job.id, errorCode: 'PROVIDER_5XX', errorMessage: 'boom2', retryAfterMs: 0 });
    current = await repo.getJob({ jobId: job.id });
    expect(current.status).toBe(JobStatus.FAILED);
    expect(current.error_code).toBe('PROVIDER_5XX');
    expect(current.finished_at).not.toBeNull();
  });

  it('recovers jobs whose lease expired', async () => {
    const job = await repo.createJob({ userId: testUserId, payload: {} });
    await repo.claimNext({ workerId: 'dead', leaseMs: 1, perUserActive: 5 });
    // Force the lease into the past.
    await db.query(
      `UPDATE agent_jobs SET lease_expires_at = now() - interval '10 seconds' WHERE id = $1`,
      [job.id]
    );
    const recovered = await repo.recoverExpiredLeases({});
    expect(recovered.some((r) => r.id === job.id)).toBe(true);
    const after = await repo.getJob({ jobId: job.id });
    expect(after.status).toBe(JobStatus.RETRYING);
    expect(after.lease_owner).toBeNull();
  });

  it('cancels a queued job and refuses to cancel another user job', async () => {
    const job = await repo.createJob({ userId: testUserId, payload: {} });
    const cancelled = await repo.cancelJob({ jobId: job.id, userId: testUserId });
    expect(cancelled.status).toBe(JobStatus.CANCELLED);

    const other = await repo.createJob({ userId: testUserId, payload: {} });
    const blocked = await repo.cancelJob({ jobId: other.id, userId: 999999 });
    expect(blocked).toBeNull();
  });
});

function cryptoRandom() {
  return Math.random().toString(36).slice(2, 10);
}
