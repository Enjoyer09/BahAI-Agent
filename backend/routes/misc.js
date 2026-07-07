// ==========================================
// Miscellaneous Routes
// ==========================================

const express = require('express');
const router = express.Router();
const path = require('path');
const { resolveWorkingDirectory, isPathSafe, isBashCommandSafe, fileExists } = require('../helpers');
const { detectRepoProfile, serializeRepoProfile, buildValidationHint, buildCompactProjectMemory } = require('../helpers');
const { execFile } = require('child_process');
const util = require('util');
const execFileAsync = util.promisify(execFile);

// POST /api/task-plan — Generate task plan
router.post('/task-plan', async (req, res) => {
  try {
    const resolvedWD = resolveWorkingDirectory(req.body.workingDirectory, req.user);
    const profile = await detectRepoProfile(resolvedWD);
    res.json({
      plan: [`1. Analyze current codebase state`, `2. Implement required changes`, `3. Validate changes`],
      repoProfile: serializeRepoProfile(profile),
      validationHint: buildValidationHint(profile)
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/diff/preview — Generate diff preview
router.post('/diff/preview', async (req, res) => {
  try {
    const { path: filePath, content, originalContent } = req.body;
    if (!filePath) return res.status(400).json({ error: 'path tələb olunur' });
    const resolvedWD = resolveWorkingDirectory(req.body.workingDirectory, req.user);
    const targetPath = path.resolve(resolvedWD, filePath);
    const fs = require('fs/promises');

    let oldContent = originalContent;
    if (!oldContent) {
      try { oldContent = await fs.readFile(targetPath, 'utf8'); }
      catch { oldContent = ''; }
    }

    const { makeUnifiedDiff, summarizeDiff } = require('../helpers');
    const diff = makeUnifiedDiff(oldContent, content || '', filePath);
    const summary = summarizeDiff(diff);

    res.json({ diff, summary, filePath });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/diff/apply — Apply file changes
router.post('/diff/apply', async (req, res) => {
  try {
    const { path: filePath, content } = req.body;
    if (!filePath || content === undefined) return res.status(400).json({ error: 'path və content tələb olunur' });
    const resolvedWD = resolveWorkingDirectory(req.body.workingDirectory, req.user);
    const targetPath = path.resolve(resolvedWD, filePath);
    if (!isPathSafe(targetPath, req.body.workingDirectory, req.user)) return res.status(403).json({ error: 'Path outside workspace' });
    const fs = require('fs/promises');
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, content, 'utf8');
    res.json({ success: true, path: filePath });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/terminal/run — Run terminal command
router.post('/terminal/run', async (req, res) => {
  try {
    const { command } = req.body;
    if (!command) return res.status(400).json({ error: 'command tələb olunur' });
    if (!isBashCommandSafe(command)) return res.status(403).json({ error: 'Command blocked or contains unsafe characters' });

    const resolvedWD = resolveWorkingDirectory(req.body.workingDirectory, req.user);
    const { stdout, stderr } = await execFileAsync('sh', ['-c', command], { cwd: resolvedWD, timeout: 30000 });
    res.json({ stdout: stdout.slice(0, 10000), stderr: stderr.slice(0, 5000) });
  } catch (e) {
    res.json({ stdout: e.stdout?.slice(0, 10000) || '', stderr: e.stderr?.slice(0, 5000) || e.message });
  }
});

// POST /api/project-health — Check project health
router.post('/project-health', async (req, res) => {
  try {
    const resolvedWD = resolveWorkingDirectory(req.body.workingDirectory, req.user);
    const profile = await detectRepoProfile(resolvedWD);
    const validationHint = buildValidationHint(profile);
    res.json({ healthy: true, profile: serializeRepoProfile(profile), validationHint });
  } catch (e) {
    res.json({ healthy: false, error: e.message });
  }
});

// GET /api/project-memory/:projectId — Get project memory
router.get('/project-memory/:projectId', async (req, res) => {
  try {
    const db = require('../db');
    if (!db.hasDatabase()) return res.json({ memory: {} });
    const result = await db.query('SELECT memory FROM project_memories WHERE project_id = $1 AND user_id = $2', [req.params.projectId, req.user.id]);
    const memory = result.rows[0]?.memory || {};
    res.json({ memory });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/project-memory/:projectId — Save project memory
router.post('/project-memory/:projectId', async (req, res) => {
  try {
    const db = require('../db');
    if (!db.hasDatabase()) return res.json({ success: true });
    const { memory } = req.body;
    if (!memory) return res.status(400).json({ error: 'memory tələb olunur' });
    await db.query(
      `INSERT INTO project_memories (project_id, user_id, memory, updated_at) VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
       ON CONFLICT (project_id) DO UPDATE SET memory = $3, updated_at = CURRENT_TIMESTAMP`,
      [req.params.projectId, req.user.id, JSON.stringify(memory)]
    );
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/tts — Text-to-speech (ElevenLabs)
router.post('/tts', async (req, res) => {
  try {
    const { text, voice } = req.body;
    if (!text) return res.status(400).json({ error: 'text tələb olunur' });
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) return res.status(501).json({ error: 'ElevenLabs API açarı təyin edilməyib' });
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice || '21m00Tcm4TlvDq8ikWAM'}`, {
      method: 'POST', headers: { 'Accept': 'audio/mpeg', 'Content-Type': 'application/json', 'xi-api-key': apiKey },
      body: JSON.stringify({ text, model_id: 'eleven_multilingual_v2', voice_settings: { stability: 0.5, similarity_boost: 0.5 } })
    });
    if (!response.ok) return res.status(500).json({ error: 'TTS xətası' });
    const audioBuffer = Buffer.from(await response.arrayBuffer());
    res.setHeader('Content-Type', 'audio/mpeg');
    res.send(audioBuffer);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/conversation-token — Get ephemeral conversation token (for Realtime API etc.)
router.get('/conversation-token', async (req, res) => {
  res.json({ token: null, error: 'Realtime API not configured' });
});

// GET /api/signed-url — Get signed URL for ElevenLabs
router.get('/signed-url', async (req, res) => {
  const { filename } = req.query;
  const API_BASE_URL = process.env.API_BASE_URL || `http://localhost:${process.env.PORT || 3001}`;
  res.json({ url: `${API_BASE_URL}/api/tts?text=${encodeURIComponent(filename || 'test')}` });
});

// GET /api/admin/stats — Admin stats
router.get('/admin/stats', async (req, res) => {
  try {
    const db = require('../db');
    if (!db.hasDatabase()) return res.json({ stats: { users: 1, conversations: 0, projects: 0 } });
    const userCount = await db.query('SELECT COUNT(*) FROM users');
    const convCount = await db.query('SELECT COUNT(*) FROM conversations');
    const projCount = await db.query('SELECT COUNT(*) FROM projects');
    res.json({ stats: { users: parseInt(userCount.rows[0].count), conversations: parseInt(convCount.rows[0].count), projects: parseInt(projCount.rows[0].count) } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/admin/users — Admin user list
router.get('/admin/users', async (req, res) => {
  try {
    const db = require('../db');
    if (!db.hasDatabase()) return res.json({ users: [{ id: 1, email: 'admin@local', name: 'Local Admin', role: 'admin' }] });
    const result = await db.query('SELECT id, email, name, role, created_at, last_active FROM users ORDER BY created_at DESC LIMIT 50');
    res.json({ users: result.rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/attachments/extract — Extract attachment content
router.post('/attachments/extract', async (req, res) => {
  try {
    const { extractAttachment } = require('../helpers');
    const attachment = req.body.attachment;
    if (!attachment) return res.status(400).json({ error: 'attachment tələb olunur' });
    const result = await extractAttachment(attachment);
    res.json({ extractedText: result.extractedText || '', extractionError: result.extractionError });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
