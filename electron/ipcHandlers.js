// ==========================================
// IPC Handlers — Centralized registration
// ==========================================
// All ipcMain.handle and ipcMain.on registrations for Desktop App Builder.

const { ipcMain } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const fsSync = require('fs');
const ptyManager = require('./ptyManager');
const fsWatcher = require('./fsWatcher');

let mainWindowRef = null;
let allowedDirectories = [];

/**
 * Register all IPC handlers.
 * @param {BrowserWindow} mainWindow
 * @param {string[]} allowedDirs - Directories the app is allowed to access
 */
function register(mainWindow, allowedDirs = []) {
  mainWindowRef = mainWindow;
  allowedDirectories = allowedDirs;

  // ─── File System ───────────────────────────────
  ipcMain.handle('fs:readDirectory', handleReadDirectory);
  ipcMain.handle('fs:readFile', handleReadFile);
  ipcMain.handle('fs:writeFile', handleWriteFile);
  ipcMain.handle('fs:deleteFile', handleDeleteFile);
  ipcMain.handle('fs:rename', handleRename);
  ipcMain.handle('fs:createDirectory', handleCreateDirectory);
  ipcMain.handle('fs:watchStart', handleWatchStart);
  ipcMain.handle('fs:watchStop', handleWatchStop);

  // ─── Terminal (PTY) ────────────────────────────
  ipcMain.handle('pty:create', handlePtyCreate);
  ipcMain.on('pty:write', handlePtyWrite);
  ipcMain.on('pty:resize', handlePtyResize);
  ipcMain.handle('pty:kill', handlePtyKill);
  ipcMain.handle('pty:list', handlePtyList);

  // ─── Git (UI-level) ───────────────────────────
  ipcMain.handle('git:status', handleGitStatus);
  ipcMain.handle('git:log', handleGitLog);
  ipcMain.handle('git:branch', handleGitBranch);

  // ─── Shell ─────────────────────────────────────
  ipcMain.handle('shell:openExternal', handleOpenExternal);
  ipcMain.handle('shell:showItemInFolder', handleShowInFolder);
}

// ─── Path Safety ─────────────────────────────────
function isPathAllowed(targetPath) {
  if (!targetPath) return false;
  const resolved = path.resolve(targetPath);
  // In dev/local mode, allow everything under home + project
  if (allowedDirectories.length === 0) return true;
  return allowedDirectories.some(dir => {
    const rel = path.relative(dir, resolved);
    return !rel.startsWith('..') && !path.isAbsolute(rel);
  });
}

// ─── File System Handlers ────────────────────────

async function handleReadDirectory(_event, dirPath, depth = 3) {
  if (!isPathAllowed(dirPath)) throw new Error('Access denied');
  return readDirRecursive(dirPath, depth);
}

async function readDirRecursive(dirPath, maxDepth, currentDepth = 0) {
  if (currentDepth >= maxDepth) return [];
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const nodes = [];

  for (const entry of entries) {
    // Skip hidden/ignored
    if (entry.name.startsWith('.') && entry.name !== '.env') continue;
    if (entry.name === 'node_modules' || entry.name === '__pycache__') continue;

    const fullPath = path.join(dirPath, entry.name);
    const node = {
      id: path.relative(dirPath, fullPath).replace(/\\/g, '/'),
      name: entry.name,
      type: entry.isDirectory() ? 'directory' : 'file',
    };

    if (entry.isDirectory()) {
      node.children = await readDirRecursive(fullPath, maxDepth, currentDepth + 1);
    }

    nodes.push(node);
  }

  // Sort: directories first, then files, alphabetically
  nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return nodes;
}

async function handleReadFile(_event, filePath) {
  if (!isPathAllowed(filePath)) throw new Error('Access denied');
  return fs.readFile(filePath, 'utf8');
}

async function handleWriteFile(_event, filePath, content) {
  if (!isPathAllowed(filePath)) throw new Error('Access denied');
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, 'utf8');
}

async function handleDeleteFile(_event, filePath) {
  if (!isPathAllowed(filePath)) throw new Error('Access denied');
  await fs.rm(filePath, { recursive: true, force: true });
}

async function handleRename(_event, oldPath, newPath) {
  if (!isPathAllowed(oldPath) || !isPathAllowed(newPath)) throw new Error('Access denied');
  await fs.rename(oldPath, newPath);
}

async function handleCreateDirectory(_event, dirPath) {
  if (!isPathAllowed(dirPath)) throw new Error('Access denied');
  await fs.mkdir(dirPath, { recursive: true });
}

async function handleWatchStart(_event, dirPath) {
  if (!isPathAllowed(dirPath)) throw new Error('Access denied');
  fsWatcher.startWatching(dirPath, (batch) => {
    if (mainWindowRef && !mainWindowRef.isDestroyed()) {
      mainWindowRef.webContents.send('fs:batch-changed', batch);
    }
  });
}

async function handleWatchStop() {
  fsWatcher.stopWatching();
}

// ─── PTY Handlers ────────────────────────────────

async function handlePtyCreate(_event, cwd) {
  if (cwd && !isPathAllowed(cwd)) throw new Error('Access denied: PTY cwd outside allowed directories');
  const result = ptyManager.createSession(cwd);

  // Wire data and exit events to renderer
  ptyManager.onSessionData(result.terminalId, (data) => {
    if (mainWindowRef && !mainWindowRef.isDestroyed()) {
      mainWindowRef.webContents.send('pty:data', { id: result.terminalId, data });
    }
  });

  ptyManager.onSessionExit(result.terminalId, ({ exitCode, signal }) => {
    if (mainWindowRef && !mainWindowRef.isDestroyed()) {
      mainWindowRef.webContents.send('pty:exit', { id: result.terminalId, exitCode, signal });
    }
  });

  return result;
}

function handlePtyWrite(_event, { id, data }) {
  ptyManager.writeToSession(id, data);
}

function handlePtyResize(_event, { id, cols, rows }) {
  ptyManager.resizeSession(id, cols, rows);
}

async function handlePtyKill(_event, terminalId) {
  ptyManager.killSession(terminalId);
}

async function handlePtyList() {
  return ptyManager.listSessions();
}

// ─── Git Handlers ────────────────────────────────

async function handleGitStatus(_event, cwd) {
  if (!isPathAllowed(cwd)) throw new Error('Access denied');
  const { execFile } = require('child_process');
  const { promisify } = require('util');
  const exec = promisify(execFile);

  try {
    const { stdout } = await exec('git', ['status', '--porcelain', '-uall'], { cwd, timeout: 5000 });
    const files = {};
    for (const line of stdout.split('\n').filter(Boolean)) {
      const status = line.substring(0, 2).trim();
      const file = line.substring(3);
      files[file] = status === '??' ? 'untracked' : status === 'M' ? 'modified' : status === 'A' ? 'added' : status === 'D' ? 'deleted' : 'modified';
    }
    const { stdout: branchOut } = await exec('git', ['branch', '--show-current'], { cwd, timeout: 3000 });
    return { files, branch: branchOut.trim() };
  } catch {
    return { files: {}, branch: '', error: 'Not a git repo' };
  }
}

async function handleGitLog(_event, cwd, limit = 20) {
  if (!isPathAllowed(cwd)) throw new Error('Access denied');
  const { execFile } = require('child_process');
  const { promisify } = require('util');
  const exec = promisify(execFile);

  try {
    const { stdout } = await exec('git', ['log', `--max-count=${limit}`, '--pretty=format:%H|%an|%ar|%s'], { cwd, timeout: 5000 });
    return stdout.split('\n').filter(Boolean).map(line => {
      const [hash, author, date, ...msgParts] = line.split('|');
      return { hash, author, date, message: msgParts.join('|') };
    });
  } catch {
    return [];
  }
}

async function handleGitBranch(_event, cwd) {
  if (!isPathAllowed(cwd)) throw new Error('Access denied');
  const { execFile } = require('child_process');
  const { promisify } = require('util');
  const exec = promisify(execFile);

  try {
    const { stdout: currentOut } = await exec('git', ['branch', '--show-current'], { cwd, timeout: 3000 });
    const { stdout: allOut } = await exec('git', ['branch', '--list', '--no-color'], { cwd, timeout: 3000 });
    const all = allOut.split('\n').map(b => b.replace(/^\*?\s*/, '').trim()).filter(Boolean);
    return { current: currentOut.trim(), all };
  } catch {
    return { current: '', all: [] };
  }
}

// ─── Shell Handlers ──────────────────────────────

async function handleOpenExternal(_event, url) {
  const { shell } = require('electron');
  await shell.openExternal(url);
}

async function handleShowInFolder(_event, filePath) {
  const { shell } = require('electron');
  shell.showItemInFolder(filePath);
}

// ─── Cleanup ─────────────────────────────────────

function cleanup() {
  ptyManager.killAll();
  fsWatcher.stopWatching();
}

module.exports = { register, cleanup };
