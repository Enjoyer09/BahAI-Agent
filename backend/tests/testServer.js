// =============================================
// Shared test-server helper for integration tests
// =============================================
// Boots the real backend (node index.js) as a child process in LOCAL_MODE and
// guards against the two classic CI flake classes seen with these tests:
//
// 1. Port conflicts (macOS SO_REUSEADDR double-bind)
//    On macOS a second `node index.js` can bind the SAME port that a leftover
//    server from a previous run still holds. The new server prints
//    "server running", exits code 0, and incoming connections get routed to
//    the stale orphan, which destroys in-flight SSE responses with
//    "Error: aborted". Fix: derive a unique port from the worker's pid so no
//    two processes can ever share a port, and pre-flight check it is free.
//
// 2. Boot races
//    Waiting on the stdout "server running" marker alone is racy under load.
//    Fix: poll TCP connect until the port actually accepts connections, and
//    capture the child's stderr so a boot failure is diagnosable.
//
// Usage:
//   const { spawnTestServer, stopTestServer } = require('./testServer.js');
//   const { child, port } = await spawnTestServer({ base: 42000, envOverrides: {...} });
//   // ... supertest against http://127.0.0.1:${port}
//   await stopTestServer(child);

const { spawn } = require('node:child_process');
const net = require('node:net');
const { setTimeout: wait } = require('node:timers/promises');
const path = require('node:path');
const { fileURLToPath } = require('node:url');

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const CONNECT_TIMEOUT_MS = 600;

/**
 * Derive a unique port per vitest worker process AND per run. Different test
 * files use different `base` ranges, the pid offset separates concurrently
 * running workers, and the time offset separates repeated runs of the same
 * worker (thread pools / pid reuse), so no two live processes — including
 * orphans from previous runs — can ever collide on the same port.
 */
function pickTestPort(base) {
  return base + (process.pid % 200) + (Date.now() % 100);
}

function isPortOpen(port, host = '127.0.0.1', timeoutMs = CONNECT_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, timeoutMs);
    socket.once('connect', () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

async function waitForPort(port, { timeoutMs = 12000, intervalMs = 100 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isPortOpen(port)) return;
    await wait(intervalMs);
  }
  throw new Error(`Server boot timeout: port ${port} never accepted connections within ${timeoutMs}ms`);
}

async function stopTestServer(child) {
  if (!child || child.exitCode !== null) return;
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (!done) {
        done = true;
        resolve();
      }
    };
    const timer = setTimeout(() => {
      if (child.exitCode === null) {
        try { child.kill('SIGKILL'); } catch { /* already gone */ }
      }
      finish();
    }, 1200);
    child.once('exit', () => {
      clearTimeout(timer);
      finish();
    });
    child.kill('SIGTERM');
  });
}

async function spawnTestServer({ base, envOverrides = {}, bootTimeoutMs = 12000 }) {
  const port = pickTestPort(base);

  // Pre-flight: if the derived port is somehow already taken (collision or a
  // stale orphan), fail loudly instead of silently racing a stale server.
  if (await isPortOpen(port)) {
    throw new Error(`Test port ${port} is already in use before spawning; refusing to race a stale server.`);
  }

  // index.js loads root/backend .env with override:true — a checked-in PORT
  // entry would clobber the unique test port. Skip dotenv for test children so
  // the spawn env (PORT, provider keys, etc.) is authoritative. The generic
  // provider env keeps /api/chat from short-circuiting with "no providers" 503
  // in tests that only exercise GUI/SSE paths.
  const env = {
    ...process.env,
    OPENAI_BASE_URL: 'http://127.0.0.1:9/v1',
    OPENAI_API_KEY: 'test-provider-key',
    OPENAI_MODEL: 'test-model',
    ...envOverrides,
    PORT: String(port),
    BAHAI_DOTENV_SKIP: '1'
  };
  const child = spawn(process.execPath, ['index.js'], {
    cwd: backendRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let stderrBuf = '';
  child.stderr.on('data', (chunk) => {
    const text = chunk.toString();
    stderrBuf += text;
    process.stderr.write(text); // surface child logs in the test output
  });

  // Reject if the child dies (or fails to spawn) before becoming ready.
  const bootFailure = new Promise((_, reject) => {
    child.once('error', (err) => reject(err));
    child.once('exit', (code, signal) => {
      if (!child.__ready) {
        reject(new Error(
          `Test server exited during boot (code=${code} signal=${signal})` +
          (stderrBuf ? `\n--- child stderr ---\n${stderrBuf}` : '')
        ));
      }
    });
  });

  try {
    await Promise.race([waitForPort(port, { timeoutMs: bootTimeoutMs }), bootFailure]);
    child.__ready = true;
    // Let any post-listen async init settle before sending requests.
    await wait(150);
  } catch (error) {
    await stopTestServer(child);
    throw error;
  }

  return { child, port };
}

module.exports = {
  spawnTestServer,
  stopTestServer,
  pickTestPort,
  isPortOpen
};
