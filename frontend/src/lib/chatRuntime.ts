import type { ActiveGuiSession, ApprovalRequest, ExecutionArtifact, GateReceipt, GovernanceEntryPath, GuiCapabilityStatus, HumanCheckpoint, PlannerArtifact, RuntimeArtifact } from './types';

export function normalizeAssistantText(content: string): string {
  if (typeof content !== 'string') return '';
  const trimmed = content.trim();
  const match = trimmed.match(/^\{\s*"response"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"\s*\}$/);
  if (!match || !match[1]) return content;
  return match[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
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
  if (finalLooksTruncated) return streamedContent;
  if (streamedContent.length > finalContent.length && finalContent.length < 120) {
    return streamedContent;
  }
  return finalContent;
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
