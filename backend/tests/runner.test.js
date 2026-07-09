import { describe, it, expect, vi } from 'vitest';
import { openAiStreamWithFallback, isRetryableProviderError } from '../chat/runner.js';

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
  it('treats 503 and network-style errors as retryable', () => {
    expect(isRetryableProviderError({ status: 503, message: 'Service Unavailable' }, () => false)).toBe(true);
    expect(isRetryableProviderError({ message: 'fetch failed ECONNREFUSED' }, () => false)).toBe(true);
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
    expect(runtime.markProviderFailure).toHaveBeenCalledWith('primary');
    expect(runtime.markProviderSuccess).toHaveBeenCalledWith('fallback');
    expect(runtime.markSessionProviderFailure).toHaveBeenCalledWith('web:anon:test', 'primary');
    expect(runtime.markSessionProviderSuccess).toHaveBeenCalledWith('web:anon:test', 'fallback');
    expect(telemetry.some((item) => item.event === 'provider_failure' && item.providerId === 'primary')).toBe(true);
    expect(telemetry.some((item) => item.event === 'provider_failover' && item.providerId === 'fallback')).toBe(true);
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
});
