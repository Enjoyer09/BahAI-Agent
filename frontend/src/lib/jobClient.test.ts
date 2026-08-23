// ==========================================
// jobClient Tests — durable job admission, reconnectable SSE, and event mapping
// ==========================================

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  submitJob,
  cancelJob,
  connectJobEvents,
  mapBackendJobEventToSSE,
} from './jobClient';
import type { JobEvent } from './jobTypes';

const BASE = 'http://localhost:3001';

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// Build a Response whose body is an SSE stream of the given `data:` lines.
function sseResponse(lines: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const line of lines) {
        controller.enqueue(encoder.encode(line + '\n\n'));
      }
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

// ==========================================
// mapBackendJobEventToSSE
// ==========================================
describe('mapBackendJobEventToSSE', () => {
  it('maps progress -> assistant_delta', () => {
    const sse = mapBackendJobEventToSSE({ type: 'progress', content: 'Salam' } as JobEvent);
    expect(sse).toEqual({ type: 'assistant_delta', content: 'Salam' });
  });

  it('returns null for progress without content', () => {
    expect(mapBackendJobEventToSSE({ type: 'progress' } as JobEvent)).toBeNull();
  });

  it('maps tool_call with result -> tool_result', () => {
    const sse = mapBackendJobEventToSSE({ type: 'tool_call', tool: 'read_file', result: 'file contents' } as JobEvent);
    expect(sse?.type).toBe('tool_result');
    expect((sse as any).result).toBe('file contents');
  });

  it('maps tool_call without result -> tool_execution', () => {
    const sse = mapBackendJobEventToSSE({ type: 'tool_call', tool: 'run_bash', tool_call_id: 't1' } as JobEvent);
    expect(sse).toEqual({ type: 'tool_execution', tool: 'run_bash', args: '', tool_call_id: 't1' });
  });

  it('maps provider_telemetry -> provider_telemetry', () => {
    const sse = mapBackendJobEventToSSE({
      type: 'provider_telemetry',
      event: 'provider_failover',
      providerId: 'web_general_primary',
      status: 429,
      message: 'retry',
    } as JobEvent);
    expect(sse).toEqual({
      type: 'provider_telemetry',
      event: 'provider_failover',
      providerId: 'web_general_primary',
      status: 429,
      message: 'retry',
    });
  });

  it('maps completed -> assistant_message from result.content', () => {
    const sse = mapBackendJobEventToSSE({
      type: 'completed',
      jobId: 'j1',
      result: { content: 'Cavab mətni' },
    } as JobEvent);
    expect(sse?.type).toBe('assistant_message');
    expect((sse as any).message.content).toBe('Cavab mətni');
  });

  it('returns null for completed without result content', () => {
    expect(mapBackendJobEventToSSE({ type: 'completed' } as JobEvent)).toBeNull();
  });

  it('maps failed -> error', () => {
    const sse = mapBackendJobEventToSSE({ type: 'failed', errorMessage: 'Xəta baş verdi', errorCode: 'E1' } as JobEvent);
    expect(sse).toEqual({ type: 'error', message: 'Xəta baş verdi' });
  });

  it('falls back to errorCode in error mapping when message missing', () => {
    const sse = mapBackendJobEventToSSE({ type: 'failed', errorCode: 'E2' } as JobEvent);
    expect((sse as any).message).toBe('E2');
  });

  it('returns null for lifecycle/noise events', () => {
    for (const t of ['created', 'claimed', 'retrying', 'heartbeat'] as const) {
      expect(mapBackendJobEventToSSE({ type: t } as JobEvent)).toBeNull();
    }
  });
});

// ==========================================
// submitJob
// ==========================================
describe('submitJob', () => {
  it('POSTs the job and returns the parsed result with auth header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ jobId: 'job_1', status: 'queued', queuePosition: 3 })
    );
    vi.stubGlobal('fetch', fetchMock);
    localStorage.setItem('auth_token', 'tok-abc');

    const result = await submitJob({ conversationId: 'c1', payload: { messages: [] } });

    expect(result.jobId).toBe('job_1');
    expect(result.status).toBe('queued');
    expect(result.queuePosition).toBe(3);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE}/api/jobs`);
    expect(init.method).toBe('POST');
    const headers = new Headers(init.headers as HeadersInit);
    expect(headers.get('Authorization')).toBe('Bearer tok-abc');
    const body = JSON.parse(init.body as string);
    expect(body.conversationId).toBe('c1');
    expect(body.resourceClass).toBe('text');
    expect(body.priority).toBe(1);
    expect(body.maxAttempts).toBe(3);
  });

  it('throws a normalized error on non-ok response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: 'Növbə doludur', code: 'QUEUE_FULL' }, 429));
    vi.stubGlobal('fetch', fetchMock);

    await expect(submitJob({ payload: {} })).rejects.toThrow('Növbə doludur');
  });
});

// ==========================================
// cancelJob
// ==========================================
describe('cancelJob', () => {
  it('POSTs to the cancel endpoint and returns the job', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ job: { id: 'job_1', status: 'cancelled' } })
    );
    vi.stubGlobal('fetch', fetchMock);

    const job = await cancelJob('job_1');

    expect(job?.status).toBe('cancelled');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE}/api/jobs/job_1/cancel`);
    expect(init.method).toBe('POST');
  });

  it('returns null on 404', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await cancelJob('missing')).toBeNull();
  });
});

// ==========================================
// connectJobEvents (reconnectable SSE consumer)
// ==========================================
describe('connectJobEvents', () => {
  it('parses SSE data lines and emits a terminal event at the end', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      sseResponse([
        'data: {"type":"claimed","seq":1,"jobId":"j1"}',
        'data: {"type":"progress","seq":2,"jobId":"j1","content":"Salam"}',
        'data: {"type":"terminal"}',
      ])
    );
    vi.stubGlobal('fetch', fetchMock);

    const events: JobEvent[] = [];
    const close = connectJobEvents({
      jobId: 'j1',
      afterSeq: 0,
      onEvent: (e) => events.push(e),
    });

    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(events.map((e) => e.type)).toEqual(['claimed', 'progress', 'terminal']);
    close();
  });

  it('emits a terminal event immediately when the signal is already aborted', () => {
    const controller = new AbortController();
    controller.abort();
    const events: JobEvent[] = [];
    connectJobEvents({
      jobId: 'j1',
      onEvent: (e) => events.push(e),
      signal: controller.signal,
    });
    expect(events.map((e) => e.type)).toEqual(['terminal']);
  });

  it('emits terminal when the stream response is not ok', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);

    const events: JobEvent[] = [];
    const close = connectJobEvents({ jobId: 'j1', onEvent: (e) => events.push(e) });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(events.some((e) => e.type === 'terminal')).toBe(true);
    close();
  });
});
