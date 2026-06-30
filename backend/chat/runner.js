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
  llmTimeoutMs
}) {
  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), llmTimeoutMs);

  let stream;
  let nextProvider = activeProvider;
  let nextClient = client;
  let nextModel = effectiveModel;
  let nextMessages = currentMessages;
  let deepSeekRecoveryUsed = false;
  let providerNoToolsFallbackUsed = false;

  try {
    while (true) {
      try {
        const apiInputMessages = await normalizeMessagesForModel(nextMessages, nextModel);
        if (nextProvider.wireApi === 'responses') {
          stream = await nextClient.responses.create({
            model: nextModel,
            input: mapMessagesToResponsesInput(apiInputMessages),
            tools: isLocalOrFlakyModel ? undefined : mapToolsToResponsesTools(phaseTools),
            stream: true,
            parallel_tool_calls: false
          }, { signal: abortController.signal });
        } else {
          stream = await nextClient.chat.completions.create({
            model: nextModel,
            messages: apiInputMessages,
            tools: isLocalOrFlakyModel ? undefined : phaseTools,
            temperature: 0.2,
            stream: true
          }, { signal: abortController.signal });
        }

        return {
          stream,
          activeProvider: nextProvider,
          client: nextClient,
          effectiveModel: nextModel,
          currentMessages: nextMessages
        };
      } catch (apiErr) {
        let currentErr = apiErr;
        const isRetryable = (() => {
          const st = currentErr?.status || currentErr?.code;
          const msg = String(currentErr?.message || '').toLowerCase();
          if (st === 401) return true;
          if (st === 429 || st === 500 || st === 502 || st === 503 || st === 504) return true;
          if (st === 400 && msg.includes('provider returned error')) return true;
          if (isResponsesSchemaMismatchError(currentErr)) return true;
          if (!st && (msg.includes('network') || msg.includes('timeout') || msg.includes('fetch failed'))) return true;
          return false;
        })();

        if (isRetryable && providerCandidates.length > 1) {
          providerRuntime.markProviderFailure(nextProvider.id);
          const alternatives = providerCandidates.filter((p) => p.id !== nextProvider.id && providerRuntime.canUseProviderNow(p.id));
          for (const alt of alternatives) {
            try {
              const altClient = buildOpenAIClient(alt);
              const altApiInputMessages = await normalizeMessagesForModel(nextMessages, alt.model);
              const altIsLocal = /qwen|ollama|deepseek|llama|local|free|nemotron/i.test(alt.model);
              if (alt.wireApi === 'responses') {
                stream = await altClient.responses.create({
                  model: alt.model,
                  input: mapMessagesToResponsesInput(altApiInputMessages),
                  tools: altIsLocal ? undefined : mapToolsToResponsesTools(phaseTools),
                  stream: true,
                  parallel_tool_calls: false
                }, { signal: abortController.signal });
              } else {
                stream = await altClient.chat.completions.create({
                  model: alt.model,
                  messages: altApiInputMessages,
                  tools: altIsLocal ? undefined : phaseTools,
                  temperature: 0.2,
                  stream: true
                }, { signal: abortController.signal });
              }
              nextProvider = alt;
              nextClient = altClient;
              nextModel = alt.model;
              providerRuntime.markProviderSuccess(alt.id);
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
            }
          }
          if (!stream && isResponsesSchemaMismatchError(currentErr) && nextProvider.wireApi === 'responses') {
            try {
              const downgradedProvider = { ...nextProvider, wireApi: 'chat_completions' };
              const downgradedClient = buildOpenAIClient(downgradedProvider);
              const downgradedMessages = await normalizeMessagesForModel(nextMessages, nextModel);
              stream = await downgradedClient.chat.completions.create({
                model: nextModel,
                messages: downgradedMessages,
                tools: isLocalOrFlakyModel ? undefined : phaseTools,
                temperature: 0.2,
                stream: true
              }, { signal: abortController.signal });
              nextProvider = downgradedProvider;
              nextClient = downgradedClient;
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
          userMsg = 'AI servisi müvəqqəti əlçatmazdır. Mesajınız çox böyük ola bilər — daha qısa mesaj göndərin və ya bir neçə dəqiqə gözləyin.';
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
          userMsg = `Şəbəkə xətası: ${nextProvider.baseURL}-ə qoşula bilmədim. İnternet bağlantınızı və baseURL-i yoxlayın.`;
        }

        return {
          errorEvent: { type: 'error', message: userMsg }
        };
      }
    }
  } finally {
    clearTimeout(timeoutId);
  }
}

module.exports = {
  openAiStreamWithFallback
};
