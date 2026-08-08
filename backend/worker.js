// ==========================================
// BahAI Worker — durable background job executor
// ==========================================
// Separate process from the web server. It claims durable jobs from PostgreSQL,
// runs them with the injected executor, and writes results/events back. The web
// process (index.js) only admits work; this process does the model calls.

try {
  require('dotenv').config({ path: require('path').resolve(__dirname, '.env') });
  require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
} catch { /* ignore */ }

const os = require('os');
const db = require('./db');
const { config } = require('./config');
const { logger } = require('./lib/structuredLogger');
const { createWorker } = require('./jobs/workerLoop');
const { createAgentExecutor } = require('./jobs/agentExecutor');

const WORKER_ID = process.env.WORKER_ID || `worker-${os.hostname()}-${process.pid}`;
const RECOVER_MS = parseInt(process.env.WORKER_RECOVER_MS || '5000', 10);

async function main() {
  await db.initDb();
  logger.info('Worker started', {
    workerId: WORKER_ID,
    concurrency: config.worker.concurrency,
    perUserActive: config.worker.perUserActive,
    omniRouteEnabled: config.omniRoute.enabled
  });

  const execute = await createAgentExecutor({ env: process.env, db });
  const worker = createWorker({
    workerId: WORKER_ID,
    concurrency: config.worker.concurrency,
    leaseMs: config.worker.leaseMs,
    heartbeatMs: config.worker.heartbeatMs,
    perUserActive: config.worker.perUserActive,
    pollIntervalMs: config.worker.pollMs,
    execute,
    onError: (err) => logger.error('worker error', { workerId: WORKER_ID, message: err && err.message })
  });

  worker.start();

  // Periodically recover jobs whose lease expired (worker crash/restart safety).
  const recoverTimer = setInterval(() => {
    worker.recover().catch((err) => logger.error('worker recover error', { message: err.message }));
  }, RECOVER_MS);

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('Worker shutting down', { workerId: WORKER_ID, signal });
    clearInterval(recoverTimer);
    await worker.drain();
    await db.shutdown();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('Worker start failed:', err);
  process.exit(1);
});
