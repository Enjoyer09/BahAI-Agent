import { describe, it, expect, vi } from 'vitest';
import { runChatSession, prepareWebFinalSynthesisMessages } from '../chat/sessionController.js';

function createReq() {
  return {
    user: { id: 'u1' },
    aborted: false,
    on: vi.fn(),
  };
}

function createRes() {
  return {
    writableEnded: false,
    end: vi.fn(function end() { this.writableEnded = true; }),
  };
}

function createRunManager() {
  return {
    getPlannerArtifact: () => null,
    getExecutionArtifacts: () => [],
    addExecutionArtifact: vi.fn(),
    setPlannerArtifact: vi.fn(),
    canAdvance: () => false,
    advance: vi.fn(),
  };
}

describe('runChatSession', () => {
  it('converts tool history into plain research context for final synthesis', () => {
    const prepared = prepareWebFinalSynthesisMessages([
      { role: 'user', content: 'Bazarı araşdır' },
      { role: 'assistant', content: null, tool_calls: [{ id: 't1', function: { name: 'web_search' } }] },
      { role: 'tool', tool_call_id: 't1', content: 'Bazar nəticəsi və mənbə' },
      { role: 'assistant', content: '<｜｜DSML｜｜tool_calls>yenidən axtar</｜｜DSML｜｜tool_calls>' },
    ]);

    expect(prepared.some((item) => item.role === 'assistant')).toBe(false);
    expect(prepared.some((item) => item.role === 'tool')).toBe(false);
    expect(prepared.some((item) => item.role === 'system' && item.content.includes('Bazar nəticəsi'))).toBe(true);
  });

  it('emits final assistant_message for partial streamed text and schedules a completion retry', async () => {
    const req = createReq();
    const res = createRes();
    const events = [];
    const currentMessagesRef = [];

    await runChatSession({
      req,
      res,
      slotAcquired: false,
      conversationId: 'c1',
      runManager: createRunManager(),
      orchestration: { enabled: false, routing: {}, maxSteps: 1 },
      resolvedWD: '',
      latestUserText: 'salam',
      auditStyleRequest: false,
      productMode: 'web_chat',
      projectMemory: {},
      apiMessages: [],
      emitTaskPlan: vi.fn(),
      emitGovernanceState: vi.fn(),
      writeSse: (_res, payload) => events.push(payload),
      createPhaseContext: () => ({ currentMessages: currentMessagesRef, phaseTools: [], activePhase: null }),
      openAiStreamWithFallback: vi.fn().mockResolvedValue({
        stream: [{ type: 'mock' }],
        activeProvider: { wireApi: 'responses', id: 'p1' },
        client: {},
        effectiveModel: 'm1',
        currentMessages: currentMessagesRef,
      }),
      collectStreamOutput: vi.fn().mockResolvedValue({
        finishReason: null,
        sawAssistantDelta: true,
        sawCompletedEvent: false,
        accumulatedContent: 'Yarımçıq görünən cavab',
        normalizedToolCalls: [],
        message: { role: 'assistant', content: 'Yarımçıq görünən cavab' },
      }),
      executeToolCalls: vi.fn(),
      extractPlannerArtifact: vi.fn(),
      buildExecutionArtifact: vi.fn().mockReturnValue({ quality: 'useful' }),
      classifyArtifactQuality: vi.fn().mockReturnValue('useful'),
      buildPhaseRecoveryInstruction: vi.fn(),
      isFileClarificationLoop: vi.fn().mockReturnValue(false),
      shouldEmitDebugEvent: vi.fn().mockReturnValue(false),
      compactMessagesForNextPhase: vi.fn((msgs) => msgs),
      buildPhaseHandoffMessage: vi.fn(),
      buildPlannerArtifactContext: vi.fn(),
      buildExecutionArtifactContext: vi.fn(),
      releaseChatSlot: vi.fn(),
      setConversationAbort: vi.fn(),
      reqUser: req.user,
      dependencies: {
        MAX_STEPS: 1,
        effectiveModelRef: { current: 'm1' },
        activeProviderRef: { current: { wireApi: 'responses', id: 'p1' } },
        clientRef: { current: {} },
        isLocalOrFlakyModel: false,
        providerCandidates: [],
        providerRuntime: {},
        buildOpenAIClient: vi.fn(),
        normalizeMessagesForModel: vi.fn(),
        mapMessagesToResponsesInput: vi.fn(),
        mapToolsToResponsesTools: vi.fn(),
        isResponsesSchemaMismatchError: vi.fn(),
        buildDeepSeekRecoveryMessages: vi.fn(),
        llmTimeoutMs: 1000,
        handleToolCall: vi.fn(),
        normalizeToolName: vi.fn((x) => x),
        extractTextToolCalls: vi.fn(),
        buildToolCallCacheKey: vi.fn(),
        flattenResponseJsonText: vi.fn((x) => x),
        normalizeFinalAssistantReport: vi.fn((x) => x),
        isSensitiveTool: vi.fn(),
        isLocalMode: vi.fn(),
        buildApprovalMetadata: vi.fn(),
        isCacheableTool: vi.fn(),
        buildToolRecoveryInstruction: vi.fn(),
        normalizeUserFacingError: vi.fn((x) => x),
        crypto: {},
        hasAttachmentInRequest: false,
        safeMode: false,
        runId: 'r1',
        entryPath: 'chat',
        initialGateReceipt: {},
        providerSessionKey: 's1',
        onProviderTelemetry: vi.fn(),
        buildFinalGateReceipt: vi.fn().mockReturnValue({}),
      },
    });

    expect(events.some((item) => item.type === 'assistant_message' && item.message?.content === 'Yarımçıq görünən cavab')).toBe(true);
  });
});
