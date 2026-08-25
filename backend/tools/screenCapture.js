// ==========================================
// Screen Capture — store the user's latest shared screen for the web_chat agent
// ==========================================
// The desktop app (or any authenticated client) uploads a screenshot here. We
// keep the latest image per user in memory (TTL) AND persist to disk so the
// conversation-append path can reference it. The web_chat `capture_my_screen`
// tool reads from this store to tell the agent whether the user just shared
// their screen and how fresh it is.

const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const RECENT_TTL_MS = 120000; // 2 minutes — long enough for a multi-turn guidance loop
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // ~3.3 MB decoded base64
const ALLOWED_MIME = new Set(['image/png', 'image/jpeg']);

// userId -> { base64, mimeType, timestamp, conversationId }
const _latest = new Map();
// Cleanup timers so entries don't linger in memory past their freshness window.
const _cleanupTimers = new Map();

function _purgeIfExpired(userId) {
  const entry = _latest.get(userId);
  if (!entry) return;
  if (Date.now() - entry.timestamp > RECENT_TTL_MS) _latest.delete(userId);
  const t = _cleanupTimers.get(userId);
  if (t) clearTimeout(t);
  _cleanupTimers.delete(userId);
}

function _scheduleCleanup(userId) {
  const existing = _cleanupTimers.get(userId);
  if (existing) clearTimeout(existing);
  const t = setTimeout(() => _purgeIfExpired(userId), RECENT_TTL_MS + 5000);
  if (typeof t.unref === 'function') t.unref();
  _cleanupTimers.set(userId, t);
}

function getScreenDir() {
  if (process.env.SCREEN_CAPTURES_DIR) return path.resolve(process.env.SCREEN_CAPTURES_DIR);
  return path.resolve(__dirname, '..', 'screen-captures');
}

async function ensureScreenDir() {
  const dir = getScreenDir();
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

// Accept either a full data URL or { base64, mimeType }.
function _parseDataUrl(input) {
  if (typeof input !== 'string') return null;
  const m = input.match(/^data:([^;]+);base64,(.+)$/s);
  if (m) return { mimeType: m[1], base64: m[2] };
  return null;
}

/**
 * Store a screenshot for the user. Validates size + mime, persists to disk,
 * and refreshes the in-memory "latest" pointer.
 *
 * @returns { ok:false, error } | { ok:true, timestamp, expiresAt, mimeType, bytes }
 */
async function storeScreen(userId, { base64, mimeType, dataUrl, conversationId } = {}) {
  if (!userId) return { ok: false, error: 'userId required' };

  let b64 = base64;
  let mime = mimeType;
  const parsed = _parseDataUrl(dataUrl);
  if (parsed) {
    b64 = parsed.base64;
    mime = parsed.mimeType;
  }
  if (!b64 || typeof b64 !== 'string') return { ok: false, error: 'base64 (or dataUrl) is required' };
  if (!mime || typeof mime !== 'string') return { ok: false, error: 'mimeType is required (e.g. image/png)' };
  if (!ALLOWED_MIME.has(mime)) {
    return { ok: false, error: `mimeType must be one of: ${[...ALLOWED_MIME].join(', ')}` };
  }

  let buffer;
  try { buffer = Buffer.from(b64, 'base64'); }
  catch { return { ok: false, error: 'invalid base64' }; }
  if (buffer.length === 0) return { ok: false, error: 'empty image' };
  if (buffer.length > MAX_IMAGE_BYTES) {
    return { ok: false, error: `image exceeds ${MAX_IMAGE_BYTES}-byte limit (got ${buffer.length})` };
  }

  const timestamp = Date.now();
  const ext = mime === 'image/png' ? 'png' : 'jpg';

  const dir = await ensureScreenDir();
  const userDir = path.join(dir, String(userId));
  await fs.mkdir(userDir, { recursive: true });
  const filename = `${timestamp}-${crypto.randomBytes(3).toString('hex')}.${ext}`;
  await fs.writeFile(path.join(userDir, filename), buffer);

  const entry = { base64: b64, mimeType: mime, timestamp, conversationId: conversationId || null };
  _latest.set(String(userId), entry);
  _scheduleCleanup(String(userId));

  return {
    ok: true,
    timestamp,
    expiresAt: timestamp + RECENT_TTL_MS,
    mimeType: mime,
    bytes: buffer.length
  };
}

function getLatest(userId) {
  if (!userId) return null;
  const entry = _latest.get(String(userId));
  if (!entry) return null;
  if (Date.now() - entry.timestamp > RECENT_TTL_MS) {
    _latest.delete(String(userId));
    return null;
  }
  return entry;
}

function getStatus(userId) {
  const entry = getLatest(userId);
  if (!entry) return { hasScreen: false, ageMs: null, ttlMs: RECENT_TTL_MS };
  const ageMs = Date.now() - entry.timestamp;
  return {
    hasScreen: true,
    ageMs,
    ttlMs: RECENT_TTL_MS,
    expiresInMs: Math.max(0, RECENT_TTL_MS - ageMs),
    mimeType: entry.mimeType,
    bytes: Buffer.from(entry.base64, 'base64').length,
    conversationId: entry.conversationId
  };
}

/**
 * Append the shared screen as a user image-message into the given conversation
 * so the agent has it in vision context on the next turn. Best-effort: returns
 * {ok:false} if the database isn't configured (e.g. local dev without Postgres).
 */
async function appendScreenShareToConversation({ userId, conversationId, entry } = {}) {
  if (!userId || !conversationId) return { ok: false, error: 'userId and conversationId required' };
  const e = entry || getLatest(userId);
  if (!e) return { ok: false, error: 'no recent screen to append' };

  let db;
  try { db = require('../db'); } catch { return { ok: false, error: 'db module unavailable' }; }
  if (!db.hasDatabase || !db.hasDatabase()) return { ok: false, error: 'database not configured' };

  const messageId = crypto.randomUUID();
  const dataUrl = `data:${e.mimeType};base64,${e.base64}`;
  const textMarker = '[İstifadəçi ekranını Buddy ilə paylaşdı]';
  // Mirror the web-UI attachment shape so the existing chat pipeline renders
  // the image and feeds it to the vision-capable model on the next turn.
  const attachments = [{ type: 'image', mimeType: e.mimeType, dataUrl }];

  try {
    await db.query(
      `INSERT INTO messages (id, conversation_id, user_id, role, content, attachments, tool_calls, tool_call_id, timestamp, created_at)
       VALUES ($1, $2, $3, 'user', $4, $5::jsonb, NULL, NULL, $6, CURRENT_TIMESTAMP)`,
      [messageId, conversationId, userId, textMarker, JSON.stringify(attachments), new Date(e.timestamp).toISOString()]
    );
    await db.query(
      `UPDATE conversations SET last_message_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND user_id = $2`,
      [conversationId, userId]
    );
    return { ok: true, messageId };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = {
  storeScreen,
  getLatest,
  getStatus,
  appendScreenShareToConversation,
  ensureScreenDir,
  getScreenDir,
  RECENT_TTL_MS,
  MAX_IMAGE_BYTES,
  ALLOWED_MIME: [...ALLOWED_MIME],
  // exported for tests
  _clearAll: () => { _latest.clear(); for (const t of _cleanupTimers.values()) clearTimeout(t); _cleanupTimers.clear(); },
  _backdate(userId, ms) {
    const entry = _latest.get(String(userId));
    if (entry) entry.timestamp = Date.now() - ms;
  },
  _size: () => _latest.size
};