// Real job executor for background jobs. It reuses the existing provider
// candidate list (OmniRoute is primary for web_chat) and performs ONE bounded
// chat completion per job. This is intentionally a single-shot completion: it
// proves the durable pipeline against the real provider path without re-running
// the full multi-step agent session for every background job. The multi-step
// agent can be plugged in later behind the same `execute` contract.

const { buildProviderCandidates, buildOpenAIClient } = require('../chat/providers');

async function createAgentExecutor({ env = process.env } = {}) {
  return async function execute({ job, sink, signal }) {
    const payload = job.payload || {};
    const messages = Array.isArray(payload.messages)
      ? payload.messages
      : [{ role: 'user', content: String(payload.prompt || payload.message || '') }];

    if (!messages.length || !String(messages[messages.length - 1].content || '').trim()) {
      return { status: 'failed', errorCode: 'INVALID_PAYLOAD', errorMessage: 'Boş prompt' };
    }

    const candidates = buildProviderCandidates({
      frontendApiKey: '',
      frontendBaseUrl: '',
      frontendModel: 'auto',
      productMode: 'web_chat',
      executionMode: 'cloud',
      hasImageAttachment: false,
      webTaskType: 'general',
      env
    });

    if (!candidates.length) {
      return { status: 'failed', errorCode: 'NO_PROVIDER', errorMessage: 'Heç bir provider konfiqurasiya edilməyib' };
    }

    let lastErr = null;
    for (const provider of candidates) {
      try {
        const client = buildOpenAIClient(provider);
        const resp = await client.chat.completions.create(
          {
            model: provider.model,
            messages,
            stream: false,
            timeout: parseInt(env.JOB_EXECUTOR_TIMEOUT_MS || '60000', 10)
          },
          { signal }
        );
        const text = resp?.choices?.[0]?.message?.content || '';
        await sink.providerTelemetry({ providerId: provider.id, status: 200, event: 'success' });
        return { status: 'completed', result: { content: text, providerId: provider.id } };
      } catch (err) {
        lastErr = err;
        await sink.providerTelemetry({
          providerId: provider.id,
          status: err?.status || 0,
          event: 'error',
          message: String(err?.message || '').slice(0, 200)
        }).catch(() => {});
        // Try the next candidate unless this was an explicit cancellation.
        if (signal && signal.aborted) break;
      }
    }

    const code = lastErr && lastErr.status === 429 ? 'PROVIDER_429'
      : lastErr && lastErr.status >= 500 ? 'PROVIDER_5XX'
      : 'INTERNAL';
    return { status: 'failed', errorCode: code, errorMessage: String(lastErr?.message || 'provider failed') };
  };
}

module.exports = { createAgentExecutor };
