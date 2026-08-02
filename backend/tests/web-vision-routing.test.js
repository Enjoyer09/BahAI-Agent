// Regression guards for the web vision fix:
// 1) providers.js — OmniRoute-enabled vision requests must route to the
//    configured WEB_CHAT_VISION_MODEL first (previously ignored → text-only
//    model hallucinated image descriptions from OCR hints + prompt fragments).
// 2) helpers.js normalizeMessagesForModel — the injected image instruction
//    must stay compact so weak models do not parrot it verbatim into the
//    user-visible answer ("Əmin olmadığım hissələr", "yazı seçilmir demək yeterli").
// No server / DB / real model needed.

import { describe, it, expect } from 'vitest';
import { buildProviderCandidates } from '../chat/providers.js';
import { normalizeMessagesForModel } from '../helpers.js';

function looksLikeOllamaModel(modelId) {
  if (!modelId) return false;
  if (modelId.includes('/')) return false;
  if (/^gpt-/i.test(modelId)) return false;
  if (/^o[134]/i.test(modelId)) return false;
  if (/^claude/i.test(modelId)) return false;
  if (/^gemini/i.test(modelId)) return false;
  return modelId.includes(':') || /^(gemma|qwen|llama|deepseek|mistral|phi|codellama)/i.test(modelId);
}

function visionCandidates(env) {
  return buildProviderCandidates({
    frontendApiKey: '',
    frontendBaseUrl: '',
    frontendModel: 'auto',
    autoIntent: 'smart',
    hasImageAttachment: true,
    webTaskType: 'vision',
    productMode: 'web_chat',
    executionMode: 'cloud',
    env,
    parseProviderPoolFromEnv: () => [],
    looksLikeOllamaModel
  });
}

describe('web vision routing (providers.js)', () => {
  it('OmniRoute vision requests use WEB_CHAT_VISION_MODEL as the first cloud candidate', () => {
    const candidates = visionCandidates({
      OMNIROUTE_ENABLED: 'true',
      OMNIROUTE_BASE_URL: 'https://omniroute.example/v1',
      OMNIROUTE_API_KEY: 'omni-key',
      OMNIROUTE_MODEL: 'auto',
      WEB_CHAT_VISION_MODEL: 'gpt-5.5-vision',
      WEB_CHAT_FAST_MODEL: 'gpt-5.5-mini',
      WEB_CHAT_SMART_MODEL: 'gpt-5.5',
      OPENAI_API_KEY: 'env-key',
      OPENAI_BASE_URL: 'https://api.freemodel.dev/v1'
    });

    // Primary cloud candidate must be the vision model on the OmniRoute base —
    // not the text-oriented 'auto' that cannot see the image.
    expect(candidates[0]).toMatchObject({
      id: 'web_vision_primary_omniroute',
      model: 'gpt-5.5-vision',
      baseURL: 'https://omniroute.example/v1'
    });
  });

  it('OmniRoute vision still falls back to OmniRoute fallback models after the vision model', () => {
    const candidates = visionCandidates({
      OMNIROUTE_ENABLED: 'true',
      OMNIROUTE_BASE_URL: 'https://omniroute.example/v1',
      OMNIROUTE_API_KEY: 'omni-key',
      OMNIROUTE_MODEL: 'auto',
      OMNIROUTE_FALLBACK_MODELS: 'meta-llama/llama-3.3-70b-instruct:free',
      WEB_CHAT_VISION_MODEL: 'gpt-5.5-vision',
      OPENAI_API_KEY: 'env-key',
      OPENAI_BASE_URL: 'https://api.freemodel.dev/v1'
    });

    const models = candidates.map((c) => c.model);
    expect(models[0]).toBe('gpt-5.5-vision');
    expect(models).toContain('meta-llama/llama-3.3-70b-instruct:free');
    // No duplicate vision model entries.
    expect(models.filter((m) => m === 'gpt-5.5-vision')).toHaveLength(1);
  });

  it('OmniRoute vision without WEB_CHAT_VISION_MODEL keeps the gateway auto routing (no NVIDIA id forced onto the gateway)', () => {
    // The NVIDIA default model id belongs to the NVIDIA endpoint, not the
    // OmniRoute gateway — forcing it onto the gateway base would guarantee a
    // failed first attempt. Without an explicit vision model, keep the plain
    // gateway fallback list so the gateway's own auto routing applies.
    const candidates = visionCandidates({
      OMNIROUTE_ENABLED: 'true',
      OMNIROUTE_BASE_URL: 'https://omniroute.example/v1',
      OMNIROUTE_API_KEY: 'omni-key',
      OMNIROUTE_MODEL: 'auto',
      OPENAI_API_KEY: 'env-key',
      OPENAI_BASE_URL: 'https://api.freemodel.dev/v1'
    });

    expect(candidates[0]).toMatchObject({
      id: 'web_vision_primary_omniroute',
      model: 'auto',
      baseURL: 'https://omniroute.example/v1'
    });
  });

  it('non-vision OmniRoute requests keep the plain OmniRoute fallback list (unchanged)', () => {
    const candidates = buildProviderCandidates({
      frontendApiKey: '',
      frontendBaseUrl: '',
      frontendModel: 'auto',
      autoIntent: 'fast',
      hasImageAttachment: false,
      webTaskType: 'general',
      productMode: 'web_chat',
      executionMode: 'cloud',
      env: {
        OMNIROUTE_ENABLED: 'true',
        OMNIROUTE_BASE_URL: 'https://omniroute.example/v1',
        OMNIROUTE_API_KEY: 'omni-key',
        OMNIROUTE_MODEL: 'auto',
        OMNIROUTE_FALLBACK_MODELS: 'qwen/qwen3-coder:free',
        OPENAI_API_KEY: 'env-key',
        OPENAI_BASE_URL: 'https://api.freemodel.dev/v1'
      },
      parseProviderPoolFromEnv: () => [],
      looksLikeOllamaModel
    });

    expect(candidates[0].model).toBe('auto');
    expect(candidates.map((c) => c.model)).toContain('qwen/qwen3-coder:free');
  });
});

describe('web vision prompt (helpers.js normalizeMessagesForModel)', () => {
  const imageMessage = {
    role: 'user',
    content: 'şəkildə nə görürsən?',
    attachments: [{
      type: 'image',
      mimeType: 'image/png',
      url: 'data:image/png;base64,aGVsbG8=',
      name: 'azergis.png',
      extractedText: 'AzərGIS COĞRAFİ İNFORMASİYA SİSTEMLƏRİ'
    }]
  };

  it('still passes the image as an image_url part to vision-capable models', async () => {
    const [normalized] = await normalizeMessagesForModel([imageMessage], 'gpt-5.5', []);
    expect(Array.isArray(normalized.content)).toBe(true);
    const imagePart = normalized.content.find((part) => part.type === 'image_url');
    expect(imagePart).toMatchObject({
      type: 'image_url',
      image_url: { url: 'data:image/png;base64,aGVsbG8=', detail: 'high' }
    });
  });

  it('does not inject the verbose echo-prone instruction fragments into the user message', async () => {
    const [normalized] = await normalizeMessagesForModel([imageMessage], 'gpt-5.5', []);
    const textPart = normalized.content.find((part) => part.type === 'text')?.text || '';
    // These phrases leaked verbatim into real model answers (user-visible
    // garbage: "Əmin olmadığım hissələr", "yazı seçilmir demək yeterli").
    expect(textPart).not.toContain('yazı seçilmir');
    expect(textPart).not.toContain('Əmin olmadığın hissələr');
    expect(textPart).not.toContain('3 hissə ilə qur');
    expect(textPart).not.toContain('Captcha');
  });

  it('keeps a compact image instruction that steers the model without being quoted', async () => {
    const [normalized] = await normalizeMessagesForModel([imageMessage], 'gpt-5.5', []);
    const textPart = normalized.content.find((part) => part.type === 'text')?.text || '';
    expect(textPart).toContain('Şəkil əlavə olunub');
    expect(textPart).toContain('qeyri-müəyyən detalları uydurma');
    // OCR is only a hint — the model must not trust it alone.
    expect(textPart).toContain('OCR mətni yalnız ipucudur');
  });

  it('does not inject image instructions for local/flaky models (text-only path)', async () => {
    const [normalized] = await normalizeMessagesForModel([imageMessage], 'ollama/gemma4:12b', []);
    expect(normalized.content).toContain('[Sistem qeydi: İstifadəçi artıq attachment göndərib');
    expect(normalized.content).not.toContain('[Sistem formatı - image reply');
  });
});
