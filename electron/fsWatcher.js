// ==========================================
// FS Watcher — chokidar wrapper with batched events
// ==========================================
// Watches a project directory and emits debounced file system events
// to the renderer process via IPC.

const path = require('path');

let chokidar;
try {
  chokidar = require('chokidar');
} catch {
  chokidar = null;
}

let activeWatcher = null;
let activeDir = null;
let batchTimer = null;
let eventBatch = [];
const BATCH_DEBOUNCE_MS = 300;
const MAX_BATCH_SIZE = 50;

const IGNORED_PATTERNS = [
  '**/node_modules/**',
  '**/.git/**',
  '**/dist/**',
  '**/build/**',
  '**/.next/**',
  '**/venv/**',
  '**/__pycache__/**',
  '**/.DS_Store',
  '**/coverage/**',
  '**/.venv/**',
];

/**
 * Start watching a directory.
 * @param {string} dirPath - Absolute path to watch
 * @param {function} onBatch - Callback receiving batched events: [{type, path, relativePath}]
 * @returns {boolean} success
 */
function startWatching(dirPath, onBatch) {
  if (!chokidar) {
    console.warn('[fsWatcher] chokidar not installed');
    return false;
  }

  // Stop previous watcher if any
  stopWatching();

  activeDir = dirPath;

  activeWatcher = chokidar.watch(dirPath, {
    ignored: IGNORED_PATTERNS,
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 200,
      pollInterval: 50,
    },
    depth: 10,
  });

  const queueEvent = (type, filePath) => {
    const relativePath = path.relative(dirPath, filePath);
    eventBatch.push({ type, path: filePath, relativePath });

    // If batch is too large, flush immediately (full tree refresh signal)
    if (eventBatch.length >= MAX_BATCH_SIZE) {
      flushBatch(onBatch);
      return;
    }

    // Debounce
    if (batchTimer) clearTimeout(batchTimer);
    batchTimer = setTimeout(() => flushBatch(onBatch), BATCH_DEBOUNCE_MS);
  };

  activeWatcher
    .on('add', (filePath) => queueEvent('add', filePath))
    .on('change', (filePath) => queueEvent('change', filePath))
    .on('unlink', (filePath) => queueEvent('unlink', filePath))
    .on('addDir', (filePath) => queueEvent('addDir', filePath))
    .on('unlinkDir', (filePath) => queueEvent('unlinkDir', filePath))
    .on('error', (err) => {
      console.error('[fsWatcher] Error:', err.message);
    });

  return true;
}

function flushBatch(onBatch) {
  if (batchTimer) {
    clearTimeout(batchTimer);
    batchTimer = null;
  }
  if (eventBatch.length === 0) return;

  const batch = [...eventBatch];
  eventBatch = [];

  if (typeof onBatch === 'function') {
    onBatch(batch);
  }
}

/**
 * Stop watching.
 */
function stopWatching() {
  if (batchTimer) {
    clearTimeout(batchTimer);
    batchTimer = null;
  }
  eventBatch = [];

  if (activeWatcher) {
    activeWatcher.close().catch(() => {});
    activeWatcher = null;
  }
  activeDir = null;
}

/**
 * Get current watched directory.
 */
function getWatchedDir() {
  return activeDir;
}

module.exports = {
  startWatching,
  stopWatching,
  getWatchedDir,
};
