import { describe, it, expect } from 'vitest';
import { buildProviderCandidates } from '../chat/providers.js';

function looksLikeOllamaModel(modelId) {
  if (!modelId) return false;
  if (modelId.includes('/')) return false;
  if (/^gpt-/i.test(modelId)) return false;
  if (/^o[134]/i.test(modelId)) return false;
  if (/^claude/i.test(modelId)) return false;
  if (/^gemini/i.test(modelId)) return false;
  return modelId.includes(':') || /^(gemma|qwen|llama|deepseek|mistral|phi|codellama)/i.test(modelId);
}

describe('provider candidate routing', () => {
  it('does not misclassify gpt cloud ids as Ollama models', () => {
    const candidates = buildProviderCandidates({
      frontendApiKey: 'dummy',
      frontendBaseUrl: 'http://localhost:8080/v1',
      frontendModel: 'gpt-4.1',
      autoIntent: 'fast',
      env: {
        OLLAMA_BASE_URL: 'http://localhost:11434/v1'
      },
      parseProviderPoolFromEnv: () => [],
      looksLikeOllamaModel
    });

    expect(candidates.some((p) => p.id === 'local_ollama_auto')).toBe(false);
    expect(candidates.some((p) => p.id === 'frontend' && p.baseURL === 'http://localhost:8080/v1')).toBe(true);
  });

  it('still recognizes real Ollama model ids', () => {
    const candidates = buildProviderCandidates({
      frontendApiKey: '',
      frontendBaseUrl: '',
      frontendModel: 'gemma4:12b',
      autoIntent: 'fast',
      productMode: 'desktop_code',
      executionMode: 'local',
      env: {
        OLLAMA_BASE_URL: 'http://localhost:11434/v1'
      },
      parseProviderPoolFromEnv: () => [],
      looksLikeOllamaModel
    });

    expect(candidates.some((p) => p.id === 'desktop_local_primary' && p.baseURL === 'http://localhost:11434/v1')).toBe(true);
  });

  it('web chat mode excludes local providers', () => {
    const candidates = buildProviderCandidates({
      frontendApiKey: 'dummy',
      frontendBaseUrl: 'http://localhost:8080/v1',
      frontendModel: 'auto',
      autoIntent: 'fast',
      webTaskType: 'general',
      productMode: 'web_chat',
      executionMode: 'cloud',
      env: {
        OPENAI_API_KEY: 'env-key',
        OPENAI_BASE_URL: 'https://api.freemodel.dev/v1',
        AUTO_SMART_MODEL: 'gpt-5.5',
        AUTO_FAST_MODEL: 'gpt-5.5-mini',
        OLLAMA_BASE_URL: 'http://localhost:11434/v1'
      },
      parseProviderPoolFromEnv: () => [],
      looksLikeOllamaModel
    });

    expect(candidates.some((p) => /11434|localhost/i.test(String(p.baseURL)))).toBe(false);
    expect(candidates[0].model).toBe('gpt-5.5-mini');
  });

  it('web chat image requests prefer vision model first', () => {
    const candidates = buildProviderCandidates({
      frontendApiKey: 'dummy',
      frontendBaseUrl: '',
      frontendModel: 'auto',
      autoIntent: 'smart',
      hasImageAttachment: true,
      webTaskType: 'vision',
      productMode: 'web_chat',
      executionMode: 'cloud',
      env: {
        OPENAI_API_KEY: 'env-key',
        OPENAI_BASE_URL: 'https://api.freemodel.dev/v1',
        WEB_CHAT_FAST_MODEL: 'gpt-5.5-mini',
        WEB_CHAT_SMART_MODEL: 'gpt-5.5',
        WEB_CHAT_VISION_MODEL: 'gpt-5.5-vision'
      },
      parseProviderPoolFromEnv: () => [],
      looksLikeOllamaModel
    });

    expect(candidates[0].model).toBe('gpt-5.5-vision');
  });

  it('web chat code requests prefer code model first', () => {
    const candidates = buildProviderCandidates({
      frontendApiKey: 'dummy',
      frontendBaseUrl: '',
      frontendModel: 'auto',
      autoIntent: 'fast',
      webTaskType: 'code',
      productMode: 'web_chat',
      executionMode: 'cloud',
      env: {
        OPENAI_API_KEY: 'env-key',
        OPENAI_BASE_URL: 'https://api.freemodel.dev/v1',
        WEB_CHAT_FAST_MODEL: 'gpt-5.5-mini',
        WEB_CHAT_SMART_MODEL: 'gpt-5.5',
        WEB_CHAT_CODE_MODEL: 'qwen3-coder-free'
      },
      parseProviderPoolFromEnv: () => [],
      looksLikeOllamaModel
    });

    expect(candidates[0].model).toBe('qwen3-coder-free');
  });

  it('omniroute takes precedence for web auto routing when enabled', () => {
    const candidates = buildProviderCandidates({
      frontendApiKey: 'frontend-key-ignored',
      frontendBaseUrl: '',
      frontendModel: 'auto',
      autoIntent: 'smart',
      webTaskType: 'general',
      productMode: 'web_chat',
      executionMode: 'cloud',
      env: {
        OPENAI_API_KEY: 'env-key',
        OPENAI_BASE_URL: 'https://api.freemodel.dev/v1',
        WEB_CHAT_SMART_MODEL: 'gpt-5.5',
        OMNIROUTE_ENABLED: 'true',
        OMNIROUTE_BASE_URL: 'https://omniroute.example/v1',
        OMNIROUTE_API_KEY: 'omni-key'
      },
      parseProviderPoolFromEnv: () => [],
      looksLikeOllamaModel
    });

    expect(candidates[0].baseURL).toBe('https://omniroute.example/v1');
    expect(candidates[0].apiKey).toBe('omni-key');
  });

  it('ignores stale browser cloud settings when web OmniRoute is enabled', () => {
    const candidates = buildProviderCandidates({
      frontendApiKey: 'stale-browser-key',
      frontendBaseUrl: 'https://agentrouter.example/v1',
      frontendModel: 'auto',
      autoIntent: 'fast',
      webTaskType: 'general',
      productMode: 'web_chat',
      executionMode: 'cloud',
      env: {
        OPENAI_API_KEY: 'legacy-key',
        OPENAI_BASE_URL: 'https://legacy.example/v1',
        OPENAI_MODEL: 'qwen2.5-coder:latest',
        WEB_CHAT_FAST_MODEL: 'qwen2.5-coder:latest',
        OMNIROUTE_ENABLED: 'true',
        OMNIROUTE_BASE_URL: 'https://omniroute.example/v1',
      },
      parseProviderPoolFromEnv: () => [],
      looksLikeOllamaModel
    });

    expect(candidates[0].id).toContain('omniroute');
    expect(candidates[0].baseURL).toBe('https://omniroute.example/v1');
    expect(candidates[0].model).toBe('auto');
  });

  it('desktop local mode forces ollama provider', () => {
    const candidates = buildProviderCandidates({
      frontendApiKey: 'dummy',
      frontendBaseUrl: 'https://api.freemodel.dev/v1',
      frontendModel: 'gpt-4.1',
      autoIntent: 'fast',
      productMode: 'desktop_code',
      executionMode: 'local',
      env: {
        OLLAMA_BASE_URL: 'http://localhost:11434/v1',
        DESKTOP_LOCAL_DEFAULT_MODEL: 'gemma4:12b'
      },
      parseProviderPoolFromEnv: () => [],
      looksLikeOllamaModel
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0].id).toBe('desktop_local_primary');
    expect(candidates[0].baseURL).toBe('http://localhost:11434/v1');
    expect(candidates[0].model).toBe('gemma4:12b');
  });
});
