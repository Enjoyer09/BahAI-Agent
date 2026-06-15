require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection:', reason);
});

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { OpenAI } = require('openai');
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { exec, execFile, spawn } = require('child_process');
const util = require('util');
const { glob } = require('glob');
const mammoth = require('mammoth');
const XLSX = require('xlsx');
const { createWorker } = require('tesseract.js');

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
// middleware which keeps the recommended defaults up-to-date. CSP is left in
// report-only mode because the SPA + Electron contexts need inline scripts.
app.use(helmet({
  contentSecurityPolicy: false, // SPA + Electron needs inline; revisit later
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
const providerRuntime = new Map();

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

function canUseProviderNow(providerId) {
  const state = providerRuntime.get(providerId);
  if (!state) return true;
  return !state.cooldownUntil || state.cooldownUntil < Date.now();
}

function markProviderFailure(providerId) {
  const prev = providerRuntime.get(providerId) || { fails: 0, cooldownUntil: 0 };
  const fails = prev.fails + 1;
  providerRuntime.set(providerId, {
    fails,
    cooldownUntil: Date.now() + Math.min(PROVIDER_COOLDOWN_MS * fails, 120000)
  });
}

function markProviderSuccess(providerId) {
  providerRuntime.set(providerId, { fails: 0, cooldownUntil: 0 });
}

function buildProviderCandidates({ frontendApiKey, frontendBaseUrl, frontendModel, autoIntent }) {
  const list = [];

  const OLLAMA_BASE = process.env.OLLAMA_BASE_URL || 'http://localhost:11434/v1';

  // FUNC-FIX: AUTO mode — route based on classifier. Fast intents try local
  // Ollama first (free, private), smart intents try the cloud frontier model
  // first. Both fall back to each other if the primary fails.
  if (frontendModel === 'auto') {
    const cloudKey = frontendApiKey || process.env.OPENAI_API_KEY || '';
    const cloudBase = frontendBaseUrl || process.env.OPENAI_BASE_URL || 'https://openrouter.ai/api/v1';
    const fastLocal = process.env.AUTO_FAST_MODEL || 'qwen2.5-coder:7b';
    const smartCloud = process.env.AUTO_SMART_MODEL || 'anthropic/claude-sonnet-4.5';

    const localProvider = { id: 'auto_ollama_fast', apiKey: 'ollama', baseURL: OLLAMA_BASE, model: fastLocal };
    const cloudProvider = cloudKey ? { id: 'auto_cloud_smart', apiKey: cloudKey, baseURL: cloudBase, model: smartCloud } : null;

    if (autoIntent === 'smart' && cloudProvider) {
      list.push(cloudProvider);
      list.push(localProvider); // failover for cloud outage
    } else {
      list.push(localProvider);
      if (cloudProvider) list.push(cloudProvider); // failover if Ollama not running
    }
  } else if (frontendModel && looksLikeOllamaModel(frontendModel)) {
    // FUNC-FIX: any Ollama-style ID auto-routes to local endpoint (was a
    // hard-coded whitelist, so e.g. qwen2.5-coder:7b silently fell back to
    // openrouter and 404'd).
    list.push({
      id: 'local_ollama_auto',
      apiKey: 'ollama',
      baseURL: OLLAMA_BASE,
      model: frontendModel
    });
  }

  if (frontendApiKey && frontendBaseUrl && frontendModel && frontendModel !== 'auto') {
    list.push({
      id: 'frontend',
      apiKey: frontendApiKey,
      baseURL: frontendBaseUrl,
      model: frontendModel
    });
  }

  for (const p of parseProviderPoolFromEnv()) {
    list.push(p);
  }

  const envApiKey = process.env.OPENAI_API_KEY || process.env.NVIDIA_API_KEY || '';
  const envBase = process.env.OPENAI_BASE_URL || 'https://openrouter.ai/api/v1';
  const envModel = process.env.OPENAI_MODEL || 'qwen/qwen3-coder:free';
  if (envApiKey && frontendModel !== 'auto') {
    list.push({
      id: process.env.OPENAI_API_KEY ? 'env_openai' : 'env_nvidia',
      apiKey: envApiKey,
      baseURL: envBase,
      model: envModel
    });
  }

  const dedup = new Map();
  for (const p of list) {
    const k = `${p.apiKey}|${p.baseURL}|${p.model}`;
    if (!dedup.has(k)) dedup.set(k, p);
  }
  return Array.from(dedup.values());
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
  
  const isSafe = isInsideProject || (isLocalMode() && isAllowedGlobally);
  
  if (!isSafe) {
    console.warn(`🚨 SECURITY ALERT: Blocked access to ${resolvedPath}`);
    console.warn(`   Rel to Project: ${rel} | Inside: ${isInsideProject}`);
    console.warn(`   Allowed Globally: ${isAllowedGlobally}`);
  }

  return isSafe;
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

function generateToolsSystemPrompt() {
  // FUNC-FIX: previous prompt was 80+ lines with 5 worked examples and made
  // smaller local models lose context. Compact prompt with a single concrete
  // example and a hard rule list.
  let prompt = `\n\nİSTİFADƏ EDƏ BİLƏCƏYİN ALƏTLƏR (TOOLS):\n`;
  prompt += `Tool çağırışı üçün cavabın YALNIZ aşağıdakı kimi JSON bloku olmalıdır:\n`;
  prompt += `\`\`\`json\n{"name": "alət_adı", "arguments": {"arq": "dəyər"}}\n\`\`\`\n`;
  prompt += `Bir cavabda yalnız 1 tool çağırışı et. İstifadəçiyə son cavab verirsənsə, JSON İSTİFADƏ ETMƏ — adi Markdown yaz.\n\n`;

  prompt += `Mövcud alətlər:\n`;
  for (const t of TOOLS) {
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

function extractTextToolCalls(text) {
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
          TOOLS.some((t) => t.function.name === parsed.name)) {
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
            TOOLS.some((t) => t.function.name === parsed.name)) {
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

const pendingApprovals = new Map();
const activeChatByUser = new Map();
const activeChatByConversation = new Map();
let activeChatTotal = 0;
const MAX_ACTIVE_CHAT_TOTAL = parseInt(process.env.MAX_ACTIVE_CHAT_TOTAL || '50', 10);
const MAX_ACTIVE_CHAT_PER_USER = parseInt(process.env.MAX_ACTIVE_CHAT_PER_USER || '5', 10);
const CHAT_QUEUE_TIMEOUT_MS = parseInt(process.env.CHAT_QUEUE_TIMEOUT_MS || '5000', 10);
const CHAT_SLOT_MAX_AGE_MS = 120000; // Force-release stuck slots after 2 minutes
const chatQueue = [];

function cleanupStaleSlots() {
  const now = Date.now();
  for (const [cid, info] of activeChatByConversation.entries()) {
    if (now - info.startedAt > CHAT_SLOT_MAX_AGE_MS) {
      console.warn(`⚠️ Force-releasing stale chat slot: conversation=${cid}, age=${Math.round((now - info.startedAt) / 1000)}s`);
      releaseChatSlot(info.userId, cid);
    }
  }
}

function acquireChatSlot(userId, conversationId) {
  const uid = String(userId || 'anon');
  const cid = String(conversationId || 'default');
  
  // Cleanup stale slots first
  cleanupStaleSlots();
  
  // If same conversation has a stuck slot, force-release it
  if (activeChatByConversation.has(cid)) {
    const existing = activeChatByConversation.get(cid);
    const age = Date.now() - existing.startedAt;
    if (age > CHAT_SLOT_MAX_AGE_MS) {
      // Force release stale slot
      releaseChatSlot(existing.userId, cid);
    } else {
      return false; // Same conversation already running (legitimately)
    }
  }
  
  const byUser = activeChatByUser.get(uid) || 0;
  if (activeChatTotal >= MAX_ACTIVE_CHAT_TOTAL || byUser >= MAX_ACTIVE_CHAT_PER_USER) {
    return false;
  }
  
  activeChatTotal += 1;
  activeChatByUser.set(uid, byUser + 1);
  activeChatByConversation.set(cid, { userId: uid, startedAt: Date.now() });
  return true;
}

function releaseChatSlot(userId, conversationId) {
  const uid = String(userId || 'anon');
  const cid = String(conversationId || 'default');
  
  // Remove conversation lock
  activeChatByConversation.delete(cid);
  
  const byUser = activeChatByUser.get(uid) || 0;
  if (byUser <= 1) activeChatByUser.delete(uid);
  else activeChatByUser.set(uid, byUser - 1);
  if (activeChatTotal > 0) activeChatTotal -= 1;
  drainChatQueue();
}

function removeFromChatQueue(ticketId) {
  const idx = chatQueue.findIndex((x) => x.id === ticketId);
  if (idx >= 0) chatQueue.splice(idx, 1);
}

function drainChatQueue() {
  let progressed = true;
  while (progressed && chatQueue.length > 0) {
    progressed = false;
    for (let i = 0; i < chatQueue.length; i += 1) {
      const item = chatQueue[i];
      if (acquireChatSlot(item.userId, item.conversationId)) {
        chatQueue.splice(i, 1);
        if (item.timer) clearTimeout(item.timer);
        item.resolve(true);
        progressed = true;
        break;
      }
    }
  }
}

async function acquireChatSlotQueued(userId, conversationId, req) {
  // First cleanup any stale slots
  cleanupStaleSlots();
  
  if (acquireChatSlot(userId, conversationId)) return true;

  // Short wait — if slot doesn't free up quickly, fail fast
  const ticketId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const onClose = () => {
      removeFromChatQueue(ticketId);
      reject(new Error('Client disconnected while waiting in queue'));
    };

    const timer = setTimeout(() => {
      removeFromChatQueue(ticketId);
      req.off('close', onClose);
      reject(new Error('Queue timeout'));
    }, CHAT_QUEUE_TIMEOUT_MS);

    chatQueue.push({
      id: ticketId,
      userId: String(userId || 'anon'),
      conversationId: String(conversationId || 'default'),
      resolve: () => {
        req.off('close', onClose);
        resolve(true);
      },
      reject,
      timer
    });
    req.on('close', onClose);
  });
}

function waitForApproval(approvalId, timeoutMs = 300000) {
  return new Promise((resolve, reject) => {
    const pending = pendingApprovals.get(approvalId);
    if (!pending) return reject(new Error('Approval tapılmadı'));

    pending._resolve = resolve;
    pending._reject = reject;
    pendingApprovals.set(approvalId, pending);

    // 5 dəqiqə timeout
    setTimeout(() => {
      if (pendingApprovals.has(approvalId)) {
        const p = pendingApprovals.get(approvalId);
        if (p.status === 'pending') {
          pendingApprovals.delete(approvalId);
          reject(new Error('Approval vaxtı bitdi (5 dəqiqə)'));
        }
      }
    }, timeoutMs);
  });
}

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
const TOOLS = [
    {
        type: "function",
        function: {
            name: "list_directory",
            description: "Lists the files and folders in a given directory.",
            parameters: {
                type: "object",
                properties: {
                    path: { type: "string" }
                },
                required: ["path"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "glob_search",
            description: "Find files using a glob pattern (e.g., src/**/*.ts).",
            parameters: {
                type: "object",
                properties: {
                    pattern: { type: "string" },
                    cwd: { type: "string" }
                },
                required: ["pattern", "cwd"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "read_file",
            description: "Reads the content of a file.",
            parameters: {
                type: "object",
                properties: {
                    path: { type: "string" },
                    start_line: { type: "number", description: "Optional. Startline to view, 1-indexed as usual, inclusive." },
                    end_line: { type: "number", description: "Optional. Endline to view, 1-indexed as usual, inclusive." }
                },
                required: ["path"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "write_file",
            description: "Creates a new file with the given content.",
            parameters: {
                type: "object",
                properties: {
                    path: { type: "string" },
                    content: { type: "string" }
                },
                required: ["path", "content"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "file_edit",
            description: "Edits a specific part of a file by replacing a unique string.",
            parameters: {
                type: "object",
                properties: {
                    path: { type: "string" },
                    target_content: { type: "string" },
                    replacement_content: { type: "string" }
                },
                required: ["path", "target_content", "replacement_content"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "check_port_status",
            description: "Checks if a specific port is active and listening for connections.",
            parameters: {
                type: "object",
                properties: {
                    port: { type: "number", description: "The port number to check (e.g. 5173)" }
                },
                required: ["port"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "run_terminal_command",
            description: "Runs a safe terminal command in the project directory.",
            parameters: {
                type: "object",
                properties: {
                    command: { type: "string" }
                },
                required: ["command"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "git_clone",
            description: "Clones a git repository from a URL into the current directory.",
            parameters: {
                type: "object",
                properties: {
                    url: { type: "string", description: "The GitHub repository URL (HTTPS)" },
                    folderName: { type: "string", description: "The name of the folder to clone into" }
                },
                required: ["url", "folderName"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "github_list_contents",
            description: "List files and directories in a remote GitHub repository via API without cloning. Useful for remote analysis.",
            parameters: {
                type: "object",
                properties: {
                    owner: { type: "string", description: "The owner of the repository (e.g. 'octocat')" },
                    repo: { type: "string", description: "The repository name (e.g. 'Hello-World')" },
                    path: { type: "string", description: "The path inside the repository to list (default is empty string for root)" }
                },
                required: ["owner", "repo"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "github_read_file",
            description: "Reads a file directly from a remote GitHub repository via API without cloning.",
            parameters: {
                type: "object",
                properties: {
                    owner: { type: "string", description: "The owner of the repository" },
                    repo: { type: "string", description: "The repository name" },
                    path: { type: "string", description: "The full path to the file inside the repo" }
                },
                required: ["owner", "repo", "path"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "github_search_code",
            description: "Search for code, keywords, or symbols in a remote GitHub repository using GitHub's Search API.",
            parameters: {
                type: "object",
                properties: {
                    owner: { type: "string", description: "The owner of the repository" },
                    repo: { type: "string", description: "The repository name" },
                    query: { type: "string", description: "The search query (e.g. 'functionName' or 'finance')" }
                },
                required: ["owner", "repo", "query"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "grep_search",
            description: "Search for a string pattern in the codebase using grep.",
            parameters: {
                type: "object",
                properties: {
                    query: { type: "string" },
                    cwd: { type: "string" }
                },
                required: ["query", "cwd"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "git_status",
            description: "Shows the current git status (modified, staged, untracked files).",
            parameters: {
                type: "object",
                properties: {},
                required: []
            }
        }
    },
    {
        type: "function",
        function: {
            name: "git_diff",
            description: "Shows git diff for modified files or a specific file.",
            parameters: {
                type: "object",
                properties: {
                    file: { type: "string", description: "Optional: specific file to diff" }
                },
                required: []
            }
        }
    },
    {
        type: "function",
        function: {
            name: "git_commit",
            description: "Creates a git commit with the given message.",
            parameters: {
                type: "object",
                properties: {
                    message: { type: "string", description: "Commit message" },
                    files: { type: "array", items: { type: "string" }, description: "Files to stage (optional, stages all if empty)" }
                },
                required: ["message"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "analyze_codebase",
            description: "Analyzes the codebase structure and provides a summary (file count, languages, dependencies).",
            parameters: {
                type: "object",
                properties: {
                    path: { type: "string", description: "Path to analyze (defaults to current directory)" }
                },
                required: []
            }
        }
    },
    {
        type: "function",
        function: {
            name: "find_definition",
            description: "Finds the definition of a function, class, or variable in the codebase.",
            parameters: {
                type: "object",
                properties: {
                    symbol: { type: "string", description: "Symbol name to find" },
                    cwd: { type: "string" }
                },
                required: ["symbol", "cwd"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "find_references",
            description: "Finds all references/usages of a function, class, or variable.",
            parameters: {
                type: "object",
                properties: {
                    symbol: { type: "string", description: "Symbol name to find references for" },
                    cwd: { type: "string" }
                },
                required: ["symbol", "cwd"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "web_search",
            description: "Searches the web for information. Use for documentation, error solutions, latest API references.",
            parameters: {
                type: "object",
                properties: {
                    query: { type: "string", description: "Search query" }
                },
                required: ["query"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "web_fetch",
            description: "Fetches content from a URL. Use to read documentation pages, API references, or web content.",
            parameters: {
                type: "object",
                properties: {
                    url: { type: "string", description: "URL to fetch" }
                },
                required: ["url"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "run_tests",
            description: "Runs project tests and returns results. Auto-detects test framework (jest, vitest, pytest, mocha).",
            parameters: {
                type: "object",
                properties: {
                    filter: { type: "string", description: "Optional: filter tests by name or file pattern" }
                },
                required: []
            }
        }
    },
    {
        type: "function",
        function: {
            name: "git_push",
            description: "Pushes committed changes to remote repository.",
            parameters: {
                type: "object",
                properties: {
                    branch: { type: "string", description: "Branch name (defaults to current branch)" }
                },
                required: []
            }
        }
    },
    {
        type: "function",
        function: {
            name: "git_log",
            description: "Shows recent git commit history.",
            parameters: {
                type: "object",
                properties: {
                    count: { type: "number", description: "Number of commits to show (default: 10)" }
                },
                required: []
            }
        }
    },
    {
        type: "function",
        function: {
            name: "git_branch",
            description: "Lists branches or creates a new branch.",
            parameters: {
                type: "object",
                properties: {
                    name: { type: "string", description: "New branch name to create (omit to list branches)" }
                },
                required: []
            }
        }
    },
    {
        type: "function",
        function: {
            name: "start_server",
            description: "Starts a development server in background (npm run dev, python -m http.server, etc). Returns after server starts.",
            parameters: {
                type: "object",
                properties: {
                    command: { type: "string", description: "Server start command (e.g. 'npm run dev', 'npx serve')" },
                    port: { type: "number", description: "Expected port number" }
                },
                required: ["command", "port"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "multi_file_edit",
            description: "Edits multiple files at once. More efficient than calling file_edit multiple times.",
            parameters: {
                type: "object",
                properties: {
                    edits: {
                        type: "array",
                        items: {
                            type: "object",
                            properties: {
                                path: { type: "string" },
                                target_content: { type: "string" },
                                replacement_content: { type: "string" }
                            },
                            required: ["path", "target_content", "replacement_content"]
                        },
                        description: "Array of file edits to apply"
                    }
                },
                required: ["edits"]
            }
        }
    }
];

// ==========================================
// Tool Execution Handler
// ==========================================

async function handleToolCall(toolCall, workingDirectory, user) {
    const { name, arguments: argsJson } = toolCall.function;
    const args = JSON.parse(argsJson);

    try {
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
                    
                    // Check for package.json
                    let projectInfo = '';
                    try {
                        const pkgPath = path.join(analyzePath, 'package.json');
                        const pkgContent = await fs.readFile(pkgPath, 'utf-8');
                        const pkg = JSON.parse(pkgContent);
                        const deps = Object.keys(pkg.dependencies || {}).slice(0, 15).join(', ');
                        const devDeps = Object.keys(pkg.devDependencies || {}).slice(0, 10).join(', ');
                        const scripts = Object.keys(pkg.scripts || {}).join(', ');
                        projectInfo = `\n\n📦 package.json:\n  Ad: ${pkg.name || 'N/A'}\n  Versiya: ${pkg.version || 'N/A'}\n  Scripts: ${scripts}\n  Dependencies: ${deps}\n  DevDeps: ${devDeps}`;
                    } catch { /* ignore */ }
                    
                    // Check for other config files
                    let configs = '';
                    const configFiles = ['tsconfig.json', 'vite.config.ts', 'next.config.js', 'webpack.config.js', '.env.example', 'Dockerfile', 'requirements.txt', 'Cargo.toml', 'go.mod'];
                    const foundConfigs = [];
                    for (const cf of configFiles) {
                        try {
                            await fs.access(path.join(analyzePath, cf));
                            foundConfigs.push(cf);
                        } catch { /* ignore */ }
                    }
                    if (foundConfigs.length > 0) configs = `\n\n⚙️ Konfiqurasiya faylları: ${foundConfigs.join(', ')}`;

                    // Read main entry point
                    let entryContent = '';
                    const entryFiles = ['src/App.tsx', 'src/App.jsx', 'src/index.ts', 'src/main.ts', 'index.js', 'app.js', 'main.py', 'src/main.tsx'];
                    for (const ef of entryFiles) {
                        try {
                            const content = await fs.readFile(path.join(analyzePath, ef), 'utf-8');
                            entryContent = `\n\n📝 Entry point (${ef}) - ilk 50 sətir:\n${content.split('\n').slice(0, 50).join('\n')}`;
                            break;
                        } catch { /* ignore */ }
                    }
                    
                    const summary = [
                        `📊 Layihə Analizi: ${analyzePath.split('/').pop()}`,
                        `\n📁 Struktur:\n${structure}`,
                        `\nÜmumi fayl sayı: ${files.length}`,
                        `Fayl tipləri: ${Object.entries(extensions).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k}(${v})`).join(', ')}`,
                        projectInfo,
                        configs,
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
                    // Auto-detect test framework
                    let testCmd = null;
                    try {
                        const pkgContent = await fs.readFile(path.join(workingDirectory, 'package.json'), 'utf-8');
                        const pkg = JSON.parse(pkgContent);
                        if (pkg.scripts?.test && pkg.scripts.test !== 'echo "Error: no test specified" && exit 1') {
                            testCmd = 'npm test -- --run';
                        }
                        if (pkg.devDependencies?.vitest || pkg.dependencies?.vitest) testCmd = 'npx vitest --run';
                        if (pkg.devDependencies?.jest || pkg.dependencies?.jest) testCmd = 'npx jest --forceExit';
                    } catch { /* ignore */ }
                    
                    if (!testCmd) {
                        // Check for Python tests
                        try {
                            await fs.access(path.join(workingDirectory, 'pytest.ini'));
                            testCmd = 'python -m pytest --tb=short';
                        } catch { /* ignore */ }
                        try {
                            await fs.access(path.join(workingDirectory, 'tests'));
                            testCmd = testCmd || 'python -m pytest --tb=short';
                        } catch { /* ignore */ }
                    }
                    
                    if (!testCmd) return "Test framework tapılmadı. package.json-da 'test' script əlavə edin.";
                    
                    if (args.filter) testCmd += ` ${args.filter}`;
                    
                    const { stdout, stderr } = await execFileAsync('sh', ['-c', testCmd], { 
                        cwd: workingDirectory, 
                        timeout: 60000,
                        env: { ...process.env, CI: 'true', FORCE_COLOR: '0' }
                    });
                    return `🧪 Test nəticələri:\n${(stdout + stderr).slice(0, 5000)}`;
                } catch (e) {
                    const output = (e.stdout || '') + (e.stderr || '');
                    return `🧪 Test nəticələri (bəziləri uğursuz):\n${output.slice(0, 5000)}`;
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
                return "Unknown tool";
        }
    } catch (e) {
        return `Error executing tool: ${e.message}`;
    }
}

// ==========================================
// API Endpoints
// ==========================================

const localDbPath = path.resolve(__dirname, '../sandbox/local_db.json');

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
  const pending = pendingApprovals.get(req.params.id);
  if (!pending) return res.status(404).json({ error: 'Approval tapılmadı' });
  if (pending.userId !== req.user.id) return res.status(403).json({ error: 'Access denied' });
  const decision = req.body?.decision === 'approve' ? 'approved' : 'rejected';

  // Agent loop-u oyandır
  if (pending._resolve) {
    pending._resolve(decision);
  }

  // Map-dan təmizlə
  pendingApprovals.delete(req.params.id);

  res.json({ success: true, status: decision });
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
    const { messages, apiKey, model, workingDirectory, baseUrl, projectId, conversationId, safeMode = true } = req.body;
    let slotAcquired = false;
    try {
      await acquireChatSlotQueued(req.user?.id, conversationId, req);
      slotAcquired = true;
    } catch (queueErr) {
      res.setHeader('Retry-After', '5');
      const msg = queueErr?.message === 'Queue timeout'
        ? 'Bu söhbətdə əvvəlki sorğu hələ davam edir. Bir neçə saniyə gözləyin.'
        : 'Sorğu göndərilə bilmədi. Yenidən cəhd edin.';
      return res.status(503).json({ error: msg });
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

    if (!ALLOWED_DIRS.some(base => {
        const r = path.relative(base, resolvedWD);
        return !r.startsWith('..') && !path.isAbsolute(r);
    })) {
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
    const autoIntent = classifyTaskComplexity({
      userMessage: lastUserMsg?.content || '',
      messageHistoryLen: messages.length,
      hasAttachments: Array.isArray(lastUserMsg?.attachments) && lastUserMsg.attachments.length > 0
    });

    const providerCandidates = buildProviderCandidates({
      frontendApiKey,
      frontendBaseUrl,
      frontendModel,
      autoIntent
    });

    if (providerCandidates.length === 0) {
        return res.status(400).json({
            error: "Süni İntellekt API Açarı tapılmadı! Layihəni lokalda (Railway-dən asılı olmadan) işlətmək üçün layihə qovluğundakı `.env` faylına OPENAI_API_KEY və OPENAI_BASE_URL açarlarını əlavə edin."
        });
    }
    let activeProvider = providerCandidates.find((p) => canUseProviderNow(p.id)) || providerCandidates[0];
    let client = new OpenAI({ 
      baseURL: activeProvider.baseURL, 
      apiKey: activeProvider.apiKey,
      defaultHeaders: {
        'HTTP-Referer': 'https://bahai-agent.app',
        'X-Title': 'bahAI Agent'
      }
    });
    let effectiveModel = activeProvider.model;
    console.log(`🤖 /api/chat | provider_candidates=${providerCandidates.length} | active=${activeProvider.id} | model=${effectiveModel}${frontendModel === 'auto' ? ` | auto_intent=${autoIntent}` : ''}`);

    // FUNC-FIX: pending event — emitted once SSE headers are written below.
    const pendingAutoRouteEvent = frontendModel === 'auto'
      ? { type: 'auto_route', intent: autoIntent, chosenModel: effectiveModel, providerId: activeProvider.id }
      : null;

    const isLocalOrFlakyModel = isLocalMode() || 
      !effectiveModel || 
      /qwen|ollama|deepseek|llama|local|free|nemotron/i.test(effectiveModel);

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

CAVAB FORMATI:
- Tool çağırışı üçün: tək JSON blok (aşağıdakı format).
- İstifadəçiyə son cavab üçün: adi Markdown mətn (kod blokları + izah).`;
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
      
    if (isLocalOrFlakyModel) {
      fullSysPrompt += generateToolsSystemPrompt();
    }

    const memoryPrompt = `Layihə yaddaşı: ${JSON.stringify(projectMemory)}`;
    const apiMessages = [{ role: 'system', content: `${fullSysPrompt}\n${memoryPrompt}` }, ...modelMessages];
    
    if (isLocalOrFlakyModel) {
      apiMessages.push({
        role: 'system',
        content: "XATIRLATMA: Sən birbaşa faylları oxuya, dəyişə və command icra edə bilən AI kodlaşdırma agentisən. MÜTLƏQ verilmiş JSON tool (read_file, grep_search, list_directory, və s.) çağırışlarını istifadə et. Qətiyyən 'mən bunu edə bilmərəm' və ya 'mən yalnız bir modeləm' bəhanələrini gətirmə!"
      });
    }

    const hasAttachmentInRequest = Array.isArray(messages) && messages.some((m) => Array.isArray(m?.attachments) && m.attachments.length > 0);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // FUNC-FIX: emit auto-routing decision so the UI can show what was picked.
    if (pendingAutoRouteEvent) {
      res.write(`data: ${JSON.stringify(pendingAutoRouteEvent)}\n\n`);
    }

    let currentMessages = [...apiMessages];
    let step = 0;
    let attachmentRetryUsed = false;
    let deepSeekRecoveryUsed = false;
    let providerNoToolsFallbackUsed = false;
    let clientDisconnected = false;

    // Client disconnect detection
    req.on('close', () => {
        clientDisconnected = true;
    });

    const initialPlan = [
      'Oxunacaq faylları müəyyən et',
      'Dəyişiklik planını hazırla',
      'Diff/Approval ilə tətbiq et',
      'Build/Test/Health yoxlaması apar'
    ];
    res.write(`data: ${JSON.stringify({ type: 'task_plan', items: initialPlan })}\n\n`);

    try {
        while (step < MAX_STEPS && !clientDisconnected) {
            step++;

            // Streaming ilə API çağırışı (default 180s; lokal/yavaş modellər üçün env ilə uzadıla bilər)
            const llmTimeoutMs = parseInt(process.env.LLM_TIMEOUT_MS || '180000', 10);
            const abortController = new AbortController();
            const timeoutId = setTimeout(() => abortController.abort(), llmTimeoutMs);

            let stream;
            let shouldRetryWithDeepSeekRecovery = false;
            try {
                const apiInputMessages = await normalizeMessagesForModel(currentMessages, effectiveModel);
                stream = await client.chat.completions.create({
                    model: effectiveModel,
                    messages: apiInputMessages,
                    tools: isLocalOrFlakyModel ? undefined : TOOLS,
                    temperature: 0.2,
                    stream: true
                }, { signal: abortController.signal });
            } catch (apiErr) {
                let currentErr = apiErr;
                const isRetryable = (() => {
                  const st = currentErr?.status || currentErr?.code;
                  const msg = String(currentErr?.message || '').toLowerCase();
                  if (st === 401) return true;
                  if (st === 429 || st === 500 || st === 502 || st === 503 || st === 504) return true;
                  if (st === 400 && msg.includes('provider returned error')) return true;
                  if (!st && (msg.includes('network') || msg.includes('timeout') || msg.includes('fetch failed'))) return true;
                  return false;
                })();

                if (isRetryable && providerCandidates.length > 1) {
                  markProviderFailure(activeProvider.id);
                  const alternatives = providerCandidates.filter((p) => p.id !== activeProvider.id && canUseProviderNow(p.id));
                  for (const alt of alternatives) {
                    try {
                      const altClient = new OpenAI({ 
                        baseURL: alt.baseURL, 
                        apiKey: alt.apiKey,
                        defaultHeaders: {
                          'HTTP-Referer': 'https://bahai-agent.app',
                          'X-Title': 'bahAI Agent'
                        }
                      });
                      const altApiInputMessages = await normalizeMessagesForModel(currentMessages, alt.model);
                      const altIsLocal = /qwen|ollama|deepseek|llama|local|free|nemotron/i.test(alt.model);
                      stream = await altClient.chat.completions.create({
                        model: alt.model,
                        messages: altApiInputMessages,
                        tools: altIsLocal ? undefined : TOOLS,
                        temperature: 0.2,
                        stream: true
                      }, { signal: abortController.signal });
                      activeProvider = alt;
                      client = altClient;
                      effectiveModel = alt.model;
                      markProviderSuccess(alt.id);
                      console.log(`🔁 Provider failover: switched to ${alt.id}`);
                      break;
                    } catch (altErr) {
                      currentErr = altErr;
                      markProviderFailure(alt.id);
                    }
                  }
                } else {
                  markProviderFailure(activeProvider.id);
                }
                clearTimeout(timeoutId);
                if (stream) {
                  // fallback succeeded
                } else if (currentErr.name === 'AbortError') {
                    const sec = Math.round(llmTimeoutMs / 1000);
                    res.write(`data: ${JSON.stringify({ type: 'error', message: `Model ${sec}s ərzində cavab vermədi. Daha kiçik model (məs. Qwen 2.5 Coder 7B) sınayın və ya \`LLM_TIMEOUT_MS\` env-i artırın.` })}\n\n`);
                    break;
                } else {
                  const status = currentErr.status || currentErr.code || 'unknown';
                  const errText = String(currentErr.message || '').toLowerCase();
                  const isDeepSeekModel = String(effectiveModel || '').toLowerCase().includes('deepseek');
                  if (
                    !deepSeekRecoveryUsed &&
                    isDeepSeekModel &&
                    String(status) === '400' &&
                    (errText.includes('provider returned error') || errText.includes('reasoning_content') || errText.includes('tool_call'))
                  ) {
                    deepSeekRecoveryUsed = true;
                    currentMessages = buildDeepSeekRecoveryMessages(currentMessages);
                    shouldRetryWithDeepSeekRecovery = true;
                  }

                  if (shouldRetryWithDeepSeekRecovery) {
                    res.write(`data: ${JSON.stringify({ type: 'debug', info: 'DeepSeek recovery retry activated' })}\n\n`);
                    continue;
                  }

                  // Generic provider 400 fallback: retry once with no tools and non-stream request.
                  if (!providerNoToolsFallbackUsed && String(status) === '400' && errText.includes('provider returned error')) {
                    providerNoToolsFallbackUsed = true;
                    try {
                      const basic = await client.chat.completions.create({
                        model: effectiveModel,
                        messages: buildDeepSeekRecoveryMessages(currentMessages),
                        temperature: 0.2
                      });
                      const simpleMsg = basic?.choices?.[0]?.message || { role: 'assistant', content: 'Cavab alınmadı.' };
                      currentMessages.push(simpleMsg);
                      res.write(`data: ${JSON.stringify({ type: 'assistant_message', message: simpleMsg })}\n\n`);
                      break;
                    } catch (fallbackErr) {
                      currentErr = fallbackErr;
                    }
                  }

                  // Detailed API error logging
                  console.error(`❌ API Error [${status}]:`, currentErr.message);
                  console.error(`❌ Full error:`, JSON.stringify({ status: currentErr.status, headers: currentErr.headers, body: currentErr.error || currentErr.body }, null, 2));
                  let userMsg = `API xətası: ${currentErr.message}`;
                  const errLower = String(currentErr.message || '').toLowerCase();
                  const isOllamaUrl = String(activeProvider.baseURL || '').includes('11434') || String(activeProvider.baseURL || '').includes('ollama');

                  if (currentErr.status === 401) {
                      userMsg = 'API açarı keçərsizdir. Ayarlardan düzgün API açarı daxil edin.';
                  } else if (currentErr.status === 429) {
                      userMsg = 'API limiti aşıldı (rate limit). 1-2 dəqiqə gözləyib yenidən cəhd edin.';
                  } else if (currentErr.status === 503) {
                      userMsg = 'AI servisi müvəqqəti əlçatmazdır. Mesajınız çox böyük ola bilər — daha qısa mesaj göndərin və ya bir neçə dəqiqə gözləyin.';
                  } else if (currentErr.status === 404) {
                      if (isOllamaUrl) {
                          userMsg = `Ollama-da "${effectiveModel}" modeli quraşdırılmayıb. Terminal-da bunu icra edin: \`ollama pull ${effectiveModel}\``;
                      } else {
                          userMsg = `Model tapılmadı: "${effectiveModel}". Ayarlardan model adını yoxlayın.`;
                      }
                  } else if (
                      // FUNC-FIX: actionable error when Ollama isn't running.
                      // Previously users just saw "Connection error" and didn't
                      // know that they needed `ollama serve`.
                      isOllamaUrl && (
                          errLower.includes('econnrefused') ||
                          errLower.includes('connection error') ||
                          errLower.includes('fetch failed') ||
                          errLower.includes('econnreset')
                      )
                  ) {
                      userMsg = `🦙 Ollama xidməti işləmir (${activeProvider.baseURL}). Terminal-da bunu icra edin:\n\n\`\`\`\nollama serve\n\`\`\`\n\nSonra modeli yükləyin: \`ollama pull ${effectiveModel}\`\n\nVə ya AYARLAR-dan Cloud modelinə (Claude Sonnet 4.5 və ya 'Auto') keçin.`;
                  } else if (errLower.includes('connection error') || errLower.includes('fetch failed') || errLower.includes('econnrefused')) {
                      userMsg = `Şəbəkə xətası: ${activeProvider.baseURL}-ə qoşula bilmədim. İnternet bağlantınızı və baseURL-i yoxlayın.`;
                  }
                  res.write(`data: ${JSON.stringify({ type: 'error', message: userMsg })}\n\n`);
                  break;
                }
            } finally {
                clearTimeout(timeoutId);
            }

            let accumulatedContent = '';
            let accumulatedReasoning = '';
            let accumulatedToolCalls = [];
            let finishReason = null;

            for await (const chunk of stream) {
              const delta = chunk.choices[0]?.delta;
              if (!delta) continue;

              // Mətn content-i real-time göndər
              if (delta.content) {
                accumulatedContent += delta.content;
                res.write(`data: ${JSON.stringify({ type: 'assistant_delta', content: delta.content })}\n\n`);
              }

              // DeepSeek/Nemotron thinking mode compatibility:
              // reasoning_content must be echoed back in subsequent turns.
              if (delta.reasoning_content) {
                accumulatedReasoning += delta.reasoning_content;
                // Send a "thinking" indicator so user sees activity
                if (accumulatedReasoning.length <= 5) {
                  res.write(`data: ${JSON.stringify({ type: 'assistant_delta', content: '🤔 *Düşünürəm...*\n\n' })}\n\n`);
                }
              }

              // Tool call-ları yığ
              if (delta.tool_calls) {
                for (const tc of delta.tool_calls) {
                  const idx = tc.index ?? 0;
                  if (!accumulatedToolCalls[idx]) {
                    accumulatedToolCalls[idx] = { id: tc.id || '', type: 'function', function: { name: '', arguments: '' } };
                  }
                  if (tc.id) accumulatedToolCalls[idx].id = tc.id;
                  if (tc.function?.name) accumulatedToolCalls[idx].function.name += tc.function.name;
                  if (tc.function?.arguments) accumulatedToolCalls[idx].function.arguments += tc.function.arguments;
                }
              }

              if (chunk.choices[0]?.finish_reason) {
                finishReason = chunk.choices[0].finish_reason;
              }
            }

            // Tamamlanmış mesajı yarat
            let normalizedToolCalls = accumulatedToolCalls
              .filter((tc) => tc && tc.function && tc.function.name)
              .map((tc, idx) => ({
                id: tc.id || `toolcall_${step}_${idx}_${Date.now()}`,
                type: 'function',
                function: {
                  name: tc.function.name,
                  arguments: tc.function.arguments || '{}'
                }
              }));

            // Universal Tool Call Fallback Parser for text-printed JSON blocks (e.g. from local Ollama/Qwen)
            let textToolCalls = [];
            if (accumulatedContent) {
              try {
                const parseResult = extractTextToolCalls(accumulatedContent);
                accumulatedContent = parseResult.cleanedText;
                textToolCalls = parseResult.toolCalls.map((tc, idx) => ({
                  id: `toolcall_text_${step}_${idx}_${Date.now()}`,
                  type: 'function',
                  function: {
                    name: tc.name,
                    arguments: tc.arguments
                  }
                }));
              } catch (parseErr) {
                console.error("⚠️ Fallback tool call parser xətası:", parseErr);
              }
            }

            if (textToolCalls.length > 0) {
              console.log(`🔌 Intercepted ${textToolCalls.length} raw text tool call(s):`, JSON.stringify(textToolCalls));
              if (textToolCalls.length > 1) {
                console.log('⚠️ Multiple tool calls found in text. To prevent hallucination loop, keeping only the first one.');
                textToolCalls = [textToolCalls[0]];
              }
              normalizedToolCalls = [...normalizedToolCalls, ...textToolCalls];
            }

            const msg = {
              role: 'assistant',
              content: accumulatedContent || null,
              reasoning_content: accumulatedReasoning || undefined,
              tool_calls: normalizedToolCalls.length > 0 ? normalizedToolCalls : undefined
            };

            const hasToolCalls = normalizedToolCalls.length > 0;
            const hasTextContent = accumulatedContent.trim().length > 0;

            if (hasAttachmentInRequest && !hasToolCalls && !hasTextContent && !attachmentRetryUsed) {
              attachmentRetryUsed = true;
              currentMessages.push({
                role: 'system',
                content: 'İstifadəçi attachment göndərib. Boş cavab vermə. Mövcud attachment məlumatına əsaslanaraq qısa, konkret analiz və nəticə yaz.'
              });
              continue;
            }

            currentMessages.push(msg);

            // Tam mesajı göndər (tool_calls ilə birlikdə)
            res.write(`data: ${JSON.stringify({ type: 'assistant_message', message: msg })}\n\n`);

            if (msg.tool_calls && msg.tool_calls.length > 0) {
                for (const toolCall of msg.tool_calls) {
                    if (clientDisconnected) break;
                    res.write(`data: ${JSON.stringify({ type: 'tool_execution', tool: toolCall.function.name, args: toolCall.function.arguments, tool_call_id: toolCall.id })}\n\n`);
                    // In local mode, skip approval for all tools (user's own machine)
                    if (safeMode && !isLocalMode() && isSensitiveTool(toolCall.function.name)) {
                        const approvalId = crypto.randomUUID();
                        pendingApprovals.set(approvalId, {
                          userId: req.user.id,
                          status: 'pending',
                          toolCall,
                          workingDirectory: resolvedWD,
                          createdAt: Date.now()
                        });
                        res.write(`data: ${JSON.stringify({ type: 'approval_request', approvalId, tool: toolCall.function.name, args: toolCall.function.arguments })}\n\n`);

                        try {
                          const decision = await waitForApproval(approvalId);
                          if (decision === 'rejected') {
                            currentMessages.push({
                              role: "tool",
                              tool_call_id: toolCall.id,
                              content: `İstifadəçi tərəfindən rədd edildi. Bu əməliyyatı icra etmə.`
                            });
                            res.write(`data: ${JSON.stringify({ type: 'tool_result', result: 'Rədd edildi' })}\n\n`);
                          } else {
                            const result = await handleToolCall(toolCall, resolvedWD, req.user);
                            currentMessages.push({ role: "tool", tool_call_id: toolCall.id, content: result });
                            res.write(`data: ${JSON.stringify({ type: 'tool_result', result })}\n\n`);
                          }
                        } catch (err) {
                          currentMessages.push({
                            role: "tool",
                            tool_call_id: toolCall.id,
                            content: `Approval xətası: ${err.message}`
                          });
                          res.write(`data: ${JSON.stringify({ type: 'tool_result', result: `Approval xətası: ${err.message}` })}\n\n`);
                        }
                        continue;
                    }
                    try {
                      const result = await handleToolCall(toolCall, resolvedWD, req.user);
                      const toolResultMsg = { role: "tool", tool_call_id: toolCall.id, content: result };
                      currentMessages.push(toolResultMsg);
                      res.write(`data: ${JSON.stringify({ type: 'tool_result', result })}\n\n`);
                    } catch (toolErr) {
                      const errorText = `Tool xətası: ${toolErr?.message || String(toolErr)}`;
                      currentMessages.push({ role: "tool", tool_call_id: toolCall.id, content: errorText });
                      res.write(`data: ${JSON.stringify({ type: 'tool_result', result: errorText })}\n\n`);
                    }
                }
            } else {
                break;
            }
        }
    } catch (e) {
        res.write(`data: ${JSON.stringify({ type: 'error', message: e.message })}\n\n`);
    } finally {
        if (slotAcquired) releaseChatSlot(req.user?.id, conversationId);
        res.end();
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
    try { await db.shutdown?.(); } catch { /* ignore */ }
    process.exit(0);
  });
}
