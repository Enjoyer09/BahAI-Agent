/**
 * bahAI - Message Helper Patterns
 * Transplanted from LibreChat's messages.ts (buildTree) and related utilities.
 * Handles structuring flat arrays of messages into branched trees based on parentMessageId.
 */

function buildMessageTree({ messages, fileMap = {} }) {
  if (!messages || !Array.isArray(messages)) {
    return [];
  }

  const messageMap = {};
  const rootMessages = [];
  const childrenCount = {};

  messages.forEach((message) => {
    if (!message || !message.messageId) {
      return;
    }
    const parentId = message.parentMessageId || '';
    childrenCount[parentId] = (childrenCount[parentId] || 0) + 1;

    const extendedMessage = {
      ...message,
      children: [],
      depth: 0,
      siblingIndex: childrenCount[parentId] - 1,
    };

    if (message.attachments && Object.keys(fileMap).length > 0) {
      extendedMessage.attachments = message.attachments.map(
        (att) => fileMap[att.file_id || ''] || att
      );
    }

    messageMap[message.messageId] = extendedMessage;

    const parentMessage = messageMap[parentId];
    if (parentMessage) {
      parentMessage.children.push(extendedMessage);
      extendedMessage.depth = parentMessage.depth + 1;
    } else {
      rootMessages.push(extendedMessage);
    }
  });

  return rootMessages;
}

/**
 * Given a tree of messages and a leaf node ID, traverses up to build the linear history branch
 */
function buildLinearHistory(messageId, messagesList) {
  const map = new Map(messagesList.map(msg => [msg.messageId, msg]));
  const history = [];
  
  let currentId = messageId;
  while (currentId && map.has(currentId)) {
    const msg = map.get(currentId);
    history.unshift(msg);
    currentId = msg.parentMessageId;
  }
  
  return history;
}

module.exports = {
  buildMessageTree,
  buildLinearHistory
};
