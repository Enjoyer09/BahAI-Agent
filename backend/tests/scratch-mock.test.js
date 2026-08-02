import { it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../helpers.js', () => ({
  serializeConversation: (row) => ({ fromMockSerialize: true, original: row }),
}));

import conversationsRouter from '../routes/conversations.js';

const app = express();
app.use(express.json());
app.use((req, _res, next) => { req.user = { id: 1 }; next(); });
app.use('/api/conversations', conversationsRouter);

it('POST response shows whether the route sees the mocked helpers', async () => {
  const r = await request(app).post('/api/conversations').send({ title: 'T' });
  // eslint-disable-next-line no-console
  console.log('POST status:', r.status, 'body:', JSON.stringify(r.body));
  expect(r.status).toBe(200);
});
