function isRetryableProviderError(error, isResponsesSchemaMismatchError) {
  const status = error?.status || error?.code;
  const msg = String(error?.message || '').toLowerCase();
  if (error?.name === 'AbortError') return true;
  if (status === 401 || status === 402) return true;
  if (status === 408 || status === 409 || status === 425 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504) return true;
  if (status === 400 || String(status) === '400') {
    if (msg.includes('upstream') || msg.includes('provider') || msg.includes('temporarily') || msg.includes('failed') || msg.includes('error') || msg.includes('content-blocked')) return true;
  }
  if (isResponsesSchemaMismatchError(error)) return true;
  if (msg.includes('usage limit') || msg.includes('quota') || msg.includes('insufficient credits') || msg.includes('credit balance')) return true;
  if (!status && (msg.includes('network') || msg.includes('timeout') || msg.includes('fetch failed') || msg.includes('econnrefused') || msg.includes('econnreset'))) return true;
  return false;
}

function normalizeProviderStreamError(error) {
  const message = String(error?.message || error || '');
  const lower = message.toLowerCase();
  if (
    lower.includes('could not parse message into json') ||
    lower.includes('event: error') ||
    lower.includes('unspecified error')
  ) {
    return Object.assign(new Error('Provider stream error'), {
      status: error?.status || 502,
      code: error?.code || 'PROVIDER_STREAM_ERROR',
      cause: error
    });
  }
  return error;
}

function isGenericFailoverCandidate(providerCandidates = []) {
  return Array.isArray(providerCandidates) && providerCandidates.length > 1;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Whether a provider error is worth a single local retry (vs. failing over to the
// next candidate). Covers transient upstream blips only: 408/429/5xx and network
// errors. Deliberately EXCLUDES AbortError (request/attempt deadline) and
// deterministic 4xx — those are not fixed by retrying the same call.
const TRANSIENT_RETRY_STATUS = new Set([408, 429, 500, 502, 503, 504]);
function isTransientForRetry(err) {
  if (!err) return false;
  if (err.name === 'AbortError') return false;
  const status = err.status || err.code;
  if (TRANSIENT_RETRY_STATUS.has(status)) return true;
  if (!status) {
    const msg = String(err.message || '').toLowerCase();
    if (msg.includes('network') || msg.includes('timeout') || msg.includes('fetch failed') || msg.includes('econnrefused') || msg.includes('econnreset')) {
      return true;
    }
  }
  return false;
}

function modelDisablesTools(model = '') {
  return /(?:^|[\/_-])(embed|embedding|rerank|retriever|reward|guard|safety|moderation|parse)(?:$|[\/_-])/i.test(String(model || ''));
}

function isVisionModel(model = '') {
  return /(?:vision|multimodal|omni|(?:^|[\/_-])vl(?:$|[\/_-]))/i.test(String(model || ''));
}

function adaptMessagesForProvider(messages = [], provider = {}, model = '') {
  const isLegacyNvidiaVision = /integrate\.api\.nvidia\.com/i.test(String(provider.baseURL || ''))
    && /llama-3\.2-11b-vision/i.test(String(model || ''));
  if (!isLegacyNvidiaVision) return messages;

  return messages.map((message) => {
    if (message?.role !== 'user' || !Array.isArray(message.content)) return message;
    const images = message.content
      .filter((part) => part?.type === 'image_url' && part.image_url?.url)
      .map((part) => `<img src="${part.image_url.url}" />`);
    const textParts = message.content
      .filter((part) => part?.type === 'text')
      .map((part) => String(part.text || ''))
      .filter(Boolean);
    return { ...message, content: [...images, ...textParts].join('\n\n') };
  });
}

async function primeProviderStream(stream) {
  if (!stream || typeof stream[Symbol.asyncIterator] !== 'function') {
    throw Object.assign(new Error('Provider etibarlı stream qaytarmadı'), { status: 503 });
  }

  const iterator = stream[Symbol.asyncIterator]();
  const first = await iterator.next();
  if (first.done) {
    throw Object.assign(new Error('Provider boş stream qaytardı'), { status: 503 });
  }

  const primedStream = {
    response: stream.response,
    async *[Symbol.asyncIterator]() {
      yield first.value;
      while (true) {
        const next = await iterator.next();
        if (next.done) return;
        yield next.value;
      }
    }
  };
  return primedStream;
}

async function openAiStreamWithFallback({
  currentMessages,
  effectiveModel,
  activeProvider,
  client,
  phaseTools,
  isLocalOrFlakyModel,
  providerCandidates,
  providerRuntime,
  buildOpenAIClient,
  normalizeMessagesForModel,
  mapMessagesToResponsesInput,
  mapToolsToResponsesTools,
  isResponsesSchemaMismatchError,
  buildDeepSeekRecoveryMessages,
  writeSse,
  shouldEmitDebugEvent,
  llmTimeoutMs,
  visionTimeoutMs = 30000,
  firstTokenTimeoutMs = 0,
  isVisionRequest = false,
  onProviderTelemetry,
  providerSessionKey,
  forceDisableTools = false,
  requestDeadlineAt = Number.POSITIVE_INFINITY
}) {
  let stream;
  let nextProvider = activeProvider;
  let nextClient = client;
  let nextModel = effectiveModel;
  let nextMessages = currentMessages;
  let deepSeekRecoveryUsed = false;
  let providerNoToolsFallbackUsed = false;
  let lastAttemptTimeoutMs = llmTimeoutMs;

  async function createStream(provider, providerClient, model, messages, disableTools = false) {
    const normalizedMessages = await normalizeMessagesForModel(messages, model);
    const apiInputMessages = adaptMessagesForProvider(normalizedMessages, provider, model);
    const shouldDisableTools = disableTools || provider.disableTools === true || modelDisablesTools(model) || isVisionModel(model);
    const isLocalProvider = /localhost|127\.0\.0\.1|11434|ollama/i.test(String(provider.baseURL || ''));
    const remainingRequestMs = requestDeadlineAt - Date.now();
    if (remainingRequestMs <= 0) {
      throw Object.assign(new Error('Request deadline exceeded'), { name: 'AbortError' });
    }
    // Vision requests (image attachments or vision-flavored models) get their
    // own, longer attempt budget. The old hard 5s OmniRoute cap made healthy
    // providers — and any image ingestion — time out on simple text questions.
    const requestIsVision = Boolean(isVisionRequest) || isVisionModel(model);
    const attemptBudget = requestIsVision ? Math.max(llmTimeoutMs, visionTimeoutMs) : llmTimeoutMs;
    const isOmniRouteProvider = /omniroute/i.test(String(provider.id || ''));
    const providerTimeoutMs = isLocalProvider
      ? Math.max(attemptBudget, 90000)
      : isOmniRouteProvider
        // Keep OmniRoute attempts short enough to fail over quickly, but never
        // so short that a healthy provider misses the deadline.
        ? (requestIsVision ? Math.min(attemptBudget, 45000) : Math.min(attemptBudget, 15000))
        : attemptBudget;
    lastAttemptTimeoutMs = Math.max(1, Math.min(providerTimeoutMs, remainingRequestMs));
    const attemptController = new AbortController();
    const attemptTimer = setTimeout(() => attemptController.abort(), lastAttemptTimeoutMs);
    // Separate, shorter time-to-first-token (TTFT) cap: a provider that never
    // emits its first chunk (queued upstream, cold gateway, hung model) burns
    // the whole attempt budget in silence before the user sees a single word.
    // Cap TTFT so a slow start fails over to the next candidate fast. Only when
    // a fallback exists — a lone provider would just turn a slow answer into an
    // error. Local providers are excluded: local LLMs legitimately warm up slowly.
    const hasFallbackProvider = Array.isArray(providerCandidates) && providerCandidates.length > 1;
    const ttftBudget = (firstTokenTimeoutMs > 0 && hasFallbackProvider && !isLocalProvider)
      ? Math.max(1, Math.min(firstTokenTimeoutMs, lastAttemptTimeoutMs))
      : 0;
    let firstTokenTimer = null;
    if (ttftBudget > 0) {
      firstTokenTimer = setTimeout(() => attemptController.abort(), ttftBudget);
    }
    try {
      let rawStream;
      if (provider.wireApi === 'responses') {
        rawStream = await providerClient.responses.create({
          model,
          input: mapMessagesToResponsesInput(apiInputMessages),
          tools: shouldDisableTools ? undefined : mapToolsToResponsesTools(phaseTools),
          stream: true,
          parallel_tool_calls: false
        }, { signal: attemptController.signal });
      } else {
        const visionOptions = /nemotron-3-nano-omni/i.test(String(model || ''))
          ? {
              max_tokens: 1024,
              chat_template_kwargs: { enable_thinking: false }
            }
          : {};
        rawStream = await providerClient.chat.completions.create({
          model,
          messages: apiInputMessages,
          tools: shouldDisableTools ? undefined : phaseTools,
          temperature: 0.2,
          stream: true,
          ...visionOptions
        }, { signal: attemptController.signal });
      }
      return await primeProviderStream(rawStream);
    } finally {
      clearTimeout(attemptTimer);
      if (firstTokenTimer) clearTimeout(firstTokenTimer);
    }
  }

  // Retry a single candidate once on transient errors before failing over. This
  // absorbs short gateway blips (e.g. a transient 5xx from OmniRoute) that would
  // otherwise burn the whole candidate pool and surface the generic failure.
  async function callCreateStream(provider, client, model, messages, forceDisableTools, deadlineAt) {
    const MAX_ATTEMPTS = 2;
    let lastErr;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        return await createStream(provider, client, model, messages, forceDisableTools);
      } catch (err) {
        lastErr = err;
        const remaining = (deadlineAt || Number.POSITIVE_INFINITY) - Date.now();
        if (attempt >= MAX_ATTEMPTS || !isTransientForRetry(err) || remaining < 800) throw err;
        await sleep(350);
      }
    }
    throw lastErr;
  }

  while (true) {
    try {
        if (providerCandidates.length > 1 && !providerRuntime.canUseProviderNow(nextProvider.id)) {
          const warmAlternative = providerCandidates.find((candidate) => (
            candidate.id !== nextProvider.id && providerRuntime.canUseProviderNow(candidate.id)
          ));
          if (warmAlternative) {
            onProviderTelemetry?.({
              event: 'provider_skip_cooldown',
              fromProviderId: nextProvider.id,
              toProviderId: warmAlternative.id,
              toModel: warmAlternative.model,
              toBaseURL: warmAlternative.baseURL
            });
            nextProvider = warmAlternative;
            nextClient = buildOpenAIClient(warmAlternative);
            nextModel = warmAlternative.model;
          }
        }

        stream = await callCreateStream(
          nextProvider,
          nextClient,
          nextModel,
          nextMessages,
          forceDisableTools,
          requestDeadlineAt
        );
        providerRuntime.markProviderSuccess(nextProvider.id);
        providerRuntime.markSessionProviderSuccess?.(providerSessionKey, nextProvider.id);
        onProviderTelemetry?.({
          event: 'provider_stream_start',
          providerId: nextProvider.id,
          model: nextModel,
          baseURL: nextProvider.baseURL,
          wireApi: nextProvider.wireApi
        });

        return {
          stream,
          activeProvider: nextProvider,
          client: nextClient,
          effectiveModel: nextModel,
          currentMessages: nextMessages
        };
      } catch (apiErr) {
        let currentErr = normalizeProviderStreamError(apiErr);
        const isRetryable = isRetryableProviderError(currentErr, isResponsesSchemaMismatchError)
          // A 400 on an image-bearing request usually means the current model
          // does not support images — fail over to a vision-capable candidate.
          || (String(currentErr?.status || currentErr?.code || '') === '400' && (isVisionModel(nextModel) || isVisionRequest));

        if (isRetryable && providerCandidates.length > 1) {
          providerRuntime.markProviderFailure(nextProvider.id, currentErr);
          providerRuntime.markSessionProviderFailure?.(providerSessionKey, nextProvider.id);
          onProviderTelemetry?.({
            event: 'provider_failure',
            providerId: nextProvider.id,
            model: nextModel,
            baseURL: nextProvider.baseURL,
            status: currentErr?.status || currentErr?.code || null,
            message: String(currentErr?.message || '').slice(0, 240)
          });
          const allAlternatives = providerCandidates.filter((provider) => provider.id !== nextProvider.id);
          const warmAlternatives = allAlternatives.filter((provider) => providerRuntime.canUseProviderNow(provider.id));
          const alternatives = warmAlternatives.length > 0 ? warmAlternatives : allAlternatives;
          for (const alt of alternatives) {
            try {
              const altClient = buildOpenAIClient(alt);
              stream = await callCreateStream(alt, altClient, alt.model, nextMessages, forceDisableTools, requestDeadlineAt);
              const previousProviderId = nextProvider.id;
              nextProvider = alt;
              nextClient = altClient;
              nextModel = alt.model;
              providerRuntime.markProviderSuccess(alt.id);
              providerRuntime.markSessionProviderSuccess?.(providerSessionKey, alt.id);
              onProviderTelemetry?.({
                event: 'provider_failover',
                fromProviderId: activeProvider?.id || null,
                previousProviderId,
                providerId: alt.id,
                model: alt.model,
                baseURL: alt.baseURL,
                wireApi: alt.wireApi
              });
              console.log(`🔁 Provider failover: switched to ${alt.id}`);
              return {
                stream,
                activeProvider: nextProvider,
                client: nextClient,
                effectiveModel: nextModel,
                currentMessages: nextMessages
              };
            } catch (altErr) {
              currentErr = altErr;
              providerRuntime.markProviderFailure(alt.id, altErr);
              providerRuntime.markSessionProviderFailure?.(providerSessionKey, alt.id);
              onProviderTelemetry?.({
                event: 'provider_failure',
                providerId: alt.id,
                model: alt.model,
                baseURL: alt.baseURL,
                status: altErr?.status || altErr?.code || null,
                message: String(altErr?.message || '').slice(0, 240)
              });
            }
          }
          if (!stream && isResponsesSchemaMismatchError(currentErr) && nextProvider.wireApi === 'responses') {
            try {
              const downgradedProvider = { ...nextProvider, wireApi: 'chat_completions' };
              const downgradedClient = buildOpenAIClient(downgradedProvider);
              stream = await createStream(downgradedProvider, downgradedClient, nextModel, nextMessages, forceDisableTools);
              nextProvider = downgradedProvider;
              nextClient = downgradedClient;
              providerRuntime.markProviderSuccess(downgradedProvider.id);
              providerRuntime.markSessionProviderSuccess?.(providerSessionKey, downgradedProvider.id);
              onProviderTelemetry?.({
                event: 'provider_wireapi_downgrade',
                providerId: downgradedProvider.id,
                model: nextModel,
                baseURL: downgradedProvider.baseURL,
                wireApi: downgradedProvider.wireApi
              });
              console.log(`🔁 Provider downgrade: switched ${nextProvider.id} to chat_completions`);
              return {
                stream,
                activeProvider: nextProvider,
                client: nextClient,
                effectiveModel: nextModel,
                currentMessages: nextMessages
              };
            } catch (downgradeErr) {
              currentErr = downgradeErr;
            }
          }
        } else {
          providerRuntime.markProviderFailure(nextProvider.id, currentErr);
          providerRuntime.markSessionProviderFailure?.(providerSessionKey, nextProvider.id);
          onProviderTelemetry?.({
            event: 'provider_failure',
            providerId: nextProvider.id,
            model: nextModel,
            baseURL: nextProvider.baseURL,
            status: currentErr?.status || currentErr?.code || null,
            message: String(currentErr?.message || '').slice(0, 240)
          });
        }

        if (currentErr.name === 'AbortError') {
          const deadlineExceeded = Date.now() >= requestDeadlineAt;
          console.warn(`[LLM_TIMEOUT] ${deadlineExceeded ? 'request deadline reached' : 'provider attempt timed out'} provider=${nextProvider.id} model=${nextModel} attemptTimeoutMs=${lastAttemptTimeoutMs}`);
          if (deadlineExceeded) {
            return {
              errorEvent: { type: 'error', message: 'Sorğu üçün ayrılmış ümumi vaxt bitdi. Sistem əlçatan provider və modelləri yoxladı; zəhmət olmasa bir neçə saniyə sonra yenidən cəhd edin.' }
            };
          }
          const sec = Math.max(1, Math.round(lastAttemptTimeoutMs / 1000));
          return {
            errorEvent: { type: 'error', message: `Model ${sec}s ərzində cavab vermədi. Zəhmət olmasa bir neçə saniyə sonra yenidən cəhd edin; problem davam edərsə daha kiçik model seçin.` }
          };
        }

        const status = currentErr.status || currentErr.code || 'unknown';
        const errText = String(currentErr.message || '').toLowerCase();
        const isDeepSeekModel = String(nextModel || '').toLowerCase().includes('deepseek');
        if (
          !deepSeekRecoveryUsed &&
          isDeepSeekModel &&
          String(status) === '400' &&
          (errText.includes('provider returned error') || errText.includes('reasoning_content') || errText.includes('tool_call'))
        ) {
          deepSeekRecoveryUsed = true;
          nextMessages = buildDeepSeekRecoveryMessages(nextMessages);
          if (shouldEmitDebugEvent()) {
            writeSse({ type: 'debug', info: 'DeepSeek recovery retry activated' });
          }
          continue;
        }

        if (
          !providerNoToolsFallbackUsed &&
          String(status) === '400' &&
          (errText.includes('provider returned error') || isResponsesSchemaMismatchError(currentErr))
        ) {
          providerNoToolsFallbackUsed = true;
          try {
            let simpleMsg;
            if (nextProvider.wireApi === 'responses') {
              const basic = await nextClient.responses.create({
                model: nextModel,
                input: mapMessagesToResponsesInput(buildDeepSeekRecoveryMessages(nextMessages)),
                tools: undefined,
                parallel_tool_calls: false
              });
              simpleMsg = { role: 'assistant', content: basic?.output_text || 'Cavab alınmadı.' };
            } else {
              const basic = await nextClient.chat.completions.create({
                model: nextModel,
                messages: buildDeepSeekRecoveryMessages(nextMessages),
                temperature: 0.2
              });
              simpleMsg = basic?.choices?.[0]?.message || { role: 'assistant', content: 'Cavab alınmadı.' };
            }
            return {
              fallbackMessage: simpleMsg,
              currentMessages: [...nextMessages, simpleMsg]
            };
          } catch (fallbackErr) {
            currentErr = fallbackErr;
          }
        }

        console.error(`❌ API Error [${status}]:`, currentErr.message);
        console.error(`❌ Full error:`, JSON.stringify({ status: currentErr.status, headers: currentErr.headers, body: currentErr.error || currentErr.body }, null, 2));
        // If every candidate routes through the SAME gateway/base URL, the
        // "alternative models" the system "auto-checked" are not real backups —
        // they share one point of failure. Say so, and point at the actual fix.
        const distinctBases = Array.from(
          new Set((providerCandidates || []).map((c) => String(c.baseURL || '').replace(/\/+$/, '').toLowerCase()))
        ).filter(Boolean);
        const singleGateway = distinctBases.length <= 1;
        let userMsg = isGenericFailoverCandidate(providerCandidates)
          ? ('AI provider-lər hazırda cavab qaytarmadı. Sistem alternativ modelləri avtomatik yoxladı. Bir az sonra yenidən cəhd edin.'
            + (singleGateway ? ' (Qeyd: bütün modellər eyni AI gateway-dən keçir — ehtiyat provider, məsələn OpenRouter və ya NVIDIA, qoşulu olarsa avtomatik keçid olunar.)' : ''))
          : `API xətası: ${currentErr.message}`;
        const errLower = String(currentErr.message || '').toLowerCase();
        const isOllamaUrl = String(nextProvider.baseURL || '').includes('11434') || String(nextProvider.baseURL || '').includes('ollama');

        if (currentErr.status === 401 && !isGenericFailoverCandidate(providerCandidates)) {
          userMsg = 'API açarı keçərsizdir. Ayarlardan düzgün API açarı daxil edin.';
        } else if (currentErr.status === 429 && !isGenericFailoverCandidate(providerCandidates)) {
          userMsg = 'API limiti aşıldı (rate limit). 1-2 dəqiqə gözləyib yenidən cəhd edin.';
        } else if (currentErr.status === 402 && !isGenericFailoverCandidate(providerCandidates)) {
          userMsg = 'API balansı bitib və ya kredit limiti aşılıb (402). Provider panelinə daxil olub kredit əlavə edin və ya başqa model seçin.';
        } else if (currentErr.status === 503) {
          userMsg = isGenericFailoverCandidate(providerCandidates)
            ? 'AI servisləri hazırda müvəqqəti əlçatmaz oldu. Sistem arxa planda alternativ provider-ləri sınadı, amma cavab ala bilmədi. Bir az sonra yenidən yoxlayaq.'
            : 'AI servisi müvəqqəti əlçatmazdır. Mesajınız çox böyük ola bilər — daha qısa mesaj göndərin və ya bir neçə dəqiqə gözləyin.';
        } else if (currentErr.status === 404 && !isGenericFailoverCandidate(providerCandidates)) {
          if (isOllamaUrl) {
            userMsg = `Ollama-da "${nextModel}" modeli quraşdırılmayıb. Terminal-da bunu icra edin: \`ollama pull ${nextModel}\``;
          } else {
            userMsg = `Model tapılmadı: "${nextModel}". Ayarlardan model adını yoxlayın.`;
          }
        } else if (
          isOllamaUrl && (
            errLower.includes('econnrefused') ||
            errLower.includes('connection error') ||
            errLower.includes('fetch failed') ||
            errLower.includes('econnreset')
          )
        ) {
          userMsg = `🦙 Ollama xidməti işləmir (${nextProvider.baseURL}). Terminal-da bunu icra edin:\n\n\`\`\`\nollama serve\n\`\`\`\n\nSonra modeli yükləyin: \`ollama pull ${nextModel}\`\n\nVə ya AYARLAR-dan Cloud modelinə (Claude Sonnet 4.5 və ya 'Auto') keçin.`;
        } else if (errLower.includes('connection error') || errLower.includes('fetch failed') || errLower.includes('econnrefused')) {
          userMsg = isGenericFailoverCandidate(providerCandidates)
            ? 'Şəbəkə problemi səbəbilə AI provider-lərlə əlaqə qurmaq alınmadı. Sistem alternativləri sınadı, amma bu dəfə cavab çıxmadı.'
            : `Şəbəkə xətası: ${nextProvider.baseURL}-ə qoşula bilmədim. İnternet bağlantınızı və baseURL-i yoxlayın.`;
        }

        // Failover pool-u istifadəçiyə ümumi mesaj göstərir və real xəta itir.
        // BAHAI_DEBUG_EVENTS=1 olduqda həqiqi xətanı debug hadisəsi kimi ver —
        // lokal debaqda failover səbəbini görmək mümkün olsun.
        if (isGenericFailoverCandidate(providerCandidates) && shouldEmitDebugEvent()) {
          writeSse({
            type: 'debug',
            info: {
              providerError: {
                status,
                message: String(currentErr?.message || '').slice(0, 500),
                providerId: nextProvider?.id || null,
                model: nextModel,
                baseURL: nextProvider?.baseURL || null
              }
            }
          });
        }

        return {
          errorEvent: { type: 'error', message: userMsg }
        };
    }
  }
}

module.exports = {
  openAiStreamWithFallback,
  isRetryableProviderError,
  modelDisablesTools,
  isVisionModel,
  adaptMessagesForProvider
};
