// ==========================================
// Shared Helpers — extracted from index.js
// ==========================================

const path = require('path');
const fs = require('fs/promises');
const crypto = require('crypto');
const mammoth = require('mammoth');
const XLSX = require('xlsx');
const { createWorker } = require('tesseract.js');
const util = require('util');
const { execFile } = require('child_process');
const fs_raw = require('fs');

const execFileAsync = util.promisify(execFile);
const pdfParse = require('pdf-parse');
const { appendGuiRepairGuidance } = require('./gui/repairGuidance');

// Module-level state for WORKSPACE_ROOT, ALLOWED_DIRS — set once at startup
let WORKSPACE_ROOT = '';
let ALLOWED_DIRS = [];

function setAllowedDirs(workspaceRoot, allowedDirs) {
  WORKSPACE_ROOT = workspaceRoot;
  ALLOWED_DIRS = allowedDirs;
}

function getWorkspaceRoot() {
  return WORKSPACE_ROOT;
}

function getAllowedDirs() {
  return ALLOWED_DIRS;
}

// ==========================================
// Env / Config helpers
// ==========================================

function isLocalMode() {
  return process.env.LOCAL_MODE === 'true';
}

// Provider runtime for cooldown tracking / fallback routing
function createProviderRuntime(opts) {
  var cooldownMs = (opts && opts.providerCooldownMs) || 20000;
  var failureCounts = {};
  var cooldowns = {};
  return {
    markProviderFailure: function(providerId) {
      cooldowns[providerId] = Date.now() + cooldownMs;
      failureCounts[providerId] = (failureCounts[providerId] || 0) + 1;
    },
    markProviderSuccess: function(providerId) {
      failureCounts[providerId] = 0;
    },
    canUseProviderNow: function(providerId) {
      if (!providerId) return true;
      if ((failureCounts[providerId] || 0) >= 3) return false;
      return !cooldowns[providerId] || Date.now() > cooldowns[providerId];
    },
    getFailureCount: function(providerId) {
      return failureCounts[providerId] || 0;
    }
  };
}

var providerRuntime = createProviderRuntime({
  providerCooldownMs: parseInt(process.env.PROVIDER_COOLDOWN_MS || '20000', 10)
});

function shouldEmitDebugEvent() {
  return process.env.BAHAI_DEBUG_EVENTS === '1';
}

function looksLikeOllamaModel(modelId) {
  if (!modelId) return false;
  if (modelId.includes('/')) return false;
  if (/^gpt-/i.test(modelId)) return false;
  if (/^o[134]/i.test(modelId)) return false;
  if (/^claude/i.test(modelId)) return false;
  if (/^gemini/i.test(modelId)) return false;
  return modelId.includes(':') || /^(gemma|qwen|llama|deepseek|mistral|phi|codellama)/i.test(modelId);
}

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

function isCurrentFactsOrPublicWebsiteRequest(text = '') {
  const value = String(text || '').toLowerCase();
  const asksCurrentFact = /\b(bugün|bugun|bu gün|today|hazırda|hazirda|indi|current|latest|son|neçə|nece dərəcə|nece derece|qiymət|qiymet|hava|weather|temperature|stock|price)\b/i.test(value);
  const asksPublicWebsiteFact = /\b(site|sayt|website|web sayt|websayt|domain|laptopmarket|wix|trendyol|kontakt|baku electronics)\b/i.test(value);
  return asksCurrentFact || asksPublicWebsiteFact;
}

function isFileClarificationLoop(text = '') {
  return /(hansı faylı|fayl.*belirt|app\.py|read_file alətini|json formatında çağır|yolun doğru olduğunu yoxlayın|yalnız bir faylı audit)/i.test(String(text));
}

// ==========================================
// Tool naming / caching helpers
// ==========================================

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

function isSensitiveTool(toolName) {
  return toolName === 'write_file' || toolName === 'file_edit' || toolName === 'multi_file_edit' || toolName === 'run_terminal_command' || toolName === 'git_clone' || toolName === 'git_push' || toolName === 'start_server';
}

// ==========================================
// Recovery / error instruction builders
// ==========================================

function buildPhaseRecoveryInstruction(role, projectRoot, reason) {
  return [
    `${role || 'Agent'} fazasının əvvəlki cavabı kifayət qədər faydalı deyildi.`,
    `Səbəb: ${reason}.`,
    'Boş, ümumi və ya yalnız status tipli cavab vermə.',
    'Konkret nəticə çıxar: ya real tool çağır, ya da faydalı, yoxlanıla bilən məzmun yaz.',
    `Project Root: ${projectRoot}`
  ].join(' ');
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

// ==========================================
// User-facing error normalization
// ==========================================

function normalizeUserFacingError(message = '') {
  const text = String(message || '').trim();
  if (!text) return 'Naməlum xəta baş verdi.';
  if (/^Unknown tool:/i.test(text)) {
    return 'Agent uyğun tool seçə bilmədi. Daxili bərpa cəhdi edilir.';
  }
  if (/^Error executing tool: Unexpected token/i.test(text)) {
    return 'Tool üçün göndərilən argument forması düzgün deyildi. Daxili bərpa cəhdi edilir.';
  }
  if (/^Browser open error:/i.test(text)) {
    if (/Code:\s*chrome_missing/i.test(text)) {
      return 'Browser açıla bilmədi: bu mühitdə GUI üçün lazım olan Chrome tapılmadı. Lokal Mac-də real Chrome quraşdırılıbsa `persistent` və ya `cdp` mode istifadə edin; Railway/Linux mühitində isə əsasən bundled browser yolu işləyəcək.';
    }
    if (/Code:\s*playwright_missing/i.test(text)) {
      return 'Browser automation hazır deyil: Playwright dependency-si tapılmadı. GUI/browser workflow işləməsi üçün server mühitində Playwright quraşdırılmış olmalıdır.';
    }
    if (/Code:\s*cdp_unreachable/i.test(text)) {
      return 'Browser CDP bağlantısı qurulmadı. Deməli seçilmiş Chrome debug port-da əlçatan deyil. Lokalda Chrome-u remote debugging ilə açın və ya browser mode-u `persistent` / `bundled` edin.';
    }
    if (/context management is not supported|Browser\.setDownloadBehavior/i.test(text)) {
      return 'Chrome açıldı, amma bu CDP sessiyası tam idarə olunan automation context vermədi. Bu halda `persistent` mode daha sabit seçimdir.';
    }
    return 'Browser açıla bilmədi. GUI capability status-a baxın: Chrome, Playwright və browser mode uyğunluğu yoxlanmalıdır.';
  }
  if (/^Screen (open_url|screenshot|click|type|press|scroll) error:/i.test(text)) {
    if (/ENOENT|python3/i.test(text)) {
      return 'Screen agent hazır deyil: lokal `.venv` Python və screen automation asılılıqları tapılmadı. Bu capability indi yalnız uyğun lokal desktop mühitində işləyir.';
    }
    if (/open ENOENT/i.test(text)) {
      return 'Screen agent bu server mühitində real desktop browser aça bilmir. `screen_*` alətləri Railway/Linux serverində yox, lokal masaüstü mühitdə nəzərdə tutulub.';
    }
    return 'Screen automation alınmadı. Bu capability yalnız uyğun lokal desktop mühitində etibarlı işləyir.';
  }
  if (/^GUI (observe|act|step) error:/i.test(text) && /Browser open error:/i.test(text)) {
    return 'GUI addımı browser sessiyasına bağlana bilmədi. Əvvəl browser launch capability-sini düzəltmək lazımdır.';
  }
  return appendGuiRepairGuidance(text);
}

// ==========================================
// Final assistant report normalization
// ==========================================

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
    productMode = 'desktop_code',
    auditStyleRequest = false,
    plannerArtifact = null,
    executionArtifacts = [],
    executionMemory = null
  } = context;

  const isWebChatProduct = productMode === 'web_chat';
  const hasPlannerMaterial = Boolean(
    plannerArtifact?.summary ||
    (Array.isArray(plannerArtifact?.implementationSteps) && plannerArtifact.implementationSteps.length > 0) ||
    (Array.isArray(plannerArtifact?.verificationSteps) && plannerArtifact.verificationSteps.length > 0) ||
    (Array.isArray(plannerArtifact?.suspectedRisks) && plannerArtifact.suspectedRisks.length > 0)
  );
  const hasExecutionMaterial = Array.isArray(executionArtifacts) && executionArtifacts.length > 0;
  if (isWebChatProduct || (!auditStyleRequest && !hasPlannerMaterial && !hasExecutionMaterial)) {
    return text;
  }

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

function flattenResponseJsonText(text = '') {
  if (typeof text !== 'string') return text;
  const match = text.trim().match(/^\s*\{\s*"response"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"\s*\}\s*$/);
  if (!match || !match[1]) return text;
  return match[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\').trim();
}

// ==========================================
// Path / directory helpers
// ==========================================

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

  if (!path.isAbsolute(cleanWd) && !cleanWd.includes('\\\\') && !cleanWd.includes(':')) {
    return path.resolve(userRoot, safeSegment(cleanWd));
  }

  if (process.platform === 'linux' && (cleanWd.startsWith('/Users/') || cleanWd.startsWith('/home/') || cleanWd.includes('\\\\') || cleanWd.includes(':'))) {
    const folderName = safeSegment(cleanWd);
    const sandboxPath = path.resolve(userRoot, folderName);
    const legacyPath = path.resolve(WORKSPACE_ROOT, folderName || 'default');

    const fsExtra = require('fs');

    if (user && user.id && !fsExtra.existsSync(sandboxPath) && fsExtra.existsSync(legacyPath)) {
      try {
        console.log(`📦 MIGRATING legacy sandbox from ${legacyPath} to ${sandboxPath}...`);
        fsExtra.renameSync(legacyPath, sandboxPath);
      } catch (err) {
        console.error("Failed to migrate legacy sandbox folder:", err);
      }
    }

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

function isPathSafe(filePath, workingDirectory, user) {
  const resolvedWD = resolveWorkingDirectory(workingDirectory, user);
  if (!resolvedWD) return false;
  const resolvedBase = path.resolve(resolvedWD);
  const resolvedPath = path.resolve(filePath);

  const rel = path.relative(resolvedBase, resolvedPath);
  const isInsideProject = !rel.startsWith('..') && !path.isAbsolute(rel);

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

// ==========================================
// GitHub helpers
// ==========================================

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
  const db = require('./db');
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

async function readLocalDb() {
  try {
    const data = await fs.readFile(path.resolve(__dirname, '../sandbox/local_db.json'), 'utf8').catch(() => '{}');
    return JSON.parse(data);
  } catch { return {}; }
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

// ==========================================
// Repo detection helpers
// ==========================================

async function detectRepoProfile(analyzePath) {
  const candidates = [
    'package.json', 'pnpm-lock.yaml', 'yarn.lock', 'package-lock.json',
    'bun.lockb', 'bun.lock', 'pnpm-workspace.yaml', 'turbo.json', 'nx.json',
    'tsconfig.json', 'vite.config.ts', 'vite.config.js', 'next.config.js',
    'next.config.mjs', 'nest-cli.json', 'requirements.txt', 'pyproject.toml',
    'pytest.ini', 'Cargo.toml', 'go.mod', 'Dockerfile'
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

  const scripts = packageJson?.scripts || {};
  const buildCommand = scripts.build || (ecosystem === 'Python' ? 'python -m build (əgər qurulubsa)' : '') || (ecosystem === 'Rust' ? 'cargo build' : '') || (ecosystem === 'Go' ? 'go build ./...' : '') || '';
  const testCommand = scripts.test || (ecosystem === 'Python' ? 'python -m pytest --tb=short' : '') || (ecosystem === 'Rust' ? 'cargo test' : '') || (ecosystem === 'Go' ? 'go test ./...' : '') || '';

  const entryCandidates = ['src/main.tsx', 'src/main.ts', 'src/App.tsx', 'src/App.jsx', 'src/index.ts', 'src/index.js', 'index.js', 'server.js', 'app.js', 'main.py'];
  const entryPoints = [];
  for (const candidate of entryCandidates) {
    if (await fileExists(path.join(analyzePath, candidate))) entryPoints.push(candidate);
    if (entryPoints.length >= 4) break;
  }

  return {
    ecosystem, packageManager, repoShape, workspaceSignals, frameworks,
    packageJson, buildCommand, testCommand, lintCommand: scripts.lint || '',
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

// ==========================================
// Validation plan builders
// ==========================================

function isPlaceholderTestScript(script = '') {
  const value = String(script || '').trim().toLowerCase();
  return (!value || value.includes('no test specified') || value === 'exit 1');
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

function buildValidationHint(repoProfile = {}) {
  const hints = [];
  if (repoProfile.buildCommand) hints.push(`build: ${repoProfile.buildCommand}`);
  if (repoProfile.testCommand) hints.push(`test: ${repoProfile.testCommand}`);
  if (repoProfile.lintCommand) hints.push(`lint: ${repoProfile.lintCommand}`);
  if (hints.length === 0) return '';
  return `Tövsiyə olunan validation komandaları -> ${hints.join(' | ')}`;
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
    steps.push({ kind, label: kind === 'typecheck' ? 'type-check' : kind, command: normalized, reason: String(reason || '').trim() });
  };

  if (ecosystem === 'Node.js') {
    if (scripts.lint) pushStep('lint', buildNodeScriptCommand(packageManager, 'lint'), 'package.json içində lint script tapıldı');
    if (scripts.typecheck) pushStep('typecheck', buildNodeScriptCommand(packageManager, 'typecheck'), 'package.json içində typecheck script tapıldı');
    else if (scripts['check-types']) pushStep('typecheck', buildNodeScriptCommand(packageManager, 'check-types'), 'package.json içində check-types script tapıldı');
    else if (scripts.typescript) pushStep('typecheck', buildNodeScriptCommand(packageManager, 'typescript'), 'package.json içində typescript script tapıldı');
    else if (repoProfile?.foundConfigs?.includes('tsconfig.json')) pushStep('typecheck', 'npx tsc --noEmit', 'tsconfig.json tapıldığı üçün TypeScript yoxlaması əlavə edildi');

    if (scripts.test && !isPlaceholderTestScript(scripts.test)) pushStep('test', buildNodeScriptCommand(packageManager, 'test', extraArgs), 'package.json içində test script tapıldı');
    else if (repoProfile?.frameworks?.includes('Vitest')) pushStep('test', filterArg ? `npx vitest --run ${quoteShellArg(filterArg)}` : 'npx vitest --run', 'Vitest dependency siqnalı tapıldı');
    else if (repoProfile?.frameworks?.includes('Jest')) pushStep('test', filterArg ? `npx jest --runInBand ${quoteShellArg(filterArg)}` : 'npx jest --runInBand', 'Jest dependency siqnalı tapıldı');

    if (scripts.build) pushStep('build', buildNodeScriptCommand(packageManager, 'build'), 'package.json içində build script tapıldı');
  } else if (ecosystem === 'Python') {
    // ... simplified for Python
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

  return { ecosystem, packageManager, repoShape: repoProfile?.repoShape || 'Unknown', steps };
}

function formatValidationReport(plan, results = []) {
  const header = [`Validation planı: ${plan?.ecosystem || 'Unknown'} / ${plan?.packageManager || 'Unknown'} / ${plan?.repoShape || 'Unknown'}`];
  if (!results.length) {
    return `${header.join('\n')}\nValidation üçün uyğun komanda tapılmadı.`;
  }
  const body = results.map((result, index) => {
    const lines = [`${index + 1}. ${result.label} [${result.status}]`, `Komanda: ${result.command}`];
    if (result.reason) lines.push(`Səbəb: ${result.reason}`);
    if (result.output) lines.push(`Çıxış:\n${result.output}`);
    return lines.join('\n');
  });
  return `🧪 Validation nəticələri:\n${header.join('\n')}\n\n${body.join('\n\n')}`.trim();
}

// ==========================================
// Attachment extraction helpers
// ==========================================

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
    const lines = rows.slice(0, 500).map((row) => Array.isArray(row) ? row.map((c) => String(c ?? '')).join('\t') : String(row)).join('\n');
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
  const buffer = isBase64 ? Buffer.from(payload, 'base64') : Buffer.from(decodeURIComponent(payload), 'utf8');
  return { mimeType, buffer };
}

async function extractAttachment(attachment) {
  if (attachment?.extractedText && typeof attachment.extractedText === 'string') {
    return { name: attachment?.name || 'attachment', mimeType: attachment?.mimeType || attachment?.type || 'application/octet-stream', extractedText: attachment.extractedText.slice(0, 50000), imageUrl: attachment?.imageUrl };
  }

  const decoded = decodeDataUrl(attachment?.url);
  const mimeType = attachment?.mimeType || decoded?.mimeType || attachment?.type || 'text/plain';
  const name = attachment?.name || 'attachment';

  try {
    if (!decoded) return { name, mimeType, extractedText: '' };

    const lowerName = name.toLowerCase();
    const buf = decoded.buffer;

    if (mimeType === 'application/pdf' || lowerName.endsWith('.pdf')) {
      try { const data = await pdfParse(buf); return { name, mimeType, extractedText: (data?.text || '').slice(0, 50000) }; }
      catch (e) { return { name, mimeType, extractedText: '', extractionError: `PDF parse xətası: ${e.message}` }; }
    }

    if (mimeType.includes('officedocument.wordprocessingml') || lowerName.endsWith('.docx')) {
      try { const text = await extractDocxText(buf); return { name, mimeType, extractedText: (text || '').slice(0, 50000) }; }
      catch (e) { return { name, mimeType, extractedText: '', extractionError: `DOCX parse xətası: ${e.message}` }; }
    }

    if (mimeType.includes('spreadsheetml') || mimeType.includes('ms-excel') || lowerName.endsWith('.xlsx') || lowerName.endsWith('.xls') || lowerName.endsWith('.csv')) {
      try { const text = extractSpreadsheetText(buf); return { name, mimeType, extractedText: (text || '').slice(0, 50000) }; }
      catch (e) { return { name, mimeType, extractedText: '', extractionError: `Cədvəl parse xətası: ${e.message}` }; }
    }

    if (mimeType.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp|tiff)$/i.test(name)) {
      try { const text = await extractImageText(buf); return { name, mimeType, extractedText: (text || '').slice(0, 50000) }; }
      catch (e) { return { name, mimeType, extractedText: '', extractionError: `Image OCR xətası: ${e.message}` }; }
    }

    if (mimeType.startsWith('text/') || mimeType.includes('json') || mimeType.includes('xml') || mimeType.includes('javascript') || mimeType.includes('typescript') || /\.(txt|json|csv|md|yaml|yml|xml|log|env|js|ts|jsx|tsx|py|html|css|sh|toml|ini|cfg|conf)$/i.test(name)) {
      const text = buf.toString('utf8');
      return { name, mimeType, extractedText: text.slice(0, 50000) };
    }

    return { name, mimeType, extractedText: `[Dəstəklənməyən fayl növü: ${name}. Dəstəklənənlər: PDF, DOCX, XLSX, CSV, şəkillər (OCR), və mətn faylları.]` };
  } catch (error) {
    console.error('Attachment parse xətası:', name, error?.message || error);
    return { name, mimeType, extractedText: `[Attachment oxunarkən xəta: ${name}]` };
  }
}

// ==========================================
// Message normalization helpers
// ==========================================

async function normalizeMessagesForModel(messages = [], modelName = '', TOOLS = []) {
  const normalized = [];
  const isLocalOrFlakyModel = isLocalMode() || !modelName || /qwen|ollama|deepseek|llama|local|free|nemotron/i.test(modelName);

  for (const message of messages) {
    if (!message) continue;
    let content = message.content || '';
    let role = message.role;
    let tool_calls = message.tool_calls;
    let tool_call_id = message.tool_call_id;
    let name = message.name;

    if (message.attachments?.length) {
      const textParts = [content, '[Sistem qeydi: İstifadəçi artıq attachment göndərib. Yenidən upload/drag-drop/link istəmədən mövcud attachment məzmununu analiz et.]'];
      const results = await Promise.all(message.attachments.map(async (attachment) => {
        if (attachment?.extractedText && typeof attachment.extractedText === 'string' && attachment.extractedText.trim()) {
          return `\n\n[Attachment: ${attachment.name || 'attachment'} | ${attachment.mimeType || attachment.type || 'unknown'}]\n${attachment.extractedText.slice(0, 6000)}`;
        }
        if (attachment?.extractionError) return `\n\n[Attachment: ${attachment?.name || 'attachment'}]\nOxuma xətası: ${attachment.extractionError}`;
        if (!attachment?.url || attachment.url === '') return `\n\n[Attachment: ${attachment?.name || 'attachment'} | ${attachment?.mimeType || 'unknown'}]\nFayl əlavə olunub, amma məzmunu çıxarıla bilmədi.`;
        let extracted;
        try { extracted = await extractAttachment(attachment); }
        catch (error) { extracted = { name: attachment?.name || 'attachment', mimeType: attachment?.mimeType || attachment?.type || 'application/octet-stream', extractedText: `[Attachment emalında xəta: ${attachment?.name || 'attachment'}]` }; }
        if (extracted.extractedText) return `\n\n[Attachment: ${extracted.name} | ${extracted.mimeType}]\n${extracted.extractedText.slice(0, 6000)}`;
        return `\n\n[Attachment: ${attachment?.name || extracted.name || 'attachment'} | ${attachment?.mimeType || extracted.mimeType || 'unknown'}]\nMətn çıxarıla bilmədi, amma fayl əlavə olunub.`;
      }));
      textParts.push(...results);
      content = textParts.join('\n').trim();
    }

    if (isLocalOrFlakyModel) {
      if (role === 'assistant' && tool_calls && tool_calls.length > 0) {
        let toolCallText = '';
        for (const tc of tool_calls) {
          toolCallText += `\n\`\`\`json\n{\n  "name": "${tc.function.name}",\n  "arguments": ${tc.function.arguments || '{}'}\n}\n\`\`\``;
        }
        if (!tool_calls.some(tc => content.includes(tc.function.name))) {
          content = (content + '\n' + toolCallText).trim();
        }
      } else if (role === 'tool') {
        const toolName = name || 'Alət';
        content = `📥 [Alət Nəticəsi (${toolName})]:\n${content}`;
        role = 'user';
        tool_call_id = undefined;
        name = undefined;
      }

      if (role === 'assistant' && typeof content === 'string') {
        const responseMatch = content.match(/\{\s*"response"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"\s*\}/);
        if (responseMatch && responseMatch[1]) {
          content = content.replace(responseMatch[0], responseMatch[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\'));
        }
        content = content.replace(/Layihə yaddaşı:\s*\{[\s\S]*?\}\n*/g, '').trim();
      }
    }

    normalized.push({
      role, content,
      tool_calls: isLocalOrFlakyModel ? undefined : (tool_calls?.length ? tool_calls : undefined),
      tool_call_id: isLocalOrFlakyModel ? undefined : tool_call_id,
      name: isLocalOrFlakyModel ? undefined : name
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

function generateToolsSystemPrompt(activeTools = []) {
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
  prompt += `\nNÜMUNƏ: İstifadəçi "qovluğu oxu" deyirsə:\n\`\`\`json\n{"name": "list_directory", "arguments": {"path": "./"}}\n\`\`\`\n\nQAYDA: Tam yol verilibsə (məs. /Users/.../proj), həmin yolu eyniylə path-da istifadə et — kor-koranə "./" yazma.\n`;
  return prompt;
}

function buildDeepSeekRecoveryMessages(messages = []) {
  if (!Array.isArray(messages) || messages.length === 0) return [];
  const sys = messages.find((m) => m?.role === 'system');
  const recent = messages.filter((m) => m && (m.role === 'user' || m.role === 'assistant')).slice(-8).map((m) => ({ role: m.role, content: typeof m.content === 'string' ? m.content : '' }));
  if (sys) return [{ role: 'system', content: typeof sys.content === 'string' ? sys.content : '' }, ...recent];
  return recent;
}

function extractTextToolCalls(text, activeTools = []) {
  if (!text) return { cleanedText: text, toolCalls: [] };
  const toolCalls = [];
  const removed = [];

  const blockRegex = /```(?:json)?\s*(\{[\s\S]*?\})\s*```/ig;
  let m;
  while ((m = blockRegex.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(m[1]);
      if (parsed && typeof parsed.name === 'string' && parsed.arguments !== undefined && activeTools.some((t) => t.function.name === parsed.name)) {
        toolCalls.push({ name: parsed.name, arguments: typeof parsed.arguments === 'object' ? JSON.stringify(parsed.arguments) : String(parsed.arguments) });
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
      let braceCount = 0, inString = false, escape = false, endIndex = startIdx, found = false;
      for (; endIndex < text.length; endIndex++) {
        const ch = text[endIndex];
        if (escape) { escape = false; continue; }
        if (ch === '\\') { escape = true; continue; }
        if (ch === '"') { inString = !inString; continue; }
        if (inString) continue;
        if (ch === '{') braceCount++;
        else if (ch === '}') { braceCount--; if (braceCount === 0) { endIndex++; found = true; break; } }
      }
      if (!found) break;
      const candidate = text.substring(startIdx, endIndex);
      try {
        const parsed = JSON.parse(candidate);
        if (parsed && typeof parsed === 'object' && typeof parsed.name === 'string' && parsed.arguments !== undefined && activeTools.some((t) => t.function.name === parsed.name)) {
          toolCalls.push({ name: parsed.name, arguments: typeof parsed.arguments === 'object' ? JSON.stringify(parsed.arguments) : String(parsed.arguments) });
          removed.push([startIdx, endIndex]);
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

// ==========================================
// Serializers
// ==========================================

function serializeProject(row) {
  return { id: row.id, name: row.name, path: row.path, repoUrl: row.repo_url || undefined, lastPort: row.last_port || undefined, archived: Boolean(row.archived), createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now() };
}

function serializeConversation(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    messages: Array.isArray(row.messages) ? row.messages : [],
    archived: Boolean(row.archived),
    lastMessageAt: row.last_message_at ? new Date(row.last_message_at).getTime() : undefined,
    preview: row.preview || undefined,
    messageCount: typeof row.message_count === 'number' ? row.message_count : undefined,
    messagesLoaded: Array.isArray(row.messages) && row.messages.length > 0,
    createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
    updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : Date.now()
  };
}

// ==========================================
// Diff helpers
// ==========================================

function makeUnifiedDiff(oldContent, newContent, filePath) {
  const oldLines = String(oldContent || '').split('\n');
  const newLines = String(newContent || '').split('\n');
  const max = Math.max(oldLines.length, newLines.length);
  const diff = [`--- a/${filePath}`, `+++ b/${filePath}`];
  for (let i = 0; i < max; i += 1) {
    const oldLine = oldLines[i], newLine = newLines[i];
    if (oldLine === newLine) continue;
    if (oldLine !== undefined) diff.push(`-${oldLine}`);
    if (newLine !== undefined) diff.push(`+${newLine}`);
  }
  return diff.join('\n');
}

function truncatePreview(value = '', max = 280) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max)}...`;
}

function summarizeDiff(diffText = '') {
  const lines = String(diffText || '').split('\n');
  let added = 0, removed = 0;
  const preview = [];
  for (const line of lines) {
    if (line.startsWith('+++') || line.startsWith('---')) continue;
    if (line.startsWith('+')) added += 1;
    if (line.startsWith('-')) removed += 1;
    if ((line.startsWith('+') || line.startsWith('-')) && preview.length < 16) preview.push(line);
  }
  return { added, removed, preview: preview.join('\n') };
}

// ==========================================
// Approval metadata builder
// ==========================================

async function buildApprovalMetadata(toolName, rawArgs, workingDirectory, user) {
  let parsedArgs = {};
  try { parsedArgs = JSON.parse(rawArgs || '{}'); } catch { parsedArgs = {}; }

  const metadata = { riskLevel: 'medium', reason: 'Bu əməliyyat workspace və ya sistem vəziyyətini dəyişə bilər.', title: toolName, summary: '', preview: '', path: '', command: '', diffPreview: '', diffStats: null };

  if (toolName === 'run_terminal_command') {
    const command = String(parsedArgs.command || '').trim();
    const destructive = /\b(rm|mv|chmod|chown|git reset|git clean|sudo|dd)\b/i.test(command);
    metadata.riskLevel = destructive ? 'high' : 'medium';
    metadata.reason = destructive ? 'Terminal komandası faylları silə, dəyişə və ya sistemə təsir edə bilər.' : 'Terminal komandası layihə fayllarını və ya prosesləri dəyişə bilər.';
    metadata.title = 'Terminal command';
    metadata.command = command;
    metadata.summary = command || 'Terminal command';
    metadata.preview = truncatePreview(command || 'Komanda göstərilməyib');
  } else if (toolName === 'write_file' || toolName === 'file_edit' || toolName === 'multi_file_edit') {
    const targetPath = parsedArgs.path || parsedArgs.file || parsedArgs.cwd || '';
    const contentPreview = parsedArgs.replacement_content || parsedArgs.content || parsedArgs.target_content || '';
    metadata.riskLevel = 'high';
    metadata.reason = 'Bu əməliyyat fayl məzmununu dəyişəcək.';
    metadata.title = toolName === 'write_file' ? 'Write file' : 'Edit file';
    metadata.path = targetPath ? path.resolve(workingDirectory, targetPath) : '';
    metadata.summary = targetPath || 'Fayl dəyişikliyi';
    metadata.preview = truncatePreview(contentPreview || 'Məzmun preview yoxdur');

    try {
      if (toolName === 'multi_file_edit' && Array.isArray(parsedArgs.edits) && parsedArgs.edits.length > 0) {
        var diffs = [];
        for (var ei = 0; ei < Math.min(parsedArgs.edits.length, 3); ei++) {
          var edit = parsedArgs.edits[ei];
          var editPath = path.resolve(workingDirectory, edit.path || '');
          if (!isPathSafe(editPath, workingDirectory, user)) continue;
          var oldContent = await fs.readFile(editPath, 'utf8').catch(function() { return ''; });
          var newContent = String(oldContent).replace(edit.target_content, edit.replacement_content);
          var diff = makeUnifiedDiff(oldContent, newContent, edit.path || editPath);
          var summary = summarizeDiff(diff);
          if (summary.preview) {
            diffs.push('# ' + (edit.path || editPath) + '\n' + summary.preview);
            metadata.diffStats = {
              added: (metadata.diffStats ? metadata.diffStats.added : 0) + summary.added,
              removed: (metadata.diffStats ? metadata.diffStats.removed : 0) + summary.removed
            };
          }
        }
        metadata.diffPreview = diffs.join('\n');
      } else if (metadata.path && isPathSafe(metadata.path, workingDirectory, user)) {
        var oldContent = await fs.readFile(metadata.path, 'utf8').catch(function() { return ''; });
        var newContent = toolName === 'write_file'
          ? String(parsedArgs.content || '')
          : String(oldContent).replace(parsedArgs.target_content || '', parsedArgs.replacement_content || '');
        var diff = makeUnifiedDiff(oldContent, newContent, targetPath || metadata.path);
        var summary = summarizeDiff(diff);
        metadata.diffPreview = summary.preview;
        metadata.diffStats = { added: summary.added, removed: summary.removed };
      }
    } catch { /* ignore */ }
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

// ==========================================
// Bash safety
// ==========================================

// SEC-FIX: Allowed commands for run_terminal_command. Destructive commands (rm, mv,
// sudo, chmod, chown, dd, shutdown, reboot, mkfs, fdisk, dd, wget, curl with -o/-O)
// are intentionally excluded. For file deletion the agent should use the file tool.
const ALLOWED_COMMANDS = ['npm', 'npx', 'yarn', 'git', 'node', 'python', 'python3', 'pip', 'ls', 'pwd', 'mkdir', 'touch', 'grep', 'find', 'cat', 'echo', 'cp', 'curl', 'which', 'env'];

// SEC-FIX: Dangerous patterns that are blocked regardless of base command.
// Covers file destruction, privilege escalation, network pivots and fork bombs.
const DENIED_PATTERNS = [
  /\brm\s+-[rf]/i,           // rm -rf (recursive forced delete)
  /\bsudo\b/i,                 // privilege escalation
  /\bchmod\s+[0-7]{3,4}/i,     // permission changes
  /\bchown\b/i,                // owner changes
  /\bdd\s+if=/i,                // disk destroy
  /\b(?:shutdown|reboot|halt|poweroff)\b/i,  // system control
  /\bmkfs\./,                  // filesystem creation (destructive)
  /\bfdisk\b/,                  // partition table
  /\b>:\s*\//,                  // redirect to root
  /\bwget\s+.*\s+-[a-z]*o\b/i,   // wget with output file
  /\bcurl\s+.*\s+-[a-z]*o\b/i,   // curl with -o / -O (output file)
  /\bcurl\b.*--output\b/i,       // curl with --output (no \s+ needed, -- has no word boundary before)
  /:\s*\)\s*\{.*:\s*\)\s*\}/, // fork bomb
  /\b(?:\/dev\/(?:null|zero|random|urandom))/, // device access
];

function isBashCommandSafe(command) {
  const trimmed = String(command || '').trim();
  if (!trimmed) return false;

  // Block shell metacharacters that enable multi-command / injection
  // Blocked: ; & | ` $ ( ) { } < > \n \r
  const unsafeChars = /[;&|`$(){}<>\n\r]/;
  if (unsafeChars.test(trimmed)) return false;

  // Block dangerous patterns irrespective of base command
  for (const pattern of DENIED_PATTERNS) {
    if (pattern.test(trimmed)) return false;
  }

  const baseCmd = trimmed.split(/\s+/)[0];
  return ALLOWED_COMMANDS.includes(baseCmd) || trimmed.startsWith('npm run') || trimmed.startsWith('npx ');
}

// ==========================================
// Response API mapping
// ==========================================

function mapMessagesToResponsesInput(messages = []) {
  const input = [];
  for (const message of messages) {
    if (!message || !message.role) continue;
    if (message.role === 'tool') {
      const callId = String(message.tool_call_id || '').trim();
      if (!callId) continue;
      input.push({ type: 'function_call_output', call_id: callId, output: String(message.content || '') });
      continue;
    }
    if (message.role === 'assistant' && Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
      for (const toolCall of message.tool_calls) {
        const callId = String(toolCall.id || toolCall.call_id || '').trim();
        if (!callId) continue;
        input.push({ type: 'function_call', call_id: callId, name: toolCall.function?.name || '', arguments: toolCall.function?.arguments || '{}' });
      }
    }
    const contentParts = [];
    if (typeof message.content === 'string' && message.content.trim()) {
      contentParts.push({ type: 'input_text', text: message.content });
    }
    if (contentParts.length > 0) {
      input.push({ role: message.role, content: contentParts });
    }
  }
  return input;
}

function mapToolsToResponsesTools(tools = []) {
  return tools.map((tool) => ({ type: 'function', name: tool.function.name, description: tool.function.description, parameters: tool.function.parameters }));
}

// ==========================================
// Execution memory helpers
// ==========================================

function buildExecutionMemoryHint(projectMemory = {}) {
  const lines = [];
  const lastValidation = projectMemory?.lastValidation;
  const lastApprovalDecision = projectMemory?.lastApprovalDecision;
  const lastBrowserArtifact = projectMemory?.lastBrowserArtifact;
  const lastTerminalArtifact = projectMemory?.lastTerminalArtifact;
  const lastRuntimeArtifact = projectMemory?.lastRuntimeArtifact;

  if (lastValidation?.status) lines.push(`Son validation statusu: ${lastValidation.status}. ${String(lastValidation.summary || '').slice(0, 240)}`);
  if (lastApprovalDecision?.decision) lines.push(`Son approval qərarı: ${lastApprovalDecision.decision} | tool=${lastApprovalDecision.title || lastApprovalDecision.tool || 'unknown'} | risk=${lastApprovalDecision.riskLevel || 'medium'}`);
  if (lastBrowserArtifact?.toolName) lines.push(`Son browser artifact: tool=${lastBrowserArtifact.toolName} | summary=${String(lastBrowserArtifact.summary || '').slice(0, 180)}`);
  if (lastTerminalArtifact?.command || lastTerminalArtifact?.summary) lines.push(`Son terminal artifact: ${String(lastTerminalArtifact.command || lastTerminalArtifact.summary || '').slice(0, 180)}`);
  if (lastRuntimeArtifact?.kind === 'browser' && lastRuntimeArtifact?.status) lines.push(`Son GUI runtime statusu: ${lastRuntimeArtifact.status} | ${String(lastRuntimeArtifact.summary || '').slice(0, 180)}`);

  if (lines.length === 0) return '';
  return `Execution yaddaşı:\n${lines.join('\n')}`;
}

function buildCompactProjectMemory(projectMemory = {}) {
  if (!projectMemory || typeof projectMemory !== 'object') return {};
  return {
    latestPrompt: projectMemory.latestPrompt || '',
    latestGoal: projectMemory.latestGoal || '',
    repoProfile: projectMemory.repoProfile ? {
      ecosystem: projectMemory.repoProfile.ecosystem || '',
      packageManager: projectMemory.repoProfile.packageManager || '',
      frameworks: projectMemory.repoProfile.frameworks || [],
      buildCommand: projectMemory.repoProfile.buildCommand || '',
      testCommand: projectMemory.repoProfile.testCommand || '',
      lintCommand: projectMemory.repoProfile.lintCommand || ''
    } : undefined,
    lastValidation: projectMemory.lastValidation || undefined,
    activeGuiSession: projectMemory.activeGuiSession || undefined,
    guiCapabilities: projectMemory.guiCapabilities ? { summary: projectMemory.guiCapabilities.summary || {}, warnings: projectMemory.guiCapabilities.warnings || [] } : undefined
  };
}

module.exports = {
  // Config
  setAllowedDirs, getWorkspaceRoot, getAllowedDirs,
  isLocalMode, shouldEmitDebugEvent,
  looksLikeOllamaModel, parseProviderPoolFromEnv,
  classifyTaskComplexity, isAuditStyleRequest,
  isCurrentFactsOrPublicWebsiteRequest, isFileClarificationLoop,

  // Tool helpers
  normalizeToolName, buildToolCallCacheKey, isCacheableTool, isSensitiveTool,

  // Instruction builders
  buildPhaseRecoveryInstruction, buildToolRecoveryInstruction,
  normalizeUserFacingError,

  // Report helpers
  normalizeFinalAssistantReport, flattenResponseJsonText,

  // Path helpers
  safeSegment, ensureDir,
  getUserWorkspaceRoot, resolveWorkingDirectory,
  isWorkingDirectoryAllowed, isPathSafe, fileExists,
  mapPath: (originalPath, originalWD, resolvedWD) => {
    if (!originalPath) return resolvedWD;
    const resolvedOrigWD = path.resolve(originalWD || '.');
    const resolvedReqPath = path.isAbsolute(originalPath) ? path.resolve(originalPath) : path.resolve(resolvedOrigWD, originalPath);
    if (resolvedOrigWD === resolvedWD) return resolvedReqPath;
    const rel = path.relative(resolvedOrigWD, resolvedReqPath);
    return path.resolve(resolvedWD, rel);
  },

  // GitHub
  encryptSecret,  decryptSecret, injectGithubTokenIntoUrl, getUserGithubToken, readLocalDb,

  // Repo detection
  detectRepoProfile, serializeRepoProfile,

  // Validation
  buildValidationHint, buildValidationPlan, formatValidationReport,

  // Attachment extraction
  readPdfFile, extractDocxText, extractSpreadsheetText,
  extractImageText, decodeDataUrl, extractAttachment,

  // Message normalization
  normalizeMessagesForModel, generateToolsSystemPrompt,
  buildDeepSeekRecoveryMessages, extractTextToolCalls,

  // Serializers
  serializeProject, serializeConversation,

  // Diff
  makeUnifiedDiff, truncatePreview, summarizeDiff,

  // Approval
  buildApprovalMetadata,

  // Provider runtime
  createProviderRuntime, providerRuntime,

  // Error helpers
  normalizeUserFacingError, appendGuiRepairGuidance,

  // Bash safety
  isBashCommandSafe,

  // API mapping
  mapMessagesToResponsesInput, mapToolsToResponsesTools,

  // Execution memory
  buildExecutionMemoryHint, buildCompactProjectMemory,

  // File system
  fs, path, crypto, execFileAsync, spawn: require('child_process').spawn,
  glob: require('glob').glob
};
