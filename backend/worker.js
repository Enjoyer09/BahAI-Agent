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
const { createWorker } = require('./jobs/workerLoop');
const { createAgentExecutor } = require('./jobs/agentExecutor');

const WORKER_ID = process.env.WORKER_ID || `worker-${os.hostname()}-${process.pid}`;
const RECOVER_MS = parseInt(process.env.WORKER_RECOVER_MS || '5000', 10);

async function main() {
  await db.initDb();
  console.log(`🔧 Worker başladı: ${WORKER_ID}`);

  const execute = await createAgentExecutor({ env: process.env });
  const worker = createWorker({
    workerId: WORKER_ID,
    execute,
    onError: (err) => console.error(`[worker:${WORKER_ID}] error:`, err && err.message)
  });

  worker.start();

  // Periodically recover jobs whose lease expired (worker crash/restart safety).
  const recoverTimer = setInterval(() => {
    worker.recover().catch((err) => console.error('[worker] recover error:', err.message));
  }, RECOVER_MS);

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[worker:${WORKER_ID}] ${signal} alındı, boşaldılır...`);
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
