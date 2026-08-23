#!/usr/bin/env node
// ============================================================
// Durable-job load test harness (staged + stop-gated)
// ============================================================
// Drives the NEW durable background-agent API end to end:
//
//   1. Acquire N auth tokens (login or token pool)
//   2. POST /api/jobs           -> admit job  (bearer token)
//   3. GET  /api/jobs/:id/events -> follow SSE until `terminal`
//   4. Record per-job latency/status; compute stage metrics
//   5. Stop-gate between stages (error-rate / latency)
//
// Stages ramp 5 -> 10 -> 20 -> 50 -> 100 concurrent users so a
// degradation shows up gently before it becomes a 100-user storm.
//
// Credentials / authorization: this script talks to a REAL deployment.
// Do NOT point it at production without explicit sign-off, a raised
// JOB_MAX_ACTIVE_PER_USER cap (>= stage size), and a valid ADMIN_OPS_TOKEN.
//
// Self-test: `node scripts/loadtest-jobs.mjs --mock` spins up an
// embedded fake backend and exercises the full stage/stop-gate/report
// path with zero external dependencies.
//
// Config (env or CLI):
//   APP_BASE_URL        e.g. https://bahai-agent-production.up.railway.app
//   ADMIN_OPS_TOKEN     token for /api/admin/ops + /health/ready
//   AUTH_MODE           login | token | mock   (default: mock)
//   LOGIN_CREDS         JSON file path or inline JSON array [{email,password}]
//   AUTH_TOKENS         JSON file path or inline JSON array of bearer tokens
//   STAGES              5,10,20,50,100
//   PROMPTS_FILE        JSON array of prompt strings (optional)
//   MAX_FAIL_RATE       0.20   abort a stage run if fail rate exceeds this
//   MAX_MEDIAN_LATENCY  60000  ms; abort if stage median latency exceeds this
//   JOB_TIMEOUT         180000 ms per-job ceiling (counts as a timeout fail)
//   ONLY_STAGE          run a single stage N (skips the ramp)
//   OUT_DIR             artifacts/stress-production
//   SEED                random seed for prompt selection
// ============================================================

import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ---------- tiny arg/env helper ----------
function envOr(name, fallback) {
  return process.env[name] ?? fallback;
}
function parseList(v) {
  if (Array.isArray(v)) return v;
  return String(v).split(',').map((s) => s.trim()).filter(Boolean);
}

const ARGS = (() => {
  const a = {};
  for (const t of process.argv.slice(2)) {
    if (!t.startsWith('--')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) a[t.slice(2)] = true;
    else a[t.slice(2, eq)] = t.slice(eq + 1);
  }
  return a;
})();

const CONFIG = {
  appBaseUrl: (ARGS['app-base-url'] || envOr('APP_BASE_URL', 'http://127.0.0.1:0')).replace(/\/$/, ''),
  adminOpsToken: ARGS['admin-ops-token'] || envOr('ADMIN_OPS_TOKEN', ''),
  authMode: ARGS['auth-mode'] || envOr('AUTH_MODE', 'mock'),
  loginCreds: ARGS['login-creds'] || envOr('LOGIN_CREDS', ''),
  authTokens: ARGS['auth-tokens'] || envOr('AUTH_TOKENS', ''),
  stages: parseList(ARGS['stages'] || envOr('STAGES', '5,10,20,50,100')).map(Number),
  promptsFile: ARGS['prompts-file'] || envOr('PROMPTS_FILE', ''),
  maxFailRate: Number(ARGS['max-fail-rate'] || envOr('MAX_FAIL_RATE', '0.2')),
  maxMedianLatency: Number(ARGS['max-median-latency'] || envOr('MAX_MEDIAN_LATENCY', '60000')),
  jobTimeout: Number(ARGS['job-timeout'] || envOr('JOB_TIMEOUT', '180000')),
  onlyStage: ARGS['only-stage'] ? Number(ARGS['only-stage']) : (ARGS['only-stage'] === '' ? null : null),
  outDir: path.resolve(ROOT, ARGS['out-dir'] || envOr('OUT_DIR', 'artifacts/stress-production')),
  seed: Number(ARGS['seed'] || envOr('SEED', String(Date.now()))),
  mock: !!ARGS['mock'] || CONFIG_IS_MOCK(),
};

function CONFIG_IS_MOCK() {
  return (ARGS['mock'] === true) || envOr('AUTH_MODE', '') === 'mock' && !ARGS['app-base-url'] && !envOr('APP_BASE_URL', '');
}

// Default prompt pool (Azerbaijani, low difficulty so the provider path is the
// thing under test, not prompt complexity).
const DEFAULT_PROMPTS = [
  'Salam, necəsən?',
  'Bakıın əsas tarixi abidələrini qısa sadala.',
  '2 + 2 neçəyə bərabərdir?',
  'Azərbaycanın paytaxtı hansı şəhərdir?',
  '"yalnız OK yaz"',
  'Bir paragrafda Xəzər dənizi haqqında yaz.',
  '5 dəqiqəni saniyəyə çevir.',
  'Günün təbriki necə deyilir?',
  '3 * 7 hesabla.',
  'İlin neçə fəsli var?',
];

// ---------- utilities ----------
function log(level, msg, fields = {}) {
  const t = new Date().toISOString();
  const f = Object.entries(fields).map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' ');
  process.stderr.write(`[${t}] ${level.toUpperCase()} ${msg}${f ? ' ' + f : ''}\n`);
}
function percentile(sortedNums, p) {
  if (!sortedNums.length) return 0;
  const idx = Math.min(sortedNums.length - 1, Math.max(0, Math.round((p / 100) * (sortedNums.length - 1))));
  return sortedNums[idx];
}
function median(nums) {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ---------- HTTP helpers (global fetch is available in Node 18+) ----------
async function httpJson(method, url, { token, body, timeout = 30000 } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: ctrl.signal });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { _raw: text }; }
    return { status: res.status, ok: res.ok, data };
  } finally {
    clearTimeout(to);
  }
}

// ---------- auth ----------
async function acquireTokens(count) {
  if (CONFIG.authMode === 'token') {
    const raw = readJsonSource(CONFIG.authTokens);
    if (!Array.isArray(raw) || !raw.length) throw new Error('AUTH_TOKENS must be a JSON array of bearer tokens');
    // Token pool may be smaller than count; cycle through it.
    return Array.from({ length: count }, (_, i) => raw[i % raw.length]);
  }
  if (CONFIG.authMode === 'login') {
    const creds = readJsonSource(CONFIG.loginCreds);
    if (!Array.isArray(creds) || !creds.length) throw new Error('LOGIN_CREDS must be a JSON array of {email,password}');
    const tokens = [];
    for (let i = 0; i < count; i++) {
      const c = creds[i % creds.length];
      const r = await httpJson('POST', `${CONFIG.appBaseUrl}/api/auth/login`, {
        body: { email: c.email, password: c.password },
        timeout: 15000,
      });
      if (!r.ok || !r.data?.token) throw new Error(`login failed for ${c.email}: ${r.status}`);
      tokens.push(r.data.token);
    }
    return tokens;
  }
  // mock: fake tokens
  return Array.from({ length: count }, (_, i) => `mock-token-${i}-${crypto.randomBytes(4).toString('hex')}`);
}

function readJsonSource(src) {
  if (!src) return [];
  if (src.trim().startsWith('[')) return JSON.parse(src);
  const p = path.resolve(ROOT, src);
  if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  return JSON.parse(src); // try as inline JSON
}

// ---------- job submit + follow ----------
async function submitJob(token, prompt, idx) {
  const startedAt = Date.now();
  const res = await httpJson('POST', `${CONFIG.appBaseUrl}/api/jobs`, {
    token,
    body: {
      resourceClass: 'text',
      priority: 1,
      idempotencyKey: `loadtest-${CONFIG.seed}-${idx}-${crypto.randomBytes(3).toString('hex')}`,
      payload: { messages: [{ role: 'user', content: prompt }] },
    },
    timeout: 20000,
  });
  return {
    submittedAt: startedAt,
    httpStatus: res.status,
    jobId: res.data?.jobId || null,
    queuePosition: res.data?.queuePosition ?? null,
    admitError: res.ok ? null : (res.data?.error || `HTTP ${res.status}`),
  };
}

// Follow SSE until a `terminal` event. Resolves with terminal status + timings.
async function followJob(token, jobId, submittedAt) {
  const url = `${CONFIG.appBaseUrl}/api/jobs/${encodeURIComponent(jobId)}/events?stream=1&after=0`;
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(new Error('JOB_TIMEOUT')), CONFIG.jobTimeout);
  const out = { jobId, terminalStatus: 'timeout', terminalAt: Date.now(), firstEventAt: null, eventCount: 0, lastError: null };
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: ctrl.signal });
    if (!res.ok || !res.body) { out.terminalStatus = 'stream_error'; out.lastError = `HTTP ${res.status}`; return out; }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const frames = buf.split('\n\n');
      buf = frames.pop() || '';
      for (const frame of frames) {
        const line = frame.split('\n').find((l) => l.startsWith('data: '));
        if (!line) continue;
        const raw = line.slice(6).trim();
        if (!raw || raw === '[DONE]') continue;
        let ev;
        try { ev = JSON.parse(raw); } catch { continue; }
        if (out.firstEventAt == null) out.firstEventAt = Date.now();
        out.eventCount++;
        if (ev.type === 'terminal' || ev.type === 'error') {
          out.terminalStatus = ev.job?.status || (ev.type === 'error' ? 'failed' : out.terminalStatus);
          if (ev.errorMessage) out.lastError = ev.errorMessage;
          out.terminalAt = Date.now();
          return out;
        }
      }
    }
  } catch (e) {
    out.lastError = e.message || String(e);
    if (e.message === 'JOB_TIMEOUT') out.terminalStatus = 'timeout';
    else out.terminalStatus = 'stream_error';
  } finally {
    clearTimeout(to);
  }
  return out;
}

// ---------- stage runner (all N concurrent) ----------
async function runStage(stage, tokens, prompts) {
  log('info', `stage start`, { users: stage });
  // Submit all jobs concurrently.
  const submits = await Promise.all(
    Array.from({ length: stage }, (_, i) => {
      const prompt = prompts[(CONFIG.seed + i) % prompts.length];
      return submitJob(tokens[i % tokens.length], prompt, i).catch((e) => ({
        submittedAt: Date.now(), httpStatus: 0, jobId: null, queuePosition: null, admitError: e.message,
      }));
    })
  );

  // Follow every admitted job concurrently.
  const follows = await Promise.all(
    submits.map((s, i) => {
      if (!s.jobId) return Promise.resolve({ ...s, terminalStatus: 'admit_failed', terminalAt: Date.now(), firstEventAt: null, eventCount: 0, lastError: s.admitError });
      return followJob(tokens[i % tokens.length], s.jobId, s.submittedAt);
    })
  );

  const jobs = follows.map((f, i) => {
    const s = submits[i];
    const latency = f.terminalAt - s.submittedAt;
    const success = f.terminalStatus === 'completed';
    return {
      userIndex: i,
      jobId: s.jobId,
      httpStatus: s.httpStatus,
      queuePosition: s.queuePosition,
      terminalStatus: f.terminalStatus,
      latencyMs: latency,
      firstEventLatencyMs: f.firstEventAt ? f.firstEventAt - s.submittedAt : null,
      eventCount: f.eventCount,
      success,
      error: f.lastError || s.admitError || null,
    };
  });

  // Stage metrics.
  const latencies = jobs.filter((j) => j.latencyMs > 0).map((j) => j.latencyMs).sort((a, b) => a - b);
  const successCount = jobs.filter((j) => j.success).length;
  const failed = jobs.filter((j) => !j.success);
  const metrics = {
    users: stage,
    submitted: jobs.length,
    success: successCount,
    failed: failed.length,
    successRate: jobs.length ? successCount / jobs.length : 0,
    failRate: jobs.length ? failed.length / jobs.length : 1,
    medianLatencyMs: median(latencies),
    p95LatencyMs: percentile(latencies, 95),
    maxLatencyMs: latencies.length ? latencies[latencies.length - 1] : 0,
    minLatencyMs: latencies.length ? latencies[0] : 0,
    meanLatencyMs: latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0,
    failedByStatus: summarizeStatuses(failed),
  };
  return { metrics, jobs };
}

function summarizeStatuses(failed) {
  const m = {};
  for (const j of failed) {
    const key = j.terminalStatus + (j.error ? `:${String(j.error).slice(0, 60)}` : '');
    m[key] = (m[key] || 0) + 1;
  }
  return m;
}

// ---------- stop-gate ----------
function evaluateStopGate(metrics) {
  const reasons = [];
  if (metrics.failRate > CONFIG.maxFailRate) reasons.push(`failRate ${metrics.failRate.toFixed(2)} > ${CONFIG.maxFailRate} (max)`);
  if (metrics.medianLatencyMs > CONFIG.maxMedianLatency) reasons.push(`medianLatency ${metrics.medianLatencyMs}ms > ${CONFIG.maxMedianLatency}ms (max)`);
  return { halt: reasons.length > 0, reasons };
}

// ---------- readiness snapshot ----------
async function snapshotOps() {
  if (CONFIG.authMode === 'mock' || !CONFIG.adminOpsToken) return null;
  try {
    const r = await httpJson('GET', `${CONFIG.appBaseUrl}/api/admin/ops`, { token: CONFIG.adminOpsToken, timeout: 10000 });
    if (!r.ok) return { error: `HTTP ${r.status}` };
    return r.data;
  } catch (e) {
    return { error: e.message };
  }
}

// ---------- reporting ----------
function writeReports(run) {
  if (!fs.existsSync(CONFIG.outDir)) fs.mkdirSync(CONFIG.outDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const tag = CONFIG.authMode === 'mock' ? `durable-mock-${ts}` : `durable-${ts}`;
  const jsonPath = path.join(CONFIG.outDir, `agent-stress-${tag}.json`);
  const mdPath = path.join(CONFIG.outDir, `agent-stress-${tag}.md`);
  fs.writeFileSync(jsonPath, JSON.stringify(run, null, 2));
  fs.writeFileSync(mdPath, renderMarkdown(run));
  log('info', `report written`, { json: jsonPath, md: mdPath });
  return { jsonPath, mdPath };
}

function renderMarkdown(run) {
  const lines = [];
  lines.push(`# BahAI Durable-Job Load Test`);
  lines.push('');
  lines.push(`- Generated: ${run.generatedAt}`);
  lines.push(`- Target: \`${run.target}\``);
  lines.push(`- Auth mode: ${run.authMode}${run.authMode === 'mock' ? ' (self-test, NOT a real deployment)' : ''}`);
  lines.push(`- Stages: ${run.stages.join(' -> ')}`);
  lines.push(`- Stop-gate: failRate > ${run.maxFailRate}, medianLatency > ${run.maxMedianLatency}ms`);
  lines.push(`- Halted early: ${run.halted ? 'YES — ' + run.haltReason : 'no'}`);
  lines.push('');
  lines.push(`## Stage summary`);
  lines.push('');
  lines.push(`| Stage | Submitted | Success | Fail | Success% | Median ms | p95 ms | Max ms |`);
  lines.push(`|------:|----------:|--------:|----:|---------:|----------:|-------:|-------:|`);
  for (const s of run.stagesResults) {
    const m = s.metrics;
    lines.push(`| ${m.users} | ${m.submitted} | ${m.success} | ${m.failed} | ${(m.successRate * 100).toFixed(1)}% | ${m.medianLatencyMs} | ${m.p95LatencyMs} | ${m.maxLatencyMs} |`);
  }
  lines.push('');
  if (run.halted) {
    lines.push(`## ⚠️ Halt`);
    lines.push('');
    lines.push(run.haltReason);
    lines.push('');
  }
  lines.push(`## Per-stage failure breakdown`);
  for (const s of run.stagesResults) {
    lines.push('');
    lines.push(`### Stage ${s.metrics.users}`);
    const fb = s.metrics.failedByStatus;
    const keys = Object.keys(fb);
    if (!keys.length) { lines.push(`- no failures`); }
    else { for (const k of keys) lines.push(`- ${k}: ${fb[k]}`); }
  }
  lines.push('');
  lines.push(`## Readiness snapshots (ops)`);
  for (const s of run.stagesResults) {
    if (s.ops == null) continue;
    lines.push(`- Stage ${s.metrics.users}: ${JSON.stringify(s.ops).slice(0, 200)}`);
  }
  return lines.join('\n');
}

// ---------- embedded mock server (self-test) ----------
function startMockServer() {
  const jobs = new Map();
  let seq = 0;
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
    const sendSSE = (jobId) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      const t0 = Date.now();
      const tick = setInterval(() => {
        const job = jobs.get(jobId);
        if (!job) { clearInterval(tick); res.end(); return; }
        if (!job.emittedProgress && Date.now() - t0 > 200) {
          job.emittedProgress = true;
          res.write(`data: ${JSON.stringify({ type: 'progress', jobId, content: '...', seq: ++seq })}\n\n`);
        }
        if (Date.now() - t0 > 600) {
          job.status = 'completed';
          clearInterval(tick);
          res.write(`data: ${JSON.stringify({ type: 'terminal', job: { id: jobId, status: 'completed' }, seq: ++seq })}\n\n`);
          res.end();
        }
      }, 150);
    };

    if (req.method === 'POST' && u.pathname === '/api/auth/login') {
      let body = ''; req.on('data', (c) => (body += c)); req.on('end', () => send(200, { token: 'mock-' + crypto.randomBytes(4).toString('hex'), user: { id: 1 } }));
      return;
    }
    if (req.method === 'POST' && u.pathname === '/api/jobs') {
      let body = ''; req.on('data', (c) => (body += c)); req.on('end', () => {
        const id = 'job-' + crypto.randomBytes(6).toString('hex');
        jobs.set(id, { id, status: 'queued', emittedProgress: false });
        send(202, { jobId: id, status: 'queued', queuePosition: 1 });
      });
      return;
    }
    if (req.method === 'GET' && u.pathname.match(/^\/api\/jobs\/[^/]+\/events$/)) {
      const id = u.pathname.split('/')[3];
      if (!jobs.has(id)) return send(404, { error: 'not found' });
      return sendSSE(id);
    }
    if (req.method === 'GET' && u.pathname === '/api/admin/ops') {
      return send(200, { mock: true, queueDepth: jobs.size, db: { ok: true } });
    }
    if (req.method === 'GET' && u.pathname === '/health/ready') return send(200, { ok: true });
    send(404, { error: 'no route' });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    const { port } = server.address();
    resolve({ server, url: `http://127.0.0.1:${port}` });
  }));
}

// ---------- main ----------
async function main() {
  let mockHandle = null;
  if (CONFIG.mock || CONFIG.authMode === 'mock') {
    mockHandle = await startMockServer();
    CONFIG.appBaseUrl = mockHandle.url;
    log('info', `mock server up`, { url: CONFIG.appBaseUrl });
  }

  const prompts = CONFIG.promptsFile ? readJsonSource(CONFIG.promptsFile) : DEFAULT_PROMPTS;
  const stageList = CONFIG.onlyStage ? [CONFIG.onlyStage] : CONFIG.stages;
  const maxUsers = Math.max(...stageList);

  log('info', `acquiring tokens`, { mode: CONFIG.authMode, count: maxUsers });
  const tokens = await acquireTokens(maxUsers);

  const run = {
    generatedAt: new Date().toISOString(),
    target: CONFIG.appBaseUrl,
    authMode: CONFIG.authMode,
    stages: stageList,
    maxFailRate: CONFIG.maxFailRate,
    maxMedianLatency: CONFIG.maxMedianLatency,
    stagesResults: [],
    halted: false,
    haltReason: null,
  };

  for (const stage of stageList) {
    const pre = await snapshotOps();
    const { metrics, jobs } = await runStage(stage, tokens, prompts);
    const post = await snapshotOps();
    run.stagesResults.push({ metrics, jobs, ops: post || pre });
    log('info', `stage done`, { users: stage, successRate: metrics.successRate.toFixed(2), medianMs: metrics.medianLatencyMs, p95Ms: metrics.p95LatencyMs });

    const gate = evaluateStopGate(metrics);
    if (gate.halt) {
      run.halted = true;
      run.haltReason = `Stop-gate tripped at stage ${stage}: ${gate.reasons.join('; ')}. Halting before larger stages. Re-run with explicit --only-stage to continue past the gate.`;
      log('warn', `STOP-GATE tripped`, { stage, reasons: gate.reasons.join('; ') });
      break;
    }
  }

  const { jsonPath, mdPath } = writeReports(run);
  log('info', `done`, { json: jsonPath, md: mdPath, halted: run.halted });
  if (mockHandle) mockHandle.server.close();
  // Non-zero exit if halted, so CI can detect a degradation.
  process.exit(run.halted ? 2 : 0);
}

main().catch((e) => {
  log('error', `fatal`, { message: e.message, stack: e.stack });
  process.exit(1);
});
