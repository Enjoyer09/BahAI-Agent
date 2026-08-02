// Integration tests for the API endpoints using supertest. Boots the express
// app on a random port with LOCAL_MODE=true (no DB needed).
//
// Run with: cd backend && LOCAL_MODE=true npx vitest run tests/api.test.js

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { spawnTestServer, stopTestServer } from './testServer.js';

let server;
let base;

beforeAll(async () => {
  // Boot the real backend in LOCAL_MODE so we don't need a database.
  const booted = await spawnTestServer({
    base: 41000,
    envOverrides: {
      LOCAL_MODE: 'true',
      JWT_SECRET: 'integration_test_secret',
      NODE_ENV: 'test',
      WORKSPACE_ROOT: '/tmp/bahai_test_ws',
      ALLOWED_DIRECTORIES: '/tmp,/app'
    }
  });
  server = booted.child;
  base = `http://127.0.0.1:${booted.port}`;
}, 20000);

afterAll(async () => {
  await stopTestServer(server);
});

describe('Auth endpoints', () => {
  it('GET /api/auth/config returns localMode true', async () => {
    const r = await request(base).get('/api/auth/config');
    expect(r.status).toBe(200);
    expect(r.body.localMode).toBe(true);
  });

  it('POST /api/auth/login returns a JWT in LOCAL_MODE', async () => {
    const r = await request(base).post('/api/auth/login').send({ email: 'test@example.com', password: 'x' });
    expect(r.status).toBe(200);
    expect(r.body.token).toMatch(/^eyJ/);
  });

  it('GET /api/projects with invalid token returns 403 in LOCAL_MODE', async () => {
    const r = await request(base).get('/api/projects').set('Authorization', 'Bearer not.a.real.token');
    expect(r.status).toBe(403);
  });

  it('GET /api/auth/me with no token returns local admin in LOCAL_MODE', async () => {
    const r = await request(base).get('/api/auth/me');
    expect(r.status).toBe(200);
    expect(r.body.user.role).toBe('admin');
  });
});

describe('Project + file endpoints', () => {
  let token;
  let projectId;

  it('logs in and creates a project', async () => {
    const login = await request(base).post('/api/auth/login').send({ email: 'tester@example.com', password: 'x' });
    token = login.body.token;

    const create = await request(base)
      .post('/api/projects')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'vitest-proj', path: 'workspace://vitest-proj' });
    expect(create.status).toBeGreaterThanOrEqual(200);
    expect(create.status).toBeLessThan(300);
    projectId = create.body.project.id;
    expect(projectId).toBeTruthy();
  });

  it('lists files at the project root', async () => {
    const r = await request(base)
      .get('/api/files?path=.&workingDirectory=workspace%3A%2F%2Fvitest-proj')
      .set('Authorization', `Bearer ${token}`);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body)).toBe(true);
  });

  it('returns 404 for unknown checkpoint id', async () => {
    const r = await request(base)
      .post('/api/checkpoints/not-found')
      .set('Authorization', `Bearer ${token}`)
      .send({ decision: 'resume', workingDirectory: '/tmp' });
    expect(r.status).toBe(404);
  });

  it('lists interactions for the user', async () => {
    const r = await request(base)
      .get('/api/interactions')
      .set('Authorization', `Bearer ${token}`);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.interactions)).toBe(true);
  });

  it('returns GUI capability status', async () => {
    const r = await request(base)
      .get('/api/gui-capabilities?mode=bundled')
      .set('Authorization', `Bearer ${token}`);
    expect(r.status).toBe(200);
    expect(typeof r.body.summary?.status).toBe('string');
    expect(typeof r.body.browser?.playwrightInstalled).toBe('boolean');
    expect(typeof r.body.computerUse?.available).toBe('boolean');
    expect(Array.isArray(r.body.warnings)).toBe(true);
  });

  it('returns computer use status', async () => {
    const r = await request(base)
      .get('/api/computer-use-status')
      .set('Authorization', `Bearer ${token}`);
    expect(r.status).toBe(200);
    expect(typeof r.body.available).toBe('boolean');
    expect(typeof r.body.appPath).toBe('string');
    expect(Array.isArray(r.body.reasons)).toBe(true);
  });
});
