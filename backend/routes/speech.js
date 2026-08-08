// ==========================================
// STT Route — Multilingual Speech-to-Text proxy
// ==========================================
// Accepts recorded audio (raw body) and transcribes it via a configurable
// OpenAI-compatible Whisper endpoint (POST /audio/transcriptions), keeping the
// API key server-side.
//
// This replaces the client-only Web Speech API (`tr-TR`) path that previously
// degraded "listening" for an Azerbaijani agent: the server picks the language
// (default Azerbaijani `az`), and the path works on Safari/Firefox where Web
// Speech API is unreliable or absent.
//
// Config (env, all optional — service is DISABLED until both are set):
//   STT_BASE_URL   OpenAI-compatible base, e.g. https://api.openai.com/v1
//   STT_API_KEY    provider key
//   STT_MODEL      model id (default "whisper-1")
//   STT_DEFAULT_LANG  language hint (default "az")
//
// Client contract:
//   POST /api/stt  (Content-Type: any audio/*, raw bytes body, ?lang=az)
//   -> 200 { text, language, configured:true }
//   -> 503 { error, configured:false }   (not configured — client falls back)
//   -> 400 { error } (no audio)
//   -> 502 { error, configured:true } (upstream failure)
//   -> 422 { error, text:"" } (empty transcript)

const express = require('express');
const router = express.Router();

const STT_BASE_URL = (process.env.STT_BASE_URL || '').trim().replace(/\/+$/, '');
const STT_API_KEY = (process.env.STT_API_KEY || '').trim();
const STT_MODEL = process.env.STT_MODEL || 'whisper-1';
const STT_DEFAULT_LANG = process.env.STT_DEFAULT_LANG || 'az';
const MAX_AUDIO_BYTES = Number(process.env.STT_MAX_AUDIO_BYTES || 25 * 1024 * 1024); // 25 MB

function isConfigured() {
  return Boolean(STT_BASE_URL && STT_API_KEY);
}

// Accept any audio payload as a raw Buffer (avoids a multer dependency).
router.post(
  '/stt',
  express.raw({ type: () => true, limit: MAX_AUDIO_BYTES }),
  async (req, res) => {
    try {
      if (!isConfigured()) {
        return res.status(503).json({ error: 'STT xidməti konfiqurasiya olunmayıb', configured: false });
      }

      const buf = req.body;
      if (!Buffer.isBuffer(buf) || buf.length === 0) {
        return res.status(400).json({ error: 'audio faylı tələb olunur' });
      }

      const lang = String(req.query.lang || STT_DEFAULT_LANG || 'az').slice(0, 8);
      const contentType = (req.headers['content-type'] || 'audio/webm').split(';')[0].trim();

      // Build an upstream multipart/form-data body using the global FormData/Blob
      // (Node 18+). fetch sets the multipart boundary automatically.
      const form = new FormData();
      form.append('file', new Blob([buf], { type: contentType }), 'audio.webm');
      form.append('model', STT_MODEL);
      form.append('language', lang);
      form.append('response_format', 'json');

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);

      let upstream;
      try {
        upstream = await fetch(`${STT_BASE_URL}/audio/transcriptions`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${STT_API_KEY}`,
          },
          body: form,
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }

      if (!upstream.ok) {
        const errText = await upstream.text().catch(() => '');
        console.error(`[STT] upstream error ${upstream.status}: ${errText.slice(0, 200)}`);
        return res.status(502).json({ error: 'STT xidmətindən cavab alınmadı', configured: true });
      }

      const data = await upstream.json().catch(() => null);
      const text = (data && data.text) || '';
      if (!text) {
        return res.status(422).json({ error: 'Səs tanınmadı, yenidən danışın', text: '' });
      }
      return res.json({ text: text.trim(), language: lang, configured: true });
    } catch (err) {
      if (err && err.name === 'AbortError') {
        if (!res.headersSent) {
          return res.status(504).json({ error: 'STT sorğusu vaxt aşımına uğradı', configured: true });
        }
        return;
      }
      console.error('[STT] Error:', err && err.message);
      if (!res.headersSent) res.status(500).json({ error: 'STT xətası', configured: true });
    }
  }
);

module.exports = router;
