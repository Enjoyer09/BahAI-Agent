const crypto = require('crypto');

function createChatRuntime({
  maxActiveChatTotal,
  maxActiveChatPerUser,
  chatQueueTimeoutMs,
  chatSlotMaxAgeMs,
  maxQueueLength = 100
}) {
  const interactions = new Map();
  const activeChatByUser = new Map();
  const activeChatByConversation = new Map();
  const chatQueue = [];
  let activeChatTotal = 0;

  function conversationKey(userId, conversationId) {
    return `${String(userId || 'anon')}:${String(conversationId || 'default')}`;
  }

  function createQueueError(message, code, statusCode = 503, retryAfterSeconds = 1) {
    const error = new Error(message);
    error.code = code;
    error.statusCode = statusCode;
    error.retryAfterSeconds = retryAfterSeconds;
    return error;
  }

  function cleanupStaleSlots() {
    const now = Date.now();
    for (const [key, info] of activeChatByConversation.entries()) {
      if (now - info.startedAt > chatSlotMaxAgeMs) {
        console.warn(`⚠️ Force-releasing stale chat slot: conversation=${info.conversationId}, age=${Math.round((now - info.startedAt) / 1000)}s`);
        releaseChatSlot(info.userId, info.conversationId, key);
      }
    }
  }

  function acquireChatSlot(userId, conversationId) {
    const uid = String(userId || 'anon');
    const cid = String(conversationId || 'default');
    const key = conversationKey(uid, cid);

    cleanupStaleSlots();

    if (activeChatByConversation.has(key)) {
      const existing = activeChatByConversation.get(key);
      const age = Date.now() - existing.startedAt;
      if (age > chatSlotMaxAgeMs) {
        releaseChatSlot(existing.userId, existing.conversationId, key);
      } else {
        return false;
      }
    }

    const byUser = activeChatByUser.get(uid) || 0;
    if (activeChatTotal >= maxActiveChatTotal || byUser >= maxActiveChatPerUser) {
      return false;
    }

    activeChatTotal += 1;
    activeChatByUser.set(uid, byUser + 1);
    activeChatByConversation.set(key, {
      userId: uid,
      conversationId: cid,
      startedAt: Date.now(),
      abortCurrent: null
    });
    return true;
  }

  function supersedeConversation(userId, conversationId) {
    const uid = String(userId || 'anon');
    const cid = String(conversationId || 'default');
    const key = conversationKey(uid, cid);
    const existing = activeChatByConversation.get(key);
    if (!existing) return false;
    if (typeof existing.abortCurrent === 'function') {
      try {
        existing.abortCurrent('superseded');
      } catch {
        // ignore abort hook errors
      }
    }
    releaseChatSlot(existing.userId || uid, cid, key);
    return true;
  }

  function removeFromChatQueue(ticketId) {
    const idx = chatQueue.findIndex((x) => x.id === ticketId);
    if (idx >= 0) chatQueue.splice(idx, 1);
  }

  function drainChatQueue() {
    let progressed = true;
    while (progressed && chatQueue.length > 0) {
      // Priority sorting: User (0) > Scheduled (1) > Background (2)
      chatQueue.sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
      progressed = false;
      for (let i = 0; i < chatQueue.length; i += 1) {
        const item = chatQueue[i];
        if (acquireChatSlot(item.userId, item.conversationId)) {
          chatQueue.splice(i, 1);
          if (item.timer) clearTimeout(item.timer);
          item.resolve(true);
          progressed = true;
          break;
        }
      }
    }
  }

  function releaseChatSlot(userId, conversationId, knownKey = null) {
    const uid = String(userId || 'anon');
    const cid = String(conversationId || 'default');
    const key = knownKey || conversationKey(uid, cid);
    const existing = activeChatByConversation.get(key);
    if (!existing) return false;

    activeChatByConversation.delete(key);

    const ownerId = String(existing.userId || uid);
    const byUser = activeChatByUser.get(ownerId) || 0;
    if (byUser <= 1) activeChatByUser.delete(ownerId);
    else activeChatByUser.set(ownerId, byUser - 1);
    if (activeChatTotal > 0) activeChatTotal -= 1;

    drainChatQueue();
    return true;
  }

  async function acquireChatSlotQueued(userId, conversationId, req, priority = 0) {
    cleanupStaleSlots();
    if (acquireChatSlot(userId, conversationId)) return true;

    if (chatQueue.length >= maxQueueLength) {
      throw createQueueError('Chat queue is full', 'CHAT_QUEUE_FULL', 429, 2);
    }

    const ticketId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      let settled = false;
      const finalize = (fn) => {
        if (settled) return;
        settled = true;
        req.off('aborted', onAborted);
        req.off('close', onClose);
        fn();
      };

      const onAborted = () => {
        finalize(() => {
          removeFromChatQueue(ticketId);
          reject(createQueueError('Client disconnected while waiting in queue', 'CHAT_QUEUE_CLIENT_DISCONNECTED', 499, 0));
        });
      };

      const onClose = () => {
        // `close` can fire after a normal request lifecycle as well, so treat
        // it as a disconnect only when the request was actually aborted.
        if (!req.aborted) return;
        onAborted();
      };

      const onTimeout = () => {
        finalize(() => {
          removeFromChatQueue(ticketId);
          reject(createQueueError('Queue timeout', 'CHAT_QUEUE_TIMEOUT', 503, 2));
        });
      };

      if (req.aborted) {
        onAborted();
        return;
      }

      const timer = setTimeout(onTimeout, chatQueueTimeoutMs);
      chatQueue.push({
        id: ticketId,
        userId: String(userId || 'anon'),
        conversationId: String(conversationId || 'default'),
        priority: Number.isFinite(Number(priority)) ? Number(priority) : 0,
        resolve: () => {
          finalize(() => resolve(true));
        },
        reject,
        timer
      });
      req.on('aborted', onAborted);
      req.on('close', onClose);
    });
  }

  function createInteraction(interactionId, payload) {
    const record = {
      ...payload,
      id: interactionId,
      status: payload.status || 'pending',
      createdAt: payload.createdAt || Date.now()
    };
    interactions.set(interactionId, record);
    return record;
  }

  function getInteraction(interactionId) {
    return interactions.get(interactionId) || null;
  }

  function deleteInteraction(interactionId) {
    interactions.delete(interactionId);
  }

  function listInteractionsByUser(userId) {
    const uid = String(userId || 'anon');
    return [...interactions.values()].filter((item) => String(item.userId || 'anon') === uid);
  }

  function waitForApproval(approvalId, timeoutMs = 300000) {
    return new Promise((resolve, reject) => {
      const pending = interactions.get(approvalId);
      if (!pending) return reject(new Error('Approval tapılmadı'));

      pending._resolve = resolve;
      pending._reject = reject;
      interactions.set(approvalId, pending);

      setTimeout(() => {
        if (interactions.has(approvalId)) {
          const active = interactions.get(approvalId);
          if (active.status === 'pending' && active.kind === 'approval') {
            interactions.delete(approvalId);
            reject(new Error('Approval vaxtı bitdi (5 dəqiqə)'));
          }
        }
      }, timeoutMs);
    });
  }

  function createCheckpoint(checkpointId, payload) {
    return createInteraction(checkpointId, {
      ...payload,
      kind: 'checkpoint',
      status: 'pending',
      createdAt: Date.now()
    });
  }

  function resolveCheckpoint(checkpointId, decision) {
    const pending = interactions.get(checkpointId);
    if (!pending) return null;
    interactions.delete(checkpointId);
    return {
      ...pending,
      decision
    };
  }

  function setConversationAbort(userId, conversationId, abortCurrent) {
    const uid = String(userId || 'anon');
    const cid = String(conversationId || 'default');
    const key = conversationKey(uid, cid);
    const existing = activeChatByConversation.get(key);
    if (!existing) return false;
    activeChatByConversation.set(key, {
      ...existing,
      abortCurrent: typeof abortCurrent === 'function' ? abortCurrent : null
    });
    return true;
  }

  return {
    interactions,
    acquireChatSlotQueued,
    releaseChatSlot,
    waitForApproval,
    supersedeConversation,
    setConversationAbort,
    createInteraction,
    getInteraction,
    deleteInteraction,
    listInteractionsByUser,
    createCheckpoint,
    resolveCheckpoint
  };
}

module.exports = {
  createChatRuntime
};
