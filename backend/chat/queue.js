const crypto = require('crypto');

function createChatRuntime({
  maxActiveChatTotal,
  maxActiveChatPerUser,
  chatQueueTimeoutMs,
  chatSlotMaxAgeMs
}) {
  const interactions = new Map();
  const activeChatByUser = new Map();
  const activeChatByConversation = new Map();
  const chatQueue = [];
  let activeChatTotal = 0;

  function cleanupStaleSlots() {
    const now = Date.now();
    for (const [cid, info] of activeChatByConversation.entries()) {
      if (now - info.startedAt > chatSlotMaxAgeMs) {
        console.warn(`⚠️ Force-releasing stale chat slot: conversation=${cid}, age=${Math.round((now - info.startedAt) / 1000)}s`);
        releaseChatSlot(info.userId, cid);
      }
    }
  }

  function acquireChatSlot(userId, conversationId) {
    const uid = String(userId || 'anon');
    const cid = String(conversationId || 'default');

    cleanupStaleSlots();

    if (activeChatByConversation.has(cid)) {
      const existing = activeChatByConversation.get(cid);
      const age = Date.now() - existing.startedAt;
      if (age > chatSlotMaxAgeMs) {
        releaseChatSlot(existing.userId, cid);
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
    activeChatByConversation.set(cid, { userId: uid, startedAt: Date.now(), abortCurrent: null });
    return true;
  }

  function supersedeConversation(userId, conversationId) {
    const cid = String(conversationId || 'default');
    const existing = activeChatByConversation.get(cid);
    if (!existing) return false;
    if (typeof existing.abortCurrent === 'function') {
      try {
        existing.abortCurrent('superseded');
      } catch {
        // ignore abort hook errors
      }
    }
    releaseChatSlot(existing.userId || userId, cid);
    return true;
  }

  function removeFromChatQueue(ticketId) {
    const idx = chatQueue.findIndex((x) => x.id === ticketId);
    if (idx >= 0) chatQueue.splice(idx, 1);
  }

  function drainChatQueue() {
    let progressed = true;
    while (progressed && chatQueue.length > 0) {
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

  function releaseChatSlot(userId, conversationId) {
    const uid = String(userId || 'anon');
    const cid = String(conversationId || 'default');

    activeChatByConversation.delete(cid);

    const byUser = activeChatByUser.get(uid) || 0;
    if (byUser <= 1) activeChatByUser.delete(uid);
    else activeChatByUser.set(uid, byUser - 1);
    if (activeChatTotal > 0) activeChatTotal -= 1;

    drainChatQueue();
  }

  async function acquireChatSlotQueued(userId, conversationId, req) {
    cleanupStaleSlots();
    if (acquireChatSlot(userId, conversationId)) return true;

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
          reject(new Error('Client disconnected while waiting in queue'));
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
          reject(new Error('Queue timeout'));
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
    const cid = String(conversationId || 'default');
    const existing = activeChatByConversation.get(cid);
    if (!existing) return false;
    if (String(existing.userId || 'anon') !== String(userId || 'anon')) return false;
    activeChatByConversation.set(cid, {
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
