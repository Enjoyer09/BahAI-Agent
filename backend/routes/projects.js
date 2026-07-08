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
      const localProjectId = `local_${Date.now()}`;
      const localConversationId = `local_conv_${Date.now()}`;
      return res.json({
        project: { id: localProjectId, name, path: projectPath, repoUrl, archived: false, createdAt: Date.now() },
        conversation: { id: localConversationId, projectId: localProjectId, title: 'Yeni chat', messages: [], createdAt: Date.now(), updatedAt: Date.now() }
      });
    }

    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      const id = crypto.randomUUID();
      const conversationId = crypto.randomUUID();
      const projectResult = await client.query(
        'INSERT INTO projects (id, user_id, name, path, repo_url) VALUES ($1, $2, $3, $4, $5) RETURNING *',
        [id, req.user.id, name, projectPath, repoUrl || null]
      );
      const conversationResult = await client.query(
        `INSERT INTO conversations (id, project_id, user_id, title, messages, archived, last_message_at)
         VALUES ($1, $2, $3, $4, $5, false, CURRENT_TIMESTAMP)
         RETURNING *`,
        [conversationId, id, req.user.id, 'Yeni chat', JSON.stringify([])]
      );
      await client.query('COMMIT');
      res.json({
        project: serializeProject(projectResult.rows[0]),
        conversation: {
          id: conversationResult.rows[0].id,
          projectId: conversationResult.rows[0].project_id,
          title: conversationResult.rows[0].title,
          messages: [],
          createdAt: new Date(conversationResult.rows[0].created_at).getTime(),
          updatedAt: new Date(conversationResult.rows[0].updated_at).getTime()
        }
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (e) {
    console.error('Create project error:', e);
    res.status(500).json({ error: 'Server xətası' });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const { name, path: projectPath, repoUrl, lastPort, archived } = req.body;
    if (!db.hasDatabase()) {
      return res.json({ project: { id: req.params.id, name, path: projectPath, repoUrl, lastPort, archived, createdAt: Date.now() } });
    }
    const result = await db.query(
      `UPDATE projects
       SET name = COALESCE($1, name),
           path = COALESCE($2, path),
           repo_url = COALESCE($3, repo_url),
           last_port = COALESCE($4, last_port),
           archived = COALESCE($5, archived)
       WHERE id = $6 AND user_id = $7
       RETURNING *`,
      [name || null, projectPath || null, repoUrl || null, Number.isFinite(lastPort) ? lastPort : null, typeof archived === 'boolean' ? archived : null, req.params.id, req.user.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Project tapılmadı' });
    res.json({ project: serializeProject(result.rows[0]) });
  } catch (e) {
    console.error('Update project error:', e);
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
