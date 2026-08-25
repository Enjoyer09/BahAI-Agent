// ==========================================
// Screen Capture Helper — Electron main process
// ==========================================
// Captures the primary display via Electron's desktopCapturer, converts the
// PNG thumbnail to base64, and uploads it to the bahAI backend's
// /api/screen-capture/upload endpoint. Used by the "Buddy → Ekranı paylaş"
// menu item so end users can ground chat turns on what they actually see.
//
// Why main process, not renderer:
//   - desktopCapturer can ONLY be called from the main process (or a hidden
//     BrowserWindow). Renderer access throws "Electron failed to install
//     extension".
//   - This keeps the screen-capture permission scope narrow: only the main
//     process asks for it, never the long-lived chat web UI.

const { desktopCapturer, screen, app } = require('electron');
const os = require('os');

const CAPTURE_WIDTH = Number(process.env.SCREEN_CAPTURE_WIDTH || 1920);
const CAPTURE_HEIGHT = Number(process.env.SCREEN_CAPTURE_HEIGHT || 1080);
const UPLOAD_TIMEOUT_MS = Number(process.env.SCREEN_CAPTURE_UPLOAD_TIMEOUT || 15000);

/**
 * Capture a PNG of the primary display.
 * Returns { ok, base64, mimeType, bytes, displayLabel } | { ok:false, error }.
 */
async function captureScreenThumbnail() {
  let primaryDisplay;
  try {
    primaryDisplay = screen.getPrimaryDisplay();
  } catch (err) {
    return { ok: false, error: `screen.getPrimaryDisplay failed: ${err.message}` };
  }

  let sources;
  try {
    sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: CAPTURE_WIDTH, height: CAPTURE_HEIGHT }
    });
  } catch (err) {
    return { ok: false, error: `desktopCapturer.getSources failed: ${err.message}` };
  }
  if (!sources || sources.length === 0) {
    return { ok: false, error: 'no screen sources available — the OS may be blocking screen capture' };
  }

  // Prefer the primary display, fall back to the first available source.
  let chosen = sources[0];
  if (primaryDisplay && primaryDisplay.id != null) {
    const match = sources.find((s) => String(s.id) === String(primaryDisplay.id));
    if (match) chosen = match;
  }

  let pngBuffer;
  try {
    pngBuffer = chosen.thumbnail.toPNG();
  } catch (err) {
    return { ok: false, error: `toPNG failed: ${err.message}` };
  }
  if (!pngBuffer || pngBuffer.length === 0) {
    return { ok: false, error: 'captured PNG is empty' };
  }
  const bytes = pngBuffer.length;
  const base64 = pngBuffer.toString('base64');
  return {
    ok: true,
    base64,
    mimeType: 'image/png',
    bytes,
    displayLabel: chosen.name || 'primary',
    deviceLabel: deriveDeviceLabel()
  };
}

function deriveDeviceLabel() {
  try {
    return `${app.getName()}/${os.hostname()}/${app.getVersion()}`;
  } catch {
    return `${app.getName()}/${os.hostname()}`;
  }
}

/**
 * POST a captured PNG to the backend's /api/screen-capture/upload endpoint.
 * The token is the user's JWT (same one the web chat uses).
 *
 * @returns { ok:true, timestamp, ttlMs, ... } | { ok:false, error }
 */
async function uploadToBackend({ baseUrl, token, base64, mimeType, conversationId, appendToConversation, deviceLabel }) {
  if (!baseUrl) return { ok: false, error: 'baseUrl is required' };
  if (!token) return { ok: false, error: 'auth token is required' };
  if (!base64) return { ok: false, error: 'base64 is required' };

  const url = `${baseUrl.replace(/\/+$/, '')}/api/screen-capture/upload`;
  const body = JSON.stringify({
    base64,
    mimeType,
    conversationId: conversationId || undefined,
    appendToConversation: !!appendToConversation,
    deviceLabel: deviceLabel || undefined
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body,
      signal: controller.signal
    });
  } catch (err) {
    clearTimeout(timer);
    return { ok: false, error: `network error: ${err.message}` };
  }
  clearTimeout(timer);

  let payload;
  try { payload = await response.json(); }
  catch { payload = { error: `non-JSON response (status ${response.status})` }; }

  if (!response.ok) {
    return { ok: false, status: response.status, error: payload.error || `upload failed (${response.status})` };
  }
  return { ok: true, ...payload };
}

module.exports = {
  captureScreenThumbnail,
  uploadToBackend,
  CAPTURE_WIDTH,
  CAPTURE_HEIGHT,
  UPLOAD_TIMEOUT_MS
};
