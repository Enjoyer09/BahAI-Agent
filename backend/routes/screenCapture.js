// ==========================================
// Screen Capture Route — upload + status
// ==========================================
// The desktop app (Electron) and any authenticated client POST here to share
// a screenshot. We keep the latest image per user in memory (TTL 2 min) AND
// persist to disk so the `capture_my_screen` web_chat tool — and any future
// agent triggers — can reference it during the same guidance loop.
//
// Mounted at /api/screen-capture by index.js (verifies token first via the
// protectedPaths gate, so req.user is always present).

const express = require('express');
const router = express.Router();
const {
  storeScreen,
  getStatus,
  appendScreenShareToConversation,
  RECENT_TTL_MS,
  MAX_IMAGE_BYTES,
  ALLOWED_MIME
} = require('../tools/screenCapture');

// Light request body cap. A 5 MB decoded image is ~6.7 MB base64 + JSON
// overhead, so we round up generously but still block absurd payloads early.
const JSON_LIMIT = String(process.env.SCREEN_CAPTURE_BODY_LIMIT || '12mb');

router.use(express.json({ limit: JSON_LIMIT }));

// POST /api/screen-capture/upload
// Body: { base64?: string, mimeType?: string, dataUrl?: string,
//         conversationId?: string, appendToConversation?: boolean,
//         deviceLabel?: string }
router.post('/upload', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'auth required' });

    const {
      base64, mimeType, dataUrl,
      conversationId, appendToConversation,
      deviceLabel
    } = req.body || {};

    if (!base64 && !dataUrl) {
      return res.status(400).json({
        error: 'base64 or dataUrl is required',
        allowedMime: ALLOWED_MIME,
        maxBytes: MAX_IMAGE_BYTES
      });
    }

    const result = await storeScreen(userId, { base64, mimeType, dataUrl, conversationId });
    if (!result.ok) {
      const status = /exceeds/.test(result.error) ? 413 : 400;
      return res.status(status).json({ error: result.error });
    }

    let appended = null;
    if (appendToConversation && conversationId) {
      const appendResult = await appendScreenShareToConversation({
        userId,
        conversationId,
        // Use the freshly-stored entry by reading from store.
        entry: (require('../tools/screenCapture').getLatest(userId))
      });
      appended = appendResult.ok
        ? { ok: true, messageId: appendResult.messageId }
        : { ok: false, error: appendResult.error };
    }

    res.json({
      ok: true,
      timestamp: result.timestamp,
      expiresAt: result.expiresAt,
      ttlMs: RECENT_TTL_MS,
      mimeType: result.mimeType,
      bytes: result.bytes,
      appended,
      deviceLabel: deviceLabel || null
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'screen capture upload failed' });
  }
});

// GET /api/screen-capture/status
// Returns whether the user currently has a fresh screenshot and how much TTL
// is left. The desktop UI and the chat tool both poll this to decide whether
// the latest snapshot is recent enough to ground a new turn on.
router.get('/status', (req, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'auth required' });
  res.json({ userId, ...getStatus(userId), ttlMs: RECENT_TTL_MS });
});

module.exports = router;
