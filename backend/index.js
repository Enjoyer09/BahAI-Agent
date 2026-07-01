require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection:', reason);
});

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { exec, execFile, spawn } = require('child_process');
const util = require('util');
const { glob } = require('glob');
const mammoth = require('mammoth');
const XLSX = require('xlsx');
const { createWorker } = require('tesseract.js');
const { getSession, closeAllSessions, findInstalledChromePath, listInstalledBrowsers } = require('./browserSession');
const { inspectGuiState, runGuiAction, stepGuiAgent } = require('./gui/agent');
const {
  isGuiObserveSelfTestRequest,
  isGuiLoginCheckpointRequest,
  isGuiLoginResumeRequest,
  buildGuiBrowserOpenArgs
} = require('./gui/requests');
const { getRecommendedGuiBrowserMode } = require('./gui/browserPolicy');
const {
  handleGuiLoginResume,
  handleGuiLoginCheckpointAction,
  handleGuiLoginCheckpoint,
  handleGuiSelfTest
} = require('./gui/fastpath');
const { resolveOrchestrationConfig } = require('./orchestrator/workflowResolver');
const { buildRoleInstruction, buildPhaseHandoffMessage } = require('./orchestrator/rolePrompts');
const { createRunManager } = require('./orchestrator/runManager');
const { extractPlannerArtifact, buildPlannerArtifactPrompt, buildPlannerArtifactContext } = require('./orchestrator/plannerArtifact');
const { buildExecutionArtifact, buildExecutionArtifactContext, compactMessagesForNextPhase, classifyArtifactQuality } = require('./orchestrator/executionArtifact');
const { getToolDefinitions } = require('./tools/registry');
const { getToolsForProfile, getToolsForRole } = require('./tools/profiles');
const {
  createProviderRuntime,
  buildProviderCandidates,
  normalizeProviderBaseUrl,
  detectWireApi,
  isResponsesSchemaMismatchError,
  buildOpenAIClient
} = require('./chat/providers');
const { createChatRuntime } = require('./chat/queue');
const { writeSse, initSse, emitOrchestrationPrelude, emitTaskPlan } = require('./chat/sse');
const { collectStreamOutput } = require('./chat/stream');
const { executeToolCalls } = require('./chat/toolExecutor');
const { openAiStreamWithFallback } = require('./chat/runner');
const { runChatSession } = require('./chat/sessionController');

const execFileAsync = util.promisify(execFile);
const pdfParse = require('pdf-parse');


const app = express();
const db = require('./db');
const { router: authRoutes, verifyToken } = require('./auth');

// Initialize Database
db.initDb();

// SEC-FIX: Restrict CORS to explicit allow-list. Previously `cors()` reflected
// any origin, enabling cross-site credential theft / CSRF from arbitrary
// websites. ALLOWED_ORIGINS is a comma-separated list (e.g.
// "https://bahai.app,https://staging.bahai.app").
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

const corsConfig = allowedOrigins.length > 0
  ? cors({
      origin: (origin, cb) => {
        // Allow non-browser clients (curl, Electron file://) which have no Origin header.
        if (!origin) return cb(null, true);
        if (allowedOrigins.includes(origin)) return cb(null, true);
        return cb(new Error(`CORS blocked origin: ${origin}`));
      },
      credentials: true
    })
  : // Dev / single-host deploy: same-origin only is enforced by reflection-with-credentials NOT being set
    cors({ origin: true });

app.use(corsConfig);
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || '50mb' }));

// SEC-FIX: replaced inline header-setting with the standard `helmet`
// middleware which keeps the recommended defaults up-to-date.
// P1-FIX: CSP enabled in report-only for now with nonce support preparation.
// The nonce mechanism can be activated by setting CSP_REPORT_ONLY=false.
const cspReportOnly = process.env.CSP_REPORT_ONLY !== 'false';
app.use(helmet({
  contentSecurityPolicy: cspReportOnly ? false : {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"], // Electron inline scripts need this
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https://oauth2.googleapis.com", "https://openrouter.ai", "http://localhost:*"],
      fontSrc: ["'self'", "https:", "data:"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
    }
  },
  crossOriginEmbedderPolicy: false,
  // hide X-Powered-By, set X-Frame-Options, Referrer-Policy, HSTS in prod, etc.
}));

// SEC-FIX: production-grade rate limiter (replaces the in-memory map).
// Backed by an in-process LRU; for multi-instance deploy swap the store
// for redis: https://github.com/express-rate-limit/rate-limit-redis
const apiLimiter = rateLimit({
  windowMs: parseInt(process.env.API_RATE_WINDOW_MS || '60000', 10),
  max: parseInt(process.env.API_RATE_MAX || '300', 10),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Çox sorğu. Bir az sonra yenidən cəhd edin.' }
});
// Apply general limiter to all /api/* routes except SSE streams (chat / health
// which legitimately keep the connection open).
app.use('/api', (req, res, next) => {
  if (req.path === '/chat' || req.path === '/chat-stream' || req.path === '/project-health') return next();
  return apiLimiter(req, res, next);
});

// Request Logger
app.use((req, res, next) => {
  console.log(`[REQ] ${req.method} ${req.url} (original: ${req.originalUrl})`);
  next();
});

// Public Auth Routes
app.use('/api/auth', authRoutes);

// Public Telemetry Endpoint (desktop apps send anonymous stats here)
app.post('/api/telemetry', async (req, res) => {
  if (!db.hasDatabase()) return res.json({ ok: true }); // silently ignore if no DB
  
  const { event, data, deviceId, appVersion } = req.body;
  if (!event) return res.status(400).json({ error: 'event required' });
  
  try {
    await db.query(
      `INSERT INTO telemetry (device_id, event, data, app_version, created_at)
       VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)`,
      [deviceId || 'unknown', event, JSON.stringify(data || {}), appVersion || '1.0.0']
    );
    res.json({ ok: true });
  } catch (e) {
    // Don't fail silently — just log
    console.error('Telemetry write error:', e.message);
    res.json({ ok: true });
  }
});

// Protected Agent/File Routes
app.use('/api/chat', verifyToken);
app.use('/api/files', verifyToken);
app.use('/api/read-file', verifyToken);
app.use('/api/write-file', verifyToken);
app.use('/api/run-terminal', verifyToken);
app.use('/api/pick-directory', verifyToken);
app.use('/api/projects', verifyToken);
app.use('/api/conversations', verifyToken);
app.use('/api/attachments', verifyToken);
app.use('/api/task-plan', verifyToken);
app.use('/api/diff', verifyToken);
app.use('/api/terminal', verifyToken);
app.use('/api/project-health', verifyToken);
app.use('/api/project-memory', verifyToken);
app.use('/api/approvals', verifyToken);
app.use('/api/github', verifyToken);

// ==========================================
// Configuration from environment
// ==========================================
const PORT = process.env.PORT || 3001;
// FUNC-FIX: previously 15 steps × ~30s/step = ~7.5min runaway loops on local
// models. 6 steps is enough for any realistic agentic flow (list → read →
// edit → verify); larger context = more hallucinations and longer waits.
const MAX_STEPS = parseInt(process.env.MAX_AGENT_STEPS || '6', 10);
const WORKSPACE_ROOT = path.resolve(process.env.WORKSPACE_ROOT || path.join(__dirname, '../sandbox'));
const ALLOWED_DIRS = process.env.ALLOWED_DIRECTORIES
  ? process.env.ALLOWED_DIRECTORIES.split(',').map(d => path.resolve(d.trim()))
  : [
      // SEC-FIX: previously also included process.env.HOME, which exposed the
      // entire user home directory (SSH keys, browser data, etc.) to the AI
      // agent. Users now need to explicitly opt in via ALLOWED_DIRECTORIES.
      path.resolve(__dirname, '..'), // Project root
      path.resolve(WORKSPACE_ROOT),  // Per-user sandbox area
    ];
// SEC-FIX: LOCAL_MODE must be explicit. Previously the system considered
// itself "local" whenever DATABASE_URL was missing, which on a cloud host
// silently disabled auth and approvals for all visitors.
const isLocalMode = () => process.env.LOCAL_MODE === 'true';
const PROVIDER_COOLDOWN_MS = parseInt(process.env.PROVIDER_COOLDOWN_MS || '20000', 10);
const providerRuntime = createProviderRuntime({
  providerCooldownMs: PROVIDER_COOLDOWN_MS
});

// Startup diagnostics
// SEC-FIX: never leak any portion of API keys to logs in production.
const diagKey = process.env.OPENAI_API_KEY;
const keyDisplay = diagKey
  ? (process.env.NODE_ENV === 'production' ? '✅ set' : `${diagKey.slice(0, 4)}...${diagKey.slice(-2)}`)
  : '❌ not set';
console.log('🔧 Startup Config:', {
  PORT,
  LOCAL_MODE: process.env.LOCAL_MODE || '(not set)',
  DATABASE_URL: process.env.DATABASE_URL ? '✅ set' : '❌ not set',
  OPENAI_API_KEY: keyDisplay,
  OPENAI_BASE_URL: process.env.OPENAI_BASE_URL || '(not set)',
  OPENAI_MODEL: process.env.OPENAI_MODEL || '(not set)',
  JWT_SECRET: process.env.JWT_SECRET ? '✅ set' : '❌ not set',
  NODE_ENV: process.env.NODE_ENV || '(not set)',
  isLocalMode: isLocalMode()
});

function parseProviderPoolFromEnv() {
  const raw = process.env.AI_PROVIDER_POOL || process.env.OPENAI_PROVIDER_POOL || '';
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .map((p, i) => ({
        id: p.id || `pool_${i + 1}`,
        apiKey: String(p.apiKey || '').trim(),
        baseURL: String(p.baseURL || p.baseUrl || '').trim(),
        model: String(p.model || '').trim()
      }))
      .filter((p) => p.apiKey && p.baseURL && p.model);
  } catch {
    return [];
  }
}

// FUNC-FIX: an Ollama model ID looks like `name:tag` (e.g. `gemma4:12b`,
// `qwen2.5-coder:7b`, `llama3:8b`) — no slash, has colon. Cloud (OpenRouter)
// IDs look like `vendor/model` or `vendor/model:free`. This lets us route to
// the local Ollama endpoint without hard-coding a model whitelist.
function looksLikeOllamaModel(modelId) {
  if (!modelId) return false;
  if (modelId.includes('/')) return false; // openrouter style
  return modelId.includes(':') || /^(gemma|qwen|llama|deepseek|mistral|phi|codellama)/i.test(modelId);
}

// FUNC-FIX: lightweight intent classifier for the new "auto" model. Returns
// 'fast' for short / chatty messages and 'smart' for complex / refactor /
// architecture / long-context work.
function classifyTaskComplexity({ userMessage, messageHistoryLen, hasAttachments }) {
  const text = String(userMessage || '');
  const len = text.length;
  const hasCodeBlock = /```/.test(text);
  const complexKeywords = /(refactor|architecture|design|plan|optimize|analyze|audit|review|debug|migrate|test plan|integration|scalab|security|performance)/i;
  const trivialKeywords = /^(salam|hi|hello|how|necə|nədir|sağol|thanks|teşekkür|test|hə|yox)\b/i;

  if (hasAttachments) return 'smart';
  if (messageHistoryLen > 10) return 'smart';
  if (hasCodeBlock && len > 500) return 'smart';
  if (complexKeywords.test(text)) return 'smart';
  if (trivialKeywords.test(text) && len < 80) return 'fast';
  if (len > 600) return 'smart';
  return 'fast';
}

function isAuditStyleRequest(text = '') {
  return /(audit|review|kodu yoxla|yoxla proqrami|proqrami audit|xəta|sehf|səhv|bug|risk|tapıntı|finding)/i.test(String(text));
}

function flattenResponseJsonText(text = '') {
  if (typeof text !== 'string') return text;
  const match = text.trim().match(/^\s*\{\s*"response"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"\s*\}\s*$/);
  if (!match || !match[1]) return text;
  return match[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\').trim();
}

function isFileClarificationLoop(text = '') {
  return /(hansı faylı|fayl.*belirt|app\.py|read_file alətini|json formatında çağır|yolun doğru olduğunu yoxlayın|yalnız bir faylı audit)/i.test(String(text));
}

function mapMessagesToResponsesInput(messages = []) {
  const input = [];
  for (const message of messages) {
    if (!message || !message.role) continue;
    if (message.role === 'tool') {
      input.push({
        type: 'function_call_output',
        call_id: message.tool_call_id || '',
        output: String(message.content || '')
      });
      continue;
    }

    if (message.role === 'assistant' && Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
      for (const toolCall of message.tool_calls) {
        input.push({
          type: 'function_call',
          call_id: toolCall.id,
          name: toolCall.function?.name || '',
          arguments: toolCall.function?.arguments || '{}'
        });
      }
    }

    const contentParts = [];
    if (typeof message.content === 'string' && message.content.trim()) {
      contentParts.push({ type: 'input_text', text: message.content });
    }
    if (contentParts.length > 0) {
      input.push({
        role: message.role,
        content: contentParts
      });
    }
  }
  return input;
}

function mapToolsToResponsesTools(tools = []) {
  return tools.map((tool) => ({
    type: 'function',
    name: tool.function.name,
    description: tool.function.description,
    parameters: tool.function.parameters
  }));
}

function buildPhaseRecoveryInstruction(role, projectRoot, reason) {
  return [
    `${role || 'Agent'} fazasının əvvəlki cavabı kifayət qədər faydalı deyildi.`,
    `Səbəb: ${reason}.`,
    'Boş, ümumi və ya yalnız status tipli cavab vermə.',
    'Konkret nəticə çıxar: ya real tool çağır, ya da faydalı, yoxlanıla bilən məzmun yaz.',
    `Project Root: ${projectRoot}`
  ].join(' ');
}

function normalizeToolName(name = '') {
  const value = String(name || '').trim();
  if (!value) return value;
  const aliases = {
    run_bash: 'run_terminal_command',
    bash: 'run_terminal_command',
    terminal: 'run_terminal_command',
    browser_snapshot: 'browser_screenshot',
    screenshot: 'browser_screenshot'
  };
  return aliases[value] || value;
}

function buildToolCallCacheKey(toolName = '', args = '') {
  const normalizedName = normalizeToolName(toolName);
  let normalizedArgs = String(args || '').trim();
  try {
    normalizedArgs = JSON.stringify(JSON.parse(normalizedArgs || '{}'));
  } catch {
    normalizedArgs = String(args || '').trim();
  }
  return `${normalizedName}::${normalizedArgs}`;
}

function isCacheableTool(toolName = '') {
  return [
    'list_directory',
    'glob_search',
    'read_file',
    'grep_search',
    'analyze_codebase',
    'find_definition',
    'find_references',
    'git_status',
    'git_diff',
    'git_log',
    'check_port_status',
    'github_list_contents',
    'github_read_file',
    'github_search_code'
  ].includes(normalizeToolName(toolName));
}

function buildToolRecoveryInstruction(role, projectRoot, detail, allowedToolNames = []) {
  return [
    `${role || 'Agent'} fazasında tool çağırışı düz olmadı.`,
    `Səbəb: ${detail}.`,
    'Yalnız mövcud və bu faza üçün icazəli tool adlarından istifadə et.',
    'Arguments həmişə keçərli JSON object olmalıdır.',
    allowedToolNames.length ? `Bu fazada icazəli tool-lar: ${allowedToolNames.join(', ')}` : '',
    `Project Root: ${projectRoot}`
  ].filter(Boolean).join(' ');
}

function normalizeUserFacingError(message = '') {
  const text = String(message || '').trim();
  if (!text) return 'Naməlum xəta baş verdi.';
  if (/^Unknown tool:/i.test(text)) {
    return 'Agent uyğun tool seçə bilmədi. Daxili bərpa cəhdi edilir.';
  }
  if (/^Error executing tool: Unexpected token/i.test(text)) {
    return 'Tool üçün göndərilən argument forması düzgün deyildi. Daxili bərpa cəhdi edilir.';
  }
  return text;
}

function shouldEmitDebugEvent() {
  return process.env.BAHAI_DEBUG_EVENTS === '1';
}

function ensureSection(lines, title, items = [], formatter = (value) => String(value || '').trim()) {
  const cleaned = (Array.isArray(items) ? items : [])
    .map(formatter)
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  if (cleaned.length === 0) return;
  lines.push(`**${title}**`);
  for (const item of cleaned) {
    lines.push(`- ${item}`);
  }
  lines.push('');
}

function normalizeFinalAssistantReport(content = '', context = {}) {
  const text = String(content || '').trim();
  if (!text) return text;
  if (/^\*\*Problem\*\*/i.test(text) || /^\*\*Findings\*\*/i.test(text)) {
    return text;
  }

  const {
    auditStyleRequest = false,
    plannerArtifact = null,
    executionArtifacts = [],
    executionMemory = null
  } = context;

  const lines = [];
  const summary = text.split('\n').map((line) => line.trim()).filter(Boolean);
  const intro = summary.slice(0, 2).join(' ').slice(0, 500);
  const enforcedRisks = [];

  if (executionMemory?.lastValidation?.status === 'failed') {
    enforcedRisks.push(`Son validation failed olub: ${String(executionMemory.lastValidation.summary || '').slice(0, 220)}`);
    enforcedRisks.push('Validation retry policy təmin olunmalıdır: ya failed check düzəldilib yenidən işlədilməli, ya da blok səbəbi açıq yazılmalıdır.');
  }
  if (executionMemory?.lastApprovalDecision?.decision === 'reject') {
    enforcedRisks.push(
      `Son approval reject olunub: ${executionMemory.lastApprovalDecision.title || executionMemory.lastApprovalDecision.tool || 'unknown tool'}`
    );
  }
  if (executionMemory?.lastBrowserArtifact?.status === 'failed') {
    enforcedRisks.push(`Son browser artifact failed olub: ${String(executionMemory.lastBrowserArtifact.summary || '').slice(0, 180)}`);
  }
  if (executionMemory?.lastTerminalArtifact?.status === 'failed') {
    enforcedRisks.push(`Son terminal artifact failed olub: ${String(executionMemory.lastTerminalArtifact.summary || '').slice(0, 180)}`);
  }

  if (auditStyleRequest) {
    ensureSection(lines, 'Findings', intro ? [intro] : []);
    ensureSection(lines, 'Plan', plannerArtifact?.implementationSteps || []);
    ensureSection(lines, 'Validation', plannerArtifact?.verificationSteps || []);
    ensureSection(
      lines,
      'Remaining Risks',
      [...(plannerArtifact?.suspectedRisks || []), ...enforcedRisks]
    );
  } else {
    ensureSection(lines, 'Problem', intro ? [intro] : []);
    ensureSection(lines, 'Plan', plannerArtifact?.implementationSteps || []);
    ensureSection(
      lines,
      'Changes',
      executionArtifacts.slice(-3).map((artifact) => artifact?.summary).filter(Boolean)
    );
    ensureSection(lines, 'Validation', plannerArtifact?.verificationSteps || []);
    ensureSection(
      lines,
      'Remaining Risks',
      [...(plannerArtifact?.suspectedRisks || []), ...enforcedRisks]
    );
  }

  if (lines.length === 0) return text;
  return lines.join('\n').trim();
}

// ==========================================
// Security helpers
// ==========================================

/**
 * Helper to resolve working directory dynamically.
 * Maps local paths (e.g., /Users/macbookair/...) to safe sandboxed container directories on cloud/Linux.
 */
function safeSegment(value, fallback = 'default') {
  const clean = String(value || fallback)
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .pop()
    ?.replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/^-+|-+$/g, '');
  return clean || fallback;
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
  return dirPath;
}

const GITHUB_TOKEN_SECRET = crypto
  .createHash('sha256')
  .update(process.env.GITHUB_TOKEN_SECRET || process.env.JWT_SECRET || 'bahai_github_secret')
  .digest();

function encryptSecret(text) {
  if (!text) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', GITHUB_TOKEN_SECRET, iv);
  const encrypted = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

function decryptSecret(payload) {
  try {
    if (!payload) return null;
    const [ivB64, tagB64, dataB64] = String(payload).split(':');
    if (!ivB64 || !tagB64 || !dataB64) return null;
    const iv = Buffer.from(ivB64, 'base64');
    const tag = Buffer.from(tagB64, 'base64');
    const encrypted = Buffer.from(dataB64, 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', GITHUB_TOKEN_SECRET, iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return plain.toString('utf8');
  } catch (error) {
    console.error("⚠️ decryptSecret error (encryption key might have changed):", error.message);
    return null;
  }
}

async function getUserGithubToken(userId) {
  if (!db.hasDatabase()) {
    const localDb = await readLocalDb();
    if (localDb.settings && localDb.settings.github_token) {
      return localDb.settings.github_token.trim();
    }
    const t = process.env.GITHUB_TOKEN;
    return typeof t === 'string' ? t.trim() : null;
  }
  const result = await db.query('SELECT github_token_enc FROM users WHERE id = $1', [userId]);
  const encrypted = result.rows[0]?.github_token_enc;
  return decryptSecret(encrypted);
}

function injectGithubTokenIntoUrl(url, token) {
  if (!url || !token) return url;
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== 'github.com') return url;
    if (parsed.username || parsed.password) return url;
    parsed.username = 'x-access-token';
    parsed.password = token;
    return parsed.toString();
  } catch {
    return url;
  }
}

function getUserWorkspaceRoot(user) {
  const userId = user?.id || 'public';
  return path.resolve(WORKSPACE_ROOT, `user_${userId}`);
}

function resolveWorkingDirectory(wd, user) {
  const userRoot = getUserWorkspaceRoot(user);
  if (!wd) return path.resolve(userRoot, 'default');

  const cleanWd = String(wd).trim();

  if (
    cleanWd === '.' ||
    cleanWd === './sandbox' ||
    cleanWd === 'sandbox' ||
    cleanWd.startsWith('workspace://')
  ) {
    const workspaceName = cleanWd.startsWith('workspace://')
      ? safeSegment(cleanWd.replace('workspace://', ''))
      : 'default';
    return path.resolve(userRoot, workspaceName);
  }

  if (!path.isAbsolute(cleanWd) && !cleanWd.includes('\\') && !cleanWd.includes(':')) {
    return path.resolve(userRoot, safeSegment(cleanWd));
  }

  // If running on Linux (Railway) but path is a macOS/Windows user directory
  if (process.platform === 'linux' && (cleanWd.startsWith('/Users/') || cleanWd.startsWith('/home/') || cleanWd.includes('\\') || cleanWd.includes(':'))) {
    const folderName = safeSegment(cleanWd);
    const sandboxPath = path.resolve(userRoot, folderName);
    const legacyPath = path.resolve(WORKSPACE_ROOT, folderName || 'default');
    
    const fsExtra = require('fs');

    // Auto-migration: Move files from legacy folder to user-isolated folder if needed!
    if (user && user.id && !fsExtra.existsSync(sandboxPath) && fsExtra.existsSync(legacyPath)) {
      try {
        console.log(`📦 MIGRATING legacy sandbox from ${legacyPath} to ${sandboxPath}...`);
        fsExtra.renameSync(legacyPath, sandboxPath);
      } catch (err) {
        console.error("Failed to migrate legacy sandbox folder:", err);
      }
    }
    
    // Ensure sandbox dir exists
    if (!fsExtra.existsSync(sandboxPath)) {
      try {
        fsExtra.mkdirSync(sandboxPath, { recursive: true });
      } catch (err) {
        console.error("Failed to create sandbox directory:", err);
      }
    }
    return sandboxPath;
  }

  return path.resolve(cleanWd);
}

function isWorkingDirectoryAllowed(resolvedWD) {
  const normalized = path.resolve(String(resolvedWD || '.'));
  if (isLocalMode()) {
    return true;
  }

  return ALLOWED_DIRS.some((base) => {
    const rel = path.relative(base, normalized);
    return !rel.startsWith('..') && !path.isAbsolute(rel);
  });
}


/**
 * Maps a file path from a requested original working directory to a resolved one.
 */
function mapPath(originalPath, originalWD, resolvedWD) {
  if (!originalPath) return resolvedWD;
  const resolvedOrigWD = path.resolve(originalWD || '.');
  const resolvedReqPath = path.isAbsolute(originalPath)
    ? path.resolve(originalPath)
    : path.resolve(resolvedOrigWD, originalPath);

  if (resolvedOrigWD === resolvedWD) return resolvedReqPath;

  const rel = path.relative(resolvedOrigWD, resolvedReqPath);
  return path.resolve(resolvedWD, rel);
}

/**
 * SEC-2: Robust path safety check using path.relative
 */
function isPathSafe(filePath, workingDirectory, user) {
  const resolvedWD = resolveWorkingDirectory(workingDirectory, user);
  if (!resolvedWD) return false;
  const resolvedBase = path.resolve(resolvedWD);
  const resolvedPath = path.resolve(filePath);
  
  // Check if it's within the specific project working directory
  const rel = path.relative(resolvedBase, resolvedPath);
  const isInsideProject = !rel.startsWith('..') && !path.isAbsolute(rel);
  
  // Local standalone mode may need broader filesystem access. Online mode must stay user-scoped.
  const isAllowedGlobally = ALLOWED_DIRS.some(base => {
    const relGlobally = path.relative(base, resolvedPath);
  return !relGlobally.startsWith('..') && !path.isAbsolute(relGlobally);
  });
  
  const isSafe = isInsideProject || (isLocalMode() && (isAllowedGlobally || path.isAbsolute(resolvedPath)));
  
  if (!isSafe) {
    console.warn(`🚨 SECURITY ALERT: Blocked access to ${resolvedPath}`);
    console.warn(`   Rel to Project: ${rel} | Inside: ${isInsideProject}`);
    console.warn(`   Allowed Globally: ${isAllowedGlobally}`);
  }

  return isSafe;
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function detectRepoProfile(analyzePath) {
  const candidates = [
    'package.json',
    'pnpm-lock.yaml',
    'yarn.lock',
    'package-lock.json',
    'bun.lockb',
    'bun.lock',
    'pnpm-workspace.yaml',
    'turbo.json',
    'nx.json',
    'tsconfig.json',
    'vite.config.ts',
    'vite.config.js',
    'next.config.js',
    'next.config.mjs',
    'nest-cli.json',
    'requirements.txt',
    'pyproject.toml',
    'pytest.ini',
    'Cargo.toml',
    'go.mod',
    'Dockerfile'
  ];

  const found = {};
  for (const candidate of candidates) {
    found[candidate] = await fileExists(path.join(analyzePath, candidate));
  }

  let packageJson = null;
  if (found['package.json']) {
    try {
      packageJson = JSON.parse(await fs.readFile(path.join(analyzePath, 'package.json'), 'utf8'));
    } catch {
      packageJson = null;
    }
  }

  const deps = {
    ...(packageJson?.dependencies || {}),
    ...(packageJson?.devDependencies || {})
  };
  const scripts = packageJson?.scripts || {};

  let ecosystem = 'Unknown';
  if (packageJson) ecosystem = 'Node.js';
  else if (found['pyproject.toml'] || found['requirements.txt']) ecosystem = 'Python';
  else if (found['Cargo.toml']) ecosystem = 'Rust';
  else if (found['go.mod']) ecosystem = 'Go';

  let packageManager = 'Unknown';
  if (found['pnpm-lock.yaml']) packageManager = 'pnpm';
  else if (found['yarn.lock']) packageManager = 'yarn';
  else if (found['package-lock.json']) packageManager = 'npm';
  else if (found['bun.lockb'] || found['bun.lock']) packageManager = 'bun';
  else if (packageJson) packageManager = 'npm';
  else if (ecosystem === 'Python') packageManager = found['pyproject.toml'] ? 'poetry/pip' : 'pip';
  else if (ecosystem === 'Rust') packageManager = 'cargo';
  else if (ecosystem === 'Go') packageManager = 'go';

  const workspaceSignals = [
    found['pnpm-workspace.yaml'] ? 'pnpm-workspace' : '',
    found['turbo.json'] ? 'turbo' : '',
    found['nx.json'] ? 'nx' : '',
    Array.isArray(packageJson?.workspaces) || typeof packageJson?.workspaces === 'object' ? 'package.json workspaces' : ''
  ].filter(Boolean);
  const repoShape = workspaceSignals.length > 0 ? 'Monorepo/Workspace' : 'Single package/service';

  const frameworkDetectors = [
    ['Next.js', found['next.config.js'] || found['next.config.mjs'] || Boolean(deps.next)],
    ['Vite', found['vite.config.ts'] || found['vite.config.js'] || Boolean(deps.vite)],
    ['NestJS', found['nest-cli.json'] || Boolean(deps['@nestjs/core'])],
    ['React', Boolean(deps.react)],
    ['Vue', Boolean(deps.vue)],
    ['Express', Boolean(deps.express)],
    ['Fastify', Boolean(deps.fastify)],
    ['Electron', Boolean(deps.electron)],
    ['Vitest', Boolean(deps.vitest)],
    ['Jest', Boolean(deps.jest)],
    ['Pytest', found['pytest.ini']]
  ];
  const frameworks = frameworkDetectors.filter(([, ok]) => ok).map(([name]) => name);

  const buildCommand =
    scripts.build ||
    (ecosystem === 'Python' ? 'python -m build (əgər qurulubsa)' : '') ||
    (ecosystem === 'Rust' ? 'cargo build' : '') ||
    (ecosystem === 'Go' ? 'go build ./...' : '') ||
    '';
  const testCommand =
    scripts.test ||
    (ecosystem === 'Python' ? 'python -m pytest --tb=short' : '') ||
    (ecosystem === 'Rust' ? 'cargo test' : '') ||
    (ecosystem === 'Go' ? 'go test ./...' : '') ||
    '';
  const lintCommand = scripts.lint || '';

  const entryCandidates = [
    'src/main.tsx',
    'src/main.ts',
    'src/App.tsx',
    'src/App.jsx',
    'src/index.ts',
    'src/index.js',
    'index.js',
    'server.js',
    'app.js',
    'main.py'
  ];
  const entryPoints = [];
  for (const candidate of entryCandidates) {
    if (await fileExists(path.join(analyzePath, candidate))) entryPoints.push(candidate);
    if (entryPoints.length >= 4) break;
  }

  return {
    ecosystem,
    packageManager,
    repoShape,
    workspaceSignals,
    frameworks,
    packageJson,
    buildCommand,
    testCommand,
    lintCommand,
    entryPoints,
    foundConfigs: Object.entries(found).filter(([, exists]) => exists).map(([name]) => name)
  };
}

function serializeRepoProfile(profile = {}) {
  return {
    ecosystem: profile.ecosystem || 'Unknown',
    packageManager: profile.packageManager || 'Unknown',
    repoShape: profile.repoShape || 'Unknown',
    workspaceSignals: profile.workspaceSignals || [],
    frameworks: profile.frameworks || [],
    buildCommand: profile.buildCommand || '',
    testCommand: profile.testCommand || '',
    lintCommand: profile.lintCommand || '',
    entryPoints: profile.entryPoints || [],
    foundConfigs: profile.foundConfigs || [],
    packageName: profile.packageJson?.name || '',
    packageVersion: profile.packageJson?.version || ''
  };
}

function buildValidationHint(repoProfile = {}) {
  const hints = [];
  if (repoProfile.buildCommand) hints.push(`build: ${repoProfile.buildCommand}`);
  if (repoProfile.testCommand) hints.push(`test: ${repoProfile.testCommand}`);
  if (repoProfile.lintCommand) hints.push(`lint: ${repoProfile.lintCommand}`);
  if (hints.length === 0) return '';
  return `Tövsiyə olunan validation komandaları -> ${hints.join(' | ')}`;
}

function buildExecutionMemoryHint(projectMemory = {}) {
  const lines = [];
  const lastValidation = projectMemory?.lastValidation;
  const lastApprovalDecision = projectMemory?.lastApprovalDecision;
  const lastBrowserArtifact = projectMemory?.lastBrowserArtifact;
  const lastTerminalArtifact = projectMemory?.lastTerminalArtifact;
  const lastRuntimeArtifact = projectMemory?.lastRuntimeArtifact;

  if (lastValidation?.status) {
    lines.push(`Son validation statusu: ${lastValidation.status}. ${String(lastValidation.summary || '').slice(0, 240)}`);
  }
  if (lastApprovalDecision?.decision) {
    lines.push(
      `Son approval qərarı: ${lastApprovalDecision.decision} | tool=${lastApprovalDecision.title || lastApprovalDecision.tool || 'unknown'} | risk=${lastApprovalDecision.riskLevel || 'medium'}`
    );
  }
  if (lastBrowserArtifact?.toolName) {
    lines.push(`Son browser artifact: tool=${lastBrowserArtifact.toolName} | summary=${String(lastBrowserArtifact.summary || '').slice(0, 180)}`);
  }
  if (lastTerminalArtifact?.command || lastTerminalArtifact?.summary) {
    lines.push(`Son terminal artifact: ${String(lastTerminalArtifact.command || lastTerminalArtifact.summary || '').slice(0, 180)}`);
  }
  if (lastRuntimeArtifact?.kind === 'browser' && lastRuntimeArtifact?.status) {
    lines.push(`Son GUI runtime statusu: ${lastRuntimeArtifact.status} | ${String(lastRuntimeArtifact.summary || '').slice(0, 180)}`);
  }

  if (lines.length === 0) return '';
  return `Execution yaddaşı:\n${lines.join('\n')}`;
}

function isPlaceholderTestScript(script = '') {
  const value = String(script || '').trim().toLowerCase();
  return (
    !value ||
    value.includes('no test specified') ||
    value === 'exit 1'
  );
}

function quoteShellArg(value = '') {
  const text = String(value ?? '');
  if (!text) return "''";
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

function buildNodeScriptCommand(packageManager, scriptName, extraArgs = []) {
  const extras = (extraArgs || []).filter(Boolean).join(' ');
  if (packageManager === 'pnpm') return `pnpm ${scriptName}${extras ? ` -- ${extras}` : ''}`;
  if (packageManager === 'yarn') return `yarn ${scriptName}${extras ? ` ${extras}` : ''}`;
  if (packageManager === 'bun') return `bun run ${scriptName}${extras ? ` -- ${extras}` : ''}`;
  return `npm run ${scriptName}${extras ? ` -- ${extras}` : ''}`;
}

function buildValidationPlan(repoProfile = {}, workingDirectory, args = {}) {
  const ecosystem = repoProfile?.ecosystem || 'Unknown';
  const packageManager = repoProfile?.packageManager || 'npm';
  const scripts = repoProfile?.packageJson?.scripts || {};
  const filterArg = String(args?.filter || '').trim();
  const extraArgs = filterArg ? [quoteShellArg(filterArg)] : [];
  const steps = [];
  const pushStep = (kind, command, reason) => {
    if (!command) return;
    const normalized = String(command).trim();
    if (!normalized) return;
    if (steps.some((step) => step.command === normalized)) return;
    steps.push({
      kind,
      label: kind === 'typecheck' ? 'type-check' : kind,
      command: normalized,
      reason: String(reason || '').trim()
    });
  };

  if (ecosystem === 'Node.js') {
    if (scripts.lint) {
      pushStep('lint', buildNodeScriptCommand(packageManager, 'lint'), 'package.json içində lint script tapıldı');
    }

    if (scripts.typecheck) {
      pushStep('typecheck', buildNodeScriptCommand(packageManager, 'typecheck'), 'package.json içində typecheck script tapıldı');
    } else if (scripts['check-types']) {
      pushStep('typecheck', buildNodeScriptCommand(packageManager, 'check-types'), 'package.json içində check-types script tapıldı');
    } else if (scripts.typescript) {
      pushStep('typecheck', buildNodeScriptCommand(packageManager, 'typescript'), 'package.json içində typescript script tapıldı');
    } else if (repoProfile?.foundConfigs?.includes('tsconfig.json')) {
      pushStep('typecheck', 'npx tsc --noEmit', 'tsconfig.json tapıldığı üçün TypeScript yoxlaması əlavə edildi');
    }

    if (scripts.test && !isPlaceholderTestScript(scripts.test)) {
      pushStep('test', buildNodeScriptCommand(packageManager, 'test', extraArgs), 'package.json içində test script tapıldı');
    } else if (repoProfile?.frameworks?.includes('Vitest')) {
      pushStep('test', filterArg ? `npx vitest --run ${quoteShellArg(filterArg)}` : 'npx vitest --run', 'Vitest dependency siqnalı tapıldı');
    } else if (repoProfile?.frameworks?.includes('Jest')) {
      pushStep('test', filterArg ? `npx jest --runInBand ${quoteShellArg(filterArg)}` : 'npx jest --runInBand', 'Jest dependency siqnalı tapıldı');
    }

    if (scripts.build) {
      pushStep('build', buildNodeScriptCommand(packageManager, 'build'), 'package.json içində build script tapıldı');
    }
  } else if (ecosystem === 'Python') {
    if (repoProfile?.lintCommand) pushStep('lint', repoProfile.lintCommand, 'repo profilində lint komandası göstərilib');
    if (repoProfile?.foundConfigs?.includes('pyproject.toml')) {
      pushStep('typecheck', 'python -m py_compile $(find . -name "*.py" -not -path "*/.venv/*" -not -path "*/venv/*")', 'Python faylları üçün sintaksis yoxlaması əlavə edildi');
    }
    if (repoProfile?.testCommand) pushStep('test', filterArg ? `${repoProfile.testCommand} ${quoteShellArg(filterArg)}` : repoProfile.testCommand, 'repo profilində test komandası göstərilib');
    if (repoProfile?.buildCommand) pushStep('build', repoProfile.buildCommand, 'repo profilində build komandası göstərilib');
  } else if (ecosystem === 'Rust') {
    pushStep('test', 'cargo test', 'Rust layihələri üçün standart test komandası');
    pushStep('build', 'cargo build', 'Rust layihələri üçün standart build komandası');
  } else if (ecosystem === 'Go') {
    pushStep('test', filterArg ? `go test ${quoteShellArg(filterArg)}` : 'go test ./...', 'Go layihələri üçün standart test komandası');
    pushStep('build', 'go build ./...', 'Go layihələri üçün standart build komandası');
  }

  if (steps.length === 0 && repoProfile?.testCommand && !isPlaceholderTestScript(repoProfile.testCommand)) {
    pushStep('test', filterArg ? `${repoProfile.testCommand} ${quoteShellArg(filterArg)}` : repoProfile.testCommand, 'repo profilində test komandası göstərilib');
  }
  if (steps.length === 0 && repoProfile?.buildCommand) {
    pushStep('build', repoProfile.buildCommand, 'test komandası tapılmadığı üçün build fallback seçildi');
  }

  return {
    ecosystem,
    packageManager,
    repoShape: repoProfile?.repoShape || 'Unknown',
    steps
  };
}

function formatValidationReport(plan, results = []) {
  const header = [
    `Validation planı: ${plan?.ecosystem || 'Unknown'} / ${plan?.packageManager || 'Unknown'} / ${plan?.repoShape || 'Unknown'}`
  ];
  if (!results.length) {
    return `${header.join('\n')}\nValidation üçün uyğun komanda tapılmadı.`;
  }

  const body = results.map((result, index) => {
    const lines = [
      `${index + 1}. ${result.label} [${result.status}]`,
      `Komanda: ${result.command}`
    ];
    if (result.reason) lines.push(`Səbəb: ${result.reason}`);
    if (result.output) lines.push(`Çıxış:\n${result.output}`);
    return lines.join('\n');
  });

  return `🧪 Validation nəticələri:\n${header.join('\n')}\n\n${body.join('\n\n')}`.trim();
}


/**
 * Parses and extracts text content from a PDF file using pdf-parse.
 */
async function readPdfFile(filePath) {
  try {
    const dataBuffer = await fs.readFile(filePath);
    const data = await pdfParse(dataBuffer);
    return data.text;
  } catch (err) {
    console.error('PDF Parse Error:', err);
    throw new Error('PDF faylı oxunarkən xəta baş verdi: ' + err.message);
  }
}

async function extractDocxText(buffer) {
  const result = await mammoth.extractRawText({ buffer });
  return result?.value || '';
}

function extractSpreadsheetText(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const chunks = [];
  for (const sheetName of wb.SheetNames.slice(0, 10)) {
    const sheet = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false, raw: false });
    const lines = rows
      .slice(0, 500)
      .map((row) => Array.isArray(row) ? row.map((c) => String(c ?? '')).join('\t') : String(row))
      .join('\n');
    chunks.push(`[Sheet: ${sheetName}]\n${lines}`);
  }
  return chunks.join('\n\n');
}

let ocrWorkerPromise = null;
async function getOcrWorker() {
  if (!ocrWorkerPromise) {
    ocrWorkerPromise = (async () => {
      const worker = await createWorker('eng');
      return worker;
    })();
  }
  return ocrWorkerPromise;
}

async function extractImageText(buffer) {
  const worker = await getOcrWorker();
  const result = await worker.recognize(buffer);
  return result?.data?.text || '';
}

function decodeDataUrl(dataUrl) {
  if (!dataUrl || typeof dataUrl !== 'string') return null;
  const match = dataUrl.match(/^data:([^;,]+)?(;base64)?,(.*)$/);
  if (!match) return null;
  const mimeType = match[1] || 'application/octet-stream';
  const isBase64 = Boolean(match[2]);
  const payload = match[3] || '';
  const buffer = isBase64
    ? Buffer.from(payload, 'base64')
    : Buffer.from(decodeURIComponent(payload), 'utf8');
  return { mimeType, buffer };
}

async function extractAttachment(attachment) {
  if (attachment?.extractedText && typeof attachment.extractedText === 'string') {
    return {
      name: attachment?.name || 'attachment',
      mimeType: attachment?.mimeType || attachment?.type || 'application/octet-stream',
      extractedText: attachment.extractedText.slice(0, 50000),
      imageUrl: attachment?.imageUrl
    };
  }

  const decoded = decodeDataUrl(attachment?.url);
  const mimeType = attachment?.mimeType || decoded?.mimeType || attachment?.type || 'text/plain';
  const name = attachment?.name || 'attachment';

  try {
    if (!decoded) {
      return { name, mimeType, extractedText: '' };
    }

    const lowerName = name.toLowerCase();
    const buf = decoded.buffer;

    // SEC/FUNC-FIX: actually use the imported parsers for PDF/DOCX/XLSX/images
    // (previously they were imported but only the agent's `read_file` tool used
    // them — user attachments fell through to "unsupported file type").
    if (mimeType === 'application/pdf' || lowerName.endsWith('.pdf')) {
      try {
        const data = await pdfParse(buf);
        return { name, mimeType, extractedText: (data?.text || '').slice(0, 50000) };
      } catch (e) {
        return { name, mimeType, extractedText: '', extractionError: `PDF parse xətası: ${e.message}` };
      }
    }

    if (
      mimeType.includes('officedocument.wordprocessingml') ||
      lowerName.endsWith('.docx')
    ) {
      try {
        const text = await extractDocxText(buf);
        return { name, mimeType, extractedText: (text || '').slice(0, 50000) };
      } catch (e) {
        return { name, mimeType, extractedText: '', extractionError: `DOCX parse xətası: ${e.message}` };
      }
    }

    if (
      mimeType.includes('spreadsheetml') ||
      mimeType.includes('ms-excel') ||
      lowerName.endsWith('.xlsx') ||
      lowerName.endsWith('.xls') ||
      lowerName.endsWith('.csv')
    ) {
      try {
        const text = extractSpreadsheetText(buf);
        return { name, mimeType, extractedText: (text || '').slice(0, 50000) };
      } catch (e) {
        return { name, mimeType, extractedText: '', extractionError: `Cədvəl parse xətası: ${e.message}` };
      }
    }

    if (mimeType.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp|tiff)$/i.test(name)) {
      try {
        const text = await extractImageText(buf);
        return { name, mimeType, extractedText: (text || '').slice(0, 50000) };
      } catch (e) {
        return { name, mimeType, extractedText: '', extractionError: `Image OCR xətası: ${e.message}` };
      }
    }

    // Only support text-based files
    if (
      mimeType.startsWith('text/') ||
      mimeType.includes('json') ||
      mimeType.includes('xml') ||
      mimeType.includes('javascript') ||
      mimeType.includes('typescript') ||
      /\.(txt|json|csv|md|yaml|yml|xml|log|env|js|ts|jsx|tsx|py|html|css|sh|toml|ini|cfg|conf)$/i.test(name)
    ) {
      const text = buf.toString('utf8');
      return { name, mimeType, extractedText: text.slice(0, 50000) };
    }

    return { name, mimeType, extractedText: `[Dəstəklənməyən fayl növü: ${name}. Dəstəklənənlər: PDF, DOCX, XLSX, CSV, şəkillər (OCR), və mətn faylları.]` };
  } catch (error) {
    console.error('Attachment parse xətası:', name, error?.message || error);
    return { name, mimeType, extractedText: `[Attachment oxunarkən xəta: ${name}]` };
  }
}

async function normalizeMessagesForModel(messages = [], modelName = '') {
  const normalized = [];
  const isLocalOrFlakyModel = isLocalMode() || 
    !modelName || 
    /qwen|ollama|deepseek|llama|local|free|nemotron/i.test(modelName);

  for (const message of messages) {
    if (!message) continue;
    
    let content = message.content || '';
    let role = message.role;
    let tool_calls = message.tool_calls;
    let tool_call_id = message.tool_call_id;
    let name = message.name;

    // 1. Process attachments if any
    if (message.attachments?.length) {
      const textParts = [
        content,
        '[Sistem qeydi: İstifadəçi artıq attachment göndərib. Yenidən upload/drag-drop/link istəmədən mövcud attachment məzmununu analiz et.]'
      ];

      const results = await Promise.all(message.attachments.map(async (attachment) => {
        if (attachment?.extractedText && typeof attachment.extractedText === 'string' && attachment.extractedText.trim()) {
          return `\n\n[Attachment: ${attachment.name || 'attachment'} | ${attachment.mimeType || attachment.type || 'unknown'}]\n${attachment.extractedText.slice(0, 6000)}`;
        }
        if (attachment?.extractionError) {
          return `\n\n[Attachment: ${attachment?.name || 'attachment'}]\nOxuma xətası: ${attachment.extractionError}`;
        }
        if (!attachment?.url || attachment.url === '') {
          return `\n\n[Attachment: ${attachment?.name || 'attachment'} | ${attachment?.mimeType || 'unknown'}]\nFayl əlavə olunub, amma məzmunu çıxarıla bilmədi.`;
        }
        let extracted;
        try {
          extracted = await extractAttachment(attachment);
        } catch (error) {
          extracted = {
            name: attachment?.name || 'attachment',
            mimeType: attachment?.mimeType || attachment?.type || 'application/octet-stream',
            extractedText: `[Attachment emalında xəta: ${attachment?.name || 'attachment'}]`
          };
        }
        if (extracted.extractedText) {
          return `\n\n[Attachment: ${extracted.name} | ${extracted.mimeType}]\n${extracted.extractedText.slice(0, 6000)}`;
        } else {
          return `\n\n[Attachment: ${attachment?.name || extracted.name || 'attachment'} | ${attachment?.mimeType || extracted.mimeType || 'unknown'}]\nMətn çıxarıla bilmədi, amma fayl əlavə olunub.`;
        }
      }));

      textParts.push(...results);
      content = textParts.join('\n').trim();
    }

    // 2. Local model tool formatting
    if (isLocalOrFlakyModel) {
      if (role === 'assistant' && tool_calls && tool_calls.length > 0) {
        let toolCallText = '';
        for (const tc of tool_calls) {
          toolCallText += `\n\`\`\`json\n{\n  "name": "${tc.function.name}",\n  "arguments": ${tc.function.arguments || '{}'}\n}\n\`\`\``;
        }
        const hasAnyToolMention = tool_calls.some(tc => content.includes(tc.function.name));
        if (!hasAnyToolMention) {
          content = (content + '\n' + toolCallText).trim();
        }
      } else if (role === 'tool') {
        const toolName = name || 'Alət';
        content = `📥 [Alət Nəticəsi (${toolName})]:\n${content}`;
        role = 'user';
        tool_call_id = undefined;
        name = undefined;
      }

      // 3. Prevent hallucination loop: if the model previously output {"response": "text"}, flatten it so it doesn't repeat the mistake.
      if (role === 'assistant' && typeof content === 'string') {
        const responseMatch = content.match(/\{\s*"response"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"\s*\}/);
        if (responseMatch && responseMatch[1]) {
          content = content.replace(responseMatch[0], responseMatch[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\'));
        }
        // Clean up leaked system prompts to prevent infinite loops
        content = content.replace(/Layihə yaddaşı:\s*\{[\s\S]*?\}\n*/g, '').trim();
      }
    }

    normalized.push({
      role,
      content,
      tool_calls: (isLocalOrFlakyModel) ? undefined : (tool_calls?.length ? tool_calls : undefined),
      tool_call_id: (isLocalOrFlakyModel) ? undefined : tool_call_id,
      name: (isLocalOrFlakyModel) ? undefined : name
    });
  }

  if (isLocalOrFlakyModel && normalized.length > 0) {
    const lastMsg = normalized[normalized.length - 1];
    if (lastMsg.role === 'user' && lastMsg.content.includes('📥 [Alət Nəticəsi')) {
      lastMsg.content += '\n\n**Təlimat:** Yuxarıdakı nəticəni analiz et və mənə ətraflı cavab yaz. Diqqət: Cavabını qətiyyən JSON formatında yazma, adi mətn (Markdown) kimi yaz!';
    }
  }

  return normalized;
}

function generateToolsSystemPrompt(activeTools = TOOLS) {
  // FUNC-FIX: previous prompt was 80+ lines with 5 worked examples and made
  // smaller local models lose context. Compact prompt with a single concrete
  // example and a hard rule list.
  let prompt = `\n\nİSTİFADƏ EDƏ BİLƏCƏYİN ALƏTLƏR (TOOLS):\n`;
  prompt += `Tool çağırışı üçün cavabın YALNIZ aşağıdakı kimi JSON bloku olmalıdır:\n`;
  prompt += `\`\`\`json\n{"name": "alət_adı", "arguments": {"arq": "dəyər"}}\n\`\`\`\n`;
  prompt += `Bir cavabda yalnız 1 tool çağırışı et. İstifadəçiyə son cavab verirsənsə, JSON İSTİFADƏ ETMƏ — adi Markdown yaz.\n\n`;

  prompt += `Mövcud alətlər:\n`;
  for (const t of activeTools) {
    const fn = t.function;
    const requiredParams = (fn.parameters?.required || []).join(', ');
    prompt += `• \`${fn.name}\` — ${fn.description}`;
    if (requiredParams) prompt += ` (məcburi: ${requiredParams})`;
    prompt += `\n`;
  }

  prompt += `\nNÜMUNƏ: İstifadəçi "qovluğu oxu" deyirsə:
\`\`\`json
{"name": "list_directory", "arguments": {"path": "./"}}
\`\`\`

QAYDA: Tam yol verilibsə (məs. /Users/.../proj), həmin yolu eyniylə path-da istifadə et — kor-koranə "./" yazma.\n`;
  return prompt;
}

function buildDeepSeekRecoveryMessages(messages = []) {
  if (!Array.isArray(messages) || messages.length === 0) return [];
  const sys = messages.find((m) => m?.role === 'system');
  const recent = messages
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant'))
    .slice(-8)
    .map((m) => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content : ''
    }));

  if (sys) {
    return [{ role: 'system', content: typeof sys.content === 'string' ? sys.content : '' }, ...recent];
  }
  return recent;
}

function extractTextToolCalls(text, activeTools = TOOLS) {
  if (!text) return { cleanedText: text, toolCalls: [] };

  // FUNC-FIX: previous impl reset `index = 0` after each match (O(n^2) +
  // double-emit) and used unreliable surrounding-text guessing. New: single
  // forward pass, returns at most ONE tool call per response (matches the
  // chat loop behaviour and avoids hallucination loops on local models).
  const toolCalls = [];
  const removed = [];

  const blockRegex = /```(?:json)?\s*(\{[\s\S]*?\})\s*```/ig;
  let m;
  while ((m = blockRegex.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(m[1]);
      if (parsed && typeof parsed.name === 'string' && parsed.arguments !== undefined &&
          activeTools.some((t) => t.function.name === parsed.name)) {
        toolCalls.push({
          name: parsed.name,
          arguments: typeof parsed.arguments === 'object' ? JSON.stringify(parsed.arguments) : String(parsed.arguments)
        });
        removed.push([m.index, m.index + m[0].length]);
        break;
      }
    } catch { /* ignore */ }
  }

  if (toolCalls.length === 0) {
    let i = 0;
    while (i < text.length) {
      const startIdx = text.indexOf('{', i);
      if (startIdx === -1) break;
      let braceCount = 0;
      let inString = false;
      let escape = false;
      let endIndex = startIdx;
      let found = false;
      for (; endIndex < text.length; endIndex++) {
        const ch = text[endIndex];
        if (escape) { escape = false; continue; }
        if (ch === '\\') { escape = true; continue; }
        if (ch === '"') { inString = !inString; continue; }
        if (inString) continue;
        if (ch === '{') braceCount++;
        else if (ch === '}') {
          braceCount--;
          if (braceCount === 0) { endIndex++; found = true; break; }
        }
      }
      if (!found) break;
      const candidate = text.substring(startIdx, endIndex);
      try {
        const parsed = JSON.parse(candidate);
        if (parsed && typeof parsed === 'object' && typeof parsed.name === 'string' &&
            parsed.arguments !== undefined &&
            activeTools.some((t) => t.function.name === parsed.name)) {
          toolCalls.push({
            name: parsed.name,
            arguments: typeof parsed.arguments === 'object' ? JSON.stringify(parsed.arguments) : String(parsed.arguments)
          });
          let startCut = startIdx;
          const before = text.substring(Math.max(0, startIdx - 10), startIdx);
          const fence = before.match(/```(?:json)?\s*$/i);
          if (fence) startCut -= fence[0].length;
          removed.push([startCut, endIndex]);
          break;
        }
      } catch { /* not valid JSON */ }
      i = endIndex;
    }
  }

  let cleaned = text;
  for (let r = removed.length - 1; r >= 0; r--) {
    cleaned = cleaned.substring(0, removed[r][0]) + cleaned.substring(removed[r][1]);
  }
  return { cleanedText: cleaned.trim(), toolCalls };
}

function serializeProject(row) {
  return {
    id: row.id,
    name: row.name,
    path: row.path,
    repoUrl: row.repo_url || undefined,
    lastPort: row.last_port || undefined,
    archived: Boolean(row.archived),
    createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now()
  };
}

function serializeConversation(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    messages: Array.isArray(row.messages) ? row.messages : [],
    createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
    updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : Date.now()
  };
}

const MAX_ACTIVE_CHAT_TOTAL = parseInt(process.env.MAX_ACTIVE_CHAT_TOTAL || '50', 10);
const MAX_ACTIVE_CHAT_PER_USER = parseInt(process.env.MAX_ACTIVE_CHAT_PER_USER || '5', 10);
// FIX: Increased default from 5s to 15s. GUI agent operations (browser launch,
// screenshot capture, etc.) can stall the queue when a previous request on the
// same conversation is still streaming/finishing. 5s was too aggressive.
const CHAT_QUEUE_TIMEOUT_MS = parseInt(process.env.CHAT_QUEUE_TIMEOUT_MS || '15000', 10);
// FIX: Increased max age from 2min to 5min for GUI workflows which legitimately
// run longer (browser automation loops, human checkpoint waits).
const CHAT_SLOT_MAX_AGE_MS = parseInt(process.env.CHAT_SLOT_MAX_AGE_MS || '300000', 10);
const chatRuntime = createChatRuntime({
  maxActiveChatTotal: MAX_ACTIVE_CHAT_TOTAL,
  maxActiveChatPerUser: MAX_ACTIVE_CHAT_PER_USER,
  chatQueueTimeoutMs: CHAT_QUEUE_TIMEOUT_MS,
  chatSlotMaxAgeMs: CHAT_SLOT_MAX_AGE_MS
});
const {
  interactions,
  acquireChatSlotQueued,
  releaseChatSlot,
  waitForApproval,
  supersedeConversation,
  setConversationAbort,
  createInteraction,
  getInteraction,
  deleteInteraction,
  listInteractionsByUser,
  createCheckpoint,
  resolveCheckpoint
} = chatRuntime;

function makeUnifiedDiff(oldContent, newContent, filePath) {
  const oldLines = String(oldContent || '').split('\n');
  const newLines = String(newContent || '').split('\n');
  const max = Math.max(oldLines.length, newLines.length);
  const diff = [`--- a/${filePath}`, `+++ b/${filePath}`];

  for (let i = 0; i < max; i += 1) {
    const oldLine = oldLines[i];
    const newLine = newLines[i];
    if (oldLine === newLine) {
      continue;
    }
    if (oldLine !== undefined) diff.push(`-${oldLine}`);
    if (newLine !== undefined) diff.push(`+${newLine}`);
  }

  return diff.join('\n');
}

function isSensitiveTool(toolName) {
  return toolName === 'write_file' || toolName === 'file_edit' || toolName === 'multi_file_edit' || toolName === 'run_terminal_command' || toolName === 'git_clone' || toolName === 'git_push' || toolName === 'start_server';
}

function truncatePreview(value = '', max = 280) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max)}...`;
}

function summarizeDiff(diffText = '') {
  const lines = String(diffText || '').split('\n');
  let added = 0;
  let removed = 0;
  const preview = [];

  for (const line of lines) {
    if (line.startsWith('+++') || line.startsWith('---')) continue;
    if (line.startsWith('+')) added += 1;
    if (line.startsWith('-')) removed += 1;
    if ((line.startsWith('+') || line.startsWith('-')) && preview.length < 16) {
      preview.push(line);
    }
  }

  return {
    added,
    removed,
    preview: preview.join('\n')
  };
}

async function buildApprovalMetadata(toolName, rawArgs, workingDirectory, user) {
  let parsedArgs = {};
  try {
    parsedArgs = JSON.parse(rawArgs || '{}');
  } catch {
    parsedArgs = {};
  }

  const metadata = {
    riskLevel: 'medium',
    reason: 'Bu əməliyyat workspace və ya sistem vəziyyətini dəyişə bilər.',
    title: toolName,
    summary: '',
    preview: '',
    path: '',
    command: '',
    diffPreview: '',
    diffStats: null
  };

  if (toolName === 'run_terminal_command') {
    const command = String(parsedArgs.command || '').trim();
    const destructive = /\b(rm|mv|chmod|chown|git reset|git clean|sudo|dd)\b/i.test(command);
    metadata.riskLevel = destructive ? 'high' : 'medium';
    metadata.reason = destructive
      ? 'Terminal komandası faylları silə, dəyişə və ya sistemə təsir edə bilər.'
      : 'Terminal komandası layihə fayllarını və ya prosesləri dəyişə bilər.';
    metadata.title = 'Terminal command';
    metadata.command = command;
    metadata.summary = command || 'Terminal command';
    metadata.preview = truncatePreview(command || 'Komanda göstərilməyib');
  } else if (toolName === 'write_file' || toolName === 'file_edit' || toolName === 'multi_file_edit') {
    const targetPath = parsedArgs.path || parsedArgs.file || parsedArgs.cwd || '';
    const contentPreview =
      parsedArgs.replacement_content ||
      parsedArgs.content ||
      parsedArgs.target_content ||
      '';
    metadata.riskLevel = 'high';
    metadata.reason = 'Bu əməliyyat fayl məzmununu dəyişəcək.';
    metadata.title = toolName === 'write_file' ? 'Write file' : 'Edit file';
    metadata.path = targetPath ? path.resolve(workingDirectory, targetPath) : '';
    metadata.summary = targetPath || 'Fayl dəyişikliyi';
    metadata.preview = truncatePreview(contentPreview || 'Məzmun preview yoxdur');

    try {
      if (toolName === 'multi_file_edit' && Array.isArray(parsedArgs.edits) && parsedArgs.edits.length > 0) {
        const diffs = [];
        for (const edit of parsedArgs.edits.slice(0, 3)) {
          const editPath = path.resolve(workingDirectory, edit.path || '');
          if (!isPathSafe(editPath, workingDirectory, user)) continue;
          const oldContent = await fs.readFile(editPath, 'utf8');
          const newContent = String(oldContent).replace(edit.target_content, edit.replacement_content);
          const diff = makeUnifiedDiff(oldContent, newContent, edit.path || editPath);
          const summary = summarizeDiff(diff);
          if (summary.preview) {
            diffs.push(`# ${edit.path || editPath}\n${summary.preview}`);
            metadata.diffStats = {
              added: (metadata.diffStats?.added || 0) + summary.added,
              removed: (metadata.diffStats?.removed || 0) + summary.removed
            };
          }
        }
        metadata.diffPreview = diffs.join('\n');
      } else if (metadata.path && isPathSafe(metadata.path, workingDirectory, user)) {
        const oldContent = await fs.readFile(metadata.path, 'utf8').catch(() => '');
        const newContent = toolName === 'write_file'
          ? String(parsedArgs.content || '')
          : String(oldContent).replace(parsedArgs.target_content || '', parsedArgs.replacement_content || '');
        const diff = makeUnifiedDiff(oldContent, newContent, targetPath || metadata.path);
        const summary = summarizeDiff(diff);
        metadata.diffPreview = summary.preview;
        metadata.diffStats = {
          added: summary.added,
          removed: summary.removed
        };
      }
    } catch {
      metadata.diffPreview = '';
      metadata.diffStats = null;
    }
  } else if (toolName === 'git_push') {
    metadata.riskLevel = 'high';
    metadata.reason = 'Bu əməliyyat dəyişiklikləri uzaq repoya göndərəcək.';
    metadata.title = 'Git push';
    metadata.summary = parsedArgs.branch ? `branch: ${parsedArgs.branch}` : 'current branch';
    metadata.preview = truncatePreview(JSON.stringify(parsedArgs, null, 2));
  } else if (toolName === 'git_clone') {
    metadata.riskLevel = 'medium';
    metadata.reason = 'Yeni repo workspace daxilinə yazılacaq.';
    metadata.title = 'Git clone';
    metadata.summary = parsedArgs.url || 'repository clone';
    metadata.preview = truncatePreview(JSON.stringify(parsedArgs, null, 2));
  } else if (toolName === 'start_server') {
    metadata.riskLevel = 'medium';
    metadata.reason = 'Yeni server/proses başladılacaq.';
    metadata.title = 'Start server';
    metadata.summary = parsedArgs.command || parsedArgs.port || 'server start';
    metadata.preview = truncatePreview(JSON.stringify(parsedArgs, null, 2));
  } else {
    metadata.preview = truncatePreview(JSON.stringify(parsedArgs, null, 2));
    metadata.summary = truncatePreview(toolName, 120);
  }

  return metadata;
}

async function runStreamingCommand(command, cwd, onChunk) {
  return new Promise((resolve) => {
    const proc = spawn('sh', ['-c', command], { cwd });
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      const chunk = String(data);
      stdout += chunk;
      onChunk('stdout', chunk);
    });

    proc.stderr.on('data', (data) => {
      const chunk = String(data);
      stderr += chunk;
      onChunk('stderr', chunk);
    });

    proc.on('close', (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

/**

 * SEC-5: Command Allowlist instead of Blocklist
 */
const ALLOWED_COMMANDS = ['npm', 'npx', 'yarn', 'git', 'node', 'python', 'python3', 'pip', 'ls', 'pwd', 'mkdir', 'touch', 'grep', 'find', 'cat', 'echo', 'cp', 'mv', 'rm', 'curl', 'which', 'env'];

function isBashCommandSafe(command) {
  // SEC-Audit: Block shell metacharacters to prevent chaining/injection
  const unsafeChars = /[;&|`$(){}><]/;
  if (unsafeChars.test(command)) return false;

  const baseCmd = command.trim().split(/\s+/)[0];
  return ALLOWED_COMMANDS.includes(baseCmd) || command.startsWith('npm run') || command.startsWith('npx ');
}

// ==========================================
// Tool Definitions
// ==========================================
const TOOLS = getToolDefinitions();

// ==========================================
// Tool Execution Handler
// ==========================================

async function handleToolCall(toolCall, workingDirectory, user) {
    try {
        const name = normalizeToolName(toolCall?.function?.name);
        const argsJson = toolCall?.function?.arguments || '{}';
        const args = typeof argsJson === 'string' ? JSON.parse(argsJson) : (argsJson || {});
        switch (name) {
            case "check_port_status": {
                const net = require('net');
                return new Promise((resolve) => {
                    const socket = new net.Socket();
                    socket.setTimeout(2000);
                    socket.on('connect', () => {
                        socket.destroy();
                        resolve(`Port ${args.port} is ACTIVE and listening.`);
                    });
                    socket.on('timeout', () => {
                        socket.destroy();
                        resolve(`Port ${args.port} is CLOSED (Timeout).`);
                    });
                    socket.on('error', () => {
                        socket.destroy();
                        resolve(`Port ${args.port} is CLOSED.`);
                    });
                    socket.connect(args.port, '127.0.0.1');
                });
            }

            case "list_directory": {
                const targetPath = path.resolve(workingDirectory, args.path || '.');
                if (!isPathSafe(targetPath, workingDirectory, user)) return "Error: Path outside workspace";
                const files = await fs.readdir(targetPath, { withFileTypes: true });
                return files.map(f => `${f.isDirectory() ? '[DIR] ' : ''}${f.name}`).join('\n');
            }

            case "glob_search": {
                const searchCwd = path.resolve(workingDirectory, args.cwd || '.');
                if (!isPathSafe(searchCwd, workingDirectory, user)) return "Error: Path outside workspace";
                const matches = await glob(args.pattern, { cwd: searchCwd, ignore: ['**/node_modules/**', '**/.git/**'] });
                return matches.join('\n') || "No matches found";
            }

            case "read_file": {
                const filePath = path.resolve(workingDirectory, args.path);
                if (!isPathSafe(filePath, workingDirectory, user)) return "Error: Path outside workspace";
                
                let content;
                if (filePath.toLowerCase().endsWith('.pdf')) {
                    content = await readPdfFile(filePath);
                    if (content.length > 50000) return content.slice(0, 50000) + "\n\n[TRUNCATED... File too large]";
                    return content;
                } else {
                    content = await fs.readFile(filePath, 'utf8');
                }

                const lines = content.split('\n');
                const totalLines = lines.length;
                let startLine = args.start_line ? Math.max(1, parseInt(args.start_line, 10)) : 1;
                let endLine = args.end_line ? Math.max(startLine, parseInt(args.end_line, 10)) : totalLines;
                
                // Cap to 800 lines max per request to prevent token overflow
                if (endLine - startLine + 1 > 800) {
                    endLine = startLine + 799;
                }
                if (endLine > totalLines) {
                    endLine = totalLines;
                }

                const selectedLines = lines.slice(startLine - 1, endLine);
                const formattedLines = selectedLines.map((line, idx) => `${startLine + idx}: ${line}`).join('\n');
                
                return `File: ${args.path}\nTotal lines: ${totalLines}\nShowing lines ${startLine} to ${endLine}:\n\n${formattedLines}`;
            }


            case "write_file": {
                const filePath = path.resolve(workingDirectory, args.path);
                if (!isPathSafe(filePath, workingDirectory, user)) return "Error: Path outside workspace";
                await fs.mkdir(path.dirname(filePath), { recursive: true });
                await fs.writeFile(filePath, args.content, 'utf8');
                return `Successfully created ${args.path}`;
            }

            case "file_edit": {
                const filePath = path.resolve(workingDirectory, args.path);
                if (!isPathSafe(filePath, workingDirectory, user)) return "Error: Path outside workspace";
                const content = await fs.readFile(filePath, 'utf8');
                
                // BUG-9: Check for ambiguity
                const occurrences = content.split(args.target_content).length - 1;
                if (occurrences === 0) return `Error: Target content not found in ${args.path}`;
                if (occurrences > 1) return `Error: Target content found ${occurrences} times. Provide more context.`;
                
                const newContent = content.replace(args.target_content, args.replacement_content);
                await fs.writeFile(filePath, newContent, 'utf8');
                return `Successfully updated ${args.path}`;
            }

            case "run_terminal_command": {
                if (!isBashCommandSafe(args.command)) return "Error: Command blocked or contains unsafe characters.";

                return new Promise((resolve) => {
                    const isServerCmd = args.command.includes('dev') || args.command.includes('serve') || args.command.includes('npm run') || args.command.includes('yarn');

                    const proc = spawn('sh', ['-c', args.command], {
                        cwd: workingDirectory,
                        detached: true, // Allow process to live independently
                        stdio: 'pipe'
                    });

                    let out = "", err = "";
                    let resolved = false;

                    proc.stdout.on('data', d => {
                        out += d;
                        // If it's a server, we don't wait for close, we look for "ready" signals
                        if (!resolved && isServerCmd && (out.includes('ready') || out.includes('Local:') || out.includes('localhost:'))) {
                            resolved = true;
                            proc.unref(); // Detach so parent can exit independently
                            resolve(`Server started in background.\nSTDOUT Snapshot: ${out}`);
                        }
                    });
                    proc.stderr.on('data', d => err += d);

                    proc.on('close', code => {
                        if (!resolved) {
                            resolved = true;
                            resolve(`Exit Code ${code}\nSTDOUT: ${out}\nSTDERR: ${err}`);
                        }
                    });

                    proc.on('error', (e) => {
                        if (!resolved) {
                            resolved = true;
                            resolve(`Process error: ${e.message}\nSTDOUT: ${out}\nSTDERR: ${err}`);
                        }
                    });

                    // For non-server commands, keep timeout. For servers, return success early but KEEP ALIVE.
                    setTimeout(() => {
                        if (resolved) return;
                        if (isServerCmd) {
                            resolved = true;
                            proc.unref(); // Detach so parent can exit independently
                            resolve(`Server is likely running in background (Timeout reached, but process kept alive).\nSTDOUT: ${out}`);
                        } else {
                            // Kill entire process group for detached processes
                            try {
                                process.kill(-proc.pid, 'SIGTERM');
                            } catch {
                                proc.kill('SIGTERM');
                            }
                            resolved = true;
                            resolve(`Timeout reached: ${out}`);
                        }
                    }, isServerCmd ? 5000 : 30000);
                });
            }

            case "git_clone": {
                // SEC-Audit: Validate folder name
                if (args.folderName.includes('..') || args.folderName.includes('/')) {
                    return "Error: Invalid folder name for security reasons.";
                }
                
                return new Promise((resolve) => {
                    let cloneUrl = args.url;
                    try {
                      if (typeof cloneUrl === 'string' && cloneUrl.includes('github.com') && user?.id) {
                        // private GitHub repos can be cloned transparently if user connected a token
                        // token is injected only for the git command, never returned to UI logs.
                        getUserGithubToken(user.id).then((githubToken) => {
                          cloneUrl = injectGithubTokenIntoUrl(cloneUrl, githubToken);
                          const proc = spawn('git', ['clone', cloneUrl, args.folderName], { cwd: workingDirectory });
                          let out = "", err = "";
                          proc.stdout.on('data', d => out += d);
                          proc.stderr.on('data', d => err += d);
                          proc.on('close', (code) => {
                              if (code === 0) resolve(`Successfully cloned ${args.url} into ${args.folderName}`);
                              else resolve(`Error cloning: ${err}`);
                          });
                          setTimeout(() => { proc.kill(); resolve(`Timeout reached while cloning`); }, 60000);
                        }).catch(() => {
                          const proc = spawn('git', ['clone', args.url, args.folderName], { cwd: workingDirectory });
                          let out = "", err = "";
                          proc.stdout.on('data', d => out += d);
                          proc.stderr.on('data', d => err += d);
                          proc.on('close', (code) => {
                              if (code === 0) resolve(`Successfully cloned ${args.url} into ${args.folderName}`);
                              else resolve(`Error cloning: ${err}`);
                          });
                          setTimeout(() => { proc.kill(); resolve(`Timeout reached while cloning`); }, 60000);
                        });
                        return;
                      }
                    } catch { /* ignore */ }

                    // SEC-4: Use execFile style for safety
                    const proc = spawn('git', ['clone', args.url, args.folderName], { cwd: workingDirectory });
                    let out = "", err = "";
                    proc.stdout.on('data', d => out += d);
                    proc.stderr.on('data', d => err += d);
                    proc.on('close', (code) => {
                        if (code === 0) resolve(`Successfully cloned ${args.url} into ${args.folderName}`);
                        else resolve(`Error cloning: ${err}`);
                    });
                    setTimeout(() => { proc.kill(); resolve(`Timeout reached while cloning`); }, 60000);
                });
            }

            case "github_list_contents": {
                return new Promise(async (resolve) => {
                    try {
                        const { owner, repo, path: repoPath = '' } = args;
                        const token = await getUserGithubToken(user?.id).catch(() => null);
                        const headers = { 'User-Agent': 'bahAI-Agent', 'Accept': 'application/vnd.github.v3+json' };
                        if (token) headers['Authorization'] = `token ${token}`;

                        const url = `https://api.github.com/repos/${owner}/${repo}/contents/${repoPath}`;
                        const response = await fetch(url, { headers });
                        if (!response.ok) {
                            return resolve(`GitHub API Error: ${response.status} ${response.statusText}`);
                        }
                        const data = await response.json();
                        if (Array.isArray(data)) {
                            const output = data.map(item => `[${item.type}] ${item.path}`).join('\n');
                            resolve(output || "Directory is empty");
                        } else {
                            resolve(`Found single file: ${data.path} (Use github_read_file to read it)`);
                        }
                    } catch (err) {
                        resolve(`Error fetching contents: ${err.message}`);
                    }
                });
            }

            case "github_read_file": {
                return new Promise(async (resolve) => {
                    try {
                        const { owner, repo, path: filePath } = args;
                        const token = await getUserGithubToken(user?.id).catch(() => null);
                        const headers = { 'User-Agent': 'bahAI-Agent', 'Accept': 'application/vnd.github.v3+json' };
                        if (token) headers['Authorization'] = `token ${token}`;

                        const url = `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`;
                        const response = await fetch(url, { headers });
                        if (!response.ok) {
                            return resolve(`GitHub API Error: ${response.status} ${response.statusText}`);
                        }
                        const data = await response.json();
                        if (data.type === 'file' && data.content && data.encoding === 'base64') {
                            const content = Buffer.from(data.content, 'base64').toString('utf8');
                            resolve(content);
                        } else {
                            resolve(`Error: Target is not a base64 encoded file (type: ${data.type})`);
                        }
                    } catch (err) {
                        resolve(`Error reading file: ${err.message}`);
                    }
                });
            }

            case "github_search_code": {
                return new Promise(async (resolve) => {
                    try {
                        const { owner, repo, query } = args;
                        const token = await getUserGithubToken(user?.id).catch(() => null);
                        const headers = { 'User-Agent': 'bahAI-Agent', 'Accept': 'application/vnd.github.v3+json' };
                        if (token) headers['Authorization'] = `token ${token}`;

                        const encodedQuery = encodeURIComponent(`${query} repo:${owner}/${repo}`);
                        const url = `https://api.github.com/search/code?q=${encodedQuery}`;
                        const response = await fetch(url, { headers });
                        if (!response.ok) {
                            if (response.status === 401) {
                                return resolve("Xəta: GitHub-da axtarış etmək üçün sistemə GitHub hesabı əlavə edilməlidir. Lütfən istifadəçiyə bunu deyin və ya ondan fayl adını birbaşa yazmasını xahiş edin.");
                            }
                            return resolve(`GitHub API Error: ${response.status} ${response.statusText}`);
                        }
                        const data = await response.json();
                        if (data.items && data.items.length > 0) {
                            const results = data.items.slice(0, 10).map(item => `[Match in ${item.path}] - URL: ${item.html_url}`).join('\n');
                            resolve(`Found matches in the following files:\n${results}\n\n(Use github_read_file on the 'path' to read the full code)`);
                        } else {
                            resolve("No matches found for your query in this repository.");
                        }
                    } catch (err) {
                        resolve(`Error searching code: ${err.message}`);
                    }
                });
            }

            case "grep_search": {
                const searchCwd = path.resolve(workingDirectory, args.cwd || '.');
                if (!isPathSafe(searchCwd, workingDirectory, user)) return "Error: Path outside workspace";
                // SEC-4: Use execFile to avoid shell injection
                try {
                    const { stdout } = await execFileAsync('grep', ['-rnI', args.query, searchCwd], { cwd: workingDirectory, timeout: 10000 });
                    return stdout.split('\n').slice(0, 50).join('\n') || "No matches found";
                } catch (e) {
                    return "No matches found or grep error";
                }
            }

            case "git_status": {
                try {
                    const { stdout } = await execFileAsync('git', ['status', '--short'], { cwd: workingDirectory, timeout: 5000 });
                    return stdout || "No changes detected";
                } catch (e) {
                    return `Git status error: ${e.message}`;
                }
            }

            case "git_diff": {
                try {
                    const gitArgs = args.file ? ['diff', args.file] : ['diff'];
                    const { stdout } = await execFileAsync('git', gitArgs, { cwd: workingDirectory, timeout: 10000 });
                    return stdout || "No differences found";
                } catch (e) {
                    return `Git diff error: ${e.message}`;
                }
            }

            case "git_commit": {
                try {
                    // Stage files
                    if (args.files && args.files.length > 0) {
                        await execFileAsync('git', ['add', ...args.files], { cwd: workingDirectory, timeout: 5000 });
                    } else {
                        await execFileAsync('git', ['add', '-A'], { cwd: workingDirectory, timeout: 5000 });
                    }
                    
                    // Commit
                    const { stdout } = await execFileAsync('git', ['commit', '-m', args.message], { cwd: workingDirectory, timeout: 5000 });
                    return stdout || `Committed: ${args.message}`;
                } catch (e) {
                    return `Git commit error: ${e.message}`;
                }
            }

            case "analyze_codebase": {
                const analyzePath = args.path ? path.resolve(workingDirectory, args.path) : workingDirectory;
                if (!isPathSafe(analyzePath, workingDirectory, user)) return "Error: Path outside workspace";
                
                try {
                    // Count files by extension
                    const files = await glob('**/*', { 
                        cwd: analyzePath, 
                        ignore: ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/build/**', '**/.next/**', '**/venv/**', '**/__pycache__/**'],
                        nodir: true 
                    });
                    
                    const extensions = {};
                    files.forEach(file => {
                        const ext = path.extname(file) || 'no-extension';
                        extensions[ext] = (extensions[ext] || 0) + 1;
                    });
                    
                    // Get top-level structure
                    const topLevel = await fs.readdir(analyzePath, { withFileTypes: true });
                    const structure = topLevel
                        .filter(f => !f.name.startsWith('.') && f.name !== 'node_modules' && f.name !== 'dist' && f.name !== 'build')
                        .map(f => `${f.isDirectory() ? '📁' : '📄'} ${f.name}`)
                        .join('\n');
                    const repoProfile = await detectRepoProfile(analyzePath);
                    const serializedRepoProfile = serializeRepoProfile(repoProfile);

                    // Read main entry point
                    let entryContent = '';
                    for (const ef of repoProfile.entryPoints) {
                        try {
                            const content = await fs.readFile(path.join(analyzePath, ef), 'utf-8');
                            entryContent = `\n\n📝 Entry point (${ef}) - ilk 50 sətir:\n${content.split('\n').slice(0, 50).join('\n')}`;
                            break;
                        } catch { /* ignore */ }
                    }

                    const packageInfo = repoProfile.packageJson
                      ? [
                          '',
                          '📦 package.json:',
                          `  Ad: ${repoProfile.packageJson.name || 'N/A'}`,
                          `  Versiya: ${repoProfile.packageJson.version || 'N/A'}`,
                          `  Scripts: ${Object.keys(repoProfile.packageJson.scripts || {}).join(', ') || 'yoxdur'}`,
                          `  Dependencies: ${Object.keys(repoProfile.packageJson.dependencies || {}).slice(0, 15).join(', ') || 'yoxdur'}`,
                          `  DevDeps: ${Object.keys(repoProfile.packageJson.devDependencies || {}).slice(0, 10).join(', ') || 'yoxdur'}`
                        ].join('\n')
                      : '';
                    
                    const summary = [
                        `📊 Layihə Analizi: ${analyzePath.split('/').pop()}`,
                        `\n📁 Struktur:\n${structure}`,
                        `\n🧭 Repo Profili:\n` +
                          `  Ekosistem: ${serializedRepoProfile.ecosystem}\n` +
                          `  Package manager: ${serializedRepoProfile.packageManager}\n` +
                          `  Repo tipi: ${serializedRepoProfile.repoShape}\n` +
                          `  Framework/stack: ${serializedRepoProfile.frameworks.join(', ') || 'tam aşkarlanmadı'}\n` +
                          `  Workspace siqnalları: ${serializedRepoProfile.workspaceSignals.join(', ') || 'yoxdur'}\n` +
                          `  Entry points: ${serializedRepoProfile.entryPoints.join(', ') || 'tapılmadı'}\n` +
                          `  Build command: ${serializedRepoProfile.buildCommand || 'tapılmadı'}\n` +
                          `  Test command: ${serializedRepoProfile.testCommand || 'tapılmadı'}\n` +
                          `  Lint command: ${serializedRepoProfile.lintCommand || 'tapılmadı'}`,
                        `\nÜmumi fayl sayı: ${files.length}`,
                        `Fayl tipləri: ${Object.entries(extensions).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k}(${v})`).join(', ')}`,
                        packageInfo,
                        repoProfile.foundConfigs.length ? `\n\n⚙️ Konfiqurasiya faylları: ${repoProfile.foundConfigs.join(', ')}` : '',
                        `\n\n[REPO_PROFILE_JSON]\n${JSON.stringify(serializedRepoProfile, null, 2)}`,
                        entryContent
                    ].filter(Boolean).join('\n');
                    
                    return summary;
                } catch (e) {
                    return `Analysis error: ${e.message}`;
                }
            }

            case "find_definition": {
                const searchCwd = path.resolve(workingDirectory, args.cwd || '.');
                if (!isPathSafe(searchCwd, workingDirectory, user)) return "Error: Path outside workspace";
                
                try {
                    // Search for function/class definitions
                    const patterns = [
                        `function ${args.symbol}`,
                        `const ${args.symbol}`,
                        `let ${args.symbol}`,
                        `class ${args.symbol}`,
                        `export.*${args.symbol}`,
                        `def ${args.symbol}`,  // Python
                    ];
                    
                    const results = [];
                    for (const pattern of patterns) {
                        try {
                            const { stdout } = await execFileAsync('grep', ['-rn', pattern, searchCwd], { 
                                cwd: workingDirectory, 
                                timeout: 5000 
                            });
                            if (stdout) results.push(stdout);
                        } catch { /* ignore */ }
                    }
                    
                    return results.length > 0 
                        ? results.join('\n').split('\n').slice(0, 20).join('\n')
                        : `Definition of '${args.symbol}' not found`;
                } catch (e) {
                    return `Find definition error: ${e.message}`;
                }
            }

            case "find_references": {
                const searchCwd = path.resolve(workingDirectory, args.cwd || '.');
                if (!isPathSafe(searchCwd, workingDirectory, user)) return "Error: Path outside workspace";
                
                try {
                    const { stdout } = await execFileAsync('grep', ['-rn', args.symbol, searchCwd], { 
                        cwd: workingDirectory, 
                        timeout: 10000 
                    });
                    const lines = stdout.split('\n').slice(0, 50);
                    return lines.length > 0 
                        ? `Found ${lines.length} references:\n${lines.join('\n')}`
                        : `No references found for '${args.symbol}'`;
                } catch (e) {
                    return `No references found for '${args.symbol}'`;
                }
            }

            case "web_search": {
                try {
                    const searchUrl = `https://www.googleapis.com/customsearch/v1?q=${encodeURIComponent(args.query)}&key=${process.env.GOOGLE_SEARCH_KEY}&cx=${process.env.GOOGLE_SEARCH_CX}`;
                    
                    // Fallback: use DuckDuckGo instant answer API (no key needed)
                    const ddgUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(args.query)}&format=json&no_html=1`;
                    const response = await fetch(ddgUrl, { timeout: 10000 });
                    const data = await response.json();
                    
                    const results = [];
                    if (data.Abstract) results.push(`📋 ${data.Abstract}`);
                    if (data.Answer) results.push(`✅ ${data.Answer}`);
                    if (data.RelatedTopics) {
                        data.RelatedTopics.slice(0, 5).forEach(topic => {
                            if (topic.Text) results.push(`• ${topic.Text}`);
                        });
                    }
                    
                    return results.length > 0 
                        ? `🔍 "${args.query}" üçün nəticələr:\n${results.join('\n')}`
                        : `"${args.query}" üçün birbaşa nəticə tapılmadı. Daha spesifik axtarış edin.`;
                } catch (e) {
                    return `Web search error: ${e.message}`;
                }
            }

            case "web_fetch": {
                try {
                    if (!args.url.startsWith('http://') && !args.url.startsWith('https://')) {
                        return "Error: URL must start with http:// or https://";
                    }
                    // SEC-FIX: block SSRF to internal services / cloud metadata.
                    let urlObj;
                    try { urlObj = new URL(args.url); } catch { return "Error: invalid URL"; }
                    const host = urlObj.hostname.toLowerCase();
                    const isPrivate = (
                      host === 'localhost' ||
                      host === '0.0.0.0' ||
                      host === '::1' ||
                      host.endsWith('.local') ||
                      host.endsWith('.internal') ||
                      /^127\./.test(host) ||
                      /^10\./.test(host) ||
                      /^192\.168\./.test(host) ||
                      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host) ||
                      /^169\.254\./.test(host) ||
                      /^fc[0-9a-f]{2}:/.test(host) ||
                      /^fe80:/.test(host)
                    );
                    if (isPrivate) {
                        return "Error: web_fetch private/internal host-larına müraciət edə bilməz.";
                    }
                    const response = await fetch(args.url, { 
                        timeout: 15000,
                        headers: { 'User-Agent': 'bahAI-Agent/1.0' }
                    });
                    if (!response.ok) return `Error: HTTP ${response.status}`;
                    const text = await response.text();
                    // Strip HTML tags for readability
                    const clean = text
                        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
                        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
                        .replace(/<[^>]+>/g, ' ')
                        .replace(/\s+/g, ' ')
                        .trim()
                        .slice(0, 8000);
                    return clean || "Page content is empty";
                } catch (e) {
                    return `Fetch error: ${e.message}`;
                }
            }

            case "run_tests": {
                try {
                    const repoProfile = await detectRepoProfile(workingDirectory);
                    const validationPlan = buildValidationPlan(repoProfile, workingDirectory, args);
                    if (!validationPlan.steps.length) {
                        return "Validation üçün uyğun komanda tapılmadı. analyze_codebase və package.json script-lərini yoxlayın.";
                    }

                    const maxSteps = typeof args.maxSteps === 'number'
                      ? Math.max(1, Math.min(validationPlan.steps.length, args.maxSteps))
                      : validationPlan.steps.length;
                    const stopOnFailure = args.stopOnFailure !== false;
                    const results = [];

                    for (const step of validationPlan.steps.slice(0, maxSteps)) {
                        try {
                            const { stdout, stderr } = await execFileAsync('sh', ['-c', step.command], {
                                cwd: workingDirectory,
                                timeout: 90000,
                                env: { ...process.env, CI: 'true', FORCE_COLOR: '0' }
                            });
                            results.push({
                                ...step,
                                status: 'passed',
                                output: `${stdout || ''}${stderr || ''}`.trim().slice(0, 3000)
                            });
                        } catch (e) {
                            const output = `${e.stdout || ''}${e.stderr || ''}`.trim().slice(0, 3000);
                            results.push({
                                ...step,
                                status: 'failed',
                                output: output || e.message || 'Komanda uğursuz oldu'
                            });
                            if (stopOnFailure) break;
                        }
                    }

                    return formatValidationReport(validationPlan, results);
                } catch (e) {
                    return `Validation error: ${e.message}`;
                }
            }

            case "git_push": {
                try {
                    const branch = args.branch || '';
                    const pushArgs = branch ? ['push', 'origin', branch] : ['push'];
                    const { stdout, stderr } = await execFileAsync('git', pushArgs, { cwd: workingDirectory, timeout: 30000 });
                    return stdout || stderr || "Push successful";
                } catch (e) {
                    return `Git push error: ${e.stderr || e.message}`;
                }
            }

            case "git_log": {
                try {
                    const count = args.count || 10;
                    const { stdout } = await execFileAsync('git', ['log', `--oneline`, `-${count}`], { cwd: workingDirectory, timeout: 5000 });
                    return stdout || "No commits found";
                } catch (e) {
                    return `Git log error: ${e.message}`;
                }
            }

            case "git_branch": {
                try {
                    if (args.name) {
                        await execFileAsync('git', ['checkout', '-b', args.name], { cwd: workingDirectory, timeout: 5000 });
                        return `Branch '${args.name}' yaradıldı və keçid edildi.`;
                    } else {
                        const { stdout } = await execFileAsync('git', ['branch', '-a'], { cwd: workingDirectory, timeout: 5000 });
                        return stdout || "No branches found";
                    }
                } catch (e) {
                    return `Git branch error: ${e.message}`;
                }
            }

            case "start_server": {
                // SEC-FIX: validate the command against the allow-list so the
                // LLM cannot smuggle `; rm -rf $HOME` through the start_server
                // tool (which previously skipped the safety check).
                if (!isBashCommandSafe(args.command || '')) {
                    return "Error: start_server qadağan olunmuş əmri rədd etdi.";
                }
                try {
                    // Kill any existing process on the port first
                    const port = args.port || 3000;
                    try {
                        await execFileAsync('sh', ['-c', `lsof -ti:${port} | xargs kill -9 2>/dev/null`], { cwd: workingDirectory, timeout: 3000 });
                    } catch { /* ignore */ }
                    
                    await new Promise(r => setTimeout(r, 500));
                    
                    const serverProc = spawn('sh', ['-c', args.command], { 
                        cwd: workingDirectory, 
                        detached: true,
                        stdio: ['ignore', 'pipe', 'pipe'],
                        env: { ...process.env, PORT: String(port) }
                    });
                    serverProc.unref();
                    
                    // Capture initial output for debugging
                    let serverOutput = '';
                    serverProc.stdout.on('data', d => serverOutput += d.toString());
                    serverProc.stderr.on('data', d => serverOutput += d.toString());
                    
                    // Wait for port to be ready (max 20s)
                    let ready = false;
                    for (let i = 0; i < 40; i++) {
                        await new Promise(r => setTimeout(r, 500));
                        try {
                            const net = require('net');
                            await new Promise((resolve, reject) => {
                                const socket = new net.Socket();
                                socket.setTimeout(500);
                                socket.on('connect', () => { socket.destroy(); resolve(true); });
                                socket.on('error', () => { socket.destroy(); reject(); });
                                socket.on('timeout', () => { socket.destroy(); reject(); });
                                socket.connect(port, '127.0.0.1');
                            });
                            ready = true;
                            break;
                        } catch { /* ignore */ }
                    }
                    
                    if (ready) {
                        // Auto-open in default browser
                        const openCmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
                        spawn(openCmd, [`http://localhost:${port}`], { detached: true, stdio: 'ignore' }).unref();
                        return `✅ Server işə düşdü: http://localhost:${port}\nBrauzerdə açıldı.`;
                    } else {
                        return `⚠️ Server başladıldı amma port ${port} hələ aktiv deyil.\nOutput: ${serverOutput.slice(0, 1000)}`;
                    }
                } catch (e) {
                    return `Server start error: ${e.message}`;
                }
            }

            case "browser_open": {
                try {
                    const session = await getSession(args.sessionId || 'default', {
                        visible: Boolean(args.visible),
                        slowMoMs: args.slowMoMs,
                        browserChannel: args.browserChannel,
                        executablePath: args.executablePath,
                        cdpUrl: args.cdpUrl,
                        persistent: Boolean(args.persistent),
                        userDataDir: args.userDataDir
                    });
                    await session.page.goto(args.url, {
                        waitUntil: 'domcontentloaded',
                        timeout: 30000
                    });
                    const title = await session.page.title().catch(() => '');
                    return `Browser opened: ${args.url}${title ? `\nTitle: ${title}` : ''}${session.openedVia ? `\nOpened via: ${session.openedVia}` : ''}${session.cdpAttached && session.cdpUrl ? `\nAttached CDP: ${session.cdpUrl}` : ''}${session.visible ? '\nVisible: true' : ''}${session.slowMo ? `\nSlowMo: ${session.slowMo}ms` : ''}${session.browserChannel ? `\nBrowser channel: ${session.browserChannel}` : ''}${session.executablePath ? `\nExecutable: ${session.executablePath}` : ''}${session.persistent ? `\nPersistent profile: ${session.userDataDir}` : ''}${session.launchWarning ? `\nWarning: ${session.launchWarning}` : ''}`;
                } catch (e) {
                    const code = e?.browserLaunchCode ? `\nCode: ${e.browserLaunchCode}` : '';
                    const cdp = e?.cdpUrl ? `\nCDP: ${e.cdpUrl}` : '';
                    const exe = e?.chromePath || e?.executablePath ? `\nExecutable: ${e.chromePath || e.executablePath}` : '';
                    const profile = e?.profileDir || e?.userDataDir ? `\nProfile: ${e.profileDir || e.userDataDir}` : '';
                    return `Browser open error: ${e.message}${code}${cdp}${exe}${profile}`;
                }
            }

            case "browser_click": {
                try {
                    const session = await getSession(args.sessionId || 'default');
                    await session.page.locator(args.selector).first().click({ timeout: 15000 });
                    return `Clicked: ${args.selector}`;
                } catch (e) {
                    return `Browser click error: ${e.message}`;
                }
            }

            case "browser_type": {
                try {
                    const session = await getSession(args.sessionId || 'default');
                    await session.page.locator(args.selector).first().fill(args.text, { timeout: 15000 });
                    return `Typed into: ${args.selector}`;
                } catch (e) {
                    return `Browser type error: ${e.message}`;
                }
            }

            case "browser_screenshot": {
                try {
                    const session = await getSession(args.sessionId || 'default');
                    const outputDir = path.resolve(workingDirectory, 'sandbox', 'browser-shots');
                    await fs.mkdir(outputDir, { recursive: true });
                    const filePath = path.join(outputDir, `shot-${Date.now()}.png`);
                    await session.page.screenshot({
                        path: filePath,
                        fullPage: args.fullPage !== false
                    });
                    return `Screenshot saved: ${filePath}`;
                } catch (e) {
                    return `Browser screenshot error: ${e.message}`;
                }
            }

            case "browser_wait_for": {
                try {
                    const session = await getSession(args.sessionId || 'default');
                    const timeout = Number(args.timeoutMs) > 0 ? Number(args.timeoutMs) : 15000;
                    if (args.selector) {
                        const selectorState = ['visible', 'hidden', 'attached', 'detached'].includes(args.state)
                            ? args.state
                            : 'visible';
                        await session.page.locator(args.selector).first().waitFor({
                            state: selectorState,
                            timeout
                        });
                        return `Wait complete: ${args.selector} (${selectorState})`;
                    }

                    const loadState = ['load', 'domcontentloaded', 'networkidle'].includes(args.state)
                        ? args.state
                        : 'load';
                    await session.page.waitForLoadState(loadState, { timeout });
                    return `Wait complete: page (${loadState})`;
                } catch (e) {
                    return `Browser wait error: ${e.message}`;
                }
            }

            case "browser_eval": {
                try {
                    const session = await getSession(args.sessionId || 'default');
                    const expression = String(args.expression || '').trim();
                    if (!expression) {
                        return 'Browser eval error: expression is required';
                    }
                    const value = await session.page.evaluate(`(() => (${expression}))()`);
                    return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
                } catch (e) {
                    return `Browser eval error: ${e.message}`;
                }
            }

            case "browser_press": {
                try {
                    const session = await getSession(args.sessionId || 'default');
                    const key = String(args.key || '').trim();
                    if (!key) {
                        return 'Browser press error: key is required';
                    }
                    if (args.selector) {
                        const locator = session.page.locator(args.selector).first();
                        await locator.focus({ timeout: 15000 });
                        await locator.press(key, { timeout: 15000 });
                        return `Pressed ${key} on ${args.selector}`;
                    }
                    await session.page.keyboard.press(key);
                    return `Pressed ${key}`;
                } catch (e) {
                    return `Browser press error: ${e.message}`;
                }
            }

            case "browser_scroll": {
                try {
                    const session = await getSession(args.sessionId || 'default');
                    const x = Number.isFinite(Number(args.x)) ? Number(args.x) : 0;
                    const y = Number.isFinite(Number(args.y)) ? Number(args.y) : 600;
                    const to = typeof args.to === 'string' ? args.to : '';
                    if (args.selector) {
                        const locator = session.page.locator(args.selector).first();
                        await locator.evaluate((el, options) => {
                            if (options.to === 'top') {
                                el.scrollTo({ top: 0, behavior: 'auto' });
                                return;
                            }
                            if (options.to === 'bottom') {
                                el.scrollTo({ top: el.scrollHeight, behavior: 'auto' });
                                return;
                            }
                            el.scrollBy(options.x, options.y);
                        }, { x, y, to });
                        return `Scrolled ${args.selector}${to ? ` to ${to}` : ` by (${x}, ${y})`}`;
                    }

                    await session.page.evaluate((options) => {
                        if (options.to === 'top') {
                            window.scrollTo({ top: 0, behavior: 'auto' });
                            return;
                        }
                        if (options.to === 'bottom') {
                            window.scrollTo({ top: document.body.scrollHeight, behavior: 'auto' });
                            return;
                        }
                        window.scrollBy(options.x, options.y);
                    }, { x, y, to });
                    return `Scrolled page${to ? ` to ${to}` : ` by (${x}, ${y})`}`;
                } catch (e) {
                    return `Browser scroll error: ${e.message}`;
                }
            }

            case "browser_extract": {
                try {
                    const session = await getSession(args.sessionId || 'default');
                    const selector = String(args.selector || '').trim();
                    if (!selector) {
                        return 'Browser extract error: selector is required';
                    }
                    const limit = Number.isFinite(Number(args.limit)) && Number(args.limit) > 0
                        ? Math.min(Number(args.limit), 50)
                        : 10;
                    const fields = Array.isArray(args.fields) && args.fields.length > 0
                        ? args.fields
                        : ['text'];
                    const items = await session.page.locator(selector).evaluateAll((elements, options) => {
                        return elements.slice(0, options.limit).map((el) => {
                            const record = {};
                            for (const field of options.fields) {
                                if (field === 'text') record.text = el.textContent?.trim() || '';
                                if (field === 'html') record.html = el.innerHTML || '';
                                if (field === 'href') record.href = el.getAttribute('href') || '';
                                if (field === 'src') record.src = el.getAttribute('src') || '';
                                if (field === 'value') record.value = 'value' in el ? (el.value || '') : '';
                                if (field === 'ariaLabel') record.ariaLabel = el.getAttribute('aria-label') || '';
                            }
                            return record;
                        });
                    }, { limit, fields });
                    return JSON.stringify({
                        selector,
                        count: items.length,
                        items
                    }, null, 2);
                } catch (e) {
                    return `Browser extract error: ${e.message}`;
                }
            }

            case "gui_observe": {
                try {
                    const payload = await inspectGuiState({
                        sessionId: args.sessionId || 'default',
                        workingDirectory,
                        goal: args.goal || '',
                        history: Array.isArray(args.history) ? args.history : []
                    });
                    return JSON.stringify(payload, null, 2);
                } catch (e) {
                    return `GUI observe error: ${e.message}`;
                }
            }

            case "gui_act": {
                try {
                    const payload = await runGuiAction({
                        sessionId: args.sessionId || 'default',
                        workingDirectory,
                        action: args.action || {},
                        history: Array.isArray(args.history) ? args.history : []
                    });
                    return JSON.stringify(payload, null, 2);
                } catch (e) {
                    return `GUI act error: ${e.message}`;
                }
            }

            case "gui_step": {
                try {
                    const payload = await stepGuiAgent({
                        sessionId: args.sessionId || 'default',
                        workingDirectory,
                        goal: args.goal || '',
                        action: args.action || null,
                        history: Array.isArray(args.history) ? args.history : [],
                        autoGround: Boolean(args.autoGround),
                        groundingMode: args.groundingMode || 'prompt_only',
                        minConfidence: Number.isFinite(Number(args.minConfidence)) ? Number(args.minConfidence) : 0.35,
                        grounding: {
                          client,
                          model: effectiveModel
                        }
                    });
                    return JSON.stringify(payload, null, 2);
                } catch (e) {
                    return `GUI step error: ${e.message}`;
                }
            }

            // ─── Screen Agent Tools (TeamViewer-style) ───
            case "screen_open_url": {
                try {
                    const { openUrl } = require('./gui/screen-agent');
                    const result = await openUrl(args.url);
                    // Wait for page to load
                    await new Promise(r => setTimeout(r, 2000));
                    return `✅ URL açıldı real brauzerdə: ${args.url}\nİndi login ola bilərsiniz. Hazır olduqda deyin.`;
                } catch (e) {
                    return `Screen open_url error: ${e.message}`;
                }
            }

            case "screen_screenshot": {
                try {
                    const { takeScreenshot, getScreenInfo } = require('./gui/screen-agent');
                    const shot = await takeScreenshot();
                    const info = await getScreenInfo();
                    return `Screenshot alındı.\nÖlçü: ${info.screen.width}x${info.screen.height}\nMouse: (${info.mouse.x}, ${info.mouse.y})\nFayl: ${shot.path}\n[SCREENSHOT_PATH:${shot.path}]`;
                } catch (e) {
                    return `Screen screenshot error: ${e.message}`;
                }
            }

            case "screen_click": {
                try {
                    const { mouseClick } = require('./gui/screen-agent');
                    const result = await mouseClick(args.x, args.y, { clicks: args.clicks, button: args.button });
                    return `✅ Klik edildi: (${args.x}, ${args.y})${args.clicks > 1 ? ` [${args.clicks}x]` : ''}`;
                } catch (e) {
                    return `Screen click error: ${e.message}`;
                }
            }

            case "screen_type": {
                try {
                    const { typeText } = require('./gui/screen-agent');
                    await typeText(args.text, { useClipboard: args.useClipboard });
                    return `✅ Yazıldı: "${String(args.text || '').slice(0, 50)}"`;
                } catch (e) {
                    return `Screen type error: ${e.message}`;
                }
            }

            case "screen_press": {
                try {
                    const { pressKey } = require('./gui/screen-agent');
                    await pressKey(args.key);
                    return `✅ Düymə basıldı: ${args.key}`;
                } catch (e) {
                    return `Screen press error: ${e.message}`;
                }
            }

            case "screen_scroll": {
                try {
                    const { scroll } = require('./gui/screen-agent');
                    await scroll(args.amount, { x: args.x, y: args.y });
                    return `✅ Scroll edildi: ${args.amount > 0 ? 'yuxarı' : 'aşağı'} (${Math.abs(args.amount)})`;
                } catch (e) {
                    return `Screen scroll error: ${e.message}`;
                }
            }

            case "multi_file_edit": {
                if (!Array.isArray(args.edits)) return "Error: edits must be an array";
                const results = [];
                for (const edit of args.edits) {
                    const filePath = path.resolve(workingDirectory, edit.path);
                    if (!isPathSafe(filePath, workingDirectory, user)) {
                        results.push(`❌ ${edit.path}: Access denied`);
                        continue;
                    }
                    try {
                        const content = await fs.readFile(filePath, 'utf8');
                        if (!content.includes(edit.target_content)) {
                            results.push(`⚠️ ${edit.path}: Target content not found`);
                            continue;
                        }
                        const newContent = content.replace(edit.target_content, edit.replacement_content);
                        await fs.writeFile(filePath, newContent, 'utf8');
                        results.push(`✅ ${edit.path}: Updated`);
                    } catch (e) {
                        results.push(`❌ ${edit.path}: ${e.message}`);
                    }
                }
                return results.join('\n');
            }

            default:
                return `Unknown tool: ${name}`;
        }
    } catch (e) {
        return `Error executing tool: ${e.message}`;
    }
}

// ==========================================
// API Endpoints
// ==========================================

const localDbPath = process.env.LOCAL_DB_PATH
  ? path.resolve(process.env.LOCAL_DB_PATH)
  : path.resolve(__dirname, '../sandbox/local_db.json');

async function readLocalDb() {
  try {
    const data = await fs.readFile(localDbPath, 'utf8');
    const parsed = JSON.parse(data);
    return {
      projects: Array.isArray(parsed.projects) ? parsed.projects : [],
      conversations: Array.isArray(parsed.conversations) ? parsed.conversations : [],
      projectMemories: parsed.projectMemories && typeof parsed.projectMemories === 'object' ? parsed.projectMemories : {},
      settings: parsed.settings && typeof parsed.settings === 'object' ? parsed.settings : {}
    };
  } catch (err) {
    return { projects: [], conversations: [], projectMemories: {}, settings: {} };
  }
}

async function writeLocalDb(dbData) {
  try {
    await fs.mkdir(path.dirname(localDbPath), { recursive: true });
    await fs.writeFile(localDbPath, JSON.stringify(dbData, null, 2), 'utf8');
  } catch (err) {
    console.error("❌ Local DB write failed:", err);
  }
}

app.get('/api/projects', async (req, res) => {
  if (!db.hasDatabase()) {
    try {
      const localDb = await readLocalDb();
      const userId = req.user?.id || 9999;
      const userProjects = localDb.projects.filter(p => p.user_id === userId);
      const userConversations = localDb.conversations.filter(c => c.user_id === userId);
      return res.json({
        projects: userProjects,
        conversations: userConversations
      });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  try {
    const projectsResult = await db.query(
      'SELECT * FROM projects WHERE user_id = $1 ORDER BY created_at DESC',
      [req.user.id]
    );
    const conversationsResult = await db.query(
      'SELECT * FROM conversations WHERE user_id = $1 ORDER BY updated_at DESC',
      [req.user.id]
    );

    res.json({
      projects: projectsResult.rows.map(serializeProject),
      conversations: conversationsResult.rows.map(serializeConversation)
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/projects', async (req, res) => {
  const isLocalMode = !db.hasDatabase();
  const id = req.body.id || crypto.randomUUID();
  const name = req.body.name || 'Yeni layihə';
  const repoUrl = req.body.repoUrl || null;
  const requestedPath = req.body.path || `workspace://${safeSegment(name)}`;
  const resolvedPath = resolveWorkingDirectory(requestedPath, req.user);

  try {
    await ensureDir(resolvedPath);
    
    // Auto-clone repo if URL provided
    if (repoUrl) {
      try {
        let cloneUrl = repoUrl;
        // Inject GitHub token for private repos
        if (cloneUrl.includes('github.com') && req.user?.id) {
          const githubToken = await getUserGithubToken(req.user.id);
          if (githubToken) {
            cloneUrl = injectGithubTokenIntoUrl(cloneUrl, githubToken);
          }
        }
        await new Promise((resolve, reject) => {
          const proc = spawn('git', ['clone', cloneUrl, '.'], { cwd: resolvedPath });
          let stderr = '';
          proc.stderr.on('data', d => stderr += d);
          proc.on('close', (code) => {
            if (code === 0) resolve(true);
            else reject(new Error(stderr || `git clone exit code: ${code}`));
          });
          setTimeout(() => { proc.kill(); reject(new Error('Git clone timeout (60s)')); }, 60000);
        });
        console.log(`✅ Auto-cloned ${repoUrl} into ${resolvedPath}`);
      } catch (cloneErr) {
        console.error(`❌ Auto-clone failed: ${cloneErr.message}`);
        // Don't fail project creation — agent can retry later
      }
    }

    const conversationId = crypto.randomUUID();
    const title = name;

    if (isLocalMode) {
      const localDb = await readLocalDb();
      const userId = req.user?.id || 9999;
      
      const newProject = {
        id,
        user_id: userId,
        name,
        path: requestedPath,
        repo_url: repoUrl,
        last_port: req.body.lastPort || 5173,
        archived: false,
        created_at: new Date().toISOString()
      };
      
      const newConversation = {
        id: conversationId,
        project_id: id,
        user_id: userId,
        title,
        messages: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      
      localDb.projects.push(newProject);
      localDb.conversations.push(newConversation);
      await writeLocalDb(localDb);

      return res.status(201).json({
        project: newProject,
        conversation: newConversation
      });
    }

    const result = await db.query(
      `INSERT INTO projects (id, user_id, name, path, repo_url, last_port)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [id, req.user.id, name, requestedPath, repoUrl, req.body.lastPort || 5173]
    );

    const conversation = await db.query(
      `INSERT INTO conversations (id, project_id, user_id, title, messages)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [conversationId, id, req.user.id, title, JSON.stringify([])]
    );

    res.status(201).json({
      project: serializeProject(result.rows[0]),
      conversation: serializeConversation(conversation.rows[0])
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.patch('/api/projects/:id', async (req, res) => {
  if (!db.hasDatabase()) {
    try {
      const localDb = await readLocalDb();
      const userId = req.user?.id || 9999;
      const index = localDb.projects.findIndex(p => p.id === req.params.id && p.user_id === userId);
      if (index === -1) return res.status(404).json({ error: 'Layihə tapılmadı' });
      
      const project = localDb.projects[index];
      if (req.body.name !== undefined) project.name = req.body.name;
      if (req.body.path !== undefined) project.path = req.body.path;
      if (req.body.repoUrl !== undefined) project.repo_url = req.body.repoUrl;
      if (req.body.lastPort !== undefined) project.last_port = req.body.lastPort;
      if (req.body.archived !== undefined) project.archived = req.body.archived;
      
      await writeLocalDb(localDb);
      return res.json({ project });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  const updates = [];
  const values = [];
  const allowed = {
    name: 'name',
    path: 'path',
    repoUrl: 'repo_url',
    lastPort: 'last_port',
    archived: 'archived'
  };

  for (const [key, column] of Object.entries(allowed)) {
    if (Object.prototype.hasOwnProperty.call(req.body, key)) {
      values.push(req.body[key]);
      updates.push(`${column} = $${values.length}`);
    }
  }

  if (updates.length === 0) {
    return res.status(400).json({ error: 'Dəyişiklik yoxdur' });
  }

  values.push(req.params.id, req.user.id);

  try {
    const result = await db.query(
      `UPDATE projects SET ${updates.join(', ')}
       WHERE id = $${values.length - 1} AND user_id = $${values.length}
       RETURNING *`,
      values
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Layihə tapılmadı' });
    res.json({ project: serializeProject(result.rows[0]) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/projects/:id', async (req, res) => {
  if (!db.hasDatabase()) {
    try {
      const localDb = await readLocalDb();
      const userId = req.user?.id || 9999;
      const initialLength = localDb.projects.length;
      
      localDb.projects = localDb.projects.filter(p => !(p.id === req.params.id && p.user_id === userId));
      localDb.conversations = localDb.conversations.filter(c => !(c.project_id === req.params.id && c.user_id === userId));
      
      if (localDb.projects.length === initialLength) {
        return res.status(404).json({ error: 'Layihə tapılmadı' });
      }
      
      await writeLocalDb(localDb);
      return res.json({ success: true });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  try {
    await db.query('DELETE FROM conversations WHERE project_id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    const result = await db.query('DELETE FROM projects WHERE id = $1 AND user_id = $2 RETURNING id', [req.params.id, req.user.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Layihə tapılmadı' });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/conversations', async (req, res) => {
  if (!db.hasDatabase()) {
    try {
      const localDb = await readLocalDb();
      const userId = req.user?.id || 9999;
      
      const project = localDb.projects.find(p => p.id === req.body.projectId && p.user_id === userId);
      if (!project) return res.status(404).json({ error: 'Layihə tapılmadı' });
      
      const id = req.body.id || crypto.randomUUID();
      const newConversation = {
        id,
        project_id: req.body.projectId,
        user_id: userId,
        title: req.body.title || 'Yeni söhbət',
        messages: req.body.messages || [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      
      localDb.conversations.push(newConversation);
      await writeLocalDb(localDb);
      return res.status(201).json({ conversation: newConversation });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  const projectCheck = await db.query(
    'SELECT id FROM projects WHERE id = $1 AND user_id = $2',
    [req.body.projectId, req.user.id]
  );
  if (projectCheck.rows.length === 0) {
    return res.status(404).json({ error: 'Layihə tapılmadı' });
  }

  try {
    const id = req.body.id || crypto.randomUUID();
    const result = await db.query(
      `INSERT INTO conversations (id, project_id, user_id, title, messages)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [id, req.body.projectId, req.user.id, req.body.title || 'Yeni söhbət', JSON.stringify(req.body.messages || [])]
    );
    res.status(201).json({ conversation: serializeConversation(result.rows[0]) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.patch('/api/conversations/:id', async (req, res) => {
  if (!db.hasDatabase()) {
    try {
      const localDb = await readLocalDb();
      const userId = req.user?.id || 9999;
      const index = localDb.conversations.findIndex(c => c.id === req.params.id && c.user_id === userId);
      if (index === -1) return res.status(404).json({ error: 'Söhbət tapılmadı' });
      
      const conversation = localDb.conversations[index];
      if (req.body.title !== undefined) conversation.title = req.body.title;
      if (req.body.messages !== undefined) conversation.messages = req.body.messages;
      conversation.updated_at = new Date().toISOString();
      
      await writeLocalDb(localDb);
      return res.json({ conversation });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  try {
    const result = await db.query(
      `UPDATE conversations
       SET title = COALESCE($1, title),
           messages = COALESCE($2, messages),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $3 AND user_id = $4
       RETURNING *`,
      [
        req.body.title ?? null,
        req.body.messages ? JSON.stringify(req.body.messages) : null,
        req.params.id,
        req.user.id
      ]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Söhbət tapılmadı' });
    res.json({ conversation: serializeConversation(result.rows[0]) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/conversations/:id', async (req, res) => {
  if (!db.hasDatabase()) {
    try {
      const localDb = await readLocalDb();
      const userId = req.user?.id || 9999;
      const initialLength = localDb.conversations.length;
      
      localDb.conversations = localDb.conversations.filter(c => !(c.id === req.params.id && c.user_id === userId));
      
      if (localDb.conversations.length === initialLength) {
        return res.status(404).json({ error: 'Söhbət tapılmadı' });
      }
      
      await writeLocalDb(localDb);
      return res.json({ success: true });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  try {
    const result = await db.query('DELETE FROM conversations WHERE id = $1 AND user_id = $2 RETURNING id', [req.params.id, req.user.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Söhbət tapılmadı' });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/attachments/extract', async (req, res) => {
  // Set a longer timeout for attachment processing (3 minutes)
  req.setTimeout(180000);
  res.setTimeout(180000);
  
  try {
    const attachments = Array.isArray(req.body.attachments) ? req.body.attachments : [];
    const extracted = [];

    // Process attachments with individual timeout (30s per attachment)
    for (const attachment of attachments) {
      let item;
      try {
        item = await Promise.race([
          extractAttachment(attachment),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Attachment emalı vaxtı bitdi (30s)')), 30000))
        ]);
      } catch (error) {
        item = {
          name: attachment?.name || 'attachment',
          mimeType: attachment?.mimeType || attachment?.type || 'application/octet-stream',
          extractedText: '',
          extractionError: error?.message || 'Attachment emal edilə bilmədi'
        };
      }
      extracted.push({
        id: attachment.id || crypto.randomUUID(),
        name: item.name,
        mimeType: item.mimeType,
        extractedText: item.extractedText?.slice(0, 50000) || '',
        imageUrl: item.imageUrl,
        extractionError: item.extractionError
      });
    }

    res.json({ attachments: extracted });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/browser-shot', async (req, res) => {
  const requestedPath = String(req.query.path || '');
  const workingDirectory = String(req.query.workingDirectory || '');
  const resolvedWD = resolveWorkingDirectory(workingDirectory, req.user);
  const resolvedPath = mapPath(requestedPath, workingDirectory, resolvedWD);

  if (!requestedPath) {
    return res.status(400).json({ error: 'path required' });
  }

  if (!isPathSafe(resolvedPath, workingDirectory, req.user)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  if (!/\.png$/i.test(resolvedPath)) {
    return res.status(400).json({ error: 'Only PNG screenshots are supported' });
  }

  try {
    await fs.access(resolvedPath);
    res.sendFile(resolvedPath);
  } catch (e) {
    res.status(404).json({ error: e.message });
  }
});

app.get('/api/browsers', async (req, res) => {
  const installed = listInstalledBrowsers();
  res.json({
    browsers: installed,
    cdpUrl: process.env.GUI_BROWSER_CDP_URL || '',
    recommendedMode: getRecommendedGuiBrowserMode({
      installedBrowsers: installed,
      cdpUrl: process.env.GUI_BROWSER_CDP_URL || ''
    })
  });
});

app.post('/api/task-plan', async (req, res) => {
  const { prompt, workingDirectory } = req.body;
  const resolvedWD = resolveWorkingDirectory(workingDirectory, req.user);
  try {
    const files = await fs.readdir(resolvedWD);
    const likelyFiles = files.slice(0, 20);
    const plan = [
      { id: crypto.randomUUID(), title: 'Konteksti oxu', detail: `Layihə qovluğu: ${resolvedWD}`, status: 'pending' },
      { id: crypto.randomUUID(), title: 'Oxunacaq fayllar', detail: likelyFiles.join(', ') || 'Fayl tapılmadı', status: 'pending' },
      { id: crypto.randomUUID(), title: 'Dəyişiklikləri hazırla', detail: 'Planlanan patch və diff preview yaradılacaq', status: 'pending' },
      { id: crypto.randomUUID(), title: 'Yoxlama', detail: 'build/lint/test/health check icra ediləcək', status: 'pending' }
    ];
    res.json({ prompt: prompt || '', workingDirectory: resolvedWD, plan });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/diff/preview', async (req, res) => {
  const { path: reqPath, workingDirectory, newContent } = req.body;
  const resolvedWD = resolveWorkingDirectory(workingDirectory, req.user);
  const resolvedPath = mapPath(reqPath, workingDirectory, resolvedWD);
  if (!isPathSafe(resolvedPath, workingDirectory, req.user)) {
    return res.status(403).json({ error: 'Access denied' });
  }
  try {
    const oldContent = await fs.readFile(resolvedPath, 'utf8');
    const diff = makeUnifiedDiff(oldContent, String(newContent || ''), reqPath || resolvedPath);
    res.json({ diff, oldContent, newContent: String(newContent || '') });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/diff/apply', async (req, res) => {
  const { path: reqPath, workingDirectory, newContent } = req.body;
  const resolvedWD = resolveWorkingDirectory(workingDirectory, req.user);
  const resolvedPath = mapPath(reqPath, workingDirectory, resolvedWD);
  if (!isPathSafe(resolvedPath, workingDirectory, req.user)) {
    return res.status(403).json({ error: 'Access denied' });
  }
  try {
    await fs.writeFile(resolvedPath, String(newContent || ''), 'utf8');
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/terminal/run', async (req, res) => {
  const { command, workingDirectory } = req.body;
  const resolvedWD = resolveWorkingDirectory(workingDirectory, req.user);
  if (!isBashCommandSafe(command || '')) {
    return res.status(400).json({ error: 'Command blocked for safety' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const result = await runStreamingCommand(command, resolvedWD, (stream, chunk) => {
    res.write(`data: ${JSON.stringify({ type: 'terminal_line', stream, chunk })}\n\n`);
  });
  res.write(`data: ${JSON.stringify({ type: 'terminal_done', ...result })}\n\n`);
  res.end();
});

app.post('/api/project-health', async (req, res) => {
  const { workingDirectory } = req.body;
  const resolvedWD = resolveWorkingDirectory(workingDirectory, req.user);
  const commands = [
    { key: 'build', cmd: 'npm run build' },
    { key: 'lint', cmd: 'npm run lint' },
    { key: 'deps', cmd: 'npm outdated --depth=0 || true' },
    { key: 'port', cmd: 'node -e "require(\'net\').createConnection({port:3001,host:\'127.0.0.1\'}).on(\'connect\',()=>{console.log(\'OPEN\');process.exit(0)}).on(\'error\',()=>{console.log(\'CLOSED\');process.exit(0)})"' },
    { key: 'health', cmd: 'curl -sS -m 3 http://localhost:3001/api/auth/config || true' }
  ];

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  for (const item of commands) {
    res.write(`data: ${JSON.stringify({ type: 'health_step', key: item.key, status: 'running', command: item.cmd })}\n\n`);
    const result = await runStreamingCommand(item.cmd, resolvedWD, (stream, chunk) => {
      res.write(`data: ${JSON.stringify({ type: 'health_log', key: item.key, stream, chunk })}\n\n`);
    });
    res.write(`data: ${JSON.stringify({ type: 'health_step', key: item.key, status: result.code === 0 ? 'done' : 'failed', exitCode: result.code })}\n\n`);
  }
  res.write(`data: ${JSON.stringify({ type: 'health_done' })}\n\n`);
  res.end();
});

app.get('/api/project-memory/:projectId', async (req, res) => {
  if (!db.hasDatabase()) {
    try {
      const localDb = await readLocalDb();
      const memory = localDb.projectMemories[req.params.projectId] || {};
      return res.json({ memory });
    } catch {
      return res.json({ memory: {} });
    }
  }
  try {
    const result = await db.query(
      'SELECT memory FROM project_memories WHERE project_id = $1 AND user_id = $2',
      [req.params.projectId, req.user.id]
    );
    res.json({ memory: result.rows[0]?.memory || {} });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/project-memory/:projectId', async (req, res) => {
  if (!db.hasDatabase()) {
    try {
      const localDb = await readLocalDb();
      const memory = req.body?.memory || {};
      localDb.projectMemories[req.params.projectId] = memory;
      await writeLocalDb(localDb);
      return res.json({ success: true });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }
  try {
    const memory = req.body?.memory || {};
    await db.query(
      `INSERT INTO project_memories (project_id, user_id, memory, updated_at)
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
       ON CONFLICT (project_id) DO UPDATE
       SET memory = EXCLUDED.memory, updated_at = CURRENT_TIMESTAMP`,
      [req.params.projectId, req.user.id, JSON.stringify(memory)]
    );
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/approvals/:id', async (req, res) => {
  const pending = getInteraction(req.params.id);
  if (!pending) return res.status(404).json({ error: 'Approval tapılmadı' });
  if (pending.userId !== req.user.id) return res.status(403).json({ error: 'Access denied' });
  const decision = req.body?.decision === 'approve' ? 'approved' : 'rejected';

  // Agent loop-u oyandır
  if (pending._resolve) {
    pending._resolve(decision);
  }

  // Map-dan təmizlə
  deleteInteraction(req.params.id);

  res.json({ success: true, status: decision });
});

app.post('/api/checkpoints/:id', async (req, res) => {
  const resolved = resolveCheckpoint(req.params.id, req.body?.decision === 'resume' ? 'resume' : 'cancel');
  if (!resolved) return res.status(404).json({ error: 'Checkpoint tapılmadı' });
  if (resolved.userId !== req.user.id) return res.status(403).json({ error: 'Access denied' });

  if (resolved.kind === 'login' && resolved.workflow === 'gui') {
    const orchestration = resolveOrchestrationConfig(true, 'gui', 'login oldum');
    const runManager = createRunManager(orchestration, crypto.randomUUID());
    return handleGuiLoginCheckpointAction({
      res,
      checkpoint: resolved,
      orchestration,
      runManager,
      resolvedWD: resolveWorkingDirectory(req.body?.workingDirectory, req.user),
      reqUser: req.user,
      handleToolCall,
      normalizeUserFacingError
    });
  }

  return res.json({ success: true, status: resolved.decision });
});

app.get('/api/interactions', async (req, res) => {
  const items = listInteractionsByUser(req.user?.id).map((item) => ({
    id: item.id,
    kind: item.kind,
    createdAt: item.createdAt,
    approval: item.kind === 'approval' ? {
      approvalId: item.id,
      tool: item.toolCall?.function?.name || '',
      args: item.toolCall?.function?.arguments || '{}',
      conversationId: item.conversationId,
      runId: item.runId,
      phaseRole: item.phaseRole,
      expiresAt: item.expiresAt,
      meta: item.meta
    } : undefined,
    checkpoint: item.kind === 'checkpoint' ? {
      id: item.id,
      kind: item.kind,
      workflow: item.workflow,
      sessionId: item.sessionId,
      conversationId: item.conversationId,
      runId: item.runId,
      phaseRole: item.phaseRole,
      expiresAt: item.expiresAt,
      title: item.title || 'Checkpoint',
      message: item.message || '',
      resumePrompt: item.resumePrompt || '',
      cancelPrompt: item.cancelPrompt,
      resumeLabel: item.resumeLabel,
      cancelLabel: item.cancelLabel
    } : undefined
  }));
  res.json({ interactions: items });
});

app.post('/api/tts', async (req, res) => {
  const { text, voiceId = process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM' } = req.body;
  const apiKey = process.env.ELEVENLABS_API_KEY;

  if (!apiKey) {
    return res.status(400).json({ error: "ElevenLabs API Key not configured. Using browser fallback." });
  }

  try {
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        'accept': 'audio/mpeg'
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_multilingual_v2',
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75
        }
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`ElevenLabs error: ${response.status} - ${errText}`);
    }

    res.setHeader('Content-Type', 'audio/mpeg');
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    res.send(buffer);
  } catch (error) {
    console.error("ElevenLabs TTS error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/conversation-token', async (req, res) => {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const agentId = process.env.ELEVENLABS_AGENT_ID;

  if (!apiKey || !agentId) {
    return res.status(400).json({ error: "ElevenLabs API Key or Agent ID not configured." });
  }

  try {
    const response = await fetch(
      `https://api.elevenlabs.io/v1/convai/conversation/token?agent_id=${agentId}`,
      {
        method: 'GET',
        headers: {
          'xi-api-key': apiKey
        }
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`ElevenLabs token error: ${response.status} - ${errText}`);
    }

    const body = await response.json();
    res.json({ token: body.token });
  } catch (error) {
    console.error("ElevenLabs conversation token error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/signed-url', async (req, res) => {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const agentId = process.env.ELEVENLABS_AGENT_ID;

  if (!apiKey || !agentId) {
    return res.status(400).json({ error: "ElevenLabs API Key or Agent ID not configured." });
  }

  try {
    const response = await fetch(
      `https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${agentId}`,
      {
        method: 'GET',
        headers: {
          'xi-api-key': apiKey
        }
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`ElevenLabs signed-url error: ${response.status} - ${errText}`);
    }

    const body = await response.json();
    res.json({ signedUrl: body.signed_url });
  } catch (error) {
    console.error("ElevenLabs signed-url error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/chat', async (req, res) => {
    const {
      messages,
      apiKey,
      model,
      workingDirectory,
      baseUrl,
      projectId,
      conversationId,
      safeMode = true,
      orchestrationMode = false,
      workflow = 'default',
      guiBrowserMode = 'cdp',
      guiBrowserPath = '',
      guiBrowserCdpUrl = ''
    } = req.body;

    const lastUserMsgForQueue = Array.isArray(messages)
      ? [...messages].reverse().find((m) => m.role === 'user')
      : null;
    const latestUserTextForQueue = String(lastUserMsgForQueue?.content || '');
    const isGuiFastPathRequest = workflow === 'gui' && (
      isGuiLoginCheckpointRequest(latestUserTextForQueue) ||
      isGuiLoginResumeRequest(latestUserTextForQueue) ||
      isGuiObserveSelfTestRequest(latestUserTextForQueue)
    );

    let slotAcquired = false;
    if (!isGuiFastPathRequest) {
      try {
        const superseded = supersedeConversation(req.user?.id, conversationId);
        if (superseded) {
          console.log(`🔁 Superseded active chat for conversation=${String(conversationId || 'default')}`);
        }
        await acquireChatSlotQueued(req.user?.id, conversationId, req);
        slotAcquired = true;
      } catch (queueErr) {
        res.setHeader('Retry-After', '5');
        const isQueueTimeout = queueErr?.message === 'Queue timeout';
        const isClientDisconnect = queueErr?.message === 'Client disconnected while waiting in queue';
        const msg = isQueueTimeout
          ? 'Bu söhbətdə əvvəlki sorğu hələ davam edir. Bir neçə saniyə gözləyin.'
          : isClientDisconnect
            ? 'Əvvəlki sorğu bağlandığı üçün bu sorğu növbədən çıxdı.'
            : 'Sorğu növbəyə alına bilmədi. Yenidən cəhd edin.';
        return res.status(409).json({
          error: msg,
          code: isQueueTimeout ? 'CHAT_QUEUE_BUSY' : (isClientDisconnect ? 'CHAT_QUEUE_DISCONNECTED' : 'CHAT_QUEUE_FAILED')
        });
      }
    }
    
    // SEC-1: Verify workingDirectory against ALLOWED_DIRS
    let resolvedWD = resolveWorkingDirectory(workingDirectory, req.user);
    
    // --- Hardcoded Fallback Redirect for weak models ---
    let userPathMatch = null;
    // SEC-FIX: removed `fs.writeFileSync('debug_messages.json', ...)` which
    // dumped every chat (with attachments and possibly secrets) to the project
    // root on every request.
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user' || messages[i].role === 'system') {
        let textContent = messages[i].content;
        if (Array.isArray(textContent)) {
           // Handle case where content is an array (multimodal)
           textContent = textContent.map(c => c.text || '').join('\n');
        }
        if (typeof textContent === 'string') {
          const match = textContent.match(/(\/(?:Users|home|opt|usr|var|tmp|etc)[\/\w\.-]+)/i);
          if (match) {
            userPathMatch = match;
            break;
          }
        }
      }
    }
    if (userPathMatch && isLocalMode()) {
      resolvedWD = path.resolve(userPathMatch[1]);
      console.log(`🚀 HARDCODE REDIRECT: Overriding working directory to user path -> ${resolvedWD}`);
    }
    // ---------------------------------------------------

    if (!isWorkingDirectoryAllowed(resolvedWD)) {
        return res.status(403).json({ error: "Unauthorized working directory" });
    }
    // We do not ensureDir for user absolute paths because they already exist and we shouldn't create them if they don't
    if (!userPathMatch) {
       await ensureDir(resolvedWD);
    }

    const frontendApiKey = typeof apiKey === 'string' ? apiKey.trim() : '';
    const frontendBaseUrl = (typeof baseUrl === 'string' ? baseUrl.trim() : '') || process.env.OPENAI_BASE_URL || "https://openrouter.ai/api/v1";
    const frontendModel = model || process.env.OPENAI_MODEL || 'qwen/qwen3-coder:free';

    // FUNC-FIX: classify the LATEST user message for the new "auto" model so
    // we can pick fast/local vs smart/cloud automatically.
    const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
    const latestUserText = String(lastUserMsg?.content || '');
    const pendingGuiLoginCheckpoint = listInteractionsByUser(req.user?.id).find((item) => (
      item.kind === 'checkpoint' &&
      item.workflow === 'gui' &&
      item.sessionId &&
      (!conversationId || !item.conversationId || String(item.conversationId) === String(conversationId))
    ));
    const shouldForceGuiResume = isGuiLoginResumeRequest(latestUserText) && Boolean(pendingGuiLoginCheckpoint);
    const effectiveWorkflow = shouldForceGuiResume ? 'gui' : workflow;
    const autoIntent = classifyTaskComplexity({
      userMessage: lastUserMsg?.content || '',
      messageHistoryLen: messages.length,
      hasAttachments: Array.isArray(lastUserMsg?.attachments) && lastUserMsg.attachments.length > 0
    });
    const earlyOrchestration = resolveOrchestrationConfig(orchestrationMode, effectiveWorkflow, latestUserText);

    if (earlyOrchestration.workflow === 'gui' && isGuiLoginResumeRequest(latestUserText)) {
      const runManager = createRunManager(earlyOrchestration, crypto.randomUUID());
      await handleGuiLoginResume({
        res,
        orchestration: earlyOrchestration,
        runManager,
        resolvedWD,
        reqUser: req.user,
        checkpoint: pendingGuiLoginCheckpoint,
        latestUserText,
        handleToolCall,
        normalizeUserFacingError
      });
      return;
    }

    if (earlyOrchestration.workflow === 'gui' && isGuiLoginCheckpointRequest(latestUserText)) {
      const runManager = createRunManager(earlyOrchestration, crypto.randomUUID());
      await handleGuiLoginCheckpoint({
        res,
        orchestration: earlyOrchestration,
        runManager,
        resolvedWD,
        conversationId,
        reqUser: req.user,
        handleToolCall,
        normalizeUserFacingError,
        browserOpenArgs: buildGuiBrowserOpenArgs({
          url: 'https://www.wix.com',
          sessionId: 'gui-wix-live',
          guiBrowserMode,
          guiBrowserPath,
          guiBrowserCdpUrl,
          defaultCdpUrl: process.env.GUI_BROWSER_CDP_URL || 'http://127.0.0.1:9222',
          fallbackChromePath: findInstalledChromePath()
        }),
        createCheckpoint
      });
      return;
    }

    if (earlyOrchestration.workflow === 'gui' && isGuiObserveSelfTestRequest(latestUserText)) {
      const runManager = createRunManager(earlyOrchestration, crypto.randomUUID());
      await handleGuiSelfTest({
        res,
        orchestration: earlyOrchestration,
        runManager,
        resolvedWD,
        reqUser: req.user,
        handleToolCall,
        normalizeUserFacingError,
        browserOpenArgs: buildGuiBrowserOpenArgs({
          url: 'https://example.com',
          sessionId: 'gui-self-test',
          guiBrowserMode,
          guiBrowserPath,
          guiBrowserCdpUrl,
          defaultCdpUrl: process.env.GUI_BROWSER_CDP_URL || 'http://127.0.0.1:9222',
          fallbackChromePath: findInstalledChromePath()
        })
      });
      return;
    }

    const providerCandidates = buildProviderCandidates({
      frontendApiKey,
      frontendBaseUrl,
      frontendModel,
      autoIntent,
      env: process.env,
      parseProviderPoolFromEnv,
      looksLikeOllamaModel
    });

    if (providerCandidates.length === 0) {
        return res.status(400).json({
            error: "Süni İntellekt API Açarı tapılmadı! Layihəni lokalda (Railway-dən asılı olmadan) işlətmək üçün layihə qovluğundakı `.env` faylına OPENAI_API_KEY və OPENAI_BASE_URL açarlarını əlavə edin."
        });
    }
    let activeProvider = providerCandidates.find((p) => providerRuntime.canUseProviderNow(p.id)) || providerCandidates[0];
    let client = buildOpenAIClient(activeProvider);
    let effectiveModel = activeProvider.model;
    console.log(`🤖 /api/chat | provider_candidates=${providerCandidates.length} | active=${activeProvider.id} | model=${effectiveModel}${frontendModel === 'auto' ? ` | auto_intent=${autoIntent}` : ''}`);

    // FUNC-FIX: pending event — emitted once SSE headers are written below.
    const pendingAutoRouteEvent = frontendModel === 'auto'
      ? { type: 'auto_route', intent: autoIntent, chosenModel: effectiveModel, providerId: activeProvider.id }
      : null;

    const providerLooksLocal =
      String(activeProvider.baseURL || '').includes('localhost') ||
      String(activeProvider.baseURL || '').includes('127.0.0.1') ||
      String(activeProvider.baseURL || '').includes('11434') ||
      String(activeProvider.baseURL || '').includes('1234');
    const isLocalOrFlakyModel =
      providerLooksLocal ||
      !effectiveModel ||
      /qwen|ollama|llama|local|nemotron/i.test(effectiveModel);

    const auditStyleRequest = isAuditStyleRequest(latestUserText);

    let sysPrompt = `Sən bahAI İDE rəsmi və peşəkar AI Kodlaşdırma Agentisən. Project Root: ${resolvedWD}.
Sən dünya səviyyəli proqramçı, sistem memarı və UI/UX ekspertisən. Qwen 2.5 Coder modelləri üçün xüsusi olaraq optimallaşdırılmısan.

🎯 MƏQSƏD VƏ MƏNTİQ:
Sənin əsas məqsədin kod bazasını mükəmməl analiz etmək, 100% işlək, istehsalata hazır (production-ready) kodlar yazmaq və layihədəki problemləri dərhal həll etməkdir.

🧠 DÜŞÜNCƏ ZƏNCİRİ (CHAIN OF THOUGHT):
- Fəaliyyətlərini "Analiz edirəm -> Plan qururam -> Kodu tətbiq edirəm -> Yoxlayıram" zənciri ilə qur.

🛠️ KOD KEYFİYYƏTİ VƏ DAXİLİ QAYDALAR:
1. LAYİHƏNİ TƏHLİL ET:
   - Layihə faylları artıq sənin "Project Root" qovluğundadır (${resolvedWD}). Kodu audit etmək üçün qətiyyən \`git_clone\` ALƏTİNİ ÇAĞIRMA. Birbaşa \`list_directory\` və \`read_file\` alətlərindən istifadə edərək mövcud faylları oxu və audit et.
   - Əgər istifadəçi kodu kompyuterə yükləmədən birbaşa GitHub üzərindən (onlayn) oxumaq istəyirsə, \`github_list_contents\` və \`github_read_file\` alətlərindən istifadə et.
   - Kodu dəyişməzdən əvvəl mütləq \`glob_search\`, \`grep_search\` və ya \`read_file\` ilə hədəf kod hissəsini oxu. Kor-koranə kod yazma!
2. DƏQİQ REDAKTƏ:
   - Dəyişiklik etdikdə \`file_edit\` çağırışında hədəf mətni EXACTLY (eyniylə) uyğunlaşdır. Sintaksis xətalarına yol vermə!
3. YALNIZ TAM VƏ İŞLƏK KOD:
   - Heç vaxt kod daxilində placeholder (məsələn: \`// implement later\`) istifadə etmə. Bütün kodu tam, işlək yaz.
4. LİVE PREVIEW:
   - \`start_server\` alətini çağırdıqdan sonra dərhal dayanın və "Server başladıldı!" deyib dayanın.

Azərbaycan dilində, peşəkar, aydın və dostyana bir proqramçı tonunda cavab ver.`;

    if (auditStyleRequest) {
      sysPrompt += `

AUDIT REJİMİ:
- İstifadəçi audit istəyirsə, əvvəlcə kodu oxu və konkret findings ver.
- Düzəlişə keçməzdən əvvəl istifadəçidən təsdiq gözlə, əgər o hələ düzəltməyi istəməyibsə.
- "Xəta var, istəsən düzəldim" kimi ümumi və boş cümlə yazma. Konkret fayl, risk və səbəb göstər.
- Əgər hələ fayl oxumamısansa, problem uydurma. Əvvəl tool ilə oxu, sonra danış.
- Audit cavabında prioritet findings-first olsun, sonra qısa yekun ver.`;
    }

    // Screen Agent capabilities — compact version for token-limited APIs
    sysPrompt += `

🖥️ EKRAN AGENTI:
Sən ekranı görüb mouse/keyboard idarə edə bilirsən. Browser açma — istifadəçi özü açar.

ALƏTLƏR: screen_screenshot, screen_click(x,y), screen_type(text), screen_press(key), screen_scroll(amount), screen_open_url(url)

QAYDALAR:
- "Ekrana bax" desə → screen_screenshot çağır
- Klik etməzdən əvvəl icazə al
- Publish/Delete/Payment düymələrinə HEÇ VAXT toxunma`;

    if (isLocalOrFlakyModel) {
       // FUNC-FIX: previous prompt was 700+ lines of "QƏTİ QADAĞANDIR" rules
       // which weak local models (Gemma/Qwen 7B) couldn't follow and ended up
       // hallucinating "I can't do this". Replaced with a tight, example-led
       // prompt that mirrors how Claude Code / Cursor system-prompt their
       // local fallbacks.
       sysPrompt = `Sən bahAI — Azərbaycan dilində danışan AI proqramçı agentisən.
Layihənin yolu: ${resolvedWD}

QAYDALAR:
1. Sən faylları oxuya, yaza və terminal əmrlərini icra edə bilirsən. Heç vaxt "edə bilmərəm" demə.
2. Fayl oxumaq və qovluq görmək üçün TOOL CALL et — söz vermə.
3. Cavabın HƏMİŞƏ Azərbaycan dilində olsun. JSON formatında istifadəçiyə cavab vermə (yalnız tool call üçün JSON).
4. Hər tool call-dan sonra qısa izah yaz: nə etdiyin və növbəti addım.
5. Sual aydın deyilsə, ÖZ bildiyin ən məntiqli interpretasiyaya əməl et — soruşma.
6. Uydurma nəticə yazma. Faylı oxumadan "xəta tapdım", "src tapdım", "problem var" kimi danışmaq qadağandır.
7. "read_file alətini JSON formatında çağırın" kimi istifadəçiyə tool təlimatı vermə. Tool-u özün çağır.
8. Heç vaxt \`{"response":"..."}\` və ya buna bənzər saxta cavab formatı yaratma.
9. Əgər istifadəçi audit istəyirsə, əvvəl findings ver, düzəltməyə icazə istəmədən keçmə.
10. Əgər path boş və ya yanlış görünürsə, bunu qısa və peşəkar de; kobud və qeyri-professional cümlə qurma.

CAVAB FORMATI:
- Tool çağırışı üçün: tək JSON blok (aşağıdakı format).
- İstifadəçiyə son cavab üçün: adi Markdown mətn (kod blokları + izah).`;

      if (auditStyleRequest) {
        sysPrompt += `

AUDIT REJİMİ:
- Əvvəl list_directory / read_file ilə fakt topla.
- Son cavabda konkret findings yaz: fayl, problem, risk.
- İstifadəçi "mənimlə paylaş" və ya "əvvəl göstər" deyirsə, yalnız findings paylaş; kodu dəyişmə.`;
      }
    }

    let modelMessages = [];
    try {
      modelMessages = await normalizeMessagesForModel(messages, effectiveModel);
    } catch (error) {
      console.error('/api/chat normalize xətası:', error?.message || error);
      modelMessages = Array.isArray(messages) ? messages : [];
    }
    let projectMemory = {};
    if (db.hasDatabase() && projectId) {
      try {
        const memoryResult = await db.query(
          'SELECT memory FROM project_memories WHERE project_id = $1 AND user_id = $2',
          [projectId, req.user.id]
        );
        projectMemory = memoryResult.rows[0]?.memory || {};
      } catch {
        projectMemory = {};
      }
    }

    let fullSysPrompt = sysPrompt;
      
    const hasAttachmentInRequest = Array.isArray(messages) && messages.some((m) => Array.isArray(m?.attachments) && m.attachments.length > 0);
    const orchestration = resolveOrchestrationConfig(orchestrationMode, workflow, latestUserText);
    const runId = crypto.randomUUID();
    const runManager = createRunManager(orchestration, runId);
    const initialRole = runManager.currentPhase()?.role || orchestration.agents?.[0] || 'Solo Agent';
    const initialTools = getToolsForRole(initialRole, orchestration.toolProfile);
    if (isLocalOrFlakyModel) {
      fullSysPrompt += generateToolsSystemPrompt(initialTools);
    }

    const repoProfilePrompt = projectMemory?.repoProfile
      ? `Repo Profili: ${JSON.stringify(projectMemory.repoProfile)}`
      : '';
    const validationHintPrompt = projectMemory?.repoProfile
      ? buildValidationHint(projectMemory.repoProfile)
      : '';
    const executionMemoryHint = buildExecutionMemoryHint(projectMemory);
    const tokenDisciplinePrompt = orchestration?.routing?.tokenDiscipline
      ? `Token büdcəsi: ${JSON.stringify(orchestration.routing.tokenDiscipline)}`
      : '';
    const memoryPrompt = `Layihə yaddaşı: ${JSON.stringify(projectMemory)}${repoProfilePrompt ? `\n${repoProfilePrompt}` : ''}${executionMemoryHint ? `\n${executionMemoryHint}` : ''}${tokenDisciplinePrompt ? `\n${tokenDisciplinePrompt}` : ''}`;
    const apiMessages = [{ role: 'system', content: `${fullSysPrompt}\n${memoryPrompt}${validationHintPrompt ? `\n${validationHintPrompt}` : ''}` }, ...modelMessages];
    
    if (isLocalOrFlakyModel) {
      apiMessages.push({
        role: 'system',
        content: "XATIRLATMA: Sən birbaşa faylları oxuya, dəyişə və command icra edə bilən AI kodlaşdırma agentisən. MÜTLƏQ verilmiş JSON tool (read_file, grep_search, list_directory, və s.) çağırışlarını istifadə et. Qətiyyən xəyalından uydurma (məsələn, 'faylı oxudum, xəta tapdım' demə)! Real faylları oxumaq üçün mütləq JSON çağırışı et! İstifadəçiyə tool necə çağırılmalıdır deyə təlimat yazma; tool-u özün çağır."
      });
    }

    if (auditStyleRequest) {
      apiMessages.push({
        role: 'system',
        content: `İstifadəçi bütün layihə qovluğunu audit etməyini istəyir, tək fayl soruşmur. Birinci addımda mütləq \`list_directory\` və ya \`analyze_codebase\` ilə Project Root (${resolvedWD}) üzrə audit başlat. İstifadəçidən "hansı faylı oxuyum?" deyə soruşma.`
      });
    }

    initSse(res);
    emitOrchestrationPrelude(res, {
      runId,
      orchestration,
      runManager,
      pendingAutoRouteEvent
    });
    const activeProviderRef = { current: activeProvider };
    const clientRef = { current: client };
    const effectiveModelRef = { current: effectiveModel };
    const llmTimeoutMs = parseInt(process.env.LLM_TIMEOUT_MS || '180000', 10);

    try {
      await runChatSession({
        req,
        res,
        slotAcquired,
        conversationId,
        runManager,
        orchestration,
        resolvedWD,
        latestUserText,
        auditStyleRequest,
        projectMemory,
        apiMessages,
        emitTaskPlan,
        writeSse,
        createPhaseContext: ({ currentMessages, runManager, orchestration, resolvedWD, auditStyleRequest, projectMemory }) => {
          const activePhase = runManager.currentPhase();
          const phaseTools = getToolsForRole(activePhase?.role, orchestration.toolProfile);
          const roleInstruction = buildRoleInstruction(activePhase?.role, {
            workflow: orchestration.workflow,
            projectRoot: resolvedWD,
            auditStyleRequest,
            repoProfile: projectMemory?.repoProfile || null,
            executionMemory: {
              lastValidation: projectMemory?.lastValidation || null,
              lastApprovalDecision: projectMemory?.lastApprovalDecision || null
            },
            tokenDiscipline: orchestration?.routing?.tokenDiscipline || null
          });
          currentMessages.push({
            role: 'system',
            content: roleInstruction
          });
          if (activePhase?.role === 'Planner') {
            currentMessages.push({
              role: 'system',
              content: buildPlannerArtifactPrompt()
            });
          }
          const plannerArtifactContext = buildPlannerArtifactContext(runManager.getPlannerArtifact());
          const executionArtifactContext = buildExecutionArtifactContext(runManager.getExecutionArtifacts());
          if (plannerArtifactContext && activePhase?.role !== 'Planner') {
            currentMessages.push({
              role: 'system',
              content: `${plannerArtifactContext}\nBu artifact-i əsas input kimi istifadə et.`
            });
          }
          if (executionArtifactContext && activePhase?.role !== 'Planner') {
            currentMessages.push({
              role: 'system',
              content: `${executionArtifactContext}\nƏvvəlki icra izlərini də nəzərə al.`
            });
          }
          return {
            currentMessages,
            activePhase,
            phaseTools
          };
        },
        openAiStreamWithFallback,
        collectStreamOutput,
        executeToolCalls,
        extractPlannerArtifact,
        buildExecutionArtifact,
        classifyArtifactQuality,
        buildPhaseRecoveryInstruction,
        isFileClarificationLoop,
        shouldEmitDebugEvent,
        compactMessagesForNextPhase,
        buildPhaseHandoffMessage,
        buildPlannerArtifactContext,
        buildExecutionArtifactContext,
        releaseChatSlot,
        setConversationAbort,
        reqUser: req.user,
        dependencies: {
          MAX_STEPS,
          effectiveModelRef,
          activeProviderRef,
          clientRef,
          isLocalOrFlakyModel,
          providerCandidates,
          providerRuntime,
          buildOpenAIClient,
          normalizeMessagesForModel,
          mapMessagesToResponsesInput,
          mapToolsToResponsesTools,
          isResponsesSchemaMismatchError,
          buildDeepSeekRecoveryMessages,
          normalizeToolName,
          extractTextToolCalls,
          buildToolCallCacheKey,
          flattenResponseJsonText,
          normalizeFinalAssistantReport,
          hasAttachmentInRequest,
          safeMode,
          isLocalMode,
          isSensitiveTool,
          buildApprovalMetadata,
          createInteraction,
          waitForApproval,
          handleToolCall,
          isCacheableTool,
          buildToolRecoveryInstruction,
          normalizeUserFacingError,
          crypto,
          runId,
          llmTimeoutMs
        }
      });
      activeProvider = activeProviderRef.current;
      client = clientRef.current;
      effectiveModel = effectiveModelRef.current;
    } catch (e) {
      writeSse(res, { type: 'error', message: e.message });
    }
});

/**
 * SEC-3: Protected file reading
 */
app.get('/api/read-file', async (req, res) => {
  const { path: reqPath, workingDirectory } = req.query;
  const resolvedWD = resolveWorkingDirectory(workingDirectory, req.user);
  const resolvedPath = mapPath(reqPath, workingDirectory, resolvedWD);
  
  if (!isPathSafe(resolvedPath, workingDirectory, req.user)) {
    return res.status(403).json({ error: "Access denied" });
  }
  try {
    let content;
    if (resolvedPath.toLowerCase().endsWith('.pdf')) {
      content = await readPdfFile(resolvedPath);
    } else {
      content = await fs.readFile(resolvedPath, 'utf8');
    }
    res.json({ content });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }

});

/**
 * SEC-3: Protected file tree
 */
app.get('/api/files', async (req, res) => {
  const { path: reqPath, workingDirectory } = req.query;
  const resolvedWD = resolveWorkingDirectory(workingDirectory, req.user);
  const targetDir = mapPath(path.resolve(workingDirectory, reqPath || '.'), workingDirectory, resolvedWD);
  
  if (!isPathSafe(targetDir, workingDirectory, req.user)) {
    return res.status(403).json({ error: "Access denied" });
  }

  try {
    const files = await fs.readdir(targetDir, { withFileTypes: true });
    const result = files.map(f => ({
      name: f.name,
      type: f.isDirectory() ? 'directory' : 'file',
      path: path.join(reqPath || '.', f.name)
    }));
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/write-file', async (req, res) => {
  const { path: reqPath, content, workingDirectory } = req.body;
  const resolvedWD = resolveWorkingDirectory(workingDirectory, req.user);
  const resolvedPath = mapPath(reqPath, workingDirectory, resolvedWD);
  
  if (!isPathSafe(resolvedPath, workingDirectory, req.user)) {
    return res.status(403).json({ error: "Access denied" });
  }
  try {
    await fs.writeFile(resolvedPath, content, 'utf8');
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/pick-directory', async (req, res) => {
    if (process.platform !== 'darwin') {
        return res.status(400).json({ error: "Sadece macOS desteklenir" });
    }
    const script = `osascript -e 'POSIX path of (choose folder with prompt "Layihe qovlugunu secin:")'`;
    exec(script, (err, stdout) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ path: stdout.trim() });
    });
});

let cachedLocalGithubUsername = null;

app.get('/api/github/status', async (req, res) => {
  if (!db.hasDatabase()) {
    const localDb = await readLocalDb();
    let token = localDb.settings?.github_token;
    if (!token) token = typeof process.env.GITHUB_TOKEN === 'string' ? process.env.GITHUB_TOKEN.trim() : '';
    if (!token) {
      return res.json({ connected: false, username: null });
    }
    if (cachedLocalGithubUsername) {
      return res.json({ connected: true, username: cachedLocalGithubUsername });
    }
    try {
      const meResponse = await fetch('https://api.github.com/user', {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'bahAI-Agent'
        }
      });
      if (meResponse.ok) {
        const me = await meResponse.json();
        cachedLocalGithubUsername = me.login || 'developer';
        return res.json({ connected: true, username: cachedLocalGithubUsername });
      } else {
        console.error(`⚠️ Local GITHUB_TOKEN validation failed: status=${meResponse.status}`);
      }
    } catch (err) {
      console.error("⚠️ Local GITHUB_TOKEN status verification error:", err.message);
    }
    return res.json({ connected: false, username: null });
  }
  try {
    const result = await db.query('SELECT github_token_enc, github_username FROM users WHERE id = $1', [req.user.id]);
    const row = result.rows[0] || {};
    res.json({ connected: Boolean(row.github_token_enc), username: row.github_username || null });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/github/connect', async (req, res) => {
  const token = String(req.body?.token || '').trim();
  if (!token) return res.status(400).json({ error: 'GitHub token tələb olunur' });

  try {
    const meResponse = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'bahAI-Agent'
      }
    });
    if (!meResponse.ok) {
      return res.status(401).json({ error: 'GitHub token etibarsızdır və ya icazə yoxdur' });
    }
    const me = await meResponse.json();

    if (!db.hasDatabase()) {
      const fs = require('fs');
      const path = require('path');
      const envPath = path.resolve(__dirname, '../.env');
      let envContent = '';
      try {
        envContent = fs.readFileSync(envPath, 'utf8');
      } catch { /* ignore */ }

      if (envContent.includes('GITHUB_TOKEN=')) {
        envContent = envContent.replace(/GITHUB_TOKEN=.*/g, `GITHUB_TOKEN=${token}`);
      } else {
        envContent += `\n# GitHub Yerli Token\nGITHUB_TOKEN=${token}\n`;
      }
      fs.writeFileSync(envPath, envContent, 'utf8');
      process.env.GITHUB_TOKEN = token;
      cachedLocalGithubUsername = me.login || 'developer';

      const localDb = await readLocalDb();
      localDb.settings = localDb.settings || {};
      localDb.settings.github_token = token;
      await writeLocalDb(localDb);

      return res.json({ connected: true, username: me.login || null });
    }

    const encrypted = encryptSecret(token);
    await db.query(
      'UPDATE users SET github_token_enc = $1, github_username = $2 WHERE id = $3',
      [encrypted, me.login || null, req.user.id]
    );
    res.json({ connected: true, username: me.login || null });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/github/connect', async (req, res) => {
  if (!db.hasDatabase()) {
    try {
      const fs = require('fs');
      const path = require('path');
      const envPath = path.resolve(__dirname, '../.env');
      let envContent = '';
      try {
        envContent = fs.readFileSync(envPath, 'utf8');
      } catch { /* ignore */ }

      envContent = envContent.replace(/GITHUB_TOKEN=.*/g, '');
      fs.writeFileSync(envPath, envContent, 'utf8');
      delete process.env.GITHUB_TOKEN;
      cachedLocalGithubUsername = null;

      return res.json({ success: true });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }
  try {
    await db.query('UPDATE users SET github_token_enc = NULL, github_username = NULL WHERE id = $1', [req.user.id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/github/repos', async (req, res) => {
  try {
    const token = await getUserGithubToken(req.user.id);
    if (!token) return res.status(400).json({ error: 'GitHub bağlantısı yoxdur' });

    const ghResp = await fetch('https://api.github.com/user/repos?per_page=100&sort=updated', {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'bahAI-Agent'
      }
    });
    if (!ghResp.ok) {
      return res.status(ghResp.status).json({ error: 'GitHub repos alınmadı' });
    }
    const repos = await ghResp.json();
    const mapped = Array.isArray(repos)
      ? repos.map((r) => ({
          id: r.id,
          name: r.name,
          fullName: r.full_name,
          private: Boolean(r.private),
          cloneUrl: r.clone_url,
          defaultBranch: r.default_branch
        }))
      : [];
    res.json({ repos: mapped });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Admin verification middleware
function verifyAdmin(req, res, next) {
  if (req.user && req.user.role === 'admin') {
    next();
  } else {
    res.status(403).json({ error: 'Giriş qadağandır: Admin səlahiyyəti lazımdır' });
  }
}

// Admin Dashboard Stats
app.get('/api/admin/stats', verifyToken, verifyAdmin, async (req, res) => {
  if (!db.hasDatabase()) {
    return res.json({ 
      totalUsers: 0, onlineUsers: 0, totalMessages: 0, totalConversations: 0,
      todayMessages: 0, todayErrors: 0, activeDevices: 0, topModels: [], recentEvents: []
    });
  }

  try {
    const [users, conversations, todayTelemetry, devices, models, recentEvents] = await Promise.all([
      db.query('SELECT COUNT(*) as total, COUNT(CASE WHEN last_active > NOW() - INTERVAL \'5 minutes\' THEN 1 END) as online FROM users'),
      db.query('SELECT COUNT(*) as total, COALESCE(SUM(jsonb_array_length(messages)), 0) as messages FROM conversations'),
      db.query(`SELECT 
        COUNT(CASE WHEN event = 'chat_message' THEN 1 END) as messages,
        COUNT(CASE WHEN event = 'chat_error' THEN 1 END) as errors
        FROM telemetry WHERE created_at > NOW() - INTERVAL '24 hours'`),
      db.query(`SELECT COUNT(DISTINCT device_id) as total FROM telemetry WHERE created_at > NOW() - INTERVAL '7 days'`),
      db.query(`SELECT data->>'model' as model, COUNT(*) as count FROM telemetry WHERE event = 'chat_message' AND created_at > NOW() - INTERVAL '7 days' GROUP BY data->>'model' ORDER BY count DESC LIMIT 5`),
      db.query(`SELECT event, data, device_id, created_at FROM telemetry ORDER BY created_at DESC LIMIT 20`)
    ]);

    res.json({
      totalUsers: parseInt(users.rows[0]?.total) || 0,
      onlineUsers: parseInt(users.rows[0]?.online) || 0,
      totalConversations: parseInt(conversations.rows[0]?.total) || 0,
      totalMessages: parseInt(conversations.rows[0]?.messages) || 0,
      todayMessages: parseInt(todayTelemetry.rows[0]?.messages) || 0,
      todayErrors: parseInt(todayTelemetry.rows[0]?.errors) || 0,
      activeDevices: parseInt(devices.rows[0]?.total) || 0,
      topModels: models.rows || [],
      recentEvents: recentEvents.rows || []
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Protected Admin Route to list all registered users
app.get('/api/admin/users', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const isLocalMode = process.env.LOCAL_MODE === 'true' || !process.env.DATABASE_URL;
    if (isLocalMode) {
      return res.json({
        users: [
          { id: 9999, email: 'admin@bahai.local', name: 'bahAI Developer', role: 'admin', created_at: new Date(), last_active: new Date(), conversation_count: 5, message_count: 42 },
          { id: 1, email: 'kamran@gmail.com', name: 'Kamran Məmmədov', role: 'user', created_at: new Date(), last_active: new Date(Date.now() - 3600000), conversation_count: 3, message_count: 18 },
          { id: 2, email: 'nazim@gmail.com', name: 'Nazim Əliyev', role: 'user', created_at: new Date(), last_active: null, conversation_count: 0, message_count: 0 }
        ]
      });
    }

    const result = await db.query(`
      SELECT 
        u.id, u.email, u.name, u.role, u.created_at, u.last_active,
        COUNT(DISTINCT c.id) AS conversation_count,
        COALESCE(SUM(jsonb_array_length(c.messages)), 0) AS message_count
      FROM users u
      LEFT JOIN conversations c ON c.user_id = u.id
      GROUP BY u.id
      ORDER BY u.last_active DESC NULLS LAST, u.created_at DESC
    `);
    
    res.json({ 
      users: result.rows.map(row => ({
        ...row,
        conversation_count: parseInt(row.conversation_count) || 0,
        message_count: parseInt(row.message_count) || 0
      }))
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


// Serve Static Frontend in Production
const frontendDist = path.resolve(__dirname, '../frontend/dist');
app.use(express.static(frontendDist));

// Catch-all for 404s or SPA routing - return index.html for frontend, JSON for API
app.use((req, res) => {
    if (req.originalUrl.startsWith('/api')) {
        return res.status(404).json({ error: `Route ${req.originalUrl} not found` });
    }
    res.sendFile(path.join(frontendDist, 'index.html'), (err) => {
        if (err) {
            console.error('Failed to send index.html:', err);
            res.status(500).send("bahAI Frontend was not found or compiled. Please run 'npm run build' first!");
        }
    });
});

// Global Error Handler
app.use((err, req, res, next) => {
    console.error('SERVER ERROR:', err);
    res.status(500).json({ error: 'Daxili server xətası baş verdi' });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 bahAI Backend running on http://0.0.0.0:${PORT}`);
});

// SEC-FIX: graceful shutdown — close PG pool and finish in-flight requests
// before exit so connections are not leaked when the host sends SIGTERM
// (Railway/Kubernetes deploys).
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, async () => {
    console.log(`Received ${sig}, shutting down gracefully...`);
    try { await closeAllSessions().catch(() => {}); } catch { /* ignore */ }
    try { await db.shutdown?.(); } catch { /* ignore */ }
    process.exit(0);
  });
}
