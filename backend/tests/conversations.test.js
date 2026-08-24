// ==========================================
// Conversations — Append-only upsert tests
//
// Verifies the PATCH/POST message write path uses
// INSERT ... ON CONFLICT (id) DO UPDATE (never a
// destructive DELETE-all + INSERT-all) and only
// reconciles rows absent from the authoritative
// client list (retry/edit truncation).
//
// NOTE: This repo's routes are loaded as external CJS,
// so vitest's vi.mock cannot intercept their require().
// We stub the db module via require.cache before loading
// the router (same mechanism the runner.test.js uses for
// dependency injection, but for a module-level require).
// This is safe because vitest isolates each test file in its
// own worker by default — the require.cache stub never leaks
// into other test files (would only matter with isolate:false).
//
// Run with: cd backend && npx vitest run tests/conversations.test.js
// ==========================================

import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

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
        pinned: false,
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
      // PATCH final UPDATE: $1 title, $2 archived, $3 messages, $4 summary_text, $5 pinned, $6 id, $7 user_id
      const row = state.conversations.get(params[5]);
      if (row) {
        if (params[0] != null) row.title = params[0];
        if (params[1] != null) row.archived = params[1];
        if (params[2] != null) row.messages = params[2];
        if (params[3] != null) row.summary_text = params[3];
        if (params[4] != null) row.pinned = params[4];
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

    if (t.startsWith('SELECT id FROM conversations')) {
      // Ownership check for GET /:id/messages: $1 = conversation id, $2 = user id
      const conv = state.conversations.get(params[0]);
      if (conv && conv.user_id === params[1]) return { rows: [{ id: conv.id }] };
      return { rows: [] };
    }

    if (t.startsWith('SELECT id, role, content, attachments, tool_calls, tool_call_id, timestamp, created_at')) {
      // loadMessagesPageForConversation: $1 conversation_id, optional $2 before
      // (ISO created_at), last param = LIMIT (safeLimit + 1 probe row). Mirrors
      // ORDER BY created_at DESC, id DESC so hasMore and page boundaries behave
      // exactly like Postgres.
      const convId = params[0];
      const hasBefore = params.length > 2;
      const before = hasBefore ? params[1] : null;
      const limit = params[params.length - 1];
      let rows = [...state.messages.values()].filter((m) => m.conversation_id === convId);
      if (before) rows = rows.filter((m) => m.created_at < before);
      rows = rows
        .sort((a, b) => {
          if (a.created_at !== b.created_at) return a.created_at < b.created_at ? 1 : -1;
          return a.id < b.id ? 1 : -1;
        })
        .slice(0, limit);
      return { rows: rows.map((r) => ({ ...r })) };
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

let app;

beforeAll(() => {
  // Stub the db module in the native require cache BEFORE loading the router so
  // its require('../db') resolves to the in-memory fake.
  const dbPath = require.resolve('../db.js');
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: fake.db };

  const conversationsRouter = require('../routes/conversations.js');
  app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 7 };
    next();
  });
  app.use('/api/conversations', conversationsRouter);
});

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

describe('GET /api/conversations/:id/messages pagination', () => {
  const ts = (n) => 1600000000000 + n * 1000;

  async function seedMessages(convId, count) {
    const messages = [];
    for (let i = 1; i <= count; i += 1) {
      messages.push(msg(`m${i}`, i % 2 === 0 ? 'assistant' : 'user', `mesaj-${i}`, ts(i)));
    }
    await request(app).patch(`/api/conversations/${convId}`).send({ messages });
  }

  it('returns the newest page in ascending order with hasMore=false when everything fits', async () => {
    const convId = await createConversation('Page');
    await seedMessages(convId, 5);

    const r = await request(app).get(`/api/conversations/${convId}/messages`);
    expect(r.status).toBe(200);
    expect(r.body.messages.map((m) => m.id)).toEqual(['m1', 'm2', 'm3', 'm4', 'm5']);
    expect(r.body.pagination.hasMore).toBe(false);
    // timestamps round-trip as numbers (created_at is preserved, not regenerated)
    expect(r.body.messages[0].timestamp).toBe(ts(1));
    expect(r.body.messages[4].timestamp).toBe(ts(5));

    // The emitted query must keep the deterministic ordering (created_at DESC,
    // id DESC tie-break) and probe safeLimit+1 rows to compute hasMore.
    const pageQuery = fake.state.queries
      .filter((q) => q.text.startsWith('SELECT id, role, content'))
      .pop();
    expect(pageQuery.text).toContain('ORDER BY created_at DESC, id DESC');
    expect(pageQuery.params[pageQuery.params.length - 1]).toBe(121); // 120 + 1 probe row
  });

  it('returns a trimmed page with hasMore=true when messages exceed the limit', async () => {
    const convId = await createConversation('Page');
    await seedMessages(convId, 5);

    const r = await request(app).get(`/api/conversations/${convId}/messages?limit=2`);
    expect(r.status).toBe(200);
    // newest 2 messages, oldest-first within the page
    expect(r.body.messages.map((m) => m.id)).toEqual(['m4', 'm5']);
    expect(r.body.pagination.hasMore).toBe(true);
  });

  it('walks backward with before without gaps or duplicates', async () => {
    const convId = await createConversation('Page');
    await seedMessages(convId, 5);

    const page1 = await request(app).get(`/api/conversations/${convId}/messages?limit=2`);
    expect(page1.body.messages.map((m) => m.id)).toEqual(['m4', 'm5']);
    expect(page1.body.pagination.hasMore).toBe(true);

    const before4 = new Date(ts(4)).toISOString();
    const page2 = await request(app)
      .get(`/api/conversations/${convId}/messages?limit=2&before=${encodeURIComponent(before4)}`);
    expect(page2.body.messages.map((m) => m.id)).toEqual(['m2', 'm3']);
    expect(page2.body.pagination.hasMore).toBe(true);

    const before2 = new Date(ts(2)).toISOString();
    const page3 = await request(app)
      .get(`/api/conversations/${convId}/messages?limit=2&before=${encodeURIComponent(before2)}`);
    expect(page3.body.messages.map((m) => m.id)).toEqual(['m1']);
    expect(page3.body.pagination.hasMore).toBe(false);

    const all = [...page1.body.messages, ...page2.body.messages, ...page3.body.messages].map((m) => m.id);
    expect(all).toEqual(['m4', 'm5', 'm2', 'm3', 'm1']);
    expect(new Set(all).size).toBe(5);
  });

  it('clamps safeLimit to 1 when the requested limit is <= 0', async () => {
    const convId = await createConversation('Page');
    await seedMessages(convId, 3);

    const r = await request(app).get(`/api/conversations/${convId}/messages?limit=-5`);
    expect(r.status).toBe(200);
    expect(r.body.messages.map((m) => m.id)).toEqual(['m3']);
    expect(r.body.pagination.hasMore).toBe(true);

    const pageQuery = fake.state.queries
      .filter((q) => q.text.startsWith('SELECT id, role, content'))
      .pop();
    expect(pageQuery.params[pageQuery.params.length - 1]).toBe(2); // safeLimit + 1 probe row
  });

  it('clamps safeLimit to 200 and never fetches more than 200 messages', async () => {
    const convId = await createConversation('Page');
    await seedMessages(convId, 250);

    const r = await request(app).get(`/api/conversations/${convId}/messages?limit=500`);
    expect(r.status).toBe(200);
    expect(r.body.messages).toHaveLength(200);
    expect(r.body.pagination.hasMore).toBe(true);
    expect(r.body.messages[0].id).toBe('m51'); // oldest of the returned window
    expect(r.body.messages[199].id).toBe('m250'); // newest

    const pageQuery = fake.state.queries
      .filter((q) => q.text.startsWith('SELECT id, role, content'))
      .pop();
    expect(pageQuery.params[pageQuery.params.length - 1]).toBe(201); // 200 + 1 probe row
  });

  it('applies the default limit of 120', async () => {
    const convId = await createConversation('Page');
    await seedMessages(convId, 125);

    const r = await request(app).get(`/api/conversations/${convId}/messages`);
    expect(r.status).toBe(200);
    expect(r.body.messages).toHaveLength(120);
    expect(r.body.pagination.hasMore).toBe(true);
    expect(r.body.messages[0].id).toBe('m6'); // oldest of the newest-120 window
    expect(r.body.messages[119].id).toBe('m125'); // newest
  });

  it('returns an empty page with hasMore=false when before precedes all messages', async () => {
    const convId = await createConversation('Page');
    await seedMessages(convId, 3);

    const before = new Date(ts(1) - 1000).toISOString();
    const r = await request(app)
      .get(`/api/conversations/${convId}/messages?before=${encodeURIComponent(before)}`);
    expect(r.body.messages).toEqual([]);
    expect(r.body.pagination.hasMore).toBe(false);
  });

  it('orders messages with identical created_at by id descending (stable tie-break)', async () => {
    const convId = await createConversation('Page');
    // Same client timestamp → same created_at for all three
    await request(app).patch(`/api/conversations/${convId}`).send({
      messages: [msg('m1', 'user', 'a', 1000), msg('m2', 'assistant', 'b', 1000), msg('m3', 'user', 'c', 1000)]
    });

    const r = await request(app).get(`/api/conversations/${convId}/messages?limit=1`);
    // id DESC wins: newest single message is m3
    expect(r.body.messages.map((m) => m.id)).toEqual(['m3']);
    expect(r.body.pagination.hasMore).toBe(true);
  });

  it('returns 404 for an unknown conversation', async () => {
    const r = await request(app).get('/api/conversations/unknown-id/messages');
    expect(r.status).toBe(404);
  });

  it('returns 404 when the conversation belongs to another user', async () => {
    // Simulate a row owned by a different user: ownership check must reject it
    // even though the conversation exists.
    fake.state.conversations.set('others-conv', {
      id: 'others-conv',
      project_id: null,
      user_id: 99,
      title: 'Başqa istifadəçinin chat-ı',
      messages: [],
      summary_text: '',
      archived: false,
      last_message_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const r = await request(app).get('/api/conversations/others-conv/messages');
    expect(r.status).toBe(404);
  });
});
