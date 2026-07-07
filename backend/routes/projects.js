// ==========================================
// Projects Route
// ==========================================

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { serializeProject } = require('../helpers');
const db = require('../db');

// GET /api/projects — List user projects
router.get('/', async (req, res) => {
  try {
    if (!db.hasDatabase()) {
      return res.json({ projects: [{ id: 'default', name: 'Local Workspace', path: process.cwd(), archived: false, createdAt: Date.now() }] });
    }
    const result = await db.query('SELECT * FROM projects WHERE user_id = $1 AND archived = false ORDER BY created_at DESC', [req.user.id]);
    res.json({ projects: result.rows.map(serializeProject) });
  } catch (e) {
    console.error('List projects error:', e);
    res.status(500).json({ error: 'Server xətası' });
  }
});

// POST /api/projects — Create project
router.post('/', async (req, res) => {
  try {
    const { name, path: projectPath, repoUrl } = req.body;
    if (!name || !projectPath) return res.status(400).json({ error: 'name və path tələb olunur' });

    if (!db.hasDatabase()) {
      return res.json({ project: { id: `local_${Date.now()}`, name, path: projectPath, repoUrl, archived: false, createdAt: Date.now() } });
    }

    const id = crypto.randomUUID();
    const result = await db.query(
      'INSERT INTO projects (id, user_id, name, path, repo_url) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [id, req.user.id, name, projectPath, repoUrl || null]
    );
    res.json({ project: serializeProject(result.rows[0]) });
  } catch (e) {
    console.error('Create project error:', e);
    res.status(500).json({ error: 'Server xətası' });
  }
});

// DELETE /api/projects/:id — Delete/archive project
router.delete('/:id', async (req, res) => {
  try {
    if (!db.hasDatabase()) return res.json({ success: true });

    const result = await db.query(
      'UPDATE projects SET archived = true WHERE id = $1 AND user_id = $2 RETURNING *',
      [req.params.id, req.user.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Project tapılmadı' });
    res.json({ success: true });
  } catch (e) {
    console.error('Delete project error:', e);
    res.status(500).json({ error: 'Server xətası' });
  }
});

module.exports = router;
