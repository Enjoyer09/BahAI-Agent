require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { OpenAI } = require('openai');
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { exec, execFile, spawn } = require('child_process');
const util = require('util');
const { glob } = require('glob');

const execFileAsync = util.promisify(execFile);
const pdfParse = require('pdf-parse');


const app = express();
const db = require('./db');
const { router: authRoutes, verifyToken } = require('./auth');

// Initialize Database
db.initDb();

// SEC-7: Restrict CORS
app.use(cors());
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || '15mb' }));

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

function sanitizeAttachmentFallbackReply(content, hasAttachments) {
  if (!hasAttachments || typeof content !== 'string') return content;
  const text = content.toLowerCase();
  const retryPatterns = [
    'drag & drop',
    'drag and drop',
    'link göndərin',
    'copy-paste',
    'yenidən yüklə',
    'yenidən upload',
    'faylı buraya sürüşdür',
    'pdf-i haradan'
  ];
  const asksToReupload = retryPatterns.some((p) => text.includes(p));
  if (!asksToReupload) return content;
  return [
    'PDF faylı artıq sistemə əlavə olunub; yenidən upload tələb etmirəm.',
    'Hazır fayl üzərindən analiz etməyə davam edirəm. Əgər mətn çıxarışı boşdursa, bunu səbəbi ilə birlikdə bildirəcəyəm.'
  ].join(' ');
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
  const mimeType = attachment?.mimeType || decoded?.mimeType || attachment?.type || 'application/octet-stream';
  const name = attachment?.name || 'attachment';

  try {
    if (!decoded) {
      return { name, mimeType, extractedText: '' };
    }

    if (mimeType === 'application/pdf' || name.toLowerCase().endsWith('.pdf')) {
      const data = await pdfParse(decoded.buffer);
      return { name, mimeType, extractedText: data.text || '' };
    }

    if (
      mimeType.startsWith('text/') ||
      mimeType.includes('json') ||
      mimeType.includes('xml') ||
      /\.(log|txt|json|csv|md|yaml|yml|env)$/i.test(name)
    ) {
      return { name, mimeType, extractedText: decoded.buffer.toString('utf8') };
    }

    if (mimeType.startsWith('image/')) {
      return { name, mimeType, imageUrl: attachment.url, extractedText: `[Şəkil əlavə olunub: ${name}]` };
    }

    return { name, mimeType, extractedText: `[Dəstəklənməyən fayl növü: ${name}, ${mimeType}]` };
  } catch (error) {
    console.error('Attachment parse xətası:', name, error?.message || error);
    return { name, mimeType, extractedText: `[Attachment oxunarkən xəta baş verdi: ${name}]` };
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
    const imageParts = [];

    for (const attachment of message.attachments) {
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
        textParts.push(`\n\n[Attachment: ${extracted.name} | ${extracted.mimeType}]\n${extracted.extractedText.slice(0, 30000)}`);
      } else if (attachment?.extractionError) {
        textParts.push(`\n\n[Attachment: ${attachment?.name || 'attachment'}]\nOxuma xətası: ${attachment.extractionError}`);
      } else {
        textParts.push(`\n\n[Attachment: ${attachment?.name || extracted.name || 'attachment'} | ${attachment?.mimeType || extracted.mimeType || 'unknown'}]\nMətn çıxarıla bilmədi, amma fayl əlavə olunub.`);
      }
      if (extracted.imageUrl) {
        imageParts.push({ type: 'image_url', image_url: { url: extracted.imageUrl } });
      }
    }

    if (imageParts.length > 0) {
      normalized.push({
        ...message,
        content: [
          { type: 'text', text: textParts.join('\n').trim() || 'İstifadəçi fayl əlavə edib.' },
          ...imageParts
        ],
        attachments: undefined
      });
    } else {
      normalized.push({
        ...message,
        content: textParts.join('\n').trim(),
        attachments: undefined
      });
    }
  }

  return normalized;
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
  const unsafeChars = /[;&|`$(){}]/;
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
                    proc.stdout.on('data', d => {
                        out += d;
                        // If it's a server, we don't wait for close, we look for "ready" signals
                        if (isServerCmd && (out.includes('ready') || out.includes('Local:') || out.includes('localhost:'))) {
                            resolve(`Server started in background.\nSTDOUT Snapshot: ${out}`);
                        }
                    });
                    proc.stderr.on('data', d => err += d);
                    
                    proc.on('close', code => resolve(`Exit Code ${code}\nSTDOUT: ${out}\nSTDERR: ${err}`));

                    // For non-server commands, keep timeout. For servers, return success early but KEEP ALIVE.
                    setTimeout(() => {
                        if (isServerCmd) {
                            resolve(`Server is likely running in background (Timeout reached, but process kept alive).\nSTDOUT: ${out}`);
                        } else {
                            proc.kill();
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
                    const { stdout } = await execFileAsync('grep', ['-rnI', args.query, '.'], { cwd: searchCwd, timeout: 10000 });
                    return stdout.split('\n').slice(0, 50).join('\n') || "No matches found";
                } catch (e) {
                    return "No matches found or grep error";
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
    const result = await db.query(
      `INSERT INTO projects (id, user_id, name, path, repo_url, last_port)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [id, req.user.id, name, requestedPath, repoUrl, req.body.lastPort || 5173]
    );

    const conversationId = crypto.randomUUID();
    const title = repoUrl ? `Import: ${name}` : 'Analiz və Planlaşdırma';
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
  try {
    const attachments = Array.isArray(req.body.attachments) ? req.body.attachments : [];
    const extracted = [];

    for (const attachment of attachments) {
      let item;
      try {
        item = await extractAttachment(attachment);
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
  pending.status = req.body?.decision === 'approve' ? 'approved' : 'rejected';
  pendingApprovals.set(req.params.id, pending);
  res.json({ success: true, status: pending.status });
});

app.post('/api/approvals/:id/execute', async (req, res) => {
  const pending = pendingApprovals.get(req.params.id);
  if (!pending) return res.status(404).json({ error: 'Approval tapılmadı' });
  if (pending.userId !== req.user.id) return res.status(403).json({ error: 'Access denied' });
  if (pending.status !== 'approved') return res.status(400).json({ error: 'Approval təsdiqlənməyib' });

  try {
    const result = await handleToolCall(pending.toolCall, pending.workingDirectory, req.user);
    pendingApprovals.delete(req.params.id);
    res.json({ success: true, result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/chat', async (req, res) => {
    const { messages, apiKey, model, workingDirectory, baseUrl, projectId, safeMode = true } = req.body;
    
    // SEC-1: Verify workingDirectory against ALLOWED_DIRS
    const resolvedWD = resolveWorkingDirectory(workingDirectory, req.user);
    if (!ALLOWED_DIRS.some(base => {
        const r = path.relative(base, resolvedWD);
        return !r.startsWith('..') && !path.isAbsolute(r);
    })) {
        return res.status(403).json({ error: "Unauthorized working directory" });
    }
    await ensureDir(resolvedWD);

    const effectiveApiKey = apiKey || process.env.OPENAI_API_KEY || process.env.NVIDIA_API_KEY;
    const effectiveBaseUrl = baseUrl || process.env.OPENAI_BASE_URL || "https://integrate.api.nvidia.com/v1";
    const effectiveModel = model || process.env.OPENAI_MODEL || 'meta/llama-3.3-70b-instruct';

    if (!effectiveApiKey) {
        return res.status(400).json({ 
            error: "Süni İntellekt API Açarı tapılmadı! Layihəni lokalda (Railway-dən asılı olmadan) işlətmək üçün layihə qovluğundakı `.env` faylına OPENAI_API_KEY və OPENAI_BASE_URL açarlarını əlavə edin." 
        });
    }

    const client = new OpenAI({ baseURL: effectiveBaseUrl, apiKey: effectiveApiKey });

    const sysPrompt = `Sən bahAI İDE rəsmi AI Agentisən. Project Root: ${resolvedWD}.
Sən professional proqramçı və UI/UX ekspertisən.
MÜHÜM QAYDALAR:
1. Kodu dəyişməzdən əvvəl glob_search və read_file ilə mütləq kodu analiz et.
2. Dəyişiklik etdikdə YALNIZ file_edit istifadə et (bütöv faylı yenidən yazma).
3. LIVE PREVIEW HAQQINDA: Bizim LivePreview paneli YALNIZ 'http://localhost:PORT' formatında işləyir. Lokal fayl yollarını (file:///...) aça bilmir.
4. Əgər bir web səhifə yaratmısansa, onu görmək üçün mütləq bir server başlatmalısan (məs: 'npx serve' və ya 'npm run dev').
5. SERVERİ TƏSDİQLƏ (KRİTİK): check_port_status alətini çağırmadan serverin işlədiyini iddia etmək QADAĞANDIR! Əgər bu aləti çağırmamısansa, "Server işləyir" demə! Əgər port aktiv deyilsə, serverin niyə qalxmadığını (logs) yoxla.
6. İstifadəçi attachment/PDF göndəribsə, birbaşa həmin məzmunu analiz et. "Drag & drop et", "link göndər", "yenidən yüklə" kimi cavabları yalnız attachment ümumiyyətlə yoxdursa ver.
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

    let currentMessages = [...apiMessages];
    let step = 0;
    const initialPlan = [
      'Oxunacaq faylları müəyyən et',
      'Dəyişiklik planını hazırla',
      'Diff/Approval ilə tətbiq et',
      'Build/Test/Health yoxlaması apar'
    ];
    res.write(`data: ${JSON.stringify({ type: 'task_plan', items: initialPlan })}\n\n`);

    try {
        while (step < MAX_STEPS) {
            step++;
            const response = await client.chat.completions.create({
                model: effectiveModel,
                messages: currentMessages,
                tools: TOOLS,
                temperature: 0.2
            });

            const msg = response.choices[0].message;
            if (typeof msg.content === 'string') {
              msg.content = sanitizeAttachmentFallbackReply(msg.content, hasAttachmentInRequest);
            }
            currentMessages.push(msg);

            // BUG-4: Send full message including tool_calls
            res.write(`data: ${JSON.stringify({ type: 'assistant_message', message: msg })}\n\n`);

            if (msg.tool_calls && msg.tool_calls.length > 0) {
                for (const toolCall of msg.tool_calls) {
                    res.write(`data: ${JSON.stringify({ type: 'tool_execution', tool: toolCall.function.name, args: toolCall.function.arguments })}\n\n`);
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
                        currentMessages.push({
                          role: "tool",
                          tool_call_id: toolCall.id,
                          content: `Approval required: ${approvalId}`
                        });
                        continue;
                    }
                    const result = await handleToolCall(toolCall, resolvedWD, req.user);
                    
                    const toolResultMsg = { role: "tool", tool_call_id: toolCall.id, content: result };
                    currentMessages.push(toolResultMsg);
                    res.write(`data: ${JSON.stringify({ type: 'tool_result', result })}\n\n`);
                }
            } else {
                break;
            }
        }
    } catch (e) {
        res.write(`data: ${JSON.stringify({ type: 'error', message: e.message })}\n\n`);
    } finally {
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
      // Mock data for local testing
      return res.json({
        users: [
          { id: 9999, email: 'admin@bahai.local', name: 'bahAI Developer', role: 'admin', created_at: new Date() },
          { id: 1, email: 'kamran@gmail.com', name: 'Kamran Məmmədov', role: 'user', created_at: new Date() },
          { id: 2, email: 'nazim@gmail.com', name: 'Nazim Əliyev', role: 'user', created_at: new Date() }
        ]
      });
    }

    const result = await db.query('SELECT id, email, name, role, created_at FROM users ORDER BY created_at DESC');
    res.json({ users: result.rows });
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
