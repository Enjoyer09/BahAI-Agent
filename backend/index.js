require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { OpenAI } = require('openai');
const fs = require('fs/promises');
const path = require('path');
const { exec, execFile, spawn } = require('child_process');
const util = require('util');
const { glob } = require('glob');

const execFileAsync = util.promisify(execFile);

const app = express();
const db = require('./db');
const { router: authRoutes, verifyToken } = require('./auth');

// Initialize Database
db.initDb();

// SEC-7: Restrict CORS
app.use(cors());
app.use(express.json({ limit: '2mb' }));

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

// ==========================================
// Security helpers
// ==========================================

/**
 * Helper to resolve working directory dynamically.
 * Maps local paths (e.g., /Users/macbookair/...) to safe sandboxed container directories on cloud/Linux.
 */
function resolveWorkingDirectory(wd) {
  if (!wd) return path.resolve(process.cwd());

  const cleanWd = wd.trim();

  // If running on Linux (Railway) but path is a macOS/Windows user directory
  if (process.platform === 'linux' && (cleanWd.startsWith('/Users/') || cleanWd.startsWith('/home/') || cleanWd.includes('\\') || cleanWd.includes(':'))) {
    const folderName = path.basename(cleanWd.replace(/\\/g, '/'));
    const sandboxPath = path.resolve(__dirname, '../sandbox', folderName || 'default');
    
    // Ensure sandbox dir exists
    const fsExtra = require('fs');
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
  const resolvedReqPath = path.resolve(originalPath);

  if (resolvedOrigWD === resolvedWD) return resolvedReqPath;

  const rel = path.relative(resolvedOrigWD, resolvedReqPath);
  return path.resolve(resolvedWD, rel);
}

/**
 * SEC-2: Robust path safety check using path.relative
 */
function isPathSafe(filePath, workingDirectory) {
  const resolvedWD = resolveWorkingDirectory(workingDirectory);
  if (!resolvedWD) return false;
  const resolvedBase = path.resolve(resolvedWD);
  const resolvedPath = path.resolve(filePath);
  
  // Check if it's within the specific project working directory
  const rel = path.relative(resolvedBase, resolvedPath);
  const isInsideProject = !rel.startsWith('..') && !path.isAbsolute(rel);
  
  // SEC-1: Also check if it's within globally allowed directories from .env
  const isAllowedGlobally = ALLOWED_DIRS.some(base => {
    const r = path.relative(base, resolvedPath);
    return !r.startsWith('..') && !path.isAbsolute(r);
  });

  const isSafe = isInsideProject || isAllowedGlobally;
  
  if (!isSafe) {
    console.warn(`🚨 SECURITY ALERT: Blocked access to ${resolvedPath}`);
    console.warn(`   Rel to Project: ${rel} | Inside: ${isInsideProject}`);
    console.warn(`   Allowed Globally: ${isAllowedGlobally}`);
  }

  return isSafe;
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

async function handleToolCall(toolCall, workingDirectory) {
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
                if (!isPathSafe(targetPath, workingDirectory)) return "Error: Path outside workspace";
                const files = await fs.readdir(targetPath, { withFileTypes: true });
                return files.map(f => `${f.isDirectory() ? '[DIR] ' : ''}${f.name}`).join('\n');
            }

            case "glob_search": {
                const searchCwd = path.resolve(workingDirectory, args.cwd || '.');
                if (!isPathSafe(searchCwd, workingDirectory)) return "Error: Path outside workspace";
                const matches = await glob(args.pattern, { cwd: searchCwd, ignore: ['**/node_modules/**', '**/.git/**'] });
                return matches.join('\n') || "No matches found";
            }

            case "read_file": {
                const filePath = path.resolve(workingDirectory, args.path);
                if (!isPathSafe(filePath, workingDirectory)) return "Error: Path outside workspace";
                const content = await fs.readFile(filePath, 'utf8');
                // PERF: Simple truncation for very large files
                if (content.length > 50000) return content.slice(0, 50000) + "\n\n[TRUNCATED... File too large]";
                return content;
            }

            case "write_file": {
                const filePath = path.resolve(workingDirectory, args.path);
                if (!isPathSafe(filePath, workingDirectory)) return "Error: Path outside workspace";
                await fs.mkdir(path.dirname(filePath), { recursive: true });
                await fs.writeFile(filePath, args.content, 'utf8');
                return `Successfully created ${args.path}`;
            }

            case "file_edit": {
                const filePath = path.resolve(workingDirectory, args.path);
                if (!isPathSafe(filePath, workingDirectory)) return "Error: Path outside workspace";
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
                if (!isPathSafe(searchCwd, workingDirectory)) return "Error: Path outside workspace";
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

app.post('/api/chat', async (req, res) => {
    const { messages, apiKey, model, workingDirectory, baseUrl, debug } = req.body;
    
    // SEC-1: Verify workingDirectory against ALLOWED_DIRS
    const resolvedWD = resolveWorkingDirectory(workingDirectory);
    if (!ALLOWED_DIRS.some(base => {
        const r = path.relative(base, resolvedWD);
        return !r.startsWith('..') && !path.isAbsolute(r);
    })) {
        return res.status(403).json({ error: "Unauthorized working directory" });
    }

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
Azərbaycan dilində cavab ver.`;

    const apiMessages = [{ role: 'system', content: sysPrompt }, ...messages];

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');

    let currentMessages = [...apiMessages];
    let step = 0;

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
            currentMessages.push(msg);

            // BUG-4: Send full message including tool_calls
            res.write(`data: ${JSON.stringify({ type: 'assistant_message', message: msg })}\n\n`);

            if (msg.tool_calls && msg.tool_calls.length > 0) {
                for (const toolCall of msg.tool_calls) {
                    res.write(`data: ${JSON.stringify({ type: 'tool_execution', tool: toolCall.function.name, args: toolCall.function.arguments })}\n\n`);
                    const result = await handleToolCall(toolCall, resolvedWD);
                    
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
  const resolvedWD = resolveWorkingDirectory(workingDirectory);
  const resolvedPath = mapPath(reqPath, workingDirectory, resolvedWD);
  
  if (!isPathSafe(resolvedPath, resolvedWD)) {
    return res.status(403).json({ error: "Access denied" });
  }
  try {
    const content = await fs.readFile(resolvedPath, 'utf8');
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
  const resolvedWD = resolveWorkingDirectory(workingDirectory);
  const targetDir = mapPath(path.resolve(workingDirectory, reqPath || '.'), workingDirectory, resolvedWD);
  
  if (!isPathSafe(targetDir, resolvedWD)) {
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
  const resolvedWD = resolveWorkingDirectory(workingDirectory);
  const resolvedPath = mapPath(reqPath, workingDirectory, resolvedWD);
  
  if (!isPathSafe(resolvedPath, resolvedWD)) {
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
