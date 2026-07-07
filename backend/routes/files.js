// ==========================================
// File Operations Route
// ==========================================

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs/promises');
const { isPathSafe, resolveWorkingDirectory, readPdfFile, fileExists } = require('../helpers');

// GET /api/files (mounted at /api) — List directory contents
router.get('/files', async (req, res) => {
  try {
    const dirPath = req.query.path || '.';
    const resolvedWD = resolveWorkingDirectory(req.query.workingDirectory, req.user);
    const targetPath = path.resolve(resolvedWD, dirPath);

    if (!isPathSafe(targetPath, req.query.workingDirectory, req.user)) {
      return res.status(403).json({ error: 'Path outside workspace' });
    }

    const entries = await fs.readdir(targetPath, { withFileTypes: true });
    const files = entries.map(entry => ({
      name: entry.name,
      isDirectory: entry.isDirectory(),
      path: path.join(dirPath, entry.name)
    }));
    files.currentPath = dirPath;
    files.files = files;
    res.json(files);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/read-file (mounted at /api) — Read file contents
router.get('/read-file', async (req, res) => {
  try {
    const filePath = req.query.path;
    if (!filePath) return res.status(400).json({ error: 'path tələb olunur' });

    const resolvedWD = resolveWorkingDirectory(req.query.workingDirectory, req.user);
    const targetPath = path.resolve(resolvedWD, filePath);

    if (!isPathSafe(targetPath, req.query.workingDirectory, req.user)) {
      return res.status(403).json({ error: 'Path outside workspace' });
    }

    let content;
    if (filePath.toLowerCase().endsWith('.pdf')) {
      content = await readPdfFile(targetPath);
    } else {
      content = await fs.readFile(targetPath, 'utf8');
    }

    res.json({ content, path: filePath });
  } catch (e) {
    if (e.code === 'ENOENT') return res.status(404).json({ error: 'Fayl tapılmadı' });
    res.status(500).json({ error: e.message });
  }
});

// POST /api/write-file (mounted at /api) — Write file
router.post('/write-file', async (req, res) => {
  try {
    const { path: filePath, content } = req.body;
    if (!filePath || content === undefined) return res.status(400).json({ error: 'path və content tələb olunur' });

    const resolvedWD = resolveWorkingDirectory(req.body.workingDirectory, req.user);
    const targetPath = path.resolve(resolvedWD, filePath);

    if (!isPathSafe(targetPath, req.body.workingDirectory, req.user)) {
      return res.status(403).json({ error: 'Path outside workspace' });
    }

    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, content, 'utf8');
    res.json({ success: true, path: filePath });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/pick-directory (mounted at /api) — List root directories
router.get('/pick-directory', async (req, res) => {
  try {
    const dirs = ['/Users', '/tmp', process.cwd()];
    const results = [];
    for (const dir of dirs) {
      try {
        const entries = await fs.readdir(dir);
        const subdirs = entries.filter(e => !e.startsWith('.')).slice(0, 50);
        results.push({ path: dir, entries: subdirs });
      } catch { /* skip */ }
    }
    res.json({ directories: results });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
