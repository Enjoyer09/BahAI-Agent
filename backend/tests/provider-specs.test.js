import { describe, it, expect } from 'vitest';
import {
  NVIDIA_SPEC,
  WEB_SPEC,
  OMNIROUTE_SPEC,
  PROVIDER_SPECS,
  getProviderSpec,
  resolveTaskModels,
  buildProviderFromSpec,
  parseModelList,
  uniqueModels,
} from '../chat/providerSpecs.js';
import { buildProviderCandidates } from '../chat/providers.js';

function looksLikeOllamaModel(modelId) {
  return modelId.includes(':') && !modelId.includes('/');
}

describe('provider spec registry', () => {
  it('exposes all specs and lookups', () => {
    expect(getProviderSpec('nvidia')).toBe(NVIDIA_SPEC);
    expect(getProviderSpec('web')).toBe(WEB_SPEC);
    expect(getProviderSpec('omniroute')).toBe(OMNIROUTE_SPEC);
    expect(getProviderSpec('nope')).toBeNull();
    expect(Object.keys(PROVIDER_SPECS)).toEqual(['nvidia', 'omniroute', 'web']);
  });

  it('NVIDIA general model falls back to fast alias (old: GENERAL || FAST)', () => {
    const models = resolveTaskModels(NVIDIA_SPEC, {
      taskType: 'general',
      autoIntent: 'fast',
      env: { NVIDIA_FAST_MODEL: 'meta/llama-3.1-8b-instruct' },
    });
    expect(models[0]).toBe('meta/llama-3.1-8b-instruct');
  });

  it('NVIDIA prefers GENERAL over the fast alias when both configured', () => {
    const models = resolveTaskModels(NVIDIA_SPEC, {
      taskType: 'general',
      autoIntent: 'fast',
      env: {
        NVIDIA_FAST_MODEL: 'meta/llama-3.1-8b-instruct',
        NVIDIA_GENERAL_MODEL: 'meta/llama-3.3-70b-instruct',
      },
    });
    // old behaviour: general = GENERAL || FAST, smart = SMART || general,
    // code = CODE || smart → with GENERAL set everything dedupes to it.
    expect(models).toEqual(['meta/llama-3.3-70b-instruct']);
  });

  it('NVIDIA smart falls back to general then fast (old chain)', () => {
    const models = resolveTaskModels(NVIDIA_SPEC, {
      taskType: 'smart',
      autoIntent: 'smart',
      env: {
        NVIDIA_GENERAL_MODEL: 'meta/llama-3.3-70b-instruct',
        NVIDIA_FAST_MODEL: 'meta/llama-3.1-8b-instruct',
      },
    });
    expect(models[0]).toBe('meta/llama-3.3-70b-instruct');
  });

  it('NVIDIA vision uses env override first, then the Omni default', () => {
    const explicit = resolveTaskModels(NVIDIA_SPEC, {
      taskType: 'vision',
      autoIntent: 'smart',
      env: { NVIDIA_VISION_MODEL: 'meta/llama-3.2-11b-vision-instruct' },
    });
    expect(explicit[0]).toBe('meta/llama-3.2-11b-vision-instruct');

    const fallback = resolveTaskModels(NVIDIA_SPEC, {
      taskType: 'vision',
      autoIntent: 'smart',
      env: {},
    });
    expect(fallback[0]).toBe('nvidia/nemotron-3-nano-omni-30b-a3b-reasoning');
  });

  it('NVIDIA appends fallback list and dedupes', () => {
    const models = resolveTaskModels(NVIDIA_SPEC, {
      taskType: 'code',
      autoIntent: 'smart',
      env: {
        NVIDIA_CODE_MODEL: 'qwen/code-model',
        NVIDIA_SMART_MODEL: 'meta/smart-model',
        NVIDIA_GENERAL_MODEL: 'meta/fast-model',
        NVIDIA_FALLBACK_MODELS: 'meta/fast-model, extra/fallback',
      },
    });
    expect(models).toEqual(['qwen/code-model', 'meta/smart-model', 'meta/fast-model', 'extra/fallback']);
  });

  it('WEB spec general+fast collapses fast/smart/code and appends the vision default', () => {
    const models = resolveTaskModels(WEB_SPEC, {
      taskType: 'general',
      autoIntent: 'fast',
      env: { WEB_CHAT_FAST_MODEL: 'gpt-5.5-mini' },
      defaults: { fast: 'gpt-5.5-mini', smart: 'gpt-5.5-mini' },
    });
    expect(models[0]).toBe('gpt-5.5-mini');
    // smart/code both alias to fast; the vision default is appended (old behaviour)
    expect(models).toEqual(['gpt-5.5-mini', 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning']);
  });

  it('WEB spec general+smart uses the smart-first ordering (old intent branch)', () => {
    const models = resolveTaskModels(WEB_SPEC, {
      taskType: 'general',
      autoIntent: 'smart',
      env: {
        WEB_CHAT_FAST_MODEL: 'gpt-5.5-mini',
        WEB_CHAT_SMART_MODEL: 'gpt-5.5',
      },
      defaults: { fast: 'gpt-5.5-mini', smart: 'gpt-5.5-mini' },
    });
    expect(models[0]).toBe('gpt-5.5');
    expect(models[1]).toBe('gpt-5.5-mini');
  });

  it('WEB vision prepends the vision model first (old ordering)', () => {
    const models = resolveTaskModels(WEB_SPEC, {
      taskType: 'vision',
      autoIntent: 'smart',
      env: {
        WEB_CHAT_VISION_MODEL: 'gpt-5.5-vision',
        WEB_CHAT_SMART_MODEL: 'gpt-5.5',
        WEB_CHAT_FAST_MODEL: 'gpt-5.5-mini',
      },
    });
    expect(models[0]).toBe('gpt-5.5-vision');
    expect(models[1]).toBe('gpt-5.5');
  });

  it('buildProviderFromSpec produces a candidate with spec wireApi', () => {
    const candidate = buildProviderFromSpec(NVIDIA_SPEC, {
      model: 'm1',
      apiKey: 'k',
      baseURL: 'https://b/v1',
      id: 'nvidia_general_1',
    });
    expect(candidate).toMatchObject({
      id: 'nvidia_general_1',
      model: 'm1',
      apiKey: 'k',
      baseURL: 'https://b/v1',
      wireApi: 'chat_completions',
    });
  });

  it('parseModelList / uniqueModels helpers behave like before', () => {
    expect(parseModelList('a, b\nc')).toEqual(['a', 'b', 'c']);
    expect(parseModelList('["x","y"]')).toEqual(['x', 'y']);
    expect(uniqueModels(['a', 'A', 'b', 'a'])).toEqual(['a', 'b']);
  });
});

describe('providers.js integration with specs', () => {
  it('NVIDIA candidates are unchanged after the spec refactor', () => {
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
        NVIDIA_GENERAL_MODEL: 'meta/fast-model',
      },
      parseProviderPoolFromEnv: () => [],
      looksLikeOllamaModel,
    });

    expect(candidates.find((provider) => provider.id === 'nvidia_code_1')).toMatchObject({
      baseURL: 'https://integrate.api.nvidia.com/v1',
      apiKey: 'nvapi-test',
      model: 'qwen/code-model',
      wireApi: 'chat_completions',
    });
  });

  it('web auto plan still prefers the vision model for image requests', () => {
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
        WEB_CHAT_VISION_MODEL: 'gpt-5.5-vision',
      },
      parseProviderPoolFromEnv: () => [],
      looksLikeOllamaModel,
    });
    expect(candidates[0].model).toBe('gpt-5.5-vision');
  });

  it('web auto plan general intent uses fast model first', () => {
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
        WEB_CHAT_FAST_MODEL: 'gpt-5.5-mini',
        WEB_CHAT_SMART_MODEL: 'gpt-5.5',
      },
      parseProviderPoolFromEnv: () => [],
      looksLikeOllamaModel,
    });
    expect(candidates[0].model).toBe('gpt-5.5-mini');
  });
});
