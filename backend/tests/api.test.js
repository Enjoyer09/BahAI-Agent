// Integration tests for the API endpoints using supertest. Boots the express
// app on a random port with LOCAL_MODE=true (no DB needed).
//
// Run with: cd backend && LOCAL_MODE=true npx vitest run tests/api.test.js

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { spawn } from 'node:child_process';
import { setTimeout as wait } from 'node:timers/promises';
import getPort from 'node:net';

const PORT = 41737;
let server;

beforeAll(async () => {
  // Boot the real backend in LOCAL_MODE so we don't need a database.
  process.env.LOCAL_MODE = 'true';
  process.env.JWT_SECRET = 'integration_test_secret';
  process.env.PORT = String(PORT);
  process.env.NODE_ENV = 'test';
  process.env.WORKSPACE_ROOT = '/tmp/bahai_test_ws';
  process.env.ALLOWED_DIRECTORIES = '/tmp,/app';

  server = spawn(process.execPath, ['index.js'], {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'pipe'
  });

  // Wait for "Backend running" log
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Server boot timeout')), 10000);
    server.stdout.on('data', (chunk) => {
      if (chunk.toString().includes('Backend running')) {
        clearTimeout(timer);
        resolve();
      }
    });
    server.stderr.on('data', (chunk) => process.stderr.write(chunk));
  });
  await wait(200);
}, 15000);

afterAll(async () => {
  if (server) {
    server.kill('SIGTERM');
    await wait(300);
  }
});

const base = `http://127.0.0.1:${PORT}`;

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

  it('GET /api/projects with invalid token returns 403 (no LOCAL_MODE bypass)', async () => {
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
});
