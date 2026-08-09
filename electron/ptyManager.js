// ==========================================
// PTY Manager — node-pty session lifecycle
// ==========================================
// Manages terminal pseudo-TTY sessions for the Desktop App Builder.
// Each session is a real shell process (zsh/bash) with full I/O.

const path = require('path');
const os = require('os');

let pty;
try {
  pty = require('node-pty');
} catch {
  // node-pty not installed yet — module will be non-functional
  pty = null;
}

const sessions = new Map();
let idCounter = 0;

function getShell() {
  if (process.platform === 'darwin') return process.env.SHELL || '/bin/zsh';
  if (process.platform === 'win32') return 'powershell.exe';
  return process.env.SHELL || '/bin/bash';
}

/**
 * Create a new PTY session.
 * @param {string} cwd - Working directory for the shell
 * @param {object} opts - { cols, rows, env }
 * @returns {{ terminalId: string }}
 */
function createSession(cwd, opts = {}) {
  if (!pty) throw new Error('node-pty is not installed. Run: cd electron && npm install node-pty');

  const terminalId = `pty_${++idCounter}_${Date.now()}`;
  const cols = opts.cols || 80;
  const rows = opts.rows || 24;

  const shell = getShell();
  const shellArgs = process.platform === 'darwin' ? ['-l'] : [];

  const ptyProcess = pty.spawn(shell, shellArgs, {
    name: 'xterm-256color',
    cols,
    rows,
    cwd: cwd || os.homedir(),
    env: {
      ...process.env,
      ...opts.env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
    },
  });

  const session = {
    id: terminalId,
    pty: ptyProcess,
    cwd,
    createdAt: Date.now(),
    pid: ptyProcess.pid,
  };

  sessions.set(terminalId, session);
  return { terminalId, pid: ptyProcess.pid };
}

/**
 * Write data to a PTY session (user input).
 */
function writeToSession(terminalId, data) {
  const session = sessions.get(terminalId);
  if (!session) return;
  session.pty.write(data);
}

/**
 * Resize a PTY session.
 */
function resizeSession(terminalId, cols, rows) {
  const session = sessions.get(terminalId);
  if (!session) return;
  try {
    session.pty.resize(Math.max(1, cols), Math.max(1, rows));
  } catch { /* ignore resize errors */ }
}

/**
 * Kill a PTY session.
 */
function killSession(terminalId) {
  const session = sessions.get(terminalId);
  if (!session) return;
  try {
    session.pty.kill();
  } catch { /* ignore */ }
  sessions.delete(terminalId);
}

/**
 * Get a PTY session's onData handler.
 */
function onSessionData(terminalId, callback) {
  const session = sessions.get(terminalId);
  if (!session) return () => {};
  const disposable = session.pty.onData(callback);
  return () => disposable.dispose();
}

/**
 * Get a PTY session's onExit handler.
 */
function onSessionExit(terminalId, callback) {
  const session = sessions.get(terminalId);
  if (!session) return () => {};
  const disposable = session.pty.onExit(callback);
  return () => disposable.dispose();
}

/**
 * Kill all sessions (cleanup on app quit).
 */
function killAll() {
  for (const [id] of sessions) {
    killSession(id);
  }
}

/**
 * List active sessions.
 */
function listSessions() {
  return Array.from(sessions.values()).map(s => ({
    id: s.id,
    cwd: s.cwd,
    pid: s.pid,
    createdAt: s.createdAt,
  }));
}

module.exports = {
  createSession,
  writeToSession,
  resizeSession,
  killSession,
  onSessionData,
  onSessionExit,
  killAll,
  listSessions,
};
