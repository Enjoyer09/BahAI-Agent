// ==========================================
// Conversations Route
// ==========================================

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { serializeConversation } = require('../helpers');
const db = require('../db');

const MAX_PERSISTED_CONTENT = {
  user: 12000,
  assistant: 16000,
  tool: 4000,
  system: 2000,
};

function trimText(value, max) {
  const text = typeof value === 'string' ? value : '';
  if (!max || text.length <= max) return text;
  return `${text.slice(0, max)}\n...[truncated]`;
}

function compactToolCalls(toolCalls = []) {
  if (!Array.isArray(toolCalls)) return undefined;
  const compacted = toolCalls.slice(0, 12).map((toolCall) => ({
    id: toolCall?.id,
    type: toolCall?.type || 'function',
    function: toolCall?.function ? {
      name: toolCall.function.name,
      arguments: trimText(toolCall.function.arguments, 2000),
    } : (toolCall?.name || toolCall?.args) ? {
      name: toolCall.name,
      arguments: trimText(toolCall.args, 2000),
    } : undefined,
    status: toolCall?.status,
  })).filter((toolCall) => toolCall.function?.name || toolCall.id);
  return compacted.length > 0 ? compacted : undefined;
}

function sanitizePersistedMessage(msg = {}, index = 0) {
  const role = msg?.role || 'assistant';
  const contentLimit = MAX_PERSISTED_CONTENT[role] || 8000;
  return {
    id: msg?.id || crypto.randomUUID(),
    role,
    content: trimText(msg?.content, contentLimit),
    attachments: Array.isArray(msg?.attachments) ? msg.attachments.slice(0, 8).map((attachment) => ({
      id: attachment?.id,
      name: attachment?.name,
      type: attachment?.type,
      mimeType: attachment?.mimeType,
      url: role === 'user' ? attachment?.url : undefined,
      extractionError: attachment?.extractionError,
      extractedText: trimText(attachment?.extractedText, 3000),
    })) : [],
    timestamp: typeof msg?.timestamp === 'number' ? msg.timestamp : Date.now() + index,
    tool_calls: compactToolCalls(msg?.tool_calls),
    tool_call_id: typeof msg?.tool_call_id === 'string' ? msg.tool_call_id : undefined,
  };
}

function normalizeMessages(messages = []) {
  return (Array.isArray(messages) ? messages : []).map((msg, index) => sanitizePersistedMessage(msg, index));
}

function buildConversationSnapshot(messages = []) {
  if (!Array.isArray(messages) || messages.length === 0) return [];
  const kept = messages.filter((message) => message.role !== 'system').slice(-40);
  return kept.map((message, index) => sanitizePersistedMessage(message, index));
}

function buildConversationSummary(messages = []) {
  if (!Array.isArray(messages) || messages.length <= 40) return '';
  const older = messages.filter((message) => message.role !== 'system').slice(0, -40);
  if (older.length === 0) return '';
  const counts = older.reduce((acc, message) => {
    const role = message?.role || 'assistant';
    acc[role] = (acc[role] || 0) + 1;
    return acc;
  }, {});
  const highlights = older
    .filter((message) => message?.role === 'user' || message?.role === 'assistant')
    .map((message) => trimText(String(message?.content || '').replace(/\s+/g, ' ').trim(), 220))
    .filter(Boolean)
    .slice(-6);

  const parts = [];
  parts.push(`Archived ${older.length} older messages.`);
  if (counts.user) parts.push(`user:${counts.user}`);
  if (counts.assistant) parts.push(`assistant:${counts.assistant}`);
  if (counts.tool) parts.push(`tool:${counts.tool}`);
  if (highlights.length > 0) {
    parts.push(`Highlights: ${highlights.join(' | ')}`);
  }
  return trimText(parts.join(' '), 2000);
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

async function loadMessagesPageForConversation(conversationId, limit = 100, beforeCreatedAt = null) {
  const safeLimit = Math.max(1, Math.min(limit, 200));
  const params = [conversationId];
  let whereClause = 'WHERE conversation_id = $1';
  if (beforeCreatedAt) {
    params.push(beforeCreatedAt);
    whereClause += ` AND created_at < $${params.length}`;
  }
  params.push(safeLimit + 1);
  const result = await db.query(
    `SELECT id, role, content, attachments, tool_calls, tool_call_id, timestamp, created_at
     FROM messages
     ${whereClause}
     ORDER BY created_at DESC, id DESC
     LIMIT $${params.length}`,
    params
  );
  const rows = result.rows.slice(0, safeLimit).reverse();
  return {
    messages: rows.map((row) => ({
      id: row.id,
      role: row.role,
      content: row.content || '',
      attachments: Array.isArray(row.attachments) ? row.attachments : [],
      timestamp: typeof row.timestamp === 'number'
        ? row.timestamp
        : (row.created_at ? new Date(row.created_at).getTime() : Date.now()),
      tool_calls: Array.isArray(row.tool_calls) && row.tool_calls.length > 0 ? row.tool_calls : undefined,
      tool_call_id: row.tool_call_id || undefined,
    })),
    hasMore: result.rows.length > safeLimit
  };
}

async function replaceConversationMessages(client, conversationId, userId, rawMessages = []) {
  const messages = normalizeMessages(rawMessages);
  const summaryText = buildConversationSummary(messages);
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
         summary_text = $2,
         last_message_at = CASE WHEN $3::bigint IS NULL THEN last_message_at ELSE to_timestamp($3::bigint / 1000.0) END,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $4`,
    [
      JSON.stringify(buildConversationSnapshot(messages)),
      summaryText,
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
    const search = String(req.query.q || '').trim();
    const limit = Math.max(1, Math.min(parseInt(String(req.query.limit || '100'), 10) || 100, 200));
    const offset = Math.max(0, parseInt(String(req.query.offset || '0'), 10) || 0);
    if (!db.hasDatabase()) return res.json({ conversations: [] });

    if (projectId) {
      const params = [req.user.id, projectId];
      let searchClause = '';
      if (search) {
        params.push(`%${search}%`);
        searchClause = ` AND (c.title ILIKE $${params.length} OR COALESCE(m.preview, '') ILIKE $${params.length})`;
      }
      params.push(limit + 1, offset);
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
         WHERE c.user_id = $1 AND c.project_id = $2 AND c.archived = false${searchClause}
         ORDER BY COALESCE(c.last_message_at, c.updated_at) DESC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params
      );
      const rows = result.rows.slice(0, limit);
      return res.json({
        conversations: rows.map((row) => serializeConversation({ ...row, messages: [] })),
        pagination: { limit, offset, hasMore: result.rows.length > limit }
      });
    }
    const params = [req.user.id];
    let searchClause = '';
    if (search) {
      params.push(`%${search}%`);
      searchClause = ` AND (c.title ILIKE $${params.length} OR COALESCE(m.preview, '') ILIKE $${params.length})`;
    }
    params.push(limit + 1, offset);
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
       WHERE c.user_id = $1 AND c.archived = false${searchClause}
       ORDER BY COALESCE(c.last_message_at, c.updated_at) DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    const rows = result.rows.slice(0, limit);
    res.json({
      conversations: rows.map((row) => serializeConversation({ ...row, messages: [] })),
      pagination: { limit, offset, hasMore: result.rows.length > limit }
    });
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
      const summaryText = buildConversationSummary(seedMessages);
      const result = await client.query(
        `INSERT INTO conversations (id, project_id, user_id, title, messages, archived, last_message_at, summary_text)
         VALUES ($1, $2, $3, $4, $5, false, CURRENT_TIMESTAMP, $6)
         RETURNING *`,
        [id, projectId || null, req.user.id, convTitle, JSON.stringify(buildConversationSnapshot(seedMessages)), summaryText]
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
    const limit = Math.max(1, Math.min(parseInt(String(req.query.limit || '120'), 10) || 120, 200));
    const before = String(req.query.before || '').trim();
    const ownsConversation = await db.query(
      'SELECT id FROM conversations WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    if (ownsConversation.rows.length === 0) return res.status(404).json({ error: 'Conversation tapılmadı' });
    if (!before) {
      const page = await loadMessagesPageForConversation(req.params.id, limit);
      return res.json({ messages: page.messages, pagination: { hasMore: page.hasMore } });
    }
    const page = await loadMessagesPageForConversation(req.params.id, limit, before);
    res.json({ messages: page.messages, pagination: { hasMore: page.hasMore } });
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
      let summaryText = existing.summary_text || '';
      if (messages) {
        normalized = await replaceConversationMessages(client, req.params.id, req.user.id, messages);
        summaryText = buildConversationSummary(normalized);
      }
      const updateResult = await client.query(
        `UPDATE conversations
         SET title = COALESCE($1, title),
             archived = COALESCE($2, archived),
             messages = COALESCE($3, messages),
             summary_text = COALESCE($4, summary_text),
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $5 AND user_id = $6
         RETURNING *`,
        [title || null, typeof archived === 'boolean' ? archived : null, messages ? JSON.stringify(buildConversationSnapshot(normalized)) : null, messages ? summaryText : null, req.params.id, req.user.id]
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
