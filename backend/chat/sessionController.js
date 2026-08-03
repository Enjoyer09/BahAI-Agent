function prepareWebFinalSynthesisMessages(messages = []) {
  const prepared = [];
  for (const message of messages) {
    if (!message || !message.role) continue;
    const content = String(message.content || '').trim();
    if (message.role === 'assistant' && Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
      continue;
    }
    if (message.role === 'assistant' && /(?:DSML|tool_calls|<invoke\b|<function_calls)/i.test(content)) {
      continue;
    }
    if (message.role === 'tool') {
      if (content) {
        prepared.push({
          role: 'system',
          content: `[Araşdırma mənbəsi]\n${content.slice(0, 8000)}`
        });
      }
      continue;
    }
    prepared.push(message);
  }
  return prepared.slice(-24);
}

function isConciseOutputRequest(text = '') {
  return /(?:yalnız|yalniz|only|exactly|tam olaraq|başqa heç nə|basqa hec ne|rəqəmi yaz|reqemi yaz|bir söz|bir soz|bir emoji|qısa)/i.test(String(text || ''));
}

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
  productMode,
  projectMemory,
  apiMessages,
  emitTaskPlan,
  emitGovernanceState,
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
  const requestDeadlineAt = Date.now() + (dependencies.requestTimeoutMs || 30000);
  const { createGuardrails } = require('./guardrails');
  const guardrails = createGuardrails({ maxToolCallsPerSession: 25, maxDuplicateToolThreshold: 4, maxMutationsPerFile: 6 });
  const expectsConciseOutput = isConciseOutputRequest(latestUserText);

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
  emitGovernanceState(res, {
    entryPath: dependencies.entryPath,
    gateReceipt: dependencies.initialGateReceipt
  });

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
      const forceFinalSynthesis = productMode === 'web_chat' && step === stepLimit;
      if (forceFinalSynthesis) {
        currentMessages = prepareWebFinalSynthesisMessages(currentMessages);
        currentMessages.push({
          role: 'system',
          content: 'Bu son cavab mərhələsidir. Daha heç bir tool çağırma və tool-call sintaksisi yazma. Yuxarıdakı araşdırma mənbələrinə əsasən istifadəçinin tələb etdiyi formatda konkret yekun cavab yaz. Məlumat çatışmırsa bunu qısa qeyd et, amma cavabı boş buraxma.'
        });
      }

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
        llmTimeoutMs: dependencies.llmTimeoutMs,
        visionTimeoutMs: dependencies.visionTimeoutMs || 30000,
        isVisionRequest: Boolean(dependencies.hasImageAttachment),
        onProviderTelemetry: dependencies.onProviderTelemetry,
        providerSessionKey: dependencies.providerSessionKey,
        forceDisableTools: forceFinalSynthesis,
        requestDeadlineAt
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

      let streamOutput;
      try {
        streamOutput = await collectStreamOutput({
          stream: runnerResult.stream,
          wireApi: dependencies.activeProviderRef.current.wireApi,
          res,
          writeSse,
          normalizeToolName: dependencies.normalizeToolName,
          extractTextToolCalls: dependencies.extractTextToolCalls,
          buildToolCallCacheKey: dependencies.buildToolCallCacheKey,
          flattenResponseJsonText: dependencies.flattenResponseJsonText,
          normalizeFinalAssistantReport: dependencies.normalizeFinalAssistantReport,
          productMode,
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
      } catch (streamError) {
        const streamMessage = String(streamError?.message || '').toLowerCase();
        const providerStreamFailure = streamMessage.includes('provider stream error');
        writeSse(res, {
          type: 'error',
          message: providerStreamFailure
            ? 'AI provider cavabı yarımçıq qaytardı. Sistem bunu qeydə aldı; zəhmət olmasa bir az sonra yenidən cəhd edin.'
            : 'Cavab hazırlanarkən əlaqə kəsildi. Zəhmət olmasa yenidən cəhd edin.'
        });
        break;
      }

      const {
        finishReason,
        sawAssistantDelta,
        sawCompletedEvent,
        accumulatedContent,
        normalizedToolCalls,
        degenerateLoop,
        message: msg
      } = streamOutput;

      // The model fell into a degenerate repetition loop (same sentence
      // repeated many times). Never finalize that garbage into the
      // conversation; drop it and hand the user a clean retry instead.
      if (degenerateLoop) {
        console.warn(`[REPETITION_LOOP] Cavab finalizasiya edilmədi (${String(degenerateLoop.phrase || '').slice(0, 100)})`);
        writeSse(res, {
          type: 'error',
          message: 'Cavab hazırlanarkən problem yarandı (təkrarlanma aşkar edildi). Zəhmət olmasa bir az sonra yenidən cəhd edin.'
        });
        break;
      }

      const hasToolCalls = normalizedToolCalls.length > 0;
      const hasTextContent = accumulatedContent.trim().length > 0;
      const hasRecoverablePartialText = !hasToolCalls && hasTextContent && sawAssistantDelta && !sawCompletedEvent;
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
        if (productMode === 'web_chat' && expectsConciseOutput && hasTextContent) return false;
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

      if (!hasToolCalls && !hasTextContent && sawAssistantDelta) {
        currentMessages.push({
          role: 'system',
          content: 'Model stream zamanı mətn göndərdi, amma final cavab boş qaldı. Eyni mövzunu təkrarlamadan, artıq başladığın cavabı 1 qısa yekun cavab kimi tamamla.'
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

      if (hasRecoverablePartialText && finishReason !== 'tool_calls') {
        currentMessages.push({
          role: 'system',
          content: 'Əvvəlki cavab yarımçıq kəsildi. Eyni məlumatı təkrarlama, sadəcə qaldığın yerdən 1 qısa yekun abzasla tamamla.'
        });
      }

      if (msg.tool_calls && msg.tool_calls.length > 0) {
        // Validate each tool call against Safety Guardrails
        const safeToolCalls = [];
        for (const tc of msg.tool_calls) {
          const toolName = tc.function?.name || tc.name;
          let args = {};
          try { args = JSON.parse(tc.function?.arguments || tc.args || '{}'); } catch {}
          const check = guardrails.validateToolCall(toolName, args);
          if (!check.allowed) {
            writeSse(res, { type: 'error', message: check.reason });
            break;
          }
          safeToolCalls.push(tc);
        }

        if (safeToolCalls.length > 0) {
          currentMessages = await executeToolCalls({
            toolCalls: safeToolCalls,
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

        // ── Mərhələ 3: Agent-as-a-Judge (Self-Correction Loop) ──
        const executedMutatingTools = msg.tool_calls.map(tc => tc.function?.name || tc.name);
        const didMutateCode = executedMutatingTools.some(t => ['write_file', 'file_edit', 'multi_file_edit'].includes(t));
        if (didMutateCode && step < orchestration.maxSteps) {
          try {
            const { buildValidationPlan, formatValidationReport } = require('../helpers');
            const validationPlan = await buildValidationPlan(resolvedWD);
            if (validationPlan.length > 0) {
              const { handleToolCall } = require('../toolRunner');
              const validationResult = await handleToolCall({
                function: { name: 'run_tests', arguments: JSON.stringify({ stopOnFailure: true, maxSteps: 1 }) }
              }, resolvedWD, reqUser);

              if (typeof validationResult === 'string' && (validationResult.includes('❌') || validationResult.includes('FAIL') || validationResult.includes('error'))) {
                currentMessages.push({
                  role: 'system',
                  content: `⚠️ [Agent-as-a-Judge Autocorrect]: Kod dəyişikliyindən sonra avtomatik test/lint uğursuz oldu:\n${validationResult.slice(0, 1500)}\n\nXahiş olunur xətanı təhlil et və \`file_edit\` və ya \`write_file\` ilə koddakı problemi dərhal avtomatik düzəlt.`
                });
              }
            }
          } catch { /* skip judge if test runner is not present */ }
        }
        }
      } else {
        const latestArtifacts = runManager.getExecutionArtifacts();
        const latestArtifact = latestArtifacts[latestArtifacts.length - 1];
        const canAdvancePhase = !orchestration.enabled || latestArtifact?.quality === 'useful' || activeRole === 'Planner';

        if (productMode === 'web_chat' && (!msg.content || msg.content.trim() === '')) {
          const { buildFallbackWebPlan } = require('./webPlanner');
          const fallbackText = buildFallbackWebPlan(latestUserText, 'empty_tool_response');
          writeSse(res, { type: 'assistant_delta', content: fallbackText });
          currentMessages.push({ role: 'assistant', content: fallbackText });
        }

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
            preserveSystemCount: 12,
            preserveRecentConversationCount: 10,
            preserveRecentToolCount: 8
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
    if (!clientDisconnected) {
      emitGovernanceState(res, {
        entryPath: dependencies.entryPath,
        gateReceipt: dependencies.buildFinalGateReceipt({
          plannerArtifact: runManager.getPlannerArtifact(),
          executionArtifacts: runManager.getExecutionArtifacts()
        })
      });
    }
    if (slotAcquired) releaseChatSlot(req.user?.id, conversationId);
    if (!res.writableEnded) {
      if (typeof dependencies.finishSse === 'function') {
        dependencies.finishSse(res);
      }
      res.end();
    }
  }
}

module.exports = {
  runChatSession,
  prepareWebFinalSynthesisMessages,
  isConciseOutputRequest
};
