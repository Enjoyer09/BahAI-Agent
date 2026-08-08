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
const { requireAdmin, requireWorkspaceAccess } = require('../auth');

// POST /api/task-plan — Generate task plan
router.post('/task-plan', requireWorkspaceAccess, async (req, res) => {
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
router.post('/diff/preview', requireWorkspaceAccess, async (req, res) => {
  try {
    const { path: filePath, content, originalContent } = req.body;
    if (!filePath) return res.status(400).json({ error: 'path tələb olunur' });
    const resolvedWD = resolveWorkingDirectory(req.body.workingDirectory, req.user);
    const targetPath = path.resolve(resolvedWD, filePath);
    const fs = require('fs/promises');
    if (!isPathSafe(targetPath, req.body.workingDirectory, req.user)) {
      return res.status(403).json({ error: 'Path outside workspace' });
    }

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
router.post('/diff/apply', requireWorkspaceAccess, async (req, res) => {
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
router.post('/terminal/run', requireWorkspaceAccess, async (req, res) => {
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
router.post('/project-health', requireWorkspaceAccess, async (req, res) => {
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
    const ownedProject = await db.query(
      'SELECT id FROM projects WHERE id = $1 AND user_id = $2',
      [req.params.projectId, req.user.id]
    );
    if (ownedProject.rows.length === 0) {
      return res.status(404).json({ error: 'Project tapılmadı' });
    }
    const result = await db.query(
      `INSERT INTO project_memories (project_id, user_id, memory, updated_at) VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
       ON CONFLICT (project_id) DO UPDATE
       SET memory = EXCLUDED.memory, updated_at = CURRENT_TIMESTAMP
       WHERE project_memories.user_id = EXCLUDED.user_id
       RETURNING project_id`,
      [req.params.projectId, req.user.id, JSON.stringify(memory)]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Project tapılmadı' });
    }
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
router.get('/admin/stats', requireAdmin, async (req, res) => {
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
router.get('/admin/users', requireAdmin, async (req, res) => {
  try {
    const db = require('../db');
    if (!db.hasDatabase()) return res.json({ users: [{ id: 1, email: 'admin@local', name: 'Local Admin', role: 'admin' }] });
    const result = await db.query(`
      SELECT u.id, u.email, u.name, u.role, u.created_at, u.last_active,
        (SELECT COUNT(*) FROM conversations WHERE user_id = u.id) as conversation_count,
        (SELECT COUNT(*) FROM messages WHERE user_id = u.id) as message_count
      FROM users u ORDER BY u.created_at DESC LIMIT 50
    `);
    res.json({ users: result.rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/admin/login-history — Login history for all users
router.get('/admin/login-history', requireAdmin, async (req, res) => {
  try {
    const db = require('../db');
    if (!db.hasDatabase()) return res.json({ logins: [] });
    const result = await db.query(`
      SELECT lh.id, lh.email, lh.success, lh.ip_address, lh.user_agent, lh.method, lh.created_at,
        u.name as user_name
      FROM login_history lh
      LEFT JOIN users u ON u.id = lh.user_id
      ORDER BY lh.created_at DESC
      LIMIT 100
    `);
    res.json({ logins: result.rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/admin/sessions — User session durations
router.get('/admin/sessions', requireAdmin, async (req, res) => {
  try {
    const db = require('../db');
    if (!db.hasDatabase()) return res.json({ sessions: [] });
    const result = await db.query(`
      SELECT s.id, s.user_id, s.started_at, s.last_seen_at, s.ended_at, 
        COALESCE(s.duration_minutes, EXTRACT(EPOCH FROM (COALESCE(s.ended_at, s.last_seen_at) - s.started_at)) / 60) as duration_minutes,
        s.ip_address, u.name as user_name, u.email
      FROM user_sessions s
      LEFT JOIN users u ON u.id = s.user_id
      ORDER BY s.started_at DESC
      LIMIT 100
    `);
    res.json({ sessions: result.rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/admin/errors — Error logs
router.get('/admin/errors', requireAdmin, async (req, res) => {
  try {
    const db = require('../db');
    if (!db.hasDatabase()) return res.json({ errors: [] });
    const result = await db.query(`
      SELECT e.id, e.user_id, e.email, e.error_type, e.error_message, e.endpoint, e.metadata, e.created_at,
        u.name as user_name
      FROM error_logs e
      LEFT JOIN users u ON u.id = e.user_id
      ORDER BY e.created_at DESC
      LIMIT 100
    `);
    res.json({ errors: result.rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/attachments/extract — Extract attachment content
router.post('/attachments/extract', async (req, res) => {
  try {
    const { extractAttachment } = require('../helpers');
    const attachments = Array.isArray(req.body.attachments)
      ? req.body.attachments
      : req.body.attachment
        ? [req.body.attachment]
        : [];
    if (attachments.length === 0) return res.status(400).json({ error: 'attachment tələb olunur' });
    const results = await Promise.all(
      attachments.map(async (attachment) => {
        const result = await extractAttachment(attachment);
        return {
          id: attachment?.id,
          name: attachment?.name || result.name || 'attachment',
          type: attachment?.type || 'file',
          mimeType: attachment?.mimeType || result.mimeType || 'application/octet-stream',
          extractedText: result.extractedText || '',
          extractionError: result.extractionError,
          imageUrl: attachment?.type === 'image' ? attachment?.url : undefined
        };
      })
    );
    res.json({ attachments: results });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// NOTE: mcpGateway is a process-global singleton. Reloading (or status-triggered
// config loads for a different workspace) swaps the gateway to that workspace,
// so a concurrently running chat session that is mid-call on MCP tools from a
// different project can have its server processes torn down. This is an accepted
// trade-off for a single-workspace desktop session; status/reload use short
// timeouts so a hung server never blocks the panel for long.
const MCP_PANEL_TIMEOUTS = { initTimeoutMs: 3000, toolsTimeoutMs: 3000 };

// POST /api/mcp/reload — Reset MCP gateway cache and reload config for a workspace
router.post('/mcp/reload', requireWorkspaceAccess, async (req, res) => {
  try {
    const resolvedWD = resolveWorkingDirectory(req.body.workingDirectory, req.user);
    const { mcpGateway } = require('../chat/mcpGateway');
    const { resetMcpConfigCache } = require('../helpers');
    mcpGateway.closeAll();
    resetMcpConfigCache();
    const { loadMcpConfigForWorkingDirectory } = require('../helpers');
    const tools = await loadMcpConfigForWorkingDirectory(resolvedWD, MCP_PANEL_TIMEOUTS);
    res.json({
      workingDirectory: resolvedWD,
      servers: mcpGateway.getStatus(),
      toolCount: tools.length,
      tools: tools.map((t) => t.function?.name || '').filter(Boolean),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/mcp/status — MCP server status for the MCP panel (desktop)
router.get('/mcp/status', requireWorkspaceAccess, async (req, res) => {
  try {
    const resolvedWD = resolveWorkingDirectory(req.query.workingDirectory, req.user);
    const { mcpGateway } = require('../chat/mcpGateway');
    const { loadMcpConfigForWorkingDirectory } = require('../helpers');
    const tools = await loadMcpConfigForWorkingDirectory(resolvedWD, MCP_PANEL_TIMEOUTS);
    res.json({
      workingDirectory: resolvedWD,
      servers: mcpGateway.getStatus(),
      toolCount: tools.length,
      tools: tools.map((t) => t.function?.name || '').filter(Boolean),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
