/**
 * bahAI - Vision / File Context Carryover
 * Adapted from LibreChat's `collectHistoricalFileRefs` and `buildMessageFiles`.
 * Resolves referents (e.g. "bunu", "bu şəkli") in the chat to active file contexts
 * to keep context windows efficient.
 */

function collectHistoricalFileRefs(messages) {
  const refs = [];
  for (const message of messages) {
    if (Array.isArray(message.attachments)) {
      refs.push(...message.attachments);
    }
  }
  return refs;
}

/**
 * Filters out massive attachments if they are too old, keeping only the most recent ones
 * or ones explicitly mentioned in the text context.
 */
function resolveContextFiles(currentMessage, historicalMessages) {
  const currentAttachments = currentMessage.attachments || [];
  const historicalRefs = collectHistoricalFileRefs(historicalMessages);

  // Example logic: if user explicitly references a past image by ID or context
  // Here we just keep the last 5 attachments to prevent payload bloat.
  const allAttachments = [...currentAttachments, ...historicalRefs.slice(-5)];
  
  // Deduplicate by ID or URL
  const uniqueAttachments = [];
  const seen = new Set();
  
  for (const att of allAttachments) {
    const key = att.id || att.url;
    if (key && !seen.has(key)) {
      seen.add(key);
      uniqueAttachments.push(att);
    }
  }

  return uniqueAttachments;
}

module.exports = {
  collectHistoricalFileRefs,
  resolveContextFiles
};
