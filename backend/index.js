// ==========================================
// BahAI Backend — Slim Entry Point
// ==========================================
// All route handlers are in backend/routes/*.js
// Utility functions are in backend/helpers.js
// Tool execution is in backend/toolRunner.js

require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection:', reason);
});

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');

const app = express();
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
const filesRouter = require('./routes/files');
const projectsRouter = require('./routes/projects');
const conversationsRouter = require('./routes/conversations');
const githubRouter = require('./routes/github');
const browserRouter = require('./routes/browser');
const miscRouter = require('./routes/misc');
const approvalsRouter = require('./routes/approvals');

// ==========================================
// Configuration
// ==========================================
const PORT = process.env.PORT || 3001;
const WORKSPACE_ROOT = path.resolve(process.env.WORKSPACE_ROOT || path.join(__dirname, '../sandbox'));
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

const corsConfig = allowedOrigins.length > 0
  ? cors({
      origin: (origin, cb) => {
        if (!origin) return cb(null, true);
        if (allowedOrigins.includes(origin)) return cb(null, true);
        return cb(new Error('CORS blocked origin: ' + origin));
      },
      credentials: true
    })
  : cors({ origin: true });

app.use(corsConfig);
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || '50mb' }));

// ==========================================
// Helmet / CSP
// ==========================================
const cspReportOnly = process.env.CSP_REPORT_ONLY !== 'false';
app.use(helmet({
  contentSecurityPolicy: cspReportOnly ? false : {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https://oauth2.googleapis.com", "https://openrouter.ai", "http://localhost:*"],
      fontSrc: ["'self'", "https:", "data:"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
    }
  },
  crossOriginEmbedderPolicy: false,
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
app.use('/api', (req, res, next) => {
  if (req.path === '/chat' || req.path === '/chat-stream' || req.path === '/project-health') return next();
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
  const { event, data, deviceId, appVersion } = req.body;
  if (!event) return res.status(400).json({ error: 'event required' });
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
  '/api/admin/users'
];
protectedPaths.forEach(function(p) { app.use(p, verifyToken); });

// ==========================================
// Initialize Chat Runtime (in-memory)
// ==========================================
var { createChatRuntime } = require('./chat/queue');
var MAX_ACTIVE_CHAT_TOTAL = parseInt(process.env.MAX_ACTIVE_CHAT_TOTAL || '50', 10);
var MAX_ACTIVE_CHAT_PER_USER = parseInt(process.env.MAX_ACTIVE_CHAT_PER_USER || '5', 10);
var CHAT_QUEUE_TIMEOUT_MS = parseInt(process.env.CHAT_QUEUE_TIMEOUT_MS || '15000', 10);
var CHAT_SLOT_MAX_AGE_MS = parseInt(process.env.CHAT_SLOT_MAX_AGE_MS || '300000', 10);
var chatRuntime = createChatRuntime({
  maxActiveChatTotal: MAX_ACTIVE_CHAT_TOTAL,
  maxActiveChatPerUser: MAX_ACTIVE_CHAT_PER_USER,
  chatQueueTimeoutMs: CHAT_QUEUE_TIMEOUT_MS,
  chatSlotMaxAgeMs: CHAT_SLOT_MAX_AGE_MS
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
app.use('/api/chat', chatRouter);

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

// Approvals — POST /api/approvals/:id, POST /api/checkpoints/:id, GET /api/interactions
app.use('/api', injectChatRuntime, approvalsRouter);

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
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Server xetasi' });
});

// ==========================================
// Server Start
// ==========================================
app.listen(PORT, '0.0.0.0', function() {
  console.log('\u2705 BahAI server running on port ' + PORT);
  console.log('   CORS origins: ' + (allowedOrigins.length > 0 ? allowedOrigins.join(', ') : 'all (dev mode)'));
  console.log('   Workspace root: ' + WORKSPACE_ROOT);
  console.log('   Local mode: ' + isLocalMode());
});

module.exports = app;
