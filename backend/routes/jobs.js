// ==========================================
// Job API — durable background agent admission + status
// ==========================================
// The web process only ADMITS work here. Execution happens in the worker
// process; clients reconnect to /events to follow progress across disconnects.

const express = require('express');
const router = express.Router();

const repo = require('../jobs/repository');
const { JobStatus, isTerminal } = require('../jobs/types');
const { logger } = require('../lib/structuredLogger');
const { config } = require('../config');

function requireUser(req, res, next) {
  if (!req.user || !req.user.id) {
    return res.status(401).json({ error: 'Giriş tələb olunur' });
  }
  next();
}

// Normalize a stored event row into the same flat shape the live sink streams
// (payload fields spread to the top level) so the client mapping is uniform
// whether it is reconnecting from durable storage or attached to a live stream.
function writeEvent(res, event) {
  const normalized =
    event && event.payload && typeof event.payload === 'object'
      ? { type: event.type, seq: Number(event.seq), jobId: event.job_id, ...event.payload }
      : event;
  res.write(`data: ${JSON.stringify(normalized)}\n\n`);
}

function queuePosition(job) {
  // Approximate position: jobs ahead by priority, then by creation order.
  return repo.queueDepth()
    .then(() => require('../db').query(
      `SELECT COUNT(*) AS ahead FROM agent_jobs
       WHERE status IN ('queued','retrying')
         AND (
           priority < $1
           OR (priority = $1 AND created_at < $2)
         )`,
      [job.priority, job.created_at]
    ))
    .then((r) => Number(r.rows[0].ahead) + 1);
}

// POST /api/jobs — submit a durable job (idempotent via idempotencyKey).
router.post('/', requireUser, async (req, res) => {
  try {
    const {
      conversationId = null,
      resourceClass = 'text',
      priority = 1,
      idempotencyKey = null,
      maxAttempts = 3,
      payload = {}
    } = req.body || {};

    // Basic admission limits to avoid unbounded payloads.
    const estSize = JSON.stringify(payload || {}).length;
    if (estSize > 1024 * 1024) {
      return res.status(413).json({ error: 'Job payloadı çox böyükdür (max 1MB).' });
    }

    // Per-user admission guard: prevent a single user from flooding the durable
    // queue. The claim-time perUserActive cap already limits *concurrency*; this
    // caps *queued+running* volume so one user cannot starve the others.
    const activeForUser = await repo.countActiveForUser({ userId: req.user.id });
    const maxActive = config.quota.maxActivePerUser;
    if (activeForUser >= maxActive) {
      logger.warn('Job admission rejected: per-user active cap reached', {
        userId: req.user.id, active: activeForUser, max: maxActive
      });
      return res.status(429).json({
        error: 'Aktiv job limitinə çatdınız. Davam edən işlərin bitməsini gözləyin.',
        activeJobs: activeForUser,
        maxActiveJobs: maxActive
      });
    }

    const safePriority = Math.max(0, Math.min(2, Math.trunc(Number(priority) || 1)));
    const { id } = await repo.createJob({
      userId: req.user.id,
      conversationId,
      resourceClass,
      priority: safePriority,
      payload,
      idempotencyKey: idempotencyKey || null,
      maxAttempts: Math.max(1, Math.min(10, Number(maxAttempts) || 3))
    });

    const job = await repo.getJob({ jobId: id });
    const position = await queuePosition(job);
    logger.info('Job admitted', { jobId: id, userId: req.user.id, status: job.status, queuePosition: position });
    return res.status(202).json({ jobId: id, status: job.status, queuePosition: position });
  } catch (err) {
    logger.error('Job submit error', { message: err.message, userId: req.user && req.user.id });
    return res.status(500).json({ error: 'Job qəbul edilə bilmədi.' });
  }
});

// GET /api/jobs — list the current user's recent jobs.
router.get('/', requireUser, async (req, res) => {
  try {
    const limit = Math.min(200, Number(req.query.limit) || 50);
    const jobs = await repo.listJobsForUser({ userId: req.user.id, limit });
    return res.json({ jobs });
  } catch (err) {
    console.error('Job list error:', err.message);
    return res.status(500).json({ error: 'Job siyahısı alına bilmədi.' });
  }
});

// GET /api/jobs/:id — status/result (owner only).
router.get('/:id', requireUser, async (req, res) => {
  try {
    const job = await repo.getJob({ jobId: req.params.id, userId: req.user.id });
    if (!job) return res.status(404).json({ error: 'Job tapılmadı.' });
    return res.json({ job });
  } catch (err) {
    console.error('Job status error:', err.message);
    return res.status(500).json({ error: 'Job statusu alına bilmədi.' });
  }
});

// POST /api/jobs/:id/cancel — cooperative cancel (owner only).
router.post('/:id/cancel', requireUser, async (req, res) => {
  try {
    const job = await repo.cancelJob({ jobId: req.params.id, userId: req.user.id });
    if (!job) return res.status(404).json({ error: 'Job tapılmadı və ya artıq başa çatıb.' });
    return res.json({ job });
  } catch (err) {
    console.error('Job cancel error:', err.message);
    return res.status(500).json({ error: 'Job ləğv edilə bilmədi.' });
  }
});

// GET /api/jobs/:id/events — reconnectable event stream.
//   ?after=<seq>  resume from a known seq
//   ?stream=1     Server-Sent Events (default); otherwise a JSON snapshot
router.get('/:id/events', requireUser, async (req, res) => {
  try {
    const job = await repo.getJob({ jobId: req.params.id, userId: req.user.id });
    if (!job) return res.status(404).json({ error: 'Job tapılmadı.' });

    const afterSeq = Number(req.query.after) || 0;
    const useStream = req.query.stream !== '0';

    const existing = await repo.getEventsAfter({ jobId: job.id, afterSeq });

    if (!useStream) {
      return res.json({ job, events: existing });
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    const send = (event) => writeEvent(res, event);
    for (const e of existing) send(e);
    if (isTerminal(job.status)) send({ type: 'terminal', job });

    let lastSeen = afterSeq;
    if (existing.length) lastSeen = Math.max(lastSeen, ...existing.map((e) => e.seq));

    const pollMs = 500;
    const timer = setInterval(async () => {
      try {
        const current = await repo.getJob({ jobId: job.id, userId: req.user.id });
        if (!current) { clearInterval(timer); res.end(); return; }
        const fresh = await repo.getEventsAfter({ jobId: job.id, afterSeq: lastSeen });
        for (const e of fresh) {
          send(e);
          lastSeen = Math.max(lastSeen, e.seq);
        }
        if (isTerminal(current.status)) {
          send({ type: 'terminal', job: current });
          clearInterval(timer);
          res.end();
        }
      } catch {
        // ignore transient poll errors; the next tick will retry
      }
    }, pollMs);

    req.on('close', () => clearInterval(timer));
  } catch (err) {
    console.error('Job events error:', err.message);
    if (!res.headersSent) return res.status(500).json({ error: 'Job hadisələri alına bilmədi.' });
  }
});

module.exports = router;
