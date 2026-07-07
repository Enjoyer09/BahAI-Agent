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
});
