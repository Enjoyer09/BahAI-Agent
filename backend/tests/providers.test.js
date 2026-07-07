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
      productMode: 'web_chat',
      executionMode: 'cloud',
      env: {
        OPENAI_API_KEY: 'env-key',
        OPENAI_BASE_URL: 'https://api.freemodel.dev/v1',
        AUTO_SMART_MODEL: 'gpt-5.5',
        OLLAMA_BASE_URL: 'http://localhost:11434/v1'
      },
      parseProviderPoolFromEnv: () => [],
      looksLikeOllamaModel
    });

    expect(candidates.some((p) => /11434|localhost/i.test(String(p.baseURL)))).toBe(false);
    expect(candidates.some((p) => p.id === 'auto_cloud_smart')).toBe(true);
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
