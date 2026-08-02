// ==========================================
// Conversations — Append-only upsert tests
// Verifies the PATCH/POST message write path uses
// INSERT ... ON CONFLICT (id) DO UPDATE (never a
// destructive DELETE-all + INSERT-all) and only
// reconciles rows that are absent from the
// authoritative client list.
// Run with: cd backend && npx vitest run tests/conversations.test.js
// ==========================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const fake = vi.hoisted(() => {
  const state = {
    conversations: new Map(),
    messages: new Map(),
    queries: [],
  };

  function run(text, params = []) {
    state.queries.push({ text: text.replace(/\s+/g, ' ').trim(), params });
    const t = text.replace(/\s+/g, ' ').trim();

    if (t.startsWith('BEGIN') || t.startsWith('COMMIT') || t.startsWith('ROLLBACK')) {
      return { rows: [] };
    }

    if (t.includes('FOR UPDATE')) {
      const row = state.conversations.get(params[0]);
      return { rows: row ? [{ ...row }] : [] };
    }

    if (t.startsWith('INSERT INTO conversations')) {
      // $1 id, $2 project_id, $3 user_id, $4 title, $5 messages, $6 summary_text
      const row = {
        id: params[0],
        project_id: params[1],
        user_id: params[2],
        title: params[3],
        messages: params[4],
        summary_text: params[5] || '',
        archived: false,
        last_message_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      state.conversations.set(row.id, row);
      return { rows: [{ ...row }] };
    }

    if (t.startsWith('INSERT INTO messages')) {
      const [id, convId, userId, role, content, attachments, toolCalls, toolCallId, timestamp] = params;
      const existing = state.messages.get(id);
      if (existing) {
        // ON CONFLICT (id) DO UPDATE ... WHERE messages.conversation_id = EXCLUDED.conversation_id
        if (existing.conversation_id === convId) {
          Object.assign(existing, {
            user_id: userId,
            role,
            content,
            attachments,
            tool_calls: toolCalls,
            tool_call_id: toolCallId,
            timestamp,
          });
        }
        // Cross-conversation id conflict: WHERE guard fails → row untouched.
      } else {
        state.messages.set(id, {
          id,
          conversation_id: convId,
          user_id: userId,
          role,
          content,
          attachments,
          tool_calls: toolCalls,
          tool_call_id: toolCallId,
          timestamp,
          created_at: new Date(timestamp && timestamp > 0 ? timestamp : Date.now()).toISOString(),
        });
      }
      return { rows: [] };
    }

    if (t.startsWith('DELETE FROM messages')) {
      if (t.includes('ANY(')) {
        const [convId, idList] = params;
        for (const [mid, mrow] of [...state.messages]) {
          if (mrow.conversation_id === convId && !idList.includes(mid)) {
            state.messages.delete(mid);
          }
        }
      } else {
        const [convId] = params;
        for (const [mid, mrow] of [...state.messages]) {
          if (mrow.conversation_id === convId) state.messages.delete(mid);
        }
      }
      return { rows: [] };
    }

    if (t.startsWith('UPDATE conversations') && t.includes('RETURNING')) {
      // PATCH final UPDATE: $1 title, $2 archived, $3 messages, $4 summary_text, $5 id, $6 user_id
      const row = state.conversations.get(params[4]);
      if (row) {
        if (params[0] != null) row.title = params[0];
        if (params[1] != null) row.archived = params[1];
        if (params[2] != null) row.messages = params[2];
        if (params[3] != null) row.summary_text = params[3];
        row.updated_at = new Date().toISOString();
        return { rows: [{ ...row }] };
      }
      return { rows: [] };
    }

    if (t.startsWith('UPDATE conversations')) {
      // upsert trailing UPDATE: $1 messages, $2 summary_text, $3 last_message_at, $4 id
      const row = state.conversations.get(params[3]);
      if (row) {
        row.messages = params[0];
        if (params[1] != null) row.summary_text = params[1];
        row.updated_at = new Date().toISOString();
        return { rows: [] };
      }
      return { rows: [] };
    }

    return { rows: [] };
  }

  const fakeClient = {
    query: async (text, params) => run(text, params),
    release: () => {},
  };

  return {
    state,
    db: {
      hasDatabase: () => true,
      query: async (text, params) => run(text, params),
      pool: { connect: async () => fakeClient },
    },
  };
});

vi.mock('../db', () => fake.db);

import conversationsRouter from '../routes/conversations.js';

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  req.user = { id: 7 };
  next();
});
app.use('/api/conversations', conversationsRouter);

const norm = (sql) => sql.replace(/\s+/g, ' ').trim();

const msg = (id, role, content, timestamp) => ({ id, role, content, timestamp });

async function createConversation(title = 'Test') {
  const r = await request(app).post('/api/conversations').send({ title });
  expect(r.status).toBe(200);
  return r.body.conversation.id;
}

beforeEach(() => {
  fake.state.conversations.clear();
  fake.state.messages.clear();
  fake.state.queries.length = 0;
});

describe('append-only upsert write path', () => {
  it('POST seeds messages with upsert (no DELETE needed)', async () => {
    const convId = await createConversation();
    await request(app)
      .patch(`/api/conversations/${convId}`)
      .send({ messages: [msg('m1', 'user', 'salam', 1000), msg('m2', 'assistant', 'salam!', 2000)] });

    expect(fake.state.messages.has('m1')).toBe(true);
    expect(fake.state.messages.has('m2')).toBe(true);
    const inserts = fake.state.queries.filter((q) => q.text.startsWith('INSERT INTO messages'));
    expect(inserts).toHaveLength(2);
  });

  it('appends new messages and preserves existing rows (same created_at, same id)', async () => {
    const convId = await createConversation();
    await request(app)
      .patch(`/api/conversations/${convId}`)
      .send({ messages: [msg('m1', 'user', 'hello', 1000), msg('m2', 'assistant', 'hi', 2000)] });
    const firstCreatedAt = fake.state.messages.get('m1').created_at;

    await request(app)
      .patch(`/api/conversations/${convId}`)
      .send({ messages: [msg('m1', 'user', 'hello', 1000), msg('m2', 'assistant', 'hi', 2000), msg('m3', 'user', 'davam', 3000)] });

    expect(fake.state.messages.size).toBe(3);
    expect(fake.state.messages.get('m1').created_at).toBe(firstCreatedAt);
    expect(fake.state.messages.get('m2').created_at).toBe(fake.state.messages.get('m2').created_at);
    expect(fake.state.messages.get('m3')).toBeTruthy();
  });

  it('updates existing message content in place without recreating the row', async () => {
    const convId = await createConversation();
    await request(app)
      .patch(`/api/conversations/${convId}`)
      .send({ messages: [msg('m1', 'user', 'orijinal', 1000)] });
    const original = fake.state.messages.get('m1');

    const r = await request(app)
      .patch(`/api/conversations/${convId}`)
      .send({ messages: [msg('m1', 'user', 'redaktə edildi', 1000)] });

    expect(r.status).toBe(200);
    expect(fake.state.messages.get('m1').content).toBe('redaktə edildi');
    // Row identity + ordering preserved: created_at untouched by DO UPDATE
    expect(fake.state.messages.get('m1').created_at).toBe(original.created_at);
  });

  it('reconciles only messages removed from the authoritative list (retry/edit truncation)', async () => {
    const convId = await createConversation();
    await request(app)
      .patch(`/api/conversations/${convId}`)
      .send({ messages: [msg('m1', 'user', 'a', 1000), msg('m2', 'assistant', 'b', 2000), msg('m3', 'user', 'c', 3000)] });

    // Retry semantics: client truncates m2/m3 and sends [m1] + fresh m4
    await request(app)
      .patch(`/api/conversations/${convId}`)
      .send({ messages: [msg('m1', 'user', 'a', 1000), msg('m4', 'assistant', 'b2', 4000)] });

    expect(fake.state.messages.has('m1')).toBe(true);
    expect(fake.state.messages.has('m2')).toBe(false);
    expect(fake.state.messages.has('m3')).toBe(false);
    expect(fake.state.messages.has('m4')).toBe(true);
  });

  it('clears the conversation when the client sends an empty message list', async () => {
    const convId = await createConversation();
    await request(app)
      .patch(`/api/conversations/${convId}`)
      .send({ messages: [msg('m1', 'user', 'a', 1000)] });
    expect(fake.state.messages.size).toBe(1);

    await request(app)
      .patch(`/api/conversations/${convId}`)
      .send({ messages: [] });

    expect(fake.state.messages.size).toBe(0);
  });

  it('never issues a full DELETE-all for the conversation', async () => {
    const convId = await createConversation();
    await request(app)
      .patch(`/api/conversations/${convId}`)
      .send({ messages: [msg('m1', 'user', 'a', 1000), msg('m2', 'assistant', 'b', 2000)] });
    await request(app)
      .patch(`/api/conversations/${convId}`)
      .send({ messages: [msg('m1', 'user', 'a', 1000)] });

    const fullDeletes = fake.state.queries.filter(
      (q) => q.text === 'DELETE FROM messages WHERE conversation_id = $1'
    );
    expect(fullDeletes).toHaveLength(0);
  });

  it('emits ON CONFLICT DO UPDATE with preserved created_at + conversation guard + client-timestamp ordering', async () => {
    const convId = await createConversation();
    await request(app)
      .patch(`/api/conversations/${convId}`)
      .send({ messages: [msg('m1', 'user', 'a', 1500000000000)] });

    const insert = fake.state.queries.find((q) => q.text.startsWith('INSERT INTO messages'));
    expect(insert.text).toContain('ON CONFLICT (id) DO UPDATE');
    const doUpdate = insert.text.split('DO UPDATE SET')[1];
    expect(doUpdate).not.toContain('created_at');
    expect(doUpdate).toContain('WHERE messages.conversation_id = EXCLUDED.conversation_id');
    expect(insert.text).toContain('to_timestamp($9::bigint / 1000.0)');
    expect(insert.text).toContain('CASE WHEN $9::bigint IS NOT NULL AND $9::bigint > 0');

    const reconcile = fake.state.queries.find((q) => q.text.includes('ANY($2::text[])'));
    expect(reconcile).toBeTruthy();
    expect(reconcile.params[0]).toBe(convId);
    expect(reconcile.params[1]).toEqual(['m1']);
  });

  it('derives created_at from the client timestamp for fresh inserts', async () => {
    const convId = await createConversation();
    await request(app)
      .patch(`/api/conversations/${convId}`)
      .send({ messages: [msg('m1', 'user', 'a', 1600000000000)] });

    const row = fake.state.messages.get('m1');
    expect(new Date(row.created_at).getTime()).toBe(1600000000000);
  });

  it('does not move a message across conversations on id conflict', async () => {
    const convA = await createConversation('A');
    const convB = await createConversation('B');
    await request(app)
      .patch(`/api/conversations/${convA}`)
      .send({ messages: [msg('dup', 'user', 'in A', 1000)] });

    // Same message id sent to conversation B → WHERE guard leaves the row in A
    await request(app)
      .patch(`/api/conversations/${convB}`)
      .send({ messages: [msg('dup', 'user', 'in B', 2000)] });

    expect(fake.state.messages.get('dup').conversation_id).toBe(convA);
    expect(fake.state.messages.get('dup').content).toBe('in A');
  });

  it('resending the same list is idempotent (no row churn)', async () => {
    const convId = await createConversation();
    const payload = { messages: [msg('m1', 'user', 'a', 1000), msg('m2', 'assistant', 'b', 2000)] };
    await request(app).patch(`/api/conversations/${convId}`).send(payload);
    const before = { size: fake.state.messages.size, m1: fake.state.messages.get('m1').created_at };

    await request(app).patch(`/api/conversations/${convId}`).send(payload);
    await request(app).patch(`/api/conversations/${convId}`).send(payload);

    expect(fake.state.messages.size).toBe(before.size);
    expect(fake.state.messages.get('m1').created_at).toBe(before.m1);
    expect(fake.state.messages.get('m1').content).toBe('a');
  });
});
