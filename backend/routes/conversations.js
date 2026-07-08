// ==========================================
// Conversations Route
// ==========================================

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { serializeConversation } = require('../helpers');
const db = require('../db');

function normalizeMessages(messages = []) {
  return (Array.isArray(messages) ? messages : []).map((msg, index) => ({
    id: msg?.id || crypto.randomUUID(),
    role: msg?.role || 'assistant',
    content: typeof msg?.content === 'string' ? msg.content : '',
    attachments: Array.isArray(msg?.attachments) ? msg.attachments : [],
    timestamp: typeof msg?.timestamp === 'number' ? msg.timestamp : Date.now() + index,
    tool_calls: Array.isArray(msg?.tool_calls) ? msg.tool_calls : undefined,
    tool_call_id: typeof msg?.tool_call_id === 'string' ? msg.tool_call_id : undefined,
  }));
}

async function loadMessagesForConversation(conversationId) {
  const result = await db.query(
    `SELECT id, role, content, attachments, tool_calls, tool_call_id, timestamp, created_at
     FROM messages
     WHERE conversation_id = $1
     ORDER BY created_at ASC, id ASC`,
    [conversationId]
  );
  return result.rows.map((row) => ({
    id: row.id,
    role: row.role,
    content: row.content || '',
    attachments: Array.isArray(row.attachments) ? row.attachments : [],
    timestamp: typeof row.timestamp === 'number'
      ? row.timestamp
      : (row.created_at ? new Date(row.created_at).getTime() : Date.now()),
    tool_calls: Array.isArray(row.tool_calls) && row.tool_calls.length > 0 ? row.tool_calls : undefined,
    tool_call_id: row.tool_call_id || undefined,
  }));
}

async function replaceConversationMessages(client, conversationId, userId, rawMessages = []) {
  const messages = normalizeMessages(rawMessages);
  await client.query('DELETE FROM messages WHERE conversation_id = $1', [conversationId]);
  for (const message of messages) {
    await client.query(
      `INSERT INTO messages (id, conversation_id, user_id, role, content, attachments, tool_calls, tool_call_id, timestamp)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        message.id,
        conversationId,
        userId,
        message.role,
        message.content,
        JSON.stringify(message.attachments || []),
        JSON.stringify(message.tool_calls || []),
        message.tool_call_id || null,
        message.timestamp || Date.now()
      ]
    );
  }
  await client.query(
    `UPDATE conversations
     SET messages = $1,
         last_message_at = CASE WHEN $2::bigint IS NULL THEN last_message_at ELSE to_timestamp($2::bigint / 1000.0) END,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $3`,
    [
      JSON.stringify(messages),
      messages.length > 0 ? messages[messages.length - 1].timestamp : null,
      conversationId
    ]
  );
  return messages;
}

// GET /api/conversations — List conversations for a project
router.get('/', async (req, res) => {
  try {
    const projectId = req.query.projectId;
    if (!db.hasDatabase()) return res.json({ conversations: [] });

    if (projectId) {
      const result = await db.query(
        `SELECT c.*,
                COALESCE(m.preview, '') AS preview,
                COALESCE(m.message_count, 0)::int AS message_count
         FROM conversations c
         LEFT JOIN (
           SELECT conversation_id,
                  COUNT(*)::int AS message_count,
                  MAX(created_at) AS latest_created_at,
                  (ARRAY_AGG(NULLIF(TRIM(content), '') ORDER BY created_at DESC))[1] AS preview
           FROM messages
           GROUP BY conversation_id
         ) m ON m.conversation_id = c.id
         WHERE c.user_id = $1 AND c.project_id = $2 AND c.archived = false
         ORDER BY COALESCE(c.last_message_at, c.updated_at) DESC`,
        [req.user.id, projectId]
      );
      return res.json({ conversations: result.rows.map((row) => serializeConversation({ ...row, messages: [] })) });
    }
    const result = await db.query(
      `SELECT c.*,
              COALESCE(m.preview, '') AS preview,
              COALESCE(m.message_count, 0)::int AS message_count
       FROM conversations c
       LEFT JOIN (
         SELECT conversation_id,
                COUNT(*)::int AS message_count,
                MAX(created_at) AS latest_created_at,
                (ARRAY_AGG(NULLIF(TRIM(content), '') ORDER BY created_at DESC))[1] AS preview
         FROM messages
         GROUP BY conversation_id
       ) m ON m.conversation_id = c.id
       WHERE c.user_id = $1 AND c.archived = false
       ORDER BY COALESCE(c.last_message_at, c.updated_at) DESC
       LIMIT 100`,
      [req.user.id]
    );
    res.json({ conversations: result.rows.map((row) => serializeConversation({ ...row, messages: [] })) });
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
    const convTitle = title || 'Yeni chat';

    if (!db.hasDatabase()) {
      return res.json({
        conversation: { id, projectId: projectId || null, title: convTitle, messages: messages || [], createdAt: Date.now(), updatedAt: Date.now() }
      });
    }

    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      const seedMessages = normalizeMessages(messages || []);
      const result = await client.query(
        `INSERT INTO conversations (id, project_id, user_id, title, messages, archived, last_message_at)
         VALUES ($1, $2, $3, $4, $5, false, CURRENT_TIMESTAMP)
         RETURNING *`,
        [id, projectId || null, req.user.id, convTitle, JSON.stringify(seedMessages)]
      );
      if (seedMessages.length > 0) {
        await replaceConversationMessages(client, id, req.user.id, seedMessages);
      }
      await client.query('COMMIT');
      const row = result.rows[0];
      row.messages = seedMessages;
      res.json({ conversation: serializeConversation(row) });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (e) {
    console.error('Create conversation error:', e);
    res.status(500).json({ error: 'Server xətası' });
  }
});

router.get('/:id/messages', async (req, res) => {
  try {
    if (!db.hasDatabase()) return res.json({ messages: [] });
    const ownsConversation = await db.query(
      'SELECT id FROM conversations WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    if (ownsConversation.rows.length === 0) return res.status(404).json({ error: 'Conversation tapılmadı' });
    const messages = await loadMessagesForConversation(req.params.id);
    res.json({ messages });
  } catch (e) {
    console.error('Load conversation messages error:', e);
    res.status(500).json({ error: 'Server xətası' });
  }
});

async function patchConversation(req, res) {
  try {
    const { title, messages, archived } = req.body;
    if (!db.hasDatabase()) return res.json({ success: true });
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      const existingResult = await client.query(
        'SELECT * FROM conversations WHERE id = $1 AND user_id = $2 FOR UPDATE',
        [req.params.id, req.user.id]
      );
      if (existingResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Conversation tapılmadı' });
      }
      const existing = existingResult.rows[0];
      let normalized = Array.isArray(existing.messages) ? existing.messages : [];
      if (messages) {
        normalized = await replaceConversationMessages(client, req.params.id, req.user.id, messages);
      }
      const updateResult = await client.query(
        `UPDATE conversations
         SET title = COALESCE($1, title),
             archived = COALESCE($2, archived),
             messages = COALESCE($3, messages),
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $4 AND user_id = $5
         RETURNING *`,
        [title || null, typeof archived === 'boolean' ? archived : null, messages ? JSON.stringify(normalized) : null, req.params.id, req.user.id]
      );
      await client.query('COMMIT');
      updateResult.rows[0].messages = normalized;
      res.json({ conversation: serializeConversation(updateResult.rows[0]) });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (e) {
    console.error('Update conversation error:', e);
    res.status(500).json({ error: 'Server xətası' });
  }
}

// PATCH /api/conversations/:id — Update conversation
router.patch('/:id', patchConversation);
router.put('/:id', patchConversation);

// DELETE /api/conversations/:id
router.delete('/:id', async (req, res) => {
  try {
    if (!db.hasDatabase()) return res.json({ success: true });
    await db.query('UPDATE conversations SET archived = true, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    res.json({ success: true });
  } catch (e) {
    console.error('Delete conversation error:', e);
    res.status(500).json({ error: 'Server xətası' });
  }
});

module.exports = router;
