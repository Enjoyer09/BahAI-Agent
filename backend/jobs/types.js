// Durable job domain types and status constants.
// These are shared between the web API, worker loop, and event sink so a job's
// lifecycle is described by one vocabulary rather than ad-hoc strings.

const JobStatus = Object.freeze({
  QUEUED: 'queued',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  RETRYING: 'retrying'
});

const ResourceClass = Object.freeze({
  TEXT: 'text',
  VISION: 'vision',
  BROWSER: 'browser',
  PROCESS: 'process'
});

const EventType = Object.freeze({
  CREATED: 'created',
  CLAIMED: 'claimed',
  PROGRESS: 'progress',
  TOOL_CALL: 'tool_call',
  PROVIDER_TELEMETRY: 'provider_telemetry',
  RETRYING: 'retrying',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  HEARTBEAT: 'heartbeat'
});

const ErrorCode = Object.freeze({
  PROVIDER_5XX: 'PROVIDER_5XX',
  PROVIDER_TIMEOUT: 'PROVIDER_TIMEOUT',
  PROVIDER_429: 'PROVIDER_429',
  CONTEXT_CANCELLED: 'CONTEXT_CANCELLED',
  DEADLINE_EXCEEDED: 'DEADLINE_EXCEEDED',
  INTERNAL: 'INTERNAL',
  MODEL_QUALITY: 'MODEL_QUALITY'
});

function isTerminal(status) {
  return (
    status === JobStatus.COMPLETED ||
    status === JobStatus.FAILED ||
    status === JobStatus.CANCELLED
  );
}

function isActive(status) {
  return status === JobStatus.QUEUED || status === JobStatus.RUNNING || status === JobStatus.RETRYING;
}

function classifyError(err, providerStatus) {
  if (err && err.code === 'CHAT_QUEUE_FULL') return ErrorCode.PROVIDER_429;
  const status = Number(providerStatus || err?.status || 0);
  if (status === 429) return ErrorCode.PROVIDER_429;
  if (status >= 500 && status < 600) return ErrorCode.PROVIDER_5XX;
  if (err && /timeout|aborted/i.test(String(err.message || ''))) return ErrorCode.PROVIDER_TIMEOUT;
  if (err && /deadline/i.test(String(err.message || ''))) return ErrorCode.DEADLINE_EXCEEDED;
  if (err && /cancel/i.test(String(err.message || ''))) return ErrorCode.CONTEXT_CANCELLED;
  return ErrorCode.INTERNAL;
}

module.exports = {
  JobStatus,
  ResourceClass,
  EventType,
  ErrorCode,
  isTerminal,
  isActive,
  classifyError
};
