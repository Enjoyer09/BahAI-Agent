// ==========================================
// Chat Service — Async Operations & SSE Handling
// ==========================================

import type { Message, Conversation, Project, Settings, PlannerArtifact, ExecutionArtifact, ApprovalRequest } from '../lib/types';
import {
  sendChatMessage as apiSendChatMessage,
  loadWorkspaceState,
  listConversations,
  createProjectOnServer,
  updateProjectOnServer,
  deleteProjectOnServer,
  createConversationOnServer,
  updateConversationOnServer,
  deleteConversationOnServer,
  extractAttachments,
  getProjectMemory,
  getInteractions,
  getGuiCapabilities,
  getTaskPlan,
  previewDiff,
  applyDiff,
  resolveCheckpoint as resolveCheckpointRequest,
  runProjectHealthCheck,
  runTerminalStream,
  saveProjectMemory,
  submitApproval
} from '../lib/api';
import { trackToolUse, trackChatError } from '../lib/telemetry';
import {
  normalizeAssistantText,
  chooseAssistantContent,
  normalizeUiErrorMessage,
  isToolCallLikeText,
  extractRepoProfileFromToolResult,
  mergeRepoProfileIntoMemory,
  mergePlannerArtifactIntoMemory,
  mergeExecutionArtifactsIntoMemory,
  extractRuntimeArtifact,
  mergeRuntimeArtifactIntoMemory,
  buildValidationSnapshot,
  mergeValidationIntoMemory,
  mergeEvidenceSummaryIntoMemory,
  mergeGovernanceIntoMemory,
  mergeHumanCheckpointIntoMemory,
  mergeGuiObservationIntoMemory,
  mergeProviderTelemetryIntoMemory,
} from '../lib/chatRuntime';

// ==========================================
// Helpers
// ==========================================

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function getDefaultConversationTitle(productMode?: Settings['productMode']): string {
  return productMode === 'web_chat' ? 'Yeni chat' : 'Yeni söhbət';
}

function getDefaultWorkspaceName(productMode?: Settings['productMode']): string {
  return productMode === 'web_chat' ? 'BahAI Session' : 'bahAI Sandbox';
}

function getWelcomeMessage(productMode?: Settings['productMode'], serverBacked = false): string {
  if (productMode === 'web_chat') {
    return serverBacked
      ? 'Salam! Söhbət tarixçəniz saxlanılıb. Qaldığınız yerdən rahatca davam edə bilərsiniz.'
      : 'Salam! Yazın, mən kömək edim.';
  }
  return serverBacked
    ? 'Salam! Mən bahAI agentiyəm. Sizin üçün ayrıca şəxsi workspace yaratdım. Buradakı fayllar yalnız sizin hesabınıza bağlıdır.'
    : 'Salam! Mən bahAI agentiyəm. Layihə seçilmədiyi üçün sizin üçün avtomatik olaraq bir "bahAI Sandbox" (Qaralama) iş sahəsi yaratdım. İndi bura nəsə yaza bilərsiniz, sizə kömək etməyə hazıram! 🚀';
}

function isWelcomeLikeAssistantMessage(content: string, productMode?: Settings['productMode']): boolean {
  const normalized = String(content || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  if (!normalized) return false;
  const webWelcomePatterns = [
    'salam! yazın, mən kömək edim',
    'salam! söhbət tarixçəniz saxlanılıb',
    'salam! mən bahai',
    'mən bahai',
  ];
  const desktopWelcomePatterns = [
    'salam! mən bahai agentiyəm',
    'workspace yaratdım',
    'bahai sandbox',
  ];
  const patterns = productMode === 'web_chat'
    ? [...webWelcomePatterns, ...desktopWelcomePatterns]
    : desktopWelcomePatterns;
  return patterns.some((pattern) => normalized.includes(pattern));
}

function isWebChatHistoryNoise(message: Message): boolean {
  const content = String(message.content || '').trim();
  if (!content) return true;
  if (message.role === 'system' || message.role === 'tool') return true;
  if (isToolCallLikeText(content)) return true;
  // Error messages (exact format)
  if (/^❌\s*xəta:/i.test(content)) return true;
  if (/cavab tamamlanmadan əlaqə kəsildi/i.test(content)) return true;
  // System-generated orchestration messages (match EXACT format, not just first word)
  if (/^Workflow:\s*\*\*[^*]+\*\*\s*\|/i.test(content)) return true;
  if (/^Faza:\s*\*\*[^*]+\*\*/i.test(content)) return true;
  if (/^[☁️🦙]\s*Auto\s*→/i.test(content)) return true;
  // GUI/browser session noise
  if (/active gui session|cari visible browser sessiyası açıqdır/i.test(content)) return true;
  if (/eyni browser sessiyasında davam edirəm/i.test(content)) return true;
  if (/hazırdır\.\s*istəsən növbəti addımı bu sessiyada davam etdirə bilərik/i.test(content)) return true;
  return false;
}

function sanitizeWebChatHistory(messages: Message[]): Message[] {
  const filtered = messages.filter((message) => !isWebChatHistoryNoise(message));
  return filtered.slice(-12);
}

function buildWebReferentSummary(messages: Message[], latestInput: string): Record<string, unknown> | null {
  const history = sanitizeWebChatHistory(messages);
  if (history.length < 2) return null;
  const latestNormalized = String(latestInput || '').trim().toLowerCase();
  if (!latestNormalized) return null;
  const isReferentialFollowup = /^(onu|bunu|el[eə] onu|orada dediyin|deqiqleshdir|dəqiqləşdir|onu dəqiqləşdir|onu deqiqleshdir|bunu dəqiqləşdir|bunu deqiqleshdir|yuxarida dedin axi|yuxarıda dedin axı|bu sənəd|bu sened|bu şəkil|bu sekil|bu fayl|bu file|buradakı sənəd|burdaki sened)$/i.test(latestNormalized);
  if (!isReferentialFollowup) return null;

  const previousAssistant = [...history].reverse().find((item) => item.role === 'assistant' && String(item.content || '').trim());
  const previousUser = [...history].reverse().find((item) => item.role === 'user' && String(item.content || '').trim() && String(item.content || '').trim().toLowerCase() !== latestNormalized);
  if (!previousAssistant) return null;
  if (!previousUser) return null;

  const previousVisualMessage = [...history].reverse().find((item) => item.role === 'user' && Array.isArray(item.attachments) && item.attachments.length > 0);
  const previousAttachment = previousVisualMessage?.attachments?.[0];
  const hasMeaningfulPriorThread = history.filter((item) => item.role === 'assistant' || item.role === 'user').length >= 2;
  if (!hasMeaningfulPriorThread) return null;

  return {
    latestFollowup: latestInput,
    previousAssistant: String(previousAssistant.content || '').slice(0, 1200),
    previousUser: previousUser ? String(previousUser.content || '').slice(0, 400) : '',
    previousAttachment: previousAttachment ? {
      name: previousAttachment.name || '',
      type: previousAttachment.type || '',
      mimeType: previousAttachment.mimeType || '',
      extractedText: String(previousAttachment.extractedText || '').slice(0, 1200),
    } : null,
  };
}

function buildConversationTitleFromInput(input: string, productMode?: Settings['productMode']): string {
  const text = String(input || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return getDefaultConversationTitle(productMode);
  const cleaned = text.replace(/^["'`]+|["'`]+$/g, '').replace(/^(zəhmət olmasa|zehmet olmasa|please)\s+/i, '').trim();
  if (!cleaned) return getDefaultConversationTitle(productMode);
  if (cleaned.length <= 48) return cleaned;
  const sliced = cleaned.slice(0, 48);
  const lastSpace = sliced.lastIndexOf(' ');
  return `${(lastSpace > 20 ? sliced.slice(0, lastSpace) : sliced).trim()}...`;
}

// ==========================================
// SSE Event Handler (dispatches to an event sink)
// ==========================================

interface EventSink {
  setTaskPlan(items: string[]): void;
  addSystemMessage(content: string): void;
  updateAssistantMessage(content: string): void;
  finalizeAssistantMessage(msg: Message): void;
  updateToolExecution(toolCallId: string | undefined, tool: string): void;
  addToolResult(toolMsg: Message, updatedToolCallId: string): void;
  addApproval(approval: ApprovalRequest): void;
  removeApproval(approvalId: string): void;
  setHumanCheckpoint(checkpoint: any): void;
  setPlannerArtifact(artifact: PlannerArtifact): void;
  setExecutionArtifacts(artifacts: ExecutionArtifact[]): void;
  mergeProjectMemory(memory: Record<string, unknown>): void;
  updateProjectPort(projectId: string, port: number): void;
  incrementPreviewKey(): void;
}

export interface SendMessageContext {
  settings: Settings;
  activeConvId: string;
  activeProject: Project | null;
  messages: Message[];
  projectMemory: Record<string, unknown>;
  plannerArtifact: PlannerArtifact | null;
  executionArtifacts: ExecutionArtifact[];
  serverBacked: boolean;
  safeMode: boolean;
  signal?: AbortSignal;
  sink: EventSink;
}

export async function handleSendMessage(
  input: string,
  attachments: any[],
  ctx: SendMessageContext
): Promise<void> {
  const { settings, activeConvId, activeProject, messages, projectMemory, serverBacked, safeMode, sink } = ctx;
  // Process attachments
  const enrichedAttachments = await extractAttachments(attachments);

  // useChat already places the optimistic user message in the conversation.
  // Enrich that same message instead of appending a duplicate request entry.
  const currentMsgs = [...messages];
  const lastMessage = currentMsgs[currentMsgs.length - 1];
  if (lastMessage?.role === 'user' && lastMessage.content === input) {
    currentMsgs[currentMsgs.length - 1] = { ...lastMessage, attachments: enrichedAttachments };
  } else {
    currentMsgs.push({
      id: generateId(),
      role: 'user',
      content: input,
      attachments: enrichedAttachments,
      timestamp: Date.now(),
    });
  }
  const convId = activeConvId;
  const streamBufferRef = { current: '' };

  // Dispatch user message to store
  sink.incrementPreviewKey();

  try {
    // Background task plan fetch
    getTaskPlan(input, activeProject?.path || settings.projectDir)
      .then(plan => sink.setTaskPlan(plan.items))
      .catch(() => sink.setTaskPlan([]));

    const isLikelyLocalModel = !settings.model.includes('/') || settings.baseUrl.includes('localhost') || settings.baseUrl.includes('127.0.0.1');
    const MAX_HISTORY_MESSAGES = isLikelyLocalModel ? 12 : 20;
    const historySource = settings.productMode === 'web_chat'
      ? sanitizeWebChatHistory(currentMsgs)
      : currentMsgs;
    const historySlice = historySource.slice(-MAX_HISTORY_MESSAGES);
    const preparedMessagesCore = historySlice.map((m, idx) => {
      const isRecent = idx >= historySlice.length - 6;
      const trimmedToolCalls = isRecent
        ? m.tool_calls?.map((tc: any) => ({
            id: tc.id,
            type: tc.type || 'function',
            function: {
              name: tc.function?.name || tc.name || '',
              arguments: String(tc.function?.arguments || tc.args || '').slice(0, 2000),
            },
          }))
        : undefined;
      return {
        role: m.role,
        content: String(m.content || '').slice(0, 8000),
        attachments: m.attachments?.map((at: any) => {
          const isImage = at.type === 'image' || /^image\//i.test(at.mimeType || '');
          return {
            id: at.id,
            name: at.name,
            type: at.type,
            mimeType: at.mimeType,
            extractedText: at.extractedText || '',
            extractionError: at.extractionError,
            url: at.url || '',
          };
        }),
        tool_calls: trimmedToolCalls,
        tool_call_id: m.tool_call_id,
      };
    });

    const activeGuiSession = projectMemory?.activeGuiSession as any;
    const referentSummary = settings.productMode === 'web_chat'
      ? buildWebReferentSummary(currentMsgs, input)
      : null;
    const preparedMessages = activeGuiSession?.sessionId && settings.workflow === 'gui'
      ? [{
          role: 'system' as const,
          content: `Active GUI session: ${activeGuiSession.sessionId}. Cari visible browser sessiyası açıqdır.`,
        }, ...preparedMessagesCore]
      : preparedMessagesCore;

    let finalPreparedMessages = preparedMessages;
    if (settings.customInstructions && settings.customInstructions.trim() !== '') {
      finalPreparedMessages = [
        { role: 'system' as const, content: `Custom Instructions:\n${settings.customInstructions}` },
        ...preparedMessages
      ];
    }

    const isSmartMode = settings.aiMode === 'smart';
    const isWebChat = settings.productMode === 'web_chat';
    // Web provider credentials and routing belong to the BahAI backend. Do not
    // let stale browser settings override Railway's OmniRoute configuration.
    const effectiveBaseUrl = isWebChat ? '' : settings.baseUrl;
    const effectiveApiKey = isWebChat ? '' : settings.apiKey;
    const effectiveModel = (isWebChat || isSmartMode) ? 'auto' : settings.model;

    await apiSendChatMessage(
      finalPreparedMessages,
      effectiveApiKey, effectiveBaseUrl, effectiveModel,
      activeProject?.path || settings.projectDir,
      {
        safeMode,
        projectId: activeProject?.id,
        conversationId: convId,
        orchestrationMode: settings.orchestrationMode,
        workflow: settings.workflow,
        guiBrowserMode: settings.guiBrowserMode,
        guiBrowserPath: settings.guiBrowserPath,
        guiBrowserCdpUrl: settings.guiBrowserCdpUrl,
        productMode: settings.productMode,
        executionMode: settings.executionMode,
        referentSummary,
      },
      (event: any) => handleSSEEvent(event, {
        convId,
        projectMemory,
        activeProject,
        serverBacked,
        settings,
        sink,
        currentMsgs: { current: currentMsgs },
        streamBufferRef,
      }),
      ctx.signal
    );

    const pendingAssistant = normalizeAssistantText(streamBufferRef.current || '');
    if (pendingAssistant) {
      sink.finalizeAssistantMessage({
        id: generateId(),
        role: 'assistant',
        content: pendingAssistant,
        timestamp: Date.now(),
      });
      streamBufferRef.current = '';
    }

    // Save project memory after successful completion
    if (activeProject?.id && serverBacked) {
      const inferredMemory = {
        ...projectMemory,
        language: 'az',
        model: settings.model,
        latestPrompt: input,
        workspace: activeProject.path,
      };
      sink.mergeProjectMemory(inferredMemory);
      saveProjectMemory(activeProject.id, inferredMemory).catch(console.error);
    }
  } catch (err: any) {
    if (err.name !== 'AbortError') {
      const errMsg: Message = {
        id: generateId(),
        role: 'assistant',
        content: `❌ Xəta: ${normalizeUiErrorMessage(err.message)}`,
        timestamp: Date.now(),
      };
      sink.finalizeAssistantMessage(errMsg);
    }
  }
}

// ==========================================
// SSE Event Handler
// ==========================================

interface SSEEventContext {
  convId: string;
  projectMemory: Record<string, unknown>;
  activeProject: Project | null;
  serverBacked: boolean;
  settings: Settings;
  sink: EventSink;
  currentMsgs: { current: Message[] };
  streamBufferRef: { current: string };
}

function handleSSEEvent(event: any, ctx: SSEEventContext): void {
  const { projectMemory, activeProject, serverBacked, sink, currentMsgs, streamBufferRef } = ctx;
  const isWebChat = ctx.settings.productMode === 'web_chat';

  if (event.type === 'task_plan') {
    if (isWebChat) return;
    sink.setTaskPlan(Array.isArray(event.items) ? event.items : []);
    return;
  }

  if (event.type === 'orchestration_state') {
    if (isWebChat) return;
    const routingLine = event.routing?.reason
      ? `\nMarşrut: ${event.routing.primaryAgent}${event.routing.secondaryAgents?.length ? ` -> ${event.routing.secondaryAgents.join(' -> ')}` : ''}\nSəbəb: ${event.routing.reason}`
      : '';
    sink.addSystemMessage(
      `Workflow: **${event.workflow}** | Rejim: **${event.mode}** | Agentlər: ${Array.isArray(event.agents) ? event.agents.join(', ') : ''}${routingLine}`
    );
    return;
  }

  if (event.type === 'orchestration_phase') {
    if (isWebChat) return;
    if (event.currentRole === 'Manager') return;
    const phaseSummary = Array.isArray(event.phases)
      ? event.phases.map((p: any) => `${p.role}: ${p.status}`).join(' | ')
      : '';
    sink.addSystemMessage(`Faza: **${event.currentRole}**${phaseSummary ? ` | ${phaseSummary}` : ''}`);
    return;
  }

  if (event.type === 'auto_route') {
    const isCloud = event.providerId?.includes('cloud') || /\//.test(event.chosenModel || '');
    const icon = isCloud ? '☁️' : '🦙';
    const tier = event.intent === 'smart' ? 'Mürəkkəb iş' : 'Sürətli sual';
    sink.addSystemMessage(`${icon} Auto → **${event.chosenModel}** (${tier})`);
    return;
  }

  if (event.type === 'error') {
    trackChatError(ctx.settings.model, event.message);
    const normalizedError = normalizeUiErrorMessage(event.message);
    const bufferedAssistant = normalizeAssistantText(streamBufferRef.current || '');
    if (isWebChat && bufferedAssistant && /cavabın görünən hissəsi saxlanıldı|gələn hissə göstərildi/i.test(normalizedError)) {
      return;
    }
    sink.addSystemMessage(`❌ Xəta: ${normalizedError}`);
    return;
  }

  if (event.type === 'provider_telemetry') {
    if (!activeProject?.id) return;
    const mergedMemory = mergeProviderTelemetryIntoMemory(projectMemory, event);
    sink.mergeProjectMemory(mergedMemory);
    if (serverBacked) saveProjectMemory(activeProject.id, mergedMemory).catch(console.error);
    return;
  }

  if (event.type === 'token_usage') {
    if (!activeProject?.id) return;
    const mergedMemory = {
      ...projectMemory,
      tokenUsage: {
        promptTokens: event.promptTokens,
        completionTokens: event.completionTokens,
        totalTokens: event.totalTokens,
        estimatedCostUSD: event.estimatedCostUSD,
        model: event.model
      }
    };
    sink.mergeProjectMemory(mergedMemory);
    if (serverBacked) saveProjectMemory(activeProject.id, mergedMemory).catch(console.error);
    return;
  }

  if (event.type === 'debug') {
    if (isWebChat) return;
    if (event.info?.plannerArtifact) {
      const artifact = event.info.plannerArtifact as PlannerArtifact;
      sink.setPlannerArtifact(artifact);
      if (activeProject?.id) {
        const mergedMemory = mergePlannerArtifactIntoMemory(projectMemory, artifact, '');
        sink.mergeProjectMemory(mergedMemory);
        if (serverBacked) saveProjectMemory(activeProject.id, mergedMemory).catch(console.error);
      }
    }
    if (Array.isArray(event.info?.executionArtifacts)) {
      const artifacts = event.info.executionArtifacts as ExecutionArtifact[];
      sink.setExecutionArtifacts(artifacts);
      if (activeProject?.id) {
        const mergedMemory = mergeExecutionArtifactsIntoMemory(projectMemory, artifacts);
        sink.mergeProjectMemory(mergedMemory);
        if (serverBacked) saveProjectMemory(activeProject.id, mergedMemory).catch(console.error);
      }
    }
    return;
  }

  if (event.type === 'governance_state') {
    if (isWebChat) return;
    if (activeProject?.id) {
      const mergedMemory = mergeGovernanceIntoMemory(projectMemory, event.entryPath, event.gateReceipt);
      sink.mergeProjectMemory(mergedMemory);
      if (serverBacked) saveProjectMemory(activeProject.id, mergedMemory).catch(console.error);
    }
    return;
  }

  if (event.type === 'approval_request') {
    if (isWebChat) return;
    const approval = {
      approvalId: event.approvalId,
      tool: event.tool,
      args: event.args,
      conversationId: event.conversationId,
      runId: event.runId,
      phaseRole: event.phaseRole,
      expiresAt: event.expiresAt,
      meta: event.meta,
    };
    sink.addApproval(approval);
    sink.incrementPreviewKey();
    return;
  }

  if (event.type === 'approval_resolved') {
    if (isWebChat) return;
    sink.removeApproval(event.approvalId);
    sink.incrementPreviewKey();
    return;
  }

  if (event.type === 'human_checkpoint') {
    if (isWebChat) return;
    sink.setHumanCheckpoint(event.checkpoint);
    if (activeProject?.id) {
      const mergedMemory = mergeHumanCheckpointIntoMemory(projectMemory, event.checkpoint);
      sink.mergeProjectMemory(mergedMemory);
      if (serverBacked) saveProjectMemory(activeProject.id, mergedMemory).catch(console.error);
    }
    return;
  }

  if (event.type === 'assistant_delta') {
    const rawDelta = String(event.content || '');
    if (/Düşünürəm/i.test(rawDelta)) return;
    if (!rawDelta) return;
    streamBufferRef.current = (streamBufferRef.current || '') + rawDelta;
    const normalizedBuffer = normalizeAssistantText(streamBufferRef.current);
    if (!normalizedBuffer) return;
    sink.updateAssistantMessage(normalizedBuffer);
    return;
  }

  if (event.type === 'assistant_message') {
    const content = chooseAssistantContent(streamBufferRef.current || '', event.message.content || '');
    if (isWebChat && (!content || isToolCallLikeText(content))) {
      streamBufferRef.current = '';
      return;
    }
    const assistantMsg: Message = {
      id: generateId(),
      role: 'assistant',
      content,
      tool_calls: isWebChat ? undefined : event.message.tool_calls?.map((tc: any) => ({ ...tc, status: 'done' })),
      timestamp: Date.now(),
    };
    streamBufferRef.current = '';
    sink.finalizeAssistantMessage(assistantMsg);

    // Auto-port detection
    const msgContent = typeof event.message === 'string' ? event.message : (event.message.content || '');
    if (msgContent.includes('http://localhost:') && activeProject?.id) {
      const match = msgContent.match(/http:\/\/localhost:(\d+)/);
      if (match && match[1]) {
        sink.updateProjectPort(activeProject.id, parseInt(match[1]));
      }
    }
    sink.incrementPreviewKey();
    return;
  }

  if (event.type === 'tool_execution') {
    if (isWebChat) return;
    trackToolUse(event.tool);
    // Update currentMsgs ref to track the running tool
    const current = currentMsgs.current;
    const lastIdx = current.length - 1;
    if (lastIdx >= 0 && current[lastIdx].role === 'assistant' && current[lastIdx].tool_calls) {
      currentMsgs.current = current.map((m, idx) => {
        if (idx === lastIdx && m.role === 'assistant' && m.tool_calls) {
          return {
            ...m,
            tool_calls: m.tool_calls.map((tc: any) =>
              (event.tool_call_id && tc.id === event.tool_call_id) || (!event.tool_call_id && tc.function?.name === event.tool)
                ? { ...tc, status: 'running' as const }
                : tc
            ),
          };
        }
        return m;
      });
    }
    sink.updateToolExecution(event.tool_call_id, event.tool);
    sink.incrementPreviewKey();
    return;
  }

  if (event.type === 'tool_result') {
    if (isWebChat) return;
    // Find the running tool from the current messages (updated by tool_execution handler)
    const allToolCalls = currentMsgs.current.flatMap(m => m.tool_calls || []);
    const runningTool = allToolCalls.find((tc: any) => tc.status === 'running');
    const updatedToolCallId = runningTool?.id || event.tool_call_id || '';

    // Update currentMsgs ref: mark running tool as done
    const current = currentMsgs.current;
    const lastIdx = current.length - 1;
    if (lastIdx >= 0 && current[lastIdx].role === 'assistant' && current[lastIdx].tool_calls) {
      currentMsgs.current = current.map((m, idx) => {
        if (idx === lastIdx && m.role === 'assistant' && m.tool_calls) {
          return {
            ...m,
            tool_calls: m.tool_calls.map((tc: any) =>
              tc.status === 'running' ? { ...tc, status: 'done' as const, result: event.result } : tc
            ),
          };
        }
        return m;
      });
    }

    // Create tool result message
    const toolMsg: Message = {
      id: generateId(),
      role: 'tool',
      content: typeof event.result === 'string' ? event.result : JSON.stringify(event.result),
      tool_call_id: updatedToolCallId,
      timestamp: Date.now(),
    };
    currentMsgs.current = [...currentMsgs.current, toolMsg];

    // Handle repo profile extraction
    const repoProfile = typeof event.result === 'string'
      ? extractRepoProfileFromToolResult(event.result)
      : null;
    if (repoProfile && activeProject?.id) {
      const mergedMemory = mergeRepoProfileIntoMemory(projectMemory, repoProfile);
      sink.mergeProjectMemory(mergedMemory);
      if (serverBacked) saveProjectMemory(activeProject.id, mergedMemory).catch(console.error);
    }

    // Handle tool result tracking
    if (runningTool?.function?.name && typeof event.result === 'string' && activeProject?.id) {
      const runtimeArtifact = extractRuntimeArtifact(
        runningTool.function.name,
        runningTool.function.arguments || '{}',
        event.result
      );
      if (runtimeArtifact) {
        const withRuntime = mergeRuntimeArtifactIntoMemory(projectMemory, runtimeArtifact);
        const withGuiSession = runtimeArtifact.kind === 'gui'
          ? mergeGuiObservationIntoMemory(withRuntime, runtimeArtifact)
          : withRuntime;
        const mergedMemory = mergeEvidenceSummaryIntoMemory(withGuiSession);
        sink.mergeProjectMemory(mergedMemory);
        if (serverBacked) saveProjectMemory(activeProject.id, mergedMemory).catch(console.error);
      }
    }

    // Handle test validation
    if (runningTool?.function?.name === 'run_tests' && typeof event.result === 'string' && activeProject?.id) {
      const validation = buildValidationSnapshot(event.result);
      if (validation) {
        const mergedMemory = mergeEvidenceSummaryIntoMemory(
          mergeValidationIntoMemory(projectMemory, validation)
        );
        sink.mergeProjectMemory(mergedMemory);
        if (serverBacked) saveProjectMemory(activeProject.id, mergedMemory).catch(console.error);
      }
    }

    // Auto-port detection from terminal output
    if (typeof event.result === 'string' && event.result.includes('http://localhost:') && activeProject?.id) {
      const match = event.result.match(/http:\/\/localhost:(\d+)/);
      if (match && match[1]) {
        sink.updateProjectPort(activeProject.id, parseInt(match[1]));
      }
    }

    sink.addToolResult(toolMsg, updatedToolCallId);
    sink.incrementPreviewKey();
    return;
  }

  if (event.type === 'workspace_updated') {
    if (isWebChat) return;
    if (activeProject) {
      sink.updateProjectPort(activeProject?.id || '', 0); // signal workspace update
    }
    sink.incrementPreviewKey();
  }
}

// ==========================================
// Workspace Loading
// ==========================================

export interface WorkspaceLoadResult {
  projects: Project[];
  conversations: Conversation[];
  serverBacked: boolean;
  activeConvId: string | null;
  conversationsHasMore?: boolean;
}

export async function loadWorkspace(
  userKey: string | number | null | undefined,
  settings: Settings
): Promise<WorkspaceLoadResult> {
  if (!userKey) {
    return { projects: [], conversations: [], serverBacked: false, activeConvId: null };
  }

  try {
    const state = await loadWorkspaceState({ limit: 40, offset: 0 });
    if (state.projects.length === 0) {
      const created = await createProjectOnServer({
        name: getDefaultWorkspaceName(settings.productMode),
        path: 'workspace://default',
      });
      const newConv = {
        ...created.conversation,
        messages: settings.productMode === 'web_chat'
          ? []
          : [{
              id: generateId(),
              role: 'assistant' as const,
              content: getWelcomeMessage(settings.productMode, true),
              timestamp: Date.now(),
            }],
      };
      if (newConv.messages.length > 0) {
        await updateConversationOnServer(created.conversation.id, { messages: newConv.messages });
      }
      return {
        projects: [created.project],
        conversations: [newConv],
        serverBacked: true,
        activeConvId: created.conversation.id,
        conversationsHasMore: false,
      };
    }
    return {
      projects: state.projects,
      conversations: state.conversations,
      serverBacked: true,
      activeConvId: state.conversations[0]?.id || null,
      conversationsHasMore: Boolean(state.pagination?.hasMore),
    };
  } catch {
    return { projects: [], conversations: [], serverBacked: false, activeConvId: null };
  }
}

// ==========================================
// Simple service functions
// ==========================================

export {
  generateId,
  getDefaultConversationTitle,
  getDefaultWorkspaceName,
  getWelcomeMessage,
  isWelcomeLikeAssistantMessage,
  sanitizeWebChatHistory,
  buildWebReferentSummary,
  buildConversationTitleFromInput,
  loadWorkspaceState,
  listConversations,
  createProjectOnServer,
  updateProjectOnServer,
  deleteProjectOnServer,
  createConversationOnServer,
  updateConversationOnServer,
  deleteConversationOnServer,
  extractAttachments,
  getProjectMemory,
  getInteractions,
  getGuiCapabilities,
  getTaskPlan,
  previewDiff,
  applyDiff,
  resolveCheckpointRequest,
  runProjectHealthCheck,
  runTerminalStream,
  saveProjectMemory,
  submitApproval,
  normalizeUiErrorMessage,
  handleSSEEvent,
};
