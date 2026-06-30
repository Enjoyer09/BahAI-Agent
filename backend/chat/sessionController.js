async function runChatSession({
  req,
  res,
  slotAcquired,
  conversationId,
  runManager,
  orchestration,
  resolvedWD,
  latestUserText,
  auditStyleRequest,
  projectMemory,
  apiMessages,
  emitTaskPlan,
  writeSse,
  createPhaseContext,
  openAiStreamWithFallback,
  collectStreamOutput,
  executeToolCalls,
  extractPlannerArtifact,
  buildExecutionArtifact,
  classifyArtifactQuality,
  buildPhaseRecoveryInstruction,
  isFileClarificationLoop,
  shouldEmitDebugEvent,
  compactMessagesForNextPhase,
  buildPhaseHandoffMessage,
  buildPlannerArtifactContext,
  buildExecutionArtifactContext,
  releaseChatSlot,
  setConversationAbort,
  reqUser,
  dependencies
}) {
  let currentMessages = [...apiMessages];
  let step = 0;
  let attachmentRetryUsed = false;
  let clientDisconnected = false;
  let disconnectReason = '';
  const phaseRecoveryAttempts = new Map();
  const toolResultCache = new Map();

  const markClientDisconnected = (reason = 'client_disconnect') => {
    clientDisconnected = true;
    disconnectReason = reason;
  };

  req.on('aborted', () => {
    markClientDisconnected('request_aborted');
  });
  req.on('close', () => {
    if (req.aborted) {
      markClientDisconnected('request_aborted');
    }
  });

  if (slotAcquired) {
    setConversationAbort(req.user?.id, conversationId, (reason = 'superseded') => {
      markClientDisconnected(reason);
    });
  }

  const initialPlan = orchestration.enabled
    ? [
        ...orchestration.plan,
        'Oxunacaq faylları müəyyən et',
        'Dəyişiklik planını hazırla',
        'Diff/Approval ilə tətbiq et',
        'Build/Test/Health yoxlaması apar'
      ]
    : (orchestration.routing?.mode === 'direct'
        ? [orchestration.routing.reason]
        : ['Sorğunu analiz et', 'Lazım olan tool-ları işə sal', 'Nəticəni yekunlaşdır']);
  const compactPlan = orchestration?.routing?.tokenDiscipline?.compact
    ? initialPlan.slice(0, Math.min(initialPlan.length, 2))
    : initialPlan;
  emitTaskPlan(res, compactPlan);

  try {
    const stepLimit = Math.min(dependencies.MAX_STEPS, orchestration.maxSteps || dependencies.MAX_STEPS);
    while (step < stepLimit && !clientDisconnected) {
      step++;

      const phaseContext = createPhaseContext({
        currentMessages,
        runManager,
        orchestration,
        resolvedWD,
        auditStyleRequest,
        projectMemory
      });
      currentMessages = phaseContext.currentMessages;

      const runnerResult = await openAiStreamWithFallback({
        currentMessages,
        effectiveModel: dependencies.effectiveModelRef.current,
        activeProvider: dependencies.activeProviderRef.current,
        client: dependencies.clientRef.current,
        phaseTools: phaseContext.phaseTools,
        isLocalOrFlakyModel: dependencies.isLocalOrFlakyModel,
        providerCandidates: dependencies.providerCandidates,
        providerRuntime: dependencies.providerRuntime,
        buildOpenAIClient: dependencies.buildOpenAIClient,
        normalizeMessagesForModel: dependencies.normalizeMessagesForModel,
        mapMessagesToResponsesInput: dependencies.mapMessagesToResponsesInput,
        mapToolsToResponsesTools: dependencies.mapToolsToResponsesTools,
        isResponsesSchemaMismatchError: dependencies.isResponsesSchemaMismatchError,
        buildDeepSeekRecoveryMessages: dependencies.buildDeepSeekRecoveryMessages,
        writeSse: (payload) => writeSse(res, payload),
        shouldEmitDebugEvent,
        llmTimeoutMs: dependencies.llmTimeoutMs
      });

      if (runnerResult.errorEvent) {
        writeSse(res, runnerResult.errorEvent);
        break;
      }

      if (runnerResult.fallbackMessage) {
        currentMessages = runnerResult.currentMessages || currentMessages;
        writeSse(res, { type: 'assistant_message', message: runnerResult.fallbackMessage });
        break;
      }

      dependencies.activeProviderRef.current = runnerResult.activeProvider || dependencies.activeProviderRef.current;
      dependencies.clientRef.current = runnerResult.client || dependencies.clientRef.current;
      dependencies.effectiveModelRef.current = runnerResult.effectiveModel || dependencies.effectiveModelRef.current;
      currentMessages = runnerResult.currentMessages || currentMessages;

      const {
        accumulatedContent,
        normalizedToolCalls,
        message: msg
      } = await collectStreamOutput({
        stream: runnerResult.stream,
        wireApi: dependencies.activeProviderRef.current.wireApi,
        res,
        writeSse,
        normalizeToolName: dependencies.normalizeToolName,
        extractTextToolCalls: dependencies.extractTextToolCalls,
        buildToolCallCacheKey: dependencies.buildToolCallCacheKey,
        flattenResponseJsonText: dependencies.flattenResponseJsonText,
        normalizeFinalAssistantReport: dependencies.normalizeFinalAssistantReport,
        auditStyleRequest,
        plannerArtifact: runManager.getPlannerArtifact(),
        executionArtifacts: runManager.getExecutionArtifacts(),
        executionMemory: {
          lastValidation: projectMemory?.lastValidation || null,
          lastApprovalDecision: projectMemory?.lastApprovalDecision || null
        },
        phaseTools: phaseContext.phaseTools,
        step
      });

      const hasToolCalls = normalizedToolCalls.length > 0;
      const hasTextContent = accumulatedContent.trim().length > 0;
      const artifactQuality = classifyArtifactQuality(accumulatedContent, normalizedToolCalls.map((tc) => tc?.function?.name).filter(Boolean));
      const activeRole = phaseContext.activePhase?.role || 'Solo Agent';
      const phaseRecoveryKey = `${step}:${activeRole}`;

      if (dependencies.hasAttachmentInRequest && !hasToolCalls && !hasTextContent && !attachmentRetryUsed) {
        attachmentRetryUsed = true;
        currentMessages.push({
          role: 'system',
          content: 'İstifadəçi attachment göndərib. Boş cavab vermə. Mövcud attachment məlumatına əsaslanaraq qısa, konkret analiz və nəticə yaz.'
        });
        continue;
      }

      const shouldRecoverCurrentPhase = (() => {
        if (hasToolCalls) return false;
        if (artifactQuality === 'useful') return false;
        const attempts = phaseRecoveryAttempts.get(phaseRecoveryKey) || 0;
        return attempts < 1;
      })();

      if (shouldRecoverCurrentPhase) {
        phaseRecoveryAttempts.set(phaseRecoveryKey, (phaseRecoveryAttempts.get(phaseRecoveryKey) || 0) + 1);
        currentMessages.push({
          role: 'system',
          content: buildPhaseRecoveryInstruction(activeRole, resolvedWD, artifactQuality)
        });
        continue;
      }

      if (auditStyleRequest && step <= 2 && !hasToolCalls && isFileClarificationLoop(accumulatedContent || '')) {
        currentMessages.push({
          role: 'system',
          content: `Sən loop-a düşdün. İstifadəçi bütün qovluğu audit etməyi istəyir. Fayl soruşma, path soruşma, JSON təlimatı yazma. İndi dərhal \`analyze_codebase\` və ya \`list_directory\` tool call et və sonra findings hazırla. Project Root: ${resolvedWD}`
        });
        continue;
      }

      currentMessages.push(msg);

      if (phaseContext.activePhase?.role === 'Planner' && !hasToolCalls && hasTextContent) {
        const plannerArtifact = extractPlannerArtifact(accumulatedContent, latestUserText);
        runManager.setPlannerArtifact(plannerArtifact);
        if (shouldEmitDebugEvent()) {
          writeSse(res, {
            type: 'debug',
            info: { plannerArtifact }
          });
        }
      }

      if (!hasToolCalls && hasTextContent) {
        const executionArtifact = buildExecutionArtifact(phaseContext.activePhase?.role, accumulatedContent, normalizedToolCalls);
        runManager.addExecutionArtifact(executionArtifact);
        if (shouldEmitDebugEvent()) {
          writeSse(res, {
            type: 'debug',
            info: { executionArtifacts: runManager.getExecutionArtifacts() }
          });
        }
      }

      writeSse(res, { type: 'assistant_message', message: msg });

      if (msg.tool_calls && msg.tool_calls.length > 0) {
        currentMessages = await executeToolCalls({
          toolCalls: msg.tool_calls,
          clientDisconnected: () => clientDisconnected,
          phaseTools: phaseContext.phaseTools,
          activeRole,
          resolvedWD,
          currentMessages,
          writeSse: (payload) => writeSse(res, payload),
          safeMode: dependencies.safeMode,
          isLocalMode: dependencies.isLocalMode,
          isSensitiveTool: dependencies.isSensitiveTool,
          buildApprovalMetadata: dependencies.buildApprovalMetadata,
          createInteraction: dependencies.createInteraction,
          waitForApproval: dependencies.waitForApproval,
          handleToolCall: dependencies.handleToolCall,
          isCacheableTool: dependencies.isCacheableTool,
          toolResultCache,
          buildToolCallCacheKey: dependencies.buildToolCallCacheKey,
          buildToolRecoveryInstruction: dependencies.buildToolRecoveryInstruction,
          normalizeToolName: dependencies.normalizeToolName,
          normalizeUserFacingError: dependencies.normalizeUserFacingError,
          crypto: dependencies.crypto,
          reqUser,
          conversationId,
          runId: dependencies.runId || null
        });
      } else {
        const latestArtifacts = runManager.getExecutionArtifacts();
        const latestArtifact = latestArtifacts[latestArtifacts.length - 1];
        const canAdvancePhase = !orchestration.enabled || latestArtifact?.quality === 'useful' || activeRole === 'Planner';

        if (orchestration.enabled && runManager.canAdvance() && canAdvancePhase) {
          const finishedRole = phaseContext.activePhase?.role || 'Solo Agent';
          const nextPhase = runManager.advance();
          const plannerContext = buildPlannerArtifactContext(runManager.getPlannerArtifact());
          const executionContext = buildExecutionArtifactContext(runManager.getExecutionArtifacts());
          currentMessages.push({
            role: 'system',
            content: [
              buildPhaseHandoffMessage(finishedRole, nextPhase?.role),
              plannerContext,
              executionContext
            ].filter(Boolean).join('\n\n')
          });
          currentMessages = compactMessagesForNextPhase(currentMessages, {
            preserveSystemCount: 8,
            preserveRecentConversationCount: 8,
            preserveRecentToolCount: 6
          });
          writeSse(res, {
            type: 'orchestration_phase',
            ...runManager.snapshot()
          });
          continue;
        } else if (orchestration.enabled && runManager.canAdvance() && !canAdvancePhase) {
          currentMessages.push({
            role: 'system',
            content: buildPhaseRecoveryInstruction(activeRole, resolvedWD, latestArtifact?.quality || 'empty')
          });
          continue;
        }
        break;
      }
    }
  } finally {
    if (slotAcquired) releaseChatSlot(req.user?.id, conversationId);
    if (!res.writableEnded) {
      res.end();
    }
  }
}

module.exports = {
  runChatSession
};
