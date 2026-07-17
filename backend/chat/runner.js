function isRetryableProviderError(error, isResponsesSchemaMismatchError) {
  const status = error?.status || error?.code;
  const msg = String(error?.message || '').toLowerCase();
  if (status === 401) return true;
  if (status === 408 || status === 409 || status === 425 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504) return true;
  if (status === 400 && (msg.includes('provider returned error') || msg.includes('temporarily unavailable') || msg.includes('content-blocked'))) return true;
  if (isResponsesSchemaMismatchError(error)) return true;
  if (!status && (msg.includes('network') || msg.includes('timeout') || msg.includes('fetch failed') || msg.includes('econnrefused') || msg.includes('econnreset'))) return true;
  return false;
}

function modelDisablesTools(model = '') {
  return /qwen|ollama|deepseek|llama|local|free|nemotron/i.test(String(model || ''));
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
  onProviderTelemetry,
  providerSessionKey
}) {
  const abortController = new AbortController();
  const FIRST_CHUNK_TIMEOUT_MS = Math.min(llmTimeoutMs, 15000); // First chunk within 15s
  let firstChunkTimer = setTimeout(() => abortController.abort(), FIRST_CHUNK_TIMEOUT_MS);
  const timeoutId = setTimeout(() => {
    if (firstChunkTimer) {
      clearTimeout(firstChunkTimer);
      firstChunkTimer = null;
    }
    abortController.abort();
  }, llmTimeoutMs);

  let stream;
  let nextProvider = activeProvider;
  let nextClient = client;
  let nextModel = effectiveModel;
  let nextMessages = currentMessages;
  let deepSeekRecoveryUsed = false;
  let providerNoToolsFallbackUsed = false;

  async function createStream(provider, providerClient, model, messages, disableTools = false) {
    const apiInputMessages = await normalizeMessagesForModel(messages, model);
    const shouldDisableTools = disableTools || modelDisablesTools(model);
    // Clear first-chunk timer when we successfully create a stream
    if (firstChunkTimer) {
      clearTimeout(firstChunkTimer);
      firstChunkTimer = null;
    }
    if (provider.wireApi === 'responses') {
      return providerClient.responses.create({
        model,
        input: mapMessagesToResponsesInput(apiInputMessages),
        tools: shouldDisableTools ? undefined : mapToolsToResponsesTools(phaseTools),
        stream: true,
        parallel_tool_calls: false
      }, { signal: abortController.signal });
    }
    return providerClient.chat.completions.create({
      model,
      messages: apiInputMessages,
      tools: shouldDisableTools ? undefined : phaseTools,
      temperature: 0.2,
      stream: true
    }, { signal: abortController.signal });
  }

  try {
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

        stream = await createStream(
          nextProvider,
          nextClient,
          nextModel,
          nextMessages,
          isLocalOrFlakyModel
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
        let currentErr = apiErr;
        const isRetryable = isRetryableProviderError(currentErr, isResponsesSchemaMismatchError);

        if (isRetryable && providerCandidates.length > 1) {
          providerRuntime.markProviderFailure(nextProvider.id);
          providerRuntime.markSessionProviderFailure?.(providerSessionKey, nextProvider.id);
          onProviderTelemetry?.({
            event: 'provider_failure',
            providerId: nextProvider.id,
            model: nextModel,
            baseURL: nextProvider.baseURL,
            status: currentErr?.status || currentErr?.code || null,
            message: String(currentErr?.message || '').slice(0, 240)
          });
          const alternatives = providerCandidates.filter((p) => p.id !== nextProvider.id && providerRuntime.canUseProviderNow(p.id));
          for (const alt of alternatives) {
            try {
              const altClient = buildOpenAIClient(alt);
              stream = await createStream(alt, altClient, alt.model, nextMessages, false);
              nextProvider = alt;
              nextClient = altClient;
              nextModel = alt.model;
              providerRuntime.markProviderSuccess(alt.id);
              providerRuntime.markSessionProviderSuccess?.(providerSessionKey, alt.id);
              onProviderTelemetry?.({
                event: 'provider_failover',
                fromProviderId: activeProvider?.id || null,
                previousProviderId: nextProvider.id,
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
              providerRuntime.markProviderFailure(alt.id);
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
              stream = await createStream(downgradedProvider, downgradedClient, nextModel, nextMessages, isLocalOrFlakyModel);
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
          providerRuntime.markProviderFailure(nextProvider.id);
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
          const sec = Math.round(llmTimeoutMs / 1000);
          return {
            errorEvent: { type: 'error', message: `Model ${sec}s ərzində cavab vermədi. Daha kiçik model (məs. Qwen 2.5 Coder 7B) sınayın və ya \`LLM_TIMEOUT_MS\` env-i artırın.` }
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
        let userMsg = `API xətası: ${currentErr.message}`;
        const errLower = String(currentErr.message || '').toLowerCase();
        const isOllamaUrl = String(nextProvider.baseURL || '').includes('11434') || String(nextProvider.baseURL || '').includes('ollama');

        if (currentErr.status === 401) {
          userMsg = 'API açarı keçərsizdir. Ayarlardan düzgün API açarı daxil edin.';
        } else if (currentErr.status === 429) {
          userMsg = 'API limiti aşıldı (rate limit). 1-2 dəqiqə gözləyib yenidən cəhd edin.';
        } else if (currentErr.status === 503) {
          userMsg = providerCandidates.length > 1
            ? 'AI servisləri hazırda müvəqqəti əlçatmaz oldu. Sistem arxa planda alternativ provider-ləri sınadı, amma cavab ala bilmədi. Bir az sonra yenidən yoxlayaq.'
            : 'AI servisi müvəqqəti əlçatmazdır. Mesajınız çox böyük ola bilər — daha qısa mesaj göndərin və ya bir neçə dəqiqə gözləyin.';
        } else if (currentErr.status === 404) {
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
          userMsg = providerCandidates.length > 1
            ? 'Şəbəkə problemi səbəbilə AI provider-lərlə əlaqə qurmaq alınmadı. Sistem alternativləri sınadı, amma bu dəfə cavab çıxmadı.'
            : `Şəbəkə xətası: ${nextProvider.baseURL}-ə qoşula bilmədim. İnternet bağlantınızı və baseURL-i yoxlayın.`;
        }

        return {
          errorEvent: { type: 'error', message: userMsg }
        };
      }
    }
  } finally {
    clearTimeout(timeoutId);
    if (firstChunkTimer) {
      clearTimeout(firstChunkTimer);
      firstChunkTimer = null;
    }
  }
}

module.exports = {
  openAiStreamWithFallback,
  isRetryableProviderError,
  modelDisablesTools
};
