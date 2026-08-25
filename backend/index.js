// ==========================================
// BahAI Backend — Slim Entry Point
// ==========================================
// All route handlers are in backend/routes/*.js
// Utility functions are in backend/helpers.js
// Tool execution is in backend/toolRunner.js

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const moduleAlias = require('module');

// Extend Node module resolution paths
const extraModulePaths = [
  path.resolve(__dirname, 'node_modules'),
  path.resolve(__dirname, '..', 'node_modules'),
  path.resolve(__dirname, '..', '..', 'node_modules'),
];
for (const p of extraModulePaths) {
  if (fs.existsSync(p) && !moduleAlias.globalPaths.includes(p)) {
    moduleAlias.globalPaths.push(p);
  }
}

// Safe dotenv loading with zero-dependency fallback. Test-child processes
// (tests/testServer.js) set BAHAI_DOTENV_SKIP=1 so their unique PORT/SSE env
// passed via spawn is not overridden by a checked-in .env PORT entry.
const dotenvSkipped = process.env.BAHAI_DOTENV_SKIP === '1';
if (!dotenvSkipped) {
  try {
    require('dotenv').config({ path: path.resolve(__dirname, '.env'), override: true });
    require('dotenv').config({ path: path.resolve(__dirname, '..', '.env'), override: true });
  } catch {
  const envFiles = [
    path.resolve(__dirname, '.env'),
    path.resolve(__dirname, '..', '.env'),
    process.env.DOTENV_CONFIG_PATH
  ].filter(Boolean);
  for (const envFile of envFiles) {
    if (fs.existsSync(envFile)) {
      try {
        const lines = fs.readFileSync(envFile, 'utf-8').split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
            const idx = trimmed.indexOf('=');
            const k = trimmed.slice(0, idx).trim();
            const v = trimmed.slice(idx + 1).trim();
            if (k && !process.env[k]) process.env[k] = v;
          }
        }
      } catch {}
    }
  }
}
}

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection:', reason);
});

// SEC: production misconfiguration guard. LOCAL_MODE=true and DEMO_LOGIN_ENABLED=true
// silently turn the deployment into an unauthenticated admin server — fail fast
// instead of shipping an open deployment.
if (process.env.NODE_ENV === 'production') {
  if (String(process.env.LOCAL_MODE || '').toLowerCase() === 'true') {
    throw new Error('LOCAL_MODE=true production mühitində qadağandır — bu serveri icazəsiz admin serverinə çevirir.');
  }
  if (String(process.env.DEMO_LOGIN_ENABLED || '').toLowerCase() === 'true') {
    throw new Error('DEMO_LOGIN_ENABLED=true production mühitində qadağandır — hər kəs admin girişi alır.');
  }
}

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const compression = require('compression');

const app = express();

// Per-request correlation id — every error log and client-visible error
// carries it, so a user-reported "Server xetasi" can be matched to the
// exact stack trace in Railway logs.
app.use(function (req, res, next) {
  req.correlationId = crypto.randomUUID();
  next();
});
app.set('trust proxy', 1);
const db = require('./db');
const { router: authRoutes, verifyToken } = require('./auth');

// Initialize Database
db.initDb();

// ==========================================
// Module Imports
// ==========================================
const { setAllowedDirs, isLocalMode } = require('./helpers');

// Route modules
const chatRouter = require('./routes/chat');
const jobsRouter = require('./routes/jobs');
const filesRouter = require('./routes/files');
const projectsRouter = require('./routes/projects');
const conversationsRouter = require('./routes/conversations');
const githubRouter = require('./routes/github');
const browserRouter = require('./routes/browser');
const miscRouter = require('./routes/misc');
const approvalsRouter = require('./routes/approvals');
const ttsRouter = require('./routes/tts');
const speechRouter = require('./routes/speech');
const opsRouter = require('./routes/ops');
const screenCaptureRouter = require('./routes/screenCapture');

// ==========================================
// Configuration
// ==========================================
const PORT = process.env.PORT || 3001;
const WORKSPACE_ROOT = path.resolve(process.env.WORKSPACE_ROOT || path.join(__dirname, '../sandbox'));
const FRONTEND_DIST = path.resolve(__dirname, '../frontend/dist');
// SEC-FIX: By default only the sandbox directory is allowed. Previously the entire
// project root was included which let the AI agent read/write .env, node_modules,
// backend/ and frontend/ source files. On cloud deployments ALLOWED_DIRECTORIES
// env must be set explicitly. In LOCAL_MODE isPathSafe bypasses this check.
const ALLOWED_DIRS = process.env.ALLOWED_DIRECTORIES
  ? process.env.ALLOWED_DIRECTORIES.split(',').map(d => path.resolve(d.trim()))
  : [
      path.resolve(WORKSPACE_ROOT),
    ];

// Initialize helpers with config
setAllowedDirs(WORKSPACE_ROOT, ALLOWED_DIRS);

// Startup diagnostics
const diagKey = process.env.OPENAI_API_KEY;
const keyDisplay = diagKey
  ? (process.env.NODE_ENV === 'production' ? '\u2705 set' : diagKey.slice(0, 4) + '...' + diagKey.slice(-2))
  : '\u274c not set';
console.log('\u{1f4a1} Startup Config:', {
  PORT,
  LOCAL_MODE: process.env.LOCAL_MODE || '(not set)',
  DATABASE_URL: process.env.DATABASE_URL ? '\u2705 set' : '\u274c not set',
  OPENAI_API_KEY: keyDisplay,
  OPENAI_BASE_URL: process.env.OPENAI_BASE_URL || '(not set)',
  OPENAI_MODEL: process.env.OPENAI_MODEL || '(not set)',
  JWT_SECRET: process.env.JWT_SECRET ? '\u2705 set' : '\u274c not set',
  NODE_ENV: process.env.NODE_ENV || '(not set)',
  isLocalMode: isLocalMode()
});

// ==========================================
// CORS
// ==========================================
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

const isProd = process.env.NODE_ENV === 'production';
if (isProd && allowedOrigins.length === 0) {
  console.error('⚠️ Production CORS: ALLOWED_ORIGINS təyin olunmayıb — cross-origin brauzer sorğuları bloklanacaq. Frontend ayrı domendədirsə ALLOWED_ORIGINS-i mütləq təyin edin.');
}

const corsConfig = allowedOrigins.length > 0
  ? cors({
      origin: (origin, cb) => {
        if (!origin) return cb(null, true);
        if (allowedOrigins.includes(origin)) return cb(null, true);
        return cb(new Error('CORS blocked origin: ' + origin));
      },
      credentials: true
    })
  // Production-da allowlist yoxdursa fail-closed: cross-origin brauzer sorğuları
  // CORS header-i almır (eyni-origin və origin-siz sorğular təsirlənmir). Lokal
  // dev-də köhnə davranış qorunur (istənilən origin).
  : (isProd
      ? cors({ origin: false })
      : cors({ origin: true }));

app.use(corsConfig);
// PERF: gzip/deflate all non-SSE responses. Mobile networks benefit heavily
// from compressed JSON, HTML and static JS/CSS. SSE (text/event-stream) is
// excluded because compression buffers chunks, which defeats real-time streaming.
app.use(compression({
  filter: (req, res) => {
    if (req.headers.accept === 'text/event-stream') return false;
    if (res.getHeader('Content-Type') === 'text/event-stream') return false;
    return compression.filter(req, res);
  },
  threshold: 1024, // only compress responses > 1KB
}));
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || '25mb' }));

// ==========================================
// Frontend Static App (Railway/Web)
// ==========================================
// PERF: Vite outputs content-hashed filenames (assets/*.js, assets/*.css).
// Set aggressive cache for those; short cache for index.html and non-hashed.
app.use(express.static(FRONTEND_DIST, {
  maxAge: '7d',
  immutable: true,
  setHeaders(res, filePath) {
    // index.html must not be aggressively cached — new deploys change its
    // script references. Hashed assets can be cached indefinitely.
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
    }
  }
}));

// ==========================================
// Published Mini-Apps (/apps/<id>/index.html)
// ==========================================
// Self-contained HTML pages the agent publishes via the build_and_publish_app
// tool. On Railway the APPS_DIR defaults to <repo>/backend/apps which is
// ephemeral — mount a Railway Volume there for persistence across deploys.
const { ensureAppsDir } = require('./tools/appBuilder');
const APPS_DIR = ensureAppsDir();
app.use('/apps', express.static(APPS_DIR, {
  index: 'index.html',
  fallthrough: true,
  setHeaders(res, filePath) {
    // Published pages are versioned by their id (random hex or user slug), so
    // they're already immutable per page — but allow short revalidation in case
    // the agent ever updates the same id.
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
    }
  }
}));

// ==========================================
// Helmet / CSP
// ==========================================
const disableCsp = process.env.DISABLE_CSP === 'true';
app.use(helmet({
  contentSecurityPolicy: disableCsp ? false : {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://elevenlabs.io", "https://js.puter.com"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: [
        "'self'",
        "https://oauth2.googleapis.com",
        "https://openrouter.ai",
        "http://localhost:*",
        // Web Speech API (Chrome) connects to Google's speech service
        "https://www.google.com",
        "wss://www.google.com",
        // Fish Audio TTS (proxied through /api/tts, but just in case)
        "https://api.fish.audio",
      ],
      mediaSrc: ["'self'", "blob:"],
      fontSrc: ["'self'", "https:", "data:"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
    }
  },
  crossOriginEmbedderPolicy: false,
  // Allow microphone access for Voice Mode (Web Speech API STT)
  permissionsPolicy: {
    microphone: ['self'],
  },
}));

// ==========================================
// Rate Limiting
// ==========================================
const apiLimiter = rateLimit({
  windowMs: parseInt(process.env.API_RATE_WINDOW_MS || '60000', 10),
  max: parseInt(process.env.API_RATE_MAX || '300', 10),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: '\xc7ox sor\u011fu. Bir az sonra yenid\u0259n c\u0259hd edin.' }
});
const chatLimiter = rateLimit({
  windowMs: parseInt(process.env.CHAT_RATE_WINDOW_MS || '60000', 10),
  max: parseInt(process.env.CHAT_RATE_MAX || '30', 10),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Çox chat sorğusu. Bir az sonra yenidən cəhd edin.' }
});
app.use('/api', (req, res, next) => {
  // The desktop app talks exclusively to its loopback-only backend. Background
  // capability and interaction polling can legitimately exceed the public API
  // budget and must not block folder selection or agent tool calls.
  if (isLocalMode()) return next();
  if (req.path === '/chat' || req.path === '/chat-stream') return chatLimiter(req, res, next);
  return apiLimiter(req, res, next);
});

// ==========================================
// Request Logger
// ==========================================
app.use((req, res, next) => {
  console.log('[REQ] ' + req.method + ' ' + req.url + ' (original: ' + req.originalUrl + ')');
  next();
});

// ==========================================
// Public Routes (no auth required)
// ==========================================

// Auth
app.use('/api/auth', authRoutes);

// Telemetry (anonymous stats from desktop apps)
app.post('/api/telemetry', async (req, res) => {
  if (!db.hasDatabase()) return res.json({ ok: true });
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const { event, data, deviceId, appVersion } = body;
  if (!event) return res.json({ ok: true, ignored: true });
  try {
    await db.query(
      'INSERT INTO telemetry (device_id, event, data, app_version, created_at) VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)',
      [deviceId || 'unknown', event, JSON.stringify(data || {}), appVersion || '1.0.0']
    );
    res.json({ ok: true });
  } catch (e) {
    console.error('Telemetry write error:', e.message);
    res.json({ ok: true });
  }
});

// ==========================================
// Protected Routes — verifyToken middleware
// ==========================================
const protectedPaths = [
  '/api/chat', '/api/files', '/api/read-file', '/api/write-file',
  '/api/attachments', '/api/browser-shot', '/api/pick-directory',
  '/api/projects', '/api/conversations', '/api/task-plan',
  '/api/diff', '/api/terminal', '/api/project-health',
  '/api/project-memory', '/api/approvals', '/api/github',
  '/api/browsers', '/api/gui-capabilities', '/api/computer-use-status',
  '/api/runtime-status', '/api/interactions', '/api/tts',
  '/api/conversation-token', '/api/signed-url', '/api/admin/stats',
  '/api/admin/users', '/api/mcp', '/api/jobs', '/api/dsh',
  '/api/screen-capture'
];
protectedPaths.forEach(function(p) { app.use(p, verifyToken); });

// ==========================================
// Initialize Chat Runtime (in-memory)
// ==========================================
var { createChatRuntime } = require('./chat/queue');
var MAX_ACTIVE_CHAT_TOTAL = parseInt(process.env.MAX_ACTIVE_CHAT_TOTAL || '50', 10);
var MAX_ACTIVE_CHAT_PER_USER = parseInt(process.env.MAX_ACTIVE_CHAT_PER_USER || '5', 10);
var CHAT_QUEUE_TIMEOUT_MS = parseInt(process.env.CHAT_QUEUE_TIMEOUT_MS || '10000', 10);
var CHAT_SLOT_MAX_AGE_MS = parseInt(process.env.CHAT_SLOT_MAX_AGE_MS || '300000', 10);
var CHAT_QUEUE_MAX_LENGTH = parseInt(process.env.CHAT_QUEUE_MAX_LENGTH || '100', 10);
var chatRuntime = createChatRuntime({
  maxActiveChatTotal: MAX_ACTIVE_CHAT_TOTAL,
  maxActiveChatPerUser: MAX_ACTIVE_CHAT_PER_USER,
  chatQueueTimeoutMs: CHAT_QUEUE_TIMEOUT_MS,
  chatSlotMaxAgeMs: CHAT_SLOT_MAX_AGE_MS,
  maxQueueLength: CHAT_QUEUE_MAX_LENGTH
});

// Inject chatRuntime into request for route handlers that need it
function injectChatRuntime(req, res, next) {
  req.chatRuntime = chatRuntime;
  next();
}

// ==========================================
// Mount Route Modules
// ==========================================

// Chat — POST /api/chat
app.use('/api/chat', injectChatRuntime, chatRouter);

// Durable job admission + status (web process only; execution runs in worker)
app.use('/api/jobs', jobsRouter);

// Ops: liveness/readiness probes + admin operational snapshot
app.use('/', opsRouter);

// TTS — Fish Audio proxy (Voice Mode) — must be before filesRouter
// which has a router.use(requireWorkspaceAccess) that would block it
app.use('/api', ttsRouter);

// STT — multilingual Speech-to-Text proxy (Voice Mode). Disabled by default;
// activates when STT_BASE_URL + STT_API_KEY are set. Must be before
// filesRouter for the same access reason as TTS.
app.use('/api', speechRouter);

// Files — GET /api/files, GET /api/read-file, POST /api/write-file, GET /api/pick-directory
app.use('/api', filesRouter);

// Projects — GET/POST /api/projects, DELETE /api/projects/:id
app.use('/api/projects', projectsRouter);

// Conversations — GET/POST /api/conversations, PUT/DELETE /api/conversations/:id
app.use('/api/conversations', conversationsRouter);

// GitHub — GET /api/github/status, POST/DELETE /api/github/connect, GET /api/github/repos
app.use('/api/github', githubRouter);

// Browser/GUI status — GET /api/browsers, /api/gui-capabilities, etc.
app.use('/api', browserRouter);

// Misc routes — task-plan, diff, terminal, project-health, etc.
app.use('/api', miscRouter);

// DSH Features (Plugins, Sub-Agent Profiles, Stress Test)
const dshRouter = require('./routes/dsh');
app.use('/api/dsh', dshRouter);

// Screen capture — desktop app uploads user screenshots, web_chat reads them
app.use('/api/screen-capture', screenCaptureRouter);

// Approvals — POST /api/approvals/:id, POST /api/checkpoints/:id, GET /api/interactions
app.use('/api', injectChatRuntime, approvalsRouter);

// SPA fallback for web product routes
app.get(['/','/chat','/login','/settings','/projects','/conversations/:id'], function(req, res, next) {
  res.sendFile(path.join(FRONTEND_DIST, 'index.html'), function(err) {
    if (err) next();
  });
});

// ==========================================
// 404 Handler
// ==========================================
app.use(function(req, res) {
  res.status(404).json({ error: req.method + ' ' + req.url + ' ucun route tapilmadi' });
});

// ==========================================
// Error Handler
// ==========================================
app.use(function(err, req, res, next) {
  const correlationId = req.correlationId || crypto.randomUUID();
  console.error(`[ERROR:${correlationId}] Unhandled error on ${req.method} ${req.originalUrl}:`, err);
  if (err && err.message) {
    console.error(`[ERROR:${correlationId}] Context:`, {
      user: req.user?.id || req.user?.email || null,
      bodyKeys: req.body ? Object.keys(req.body).slice(0, 20) : [],
      messagePreview: String(req.body?.message || '').slice(0, 200)
    });
  }
  // Log to admin error_logs table
  try {
    const { logError } = require('./auth');
    if (logError) {
      logError(
        req.user?.id || null,
        req.user?.email || null,
        'unhandled_error',
        err?.message || 'Unknown error',
        `${req.method} ${req.originalUrl}`,
        { correlationId }
      );
    }
  } catch { /* ignore */ }
  if (res.headersSent) {
    return next(err);
  }
  res.status(500).json({ error: 'Server xetasi', correlationId });
});

// ==========================================
// Server Start
// ==========================================
const HOST = process.env.HOST || (isLocalMode() ? '127.0.0.1' : '0.0.0.0');
app.listen(PORT, HOST, function() {
  console.log('\u2705 BahAI server running on port ' + PORT);
  console.log('   Bind host: ' + HOST);
  console.log('   CORS origins: ' + (allowedOrigins.length > 0 ? allowedOrigins.join(', ') : 'all (dev mode)'));
  console.log('   Workspace root: ' + WORKSPACE_ROOT);
  console.log('   Local mode: ' + isLocalMode());
});

module.exports = app;
