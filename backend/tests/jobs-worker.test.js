import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';

const TEST_DATABASE_URL =
  process.env.JOBS_TEST_DATABASE_URL ||
  process.env.DATABASE_URL ||
  'postgres://postgres:testpass@localhost:5433/bahai';
if (!process.env.DATABASE_URL) process.env.DATABASE_URL = TEST_DATABASE_URL;

const db = require('../db');
const repo = require('../jobs/repository');
const { createWorker } = require('../jobs/workerLoop');
const { JobStatus } = require('../jobs/types');

let testUserId = null;

beforeAll(async () => {
  await db.initDb();
  const res = await db.query(
    `INSERT INTO users (email, password, name, role) VALUES ($1, $2, 'test', 'user') RETURNING id`,
    [`worker-test-${Date.now()}@bahai.az`, 'x']
  );
  testUserId = res.rows[0].id;
}, 30000);

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe('worker loop', () => {
  it('claims a job, runs the executor, and marks it completed', async () => {
    const job = await repo.createJob({ userId: testUserId, payload: { q: 'hi' } });
    let executed = false;
    const worker = createWorker({
      workerId: 'w1',
      concurrency: 1,
      perUserActive: 1,
      execute: async ({ job: j, sink }) => {
        executed = true;
        await sink.progress({ note: 'start' });
        return { status: 'completed', result: { answer: 'ok' } };
      }
    });
    await worker._runOne(job);

    expect(executed).toBe(true);
    const final = await repo.getJob({ jobId: job.id });
    expect(final.status).toBe(JobStatus.COMPLETED);
    expect(final.result.answer).toBe('ok');

    const events = await repo.getEventsAfter({ jobId: job.id, afterSeq: 0 });
    expect(events.map((e) => e.type)).toContain('progress');
    expect(events.map((e) => e.type)).toContain('completed');
  });

  it('retries a failing executor up to max_attempts then marks terminal failure', async () => {
    const job = await repo.createJob({ userId: testUserId, maxAttempts: 2, payload: {} });
    let attempts = 0;
    const worker = createWorker({
      workerId: 'w2',
      concurrency: 1,
      perUserActive: 1,
      execute: async () => {
        attempts += 1;
        throw new Error('boom');
      }
    });

    // _runOne runs an already-claimed job; claim first so attempt increments.
    let claimed = await repo.claimNext({ workerId: 'w2', leaseMs: 60000, perUserActive: 1 });
    await worker._runOne(claimed);
    let current = await repo.getJob({ jobId: job.id });
    expect(current.status).toBe(JobStatus.RETRYING);
    expect(current.attempt).toBe(1);

    // Re-claim the retried job and run again.
    claimed = await repo.claimNext({ workerId: 'w2', leaseMs: 60000, perUserActive: 1 });
    expect(claimed.attempt).toBe(2);
    await worker._runOne(claimed);
    current = await repo.getJob({ jobId: job.id });
    expect(current.status).toBe(JobStatus.FAILED);
    expect(attempts).toBe(2);
  });

  it('aborts a running executor when the job is cancelled', async () => {
    const job = await repo.createJob({ userId: testUserId, payload: {} });
    let aborted = false;
    const worker = createWorker({
      workerId: 'w3',
      concurrency: 1,
      perUserActive: 1,
      execute: async ({ signal }) => {
        await new Promise((resolve, reject) => {
          const t = setTimeout(resolve, 5000);
          signal.addEventListener('abort', () => {
            clearTimeout(t);
            aborted = true;
            reject(new Error('aborted'));
          });
        });
        return { status: 'completed', result: {} };
      }
    });

    const runp = worker._runOne(job);
    // Give the executor time to start, then cancel.
    await sleep(50);
    await repo.cancelJob({ jobId: job.id, userId: testUserId });
    await runp;

    expect(aborted).toBe(true);
    const final = await repo.getJob({ jobId: job.id });
    expect(final.status).toBe(JobStatus.CANCELLED);
  });
});
