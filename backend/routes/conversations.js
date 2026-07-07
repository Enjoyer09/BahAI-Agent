// ==========================================
// Conversations Route
// ==========================================

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { serializeConversation } = require('../helpers');
const db = require('../db');

// GET /api/conversations — List conversations for a project
router.get('/', async (req, res) => {
  try {
    const projectId = req.query.projectId;
    if (!db.hasDatabase()) return res.json({ conversations: [] });

    if (projectId) {
      const result = await db.query(
        'SELECT * FROM conversations WHERE user_id = $1 AND project_id = $2 ORDER BY updated_at DESC',
        [req.user.id, projectId]
      );
      return res.json({ conversations: result.rows.map(serializeConversation) });
    }
    const result = await db.query(
      'SELECT * FROM conversations WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 50',
      [req.user.id]
    );
    res.json({ conversations: result.rows.map(serializeConversation) });
  } catch (e) {
    console.error('List conversations error:', e);
    res.status(500).json({ error: 'Server xətası' });
  }
});

// POST /api/conversations — Create conversation
router.post('/', async (req, res) => {
  try {
    const { projectId, title, messages } = req.body;
    const id = crypto.randomUUID();
    const convTitle = title || 'Yeni söhbət';

    if (!db.hasDatabase()) {
      return res.json({
        conversation: { id, projectId: projectId || null, title: convTitle, messages: messages || [], createdAt: Date.now(), updatedAt: Date.now() }
      });
    }

    const result = await db.query(
      'INSERT INTO conversations (id, project_id, user_id, title, messages) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [id, projectId || null, req.user.id, convTitle, JSON.stringify(messages || [])]
    );
    res.json({ conversation: serializeConversation(result.rows[0]) });
  } catch (e) {
    console.error('Create conversation error:', e);
    res.status(500).json({ error: 'Server xətası' });
  }
});

// PUT /api/conversations/:id — Update conversation
router.put('/:id', async (req, res) => {
  try {
    const { title, messages } = req.body;
    if (!db.hasDatabase()) return res.json({ success: true });

    const result = await db.query(
      'UPDATE conversations SET title = COALESCE($1, title), messages = COALESCE($2, messages), updated_at = CURRENT_TIMESTAMP WHERE id = $3 AND user_id = $4 RETURNING *',
      [title || null, messages ? JSON.stringify(messages) : null, req.params.id, req.user.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Conversation tapılmadı' });
    res.json({ conversation: serializeConversation(result.rows[0]) });
  } catch (e) {
    console.error('Update conversation error:', e);
    res.status(500).json({ error: 'Server xətası' });
  }
});

// DELETE /api/conversations/:id
router.delete('/:id', async (req, res) => {
  try {
    if (!db.hasDatabase()) return res.json({ success: true });
    await db.query('DELETE FROM conversations WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    res.json({ success: true });
  } catch (e) {
    console.error('Delete conversation error:', e);
    res.status(500).json({ error: 'Server xətası' });
  }
});

module.exports = router;
