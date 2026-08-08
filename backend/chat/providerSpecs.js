/**
 * bahAI - Provider Spec Registry
 * LibreChat-style declarative specs for each provider: which env vars hold the
 * base URL / API key / per-task models, wire API, vision capability and model
 * ordering. providers.js consumes these specs so adding a provider becomes a
 * one-line spec entry instead of a new branch.
 *
 * Model resolution is slot-based: each spec declares an `ordering` per task
 * (e.g. vision: ['vision','smart','general']) and each slot resolves via
 *  1. its direct env key (modelEnv)
 *  2. a hard-coded default (modelDefault)
 *  3. an env alias list (modelAliasEnv)
 *  4. a previously resolved slot (slotFallback)   <- mirrors the old
 *     `const smartModel = env.SMART || generalModel` chains
 *  5. an externally supplied default (defaults)
 * and finally appends the spec's fallback model env list.
 */

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

function getEnv(env, key) {
  return env ? env[key] : undefined;
}

function pickFirst(env, keys = []) {
  for (const key of keys) {
    const value = getEnv(env, key);
    if (value) return value;
  }
  return '';
}

/**
 * NVIDIA NIM provider spec.
 */
const NVIDIA_SPEC = {
  id: 'nvidia',
  name: 'NVIDIA NIM',
  baseUrlEnv: 'NVIDIA_BASE_URL',
  defaultBaseUrl: 'https://integrate.api.nvidia.com/v1',
  apiKeyEnv: 'NVIDIA_API_KEY',
  wireApi: 'chat_completions',
  vision: true,
  nimAdaptor: true, // runner.js applies the NIM <img> tag adaptation
  modelEnv: {
    vision: 'NVIDIA_VISION_MODEL',
    smart: 'NVIDIA_SMART_MODEL',
    general: 'NVIDIA_GENERAL_MODEL',
    code: 'NVIDIA_CODE_MODEL',
    fast: 'NVIDIA_FAST_MODEL',
  },
  modelDefault: {
    vision: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning',
    // Drop-in defaults: with ONLY NVIDIA_API_KEY set, NVIDIA still serves as a
    // cross-provider failover for text chat (no per-slot env vars required).
    // Small, free NIM instruct model — override with NVIDIA_GENERAL_MODEL etc.
    general: 'meta/llama-3.1-8b-instruct',
    smart: 'meta/llama-3.1-8b-instruct',
  },
  modelAliasEnv: {
    general: ['NVIDIA_FAST_MODEL'], // old: general = GENERAL || FAST
  },
  slotFallback: {
    smart: ['general'], // old: smart = SMART || general
    code: ['smart', 'general'], // old: code = CODE || smart || general
  },
  fallbackModelEnv: ['NVIDIA_FALLBACK_MODELS', 'NVIDIA_MODELS'],
  ordering: {
    vision: ['vision', 'smart', 'general'],
    code: ['code', 'smart', 'general'],
    smart: ['smart', 'general', 'code'],
    fast: ['general', 'smart', 'code'],
  },
};

/**
 * OmniRoute gateway spec (Railway web routing layer).
 */
const OMNIROUTE_SPEC = {
  id: 'omniroute',
  name: 'OmniRoute Gateway',
  enabledEnv: 'OMNIROUTE_ENABLED',
  baseUrlEnv: 'OMNIROUTE_BASE_URL',
  apiKeyEnv: 'OMNIROUTE_API_KEY',
  modelEnv: 'OMNIROUTE_MODEL',
  fallbackModelEnv: ['OMNIROUTE_FALLBACK_MODELS', 'OMNIROUTE_MODELS'],
  wireApi: 'chat_completions',
  primaryIdPrefix: 'omniroute',
};

/**
 * Web chat auto-routing spec (Web product only).
 */
const WEB_SPEC = {
  id: 'web',
  name: 'Web Chat Auto',
  modelEnv: {
    vision: 'WEB_CHAT_VISION_MODEL',
    smart: 'WEB_CHAT_SMART_MODEL',
    fast: 'WEB_CHAT_FAST_MODEL',
    code: 'WEB_CHAT_CODE_MODEL',
  },
  modelAliasEnv: {
    smart: ['AUTO_SMART_MODEL'],
    fast: ['AUTO_FAST_MODEL'],
  },
  modelDefault: {
    vision: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning',
  },
  slotFallback: {
    smart: ['fast'], // old: smart = SMART || AUTO_SMART || fast
    code: ['smart'], // old: code = CODE || smart
  },
  ordering: {
    vision: ['vision', 'smart', 'fast', 'code'],
    code: ['code', 'smart', 'fast', 'vision'],
    smart: ['smart', 'fast', 'code', 'vision'],
    fast: ['fast', 'smart', 'code', 'vision'],
  },
};

const PROVIDER_SPECS = {
  nvidia: NVIDIA_SPEC,
  omniroute: OMNIROUTE_SPEC,
  web: WEB_SPEC,
};

function getProviderSpec(id) {
  return PROVIDER_SPECS[id] || null;
}

function getAllProviderSpecs() {
  return Object.values(PROVIDER_SPECS);
}

/**
 * Resolves the ordered, deduplicated model list for a task using a spec.
 * Behaviour matches the previous hardcoded logic in providers.js exactly
 * (including alias chains and fallback lists).
 */
function resolveTaskModels(spec, { taskType = 'general', autoIntent = 'fast', env = {}, defaults = {} } = {}) {
  if (!spec) return [];
  // 'general' has no explicit ordering: pick smart vs fast ordering by intent,
  // exactly like the old providers.js branch (smart -> smart-first, else fast-first).
  let orderKey = taskType;
  if (!spec.ordering?.[orderKey]) {
    orderKey = taskType === 'general'
      ? (autoIntent === 'smart' ? 'smart' : 'fast')
      : 'fast';
  }
  const keys = spec.ordering?.[orderKey] || spec.ordering?.fast || [];
  const resolved = [];
  const bySlot = {};

  for (const slot of keys) {
    let value = '';

    // 1. direct env key
    const envKey = spec.modelEnv?.[slot];
    if (envKey) value = getEnv(env, envKey);

    // 2. hard-coded default
    if (!value && spec.modelDefault?.[slot]) value = spec.modelDefault[slot];

    // 3. env alias list
    if (!value && spec.modelAliasEnv?.[slot]) value = pickFirst(env, spec.modelAliasEnv[slot]);

    // 4. previously resolved slot (old `x = ENV || y` chains)
    if (!value && spec.slotFallback?.[slot]) {
      for (const fb of spec.slotFallback[slot]) {
        if (bySlot[fb]) { value = bySlot[fb]; break; }
      }
    }

    // 5. externally supplied default (e.g. gateway defaultModel)
    if (!value && defaults[slot]) value = defaults[slot];

    if (value) {
      bySlot[slot] = value;
      resolved.push(value);
    }
  }

  // fallback model env list appended last (old: ...parseModelList(FALLBACK||MODELS))
  resolved.push(...parseModelList(pickFirst(env, spec.fallbackModelEnv || [])));
  return uniqueModels(resolved);
}

/**
 * Builds a provider candidate object from a spec + explicit model + credentials.
 */
function buildProviderFromSpec(spec, { model, apiKey, baseURL, wireApi, id }) {
  return {
    id,
    apiKey,
    baseURL,
    model,
    wireApi: wireApi || spec.wireApi || 'chat_completions',
  };
}

module.exports = {
  NVIDIA_SPEC,
  OMNIROUTE_SPEC,
  WEB_SPEC,
  PROVIDER_SPECS,
  getProviderSpec,
  getAllProviderSpecs,
  resolveTaskModels,
  buildProviderFromSpec,
  parseModelList,
  uniqueModels,
};
