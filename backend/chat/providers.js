const { OpenAI } = require('openai');
const BaseProvider = require('../providers/BaseProvider');

function createProviderRuntime({ providerCooldownMs }) {
  const runtime = new Map();

  function canUseProviderNow(providerId) {
    const state = runtime.get(providerId);
    if (!state) return true;
    return !state.cooldownUntil || state.cooldownUntil < Date.now();
  }

  function markProviderFailure(providerId) {
    const prev = runtime.get(providerId) || { fails: 0, cooldownUntil: 0 };
    const fails = prev.fails + 1;
    runtime.set(providerId, {
      fails,
      cooldownUntil: Date.now() + Math.min(providerCooldownMs * fails, 60000)
    });
  }

  function markProviderSuccess(providerId) {
    runtime.set(providerId, { fails: 0, cooldownUntil: 0 });
  }

  return {
    canUseProviderNow,
    markProviderFailure,
    markProviderSuccess
  };
}

function normalizeProviderBaseUrl(rawBaseUrl = '') {
  const value = String(rawBaseUrl || '').trim();
  if (!value) return value;
  // FreeModel.dev: ensure /v1 suffix for OpenAI-compatible calls
  if (/^https?:\/\/api\.freemodel\.dev\/?$/i.test(value)) {
    return 'https://api.freemodel.dev/v1';
  }
  // Also handle base domain without /api prefix
  if (/^https?:\/\/freemodel\.dev\/?$/i.test(value)) {
    return 'https://api.freemodel.dev/v1';
  }
  // Freebuff2API local proxy convenience
  if (/^https?:\/\/(?:localhost|127\.0\.0\.1):8080\/?$/i.test(value)) {
    return `${value.replace(/\/$/, '')}/v1`;
  }
  return value;
}

function detectWireApi(baseUrl = '') {
  const value = String(baseUrl || '').trim().toLowerCase();
  // Official OpenAI supports Responses API
  if (
    value.includes('api.openai.com') ||
    value.includes('api.openai.azure.com')
  ) {
    return 'responses';
  }
  // FreeModel.dev supports Responses API (Codex-compatible)
  if (value.includes('freemodel.dev')) {
    return 'responses';
  }
  return 'chat_completions';
}

function isResponsesSchemaMismatchError(error) {
  const status = String(error?.status || error?.code || '');
  const message = String(error?.message || '').toLowerCase();
  if (status !== '400') return false;
  return (
    message.includes("invalid value: 'input_text'") ||
    message.includes("supported values are: 'output_text' and 'refusal'") ||
    (message.includes('responses') && message.includes('input_text'))
  );
}

function buildOpenAIClient(provider) {
  return new OpenAI({
    baseURL: provider.baseURL,
    apiKey: provider.apiKey,
    defaultHeaders: {
      'HTTP-Referer': 'https://bahai-agent.app',
      'X-Title': 'bahAI Agent'
    }
  });
}

function buildProviderCandidates({
  frontendApiKey,
  frontendBaseUrl,
  frontendModel,
  autoIntent,
  productMode = 'desktop_code',
  executionMode = 'cloud',
  hasImageAttachment = false,
  webTaskType = 'general',
  env,
  parseProviderPoolFromEnv,
  looksLikeOllamaModel
}) {
  const list = [];

  const OLLAMA_BASE = env.OLLAMA_BASE_URL || 'http://localhost:11434/v1';
  const normalizedFrontendBaseUrl = normalizeProviderBaseUrl(frontendBaseUrl);
  const defaultLocalModel = env.DESKTOP_LOCAL_DEFAULT_MODEL || env.OLLAMA_DEFAULT_MODEL || 'gemma4:12b';
  const cloudOnly = productMode === 'web_chat' || executionMode === 'cloud';
  const localOnly = productMode === 'desktop_code' && executionMode === 'local';
  const omniRouteEnabled = String(env.OMNIROUTE_ENABLED || '').toLowerCase() === 'true';
  const omniRouteApiKey = env.OMNIROUTE_API_KEY || '';
  const omniRouteBase = normalizeProviderBaseUrl(env.OMNIROUTE_BASE_URL || '');
  const omniRouteModel = env.OMNIROUTE_MODEL || '';

  function buildCloudProvider({ id, apiKey, baseURL, model }) {
    if (!apiKey || !baseURL || !model) return null;
    return {
      id,
      apiKey,
      baseURL: normalizeProviderBaseUrl(baseURL),
      model,
      wireApi: detectWireApi(baseURL)
    };
  }

  function resolveWebAutoPlan() {
    const normalizedEnvBase = normalizeProviderBaseUrl(env.OPENAI_BASE_URL || 'https://openrouter.ai/api/v1');
    const defaultBase = omniRouteEnabled && omniRouteBase ? omniRouteBase : normalizedEnvBase;
    const defaultKey = (omniRouteEnabled && omniRouteApiKey) ? omniRouteApiKey : (frontendApiKey || env.OPENAI_API_KEY || '');
    const defaultModel = omniRouteModel || env.OPENAI_MODEL || env.AUTO_SMART_MODEL || env.AUTO_FAST_MODEL || 'gpt-5.5';
    const frontLooksLocal = /localhost|127\.0\.0\.1|11434|1234|8080/i.test(String(normalizedFrontendBaseUrl || ''));
    const requestedBase = normalizedFrontendBaseUrl && !frontLooksLocal ? normalizedFrontendBaseUrl : '';
    const effectiveBase = requestedBase || defaultBase;
    const effectiveKey = (requestedBase && frontendApiKey) ? frontendApiKey : defaultKey;
    const fastModel = env.WEB_CHAT_FAST_MODEL || env.AUTO_FAST_MODEL || defaultModel;
    const smartModel = env.WEB_CHAT_SMART_MODEL || env.AUTO_SMART_MODEL || fastModel;
    const visionModel = env.WEB_CHAT_VISION_MODEL || 'meta-llama/llama-3.2-11b-vision-instruct:free' || smartModel;
    const codeModel = env.WEB_CHAT_CODE_MODEL || smartModel;
    const primaryTask = hasImageAttachment ? 'vision' : webTaskType;
    const orderedModels = primaryTask === 'vision'
      ? [visionModel, smartModel, fastModel, codeModel]
      : primaryTask === 'code'
        ? [codeModel, smartModel, fastModel, visionModel]
        : autoIntent === 'smart'
          ? [smartModel, fastModel, codeModel, visionModel]
          : [fastModel, smartModel, codeModel, visionModel];

    return orderedModels
      .filter(Boolean)
      .map((model, index) => buildCloudProvider({
        id: index === 0
          ? (omniRouteEnabled && omniRouteBase ? `web_${primaryTask}_primary_omniroute` : `web_${primaryTask}_primary`)
          : `web_${primaryTask}_fallback_${index}`,
        apiKey: effectiveKey,
        baseURL: effectiveBase,
        model
      }))
      .filter(Boolean);
  }

  if (localOnly) {
    const chosenLocalModel = looksLikeOllamaModel(frontendModel) ? frontendModel : defaultLocalModel;
    list.push({
      id: 'desktop_local_primary',
      apiKey: 'ollama',
      baseURL: OLLAMA_BASE,
      model: chosenLocalModel,
      wireApi: 'chat_completions'
    });
  }

  if (!localOnly && frontendModel === 'auto') {
    if (productMode === 'web_chat') {
      list.push(...resolveWebAutoPlan());
    } else {
    const cloudKey = frontendApiKey || env.OPENAI_API_KEY || '';
    const normalizedEnvBase = normalizeProviderBaseUrl(env.OPENAI_BASE_URL || 'https://openrouter.ai/api/v1');
    const frontendLooksLocal = /localhost|127\.0\.0\.1|11434|1234|8080/i.test(String(normalizedFrontendBaseUrl || ''));
    const cloudBase = (cloudOnly && frontendLooksLocal)
      ? normalizedEnvBase
      : (normalizedFrontendBaseUrl || normalizedEnvBase);
    const fastLocal = env.AUTO_FAST_MODEL || 'qwen2.5-coder:7b';
    const smartCloud = env.AUTO_SMART_MODEL || 'anthropic/claude-sonnet-4.5';

    const localProvider = { id: 'auto_ollama_fast', apiKey: 'ollama', baseURL: OLLAMA_BASE, model: fastLocal };
    const cloudProvider = cloudKey ? { id: 'auto_cloud_smart', apiKey: cloudKey, baseURL: cloudBase, model: smartCloud, wireApi: detectWireApi(cloudBase) } : null;

    if (cloudOnly) {
      if (cloudProvider) list.push(cloudProvider);
    } else if (autoIntent === 'smart' && cloudProvider) {
      list.push(cloudProvider);
      list.push(localProvider);
    } else {
      list.push(localProvider);
      if (cloudProvider) list.push(cloudProvider);
    }
    }
  } else if (!localOnly && frontendModel && looksLikeOllamaModel(frontendModel) && !cloudOnly) {
    list.push({
      id: 'local_ollama_auto',
      apiKey: 'ollama',
      baseURL: OLLAMA_BASE,
      model: frontendModel,
      wireApi: 'chat_completions'
    });
  }

  if (!localOnly && frontendApiKey && frontendBaseUrl && frontendModel && frontendModel !== 'auto') {
    list.push({
      id: 'frontend',
      apiKey: frontendApiKey,
      baseURL: normalizedFrontendBaseUrl,
      model: frontendModel,
      wireApi: detectWireApi(normalizedFrontendBaseUrl)
    });
  }

  for (const provider of parseProviderPoolFromEnv()) {
    const looksLocalBase = /localhost|127\.0\.0\.1|11434|1234/i.test(String(provider.baseURL || ''));
    if (localOnly && looksLocalBase) {
      list.push(provider);
      continue;
    }
    if (cloudOnly && looksLocalBase) {
      continue;
    }
    if (!localOnly) {
      list.push(provider);
    }
  }

  const envApiKey = env.OPENAI_API_KEY || env.NVIDIA_API_KEY || '';
  const envBase = env.OPENAI_BASE_URL || 'https://openrouter.ai/api/v1';
  const envModel = env.OPENAI_MODEL || 'qwen/qwen3-coder:free';
  if (!localOnly && envApiKey && frontendModel !== 'auto') {
    list.push({
      id: env.OPENAI_API_KEY ? 'env_openai' : 'env_nvidia',
      apiKey: envApiKey,
      baseURL: envBase,
      model: envModel,
      wireApi: detectWireApi(envBase)
    });
  }

  const dedup = new Map();
  for (const provider of list) {
    const key = `${provider.apiKey}|${provider.baseURL}|${provider.model}`;
    if (!dedup.has(key)) dedup.set(key, provider);
  }

  return Array.from(dedup.values());
}

module.exports = {
  createProviderRuntime,
  normalizeProviderBaseUrl,
  detectWireApi,
  isResponsesSchemaMismatchError,
  buildOpenAIClient,
  buildProviderCandidates,
  BaseProvider // Exporting LibreChat abstraction for external use
};
