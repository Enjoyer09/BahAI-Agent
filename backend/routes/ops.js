// ==========================================
// Ops endpoints — health checks + admin observability
// ==========================================
//   GET /health/live      public liveness probe (always 200 when process is up)
//   GET /health/ready     readiness probe (DB reachable)
//   GET /api/admin/ops    protected operational snapshot (breaker/queue/config)
//
// Mounted by index.js. The admin endpoint is guarded by ADMIN_OPS_TOKEN; if it
// is unset in production the endpoint is disabled (403) rather than open.

const express = require('express');
const router = express.Router();
const db = require('../db');
const repo = require('../jobs/repository');
const { createProviderHealth } = require('../jobs/providerHealth');
const { config } = require('../config');
const { logger } = require('../lib/structuredLogger');

// A shared (process-local) breaker instance so persistedStates() reflects this
// process's writes; in the worker process it is the authoritative instance.
const health = createProviderHealth({ db, env: process.env });

const startedAt = Date.now();

function isReady() {
  if (!db || typeof db.hasDatabase !== 'function' || !db.hasDatabase()) {
    return Promise.resolve(false);
  }
  return db.query('SELECT 1').then(() => true).catch(() => false);
}

// Liveness: the process is alive and the event loop is running.
router.get('/health/live', (req, res) => {
  res.status(200).json({
    status: 'ok',
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    timestamp: new Date().toISOString()
  });
});

// Readiness: can we actually serve work (DB reachable)?
router.get('/health/ready', async (req, res) => {
  const ready = await isReady();
  if (!ready) {
    return res.status(503).json({ status: 'not_ready', db: false, timestamp: new Date().toISOString() });
  }
  res.status(200).json({ status: 'ready', db: true, timestamp: new Date().toISOString() });
});

// Admin operational snapshot.
router.get('/api/admin/ops', async (req, res) => {
  const token = req.headers['x-admin-token'];
  const isProd = config.adminOpsToken && process.env.NODE_ENV === 'production';
  if (config.adminOpsToken) {
    if (token !== config.adminOpsToken) {
      return res.status(403).json({ error: 'Admin token tələb olunur' });
    }
  } else if (isProd) {
    return res.status(403).json({ error: 'Admin ops endpointi konfiqurasiya edilməyib (ADMIN_OPS_TOKEN)' });
  }

  const ready = await isReady().catch(() => false);
  let queue = null;
  try { queue = await repo.queueDepth(); } catch (e) { /* ignore */ }

  let breaker;
  try { breaker = await health.persistedStates(); } catch (e) { breaker = health.snapshot(); }

  const payload = {
    version: config.version,
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    timestamp: new Date().toISOString(),
    db: { ok: ready },
    queue,
    breaker,
    config: {
      workerConcurrency: config.worker.concurrency,
      perUserActive: config.worker.perUserActive,
      maxActivePerUser: config.quota.maxActivePerUser,
      breaker: config.breaker
    }
  };
  logger.info('Admin ops snapshot requested', { ip: req.ip });
  return res.status(200).json(payload);
});

module.exports = router;
module.exports.isReady = isReady;
