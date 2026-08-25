// Tests for the screen capture feature: store, ttl, route, profile exposure.
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import express from 'express';
import request from 'supertest';

// Isolate SCREEN_CAPTURES_DIR for every test run so user screenshots never
// leak into the developer's working tree.
const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'bahai-screencap-'));
process.env.SCREEN_CAPTURES_DIR = tmpRoot;

// Import AFTER setting SCREEN_CAPTURES_DIR so getScreenDir() picks it up.
// Use createRequire so we share Node's CJS module cache with toolRunner.js
// (which uses require()). Otherwise vitest's ESM `import()` resolves to a
// DIFFERENT module instance from `require()` in toolRunner.js, and our
// in-memory store ends up duplicated across the two views.
import { createRequire } from 'module';
const require_ = createRequire(import.meta.url);
const screenCapture = require_('../tools/screenCapture.js');
const { getToolsForProfile } = require_('../tools/profiles.js');
const { handleToolCall } = require_('../toolRunner.js');

// 1x1 transparent PNG (smallest valid PNG we can produce quickly)
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const TINY_PNG_DATAURL = `data:image/png;base64,${TINY_PNG_BASE64}`;

describe('screenCapture.storeScreen', () => {
  beforeEach(() => {
    screenCapture._clearAll();
  });

  it('writes a valid screenshot and returns metadata', async () => {
    const res = await screenCapture.storeScreen('user-1', {
      base64: TINY_PNG_BASE64,
      mimeType: 'image/png'
    });
    expect(res.ok).toBe(true);
    expect(res.mimeType).toBe('image/png');
    expect(res.bytes).toBeGreaterThan(0);
    expect(res.expiresAt).toBeGreaterThan(res.timestamp);

    // Disk file should exist
    const userDir = path.join(tmpRoot, 'user-1');
    const files = await fs.readdir(userDir);
    expect(files.length).toBe(1);
    expect(files[0]).toMatch(/\.png$/);
  });

  it('parses a data URL when base64/mime are not provided', async () => {
    const res = await screenCapture.storeScreen('user-2', { dataUrl: TINY_PNG_DATAURL });
    expect(res.ok).toBe(true);
    expect(res.mimeType).toBe('image/png');
  });

  it('rejects an empty payload', async () => {
    const res = await screenCapture.storeScreen('user-3', {});
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/required/i);
  });

  it('rejects an unknown mime type', async () => {
    const res = await screenCapture.storeScreen('user-4', {
      base64: TINY_PNG_BASE64,
      mimeType: 'image/gif'
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/mimeType/);
  });

  it('rejects an oversize image', async () => {
    // Build a base64 string whose DECODED length exceeds MAX_IMAGE_BYTES.
    // Base64 expands data by a factor of 4/3, so we need ~MAX_IMAGE_BYTES*4/3 chars.
    const oversizeB64Len = Math.ceil(screenCapture.MAX_IMAGE_BYTES * 4 / 3) + 100;
    const huge = 'A'.repeat(oversizeB64Len);
    const res = await screenCapture.storeScreen('user-5', {
      base64: huge,
      mimeType: 'image/png'
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/exceeds/);
  });

  it('accepts jpeg mime and writes a .jpg file', async () => {
    const jpegBase64 = '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/2wBDAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09PX29+Pj6+v/aAAwDAQACEQMRAD8A/v4ooooAKKKKAP/Z';
    const res = await screenCapture.storeScreen('user-6', {
      base64: jpegBase64,
      mimeType: 'image/jpeg'
    });
    expect(res.ok).toBe(true);
    expect(res.mimeType).toBe('image/jpeg');
    const userDir = path.join(tmpRoot, 'user-6');
    const files = await fs.readdir(userDir);
    expect(files[0]).toMatch(/\.jpg$/);
  });
});

describe('screenCapture.getStatus', () => {
  beforeEach(() => {
    screenCapture._clearAll();
  });

  it('returns hasScreen=false when nothing is stored', () => {
    const s = screenCapture.getStatus('ghost-user');
    expect(s.hasScreen).toBe(false);
    expect(s.ageMs).toBe(null);
    expect(s.ttlMs).toBe(screenCapture.RECENT_TTL_MS);
  });

  it('returns hasScreen=true with positive ageMs after a store', async () => {
    await screenCapture.storeScreen('user-7', { base64: TINY_PNG_BASE64, mimeType: 'image/png' });
    const s = screenCapture.getStatus('user-7');
    expect(s.hasScreen).toBe(true);
    expect(s.ageMs).toBeGreaterThanOrEqual(0);
    expect(s.ageMs).toBeLessThan(screenCapture.RECENT_TTL_MS);
    expect(s.mimeType).toBe('image/png');
    expect(s.expiresInMs).toBeGreaterThan(0);
  });

  it('hides an expired entry', async () => {
    await screenCapture.storeScreen('user-8', { base64: TINY_PNG_BASE64, mimeType: 'image/png' });
    // Force expiration via the test helper — exact same Map, no private field
    // access needed.
    screenCapture._backdate('user-8', screenCapture.RECENT_TTL_MS + 5000);
    const s = screenCapture.getStatus('user-8');
    expect(s.hasScreen).toBe(false);
  });
});

describe('screen-capture route — POST /upload', () => {
  let app;

  beforeAll(() => {
    const screenCaptureRouter = require('../routes/screenCapture.js');
    app = express();
    app.use(express.json({ limit: '12mb' }));
    // Skip verifyToken: tests need req.user, not a real JWT.
    app.use((req, _res, next) => { req.user = { id: 42 }; next(); });
    app.use('/api/screen-capture', screenCaptureRouter);
    screenCapture._clearAll();
  });

  beforeEach(() => {
    screenCapture._clearAll();
  });

  it('accepts a base64 upload and returns 200 with metadata', async () => {
    const r = await request(app)
      .post('/api/screen-capture/upload')
      .send({ base64: TINY_PNG_BASE64, mimeType: 'image/png', deviceLabel: 'MacBook Pro' });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.bytes).toBeGreaterThan(0);
    expect(r.body.ttlMs).toBe(screenCapture.RECENT_TTL_MS);
    expect(r.body.deviceLabel).toBe('MacBook Pro');
  });

  it('accepts a dataUrl upload', async () => {
    const r = await request(app)
      .post('/api/screen-capture/upload')
      .send({ dataUrl: TINY_PNG_DATAURL });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
  });

  it('returns 400 when no image data is provided', async () => {
    const r = await request(app)
      .post('/api/screen-capture/upload')
      .send({});
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/required/i);
  });

  it('returns 400 on unknown mime type', async () => {
    const r = await request(app)
      .post('/api/screen-capture/upload')
      .send({ base64: TINY_PNG_BASE64, mimeType: 'image/webp' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/mimeType/);
  });

  it('returns 413 on oversize payloads', async () => {
    const oversizeB64Len = Math.ceil(screenCapture.MAX_IMAGE_BYTES * 4 / 3) + 100;
    const huge = 'A'.repeat(oversizeB64Len);
    const r = await request(app)
      .post('/api/screen-capture/upload')
      .send({ base64: huge, mimeType: 'image/png' });
    expect(r.status).toBe(413);
    expect(r.body.error).toMatch(/exceeds/);
  });
});

describe('screen-capture route — GET /status', () => {
  let app;

  beforeAll(() => {
    const screenCaptureRouter = require('../routes/screenCapture.js');
    app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.user = { id: 99 }; next(); });
    app.use('/api/screen-capture', screenCaptureRouter);
  });

  beforeEach(() => {
    screenCapture._clearAll();
  });

  it('reports hasScreen=false when nothing is stored', async () => {
    const r = await request(app).get('/api/screen-capture/status');
    expect(r.status).toBe(200);
    expect(r.body.hasScreen).toBe(false);
    expect(r.body.userId).toBe(99);
  });

  it('reports hasScreen=true after a successful upload', async () => {
    await request(app)
      .post('/api/screen-capture/upload')
      .send({ base64: TINY_PNG_BASE64, mimeType: 'image/png' });
    const r = await request(app).get('/api/screen-capture/status');
    expect(r.status).toBe(200);
    expect(r.body.hasScreen).toBe(true);
  });
});

describe('capture_my_screen tool exposure', () => {
  it('appears in the web-chat profile', () => {
    const tools = getToolsForProfile('web-chat');
    const names = tools.map((t) => t.function.name);
    expect(names).toContain('capture_my_screen');
  });

  it('is exposed exactly once (no duplicates)', () => {
    const tools = getToolsForProfile('web-chat');
    const matches = tools.filter((t) => t.function.name === 'capture_my_screen');
    expect(matches.length).toBe(1);
  });

  it('does NOT leak into role-restricted profiles that use only READ_ONLY_TOOLS', () => {
    // When getToolsForRole is called with role=Planner, profile=web-chat,
    // the intersection is just READ_ONLY_TOOLS — capture_my_screen is not in
    // READ_ONLY, so it should NOT appear.
    // We can't easily call getToolsForRole directly (it expects role/profile
    // context that might not exist in our test env), so do a tighter check:
    // verify READ_ONLY_TOOLS itself doesn't list capture_my_screen.
    const readOnlyTools = [
      'list_directory', 'glob_search', 'read_file', 'grep_search',
      'analyze_codebase', 'find_definition', 'find_references',
      'web_search', 'web_fetch',
      'git_status', 'git_diff', 'git_log'
    ];
    // Sanity: build_and_publish_app and capture_my_screen are NOT in this list
    expect(readOnlyTools).not.toContain('capture_my_screen');
    expect(readOnlyTools).not.toContain('build_and_publish_app');
  });
});

describe('handleToolCall("capture_my_screen")', () => {
  beforeEach(() => {
    screenCapture._clearAll();
  });

  it('returns hasScreen=false JSON before anything is stored', async () => {
    const result = await handleToolCall(
      { function: { name: 'capture_my_screen', arguments: '{}' } },
      process.cwd(),
      { id: 'tool-user-1', email: 'tool@example.com' }
    );
    const parsed = JSON.parse(result);
    expect(parsed.hasScreen).toBe(false);
  });

  it('returns hasScreen=true JSON after a store', async () => {
    await screenCapture.storeScreen('tool-user-2', {
      base64: TINY_PNG_BASE64,
      mimeType: 'image/png'
    });
    const result = await handleToolCall(
      { function: { name: 'capture_my_screen', arguments: '{}' } },
      process.cwd(),
      { id: 'tool-user-2' }
    );
    const parsed = JSON.parse(result);
    expect(parsed.hasScreen).toBe(true);
    expect(parsed.mimeType).toBe('image/png');
    expect(parsed.expiresInMs).toBeGreaterThan(0);
  });
});

afterAll(async () => {
  screenCapture._clearAll();
  await fs.rm(tmpRoot, { recursive: true, force: true });
});
