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

  it('adds task-aware NVIDIA NIM models after OmniRoute candidates', () => {
    const candidates = buildProviderCandidates({
      frontendApiKey: '',
      frontendBaseUrl: '',
      frontendModel: 'auto',
      autoIntent: 'smart',
      webTaskType: 'code',
      productMode: 'web_chat',
      executionMode: 'cloud',
      env: {
        OMNIROUTE_ENABLED: 'true',
        OMNIROUTE_BASE_URL: 'https://omniroute.example/v1',
        OMNIROUTE_API_KEY: 'omni-key',
        OMNIROUTE_MODEL: 'auto',
        NVIDIA_API_KEY: 'nvapi-test',
        NVIDIA_CODE_MODEL: 'qwen/code-model',
        NVIDIA_SMART_MODEL: 'meta/smart-model',
        NVIDIA_GENERAL_MODEL: 'meta/fast-model'
      },
      parseProviderPoolFromEnv: () => [],
      looksLikeOllamaModel
    });

    expect(candidates[0].id).toContain('omniroute');
    expect(candidates.find((provider) => provider.id === 'nvidia_code_1')).toMatchObject({
      baseURL: 'https://integrate.api.nvidia.com/v1',
      apiKey: 'nvapi-test',
      model: 'qwen/code-model',
      wireApi: 'chat_completions'
    });
  });

  it('prefers NVIDIA_GENERAL_MODEL over the fast alias when both are configured', () => {
    const candidates = buildProviderCandidates({
      frontendApiKey: '',
      frontendBaseUrl: '',
      frontendModel: 'auto',
      autoIntent: 'fast',
      webTaskType: 'general',
      productMode: 'web_chat',
      executionMode: 'cloud',
      env: {
        NVIDIA_API_KEY: 'nvapi-test',
        NVIDIA_FAST_MODEL: 'meta/llama-3.1-8b-instruct',
        NVIDIA_GENERAL_MODEL: 'meta/llama-3.3-70b-instruct'
      },
      parseProviderPoolFromEnv: () => [],
      looksLikeOllamaModel
    });

    expect(candidates.find((provider) => provider.id === 'nvidia_general_1').model)
      .toBe('meta/llama-3.3-70b-instruct');
  });

  it('uses NVIDIA as a desktop cloud Smart fallback', () => {
    const candidates = buildProviderCandidates({
      frontendApiKey: '',
      frontendBaseUrl: '',
      frontendModel: 'auto',
      autoIntent: 'smart',
      productMode: 'desktop_code',
      executionMode: 'cloud',
      env: {
        NVIDIA_API_KEY: 'nvapi-test',
        NVIDIA_CODE_MODEL: 'qwen/code-model',
        NVIDIA_SMART_MODEL: 'meta/smart-model'
      },
      parseProviderPoolFromEnv: () => [],
      looksLikeOllamaModel
    });

    expect(candidates[0]).toMatchObject({
      id: 'nvidia_code_1',
      model: 'qwen/code-model'
    });
  });

  it('expands OmniRoute fallback models for 401 model rotation', () => {
    const candidates = buildProviderCandidates({
      frontendApiKey: 'frontend-key-ignored',
      frontendBaseUrl: '',
      frontendModel: 'auto',
      autoIntent: 'fast',
      webTaskType: 'general',
      productMode: 'web_chat',
      executionMode: 'cloud',
      env: {
        OMNIROUTE_ENABLED: 'true',
        OMNIROUTE_BASE_URL: 'https://omniroute.example/v1',
        OMNIROUTE_API_KEY: 'omni-key',
        OMNIROUTE_MODEL: 'auto',
        OMNIROUTE_FALLBACK_MODELS: 'qwen/qwen3-coder:free, meta-llama/llama-3.3-70b-instruct:free, auto'
      },
      parseProviderPoolFromEnv: () => [],
      looksLikeOllamaModel
    });

    expect(candidates.slice(0, 3).map((provider) => provider.model)).toEqual([
      'auto',
      'qwen/qwen3-coder:free',
      'meta-llama/llama-3.3-70b-instruct:free'
    ]);
    expect(candidates.slice(0, 3).every((provider) => provider.baseURL === 'https://omniroute.example/v1')).toBe(true);
    expect(new Set(candidates.slice(0, 3).map((provider) => provider.id)).size).toBe(3);
  });

  it('keeps local OmniRoute gateway as OmniRoute instead of Ollama', () => {
    const candidates = buildProviderCandidates({
      frontendApiKey: '',
      frontendBaseUrl: '',
      frontendModel: 'auto',
      autoIntent: 'fast',
      webTaskType: 'general',
      productMode: 'web_chat',
      executionMode: 'cloud',
      env: {
        OMNIROUTE_ENABLED: 'true',
        OMNIROUTE_BASE_URL: 'http://localhost:20128/v1',
        OMNIROUTE_API_KEY: 'omni-key',
        OMNIROUTE_MODEL: 'auto',
        OMNIROUTE_FALLBACK_MODELS: 'qwen/qwen3-coder:free'
      },
      parseProviderPoolFromEnv: () => [],
      looksLikeOllamaModel
    });

    expect(candidates[0]).toMatchObject({
      id: 'web_general_primary_omniroute',
      baseURL: 'http://localhost:20128/v1',
      model: 'auto',
      wireApi: 'chat_completions'
    });
    expect(candidates[1]).toMatchObject({
      baseURL: 'http://localhost:20128/v1',
      model: 'qwen/qwen3-coder:free'
    });
  });

  it('uses the configured fast Ollama model for local web fallback', () => {
    const candidates = buildProviderCandidates({
      frontendApiKey: '',
      frontendBaseUrl: '',
      frontendModel: 'auto',
      autoIntent: 'fast',
      webTaskType: 'general',
      productMode: 'web_chat',
      executionMode: 'cloud',
      env: {
        LOCAL_MODE: 'true',
        OMNIROUTE_ENABLED: 'true',
        OMNIROUTE_BASE_URL: 'https://omniroute.example/v1',
        OMNIROUTE_API_KEY: 'omni-key',
        OMNIROUTE_MODEL: 'gpt-5.5',
        AUTO_FAST_MODEL: 'qwen2.5-coder:latest',
        OPENAI_MODEL: 'qwen2.5-coder:latest',
        OLLAMA_BASE_URL: 'http://localhost:11434/v1'
      },
      parseProviderPoolFromEnv: () => [],
      looksLikeOllamaModel
    });

    expect(candidates.at(-1)).toMatchObject({
      id: 'web_auto_ollama_fallback',
      model: 'qwen2.5-coder:latest'
    });
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
