// Event sink for background jobs. Every durable job emits a monotonic event
// stream (stored in agent_job_events) so a browser can reconnect from the last
// seen seq after a disconnect or reload. The sink can ALSO fan out to a live SSE
// response for the currently-connected client, without coupling job execution to
// the HTTP request lifecycle.

const repo = require('./repository');
const { EventType, JobStatus } = require('./types');

function createEventSink({ jobId, liveRes = null, writeSse = null }) {
  let lastSeq = 0;

  function sanitize(payload) {
    if (payload == null) return {};
    const out = { ...payload };
    // Never leak provider keys, secrets, or raw prompt text into stored events.
    for (const key of ['apiKey', 'api_key', 'secret', 'password', 'token', 'baseURL', 'baseUrl']) {
      if (key in out) out[key] = '[redacted]';
    }
    return out;
  }

  async function emit(type, payload = {}) {
    const stored = await repo.appendEvent({ jobId, type, payload: sanitize(payload) });
    if (stored) lastSeq = Number(stored.seq);
    if (liveRes && writeSse) {
      try {
        writeSse(liveRes, { type, jobId, seq: stored ? Number(stored.seq) : undefined, ...sanitize(payload) });
      } catch {
        // live stream may have closed; durable storage already has the event.
      }
    }
    return stored;
  }

  return {
    emit,
    get lastSeq() { return lastSeq; },
    created: (payload) => emit(EventType.CREATED, payload),
    claimed: (payload) => emit(EventType.CLAIMED, payload),
    progress: (payload) => emit(EventType.PROGRESS, payload),
    toolCall: (payload) => emit(EventType.TOOL_CALL, payload),
    providerTelemetry: (payload) => emit(EventType.PROVIDER_TELEMETRY, payload),
    retrying: (payload) => emit(EventType.RETRYING, payload),
    completed: (payload) => emit(EventType.COMPLETED, payload),
    failed: (payload) => emit(EventType.FAILED, payload),
    cancelled: (payload) => emit(EventType.CANCELLED, payload),
    heartbeat: (payload) => emit(EventType.HEARTBEAT, payload)
  };
}

// Map a terminal job status to its event type for the sink.
function terminalEventType(status) {
  if (status === JobStatus.COMPLETED) return EventType.COMPLETED;
  if (status === JobStatus.FAILED) return EventType.FAILED;
  if (status === JobStatus.CANCELLED) return EventType.CANCELLED;
  return EventType.FAILED;
}

module.exports = { createEventSink, terminalEventType, EventType };
