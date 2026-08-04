// ==========================================
// TTS Route — Fish Audio S2.1 Pro Free proxy
// ==========================================
// Proxies text-to-speech requests to Fish Audio API so the API key
// stays server-side. Streams audio chunks back to the client for
// low-latency playback (Voice Mode).

const express = require('express');
const router = express.Router();

const FISH_API_URL = 'https://api.fish.audio/v1/tts';
const FISH_MODEL = process.env.FISH_TTS_MODEL || 's2.1-pro-free';
const FISH_VOICE_ID = process.env.FISH_TTS_VOICE_ID || '';
const MAX_TEXT_LENGTH = 4000; // chars — prevent abuse

// POST /api/tts — Synthesize speech from text
// Body: { text: string, format?: 'mp3'|'pcm', voice?: string }
// Returns: audio stream (audio/mpeg or audio/pcm)
router.post('/tts', async (req, res) => {
  try {
    const apiKey = process.env.FISH_API_KEY;
    if (!apiKey) {
      return res.status(503).json({ error: 'TTS xidməti konfiqurasiya olunmayıb' });
    }

    const { text, format = 'mp3', voice } = req.body || {};
    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      return res.status(400).json({ error: 'text sahəsi tələb olunur' });
    }
    if (text.length > MAX_TEXT_LENGTH) {
      return res.status(400).json({ error: `Mətn ${MAX_TEXT_LENGTH} simvoldan çox ola bilməz` });
    }

    const referenceId = voice || FISH_VOICE_ID || undefined;
    const body = {
      text: text.trim(),
      format,
      latency: 'balanced',
      ...(referenceId ? { reference_id: referenceId } : {}),
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    const fishRes = await fetch(FISH_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'model': FISH_MODEL,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!fishRes.ok) {
      const errText = await fishRes.text().catch(() => '');
      console.error(`[TTS] Fish Audio error: ${fishRes.status} ${errText.slice(0, 200)}`);
      return res.status(502).json({ error: 'TTS xidmətindən cavab alınmadı' });
    }

    // Stream audio back to client
    const contentType = format === 'pcm' ? 'audio/pcm' : 'audio/mpeg';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Transfer-Encoding', 'chunked');

    // Pipe Fish Audio response body to client
    const reader = fishRes.body?.getReader();
    if (!reader) {
      return res.status(502).json({ error: 'TTS stream alınmadı' });
    }

    const pump = async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!res.writableEnded) {
          res.write(value);
        } else {
          break;
        }
      }
      if (!res.writableEnded) res.end();
    };

    res.on('close', () => {
      reader.cancel().catch(() => {});
    });

    await pump();
  } catch (err) {
    if (err.name === 'AbortError') {
      if (!res.headersSent) {
        return res.status(504).json({ error: 'TTS sorğusu vaxt aşımına uğradı' });
      }
    }
    console.error('[TTS] Error:', err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: 'TTS xətası' });
    }
  }
});

module.exports = router;
