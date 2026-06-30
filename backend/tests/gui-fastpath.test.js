import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { spawn } from 'node:child_process';
import { setTimeout as wait } from 'node:timers/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = 41739;
let server;
const testDir = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(testDir, '..');

beforeAll(async () => {
  process.env.LOCAL_MODE = 'true';
  process.env.JWT_SECRET = 'gui_fastpath_test_secret';
  process.env.PORT = String(PORT);
  process.env.NODE_ENV = 'test';
  process.env.WORKSPACE_ROOT = '/tmp/bahai_gui_fastpath_test';
  process.env.ALLOWED_DIRECTORIES = '/tmp,/app';
  process.env.GUI_BROWSER_CDP_URL = 'http://127.0.0.1:65530';

  server = spawn(process.execPath, ['index.js'], {
    cwd: backendRoot,
    env: process.env,
    stdio: 'pipe'
  });

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Server boot timeout')), 12000);
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

async function login() {
  const r = await request(base)
    .post('/api/auth/login')
    .send({ email: 'gui@test.com', password: 'x' });
  return r.body.token;
}

describe('GUI fast-path SSE', () => {
  it('wix checkpoint request returns human checkpoint event or browser failure assistant message', async () => {
    const token = await login();
    const response = await request(base)
      .post('/api/chat')
      .set('Authorization', `Bearer ${token}`)
      .set('Accept', 'text/event-stream')
      .send({
        messages: [
          {
            role: 'user',
            content: 'GUI Agent ilə visible browser aç və wix.com daxil ol. Mən login olana qədər gözlə. Login-dən sonra observe et. Workflow: gui.'
          }
        ],
        model: 'auto',
        workingDirectory: '/tmp',
        orchestrationMode: true,
        workflow: 'gui',
        guiBrowserMode: 'cdp',
        guiBrowserCdpUrl: 'http://127.0.0.1:65530'
      });

    expect(response.status).toBe(200);
    expect(response.text.includes('"type":"human_checkpoint"') || response.text.includes('Browser açıla bilmədi')).toBe(true);
  }, 10000);
});
