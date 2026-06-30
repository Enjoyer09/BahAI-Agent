function buildExecutionArtifact(role, messageContent = '', toolCalls = []) {
  const summary = String(messageContent || '').trim().slice(0, 1200);
  const toolNames = Array.isArray(toolCalls)
    ? toolCalls
        .map((toolCall) => toolCall?.function?.name)
        .filter(Boolean)
        .slice(0, 12)
    : [];
  return {
    role: role || 'Unknown',
    summary,
    toolNames,
    quality: classifyArtifactQuality(summary, toolNames),
    timestamp: Date.now()
  };
}

function classifyArtifactQuality(summary = '', toolNames = []) {
  const text = String(summary || '').trim().toLowerCase();
  if (!text && (!toolNames || toolNames.length === 0)) return 'empty';
  if (
    text.length < 40 &&
    /^(ok|tamam|hazır|done|bitdi|cavab alınmadı\.?|unknown tool|rədd edildi\.?)$/i.test(text)
  ) {
    return 'weak';
  }
  if (/^(api xətası|tool xətası|approval xətası|browser .* error|server start error)/i.test(text)) {
    return 'error';
  }
  return 'useful';
}

function buildExecutionArtifactContext(artifacts = []) {
  if (!Array.isArray(artifacts) || artifacts.length === 0) return '';
  return [
    'Execution Artifacts:',
    ...artifacts.slice(-6).map((artifact, index) => (
      `${index + 1}. ${artifact.role}: ${artifact.summary}${artifact.toolNames?.length ? ` | Tools: ${artifact.toolNames.join(', ')}` : ''}`
    ))
  ].join('\n');
}

function compactMessagesForNextPhase(messages = [], options = {}) {
  const {
    preserveSystemCount = 6,
    preserveRecentConversationCount = 8,
    preserveRecentToolCount = 6
  } = options;

  const source = Array.isArray(messages) ? messages : [];
  const systemMessages = source.filter((message) => message?.role === 'system').slice(-preserveSystemCount);
  const nonSystemMessages = source.filter((message) => message?.role !== 'system');
  const recentConversation = nonSystemMessages
    .filter((message) => message?.role === 'user' || message?.role === 'assistant')
    .slice(-preserveRecentConversationCount);
  const recentTools = nonSystemMessages
    .filter((message) => message?.role === 'tool')
    .slice(-preserveRecentToolCount);

  const seen = new Set();
  const compacted = [...systemMessages, ...recentConversation, ...recentTools].filter((message) => {
    const key = `${message?.role}:${message?.tool_call_id || ''}:${String(message?.content || '').slice(0, 120)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return compacted;
}

module.exports = {
  buildExecutionArtifact,
  buildExecutionArtifactContext,
  compactMessagesForNextPhase,
  classifyArtifactQuality
};
