// ==========================================
// project_memories — append-only upsert tests
// ==========================================
// The DELETE+INSERT rewrite audit found NO remaining destructive
// DELETE-all + INSERT-all patterns in the codebase:
//   - conversations PATCH/POST → upsertConversationMessages (conversations.test.js)
//   - project_memories      → INSERT ... ON CONFLICT (project_id) DO UPDATE
//                             (backend/routes/misc.js:130-133)
//   - users admin seed      → INSERT ... ON CONFLICT (email) DO NOTHING
//                             (backend/db.js:196)
// This file locks the project_memories upsert so a regression back to a
// destructive rewrite (DELETE-all + INSERT-all) is caught immediately —
// same require.cache stub pattern as conversations.test.js.
//
// Run with: cd backend && npx vitest run tests/project-memory.test.js
// ==========================================

import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const fake = vi.hoisted(() => {
  const state = {
    projects: new Map(),  // project_id -> { id, user_id }
    memories: new Map(),  // project_id -> { user_id, memory } (memory = parsed JSON)
    queries: [],
  };

  function run(text, params = []) {
    state.queries.push({ text: text.replace(/\s+/g, ' ').trim(), params });
    const t = text.replace(/\s+/g, ' ').trim();

    if (t.startsWith('SELECT id FROM projects')) {
      // POST /api/project-memory ownership check: $1 = project_id, $2 = user_id
      const proj = state.projects.get(params[0]);
      return { rows: proj && proj.user_id === params[1] ? [{ id: proj.id }] : [] };
    }

    if (t.startsWith('SELECT memory FROM project_memories')) {
      // GET /api/project-memory: $1 = project_id, $2 = user_id
      const row = state.memories.get(params[0]);
      return { rows: row && row.user_id === params[1] ? [{ memory: row.memory }] : [] };
    }

    if (t.startsWith('INSERT INTO project_memories')) {
      // $1 project_id, $2 user_id, $3 memory (route always sends JSON.stringify'd
      // values, and real PG stores JSONB — so parse here to mirror pg's shape)
      const [projectId, userId, rawMemory] = params;
      const memory = JSON.parse(rawMemory);
      const existing = state.memories.get(projectId);
      if (existing) {
        // ON CONFLICT (project_id) DO UPDATE ... WHERE project_memories.user_id = EXCLUDED.user_id
        if (existing.user_id === userId) {
          existing.memory = memory;
          existing.user_id = userId;
          return { rows: [{ project_id: projectId }] };
        }
        return { rows: [] }; // WHERE guard fails → row untouched, route returns 404
      }
      state.memories.set(projectId, { user_id: userId, memory });
      return { rows: [{ project_id: projectId }] };
    }

    return { rows: [] };
  }

  return {
    state,
    db: {
      hasDatabase: () => true,
      query: async (text, params) => run(text, params)
    }
  };
});

let app;

beforeAll(() => {
  // Stub the db module in the native require cache BEFORE loading the router so
  // its require('../db') resolves to the in-memory fake.
  const dbPath = require.resolve('../db.js');
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: fake.db };

  const miscRouter = require('../routes/misc.js');
  app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 7 };
    next();
  });
  app.use('/api', miscRouter);
});

beforeEach(() => {
  fake.state.projects.clear();
  fake.state.memories.clear();
  fake.state.queries.length = 0;
  fake.state.projects.set('proj-1', { id: 'proj-1', user_id: 7 });
});

describe('project_memories append-only upsert', () => {
  it('saves memory with ON CONFLICT DO UPDATE and never issues a DELETE', async () => {
    const r = await request(app)
      .post('/api/project-memory/proj-1')
      .send({ memory: { lastTopic: 'test', tags: ['a'] } });
    expect(r.status).toBe(200);
    expect(r.body.success).toBe(true);

    const insert = fake.state.queries.find((q) => q.text.startsWith('INSERT INTO project_memories'));
    expect(insert).toBeTruthy();
    expect(insert.text).toContain('ON CONFLICT (project_id) DO UPDATE');
    expect(insert.text).toContain('WHERE project_memories.user_id = EXCLUDED.user_id');
    expect(insert.text).toContain('RETURNING project_id');

    // The whole flow (ownership SELECT + upsert) must never include a DELETE.
    expect(fake.state.queries.some((q) => /DELETE FROM/i.test(q.text))).toBe(false);
  });

  it('round-trips memory through GET as a parsed object', async () => {
    await request(app)
      .post('/api/project-memory/proj-1')
      .send({ memory: { a: 1, b: { c: 2 } } });

    const r = await request(app).get('/api/project-memory/proj-1');
    expect(r.status).toBe(200);
    expect(r.body.memory).toEqual({ a: 1, b: { c: 2 } });
  });

  it('updates in place without row churn (same project_id, single row)', async () => {
    await request(app).post('/api/project-memory/proj-1').send({ memory: { v: 1 } });
    await request(app).post('/api/project-memory/proj-1').send({ memory: { v: 2 } });

    expect(fake.state.memories.size).toBe(1);
    expect(fake.state.memories.get('proj-1').memory).toEqual({ v: 2 });
    const inserts = fake.state.queries.filter((q) => q.text.startsWith('INSERT INTO project_memories'));
    expect(inserts).toHaveLength(2);
    expect(inserts.every((q) => q.text.includes('ON CONFLICT'))).toBe(true);
  });

  it('returns 404 when the project does not exist', async () => {
    const r = await request(app)
      .post('/api/project-memory/other-proj')
      .send({ memory: { x: 1 } });
    expect(r.status).toBe(404);
    expect(fake.state.memories.size).toBe(0);
  });

  it('returns 404 when the project exists but belongs to another user', async () => {
    // Project row exists but user 99 owns it → ownership SELECT returns no rows.
    fake.state.projects.set('proj-99', { id: 'proj-99', user_id: 99 });

    const r = await request(app)
      .post('/api/project-memory/proj-99')
      .send({ memory: { x: 1 } });
    expect(r.status).toBe(404);
    expect(fake.state.memories.has('proj-99')).toBe(false);
  });

  it('returns an empty memory object when nothing was saved yet', async () => {
    const r = await request(app).get('/api/project-memory/proj-1');
    expect(r.status).toBe(200);
    expect(r.body.memory).toEqual({});
  });

  it('does not overwrite another user\u2019s memory on project_id conflict (WHERE guard)', async () => {
    // Same project_id exists but belongs to user 99 → ON CONFLICT DO UPDATE
    // WHERE project_memories.user_id = EXCLUDED.user_id (7 !== 99) fails → 404,
    // and the other user's memory stays untouched.
    fake.state.memories.set('proj-1', { user_id: 99, memory: { theirs: true } });

    const r = await request(app)
      .post('/api/project-memory/proj-1')
      .send({ memory: { mine: true } });

    expect(r.status).toBe(404);
    expect(fake.state.memories.get('proj-1').memory).toEqual({ theirs: true });
  });
});
