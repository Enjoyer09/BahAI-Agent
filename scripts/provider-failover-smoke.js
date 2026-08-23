#!/usr/bin/env node
// ============================================================
// Provider Failover Smoke Test — Primary Cloud → NVIDIA
// ============================================================
// Verifies that when the primary cloud provider (env-driven web chat gateway)
// fails, the backend silently fails over to NVIDIA and the user still receives
// a normal answer — and that the whole trail is visible in the server's
// stdout, i.e. exactly the markers that appear in Railway deploy logs:
//
//   [PROVIDER] {"event":"provider_failure","providerId":"web_..._primary",...}
//   [PROVIDER] {"event":"provider_failover","providerId":"nvidia_...","fromProviderId":"web_..._primary",...}
//   🔁 Provider failover: switched to nvidia_...
//
// Note: provider_stream_start is only logged when the FIRST candidate succeeds
// (no failover); the failover branch emits failure -> failover -> switched.
//
// Modes
// -----
//   node scripts/provider-failover-smoke.js                # local (deterministic)
//   node scripts/provider-failover-smoke.js --remote       # against Railway URL
//   node scripts/provider-failover-smoke.js --remote --check-logs
//   node scripts/provider-failover-smoke.js --remote --check-logs --log-cmd-extra "-n 2000"
//
// Local mode (default):
//   - Spawns the real backend locally with OPENAI_BASE_URL pointing at a
//     throwaway HTTP server that always answers 401 -> the primary cloud
//     attempt fails deterministically.
//   - If a real NVIDIA_API_KEY (+ a NVIDIA_GENERAL_MODEL / NVIDIA_FAST_MODEL)
//     is present in the environment, the failover goes to REAL NVIDIA.
//   - Otherwise a built-in fake OpenAI-compatible NVIDIA stub answers and the
//     failover is validated against it (same code path, same log markers).
//   - Asserts the chat request returned 200 with assistant content AND that
//     stdout contains the provider_failure -> provider_failover -> switched
//     trail for nvidia.
//
// Remote mode (--remote):
//   - Logs in with the demo credentials and sends one web-chat request to
//     $BAHAI_SMOKE_BASE_URL (default Railway production). Asserting the
//     request succeeded. Failover itself can only be observed, not forced, on
//     a healthy production gateway.
//   - With --check-logs it runs $FAILOVER_LOG_CMD (default "railway logs") and
//     greps the output for the [PROVIDER] failover markers. The output is
//     filtered for THIS run's runId inside the shell (grep -F), so there is no
//     fixed byte cap: $FAILOVER_LOG_CMD may already carry flags (e.g.
//     "railway logs -n 2000") and extra ones can be appended with
//     --log-cmd-extra (or FAILOVER_LOG_CMD_EXTRA). When the runId cannot be
//     scoped (unreliable extraction), the caller is responsible for bounding
//     the output (e.g. -n) since there is no byte cap.
//
// Manual Railway verification after a run:
//   railway logs | grep -E '"event":"provider_failover"'
//
// Exit codes: 0 = pass, 1 = assertion failed, 2 = config missing,
//             3 = log check not available (--check-logs only).

const { spawn, execFile } = require('child_process');
const http = require('http');
const net = require('net');
const path = require('path');
const { setTimeout: wait } = require('node:timers/promises');

const ROOT = path.resolve(__dirname, '..');
const BACKEND_ROOT = path.join(ROOT, 'backend');
const REMOTE = process.argv.includes('--remote');
const CHECK_LOGS = process.argv.includes('--check-logs');
const HELP = process.argv.includes('--help') || process.argv.includes('-h');
const REQUIRE_REAL_NVIDIA = process.argv.includes('--require-real-nvidia');

const BASE_URL = process.env.BAHAI_SMOKE_BASE_URL || 'https://bahai-agent-production.up.railway.app';
const EMAIL = process.env.BAHAI_SMOKE_EMAIL || 'demo@bahai.az';
const PASSWORD = process.env.BAHAI_SMOKE_PASSWORD || 'demo123';
const EXPECT_PROVIDER = (process.env.FAILOVER_SMOKE_EXPECT_PROVIDER || 'nvidia').toLowerCase();
const LOG_CMD = process.env.FAILOVER_LOG_CMD || 'railway logs';

// Read a CLI flag value: `--name value` or `--name=value`. Returns null when
// the flag is absent.
function argValue(name) {
  const prefix = `${name}=`;
  const inline = process.argv.find((flag) => flag.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(name);
  return index !== -1 && index + 1 < process.argv.length ? process.argv[index + 1] : null;
}
// Extra flags appended to the log command, e.g. "-n 2000". Prefer the CLI
// flag over the env var so ad-hoc invocations do not need new env plumbing.
const LOG_CMD_EXTRA = (argValue('--log-cmd-extra') || process.env.FAILOVER_LOG_CMD_EXTRA || '').trim();

const PROMPT = 'Bu bir failover yoxlama sorğusudur. Zəhmət olmasa bir cümlə ilə cavab ver.';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function printUsage() {
  console.log(`Provider Failover Smoke Test — Primary Cloud → NVIDIA

Usage:
  node scripts/provider-failover-smoke.js                Local deterministic run (default)
  node scripts/provider-failover-smoke.js --remote       Against ${BASE_URL}
  node scripts/provider-failover-smoke.js --remote --check-logs

Flags:
  --remote                  Hit the deployed backend (Railway) instead of a local spawn
  --check-logs              (with --remote) grep $FAILOVER_LOG_CMD output for failover markers
  --log-cmd-extra ARGS      (with --check-logs) append ARGS to $FAILOVER_LOG_CMD, e.g.
                            --log-cmd-extra "-n 2000" (env: FAILOVER_LOG_CMD_EXTRA)
  --require-real-nvidia     Local mode: fail instead of using the built-in fake NVIDIA stub
  -h, --help                Show this help

Env:
  BAHAI_SMOKE_BASE_URL      Remote base URL (default ${BASE_URL})
  BAHAI_SMOKE_EMAIL         Demo login email (default demo@bahai.az)
  BAHAI_SMOKE_PASSWORD      Demo login password (default demo123)
  NVIDIA_API_KEY            Real NVIDIA key -> local mode validates real Primary-Cloud→NVIDIA failover
  NVIDIA_BASE_URL           NVIDIA endpoint (default https://integrate.api.nvidia.com/v1)
  NVIDIA_GENERAL_MODEL      NVIDIA model id (or NVIDIA_FAST_MODEL)
  FAILOVER_SMOKE_EXPECT_PROVIDER   Assert failover to this provider prefix (default nvidia)
  FAILOVER_LOG_CMD          (--check-logs) command whose output is grepped (default "railway logs")
  FAILOVER_LOG_CMD_EXTRA    (--check-logs) extra flags appended to $FAILOVER_LOG_CMD (e.g. "-n 2000")

Exit codes: 0 pass, 1 assertion failed, 2 config missing, 3 log check unavailable.`);
}

// ------------------------------------------------------------
// Small HTTP stubs used by the local deterministic mode
// ------------------------------------------------------------

function startPrimaryFailureServer() {
  const server = http.createServer((req, res) => {
    res.writeHead(401, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      error: { message: 'forced failover smoke failure', type: 'authentication_error', code: 'invalid_api_key' }
    }));
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({
      port: server.address().port,
      close: () => new Promise((r) => server.close(r))
    }));
  });
}

function startFakeNvidiaServer() {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', 'connection': 'keep-alive' });
    const chunk = (payload) => res.write(`data: ${JSON.stringify(payload)}\n\n`);
    chunk({ id: 'chatcmpl-fake', object: 'chat.completion.chunk', created: Date.now(), model: 'fake-nemotron', choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }] });
    chunk({ id: 'chatcmpl-fake', object: 'chat.completion.chunk', created: Date.now(), model: 'fake-nemotron', choices: [{ index: 0, delta: { content: 'Failover smoke test ok.' }, finish_reason: null }] });
    chunk({ id: 'chatcmpl-fake', object: 'chat.completion.chunk', created: Date.now(), model: 'fake-nemotron', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });
    res.write('data: [DONE]\n\n');
    res.end();
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({
      port: server.address().port,
      close: () => new Promise((r) => server.close(r))
    }));
  });
}

// ------------------------------------------------------------
// Backend child-process helpers (pid-unique port, TCP boot wait,
// guaranteed teardown — same anti-flake pattern as the test suite)
// ------------------------------------------------------------

function isPortOpen(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const timer = setTimeout(() => { socket.destroy(); resolve(false); }, 600);
    socket.once('connect', () => { clearTimeout(timer); socket.destroy(); resolve(true); });
    socket.once('error', () => { clearTimeout(timer); resolve(false); });
  });
}

async function waitForPort(port, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isPortOpen(port)) return;
    await wait(100);
  }
  throw new Error(`Backend boot timeout: port ${port} never accepted connections`);
}

function stopChild(child) {
  if (!child || child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    const timer = setTimeout(() => {
      if (child.exitCode === null) { try { child.kill('SIGKILL'); } catch { /* gone */ } }
      finish();
    }, 1200);
    child.once('exit', () => { clearTimeout(timer); finish(); });
    child.kill('SIGTERM');
  });
}

async function spawnBackend(envOverrides, stripEnv = []) {
  const port = 43100 + (process.pid % 300) + (Date.now() % 50);
  if (await isPortOpen(port)) throw new Error(`Test port ${port} already in use; aborting to avoid racing a stale server`);
  // Keep the deterministic run hermetic: never let a real provider pool or
  // live OpenRouter key silently consume credits if the NVIDIA attempt fails.
  const baseEnv = { ...process.env };
  for (const key of stripEnv) delete baseEnv[key];
  const env = { ...baseEnv, ...envOverrides, PORT: String(port) };
  const child = spawn(process.execPath, ['index.js'], {
    cwd: BACKEND_ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stdoutBuf = '';
  let stderrBuf = '';
  child.stdout.on('data', (c) => { stdoutBuf += c.toString(); });
  child.stderr.on('data', (c) => { stderrBuf += c.toString(); });
  const bootFailure = new Promise((_, reject) => {
    child.once('error', (err) => reject(err));
    child.once('exit', (code, signal) => {
      if (!child.__ready) {
        reject(new Error(`Backend exited during boot (code=${code} signal=${signal})${stderrBuf ? `\n${stderrBuf}` : ''}`));
      }
    });
  });
  try {
    await Promise.race([waitForPort(port), bootFailure]);
    child.__ready = true;
    await wait(150);
  } catch (error) {
    await stopChild(child);
    throw error;
  }
  return { child, port, getStdout: () => stdoutBuf };
}

// ------------------------------------------------------------
// Chat request helper
// ------------------------------------------------------------

async function sendWebChat(baseUrl, token) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90000);
  try {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        accept: 'text/event-stream'
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: PROMPT }],
        model: 'auto',
        productMode: 'web_chat',
        orchestrationMode: false,
        workflow: '',
        workingDirectory: 'workspace://default'
      }),
      signal: controller.signal
    });
    const text = await response.text();
    // orchestration_state is the first SSE event and carries the runId that
    // every [PROVIDER] log line embeds — used to correlate deploy logs with
    // this exact request in --check-logs mode.
    const runId = text.match(/"runId":"([^"]+)"/)?.[1] || null;
    return { status: response.status, text, runId };
  } finally {
    clearTimeout(timer);
  }
}

async function login(baseUrl) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD })
  });
  assert(response.ok, `login failed: ${response.status}`);
  const body = await response.json();
  assert(!!body.token, 'login returned no token');
  return body.token;
}

// ------------------------------------------------------------
// Log analysis — the markers Railway deploy logs show
// ------------------------------------------------------------

function analyzeLogs(stdout, expectProvider) {
  const lines = String(stdout || '').split('\n');
  const providerLines = lines.filter((line) => line.includes('[PROVIDER]'));
  const failures = providerLines.filter((line) => line.includes('"event":"provider_failure"'));
  const failovers = providerLines.filter((line) => line.includes('"event":"provider_failover"'));
  const switched = lines.filter((line) => /🔁 Provider failover: switched to/i.test(line));

  const primaryFailure = failures.some((line) => /"providerId":"web_\w+_primary/i.test(line));
  // The failover line must show the primary-cloud -> expected-provider direction
  // (fromProviderId/previousProviderId = web_..._primary, providerId = nvidia).
  const nvidiaFailover = failovers.some((line) => (
    /"fromProviderId":"web_\w+_primary|web_\w+_local_primary/i.test(line) &&
    new RegExp(`"providerId":"${expectProvider}`, 'i').test(line)
  ));
  const nvidiaSwitched = switched.some((line) => new RegExp(`switched to ${expectProvider}`, 'i').test(line));

  return {
    primaryFailure,
    nvidiaFailover,
    nvidiaSwitched,
    trail: {
      failure: failures.slice(0, 3),
      failover: failovers.slice(0, 3),
      switched: switched.slice(0, 3)
    }
  };
}

// ------------------------------------------------------------
// Local deterministic mode
// ------------------------------------------------------------

async function runLocalMode() {
  console.log('=== Provider failover smoke — LOCAL deterministic mode ===');
  const realNvidiaKey = String(process.env.NVIDIA_API_KEY || '').trim();
  const realNvidiaModel = String(process.env.NVIDIA_GENERAL_MODEL || process.env.NVIDIA_FAST_MODEL || '').trim();
  if (realNvidiaKey && !realNvidiaModel) {
    console.error('NVIDIA_API_KEY set, but neither NVIDIA_GENERAL_MODEL nor NVIDIA_FAST_MODEL is set — NVIDIA would not be a failover candidate.');
    return 2;
  }
  if (REQUIRE_REAL_NVIDIA && !realNvidiaKey) {
    console.error('--require-real-nvidia set but NVIDIA_API_KEY is missing. Provide NVIDIA_API_KEY + NVIDIA_GENERAL_MODEL.');
    return 2;
  }
  const useRealNvidia = Boolean(realNvidiaKey);
  console.log(useRealNvidia
    ? 'Using REAL NVIDIA (NVIDIA_API_KEY present).'
    : 'No NVIDIA_API_KEY — using built-in fake NVIDIA stub (same code path, same log markers).');

  // 1) Deterministic primary-cloud failure: a server that always answers 401.
  const omniFail = await startPrimaryFailureServer();
  // 2) NVIDIA endpoint: real NVIDIA config or the built-in fake stub.
  let fakeNvidia = null;
  const nvidiaEnv = {};
  if (useRealNvidia) {
    nvidiaEnv.NVIDIA_API_KEY = realNvidiaKey;
    if (process.env.NVIDIA_BASE_URL) nvidiaEnv.NVIDIA_BASE_URL = process.env.NVIDIA_BASE_URL;
    if (process.env.NVIDIA_GENERAL_MODEL) nvidiaEnv.NVIDIA_GENERAL_MODEL = process.env.NVIDIA_GENERAL_MODEL;
    if (process.env.NVIDIA_FAST_MODEL) nvidiaEnv.NVIDIA_FAST_MODEL = process.env.NVIDIA_FAST_MODEL;
    if (process.env.NVIDIA_SMART_MODEL) nvidiaEnv.NVIDIA_SMART_MODEL = process.env.NVIDIA_SMART_MODEL;
    if (process.env.NVIDIA_CODE_MODEL) nvidiaEnv.NVIDIA_CODE_MODEL = process.env.NVIDIA_CODE_MODEL;
    if (process.env.NVIDIA_FALLBACK_MODELS) nvidiaEnv.NVIDIA_FALLBACK_MODELS = process.env.NVIDIA_FALLBACK_MODELS;
  } else {
    fakeNvidia = await startFakeNvidiaServer();
    nvidiaEnv.NVIDIA_API_KEY = 'fake-nvidia-key';
    nvidiaEnv.NVIDIA_BASE_URL = `http://127.0.0.1:${fakeNvidia.port}/v1`;
    nvidiaEnv.NVIDIA_GENERAL_MODEL = 'fake-nemotron-3-nano';
  }

  let child = null;
  let stdout = '';
  try {
    const booted = await spawnBackend({
      LOCAL_MODE: 'true',
      JWT_SECRET: 'provider_failover_smoke_secret',
      NODE_ENV: 'test',
      WORKSPACE_ROOT: '/tmp/bahai_failover_smoke',
      ALLOWED_DIRECTORIES: '/tmp,/app',
      OPENAI_BASE_URL: `http://127.0.0.1:${omniFail.port}/v1`,
      OPENAI_API_KEY: 'failover-smoke-invalid-key',
      OPENAI_MODEL: 'gpt-5.5',
      PROVIDER_COOLDOWN_MS: '1000',
      ...nvidiaEnv
    }, ['AI_PROVIDER_POOL', 'OPENROUTER_API_KEY']);
    child = booted.child;
    stdout = booted.getStdout();
    console.log(`Backend spawned on port ${booted.port}.`);

    console.log(`Sending web-chat request: "${PROMPT}"`);
    const result = await sendWebChat(`http://127.0.0.1:${booted.port}`, null);
    stdout = booted.getStdout();
    console.log(`Chat status: ${result.status}`);

    assert(result.status === 200, `chat request failed: ${result.status}`);
    assert(
      result.text.includes('assistant_message') || result.text.includes('assistant_delta'),
      'SSE response contained no assistant content — the user would have seen an error'
    );
    if (!useRealNvidia) {
      assert(result.text.includes('Failover smoke test ok.'), 'fake-NVIDIA answer missing from SSE body');
    }
    console.log('Chat response OK: user received a normal answer (no visible failure).');

    const analysis = analyzeLogs(stdout, EXPECT_PROVIDER);
    console.log('\n--- [PROVIDER] markers captured from backend stdout ---');
    for (const line of [...analysis.trail.failure, ...analysis.trail.failover, ...analysis.trail.switched].slice(0, 9)) {
      console.log(line.trim());
    }
    console.log('--------------------------------------------------------');

    assert(analysis.primaryFailure, 'No provider_failure for the primary cloud provider found in stdout');
    assert(analysis.nvidiaFailover, `No provider_failover from primary cloud to "${EXPECT_PROVIDER}" found in stdout`);
    assert(analysis.nvidiaSwitched, `No "🔁 Provider failover: switched to ${EXPECT_PROVIDER}" found in stdout`);

    console.log(`\n✅ PASS: Primary Cloud → ${EXPECT_PROVIDER} failover verified` +
      (useRealNvidia ? ' (REAL NVIDIA)' : ' (fake NVIDIA stub)') +
      `
The exact markers above are what Railway deploy logs will contain.`
      + `\nRailway manual check: railway logs | grep -E '"event":"provider_failover"'`);
    return 0;
  } finally {
    if (child) await stopChild(child);
    await omniFail.close();
    if (fakeNvidia) await fakeNvidia.close();
  }
}

// ------------------------------------------------------------
// Remote (Railway) mode
// ------------------------------------------------------------

// RunIds produced by the backend are crypto.randomUUID() values (hex + dashes),
// so the grep pattern is always shell-safe in practice. The whitelist below is
// defense in depth: the `[^"]+` capture excludes double quotes but a stray
// single quote or other metacharacter would otherwise break out of the
// single-quoted grep pattern.
const SAFE_RUN_ID = /^[A-Za-z0-9_-]+$/;

// Build the shell command that collects deploy logs. The caller controls the
// log window with extra flags (--log-cmd-extra / FAILOVER_LOG_CMD_EXTRA), so
// commands like "railway logs -n 2000" work (Railway CLI v5 uses -n/--lines,
// NOT --limit). There is deliberately no fixed byte cap: the old
// `| head -c 262144` could silently drop the very runId-scoped lines this
// check needs.
function buildScopedLogCommand(runId) {
  let command = LOG_CMD;
  if (LOG_CMD_EXTRA) command += ` ${LOG_CMD_EXTRA}`;
  if (runId && SAFE_RUN_ID.test(runId)) {
    // Filter in the shell so only THIS run's lines cross the pipe: bounded
    // buffering, no truncation, and unrelated traffic cannot false-pass.
    command += ` | grep -F '"runId":"${runId}"'`;
  }
  return command;
}

async function checkRailwayLogs(runId) {
  // Only shell-grep when the runId is whitelist-safe; otherwise fall back to
  // scanning the whole output (same behavior as when no runId was extracted).
  const safeRunId = runId && SAFE_RUN_ID.test(runId) ? runId : null;
  const scopedCommand = buildScopedLogCommand(safeRunId);
  console.log(`\nChecking deploy logs via: ${scopedCommand}`);
  return new Promise((resolve) => {
    const child = execFile('bash', ['-c', scopedCommand], { timeout: 30000 }, (error, stdout, stderr) => {
      const out = String(stdout || '');
      const errText = String(stderr || '').trim();
      // `grep -F` exits 1 when nothing matched this run — that is a valid
      // "no logs for this runId" result, not a broken check.
      const grepNoMatch = Boolean(error && error.code === 1 && safeRunId);
      // A broken railway CLI (not linked / unauthenticated) also exits
      // non-zero, and bash reports the pipeline's last command (grep) as the
      // status — so grepNoMatch would otherwise swallow it. Detect the
      // failure in stderr and report the check as unavailable instead of a
      // misleading "no lines for this run".
      const railwayFailure = grepNoMatch && /not linked|log\s*in|unauthor|401|invalid token|no such project|project not found/i.test(errText);
      if (error && !grepNoMatch) {
        console.error('Log check not available:', error.message);
        if (errText) console.error(errText);
        console.error('Run the check manually: railway logs | grep -E \'"event":"provider_failover"\'');
        resolve(3);
        return;
      }
      if (railwayFailure) {
        console.error('Log check not available — the log command reported an error:');
        if (errText) console.error(errText);
        console.error('Run the check manually: railway logs | grep -E \'"event":"provider_failover"\'');
        resolve(3);
        return;
      }
      if (grepNoMatch && errText) {
        // Surface e.g. a railway CLI auth/link error instead of hiding it.
        console.error(`Log command stderr:\n${errText}`);
      }
      const analysis = analyzeLogs(out, EXPECT_PROVIDER);
      if (analysis.primaryFailure) {
        console.log('\n--- [PROVIDER] failover trail found in deploy logs ---');
        for (const line of [...analysis.trail.failure, ...analysis.trail.failover, ...analysis.trail.switched].slice(0, 9)) {
          console.log(line.trim());
        }
      }
      if (analysis.nvidiaFailover) {
        console.log(`\n✅ PASS: deploy logs show Primary Cloud → ${EXPECT_PROVIDER} failover.`);
        resolve(0);
      } else if (analysis.primaryFailure) {
        console.log(`\nℹ️  Deploy logs show provider failures/failovers but none to "${EXPECT_PROVIDER}". This is normal when the live primary gateway was healthy for this run.`);
        resolve(0);
      } else if (safeRunId) {
        console.log(`\nℹ️  No [PROVIDER] telemetry lines for runId "${safeRunId}" in the deploy-log window.`);
        console.log('     The window may not cover this request — widen it, e.g. --log-cmd-extra "-n 5000", or Railway may not retain these logs.');
        console.log('Verify manually: railway logs | grep -E \'"event":"provider_failover"\'');
        resolve(0);
      } else {
        console.log('\nℹ️  No [PROVIDER] telemetry lines in the recent deploy-log window (no scoped runId available for this check).');
        console.log('Verify manually: railway logs | grep -E \'"event":"provider_failover"\'');
        resolve(0);
      }
    });
    // Belt-and-braces kill in case the log stream does not terminate. The
    // timer is unref'd: a completed check must not keep the process alive
    // ~32s after the callback fires (that delayed every --check-logs exit and
    // made sequential runs appear to hang).
    const killTimer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* done */ } }, 32000);
    killTimer.unref();
  });
}

async function runRemoteMode() {
  console.log(`=== Provider failover smoke — REMOTE mode against ${BASE_URL} ===`);
  const token = await login(BASE_URL);
  console.log('Login ok.');

  const result = await sendWebChat(BASE_URL, token);
  console.log(`Chat status: ${result.status}`);
  assert(result.status === 200, `chat request failed: ${result.status}`);
  assert(
    result.text.includes('assistant_message') || result.text.includes('assistant_delta'),
    'SSE response contained no assistant content'
  );
  console.log('Chat response OK: production returned a normal answer.');
  if (result.runId) console.log(`Request runId: ${result.runId}`);

  console.log('\nThe server-side routing for this request is logged as [PROVIDER] lines in the Railway deploy log:');
  console.log('  railway logs | grep -E \'("[PROVIDER]|Provider failover)\'');
  console.log('  Expected failover trail: "event":"provider_failure" (web_..._primary) -> "event":"provider_failover" (providerId=nvidia, fromProviderId=web_..._primary)');
  console.log('  plus: 🔁 Provider failover: switched to nvidia_...');

  if (CHECK_LOGS) {
    const logResult = await checkRailwayLogs(result.runId);
    return logResult;
  }
  console.log('ℹ️  (Add --check-logs to grep the deploy logs automatically.)');
  return 0;
}

// ------------------------------------------------------------

async function main() {
  if (HELP) {
    printUsage();
    return 0;
  }
  if (REMOTE) {
    return runRemoteMode();
  }
  return runLocalMode();
}

main().then((code) => {
  process.exitCode = code;
}).catch((error) => {
  console.error(`\n❌ Provider failover smoke FAILED: ${error.message}`);
  process.exitCode = 1;
});
