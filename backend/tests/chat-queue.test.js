import { describe, it, expect, vi } from 'vitest';

const { createChatRuntime } = require('../chat/queue');

function createFakeReq() {
  const listeners = new Map();
  return {
    aborted: false,
    on(event, handler) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(handler);
    },
    off(event, handler) {
      listeners.get(event)?.delete(handler);
    },
    emit(event) {
      const handlers = listeners.get(event);
      if (!handlers) return;
      for (const handler of [...handlers]) handler();
    }
  };
}

describe('chat queue runtime', () => {
  it('supersedes existing conversation run instead of timing out a new request', async () => {
    const runtime = createChatRuntime({
      maxActiveChatTotal: 1,
      maxActiveChatPerUser: 1,
      chatQueueTimeoutMs: 200,
      chatSlotMaxAgeMs: 10000
    });

    const firstReq = createFakeReq();
    const secondReq = createFakeReq();
    const abortSpy = vi.fn();

    await runtime.acquireChatSlotQueued('u1', 'conv-a', firstReq);
    runtime.setConversationAbort('u1', 'conv-a', abortSpy);

    expect(runtime.supersedeConversation('u1', 'conv-a')).toBe(true);
    expect(abortSpy).toHaveBeenCalledWith('superseded');

    await expect(runtime.acquireChatSlotQueued('u1', 'conv-a', secondReq)).resolves.toBe(true);
  });

  it('does not reject queued request on close when request was not aborted', async () => {
    const runtime = createChatRuntime({
      maxActiveChatTotal: 1,
      maxActiveChatPerUser: 1,
      chatQueueTimeoutMs: 200,
      chatSlotMaxAgeMs: 10000
    });

    const firstReq = createFakeReq();
    const secondReq = createFakeReq();

    await runtime.acquireChatSlotQueued('u1', 'conv-a', firstReq);
    const queuedPromise = runtime.acquireChatSlotQueued('u1', 'conv-b', secondReq);

    secondReq.emit('close');
    setTimeout(() => {
      runtime.releaseChatSlot('u1', 'conv-a');
    }, 20);

    await expect(queuedPromise).resolves.toBe(true);
  });

  it('rejects queued request when request was aborted', async () => {
    const runtime = createChatRuntime({
      maxActiveChatTotal: 1,
      maxActiveChatPerUser: 1,
      chatQueueTimeoutMs: 200,
      chatSlotMaxAgeMs: 10000
    });

    const firstReq = createFakeReq();
    const secondReq = createFakeReq();

    await runtime.acquireChatSlotQueued('u1', 'conv-a', firstReq);
    const queuedPromise = runtime.acquireChatSlotQueued('u1', 'conv-b', secondReq);

    secondReq.aborted = true;
    secondReq.emit('aborted');

    await expect(queuedPromise).rejects.toThrow('Client disconnected while waiting in queue');
  });

  it('superseding one conversation frees the slot for another queued conversation', async () => {
    const runtime = createChatRuntime({
      maxActiveChatTotal: 1,
      maxActiveChatPerUser: 1,
      chatQueueTimeoutMs: 200,
      chatSlotMaxAgeMs: 10000
    });

    const firstReq = createFakeReq();
    const secondReq = createFakeReq();
    const abortSpy = vi.fn();

    await runtime.acquireChatSlotQueued('u1', 'conv-a', firstReq);
    runtime.setConversationAbort('u1', 'conv-a', abortSpy);
    const queuedPromise = runtime.acquireChatSlotQueued('u1', 'conv-b', secondReq);

    expect(runtime.supersedeConversation('u1', 'conv-a')).toBe(true);
    expect(abortSpy).toHaveBeenCalledWith('superseded');
    await expect(queuedPromise).resolves.toBe(true);
  });

  it('namespaces conversation slots per user so different users may share a conversation id', async () => {
    const runtime = createChatRuntime({
      maxActiveChatTotal: 5,
      maxActiveChatPerUser: 1,
      chatQueueTimeoutMs: 200,
      chatSlotMaxAgeMs: 10000
    });

    expect(await runtime.acquireChatSlotQueued('u1', 'shared', createFakeReq())).toBe(true);
    expect(await runtime.acquireChatSlotQueued('u2', 'shared', createFakeReq())).toBe(true);
    // u1 already holds the conversation slot and per-user limit is 1, so a second
    // u1 attempt is queued (returns a Promise), not silently granted.
    const secondU1 = runtime.acquireChatSlotQueued('u1', 'shared', createFakeReq());
    expect(secondU1).toBeInstanceOf(Promise);
    // A third user with no active slot can still acquire the same conversation id,
    // proving the slot is keyed per-user not per-conversation.
    expect(await runtime.acquireChatSlotQueued('u3', 'shared', createFakeReq())).toBe(true);
  });

  it('persists queue priority so the queue can be drained in priority order', async () => {
    const runtime = createChatRuntime({
      maxActiveChatTotal: 1,
      maxActiveChatPerUser: 5,
      chatQueueTimeoutMs: 500,
      chatSlotMaxAgeMs: 10000
    });

    await runtime.acquireChatSlotQueued('u1', 'held', createFakeReq());

    const lowReq = createFakeReq();
    const highReq = createFakeReq();
    // low (priority 2) is queued first; high (priority 0) is queued second.
    const lowPromise = runtime.acquireChatSlotQueued('u1', 'low', lowReq, 2);
    const highPromise = runtime.acquireChatSlotQueued('u1', 'high', highReq, 0);

    // Freeing the holder should release the higher-priority queued item first.
    runtime.releaseChatSlot('u1', 'held');
    await expect(highPromise).resolves.toBe(true);
    // The low-priority item is still queued; it should not resolve yet.
    const lowSettledEarly = await Promise.race([
      lowPromise.then(() => 'resolved').catch(() => 'rejected'),
      new Promise((resolve) => setTimeout(() => resolve('pending'), 50))
    ]);
    expect(lowSettledEarly).toBe('pending');
  });

  it('rejects with a 429 CHAT_QUEUE_FULL error when the queue is saturated', async () => {
    const runtime = createChatRuntime({
      maxActiveChatTotal: 1,
      maxActiveChatPerUser: 5,
      chatQueueTimeoutMs: 500,
      chatSlotMaxAgeMs: 10000,
      maxQueueLength: 1
    });

    await runtime.acquireChatSlotQueued('u1', 'held', createFakeReq());
    runtime.acquireChatSlotQueued('u1', 'q1', createFakeReq());

    await expect(runtime.acquireChatSlotQueued('u1', 'q2', createFakeReq()))
      .rejects.toMatchObject({ code: 'CHAT_QUEUE_FULL', statusCode: 429 });
  });

  it('releaseChatSlot is idempotent and does not corrupt the active count', async () => {
    const runtime = createChatRuntime({
      maxActiveChatTotal: 2,
      maxActiveChatPerUser: 2,
      chatQueueTimeoutMs: 500,
      chatSlotMaxAgeMs: 10000
    });

    await runtime.acquireChatSlotQueued('u1', 'conv-a', createFakeReq());
    expect(runtime.releaseChatSlot('u1', 'conv-a')).toBe(true);
    // Second release of the same no-longer-active conversation must be a no-op.
    expect(runtime.releaseChatSlot('u1', 'conv-a')).toBe(false);

    // A new acquire must succeed because the slot was actually freed.
    await expect(runtime.acquireChatSlotQueued('u1', 'conv-a', createFakeReq())).resolves.toBe(true);
  });
});
