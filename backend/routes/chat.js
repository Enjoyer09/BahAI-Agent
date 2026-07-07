// ==========================================
// Chat Route — POST /api/chat
// ==========================================

const crypto = require('crypto');
const path = require('path');
const express = require('express');
const router = express.Router();

const { getSession, findInstalledChromePath, listInstalledBrowsers } = require('../browserSession');
const { buildGuiCapabilityStatus } = require('../gui/capabilityStatus');
const { detectComputerUseStatus } = require('../gui/computerUseStatus');
const { appendGuiRepairGuidance } = require('../gui/repairGuidance');
const {
  isGuiObserveSelfTestRequest, isGuiLoginCheckpointRequest, isGuiLoginResumeRequest,
  isGuiOpenAndAwaitRequest, isGuiContinuationRequest, extractUrlFromGuiRequest,
  isSeoGuiCheckpointRequest, buildGuiBrowserOpenArgs, shouldAdvertiseScreenAgent, getGuiCapabilityHints
} = require('../gui/requests');
const {
  handleGuiLoginResume, handleGuiLoginCheckpointAction, handleGuiLoginCheckpoint,
  handleGuiSelfTest, handleGuiOpenAndAwaitInstruction, handleGuiContinuation,
  handleComputerUseOpenAndAwait, handleComputerUseContinuation
} = require('../gui/fastpath');
const { isComputerUseOpenRequest, isComputerUseContinuationRequest, extractComputerUseTarget } = require('../gui/computerUseRequests');
const { resolveOrchestrationConfig } = require('../orchestrator/workflowResolver');
const { buildRoleInstruction, buildPhaseHandoffMessage } = require('../orchestrator/rolePrompts');
const { createRunManager } = require('../orchestrator/runManager');
const { classifyEntryPath, buildGateReceipt } = require('../orchestrator/governance');
const { extractPlannerArtifact, buildPlannerArtifactPrompt, buildPlannerArtifactContext } = require('../orchestrator/plannerArtifact');
const { buildExecutionArtifact, buildExecutionArtifactContext, compactMessagesForNextPhase, classifyArtifactQuality } = require('../orchestrator/executionArtifact');
const { getToolDefinitions } = require('../tools/registry');
const { getToolsForProfile, getToolsForRole } = require('../tools/profiles');
const { buildProviderCandidates, normalizeProviderBaseUrl, detectWireApi, isResponsesSchemaMismatchError, buildOpenAIClient } = require('../chat/providers');
const { writeSse, initSse, emitOrchestrationPrelude, emitTaskPlan, emitGovernanceState } = require('../chat/sse');
const { collectStreamOutput } = require('../chat/stream');
const { executeToolCalls } = require('../chat/toolExecutor');
const { openAiStreamWithFallback } = require('../chat/runner');
const { runChatSession } = require('../chat/sessionController');
const { handleToolCall } = require('../toolRunner');
const {
  isLocalMode, shouldEmitDebugEvent, looksLikeOllamaModel, classifyTaskComplexity,
  isAuditStyleRequest, isCurrentFactsOrPublicWebsiteRequest, isFileClarificationLoop,
  normalizeToolName, buildToolCallCacheKey, isCacheableTool, isSensitiveTool,
  buildPhaseRecoveryInstruction, buildToolRecoveryInstruction, normalizeUserFacingError,
  normalizeFinalAssistantReport, flattenResponseJsonText, isPathSafe,
  resolveWorkingDirectory, buildApprovalMetadata, extractAttachment,
  normalizeMessagesForModel, generateToolsSystemPrompt, buildDeepSeekRecoveryMessages,
  extractTextToolCalls, serializeProject, serializeConversation,
  mapMessagesToResponsesInput, mapToolsToResponsesTools
} = require('../helpers');

async function readLocalDb() {
  try {
    const fs = require('fs/promises');
    const data = await fs.readFile(path.resolve(__dirname, '../../sandbox/local_db.json'), 'utf8').catch(() => '{}');
    return JSON.parse(data);
  } catch { return {}; }
}

// ==========================================
// POST /api/chat — MAIN CHAT ENDPOINT
// ==========================================

router.post('/', async (req, res) => {
  // --- Extract request params ---
  const { message, conversationId, projectId, safeMode, productMode, executionMode,
    orchestrationMode, workflow, frontendApiKey, frontendBaseUrl, frontendModel,
    guiBrowserMode, guiBrowserPath, guiBrowserCdpUrl } = req.body;

  const latestUserText = String(message || '').trim();
  const hasAttachment = Boolean(req.body.attachment);
  const hasAttachmentInRequest = hasAttachment && !latestUserText;

  if (!latestUserText && !hasAttachmentInRequest) {
    return res.status(400).json({ error: 'Mesaj tələb olunur' });
  }

  const workspaceRoot = path.resolve(process.env.WORKSPACE_ROOT || path.join(__dirname, '../../sandbox'));
  const resolvedWD = resolveWorkingDirectory(undefined, req.user);
  const MAX_STEPS = parseInt(process.env.MAX_AGENT_STEPS || '6', 10);
  const LLM_TIMEOUT_MS = parseInt(process.env.LLM_TIMEOUT_MS || '180000', 10);
  const LLM_TIMEOUT_CHAT = parseInt(process.env.LLM_TIMEOUT_CHAT || '60000', 10);

  // --- Auto-routing ---
  const autoIntent = frontendModel === 'auto'
    ? classifyTaskComplexity({ userMessage: latestUserText, messageHistoryLen: 0, hasAttachments: Boolean(req.body.attachment) })
    : null;

  const providerCandidates = buildProviderCandidates({
    frontendApiKey, frontendBaseUrl, frontendModel, autoIntent,
    productMode, executionMode, env: process.env,
    parseProviderPoolFromEnv: require('../helpers').parseProviderPoolFromEnv,
    looksLikeOllamaModel
  });

  if (providerCandidates.length === 0) {
    return res.status(503).json({ error: 'Heç bir AI provider konfiqurasiya edilməyib. Ayarlardan API açarı və model seçin.' });
  }

  let activeProvider = providerCandidates[0];
  let client = buildOpenAIClient(activeProvider);
  let effectiveModel = activeProvider.model;
  const effectiveModelRef = { current: effectiveModel };
  const activeProviderRef = { current: activeProvider };
  const clientRef = { current: client };
  const isLocalOrFlakyModel = isLocalMode() || !effectiveModel || /qwen|ollama|deepseek|llama|local|free|nemotron/i.test(effectiveModel);

  // --- Orchestration ---
  const resolvedOrchestration = resolveOrchestrationConfig(orchestrationMode, workflow, latestUserText, { productMode });
  const orchestration = resolvedOrchestration;
  const runManager = createRunManager(orchestration);
  const runId = crypto.randomUUID();
  const entryPath = classifyEntryPath({ latestUserText, workflow: orchestration.workflow, orchestration: null });
  const initialGateReceipt = buildGateReceipt({ plannerArtifact: null, executionArtifacts: [] });
  const isAuditStyle = isAuditStyleRequest(latestUserText);

  // --- Check GUI fast paths ---
  const conversationIdSafe = String(conversationId || 'default');
  const auditStyleRequest = isAuditStyle;

  // --- GUI Checkpoint (Wix login) ---
  if (isSeoGuiCheckpointRequest(latestUserText, orchestration.workflow) || isGuiLoginCheckpointRequest(latestUserText)) {
    const browserOpenArgs = buildGuiBrowserOpenArgs({
      url: 'https://www.wix.com',
      sessionId: 'gui-wix-live',
      guiBrowserMode, guiBrowserPath, guiBrowserCdpUrl,
      defaultCdpUrl: process.env.GUI_BROWSER_CDP_URL || 'http://127.0.0.1:9222',
      installedBrowsers: listInstalledBrowsers(),
      preferPersistentIfChrome: true
    });
    return handleGuiLoginCheckpoint({
      res, orchestration, runManager, resolvedWD, conversationId: conversationIdSafe,
      reqUser: req.user, handleToolCall, normalizeUserFacingError,
      browserOpenArgs, createCheckpoint: (id, payload) => { /* stub */ }
    });
  }

  // --- GUI self-test ---
  if (isGuiObserveSelfTestRequest(latestUserText)) {
    const browserOpenArgs = buildGuiBrowserOpenArgs({
      url: 'https://example.com', sessionId: 'gui-self-test',
      guiBrowserMode, guiBrowserPath, guiBrowserCdpUrl,
      defaultCdpUrl: process.env.GUI_BROWSER_CDP_URL || 'http://127.0.0.1:9222',
      installedBrowsers: listInstalledBrowsers()
    });
    return handleGuiSelfTest({
      res, orchestration, runManager, resolvedWD, reqUser: req.user,
      handleToolCall, normalizeUserFacingError, browserOpenArgs
    });
  }

  // --- GUI login resume ---
  if (isGuiLoginResumeRequest(latestUserText)) {
    return handleGuiLoginResume({
      res, orchestration, runManager, resolvedWD, reqUser: req.user,
      checkpoint: { sessionId: 'gui-wix-live', workflow: orchestration.workflow },
      latestUserText, handleToolCall, normalizeUserFacingError
    });
  }

  // --- GUI Open & Await ---
  if (isGuiOpenAndAwaitRequest(latestUserText)) {
    const url = extractUrlFromGuiRequest(latestUserText);
    if (url) {
      const browserOpenArgs = buildGuiBrowserOpenArgs({
        url, sessionId: 'gui-live', guiBrowserMode, guiBrowserPath, guiBrowserCdpUrl,
        defaultCdpUrl: process.env.GUI_BROWSER_CDP_URL || 'http://127.0.0.1:9222',
        installedBrowsers: listInstalledBrowsers()
      });
      return handleGuiOpenAndAwaitInstruction({
        res, orchestration, runManager, resolvedWD, reqUser: req.user,
        handleToolCall, normalizeUserFacingError, browserOpenArgs, promptText: latestUserText
      });
    }
  }

  // --- GUI continuation ---
  if (isGuiContinuationRequest(latestUserText)) {
    return handleGuiContinuation({
      res, orchestration, runManager, resolvedWD, reqUser: req.user,
      handleToolCall, normalizeUserFacingError, sessionId: 'gui-live', promptText: latestUserText
    });
  }

  // --- Computer Use fast paths ---
  if (isComputerUseOpenRequest(latestUserText, orchestration.workflow)) {
    const target = extractComputerUseTarget(latestUserText);
    return handleComputerUseOpenAndAwait({
      res, orchestration, runManager, target, promptText: latestUserText
    });
  }

  if (isComputerUseContinuationRequest(latestUserText, orchestration.workflow)) {
    return handleComputerUseContinuation({
      res, orchestration, runManager, promptText: latestUserText
    });
  }

  // --- Main Chat Processing ---
  const TOOLS = getToolDefinitions();
  const db = require('../db');

  // Build system message
  const workspaceHint = resolvedWD ? `Cari iş qovluğu: ${resolvedWD}` : '';
  const systemPrompt = `Sən BahAI agentisən — Azərbaycan dilində AI kodlaşdırma köməkçisi.

${workspaceHint}
${resolvedWD ? `Project Root: ${resolvedWD}` : ''}

Tool-ları istifadə edərək sualları cavablandır, kod yaz, faylları oxu/düzəlt, test işlət.

═══════════════════════════════════════════
WEB SCRAPING QAYDASI (bunu diqqətlə oxu!)
═══════════════════════════════════════════

Hansı tool-u seçməli:

• `web_fetch` — YALNIZ statik səhifələr üçün: plain HTML, blog yazıları, 
  API reference sənədləri, GitHub README-lər. JavaScript icra ETMİR.
  Sadəcə HTTP GET + HTML strip edir.

• `browser_open` + `browser_eval` — Dinamik (JS) səhifələr üçün: 
  e-ticarət saytları (laptopmarket.az, trendyol, wix), SPA-lar 
  (React/Vue/Angular), dashboard-lar, login tələb edən səhifələr.
  Playwright browser-də JS icra edir.

NECƏ:
  1) browser_open(url) — səhifəni aç
  2) browser_wait_for(state:'networkidle') — JS-nin yüklənməsini gözlə
  3) browser_eval("document.body.innerText") — bütün mətni çıxart
  və ya browser_eval("JSON.stringify([...document.querySelectorAll('...')].map(e => e.textContent))") 
  — konkret elementləri çıxart

BİRBAŞA NÜMUNƏ:
  İstifadəçi: "laptopmarket.az saytından ən ucuz laptopu tap"
  Sən: browser_open(url) -> browser_wait_for -> browser_eval ilə 
  qiymət siyahısını çıxart -> nəticəni analiz et -> ən ucuzu tap

═══════════════════════════════════════════

${generateToolsSystemPrompt(TOOLS)}`;

  const apiMessages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: latestUserText },
    ...(req.body.attachment ? [{
      role: 'user',
      content: '[İstifadəçi attachment göndərdi]',
      attachments: [req.body.attachment]
    }] : [])
  ];

  // Setup the chat session
  initSse(res);
  emitOrchestrationPrelude(res, { runId, orchestration, runManager, pendingAutoRouteEvent: null });

  try {
    await runChatSession({
      req, res, slotAcquired: true, conversationId: conversationIdSafe,
      runManager, orchestration, resolvedWD, latestUserText,
      auditStyleRequest: isAuditStyle, productMode: productMode || 'desktop_code',
      projectMemory: null, apiMessages,
      emitTaskPlan: (r, items) => emitTaskPlan(r, items),
      emitGovernanceState: (r, p) => emitGovernanceState(r, p),
      writeSse: (r, payload) => writeSse(r, payload),
      createPhaseContext: ({ currentMessages, runManager, orchestration, resolvedWD, auditStyleRequest, projectMemory }) => {
        const activePhase = orchestration.enabled ? runManager.currentPhase() : null;
        const phaseTools = activePhase
          ? getToolsForRole(activePhase.role, orchestration.workflow)
          : TOOLS;
        return { currentMessages, phaseTools, activePhase };
      },
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
      releaseChatSlot: () => {},
      setConversationAbort: () => {},
      reqUser: req.user,
      dependencies: {
        MAX_STEPS, effectiveModelRef, activeProviderRef, clientRef, isLocalOrFlakyModel,
        providerCandidates, providerRuntime: require('../helpers').providerRuntime || { markProviderFailure: () => {}, canUseProviderNow: () => true, markProviderSuccess: () => {} },
        buildOpenAIClient, normalizeMessagesForModel,
        mapMessagesToResponsesInput, mapToolsToResponsesTools,
        isResponsesSchemaMismatchError, buildDeepSeekRecoveryMessages,
        llmTimeoutMs: LLM_TIMEOUT_MS,
        handleToolCall, normalizeToolName, extractTextToolCalls,
        buildToolCallCacheKey, flattenResponseJsonText,
        normalizeFinalAssistantReport, isSensitiveTool,
        isLocalMode, buildApprovalMetadata, isCacheableTool,
        buildToolRecoveryInstruction, normalizeUserFacingError,
        crypto, hasAttachmentInRequest, safeMode, runId,
        entryPath, initialGateReceipt,
        buildFinalGateReceipt: ({ plannerArtifact, executionArtifacts }) => buildGateReceipt({ plannerArtifact, executionArtifacts })
      }
    });
  } catch (err) {
    console.error('Chat session error:', err);
    if (!res.writableEnded) {
      writeSse(res, { type: 'error', message: 'Server xətası baş verdi.' });
      res.end();
    }
  }
});

module.exports = router;
