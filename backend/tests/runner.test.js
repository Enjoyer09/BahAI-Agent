import { describe, it, expect, vi } from 'vitest';
import { openAiStreamWithFallback, isRetryableProviderError, adaptMessagesForProvider } from '../chat/runner.js';

function createProviderRuntime() {
  const failed = new Set();
  const sessionAvoid = new Map();
  return {
    markProviderFailure: vi.fn((id) => failed.add(id)),
    markProviderSuccess: vi.fn((id) => failed.delete(id)),
    canUseProviderNow: vi.fn((id) => !failed.has(id)),
    markSessionProviderFailure: vi.fn((sessionKey, id) => sessionAvoid.set(`${sessionKey}:${id}`, true)),
    markSessionProviderSuccess: vi.fn((sessionKey, id) => sessionAvoid.delete(`${sessionKey}:${id}`)),
    shouldAvoidProviderForSession: vi.fn((sessionKey, id) => sessionAvoid.has(`${sessionKey}:${id}`)),
    reorderCandidatesForSession: vi.fn((sessionKey, candidates) => {
      return [...candidates].sort((a, b) => {
        const avoidA = sessionAvoid.has(`${sessionKey}:${a.id}`) ? 1 : 0;
        const avoidB = sessionAvoid.has(`${sessionKey}:${b.id}`) ? 1 : 0;
        return avoidA - avoidB;
      });
    })
  };
}

function createClientThatFails(error) {
  return {
    responses: { create: vi.fn().mockRejectedValue(error) },
    chat: { completions: { create: vi.fn().mockRejectedValue(error) } }
  };
}

function createStreamingClient(tag = 'ok') {
  return {
    responses: {
      create: vi.fn().mockResolvedValue({
        [Symbol.asyncIterator]: async function* () {
          yield { type: 'response.output_text.delta', delta: `${tag}` };
          yield { type: 'response.completed' };
        }
      })
    },
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({
          [Symbol.asyncIterator]: async function* () {
            yield { choices: [{ delta: { content: `${tag}` }, finish_reason: 'stop' }] };
          }
        })
      }
    }
  };
}

describe('runner failover behavior', () => {
  it('adapts NVIDIA vision image_url content to the NIM img-tag format', () => {
    const messages = adaptMessagesForProvider([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Şəkildə nə görürsən?' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,abc' } }
        ]
      }
    ], {
      baseURL: 'https://integrate.api.nvidia.com/v1'
    }, 'meta/llama-3.2-11b-vision-instruct');

    expect(messages[0].content).toContain('Şəkildə nə görürsən?');
    expect(messages[0].content).toContain('<img src="data:image/png;base64,abc" />');
    expect(messages[0].content.indexOf('<img')).toBeLessThan(messages[0].content.indexOf('Şəkildə'));
  });

  it('disables tools for NVIDIA vision requests', async () => {
    const runtime = createProviderRuntime();
    const provider = {
      id: 'nvidia_vision_1',
      wireApi: 'chat_completions',
      model: 'meta/llama-3.2-11b-vision-instruct',
      baseURL: 'https://integrate.api.nvidia.com/v1',
      apiKey: 'key'
    };
    const client = createStreamingClient('vision-ok');

    await openAiStreamWithFallback({
      currentMessages: [{
        role: 'user',
        content: 'Şəkildə nə görürsən?',
        attachments: [{ type: 'image', mimeType: 'image/png', url: 'data:image/png;base64,abc' }]
      }],
      effectiveModel: provider.model,
      activeProvider: provider,
      client,
      phaseTools: [{ type: 'function', function: { name: 'web_search', parameters: {} } }],
      isLocalOrFlakyModel: false,
      providerCandidates: [provider],
      providerRuntime: runtime,
      buildOpenAIClient: () => client,
      normalizeMessagesForModel: async () => [{
        role: 'user',
        content: [
          { type: 'text', text: 'Şəkildə nə görürsən?' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,abc' } }
        ]
      }],
      mapMessagesToResponsesInput: (messages) => messages,
      mapToolsToResponsesTools: (tools) => tools,
      isResponsesSchemaMismatchError: () => false,
      buildDeepSeekRecoveryMessages: (messages) => messages,
      writeSse: () => {},
      shouldEmitDebugEvent: () => false,
      llmTimeoutMs: 1000,
      onProviderTelemetry: () => {},
      providerSessionKey: 'web:vision:test'
    });

    expect(client.chat.completions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: undefined,
        messages: [expect.objectContaining({
          content: expect.stringContaining('<img src="data:image/png;base64,abc" />')
        })]
      }),
      expect.any(Object)
    );
  });

  it('passes the base64 image_url array to OpenAI-compatible providers for vision requests', async () => {
    const runtime = createProviderRuntime();
    const provider = { id: 'web_vision_primary', wireApi: 'chat_completions', model: 'gpt-5.5', baseURL: 'https://api.freemodel.dev/v1', apiKey: 'key' };
    const client = createStreamingClient('vision-ok');

    await openAiStreamWithFallback({
      currentMessages: [{ role: 'user', content: 'Şəkildə nə var?', attachments: [{ type: 'image', mimeType: 'image/png', url: 'data:image/png;base64,aGVsbG8=' }] }],
      effectiveModel: provider.model,
      activeProvider: provider,
      client,
      phaseTools: [],
      isLocalOrFlakyModel: false,
      isVisionRequest: true,
      providerCandidates: [provider],
      providerRuntime: runtime,
      buildOpenAIClient: () => client,
      normalizeMessagesForModel: async () => [{
        role: 'user',
        content: [
          { type: 'text', text: 'Şəkildə nə var?' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,aGVsbG8=', detail: 'high' } }
        ]
      }],
      mapMessagesToResponsesInput: (messages) => messages,
      mapToolsToResponsesTools: (tools) => tools,
      isResponsesSchemaMismatchError: () => false,
      buildDeepSeekRecoveryMessages: (messages) => messages,
      writeSse: () => {},
      shouldEmitDebugEvent: () => false,
      llmTimeoutMs: 1000,
      onProviderTelemetry: () => {},
      providerSessionKey: 'web:anon:vision-payload'
    });

    const payload = client.chat.completions.create.mock.calls[0][0];
    expect(payload.messages[0].content).toEqual([
      { type: 'text', text: 'Şəkildə nə var?' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,aGVsbG8=', detail: 'high' } }
    ]);
  });

  it('keeps OpenAI image arrays for the current NVIDIA Omni vision model', () => {
    const original = [{
      role: 'user',
      content: [
        { type: 'text', text: 'Şəkli təsvir et' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,abc' } }
      ]
    }];
    const adapted = adaptMessagesForProvider(
      original,
      { baseURL: 'https://integrate.api.nvidia.com/v1' },
      'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning'
    );

    expect(adapted).toEqual(original);
  });

  it('treats provider limits, 503 and network-style errors as retryable', () => {
    expect(isRetryableProviderError({ status: 402, message: 'Usage limit reached' }, () => false)).toBe(true);
    expect(isRetryableProviderError({ message: 'Provider quota exceeded' }, () => false)).toBe(true);
    expect(isRetryableProviderError({ status: 503, message: 'Service Unavailable' }, () => false)).toBe(true);
    expect(isRetryableProviderError({ message: 'fetch failed ECONNREFUSED' }, () => false)).toBe(true);
    expect(isRetryableProviderError({ name: 'AbortError', message: 'aborted' }, () => false)).toBe(true);
  });

  it('omits tools when final synthesis is forced', async () => {
    const runtime = createProviderRuntime();
    const provider = { id: 'omni', wireApi: 'chat_completions', model: 'auto', baseURL: 'https://omni.example/v1', apiKey: 'key' };
    const client = createStreamingClient('final');

    await openAiStreamWithFallback({
      currentMessages: [{ role: 'user', content: 'Araşdır və yekunlaşdır' }],
      effectiveModel: provider.model,
      activeProvider: provider,
      client,
      phaseTools: [{ type: 'function', function: { name: 'web_search', parameters: {} } }],
      isLocalOrFlakyModel: false,
      providerCandidates: [provider],
      providerRuntime: runtime,
      buildOpenAIClient: () => client,
      normalizeMessagesForModel: async (messages) => messages,
      mapMessagesToResponsesInput: (messages) => messages,
      mapToolsToResponsesTools: (tools) => tools,
      isResponsesSchemaMismatchError: () => false,
      buildDeepSeekRecoveryMessages: (messages) => messages,
      writeSse: () => {},
      shouldEmitDebugEvent: () => false,
      llmTimeoutMs: 1000,
      onProviderTelemetry: () => {},
      providerSessionKey: 'web:anon:final',
      forceDisableTools: true,
    });

    expect(client.chat.completions.create).toHaveBeenCalledWith(
      expect.objectContaining({ tools: undefined, stream: true }),
      expect.any(Object),
    );
  });

  it('gives a hanging OmniRoute text attempt a real 15s budget before fallback (no more 5s cap)', async () => {
    vi.useFakeTimers();
    const runtime = createProviderRuntime();
    const primary = { id: 'web_general_primary_omniroute', wireApi: 'chat_completions', model: 'auto', baseURL: 'https://omni.example/v1', apiKey: 'a' };
    const fallback = { id: 'nvidia_general_1', wireApi: 'chat_completions', model: 'meta/llama-3.3-70b-instruct', baseURL: 'https://integrate.api.nvidia.com/v1', apiKey: 'b' };
    const hangingClient = {
      chat: {
        completions: {
          create: vi.fn((_input, options) => new Promise((_resolve, reject) => {
            options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
          }))
        }
      }
    };
    const fallbackClient = createStreamingClient('fallback-ok');

    const resultPromise = openAiStreamWithFallback({
      currentMessages: [{ role: 'user', content: 'Salam' }],
      effectiveModel: primary.model,
      activeProvider: primary,
      client: hangingClient,
      phaseTools: [],
      isLocalOrFlakyModel: false,
      providerCandidates: [primary, fallback],
      providerRuntime: runtime,
      buildOpenAIClient: (provider) => provider.id === primary.id ? hangingClient : fallbackClient,
      normalizeMessagesForModel: async (messages) => messages,
      mapMessagesToResponsesInput: (messages) => messages,
      mapToolsToResponsesTools: (tools) => tools,
      isResponsesSchemaMismatchError: () => false,
      buildDeepSeekRecoveryMessages: (messages) => messages,
      writeSse: () => {},
      shouldEmitDebugEvent: () => false,
      llmTimeoutMs: 20000,
      onProviderTelemetry: () => {},
      providerSessionKey: 'web:anon:omni-timeout'
    });

    // A healthy provider must not be cut at 5s: nothing should settle yet.
    let settled = false;
    resultPromise.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(5001);
    expect(settled).toBe(false);

    // The text attempt cap is now 15s — fallback happens after that.
    await vi.advanceTimersByTimeAsync(10001);
    const result = await resultPromise;
    expect(result.activeProvider.id).toBe(fallback.id);
    vi.useRealTimers();
  });

  it('gives vision requests a longer OmniRoute attempt timeout (30s floor)', async () => {
    vi.useFakeTimers();
    const runtime = createProviderRuntime();
    const primary = { id: 'web_vision_primary_omniroute', wireApi: 'chat_completions', model: 'auto', baseURL: 'https://omni.example/v1', apiKey: 'a' };
    const fallback = { id: 'nvidia_vision_1', wireApi: 'chat_completions', model: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning', baseURL: 'https://integrate.api.nvidia.com/v1', apiKey: 'b' };
    const hangingClient = {
      chat: {
        completions: {
          create: vi.fn((_input, options) => new Promise((_resolve, reject) => {
            options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
          }))
        }
      }
    };
    const fallbackClient = createStreamingClient('vision-fallback-ok');

    let settled = false;
    const resultPromise = openAiStreamWithFallback({
      currentMessages: [{ role: 'user', content: 'Şəkildə nə görürsən?', attachments: [{ type: 'image', mimeType: 'image/png', url: 'data:image/png;base64,abc' }] }],
      effectiveModel: primary.model,
      activeProvider: primary,
      client: hangingClient,
      phaseTools: [],
      isLocalOrFlakyModel: false,
      isVisionRequest: true,
      visionTimeoutMs: 30000,
      providerCandidates: [primary, fallback],
      providerRuntime: runtime,
      buildOpenAIClient: (provider) => provider.id === primary.id ? hangingClient : fallbackClient,
      normalizeMessagesForModel: async (messages) => messages,
      mapMessagesToResponsesInput: (messages) => messages,
      mapToolsToResponsesTools: (tools) => tools,
      isResponsesSchemaMismatchError: () => false,
      buildDeepSeekRecoveryMessages: (messages) => messages,
      writeSse: () => {},
      shouldEmitDebugEvent: () => false,
      llmTimeoutMs: 20000,
      onProviderTelemetry: () => {},
      providerSessionKey: 'web:anon:omni-vision-timeout'
    });
    resultPromise.then(() => { settled = true; });

    // Image ingestion needs time: still hanging after the 20s text budget.
    await vi.advanceTimersByTimeAsync(20001);
    expect(settled).toBe(false);

    // Falls over once the vision floor (30s) is reached.
    await vi.advanceTimersByTimeAsync(10001);
    const result = await resultPromise;
    expect(result.activeProvider.id).toBe(fallback.id);
    vi.useRealTimers();
  });

  it('shows a request-deadline message instead of a bogus 1s model timeout', async () => {
    const runtime = createProviderRuntime();
    const provider = { id: 'primary', wireApi: 'chat_completions', model: 'auto', baseURL: 'https://a.example', apiKey: 'a' };

    const result = await openAiStreamWithFallback({
      currentMessages: [{ role: 'user', content: 'Salam' }],
      effectiveModel: provider.model,
      activeProvider: provider,
      client: createStreamingClient('ok'),
      phaseTools: [],
      isLocalOrFlakyModel: false,
      providerCandidates: [provider],
      providerRuntime: runtime,
      buildOpenAIClient: () => createStreamingClient('ok'),
      normalizeMessagesForModel: async (messages) => messages,
      mapMessagesToResponsesInput: (messages) => messages,
      mapToolsToResponsesTools: (tools) => tools,
      isResponsesSchemaMismatchError: () => false,
      buildDeepSeekRecoveryMessages: (messages) => messages,
      writeSse: () => {},
      shouldEmitDebugEvent: () => false,
      llmTimeoutMs: 1000,
      requestDeadlineAt: Date.now() - 100,
      onProviderTelemetry: () => {},
      providerSessionKey: 'web:anon:deadline'
    });

    expect(result.errorEvent).toBeTruthy();
    expect(result.errorEvent.message).toContain('ümumi vaxt');
    expect(result.errorEvent.message).not.toMatch(/Model \d+s ərzində/);
  });

  it('fails over to a vision-capable model when a 400 rejects the image on a vision request', async () => {
    const runtime = createProviderRuntime();
    const primary = { id: 'web_vision_fallback_2', wireApi: 'chat_completions', model: 'meta-llama/llama-3.3-70b-instruct', baseURL: 'https://openrouter.ai/api/v1', apiKey: 'a' };
    const fallback = { id: 'nvidia_vision_1', wireApi: 'chat_completions', model: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning', baseURL: 'https://integrate.api.nvidia.com/v1', apiKey: 'b' };
    const clients = {
      [primary.id]: createClientThatFails({ status: 400, message: 'image_url is not supported by this model' }),
      [fallback.id]: createStreamingClient('vision-ok')
    };

    const result = await openAiStreamWithFallback({
      currentMessages: [{ role: 'user', content: 'Şəkildə nə var?', attachments: [{ type: 'image', mimeType: 'image/png', url: 'data:image/png;base64,abc' }] }],
      effectiveModel: primary.model,
      activeProvider: primary,
      client: clients[primary.id],
      phaseTools: [],
      isLocalOrFlakyModel: false,
      isVisionRequest: true,
      providerCandidates: [primary, fallback],
      providerRuntime: runtime,
      buildOpenAIClient: (provider) => clients[provider.id],
      normalizeMessagesForModel: async (messages) => messages,
      mapMessagesToResponsesInput: (messages) => messages,
      mapToolsToResponsesTools: (tools) => tools,
      isResponsesSchemaMismatchError: () => false,
      buildDeepSeekRecoveryMessages: (messages) => messages,
      writeSse: () => {},
      shouldEmitDebugEvent: () => false,
      llmTimeoutMs: 1000,
      onProviderTelemetry: () => {},
      providerSessionKey: 'web:anon:vision-400'
    });

    expect(result.activeProvider.id).toBe(fallback.id);
    expect(runtime.markProviderFailure).toHaveBeenCalledWith(primary.id, expect.objectContaining({ status: 400 }));
  });

  it('keeps agent tools enabled for local and NVIDIA coding models', async () => {
    const runtime = createProviderRuntime();
    const tools = [{ type: 'function', function: { name: 'list_directory', parameters: {} } }];
    for (const model of ['qwen2.5-coder:latest', 'nvidia/nemotron-3-super-120b-a12b']) {
      const provider = { id: model, wireApi: 'chat_completions', model, baseURL: 'http://127.0.0.1:11434/v1', apiKey: 'key' };
      const client = createStreamingClient('tool-capable');

      await openAiStreamWithFallback({
        currentMessages: [{ role: 'user', content: 'Reponu audit et' }],
        effectiveModel: provider.model,
        activeProvider: provider,
        client,
        phaseTools: tools,
        isLocalOrFlakyModel: true,
        providerCandidates: [provider],
        providerRuntime: runtime,
        buildOpenAIClient: () => client,
        normalizeMessagesForModel: async (messages) => messages,
        mapMessagesToResponsesInput: (messages) => messages,
        mapToolsToResponsesTools: (items) => items,
        isResponsesSchemaMismatchError: () => false,
        buildDeepSeekRecoveryMessages: (messages) => messages,
        writeSse: () => {},
        shouldEmitDebugEvent: () => false,
        llmTimeoutMs: 1000,
        onProviderTelemetry: () => {},
        providerSessionKey: `desktop:test:${model}`
      });

      expect(client.chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({ tools, stream: true }),
        expect.any(Object),
      );
    }
  });

  it('fails over to the next provider when the first provider returns 503', async () => {
    const runtime = createProviderRuntime();
    const primary = { id: 'primary', wireApi: 'responses', model: 'gpt-5.5', baseURL: 'https://a.example', apiKey: 'a' };
    const fallback = { id: 'fallback', wireApi: 'responses', model: 'gpt-5.5', baseURL: 'https://b.example', apiKey: 'b' };
    const clients = {
      primary: createClientThatFails({ status: 503, message: 'Service unavailable' }),
      fallback: createStreamingClient('fallback-ok')
    };

    const telemetry = [];
    const result = await openAiStreamWithFallback({
      currentMessages: [{ role: 'user', content: 'Salam' }],
      effectiveModel: primary.model,
      activeProvider: primary,
      client: clients.primary,
      phaseTools: [],
      isLocalOrFlakyModel: false,
      providerCandidates: [primary, fallback],
      providerRuntime: runtime,
      buildOpenAIClient: (provider) => clients[provider.id],
      normalizeMessagesForModel: async (messages) => messages,
      mapMessagesToResponsesInput: (messages) => messages,
      mapToolsToResponsesTools: (tools) => tools,
      isResponsesSchemaMismatchError: () => false,
      buildDeepSeekRecoveryMessages: (messages) => messages,
      writeSse: () => {},
      shouldEmitDebugEvent: () => false,
      llmTimeoutMs: 1000,
      onProviderTelemetry: (event) => telemetry.push(event),
      providerSessionKey: 'web:anon:test'
    });

    expect(result.activeProvider.id).toBe('fallback');
    expect(runtime.markProviderFailure).toHaveBeenCalledWith('primary', expect.objectContaining({ status: 503 }));
    expect(runtime.markProviderSuccess).toHaveBeenCalledWith('fallback');
    expect(runtime.markSessionProviderFailure).toHaveBeenCalledWith('web:anon:test', 'primary');
    expect(runtime.markSessionProviderSuccess).toHaveBeenCalledWith('web:anon:test', 'fallback');
    expect(telemetry.some((item) => item.event === 'provider_failure' && item.providerId === 'primary')).toBe(true);
    expect(telemetry.some((item) => item.event === 'provider_failover' && item.providerId === 'fallback')).toBe(true);
  });

  it('fails over when a provider opens an empty stream without any chunks', async () => {
    const runtime = createProviderRuntime();
    const primary = { id: 'omniroute', wireApi: 'chat_completions', model: 'auto', baseURL: 'https://omni.example/v1', apiKey: 'a' };
    const fallback = { id: 'nvidia', wireApi: 'chat_completions', model: 'meta/llama-3.3-70b-instruct', baseURL: 'https://integrate.api.nvidia.com/v1', apiKey: 'b' };
    const emptyClient = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            [Symbol.asyncIterator]: async function* () {}
          })
        }
      }
    };
    const fallbackClient = createStreamingClient('nvidia-ok');
    const telemetry = [];

    const result = await openAiStreamWithFallback({
      currentMessages: [{ role: 'user', content: 'Salam' }],
      effectiveModel: primary.model,
      activeProvider: primary,
      client: emptyClient,
      phaseTools: [],
      isLocalOrFlakyModel: false,
      providerCandidates: [primary, fallback],
      providerRuntime: runtime,
      buildOpenAIClient: (provider) => provider.id === primary.id ? emptyClient : fallbackClient,
      normalizeMessagesForModel: async (messages) => messages,
      mapMessagesToResponsesInput: (messages) => messages,
      mapToolsToResponsesTools: (tools) => tools,
      isResponsesSchemaMismatchError: () => false,
      buildDeepSeekRecoveryMessages: (messages) => messages,
      writeSse: () => {},
      shouldEmitDebugEvent: () => false,
      llmTimeoutMs: 1000,
      onProviderTelemetry: (event) => telemetry.push(event),
      providerSessionKey: 'web:anon:empty-stream'
    });

    expect(result.activeProvider.id).toBe(fallback.id);
    expect(runtime.markProviderFailure).toHaveBeenCalledWith(primary.id, expect.objectContaining({ status: 503 }));
    expect(telemetry.some((item) => item.event === 'provider_failure' && item.providerId === primary.id)).toBe(true);
    expect(telemetry.some((item) => item.event === 'provider_failover' && item.providerId === fallback.id)).toBe(true);
  });

  it('fails over when a provider emits an SSE error event instead of JSON', async () => {
    const runtime = createProviderRuntime();
    const primary = { id: 'nvidia-8b', wireApi: 'chat_completions', model: 'meta/llama-3.1-8b-instruct', baseURL: 'https://integrate.api.nvidia.com/v1', apiKey: 'a' };
    const fallback = { id: 'nvidia-70b', wireApi: 'chat_completions', model: 'meta/llama-3.3-70b-instruct', baseURL: 'https://integrate.api.nvidia.com/v1', apiKey: 'a' };
    const brokenClient = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            [Symbol.asyncIterator]: async function* () {
              throw new Error("Could not parse message into JSON\nFrom chunk: [ 'event: error', ': unspecified error' ]");
            }
          })
        }
      }
    };
    const fallbackClient = createStreamingClient('nvidia-fallback-ok');

    const result = await openAiStreamWithFallback({
      currentMessages: [{ role: 'user', content: 'Bu gün oyunları tap' }],
      effectiveModel: primary.model,
      activeProvider: primary,
      client: brokenClient,
      phaseTools: [],
      isLocalOrFlakyModel: false,
      providerCandidates: [primary, fallback],
      providerRuntime: runtime,
      buildOpenAIClient: (provider) => provider.id === primary.id ? brokenClient : fallbackClient,
      normalizeMessagesForModel: async (messages) => messages,
      mapMessagesToResponsesInput: (messages) => messages,
      mapToolsToResponsesTools: (tools) => tools,
      isResponsesSchemaMismatchError: () => false,
      buildDeepSeekRecoveryMessages: (messages) => messages,
      writeSse: () => {},
      shouldEmitDebugEvent: () => false,
      llmTimeoutMs: 1000,
      onProviderTelemetry: () => {},
      providerSessionKey: 'web:anon:sse-error'
    });

    expect(result.activeProvider.id).toBe(fallback.id);
    expect(runtime.markProviderFailure).toHaveBeenCalledWith(primary.id, expect.objectContaining({ status: 502 }));
  });

  it('switches to the next OmniRoute model when a model returns 401', async () => {
    const runtime = createProviderRuntime();
    const primary = { id: 'web_general_primary_omniroute', wireApi: 'chat_completions', model: 'auto', baseURL: 'https://omni.example/v1', apiKey: 'omni-key' };
    const fallback = { id: 'web_general_fallback_1', wireApi: 'chat_completions', model: 'qwen/qwen3-coder:free', baseURL: 'https://omni.example/v1', apiKey: 'omni-key' };
    const clients = {
      [primary.id]: createClientThatFails({ status: 401, message: 'Insufficient balance' }),
      [fallback.id]: createStreamingClient('omni-model-ok')
    };
    const telemetry = [];

    const result = await openAiStreamWithFallback({
      currentMessages: [{ role: 'user', content: 'Salam' }],
      effectiveModel: primary.model,
      activeProvider: primary,
      client: clients[primary.id],
      phaseTools: [],
      isLocalOrFlakyModel: false,
      providerCandidates: [primary, fallback],
      providerRuntime: runtime,
      buildOpenAIClient: (provider) => clients[provider.id],
      normalizeMessagesForModel: async (messages) => messages,
      mapMessagesToResponsesInput: (messages) => messages,
      mapToolsToResponsesTools: (tools) => tools,
      isResponsesSchemaMismatchError: () => false,
      buildDeepSeekRecoveryMessages: (messages) => messages,
      writeSse: () => {},
      shouldEmitDebugEvent: () => false,
      llmTimeoutMs: 1000,
      onProviderTelemetry: (event) => telemetry.push(event),
      providerSessionKey: 'web:anon:omni-401'
    });

    expect(result.activeProvider.id).toBe(fallback.id);
    expect(result.effectiveModel).toBe('qwen/qwen3-coder:free');
    expect(runtime.markProviderFailure).toHaveBeenCalledWith(primary.id, expect.objectContaining({ status: 401 }));
    expect(telemetry.some((item) => item.event === 'provider_failover' && item.providerId === fallback.id)).toBe(true);
  });

  it('fails over at the first-token cap when a provider never emits its first chunk', async () => {
    vi.useFakeTimers();
    const runtime = createProviderRuntime();
    const primary = { id: 'web_general_primary_omniroute', wireApi: 'chat_completions', model: 'auto', baseURL: 'https://omni.example/v1', apiKey: 'a' };
    const fallback = { id: 'nvidia_general_1', wireApi: 'chat_completions', model: 'meta/llama-3.3-70b-instruct', baseURL: 'https://integrate.api.nvidia.com/v1', apiKey: 'b' };
    // Provider opens the stream but the first chunk never arrives: this is the
    // slow-cold-gateway case where the whole attempt budget used to burn in
    // silence. The TTFT cap must abort it early and fail over.
    const hangingClient = {
      chat: {
        completions: {
          create: vi.fn((_input, options) => new Promise((resolve) => {
            const pendingNexts = [];
            const stream = {
              response: {},
              [Symbol.asyncIterator]: () => ({
                next: () => new Promise((resolveNext, rejectNext) => {
                  pendingNexts.push({ resolveNext, rejectNext });
                }),
                return: async () => ({ done: true, value: undefined })
              })
            };
            options.signal.addEventListener('abort', () => {
              pendingNexts.forEach(({ rejectNext }) => rejectNext(Object.assign(new Error('aborted'), { name: 'AbortError' })));
              pendingNexts.length = 0;
            });
            resolve(stream);
          }))
        }
      }
    };
    const fallbackClient = createStreamingClient('ttft-fallback-ok');
    const telemetry = [];

    let settled = false;
    const resultPromise = openAiStreamWithFallback({
      currentMessages: [{ role: 'user', content: 'Salam' }],
      effectiveModel: primary.model,
      activeProvider: primary,
      client: hangingClient,
      phaseTools: [],
      isLocalOrFlakyModel: false,
      providerCandidates: [primary, fallback],
      providerRuntime: runtime,
      buildOpenAIClient: (provider) => provider.id === primary.id ? hangingClient : fallbackClient,
      normalizeMessagesForModel: async (messages) => messages,
      mapMessagesToResponsesInput: (messages) => messages,
      mapToolsToResponsesTools: (tools) => tools,
      isResponsesSchemaMismatchError: () => false,
      buildDeepSeekRecoveryMessages: (messages) => messages,
      writeSse: () => {},
      shouldEmitDebugEvent: () => false,
      llmTimeoutMs: 20000,
      firstTokenTimeoutMs: 5000,
      onProviderTelemetry: (event) => telemetry.push(event),
      providerSessionKey: 'web:anon:ttft'
    });
    resultPromise.then(() => { settled = true; });

    // TTFT cap (5s) fires long before the full attempt budget (20s): failover
    // must have already happened by 5.5s.
    await vi.advanceTimersByTimeAsync(5500);
    expect(settled).toBe(true);
    const result = await resultPromise;
    expect(result.activeProvider.id).toBe(fallback.id);
    expect(telemetry.some((item) => item.event === 'provider_failover' && item.providerId === fallback.id)).toBe(true);
    vi.useRealTimers();
  });

  it('does not apply the TTFT cap when there is no fallback candidate', async () => {
    vi.useFakeTimers();
    const runtime = createProviderRuntime();
    const provider = { id: 'only', wireApi: 'chat_completions', model: 'auto', baseURL: 'https://only.example/v1', apiKey: 'a' };
    const hangingClient = {
      chat: {
        completions: {
          create: vi.fn((_input, options) => new Promise((resolve) => {
            const pendingNexts = [];
            const stream = {
              response: {},
              [Symbol.asyncIterator]: () => ({
                next: () => new Promise((resolveNext, rejectNext) => {
                  pendingNexts.push({ resolveNext, rejectNext });
                }),
                return: async () => ({ done: true, value: undefined })
              })
            };
            options.signal.addEventListener('abort', () => {
              pendingNexts.forEach(({ rejectNext }) => rejectNext(Object.assign(new Error('aborted'), { name: 'AbortError' })));
              pendingNexts.length = 0;
            });
            resolve(stream);
          }))
        }
      }
    };

    let settled = false;
    const resultPromise = openAiStreamWithFallback({
      currentMessages: [{ role: 'user', content: 'Salam' }],
      effectiveModel: provider.model,
      activeProvider: provider,
      client: hangingClient,
      phaseTools: [],
      isLocalOrFlakyModel: false,
      providerCandidates: [provider],
      providerRuntime: runtime,
      buildOpenAIClient: () => hangingClient,
      normalizeMessagesForModel: async (messages) => messages,
      mapMessagesToResponsesInput: (messages) => messages,
      mapToolsToResponsesTools: (tools) => tools,
      isResponsesSchemaMismatchError: () => false,
      buildDeepSeekRecoveryMessages: (messages) => messages,
      writeSse: () => {},
      shouldEmitDebugEvent: () => false,
      llmTimeoutMs: 20000,
      firstTokenTimeoutMs: 5000,
      onProviderTelemetry: () => {},
      providerSessionKey: 'web:anon:ttft-single'
    });
    resultPromise.then(() => { settled = true; });

    // No fallback -> a lone provider must keep its full attempt budget; a 5s
    // TTFT cap would otherwise turn a slow-but-alive answer into an error.
    await vi.advanceTimersByTimeAsync(5500);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(15000);
    const result = await resultPromise;
    expect(result.errorEvent).toBeTruthy();
    vi.useRealTimers();
  });

  it('uses a fresh abort signal for a fallback attempt', async () => {
    vi.useFakeTimers();
    const runtime = createProviderRuntime();
    const primary = { id: 'primary', wireApi: 'chat_completions', model: 'gpt-5.5', baseURL: 'https://a.example', apiKey: 'a' };
    const fallback = { id: 'fallback', wireApi: 'chat_completions', model: 'gpt-5.5', baseURL: 'https://b.example', apiKey: 'b' };
    const primaryClient = {
      chat: {
        completions: {
          create: vi.fn((_input, options) => new Promise((_resolve, reject) => {
            options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
          }))
        }
      }
    };
    const fallbackClient = createStreamingClient('fallback-after-timeout');

    const resultPromise = openAiStreamWithFallback({
      currentMessages: [{ role: 'user', content: 'Salam' }],
      effectiveModel: primary.model,
      activeProvider: primary,
      client: primaryClient,
      phaseTools: [],
      isLocalOrFlakyModel: false,
      providerCandidates: [primary, fallback],
      providerRuntime: runtime,
      buildOpenAIClient: (provider) => provider.id === 'fallback' ? fallbackClient : primaryClient,
      normalizeMessagesForModel: async (messages) => messages,
      mapMessagesToResponsesInput: (messages) => messages,
      mapToolsToResponsesTools: (tools) => tools,
      isResponsesSchemaMismatchError: () => false,
      buildDeepSeekRecoveryMessages: (messages) => messages,
      writeSse: () => {},
      shouldEmitDebugEvent: () => false,
      llmTimeoutMs: 10,
      onProviderTelemetry: () => {},
      providerSessionKey: 'web:anon:timeout'
    });

    await vi.advanceTimersByTimeAsync(11);
    const result = await resultPromise;
    expect(result.activeProvider.id).toBe('fallback');
    expect(fallbackClient.chat.completions.create.mock.calls[0][1].signal.aborted).toBe(false);
    vi.useRealTimers();
  });

  it('uses the only fallback as a last resort during cooldown', async () => {
    const runtime = createProviderRuntime();
    const primary = { id: 'primary', wireApi: 'chat_completions', model: 'gpt-5.5', baseURL: 'https://a.example', apiKey: 'a' };
    const fallback = { id: 'fallback', wireApi: 'chat_completions', model: 'qwen:latest', baseURL: 'http://127.0.0.1:11434/v1', apiKey: 'ollama' };
    const primaryClient = createClientThatFails({ status: 401, message: 'invalid key' });
    const fallbackClient = createStreamingClient('last-resort-ok');
    runtime.markProviderFailure('fallback');

    const result = await openAiStreamWithFallback({
      currentMessages: [{ role: 'user', content: 'Salam' }],
      effectiveModel: primary.model,
      activeProvider: primary,
      client: primaryClient,
      phaseTools: [],
      isLocalOrFlakyModel: false,
      providerCandidates: [primary, fallback],
      providerRuntime: runtime,
      buildOpenAIClient: (provider) => provider.id === 'fallback' ? fallbackClient : primaryClient,
      normalizeMessagesForModel: async (messages) => messages,
      mapMessagesToResponsesInput: (messages) => messages,
      mapToolsToResponsesTools: (tools) => tools,
      isResponsesSchemaMismatchError: () => false,
      buildDeepSeekRecoveryMessages: (messages) => messages,
      writeSse: () => {},
      shouldEmitDebugEvent: () => false,
      llmTimeoutMs: 1000,
      onProviderTelemetry: () => {},
      providerSessionKey: 'web:anon:last-resort'
    });

    expect(result.activeProvider.id).toBe('fallback');
  });

  it('returns softer multi-provider network message after alternatives fail', async () => {
    const runtime = createProviderRuntime();
    const primary = { id: 'primary', wireApi: 'responses', model: 'gpt-5.5', baseURL: 'https://a.example', apiKey: 'a' };
    const fallback = { id: 'fallback', wireApi: 'responses', model: 'gpt-5.5', baseURL: 'https://b.example', apiKey: 'b' };
    const error = { status: 503, message: 'Service unavailable' };

    const result = await openAiStreamWithFallback({
      currentMessages: [{ role: 'user', content: 'Salam' }],
      effectiveModel: primary.model,
      activeProvider: primary,
      client: createClientThatFails(error),
      phaseTools: [],
      isLocalOrFlakyModel: false,
      providerCandidates: [primary, fallback],
      providerRuntime: runtime,
      buildOpenAIClient: () => createClientThatFails(error),
      normalizeMessagesForModel: async (messages) => messages,
      mapMessagesToResponsesInput: (messages) => messages,
      mapToolsToResponsesTools: (tools) => tools,
      isResponsesSchemaMismatchError: () => false,
      buildDeepSeekRecoveryMessages: (messages) => messages,
      writeSse: () => {},
      shouldEmitDebugEvent: () => false,
      llmTimeoutMs: 1000,
      onProviderTelemetry: () => {},
      providerSessionKey: 'web:anon:test'
    });

    expect(result.errorEvent.message).toContain('alternativ provider-ləri sınadı');
  });

  it('does not expose invalid-key text when every provider returns 401', async () => {
    const runtime = createProviderRuntime();
    const primary = { id: 'primary', wireApi: 'chat_completions', model: 'auto', baseURL: 'https://a.example', apiKey: 'a' };
    const fallback = { id: 'fallback', wireApi: 'chat_completions', model: 'backup', baseURL: 'https://b.example', apiKey: 'b' };
    const result = await openAiStreamWithFallback({
      currentMessages: [{ role: 'user', content: 'Salam' }],
      effectiveModel: primary.model,
      activeProvider: primary,
      client: createClientThatFails({ status: 401, message: 'invalid api key' }),
      phaseTools: [],
      isLocalOrFlakyModel: false,
      providerCandidates: [primary, fallback],
      providerRuntime: runtime,
      buildOpenAIClient: () => createClientThatFails({ status: 401, message: 'invalid api key' }),
      normalizeMessagesForModel: async (messages) => messages,
      mapMessagesToResponsesInput: (messages) => messages,
      mapToolsToResponsesTools: (tools) => tools,
      isResponsesSchemaMismatchError: () => false,
      buildDeepSeekRecoveryMessages: (messages) => messages,
      writeSse: () => {},
      shouldEmitDebugEvent: () => false,
      llmTimeoutMs: 1000,
      onProviderTelemetry: () => {},
      providerSessionKey: 'web:anon:all-401'
    });

    expect(result.errorEvent.message).not.toContain('API açarı keçərsizdir');
    expect(result.errorEvent.message).toContain('AI provider');
  });

  it('explains a 402 credit/balance error for a single provider', async () => {
    const runtime = createProviderRuntime();
    const provider = { id: 'openrouter_single', wireApi: 'chat_completions', model: 'anthropic/claude-sonnet-4.5', baseURL: 'https://openrouter.ai/api/v1', apiKey: 'sk-or-test' };

    const result = await openAiStreamWithFallback({
      currentMessages: [{ role: 'user', content: 'Salam' }],
      effectiveModel: provider.model,
      activeProvider: provider,
      client: createClientThatFails({ status: 402, message: 'Insufficient Credits' }),
      phaseTools: [],
      isLocalOrFlakyModel: false,
      providerCandidates: [provider],
      providerRuntime: runtime,
      buildOpenAIClient: () => createClientThatFails({ status: 402, message: 'Insufficient Credits' }),
      normalizeMessagesForModel: async (messages) => messages,
      mapMessagesToResponsesInput: (messages) => messages,
      mapToolsToResponsesTools: (tools) => tools,
      isResponsesSchemaMismatchError: () => false,
      buildDeepSeekRecoveryMessages: (messages) => messages,
      writeSse: () => {},
      shouldEmitDebugEvent: () => false,
      llmTimeoutMs: 1000,
      onProviderTelemetry: () => {},
      providerSessionKey: 'web:anon:single-402'
    });

    expect(result.errorEvent).toBeTruthy();
    expect(result.errorEvent.message).toContain('balansı bitib');
    expect(result.errorEvent.message).toContain('402');
  });

  it('emits the real error as a debug event after multi-provider failover', async () => {
    const runtime = createProviderRuntime();
    const primary = { id: 'omniroute', wireApi: 'chat_completions', model: 'auto', baseURL: 'https://omni.example/v1', apiKey: 'a' };
    const fallback = { id: 'nvidia', wireApi: 'chat_completions', model: 'meta/llama-3.3-70b-instruct', baseURL: 'https://integrate.api.nvidia.com/v1', apiKey: 'b' };
    const error = { status: 402, message: 'Insufficient Credits' };
    const events = [];

    const result = await openAiStreamWithFallback({
      currentMessages: [{ role: 'user', content: 'Salam' }],
      effectiveModel: primary.model,
      activeProvider: primary,
      client: createClientThatFails(error),
      phaseTools: [],
      isLocalOrFlakyModel: false,
      providerCandidates: [primary, fallback],
      providerRuntime: runtime,
      buildOpenAIClient: () => createClientThatFails(error),
      normalizeMessagesForModel: async (messages) => messages,
      mapMessagesToResponsesInput: (messages) => messages,
      mapToolsToResponsesTools: (tools) => tools,
      isResponsesSchemaMismatchError: () => false,
      buildDeepSeekRecoveryMessages: (messages) => messages,
      writeSse: (event) => events.push(event),
      shouldEmitDebugEvent: () => true,
      llmTimeoutMs: 1000,
      onProviderTelemetry: () => {},
      providerSessionKey: 'web:anon:failover-debug'
    });

    // Failover pool olduğu üçün istifadəçi ümumi mesaj görür...
    expect(result.errorEvent.message).toContain('AI provider');
    // ...amma BAHAI_DEBUG_EVENTS=1-də real xəta debug hadisəsində gəlir.
    const debugEvent = events.find((event) => event.type === 'debug');
    expect(debugEvent).toBeTruthy();
    expect(debugEvent.info.providerError).toMatchObject({
      status: 402,
      message: 'Insufficient Credits'
    });
    expect(debugEvent.info.providerError.providerId).toBeTruthy();
    expect(debugEvent.info.providerError.baseURL).toBeTruthy();
  });

  it('does not leak provider details in debug events when debug events are off', async () => {
    const runtime = createProviderRuntime();
    const primary = { id: 'primary', wireApi: 'responses', model: 'gpt-5.5', baseURL: 'https://a.example', apiKey: 'a' };
    const fallback = { id: 'fallback', wireApi: 'responses', model: 'gpt-5.5', baseURL: 'https://b.example', apiKey: 'b' };
    const error = { status: 500, message: 'Internal error' };
    const events = [];

    const result = await openAiStreamWithFallback({
      currentMessages: [{ role: 'user', content: 'Salam' }],
      effectiveModel: primary.model,
      activeProvider: primary,
      client: createClientThatFails(error),
      phaseTools: [],
      isLocalOrFlakyModel: false,
      providerCandidates: [primary, fallback],
      providerRuntime: runtime,
      buildOpenAIClient: () => createClientThatFails(error),
      normalizeMessagesForModel: async (messages) => messages,
      mapMessagesToResponsesInput: (messages) => messages,
      mapToolsToResponsesTools: (tools) => tools,
      isResponsesSchemaMismatchError: () => false,
      buildDeepSeekRecoveryMessages: (messages) => messages,
      writeSse: (event) => events.push(event),
      shouldEmitDebugEvent: () => false,
      llmTimeoutMs: 1000,
      onProviderTelemetry: () => {},
      providerSessionKey: 'web:anon:no-debug'
    });

    expect(result.errorEvent).toBeTruthy();
    expect(events.some((event) => event.type === 'debug')).toBe(false);
  });
});
