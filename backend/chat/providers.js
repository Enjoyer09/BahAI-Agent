const { OpenAI } = require('openai');
const BaseProvider = require('../providers/BaseProvider');
const dns = require('dns/promises');
const net = require('net');
const { NVIDIA_SPEC, WEB_SPEC, resolveTaskModels, buildProviderFromSpec } = require('./providerSpecs');

function isPrivateAddress(address) {
  const normalized = String(address || '').toLowerCase();
  if (net.isIPv4(normalized)) {
    const parts = normalized.split('.').map(Number);
    return (
      parts[0] === 0
      || parts[0] === 10
      || parts[0] === 127
      || (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127)
      || (parts[0] === 169 && parts[1] === 254)
      || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
      || (parts[0] === 192 && parts[1] === 168)
      || (parts[0] === 198 && parts[1] >= 18 && parts[1] <= 19)
      || parts[0] >= 224
    );
  }
  if (net.isIPv6(normalized)) {
    if (normalized.startsWith('::ffff:')) {
      return isPrivateAddress(normalized.slice(7));
    }
    return (
      normalized === '::'
      || normalized === '::1'
      || normalized.startsWith('fc')
      || normalized.startsWith('fd')
      || normalized.startsWith('fe8')
      || normalized.startsWith('fe9')
      || normalized.startsWith('fea')
      || normalized.startsWith('feb')
    );
  }
  return false;
}

async function validateProviderBaseUrl(rawBaseUrl, { allowPrivate = false } = {}) {
  let parsed;
  try {
    parsed = new URL(String(rawBaseUrl || ''));
  } catch {
    throw new Error('Provider base URL etibarsızdır');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Provider base URL yalnız HTTP(S) ola bilər');
  }
  if (!allowPrivate && parsed.protocol !== 'https:') {
    throw new Error('Cloud provider üçün HTTPS tələb olunur');
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!allowPrivate && (hostname === 'localhost' || hostname.endsWith('.local') || isPrivateAddress(hostname))) {
    throw new Error('Private və ya lokal provider ünvanına giriş bloklandı');
  }
  if (!allowPrivate) {
    let addresses;
    try {
      addresses = await dns.lookup(hostname, { all: true, verbatim: true });
    } catch {
      throw new Error('Provider host adı həll edilə bilmədi');
    }
    if (addresses.some((item) => isPrivateAddress(item.address))) {
      throw new Error('Provider host private şəbəkəyə yönəlir');
    }
  }
  return parsed.toString().replace(/\/$/, '');
}

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

function parseModelList(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return [];
  if (raw.startsWith('[')) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.map((item) => String(item || '').trim()).filter(Boolean);
      }
    } catch {
      return [];
    }
  }
  return raw
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function uniqueModels(models = []) {
  const seen = new Set();
  const list = [];
  for (const model of models) {
    const normalized = String(model || '').trim();
    const key = normalized.toLowerCase();
    if (normalized && !seen.has(key)) {
      seen.add(key);
      list.push(normalized);
    }
  }
  return list;
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
  const configuredLocalModel = [
    env.DESKTOP_LOCAL_DEFAULT_MODEL,
    env.OLLAMA_DEFAULT_MODEL,
    env.AUTO_FAST_MODEL,
    env.OPENAI_MODEL
  ].find((model) => model && looksLikeOllamaModel(model));
  const defaultLocalModel = configuredLocalModel || 'gemma4:12b';
  const cloudOnly = productMode === 'web_chat' || executionMode === 'cloud';
  const localOnly = productMode === 'desktop_code' && executionMode === 'local';
  const omniRouteEnabled = String(env.OMNIROUTE_ENABLED || '').toLowerCase() === 'true';
  const omniRouteApiKey = env.OMNIROUTE_API_KEY || '';
  const omniRouteBase = normalizeProviderBaseUrl(env.OMNIROUTE_BASE_URL || '');
  const omniRouteModel = env.OMNIROUTE_MODEL || '';
  const omniRouteFallbackModels = uniqueModels([
    omniRouteModel || 'auto',
    ...parseModelList(env.OMNIROUTE_FALLBACK_MODELS || env.OMNIROUTE_MODELS || '')
  ]);
  const nvidiaApiKey = String(env.NVIDIA_API_KEY || '').trim();
  const nvidiaBaseUrl = normalizeProviderBaseUrl(env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1');
  const openRouterKey = env.OPENROUTER_API_KEY || (String(env.OPENAI_API_KEY || '').startsWith('sk-or-') ? env.OPENAI_API_KEY : '');
  const openRouterBase = normalizeProviderBaseUrl(env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1');
  const openRouterDefaultModel = hasImageAttachment ? 'google/gemini-2.0-flash-exp:free' : 'meta-llama/llama-3.3-70b-instruct:free';

  function buildOpenRouterFallbackCandidates(idPrefix = 'web_auto') {
    if (!openRouterKey) return [];
    const models = uniqueModels([
      ...parseModelList(env.OPENROUTER_FALLBACK_MODELS || ''),
      openRouterDefaultModel
    ]);
    return models
      .filter(Boolean)
      .map((model, index) => ({
        id: `${idPrefix}_openrouter_fallback_${index + 1}`,
        apiKey: openRouterKey,
        baseURL: openRouterBase,
        model,
        wireApi: 'chat_completions'
      }));
  }

  function buildNvidiaProviders(taskType = 'general') {
    if (!nvidiaApiKey) return [];
    // Spec-driven model resolution (providerSpecs.js) — identical output to the
    // previous hardcoded alias chains (general=GENERAL||FAST, smart=SMART||general,
    // code=CODE||smart, vision=env||default Omni NIM, fallback list appended).
    const models = resolveTaskModels(NVIDIA_SPEC, { taskType, autoIntent, env });
    return models.map((model, index) => buildProviderFromSpec(NVIDIA_SPEC, {
      id: `nvidia_${taskType}_${index + 1}`,
      apiKey: nvidiaApiKey,
      baseURL: nvidiaBaseUrl,
      model,
      wireApi: 'chat_completions'
    }));
  }

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
    const useOmniRoute = omniRouteEnabled && Boolean(omniRouteBase);
    const defaultBase = useOmniRoute ? omniRouteBase : normalizedEnvBase;
    const defaultKey = useOmniRoute
      ? (omniRouteApiKey || 'bahai-omniroute')
      : (frontendApiKey || env.OPENAI_API_KEY || '');
    const defaultModel = useOmniRoute
      ? (omniRouteFallbackModels[0] || 'auto')
      : (env.OPENAI_MODEL || env.AUTO_SMART_MODEL || env.AUTO_FAST_MODEL || 'gpt-5.5');
    const frontLooksLocal = /localhost|127\.0\.0\.1|11434|1234|8080/i.test(String(normalizedFrontendBaseUrl || ''));
    // In web mode Railway owns routing. Browser-local or stale provider
    // settings must never bypass an explicitly enabled OmniRoute gateway.
    const requestedBase = !useOmniRoute && normalizedFrontendBaseUrl && !frontLooksLocal
      ? normalizedFrontendBaseUrl
      : '';
    const effectiveBase = requestedBase || defaultBase;
    const effectiveKey = (requestedBase && frontendApiKey) ? frontendApiKey : defaultKey;
    const isBaseLocal = !useOmniRoute && /localhost|127\.0\.0\.1|11434|1234|8080/i.test(effectiveBase);

    if (isBaseLocal) {
      const chosenLocalModel = looksLikeOllamaModel(frontendModel) ? frontendModel : (env.AUTO_FAST_MODEL || env.OPENAI_MODEL || defaultLocalModel);
      return [{
        id: 'web_auto_local_primary',
        apiKey: effectiveKey || 'ollama',
        baseURL: effectiveBase,
        model: chosenLocalModel,
        wireApi: 'chat_completions'
      }];
    }

    const primaryTask = hasImageAttachment ? 'vision' : webTaskType;
    // The web vision model must stay in the candidate list even when the
    // OmniRoute gateway owns routing. A vision request sent as 'auto' can be
    // resolved by the gateway to a text-only model, which then hallucinates a
    // description from OCR hints and prompt fragments (observed: model echoing
    // the injected image rules instead of describing pixels). Only prepend an
    // explicit WEB_CHAT_VISION_MODEL though: the NVIDIA default id belongs to
    // the NVIDIA endpoint, not the gateway, so it must not be forced onto the
    // OmniRoute base URL (that would guarantee a failed first attempt).
    const webVisionModel = env.WEB_CHAT_VISION_MODEL || '';
    const orderedModels = useOmniRoute
      ? (primaryTask === 'vision' && webVisionModel
          ? uniqueModels([webVisionModel, ...omniRouteFallbackModels])
          : omniRouteFallbackModels)
      : resolveTaskModels(WEB_SPEC, {
        taskType: primaryTask,
        autoIntent,
        env,
        // Mirror the old chain smart = SMART || AUTO_SMART || fastModel, where
        // fastModel = FAST || AUTO_FAST || defaultModel was computed first.
        defaults: {
          fast: env.WEB_CHAT_FAST_MODEL || env.AUTO_FAST_MODEL || defaultModel,
          // Smart/conversational tier must prefer a GENERAL model, not the coder.
          // Previously this fell back to AUTO_FAST_MODEL (qwen2.5-coder), which
          // degraded open conversation. Prefer AUTO_SMART_MODEL explicitly.
          smart: env.WEB_CHAT_SMART_MODEL || env.AUTO_SMART_MODEL || env.WEB_CHAT_FAST_MODEL || env.AUTO_FAST_MODEL || defaultModel,
        },
      });

    const cloudCandidates = orderedModels
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

    const candidates = [];
    const seenKeys = new Set();
    const nvidiaCandidates = buildNvidiaProviders(primaryTask);
    const openRouterCandidates = buildOpenRouterFallbackCandidates('web_auto');

    let orderedCandidates;
    if (primaryTask === 'vision') {
      const [primaryCloud, ...restCloud] = cloudCandidates;
      orderedCandidates = webVisionModel
        ? [primaryCloud, ...nvidiaCandidates, ...openRouterCandidates, ...restCloud]
        : [...nvidiaCandidates, ...openRouterCandidates, ...cloudCandidates];
    } else {
      orderedCandidates = [...cloudCandidates, ...nvidiaCandidates, ...openRouterCandidates];
    }
    orderedCandidates = orderedCandidates.filter(Boolean);

    for (const cand of orderedCandidates) {
      const key = `${cand.baseURL}|${cand.model}`;
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        candidates.push(cand);
      }
    }

    // Cloud Fallback: OpenRouter Free Models (only if valid key is configured).
    // For vision tasks these are already positioned above (ahead of any blind
    // gateway 'auto'); for non-vision tasks append them here to keep the
    // original assembly path unchanged.
    if (primaryTask !== 'vision') {
      for (const cand of openRouterCandidates) {
        const key = `${cand.baseURL}|${cand.model}`;
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          candidates.push(cand);
        }
      }
    }

    // Local Fallback: Always include Ollama in local mode or when local execution is allowed
    const isLocalEnv = String(env.LOCAL_MODE || '').toLowerCase() === 'true';
    if (isLocalEnv || !cloudOnly) {
      candidates.push({
        id: 'web_auto_ollama_fallback',
        apiKey: 'ollama',
        baseURL: OLLAMA_BASE,
        model: defaultLocalModel,
        wireApi: 'chat_completions'
      });
    }

    return candidates;
  }

  if (localOnly) {
    // Even in local mode, if OmniRoute is configured, prepend it as primary
    // so the user gets cloud quality when online, with local as fallback
    const useOmniRouteEvenInLocal = omniRouteEnabled && Boolean(omniRouteBase) && omniRouteApiKey;
    if (useOmniRouteEvenInLocal) {
      const omniModels = omniRouteFallbackModels.length > 0 ? omniRouteFallbackModels : ['auto'];
      for (let i = 0; i < omniModels.length; i++) {
        list.push({
          id: i === 0 ? 'local_omniroute_primary' : `local_omniroute_fb_${i}`,
          apiKey: omniRouteApiKey,
          baseURL: omniRouteBase,
          model: omniModels[i],
          wireApi: detectWireApi(omniRouteBase),
        });
      }
    }
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
      // Desktop smart mode: use OmniRoute if enabled (same as web), then NVIDIA, then local
      const useOmniRouteForDesktop = omniRouteEnabled && Boolean(omniRouteBase) && omniRouteApiKey;

      if (useOmniRouteForDesktop) {
        // OmniRoute primary (same cloud gateway as web)
        const omniModels = omniRouteFallbackModels.length > 0 ? omniRouteFallbackModels : ['auto'];
        for (let i = 0; i < omniModels.length; i++) {
          list.push({
            id: i === 0 ? 'desktop_smart_omniroute' : `desktop_smart_omniroute_fb_${i}`,
            apiKey: omniRouteApiKey,
            baseURL: omniRouteBase,
            model: omniModels[i],
            wireApi: detectWireApi(omniRouteBase),
          });
        }
      }

      const cloudKey = frontendApiKey || env.OPENAI_API_KEY || '';
      const normalizedEnvBase = normalizeProviderBaseUrl(env.OPENAI_BASE_URL || 'https://openrouter.ai/api/v1');
      const frontendLooksLocal = /localhost|127\.0\.0\.1|11434|1234|8080/i.test(String(normalizedFrontendBaseUrl || ''));
      const cloudBase = (cloudOnly && frontendLooksLocal)
        ? normalizedEnvBase
        : (normalizedFrontendBaseUrl || normalizedEnvBase);
      const fastLocal = env.AUTO_FAST_MODEL || 'qwen2.5-coder:7b';
      const smartCloud = env.AUTO_SMART_MODEL || 'anthropic/claude-sonnet-4.5';

      const localProvider = { id: 'auto_ollama_fast', apiKey: 'ollama', baseURL: OLLAMA_BASE, model: fastLocal };
      // Only create cloudProvider if it's NOT pointing to Ollama (avoid sending cloud model names to local Ollama)
      const cloudBaseIsLocal = /localhost|127\.0\.0\.1|11434|1234|8080/i.test(cloudBase);
      const cloudProvider = (cloudKey && !cloudBaseIsLocal) ? { id: 'auto_cloud_smart', apiKey: cloudKey, baseURL: cloudBase, model: smartCloud, wireApi: detectWireApi(cloudBase) } : null;

      if (cloudOnly) {
        if (cloudProvider) list.push(cloudProvider);
        list.push(...buildNvidiaProviders('code'));
        list.push(...buildOpenRouterFallbackCandidates('auto'));
      } else if (autoIntent === 'smart' && cloudProvider) {
        list.push(cloudProvider);
        list.push(...buildNvidiaProviders('code'));
        list.push(...buildOpenRouterFallbackCandidates('auto'));
        list.push(localProvider);
      } else {
        // No valid cloud provider — go local first, then NVIDIA/OpenRouter as fallback
        list.push(localProvider);
        if (cloudProvider) list.push(cloudProvider);
        list.push(...buildNvidiaProviders('code'));
        list.push(...buildOpenRouterFallbackCandidates('auto'));
      }
    }
  }

  if (!localOnly && frontendModel && frontendModel !== 'auto') {
    const cloudKey = frontendApiKey || (env.OPENAI_API_KEY !== 'ollama' ? env.OPENAI_API_KEY : '');
    const cloudBase = normalizeProviderBaseUrl(frontendBaseUrl || (env.OPENAI_BASE_URL !== OLLAMA_BASE ? env.OPENAI_BASE_URL : 'https://openrouter.ai/api/v1'));
    
    if (looksLikeOllamaModel(frontendModel) && !cloudOnly) {
      list.push({
        id: 'local_ollama_auto',
        apiKey: 'ollama',
        baseURL: OLLAMA_BASE,
        model: frontendModel,
        wireApi: 'chat_completions'
      });
    } else if (frontendApiKey && normalizedFrontendBaseUrl) {
      list.push({
        id: 'frontend',
        apiKey: frontendApiKey,
        baseURL: normalizedFrontendBaseUrl,
        model: frontendModel,
        wireApi: detectWireApi(normalizedFrontendBaseUrl)
      });
    } else if (cloudKey) {
      list.push({
        id: 'env_cloud_explicit',
        apiKey: cloudKey,
        baseURL: cloudBase,
        model: frontendModel,
        wireApi: detectWireApi(cloudBase)
      });
    }
  }

  const getProviderPool = typeof parseProviderPoolFromEnv === 'function' ? parseProviderPoolFromEnv : (() => []);
  for (const provider of getProviderPool()) {
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

  // Append local Ollama fallback as last resort if not in pure cloud-restricted mode
  if (!localOnly && !cloudOnly) {
    list.push({
      id: 'local_ollama_last_resort',
      apiKey: 'ollama',
      baseURL: OLLAMA_BASE,
      model: defaultLocalModel,
      wireApi: 'chat_completions'
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
  validateProviderBaseUrl,
  BaseProvider // Exporting LibreChat abstraction for external use
};
