// Example: Hybrid Local + Cloud Provider Pool
//
// Copy this object as the value of AI_PROVIDER_POOL env (single-line JSON).
// The chat handler tries providers in order; on failure it moves to the next
// (and rotates back after `PROVIDER_COOLDOWN_MS`).
//
// To use:
//   1. Open the resulting JSON below in your editor
//   2. node -e "console.log(JSON.stringify(require('./scripts/provider-pool.example.js')))"
//   3. Paste the single-line output into your .env file like so:
//      AI_PROVIDER_POOL='[...]'
//
// You can mix-and-match any number of providers (Ollama, OpenRouter, NVIDIA,
// Anthropic via OpenRouter, OpenAI direct, etc.)

module.exports = [
  // 1) Lokal Ollama — pulsuz, sürətli, məxfi (sürətli suallar üçün)
  {
    id: 'ollama_qwen_7b',
    apiKey: 'ollama',
    baseURL: 'http://localhost:11434/v1',
    model: 'qwen2.5-coder:7b'
  },
  // 2) Lokal Ollama (daha böyük) — əgər birinci yüklənibsə
  {
    id: 'ollama_qwen_14b',
    apiKey: 'ollama',
    baseURL: 'http://localhost:11434/v1',
    model: 'qwen2.5-coder:14b'
  },
  // 3) Cloud — Claude Sonnet 4.5 (mürəkkəb iş üçün)
  // OpenRouter key: https://openrouter.ai/keys
  {
    id: 'openrouter_claude_sonnet',
    apiKey: 'sk-or-v1-YOUR_KEY_HERE',
    baseURL: 'https://openrouter.ai/api/v1',
    model: 'anthropic/claude-sonnet-4.5'
  },
  // 4) Cloud — Gemini 3 Flash (ucuz fallback)
  {
    id: 'openrouter_gemini_flash',
    apiKey: 'sk-or-v1-YOUR_KEY_HERE',
    baseURL: 'https://openrouter.ai/api/v1',
    model: 'google/gemini-3-flash'
  }
];
