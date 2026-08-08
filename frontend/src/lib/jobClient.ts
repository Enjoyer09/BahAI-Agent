// ==========================================
// Job API client — durable background agent admission + reconnectable events
// ==========================================

import { API_BASE_URL } from './constants';
import type { SSEEvent } from './types';
import type { Job, JobEvent, JobStatus } from './jobTypes';

function authHeader(): Record<string, string> {
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('auth_token') : null;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers || {});
  for (const [key, value] of Object.entries(authHeader())) headers.set(key, value);
  return fetch(input, { ...init, headers });
}

export interface SubmitJobInput {
  conversationId?: string | null;
  resourceClass?: string;
  priority?: number;
  idempotencyKey?: string | null;
  maxAttempts?: number;
  payload: any;
}

export interface SubmitJobResult {
  jobId: string;
  status: JobStatus;
  queuePosition: number;
}

export async function submitJob(input: SubmitJobInput): Promise<SubmitJobResult> {
  const response = await apiFetch(`${API_BASE_URL}/api/jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      conversationId: input.conversationId ?? null,
      resourceClass: input.resourceClass ?? 'text',
      priority: input.priority ?? 1,
      idempotencyKey: input.idempotencyKey ?? null,
      maxAttempts: input.maxAttempts ?? 3,
      payload: input.payload,
    }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    const err: any = new Error(data?.error || `Job qəbul edilmədi (${response.status})`);
    err.status = response.status;
    err.code = data?.code;
    throw err;
  }
  return (await response.json()) as SubmitJobResult;
}

export async function getJob(jobId: string): Promise<Job | null> {
  const response = await apiFetch(`${API_BASE_URL}/api/jobs/${encodeURIComponent(jobId)}`);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Job statusu alına bilmədi (${response.status})`);
  const data = (await response.json()) as { job: Job };
  return data.job;
}

export async function listJobs(limit = 50): Promise<Job[]> {
  const response = await apiFetch(`${API_BASE_URL}/api/jobs?limit=${encodeURIComponent(String(limit))}`);
  if (!response.ok) throw new Error(`Job siyahısı alına bilmədi (${response.status})`);
  const data = (await response.json()) as { jobs: Job[] };
  return data.jobs || [];
}

export async function cancelJob(jobId: string): Promise<Job | null> {
  const response = await apiFetch(`${API_BASE_URL}/api/jobs/${encodeURIComponent(jobId)}/cancel`, {
    method: 'POST',
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Job ləğv edilə bilmədi (${response.status})`);
  const data = (await response.json()) as { job: Job };
  return data.job;
}

export interface ConnectEventsOptions {
  jobId: string;
  afterSeq?: number;
  onEvent: (event: JobEvent) => void;
  signal?: AbortSignal;
}

// Open the reconnectable SSE event stream for a job. The backend polls durable
// storage every 500ms and sends a `terminal` event once the job reaches a
// terminal status, then closes the connection. Returns a cleanup function.
export function connectJobEvents({
  jobId,
  afterSeq = 0,
  onEvent,
  signal,
}: ConnectEventsOptions): () => void {
  const controller = new AbortController();
  const acSignal = signal || controller.signal;
  let closed = false;
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let activeFetch: Promise<Response> | null = null;

  const url = `${API_BASE_URL}/api/jobs/${encodeURIComponent(jobId)}/events?stream=1&after=${encodeURIComponent(String(afterSeq))}`;

  const close = () => {
    if (closed) return;
    closed = true;
    controller.abort();
    try {
      reader?.cancel().catch(() => {});
    } catch {
      /* ignore */
    }
  };

  if (acSignal.aborted) {
    onEvent({ type: 'terminal' } as JobEvent);
    return close;
  }
  acSignal.addEventListener('abort', close, { once: true });

  const run = async () => {
    try {
      const response = await apiFetch(url, { signal: acSignal });
      if (!response.ok || !response.body) {
        onEvent({ type: 'terminal' } as JobEvent);
        return;
      }
      activeFetch = Promise.resolve(response);
      reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let done = false;
      while (!done && !closed) {
        const { value, done: readerDone } = await reader.read();
        done = readerDone;
        if (value) {
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const raw = line.slice(6).trim();
            if (!raw || raw === '[DONE]') continue;
            try {
              const event = JSON.parse(raw) as JobEvent;
              onEvent(event);
              if (event.type === 'terminal') {
                close();
                return;
              }
            } catch {
              /* ignore malformed chunk */
            }
          }
        }
      }
    } catch {
      if (!closed) onEvent({ type: 'terminal' } as JobEvent);
    } finally {
      if (!closed) onEvent({ type: 'terminal' } as JobEvent);
    }
  };

  run();
  return close;
}

// Translate a durable job event into the SSEEvent shape the existing chat
// pipeline (handleSSEEvent) consumes. Returns null for events that carry no
// chat-rendering payload (e.g. heartbeat / claimed).
export function mapBackendJobEventToSSE(event: JobEvent): SSEEvent | null {
  switch (event.type) {
    case 'progress':
      if (event.content) return { type: 'assistant_delta', content: String(event.content) };
      return null;
    case 'tool_call':
      if (event.result != null) {
        // A completed tool call: surface both the start and the result so the
        // existing handlers paint the tool node and its output.
        return { type: 'tool_result', result: event.result } as SSEEvent;
      }
      return { type: 'tool_execution', tool: event.tool || '', args: '', tool_call_id: event.tool_call_id } as SSEEvent;
    case 'provider_telemetry':
      return {
        type: 'provider_telemetry',
        event: event.event || 'telemetry',
        providerId: event.providerId,
        status: event.status,
        message: event.message,
      } as SSEEvent;
    case 'completed':
      if (event.result && typeof event.result.content === 'string') {
        return {
          type: 'assistant_message',
          message: { id: `job_${event.jobId || 'x'}`, role: 'assistant', content: event.result.content, tool_calls: undefined },
        } as SSEEvent;
      }
      return null;
    case 'failed':
      return {
        type: 'error',
        message: event.errorMessage || event.errorCode || 'Job uğursuz oldu',
      } as SSEEvent;
    default:
      return null;
  }
}
