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

  it('web chat image requests prefer a real NVIDIA vision candidate when available', () => {
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
        NVIDIA_API_KEY: 'nvapi-test',
        NVIDIA_VISION_MODEL: 'meta/llama-3.2-11b-vision-instruct'
      },
      parseProviderPoolFromEnv: () => [],
      looksLikeOllamaModel
    });

    expect(candidates[0]).toMatchObject({
      id: 'nvidia_vision_1',
      model: 'meta/llama-3.2-11b-vision-instruct'
    });
  });

  it('uses the current NVIDIA Omni vision model by default', () => {
    const candidates = buildProviderCandidates({
      frontendApiKey: '',
      frontendBaseUrl: '',
      frontendModel: 'auto',
      autoIntent: 'smart',
      hasImageAttachment: true,
      webTaskType: 'vision',
      productMode: 'web_chat',
      executionMode: 'cloud',
      env: {
        NVIDIA_API_KEY: 'nvapi-test'
      },
      parseProviderPoolFromEnv: () => [],
      looksLikeOllamaModel
    });

    expect(candidates[0].model).toBe('nvidia/nemotron-3-nano-omni-30b-a3b-reasoning');
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

  it('web auto routing prefers the env-driven cloud provider when no browser override exists', () => {
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
        WEB_CHAT_SMART_MODEL: 'gpt-5.5'
      },
      parseProviderPoolFromEnv: () => [],
      looksLikeOllamaModel
    });

    expect(candidates[0].baseURL).toBe('https://api.freemodel.dev/v1');
    expect(candidates[0].apiKey).toBe('env-key');
  });

  it('adds task-aware NVIDIA NIM models after env-driven web candidates', () => {
    const candidates = buildProviderCandidates({
      frontendApiKey: '',
      frontendBaseUrl: '',
      frontendModel: 'auto',
      autoIntent: 'smart',
      webTaskType: 'code',
      productMode: 'web_chat',
      executionMode: 'cloud',
      env: {
        NVIDIA_API_KEY: 'nvapi-test',
        NVIDIA_CODE_MODEL: 'qwen/code-model',
        NVIDIA_SMART_MODEL: 'meta/smart-model',
        NVIDIA_GENERAL_MODEL: 'meta/fast-model'
      },
      parseProviderPoolFromEnv: () => [],
      looksLikeOllamaModel
    });

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

  it('web chat keeps a non-local browser cloud override when provided', () => {
    const candidates = buildProviderCandidates({
      frontendApiKey: 'browser-key',
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
        WEB_CHAT_FAST_MODEL: 'qwen2.5-coder:latest'
      },
      parseProviderPoolFromEnv: () => [],
      looksLikeOllamaModel
    });

    expect(candidates[0].id).toBe('web_general_primary');
    expect(candidates[0].baseURL).toBe('https://agentrouter.example/v1');
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

  it('web chat auto expands an env-driven OpenRouter fallback chain', () => {
    const candidates = buildProviderCandidates({
      frontendApiKey: '',
      frontendBaseUrl: '',
      frontendModel: 'auto',
      autoIntent: 'fast',
      webTaskType: 'general',
      productMode: 'web_chat',
      executionMode: 'cloud',
      env: {
        OPENROUTER_API_KEY: 'sk-or-test',
        OPENROUTER_FALLBACK_MODELS: 'deepseek/deepseek-v4-flash:free,qwen/qwen3-coder:free'
      },
      parseProviderPoolFromEnv: () => [],
      looksLikeOllamaModel
    });

    const openRouter = candidates.filter((p) => p.baseURL === 'https://openrouter.ai/api/v1');
    expect(openRouter.map((p) => p.model)).toEqual([
      'deepseek/deepseek-v4-flash:free',
      'qwen/qwen3-coder:free',
      'meta-llama/llama-3.3-70b-instruct:free'
    ]);
    expect(openRouter.every((p) => p.apiKey === 'sk-or-test' && p.wireApi === 'chat_completions')).toBe(true);
  });

  it('web chat vision fallback appends the vision OpenRouter model', () => {
    const candidates = buildProviderCandidates({
      frontendApiKey: '',
      frontendBaseUrl: '',
      frontendModel: 'auto',
      autoIntent: 'smart',
      hasImageAttachment: true,
      webTaskType: 'vision',
      productMode: 'web_chat',
      executionMode: 'cloud',
      env: {
        OPENROUTER_API_KEY: 'sk-or-test'
      },
      parseProviderPoolFromEnv: () => [],
      looksLikeOllamaModel
    });

    const openRouter = candidates.filter((p) => p.baseURL === 'https://openrouter.ai/api/v1');
    expect(openRouter.at(-1).model).toBe('google/gemini-2.0-flash-exp:free');
  });

  it('dedupes OpenRouter fallback models already present in the primary chain', () => {
    const candidates = buildProviderCandidates({
      frontendApiKey: '',
      frontendBaseUrl: '',
      frontendModel: 'auto',
      autoIntent: 'fast',
      webTaskType: 'code',
      productMode: 'web_chat',
      executionMode: 'cloud',
      env: {
        OPENAI_API_KEY: 'sk-or-test',
        OPENROUTER_API_KEY: 'sk-or-test',
        OPENROUTER_FALLBACK_MODELS: 'qwen/qwen3-coder:free',
        WEB_CHAT_CODE_MODEL: 'qwen/qwen3-coder:free'
      },
      parseProviderPoolFromEnv: () => [],
      looksLikeOllamaModel
    });

    const openRouter = candidates.filter((p) => p.baseURL === 'https://openrouter.ai/api/v1');
    expect(openRouter.filter((p) => p.model === 'qwen/qwen3-coder:free')).toHaveLength(1);
  });

  it('desktop auto mode adds OpenRouter fallbacks when a key is configured', () => {
    const candidates = buildProviderCandidates({
      frontendApiKey: '',
      frontendBaseUrl: '',
      frontendModel: 'auto',
      autoIntent: 'fast',
      productMode: 'desktop_code',
      executionMode: 'cloud',
      env: {
        OPENROUTER_API_KEY: 'sk-or-test',
        OPENROUTER_FALLBACK_MODELS: 'qwen/qwen3-coder:free'
      },
      parseProviderPoolFromEnv: () => [],
      looksLikeOllamaModel
    });

    const openRouter = candidates.filter((p) => p.baseURL === 'https://openrouter.ai/api/v1');
    expect(openRouter.length).toBeGreaterThan(0);
    expect(openRouter.map((p) => p.model)).toContain('qwen/qwen3-coder:free');
    expect(openRouter.map((p) => p.model)).toContain('meta-llama/llama-3.3-70b-instruct:free');
  });

  it('desktop local mode never adds OpenRouter candidates', () => {
    const candidates = buildProviderCandidates({
      frontendApiKey: '',
      frontendBaseUrl: '',
      frontendModel: 'auto',
      autoIntent: 'fast',
      productMode: 'desktop_code',
      executionMode: 'local',
      env: {
        OPENROUTER_API_KEY: 'sk-or-test',
        OLLAMA_BASE_URL: 'http://localhost:11434/v1'
      },
      parseProviderPoolFromEnv: () => [],
      looksLikeOllamaModel
    });

    expect(candidates.some((p) => p.baseURL === 'https://openrouter.ai/api/v1')).toBe(false);
    expect(candidates[0].id).toBe('desktop_local_primary');
  });

  it('mixes env-driven web candidates with a real OpenRouter cross-provider candidate when both are configured', () => {
    const candidates = buildProviderCandidates({
      frontendApiKey: '',
      frontendBaseUrl: '',
      frontendModel: 'auto',
      autoIntent: 'smart',
      webTaskType: 'general',
      productMode: 'web_chat',
      executionMode: 'cloud',
      env: {
        OPENAI_API_KEY: 'env-key',
        OPENAI_BASE_URL: 'https://api.freemodel.dev/v1',
        OPENROUTER_API_KEY: 'sk-or-test'
      },
      parseProviderPoolFromEnv: () => [],
      looksLikeOllamaModel
    });

    const cloudCandidates = candidates.filter((p) => p.baseURL === 'https://api.freemodel.dev/v1');
    const openRouterCandidates = candidates.filter((p) => p.baseURL === 'https://openrouter.ai/api/v1');
    expect(cloudCandidates.length).toBeGreaterThan(0);
    expect(openRouterCandidates.length).toBeGreaterThan(0);
    // Cross-provider failover only helps if the pool spans more than one base URL.
    const distinctBases = new Set(candidates.map((p) => String(p.baseURL).replace(/\/+$/, '').toLowerCase()));
    expect(distinctBases.size).toBeGreaterThan(1);
  });

  it('provides NVIDIA text-chat candidates from defaults when only NVIDIA_API_KEY is set', () => {
    const candidates = buildProviderCandidates({
      frontendApiKey: '',
      frontendBaseUrl: '',
      frontendModel: 'auto',
      autoIntent: 'smart',
      webTaskType: 'general',
      productMode: 'web_chat',
      executionMode: 'cloud',
      env: {
        NVIDIA_API_KEY: 'nvapi-test'
        // no NVIDIA_*_MODEL envs — must fall back to modelDefault (drop-in)
      },
      parseProviderPoolFromEnv: () => [],
      looksLikeOllamaModel
    });

    const nvidia = candidates.filter((p) => p.baseURL === 'https://integrate.api.nvidia.com/v1');
    expect(nvidia.length).toBeGreaterThan(0);
    expect(nvidia.some((p) => p.model === 'meta/llama-3.1-8b-instruct')).toBe(true);
  });
});
