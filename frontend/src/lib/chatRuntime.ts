import type { ActiveGuiSession, ApprovalRequest, ExecutionArtifact, GateReceipt, GovernanceEntryPath, GuiCapabilityStatus, HumanCheckpoint, PlannerArtifact, ProviderTelemetryEvent, RuntimeArtifact } from './types';

export function isToolCallLikeText(content: string): boolean {
  const text = String(content || '').trim();
  if (!text) return false;
  return (
    /^(?:https?:\/\/)?wttr\.in\/[^\s]+$/i.test(text) ||
    /^(?:["`{[]\s*)?web_search["']?,?\s*$/i.test(text) ||
    /^\s*\[\s*"[a-z0-9_]+"\s*,\s*(?:"[\s\S]*?"|\{[\s\S]*?\})\s*\]\s*$/i.test(text) ||
    /^(?:["`{[]\s*)?(?:web_fetch|browser_open|gui_step|gui_observe|run_terminal_command)["']?,?\s*$/i.test(text) ||
    /^[`{\s,]*$/is.test(text) ||
    /^(?:json\s+)?\{\s*"name"\s*:\s*"[^"]+"\s*,\s*"arguments"\s*:/is.test(text) ||
    /^```(?:json)?\s*\{\s*"name"\s*:\s*"[^"]+"\s*,\s*"arguments"\s*:/is.test(text) ||
    /^\{\s*"name"\s*:\s*"[^"]+"\s*,\s*"arguments"\s*:/is.test(text) ||
    /^(?:json\s+)?\{\s*"name"\s*:\s*"[^"]+"/is.test(text) ||
    /^(?:json\s+)?\{\s*"name"\s*:\s*"[^"]*$/is.test(text) ||
    /^(?:```(?:json)?\s*)?"arguments"\s*:\s*\{/is.test(text) ||
    /^(?:```(?:json)?\s*)?\{\s*"arguments"\s*:\s*\{/is.test(text) ||
    /^(?:```(?:json)?\s*)?"url"\s*:\s*"https?:\/\/[^\s"]+/is.test(text) ||
    /^(?:```(?:json)?\s*)?\{\s*"url"\s*:\s*"https?:\/\/[^\s"]+/is.test(text) ||
    /^(?:```(?:json)?\s*)?"query"\s*:\s*"[^"]+/is.test(text) ||
    /^(?:```(?:json)?\s*)?\{\s*"query"\s*:\s*"[^"]+/is.test(text) ||
    /^(?:```(?:json)?\s*)?"command"\s*:\s*"[^"]+/is.test(text) ||
    /^(?:```(?:json)?\s*)?\{\s*"command"\s*:\s*"[^"]+/is.test(text) ||
    /(?:^|[\s,{])"command"\s*:\s*"[^"]*(?:"\s*[}\],]*)?$/is.test(text) ||
    /(?:^|[\s,{])"query"\s*:\s*"[^"]*(?:"\s*[}\],]*)?$/is.test(text) ||
    /(?:^|[\s,{])command"\s*:\s*"[^"]*(?:"\s*[}\],]*)?$/is.test(text) ||
    /(?:^|[\s,{])query"\s*:\s*"[^"]*(?:"\s*[}\],]*)?$/is.test(text) ||
    /^command"\s*:\s*"[^"]*(?:"\s*[}\],]*)?$/is.test(text) ||
    /^query"\s*:\s*"[^"]*(?:"\s*[}\],]*)?$/is.test(text) ||
    /^command"\s*:\s*"[^"]+/is.test(text) ||
    /^query"\s*:\s*"[^"]+/is.test(text) ||
    /(?:^|[\s,{])"arguments"\s*:\s*\{?[^}]*$/is.test(text) ||
    /(?:^|[\s,{])"name"\s*:\s*"[^"]*$/is.test(text) ||
    /(?:^|[\s,{])"url"\s*:\s*"https?:\/\/[^\s"]*$/is.test(text) ||
    /^(?:```(?:json)?\s*)?"date"\s*:\s*"[^"]+/is.test(text) ||
    /^(?:```(?:json)?\s*)?\{\s*"date"\s*:\s*"[^"]+/is.test(text) ||
    /^```(?:json)?\s*\{\s*$/is.test(text) ||
    /^```(?:json)?\s*\{\s*"[\w]+"?\s*$/is.test(text) ||
    /^\{\s*"[\w]+"?\s*$/is.test(text) ||
    /^```(?:json)?\s*$/i.test(text) ||
    /^```\s*$/i.test(text)
  );
}

export function normalizeAssistantText(content: string): string {
  if (typeof content !== 'string') return '';
  const trimmed = content.trim();
  if (isToolCallLikeText(trimmed)) {
    return '';
  }
  if (/^(?:yenidən cəhd edirəm|yeniden cehd edirem)\b/i.test(trimmed) && !/[.?!…]$/.test(trimmed)) {
    return '';
  }
  if (/^(?:json\s+)?\{[\s\S]*"arguments"\s*:\s*\{[\s\S]*$/is.test(trimmed) && !/[.?!…:]$/.test(trimmed)) {
    return '';
  }
  const match = trimmed.match(/^\{\s*"response"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"\s*\}$/);
  const normalized = match && match[1]
    ? match[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\')
    : content;
  return normalizeWeatherUnits(normalized);
}

export function chooseAssistantContent(streamedRaw: string, finalRaw: string): string {
  const finalContent = normalizeAssistantText(finalRaw || '');
  const streamedContent = normalizeAssistantText(streamedRaw || '');
  const finalLooksTruncated = Boolean(
    streamedContent &&
    finalContent &&
    streamedContent.length > finalContent.length + 40 &&
    (
      finalContent.length < 160 ||
      streamedContent.startsWith(finalContent) ||
      finalContent.endsWith(':') ||
      finalContent.endsWith('...') ||
      /^(\*\*Problem\*\*|\*\*Findings\*\*)/i.test(finalContent)
    )
  );
  
  const extraPart = streamedContent.slice(finalContent.length).trim();
  const extraIsToolCall = extraPart.startsWith('```json') || extraPart.startsWith('{"name":') || extraPart.startsWith('{ "name":');

  if (finalLooksTruncated) {
    if (!extraIsToolCall) {
      return streamedContent;
    }
  }
  if (streamedContent.length > finalContent.length && finalContent.length < 120) {
    if (!extraIsToolCall) {
      return streamedContent;
    }
  }
  return finalContent;
}

export function simplifyAssistantTextForDedupe(value: string): string {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/\([^)]*°f[^)]*\)/gi, '')
    .replace(/\([^)]*mph[^)]*\)/gi, '')
    .replace(/\b\d+\s*°f\b/gi, '')
    .replace(/\b\d+\s*mph\b/gi, '')
    .replace(/[.!?…]+$/g, '')
    .trim()
    .toLowerCase();
}

export function areAssistantMessagesNearDuplicate(a: string, b: string): boolean {
  const left = simplifyAssistantTextForDedupe(a);
  const right = simplifyAssistantTextForDedupe(b);
  if (!left || !right) return false;
  if (left === right) return true;
  if (left.length > 120 && right.length > 120) {
    if (left.includes(right) || right.includes(left)) return true;
    const leftHead = left.slice(0, 180);
    const rightHead = right.slice(0, 180);
    if (leftHead === rightHead) return true;
  }
  return false;
}

function normalizeWeatherUnits(content: string): string {
  let text = String(content || '');
  if (!text) return text;
  text = text.replace(/\(\s*-?\d+\s*°F\s*\)/gi, '');
  text = text.replace(/,\s*-?\d+\s*°F\b/gi, '');
  text = text.replace(/\b-?\d+\s*°F\b/gi, '');
  text = text.replace(/\(\s*(\d+(?:[.,]\d+)?)\s*mph\s*\)/gi, '');
  text = text.replace(/\b(\d+(?:[.,]\d+)?)\s*mph\b/gi, '');
  text = text.replace(/[ \t]{2,}/g, ' ');
  text = text.replace(/\(\s*\)/g, '');
  text = text.replace(/[ \t]+([,.;!?])/g, '$1');
  return text.trim();
}

export function normalizeUiErrorMessage(content: string): string {
  const text = String(content || '').trim();
  if (!text) return 'Naməlum xəta baş verdi.';
  return text
    .replace(/^API xətası:\s*/i, '')
    .replace(/^Tool xətası:\s*/i, '')
    .replace(/^Error executing tool:\s*/i, '');
}

export function extractRepoProfileFromToolResult(content: string): Record<string, unknown> | null {
  const text = String(content || '');
  const match = text.match(/\[REPO_PROFILE_JSON\]\s*([\s\S]+?)(?:\n\n|$)/);
  if (!match || !match[1]) return null;
  try {
    return JSON.parse(match[1].trim());
  } catch {
    return null;
  }
}

export function mergeRepoProfileIntoMemory(memory: Record<string, unknown>, repoProfile: Record<string, unknown>) {
  return {
    ...memory,
    repoProfile,
    repoProfileUpdatedAt: Date.now(),
    ecosystem: repoProfile.ecosystem || memory.ecosystem || '',
    packageManager: repoProfile.packageManager || memory.packageManager || '',
    repoShape: repoProfile.repoShape || memory.repoShape || '',
    frameworks: repoProfile.frameworks || memory.frameworks || [],
    entryPoints: repoProfile.entryPoints || memory.entryPoints || [],
    buildCommand: repoProfile.buildCommand || memory.buildCommand || '',
    testCommand: repoProfile.testCommand || memory.testCommand || '',
    lintCommand: repoProfile.lintCommand || memory.lintCommand || ''
  };
}

export function mergePlannerArtifactIntoMemory(memory: Record<string, unknown>, artifact: PlannerArtifact, prompt: string) {
  return {
    ...memory,
    latestPrompt: prompt || (memory.latestPrompt as string) || '',
    plannerArtifact: artifact,
    latestGoal: artifact.goal || '',
    plannedFiles: artifact.filesToInspect || [],
    plannedRisks: artifact.suspectedRisks || [],
    plannedSteps: artifact.implementationSteps || [],
    verificationPlan: artifact.verificationSteps || [],
    plannerSummary: artifact.summary || '',
    plannerUpdatedAt: Date.now()
  };
}

export function mergeExecutionArtifactsIntoMemory(memory: Record<string, unknown>, artifacts: ExecutionArtifact[]) {
  return {
    ...memory,
    executionArtifacts: artifacts,
    lastExecutionArtifact: artifacts.length > 0 ? artifacts[artifacts.length - 1] : null,
    executionUpdatedAt: Date.now()
  };
}

export function extractRuntimeArtifact(toolName: string, args: string, result: string): RuntimeArtifact | null {
  const tool = String(toolName || '');
  const output = String(result || '').trim();
  let parsedArgs: Record<string, unknown> = {};
  try {
    parsedArgs = JSON.parse(String(args || '{}'));
  } catch {
    parsedArgs = {};
  }

  if (tool.startsWith('browser_')) {
    const sessionMatch = output.match(/sessionId["=: ]+([a-zA-Z0-9._-]+)/i) || output.match(/^Session:\s*([a-zA-Z0-9._-]+)/im) || output.match(/"sessionId":"([^"]+)"/i);
    const screenshotMatch = output.match(/Screenshot saved:\s*(.+)$/im);
    return {
      kind: 'browser',
      toolName: tool,
      summary: output.slice(0, 400) || tool,
      sessionId: sessionMatch?.[1]?.trim() || (typeof parsedArgs.sessionId === 'string' ? parsedArgs.sessionId : undefined),
      screenshotPath: screenshotMatch?.[1]?.trim() || undefined,
      selector: typeof parsedArgs.selector === 'string' ? parsedArgs.selector : undefined,
      url: typeof parsedArgs.url === 'string' ? parsedArgs.url : undefined,
      output: output.slice(0, 1200),
      status: /error/i.test(output) ? 'failed' : 'info',
      timestamp: Date.now()
    };
  }

  if (tool.startsWith('gui_')) {
    let parsedResult: Record<string, any> = {};
    try {
      parsedResult = JSON.parse(output || '{}');
    } catch {
      parsedResult = {};
    }
    const observation = parsedResult.observation || {};
    const assessment = parsedResult.assessment || null;
    const action = parsedResult.action || null;
    const reflection = parsedResult.reflection || {};
    const failed = assessment?.executable === false || reflection?.success === false || /error/i.test(output);
    const summaryParts = [
      action?.type ? `Action: ${action.type}` : tool,
      assessment?.reason || reflection?.nextRecommendation || ''
    ].filter(Boolean);
    return {
      kind: 'gui',
      toolName: tool,
      summary: summaryParts.join(' | ').slice(0, 400) || tool,
      screenshotPath: typeof observation.screenshotPath === 'string' ? observation.screenshotPath : undefined,
      selector: typeof action?.selector === 'string' ? action.selector : undefined,
      url: typeof observation.url === 'string' ? observation.url : undefined,
      action,
      assessment,
      output: output.slice(0, 1600),
      status: failed ? 'failed' : 'info',
      timestamp: Date.now()
    };
  }

  if (tool === 'run_terminal_command') {
    const command = typeof parsedArgs.command === 'string' ? parsedArgs.command : '';
    const failed = /exit code\s+[1-9]|error|failed/i.test(output);
    return {
      kind: 'terminal',
      toolName: tool,
      command,
      summary: command || output.slice(0, 200) || 'terminal command',
      output: output.slice(0, 1200),
      status: failed ? 'failed' : 'info',
      timestamp: Date.now()
    };
  }

  return null;
}

export function mergeRuntimeArtifactIntoMemory(memory: Record<string, unknown>, artifact: RuntimeArtifact) {
  const history = Array.isArray(memory.runtimeArtifacts) ? memory.runtimeArtifacts : [];
  const nextMemory = {
    ...memory,
    lastRuntimeArtifact: artifact,
    runtimeArtifacts: [...history, artifact].slice(-12),
    lastBrowserArtifact: (artifact.kind === 'browser' || artifact.kind === 'gui') ? artifact : memory.lastBrowserArtifact || null,
    lastGuiArtifact: artifact.kind === 'gui' ? artifact : memory.lastGuiArtifact || null,
    lastTerminalArtifact: artifact.kind === 'terminal' ? artifact : memory.lastTerminalArtifact || null
  };
  if (artifact.kind === 'browser' && artifact.sessionId) {
    return {
      ...nextMemory,
      activeGuiSession: {
        sessionId: artifact.sessionId,
        workflow: (memory.activeGuiSession as any)?.workflow || 'gui',
        status: 'ready',
        title: artifact.summary,
        url: artifact.url,
        updatedAt: Date.now()
      }
    };
  }
  return nextMemory;
}

export function mergeProviderTelemetryIntoMemory(memory: Record<string, unknown>, event: ProviderTelemetryEvent) {
  const nextEvent = {
    ...event,
    timestamp: event.timestamp || Date.now()
  };
  const history = Array.isArray(memory.providerTelemetry) ? memory.providerTelemetry : [];
  return {
    ...memory,
    lastProviderTelemetry: nextEvent,
    providerTelemetry: [...history, nextEvent].slice(-20)
  };
}

// Keys that must never reach web chat project memory: provider routing
// telemetry, token usage and GUI/browser capability status are desktop
// ops-panel details (see OpsPanel).
const WEB_PRIVACY_MEMORY_KEYS = ['providerTelemetry', 'lastProviderTelemetry', 'tokenUsage', 'guiCapabilities', 'guiCapabilitiesUpdatedAt'] as const;

/**
 * Strip provider/model internals from a project-memory payload. Used on every
 * web-chat memory write (and on web-chat memory load) so provider telemetry,
 * token usage and GUI capability status are completely excluded from web
 * project memory, even if a value was persisted by an older session.
 * Desktop (OpsPanel) never calls this — GUI capabilities stay available there.
 */
export function stripProviderDetailsFromMemory(memory: Record<string, unknown>): Record<string, unknown> {
  if (!memory || typeof memory !== 'object') return memory;
  const next = { ...memory };
  for (const key of WEB_PRIVACY_MEMORY_KEYS) {
    delete next[key];
  }
  return next;
}

export function buildValidationSnapshot(result: string) {
  const text = String(result || '').trim();
  if (!text) return null;
  const failed = /\[(failed|error)\]/i.test(text) || /uğursuz|xəta|error/i.test(text);
  const passed = /\[passed\]/i.test(text) || /validation nəticələri/i.test(text);
  if (!failed && !passed) return null;

  return {
    summary: text.slice(0, 800),
    status: failed ? 'failed' : 'passed',
    updatedAt: Date.now()
  };
}

export function mergeValidationIntoMemory(memory: Record<string, unknown>, validation: { summary: string; status: string; updatedAt: number }) {
  const history = Array.isArray(memory.validationHistory) ? memory.validationHistory : [];
  return {
    ...memory,
    lastValidation: validation,
    validationHistory: [...history, validation].slice(-8)
  };
}

export function mergeApprovalDecisionIntoMemory(
  memory: Record<string, unknown>,
  approval: ApprovalRequest,
  decision: 'approve' | 'reject'
) {
  const history = Array.isArray(memory.approvalHistory) ? memory.approvalHistory : [];
  const entry = {
    tool: approval.tool,
    title: approval.meta?.title || approval.tool,
    summary: approval.meta?.summary || '',
    riskLevel: approval.meta?.riskLevel || 'medium',
    decision,
    updatedAt: Date.now()
  };
  return {
    ...memory,
    lastApprovalDecision: entry,
    approvalHistory: [...history, entry].slice(-10)
  };
}

export function buildEvidenceSummary(memory: Record<string, unknown>) {
  const lastValidation = (memory.lastValidation || null) as { status?: string; summary?: string } | null;
  const lastBrowserArtifact = (memory.lastBrowserArtifact || null) as RuntimeArtifact | null;
  const lastGuiArtifact = (memory.lastGuiArtifact || null) as RuntimeArtifact | null;
  const lastTerminalArtifact = (memory.lastTerminalArtifact || null) as RuntimeArtifact | null;

  const items = [
    {
      label: 'Validation',
      status: lastValidation?.status || 'missing',
      summary: lastValidation?.summary || 'Validation evidence yoxdur'
    },
    {
      label: 'Browser',
      status: lastBrowserArtifact?.status || 'missing',
      summary: lastBrowserArtifact?.summary || 'Browser evidence yoxdur'
    },
    {
      label: 'GUI',
      status: lastGuiArtifact?.status || 'missing',
      summary: lastGuiArtifact?.summary || lastGuiArtifact?.assessment?.reason || 'GUI evidence yoxdur'
    },
    {
      label: 'Terminal',
      status: lastTerminalArtifact?.status || 'missing',
      summary: lastTerminalArtifact?.summary || lastTerminalArtifact?.output || 'Terminal evidence yoxdur'
    }
  ];

  const passedCount = items.filter((item) => item.status === 'passed' || item.status === 'info').length;
  const failedCount = items.filter((item) => item.status === 'failed').length;
  const missingCount = items.filter((item) => item.status === 'missing').length;

  return {
    items,
    headline: `Evidence: ${passedCount} ok | ${failedCount} failed | ${missingCount} missing`,
    updatedAt: Date.now()
  };
}

export function mergeEvidenceSummaryIntoMemory(memory: Record<string, unknown>) {
  return {
    ...memory,
    evidenceSummary: buildEvidenceSummary(memory)
  };
}

export function mergeGuiCapabilitiesIntoMemory(memory: Record<string, unknown>, guiCapabilities: GuiCapabilityStatus) {
  return {
    ...memory,
    guiCapabilities,
    guiCapabilitiesUpdatedAt: Date.now()
  };
}

export function mergeGovernanceIntoMemory(
  memory: Record<string, unknown>,
  entryPath: GovernanceEntryPath,
  gateReceipt: GateReceipt
) {
  return {
    ...memory,
    governance: {
      entryPath,
      gateReceipt,
      updatedAt: Date.now()
    }
  };
}

export function mergeHumanCheckpointIntoMemory(memory: Record<string, unknown>, checkpoint: HumanCheckpoint | null) {
  if (!checkpoint?.sessionId) return memory;
  const activeGuiSession: ActiveGuiSession = {
    sessionId: checkpoint.sessionId,
    workflow: checkpoint.workflow,
    status: checkpoint.kind === 'login' ? 'pending_login' : 'observing',
    checkpointId: checkpoint.id,
    conversationId: checkpoint.conversationId,
    runId: checkpoint.runId,
    phaseRole: checkpoint.phaseRole,
    updatedAt: Date.now()
  };
  return {
    ...memory,
    activeGuiSession
  };
}

export function mergeGuiObservationIntoMemory(memory: Record<string, unknown>, runtimeArtifact: RuntimeArtifact) {
  const existing = (memory.activeGuiSession || null) as ActiveGuiSession | null;
  const sessionId = existing?.sessionId || 'default';
  return {
    ...memory,
    activeGuiSession: {
      sessionId,
      workflow: existing?.workflow,
      checkpointId: existing?.checkpointId,
      conversationId: existing?.conversationId,
      runId: existing?.runId,
      phaseRole: existing?.phaseRole,
      status: runtimeArtifact.status === 'failed' ? 'failed' : 'ready',
      title: runtimeArtifact.summary || existing?.title,
      url: runtimeArtifact.url || existing?.url,
      updatedAt: Date.now()
    }
  };
}

export function resolveActiveGuiSessionInMemory(memory: Record<string, unknown>, decision: 'resume' | 'cancel') {
  const existing = (memory.activeGuiSession || null) as ActiveGuiSession | null;
  if (!existing) return memory;
  return {
    ...memory,
    activeGuiSession: {
      ...existing,
      status: decision === 'resume' ? 'observing' : 'closed',
      updatedAt: Date.now()
    }
  };
}
