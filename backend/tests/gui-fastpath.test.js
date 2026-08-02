import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { spawnTestServer, stopTestServer } from './testServer.js';
import * as fastpath from '../gui/fastpath.js';

let server;
let base;
let port;

beforeAll(async () => {
  const booted = await spawnTestServer({
    base: 42000,
    envOverrides: {
      LOCAL_MODE: 'true',
      JWT_SECRET: 'gui_fastpath_test_secret',
      NODE_ENV: 'test',
      WORKSPACE_ROOT: '/tmp/bahai_gui_fastpath_test',
      ALLOWED_DIRECTORIES: '/tmp,/app',
      GUI_BROWSER_CDP_URL: 'http://127.0.0.1:65530',
      // Never auto-launch a real Chrome window from a unit test: the browser
      // failure path becomes deterministic and side-effect-free instead of
      // spawning visible Chrome with the user's profile (which also raced the
      // 10s CDP reachability deadline against the 10s test timeout).
      GUI_BROWSER_NO_AUTO_LAUNCH: 'true'
    }
  });
  server = booted.child;
  port = booted.port;
  base = `http://127.0.0.1:${port}`;
}, 20000);

afterAll(async () => {
  await stopTestServer(server);
});

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
  }, 15000);
});

// Unit coverage of the happy path (human_checkpoint SSE) that the integration
// test above cannot reach deterministically without a real browser.
describe('handleGuiLoginCheckpoint success branch', () => {
  it('emits a human_checkpoint event and stores the checkpoint when browser_open succeeds', async () => {
    const chunks = [];
    const res = {
      setHeader() {},
      flushHeaders() {},
      write(chunk) {
        chunks.push(chunk.toString());
        return true;
      },
      end() {
        chunks.push('[END]');
      }
    };
    const runManager = {
      snapshot: () => ({ phase: 'Planner' }),
      currentPhase: () => ({ role: 'Planner' })
    };
    const createdCheckpoints = [];

    await fastpath.handleGuiLoginCheckpoint({
      res,
      orchestration: {
        workflow: 'gui',
        mode: 'manager_direct',
        agents: ['Solo Agent'],
        routing: { mode: 'direct' },
        enabled: false
      },
      runManager,
      resolvedWD: '/tmp',
      conversationId: 'c1',
      reqUser: { id: 1 },
      handleToolCall: async () => 'Browser opened: https://wix.com',
      normalizeUserFacingError: (result) => String(result || ''),
      browserOpenArgs: { url: 'https://wix.com', sessionId: 'gui-wix-live' },
      createCheckpoint: (id, cp) => createdCheckpoints.push({ id, ...cp })
    });

    const body = chunks.join('');
    expect(body).toContain('"type":"human_checkpoint"');
    expect(body).toContain('Browser opened');
    expect(createdCheckpoints.length).toBe(1);
    expect(createdCheckpoints[0].kind).toBe('login');
    expect(body.endsWith('[END]')).toBe(true);
  });
});
