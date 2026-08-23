import path from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { existsSync } from 'node:fs';
import { spawnTestServer, stopTestServer } from './testServer.js';
import * as fastpath from '../gui/fastpath.js';
import browserSession from '../browserSession.js';

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
      GUI_BROWSER_NO_AUTO_LAUNCH: 'true',
      // Layered guards: if the NO_AUTO_LAUNCH gate were ever removed, these
      // force a throwaway profile dir, headless/non-visible mode, no channel
      // and no executable path — so even a persistent launch could never open
      // the user's real Chrome window or touch their real profile.
      GUI_BROWSER_USER_DATA_DIR: '/tmp/bahai_gui_fastpath_test/chrome-profile',
      GUI_BROWSER_VISIBLE: 'false',
      GUI_BROWSER_PERSISTENT: 'false',
      GUI_BROWSER_CHANNEL: '',
      GUI_BROWSER_EXECUTABLE_PATH: ''
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

// Profile isolation: the CDP debug-Chrome launcher defaults to the user's REAL
// Chrome profile (so Google OAuth keeps cookies/history). Any env used by
// automated runs must resolve to a throwaway profile instead — tests set
// GUI_BROWSER_CHROME_PROFILE via testServer.js, and this verifies both that
// the override wins AND that the production default is unchanged.
describe('GUI profile isolation', () => {
  it('GUI_BROWSER_CHROME_PROFILE overrides the real Chrome profile default', () => {
    const resolved = browserSession.resolveChromeDebugProfileDir({
      GUI_BROWSER_CHROME_PROFILE: '/tmp/bahai-test-chrome-profile-42420',
      HOME: '/Users/fake-user'
    });
    expect(resolved).toBe('/tmp/bahai-test-chrome-profile-42420');
  });

  it('production default stays the real Chrome profile (no override)', () => {
    const resolved = browserSession.resolveChromeDebugProfileDir({ HOME: '/Users/fake-user' });
    expect(resolved).toBe(path.join('/Users/fake-user', 'Library', 'Application Support', 'Google', 'Chrome'));
  });
});

// Launch-gate guard: with GUI_BROWSER_NO_AUTO_LAUNCH=true, getSession must
// NEVER open a browser — even when the caller explicitly asks for
// persistent + visible + the real Chrome executable (the exact combo the wix
// checkpoint path sends). Regression guard for the gap where the guard only
// covered CDP auto-launch and the persistent+visible path opened real Chrome,
// navigating to www.wix.com during test runs.
describe('GUI launch-gate (no real browser in tests)', () => {
  it('blocks persistent+visible real-Chrome launches with cdp_unreachable and leaves no trace', async () => {
    const prev = process.env.GUI_BROWSER_NO_AUTO_LAUNCH;
    process.env.GUI_BROWSER_NO_AUTO_LAUNCH = 'true';
    const sessionId = `launch-track-${Date.now()}`;
    const profileDir = `/tmp/bahai-gui-launch-track-${Date.now()}`;
    const startedAt = Date.now();
    let error = null;
    try {
      try {
        await browserSession.getSession(sessionId, {
          visible: true,
          persistent: true,
          browserChannel: 'chrome',
          executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
          userDataDir: profileDir,
          url: 'https://www.wix.com'
        });
      } catch (e) {
        error = e;
      }

      expect(error).not.toBeNull();
      expect(error.browserLaunchCode).toBe('cdp_unreachable');
      expect(String(error.message)).toContain('GUI_BROWSER_NO_AUTO_LAUNCH');
      // Block fail-fast: must never wait out the 10s CDP reachability deadline
      // or spin up a persistent context.
      expect(Date.now() - startedAt).toBeLessThan(3000);
      // No session recorded and the persistent profile dir was never created.
      expect(browserSession.hasSession(sessionId)).toBe(false);
      expect(existsSync(profileDir)).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.GUI_BROWSER_NO_AUTO_LAUNCH;
      else process.env.GUI_BROWSER_NO_AUTO_LAUNCH = prev;
    }
  }, 10000);
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
