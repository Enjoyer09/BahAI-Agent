async function executeToolCalls({
  toolCalls,
  clientDisconnected,
  phaseTools,
  activeRole,
  resolvedWD,
  currentMessages,
  writeSse,
  safeMode,
  isLocalMode,
  isSensitiveTool,
  buildApprovalMetadata,
  createInteraction,
  waitForApproval,
  handleToolCall,
  isCacheableTool,
  toolResultCache,
  buildToolCallCacheKey,
  buildToolRecoveryInstruction,
  normalizeToolName,
  normalizeUserFacingError,
  crypto,
  reqUser,
  conversationId,
  runId
}) {
  for (const toolCall of toolCalls) {
    if (clientDisconnected()) break;

    const allowedToolNames = phaseTools.map((tool) => tool.function.name);
    const normalizedToolName = normalizeToolName(toolCall.function.name);
    if (!allowedToolNames.includes(normalizedToolName)) {
      currentMessages.push({
        role: 'system',
        content: buildToolRecoveryInstruction(activeRole, resolvedWD, `icazəsiz və ya mövcud olmayan tool: ${normalizedToolName}`, allowedToolNames)
      });
      continue;
    }

    try {
      JSON.parse(toolCall.function.arguments || '{}');
    } catch {
      currentMessages.push({
        role: 'system',
        content: buildToolRecoveryInstruction(activeRole, resolvedWD, `arguments JSON parse olunmadı: ${normalizedToolName}`, allowedToolNames)
      });
      continue;
    }

    const cacheKey = buildToolCallCacheKey(toolCall.function.name, toolCall.function.arguments);
    if (isCacheableTool(toolCall.function.name) && toolResultCache.has(cacheKey)) {
      const cachedResult = toolResultCache.get(cacheKey);
      currentMessages.push({ role: 'tool', tool_call_id: toolCall.id, content: cachedResult });
      writeSse({ type: 'tool_result', result: cachedResult });
      continue;
    }

    writeSse({ type: 'tool_execution', tool: toolCall.function.name, args: toolCall.function.arguments, tool_call_id: toolCall.id });

    if (safeMode && !isLocalMode() && isSensitiveTool(toolCall.function.name)) {
      const approvalId = crypto.randomUUID();
      const approvalMeta = await buildApprovalMetadata(toolCall.function.name, toolCall.function.arguments, resolvedWD, reqUser);
      createInteraction(approvalId, {
        kind: 'approval',
        userId: reqUser.id,
        conversationId,
        runId,
        phaseRole: activeRole,
        expiresAt: Date.now() + 300000,
        status: 'pending',
        toolCall,
        workingDirectory: resolvedWD,
        createdAt: Date.now(),
        meta: approvalMeta
      });
      writeSse({
        type: 'approval_request',
        approvalId,
        tool: toolCall.function.name,
        args: toolCall.function.arguments,
        conversationId,
        runId,
        phaseRole: activeRole,
        expiresAt: Date.now() + 300000,
        meta: approvalMeta
      });

      try {
        const decision = await waitForApproval(approvalId);
        writeSse({ type: 'approval_resolved', approvalId, decision });
        if (decision === 'rejected') {
          currentMessages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: 'İstifadəçi tərəfindən rədd edildi. Bu əməliyyatı icra etmə.'
          });
          writeSse({ type: 'tool_result', result: 'Rədd edildi' });
        } else {
          const result = await handleToolCall(toolCall, resolvedWD, reqUser);
          if (isCacheableTool(toolCall.function.name)) {
            toolResultCache.set(cacheKey, result);
          }
          currentMessages.push({ role: 'tool', tool_call_id: toolCall.id, content: result });
          writeSse({ type: 'tool_result', result });
        }
      } catch (err) {
        currentMessages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: `Approval xətası: ${err.message}`
        });
        writeSse({ type: 'tool_result', result: `Approval xətası: ${err.message}` });
      }
      continue;
    }

    try {
      const result = await handleToolCall(toolCall, resolvedWD, reqUser);
      if (
        typeof result === 'string' &&
        (/^Unknown tool:/i.test(result) || /^Error executing tool: Unexpected token/i.test(result))
      ) {
        currentMessages.push({
          role: 'system',
          content: buildToolRecoveryInstruction(activeRole, resolvedWD, result, allowedToolNames)
        });
        continue;
      }
      if (isCacheableTool(toolCall.function.name)) {
        toolResultCache.set(cacheKey, result);
      }
      currentMessages.push({ role: 'tool', tool_call_id: toolCall.id, content: result });
      writeSse({ type: 'tool_result', result: normalizeUserFacingError(result) });
    } catch (toolErr) {
      const errorText = `Tool xətası: ${toolErr?.message || String(toolErr)}`;
      currentMessages.push({ role: 'tool', tool_call_id: toolCall.id, content: errorText });
      writeSse({ type: 'tool_result', result: normalizeUserFacingError(errorText) });
    }
  }

  return currentMessages;
}

module.exports = {
  executeToolCalls
};
