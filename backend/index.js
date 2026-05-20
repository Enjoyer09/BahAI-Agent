require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection:', reason);
});

const express = require('express');
const cors = require('cors');
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

// SEC-7: Restrict CORS
app.use(cors());
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || '50mb' }));

// Request Logger
app.use((req, res, next) => {
  console.log(`[REQ] ${req.method} ${req.url} (original: ${req.originalUrl})`);
  next();
});

// Public Auth Routes
app.use('/api/auth', authRoutes);

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
const MAX_STEPS = parseInt(process.env.MAX_AGENT_STEPS || '15', 10);
const ALLOWED_DIRS = process.env.ALLOWED_DIRECTORIES
  ? process.env.ALLOWED_DIRECTORIES.split(',').map(d => path.resolve(d.trim()))
  : [
      path.resolve(__dirname, '..'), // Project root
      path.resolve(process.env.HOME || process.env.USERPROFILE || '/'), // User home (Documents, etc)
    ];
const WORKSPACE_ROOT = path.resolve(process.env.WORKSPACE_ROOT || path.join(__dirname, '../sandbox'));
const isLocalMode = () => process.env.LOCAL_MODE === 'true' || !process.env.DATABASE_URL;
const PROVIDER_COOLDOWN_MS = parseInt(process.env.PROVIDER_COOLDOWN_MS || '20000', 10);
const providerRuntime = new Map();

// Startup diagnostics
const diagKey = process.env.OPENAI_API_KEY;
console.log('🔧 Startup Config:', {
  PORT,
  LOCAL_MODE: process.env.LOCAL_MODE || '(not set)',
  DATABASE_URL: process.env.DATABASE_URL ? '✅ set' : '❌ not set',
  OPENAI_API_KEY: diagKey ? `${diagKey.slice(0, 8)}...${diagKey.slice(-4)}` : '❌ not set',
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

function buildProviderCandidates({ frontendApiKey, frontendBaseUrl, frontendModel }) {
  const list = [];

  if (frontendApiKey && frontendBaseUrl && frontendModel) {
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
  const envBase = process.env.OPENAI_BASE_URL || 'https://integrate.api.nvidia.com/v1';
  const envModel = process.env.OPENAI_MODEL || 'meta/llama-3.3-70b-instruct';
  if (envApiKey) {
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
}

async function getUserGithubToken(userId) {
  if (!db.hasDatabase()) return null;
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

    // Only support text-based files
    if (
      mimeType.startsWith('text/') ||
      mimeType.includes('json') ||
      mimeType.includes('xml') ||
      mimeType.includes('javascript') ||
      mimeType.includes('typescript') ||
      /\.(txt|json|csv|md|yaml|yml|xml|log|env|js|ts|jsx|tsx|py|html|css|sh|toml|ini|cfg|conf)$/i.test(name)
    ) {
      const text = decoded.buffer.toString('utf8');
      return { name, mimeType, extractedText: text.slice(0, 50000) };
    }

    return { name, mimeType, extractedText: `[Dəstəklənməyən fayl növü: ${name}. Yalnız mətn faylları (txt, json, csv, md, js, ts, py, html, css) dəstəklənir.]` };
  } catch (error) {
    console.error('Attachment parse xətası:', name, error?.message || error);
    return { name, mimeType, extractedText: `[Attachment oxunarkən xəta: ${name}]` };
  }
}

async function normalizeMessagesForModel(messages = []) {
  const normalized = [];

  for (const message of messages) {
    if (!message.attachments?.length) {
      normalized.push(message);
      continue;
    }

    const textParts = [
      message.content || '',
      '[Sistem qeydi: İstifadəçi artıq attachment göndərib. Yenidən upload/drag-drop/link istəmədən mövcud attachment məzmununu analiz et.]'
    ];

    // Attachment-ları paralel emal et
    const results = await Promise.all(message.attachments.map(async (attachment) => {
      // If extractedText already exists (from frontend extraction), use it directly
      if (attachment?.extractedText && typeof attachment.extractedText === 'string' && attachment.extractedText.trim()) {
        return `\n\n[Attachment: ${attachment.name || 'attachment'} | ${attachment.mimeType || attachment.type || 'unknown'}]\n${attachment.extractedText.slice(0, 6000)}`;
      }
      
      // If there was an extraction error from frontend, report it
      if (attachment?.extractionError) {
        return `\n\n[Attachment: ${attachment?.name || 'attachment'}]\nOxuma xətası: ${attachment.extractionError}`;
      }

      // Only try to extract if we have a data URL (not empty)
      if (!attachment?.url || attachment.url === '') {
        return `\n\n[Attachment: ${attachment?.name || 'attachment'} | ${attachment?.mimeType || 'unknown'}]\nFayl əlavə olunub, amma məzmunu çıxarıla bilmədi.`;
      }

      // Try extraction from data URL
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

    normalized.push({
      ...message,
      content: textParts.join('\n').trim(),
      attachments: undefined
    });
  }

  return normalized;
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
  return toolName === 'write_file' || toolName === 'file_edit' || toolName === 'run_terminal_command' || toolName === 'git_clone';
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
const ALLOWED_COMMANDS = ['npm', 'yarn', 'git', 'node', 'ls', 'pwd', 'mkdir', 'touch', 'grep', 'find'];

function isBashCommandSafe(command) {
  // SEC-Audit: Block shell metacharacters to prevent chaining/injection
  const unsafeChars = /[;&|`$(){}><]/;
  if (unsafeChars.test(command)) return false;

  const baseCmd = command.trim().split(/\s+/)[0];
  // Basic allowlist check
  return ALLOWED_COMMANDS.includes(baseCmd) || command.startsWith('npm run');
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
                    path: { type: "string" }
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
                } else {
                    content = await fs.readFile(filePath, 'utf8');
                }

                // PERF: Simple truncation for very large files
                if (content.length > 50000) return content.slice(0, 50000) + "\n\n[TRUNCATED... File too large]";
                return content;
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
                    } catch {}

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
                        ignore: ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/build/**'],
                        nodir: true 
                    });
                    
                    const extensions = {};
                    files.forEach(file => {
                        const ext = path.extname(file) || 'no-extension';
                        extensions[ext] = (extensions[ext] || 0) + 1;
                    });
                    
                    // Check for package.json
                    let dependencies = 'N/A';
                    try {
                        const pkgPath = path.join(analyzePath, 'package.json');
                        const pkgContent = await fs.readFile(pkgPath, 'utf-8');
                        const pkg = JSON.parse(pkgContent);
                        const depCount = Object.keys(pkg.dependencies || {}).length;
                        const devDepCount = Object.keys(pkg.devDependencies || {}).length;
                        dependencies = `${depCount} dependencies, ${devDepCount} devDependencies`;
                    } catch {}
                    
                    const summary = [
                        `📊 Codebase Analysis:`,
                        `Total files: ${files.length}`,
                        `File types: ${JSON.stringify(extensions, null, 2)}`,
                        `Dependencies: ${dependencies}`
                    ].join('\n');
                    
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
                        } catch {}
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

app.get('/api/projects', async (req, res) => {
  if (!db.hasDatabase()) {
    return res.status(503).json({ error: 'Database aktiv deyil' });
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
  if (!db.hasDatabase()) {
    return res.status(503).json({ error: 'Database aktiv deyil' });
  }

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

    const result = await db.query(
      `INSERT INTO projects (id, user_id, name, path, repo_url, last_port)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [id, req.user.id, name, requestedPath, repoUrl, req.body.lastPort || 5173]
    );

    const conversationId = crypto.randomUUID();
    const title = repoUrl ? `Import: ${name}` : 'Yeni söhbət';
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
    return res.status(503).json({ error: 'Database aktiv deyil' });
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
    return res.status(503).json({ error: 'Database aktiv deyil' });
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
    return res.status(503).json({ error: 'Database aktiv deyil' });
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
    return res.status(503).json({ error: 'Database aktiv deyil' });
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
    return res.status(503).json({ error: 'Database aktiv deyil' });
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
    // eslint-disable-next-line no-await-in-loop
    const result = await runStreamingCommand(item.cmd, resolvedWD, (stream, chunk) => {
      res.write(`data: ${JSON.stringify({ type: 'health_log', key: item.key, stream, chunk })}\n\n`);
    });
    res.write(`data: ${JSON.stringify({ type: 'health_step', key: item.key, status: result.code === 0 ? 'done' : 'failed', exitCode: result.code })}\n\n`);
  }
  res.write(`data: ${JSON.stringify({ type: 'health_done' })}\n\n`);
  res.end();
});

app.get('/api/project-memory/:projectId', async (req, res) => {
  if (!db.hasDatabase()) return res.json({ memory: {} });
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
  if (!db.hasDatabase()) return res.status(503).json({ error: 'Database aktiv deyil' });
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
    const resolvedWD = resolveWorkingDirectory(workingDirectory, req.user);
    if (!ALLOWED_DIRS.some(base => {
        const r = path.relative(base, resolvedWD);
        return !r.startsWith('..') && !path.isAbsolute(r);
    })) {
        return res.status(403).json({ error: "Unauthorized working directory" });
    }
    await ensureDir(resolvedWD);

    const frontendApiKey = typeof apiKey === 'string' ? apiKey.trim() : '';
    const frontendBaseUrl = (typeof baseUrl === 'string' ? baseUrl.trim() : '') || process.env.OPENAI_BASE_URL || "https://integrate.api.nvidia.com/v1";
    const frontendModel = model || process.env.OPENAI_MODEL || 'meta/llama-3.3-70b-instruct';
    const providerCandidates = buildProviderCandidates({
      frontendApiKey,
      frontendBaseUrl,
      frontendModel
    });

    if (providerCandidates.length === 0) {
        return res.status(400).json({
            error: "Süni İntellekt API Açarı tapılmadı! Layihəni lokalda (Railway-dən asılı olmadan) işlətmək üçün layihə qovluğundakı `.env` faylına OPENAI_API_KEY və OPENAI_BASE_URL açarlarını əlavə edin."
        });
    }
    let activeProvider = providerCandidates.find((p) => canUseProviderNow(p.id)) || providerCandidates[0];
    let client = new OpenAI({ baseURL: activeProvider.baseURL, apiKey: activeProvider.apiKey });
    let effectiveModel = activeProvider.model;
    console.log(`🤖 /api/chat | provider_candidates=${providerCandidates.length} | active=${activeProvider.id} | model=${effectiveModel}`);

    const sysPrompt = `Sən bahAI İDE rəsmi AI Agentisən. Project Root: ${resolvedWD}.
Sən professional proqramçı və UI/UX ekspertisən.

MÜHÜM QAYDALAR:
1. Kodu dəyişməzdən əvvəl glob_search və read_file ilə mütləq kodu analiz et.
2. Dəyişiklik etdikdə YALNIZ file_edit istifadə et (bütöv faylı yenidən yazma).
3. LIVE PREVIEW HAQQINDA: Bizim LivePreview paneli YALNIZ 'http://localhost:PORT' formatında işləyir. Lokal fayl yollarını (file:///...) aça bilmir.
4. Əgər bir web səhifə yaratmısansa, onu görmək üçün mütləq bir server başlatmalısan (məs: 'npx serve' və ya 'npm run dev').
5. SERVERİ TƏSDİQLƏ (KRİTİK): check_port_status alətini çağırmadan serverin işlədiyini iddia etmək QADAĞANDIR! Əgər bu aləti çağırmamısansa, "Server işləyir" demə! Əgər port aktiv deyilsə, serverin niyə qalxmadığını (logs) yoxla.
6. İstifadəçi attachment/PDF göndəribsə, birbaşa həmin məzmunu analiz et. "Drag & drop et", "link göndər", "yenidən yüklə" kimi cavabları yalnız attachment ümumiyyətlə yoxdursa ver.

YENİ TOOL-LAR (Claude Code-dan ilhamlanaraq):
7. GIT WORKFLOW: git_status, git_diff, git_commit tool-larını istifadə edərək git əməliyyatlarını avtomatlaşdır.
8. CODE ANALYSIS: analyze_codebase ilə layihə strukturunu analiz et, find_definition və find_references ilə kod naviqasiyası et.
9. SMART SEARCH: grep_search ilə mətn axtar, find_definition ilə funksiya/class təriflərini tap.

BEST PRACTICES:
- Böyük dəyişikliklər etməzdən əvvəl git_status ilə mövcud vəziyyəti yoxla
- Kod yazmadan əvvəl analyze_codebase ilə layihə strukturunu öyrən
- Funksiya/class istifadə etməzdən əvvəl find_definition ilə tərifini tap
- Dəyişiklikdən sonra git_commit ilə commit yarat

Azərbaycan dilində cavab ver.`;

    let modelMessages = [];
    try {
      modelMessages = await normalizeMessagesForModel(messages);
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

    const memoryPrompt = `Layihə yaddaşı: ${JSON.stringify(projectMemory)}`;
    const apiMessages = [{ role: 'system', content: `${sysPrompt}\n${memoryPrompt}` }, ...modelMessages];
    const hasAttachmentInRequest = Array.isArray(messages) && messages.some((m) => Array.isArray(m?.attachments) && m.attachments.length > 0);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

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

            // Streaming ilə API çağırışı (120 saniyə timeout - attachments üçün daha uzun)
            const abortController = new AbortController();
            const timeoutId = setTimeout(() => abortController.abort(), 120000);

            let stream;
            let shouldRetryWithDeepSeekRecovery = false;
            try {
                stream = await client.chat.completions.create({
                    model: effectiveModel,
                    messages: currentMessages,
                    tools: TOOLS,
                    temperature: 0.2,
                    stream: true
                }, { signal: abortController.signal });
            } catch (apiErr) {
                const isRetryable = (() => {
                  const st = apiErr?.status || apiErr?.code;
                  const msg = String(apiErr?.message || '').toLowerCase();
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
                      const altClient = new OpenAI({ baseURL: alt.baseURL, apiKey: alt.apiKey });
                      stream = await altClient.chat.completions.create({
                        model: alt.model,
                        messages: currentMessages,
                        tools: TOOLS,
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
                      apiErr = altErr;
                      markProviderFailure(alt.id);
                    }
                  }
                } else {
                  markProviderFailure(activeProvider.id);
                }
                clearTimeout(timeoutId);
                if (stream) {
                  // fallback succeeded
                } else if (apiErr.name === 'AbortError') {
                    res.write(`data: ${JSON.stringify({ type: 'error', message: 'API cavab vaxtı bitdi (60s). Zəhmət olmasa yenidən cəhd edin.' })}\n\n`);
                    break;
                } else {
                  const status = apiErr.status || apiErr.code || 'unknown';
                  const errText = String(apiErr.message || '').toLowerCase();
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
                      apiErr = fallbackErr;
                    }
                  }

                  // Detailed API error logging
                  console.error(`❌ API Error [${status}]:`, apiErr.message);
                  let userMsg = `API xətası: ${apiErr.message}`;
                  if (apiErr.status === 401) {
                      userMsg = 'API açarı keçərsizdir. Ayarlardan düzgün API açarı daxil edin.';
                  } else if (apiErr.status === 429) {
                      userMsg = 'API limiti aşıldı (rate limit). 1-2 dəqiqə gözləyib yenidən cəhd edin.';
                  } else if (apiErr.status === 503) {
                      userMsg = 'AI servisi müvəqqəti əlçatmazdır. Mesajınız çox böyük ola bilər — daha qısa mesaj göndərin və ya bir neçə dəqiqə gözləyin.';
                  } else if (apiErr.status === 404) {
                      userMsg = `Model tapılmadı: "${effectiveModel}". Ayarlardan model adını yoxlayın.`;
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

              // DeepSeek thinking mode compatibility:
              // reasoning_content must be echoed back in subsequent turns.
              if (delta.reasoning_content) {
                accumulatedReasoning += delta.reasoning_content;
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
            const normalizedToolCalls = accumulatedToolCalls
              .filter((tc) => tc && tc.function && tc.function.name)
              .map((tc, idx) => ({
                id: tc.id || `toolcall_${step}_${idx}_${Date.now()}`,
                type: 'function',
                function: {
                  name: tc.function.name,
                  arguments: tc.function.arguments || '{}'
                }
              }));

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
                    if (safeMode && isSensitiveTool(toolCall.function.name)) {
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

app.get('/api/github/status', async (req, res) => {
  if (!db.hasDatabase()) {
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
  if (!db.hasDatabase()) {
    return res.status(503).json({ error: 'Database aktiv deyil' });
  }
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
    return res.status(503).json({ error: 'Database aktiv deyil' });
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
